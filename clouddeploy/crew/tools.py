from __future__ import annotations
import os
import subprocess
from typing import Optional, Dict

class ShellTool:
    """Conservative shell tool. Use only in EXECUTE stage and still require approval in your app."""
    name = "shell"
    description = "Run a shell command and return stdout/stderr."

    def run(self, command: str, cwd: Optional[str] = None, env: Optional[Dict[str,str]] = None) -> str:
        e = os.environ.copy()
        if env:
            e.update(env)
        p = subprocess.run(
            command,
            shell=True,
            cwd=cwd,
            env=e,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        return p.stdout
