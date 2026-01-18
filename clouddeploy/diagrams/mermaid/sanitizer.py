from __future__ import annotations
import re

_FENCE_RE = re.compile(r"```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```", re.MULTILINE)


def strip_fences(code: str) -> str:
    """Remove triple-backtick fences if a model accidentally includes them."""
    if not code:
        return ""
    m = _FENCE_RE.search(code)
    if m:
        return m.group(1).strip()
    return str(code).strip()


def basic_sanitize(code: str) -> str:
    """Conservative sanitizer for Mermaid input."""
    code = strip_fences(code)
    # defense-in-depth: drop raw HTML tags
    code = re.sub(r"<[^>]+>", "", code)
    return code.strip() + "\n"
