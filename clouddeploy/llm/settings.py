# clouddeploy/llm/settings.py
from __future__ import annotations

import enum
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Mapping

from dotenv import load_dotenv
from pydantic import BaseModel, Field

# Load .env file if it exists (from project root or current directory)
load_dotenv()

DEFAULT_PROVIDERS: List[str] = ["openai", "claude", "watsonx", "ollama"]


def _app_data_dir() -> Path:
    """
    Production default:
    - Respect CLOUDDEPLOY_DATA_DIR when set
    - Otherwise: ~/.clouddeploy
    """
    base = os.getenv("CLOUDDEPLOY_DATA_DIR", "").strip()
    if base:
        return Path(base).expanduser().resolve()
    return (Path.home() / ".clouddeploy").resolve()


CONFIG_DIR = _app_data_dir()
CONFIG_FILE = CONFIG_DIR / "settings.json"


class LLMProvider(str, enum.Enum):
    openai = "openai"
    claude = "claude"
    watsonx = "watsonx"
    ollama = "ollama"


class OpenAIConfig(BaseModel):
    api_key: str = Field(default="")
    model: str = Field(default="gpt-4o-mini")
    base_url: str = Field(default="")  # Optional: Azure OpenAI / proxy


class ClaudeConfig(BaseModel):
    api_key: str = Field(default="")
    model: str = Field(default="claude-sonnet-4-5")
    base_url: str = Field(default="")  # Optional proxy


class WatsonxConfig(BaseModel):
    api_key: str = Field(default="")
    project_id: str = Field(default="")
    model_id: str = Field(default="ibm/granite-3-8b-instruct")
    base_url: str = Field(default="https://us-south.ml.cloud.ibm.com")


class OllamaConfig(BaseModel):
    base_url: str = Field(default="http://localhost:11434")
    model: str = Field(default="llama3")


class AppSettings(BaseModel):
    """
    This is the canonical settings object used by build_llm(settings=...).

    NOTE:
    - Stored on disk at ~/.clouddeploy/settings.json (or CLOUDDEPLOY_DATA_DIR)
    - Environment variables can override loaded settings for backward compatibility
    """
    provider: LLMProvider = Field(default=LLMProvider.watsonx)
    providers: List[str] = Field(default_factory=lambda: list(DEFAULT_PROVIDERS))

    openai: OpenAIConfig = Field(default_factory=OpenAIConfig)
    claude: ClaudeConfig = Field(default_factory=ClaudeConfig)
    watsonx: WatsonxConfig = Field(default_factory=WatsonxConfig)
    ollama: OllamaConfig = Field(default_factory=OllamaConfig)

    # monotonically increases on each save; UI can use it to decide to reload websockets
    version: int = Field(default=1)

    @classmethod
    def default_from_env(cls) -> "AppSettings":
        """
        Seed defaults from environment variables when present.
        Keeps backward compatibility with env-only deployments.
        """
        provider = (os.getenv("CLOUDDEPLOY_PROVIDER") or os.getenv("GITPILOT_PROVIDER") or "watsonx").strip().lower()
        if provider not in DEFAULT_PROVIDERS:
            provider = "watsonx"

        return cls(
            provider=LLMProvider(provider),
            providers=list(DEFAULT_PROVIDERS),
            openai=OpenAIConfig(
                api_key=os.getenv("OPENAI_API_KEY", ""),
                model=os.getenv("GITPILOT_OPENAI_MODEL", "gpt-4o-mini"),
                base_url=os.getenv("OPENAI_BASE_URL", ""),
            ),
            claude=ClaudeConfig(
                api_key=os.getenv("ANTHROPIC_API_KEY", ""),
                model=os.getenv("GITPILOT_CLAUDE_MODEL", "claude-sonnet-4-5"),
                base_url=os.getenv("ANTHROPIC_BASE_URL", ""),
            ),
            watsonx=WatsonxConfig(
                api_key=os.getenv("WATSONX_API_KEY", ""),
                project_id=os.getenv("WATSONX_PROJECT_ID", ""),
                model_id=os.getenv("GITPILOT_WATSONX_MODEL", "ibm/granite-3-8b-instruct"),
                base_url=os.getenv("WATSONX_BASE_URL", "https://us-south.ml.cloud.ibm.com"),
            ),
            ollama=OllamaConfig(
                base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
                model=os.getenv("GITPILOT_OLLAMA_MODEL", "llama3"),
            ),
        )

    @classmethod
    def from_disk(cls) -> "AppSettings":
        """
        Load settings from disk and merge with defaults + env overrides.

        Rules:
        - Start with defaults from env
        - If disk exists, merge disk onto defaults (disk wins for persisted values)
        - Then apply explicit env overrides for credential backward-compatibility
        """
        base = cls.default_from_env()

        if CONFIG_FILE.exists():
            try:
                data = json.loads(CONFIG_FILE.read_text("utf-8"))
                loaded = cls.model_validate(data)
                # Merge loaded onto base (loaded wins)
                merged = _deep_merge(base.model_dump(), loaded.model_dump())
                base = cls.model_validate(merged)
            except Exception:
                # corrupted settings file -> re-seed from env defaults to keep UI working
                base = cls.default_from_env()
                base.save()

        # Apply strong env overrides (env wins)
        env_provider = (os.getenv("CLOUDDEPLOY_PROVIDER") or os.getenv("GITPILOT_PROVIDER") or "").strip().lower()
        if env_provider in DEFAULT_PROVIDERS:
            base.provider = LLMProvider(env_provider)

        # Provider env overrides
        if os.getenv("OPENAI_API_KEY"):
            base.openai.api_key = os.getenv("OPENAI_API_KEY", "")
        if os.getenv("GITPILOT_OPENAI_MODEL"):
            base.openai.model = os.getenv("GITPILOT_OPENAI_MODEL", base.openai.model)
        if os.getenv("OPENAI_BASE_URL"):
            base.openai.base_url = os.getenv("OPENAI_BASE_URL", base.openai.base_url)

        if os.getenv("ANTHROPIC_API_KEY"):
            base.claude.api_key = os.getenv("ANTHROPIC_API_KEY", "")
        if os.getenv("GITPILOT_CLAUDE_MODEL"):
            base.claude.model = os.getenv("GITPILOT_CLAUDE_MODEL", base.claude.model)
        if os.getenv("ANTHROPIC_BASE_URL"):
            base.claude.base_url = os.getenv("ANTHROPIC_BASE_URL", base.claude.base_url)

        if os.getenv("WATSONX_API_KEY"):
            base.watsonx.api_key = os.getenv("WATSONX_API_KEY", "")
        if os.getenv("WATSONX_PROJECT_ID"):
            base.watsonx.project_id = os.getenv("WATSONX_PROJECT_ID", base.watsonx.project_id)
        if os.getenv("GITPILOT_WATSONX_MODEL"):
            base.watsonx.model_id = os.getenv("GITPILOT_WATSONX_MODEL", base.watsonx.model_id)
        if os.getenv("WATSONX_BASE_URL"):
            base.watsonx.base_url = os.getenv("WATSONX_BASE_URL", base.watsonx.base_url)

        if os.getenv("OLLAMA_BASE_URL"):
            base.ollama.base_url = os.getenv("OLLAMA_BASE_URL", base.ollama.base_url)
        if os.getenv("GITPILOT_OLLAMA_MODEL"):
            base.ollama.model = os.getenv("GITPILOT_OLLAMA_MODEL", base.ollama.model)

        return base

    def save(self) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)

        # bump version
        try:
            self.version = int(self.version or 0) + 1
        except Exception:
            self.version = 1

        tmp = CONFIG_FILE.with_suffix(".tmp")
        tmp.write_text(self.model_dump_json(indent=2), "utf-8")
        tmp.replace(CONFIG_FILE)

    def to_public_dict(self) -> Dict[str, Any]:
        """
        Safe to return to UI: masks secrets but keeps shape.
        """
        d = self.model_dump()
        d["openai"]["api_key"] = _mask_secret(d["openai"].get("api_key", ""))
        d["claude"]["api_key"] = _mask_secret(d["claude"].get("api_key", ""))
        d["watsonx"]["api_key"] = _mask_secret(d["watsonx"].get("api_key", ""))
        return d


def _mask_secret(s: str) -> str:
    s = (s or "").strip()
    if not s:
        return ""
    if len(s) <= 6:
        return "***"
    return f"{s[:3]}***{s[-3:]}"


def _deep_merge(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base)
    for k, v in (patch or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


_settings: AppSettings = AppSettings.from_disk()


def get_settings() -> AppSettings:
    return _settings


def set_provider(provider: LLMProvider) -> AppSettings:
    global _settings
    _settings.provider = provider
    _settings.save()
    return _settings


def update_settings(updates: Dict[str, Any] | Mapping[str, Any]) -> AppSettings:
    """
    Update settings with partial or full configuration.

    Example partial payloads:
      {"provider": "openai"}
      {"openai": {"api_key": "...", "model": "gpt-4o-mini"}}
      {"watsonx": {"project_id": "..."}}

    Implementation detail:
    - We deep-merge onto the existing settings dict, then re-validate with Pydantic.
    """
    global _settings
    patch = dict(updates or {})

    current = _settings.model_dump()
    merged = _deep_merge(current, patch)

    # Validate provider string safely
    prov = (merged.get("provider") or "").strip().lower()
    if prov:
        merged["provider"] = prov

    # Ensure providers list exists and is sane
    if not isinstance(merged.get("providers"), list) or not merged["providers"]:
        merged["providers"] = list(DEFAULT_PROVIDERS)

    _settings = AppSettings.model_validate(merged)
    _settings.save()
    return _settings
