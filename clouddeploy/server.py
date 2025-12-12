# clouddeploy/server.py
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Optional, Set, List, Dict, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .ibm.automation import decide_input
from .llm.llm_provider import build_llm
from .llm.prompts import build_prompts, render_status_prompt
from .mcp.tools import ToolRegistry
from .redact import redact_text

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
        # Expected during shutdown/cancel — swallow to keep server stable.
        pass
    except Exception:
        # Never let task failure crash WebSocket handler.
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

    # Prefer PtyRunner.is_running when available
    try:
        is_running_attr = getattr(runner, "is_running", None)
        if callable(is_running_attr):
            alive = bool(is_running_attr())
        else:
            # fallback heuristic
            alive = bool(getattr(runner, "pid", None)) and not bool(getattr(runner, "_closed", False))
    except Exception:
        # If runner inspection fails, do not assume alive.
        alive = False

    if alive:
        return

    # Runner is dead -> stop autopilot and clear runner.
    async with _session_lock:
        async with _autopilot_lock:
            autopilot_enabled = False
            try:
                await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
            except Exception:
                pass

            await _safe_cancel(autopilot_task)
            autopilot_task = None

        # Best-effort close
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

    # If ToolRegistry says running but runner is missing, correct it.
    if st.get("running") and _get_runner() is None:
        st["running"] = False

    return st


@app.get("/favicon.ico")
def favicon() -> Response:
    return Response(status_code=204)


@app.get("/")
def index() -> HTMLResponse:
    html = (WEB_DIR / "index.html").read_text("utf-8")
    title = os.getenv("CLOUDDEPLOY_UI_TITLE", "CloudDeploy Enterprise Workspace")
    html = html.replace("CloudDeploy Enterprise Workspace", title)
    return HTMLResponse(html)


# -----------------------------------------------------------------------------
# Script Picker API
# -----------------------------------------------------------------------------

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


# -----------------------------------------------------------------------------
# Session status + stop endpoints
# -----------------------------------------------------------------------------

@app.get("/api/session/status")
async def api_session_status() -> JSONResponse:
    st = await _session_status()
    return JSONResponse(
        {
            "ok": True,
            "running": bool(st.get("running")),
            "command": st.get("command") or "",
        }
    )


@app.post("/api/session/stop")
async def api_session_stop() -> JSONResponse:
    """
    Stops the underlying PTY process (if running) and disables autopilot.
    Called only when user commits to starting a NEW session.
    """
    global autopilot_task, autopilot_enabled

    async with _session_lock:
        # 1) Stop autopilot first (stable + no CancelledError leaking)
        async with _autopilot_lock:
            autopilot_enabled = False
            try:
                await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
            except Exception:
                pass

            await _safe_cancel(autopilot_task)
            autopilot_task = None

        # 2) Prefer ToolRegistry stop if implemented (safe no-op if missing)
        try:
            tools.call("session.stop", {})
        except Exception:
            pass

        # 3) Hard-stop the PTY runner (best-effort)
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

        # 4) Ensure registry doesn't think it's still running
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


# -----------------------------------------------------------------------------
# Autopilot broadcast
# -----------------------------------------------------------------------------

async def broadcast_autopilot(event: dict) -> None:
    dead: Set[WebSocket] = set()
    for ws in list(autopilot_clients):
        try:
            await ws.send_json(event)
        except Exception:
            dead.add(ws)
    autopilot_clients.difference_update(dead)


# -----------------------------------------------------------------------------
# WebSockets
# -----------------------------------------------------------------------------

@app.websocket("/ws/terminal")
async def ws_terminal(ws: WebSocket) -> None:
    """
    Terminal output stream. If session not started yet, keep the socket alive.
    """
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
    Human typing channel: ONLY works after session has started.
    Also: bypass strict policy and write directly to PTY runner.
    """
    await ws.accept()

    try:
        while True:
            data = await ws.receive_text()

            st = await _session_status()
            if not st.get("running"):
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
                    }
                )
                await asyncio.sleep(0.5)
                continue

            st = tools.call("state.get", {"tail_chars": 12000, "redact": True}).get("state", {}) or {}
            st["autopilot_enabled"] = autopilot_enabled
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


@app.websocket("/ws/ai")
async def ws_ai(ws: WebSocket) -> None:
    await ws.accept()

    try:
        llm = build_llm()
        prompts = build_prompts(product_name="CloudDeploy", provider_name="IBM Cloud")
        llm_ok = True
        llm_err = ""
    except Exception as e:
        llm_ok = False
        llm_err = str(e)
        llm = None
        prompts = None

    try:
        while True:
            question = await ws.receive_text()

            if not llm_ok:
                await ws.send_text(
                    "AI is not available on this server right now.\n"
                    f"Reason: {llm_err}\n"
                    "Terminal still works normally."
                )
                continue

            st_run = await _session_status()
            if not st_run.get("running"):
                await ws.send_text("No session is running yet. Pick a script to start, then ask me again.")
                continue

            recent = tools.call("cli.read", {"tail_chars": 4000, "redact": True}).get("text", "")
            st = tools.call("state.get", {"tail_chars": 6000, "redact": True}).get("state", {}) or {}

            state_json = json.dumps(st, indent=2, ensure_ascii=False)
            user_prompt = render_status_prompt(
                state_snapshot_json=state_json,
                terminal_tail=recent,
                product_name="CloudDeploy",
                provider_name="IBM Cloud",
            )

            full_prompt = (
                f"{prompts.system}\n\n"
                f"{prompts.analyze_status}\n\n"
                f"{user_prompt}\n\n"
                f"USER_QUESTION:\n{question}\n"
            )

            try:
                answer = llm.call(full_prompt)  # type: ignore[attr-defined]
            except Exception:
                answer = llm.invoke(full_prompt)  # type: ignore[attr-defined]

            await ws.send_text(str(answer))
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
        # Require a running session; otherwise autopilot does nothing.
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

        # If already running, do nothing
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
    Autopilot drives the CLI using policy-guarded cli.send.
    Must never leak CancelledError into ASGI logs.
    """
    global autopilot_enabled

    try:
        await broadcast_autopilot({"type": "autopilot_event", "event": "started"})
    except Exception:
        pass

    try:
        while True:
            # self-heal session state in case PTY died
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
                try:
                    await broadcast_autopilot(
                        {"type": "autopilot_event", "event": "paused", "reason": "No safe action determined."}
                    )
                    await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
                except Exception:
                    pass
                autopilot_enabled = False
                return

            tools.call("cli.send", {"input": send, "append_newline": True})
            try:
                await broadcast_autopilot(
                    {"type": "autopilot_event", "event": "sent_input", "input": redact_text(send)}
                )
            except Exception:
                pass

            await asyncio.sleep(0.25)

    except asyncio.CancelledError:
        # Key fix: do NOT re-raise; prevents "Exception in ASGI application" logs.
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
