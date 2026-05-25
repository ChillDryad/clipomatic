"""
Queue system for video processing pipeline.
Manages separate queues for download, transcription, and highlight detection.
"""
import asyncio
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict

# Import the pipeline functions
from pipeline.ingestion import download_video
from pipeline.transcription import transcribe
from pipeline.highlight_detection import detect_highlights

logger = logging.getLogger(__name__)


class QueueManager:
    def __init__(
        self,
        num_download_workers: int = 2,
        num_transcription_workers: int = 2,
        num_highlight_workers: int = 2,
    ):
        self.download_queue = asyncio.Queue()
        self.transcription_queue = asyncio.Queue()
        self.highlight_queue = asyncio.Queue()

        self.download_workers = []
        self.transcription_workers = []
        self.highlight_workers = []

        # Total workers across all queues
        total_workers = num_download_workers + num_transcription_workers + num_highlight_workers
        self.executor = ThreadPoolExecutor(max_workers=total_workers)

        self.num_download_workers = num_download_workers
        self.num_transcription_workers = num_transcription_workers
        self.num_highlight_workers = num_highlight_workers

        self.logger = logging.getLogger(__name__)
        self._running = False

    async def start(self):
        """Start all workers."""
        if self._running:
            return
        self._running = True
        self.logger.info("Starting video queue workers...")
        
        # Start download workers
        for i in range(self.num_download_workers):
            worker = asyncio.create_task(
                self._download_worker(f"download-worker-{i}"), name=f"download-worker-{i}"
            )
            self.download_workers.append(worker)

        # Start transcription workers
        for i in range(self.num_transcription_workers):
            worker = asyncio.create_task(
                self._transcription_worker(f"transcription-worker-{i}"),
                name=f"transcription-worker-{i}",
            )
            self.transcription_workers.append(worker)

        # Start highlight workers
        for i in range(self.num_highlight_workers):
            worker = asyncio.create_task(
                self._highlight_worker(f"highlight-worker-{i}"), name=f"highlight-worker-{i}"
            )
            self.highlight_workers.append(worker)

        self.logger.info(
            f"Started {self.num_download_workers} download, "
            f"{self.num_transcription_workers} transcription, "
            f"{self.num_highlight_workers} highlight workers"
        )

    async def stop(self):
        """Stop all workers and shutdown executor."""
        if not self._running:
            return
        self._running = False
        self.logger.info("Stopping video queue workers...")
        
        # Cancel all worker tasks
        all_workers = self.download_workers + self.transcription_workers + self.highlight_workers
        for worker in all_workers:
            worker.cancel()
        
        # Wait for all workers to finish
        if all_workers:
            await asyncio.gather(*all_workers, return_exceptions=True)
        
        self.executor.shutdown(wait=True)
        self.download_workers.clear()
        self.transcription_workers.clear()
        self.highlight_workers.clear()
        self.logger.info("All workers stopped.")

    async def _download_worker(self, name: str):
        """Worker for processing download jobs."""
        while self._running:
            try:
                job = await self.download_queue.get()
                if not self._running:
                    self.download_queue.task_done()
                    break
                self.logger.info(f"{name}: Starting download job for {job.get('video_url')}")
                # Run the blocking download function in a thread pool
                video_path = await asyncio.get_event_loop().run_in_executor(
                    self.executor, self._download_video, job
                )
                self.logger.info(f"{name}: Download completed: {video_path}")

                # Enqueue transcription job
                transcription_job = {
                    "video_path": video_path,
                    "output_dir": job.get("output_dir", os.path.dirname(video_path)),
                    "model_size": job.get("model_size", "large-v3"),
                    "device": job.get("device", "auto"),
                    "language": job.get("language"),
                }
                await self.transcription_queue.put(transcription_job)

            except asyncio.CancelledError:
                self.logger.info(f"{name}: Worker cancelled")
                break
            except Exception as e:
                self.logger.error(f"{name}: Error in download job: {e}", exc_info=True)
            finally:
                self.download_queue.task_done()

    def _download_video(self, job: Dict[str, Any]) -> str:
        """Blocking function to download a video."""
        return download_video(
            job["video_url"],
            job["output_dir"],
            progress_callback=None,
        )

    async def _transcription_worker(self, name: str):
        """Worker for processing transcription jobs."""
        while self._running:
            try:
                job = await self.transcription_queue.get()
                if not self._running:
                    self.transcription_queue.task_done()
                    break
                self.logger.info(f"{name}: Starting transcription job for {job.get('video_path')}")
                # Run the blocking transcription function in a thread pool
                transcript = await asyncio.get_event_loop().run_in_executor(
                    self.executor, self._transcribe_video, job
                )
                self.logger.info(f"{name}: Transcription completed")

                # Enqueue highlight detection job
                highlight_job = {
                    "transcript": transcript,
                    "api_key": job.get("api_key"),
                    "base_url": job.get("base_url"),
                    "model": job.get("model"),
                    "source_path": job.get("video_path"),  # For clip cache
                    "project_id": job.get("project_id"),
                }
                await self.highlight_queue.put(highlight_job)

            except asyncio.CancelledError:
                self.logger.info(f"{name}: Worker cancelled")
                break
            except Exception as e:
                self.logger.error(f"{name}: Error in transcription job: {e}", exc_info=True)
            finally:
                self.transcription_queue.task_done()

    def _transcribe_video(self, job: Dict[str, Any]) -> dict:
        """Blocking function to transcribe a video."""
        return transcribe(
            video_path=job["video_path"],
            output_dir=job["output_dir"],
            model_size=job.get("model_size", "large-v3"),
            device=job.get("device", "auto"),
            language=job.get("language"),
            progress_callback=None,
        )

    async def _highlight_worker(self, name: str):
        """Worker for processing highlight detection jobs."""
        while self._running:
            try:
                job = await self.highlight_queue.get()
                if not self._running:
                    self.highlight_queue.task_done()
                    break
                self.logger.info(f"{name}: Starting highlight detection job")
                # Run the blocking highlight detection function in a thread pool
                clips = await asyncio.get_event_loop().run_in_executor(
                    self.executor, self._detect_highlights, job
                )
                self.logger.info(f"{name}: Highlight detection completed, found {len(clips)} clips")

                # Save clips to database and update project status
                if job.get("project_id"):
                    await self._save_clips_to_database(job["project_id"], clips, job.get("source_path"))

            except asyncio.CancelledError:
                self.logger.info(f"{name}: Worker cancelled")
                break
            except Exception as e:
                self.logger.error(f"{name}: Error in highlight job: {e}", exc_info=True)
            finally:
                self.highlight_queue.task_done()

    def _detect_highlights(self, job: Dict[str, Any]) -> list:
        """Blocking function to detect highlights in a transcript."""
        return detect_highlights(
            transcript=job["transcript"],
            api_key=job["api_key"],
            base_url=job["base_url"],
            model=job["model"],
        )

    async def _save_clips_to_database(self, project_id: str, clips: list, source_path: str):
        """Save detected clips to the database."""
        try:
            from db import get_session_cm, VideoProject, GeneratedClip
            from sqlalchemy import select
            import json
            
            async with get_session_cm() as session:
                # Verify project exists
                result = await session.execute(
                    select(VideoProject).where(VideoProject.id == project_id)
                )
                project = result.scalar_one_or_none()
                if not project:
                    self.logger.error(f"Project {project_id} not found")
                    return

                # Delete existing clips for this project (to avoid duplicates)
                existing_result = await session.execute(
                    select(GeneratedClip).where(GeneratedClip.project_id == project_id)
                )
                for old_clip in existing_result.scalars().all():
                    await session.delete(old_clip)

                # Add new clips
                for idx, clip in enumerate(clips):
                    db_clip = GeneratedClip(
                        project_id=project_id,
                        index=idx,
                        title=clip.get("title", ""),
                        start_time=clip.get("start", 0),
                        end_time=clip.get("end", 0),
                        reason=clip.get("reason"),
                        virality_score=clip.get("virality_score"),
                        band_alignment=json.dumps(clip.get("band_alignment", [])) if clip.get("band_alignment") else None,
                        hashtags=json.dumps(clip.get("hashtags", [])) if clip.get("hashtags") else None,
                    )
                    session.add(db_clip)
                
                # Update project status
                project.status = "completed"
                await session.commit()
                self.logger.info(f"Saved {len(clips)} clips for project {project_id}")

        except Exception as e:
            self.logger.error(f"Error saving clips to database for project {project_id}: {e}", exc_info=True)
            # Try to update project status to failed
            try:
                from db import get_session_cm, VideoProject
                from sqlalchemy import select
                async with get_session_cm() as session:
                    result = await session.execute(
                        select(VideoProject).where(VideoProject.id == project_id)
                    )
                    project = result.scalar_one_or_none()
                    if project:
                        project.status = "failed"
                        await session.commit()
            except Exception as e2:
                self.logger.error(f"Failed to update project status to failed: {e2}")

    # Public methods to enqueue jobs
    async def enqueue_download(self, job: Dict[str, Any]):
        """Enqueue a video download job."""
        await self.download_queue.put(job)

    async def enqueue_transcription(self, job: Dict[str, Any]):
        """Enqueue a video transcription job."""
        await self.transcription_queue.put(job)

    async def enqueue_highlight(self, job: Dict[str, Any]):
        """Enqueue a highlight detection job."""
        await self.highlight_queue.put(job)


# Global queue manager instance
queue_manager = QueueManager()
