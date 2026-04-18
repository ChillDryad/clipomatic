"""
Momiji Clipper — Post-scheduling worker.

APScheduler BackgroundScheduler runs in the same FastAPI process.
Jobs are persisted in the DB (PostJob rows) so they survive restarts.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.date import DateTrigger

from db import PostJob, SessionContextManager

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Scheduler singleton
# ---------------------------------------------------------------------------

_scheduler = BackgroundScheduler(timezone=timezone.utc)


def start_scheduler() -> None:
    if not _scheduler.running:
        _scheduler.start()
        logger.info("APScheduler started.")


def stop_scheduler() -> None:
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("APScheduler stopped.")


def schedule_job(job_id: str, run_at: float) -> None:
    """Register (or re-register) a PostJob with APScheduler to fire at run_at."""
    run_dt = datetime.fromtimestamp(run_at, tz=timezone.utc)
    # Remove any existing entry for this job_id first
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)
    _scheduler.add_job(
        _execute_post,
        trigger=DateTrigger(run_date=run_dt),
        id=job_id,
        args=[job_id],
        replace_existing=True,
    )


def cancel_job(job_id: str) -> None:
    """Remove a PostJob from APScheduler (does not change DB status)."""
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)


async def _execute_post(job_id: str) -> None:
    """
    Async worker called by APScheduler at trigger time.

    1. Load the PostJob row from the DB.
    2. Load the OAuth token for the platform account.
    3. Check token expiry; refresh if needed.
    4. Call the appropriate platform adapter to upload the video.
    5. Update the PostJob row: status='posted', posted_at=now, or status='failed'.
    """
    logger.info("Executing post job: %s", job_id)

    async with SessionContextManager() as session:
        from sqlalchemy import select
        from sqlalchemy.orm import joinedload

        # Import here to avoid top-level circular import
        from db import PlatformAccount

        result = await session.execute(
            select(PostJob)
            .options(joinedload(PostJob.account).joinedload(PlatformAccount.tokens))
            .where(PostJob.id == job_id)
        )
        job: PostJob | None = result.scalar_one_or_none()

        if not job:
            logger.error("PostJob %s not found", job_id)
            return

        if job.status == "cancelled":
            logger.info("Job %s was cancelled, skipping.", job_id)
            return

        # Lazily import here to avoid circular imports at module load time
        from platforms import get_adapter

        platform = job.platform
        adapter = get_adapter(platform)

        # Get the active token for this account
        account = job.account
        if not account:
            job.status = "failed"
            job.error_message = f"No platform account configured for job {job_id}"
            await session.commit()
            return

        token_row = None
        for tok in account.tokens:
            if tok.access_token:
                token_row = tok
                break

        if not token_row:
            job.status = "failed"
            job.error_message = f"No OAuth token found for account {account.id}"
            await session.commit()
            return

        # Decrypt OAuth token before use
        from auth import decrypt_oauth_token
        access_token = decrypt_oauth_token(token_row.access_token)

        # Check expiry
        now = time.time()
        if token_row.expires_at and token_row.expires_at - 60 < now:
            logger.info("Token expired, refreshing for job %s", job_id)
            try:
                new_token = await adapter.refresh_token(token_row, access_token)
                from auth import encrypt_oauth_token
                token_row.access_token = encrypt_oauth_token(new_token["access_token"])
                if new_token.get("refresh_token"):
                    token_row.refresh_token = encrypt_oauth_token(new_token["refresh_token"]) if new_token["refresh_token"] else None
                if new_token.get("expires_at"):
                    token_row.expires_at = new_token["expires_at"]
                await session.commit()
                access_token = new_token["access_token"]  # Use fresh token
            except Exception as exc:
                job.status = "failed"
                job.error_message = f"Token refresh failed: {exc}"
                await session.commit()
                return

        # Upload
        try:
            import json
            hashtags = json.loads(job.hashtags) if job.hashtags else []
            result_url = await adapter.upload(
                video_path=job.video_path,
                title=job.title,
                description=job.description,
                hashtags=hashtags,
                post_metadata=json.loads(job.post_metadata) if job.post_metadata else {},
                token=access_token,
            )
            job.status = "posted"
            job.posted_at = time.time()
            job.post_metadata = json.dumps({**json.loads(job.post_metadata or "{}"), "post_url": result_url})
            await session.commit()
            logger.info("Job %s posted successfully: %s", job_id, result_url)
        except Exception as exc:
            job.status = "failed"
            job.error_message = str(exc)
            await session.commit()
            logger.exception("Job %s failed: %s", job_id, exc)


async def recover_scheduled_jobs() -> None:
    """
    On startup, re-register all 'scheduled' PostJobs with APScheduler.

    Called from the FastAPI lifespan on startup so that jobs survive process restarts.
    """
    async with SessionContextManager() as session:
        from sqlalchemy import select

        result = await session.execute(
            select(PostJob).where(
                PostJob.status == "scheduled",
                PostJob.schedule_at > time.time(),
            )
        )
        jobs = result.scalars().all()
        for job in jobs:
            try:
                schedule_job(job.id, job.schedule_at)
                logger.info("Recovered scheduled job: %s (fires at %s)", job.id, job.schedule_at)
            except Exception as exc:
                logger.error("Failed to recover job %s: %s. Setting status to failed.", job.id, exc)
                job.status = "failed"
                job.error_message = f"Scheduler recovery failed: {exc}"
                await session.commit()
