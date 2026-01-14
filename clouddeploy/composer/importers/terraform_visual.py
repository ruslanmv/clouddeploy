def import_plan(plan: dict):
    nodes, edges = [], []
    root = plan.get("planned_values", {}).get("root_module", {})
    for r in root.get("resources", []):
        addr = r.get("address")
        rtype = r.get("type")
        if not addr or not rtype:
            continue
        nodes.append({
            "id": addr,
            "module": rtype,
            "ref": "resource",
            "inputs": r.get("values", {})
        })
        for dep in r.get("depends_on", []):
            if isinstance(dep, str) and dep:
                edges.append({
                    "from": {"node": dep, "output": "id"},
                    "to": {"node": addr, "input": "id"}
                })
    return {"nodes": nodes, "edges": edges}
