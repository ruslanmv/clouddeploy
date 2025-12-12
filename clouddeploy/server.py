from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Optional, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from .ibm.automation import decide_input
from .llm.llm_provider import build_llm
from .llm.prompts import build_system_prompt
from .mcp.tools import ToolRegistry
from .redact import redact_text

APP_ROOT = Path(__file__).parent
WEB_DIR = APP_ROOT / "web"

app = FastAPI(title="CloudDeploy")
app.mount("/assets", StaticFiles(directory=str(WEB_DIR), html=False), name="assets")

# v1: single session shared across browser tabs
tools = ToolRegistry()

autopilot_task: Optional[asyncio.Task] = None
autopilot_enabled: bool = False
autopilot_clients: Set[WebSocket] = set()


@app.get("/")
def index() -> HTMLResponse:
    html = (WEB_DIR / "index.html").read_text("utf-8")
    title = os.getenv("CLOUDDEPLOY_UI_TITLE", "CloudDeploy Enterprise Workspace")
    html = html.replace("CloudDeploy Enterprise Workspace", title)
    return HTMLResponse(html)


def ensure_session() -> None:
    if tools.session is None:
        run_cmd = os.getenv("CLOUDDEPLOY_RUN_CMD", "bash")
        tools.call("session.start", {"cmd": run_cmd})


async def broadcast_autopilot(event: dict) -> None:
    dead: Set[WebSocket] = set()
    for ws in list(autopilot_clients):
        try:
            await ws.send_json(event)
        except Exception:
            dead.add(ws)
    autopilot_clients.difference_update(dead)


@app.websocket("/ws/terminal")
async def ws_terminal(ws: WebSocket) -> None:
    await ws.accept()
    ensure_session()

    try:
        async for chunk in tools.session.stream_output():  # type: ignore[union-attr]
            tools.detector.ingest(chunk)
            await ws.send_text(chunk)
    except WebSocketDisconnect:
        return
    finally:
        try:
            await ws.close()
        except Exception:
            pass


@app.websocket("/ws/terminal_input")
async def ws_terminal_input(ws: WebSocket) -> None:
    await ws.accept()
    ensure_session()

    try:
        while True:
            data = await ws.receive_text()
            tools.session.write(data)  # type: ignore[union-attr]
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
    ensure_session()

    try:
        while True:
            st = tools.call("state.get", {})
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
    ensure_session()

    llm = build_llm()
    system_prompt = build_system_prompt()

    try:
        while True:
            question = await ws.receive_text()

            # AI sees only sanitized context
            recent = tools.call("cli.read", {"tail_chars": 4000, "redact": True})["text"]
            st = tools.call("state.get", {})

            prompt = (
                f"{system_prompt}\n\n"
                f"=== CURRENT STATE (JSON) ===\n{st}\n\n"
                f"=== TERMINAL OUTPUT (SANITIZED) ===\n{recent}\n\n"
                f"User question: {question}\n"
            )

            try:
                answer = llm.call(prompt)  # type: ignore[attr-defined]
            except Exception:
                answer = llm.invoke(prompt)  # type: ignore[attr-defined]

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
    """
    UI control channel:
    - client sends {"action":"start"} or {"action":"stop"}
    - server broadcasts events and status updates
    """
    await ws.accept()
    ensure_session()
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
    """
    Autopilot drives the CLI using the same ToolRegistry tools used by MCP mode.
    v1 is heuristic-first and stops on errors.
    """
    global autopilot_enabled

    await broadcast_autopilot({"type": "autopilot_event", "event": "started"})

    try:
        while autopilot_enabled:
            st = tools.call("cli.wait_for_prompt", {"timeout_s": 30})
            await broadcast_autopilot({"type": "autopilot_state", "state": st})

            if st.get("completed"):
                await broadcast_autopilot({"type": "autopilot_event", "event": "completed"})
                autopilot_enabled = False
                await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
                return

            if st.get("last_error"):
                await broadcast_autopilot(
                    {"type": "autopilot_event", "event": "error_detected", "error": st["last_error"]}
                )
                autopilot_enabled = False
                await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
                return

            tail = tools.call("cli.read", {"tail_chars": 4000, "redact": True})["text"]
            send = decide_input(st, tail)

            if send is None:
                await broadcast_autopilot(
                    {
                        "type": "autopilot_event",
                        "event": "paused",
                        "reason": "No safe action determined (or error present).",
                    }
                )
                autopilot_enabled = False
                await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
                return

            tools.call("cli.send", {"text": send})
            await broadcast_autopilot(
                {"type": "autopilot_event", "event": "sent_input", "input": redact_text(send)}
            )
            await asyncio.sleep(0.25)

    except asyncio.CancelledError:
        await broadcast_autopilot({"type": "autopilot_event", "event": "stopped"})
        raise
    except Exception as e:
        await broadcast_autopilot({"type": "autopilot_event", "event": "crashed", "error": str(e)})
        autopilot_enabled = False
        await broadcast_autopilot({"type": "autopilot_status", "enabled": False})
