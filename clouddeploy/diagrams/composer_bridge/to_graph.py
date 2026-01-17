from __future__ import annotations
from typing import Any, Dict, Optional
from ..schema import ComposerGraph


def to_composer_graph(best_effort: Optional[Dict[str, Any]]) -> Optional[ComposerGraph]:
    """Validate/normalize a model-provided composer_graph."""
    if not best_effort:
        return None
    try:
        return ComposerGraph.model_validate(best_effort)
    except Exception:
        return None
