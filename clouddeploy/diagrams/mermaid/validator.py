from __future__ import annotations
from dataclasses import dataclass


@dataclass
class MermaidValidationResult:
    ok: bool
    error: str = ""


def validate_architecture_beta(code: str) -> MermaidValidationResult:
    """Basic guardrails for Mermaid architecture diagrams."""
    txt = (code or "").strip()
    if not txt:
        return MermaidValidationResult(False, "Empty Mermaid code")

    first_line = txt.splitlines()[0].strip().lower()
    if not first_line.startswith("architecture-beta"):
        return MermaidValidationResult(False, "Mermaid code must start with 'architecture-beta'")

    if len(txt.splitlines()) > 120:
        return MermaidValidationResult(False, "Mermaid code too long")

    return MermaidValidationResult(True, "")
