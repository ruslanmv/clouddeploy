from __future__ import annotations
from crewai import Task

from .prompts import diagram_prompt, diagram_edit_prompt, plan_prompt, execute_prompt

def make_diagram_task(agent, user_request: str, diagram_schema_hint: str) -> Task:
    return Task(
        description=(
            "Return STRICT JSON matching this schema:\n"
            f"{diagram_schema_hint}\n\n"
            + diagram_prompt(user_request)
        ),
        agent=agent,
        expected_output="Strict JSON DiagramResponse",
    )

def make_diagram_edit_task(agent, user_request: str, prior_code: str, diagram_schema_hint: str) -> Task:
    return Task(
        description=(
            "Return STRICT JSON matching this schema:\n"
            f"{diagram_schema_hint}\n\n"
            + diagram_edit_prompt(user_request, prior_code)
        ),
        agent=agent,
        expected_output="Strict JSON DiagramResponse (edited)",
    )

def make_plan_task(agent, user_request: str, diagram_code: str, composer_graph_json: str, plan_schema_hint: str) -> Task:
    return Task(
        description=(
            "Return STRICT JSON matching this schema:\n"
            f"{plan_schema_hint}\n\n"
            + plan_prompt(user_request, diagram_code, composer_graph_json)
        ),
        agent=agent,
        expected_output="Strict JSON PlanResponse",
    )

def make_execute_task(agent, approved_plan_json: str, approved: bool, exec_schema_hint: str) -> Task:
    return Task(
        description=(
            "Return STRICT JSON matching this schema:\n"
            f"{exec_schema_hint}\n\n"
            + execute_prompt(approved_plan_json, approved)
        ),
        agent=agent,
        expected_output="Strict JSON ExecutionResponse",
    )
