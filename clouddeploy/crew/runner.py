from __future__ import annotations

import json
from typing import Any, Dict, Optional

from .crew_factory import make_crew_for_stage
from .tasks import make_diagram_task, make_diagram_edit_task, make_plan_task, make_execute_task
from .schemas import DiagramResponse, PlanResponse, ExecutionResponse
from .policy import run_policy_check
from .mappers.module_mapper import run_module_mapper

DIAGRAM_SCHEMA_HINT = DiagramResponse.model_json_schema()
PLAN_SCHEMA_HINT = PlanResponse.model_json_schema()
EXEC_SCHEMA_HINT = ExecutionResponse.model_json_schema()

def _extract_json(text: str) -> Dict[str, Any]:
    text = (text or "").strip()
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    # best effort: find first {...} block
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            obj = json.loads(text[start:end+1])
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass
    return {"type": "message", "text": text}

def run_diagram(llm, user_request: str) -> Dict[str, Any]:
    agent_tasks = [
        make_diagram_task(
            agent=None,  # filled by CrewAI internally from crew agents; task needs agent assigned below
            user_request=user_request,
            diagram_schema_hint=json.dumps(DIAGRAM_SCHEMA_HINT),
        )
    ]
    # Task must have an agent. We create crew first then set task.agent.
    crew = make_crew_for_stage(llm, "diagram", [])
    agent_tasks[0].agent = crew.agents[0]
    crew.tasks = agent_tasks
    out = crew.kickoff()
    return _extract_json(str(out))

def run_plan(llm, user_request: str, diagram_code: str, composer_graph_json: str) -> Dict[str, Any]:
    agent_tasks = [
        make_plan_task(
            agent=None,
            user_request=user_request,
            diagram_code=diagram_code,
            composer_graph_json=composer_graph_json,
            plan_schema_hint=json.dumps(PLAN_SCHEMA_HINT),
        )
    ]
    crew = make_crew_for_stage(llm, "plan", [])
    agent_tasks[0].agent = crew.agents[0]
    crew.tasks = agent_tasks
    out = crew.kickoff()
    return _extract_json(str(out))

def run_execute(llm, approved_plan_json: str, approved: bool) -> Dict[str, Any]:
    agent_tasks = [
        make_execute_task(
            agent=None,
            approved_plan_json=approved_plan_json,
            approved=approved,
            exec_schema_hint=json.dumps(EXEC_SCHEMA_HINT),
        )
    ]
    crew = make_crew_for_stage(llm, "execute", [])
    agent_tasks[0].agent = crew.agents[0]
    crew.tasks = agent_tasks
    out = crew.kickoff()
    return _extract_json(str(out))

def run_diagram_edit(llm, user_request: str, prior_code: str) -> Dict[str, Any]:
    """Edit an existing diagram with a new request."""
    agent_tasks = [
        make_diagram_edit_task(
            agent=None,
            user_request=user_request,
            prior_code=prior_code,
            diagram_schema_hint=json.dumps(DIAGRAM_SCHEMA_HINT),
        )
    ]
    crew = make_crew_for_stage(llm, "diagram", [])
    agent_tasks[0].agent = crew.agents[0]
    crew.tasks = agent_tasks
    out = crew.kickoff()
    return _extract_json(str(out))

def run_plan_with_mapping(
    llm,
    user_request: str,
    diagram_code: str,
    composer_graph: Dict[str, Any],
    available_modules: list,
) -> Dict[str, Any]:
    """Generate a plan with module mapping for Composer integration."""
    # First: mapping
    mapping = run_module_mapper(llm, composer_graph=composer_graph, available_modules=available_modules)

    # Then: plan (include mapping in request context)
    composer_graph_json = json.dumps(composer_graph, indent=2)
    mapping_json = json.dumps(mapping, indent=2)

    enriched_request = (
        user_request
        + "\n\nMODULE_MAPPING_JSON:\n"
        + mapping_json
        + "\n\nUse the mapping to pick correct Composer modules and to name generated files/resources."
    )

    plan_obj = run_plan(llm, enriched_request, diagram_code, composer_graph_json)
    # attach mapping for UI/Composer
    plan_obj["module_mapping"] = mapping
    return plan_obj

def run_execute_with_policy(llm, approved_plan_json: str, explicit_user_approval: bool) -> Dict[str, Any]:
    """Execute plan with policy check to prevent unsafe operations."""
    # First: policy check on the plan itself (defense in depth)
    try:
        plan_obj = json.loads(approved_plan_json)
        if not isinstance(plan_obj, dict):
            plan_obj = {"raw": approved_plan_json}
    except Exception:
        plan_obj = {"raw": approved_plan_json}

    decision = run_policy_check(llm, candidate=plan_obj, explicit_user_approval=explicit_user_approval)

    if not decision.get("allowed", True):
        # Return a structured policy response that UI can show
        return decision

    # Then produce execution commands (still needs approval at app layer)
    return run_execute(llm, approved_plan_json=approved_plan_json, approved=explicit_user_approval)
