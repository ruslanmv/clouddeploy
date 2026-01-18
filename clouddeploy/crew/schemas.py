from __future__ import annotations
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

# --- Shared graph model (Composer import) ---
class ComposerGraphNode(BaseModel):
    id: str
    type: str               # e.g. "aws.s3", "aws.vpc", "aws.lambda"
    label: str
    props: Dict[str, Any] = Field(default_factory=dict)

class ComposerGraphEdge(BaseModel):
    source: str
    target: str
    label: Optional[str] = None

class ComposerGraph(BaseModel):
    nodes: List[ComposerGraphNode] = Field(default_factory=list)
    edges: List[ComposerGraphEdge] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


# --- Diagram payload (what chat renders) ---
class DiagramResponse(BaseModel):
    type: Literal["diagram"] = "diagram"
    diagram_format: Literal["mermaid"] = "mermaid"
    title: str = "Diagram"
    code: str
    summary_markdown: str = ""
    composer_graph: Optional[ComposerGraph] = None


# --- Plan payload (Claude Code-style "steps") ---
class PlanStep(BaseModel):
    name: str
    description: str
    commands: List[str] = Field(default_factory=list)   # shell commands to run
    files: List[str] = Field(default_factory=list)      # files affected/created
    risks: List[str] = Field(default_factory=list)
    checks: List[str] = Field(default_factory=list)

class PlanResponse(BaseModel):
    type: Literal["plan"] = "plan"
    summary: str
    needs_approval: bool = True
    steps: List[PlanStep] = Field(default_factory=list)
    rollback: List[str] = Field(default_factory=list)
    assumptions: List[str] = Field(default_factory=list)


# --- Execution payload (what actually runs) ---
class ExecCommand(BaseModel):
    command: str
    cwd: Optional[str] = None
    env: Dict[str, str] = Field(default_factory=dict)

class ExecutionResponse(BaseModel):
    type: Literal["execution"] = "execution"
    needs_approval: bool = True
    commands: List[ExecCommand] = Field(default_factory=list)
    post_checks: List[str] = Field(default_factory=list)
