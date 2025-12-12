from __future__ import annotations

import json
import sys
from typing import Any

from clouddeploy.mcp.tools import ToolRegistry


def run_stdio_server(command: str) -> None:
    """
    Minimal MCP stdio server loop.

    Reads JSON lines from stdin:
      {"id":"1","tool":"session.start","args":{...}}
    Writes JSON responses to stdout.

    This is intentionally simple and robust.
    """
    registry = ToolRegistry(command=command)

    # Advertise tools (optional but helpful)
    hello = {
        "type": "hello",
        "tools": registry.list_tools(),
    }
    sys.stdout.write(json.dumps(hello) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req.get("id", "")
            tool = req.get("tool", "")
            args = req.get("args", {}) or {}

            result = registry.call(tool, args)

            resp: dict[str, Any] = {"id": req_id, "ok": True, "result": result}
        except Exception as e:
            resp = {"id": req.get("id", ""), "ok": False, "error": str(e)}

        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()
