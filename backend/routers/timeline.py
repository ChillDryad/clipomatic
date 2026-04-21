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


@render_router.post("/clip")
async def render_clip_endpoint(req: RenderClipRequest, user: User = Depends(get_current_user)):
    """Render a clip to 9:16 vertical MP4 with subtitles. SSE: single done event."""
    from pipeline.renderer import render_clip, CropBox

    renders_dir = os.path.join(WORKSPACE, "renders")
    os.makedirs(renders_dir, exist_ok=True)

    video_path = req.video_path
    if video_path.startswith("/workspace/"):
        video_path = os.path.join(WORKSPACE, video_path.removeprefix("/workspace/"))

    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")

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
    from pipeline.renderer import render_timeline, CropBox

    renders_dir = os.path.join(WORKSPACE, "renders")
    os.makedirs(renders_dir, exist_ok=True)

    video_path = req.video_path
    if video_path.startswith("/workspace/"):
        video_path = os.path.join(WORKSPACE, video_path.removeprefix("/workspace/"))

    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")

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
            )
            rel = os.path.relpath(out_path, WORKSPACE)
            yield _sse_event({"done": True, "result": f"/workspace/{rel}"})
        except Exception as exc:
            logger.exception("Timeline render failed")
            yield _sse_event({"error": str(exc)})

    return _sse_response(generate())


# Get WORKSPACE from environment
WORKSPACE = os.environ.get(
    "WORKSPACE_DIR",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "workspace"),
)
