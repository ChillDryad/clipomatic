"""First-run setup, persistent provider config, and model discovery."""

from __future__ import annotations

import asyncio
import os
import re
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from auth import (
    create_access_token,
    create_refresh_token,
    get_current_user,
    get_current_user_or_api_key,
    hash_password,
    validate_password_strength,
)
from config_store import (
    encrypt_secret,
    load_config,
    provider_config,
    public_config,
    save_config,
    setup_complete,
)
from db import InstallationState, User, get_session_cm
from utils.helpers import _set_auth_cookies, _user_dict

router = APIRouter(prefix="/api", tags=["Configuration"])

_PROVIDER_DEFAULTS = {
    "ollama": ("http://ollama:11434/v1", "gemma3:latest", "gemma4:12b"),
    "openai": ("https://api.openai.com/v1", "gpt-4o-mini", "gpt-4o-mini"),
    "codex": ("http://codex:8090/v1", "default", "default"),
}


class ProviderSettings(BaseModel):
    provider: Literal["ollama", "openai", "codex"] = "ollama"
    base_url: str = ""
    api_key: str | None = Field(default=None, min_length=1)
    llm_model: str = ""
    highlight_model: str = ""
    vision_model: str = ""


class SetupRequest(ProviderSettings):
    email: str
    password: str
    display_name: str | None = None


class ConfigUpdate(ProviderSettings):
    # All values optional during settings edits; absent secret preserves current.
    provider: Literal["ollama", "openai", "codex"] | None = None
    base_url: str | None = None
    llm_model: str | None = None
    highlight_model: str | None = None
    vision_model: str | None = None


def _validate_provider(settings: ProviderSettings) -> dict[str, str]:
    default_url, default_model, default_highlight = _PROVIDER_DEFAULTS.get(
        settings.provider, ("", "", "")
    )
    base_url = (settings.base_url or default_url).rstrip("/")
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Provider URL must be a complete http(s) URL")

    host = parsed.hostname.lower()
    local_ollama_hosts = {"ollama", "ollama-shared", "localhost", "127.0.0.1", "host.docker.internal"}
    if settings.provider == "ollama" and host not in local_ollama_hosts:
        raise HTTPException(status_code=400, detail="Ollama must use a local Ollama endpoint")
    if settings.provider == "codex":
        codex_url = os.environ.get("CODEX_BRIDGE_URL", "http://codex:8090").rstrip("/") + "/v1"
        if base_url != codex_url:
            raise HTTPException(status_code=400, detail="Codex must use the internal Codex bridge")
    if settings.provider == "openai":
        if parsed.scheme != "https" or host != "api.openai.com":
            raise HTTPException(status_code=400, detail="OpenAI must use https://api.openai.com/v1")
        if not settings.api_key:
            raise HTTPException(status_code=400, detail="An OpenAI API key is required")
    return {
        "provider": settings.provider,
        "base_url": base_url,
        "llm_model": settings.llm_model or default_model,
        "highlight_model": settings.highlight_model or default_highlight or settings.llm_model,
        "vision_model": settings.vision_model or settings.llm_model or default_model,
    }


async def _list_models(base_url: str, api_key: str) -> list[str]:
    from openai import OpenAI

    try:
        client = OpenAI(api_key=api_key or "ollama", base_url=base_url)
        models = await asyncio.to_thread(lambda: client.models.list())
        return sorted(model.id for model in models.data)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Provider connection failed: {exc}") from exc


@router.get("/setup/status")
async def get_setup_status():
    """Return whether this installation already has an owner/configuration."""
    if setup_complete():
        return {"setup_complete": True}
    async with get_session_cm() as session:
        user_count = await session.scalar(select(func.count()).select_from(User))
    # Existing installs predate setup.json; do not lock their users into a wizard.
    return {"setup_complete": bool(user_count)}


async def _codex_status() -> dict:
    import httpx

    bridge_url = os.environ.get("CODEX_BRIDGE_URL", "http://codex:8090").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{bridge_url}/health")
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="Codex bridge is unavailable") from exc


@router.get("/setup/codex/status")
async def get_setup_codex_status():
    """Expose official Codex login status without exposing credentials."""
    status = await _codex_status()
    return {
        "authenticated": bool(status.get("authenticated")),
        "models": status.get("models", []),
        "login_command": os.environ.get(
            "CODEX_LOGIN_COMMAND", "docker exec -it clipomatic-codex codex login --device-auth"
        ),
    }


@router.get("/setup/ollama-models")
async def get_setup_ollama_models():
    """List locally installed models for the first-run Ollama dropdowns."""
    base_url = (
        os.environ.get("OLLAMA_SETUP_URL")
        or os.environ.get("LLM_BASE_URL")
        or "http://ollama:11434/v1"
    )
    return {"models": await _list_models(base_url, "ollama")}


@router.post("/setup/test-provider")
async def test_provider(settings: ProviderSettings):
    """Validate provider credentials and return visible model IDs without saving."""
    normalized = _validate_provider(settings)
    return {"models": await _list_models(normalized["base_url"], settings.api_key or "")}


@router.post("/setup")
async def setup_installation(request: SetupRequest, response: Response):
    """Create the first owner and persist encrypted provider configuration once."""
    if not re.match(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$", request.email):
        raise HTTPException(status_code=400, detail="Invalid email format")
    valid, reason = validate_password_strength(request.password)
    if not valid:
        raise HTTPException(status_code=400, detail=reason)
    if request.provider not in {"ollama", "codex"}:
        raise HTTPException(status_code=400, detail="First-run setup supports local Ollama or Codex subscription access")
    if request.provider == "codex":
        status = await _codex_status()
        if not status.get("authenticated"):
            raise HTTPException(status_code=400, detail="Connect ChatGPT in the Codex container before completing setup")
    normalized = _validate_provider(request)

    async with get_session_cm() as session:
        # Existing installs predate the singleton row; do not create a second
        # owner when they visit the new setup API after upgrade.
        if await session.get(InstallationState, "setup") or await session.scalar(select(func.count()).select_from(User)):
            raise HTTPException(status_code=409, detail="Setup has already been completed")
        owner = User(
            email=request.email,
            password_hash=hash_password(request.password),
            display_name=request.display_name or request.email.split("@", 1)[0],
            is_verified=True,
        )
        session.add(owner)
        await session.flush()
        session.add(InstallationState(id="setup", owner_id=owner.id))
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise HTTPException(status_code=409, detail="Setup has already been completed") from None
        await session.refresh(owner)

    config = {
        "setup_complete": True,
        **normalized,
    }
    if request.api_key:
        config["api_key_encrypted"] = encrypt_secret(request.api_key)
    save_config(config)

    _set_auth_cookies(
        response,
        create_access_token(owner.id, owner.email),
        create_refresh_token(owner.id),
    )
    return {"setup_complete": True, "user": _user_dict(owner)}


@router.get("/config")
async def get_config():
    """Return persistent provider settings; never return API credentials."""
    return public_config()


@router.post("/config")
async def update_config(update: ConfigUpdate, user: User = Depends(get_current_user)):
    """Update provider settings. Omit api_key to preserve the stored credential."""
    current = load_config()
    merged = ProviderSettings(
        provider=update.provider or current.get("provider", "ollama"),
        base_url=update.base_url if update.base_url is not None else current.get("base_url", ""),
        api_key=update.api_key,
        llm_model=update.llm_model if update.llm_model is not None else current.get("llm_model", ""),
        highlight_model=update.highlight_model if update.highlight_model is not None else current.get("highlight_model", ""),
        vision_model=update.vision_model if update.vision_model is not None else current.get("vision_model", ""),
    )
    config = {"setup_complete": True, **_validate_provider(merged)}
    if update.api_key:
        config["api_key_encrypted"] = encrypt_secret(update.api_key)
    elif current.get("api_key_encrypted"):
        config["api_key_encrypted"] = current["api_key_encrypted"]
    save_config(config)
    return {**public_config(), "success": True}


@router.get("/models")
async def get_models(user: User = Depends(get_current_user_or_api_key)):
    """List models using the saved provider configuration."""
    settings = provider_config()
    if not settings["base_url"]:
        raise HTTPException(status_code=409, detail="Complete initial setup before listing models")
    return {"models": await _list_models(settings["base_url"], settings["api_key"])}
