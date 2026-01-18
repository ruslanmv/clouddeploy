from __future__ import annotations

import json
from typing import Any, Dict, Optional

from .crew_factory import make_crew_for_stage
from .tasks import make_diagram_task, make_plan_task, make_execute_task
from .schemas import DiagramResponse, PlanResponse, ExecutionResponse

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
