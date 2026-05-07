"""
Momiji Clipper — Thumbnail router.

Endpoints:
- POST   /api/projects/{project_id}/thumbnail       — Upload thumbnail image
- DELETE /api/projects/{project_id}/thumbnail       — Remove thumbnail
- POST   /api/projects/{project_id}/thumbnail/auto-generate — Auto-generate from YouTube or video frame
- GET    /api/projects/{project_id}/thumbnail       — Serve thumbnail file
- GET    /api/projects/{project_id}/thumbnail/status — Check if thumbnail exists
"""

import asyncio
import os
import shutil
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import select

from db import VideoProject, User, get_session_cm
from auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects", tags=["Thumbnails"])

WORKSPACE = os.environ.get(
    "WORKSPACE_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "workspace"),
)
THUMBNAILS_DIR = os.path.join(WORKSPACE, "thumbnails")

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB


def _thumbnail_path(project_id: str) -> str:
    """Find the thumbnail file for a project, or return empty string."""
    for ext in ALLOWED_EXTENSIONS:
        path = os.path.join(THUMBNAILS_DIR, f"{project_id}{ext}")
        if os.path.exists(path):
            return path
    return ""


@router.post("/{project_id}/thumbnail")
async def upload_thumbnail(
    project_id: str,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    """Upload a thumbnail image for a project."""
    os.makedirs(THUMBNAILS_DIR, exist_ok=True)

    # Validate extension
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type '{ext}'. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    # Read and validate size
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File too large. Max {MAX_FILE_SIZE // 1024 // 1024}MB")

    # Validate it's actually an image (header magic bytes)
    if not _is_image(contents):
        raise HTTPException(status_code=400, detail="File is not a valid image")

    # Remove existing thumbnail with any extension
    _remove_existing_thumbnail(project_id)

    # Save new thumbnail
    thumb_path = os.path.join(THUMBNAILS_DIR, f"{project_id}{ext}")
    with open(thumb_path, "wb") as f:
        f.write(contents)

    # Update DB
    async with get_session_cm() as session:
        result = await session.execute(
            select(VideoProject).where(VideoProject.id == project_id)
        )
        project = result.scalar_one_or_none()
        if not project:
            os.remove(thumb_path)
            raise HTTPException(status_code=404, detail="Project not found")
        project.thumbnail_path = thumb_path

    return {"thumbnail_path": thumb_path}


@router.delete("/{project_id}/thumbnail")
async def delete_thumbnail(
    project_id: str,
    user: User = Depends(get_current_user),
):
    """Remove the thumbnail for a project."""
    removed = _remove_existing_thumbnail(project_id)

    async with get_session_cm() as session:
        result = await session.execute(
            select(VideoProject).where(VideoProject.id == project_id)
        )
        project = result.scalar_one_or_none()
        if project:
            project.thumbnail_path = None

    return {"deleted": removed}


@router.post("/{project_id}/thumbnail/auto-generate")
async def auto_generate_thumbnail(
    project_id: str,
    user: User = Depends(get_current_user),
):
    """Auto-generate a thumbnail from YouTube (if URL source) or extract a video frame."""
    os.makedirs(THUMBNAILS_DIR, exist_ok=True)

    async with get_session_cm() as session:
        result = await session.execute(
            select(VideoProject).where(VideoProject.id == project_id)
        )
        project = result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        source = project.original_source or project.source_path

    # Try YouTube thumbnail first
    yt_id = _extract_youtube_id(source)
    if yt_id:
        thumb_url = f"https://img.youtube.com/vi/{yt_id}/maxresdefault.jpg"
        try:
            import httpx
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(thumb_url)
                if resp.status_code == 200:
                    _remove_existing_thumbnail(project_id)
                    ext = ".jpg"
                    thumb_path = os.path.join(THUMBNAILS_DIR, f"{project_id}{ext}")
                    with open(thumb_path, "wb") as f:
                        f.write(resp.content)

                    async with get_session_cm() as session:
                        result = await session.execute(
                            select(VideoProject).where(VideoProject.id == project_id)
                        )
                        project = result.scalar_one_or_none()
                        if project:
                            project.thumbnail_path = thumb_path

                    return {"thumbnail_path": thumb_path}
        except Exception as e:
            logger.warning(f"YouTube thumbnail fetch failed: {e}")

    # Fall back to extracting a frame from the video
    video_path = source
    if video_path.startswith("/workspace/"):
        video_path = os.path.join(WORKSPACE, video_path.removeprefix("/workspace/"))

    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")

    try:
        from pipeline.media import extract_frame

        frames_dir = os.path.join(WORKSPACE, "frames")
        frame_path = await asyncio.to_thread(extract_frame, video_path, 2.0, frames_dir)

        if os.path.exists(frame_path):
            _remove_existing_thumbnail(project_id)
            ext = ".jpg"
            thumb_path = os.path.join(THUMBNAILS_DIR, f"{project_id}{ext}")
            shutil.copy2(frame_path, thumb_path)

            async with get_session_cm() as session:
                result = await session.execute(
                    select(VideoProject).where(VideoProject.id == project_id)
                )
                project = result.scalar_one_or_none()
                if project:
                    project.thumbnail_path = thumb_path

            return {"thumbnail_path": thumb_path}
    except Exception as e:
        logger.warning(f"Frame extraction thumbnail failed: {e}")

    raise HTTPException(status_code=500, detail="Could not generate thumbnail")


@router.get("/{project_id}/thumbnail")
async def get_thumbnail(
    project_id: str,
    user: User = Depends(get_current_user),
):
    """Serve the thumbnail image for a project."""
    thumb_path = _thumbnail_path(project_id)
    if not thumb_path:
        raise HTTPException(status_code=404, detail="No thumbnail found")
    ext = os.path.splitext(thumb_path)[1].lower()
    media_type = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(ext, "image/jpeg")
    return FileResponse(thumb_path, media_type=media_type)


@router.get("/{project_id}/thumbnail/status")
async def thumbnail_status(
    project_id: str,
    user: User = Depends(get_current_user),
):
    """Check if a thumbnail exists for a project."""
    thumb_path = _thumbnail_path(project_id)
    return {
        "has_thumbnail": bool(thumb_path),
        "thumbnail_path": thumb_path if thumb_path else None,
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _is_image(data: bytes) -> bool:
    """Check magic bytes for valid image formats."""
    if len(data) < 8:
        return False
    # PNG: 89 50 4E 47
    if data[:4] == b"\x89PNG":
        return True
    # JPEG: FF D8 FF
    if data[:2] == b"\xff\xd8":
        return True
    # WebP: 52 49 46 46 ... 57 45 42 50
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    return False


def _remove_existing_thumbnail(project_id: str) -> bool:
    """Remove any existing thumbnail file for the project. Returns True if removed."""
    removed = False
    for ext in ALLOWED_EXTENSIONS:
        path = os.path.join(THUMBNAILS_DIR, f"{project_id}{ext}")
        if os.path.exists(path):
            os.remove(path)
            removed = True
    return removed


def _extract_youtube_id(url: str) -> str | None:
    """Extract YouTube video ID from various URL formats."""
    patterns = [
        r"(?:youtube\.com/watch\?.*v=)([\w-]+)",
        r"(?:youtu\.be/)([\w-]+)",
        r"(?:youtube\.com/embed/)([\w-]+)",
        r"(?:youtube\.com/shorts/)([\w-]+)",
    ]
    for pattern in patterns:
        m = re.search(pattern, url)
        if m:
            return m.group(1)
    return None
