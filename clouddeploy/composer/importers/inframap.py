import os
import hcl2

def import_hcl(path: str):
    nodes, edges = [], []
    for root, _, files in os.walk(path):
        for f in files:
            if not f.endswith(".tf"):
                continue
            p = os.path.join(root, f)
            try:
                with open(p, "r", encoding="utf-8") as fp:
                    data = hcl2.load(fp)
            except Exception:
                continue

            res = data.get("resource", {})
            if isinstance(res, list):
                for entry in res:
                    if isinstance(entry, dict):
                        for rtype, rs in entry.items():
                            if isinstance(rs, dict):
                                for name, body in rs.items():
                                    nodes.append({
                                        "id": f"{rtype}.{name}",
                                        "module": rtype,
                                        "ref": name,
                                        "inputs": body or {}
                                    })
            elif isinstance(res, dict):
                for rtype, rs in res.items():
                    if isinstance(rs, dict):
                        for name, body in rs.items():
                            nodes.append({
                                "id": f"{rtype}.{name}",
                                "module": rtype,
                                "ref": name,
                                "inputs": body or {}
                            })
    return {"nodes": nodes, "edges": edges}
