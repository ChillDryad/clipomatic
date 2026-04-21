"""
Momiji Clipper — Transcription router.

Endpoints:
- POST /api/transcribe — Transcribe video/audio with SSE progress
- GET /api/transcribe/cached — Get cached transcript
- POST /api/transcribe/segment — Re-transcribe specific segment
"""

import os
import json
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query

from db import User, VideoProject, get_session_cm
from auth import get_current_user
from pipeline import transcription
from utils.sse import _sse_response, _sse_stream
from utils.helpers import _update_project_status
from pydantic import BaseModel
from sqlalchemy import select

router = APIRouter(prefix="/api/transcribe", tags=["Transcription"])


class TranscribeRequest(BaseModel):
    video_path: str | None = None
    audio_path: str | None = None
    project_id: str | None = None
    model_size: str = "large-v3"
    device: str = "auto"
    language: str | None = None


class TranscribeSegmentRequest(BaseModel):
    video_path: str | None = None
    audio_path: str | None = None
    start: float
    end: float
    model_size: str = "large-v3"
    device: str = "auto"
    language: str | None = None


@router.post("")
async def transcribe(req: TranscribeRequest):
    """Transcribe a video or audio file with SSE progress."""
    if not req.video_path and not req.audio_path:
        raise HTTPException(status_code=400, detail="Either video_path or audio_path required.")

    source_path = req.video_path or req.audio_path
    project_id = req.project_id

    # Update project status to "processing" if project exists
    if project_id:
        async with get_session_cm() as session:
            result = await session.execute(
                select(VideoProject).where(VideoProject.id == project_id)
            )
            project = result.scalar_one_or_none()
            if project:
                project.status = "processing"
                await session.commit()
    elif source_path:
        await _update_project_status(source_path, "processing")

    # Completion callback to update project status when done
    async def on_transcribe_complete(result: Any, error: str | None) -> None:
        new_status = "complete" if error is None else "failed"
        if project_id:
            async with get_session_cm() as session:
                result_obj = await session.execute(
                    select(VideoProject).where(VideoProject.id == project_id)
                )
                project = result_obj.scalar_one_or_none()
                if project:
                    project.status = new_status
                    await session.commit()
        elif source_path:
            await _update_project_status(source_path, new_status)

    return _sse_response(
        _sse_stream(
            transcription.transcribe,
            video_path=req.video_path,
            output_dir=WORKSPACE,
            model_size=req.model_size,
            device=req.device,
            language=req.language or None,
            audio_path=req.audio_path,
            on_complete=on_transcribe_complete,
        )
    )


@router.get("/cached")
async def transcribe_cached(path: str = Query(...), user: User = Depends(get_current_user)):
    """Return cached transcript JSON for a given video/audio path, or 404."""
    stem = os.path.splitext(os.path.basename(path))[0]
    transcript_path = os.path.join(WORKSPACE, f"{stem}_transcript.json")
    if not os.path.exists(transcript_path):
        raise HTTPException(status_code=404, detail="No cached transcript found.")
    with open(transcript_path, "r", encoding="utf-8") as f:
        return json.load(f)


@router.post("/segment")
async def transcribe_segment(req: TranscribeSegmentRequest):
    """Re-transcribe a specific time window with a chosen Whisper model. SSE progress."""
    if not req.video_path and not req.audio_path:
        raise HTTPException(status_code=400, detail="Either video_path or audio_path required.")
    return _sse_response(
        _sse_stream(
            transcription.transcribe_segment,
            video_path=req.video_path,
            audio_path=req.audio_path,
            start=req.start,
            end=req.end,
            model_size=req.model_size,
            device=req.device,
            language=req.language or None,
        )
    )


# Get WORKSPACE from environment
WORKSPACE = os.environ.get(
    "WORKSPACE_DIR",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "workspace"),
)
