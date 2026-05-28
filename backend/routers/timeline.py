"""
Momiji Clipper — Timeline and Render router.

Endpoints:
- POST /api/timeline/batch — Execute batch timeline operations
- POST /api/render/clip — Render a single clip with subtitles
- POST /api/render/segment — Render a custom time segment
- POST /api/render/timeline — Render full timeline with all tracks
"""

import asyncio
import os
import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException

from db import User
from auth import get_current_user
from pipeline import ingestion
from utils.helpers import _validate_workspace_path
from utils.sse import _sse_event, _sse_response, _sse_stream
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/timeline", tags=["Timeline"])


class TimelineBatchOperation(BaseModel):
    """A single batch operation."""
    operation: str
    track_id: str | None = None
    segment_id: str | None = None
    data: dict | None = None


class BatchEditRequest(BaseModel):
    """Batch edit request for multiple timeline operations."""
    operations: list[TimelineBatchOperation]
    video_path: str


class BatchEditResponse(BaseModel):
    success: bool
    message: str | None = None
    error: str | None = None


@router.post("/batch")
async def batch_edit(req: BatchEditRequest):
    """
    Execute multiple timeline operations atomically.
    Operations are validated but not persisted server-side.
    """
    errors = []
    for i, op in enumerate(req.operations):
        if op.operation not in (
            "add_segment", "remove_segment", "move_segment",
            "trim_segment", "add_track", "remove_track"
        ):
            errors.append(f"Operation {i}: unknown operation '{op.operation}'")
        if op.operation in ("add_segment", "move_segment", "trim_segment") and not op.data:
            errors.append(f"Operation {i}: '{op.operation}' requires data")

    if errors:
        raise HTTPException(status_code=400, detail={"errors": errors})

    video_path = req.video_path
    if video_path.startswith("/workspace/"):
        video_path = os.path.join(WORKSPACE, video_path.removeprefix("/workspace/"))

    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Video file not found")

    return BatchEditResponse(
        success=True,
        message=f"Successfully validated {len(req.operations)} operations",
    )


# ---------------------------------------------------------------------------
# Render endpoints (shared prefix /api/render)
# ---------------------------------------------------------------------------

render_router = APIRouter(prefix="/api/render", tags=["Rendering"])


class RenderClipRequest(BaseModel):
    """Request for rendering a clip."""
    video_path: str
    clip: dict
    crop_avatar: dict | None = None
    crop_game: dict | None = None
    segments: list[dict]
    font_name: str | None = None
    font_color: str | None = None
    highlight_color: str | None = None
    outline_color: str | None = None
    outline_width: int | None = None
    shadow_color: str | None = None
    shadow_depth: int | None = None
    shadow_opacity: float | None = None
    font_size: int | None = None
    subtitle_fade_in_ms: int | None = None
    subtitle_fade_out_ms: int | None = None
    caption_style: str | None = None
    words_per_line: int | None = None
    quality_preset: str | None = None
    layout_mode: str = "stacked"
    animation_speed: str | None = None
    style_preset: str | None = None
    thumbnail_path: str | None = None
    zoom_effect: dict | None = None  # {"start_scale": 1.5, "end_scale": 1.0, "zoom_duration": 1.0, "easing": "ease_out"}
    sfx_placements: list[dict] | None = None  # [{"sfx_name": "whoosh.wav", "time": 0.0, "volume": 0.7}]


class RenderSegmentRequest(BaseModel):
    """Request for rendering a segment."""
    url: str
    start: float
    end: float


class RenderTimelineRequest(BaseModel):
    """Request for rendering full timeline."""
    video_path: str
    start: float
    end: float
    segments: list[dict]
    crop_avatar: dict | None = None
    crop_game: dict | None = None
    overlays: list[dict] | None = None
    audio_tracks: list[dict] | None = None
    markers: list[dict] | None = None
    zoom_effect: dict | None = None  # {"start_scale": 1.5, "end_scale": 1.0, "zoom_duration": 1.0, "easing": "ease_out"}
    sfx_placements: list[dict] | None = None  # [{"sfx_name": "whoosh.wav", "time": 0.0, "volume": 0.7}]


@render_router.post("/clip")
async def render_clip_endpoint(req: RenderClipRequest, user: User = Depends(get_current_user)):
    """Render a clip to 9:16 vertical MP4 with subtitles. SSE: single done event."""
    from pipeline.renderer import render_clip, CropBox, ZoomEffect

    renders_dir = os.path.join(WORKSPACE, "renders")
    os.makedirs(renders_dir, exist_ok=True)

    video_path = req.video_path
    if video_path.startswith("/workspace/"):
        video_path = os.path.join(WORKSPACE, video_path.removeprefix("/workspace/"))

    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")

    zoom = ZoomEffect(**req.zoom_effect) if req.zoom_effect else None

    # Auto-suggest SFX when zoom is set but no SFX placements provided
    sfx = req.sfx_placements
    if sfx is None and zoom is not None:
        from pipeline.sfx import suggest_sfx_placements, list_available_sfx
        available = list_available_sfx(WORKSPACE)
        if available:
            sfx_dicts = suggest_sfx_placements(
                clip=req.clip,
                audio_energy=None,
                zoom_effect=zoom,
            )
            sfx = [{"sfx_name": sp.sfx_name, "time": sp.time, "volume": sp.volume} for sp in sfx_dicts]

    async def generate():
        yield _sse_event({"progress": 0.1, "label": "Running FFmpeg…"})
        try:
            out_path = await asyncio.to_thread(
                render_clip,
                video_path=video_path,
                clip=req.clip,
                crop_avatar=CropBox(**req.crop_avatar) if req.crop_avatar else None,
                crop_game=CropBox(**req.crop_game) if req.crop_game else None,
                segments=req.segments,
                output_dir=renders_dir,
                font_name=req.font_name,
                font_color=req.font_color,
                highlight_color=req.highlight_color,
                outline_color=req.outline_color,
                outline_width=req.outline_width,
                shadow_color=req.shadow_color,
                shadow_depth=req.shadow_depth,
                shadow_opacity=req.shadow_opacity,
                font_size=req.font_size,
                subtitle_fade_in_ms=req.subtitle_fade_in_ms,
                subtitle_fade_out_ms=req.subtitle_fade_out_ms,
                caption_style=req.caption_style,
                words_per_line=req.words_per_line,
                quality_preset=req.quality_preset,
                layout_mode=req.layout_mode,
                animation_speed=req.animation_speed,
                style_preset=req.style_preset,
                thumbnail_path=req.thumbnail_path,
                zoom_effect=zoom,
                sfx_placements=sfx,
                workspace_dir=WORKSPACE,
            )
            rel = os.path.relpath(out_path, WORKSPACE)
            yield _sse_event({"done": True, "result": f"/workspace/{rel}"})
        except Exception as exc:
            logger.exception("Render failed")
            yield _sse_event({"error": str(exc)})

    return _sse_response(generate())


@render_router.post("/segment")
async def render_segment_endpoint(req: RenderSegmentRequest, user: User = Depends(get_current_user)):
    """Download a specific time segment of a VOD with SSE progress."""
    renders_dir = os.path.join(WORKSPACE, "renders")
    return _sse_response(
        _sse_stream(ingestion.download_segment, req.url, req.start, req.end, renders_dir)
    )


@render_router.post("/timeline")
async def render_timeline_endpoint(req: RenderTimelineRequest, user: User = Depends(get_current_user)):
    """Render full timeline with all tracks, overlays, and effects."""
    from pipeline.renderer import render_timeline, CropBox, ZoomEffect

    renders_dir = os.path.join(WORKSPACE, "renders")
    os.makedirs(renders_dir, exist_ok=True)

    video_path = req.video_path
    if video_path.startswith("/workspace/"):
        video_path = os.path.join(WORKSPACE, video_path.removeprefix("/workspace/"))

    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")

    zoom = ZoomEffect(**req.zoom_effect) if req.zoom_effect else None

    async def generate():
        yield _sse_event({"progress": 0.1, "label": "Running FFmpeg…"})
        try:
            out_path = await asyncio.to_thread(
                render_timeline,
                video_path=video_path,
                start=req.start,
                end=req.end,
                segments=req.segments,
                crop_avatar=CropBox(**req.crop_avatar) if req.crop_avatar else None,
                crop_game=CropBox(**req.crop_game) if req.crop_game else None,
                overlays=req.overlays,
                audio_tracks=req.audio_tracks,
                markers=req.markers,
                output_dir=renders_dir,
                zoom_effect=zoom,
            )
            rel = os.path.relpath(out_path, WORKSPACE)
            yield _sse_event({"done": True, "result": f"/workspace/{rel}"})
        except Exception as exc:
            logger.exception("Timeline render failed")
            yield _sse_event({"error": str(exc)})

    return _sse_response(generate())


@render_router.post("/preview")
async def render_preview_endpoint(req: RenderClipRequest, user: User = Depends(get_current_user)):
    """Render a low-res preview of a clip. Identical layout to final render, half resolution, fast encode.

    SSE: single done event. Cached: identical params return cached preview instantly.
    """
    from pipeline.renderer import render_clip, CropBox, ZoomEffect
    import hashlib
    import json
    import shutil

    preview_dir = os.path.join(WORKSPACE, "previews")
    os.makedirs(preview_dir, exist_ok=True)

    video_path = req.video_path
    if video_path.startswith("/workspace/"):
        video_path = os.path.join(WORKSPACE, video_path.removeprefix("/workspace/"))

    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")

    # Generate deterministic cache key from render parameters
    cache_key = hashlib.md5(
        json.dumps({
            "video_path": video_path,
            "clip": req.clip,
            "crop_avatar": req.crop_avatar,
            "crop_game": req.crop_game,
            "layout_mode": req.layout_mode,
            "font_name": req.font_name,
            "font_size": req.font_size,
            "caption_style": req.caption_style,
            "words_per_line": req.words_per_line,
            "thumbnail_path": req.thumbnail_path,
            "zoom_effect": req.zoom_effect,
        }, sort_keys=True, default=str).encode()
    ).hexdigest()[:16]

    preview_path = os.path.join(preview_dir, f"preview_{cache_key}.mp4")

    # Check cache
    if os.path.exists(preview_path):
        rel = os.path.relpath(preview_path, WORKSPACE)
        async def cached_gen():
            yield _sse_event({"progress": 1.0, "label": "Cached preview"})
            yield _sse_event({"done": True, "result": f"/workspace/{rel}"})
        return _sse_response(cached_gen())

    zoom = ZoomEffect(**req.zoom_effect) if req.zoom_effect else None

    async def generate():
        yield _sse_event({"progress": 0.1, "label": "Generating preview…"})
        try:
            out_path = await asyncio.to_thread(
                render_clip,
                video_path=video_path,
                clip=req.clip,
                crop_avatar=CropBox(**req.crop_avatar) if req.crop_avatar else None,
                crop_game=CropBox(**req.crop_game) if req.crop_game else None,
                segments=req.segments,
                output_dir=preview_dir,
                font_name=req.font_name,
                font_color=req.font_color,
                highlight_color=req.highlight_color,
                outline_color=req.outline_color,
                outline_width=req.outline_width,
                shadow_color=req.shadow_color,
                shadow_depth=req.shadow_depth,
                shadow_opacity=req.shadow_opacity,
                font_size=int((req.font_size or 50) * 0.5),
                subtitle_fade_in_ms=req.subtitle_fade_in_ms,
                subtitle_fade_out_ms=req.subtitle_fade_out_ms,
                caption_style=req.caption_style,
                words_per_line=req.words_per_line,
                quality_preset="fast",
                layout_mode=req.layout_mode,
                animation_speed=req.animation_speed,
                output_width=540,
                output_height=960,
                thumbnail_path=req.thumbnail_path,
                zoom_effect=zoom,
            )
            # Rename to cache key for next cache hit
            cached = os.path.join(preview_dir, f"preview_{cache_key}.mp4")
            if os.path.exists(out_path) and out_path != cached:
                shutil.move(out_path, cached)

            rel = os.path.relpath(cached, WORKSPACE)
            yield _sse_event({"done": True, "result": f"/workspace/{rel}"})
        except Exception as exc:
            logger.exception("Preview render failed")
            yield _sse_event({"error": str(exc)})

    return _sse_response(generate())


# Get WORKSPACE from environment
WORKSPACE = os.environ.get(
    "WORKSPACE_DIR",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "workspace"),
)
