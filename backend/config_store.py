"""Persistent, encrypted application setup configuration.

The workspace volume is the installation boundary. First boot generates a
Fernet key under ``.secrets`` and stores provider credentials encrypted in the
same persistent volume. Environment variables remain migration defaults only.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

WORKSPACE = Path(os.environ.get("WORKSPACE_DIR", "/app/workspace"))
SECRETS_DIR = WORKSPACE / ".secrets"
FERNET_KEY_PATH = SECRETS_DIR / "fernet.key"
CONFIG_PATH = WORKSPACE / ".app_config.json"


def _ensure_fernet() -> Fernet:
    """Load or atomically create the workspace-persistent Fernet key."""
    SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(SECRETS_DIR, 0o700)
    except OSError:
        pass

    if FERNET_KEY_PATH.exists():
        key = FERNET_KEY_PATH.read_bytes().strip()
    else:
        # Legacy env input is migrated into the persistent volume once, so
        # removing it from Portainer later does not invalidate stored secrets.
        key = os.environ.get("OAUTH_ENCRYPTION_KEY", "").encode() or Fernet.generate_key()
        try:
            fd = os.open(FERNET_KEY_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(key + b"\n")
        except FileExistsError:
            key = FERNET_KEY_PATH.read_bytes().strip()
    try:
        os.chmod(FERNET_KEY_PATH, 0o600)
    except OSError:
        pass
    return Fernet(key)


def encrypt_secret(value: str) -> str:
    return _ensure_fernet().encrypt(value.encode()).decode()


def decrypt_secret(value: str) -> str:
    try:
        return _ensure_fernet().decrypt(value.encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError("Stored provider credential cannot be decrypted") from exc


def load_config() -> dict[str, Any]:
    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_config(config: dict[str, Any]) -> None:
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".app_config.", dir=WORKSPACE)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(config, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.chmod(tmp_name, 0o600)
        os.replace(tmp_name, CONFIG_PATH)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def setup_complete() -> bool:
    return bool(load_config().get("setup_complete"))


def public_config() -> dict[str, Any]:
    config = load_config()
    return {
        "setup_complete": bool(config.get("setup_complete")),
        "provider": config.get("provider", "ollama"),
        "base_url": config.get("base_url", os.environ.get("LLM_BASE_URL", "")),
        "llm_model": config.get("llm_model", os.environ.get("LLM_MODEL", "")),
        "highlight_model": config.get("highlight_model", os.environ.get("HIGHLIGHT_LLM_MODEL", "")),
        "vision_model": config.get("vision_model", os.environ.get("VISION_MODEL", "")),
        "has_api_key": bool(config.get("api_key_encrypted")),
    }


def provider_config() -> dict[str, str]:
    """Resolve saved provider settings for API workers without exposing secrets."""
    config = load_config()
    if not config.get("setup_complete"):
        return {
            "base_url": os.environ.get("LLM_BASE_URL", ""),
            "api_key": os.environ.get("LLM_API_KEY", ""),
            "llm_model": os.environ.get("LLM_MODEL", ""),
            "highlight_model": os.environ.get("HIGHLIGHT_LLM_MODEL", ""),
            "vision_model": os.environ.get("VISION_MODEL", ""),
            "provider": "environment",
        }
    api_key = decrypt_secret(config["api_key_encrypted"]) if config.get("api_key_encrypted") else ""
    if config.get("provider") == "ollama" and not api_key:
        api_key = "ollama"
    return {
        "base_url": config.get("base_url", ""),
        "api_key": api_key,
        "llm_model": config.get("llm_model", ""),
        "highlight_model": config.get("highlight_model", ""),
        "vision_model": config.get("vision_model", ""),
        "provider": config.get("provider", "custom"),
    }
