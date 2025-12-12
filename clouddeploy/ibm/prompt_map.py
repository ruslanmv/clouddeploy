from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Pattern, Tuple

# -----------------------------------------------------------------------------
# IBM wizard step mapping
# -----------------------------------------------------------------------------
# Goal: stabilize "where we are" in the bash wizard by matching known phrases
# in terminal output, independent of minor formatting differences.
#
# Step IDs should be stable and human-readable, since both UI + MCP clients use them.
# -----------------------------------------------------------------------------


@dataclass(frozen=True)
class StepRule:
    step_id: str
    pattern: Pattern[str]
    # Optional: a short label to show in UI
    label: str


def _rx(s: str) -> Pattern[str]:
    return re.compile(s, re.IGNORECASE | re.MULTILINE)


# Ordered rules: first match wins (so put more specific patterns earlier)
STEP_RULES: List[StepRule] = [
    StepRule(
        step_id="image_source_mode",
        label="Choose image source",
        pattern=_rx(r"choose how you want to obtain the container image"),
    ),
    StepRule(
        step_id="docker_build",
        label="Build Docker image",
        pattern=_rx(r"building docker image from dockerfile"),
    ),
    StepRule(
        step_id="local_image_select",
        label="Select local Docker image",
        pattern=_rx(r"local docker images:"),
    ),
    StepRule(
        step_id="icr_registry_select",
        label="Select ICR registry endpoint",
        pattern=_rx(r"container registry public regional endpoints|select registry for push"),
    ),
    StepRule(
        step_id="icr_namespace_select",
        label="Select ICR namespace",
        pattern=_rx(r"available namespaces:|select namespace"),
    ),
    StepRule(
        step_id="icr_push_confirm",
        label="Confirm push to ICR",
        pattern=_rx(r"proceed with tagging and pushing to icr"),
    ),
    StepRule(
        step_id="ce_deploy_confirm",
        label="Deploy to Code Engine?",
        pattern=_rx(r"do you want to deploy this image .* to code engine\?"),
    ),
    StepRule(
        step_id="ce_plugin_install",
        label="Ensure Code Engine plugin",
        pattern=_rx(r"checking for code engine plugin|install the 'code-engine' plugin"),
    ),
    StepRule(
        step_id="ce_project_select",
        label="Select Code Engine project",
        pattern=_rx(r"available code engine projects|select code engine project|project select"),
    ),
    StepRule(
        step_id="ce_registry_secret",
        label="Configure registry secret",
        pattern=_rx(r"configuring code engine access to ibm cloud container registry|registry secret"),
    ),
    StepRule(
        step_id="ce_env_secret",
        label="Configure env secret",
        pattern=_rx(r"configure environment variables from \.env file|creating env secret"),
    ),
    StepRule(
        step_id="ce_app_config",
        label="Configure application",
        pattern=_rx(r"configuring code engine application|deployment summary"),
    ),
    StepRule(
        step_id="ce_app_apply",
        label="Create/Update application",
        pattern=_rx(r"creating new application|updating it\.\.\.|ce app (create|update)"),
    ),
    StepRule(
        step_id="ce_app_url",
        label="Fetch application URL",
        pattern=_rx(r"fetching application url|should be available at:"),
    ),
    StepRule(
        step_id="done",
        label="Done",
        pattern=_rx(r"all done!"),
    ),
]


# Prompt patterns for "waiting for input"
# (StepDetector uses these to mark waiting=True, and to show prompt text)
PROMPT_PATTERNS: List[Tuple[str, Pattern[str]]] = [
    ("selection", _rx(r"selection\s*\[\d+\]\s*:")),
    ("select", _rx(r"^select .+?:\s*$")),
    ("enter", _rx(r"^enter .+?:\s*$")),
    ("proceed_yn", _rx(r"proceed .+\[y/n\]")),
    ("install_yn", _rx(r"install .+\[y/n\]")),
    ("deploy_yn", _rx(r"deploy .+\[y/n\]")),
]


def detect_step_id(text: str) -> Optional[str]:
    """
    Return the best matching step_id for the given terminal text.
    First match wins based on STEP_RULES order.
    """
    for rule in STEP_RULES:
        if rule.pattern.search(text):
            return rule.step_id
    return None


def detect_prompt(text: str) -> Optional[str]:
    """
    Return a normalized prompt "type" if terminal tail appears to be waiting for input.
    """
    tail = text[-2000:]
    for _, pat in PROMPT_PATTERNS:
        if pat.search(tail):
            # Return the actual prompt line (best effort)
            # We'll try to extract the last matching line
            lines = tail.splitlines()
            for line in reversed(lines):
                if pat.search(line):
                    return line.strip()
            return "Waiting for input"
    return None


def label_for_step(step_id: str) -> str:
    for rule in STEP_RULES:
        if rule.step_id == step_id:
            return rule.label
    return step_id
