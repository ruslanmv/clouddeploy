from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..diagrams.schema import DiagramEditRequest, DiagramGenerateRequest, DiagramResponse
from ..diagrams.service import edit_mermaid_diagram, generate_mermaid_diagram
from ..llm.llm_provider import build_llm
from ..settings import get_store

router = APIRouter(prefix="/api/diagrams", tags=["diagrams"])


def _build_llm_from_store():
    store = get_store()
    cfg = store.load()
    return build_llm(settings=cfg)


@router.post("/generate", response_model=DiagramResponse)
def generate(req: DiagramGenerateRequest) -> DiagramResponse:
    try:
        llm = _build_llm_from_store()
        return generate_mermaid_diagram(llm, user_prompt=req.prompt, cloud=req.cloud or "aws")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/edit", response_model=DiagramResponse)
def edit(req: DiagramEditRequest) -> DiagramResponse:
    try:
        llm = _build_llm_from_store()
        return edit_mermaid_diagram(
            llm,
            user_prompt=req.prompt,
            prior_code=req.prior_code,
            cloud=req.cloud or "aws",
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
