from __future__ import annotations

import re
from typing import Pattern

# Key=value secrets
ENV_SECRET_PATTERNS: list[Pattern[str]] = [
    re.compile(r"\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|WATSONX_API_KEY)\s*=\s*([^\s]+)", re.I),
    re.compile(r"\b(api_key|apikey|token|password)\s*[:=]\s*([^\s]+)", re.I),
]

# Bearer tokens
BEARER_RE = re.compile(r"Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*", re.I)

# Optional: redact .env-style KEY=VALUE but keep KEY (use carefully; can be too aggressive)
DOTENV_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.+)$", re.M)


def redact_text(text: str, redact_dotenv_values: bool = False) -> str:
    out = text

    for pat in ENV_SECRET_PATTERNS:
        out = pat.sub(r"\1=<REDACTED>", out)

    out = BEARER_RE.sub("Bearer <REDACTED>", out)

    if redact_dotenv_values:
        out = DOTENV_RE.sub(r"\1=<REDACTED>", out)

    return out
