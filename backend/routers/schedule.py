"""
Momiji Clipper — Scheduling router.

Endpoints:
- POST /api/schedule — Create scheduled post job
- GET /api/schedule — List post jobs
- GET /api/schedule/{job_id} — Get job details
- PATCH /api/schedule/{job_id} — Update job
- DELETE /api/schedule/{job_id} — Cancel job
"""

import json
import time as _time
from fastapi import APIRouter, HTTPException, Query

from db import PostJob, get_session_cm
from scheduler import schedule_job, cancel_job as cancel_scheduler_job
from pydantic import BaseModel
from sqlalchemy import select

router = APIRouter(prefix="/api/schedule", tags=["Scheduling"])


class SchedulePostRequest(BaseModel):
    clip_key: str
    video_path: str
    title: str
    description: str
    hashtags: list[str]
    platform: str
    platform_account_id: str
    schedule_at: float
    metadata: dict | None = None


class UpdateSchedulePostRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    hashtags: list[str] | None = None
    schedule_at: float | None = None
    metadata: dict | None = None


def _post_job_to_dict(job: PostJob) -> dict:
    """Convert PostJob to dict for JSON response."""
    return {
        "id": job.id,
        "clip_key": job.clip_key,
        "video_path": job.video_path,
        "title": job.title,
        "description": job.description,
        "hashtags": json.loads(job.hashtags) if job.hashtags else [],
        "schedule_at": job.schedule_at,
        "posted_at": job.posted_at,
        "status": job.status,
        "platform": job.platform,
        "platform_account_id": job.platform_account_id,
        "error_message": job.error_message,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


@router.post("")
async def create_schedule_post(req: SchedulePostRequest):
    """Create a new scheduled post job."""
    if req.schedule_at <= _time.time():
        raise HTTPException(status_code=400, detail="schedule_at must be in the future.")

    async with get_session_cm() as session:
        job = PostJob(
            clip_key=req.clip_key,
            video_path=req.video_path,
            title=req.title,
            description=req.description,
            hashtags=json.dumps(req.hashtags),
            platform=req.platform,
            platform_account_id=req.platform_account_id,
            schedule_at=req.schedule_at,
            status="scheduled",
            post_metadata=json.dumps(req.metadata) if req.metadata else None,
        )
        session.add(job)
        try:
            schedule_job(job.id, req.schedule_at)
        except Exception as exc:
            await session.rollback()
            raise
        await session.flush()
        await session.refresh(job)

    return {"job_id": job.id}


@router.get("")
async def list_schedule_posts(
    status: str | None = Query(None),
    platform: str | None = Query(None),
):
    """List post jobs, optionally filtered by status and/or platform."""
    async with get_session_cm() as session:
        query = select(PostJob).order_by(PostJob.schedule_at.desc())
        if status:
            query = query.where(PostJob.status == status)
        if platform:
            query = query.where(PostJob.platform == platform)
        result = await session.execute(query)
        jobs = result.scalars().all()

    return [_post_job_to_dict(j) for j in jobs]


@router.get("/{job_id}")
async def get_schedule_post(job_id: str):
    """Get a single post job by ID."""
    async with get_session_cm() as session:
        result = await session.execute(select(PostJob).where(PostJob.id == job_id))
        job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Post job not found.")
    return _post_job_to_dict(job)


@router.patch("/{job_id}")
async def update_schedule_post(job_id: str, req: UpdateSchedulePostRequest):
    """Update a pending/scheduled post job. Reschedules APScheduler if schedule_at changes."""
    async with get_session_cm() as session:
        job = await session.get(PostJob, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Post job not found.")

        if job.status not in ("pending", "scheduled"):
            raise HTTPException(status_code=400, detail=f"Cannot update job with status {job.status!r}")

        if req.schedule_at is not None:
            if req.schedule_at <= _time.time():
                raise HTTPException(status_code=400, detail="schedule_at must be in the future.")
            job.schedule_at = req.schedule_at
            # Reschedule in APScheduler
            try:
                schedule_job(job_id, req.schedule_at)
            except Exception as exc:
                await session.rollback()
                raise HTTPException(status_code=500, detail=f"Failed to reschedule: {exc}")

        if req.title is not None:
            job.title = req.title
        if req.description is not None:
            job.description = req.description
        if req.hashtags is not None:
            job.hashtags = json.dumps(req.hashtags)
        if req.metadata is not None:
            job.post_metadata = json.dumps(req.metadata)

        await session.commit()
        await session.refresh(job)

    return _post_job_to_dict(job)


@router.delete("/{job_id}")
async def cancel_schedule_post(job_id: str):
    """Cancel a scheduled post job."""
    async with get_session_cm() as session:
        job = await session.get(PostJob, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Post job not found.")

        if job.status not in ("pending", "scheduled"):
            raise HTTPException(status_code=400, detail=f"Cannot cancel job with status {job.status!r}")

        job.status = "cancelled"
        await session.commit()

    # Remove from APScheduler
    cancel_scheduler_job(job_id)

    return {"success": True}
