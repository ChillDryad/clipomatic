"""
Momiji Clipper — Config and models router.

Endpoints:
- GET /api/config — Environment configuration
- GET /api/models — Available LLM models
"""

import asyncio
import os
from fastapi import APIRouter, Depends, HTTPException, Query

from db import User
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["Configuration"])


@router.get("/config")
async def get_config():
    """Return environment configuration exposed to frontend."""
    return {
        "llm_base_url": os.environ.get("LLM_BASE_URL", ""),
        "llm_model": os.environ.get("LLM_MODEL", ""),
        "whisper_model": os.environ.get("WHISPER_MODEL", "large-v3"),
        "whisper_device": os.environ.get("WHISPER_DEVICE", "auto"),
    }


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
