from __future__ import annotations

import json
from typing import Any, Optional

from .composer_bridge.to_graph import to_composer_graph
from .composer_bridge.schema_hint import composer_graph_hint
from .mermaid.sanitizer import basic_sanitize
from .mermaid.validator import validate_architecture_beta
from .prompts import system_prompt, generate_prompt, edit_prompt
from .schema import DiagramResponse


def _llm_call(llm: Any, prompt: str) -> str:
    """Call CrewAI LLM (call/invoke), returning a string."""
    try:
        raw = llm.call(prompt)  # type: ignore[attr-defined]
    except Exception:
        raw = llm.invoke(prompt)  # type: ignore[attr-defined]
    return str(raw).strip()


def _extract_json(raw: str) -> Optional[dict]:
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


def generate_mermaid_diagram(llm: Any, user_prompt: str, cloud: str = "aws") -> DiagramResponse:
    schema_hint = (
        "Return ONLY valid JSON in this exact shape:\n"
        "{\"type\":\"diagram\",\"diagram_format\":\"mermaid\",\"title\":\"...\",\"code\":\"...\","
        "\"summary_markdown\":\"...\",\"composer_graph\":{...}}\n"
        "The Mermaid code MUST start with 'architecture-beta'.\n"
        "Do NOT include ``` fences.\n\n"
        + composer_graph_hint()
    )

    prompt = "\n\n".join(
        [
            system_prompt(),
            schema_hint,
            generate_prompt(user_prompt=user_prompt, cloud=cloud),
        ]
    )

    raw = _llm_call(llm, prompt)
    obj = _extract_json(raw) or {}

    code = basic_sanitize(str(obj.get("code") or ""))
    vr = validate_architecture_beta(code)
    if not vr.ok:
        code = f"architecture-beta\n%% ERROR: {vr.error}\n"

    return DiagramResponse(
        title=str(obj.get("title") or "Diagram"),
        code=code,
        summary_markdown=str(obj.get("summary_markdown") or ""),
        composer_graph=to_composer_graph(obj.get("composer_graph")),
    )


def edit_mermaid_diagram(llm: Any, user_prompt: str, prior_code: str, cloud: str = "aws") -> DiagramResponse:
    schema_hint = (
        "Return ONLY valid JSON in this exact shape:\n"
        "{\"type\":\"diagram\",\"diagram_format\":\"mermaid\",\"title\":\"...\",\"code\":\"...\","
        "\"summary_markdown\":\"...\",\"composer_graph\":{...}}\n"
        "Return the FULL updated Mermaid code.\n"
        "Do NOT include ``` fences.\n\n"
        + composer_graph_hint()
    )

    prompt = "\n\n".join(
        [
            system_prompt(),
            schema_hint,
            edit_prompt(user_prompt=user_prompt, prior_code=prior_code, cloud=cloud),
        ]
    )

    raw = _llm_call(llm, prompt)
    obj = _extract_json(raw) or {}

    code = basic_sanitize(str(obj.get("code") or ""))
    vr = validate_architecture_beta(code)
    if not vr.ok:
        code = f"architecture-beta\n%% ERROR: {vr.error}\n"

    return DiagramResponse(
        title=str(obj.get("title") or "Diagram"),
        code=code,
        summary_markdown=str(obj.get("summary_markdown") or ""),
        composer_graph=to_composer_graph(obj.get("composer_graph")),
    )
