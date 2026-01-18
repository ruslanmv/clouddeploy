def composer_graph_hint() -> str:
    return (
        "CRITICAL: You MUST include a complete composer_graph object with nodes and edges.\n"
        "The composer_graph field is REQUIRED and MUST NOT be null or omitted.\n"
        "Each node MUST have:\n"
        "- id: stable string (no spaces, lowercase)\n"
        "- type: AWS type like 'aws.s3', 'aws.lambda', 'aws.vpc', 'aws.cloudfront', 'aws.rds', 'aws.alb'\n"
        "- label: human-readable short name\n"
        "- props: object with service-specific properties (bucket_name, versioning, encryption, etc.)\n"
        "Edges should represent data flow, attachments, or dependencies.\n"
        "REQUIRED Example composer_graph:\n"
        "{\"nodes\":[{\"id\":\"mybucket\",\"type\":\"aws.s3\",\"label\":\"S3 Bucket\",\"props\":{\"bucket_name\":\"my-bucket\",\"versioning\":true}}],"
        "\"edges\":[],\"metadata\":{\"cloud\":\"aws\"}}\n"
    )
