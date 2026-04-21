"""
Momiji Clipper — Highlight detection router.

Endpoints:
- POST /api/highlights — Detect viral clips with SSE progress
- GET /api/highlights/cached — Get cached clips
"""

import os
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Query

from db import User, VideoProject, get_session_cm
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
        async for event_str in _sse_stream(
            highlight_detection.detect_highlights,
            transcript=req.transcript,
            api_key=api_key,
            base_url=base_url,
            model=req.model,
        ):
            yield event_str
            # When done, persist the clips to disk
            try:
                raw = event_str.removeprefix("data: ").strip()
                event = json.loads(raw) if raw.startswith("{") else {}
                if event.get("done") and req.source_path and event.get("result") is not None:
                    cache_path = _clips_cache_path(req.source_path)
                    with open(cache_path, "w", encoding="utf-8") as f:
                        json.dump(event["result"], f, ensure_ascii=False, indent=2)
                    completed = True
            except Exception as exc:
                logger.warning("Failed to write clips cache: %s", exc)

        # Update project status on completion
        if req.project_id:
            async with get_session_cm() as session:
                result = await session.execute(
                    select(VideoProject).where(VideoProject.id == req.project_id)
                )
                project = result.scalar_one_or_none()
                if project:
                    project.status = "complete" if completed else "failed"
                    await session.commit()
        elif req.source_path:
            await _update_project_status(req.source_path, "complete" if completed else "failed")

    return _sse_response(_generate())


@router.get("/cached")
async def highlights_cached(path: str = Query(...), user: User = Depends(get_current_user)):
    """Return cached clips JSON for a given source path, or 404."""
    cache_path = _clips_cache_path(path)
    if not os.path.exists(cache_path):
        raise HTTPException(status_code=404, detail="No cached clips found.")
    with open(cache_path, "r", encoding="utf-8") as f:
        return json.load(f)
