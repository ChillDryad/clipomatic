"""
Momiji Clipper — Celery tasks for pipeline processing.

Each job is a single `pipeline_chain` task that runs steps sequentially.
This keeps the job atomic and makes round-robin dispatch simpler.
"""

import json
import logging
import os
import sys
import time

# Ensure the backend directory is on sys.path so that
# `from pipeline import ...` and `from db import ...` work
# regardless of how Celery is invoked.
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from celery_app import celery_app
from db import PipelineJob, PipelineEvent, VideoProject, Transcript, GeneratedClip, get_session_cm
from utils.progress import RedisProgressCallback

logger = logging.getLogger(__name__)

WORKSPACE = os.environ.get(
    "WORKSPACE_DIR",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "workspace"),
)

# Status transitions for each pipeline step
_STEP_PROJECT_STATUS = {
    "transcribe": {"running": "transcribing", "done": "transcribed", "failed": "failed"},
    "highlights": {"running": "detecting", "done": "completed", "failed": "failed"},
}


@celery_app.task(bind=True, max_retries=2)
def pipeline_chain(self, job_id: str) -> None:
    """Run a chain of pipeline steps for a PipelineJob."""
    from sqlalchemy import select

    # Load job data from DB (returns plain dicts, not ORM objects)
    result = _load_job(job_id)
    if result is None or result[1] is None:
        logger.error("PipelineJob %s or its project not found", job_id)
        return

    steps_json, current_step, project_data, config = result
    steps = json.loads(steps_json) if isinstance(steps_json, str) else steps_json

    for step_idx in range(current_step, len(steps)):
        step_name = steps[step_idx]

        # Update job state
        _update_job_step(job_id, step_name, step_idx, status="running")

        # Update project status
        status_map = _STEP_PROJECT_STATUS.get(step_name, {})
        _update_project_status_sync(project_data["id"], status_map.get("running", "processing"))

        # Write step_start event
        _write_event_sync(job_id, "step_start", step=step_name)

        # Create step-specific progress callback
        progress_cb = RedisProgressCallback(job_id, step_name)

        try:
            if step_name == "transcribe":
                step_result = _run_transcribe(project_data, config, progress_cb)
            elif step_name == "highlights":
                step_result = _run_highlights(project_data, config, progress_cb)
            else:
                raise ValueError(f"Unknown pipeline step: {step_name}")

            # Step succeeded
            _write_event_sync(job_id, "step_done", step=step_name)
            _update_job_step(job_id, step_name, step_idx, status="done", progress=1.0)
            _update_project_status_sync(project_data["id"], status_map.get("done", "completed"))

            # Advance current_step
            _advance_job(job_id, step_idx + 1)

        except Exception as exc:
            logger.exception("Pipeline step %s failed for job %s: %s", step_name, job_id, exc)
            _write_event_sync(job_id, "error", step=step_name, detail=str(exc))
            _fail_job(job_id, step_name, str(exc))
            _update_project_status_sync(project_data["id"], status_map.get("failed", "failed"))

            # Re-load job to check retry_count
            job_data = _load_job(job_id)
            if job_data:
                # Auto-retry for transient errors
                retryable = isinstance(exc, (TimeoutError, ConnectionError, RuntimeError))
                if retryable:
                    _increment_retry(job_id)
                    raise self.retry(exc=exc, countdown=30)

            return
        finally:
            progress_cb.close()

    # All steps completed
    _complete_job(job_id)
    logger.info("PipelineJob %s completed all steps", job_id)


def _load_job(job_id: str):
    """Load PipelineJob, VideoProject, and config from DB.

    Returns plain dicts to avoid DetachedInstanceError with closed sessions.
    """
    import asyncio
    from sqlalchemy import select

    async def _inner():
        async with get_session_cm() as session:
            result = await session.execute(
                select(PipelineJob).where(PipelineJob.id == job_id)
            )
            job = result.scalar_one_or_none()
            if not job:
                return None, None, None

            result = await session.execute(
                select(VideoProject).where(VideoProject.id == job.project_id)
            )
            project = result.scalar_one_or_none()

            config = json.loads(job.config) if job.config else {}

            # Extract into plain dicts to survive session closure
            project_data = {
                "id": project.id,
                "source_path": project.source_path,
                "original_source": project.original_source,
            }
            return job.steps, job.current_step, project_data, config

    return asyncio.run(_inner())


def _run_transcribe(project_data: dict, config: dict, progress_cb) -> dict:
    """Run the transcribe step."""
    from pipeline import transcription

    source_path = project_data["source_path"]
    video_path = source_path if os.path.exists(source_path) else None
    audio_path = source_path if not video_path else None

    result = transcription.transcribe(
        video_path=video_path,
        output_dir=WORKSPACE,
        model_size=config.get("whisper_model", "large-v3"),
        device=config.get("device", "auto"),
        language=config.get("language"),
        progress_callback=progress_cb,
        audio_path=audio_path,
    )

    # Persist transcript to DB
    _persist_transcript_sync(project_data["id"], source_path, result)

    return result


def _run_highlights(project_data: dict, config: dict, progress_cb) -> list:
    """Run the highlights detection step."""
    from pipeline import highlight_detection
    from utils.helpers import _clips_cache_path

    source_path = project_data["source_path"]
    project_id = project_data["id"]

    # Load transcript from DB first, fall back to file
    transcript_data = _load_transcript_from_db(project_id)
    if not transcript_data:
        stem = os.path.splitext(os.path.basename(source_path))[0]
        transcript_path = os.path.join(WORKSPACE, f"{stem}_transcript.json")
        if not os.path.exists(transcript_path):
            raise FileNotFoundError(f"Transcript not found at {transcript_path}")
        with open(transcript_path, "r", encoding="utf-8") as f:
            transcript_data = json.load(f)

    api_key = os.environ.get("LLM_API_KEY", "")
    base_url = os.environ.get("LLM_BASE_URL", "")
    if not api_key or not base_url:
        raise RuntimeError("LLM_API_KEY and LLM_BASE_URL must be set for highlight detection.")

    timeout_per_chunk = float(os.environ.get("HIGHLIGHT_TIMEOUT_PER_CHUNK", "300"))
    fallback_model = os.environ.get("HIGHLIGHT_FALLBACK_MODEL", "phi3:mini")

    detected_clips = highlight_detection.detect_highlights(
        transcript=transcript_data,
        api_key=api_key,
        base_url=base_url,
        model=config.get("llm_model", "llama3"),
        progress_callback=progress_cb,
        timeout_per_chunk=timeout_per_chunk,
        fallback_model=fallback_model,
    )

    # Write to cache file
    cache_path = _clips_cache_path(source_path)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(detected_clips, f, ensure_ascii=False, indent=2)

    # Persist clips to DB
    _persist_clips_sync(project_id, detected_clips)

    return detected_clips


def _load_transcript_from_db(project_id: str) -> dict | None:
    """Load transcript data from the DB. Returns None if not found."""
    import asyncio
    from sqlalchemy import select

    async def _inner():
        async with get_session_cm() as session:
            result = await session.execute(
                select(Transcript).where(Transcript.project_id == project_id)
            )
            record = result.scalar_one_or_none()
            if not record:
                return None
            return {
                "language": record.language,
                "language_probability": record.language_probability,
                "duration": record.duration,
                "segments": json.loads(record.segments) if isinstance(record.segments, str) else record.segments,
            }

    return asyncio.run(_inner())


def _persist_transcript_sync(project_id: str, source_path: str, result: dict) -> None:
    """Persist transcription result to DB."""
    import asyncio
    from sqlalchemy import select

    async def _inner():
        async with get_session_cm() as session:
            existing = await session.execute(
                select(Transcript).where(Transcript.project_id == project_id)
            )
            transcript_record = existing.scalar_one_or_none()
            if transcript_record:
                transcript_record.language = result.get("language")
                transcript_record.language_probability = result.get("language_probability")
                transcript_record.duration = result.get("duration")
                transcript_record.segments = json.dumps(result.get("segments", []))
            else:
                transcript_record = Transcript(
                    project_id=project_id,
                    source_path=source_path,
                    language=result.get("language"),
                    language_probability=result.get("language_probability"),
                    duration=result.get("duration"),
                    segments=json.dumps(result.get("segments", [])),
                )
                session.add(transcript_record)

    _run_async(_inner)


def _persist_clips_sync(project_id: str, detected_clips: list) -> None:
    """Persist detected clips to DB."""
    import asyncio
    from sqlalchemy import select

    async def _inner():
        async with get_session_cm() as session:
            # Delete existing clips
            existing = await session.execute(
                select(GeneratedClip).where(GeneratedClip.project_id == project_id)
            )
            for old_clip in existing.scalars().all():
                await session.delete(old_clip)

            # Insert new clips
            for idx, clip in enumerate(detected_clips):
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

    _run_async(_inner)


def _update_project_status_sync(project_id: str, status: str) -> None:
    """Update VideoProject status from Celery worker."""
    import asyncio
    from sqlalchemy import select

    async def _inner():
        async with get_session_cm() as session:
            result = await session.execute(
                select(VideoProject).where(VideoProject.id == project_id)
            )
            project = result.scalar_one_or_none()
            if project:
                project.status = status

    _run_async(_inner)


def _update_job_step(job_id: str, step_name: str, step_idx: int, status: str, progress: float = 0.0) -> None:
    """Update PipelineJob step progress and status."""
    import asyncio
    from sqlalchemy import select

    async def _inner():
        async with get_session_cm() as session:
            result = await session.execute(
                select(PipelineJob).where(PipelineJob.id == job_id)
            )
            job = result.scalar_one_or_none()
            if job:
                job.current_step = step_idx
                if status == "running":
                    job.status = "running"
                    job.started_at = job.started_at or time.time()
                job.step_progress = progress
                job.step_label = f"Running {step_name}..."

    _run_async(_inner)


def _advance_job(job_id: str, next_step: int) -> None:
    """Advance PipelineJob to next step index."""
    import asyncio
    from sqlalchemy import select

    async def _inner():
        async with get_session_cm() as session:
            result = await session.execute(
                select(PipelineJob).where(PipelineJob.id == job_id)
            )
            job = result.scalar_one_or_none()
            if job:
                job.current_step = next_step
                job.step_progress = 0.0
                job.step_label = None

    _run_async(_inner)


def _fail_job(job_id: str, step: str, error: str) -> None:
    """Mark PipelineJob as failed."""
    import asyncio
    from sqlalchemy import select

    async def _inner():
        async with get_session_cm() as session:
            result = await session.execute(
                select(PipelineJob).where(PipelineJob.id == job_id)
            )
            job = result.scalar_one_or_none()
            if job:
                job.status = "failed"
                job.failed_step = step
                job.error_message = error
                job.completed_at = time.time()

    _run_async(_inner)


def _complete_job(job_id: str) -> None:
    """Mark PipelineJob as completed."""
    import asyncio
    from sqlalchemy import select

    async def _inner():
        async with get_session_cm() as session:
            result = await session.execute(
                select(PipelineJob).where(PipelineJob.id == job_id)
            )
            job = result.scalar_one_or_none()
            if job:
                job.status = "completed"
                job.step_progress = 1.0
                job.completed_at = time.time()

    _run_async(_inner)


def _increment_retry(job_id: str) -> None:
    """Increment retry count on a PipelineJob."""
    import asyncio
    from sqlalchemy import select

    async def _inner():
        async with get_session_cm() as session:
            result = await session.execute(
                select(PipelineJob).where(PipelineJob.id == job_id)
            )
            job = result.scalar_one_or_none()
            if job:
                job.retry_count += 1

    _run_async(_inner)


def _write_event_sync(job_id: str, event_type: str, step: str = None, progress: float = None, label: str = None, detail: str = None) -> None:
    """Write a PipelineEvent to the DB from a Celery worker."""
    import asyncio

    async def _inner():
        async with get_session_cm() as session:
            event = PipelineEvent(
                job_id=job_id,
                event_type=event_type,
                step=step,
                progress=progress,
                label=label,
                detail=detail,
            )
            session.add(event)

    _run_async(_inner)


def _run_async(coro_func):
    """Helper to run an async function from synchronous Celery worker context.

    Celery workers are synchronous — no running event loop exists.
    We always use asyncio.run() which creates a fresh loop each time.
    """
    import asyncio

    asyncio.run(coro_func())