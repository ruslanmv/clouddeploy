from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Optional, Tuple


# ---------------------------------------------------------------------------
# Policy goals
# - Prevent obviously destructive shell payloads from being sent into a PTY.
# - In "strict" mode, only allow wizard-style inputs (ENTER, y/n, small ints).
# - Provide clear human-readable reasons for denial.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    reason: str
    normalized_input: str = ""


# High-signal dangerous patterns. These are conservative on purpose.
_DANGEROUS_PATTERNS = [
    # destructive deletes / wipes
    r"\brm\s+-rf\b",
    r"\brm\s+-fr\b",
    r"\brm\s+-r\b.*\s+/\b",
    r"\bmkfs\.",
    r"\bdd\s+if=",
    r"\b:>\s*/",
    r"\bchmod\s+-R\s+777\s+/\b",
    r"\bchown\s+-R\b.*\s+/\b",
    # privilege / shutdown / reboot
    r"\bsudo\b",
    r"\bsu\b",
    r"\bshutdown\b",
    r"\breboot\b",
    r"\bpoweroff\b",
    r"\bsystemctl\s+(stop|disable)\b",
    # piping remote scripts
    r"curl\b.*\|\s*(sh|bash)\b",
    r"wget\b.*\|\s*(sh|bash)\b",
    # fork bombs / weirdness
    r":\(\)\s*\{\s*:\s*\|\s*:\s*;\s*\}\s*;\s*:",
]


# Inputs that are "safe wizard answers" in strict mode:
# - empty (ENTER)
# - y / n / yes / no (case-insensitive)
# - a small integer option like "1" or "12"
_STRICT_ALLOWED = re.compile(r"^(?:\s*|[yYnN]\s*|yes\s*|no\s*|\d{1,3}\s*)$")

# In non-strict mode, we still disallow raw newlines in the middle and control chars.
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0B-\x1F\x7F]")

# If true, strict mode is default unless explicitly disabled.
_DEFAULT_STRICT = os.getenv("CLOUDDEPLOY_STRICT_POLICY", "1").strip() not in {"0", "false", "False"}


def is_strict_mode(enabled: Optional[bool] = None) -> bool:
    if enabled is None:
        return _DEFAULT_STRICT
    return bool(enabled)


def _normalize_user_input(user_input: str) -> str:
    # Keep it simple: strip only trailing \r (Windows) and keep other whitespace
    # so ENTER can be represented as "".
    if user_input is None:
        return ""
    return user_input.replace("\r", "")


def evaluate_cli_send(
    user_input: str,
    *,
    strict: Optional[bool] = None,
) -> PolicyDecision:
    """
    Decide whether an input is allowed to be sent to the PTY.

    strict mode:
      - only allows: ENTER, y/n, yes/no, small integers
      - still blocks dangerous patterns (defense-in-depth)

    non-strict mode:
      - allows broader text input but still blocks dangerous patterns and control chars
    """
    s = _normalize_user_input(user_input)
    strict_mode = is_strict_mode(strict)

    # Block control characters (except \n which we don't expect inside the string anyway)
    if _CONTROL_CHARS.search(s):
        return PolicyDecision(False, "Denied: input contains control characters.")

    # Block dangerous payloads (case-insensitive)
    lowered = s.lower()
    for pat in _DANGEROUS_PATTERNS:
        if re.search(pat, lowered, flags=re.IGNORECASE):
            return PolicyDecision(False, f"Denied: input matches a dangerous pattern: {pat}")

    # Strict mode: only wizard-style answers
    if strict_mode and not _STRICT_ALLOWED.match(s.strip()):
        return PolicyDecision(
            False,
            "Denied (strict mode): only ENTER, y/n, yes/no, or a small integer option is allowed.",
        )

    return PolicyDecision(True, "Allowed.", normalized_input=s)


def assert_allowed_cli_send(
    user_input: str,
    *,
    strict: Optional[bool] = None,
) -> str:
    """
    Convenience helper for tool implementations.

    Returns the normalized input if allowed, otherwise raises ValueError.
    """
    decision = evaluate_cli_send(user_input, strict=strict)
    if not decision.allowed:
        raise ValueError(decision.reason)
    return decision.normalized_input


def describe_policy(*, strict: Optional[bool] = None) -> dict:
    """
    Human/machine-readable policy description that can be surfaced in UI/MCP hello.
    """
    strict_mode = is_strict_mode(strict)
    return {
        "strict_mode": strict_mode,
        "strict_allows": ["ENTER", "y/n", "yes/no", "integer options (1-3 digits)"] if strict_mode else None,
        "blocks": [
            "destructive shell patterns (rm -rf, mkfs, dd, shutdown, sudo, curl|bash, etc.)",
            "control characters",
        ],
        "env": {
            "CLOUDDEPLOY_STRICT_POLICY": os.getenv("CLOUDDEPLOY_STRICT_POLICY", "1"),
        },
    }
