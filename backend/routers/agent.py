"""
Momiji Clipper — Agent discovery and identity router.

Endpoints:
- GET /api/agent/info — Returns the authenticated agent's identity, scopes, and capabilities
"""

import json
import logging

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user_or_api_key
from db import ApiKey, User, get_session
from routers.api_keys import AVAILABLE_SCOPES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agent", tags=["Agent"])


@router.get("/info")
async def agent_info(
    request: Request,
    user: User = Depends(get_current_user_or_api_key),
    db: AsyncSession = Depends(get_session),
):
    """Return the authenticated agent's identity, scopes, and available capabilities.

    Works with both API key (Bearer mc_live_...) and JWT cookie auth.
    When authenticated via API key, includes the key's label and scopes.
    """
    auth_header = request.headers.get("authorization", "")
    key_label = None
    key_scopes = None
    key_prefix = None

    if auth_header.startswith("Bearer mc_live_"):
        raw_key = auth_header.removeprefix("Bearer ").strip()
        key_prefix = raw_key[:12]
        from sqlalchemy import select
        result = await db.execute(
            select(ApiKey).where(
                ApiKey.key_prefix == key_prefix,
                ApiKey.is_active == True,  # noqa: E712
            )
        )
        candidates = result.scalars().all()
        from auth import verify_password
        for c in candidates:
            if verify_password(raw_key, c.key_hash):
                key_label = c.label
                key_scopes = json.loads(c.scopes) if c.scopes else None
                key_prefix = c.key_prefix
                break

    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "is_verified": user.is_verified,
        },
        "auth_method": "api_key" if key_prefix else "jwt",
        "key": {
            "label": key_label,
            "prefix": key_prefix,
            "scopes": key_scopes if key_scopes is not None else "all",
        } if key_prefix else None,
        "available_scopes": AVAILABLE_SCOPES,
        "capabilities": {
            "ingest": "Download or upload videos for processing",
            "transcribe": "Run Whisper transcription",
            "highlights": "Run LLM-based highlight detection",
            "pipeline": "Enqueue and monitor pipeline jobs",
            "clips": "View and modify clip metadata",
            "projects": "View and modify video projects",
            "render": "Render clips with subtitles (legacy vertical mode)",
            "clip-studio": "Batch process videos for source quality clip extraction",
            "api-keys": "Manage and rotate API keys",
            "agent": "Inspect agent identity and capabilities",
        },
    }