"""
Momiji Clipper — Celery app configuration.

Redis is used as both broker and result backend.
Broker DB 0, Result backend DB 1 (to avoid key collisions).
"""

import os
import sys

# Ensure the backend directory is on sys.path before any imports
# so that `from pipeline import ...` and `from db import ...` work.
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from celery import Celery
from celery.signals import worker_process_init

celery_app = Celery(
    "momiji",
    broker=os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0"),
    backend=os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/1"),
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    worker_prefetch_multiplier=1,
)


@worker_process_init.connect
def _ensure_path_in_worker(**kwargs):
    """Re-ensure sys.path is correct in each forked worker process."""
    if _BACKEND_DIR not in sys.path:
        sys.path.insert(0, _BACKEND_DIR)


@celery_app.task(bind=True, name="pipeline.process_clip_studio")
def process_clip_studio_task(self, queue_item_id: str) -> dict:
    """
    Celery task to process a Clip Studio queue item.

    Mirrors pipeline_chain pattern: pure sync, no asyncio.run wrapper.
    Uses the same _run_transcribe / _run_highlights / _run_export_segments
    functions, which handle their own async DB calls via _run_async().

    Pipeline steps: transcribe → highlights → export_segments
    """
    import json
    import logging
    import time

    from db import ClipStudioQueue, VideoProject
    from sqlalchemy import select
    from tasks import _run_async, _run_transcribe, _run_highlights, _run_export_segments

    logger = logging.getLogger(__name__)

    # Load queue item (sync, via _run_async)
    def _load_queue():
        async def _inner():
            from db import get_session_cm
            async with get_session_cm() as session:
                result = await session.execute(
                    select(ClipStudioQueue).where(ClipStudioQueue.id == queue_item_id)
                )
                item = result.scalar_one_or_none()
                if not item:
                    return None
                return {
                    "id": item.id,
                    "project_id": item.project_id,
                    "config": json.loads(item.config) if isinstance(item.config, str) else item.config,
                    "status": item.status,
                }
        return _run_async(_inner)

    queue_data = _load_queue()
    if not queue_data:
        raise ValueError(f"Queue item not found: {queue_item_id}")

    # Load project (sync, via _run_async)
    def _load_project():
        async def _inner():
            from db import get_session_cm
            async with get_session_cm() as session:
                result = await session.execute(
                    select(VideoProject).where(VideoProject.id == queue_data["project_id"])
                )
                project = result.scalar_one_or_none()
                if not project:
                    return None
                return {
                    "id": project.id,
                    "source_path": project.source_path,
                }
        return _run_async(_inner)

    project_data = _load_project()
    if not project_data:
        raise ValueError(f"Project not found: {queue_data['project_id']}")

    # Mark as processing (sync, via _run_async)
    def _mark_processing(step):
        async def _inner():
            from db import get_session_cm
            async with get_session_cm() as session:
                result = await session.execute(
                    select(ClipStudioQueue).where(ClipStudioQueue.id == queue_item_id)
                )
                item = result.scalar_one_or_none()
                if item:
                    item.status = "processing"
                    item.started_at = item.started_at or time.time()
                    item.current_step = step
        _run_async(_inner)

    # Mark completed (sync, via _run_async)
    def _mark_completed():
        async def _inner():
            from db import get_session_cm
            async with get_session_cm() as session:
                result = await session.execute(
                    select(ClipStudioQueue).where(ClipStudioQueue.id == queue_item_id)
                )
                item = result.scalar_one_or_none()
                if item:
                    item.status = "completed"
                    item.progress = 1.0
                    item.current_step = "export"
                    item.completed_at = time.time()
        _run_async(_inner)

    # Mark failed (sync, via _run_async)
    def _mark_failed(error_msg):
        async def _inner():
            from db import get_session_cm
            async with get_session_cm() as session:
                result = await session.execute(
                    select(ClipStudioQueue).where(ClipStudioQueue.id == queue_item_id)
                )
                item = result.scalar_one_or_none()
                if item:
                    item.status = "failed"
                    item.error_message = error_msg
                    item.completed_at = time.time()
        _run_async(_inner)

    # Build pipeline config
    config = queue_data["config"]
    clip_studio_config = config.get("clip_studio", {})
    pipeline_config = {
        "whisper_model": config.get("whisper_model", "small"),
        "device": config.get("device", "auto"),
        "llm_model": config.get("llm_model", os.environ.get("HIGHLIGHT_LLM_MODEL", "gemma4:12b")),
        "clip_studio": clip_studio_config,
    }

    # Simple progress callback (updates queue item progress)
    def progress_cb(fraction: float, label: str):
        async def _inner():
            from db import get_session_cm
            async with get_session_cm() as session:
                result = await session.execute(
                    select(ClipStudioQueue).where(ClipStudioQueue.id == queue_item_id)
                )
                item = result.scalar_one_or_none()
                if item:
                    item.progress = fraction
                    item.step_label = label
        _run_async(_inner)

    # Run pipeline steps (same as pipeline_chain — pure sync)
    steps = ["transcribe", "highlights", "export_segments"]

    for step_name in steps:
        logger.info("Clip Studio %s: starting step %s", queue_item_id[:8], step_name)
        _mark_processing(step_name)

        try:
            if step_name == "transcribe":
                _run_transcribe(project_data, pipeline_config, progress_cb)
            elif step_name == "highlights":
                _run_highlights(project_data, pipeline_config, progress_cb)
            elif step_name == "export_segments":
                result = _run_export_segments(project_data, pipeline_config, progress_cb)
                _mark_completed()
                logger.info("Clip Studio %s: completed with %d exports",
                            queue_item_id[:8], len(result.get("exports", [])))
                return {"status": "completed", "exports": result.get("exports", [])}

            logger.info("Clip Studio %s: step %s done", queue_item_id[:8], step_name)

        except Exception as exc:
            logger.exception("Clip Studio %s: step %s failed: %s", queue_item_id[:8], step_name, exc)
            _mark_failed(str(exc))
            raise

    return {"status": "completed"}


# Import tasks so Celery worker discovers them
import tasks  # noqa: E402, F401