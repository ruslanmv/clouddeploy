# clouddeploy/composer/pipelines/infra_generators.py
from __future__ import annotations
from typing import Any, Dict, List

def _nodes(graph: Dict[str, Any]) -> List[Dict[str, Any]]:
    return list((graph or {}).get("nodes") or [])

def _props(n: Dict[str, Any]) -> Dict[str, Any]:
    return dict(n.get("props") or {})

def generate_terraform(graph: Dict[str, Any]) -> Dict[str, Any]:
    """
    Returns Terraform files as strings. Expand mapping per aws.* type.
    """
    tf = []
    tf.append('terraform {\n  required_providers {\n    aws = {\n      source = "hashicorp/aws"\n    }\n  }\n}\n')
    tf.append('provider "aws" {\n  region = var.aws_region\n}\n\nvariable "aws_region" { type = string }\n')

    for n in _nodes(graph):
        t = (n.get("type") or "").lower()
        name = (n.get("id") or "resource").replace("-", "_")
        p = _props(n)

        if t == "aws.s3":
            bucket = p.get("bucket_name") or f"{name}-bucket"
            versioning = bool(p.get("versioning", False))
            sse = p.get("encryption", "AES256")

            tf.append(f'''
resource "aws_s3_bucket" "{name}" {{
  bucket = "{bucket}"
}}
''')
            if versioning:
                tf.append(f'''
resource "aws_s3_bucket_versioning" "{name}_ver" {{
  bucket = aws_s3_bucket.{name}.id
  versioning_configuration {{
    status = "Enabled"
  }}
}}
''')
            if sse:
                tf.append(f'''
resource "aws_s3_bucket_server_side_encryption_configuration" "{name}_sse" {{
  bucket = aws_s3_bucket.{name}.id
  rule {{
    apply_server_side_encryption_by_default {{
      sse_algorithm = "{sse}"
    }}
  }}
}}
''')

        # Add more mappings: aws.vpc, aws.lambda, aws.rds, aws.alb, etc.

    return {
        "format": "terraform",
        "files": {
            "main.tf": "\n".join(tf),
        },
        "notes": [
            "This is a starter generator. Expand per aws.* node type for full coverage.",
            "Prefer storing sensitive values as variables or secrets managers integrations.",
        ],
    }

def generate_cloudformation(graph: Dict[str, Any]) -> Dict[str, Any]:
    """
    Returns a single CloudFormation template (YAML) as string.
    """
    resources = []
    for n in _nodes(graph):
        t = (n.get("type") or "").lower()
        logical_id = (n.get("id") or "Resource").replace("-", "").replace("_", "")
        p = _props(n)

        if t == "aws.s3":
            bucket_name = p.get("bucket_name")
            versioning = p.get("versioning", False)

            props = []
            if bucket_name:
                props.append(f"      BucketName: {bucket_name}")
            if versioning:
                props.append("      VersioningConfiguration:\n        Status: Enabled")

            resources.append(
                "  " + logical_id + ":\n"
                "    Type: AWS::S3::Bucket\n"
                "    Properties:\n" +
                ("\n".join(props) if props else "      {}\n")
            )

    template = (
        "AWSTemplateFormatVersion: '2010-09-09'\n"
        "Description: Generated from Composer graph\n"
        "Resources:\n" +
        ("\n".join(resources) if resources else "  {}\n")
    )
    return {
        "format": "cloudformation",
        "files": {"template.yaml": template},
        "notes": ["Starter CloudFormation generator. Expand mappings per aws.* node type."],
    }

def generate_aws_cli(graph: Dict[str, Any]) -> Dict[str, Any]:
    """
    Returns a bash script with AWS CLI commands.
    """
    lines = ["#!/usr/bin/env bash", "set -euo pipefail"]

    for n in _nodes(graph):
        t = (n.get("type") or "").lower()
        p = _props(n)

        if t == "aws.s3":
            bucket = p.get("bucket_name") or f"{n.get('id','bucket')}-bucket"
            region = p.get("region", "${AWS_REGION:-us-east-1}")
            lines.append(f'aws s3api create-bucket --bucket "{bucket}" --region "{region}"')

            if p.get("versioning"):
                lines.append(f'aws s3api put-bucket-versioning --bucket "{bucket}" --versioning-configuration Status=Enabled')

            if p.get("encryption"):
                algo = p.get("encryption", "AES256")
                lines.append(
                    f'aws s3api put-bucket-encryption --bucket "{bucket}" '
                    f'--server-side-encryption-configuration \'{{"Rules":[{{"ApplyServerSideEncryptionByDefault":{{"SSEAlgorithm":"{algo}"}}}}]}}\''
                )

    return {
        "format": "awscli",
        "files": {"apply.sh": "\n".join(lines) + "\n"},
        "notes": [
            "AWS CLI script is imperative; consider Terraform/CloudFormation for idempotency.",
            "Set AWS_REGION/AWS_PROFILE externally; do not embed secrets.",
        ],
    }
