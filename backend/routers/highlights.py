"""
Momiji Clipper — Highlight detection router.

Endpoints:
- POST /api/highlights — Detect viral clips with SSE progress
- GET /api/highlights/cached — Get cached clips
"""

import os
import json
import logging
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query

from db import User, VideoProject, GeneratedClip, get_session_cm
from auth import get_current_user
from pipeline import highlight_detection
from utils.sse import _sse_response, _sse_stream
from utils.helpers import _clips_cache_path, _update_project_status
from pydantic import BaseModel
from sqlalchemy import select

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/highlights", tags=["Highlight Detection"])


class HighlightsRequest(BaseModel):
    transcript: dict
    model: str
    source_path: str | None = None
    project_id: str | None = None


@router.post("")
async def highlights(req: HighlightsRequest):
    """Detect viral clip candidates using the configured LLM. SSE: progress events + final done."""
    api_key = os.environ.get("LLM_API_KEY", "")
    base_url = os.environ.get("LLM_BASE_URL", "")
    if not api_key or not base_url:
        raise HTTPException(status_code=500, detail="LLM_API_KEY and LLM_BASE_URL must be set.")

    async def _generate():
        completed = False
        detected_clips = []
        # Timeout per chunk: 2 minutes (120s) for Gemma4, adjust based on hardware
        timeout_per_chunk = float(os.environ.get("HIGHLIGHT_TIMEOUT_PER_CHUNK", "120"))
        # Fallback model when primary times out (smaller = faster)
        fallback_model = os.environ.get("HIGHLIGHT_FALLBACK_MODEL", "phi3:mini")
        async for event_str in _sse_stream(
            highlight_detection.detect_highlights,
            transcript=req.transcript,
            api_key=api_key,
            base_url=base_url,
            model=req.model,
            timeout_per_chunk=timeout_per_chunk,
            fallback_model=fallback_model,
        ):
            yield event_str
            # When done, persist the clips to disk and database
            try:
                raw = event_str.removeprefix("data: ").strip()
                event = json.loads(raw) if raw.startswith("{") else {}
                if event.get("done") and req.source_path and event.get("result") is not None:
                    detected_clips = event["result"]
                    # Write to cache file
                    cache_path = _clips_cache_path(req.source_path)
                    with open(cache_path, "w", encoding="utf-8") as f:
                        json.dump(detected_clips, f, ensure_ascii=False, indent=2)
                    completed = True
            except Exception as exc:
                logger.warning("Failed to write clips cache: %s", exc)

        # Update project status and write clips to database on completion
        if req.project_id and completed:
            async with get_session_cm() as session:
                # Update project status to 'completed'
                result = await session.execute(
                    select(VideoProject).where(VideoProject.id == req.project_id)
                )
                project = result.scalar_one_or_none()
                if project:
                    project.status = "completed"
                    # Write clips to GeneratedClip table
                    for idx, clip in enumerate(detected_clips):
                        db_clip = GeneratedClip(
                            project_id=req.project_id,
                            index=idx,
                            title=clip.get("title", ""),
                            start_time=clip.get("start", 0),
                            end_time=clip.get("end", 0),
                            reason=clip.get("reason"),
                            virality_score=clip.get("virality_score"),
                            brand_alignment=json.dumps(clip.get("brand_alignment", [])) if clip.get("brand_alignment") else None,
                            hashtags=json.dumps(clip.get("hashtags", [])) if clip.get("hashtags") else None,
                        )
                        session.add(db_clip)
                    await session.commit()
        elif req.source_path:
            await _update_project_status(req.source_path, "completed" if completed else "failed")

    return _sse_response(_generate())


@router.get("/cached")
async def highlights_cached(path: str = Query(...), user: User = Depends(get_current_user)):
    """Return cached clips JSON for a given source path, or 404."""
    cache_path = _clips_cache_path(path)
    if not os.path.exists(cache_path):
        raise HTTPException(status_code=404, detail="No cached clips found.")
    with open(cache_path, "r", encoding="utf-8") as f:
        return json.load(f)
