def composer_graph_hint() -> str:
    return (
        "Also include composer_graph with nodes/edges.\n"
        "Each node must have:\n"
        "- id: stable string\n"
        "- type: AWS type like 'aws.s3', 'aws.lambda', 'aws.vpc'\n"
        "- label: short name\n"
        "Edges should represent data flow / attachment.\n"
        "Example composer_graph:\n"
        "{\"nodes\":[{\"id\":\"s3\",\"type\":\"aws.s3\",\"label\":\"S3 Bucket\",\"props\":{}}],"
        "\"edges\":[],\"metadata\":{\"cloud\":\"aws\"}}\n"
    )
