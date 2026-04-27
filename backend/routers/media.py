"""
Momiji Clipper — Media router.

Endpoints:
- POST /api/media/upload — Upload image/video asset
- GET /api/media/list — List media assets
- DELETE /api/media/{asset_id} — Delete media asset
- POST /api/audio/upload — Upload audio asset
- GET /api/audio/list — List audio assets
- DELETE /api/audio/{asset_id} — Delete audio asset
- GET /api/audio/{asset_id}/waveform — Get waveform data
- GET /api/frame — Extract video frame at timestamp
"""

import asyncio
import os
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from db import MediaAsset as MediaAssetModel, AudioAsset as AudioAssetModel, User, get_session_cm
from auth import get_current_user
from utils.helpers import _validate_workspace_path
from pydantic import BaseModel
from sqlalchemy import select

router = APIRouter(prefix="/api", tags=["Media Library"])


class MediaResponse(BaseModel):
    id: str
    filename: str
    original_filename: str
    file_path: str
    file_size: int
    mime_type: str
    asset_type: str
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    url: str


class AudioResponse(BaseModel):
    id: str
    filename: str
    original_filename: str
    file_path: str
    file_size: int
    duration: float
    sample_rate: int
    channels: int
    url: str


class WaveformResponse(BaseModel):
    duration: float
    sample_rate: int
    peaks: list[float]


@router.post("/media/upload")
async def upload_media(file: UploadFile = File(...)):
    """Upload an image or video file for overlay tracks."""
    from pipeline import media as media_pipeline

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    try:
        content = await file.read()
        asset = await media_pipeline.save_media_file(
            file_content=content,
            original_filename=file.filename,
            media_dir=MEDIA_DIR,
        )

        async with get_session_cm() as session:
            db_asset = MediaAssetModel(
                id=asset.id,
                filename=asset.filename,
                original_filename=asset.original_filename,
                file_path=asset.file_path,
                file_size=asset.file_size,
                mime_type=asset.mime_type,
                asset_type=asset.asset_type,
                width=asset.width,
                height=asset.height,
                duration=asset.duration,
            )
            session.add(db_asset)
            await session.commit()
            await session.refresh(db_asset)

        rel_path = os.path.relpath(asset.file_path, WORKSPACE)

        return MediaResponse(
            id=asset.id,
            filename=asset.filename,
            original_filename=asset.original_filename,
            file_path=asset.file_path,
            file_size=asset.file_size,
            mime_type=asset.mime_type,
            asset_type=asset.asset_type,
            width=asset.width,
            height=asset.height,
            duration=asset.duration,
            url=f"/workspace/{rel_path}",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/media/list")
async def list_media(asset_type: str | None = Query(None)):
    """List all uploaded media assets, optionally filtered by type."""
    async with get_session_cm() as session:
        query = select(MediaAssetModel).order_by(MediaAssetModel.created_at.desc())
        if asset_type:
            query = query.where(MediaAssetModel.asset_type == asset_type)
        result = await session.execute(query)
        db_assets = result.scalars().all()

    return {
        "assets": [
            {
                "id": a.id,
                "filename": a.filename,
                "original_filename": a.original_filename,
                "file_path": a.file_path,
                "file_size": a.file_size,
                "mime_type": a.mime_type,
                "asset_type": a.asset_type,
                "width": a.width,
                "height": a.height,
                "duration": a.duration,
                "url": f"/workspace/{os.path.relpath(a.file_path, WORKSPACE)}",
            }
            for a in db_assets
        ]
    }


@router.delete("/media/{asset_id}")
async def delete_media(asset_id: str):
    """Delete a media asset."""
    async with get_session_cm() as session:
        result = await session.execute(select(MediaAssetModel).where(MediaAssetModel.id == asset_id))
        asset = result.scalar_one_or_none()

        if not asset:
            raise HTTPException(status_code=404, detail="Media asset not found")

        if os.path.exists(asset.file_path):
            os.remove(asset.file_path)

        await session.delete(asset)
        await session.commit()

    return {"ok": True}


@router.post("/audio/upload")
async def upload_audio(file: UploadFile = File(...)):
    """Upload an audio file for BGM/SFX tracks."""
    from pipeline import audio as audio_pipeline

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    try:
        content = await file.read()
        asset = await audio_pipeline.save_audio_file(
            file_content=content,
            original_filename=file.filename,
            audio_dir=AUDIO_DIR,
        )

        async with get_session_cm() as session:
            db_asset = AudioAssetModel(
                id=asset.id,
                filename=asset.filename,
                original_filename=asset.original_filename,
                file_path=asset.file_path,
                file_size=asset.file_size,
                duration=asset.duration,
                sample_rate=asset.sample_rate,
                channels=asset.channels,
            )
            session.add(db_asset)
            await session.commit()
            await session.refresh(db_asset)

        rel_path = os.path.relpath(asset.file_path, WORKSPACE)

        return AudioResponse(
            id=asset.id,
            filename=asset.filename,
            original_filename=asset.original_filename,
            file_path=asset.file_path,
            file_size=asset.file_size,
            duration=asset.duration,
            sample_rate=asset.sample_rate,
            channels=asset.channels,
            url=f"/workspace/{rel_path}",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/audio/list")
async def list_audio():
    """List all uploaded audio assets."""
    async with get_session_cm() as session:
        result = await session.execute(
            select(AudioAssetModel).order_by(AudioAssetModel.created_at.desc())
        )
        db_assets = result.scalars().all()

    return {
        "assets": [
            {
                "id": a.id,
                "filename": a.filename,
                "original_filename": a.original_filename,
                "file_path": a.file_path,
                "file_size": a.file_size,
                "duration": a.duration,
                "sample_rate": a.sample_rate,
                "channels": a.channels,
                "url": f"/workspace/{os.path.relpath(a.file_path, WORKSPACE)}",
            }
            for a in db_assets
        ]
    }


@router.delete("/audio/{asset_id}")
async def delete_audio(asset_id: str):
    """Delete an audio asset."""
    async with get_session_cm() as session:
        result = await session.execute(select(AudioAssetModel).where(AudioAssetModel.id == asset_id))
        asset = result.scalar_one_or_none()

        if not asset:
            raise HTTPException(status_code=404, detail="Audio asset not found")

        if os.path.exists(asset.file_path):
            os.remove(asset.file_path)

        await session.delete(asset)
        await session.commit()

    return {"ok": True}


@router.get("/audio/{asset_id}/waveform")
async def get_waveform(asset_id: str):
    """Generate waveform data for an audio asset."""
    from pipeline import audio as audio_pipeline

    async with get_session_cm() as session:
        result = await session.execute(select(AudioAssetModel).where(AudioAssetModel.id == asset_id))
        asset = result.scalar_one_or_none()

        if not asset:
            raise HTTPException(status_code=404, detail="Audio asset not found")

    peaks = await audio_pipeline.generate_waveform(asset.file_path)

    return WaveformResponse(
        duration=asset.duration,
        sample_rate=asset.sample_rate,
        peaks=peaks,
    )


@router.get("/frame")
async def get_frame(
    video: str = Query(...),
    t: float = Query(2.0),
    user: User = Depends(get_current_user),
):
    """
    Extract a single frame from a video at timestamp t and return it as JPEG.
    Supports both file paths and URLs (YouTube, Twitch, etc.).
    """
    from pipeline.media import extract_frame

    # Resolve /workspace/... URL paths to the actual workspace directory
    if video.startswith("/workspace/"):
        video = os.path.join(WORKSPACE, video.removeprefix("/workspace/"))

    # For URLs (http/https), skip file path validation
    is_url = video.startswith("http://") or video.startswith("https://")

    if not is_url:
        # Validate video path is inside WORKSPACE
        try:
            video_abs = os.path.abspath(video)
            workspace_abs = os.path.abspath(WORKSPACE)
            if not video_abs.startswith(workspace_abs + os.sep) and video_abs != workspace_abs:
                raise HTTPException(status_code=400, detail="Video path is outside workspace.")
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid video path.")

        if not os.path.exists(video):
            raise HTTPException(status_code=404, detail="Video file not found.")

    frames_dir = os.path.join(WORKSPACE, "frames")
    try:
        frame_path = await asyncio.to_thread(extract_frame, video, t, frames_dir)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return FileResponse(frame_path, media_type="image/jpeg")


# Get directories from environment
WORKSPACE = os.environ.get(
    "WORKSPACE_DIR",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "workspace"),
)
FRAMES_DIR = os.path.join(WORKSPACE, "frames")
MEDIA_DIR = os.path.join(WORKSPACE, "media")
AUDIO_DIR = os.path.join(WORKSPACE, "audio_assets")
os.makedirs(FRAMES_DIR, exist_ok=True)
os.makedirs(MEDIA_DIR, exist_ok=True)
os.makedirs(AUDIO_DIR, exist_ok=True)
