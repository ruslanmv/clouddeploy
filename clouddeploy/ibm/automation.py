from __future__ import annotations

from typing import Any, Dict, Optional


def decide_input(state: Dict[str, Any], tail: str) -> Optional[str]:
    """
    Conservative IBM Cloud autopilot (v1).

    Rules:
    - NEVER try to fix errors automatically (stop and let user/AI advise).
    - Prefer defaults (press Enter) for most prompts.
    - For "image source mode", choose Build & Push (1) for "zero to hero".
    - For yes/no confirmations, default to "Y" where safe.
    """

    if state.get("completed"):
        return None

    # If any error is detected, stop. Don't guess.
    if state.get("last_error"):
        return None

    if not state.get("waiting_for_input"):
        return None

    prompt = (state.get("prompt") or "").lower()
    tail_low = (tail or "").lower()

    # --- Explicit safe Y/N confirmations ---
    # These are typically asking to proceed, deploy, install plugin, replace secret, etc.
    if "[y/n]" in prompt:
        # Prefer "Y" (the script's default) unless prompt seems destructive.
        # In this wizard, prompts are generally "proceed?" and safe.
        return "Y\n"

    # --- Key wizard decision: image source ---
    # Choose "1" (build & push) for the common first-run path.
    if "choose how you want to obtain the container image" in tail_low:
        return "1\n"

    # --- Common selections: accept defaults ---
    # Most prompts in your script show a recommended default in brackets.
    # Pressing Enter accepts it.
    if prompt.startswith("selection"):
        return "\n"
    if prompt.startswith("select"):
        return "\n"
    if prompt.startswith("enter"):
        return "\n"

    # --- Specific known prompts (accept default) ---
    if "select namespace" in prompt:
        return "\n"
    if "select image" in prompt or "pick image" in prompt:
        return "\n"
    if "select registry for push" in prompt:
        return "\n"

    # --- Resource prompts: accept defaults ---
    if "cpu" in prompt or "memory" in prompt or "minimum number" in prompt or "maximum number" in prompt:
        return "\n"
    if "application name" in prompt or "port your application listens on" in prompt:
        return "\n"

    # Fallback: safest action is Enter (accept default)
    return "\n"
