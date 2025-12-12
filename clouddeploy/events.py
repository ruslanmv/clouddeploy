from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Literal, Optional


# These dataclasses are optional but help keep message payloads consistent
# between UI websockets and MCP tool outputs.

EventType = Literal["terminal_chunk", "state_snapshot", "autopilot_event", "error_event"]


@dataclass
class TerminalChunkEvent:
    type: Literal["terminal_chunk"] = "terminal_chunk"
    chunk: str = ""


@dataclass
class StateSnapshotEvent:
    type: Literal["state_snapshot"] = "state_snapshot"
    state: Dict[str, Any] = None  # type: ignore[assignment]


@dataclass
class AutopilotEvent:
    type: Literal["autopilot_event"] = "autopilot_event"
    event: str = ""
    detail: Optional[Dict[str, Any]] = None


@dataclass
class ErrorEvent:
    type: Literal["error_event"] = "error_event"
    message: str = ""
    detail: Optional[Dict[str, Any]] = None


def asdict(event: Any) -> Dict[str, Any]:
    """
    Convert known event dataclasses to dict.
    Keeps a consistent structure for JSON payloads.
    """
    if hasattr(event, "__dict__"):
        return dict(event.__dict__)
    if isinstance(event, dict):
        return event
    return {"type": "error_event", "message": "Unknown event type", "detail": {"repr": repr(event)}}
