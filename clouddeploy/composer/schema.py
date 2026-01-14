from jsonschema import Draft7Validator

GRAPH_SCHEMA = {
    "type": "object",
    "required": ["nodes", "edges"],
    "properties": {
        "nodes": {"type": "array"},
        "edges": {"type": "array"}
    }
}

def validate_graph(graph):
    Draft7Validator(GRAPH_SCHEMA).validate(graph)
