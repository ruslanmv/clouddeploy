from __future__ import annotations
from crewai import Agent

from .prompts import SYSTEM_BASE

def diagram_agent(llm) -> Agent:
    return Agent(
        role="Cloud Diagram Architect",
        goal="Generate AWS architecture diagrams and a normalized Composer graph representation.",
        backstory="Expert cloud architect. Produces Mermaid architecture-beta diagrams and structured graph models.",
        llm=llm,
        verbose=False,
        allow_delegation=False,
        system_message=SYSTEM_BASE,
    )

def planner_agent(llm) -> Agent:
    return Agent(
        role="Infrastructure Planner",
        goal="Produce a safe, ordered plan to implement the approved design as deployable infrastructure.",
        backstory="Senior platform engineer who writes precise step-by-step plans like Claude Code.",
        llm=llm,
        verbose=False,
        allow_delegation=False,
        system_message=SYSTEM_BASE,
    )

def executor_agent(llm) -> Agent:
    return Agent(
        role="Execution Engineer",
        goal="Convert an approved plan into explicit commands and checks; never run without approval.",
        backstory="Release engineer focused on safe execution, validations, and rollback.",
        llm=llm,
        verbose=False,
        allow_delegation=False,
        system_message=SYSTEM_BASE,
    )
