"""
Momiji Clipper — Ingestion router.

Endpoints:
- POST /api/ingest/upload — Upload video file
- POST /api/ingest/url — Download from URL (YouTube/Twitch/Kick)
- POST /api/ingest/twitch/stream — Stream Twitch VOD audio
- GET /api/ingest/twitch/check — Check if Twitch VOD exists
"""

import asyncio
import hashlib
import json
import logging
import os
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import select

from db import User, UserOAuthAccount, VideoProject, get_session_cm
from auth import decrypt_oauth_token, get_current_user
from pipeline import ingestion
from pipeline.ingestion import extract_vod_id
from oauth.twitch import get_user_vods
from utils.helpers import _clips_cache_path
from utils.sse import _sse_event, _sse_response, _sse_stream

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ingest", tags=["Ingestion"])

# Get WORKSPACE from environment
WORKSPACE = os.environ.get(
    "WORKSPACE_DIR",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "workspace"),
)

# Allowed file extensions and MIME types for ingestion
_ALLOWED_INGEST_EXTENSIONS = {".mp4", ".mkv", ".mov", ".avi", ".webm"}
_MAX_INGEST_FILE_SIZE = 100 * 1024 * 1024  # 100 MB max
_ALLOWED_MIME_TYPES = {
    "video/mp4",
    "video/x-matroska",
    "video/quicktime",
    "video/x-msvideo",
    "video/webm",
    "video/x-ms-wmv",
}

_CHUNK_SIZE = 4 * 1024 * 1024  # 4 MB for upload progress


class UrlRequest(BaseModel):
    url: str


@router.post("/upload")
async def ingest_upload(
    request: Request,
    file: UploadFile = File(...),
    name: str = Form(...),
    user: User = Depends(get_current_user),
):
    """
    Save an uploaded video file to the workspace, streaming to disk in chunks.
    Creates a VideoProject on success with status='loaded'.
    Returns SSE stream with progress updates and final result.

    Security validations:
    - Path traversal prevention
    - Extension whitelist (.mp4, .mkv, .mov, .avi, .webm)
    - MIME type validation
    - File size limit (100 MB max)
    """
    # Validate user-provided name
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Video name is required")
    display_name = name.strip()[:200]

    # SECURITY: Validate filename
    original_name = file.filename or "upload"

    # Strip path components to prevent path traversal
    safe_basename = os.path.basename(original_name)
    if safe_basename != original_name:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid filename: path components not allowed. Original: {original_name!r}"
        )

    # Validate extension (allowlist)
    ext = os.path.splitext(safe_basename)[1].lower()
    if ext not in _ALLOWED_INGEST_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file extension: {ext!r}. Allowed: {', '.join(sorted(_ALLOWED_INGEST_EXTENSIONS))}"
        )

    # Generate secure filename with UUID
    safe_name = f"{uuid.uuid4().hex[:12]}{ext}"
    dest_path = os.path.join(WORKSPACE, safe_name)

    def _save_file_sync(progress_callback=None):
        """Blocking file save for SSE streaming - reads file in chunks."""
        written = 0
        first_chunk = True
        file_hash = hashlib.sha256()

        # Get the raw file-like object from UploadFile and seek to start
        file_obj = file.file
        file_obj.seek(0)

        with open(dest_path, "wb") as f:
            while True:
                chunk = file_obj.read(_CHUNK_SIZE)
                if not chunk:
                    break

                # SECURITY: Check file size during streaming (100 MB max)
                written += len(chunk)
                if written > _MAX_INGEST_FILE_SIZE:
                    f.close()
                    os.remove(dest_path)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large: exceeds {_MAX_INGEST_FILE_SIZE / (1024*1024):.1f} MB limit"
                    )

                # Validate MIME type from first chunk
                if first_chunk:
                    try:
                        import magic
                        detected_mime = magic.from_buffer(chunk, mime=True)
                        if detected_mime not in _ALLOWED_MIME_TYPES:
                            f.close()
                            os.remove(dest_path)
                            raise HTTPException(
                                status_code=400,
                                detail=f"Invalid file type: detected MIME {detected_mime!r}. Allowed: {', '.join(sorted(_ALLOWED_MIME_TYPES))}"
                            )
                        mime_type_validated = True
                    except ImportError:
                        mime_type_validated = True
                    except HTTPException:
                        raise
                    except Exception as exc:
                        logger.warning("MIME type detection failed: %s. Continuing with extension validation only.", exc)
                        mime_type_validated = True
                    first_chunk = False

                f.write(chunk)
                file_hash.update(chunk)
                mb_done = written / (1024 * 1024)
                if progress_callback:
                    progress_callback(mb_done / 100, f"Saving… {mb_done:.0f} MB")

        content_hash_hex = file_hash.hexdigest()
        return {
            "videoPath": dest_path,
            "contentHash": content_hash_hex,
            "displayName": display_name,
        }

    async def _on_upload_complete(result: Any, error: str | None) -> None:
        """Called when file upload completes - creates VideoProject."""
        if error or not result:
            return
        # Create VideoProject with status='loaded'
        async with get_session_cm() as session:
            project = VideoProject(
                owner_id=user.id,
                source_path=result["videoPath"],
                original_filename=result["displayName"],
                status="loaded",
            )
            session.add(project)
            await session.commit()
            result["project_id"] = project.id

    return _sse_response(_sse_stream(_save_file_sync, on_complete=_on_upload_complete))


@router.post("/url")
async def ingest_url(req: UrlRequest, user: User = Depends(get_current_user)):
    """
    Download a video from any yt-dlp-supported URL with SSE progress.
    Creates a VideoProject on success with status='loaded'.
    Auto-names the video using metadata from the source.
    Checks for duplicates before downloading.
    """
    import yt_dlp

    # First, check for duplicates by URL
    async with get_session_cm() as session:
        existing = await session.execute(
            select(VideoProject).where(
                VideoProject.source_path == req.url,
                VideoProject.owner_id == user.id,
            ).limit(1)
        )
        project = existing.scalar_one_or_none()
        if project:
            async def _redirect():
                yield _sse_event({
                    "redirect": True,
                    "projectId": project.id,
                    "url": f"/video/{project.id}",
                    "message": f"Video already exists: {project.original_filename}",
                })
            return _sse_response(_redirect())

    # Extract video title for auto-naming before download
    video_title = None
    video_duration = None
    try:
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(req.url, download=False)
            video_title = info.get("title", None)
            video_duration = info.get("duration", None)
    except Exception as exc:
        logger.warning("Failed to extract video title: %s", exc)

    def _download_with_title(progress_callback=None):
        result_path = ingestion.download_video(req.url, WORKSPACE, progress_callback)
        return {
            "videoPath": result_path,
            "videoTitle": video_title,
            "duration": video_duration,
        }

    async def _on_download_complete(result: Any, error: str | None) -> None:
        """Called when download completes - creates VideoProject."""
        if error or not result:
            return
        # Create VideoProject with status='loaded'
        async with get_session_cm() as session:
            project = VideoProject(
                owner_id=user.id,
                source_path=result["videoPath"],
                original_source=req.url,  # Store original URL
                original_filename=video_title or os.path.basename(result["videoPath"]),
                duration=result.get("duration"),
                status="loaded",
            )
            session.add(project)
            await session.commit()
            result["project_id"] = project.id

    return _sse_response(_sse_stream(_download_with_title, on_complete=_on_download_complete))


@router.post("/twitch/stream")
async def ingest_twitch_stream(req: UrlRequest, user: User = Depends(get_current_user)):
    """
    Stream only the audio from a Twitch VOD with SSE progress.
    Creates a VideoProject on success with status='loaded'.
    Auto-names using the VOD title. Checks for duplicates before streaming.
    """
    import yt_dlp

    vod_id = extract_vod_id(req.url)

    # Check for duplicates by VOD ID
    async with get_session_cm() as session:
        existing = await session.execute(
            select(VideoProject).where(
                VideoProject.source_path.like(f"%{vod_id}%"),
                VideoProject.owner_id == user.id,
            ).limit(1)
        )
        project = existing.scalar_one_or_none()
        if project:
            async def _redirect():
                yield _sse_event({
                    "redirect": True,
                    "projectId": project.id,
                    "url": f"/video/{project.id}",
                    "message": f"Twitch VOD already exists: {project.original_filename}",
                })
            return _sse_response(_redirect())

    # Extract VOD title
    video_title = None
    video_duration = None
    try:
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(req.url, download=False)
            video_title = info.get("title", None)
            video_duration = info.get("duration", None)
    except Exception as exc:
        logger.warning("Failed to extract Twitch VOD title: %s", exc)

    audio_path = os.path.join(WORKSPACE, "audio", f"{vod_id}_audio.wav")

    def _stream_with_title(progress_callback=None):
        result_path = ingestion.stream_audio_to_file(req.url, audio_path, progress_callback)
        return {
            "audioPath": result_path,
            "videoTitle": video_title,
            "duration": video_duration,
        }

    async def _on_stream_complete(result: Any, error: str | None) -> None:
        """Called when streaming completes - creates VideoProject."""
        if error or not result:
            return
        # Create VideoProject with status='loaded'
        async with get_session_cm() as session:
            project = VideoProject(
                owner_id=user.id,
                source_path=result["audioPath"],
                original_source=req.url,  # Store original Twitch URL
                original_filename=video_title or f"Twitch VOD {vod_id}",
                duration=result.get("duration"),
                status="loaded",
            )
            session.add(project)
            await session.commit()
            result["project_id"] = project.id

    return _sse_response(_sse_stream(_stream_with_title, on_complete=_on_stream_complete))


@router.get("/twitch/check")
async def ingest_twitch_check(url: str = Query(...), user: User = Depends(get_current_user)):
    """Check whether a transcript already exists for a Twitch VOD URL."""
    try:
        vod_id = extract_vod_id(url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    audio_path = os.path.join(WORKSPACE, "audio", f"{vod_id}_audio.wav")
    transcript_path = os.path.join(WORKSPACE, f"{vod_id}_audio_transcript.json")

    if os.path.exists(transcript_path):
        with open(transcript_path, "r", encoding="utf-8") as f:
            transcript = json.load(f)
        return {
            "cached": True,
            "transcript": transcript,
            "audio_path": audio_path if os.path.exists(audio_path) else None,
        }
    return {"cached": False}


@router.get("/twitch/vods")
async def list_twitch_vods(user: User = Depends(get_current_user)):
    """Fetch the authenticated user's Twitch VODs using their stored OAuth token."""
    async with get_session_cm() as session:
        result = await session.execute(
            select(UserOAuthAccount).where(
                UserOAuthAccount.provider == "twitch",
                UserOAuthAccount.access_token.isnot(None),
            )
            .order_by(UserOAuthAccount.created_at.desc())
            .limit(1)
        )
        oauth_account = result.scalar_one_or_none()

    if not oauth_account:
        raise HTTPException(status_code=401, detail="No Twitch account connected.")

    access_token = decrypt_oauth_token(oauth_account.access_token)
    vods = await get_user_vods(access_token, oauth_account.provider_account_id)
    return {"vods": vods}


@router.get("/check/{path:path}")
async def check_ingest_state(path: str, user: User = Depends(get_current_user)):
    """
    Check the ingestion state for a given source path.
    Returns whether video/audio file exists, and if transcript/clips are cached.
    """
    # Decode the path if it was URL-encoded
    import urllib.parse
    source_path = urllib.parse.unquote(path)

    # Check if file exists
    file_exists = os.path.exists(source_path)

    # Check transcript cache
    transcript_cached = False
    stem = os.path.splitext(os.path.basename(source_path))[0]
    transcript_path = os.path.join(WORKSPACE, f"{stem}_transcript.json")
    if os.path.exists(transcript_path):
        transcript_cached = True

    # Check clips cache
    clips_cached = False
    clips_path = _clips_cache_path(source_path)
    if os.path.exists(clips_path):
        clips_cached = True

    return {
        "file_exists": file_exists,
        "transcript_cached": transcript_cached,
        "clips_cached": clips_cached,
    }
