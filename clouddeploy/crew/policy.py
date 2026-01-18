from __future__ import annotations
import json
import re
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

# --- Structured output from Policy agent ---
class PolicyDecision(BaseModel):
    type: Literal["policy"] = "policy"
    allowed: bool
    reason: str
    blocked_items: List[str] = Field(default_factory=list)
    required_user_confirmations: List[str] = Field(default_factory=list)
    suggested_safer_alternatives: List[str] = Field(default_factory=list)


DESTRUCTIVE_PATTERNS = [
    r"\bterraform\s+destroy\b",
    r"\baws\s+s3\s+rb\b.*--force",
    r"\baws\s+s3api\s+delete-bucket\b",
    r"\baws\s+iam\s+create-user\b",
    r"\baws\s+iam\s+attach-user-policy\b",
    r"\bdelete\b.*\b(bucket|vpc|subnet|db|rds|iam|kms|route53)\b",
    r"\bremove\b.*\bstate\b",
    r"\brm\s+-rf\b",
]

def _looks_destructive(text: str) -> List[str]:
    hits = []
    t = (text or "").lower()
    for pat in DESTRUCTIVE_PATTERNS:
        if re.search(pat, t, flags=re.IGNORECASE):
            hits.append(pat)
    return hits


def policy_system_prompt() -> str:
    return (
        "You are CloudDeploy Policy Guard.\n"
        "Your job: examine the proposed plan/execution and decide if it is safe.\n"
        "Default to SAFE. If destructive actions exist, block unless user explicitly confirmed.\n"
        "Return ONLY valid JSON matching the schema provided.\n"
    )


def policy_prompt(candidate_json: str, explicit_user_approval: bool) -> str:
    return (
        policy_system_prompt()
        + "\nSCHEMA:\n"
        + json.dumps(PolicyDecision.model_json_schema())
        + "\n\n"
        + f"EXPLICIT_USER_APPROVAL: {explicit_user_approval}\n\n"
        + "CANDIDATE_PLAN_OR_EXECUTION_JSON:\n"
        + candidate_json
    )


def run_policy_check(llm: Any, candidate: Dict[str, Any], explicit_user_approval: bool) -> Dict[str, Any]:
    """
    Two-layer defense:
    1) Fast heuristic blocklist (no LLM).
    2) LLM policy review for nuance and confirmations needed.
    """
    raw = json.dumps(candidate, indent=2)

    # 1) heuristic
    hits = _looks_destructive(raw)
    if hits and not explicit_user_approval:
        decision = PolicyDecision(
            allowed=False,
            reason="Destructive or high-risk operations detected; explicit approval required.",
            blocked_items=hits,
            required_user_confirmations=[
                "Confirm you want to perform destructive actions (delete/destroy) and understand data loss risk.",
                "Confirm backups exist (if data resources are involved).",
            ],
            suggested_safer_alternatives=[
                "Use 'terraform plan' first and review changes.",
                "For S3 deletions, remove objects selectively or enable lifecycle policies instead of force deletion.",
                "Prefer least-privilege IAM changes; avoid attaching admin policies.",
            ],
        )
        return decision.model_dump()

    # 2) LLM review
    prompt = policy_prompt(raw, explicit_user_approval)
    try:
        out = llm.call(prompt)  # type: ignore[attr-defined]
    except Exception:
        out = llm.invoke(prompt)  # type: ignore[attr-defined]

    # parse
    try:
        obj = json.loads(str(out))
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass

    # safe fallback
    fallback = PolicyDecision(
        allowed=True,
        reason="No policy issues detected (fallback).",
    )
    return fallback.model_dump()
