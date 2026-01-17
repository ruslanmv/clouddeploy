"""Diagram generation + rendering helpers.

This package is intentionally small and "pluggable":
- Chat (ws) can emit {type:"diagram"} payloads directly.
- REST endpoints can optionally call the same service.

Current focus: Mermaid (architecture-beta) diagrams for cloud/AWS.
"""
