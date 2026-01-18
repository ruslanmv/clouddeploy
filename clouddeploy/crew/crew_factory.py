from __future__ import annotations
from crewai import Crew

from .agents import diagram_agent, planner_agent, executor_agent

def make_crew_for_stage(llm, stage: str, tasks):
    stage = (stage or "").lower()
    if stage == "diagram":
        agents = [diagram_agent(llm)]
    elif stage == "plan":
        agents = [planner_agent(llm)]
    elif stage == "execute":
        agents = [executor_agent(llm)]
    else:
        agents = [diagram_agent(llm)]

    return Crew(
        agents=agents,
        tasks=tasks,
        verbose=False,
    )
