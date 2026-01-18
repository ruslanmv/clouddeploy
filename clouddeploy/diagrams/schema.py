from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

DiagramFormat = Literal["mermaid"]


class ComposerGraphNode(BaseModel):
    id: str
    type: str
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


class DiagramResponse(BaseModel):
    """Payload sent to the UI via websocket or REST."""
    type: Literal["diagram"] = "diagram"
    diagram_format: DiagramFormat = "mermaid"
    title: str = "Diagram"
    code: str
    summary_markdown: str = ""
    composer_graph: Optional[ComposerGraph] = None


class DiagramGenerateRequest(BaseModel):
    prompt: str
    cloud: Optional[str] = "aws"
    diagram_format: DiagramFormat = "mermaid"


class DiagramEditRequest(BaseModel):
    prompt: str
    prior_code: str
    cloud: Optional[str] = "aws"
    diagram_format: DiagramFormat = "mermaid"
