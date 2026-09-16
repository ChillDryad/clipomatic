"""
Momiji Clipper — API Key management router.

Endpoints:
- POST /api/api-keys — Generate a new API key (returns plaintext once)
- GET /api/api-keys — List active API keys for current user
- DELETE /api/api-keys/{key_id} — Revoke (deactivate) an API key
"""

import hashlib
import json
import logging
import os
import secrets
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from auth import get_current_user, get_current_user_or_api_key, hash_password, verify_password
from db import ApiKey, DeviceCodePairing, User, get_session
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
    "api-keys",        # manage and rotate API keys without scope escalation
    "agent",           # inspect the authenticated agent identity/capabilities
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


class DeviceCodeStartRequest(BaseModel):
    label: str
    scopes: list[str]


class DeviceCodeStartResponse(BaseModel):
    device_code: str
    user_code: str
    verification_uri: str
    expires_at: float
    interval: int = 5


class DeviceCodeApproveRequest(BaseModel):
    user_code: str
    scopes: list[str]


class DeviceCodeExchangeRequest(BaseModel):
    device_code: str


def _pairing_code_hash(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _validate_explicit_scopes(scopes: list[str]) -> list[str]:
    normalized = list(dict.fromkeys(scopes))
    if not normalized:
        raise HTTPException(status_code=400, detail="At least one scope is required")
    invalid = [scope for scope in normalized if scope not in AVAILABLE_SCOPES]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid scopes: {invalid}")
    return normalized


@router.post("/device-code", response_model=DeviceCodeStartResponse)
async def start_device_code(
    req: DeviceCodeStartRequest,
    db: AsyncSession = Depends(get_session),
):
    """Start an unauthenticated, short-lived agent device pairing flow."""
    label = req.label.strip()[:100]
    if not label:
        raise HTTPException(status_code=400, detail="Label is required")
    scopes = _validate_explicit_scopes(req.scopes)
    device_code = secrets.token_urlsafe(32)
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    compact_user_code = "".join(secrets.choice(alphabet) for _ in range(8))
    user_code = f"{compact_user_code[:4]}-{compact_user_code[4:]}"
    expires_at = time.time() + 600
    db.add(DeviceCodePairing(
        device_code_hash=_pairing_code_hash(device_code),
        user_code_hash=_pairing_code_hash(compact_user_code),
        label=label,
        requested_scopes=json.dumps(scopes),
        expires_at=expires_at,
    ))
    await db.commit()
    return DeviceCodeStartResponse(
        device_code=device_code,
        user_code=user_code,
        verification_uri="/settings/api-keys",
        expires_at=expires_at,
    )


@router.post("/device-code/approve")
async def approve_device_code(
    req: DeviceCodeApproveRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Approve a pending device code from an authenticated browser session."""
    normalized_user_code = req.user_code.replace("-", "").strip().upper()
    result = await db.execute(select(DeviceCodePairing).where(
        DeviceCodePairing.user_code_hash == _pairing_code_hash(normalized_user_code)
    ))
    pairing = result.scalar_one_or_none()
    if not pairing or pairing.expires_at <= time.time():
        raise HTTPException(status_code=400, detail="Invalid or expired user code")
    if pairing.approved_at or pairing.consumed_at:
        raise HTTPException(status_code=409, detail="Device code has already been used")
    approved_scopes = _validate_explicit_scopes(req.scopes)
    requested_scopes = set(json.loads(pairing.requested_scopes))
    if not set(approved_scopes).issubset(requested_scopes):
        raise HTTPException(status_code=400, detail="Approved scopes exceed requested scopes")
    pairing.user_id = user.id
    pairing.approved_scopes = json.dumps(approved_scopes)
    pairing.approved_at = time.time()
    await db.commit()
    return {"status": "approved", "scopes": approved_scopes}


@router.post("/device-code/exchange", response_model=CreateKeyResponse)
async def exchange_device_code(
    req: DeviceCodeExchangeRequest,
    db: AsyncSession = Depends(get_session),
):
    """Exchange an approved device code exactly once for a new API key."""
    result = await db.execute(select(DeviceCodePairing).where(
        DeviceCodePairing.device_code_hash == _pairing_code_hash(req.device_code)
    ))
    pairing = result.scalar_one_or_none()
    if not pairing or pairing.expires_at <= time.time():
        raise HTTPException(status_code=400, detail="Invalid or expired device code")
    if pairing.consumed_at:
        raise HTTPException(status_code=409, detail="Device code has already been exchanged")
    if not pairing.approved_at or not pairing.user_id or not pairing.approved_scopes:
        raise HTTPException(status_code=428, detail="Authorization pending")

    plaintext_key = f"{_KEY_PREFIX}{secrets.token_hex(_KEY_RANDOM_BYTES)}"
    scopes = json.loads(pairing.approved_scopes)
    api_key = ApiKey(
        user_id=pairing.user_id,
        key_hash=hash_password(plaintext_key),
        label=pairing.label,
        key_prefix=plaintext_key[:12],
        scopes=json.dumps(scopes),
    )
    db.add(api_key)
    pairing.consumed_at = time.time()
    await db.commit()
    await db.refresh(api_key)
    return CreateKeyResponse(
        key=plaintext_key,
        id=api_key.id,
        label=api_key.label,
        key_prefix=api_key.key_prefix,
        scopes=scopes,
        expires_at=api_key.expires_at,
        created_at=api_key.created_at,
    )


@router.post("", response_model=CreateKeyResponse)
async def create_api_key(
    req: CreateKeyRequest,
    user: User = Depends(get_current_user_or_api_key),
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
    user: User = Depends(get_current_user_or_api_key),
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
    user: User = Depends(get_current_user_or_api_key),
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
async def list_scopes(user: User = Depends(get_current_user_or_api_key)):
    """Return the list of available scopes for API keys."""
    return {"scopes": AVAILABLE_SCOPES}


class RotateKeyResponse(BaseModel):
    key: str
    id: str
    label: str
    key_prefix: str
    scopes: list[str] | None
    expires_at: float | None
    created_at: float


@router.post("/{key_id}/rotate", response_model=RotateKeyResponse)
async def rotate_api_key(
    key_id: str,
    user: User = Depends(get_current_user_or_api_key),
    db: AsyncSession = Depends(get_session),
):
    """Rotate an API key: generate a new secret, keep same scopes/label/expiry.

    The caller must either own the key OR have the 'api-keys' scope.
    The old key_hash is replaced — the old plaintext stops working immediately.
    Scopes cannot be escalated through rotation.
    """
    result = await db.execute(
        select(ApiKey).where(
            ApiKey.id == key_id,
            ApiKey.user_id == user.id,
            ApiKey.is_active == True,  # noqa: E712
        )
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(status_code=404, detail="API key not found")

    random_part = secrets.token_hex(_KEY_RANDOM_BYTES)
    plaintext_key = f"{_KEY_PREFIX}{random_part}"
    key.key_hash = hash_password(plaintext_key)
    key.key_prefix = plaintext_key[:12]
    await db.commit()

    logger.info("API key rotated: label=%s prefix=%s user=%s", key.label, key.key_prefix, user.id)
    return RotateKeyResponse(
        key=plaintext_key,
        id=key.id,
        label=key.label,
        key_prefix=key.key_prefix,
        scopes=json.loads(key.scopes) if key.scopes else None,
        expires_at=key.expires_at,
        created_at=key.created_at,
    )