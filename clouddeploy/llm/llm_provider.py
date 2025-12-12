# clouddeploy/llm/llm_provider.py
from __future__ import annotations

import os
from typing import Any, Mapping, Optional

from crewai import LLM

from .settings import AppSettings, LLMProvider, get_settings


def _coerce_settings(settings: Any | None) -> AppSettings:
    """
    Accept:
      - None (load from get_settings())
      - AppSettings
      - dict-like (validated into AppSettings)
    """
    if settings is None:
        return get_settings()
    if isinstance(settings, AppSettings):
        return settings
    if isinstance(settings, Mapping):
        return AppSettings.model_validate(dict(settings))
    raise TypeError("build_llm(settings=...) must be None, AppSettings, or a dict-like object")


def _ensure_prefix(model: str, prefix: str) -> str:
    model = (model or "").strip()
    if not model:
        return model
    return model if model.startswith(prefix) else f"{prefix}{model}"


def build_llm(settings: Optional[dict] = None) -> LLM:
    """
    Return an initialized CrewAI LLM using the active provider.

    IMPORTANT:
    - settings can be passed from server-side runtime settings (UI-controlled),
      otherwise we fall back to get_settings() (disk+env merged).
    - We still allow env vars as fallback for missing credentials for backwards compatibility.
    """
    cfg = _coerce_settings(settings)
    provider = cfg.provider

    # -------------------------
    # OpenAI
    # -------------------------
    if provider == LLMProvider.openai:
        api_key = (cfg.openai.api_key or os.getenv("OPENAI_API_KEY", "")).strip()
        model = (cfg.openai.model or os.getenv("GITPILOT_OPENAI_MODEL", "gpt-4o-mini")).strip()
        base_url = (cfg.openai.base_url or os.getenv("OPENAI_BASE_URL", "")).strip()

        if not api_key:
            raise ValueError(
                "OpenAI API key is required. Configure it in Settings or set OPENAI_API_KEY."
            )

        model = _ensure_prefix(model, "openai/")

        return LLM(
            model=model,
            api_key=api_key,
            base_url=base_url or None,
        )

    # -------------------------
    # Claude (Anthropic)
    # -------------------------
    if provider == LLMProvider.claude:
        api_key = (cfg.claude.api_key or os.getenv("ANTHROPIC_API_KEY", "")).strip()
        model = (cfg.claude.model or os.getenv("GITPILOT_CLAUDE_MODEL", "claude-sonnet-4-5")).strip()
        base_url = (cfg.claude.base_url or os.getenv("ANTHROPIC_BASE_URL", "")).strip()

        if not api_key:
            raise ValueError(
                "Claude API key is required. Configure it in Settings or set ANTHROPIC_API_KEY."
            )

        # CrewAI's Anthropic provider commonly reads env vars internally
        os.environ["ANTHROPIC_API_KEY"] = api_key
        if base_url:
            os.environ["ANTHROPIC_BASE_URL"] = base_url
        else:
            os.environ.pop("ANTHROPIC_BASE_URL", None)

        model = _ensure_prefix(model, "anthropic/")

        return LLM(
            model=model,
            api_key=api_key,
            base_url=base_url or None,
        )

    # -------------------------
    # IBM watsonx.ai
    # -------------------------
    if provider == LLMProvider.watsonx:
        api_key = (cfg.watsonx.api_key or os.getenv("WATSONX_API_KEY", "")).strip()
        project_id = (cfg.watsonx.project_id or os.getenv("WATSONX_PROJECT_ID", "")).strip()
        model_id = (cfg.watsonx.model_id or os.getenv("GITPILOT_WATSONX_MODEL", "ibm/granite-3-8b-instruct")).strip()
        base_url = (cfg.watsonx.base_url or os.getenv("WATSONX_BASE_URL", "https://us-south.ml.cloud.ibm.com")).strip()

        if not api_key:
            raise ValueError(
                "watsonx API key is required. Configure it in Settings or set WATSONX_API_KEY."
            )
        if not project_id:
            raise ValueError(
                "watsonx project ID is required. Configure it in Settings or set WATSONX_PROJECT_ID."
            )

        # Some integrations rely on these environment variables
        os.environ["WATSONX_PROJECT_ID"] = project_id
        os.environ["WATSONX_URL"] = base_url  # best-effort compatibility alias

        model = _ensure_prefix(model_id, "watsonx/")

        # NOTE: CrewAI's LLM signature may vary by version. This matches your existing usage.
        return LLM(
            model=model,
            api_key=api_key,
            base_url=base_url,
            project_id=project_id,
            temperature=0.3,
            max_tokens=1024,
        )

    # -------------------------
    # Ollama (local)
    # -------------------------
    if provider == LLMProvider.ollama:
        model = (cfg.ollama.model or os.getenv("GITPILOT_OLLAMA_MODEL", "llama3")).strip()
        base_url = (cfg.ollama.base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")).strip()

        if not base_url:
            raise ValueError(
                "Ollama base URL is required. Configure it in Settings or set OLLAMA_BASE_URL."
            )

        model = _ensure_prefix(model, "ollama/")

        return LLM(
            model=model,
            base_url=base_url,
        )

    raise ValueError(f"Unsupported provider: {provider}")
