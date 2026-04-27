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
from auth import get_current_user
from utils.helpers import _clips_cache_path, _parse_clip_key, _regenerate_clip_metadata, _user_dict
from pydantic import BaseModel

router = APIRouter(prefix="/api/projects", tags=["Video Projects"])


class CreateProjectRequest(BaseModel):
    source_path: str
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
async def check_duplicate_project(req: CheckDuplicateRequest, user: User = Depends(get_current_user)):
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
async def create_project(req: CreateProjectRequest, user: User = Depends(get_current_user)):
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
    user: User = Depends(get_current_user),
):
    """List user's video projects, optionally filtered by team. Supports pagination."""
    async with get_session_cm() as session:
        query = select(VideoProject).where(VideoProject.owner_id == user.id).distinct()

        if team_id:
            member_result = await session.execute(
                select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user.id)
            )
            member = member_result.scalar_one_or_none()
            if not member:
                raise HTTPException(status_code=403, detail="Not a member of this team")

            query = select(VideoProject).where(
                or_(VideoProject.owner_id == user.id, VideoProject.team_id == team_id)
            ).distinct()

        count_query = select(func.count()).select_from(query.subquery())
        total_result = await session.execute(count_query)
        total = total_result.scalar() or 0

        query = query.order_by(VideoProject.created_at.desc()).offset(offset).limit(limit)
        result = await session.execute(query)
        projects = result.scalars().all()

    return {
        "projects": [
            {
                "id": p.id,
                "owner_id": p.owner_id,
                "team_id": p.team_id,
                "source_path": p.source_path,
                "original_filename": p.original_filename,
                "duration": p.duration,
                "status": p.status,
                "created_at": p.created_at,
                "clip_count": 0,
            }
            for p in projects
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(projects) < total,
    }


@router.get("/{project_id}")
async def get_project(project_id: str, user: User = Depends(get_current_user)):
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
                "virality_score": c.virality_score,
                "brand_alignment": json.loads(c.brand_alignment) if c.brand_alignment else [],
                "hashtags": json.loads(c.hashtags) if c.hashtags else [],
                "render_path": c.render_path,
            }
            for c in clips
        ],
    }


@router.delete("/{project_id}")
async def delete_project(project_id: str, user: User = Depends(get_current_user)):
    """Delete a video project."""
    async with get_session_cm() as session:
        result = await session.execute(select(VideoProject).where(VideoProject.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.owner_id != user.id:
            raise HTTPException(status_code=403, detail="Access denied")

        await session.delete(project)
        await session.commit()

    return {"success": True}


@router.post("/{project_id}/clips")
async def add_clips_to_project(project_id: str, req: AddClipsRequest, user: User = Depends(get_current_user)):
    """Add clips to a project."""
    async with get_session_cm() as session:
        project = await session.get(VideoProject, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.owner_id != user.id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Add clips to database
        for clip_data in req.clips:
            clip = GeneratedClip(
                project_id=project_id,
                index=clip_data.get("index", 0),
                title=clip_data.get("title", ""),
                start_time=clip_data.get("start", 0),
                end_time=clip_data.get("end", 0),
                reason=clip_data.get("reason"),
                virality_score=clip_data.get("virality_score"),
                brand_alignment=json.dumps(clip_data.get("brand_alignment", [])) if clip_data.get("brand_alignment") else None,
                hashtags=json.dumps(clip_data.get("hashtags", [])) if clip_data.get("hashtags") else None,
            )
            session.add(clip)

        await session.commit()

    return {"success": True}


@router.get("/{project_id}/clips")
async def get_project_clips(project_id: str, user: User = Depends(get_current_user)):
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
                        "virality_score": c.virality_score,
                        "brand_alignment": json.loads(c.brand_alignment) if c.brand_alignment else [],
                        "hashtags": json.loads(c.hashtags) if c.hashtags else [],
                        "render_path": c.render_path,
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
    project_id: str, clip_index: int, req: dict, user: User = Depends(get_current_user)
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
async def get_project_pipeline_state(project_id: str, user: User = Depends(get_current_user)):
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
            "original_filename": project.original_filename,
            "duration": project.duration,
            "status": project.status,
        },
        "transcript": transcript,
        "transcript_cached": transcript_cached,
        "clips": clips,
        "clips_cached": clips_cached,
    }
