from __future__ import annotations


def system_prompt() -> str:
    """System-level instruction for diagram generation."""
    return (
        "You are CloudDeploy Diagram Copilot. "
        "When asked, you produce cloud architecture diagrams as Mermaid code. "
        "Prefer Mermaid architecture-beta diagrams for AWS/cloud. "
        "Return ONLY valid JSON using the schema provided by the caller."
    )


def generate_prompt(user_prompt: str, cloud: str = "aws") -> str:
    return (
        f"Generate a {cloud} cloud architecture diagram.\n\n"
        "Requirements:\n"
        "- Output Mermaid code using architecture-beta.\n"
        "- Keep it readable and reasonably sized.\n\n"
        f"USER_PROMPT:\n{user_prompt}\n"
    )


def edit_prompt(user_prompt: str, prior_code: str, cloud: str = "aws") -> str:
    return (
        f"Update the existing {cloud} Mermaid diagram per the request.\n\n"
        "Rules:\n"
        "- Keep the same Mermaid diagram type (architecture-beta).\n"
        "- Return the full updated Mermaid code (not a diff).\n\n"
        f"CURRENT_DIAGRAM_CODE:\n{prior_code}\n\n"
        f"EDIT_REQUEST:\n{user_prompt}\n"
    )
