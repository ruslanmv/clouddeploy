from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import uvicorn


def _default_script_path() -> str:
    """Prefer packaged script if present, otherwise fallback to ./scripts."""
    here = Path(__file__).resolve().parent
    candidate = (here.parent / "scripts" / "push_to_code_engine.sh").resolve()
    if candidate.exists():
        return str(candidate)
    local = (Path.cwd() / "scripts" / "push_to_code_engine.sh").resolve()
    return str(local)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="clouddeploy")
    sub = parser.add_subparsers(dest="subcommand", required=True)

    # --- UI ---
    ui = sub.add_parser("ui", help="Start the CloudDeploy web workspace (terminal + AI sidecar)")
    ui.add_argument("--host", default="127.0.0.1", help="Bind host")
    ui.add_argument("--port", type=int, default=8787, help="Bind port")
    ui.add_argument(
        "--cmd",
        dest="run_cmd",
        default=_default_script_path(),
        help="Command to run inside the terminal session (default: scripts/push_to_code_engine.sh)",
    )
    ui.add_argument("--title", default="CloudDeploy Enterprise Workspace", help="UI title")

    # --- MCP ---
    mcp = sub.add_parser("mcp", help="Run CloudDeploy as an MCP server over stdio")
    mcp.add_argument(
        "--cmd",
        dest="run_cmd",
        required=True,
        help="Command to run inside the PTY session (e.g., ./scripts/push_to_code_engine.sh)",
    )

    # --- Optional: settings/models ---
    sub.add_parser("settings", help="Print current LLM settings")
    sub.add_parser("models", help="List models for the active LLM provider")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.subcommand == "ui":
        # env vars consumed by server.py
        os.environ["CLOUDDEPLOY_RUN_CMD"] = args.run_cmd
        os.environ["CLOUDDEPLOY_UI_TITLE"] = args.title

        uvicorn.run(
            "clouddeploy.server:app",
            host=args.host,
            port=args.port,
            reload=False,
            log_level="info",
        )
        return 0

    if args.subcommand == "mcp":
        # Lazy import so UI mode never breaks due to MCP changes
        from clouddeploy.mcp.mcp_server import run_stdio_server

        run_stdio_server(command=args.run_cmd)
        return 0

    if args.subcommand == "settings":
        from clouddeploy.llm.settings import get_settings

        s = get_settings()
        print(s.model_dump_json(indent=2))
        return 0

    if args.subcommand == "models":
        from clouddeploy.llm.model_catalog import list_models_for_provider
        from clouddeploy.llm.settings import get_settings

        s = get_settings()
        models_list, err = list_models_for_provider(s.provider, s)
        if err:
            print(f"ERROR: {err}", file=sys.stderr)
            return 1
        for m in models_list:
            print(m)
        return 0

    parser.print_help()
    return 2
