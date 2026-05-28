"""
Momiji Clipper — Clips router.

Endpoints:
- GET /api/clips/{clip_key} — Get single clip
- PATCH /api/clips/{clip_key} — Update clip metadata
- POST /api/clips/{clip_key}/regenerate-metadata — Regenerate clip metadata
- POST /api/clips/{clip_key}/generate-post-description — Generate post description
- POST /api/clips/{clip_key}/suggest-sfx — Suggest SFX placements for a clip
"""

import os
import json
import uuid
from fastapi import APIRouter, Depends, HTTPException

from db import User, get_session_cm
from auth import get_current_user
from utils.helpers import _clips_cache_path, _parse_clip_key, _regenerate_clip_metadata, _generate_post_description
from pydantic import BaseModel

WORKSPACE = os.environ.get(
    "WORKSPACE_DIR",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "workspace"),
)

router = APIRouter(prefix="/api/clips", tags=["Clips"])


class ClipPatchRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    hashtags: list[str] | None = None
    brand_alignment: list[str] | None = None
    start: float | None = None
    end: float | None = None
    crop_avatar: dict | None = None
    crop_game: dict | None = None


class RegenerateMetadataRequest(BaseModel):
    clip: dict
    transcript: dict


class GeneratePostDescriptionRequest(BaseModel):
    clip: dict
    transcript: dict


class SuggestSfxRequest(BaseModel):
    clip: dict
    audio_energy: list[dict] | None = None
    zoom_effect: dict | None = None


@router.patch("/{clip_key}")
async def patch_clip(clip_key: str, req: ClipPatchRequest):
    """Partially update a clip's metadata in the cached clips JSON file."""
    source_path, index = _parse_clip_key(clip_key)
    cache_path = _clips_cache_path(source_path)

    if not os.path.exists(cache_path):
        raise HTTPException(status_code=404, detail="Clip cache file not found.")

    with open(cache_path, "r", encoding="utf-8") as f:
        clips = json.load(f)

    if not isinstance(clips, list) or index < 0 or index >= len(clips):
        raise HTTPException(status_code=404, detail=f"Clip index {index} out of range.")

    patch = req.model_dump(exclude_none=True)
    for key, value in patch.items():
        clips[index][key] = value
    if req.crop_avatar:
        clips[index]["crop_avatar"] = req.crop_avatar
    if req.crop_game:
        clips[index]["crop_game"] = req.crop_game

    # Write atomically
    tmp = cache_path + f".{uuid.uuid4().hex[:8]}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(clips, f, ensure_ascii=False, indent=2)
    os.replace(tmp, cache_path)

    return clips[index]


@router.get("/{clip_key}")
async def get_clip(clip_key: str, user: User = Depends(get_current_user)):
    """Return a single clip from the cache by clip_key."""
    source_path, index = _parse_clip_key(clip_key)
    cache_path = _clips_cache_path(source_path)

    if not os.path.exists(cache_path):
        raise HTTPException(status_code=404, detail="Clip cache file not found.")

    with open(cache_path, "r", encoding="utf-8") as f:
        clips = json.load(f)

    if not isinstance(clips, list) or index < 0 or index >= len(clips):
        raise HTTPException(status_code=404, detail=f"Clip index {index} out of range.")

    return clips[index]


@router.post("/{clip_key}/regenerate-metadata")
async def regenerate_clip_metadata_endpoint(clip_key: str, req: RegenerateMetadataRequest, user: User = Depends(get_current_user)):
    """Regenerate title and hashtags for a clip using the LLM."""
    source_path, index = _parse_clip_key(clip_key)
    cache_path = _clips_cache_path(source_path)

    if not os.path.exists(cache_path):
        raise HTTPException(status_code=404, detail="Clip cache file not found.")

    with open(cache_path, "r", encoding="utf-8") as f:
        clips = json.load(f)

    if not isinstance(clips, list) or index < 0 or index >= len(clips):
        raise HTTPException(status_code=404, detail=f"Clip index {index} out of range.")

    clip = clips[index]
    updated = await _regenerate_clip_metadata(req.clip, req.transcript)
    clips[index] = updated

    # Write atomically
    tmp = cache_path + f".{uuid.uuid4().hex[:8]}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(clips, f, ensure_ascii=False, indent=2)
    os.replace(tmp, cache_path)

    return updated


@router.post("/{clip_key}/generate-post-description")
async def generate_post_description_endpoint(clip_key: str, req: GeneratePostDescriptionRequest, user: User = Depends(get_current_user)):
    """Generate a social media post description based on the clip transcript."""
    source_path, index = _parse_clip_key(clip_key)
    cache_path = _clips_cache_path(source_path)

    if not os.path.exists(cache_path):
        raise HTTPException(status_code=404, detail="Clip cache file not found.")

    with open(cache_path, "r", encoding="utf-8") as f:
        clips = json.load(f)

    if not isinstance(clips, list) or index < 0 or index >= len(clips):
        raise HTTPException(status_code=404, detail=f"Clip index {index} out of range.")

    post_body = await _generate_post_description(req.clip, req.transcript)

    return {"post_body": post_body}


@router.post("/{clip_key}/suggest-sfx")
async def suggest_sfx_endpoint(clip_key: str, req: SuggestSfxRequest, user: User = Depends(get_current_user)):
    """Suggest SFX placements based on clip metadata, audio energy, and zoom settings."""
    from pipeline.sfx import suggest_sfx_placements, list_available_sfx
    from pipeline.renderer import ZoomEffect

    available = list_available_sfx(WORKSPACE)
    zoom = None
    if req.zoom_effect:
        zoom = ZoomEffect(**req.zoom_effect)

    placements = suggest_sfx_placements(
        clip=req.clip,
        audio_energy=req.audio_energy,
        zoom_effect=zoom,
    )

    return {
        "available_sfx": available,
        "suggestions": [
            {"sfx_name": sp.sfx_name, "time": sp.time, "volume": sp.volume,
             "fade_in": sp.fade_in, "fade_out": sp.fade_out}
            for sp in placements
        ],
    }
