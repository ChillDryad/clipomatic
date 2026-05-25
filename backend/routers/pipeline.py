"""
Momiji Clipper — Pipeline queue router.

Endpoints for enqueuing, monitoring, and controlling automated pipeline jobs.
"""

import asyncio
import json
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select

from auth import get_current_user
from db import (
    PipelineJob,
    PipelineEvent,
    User,
    VideoProject,
    get_session,
)
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pipeline", tags=["Pipeline Queue"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class EnqueueRequest(BaseModel):
    project_id: str
    steps: list[str] | None = None  # Default: ["transcribe", "highlights"]
    config: dict | None = None  # Default: current user preferences


class RetryRequest(BaseModel):
    config: dict | None = None  # Optional config override


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/enqueue")
async def enqueue_job(
    req: EnqueueRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Enqueue a project for automated pipeline processing."""
    # Verify project exists and belongs to user
    result = await db.execute(
        select(VideoProject).where(
            VideoProject.id == req.project_id,
            VideoProject.owner_id == user.id,
        )
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found or access denied.")

    # Only enqueue projects that are in a valid state
    if project.status not in ("loaded", "transcribed", "queued", "failed", "cancelled"):
        raise HTTPException(
            status_code=400,
            detail=f"Project status '{project.status}' is not enqueueable. Expected 'loaded', 'transcribed', 'failed', or 'cancelled'.",
        )

    steps = req.steps or ["transcribe", "highlights"]
    # Filter steps based on current state: if already transcribed, skip transcribe
    if project.status == "transcribed" and "transcribe" in steps:
        steps = [s for s in steps if s != "transcribe"]

    if not steps:
        raise HTTPException(status_code=400, detail="No steps to run.")

    # Build config snapshot
    config = req.config or _default_config()

    job = PipelineJob(
        project_id=req.project_id,
        owner_id=user.id,
        steps=json.dumps(steps),
        config=json.dumps(config),
        status="queued",
        queued_at=time.time(),
    )
    db.add(job)

    # Update project status
    project.status = "queued"

    await db.commit()
    await db.refresh(job)

    return {"job_id": job.id, "status": "queued", "steps": steps}


@router.get("/jobs")
async def list_jobs(
    status: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """List pipeline jobs for the current user."""
    query = select(PipelineJob).where(PipelineJob.owner_id == user.id)
    count_query = select(func.count()).select_from(PipelineJob).where(PipelineJob.owner_id == user.id)

    if status:
        query = query.where(PipelineJob.status == status)
        count_query = count_query.where(PipelineJob.status == status)

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = query.order_by(PipelineJob.queued_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    jobs = result.scalars().all()

    return {
        "jobs": [_job_to_dict(j) for j in jobs],
        "total": total,
        "has_more": offset + limit < total,
    }


@router.get("/jobs/{job_id}")
async def get_job(
    job_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Get pipeline job details."""
    result = await db.execute(
        select(PipelineJob).where(PipelineJob.id == job_id, PipelineJob.owner_id == user.id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return _job_to_dict(job)


@router.get("/jobs/{job_id}/events")
async def get_job_events(
    job_id: str,
    since: float = Query(0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Get progress events for a job since a given timestamp."""
    # Verify ownership
    result = await db.execute(
        select(PipelineJob.id).where(PipelineJob.id == job_id, PipelineJob.owner_id == user.id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Job not found.")

    result = await db.execute(
        select(PipelineEvent)
        .where(PipelineEvent.job_id == job_id, PipelineEvent.created_at > since)
        .order_by(PipelineEvent.created_at.asc())
    )
    events = result.scalars().all()

    return {
        "events": [
            {
                "id": e.id,
                "event_type": e.event_type,
                "step": e.step,
                "progress": e.progress,
                "label": e.label,
                "detail": e.detail,
                "created_at": e.created_at,
            }
            for e in events
        ],
    }


@router.get("/jobs/{job_id}/stream")
async def stream_job_progress(
    job_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """SSE stream for real-time job progress via Redis Pub/Sub."""
    # Verify ownership
    result = await db.execute(
        select(PipelineJob).where(PipelineJob.id == job_id, PipelineJob.owner_id == user.id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    from fastapi.responses import StreamingResponse

    return StreamingResponse(
        _job_sse_generator(job_id, job.status),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _job_sse_generator(job_id: str, job_status: str):
    """Generate SSE events from Redis Pub/Sub for a job."""
    import os
    import redis.asyncio as aioredis

    # If job is already done, replay stored events and close
    if job_status in ("completed", "failed", "cancelled"):
        yield _sse({"status": job_status, "done": True})
        return

    # Subscribe to Redis channel
    broker_url = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
    r = aioredis.from_url(broker_url, decode_responses=True)
    pubsub = r.pubsub()
    channel = f"pipeline:{job_id}"
    await pubsub.subscribe(channel)

    try:
        while True:
            message = await pubsub.get_message(
                ignore_subscribe_messages=True, timeout=1.0
            )
            if message and message["type"] == "message":
                data = message["data"]
                if isinstance(data, str):
                    try:
                        event = json.loads(data)
                        yield _sse(event)
                    except json.JSONDecodeError:
                        pass
            else:
                # Send heartbeat
                yield _sse({"heartbeat": True})

            # Check if job is still running
            async with get_session() as session:
                result = await session.execute(
                    select(PipelineJob.status).where(PipelineJob.id == job_id)
                )
                status = result.scalar_one_or_none()
                if status in ("completed", "failed", "cancelled", "paused"):
                    yield _sse({"status": status, "done": True})
                    break
    finally:
        await pubsub.unsubscribe(channel)
        await r.close()


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Cancel a queued or running job."""
    result = await db.execute(
        select(PipelineJob).where(PipelineJob.id == job_id, PipelineJob.owner_id == user.id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.status not in ("queued", "running"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel job with status '{job.status}'.")

    # Revoke Celery task if running
    if job.celery_task_id:
        from celery_app import celery_app
        celery_app.control.revoke(job.celery_task_id, terminate=True)

    job.status = "cancelled"
    job.completed_at = time.time()

    # Revert project status to last completed step
    result = await db.execute(
        select(VideoProject).where(VideoProject.id == job.project_id)
    )
    project = result.scalar_one_or_none()
    if project:
        steps = json.loads(job.steps)
        if job.current_step > 0:
            # Completed steps determine the project status
            last_step = steps[min(job.current_step - 1, len(steps) - 1)]
            project.status = "transcribed" if last_step == "transcribe" else "loaded"
        else:
            project.status = "loaded"

    await db.commit()
    return {"status": "cancelled"}


@router.post("/jobs/{job_id}/retry")
async def retry_job(
    job_id: str,
    req: RetryRequest | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Retry a failed job."""
    result = await db.execute(
        select(PipelineJob).where(PipelineJob.id == job_id, PipelineJob.owner_id == user.id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.status not in ("failed", "cancelled"):
        raise HTTPException(status_code=400, detail="Can only retry failed or cancelled jobs.")

    # Optionally override config
    if req and req.config:
        job.config = json.dumps(req.config)

    # Reset to queued from the failed step
    job.status = "queued"
    job.error_message = None
    job.failed_step = None
    job.celery_task_id = None
    job.queued_at = time.time()

    # Update project status
    result = await db.execute(
        select(VideoProject).where(VideoProject.id == job.project_id)
    )
    project = result.scalar_one_or_none()
    if project:
        project.status = "queued"

    await db.commit()
    return {"job_id": job.id, "status": "queued"}


@router.post("/jobs/{job_id}/pause")
async def pause_job(
    job_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Pause a running job (completes current step, then pauses)."""
    result = await db.execute(
        select(PipelineJob).where(PipelineJob.id == job_id, PipelineJob.owner_id == user.id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.status != "running":
        raise HTTPException(status_code=400, detail="Can only pause running jobs.")

    job.auto_advance = False
    await db.commit()
    return {"status": "running", "auto_advance": False}


@router.post("/jobs/{job_id}/resume")
async def resume_job(
    job_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Resume a paused job."""
    result = await db.execute(
        select(PipelineJob).where(PipelineJob.id == job_id, PipelineJob.owner_id == user.id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.status != "paused":
        raise HTTPException(status_code=400, detail="Can only resume paused jobs.")

    job.status = "queued"
    job.auto_advance = True
    job.queued_at = time.time()

    # Update project status
    result = await db.execute(
        select(VideoProject).where(VideoProject.id == job.project_id)
    )
    project = result.scalar_one_or_none()
    if project:
        project.status = "queued"

    await db.commit()
    return {"job_id": job.id, "status": "queued"}


@router.get("/queue")
async def queue_status(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    """Global queue status."""
    # Get dispatcher status
    dispatcher = request.app.state.pipeline_dispatcher if hasattr(request.app.state, "pipeline_dispatcher") else None
    dispatcher_info = dispatcher.get_queue_status() if dispatcher else {}

    # Count queued jobs
    queued_result = await db.execute(
        select(func.count()).select_from(PipelineJob).where(PipelineJob.status == "queued")
    )
    queued_count = queued_result.scalar() or 0

    # Count running jobs
    running_result = await db.execute(
        select(func.count()).select_from(PipelineJob).where(PipelineJob.status == "running")
    )
    running_count = running_result.scalar() or 0

    # Per-user breakdown
    user_counts_result = await db.execute(
        select(PipelineJob.owner_id, PipelineJob.status, func.count())
        .where(PipelineJob.status.in_(["queued", "running"]))
        .group_by(PipelineJob.owner_id, PipelineJob.status)
    )
    per_user = {}
    for owner_id, status, count in user_counts_result:
        if owner_id not in per_user:
            per_user[owner_id] = {}
        per_user[owner_id][status] = count

    return {
        "queued": queued_count,
        "running": running_count,
        "per_user": per_user,
        "dispatcher": dispatcher_info,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _job_to_dict(job: PipelineJob) -> dict:
    """Convert a PipelineJob to a dict for API responses."""
    return {
        "id": job.id,
        "project_id": job.project_id,
        "owner_id": job.owner_id,
        "steps": json.loads(job.steps) if isinstance(job.steps, str) else job.steps,
        "current_step": job.current_step,
        "status": job.status,
        "config": json.loads(job.config) if isinstance(job.config, str) else job.config,
        "step_progress": job.step_progress,
        "step_label": job.step_label,
        "error_message": job.error_message,
        "failed_step": job.failed_step,
        "retry_count": job.retry_count,
        "priority": job.priority,
        "queued_at": job.queued_at,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
        "auto_advance": job.auto_advance,
        "created_at": job.created_at,
    }


def _default_config() -> dict:
    """Build default config from environment variables."""
    import os

    return {
        "whisper_model": os.environ.get("WHISPER_MODEL", "large-v3"),
        "device": os.environ.get("WHISPER_DEVICE", "auto"),
        "llm_model": os.environ.get("LLM_MODEL", "llama3"),
    }


def _sse(data: Any) -> str:
    """Format data as SSE event string."""
    return f"data: {json.dumps(data)}\n\n"