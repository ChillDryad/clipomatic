"""
Momiji Clipper — Pipeline Dispatcher.

Polls PipelineJob rows and dispatches to Celery with strict round-robin
fairness between users. Runs as an asyncio background task in the FastAPI process.
"""

import asyncio
import json
import logging
import os
import time
from collections import defaultdict

from db import PipelineJob, VideoProject, get_session_cm
from sqlalchemy import select

logger = logging.getLogger(__name__)


class PipelineDispatcher:
    """Polls queued PipelineJob rows and dispatches to Celery with round-robin fairness."""

    def __init__(
        self,
        max_gpu_concurrency: int | None = None,
        max_cpu_concurrency: int | None = None,
        max_per_user: int | None = None,
    ):
        self._max_gpu = max_gpu_concurrency or int(os.environ.get("PIPELINE_GPU_CONCURRENCY", "1"))
        self._max_cpu = max_cpu_concurrency or int(os.environ.get("PIPELINE_CPU_CONCURRENCY", "2"))
        self._max_per_user = max_per_user or int(os.environ.get("PIPELINE_MAX_PER_USER", "2"))
        self._poll_interval = 2.0
        self._running = False
        self._task: asyncio.Task | None = None
        # Track active jobs: job_id → {owner_id, resource_type}
        self._active_jobs: dict[str, dict] = {}

    async def start(self) -> None:
        """Start the dispatch loop."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._poll_loop())
        await self._recover_jobs()
        logger.info("PipelineDispatcher started (gpu=%d, cpu=%d, per_user=%d)", self._max_gpu, self._max_cpu, self._max_per_user)

    async def stop(self) -> None:
        """Stop the dispatch loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("PipelineDispatcher stopped")

    async def _poll_loop(self) -> None:
        """Main loop: poll queued jobs and dispatch with fairness."""
        while self._running:
            try:
                await self._dispatch_next()
            except Exception as exc:
                logger.exception("Dispatcher error: %s", exc)
            await asyncio.sleep(self._poll_interval)

    async def _dispatch_next(self) -> None:
        """Select and dispatch the next eligible job(s) to Celery."""
        async with get_session_cm() as session:
            # Get all queued jobs ordered by priority then time
            result = await session.execute(
                select(PipelineJob)
                .where(PipelineJob.status == "queued")
                .order_by(PipelineJob.priority.desc(), PipelineJob.queued_at.asc())
            )
            queued_jobs = result.scalars().all()

            if not queued_jobs:
                return

            # Refresh active job tracking from DB (in case tasks completed)
            await self._refresh_active(session)

            # Count running jobs per user
            user_active = defaultdict(int)
            gpu_running = 0
            cpu_running = 0
            for job_id, info in self._active_jobs.items():
                user_active[info["owner_id"]] += 1
                if info["resource"] == "gpu":
                    gpu_running += 1
                else:
                    cpu_running += 1

            # Try to dispatch jobs while capacity exists
            dispatched = set(j["job_id"] for j in self._active_jobs.values())
            to_dispatch = []
            for job in queued_jobs:
                if job.id in dispatched:
                    continue
                # Check per-user limit
                if user_active[job.owner_id] >= self._max_per_user:
                    continue

                # Determine resource type from steps
                resource = self._job_resource_type(job)

                # Check resource capacity
                if resource == "gpu" and gpu_running >= self._max_gpu:
                    continue
                if resource == "cpu" and cpu_running >= self._max_cpu:
                    continue

                # Mark as running and track for dispatch
                job.status = "running"
                job.started_at = time.time()
                to_dispatch.append((job.id, job.owner_id, resource))
                dispatched.add(job.id)
                user_active[job.owner_id] += 1
                if resource == "gpu":
                    gpu_running += 1
                else:
                    cpu_running += 1

            # Session commits here (on exit of async with) before we dispatch to Celery.
            # This ensures the Celery task sees status='running' in the DB.

        # Dispatch to Celery AFTER commit so tasks don't read stale data
        for job_id, owner_id, resource in to_dispatch:
            await self._dispatch_to_celery(job_id, owner_id, resource)

    async def _dispatch_to_celery(self, job_id: str, owner_id: str, resource: str) -> None:
        """Send a job to Celery for execution (DB already updated)."""
        from tasks import pipeline_chain

        result = pipeline_chain.delay(job_id)

        # Store Celery task ID back to DB
        async with get_session_cm() as session:
            db_result = await session.execute(
                select(PipelineJob).where(PipelineJob.id == job_id)
            )
            job = db_result.scalar_one_or_none()
            if job:
                job.celery_task_id = result.id

        # Track as active
        self._active_jobs[job_id] = {
            "job_id": job_id,
            "owner_id": owner_id,
            "resource": resource,
            "celery_task_id": result.id,
            "started_at": time.time(),
        }

        logger.info("Dispatched job %s (task %s) for user %s", job_id, result.id, owner_id)

    async def _refresh_active(self, session) -> None:
        """Remove completed jobs from active tracking."""
        stale = []
        for job_id, info in self._active_jobs.items():
            result = await session.execute(
                select(PipelineJob.status).where(PipelineJob.id == job_id)
            )
            status = result.scalar_one_or_none()
            if status in ("completed", "failed", "cancelled", "paused"):
                stale.append(job_id)
        for job_id in stale:
            del self._active_jobs[job_id]

    def _job_resource_type(self, job: PipelineJob) -> str:
        """Determine if a job needs GPU (transcribe) or only CPU (highlights)."""
        steps = json.loads(job.steps) if isinstance(job.steps, str) else job.steps
        if "transcribe" in steps:
            return "gpu"
        return "cpu"

    async def _recover_jobs(self) -> None:
        """Recover jobs on startup: mark any 'running' jobs as failed (server restarted)."""
        async with get_session_cm() as session:
            result = await session.execute(
                select(PipelineJob).where(PipelineJob.status == "running")
            )
            running = result.scalars().all()
            for job in running:
                job.status = "failed"
                job.error_message = "Server restarted during processing"
                job.completed_at = time.time()
                # Don't increment retry_count — let the user retry manually
                logger.info("Recovered job %s: marked as failed (server restart)", job.id)

    def get_active_count(self) -> int:
        """Return number of currently active (running) jobs."""
        return len(self._active_jobs)

    def get_queue_status(self) -> dict:
        """Return queue status summary."""
        return {
            "active": len(self._active_jobs),
            "max_gpu": self._max_gpu,
            "max_cpu": self._max_cpu,
            "max_per_user": self._max_per_user,
            "active_jobs": {jid: info for jid, info in self._active_jobs.items()},
        }