# clouddeploy/server.py
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from pathlib import Path
from typing import Optional, Set, List, Dict, Any, Tuple

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .ibm.automation import decide_input
from .llm.llm_provider import build_llm
from .llm.prompts import build_prompts, render_status_prompt
from .mcp.tools import ToolRegistry
from .redact import redact_text

# Settings store (file-backed) + redaction
from .settings import get_store, redact_settings

# NEW: real provider model discovery (OpenAI/Claude/Watsonx/Ollama)
from .llm.model_catalog import list_models_for_provider
from .llm.settings import LLMProvider, get_settings

APP_ROOT = Path(__file__).parent
WEB_DIR = APP_ROOT / "web"
SCRIPTS_DIR = (APP_ROOT.parent / "scripts").resolve()

app = FastAPI(title="CloudDeploy")
app.mount("/assets", StaticFiles(directory=str(WEB_DIR), html=False), name="assets")

autopilot_task: Optional[asyncio.Task] = None
autopilot_enabled: bool = False
autopilot_clients: Set[WebSocket] = set()

# Prevent race conditions between start/stop/autopilot toggles
_session_lock = asyncio.Lock()
_autopilot_lock = asyncio.Lock()

# NEW: prevent command interleaving (plan execution vs manual typing vs autopilot)
_exec_lock = asyncio.Lock()
_exec_active: bool = False

# Settings store (file-backed)
settings_store = get_store()

# ---------------------------------------------------------------------------
# Models endpoint cache (prevents hammering provider APIs)
# ---------------------------------------------------------------------------
_models_cache: Dict[str, Tuple[float, List[str], Optional[str]]] = {}
MODELS_CACHE_TTL_S = 300  # 5 minutes


def _strict_policy() -> Optional[bool]:
    v = os.getenv("CLOUDDEPLOY_STRICT_POLICY", "").strip().lower()
    if v in {"1", "true", "yes", "on"}:
        return True
    if v in {"0", "false", "no", "off"}:
        return False
    return None


def _default_cmd() -> str:
    return os.getenv("CLOUDDEPLOY_RUN_CMD") or os.getenv("CLOUDDEPLOY_DEFAULT_CMD") or "bash"


# IMPORTANT: do NOT start session automatically. Only /api/session/start starts it.
tools = ToolRegistry(command=_default_cmd(), strict_policy=_strict_policy())


async def _safe_cancel(task: Optional[asyncio.Task]) -> None:
    """
    Best-practice: cancel and await a task, but never let CancelledError
    bubble into ASGI logs (especially from WebSocket handlers).
    """
    if not task or task.done():
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception:
        pass


def _get_runner():
    return getattr(tools, "_runner", None)


async def _cleanup_dead_session_if_needed() -> None:
    """
    Production self-heal:
    If the PTY process has exited but ToolRegistry still reports running,
    clean up runner + disable autopilot so UI never freezes.
    """
    global autopilot_enabled, autopilot_task

    runner = _get_runner()
    if runner is None:
        return

    try:
        is_running_attr = getattr(runner, "is_running", None)
        if callable(is_running_attr):
            alive = bool(is_running_attr())
        else:
            alive = bool(getattr(runner, "pid", None)) and not bool(getattr(runner, "_closed", False))
    except Exception:
        alive = False

    if alive:
        return

    async with _session_lock:
        async with _autopilot_lock:
            autopilot_enabled = False
            try:
                await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
            except Exception:
                pass

            await _safe_cancel(autopilot_task)
            autopilot_task = None

        try:
            runner.close()
        except Exception:
            pass

        try:
            setattr(tools, "_runner", None)
        except Exception:
            pass


async def _session_status() -> Dict[str, Any]:
    """
    Authoritative status used by endpoints + websockets.
    Ensures 'running' can't be stuck True after PTY exits.
    """
    await _cleanup_dead_session_if_needed()
    st = tools.call("session.status", {}) or {}
    if st.get("running") and _get_runner() is None:
        st["running"] = False
    return st


def _load_settings() -> Dict[str, Any]:
    return settings_store.load()


@app.get("/favicon.ico")
def favicon() -> Response:
    return Response(status_code=204)


@app.get("/")
def index() -> HTMLResponse:
    html = (WEB_DIR / "index.html").read_text("utf-8")
    title = os.getenv("CLOUDDEPLOY_UI_TITLE", "CloudDeploy Enterprise Workspace")
    html = html.replace("CloudDeploy Enterprise Workspace", title)
    return HTMLResponse(html)


# ---------------------------------------------------------------------------
# Helpers: stop masked keys from overwriting real keys (CRITICAL)
# ---------------------------------------------------------------------------

_MASK_RE = re.compile(r"^\*{3,}$|^[A-Za-z0-9]{0,6}\*{3,}[A-Za-z0-9]{0,6}$")


def _looks_masked(secret: Any) -> bool:
    s = str(secret or "").strip()
    if not s:
        return False
    return "*" in s and bool(_MASK_RE.match(s))


def _apply_llm_patch_preserving_secrets(patch: Dict[str, Any]) -> Dict[str, Any]:
    """
    If UI sends masked api_key (e.g. 'sk-***xyz'), ignore it and keep stored secret.
    This prevents "open settings then save destroys key".
    """
    current = _load_settings()

    def fix_provider_section(provider: str) -> None:
        if provider not in patch or not isinstance(patch.get(provider), dict):
            return
        sec = patch[provider]
        if "api_key" in sec and _looks_masked(sec.get("api_key")):
            # remove masked key so store.update keeps the current one
            sec.pop("api_key", None)

    for p in ("openai", "claude", "watsonx"):
        fix_provider_section(p)

    # Also protect nested payloads (some UIs send {provider:..., openai:{...}} etc.)
    # After stripping masked keys, if a section became empty, drop it.
    for p in ("openai", "claude", "watsonx", "ollama"):
        if isinstance(patch.get(p), dict) and len(patch[p]) == 0:
            patch.pop(p, None)

    return patch


# ---------------------------------------------------------------------------
# Plan approval execution (EXPANDED for mkdir, touch, cp, mv, etc.)
# ---------------------------------------------------------------------------

# Block shell metacharacters (but allow spaces in paths)
_META_CHARS = re.compile(r"[;&|`$<>\\]|(\$\()|(\)\s*)")

# Block obviously destructive commands
_BLOCKLIST = re.compile(
    r"\b(sudo|shutdown|reboot|mkfs|dd|:>|chmod\s+777|chown|useradd|usermod|groupadd|iptables|ufw|systemctl|service)\b",
    re.IGNORECASE,
)

# EXPANDED allowlist: read-only + common write operations (mkdir, touch, cp, mv, etc.)
_ALLOWED_PREFIXES = {
    # Read-only / inspection commands
    "ls",
    "pwd",
    "whoami",
    "id",
    "date",
    "uname",
    "env",
    "printenv",
    "echo",
    "cat",
    "head",
    "tail",
    "grep",
    "find",
    "stat",
    "du",
    "df",
    "ps",
    "top",
    "tree",
    "file",
    "which",
    "whereis",
    # Write operations (safe for development/deployment)
    "mkdir",   # ✅ CREATE FOLDERS
    "touch",   # ✅ CREATE FILES
    "cp",      # ✅ COPY FILES
    "mv",      # ✅ MOVE/RENAME FILES
    "rm",      # ⚠️ ALLOW with validation (see special handling below)
    "nano",    # Text editors
    "vi",
    "vim",
    # Cloud/Container CLIs
    "docker",
    "ibmcloud",
    "kubectl",
    "helm",
    "git",
    # Development tools
    "npm",
    "yarn",
    "pip",
    "python",
    "python3",
    "node",
    "jq",
    "curl",
    "wget",
    # Build/deploy
    "make",
    "mvn",
    "gradle",
}

# For "powerful" CLIs, enforce read-only-ish subcommands
_READONLY_SUBCOMMANDS = {
    "docker": {"ps", "images", "info", "version", "logs", "inspect", "stats", "build", "run", "exec"},
    "kubectl": {"get", "describe", "logs", "top", "version", "config", "apply", "create", "delete"},
    "helm": {"list", "status", "get", "version", "install", "upgrade", "uninstall"},
    "git": {"status", "log", "diff", "branch", "rev-parse", "show", "clone", "pull", "push", "commit", "add"},
    "ibmcloud": {"version", "help", "target", "regions", "resource", "cr", "ce", "login", "ks", "plugin"},
}

# Special validation for rm: only allow specific safe patterns
_SAFE_RM_PATTERNS = [
    r"^rm\s+-rf?\s+[a-zA-Z0-9_\-./]+$",  # rm -rf folder_name or ./path/to/folder
    r"^rm\s+[a-zA-Z0-9_\-./]+\.(txt|log|tmp|json|yml|yaml)$",  # rm file.txt
]


def _validate_rm_command(cmd: str) -> Tuple[bool, str]:
    """
    Special validation for rm commands.
    Only allow safe patterns like:
    - rm -rf temp_folder
    - rm file.txt
    Block dangerous patterns like:
    - rm -rf / 
    - rm -rf /*
    - rm -rf ~
    """
    c = cmd.strip()
    
    # Block extremely dangerous patterns
    if re.search(r"rm\s+.*(/\s|/\*|\~|\.\.)", c):
        return False, "rm with /, /*, ~, or .. is not allowed"
    
    # Check if it matches any safe pattern
    for pattern in _SAFE_RM_PATTERNS:
        if re.match(pattern, c):
            return True, ""
    
    return False, "rm command doesn't match safe patterns (use: rm file.txt or rm -rf folder_name)"


def _validate_cmd(cmd: str) -> Tuple[bool, str]:
    """
    Validates commands with expanded allowlist for practical use.
    Returns (ok, error_message).
    """
    c = (cmd or "").strip()
    if not c:
        return False, "Empty command"
    if len(c) > 500:
        return False, "Command too long"
    
    # Block shell metacharacters (pipes, redirects, command chaining)
    if _META_CHARS.search(c):
        return False, "Shell metacharacters (|, ;, &, >, <, $, \\) are not allowed"
    
    # Block destructive commands
    if _BLOCKLIST.search(c):
        return False, "Command contains a blocked/destructive keyword"

    parts = c.split()
    root = parts[0].lower()

    if root not in _ALLOWED_PREFIXES:
        return False, f"Command '{root}' is not in the allowlist"

    # Special handling for rm
    if root == "rm":
        return _validate_rm_command(c)

    # For powerful CLIs, check subcommands
    if root in _READONLY_SUBCOMMANDS:
        if len(parts) < 2:
            return False, f"'{root}' requires a subcommand"
        sub = parts[1].lower()
        if sub not in _READONLY_SUBCOMMANDS[root]:
            return False, f"'{root} {sub}' is not in the allowed subcommands"

    return True, ""


async def _exec_plan_steps(steps: List[Dict[str, Any]]) -> Tuple[bool, str]:
    """
    Executes approved plan steps sequentially.
    IMPORTANT: Bypasses policy checks because commands are already validated by _validate_cmd.
    
    This is what actually TYPES the commands into the left terminal (PTY).
    """
    global _exec_active

    st = await _session_status()
    if not st.get("running"):
        return False, "No session is running"

    async with _exec_lock:
        if _exec_active:
            return False, "Execution is already in progress"
        _exec_active = True

        try:
            for i, step in enumerate(steps, start=1):
                cmd = str(step.get("cmd") or "").strip()
                ok, err = _validate_cmd(cmd)
                if not ok:
                    return False, f"Step {i} rejected: {err} | cmd={cmd}"

                # ✅ BYPASS POLICY: Write directly to PTY for approved plan commands
                # We already validated with _validate_cmd above, so skip cli.send policy
                runner = _get_runner()
                if runner is None:
                    return False, f"Step {i}: PTY session not available"
                
                try:
                    # Write command + newline directly to PTY
                    runner.write(f"{cmd}\n")
                except Exception as e:
                    return False, f"Step {i}: Failed to write to PTY: {e}"
                
                # Wait for command to execute and output to appear
                await asyncio.sleep(0.30)

            return True, ""
        finally:
            _exec_active = False


@app.post("/api/plan/execute")
async def api_plan_execute(payload: Dict[str, Any]) -> JSONResponse:
    """
    Execute an APPROVED plan.
    Payload:
      { "steps": [ {"cmd":"ls -la","why":"...","risk":"low"}, ... ] }
    
    This endpoint is called by the frontend when user clicks "Approve & Run".
    """
    steps = payload.get("steps") or []
    if not isinstance(steps, list) or len(steps) == 0:
        return JSONResponse({"ok": False, "error": "Missing steps"}, status_code=400)

    # Hard limit for safety
    if len(steps) > 15:
        return JSONResponse({"ok": False, "error": "Too many steps (max 15)"}, status_code=400)

    ok, err = await _exec_plan_steps(steps)
    if not ok:
        return JSONResponse({"ok": False, "error": err}, status_code=409)

    return JSONResponse({"ok": True, "executed": len(steps)})


# ---------------------------------------------------------------------------
# Settings API
# ---------------------------------------------------------------------------

@app.get("/api/settings")
def api_settings() -> JSONResponse:
    s = _load_settings()
    return JSONResponse(redact_settings(s))


@app.post("/api/settings/provider")
def api_settings_provider(payload: Dict[str, Any]) -> JSONResponse:
    provider = str(payload.get("provider") or "").strip().lower()
    updated = settings_store.update({"provider": provider})
    return JSONResponse(redact_settings(updated))


@app.put("/api/settings/llm")
def api_settings_llm(payload: Dict[str, Any]) -> JSONResponse:
    """
    Update one or more provider sections (partial patches supported).
    CRITICAL: masked api_key from UI must NOT overwrite stored secrets.
    """
    patch = _apply_llm_patch_preserving_secrets(payload or {})
    updated = settings_store.update(patch)
    return JSONResponse(redact_settings(updated))


@app.get("/api/settings/models")
def api_settings_models(provider: str = "") -> JSONResponse:
    """
    REAL model listing per provider (not static), cached.
    """
    p = (provider or "").strip().lower()
    try:
        llm_provider = LLMProvider(p)
    except Exception:
        return JSONResponse({"ok": False, "error": f"Invalid provider: {provider}"}, status_code=400)

    now = time.time()
    cached = _models_cache.get(p)
    if cached and (now - cached[0]) < MODELS_CACHE_TTL_S:
        _, models, err = cached
    else:
        settings = get_settings()
        models, err = list_models_for_provider(llm_provider, settings=settings)
        _models_cache[p] = (now, models, err)

    if err:
        return JSONResponse({"ok": False, "provider": p, "error": err, "models": []}, status_code=200)

    return JSONResponse({"ok": True, "provider": p, "models": models})


# ---------------------------------------------------------------------------
# Script Picker API
# ---------------------------------------------------------------------------

def _discover_scripts() -> List[Dict[str, Any]]:
    scripts: List[Dict[str, Any]] = []
    if SCRIPTS_DIR.exists():
        for p in sorted(SCRIPTS_DIR.glob("*.sh")):
            scripts.append(
                {
                    "id": p.stem,
                    "name": p.stem.replace("_", " ").title(),
                    "path": str(p),
                    "description": "Deployment helper script",
                }
            )

    scripts.append(
        {
            "id": "shell",
            "name": "Interactive Shell",
            "path": "bash",
            "description": "Start a bash shell session",
        }
    )
    return scripts


@app.get("/api/scripts")
def api_scripts() -> JSONResponse:
    return JSONResponse({"ok": True, "scripts": _discover_scripts()})


# ---------------------------------------------------------------------------
# Session status + stop endpoints
# ---------------------------------------------------------------------------

@app.get("/api/session/status")
async def api_session_status() -> JSONResponse:
    st = await _session_status()
    return JSONResponse({"ok": True, "running": bool(st.get("running")), "command": st.get("command") or ""})


@app.post("/api/session/stop")
async def api_session_stop() -> JSONResponse:
    """
    Stops the underlying PTY process (if running) and disables autopilot.
    Called only when user commits to starting a NEW session.
    """
    global autopilot_task, autopilot_enabled, _exec_active

    async with _session_lock:
        # stop autopilot
        async with _autopilot_lock:
            autopilot_enabled = False
            try:
                await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
            except Exception:
                pass

            await _safe_cancel(autopilot_task)
            autopilot_task = None

        # stop any in-flight plan execution
        async with _exec_lock:
            _exec_active = False

        # stop session
        try:
            tools.call("session.stop", {})
        except Exception:
            pass

        runner = _get_runner()
        if runner is not None:
            try:
                runner.terminate()
            except Exception:
                pass
            try:
                runner.close()
            except Exception:
                pass

        try:
            setattr(tools, "_runner", None)
        except Exception:
            pass

    return JSONResponse({"ok": True, "stopped": True})


@app.post("/api/session/start")
async def api_session_start(payload: Dict[str, Any]) -> JSONResponse:
    """
    Start session with a chosen command, but only if the PTY hasn't started yet.
    Self-heals stale status if a prior PTY died.
    """
    cmd = str(payload.get("cmd") or "").strip()
    if not cmd:
        return JSONResponse({"ok": False, "error": "Missing cmd"}, status_code=400)

    async with _session_lock:
        st = await _session_status()
        if st.get("running"):
            return JSONResponse({"ok": True, "already_running": True, "command": st.get("command")})

        tools.command = cmd
        tools.call("session.start", {})

    return JSONResponse({"ok": True, "command": cmd})


# ---------------------------------------------------------------------------
# Autopilot broadcast
# ---------------------------------------------------------------------------

async def broadcast_autopilot(event: dict) -> None:
    dead: Set[WebSocket] = set()
    for ws in list(autopilot_clients):
        try:
            await ws.send_json(event)
        except Exception:
            dead.add(ws)
    autopilot_clients.difference_update(dead)


# ---------------------------------------------------------------------------
# WebSockets
# ---------------------------------------------------------------------------

@app.websocket("/ws/terminal")
async def ws_terminal(ws: WebSocket) -> None:
    await ws.accept()
    last_sent = ""

    try:
        while True:
            st = await _session_status()
            if not st.get("running"):
                await asyncio.sleep(0.25)
                continue

            out = tools.call("cli.read", {"tail_chars": 12000, "redact": False}).get("text", "")
            if out and out != last_sent:
                if out.startswith(last_sent):
                    await ws.send_text(out[len(last_sent):])
                else:
                    await ws.send_text(out)
                last_sent = out

            await asyncio.sleep(0.08)
    except WebSocketDisconnect:
        return
    except asyncio.CancelledError:
        return
    except Exception:
        return
    finally:
        try:
            await ws.close()
        except Exception:
            pass


@app.websocket("/ws/terminal_input")
async def ws_terminal_input(ws: WebSocket) -> None:
    """
    Human typing channel.
    NOTE: we only block manual typing while plan execution is active to avoid interleaving.
    Autopilot may still run (wizard prompts), but it should also avoid sending while _exec_active.
    """
    await ws.accept()

    try:
        while True:
            data = await ws.receive_text()

            st = await _session_status()
            if not st.get("running"):
                continue

            # Block manual typing while plan execution is active (prevents interleaving).
            if _exec_active:
                # silently drop; frontend should disable typing during exec anyway
                continue

            try:
                runner = _get_runner()
                if runner is None:
                    continue
                runner.write(data)
            except Exception as e:
                try:
                    await ws.send_text(f"\r\n[clouddeploy] input error: {e}\r\n")
                except Exception:
                    pass
    except WebSocketDisconnect:
        return
    except asyncio.CancelledError:
        return
    except Exception:
        return
    finally:
        try:
            await ws.close()
        except Exception:
            pass


@app.websocket("/ws/state")
async def ws_state(ws: WebSocket) -> None:
    await ws.accept()

    try:
        while True:
            st_run = await _session_status()
            if not st_run.get("running"):
                await ws.send_json(
                    {
                        "phase": "idle",
                        "waiting_for_input": False,
                        "prompt": "",
                        "choices": [],
                        "completed": False,
                        "autopilot_enabled": autopilot_enabled,
                        "exec_active": _exec_active,
                    }
                )
                await asyncio.sleep(0.5)
                continue

            st = tools.call("state.get", {"tail_chars": 12000, "redact": True}).get("state", {}) or {}
            st["autopilot_enabled"] = autopilot_enabled
            st["exec_active"] = _exec_active
            await ws.send_json(st)
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        return
    except asyncio.CancelledError:
        return
    except Exception:
        return
    finally:
        try:
            await ws.close()
        except Exception:
            pass


def _build_llm_from_settings() -> Any:
    """
    Uses file-backed settings to build the LLM provider.
    If your build_llm() does not accept settings yet, it falls back to env-based build.
    """
    s = _load_settings()
    try:
        return build_llm(settings=s)
    except TypeError:
        return build_llm()


def _json_ws_send(ws: WebSocket, payload: Dict[str, Any]) -> asyncio.Future:
    # We send JSON as text so the existing wsAI client still works,
    # and the frontend can JSON.parse() when it wants.
    return ws.send_text(json.dumps(payload, ensure_ascii=False))


def _try_parse_json(s: str) -> Optional[Dict[str, Any]]:
    """Helper to safely parse JSON from LLM response."""
    try:
        obj = json.loads(s)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


@app.websocket("/ws/ai")
async def ws_ai(ws: WebSocket) -> None:
    """
    AI Chat websocket with Plan → Approve → Execute protocol.
    
    When user asks to DO something, AI returns a structured plan.
    Frontend shows approval UI, then calls /api/plan/execute.
    That's when commands actually type into the LEFT terminal (PTY).
    """
    await ws.accept()

    prompts = build_prompts(product_name="CloudDeploy", provider_name="IBM Cloud")

    # Track settings version so changes can take effect without server restart.
    llm = None
    llm_ok = False
    llm_err = ""
    last_version = -1

    async def ensure_llm_loaded() -> None:
        nonlocal llm, llm_ok, llm_err, last_version
        s = _load_settings()
        ver = int(s.get("version") or 0)
        if llm is not None and ver == last_version and llm_ok:
            return
        try:
            llm = _build_llm_from_settings()
            llm_ok = True
            llm_err = ""
            last_version = ver
        except Exception as e:
            llm = None
            llm_ok = False
            llm_err = str(e)
            last_version = ver

    # System instruction for the "Plan → Approve → Execute" protocol
    plan_protocol = """
You are CloudDeploy Copilot.

When the user asks you to DO something in the terminal (examples: "list files", "create a folder", "check deployment", "build the app"),
DO NOT execute anything yourself. Instead, return a JSON object with this EXACT format:

{
  "type": "plan",
  "title": "<short descriptive title>",
  "steps": [
    {"cmd": "<single shell command>", "why": "<brief reason>", "risk": "low|medium|high"}
  ],
  "notes": "<optional additional context>",
  "needs_approval": true
}

CRITICAL RULES FOR PLANS:
1. Each "cmd" must be a SINGLE command (no pipes |, no redirects > <, no chaining with ; or &&)
2. Keep total steps <= 8
3. Use appropriate risk levels:
   - "low": read-only commands (ls, cat, grep, docker ps, kubectl get)
   - "medium": write operations (mkdir, touch, cp, mv, npm install, docker build)
   - "high": destructive operations (rm, git push, kubectl delete, deployment commands)
4. Be specific in "why" field (helps user understand what each step does)

EXAMPLES OF GOOD PLANS:

User: "List all files in the current directory"
AI Response:
{
  "type": "plan",
  "title": "List directory contents",
  "steps": [
    {"cmd": "ls -la", "why": "Show all files including hidden ones with details", "risk": "low"}
  ],
  "needs_approval": true
}

User: "Create a folder called 'example' and a file inside it"
AI Response:
{
  "type": "plan",
  "title": "Create folder structure",
  "steps": [
    {"cmd": "mkdir example", "why": "Create the 'example' directory", "risk": "medium"},
    {"cmd": "touch example/README.md", "why": "Create README file inside example folder", "risk": "medium"}
  ],
  "needs_approval": true
}

User: "Check if Docker is running"
AI Response:
{
  "type": "plan",
  "title": "Check Docker status",
  "steps": [
    {"cmd": "docker ps", "why": "List running containers to verify Docker daemon", "risk": "low"}
  ],
  "needs_approval": true
}

If the user is ONLY asking a question or wants explanation (no action needed), return:
{
  "type": "message",
  "markdown": "<your answer in markdown format>"
}

IMPORTANT: Always output valid JSON. Never include markdown fences (```json) or preamble text.
"""

    try:
        while True:
            question = await ws.receive_text()
            await ensure_llm_loaded()

            if not llm_ok:
                await _json_ws_send(
                    ws,
                    {
                        "type": "message",
                        "markdown": (
                            "⚠️ AI is not available on this server right now.\n\n"
                            f"**Reason:** {llm_err}\n\n"
                            "**Tip:** Open Settings (⚙️ top right) and verify provider credentials.\n\n"
                            "The terminal still works normally - you can type commands directly."
                        ),
                    },
                )
                continue

            st_run = await _session_status()
            if not st_run.get("running"):
                await _json_ws_send(
                    ws,
                    {
                        "type": "message",
                        "markdown": (
                            "No session is running yet.\n\n"
                            "Click **Choose a script to launch** above to start, then ask me again!"
                        ),
                    },
                )
                continue

            recent = tools.call("cli.read", {"tail_chars": 6000, "redact": True}).get("text", "") or ""
            st = tools.call("state.get", {"tail_chars": 12000, "redact": True}).get("state", {}) or {}

            # ---- Evidence gate: avoid hallucinating steps when we have no output ----
            has_terminal = bool(recent.strip())
            waiting_for_input = bool(st.get("waiting_for_input"))
            user_q = (question or "").strip().lower()

            # Friendly greeting when terminal is empty
            if not has_terminal and not waiting_for_input and user_q in {"hi", "hello", "hey", "help"}:
                await _json_ws_send(
                    ws,
                    {
                        "type": "message",
                        "markdown": (
                            "👋 Hi! I'm your CloudDeploy copilot.\n\n"
                            "I can help you:\n"
                            "- 📁 List files and directories\n"
                            "- 📝 Create folders and files\n"
                            "- 🐳 Check Docker/Kubernetes status\n"
                            "- 🚀 Run deployment commands\n"
                            "- 🔍 Inspect logs and configurations\n\n"
                            "Start a script from **Choose a script to launch**, and I'll read the terminal output to guide you!\n\n"
                            "Or just ask me to do something (e.g., 'list all files', 'create a folder called test')."
                        ),
                    },
                )
                continue

            # No terminal output yet - guide user
            if not has_terminal and not waiting_for_input:
                await _json_ws_send(
                    ws,
                    {
                        "type": "message",
                        "markdown": (
                            "I don't see any terminal output yet.\n\n"
                            "**Two ways to proceed:**\n"
                            "1. Start a script (click **Choose a script to launch**), or\n"
                            "2. Tell me what you want to do (e.g., 'list all files', 'create a test folder')\n\n"
                            "I'll create a plan for you to approve!"
                        ),
                    },
                )
                continue

            # Workflow is waiting for input - show wizard state
            if waiting_for_input:
                await _json_ws_send(
                    ws,
                    {
                        "type": "message",
                        "markdown": (
                            "🔔 **The workflow is waiting for input**\n\n"
                            f"**Prompt:** {str(st.get('prompt') or '').strip() or '(not provided)'}\n\n"
                            f"**Available choices:** {st.get('choices') or []}\n\n"
                            "Tell me what you want to choose, or use the quick action buttons below the terminal."
                        ),
                    },
                )
                continue

            state_json = json.dumps(st, indent=2, ensure_ascii=False)
            user_prompt = render_status_prompt(
                state_snapshot_json=state_json,
                terminal_tail=recent,
                product_name="CloudDeploy",
                provider_name="IBM Cloud",
            )

            guardrail = (
                "CRITICAL EVIDENCE-BASED REASONING:\n"
                "- Only claim something is happening if it is EXPLICITLY in TERMINAL_TAIL or STATE.\n"
                "- If evidence is missing, say what you CANNOT see and ask for clarification.\n"
                "- Prefer SHORT, ACTIONABLE next steps.\n"
                "- When creating plans, be SPECIFIC about what each command does.\n"
            )

            full_prompt = (
                f"{prompts.system}\n\n"
                f"{guardrail}\n\n"
                f"{plan_protocol}\n\n"
                f"{prompts.analyze_status}\n\n"
                f"{user_prompt}\n\n"
                f"USER_QUESTION:\n{question}\n\n"
                f"Remember: Output ONLY valid JSON. If creating a plan, use the exact format shown in examples."
            )

            try:
                raw = llm.call(full_prompt)  # type: ignore[attr-defined]
            except Exception:
                raw = llm.invoke(full_prompt)  # type: ignore[attr-defined]

            raw_s = str(raw).strip()
            
            # Try to parse as JSON
            obj = _try_parse_json(raw_s)

            # If the model complied with protocol and returned a plan
            if obj and obj.get("type") == "plan":
                steps = obj.get("steps") or []
                if isinstance(steps, list) and 0 < len(steps) <= 8:
                    # Sanitize steps: ensure cmd strings
                    clean_steps: List[Dict[str, Any]] = []
                    for step in steps:
                        if not isinstance(step, dict):
                            continue
                        cmd = str(step.get("cmd") or "").strip()
                        why = str(step.get("why") or "No reason provided").strip()
                        risk = str(step.get("risk") or "low").strip().lower()
                        if risk not in {"low", "medium", "high"}:
                            risk = "low"
                        clean_steps.append({"cmd": cmd, "why": why, "risk": risk})

                    # Validate commands and mark invalid ones as "high risk"
                    invalids: List[str] = []
                    for s2 in clean_steps:
                        ok, err = _validate_cmd(s2["cmd"])
                        if not ok:
                            invalids.append(f"`{s2['cmd']}` - {err}")
                            s2["risk"] = "high"

                    # Add warning if some commands are blocked
                    if invalids:
                        obj["notes"] = (
                            (str(obj.get("notes") or "").strip() + "\n\n").lstrip()
                            + "⚠️ **Some proposed commands are blocked by security policy:**\n\n"
                            + "\n".join(f"- {inv}" for inv in invalids)
                            + "\n\nThese will be rejected if you approve the plan."
                        )

                    obj["steps"] = clean_steps
                    obj["needs_approval"] = True  # Always require approval
                    await _json_ws_send(ws, obj)
                    continue

            # Otherwise: treat as normal markdown message
            await _json_ws_send(ws, {"type": "message", "markdown": raw_s})

    except WebSocketDisconnect:
        return
    except asyncio.CancelledError:
        return
    except Exception:
        return
    finally:
        try:
            await ws.close()
        except Exception:
            pass


@app.websocket("/ws/autopilot")
async def ws_autopilot(ws: WebSocket) -> None:
    await ws.accept()
    autopilot_clients.add(ws)

    await ws.send_json({"type": "autopilot_status", "enabled": autopilot_enabled})

    try:
        while True:
            msg = await ws.receive_json()
            action = (msg.get("action") or "").lower()

            if action == "start":
                await start_autopilot()
            elif action == "stop":
                await stop_autopilot()
            else:
                await ws.send_json({"type": "error", "message": f"Unknown action: {action}"})
    except WebSocketDisconnect:
        return
    except asyncio.CancelledError:
        return
    except Exception:
        return
    finally:
        autopilot_clients.discard(ws)
        try:
            await ws.close()
        except Exception:
            pass


async def start_autopilot() -> None:
    global autopilot_task, autopilot_enabled

    async with _autopilot_lock:
        st = await _session_status()
        if not st.get("running"):
            autopilot_enabled = False
            try:
                await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
                await broadcast_autopilot({"type": "autopilot_event", "event": "waiting_for_session"})
            except Exception:
                pass
            return

        autopilot_enabled = True
        try:
            await broadcast_autopilot({"type": "autopilot_status", "enabled": True})
        except Exception:
            pass

        if autopilot_task and not autopilot_task.done():
            return

        autopilot_task = asyncio.create_task(autopilot_loop())


async def stop_autopilot() -> None:
    global autopilot_task, autopilot_enabled

    async with _autopilot_lock:
        autopilot_enabled = False
        try:
            await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
        except Exception:
            pass

        await _safe_cancel(autopilot_task)
        autopilot_task = None


async def autopilot_loop() -> None:
    """
    Autopilot drives wizard prompts (policy-guarded cli.send).
    IMPORTANT: it must not interleave with approved plan execution.
    """
    global autopilot_enabled

    try:
        await broadcast_autopilot({"type": "autopilot_event", "event": "started"})
    except Exception:
        pass

    try:
        while True:
            st_run = await _session_status()
            if not autopilot_enabled:
                break

            if not st_run.get("running"):
                try:
                    await broadcast_autopilot({"type": "autopilot_event", "event": "waiting_for_session"})
                except Exception:
                    pass
                await asyncio.sleep(0.5)
                continue

            # Do not send autopilot input while a plan is executing
            if _exec_active:
                await asyncio.sleep(0.25)
                continue

            wait_res = tools.call("cli.wait_for_prompt", {"timeout_s": 30, "poll_s": 0.5})
            state = wait_res.get("state", {}) or {}
            try:
                await broadcast_autopilot({"type": "autopilot_state", "state": state})
            except Exception:
                pass

            if state.get("completed"):
                try:
                    await broadcast_autopilot({"type": "autopilot_event", "event": "completed"})
                    await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
                except Exception:
                    pass
                autopilot_enabled = False
                return

            if state.get("last_error"):
                try:
                    await broadcast_autopilot(
                        {"type": "autopilot_event", "event": "error_detected", "error": state["last_error"]}
                    )
                    await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
                except Exception:
                    pass
                autopilot_enabled = False
                return

            tail = tools.call("cli.read", {"tail_chars": 4000, "redact": True}).get("text", "")
            send = decide_input(state, tail)

            if send is None:
                # Best practice: stay enabled but idle instead of "pausing" off
                try:
                    await broadcast_autopilot({"type": "autopilot_event", "event": "idle_no_actionable_prompt"})
                except Exception:
                    pass
                await asyncio.sleep(0.5)
                continue

            tools.call("cli.send", {"input": send, "append_newline": True})
            try:
                await broadcast_autopilot({"type": "autopilot_event", "event": "sent_input", "input": redact_text(send)})
            except Exception:
                pass

            await asyncio.sleep(0.25)

    except asyncio.CancelledError:
        try:
            await broadcast_autopilot({"type": "autopilot_event", "event": "stopped"})
        except Exception:
            pass
        return
    except Exception as e:
        try:
            await broadcast_autopilot({"type": "autopilot_event", "event": "crashed", "error": str(e)})
            await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
        except Exception:
            pass
        autopilot_enabled = False
        return