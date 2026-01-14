import os
import json
from .vendor import vendor

def build_infra(payload: dict):
    graph = payload["graph"]
    out = payload.get("output_dir", "infra")
    os.makedirs(out, exist_ok=True)

    vendor_dir = os.path.join(out, "modules_vendor")
    os.makedirs(vendor_dir, exist_ok=True)

    for n in graph.get("nodes", []):
        vendor(n.get("module"), vendor_dir)

    with open(os.path.join(out, "graph.json"), "w", encoding="utf-8") as f:
        json.dump(graph, f, indent=2)

    return {"output_path": os.path.abspath(out)}
