"""
Momiji Clipper — Redis Pub/Sub progress callback for Celery tasks.

Publishes progress to Redis channel for real-time SSE streaming,
and writes throttled PipelineEvent records to the DB for disconnected catch-up.
"""

import json
import logging
import time

import redis

logger = logging.getLogger(__name__)


class RedisProgressCallback:
    """Progress callback that publishes to Redis Pub/Sub and writes to DB."""

    def __init__(self, job_id: str, step: str, redis_url: str = None):
        self.job_id = job_id
        self.step = step
        self._last_db_write = 0.0
        self._db_throttle = 1.0  # Write to DB at most every 1 second
        self._redis = None
        self._redis_url = redis_url

    def _get_redis(self):
        if self._redis is None:
            import os
            url = self._redis_url or os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
            # Parse broker URL to get Redis host/port/db, then use db 0 for pub/sub
            self._redis = redis.Redis.from_url(url, decode_responses=True)
        return self._redis

    def __call__(self, fraction: float, label: str) -> None:
        # Publish to Redis channel (instant, for SSE streaming)
        try:
            r = self._get_redis()
            r.publish(
                f"pipeline:{self.job_id}",
                json.dumps({"progress": fraction, "label": label, "step": self.step}),
            )
        except Exception as exc:
            logger.debug("Redis publish failed: %s", exc)

        # Throttled DB write for disconnected catch-up
        now = time.time()
        if now - self._last_db_write >= self._db_throttle:
            self._write_event(fraction, label)
            self._last_db_write = now

    def _write_event(self, fraction: float, label: str) -> None:
        """Write a PipelineEvent and update PipelineJob progress in the DB."""
        try:
            import asyncio
            from db import PipelineJob, PipelineEvent, get_session_cm

            async def _persist():
                async with get_session_cm() as session:
                    from sqlalchemy import select

                    result = await session.execute(
                        select(PipelineJob).where(PipelineJob.id == self.job_id)
                    )
                    job = result.scalar_one_or_none()
                    if job:
                        job.step_progress = fraction
                        job.step_label = label
                        event = PipelineEvent(
                            job_id=self.job_id,
                            event_type="progress",
                            step=self.step,
                            progress=fraction,
                            label=label,
                        )
                        session.add(event)

            # Run the async DB write synchronously from the Celery worker
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    # We're inside an async context already — schedule as task
                    asyncio.ensure_future(_persist())
                else:
                    loop.run_until_complete(_persist())
            except RuntimeError:
                # No event loop — create one
                asyncio.run(_persist())
        except Exception as exc:
            logger.debug("Failed to write progress event to DB: %s", exc)

    def close(self) -> None:
        """Clean up Redis connection."""
        if self._redis is not None:
            try:
                self._redis.close()
            except Exception:
                pass