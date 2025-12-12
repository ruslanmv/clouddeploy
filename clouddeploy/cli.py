from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import uvicorn

from .mcp.mcp_server import run_stdio_server


def _default_script_path() -> str:
    # Prefer packaged script if present, otherwise fallback to ./scripts
    here = Path(__file__).resolve().parent
    candidate = (here.parent / "scripts" / "push_to_code_engine.sh").resolve()
    if candidate.exists():
        return str(candidate)
    local = (Path.cwd() / "scripts" / "push_to_code_engine.sh").resolve()
    return str(local)


def main() -> None:
    parser = argparse.ArgumentParser(prog="clouddeploy")
    sub = parser.add_subparsers(dest="cmd", required=True)

    # --- UI ---
    ui = sub.add_parser("ui", help="Start the CloudDeploy web workspace (terminal + AI sidecar)")
    ui.add_argument("--host", default="127.0.0.1", help="Bind host")
    ui.add_argument("--port", type=int, default=8787, help="Bind port")
    ui.add_argument(
        "--cmd",
        default=_default_script_path(),
        help="Command to run inside the terminal session (default: scripts/push_to_code_engine.sh)",
    )
    ui.add_argument("--title", default="CloudDeploy Enterprise Workspace", help="UI title")

    # --- MCP ---
    mcp = sub.add_parser("mcp", help="Run CloudDeploy as an MCP server over stdio")
    mcp.add_argument(
        "--cmd",
        required=True,
        help="Command to run inside the PTY session (e.g., ./scripts/push_to_code_engine.sh)",
    )

    # --- Optional: settings/models ---
    settings = sub.add_parser("settings", help="Print current LLM settings")
    models = sub.add_parser("models", help="List models for the active LLM provider")

    args = parser.parse_args()

    if args.cmd == "ui":
        # These env vars are consumed by server.py
        os.environ["CLOUDDEPLOY_RUN_CMD"] = args.cmd
        os.environ["CLOUDDEPLOY_UI_TITLE"] = args.title

        uvicorn.run(
            "clouddeploy.server:app",
            host=args.host,
            port=args.port,
            reload=False,
            log_level="info",
        )
        return

    if args.cmd == "mcp":
        # MCP runs over stdin/stdout
        run_stdio_server(command=args.cmd)
        return

    if args.cmd == "settings":
        from .llm.settings import get_settings

        s = get_settings()
        print(s.model_dump_json(indent=2))
        return

    if args.cmd == "models":
        from .llm.model_catalog import list_models_for_provider
        from .llm.settings import get_settings

        s = get_settings()
        models_list, err = list_models_for_provider(s.provider, s)
        if err:
            print(f"ERROR: {err}", file=sys.stderr)
            sys.exit(1)
        for m in models_list:
            print(m)
        return
