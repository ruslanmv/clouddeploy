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


def _strict_policy() -> Optional[bool]:
    v = os.getenv("CLOUDDEPLOY_STRICT_POLICY", "").strip().lower()
    if v in {"1", "true", "yes", "on"}:
        return True
    if v in {"0", "false", "no", "off"}:
        return False
    return None


def _default_cmd() -> str:
    # Only used if someone starts session without selecting (shouldn't happen in UI).
    return os.getenv("CLOUDDEPLOY_RUN_CMD") or os.getenv("CLOUDDEPLOY_DEFAULT_CMD") or "bash"


# IMPORTANT: do NOT start session automatically. Only /api/session/start starts it.
tools = ToolRegistry(command=_default_cmd(), strict_policy=_strict_policy())


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


@app.post("/api/session/start")
async def api_session_start(payload: Dict[str, Any]) -> JSONResponse:
    """
    Start session with a chosen command, but only if the PTY hasn't started yet.
    """
    cmd = str(payload.get("cmd") or "").strip()
    if not cmd:
        return JSONResponse({"ok": False, "error": "Missing cmd"}, status_code=400)

    st = tools.call("session.status", {})
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
            st = tools.call("session.status", {})
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

            st = tools.call("session.status", {})
            if not st.get("running"):
                # Do NOT start session here. UI must call /api/session/start first.
                continue

            try:
                runner = getattr(tools, "_runner", None)
                if runner is None:
                    # session.status said running, but runner missing -> ignore
                    continue
                runner.write(data)
            except Exception as e:
                try:
                    await ws.send_text(f"\r\n[clouddeploy] input error: {e}\r\n")
                except Exception:
                    pass
    except WebSocketDisconnect:
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
            st_run = tools.call("session.status", {})
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
    finally:
        try:
            await ws.close()
        except Exception:
            pass


@app.websocket("/ws/ai")
async def ws_ai(ws: WebSocket) -> None:
    await ws.accept()

    # If LLM provider init fails, we keep the websocket alive and respond with a message
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

            st_run = tools.call("session.status", {})
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
    finally:
        autopilot_clients.discard(ws)
        try:
            await ws.close()
        except Exception:
            pass


async def start_autopilot() -> None:
    global autopilot_task, autopilot_enabled
    autopilot_enabled = True
    await broadcast_autopilot({"type": "autopilot_status", "enabled": True})

    if autopilot_task and not autopilot_task.done():
        return

    autopilot_task = asyncio.create_task(autopilot_loop())


async def stop_autopilot() -> None:
    global autopilot_task, autopilot_enabled
    autopilot_enabled = False
    await broadcast_autopilot({"type": "autopilot_status", "enabled": False})

    if autopilot_task and not autopilot_task.done():
        autopilot_task.cancel()
        try:
            await autopilot_task
        except Exception:
            pass


async def autopilot_loop() -> None:
    global autopilot_enabled

    await broadcast_autopilot({"type": "autopilot_event", "event": "started"})

    try:
        while autopilot_enabled:
            st_run = tools.call("session.status", {})
            if not st_run.get("running"):
                await broadcast_autopilot({"type": "autopilot_event", "event": "waiting_for_session"})
                await asyncio.sleep(0.5)
                continue

            wait_res = tools.call("cli.wait_for_prompt", {"timeout_s": 30, "poll_s": 0.5})
            state = wait_res.get("state", {}) or {}
            await broadcast_autopilot({"type": "autopilot_state", "state": state})

            if state.get("completed"):
                await broadcast_autopilot({"type": "autopilot_event", "event": "completed"})
                autopilot_enabled = False
                await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
                return

            if state.get("last_error"):
                await broadcast_autopilot(
                    {"type": "autopilot_event", "event": "error_detected", "error": state["last_error"]}
                )
                autopilot_enabled = False
                await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
                return

            tail = tools.call("cli.read", {"tail_chars": 4000, "redact": True}).get("text", "")
            send = decide_input(state, tail)

            if send is None:
                await broadcast_autopilot({"type": "autopilot_event", "event": "paused", "reason": "No safe action determined."})
                autopilot_enabled = False
                await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
                return

            tools.call("cli.send", {"input": send, "append_newline": True})
            await broadcast_autopilot({"type": "autopilot_event", "event": "sent_input", "input": redact_text(send)})
            await asyncio.sleep(0.25)

    except asyncio.CancelledError:
        await broadcast_autopilot({"type": "autopilot_event", "event": "stopped"})
        raise
    except Exception as e:
        await broadcast_autopilot({"type": "autopilot_event", "event": "crashed", "error": str(e)})
        autopilot_enabled = False
        await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
