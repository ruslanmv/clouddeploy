# clouddeploy/api/composer_ai.py
from __future__ import annotations

import json
from typing import Any, Dict, Literal, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from clouddeploy.llm.llm_provider import build_llm
from clouddeploy.settings import get_store

# Reuse your existing diagrams service if present
from clouddeploy.diagrams.service import generate_mermaid_diagram, edit_mermaid_diagram

# New infra generation logic (file #3 below)
from clouddeploy.composer.pipelines.infra_generators import (
    generate_terraform,
    generate_cloudformation,
    generate_aws_cli,
)

router = APIRouter(prefix="/api/composer-ai", tags=["composer-ai"])

Stage = Literal["diagram", "plan", "build"]
Action = Literal["diagram.generate", "diagram.edit", "diagram.from_graph", "plan.generate", "plan.from_graph", "build.generate"]
BuildFormat = Literal["terraform", "cloudformation", "awscli"]


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
    nodes: list[ComposerGraphNode] = Field(default_factory=list)
    edges: list[ComposerGraphEdge] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ComposerAIRequest(BaseModel):
    action: Action
    stage: Stage = "diagram"

    prompt: Optional[str] = None                # for generate
    instruction: Optional[str] = None           # for edit

    current_graph: Optional[ComposerGraph] = None
    approved_diagram: bool = False
    approved_plan: bool = False

    build_format: BuildFormat = "terraform"


class ComposerAIResponse(BaseModel):
    # You can return one of these depending on stage
    diagram: Optional[dict] = None
    composer_graph: Optional[dict] = None
    plan: Optional[dict] = None
    build: Optional[dict] = None
    stage: Stage = "diagram"


def _llm():
    store = get_store()
    cfg = store.load()
    return build_llm(settings=cfg)


@router.post("", response_model=ComposerAIResponse)
def composer_ai(req: ComposerAIRequest) -> ComposerAIResponse:
    llm = _llm()

    # --- DIAGRAM GENERATE ---
    if req.action == "diagram.generate":
      if not req.prompt:
        raise HTTPException(400, "Missing prompt")
      diag = generate_mermaid_diagram(llm, user_prompt=req.prompt, cloud="aws")
      # IMPORTANT: your diagram service must output composer_graph for full Composer sync.
      # If your current service returns composer_graph=None, update its prompt to require it.
      return ComposerAIResponse(
        diagram=diag.model_dump(),
        composer_graph=(diag.composer_graph.model_dump() if diag.composer_graph else None),
        stage="diagram",
      )

    # --- DIAGRAM EDIT (AI edits existing graph/diagram) ---
    if req.action == "diagram.edit":
      if not req.instruction:
        raise HTTPException(400, "Missing instruction")

      # If you have prior mermaid code, pass it. If you only have graph, you can store mermaid in metadata.
      prior_mermaid = ""
      if req.current_graph and req.current_graph.metadata:
        prior_mermaid = str(req.current_graph.metadata.get("mermaid") or "")

      # Best: keep mermaid in metadata; fallback to minimal
      if not prior_mermaid.strip():
        prior_mermaid = "architecture-beta\n%% No prior Mermaid in session\n"

      diag = edit_mermaid_diagram(llm, user_prompt=req.instruction, prior_code=prior_mermaid, cloud="aws")

      return ComposerAIResponse(
        diagram=diag.model_dump(),
        composer_graph=(diag.composer_graph.model_dump() if diag.composer_graph else None),
        stage="diagram",
      )

    # --- DIAGRAM FROM GRAPH (analyze manually created graph) ---
    if req.action == "diagram.from_graph":
      if not req.current_graph:
        raise HTTPException(400, "Missing current_graph")

      # Build a summary of the current graph for AI analysis
      graph_dict = req.current_graph.model_dump()
      nodes_summary = []
      for n in graph_dict.get("nodes", []):
        nodes_summary.append(f"- {n.get('label', n.get('id'))} ({n.get('type', 'unknown')})")

      analysis_prompt = (
        "Analyze this AWS architecture diagram and provide recommendations:\n\n"
        f"Services:\n" + "\n".join(nodes_summary) + "\n\n"
        "Provide:\n"
        "1. Summary of what this architecture does\n"
        "2. Security recommendations\n"
        "3. Cost optimization suggestions\n"
        "4. Best practices to implement\n"
      )

      # Use LLM to generate analysis
      response = llm.complete(analysis_prompt)

      return ComposerAIResponse(
        diagram={
          "type": "analysis",
          "content": response.text,
          "graph": graph_dict,
        },
        composer_graph=graph_dict,
        stage="diagram",
      )

    # --- PLAN GENERATE (requires approved diagram) ---
    if req.action == "plan.generate":
      if not req.approved_diagram:
        raise HTTPException(400, "Diagram not approved yet. Approve diagram before planning.")
      # Placeholder: you can call your CrewAI planner here; returning a simple plan skeleton for now.
      plan = {
        "type": "plan",
        "needs_approval": True,
        "summary": "Plan to implement the approved architecture",
        "steps": [
          {"name": "Validate inputs", "description": "Validate module props and required fields", "commands": [], "files": [], "risks": [], "checks": []},
          {"name": "Generate IaC", "description": "Generate Terraform / CloudFormation from graph", "commands": [], "files": [], "risks": [], "checks": []},
          {"name": "Preview changes", "description": "terraform plan / cfn validate", "commands": [], "files": [], "risks": [], "checks": []},
        ],
        "rollback": ["Use terraform destroy only if explicitly approved", "Revert stack changes carefully"],
        "assumptions": [],
      }
      return ComposerAIResponse(plan=plan, stage="plan")

    # --- PLAN FROM GRAPH (generate plan directly from graph) ---
    if req.action == "plan.from_graph":
      if not req.current_graph:
        raise HTTPException(400, "Missing current_graph")

      # Generate plan from the current graph
      plan = {
        "type": "plan",
        "needs_approval": True,
        "summary": "Infrastructure deployment plan generated from diagram",
        "steps": [
          {"name": "Validate graph", "description": "Validate all nodes have required properties", "commands": [], "files": [], "risks": [], "checks": []},
          {"name": "Generate infrastructure code", "description": f"Generate {req.build_format} code from graph", "commands": [], "files": [], "risks": [], "checks": []},
          {"name": "Review and deploy", "description": "Review generated code and deploy", "commands": [], "files": [], "risks": [], "checks": []},
        ],
        "rollback": ["Destroy infrastructure only if explicitly approved"],
        "assumptions": ["All node properties are valid", "AWS credentials are configured"],
      }
      return ComposerAIResponse(plan=plan, stage="plan")

    # --- BUILD GENERATE (requires approved plan) ---
    if req.action == "build.generate":
      if not req.approved_plan:
        raise HTTPException(400, "Plan not approved yet. Approve plan before build.")

      if not req.current_graph:
        raise HTTPException(400, "Missing current_graph for build")

      g = req.current_graph.model_dump()

      if req.build_format == "terraform":
        out = generate_terraform(g)
      elif req.build_format == "cloudformation":
        out = generate_cloudformation(g)
      else:
        out = generate_aws_cli(g)

      return ComposerAIResponse(build=out, stage="build")

    raise HTTPException(400, f"Unknown action: {req.action}")
