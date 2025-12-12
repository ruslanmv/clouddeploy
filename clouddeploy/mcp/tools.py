from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from clouddeploy.mcp.policy import assert_allowed_cli_send, describe_policy
from clouddeploy.pty_runner import PtyRunner
from clouddeploy.redact import redact_text
from clouddeploy.step_detector import StepDetector


@dataclass
class ToolRegistry:
    """
    Central tool layer shared by:
      - MCP server (external agent control)
      - Web Autopilot (internal)

    The registry manages a single PTY session per process.
    """

    command: str
    strict_policy: Optional[bool] = None

    def __post_init__(self) -> None:
        self._runner: Optional[PtyRunner] = None
        self._detector: Optional[StepDetector] = None
        self._started_at: float = 0.0

    # ---------------------------------------------------------------------
    # Lifecycle
    # ---------------------------------------------------------------------

    def list_tools(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": "session.start",
                "description": "Start (or ensure) the PTY session running the command.",
                "args_schema": {"type": "object", "properties": {}, "additionalProperties": False},
            },
            {
                "name": "session.status",
                "description": "Get session status (running, pid, started_at).",
                "args_schema": {"type": "object", "properties": {}, "additionalProperties": False},
            },
            {
                "name": "cli.read",
                "description": "Read terminal output tail (optionally redacted).",
                "args_schema": {
                    "type": "object",
                    "properties": {
                        "tail_chars": {"type": "integer", "default": 4000},
                        "redact": {"type": "boolean", "default": True},
                    },
                    "additionalProperties": False,
                },
            },
            {
                "name": "cli.send",
                "description": "Send wizard-style input to the PTY (policy-guarded).",
                "args_schema": {
                    "type": "object",
                    "properties": {
                        "input": {"type": "string"},
                        "append_newline": {"type": "boolean", "default": True},
                    },
                    "required": ["input"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "cli.wait_for_prompt",
                "description": "Wait until StepDetector reports waiting_for_input or timeout.",
                "args_schema": {
                    "type": "object",
                    "properties": {
                        "timeout_s": {"type": "number", "default": 30.0},
                        "poll_s": {"type": "number", "default": 0.5},
                    },
                    "additionalProperties": False,
                },
            },
            {
                "name": "state.get",
                "description": "Get the latest parsed state snapshot from StepDetector.",
                "args_schema": {
                    "type": "object",
                    "properties": {
                        "tail_chars": {"type": "integer", "default": 6000},
                        "redact": {"type": "boolean", "default": True},
                    },
                    "additionalProperties": False,
                },
            },
            {
                "name": "policy.describe",
                "description": "Return the current policy configuration.",
                "args_schema": {"type": "object", "properties": {}, "additionalProperties": False},
            },
        ]

    def ensure_started(self) -> None:
        if self._runner is not None:
            return
        self._runner = PtyRunner(self.command)
        self._runner.start()
        self._detector = StepDetector()
        self._started_at = time.time()

    # ---------------------------------------------------------------------
    # Tool dispatch
    # ---------------------------------------------------------------------

    def call(self, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """
        Synchronous tool dispatcher. (Works well for stdio MCP.)
        Web server can call these in threads if needed.
        """
        if tool_name == "session.start":
            self.ensure_started()
            return {"ok": True}

        if tool_name == "session.status":
            running = self._runner is not None and self._runner.is_running
            return {
                "running": running,
                "pid": self._runner.pid if self._runner else None,
                "started_at": self._started_at if self._started_at else None,
                "command": self.command,
            }

        if tool_name == "cli.read":
            self.ensure_started()
            tail_chars = int(args.get("tail_chars", 4000))
            do_redact = bool(args.get("redact", True))
            assert self._runner is not None
            out = self._runner.tail(max_chars=tail_chars)
            if do_redact:
                out = redact_text(out)
            return {"text": out}

        if tool_name == "cli.send":
            self.ensure_started()
            user_input = str(args.get("input", ""))
            append_newline = bool(args.get("append_newline", True))

            # Guardrails: deny dangerous patterns; strict mode can restrict further.
            normalized = assert_allowed_cli_send(user_input, strict=self.strict_policy)

            to_send = normalized + ("\n" if append_newline else "")
            assert self._runner is not None
            self._runner.write(to_send)
            return {"sent": True, "normalized": normalized}

        if tool_name == "cli.wait_for_prompt":
            self.ensure_started()
            timeout_s = float(args.get("timeout_s", 30.0))
            poll_s = float(args.get("poll_s", 0.5))
            assert self._runner is not None
            assert self._detector is not None

            deadline = time.time() + timeout_s
            while time.time() < deadline:
                snap = self._snapshot(tail_chars=6000, redact=True)
                if snap.get("waiting_for_input"):
                    return {"waiting_for_input": True, "state": snap}
                if snap.get("completed"):
                    return {"waiting_for_input": False, "completed": True, "state": snap}
                time.sleep(poll_s)

            return {"waiting_for_input": False, "timeout": True, "state": self._snapshot(6000, True)}

        if tool_name == "state.get":
            self.ensure_started()
            tail_chars = int(args.get("tail_chars", 6000))
            do_redact = bool(args.get("redact", True))
            snap = self._snapshot(tail_chars=tail_chars, redact=do_redact)
            return {"state": snap}

        if tool_name == "policy.describe":
            return describe_policy(strict=self.strict_policy)

        raise ValueError(f"Unknown tool: {tool_name}")

    # ---------------------------------------------------------------------
    # Internals
    # ---------------------------------------------------------------------

    def _snapshot(self, tail_chars: int, redact: bool) -> Dict[str, Any]:
        assert self._runner is not None
        assert self._detector is not None

        out = self._runner.tail(max_chars=tail_chars)
        out_for_state = redact_text(out) if redact else out

        # StepDetector API variants:
        # - some implementations use update(text)->dict
        # - others use ingest(text) + snapshot()
        if hasattr(self._detector, "update"):
            snap = self._detector.update(out_for_state)  # type: ignore[attr-defined]
            return snap if isinstance(snap, dict) else {"raw": str(snap)}

        # fallback
        self._detector.ingest(out_for_state)  # type: ignore[attr-defined]
        snap_obj = self._detector.snapshot()  # type: ignore[attr-defined]
        if hasattr(snap_obj, "__dict__"):
            return dict(snap_obj.__dict__)
        return {"snapshot": str(snap_obj)}
