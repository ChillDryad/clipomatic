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
    
    This runs the full pipeline: ingest (if needed) → transcribe → highlights → export_segments
    """
    import asyncio
    import json
    import time
    from pathlib import Path
    
    from db import get_session_cm, ClipStudioQueue, ClipStudioExport, VideoProject
    from sqlalchemy import select
    from pipeline import renderer
    
    def _run_async(coro):
        return asyncio.run(coro)
    
    async def _inner():
        async with get_session_cm() as session:
            # Load queue item
            result = await session.execute(
                select(ClipStudioQueue).where(ClipStudioQueue.id == queue_item_id)
            )
            queue_item = result.scalar_one_or_none()
            if not queue_item:
                raise ValueError(f"Queue item not found: {queue_item_id}")
            
            # Load project
            proj_result = await session.execute(
                select(VideoProject).where(VideoProject.id == queue_item.project_id)
            )
            project = proj_result.scalar_one_or_none()
            if not project:
                raise ValueError(f"Project not found: {queue_item.project_id}")
            
            # Mark as processing
            queue_item.status = "processing"
            queue_item.started_at = time.time()
            queue_item.current_step = "ingest"
            await session.commit()
            
            # Load config
            config = json.loads(queue_item.config) if isinstance(queue_item.config, str) else queue_item.config
            clip_studio_config = config.get("clip_studio", {})
            
            # Build pipeline config with Clip Studio settings
            pipeline_config = {
                "whisper_model": config.get("whisper_model", "small"),
                "device": config.get("device", "auto"),
                "llm_model": config.get("llm_model", "gemma3:latest"),
                "clip_studio": clip_studio_config,
            }
            
            project_data = {
                "id": project.id,
                "source_path": project.source_path,
            }
            
            # Progress callback
            def progress_cb(fraction: float, label: str):
                queue_item.progress = fraction
                queue_item.step_label = label
                # We can't easily update DB from here without a new session
                # This is handled via events in the actual pipeline
            
            # Run the full pipeline steps
            steps = ["transcribe", "highlights", "export_segments"]
            
            for step_name in steps:
                queue_item.current_step = step_name
                await session.commit()
                
                if step_name == "transcribe":
                    from tasks import _run_transcribe
                    _run_transcribe(project_data, pipeline_config, progress_cb)
                elif step_name == "highlights":
                    from tasks import _run_highlights
                    _run_highlights(project_data, pipeline_config, progress_cb)
                elif step_name == "export_segments":
                    from tasks import _run_export_segments
                    result = _run_export_segments(project_data, pipeline_config, progress_cb)
                    
                    # Update queue item with export results
                    queue_item.status = "completed"
                    queue_item.progress = 1.0
                    queue_item.current_step = "export"
                    queue_item.completed_at = time.time()
                    await session.commit()
                    
                    return {"status": "completed", "exports": result.get("exports", [])}
            
            return {"status": "completed"}
    
    return _run_async(_inner())


# Import tasks so Celery worker discovers them
import tasks  # noqa: E402, F401

