import xml.etree.ElementTree as ET

def import_drawio(file):
    file.file.seek(0)
    raw = file.file.read()
    try:
        root = ET.fromstring(raw)
    except Exception as e:
        return {"graph": {"nodes": [], "edges": []}, "ambiguities": [{"reason": f"Invalid XML: {e}"}]}

    nodes, edges = [], []
    for cell in root.iter("mxCell"):
        if cell.get("vertex") == "1":
            label = (cell.get("value") or "").strip()
            nodes.append({
                "id": cell.get("id"),
                "module": label.lower().replace(" ", "-") if label else "unknown",
                "inputs": {}
            })
        if cell.get("edge") == "1" and cell.get("source") and cell.get("target"):
            edges.append({
                "from": {"node": cell.get("source"), "output": "id"},
                "to": {"node": cell.get("target"), "input": "id"}
            })

    return {"graph": {"nodes": nodes, "edges": edges}, "ambiguities": []}
