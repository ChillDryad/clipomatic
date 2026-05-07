"""
Momiji Clipper — Config and models router.

Endpoints:
- GET /api/config — Environment configuration
- POST /api/config — Update user preferences
- GET /api/models — Available LLM models
"""

import asyncio
import json
import os
import subprocess
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from db import User
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["Configuration"])

# Path to user preferences file (stored in workspace)
_PREFERENCES_FILE = os.path.join(
    os.environ.get("WORKSPACE_DIR", os.path.join(os.path.dirname(__file__), "workspace")),
    ".user_preferences.json"
)


def _load_user_preferences() -> dict:
    """Load user preferences from file, or return empty dict if not found."""
    try:
        with open(_PREFERENCES_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_user_preferences(prefs: dict) -> None:
    """Save user preferences to file."""
    with open(_PREFERENCES_FILE, "w") as f:
        json.dump(prefs, f, indent=2)


@router.get("/config")
async def get_config():
    """Return environment configuration exposed to frontend."""
    # Check if FFmpeg has h264_nvenc encoder available
    nvenc_available = False
    try:
        result = subprocess.run(
            ["ffmpeg", "-encoders"],
            capture_output=True, text=True,
        )
        nvenc_available = "h264_nvenc" in result.stdout
    except FileNotFoundError:
        nvenc_available = False

    # Load user preferences (overrides environment defaults)
    user_prefs = _load_user_preferences()

    return {
        "llm_base_url": user_prefs.get("llm_base_url") or os.environ.get("LLM_BASE_URL", ""),
        "llm_model": user_prefs.get("llm_model") or os.environ.get("LLM_MODEL", ""),
        "whisper_model": user_prefs.get("whisper_model") or os.environ.get("WHISPER_MODEL", "base"),
        "whisper_device": user_prefs.get("whisper_device") or os.environ.get("WHISPER_DEVICE", "auto"),
        "nvenc_available": nvenc_available,
    }


class ConfigUpdate(BaseModel):
    """Request body for updating user preferences."""
    llm_model: str | None = None
    llm_base_url: str | None = None
    whisper_model: str | None = None
    whisper_device: str | None = None


@router.post("/config")
async def update_config(
    update: ConfigUpdate,
    user: User = Depends(get_current_user),
):
    """
    Update user preferences for LLM and Whisper configuration.

    These preferences override environment variables for this user.
    """
    prefs = _load_user_preferences()

    if update.llm_model is not None:
        prefs["llm_model"] = update.llm_model
    if update.llm_base_url is not None:
        prefs["llm_base_url"] = update.llm_base_url
    if update.whisper_model is not None:
        prefs["whisper_model"] = update.whisper_model
    if update.whisper_device is not None:
        prefs["whisper_device"] = update.whisper_device

    _save_user_preferences(prefs)

    return {**prefs, "success": True}


@router.get("/models")
async def get_models(
    base_url: str = Query(default=""),
    api_key: str = Query(default=""),
):
    """
    List available models from the LLM provider.

    Args:
        base_url: LLM API base URL (overrides env var)
        api_key: LLM API key (overrides env var)

    Returns:
        Dict with list of model IDs
    """
    _base_url = base_url or os.environ.get("LLM_BASE_URL", "")
    _api_key = api_key or os.environ.get("LLM_API_KEY", "")
    if not _base_url or not _api_key:
        raise HTTPException(status_code=400, detail="base_url and api_key required.")
    try:
        from openai import OpenAI
        client = OpenAI(api_key=_api_key, base_url=_base_url)
        models = await asyncio.to_thread(lambda: client.models.list())
        return {"models": sorted(m.id for m in models.data)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
