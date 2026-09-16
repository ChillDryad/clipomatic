"""
Momiji Clipper — Video projects router.

Endpoints:
- POST /api/projects/check-duplicate — Check for duplicate video
- POST /api/projects — Create new project
- GET /api/projects — List user's projects
- GET /api/projects/{project_id} — Get project details
- DELETE /api/projects/{project_id} — Delete project
- POST /api/projects/{project_id}/clips — Add clips to project
- GET /api/projects/{project_id}/clips — Get project clips
- PUT /api/projects/{project_id}/clips/{clip_index} — Update clip
- DELETE /api/projects/{project_id}/clips/{clip_index} — Delete clip
- POST /api/projects/{project_id}/clips/{clip_index}/regenerate-metadata — Regenerate clip metadata
"""

import os
import json
import uuid
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select, func, or_

from db import User, VideoProject, GeneratedClip, TeamMember, Transcript, get_session_cm
from auth import get_current_user_or_api_key
from utils.helpers import _clips_cache_path, _parse_clip_key, _regenerate_clip_metadata, _user_dict
from pydantic import BaseModel

router = APIRouter(prefix="/api/projects", tags=["Video Projects"])

# Get WORKSPACE from environment
WORKSPACE = os.environ.get(
    "WORKSPACE_DIR",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "workspace"),
)


class CreateProjectRequest(BaseModel):
    source_path: str
    original_source: str | None = None  # Original URL (YouTube/Twitch/Kick)
    original_filename: str
    duration: float | None = None
    team_id: str | None = None
    content_hash: str | None = None


class CheckDuplicateRequest(BaseModel):
    url: str | None = None
    content_hash: str | None = None


class AddClipsRequest(BaseModel):
    clips: list[dict]


@router.post("/check-duplicate")
async def check_duplicate_project(req: CheckDuplicateRequest, user: User = Depends(get_current_user_or_api_key)):
    """Check if a video with the same URL or content hash already exists for this user."""
    async with get_session_cm() as session:
        query = select(VideoProject).where(VideoProject.owner_id == user.id)

        if req.url:
            query = query.where(VideoProject.source_path == req.url)
        elif req.content_hash:
            query = query.where(VideoProject.source_path.like(f"%{req.content_hash}%"))

        existing = await session.execute(query)
        project = existing.scalar_one_or_none()

        if project:
            return {
                "is_duplicate": True,
                "existing_project_id": project.id,
                "redirect_url": f"/video/{project.id}",
            }

        return {"is_duplicate": False}


@router.post("")
async def create_project(req: CreateProjectRequest, user: User = Depends(get_current_user_or_api_key)):
    """Create a new video project."""
    async with get_session_cm() as session:
        if req.team_id:
            member_result = await session.execute(
                select(TeamMember).where(TeamMember.team_id == req.team_id, TeamMember.user_id == user.id)
            )
            member = member_result.scalar_one_or_none()
            if not member:
                raise HTTPException(status_code=403, detail="Not a member of this team")

        project = VideoProject(
            owner_id=user.id,
            team_id=req.team_id,
            source_path=req.source_path,
            original_source=req.original_source,
            original_filename=req.original_filename,
            duration=req.duration,
            status="pending",
        )
        session.add(project)
        await session.commit()
        await session.refresh(project)

    return {
        "id": project.id,
        "owner_id": project.owner_id,
        "team_id": project.team_id,
        "source_path": project.source_path,
        "original_source": project.original_source,
        "original_filename": project.original_filename,
        "duration": project.duration,
        "status": project.status,
        "created_at": project.created_at,
    }


@router.get("")
async def list_projects(
    team_id: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user_or_api_key),
):
    """List user's video projects, optionally filtered by team. Supports pagination."""
    async with get_session_cm() as session:
        # Build base query for accessible projects
        if team_id:
            member_result = await session.execute(
                select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user.id)
            )
            member = member_result.scalar_one_or_none()
            if not member:
                raise HTTPException(status_code=403, detail="Not a member of this team")

            # Subquery guarantees unique project IDs (avoids OR-condition duplicates)
            project_ids = (
                select(VideoProject.id)
                .where(or_(VideoProject.owner_id == user.id, VideoProject.team_id == team_id))
                .distinct()
                .subquery()
            )
            base_query = select(VideoProject).where(VideoProject.id.in_(select(project_ids)))
        else:
            base_query = select(VideoProject).where(VideoProject.owner_id == user.id)

        # Count total matching projects
        count_query = select(func.count()).select_from(base_query.subquery())
        total_result = await session.execute(count_query)
        total = total_result.scalar() or 0

        # Paginate
        query = base_query.order_by(VideoProject.created_at.desc()).offset(offset).limit(limit)
        result = await session.execute(query)
        projects = result.scalars().all()

        # Fetch real clip counts
        project_ids_list = [p.id for p in projects]
        clip_counts: dict[str, int] = {}
        if project_ids_list:
            count_rows = await session.execute(
                select(GeneratedClip.project_id, func.count().label("cnt"))
                .where(GeneratedClip.project_id.in_(project_ids_list))
                .group_by(GeneratedClip.project_id)
            )
            clip_counts = {row[0]: row[1] for row in count_rows}

    return {
        "projects": [
            {
                "id": p.id,
                "owner_id": p.owner_id,
                "team_id": p.team_id,
                "source_path": p.source_path,
                "original_source": p.original_source,
                "original_filename": p.original_filename,
                "duration": p.duration,
                "status": p.status,
                "created_at": p.created_at,
                "clip_count": clip_counts.get(p.id, 0),
            }
            for p in projects
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(projects) < total,
    }


@router.get("/{project_id}")
async def get_project(project_id: str, user: User = Depends(get_current_user_or_api_key)):
    """Get a video project by ID."""
    async with get_session_cm() as session:
        result = await session.execute(select(VideoProject).where(VideoProject.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.owner_id != user.id:
            if project.team_id:
                member_result = await session.execute(
                    select(TeamMember).where(TeamMember.team_id == project.team_id, TeamMember.user_id == user.id)
                )
                member = member_result.scalar_one_or_none()
                if not member:
                    raise HTTPException(status_code=403, detail="Access denied")
            else:
                raise HTTPException(status_code=403, detail="Access denied")

        # Get clips for this project
        clips_result = await session.execute(
            select(GeneratedClip).where(GeneratedClip.project_id == project_id).order_by(GeneratedClip.index)
        )
        clips = clips_result.scalars().all()

    return {
        "id": project.id,
        "owner_id": project.owner_id,
        "team_id": project.team_id,
        "source_path": project.source_path,
        "original_source": project.original_source,
        "original_filename": project.original_filename,
        "duration": project.duration,
        "status": project.status,
        "created_at": project.created_at,
        "clips": [
            {
                "id": c.id,
                "index": c.index,
                "title": c.title,
                "start_time": c.start_time,
                "end_time": c.end_time,
                "reason": c.reason,
                "recommendation_reason": c.recommendation_reason,
                "virality_score": c.virality_score,
                "brand_alignment": json.loads(c.brand_alignment) if c.brand_alignment else [],
                "hashtags": json.loads(c.hashtags) if c.hashtags else [],
                "render_path": c.render_path,
            }
            for c in clips
        ],
    }


@router.delete("/{project_id}")
async def delete_project(project_id: str, user: User = Depends(get_current_user_or_api_key)):
    """Delete a video project and clean up workspace files."""
    import shutil

    async with get_session_cm() as session:
        result = await session.execute(select(VideoProject).where(VideoProject.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.owner_id != user.id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Collect render paths before cascade delete
        clips_result = await session.execute(
            select(GeneratedClip).where(GeneratedClip.project_id == project_id)
        )
        render_paths = [c.render_path for c in clips_result.scalars().all() if c.render_path]

        await session.delete(project)
        await session.commit()

    # Clean up workspace files (outside the session)
    stem = os.path.splitext(os.path.basename(project.source_path))[0] if project.source_path else ""

    # Source video (local files only, not URLs)
    source_path = project.source_path
    if source_path and not source_path.startswith("http://") and not source_path.startswith("https://"):
        video_abs = os.path.join(WORKSPACE, source_path.removeprefix("/workspace/")) if source_path.startswith("/workspace/") else source_path
        if os.path.exists(video_abs):
            try:
                os.remove(video_abs)
            except OSError:
                pass

    # Cached transcript
    transcript_path = os.path.join(WORKSPACE, f"{stem}_transcript.json")
    if os.path.exists(transcript_path):
        try:
            os.remove(transcript_path)
        except OSError:
            pass

    # Cached clips
    clips_json = os.path.join(WORKSPACE, f"{stem}_clips.json")
    if os.path.exists(clips_json):
        try:
            os.remove(clips_json)
        except OSError:
            pass

    # Rendered clip files
    for rp in render_paths:
        if rp:
            rp_abs = os.path.join(WORKSPACE, rp.removeprefix("/workspace/"))
            if os.path.exists(rp_abs):
                try:
                    os.remove(rp_abs)
                except OSError:
                    pass

    # Thumbnail file
    thumb_dir = os.path.join(WORKSPACE, "thumbnails")
    if os.path.isdir(thumb_dir):
        for ext in [".png", ".jpg", ".jpeg", ".webp"]:
            thumb_path = os.path.join(thumb_dir, f"{project_id}{ext}")
            if os.path.exists(thumb_path):
                try:
                    os.remove(thumb_path)
                except OSError:
                    pass

    # Cached frames for this video
    frames_dir = os.path.join(WORKSPACE, "frames")
    if os.path.isdir(frames_dir):
        for fname in os.listdir(frames_dir):
            if fname.startswith(stem + "_") or f"frame_" in fname:
                fpath = os.path.join(frames_dir, fname)
                try:
                    os.remove(fpath)
                except OSError:
                    pass

    return {"success": True}


@router.post("/{project_id}/clips")
async def add_clips_to_project(project_id: str, req: AddClipsRequest, user: User = Depends(get_current_user_or_api_key)):
    """Add clips to a project."""
    async with get_session_cm() as session:
        project = await session.get(VideoProject, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.owner_id != user.id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Delete existing clips to prevent duplicates
        existing = await session.execute(
            select(GeneratedClip).where(GeneratedClip.project_id == project_id)
        )
        for old_clip in existing.scalars().all():
            await session.delete(old_clip)

        # Add clips to database
        for clip_data in req.clips:
            clip = GeneratedClip(
                project_id=project_id,
                index=clip_data.get("index", 0),
                title=clip_data.get("title", ""),
                start_time=clip_data.get("start", 0),
                end_time=clip_data.get("end", 0),
                reason=clip_data.get("reason"),
                recommendation_reason=clip_data.get("recommendation_reason"),
                virality_score=clip_data.get("virality_score"),
                brand_alignment=json.dumps(clip_data.get("brand_alignment", [])) if clip_data.get("brand_alignment") else None,
                hashtags=json.dumps(clip_data.get("hashtags", [])) if clip_data.get("hashtags") else None,
            )
            session.add(clip)

        await session.commit()

    return {"success": True}


@router.put("/{project_id}/clips/{clip_index}")
async def update_project_clip(project_id: str, clip_index: int, req: dict, user: User = Depends(get_current_user_or_api_key)):
    """Update a clip's metadata."""
    async with get_session_cm() as session:
        project = await session.get(VideoProject, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.owner_id != user.id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Find clip by index
        clips_result = await session.execute(
            select(GeneratedClip).where(
                GeneratedClip.project_id == project_id,
                GeneratedClip.index == clip_index
            )
        )
        clip = clips_result.scalar_one_or_none()
        if not clip:
            raise HTTPException(status_code=404, detail=f"Clip {clip_index} not found")

        # Update fields
        if "title" in req:
            clip.title = req["title"]
        if "start" in req:
            clip.start_time = req["start"]
        if "end" in req:
            clip.end_time = req["end"]
        if "reason" in req:
            clip.reason = req["reason"]
        if "recommendation_reason" in req:
            clip.recommendation_reason = req["recommendation_reason"]
        if "virality_score" in req:
            clip.virality_score = req["virality_score"]
        if "brand_alignment" in req:
            clip.brand_alignment = json.dumps(req["brand_alignment"]) if req["brand_alignment"] else None
        if "hashtags" in req:
            clip.hashtags = json.dumps(req["hashtags"]) if req["hashtags"] else None
        if "crop_avatar" in req:
            clip.crop_avatar = json.dumps(req["crop_avatar"]) if req["crop_avatar"] else None
        if "crop_game" in req:
            clip.crop_game = json.dumps(req["crop_game"]) if req["crop_game"] else None

        await session.commit()

    return {"success": True}


@router.get("/{project_id}/clips")
async def get_project_clips(project_id: str, user: User = Depends(get_current_user_or_api_key)):
    """
    Get clips for a project.
    Prefers database clips, but falls back to cache file and migrates to DB if found.
    """
    async with get_session_cm() as session:
        project = await session.get(VideoProject, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.owner_id != user.id:
            raise HTTPException(status_code=403, detail="Access denied")

        # First, try to load clips from database
        clips_result = await session.execute(
            select(GeneratedClip).where(GeneratedClip.project_id == project_id).order_by(GeneratedClip.index)
        )
        db_clips = clips_result.scalars().all()

        if db_clips:
            return {
                "clips": [
                    {
                        "id": c.id,
                        "index": c.index,
                        "title": c.title,
                        "start": c.start_time,
                        "end": c.end_time,
                        "reason": c.reason,
                        "recommendation_reason": c.recommendation_reason,
                        "virality_score": c.virality_score,
                        "brand_alignment": json.loads(c.brand_alignment) if c.brand_alignment else [],
                        "hashtags": json.loads(c.hashtags) if c.hashtags else [],
                        "render_path": c.render_path,
                        "crop_avatar": json.loads(c.crop_avatar) if c.crop_avatar else None,
                        "crop_game": json.loads(c.crop_game) if c.crop_game else None,
                    }
                    for c in db_clips
                ],
                "source": "database",
            }

        # No DB clips - check cache file for legacy data
        cache_path = _clips_cache_path(project.source_path)
        if not os.path.exists(cache_path):
            return {"clips": [], "source": "none"}

        with open(cache_path, "r", encoding="utf-8") as f:
            cached_clips = json.load(f)

        if not cached_clips:
            return {"clips": [], "source": "cache"}

        # Migrate cached clips to database
        for idx, clip in enumerate(cached_clips):
            db_clip = GeneratedClip(
                project_id=project_id,
                index=idx,
                title=clip.get("title", ""),
                start_time=clip.get("start", 0),
                end_time=clip.get("end", 0),
                reason=clip.get("reason"),
                recommendation_reason=clip.get("recommendation_reason"),
                virality_score=clip.get("virality_score"),
                brand_alignment=json.dumps(clip.get("brand_alignment", [])) if clip.get("brand_alignment") else None,
                hashtags=json.dumps(clip.get("hashtags", [])) if clip.get("hashtags") else None,
            )
            session.add(db_clip)

        # Update project status to 'completed' if clips were migrated
        if project.status not in ("completed", "processing"):
            project.status = "completed"

        await session.commit()

        # Return migrated clips in database format
        return {
            "clips": [
                {
                    "id": None,  # Will be populated after commit, but we return the data
                    "index": idx,
                    "title": clip.get("title", ""),
                    "start": clip.get("start", 0),
                    "end": clip.get("end", 0),
                    "reason": clip.get("reason"),
                    "recommendation_reason": clip.get("recommendation_reason"),
                    "virality_score": clip.get("virality_score"),
                    "brand_alignment": clip.get("brand_alignment", []),
                    "hashtags": clip.get("hashtags", []),
                }
                for idx, clip in enumerate(cached_clips)
            ],
            "source": "cache_migrated",
        }


@router.post("/{project_id}/clips/{clip_index}/regenerate-metadata")
async def regenerate_clip_metadata(
    project_id: str, clip_index: int, req: dict, user: User = Depends(get_current_user_or_api_key)
):
    """Regenerate title and hashtags for a clip using the LLM."""
    async with get_session_cm() as session:
        project = await session.get(VideoProject, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.owner_id != user.id:
            raise HTTPException(status_code=403, detail="Access denied")

    cache_path = _clips_cache_path(project.source_path)
    if not os.path.exists(cache_path):
        raise HTTPException(status_code=404, detail="Clip cache file not found.")

    with open(cache_path, "r", encoding="utf-8") as f:
        clips = json.load(f)

    if not isinstance(clips, list) or clip_index < 0 or clip_index >= len(clips):
        raise HTTPException(status_code=404, detail=f"Clip index {clip_index} out of range.")

    clip = clips[clip_index]
    transcript = req.get("transcript", {})

    updated = await _regenerate_clip_metadata(clip, transcript)
    clips[clip_index] = updated

    # Write atomically
    tmp = cache_path + f".{uuid.uuid4().hex[:8]}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(clips, f, ensure_ascii=False, indent=2)
    os.replace(tmp, cache_path)

    return updated


@router.get("/{project_id}/pipeline-state")
async def get_project_pipeline_state(project_id: str, user: User = Depends(get_current_user_or_api_key)):
    """
    Return the complete pipeline state for a project.
    Prefers database records, falls back to cache files.
    """
    async with get_session_cm() as session:
        result = await session.execute(
            select(VideoProject).where(VideoProject.id == project_id)
        )
        project = result.scalar_one_or_none()

        if not project:
            raise HTTPException(status_code=404, detail="Project not found.")

        # Load transcript from database (preferred) or cache file fallback
        transcript = None
        transcript_cached = False

        # Try database first
        transcript_result = await session.execute(
            select(Transcript).where(Transcript.project_id == project_id)
        )
        db_transcript = transcript_result.scalar_one_or_none()

        if db_transcript:
            transcript = {
                "language": db_transcript.language,
                "language_probability": db_transcript.language_probability,
                "duration": db_transcript.duration,
                "segments": json.loads(db_transcript.segments),
            }
            transcript_cached = True
        else:
            # Fallback to cache file
            stem = os.path.splitext(os.path.basename(project.source_path))[0]
            transcript_path = os.path.join(WORKSPACE, f"{stem}_transcript.json")
            if os.path.exists(transcript_path):
                try:
                    with open(transcript_path, "r", encoding="utf-8") as f:
                        transcript = json.load(f)
                    transcript_cached = True
                except (json.JSONDecodeError, IOError):
                    pass

        # Load clips from database (preferred) or cache file fallback
        clips = None
        clips_cached = False

        # Try database first
        clips_result = await session.execute(
            select(GeneratedClip).where(GeneratedClip.project_id == project_id).order_by(GeneratedClip.index)
        )
        db_clips = clips_result.scalars().all()

        if db_clips:
            clips = [
                {
                    "id": c.id,
                    "index": c.index,
                    "title": c.title,
                    "start": c.start_time,
                    "end": c.end_time,
                    "reason": c.reason,
                    "recommendation_reason": c.recommendation_reason,
                    "virality_score": c.virality_score,
                    "brand_alignment": json.loads(c.brand_alignment) if c.brand_alignment else [],
                    "hashtags": json.loads(c.hashtags) if c.hashtags else [],
                }
                for c in db_clips
            ]
            clips_cached = True
        else:
            # Fallback to cache file
            clips_path = _clips_cache_path(project.source_path)
            if os.path.exists(clips_path):
                try:
                    with open(clips_path, "r", encoding="utf-8") as f:
                        clips = json.load(f)
                    clips_cached = True
                except (json.JSONDecodeError, IOError):
                    pass

        return {
            "project": {
                "id": project.id,
                "source_path": project.source_path,
                "original_source": project.original_source,
                "original_filename": project.original_filename,
                "duration": project.duration,
                "status": project.status,
            },
            "transcript": transcript,
            "transcript_cached": transcript_cached,
            "clips": clips,
            "clips_cached": clips_cached,
        }
