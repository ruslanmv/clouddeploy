from fastapi import APIRouter, UploadFile, File, Body
from typing import List
import json
import tempfile
import shutil
import os

from .schema import validate_graph
from .importers.drawio import import_drawio
from .importers.terraform_visual import import_plan
from .importers.inframap import import_hcl
from .builder.generator import build_infra
from .catalog.indexer import load_catalog

router = APIRouter(prefix="/api/composer", tags=["composer"])

@router.get("/modules")
def modules():
    return load_catalog()

@router.post("/import/plan")
def plan(file: UploadFile = File(...)):
    return import_plan(json.loads(file.file.read()))

@router.post("/import/drawio")
def drawio(file: UploadFile = File(...)):
    return import_drawio(file)

@router.post("/import/hcl")
def hcl(files: List[UploadFile] = File(...)):
    tmp = tempfile.mkdtemp()
    try:
        for f in files:
            with open(os.path.join(tmp, f.filename), "wb") as out:
                out.write(f.file.read())
        return import_hcl(tmp)
    finally:
        shutil.rmtree(tmp)

@router.post("/validate")
def validate(payload: dict = Body(...)):
    validate_graph(payload["graph"])
    return {"ok": True}

@router.post("/build")
def build(payload: dict = Body(...)):
    validate_graph(payload["graph"])
    return build_infra(payload)
