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


def _normalize_openai_base_url(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        return "https://api.openai.com/v1"
    base = raw.rstrip("/")
    if not base.endswith("/v1"):
        base = f"{base}/v1"
    return base


def build_llm(settings: Optional[dict] = None) -> LLM:
    """
    Return an initialized CrewAI LLM using the active provider.
    """
    cfg = _coerce_settings(settings)
    provider = cfg.provider

    # -------------------------
    # OpenAI (WORKING VERSION)
    # - do NOT send max_tokens (some models need max_completion_tokens)
    # - do NOT send temperature (some models only allow default=1)
    # -------------------------
    if provider == LLMProvider.openai:
        api_key = (cfg.openai.api_key or os.getenv("OPENAI_API_KEY", "")).strip()
        model = (cfg.openai.model or os.getenv("GITPILOT_OPENAI_MODEL", "gpt-4o-mini")).strip()

        raw_base_url = (cfg.openai.base_url or os.getenv("OPENAI_BASE_URL", "")).strip()
        base_url = _normalize_openai_base_url(raw_base_url)

        if not api_key:
            raise ValueError("OpenAI API key is required. Configure it in Settings or set OPENAI_API_KEY.")

        # Ensure downstream libs see env vars
        os.environ["OPENAI_API_KEY"] = api_key
        os.environ["OPENAI_BASE_URL"] = base_url

        return LLM(
            model=model,
            api_key=api_key,
            base_url=base_url,
        )

    # -------------------------
    # Claude (Anthropic)
    # -------------------------
    if provider == LLMProvider.claude:
        api_key = (cfg.claude.api_key or os.getenv("ANTHROPIC_API_KEY", "")).strip()
        model = (cfg.claude.model or os.getenv("GITPILOT_CLAUDE_MODEL", "claude-sonnet-4-5")).strip()
        base_url = (cfg.claude.base_url or os.getenv("ANTHROPIC_BASE_URL", "")).strip()

        if not api_key:
            raise ValueError("Claude API key is required. Configure it in Settings or set ANTHROPIC_API_KEY.")

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
            temperature=0.2,
            max_tokens=4096,
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
            raise ValueError("watsonx API key is required. Configure it in Settings or set WATSONX_API_KEY.")
        if not project_id:
            raise ValueError("watsonx project ID is required. Configure it in Settings or set WATSONX_PROJECT_ID.")

        os.environ["WATSONX_PROJECT_ID"] = project_id
        os.environ["WATSONX_URL"] = base_url

        model = _ensure_prefix(model_id, "watsonx/")

        return LLM(
            model=model,
            api_key=api_key,
            base_url=base_url,
            project_id=project_id,
            temperature=0.2,
            max_tokens=1024,
        )

    # -------------------------
    # Ollama (WORKING VERSION)
    # - keep the 'ollama/' prefix so LiteLLM routes correctly
    # - keep temperature/max_tokens mapping (your previous working behavior)
    # -------------------------
    if provider == LLMProvider.ollama:
        model = (cfg.ollama.model or os.getenv("GITPILOT_OLLAMA_MODEL", "llama3")).strip()
        base_url = (cfg.ollama.base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")).strip()

        # Safely access the new settings (defaults are safe if Pydantic model isn't updated yet)
        temp = getattr(cfg.ollama, "temperature", 0.1)
        # Map 'num_predict' (Ollama term) to 'max_tokens' (CrewAI term)
        max_tokens = getattr(cfg.ollama, "num_predict", 1024)

        if not base_url:
            raise ValueError("Ollama base URL is required. Configure it in Settings or set OLLAMA_BASE_URL.")

        # Ensure downstream libs see it
        os.environ["OLLAMA_BASE_URL"] = base_url

        # IMPORTANT: prefix selects the correct backend in many CrewAI/LiteLLM setups
        model = _ensure_prefix(model, "ollama/")

        return LLM(
            model=model,
            base_url=base_url,
            temperature=temp,
            max_tokens=max_tokens,
        )

    raise ValueError(f"Unsupported provider: {provider}")
