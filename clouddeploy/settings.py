# clouddeploy/settings.py
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Tuple

DEFAULT_PROVIDERS = ["openai", "claude", "watsonx", "ollama"]
_SECRET_FIELDS = {
    ("openai", "api_key"),
    ("claude", "api_key"),
    ("watsonx", "api_key"),
}

# Treat these as "masked placeholders" coming back from UI
_MASK_PATTERNS = [
    re.compile(r"^\*+$"),           # "********"
    re.compile(r"^[^*]*\*+[^*]*$"), # "abc***xyz" / "***" / "sk-***abc"
]


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


def _settings_path() -> Path:
    return _app_data_dir() / "settings.json"


def _env_default_settings() -> Dict[str, Any]:
    """
    Seed defaults from env vars when present.
    Backward compatible with env-based config.
    NOTE: env vars are used only as initial defaults; persisted settings live in settings.json.
    """
    provider = (os.getenv("GITPILOT_PROVIDER") or os.getenv("CLOUDDEPLOY_PROVIDER") or "watsonx").strip().lower()
    if provider not in DEFAULT_PROVIDERS:
        provider = "watsonx"

    return {
        "provider": provider,
        "providers": DEFAULT_PROVIDERS,
        "openai": {
            "api_key": os.getenv("OPENAI_API_KEY", ""),
            "model": os.getenv("GITPILOT_OPENAI_MODEL", "gpt-4o-mini"),
            "base_url": os.getenv("OPENAI_BASE_URL", ""),
        },
        "claude": {
            "api_key": os.getenv("ANTHROPIC_API_KEY", ""),
            "model": os.getenv("GITPILOT_CLAUDE_MODEL", "claude-sonnet-4-5"),
            "base_url": os.getenv("ANTHROPIC_BASE_URL", ""),
        },
        "watsonx": {
            "api_key": os.getenv("WATSONX_API_KEY", ""),
            "project_id": os.getenv("WATSONX_PROJECT_ID", ""),
            "model_id": os.getenv("GITPILOT_WATSONX_MODEL", "ibm/granite-3-8b-instruct"),
            "base_url": os.getenv("WATSONX_BASE_URL", "https://us-south.ml.cloud.ibm.com"),
        },
        "ollama": {
            "base_url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
            "model": os.getenv("GITPILOT_OLLAMA_MODEL", "llama3"),
        },
        # incremented on every write; UI can reload ws/ai if desired
        "version": 1,
    }


def _deep_merge(base: Dict[str, Any], patch: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base)
    for k, v in (patch or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _looks_masked_secret(value: Any) -> bool:
    """
    Returns True when a value looks like a UI placeholder/masked secret:
    - "********"
    - "abc***xyz"
    - "***"
    """
    if value is None:
        return False
    s = str(value).strip()
    if not s:
        return False
    if "*" not in s:
        return False
    return any(p.match(s) for p in _MASK_PATTERNS)


def _strip_masked_secrets(patch: Dict[str, Any], current: Dict[str, Any]) -> Dict[str, Any]:
    """
    Prevent the "SAVE destroys real keys" bug.

    UI should never receive real secrets; it receives masked placeholders.
    If UI sends those placeholders back, we must IGNORE them and keep the stored secret.
    Also ignore empty strings for secret fields (meaning "unchanged").
    """
    if not isinstance(patch, dict):
        return patch

    cleaned = json.loads(json.dumps(patch))  # deep copy
    for (section, field) in _SECRET_FIELDS:
        sec_patch = cleaned.get(section)
        if not isinstance(sec_patch, dict):
            continue

        incoming = sec_patch.get(field, None)
        if incoming is None:
            continue

        incoming_str = str(incoming).strip()
        if incoming_str == "" or _looks_masked_secret(incoming_str):
            # Drop the field so merge keeps existing stored secret
            sec_patch.pop(field, None)

        # If section becomes empty, remove it too (optional cleanliness)
        if isinstance(sec_patch, dict) and len(sec_patch) == 0:
            cleaned.pop(section, None)

    return cleaned


def _mask_secret(s: str) -> str:
    """
    For display-only in UI (never reversible).
    """
    s = (s or "").strip()
    if not s:
        return ""
    # Keep it short + consistent (don't leak length precisely)
    # Using fixed mask length is better than reflecting real length.
    return "********"


def redact_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    """
    Safe to return to UI. Masks API keys.
    IMPORTANT: never return plaintext secrets.
    """
    s = json.loads(json.dumps(settings))  # deep copy
    try:
        if "openai" in s and isinstance(s["openai"], dict):
            s["openai"]["api_key"] = _mask_secret(s["openai"].get("api_key", ""))
        if "claude" in s and isinstance(s["claude"], dict):
            s["claude"]["api_key"] = _mask_secret(s["claude"].get("api_key", ""))
        if "watsonx" in s and isinstance(s["watsonx"], dict):
            s["watsonx"]["api_key"] = _mask_secret(s["watsonx"].get("api_key", ""))
    except Exception:
        # never fail API because of redaction
        pass
    return s


def validate_settings(settings: Dict[str, Any]) -> Tuple[bool, str]:
    provider = (settings.get("provider") or "").strip().lower()
    if provider not in DEFAULT_PROVIDERS:
        return False, f"Invalid provider: {provider}"

    # Basic shape checks (not forcing keys to be present, but ensure types)
    for p in DEFAULT_PROVIDERS:
        if p not in settings or not isinstance(settings.get(p), dict):
            return False, f"Missing provider section: {p}"

    # Ensure providers list is sane
    providers = settings.get("providers")
    if providers is not None and not isinstance(providers, list):
        return False, "providers must be a list"

    return True, ""


@dataclass
class SettingsStore:
    path: Path

    def ensure_parent(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> Dict[str, Any]:
        self.ensure_parent()
        if not self.path.exists():
            defaults = _env_default_settings()
            self.save(defaults)
            return defaults

        try:
            data = json.loads(self.path.read_text("utf-8"))
        except Exception:
            # If file corrupted, re-seed to prevent broken UX
            data = _env_default_settings()
            self.save(data)
            return data

        # Merge with defaults to support new fields over time
        merged = _deep_merge(_env_default_settings(), data)
        ok, _err = validate_settings(merged)
        if not ok:
            merged = _env_default_settings()
            self.save(merged)
        return merged

    def save(self, settings: Dict[str, Any]) -> Dict[str, Any]:
        self.ensure_parent()

        # bump version
        try:
            settings["version"] = int(settings.get("version") or 0) + 1
        except Exception:
            settings["version"] = 1

        ok, err = validate_settings(settings)
        if not ok:
            raise ValueError(err)

        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(settings, indent=2, ensure_ascii=False), "utf-8")
        tmp.replace(self.path)
        return settings

    def update(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        """
        Merge patch into current settings.

        CRITICAL: prevents masked secrets ("********" / "abc***xyz") from overwriting real keys.
        """
        current = self.load()
        patch = _strip_masked_secrets(patch or {}, current)
        merged = _deep_merge(current, patch)
        return self.save(merged)


def get_store() -> SettingsStore:
    return SettingsStore(path=_settings_path())


def list_models_best_effort(provider: str) -> List[str]:
    """
    Best-effort model discovery endpoint.
    In v1 we keep this intentionally conservative and stable.

    You can later replace this with real provider API calls.
    """
    p = (provider or "").strip().lower()
    if p == "openai":
        return ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"]
    if p == "claude":
        return ["claude-sonnet-4-5", "claude-3.7-sonnet", "claude-3-opus-20240229"]
    if p == "watsonx":
        return ["ibm/granite-3-8b-instruct", "ibm/granite-13b-chat-v2", "meta-llama/llama-3-3-70b-instruct"]
    if p == "ollama":
        return ["llama3", "mistral", "codellama", "phi3"]
    return []
