from __future__ import annotations
import json
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

class ModuleMatch(BaseModel):
    node_id: str
    aws_type: str
    module_name: str
    confidence: float = 0.0
    reason: str = ""
    proposed_inputs: Dict[str, Any] = Field(default_factory=dict)

class ModuleMappingResponse(BaseModel):
    type: Literal["module_mapping"] = "module_mapping"
    mappings: List[ModuleMatch] = Field(default_factory=list)
    unresolved: List[str] = Field(default_factory=list)
    notes: List[str] = Field(default_factory=list)

def mapper_system_prompt() -> str:
    return (
        "You are CloudDeploy Composer Module Mapper.\n"
        "Given a composer_graph (AWS node types) and a list of available composer modules,\n"
        "map each node to the best module.\n"
        "Return ONLY valid JSON matching the schema.\n"
        "Be conservative: if unsure, add node_id to unresolved.\n"
    )

def mapper_prompt(composer_graph_json: str, modules_json: str) -> str:
    return (
        mapper_system_prompt()
        + "\nSCHEMA:\n"
        + json.dumps(ModuleMappingResponse.model_json_schema())
        + "\n\nAVAILABLE_MODULES_JSON:\n"
        + modules_json
        + "\n\nCOMPOSER_GRAPH_JSON:\n"
        + composer_graph_json
        + "\n\nRules:\n"
        "- Prefer exact semantic matches (S3 bucket -> s3 bucket module).\n"
        "- Fill proposed_inputs only when you can infer safely.\n"
        "- If multiple modules match, pick the simplest one.\n"
    )

def run_module_mapper(llm: Any, composer_graph: Dict[str, Any], available_modules: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    available_modules: output from /api/composer/modules (list of modules)
    """
    prompt = mapper_prompt(
        composer_graph_json=json.dumps(composer_graph, indent=2),
        modules_json=json.dumps(available_modules, indent=2),
    )
    try:
        out = llm.call(prompt)  # type: ignore[attr-defined]
    except Exception:
        out = llm.invoke(prompt)  # type: ignore[attr-defined]

    try:
        obj = json.loads(str(out))
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass

    # Fallback: unresolved all
    nodes = (composer_graph or {}).get("nodes") or []
    unresolved = [str(n.get("id")) for n in nodes if isinstance(n, dict) and n.get("id")]
    return ModuleMappingResponse(mappings=[], unresolved=unresolved, notes=["Fallback mapping used."]).model_dump()
