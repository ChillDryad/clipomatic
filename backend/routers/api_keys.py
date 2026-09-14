"""
Momiji Clipper — API Key management router.

Endpoints:
- POST /api/api-keys — Generate a new API key (returns plaintext once)
- GET /api/api-keys — List active API keys for current user
- DELETE /api/api-keys/{key_id} — Revoke (deactivate) an API key
"""

import json
import logging
import os
import secrets
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from auth import get_current_user, hash_password, verify_password
from db import ApiKey, User, get_session
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/api-keys", tags=["API Keys"])

# Key format: mc_live_<32 hex chars> = 40 char total
_KEY_PREFIX = "mc_live_"
_KEY_RANDOM_BYTES = 24  # 24 bytes -> 48 hex chars

# Available scopes for API keys
AVAILABLE_SCOPES = [
    "ingest",          # download/upload videos
    "transcribe",      # run transcription
    "highlights",      # run highlight detection
    "pipeline",        # enqueue/monitor pipeline jobs
    "clips",           # view/modify clip metadata
    "projects",        # view/modify projects
    "render",          # render clips/timeline
    "clip-studio",     # batch process videos for source quality clip finding
]


class CreateKeyRequest(BaseModel):
    label: str
    scopes: list[str] | None = None  # None = all scopes
    expires_at: float | None = None  # Unix timestamp, None = no expiry


class CreateKeyResponse(BaseModel):
    key: str  # full plaintext key — only returned once
    id: str
    label: str
    key_prefix: str
    scopes: list[str] | None
    expires_at: float | None
    created_at: float


class KeyInfo(BaseModel):
    id: str
    label: str
    key_prefix: str
    scopes: list[str] | None
    is_active: bool
    last_used_at: float | None
    expires_at: float | None
    created_at: float


@router.post("", response_model=CreateKeyResponse)
async def create_api_key(
    req: CreateKeyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Generate a new API key. The full key is returned only this one time."""
    if not req.label or not req.label.strip():
        raise HTTPException(status_code=400, detail="Label is required")
    label = req.label.strip()[:100]

    # Validate scopes if provided
    if req.scopes:
        invalid = [s for s in req.scopes if s not in AVAILABLE_SCOPES]
        if invalid:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid scopes: {invalid}. Available: {AVAILABLE_SCOPES}",
            )

    # Generate the key
    random_part = secrets.token_hex(_KEY_RANDOM_BYTES)
    plaintext_key = f"{_KEY_PREFIX}{random_part}"
    key_prefix = plaintext_key[:12]  # for display: "mc_live_abcd"

    # Hash it with bcrypt
    key_hash = hash_password(plaintext_key)

    # Validate expiry
    if req.expires_at and req.expires_at < time.time():
        raise HTTPException(status_code=400, detail="Expiry must be in the future")

    api_key = ApiKey(
        id=uuid.uuid4().hex,
        user_id=user.id,
        key_hash=key_hash,
        label=label,
        key_prefix=key_prefix,
        scopes=json.dumps(req.scopes) if req.scopes else None,
        expires_at=req.expires_at,
    )
    db.add(api_key)
    await db.commit()

    logger.info("API key created: label=%s prefix=%s user=%s", label, key_prefix, user.id)

    return CreateKeyResponse(
        key=plaintext_key,
        id=api_key.id,
        label=label,
        key_prefix=key_prefix,
        scopes=req.scopes,
        expires_at=req.expires_at,
        created_at=api_key.created_at,
    )


@router.get("", response_model=list[KeyInfo])
async def list_api_keys(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """List all API keys (active and revoked) for the current user."""
    result = await db.execute(
        select(ApiKey)
        .where(ApiKey.user_id == user.id)
        .order_by(ApiKey.created_at.desc())
    )
    keys = result.scalars().all()

    return [
        KeyInfo(
            id=k.id,
            label=k.label,
            key_prefix=k.key_prefix,
            scopes=json.loads(k.scopes) if k.scopes else None,
            is_active=k.is_active,
            last_used_at=k.last_used_at,
            expires_at=k.expires_at,
            created_at=k.created_at,
        )
        for k in keys
    ]


@router.delete("/{key_id}")
async def revoke_api_key(
    key_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Revoke an API key by setting is_active=False. Does not delete the record."""
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.user_id == user.id,
        )
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")

    key.is_active = False
    await db.commit()

    logger.info("API key revoked: label=%s prefix=%s user=%s", key.label, key.key_prefix, user.id)
    return {"status": "revoked", "id": key_id}


@router.get("/scopes")
async def list_scopes(user: User = Depends(get_current_user)):
    """Return the list of available scopes for API keys."""
    return {"scopes": AVAILABLE_SCOPES}