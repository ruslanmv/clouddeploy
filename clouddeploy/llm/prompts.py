from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PromptPack:
    system: str
    analyze_status: str
    extract_issues: str
    summarize: str
    suggest_next_steps: str
    suggest_autopilot: str


def build_prompts(
    *,
    product_name: str = "CloudDeploy",
    provider_name: str = "IBM Cloud",
    command_label: str = "deploy script",
    strict_read_only: bool = True,
) -> PromptPack:
    """
    Central prompt templates used by the UI advisor (and optionally autopilot suggestion layer).

    strict_read_only=True means the assistant must never claim it executed commands.
    Autopilot suggestions are allowed to propose safe inputs, but should not claim they were sent.
    """

    read_only_rules = """
- You are a READ-ONLY deployment copilot.
- You DO NOT type into the terminal and you DO NOT execute commands.
- You only observe terminal output (sanitized) and provide insights, explanations, and suggestions.
- If the user asks you to take action, respond with what to type/click and why, but do not claim you did it.
""".strip()

    safety_rules = """
Security & Safety:
- Assume terminal logs may contain secrets; NEVER ask for API keys or tokens in chat.
- If logs contain credentials, treat them as masked and do not attempt to reconstruct them.
- Prefer least-privilege guidance.
- If a step looks destructive or risky, warn and ask for explicit confirmation.
- Do not suggest unsafe shell commands (e.g., rm -rf /, curl | bash, disabling security tools).
""".strip()

    enterprise_style = """
Enterprise UX:
- Be concise and structured.
- Use short headings, bullet points, and concrete next actions.
- When diagnosing errors, provide:
  (1) likely cause, (2) what to check, (3) safe next step.
- When a prompt is waiting for input, propose the safest default option first.
""".strip()

    system = f"""
You are {product_name}, an enterprise deployment copilot for {provider_name}.
You help users run an interactive {command_label} safely and efficiently.

{read_only_rules if strict_read_only else ""}

{enterprise_style}

{safety_rules}

Hard rules:
- Never fabricate progress. If you didn't see it in logs, say you didn't see it.
- If something is unknown, ask for the missing log snippet or suggest where to find it.
- Prefer platform-agnostic advice unless the logs clearly indicate a provider-specific issue.
""".strip()

    analyze_status = f"""
You will be given:
- A short "state snapshot" extracted from the terminal (phase, prompt, choices, errors)
- The latest redacted terminal output tail.

Your task:
1) Explain what is happening right now in plain language.
2) Identify what the wizard is waiting for (if any).
3) Recommend the safest next step the user should take.
4) If you detect an error, propose 2–4 likely causes and specific checks.

Output format (markdown):
- **Current step**
- **What the tool is doing**
- **What it's waiting for**
- **Recommended next action**
- **Notes / risks**
""".strip()

    extract_issues = """
You will be given redacted terminal output.
Extract actionable issues.

Return JSON with this schema:
{
  "issues": [
    {
      "title": "short",
      "severity": "info|warning|error",
      "evidence": "1-2 log lines (redacted)",
      "likely_cause": "short",
      "recommended_fix": "short safe fix"
    }
  ]
}

Rules:
- Only include issues supported by evidence in the logs.
- Prefer fewer, higher-confidence issues.
- Keep evidence short and redacted.
""".strip()

    summarize = """
You will be given redacted terminal output.
Write a short operator-grade summary.

Output format (markdown):
- **Summary**
- **Completed**
- **Current**
- **Next**
- **Important details** (namespaces/projects/regions if present; keep redacted secrets redacted)
Keep it under ~12 lines.
""".strip()

    suggest_next_steps = """
You will be given:
- state snapshot (phase/prompt/choices/error)
- redacted log tail

Suggest the next step(s) for the user.

Guidelines:
- If the wizard is waiting for a simple Y/n confirmation, prefer the default (ENTER) unless risky.
- If a numbered selection is required, recommend the safest default index when obvious.
- If you see an error, do not guess a fix that changes infrastructure; propose checks first.

Output format (markdown):
- **Suggested next input**
- **Why**
- **If that fails**
""".strip()

    suggest_autopilot = """
You will be given:
- state snapshot (phase/prompt/choices/error)
- redacted terminal tail

Return JSON:
{
  "action": "send_input|wait|stop",
  "input": "string (only if send_input)",
  "reason": "short",
  "risk": "low|medium|high"
}

Constraints:
- If you are not confident, choose action="wait" or "stop".
- Only propose "send_input" for wizard-style inputs:
  - empty string (ENTER)
  - "y" / "n"
  - a small integer like "1"
- NEVER propose shell commands.
- If an error is detected, choose action="stop" and explain.
""".strip()

    return PromptPack(
        system=system,
        analyze_status=analyze_status,
        extract_issues=extract_issues,
        summarize=summarize,
        suggest_next_steps=suggest_next_steps,
        suggest_autopilot=suggest_autopilot,
    )


# ---------------------------------------------------------------------------
# Backwards-compatible helpers (server.py expects build_system_prompt)
# ---------------------------------------------------------------------------

def build_system_prompt(
    *,
    product_name: str = "CloudDeploy",
    provider_name: str = "IBM Cloud",
    command_label: str = "deploy script",
    strict_read_only: bool = True,
) -> str:
    """
    Compatibility shim: older code imports build_system_prompt().
    Returns only the system prompt string.
    """
    return build_prompts(
        product_name=product_name,
        provider_name=provider_name,
        command_label=command_label,
        strict_read_only=strict_read_only,
    ).system


def build_prompt_pack(
    *,
    product_name: str = "CloudDeploy",
    provider_name: str = "IBM Cloud",
    command_label: str = "deploy script",
    strict_read_only: bool = True,
) -> PromptPack:
    """
    Convenience alias with a more explicit name.
    """
    return build_prompts(
        product_name=product_name,
        provider_name=provider_name,
        command_label=command_label,
        strict_read_only=strict_read_only,
    )


# ---------------------------------------------------------------------------
# Rendering helpers for user prompts (system prompt passed separately)
# ---------------------------------------------------------------------------

def render_status_prompt(
    *,
    state_snapshot_json: str,
    terminal_tail: str,
    product_name: str = "CloudDeploy",
    provider_name: str = "IBM Cloud",
) -> str:
    return f"""
[{product_name} / {provider_name}] STATUS INPUTS

STATE_SNAPSHOT_JSON:
{state_snapshot_json}

TERMINAL_TAIL (REDACTED):
{terminal_tail}
""".strip()


def render_issues_prompt(*, terminal_tail: str) -> str:
    return f"""
TERMINAL_TAIL (REDACTED):
{terminal_tail}
""".strip()


def render_summary_prompt(*, terminal_tail: str) -> str:
    return f"""
TERMINAL_TAIL (REDACTED):
{terminal_tail}
""".strip()


def render_next_steps_prompt(*, state_snapshot_json: str, terminal_tail: str) -> str:
    return f"""
STATE_SNAPSHOT_JSON:
{state_snapshot_json}

TERMINAL_TAIL (REDACTED):
{terminal_tail}
""".strip()


def render_autopilot_suggestion_prompt(*, state_snapshot_json: str, terminal_tail: str) -> str:
    return f"""
STATE_SNAPSHOT_JSON:
{state_snapshot_json}

TERMINAL_TAIL (REDACTED):
{terminal_tail}
""".strip()
