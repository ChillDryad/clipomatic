# WORKING.md - Clipomatic Re-tool for Clips Studio Workflow

## Status: COMPLETE

## What Changed

### Backend

1. **`backend/db.py`** — Added two new models:
   - `ClipStudioQueue` — Batch queue for Clip Studio processing (project_id, owner_id, status, config, progress, steps)
   - `ClipStudioExport` — Individual exported clip segments with full metadata (codec, resolution, bitrate, file size, export quality)

2. **`backend/pipeline/renderer.py`** — Added Clip Studio export functions:
   - `ClipStudioExportConfig` — Dataclass for export settings (quality, format, metadata, EDL)
   - `_QUALITY_SETTINGS_CLIP_STUDIO` — Three quality presets: source (stream copy), visually_lossless (CRF 12), high (CRF 18)
   - `export_source_quality_segments()` — Main export function. Takes video path + clips list, exports each segment at source quality with FFmpeg stream copy. Falls back to re-encode if stream copy fails. Probes source and exported files for metadata. Writes per-clip JSON metadata files.
   - `_generate_edl()` — CMX 3600 EDL generator for DaVinci/Premiere import
   - `_seconds_to_timecode()` — Timecode helper

3. **`backend/tasks.py`** — Added `export_segments` pipeline step:
   - `_run_export_segments()` — Loads clips from DB/cache, creates ClipStudioExportConfig, calls renderer.export_source_quality_segments()
   - `_load_clips_from_db()` — Helper to load clips from GeneratedClip table
   - `_persist_clip_studio_exports_sync()` — Persists export results to ClipStudioExport table
   - Updated `_STEP_PROJECT_STATUS` to include `export_segments` step

4. **`backend/celery_app.py`** — Added `process_clip_studio_task` Celery task:
   - Runs full pipeline: transcribe → highlights → export_segments
   - Updates ClipStudioQueue status/progress throughout

5. **`backend/routers/pipeline.py`** — Added Clip Studio API endpoints:
   - `POST /api/pipeline/clip-studio/enqueue` — Batch enqueue multiple projects
   - `GET /api/pipeline/clip-studio/queue` — List queue items with exports
   - `GET /api/pipeline/clip-studio/queue/{id}` — Get single item with exports
   - `POST /api/pipeline/clip-studio/queue/{id}/cancel` — Cancel queued/processing item

6. **`backend/pipeline_dispatcher.py`** — Added Clip Studio dispatching:
   - `_dispatch_clip_studio()` — Polls queued ClipStudioQueue items, dispatches to Celery
   - `_dispatch_clip_studio_to_celery()` — Sends to `process_clip_studio_task`
   - Updated `_refresh_active()` to track `cs_` prefixed job IDs
   - Updated `_recover_jobs()` to recover Clip Studio items on restart

### Frontend

7. **`frontend/src/api.ts`** — Added Clip Studio API functions:
   - `ClipStudioExport` and `ClipStudioQueueItem` TypeScript interfaces
   - `enqueueClipStudio()`, `listClipStudioQueue()`, `getClipStudioQueueItem()`, `cancelClipStudioQueue()`
   - `processVideoForClips()`, `batchProcessVideosForClips()` convenience wrappers

8. **`frontend/src/pages/ClipStudioPage.tsx`** — New Clip Studio page:
   - Project multi-select with checkboxes
   - Export settings (quality, format, metadata, EDL toggles)
   - Processing queue with progress bars
   - Exported clips list with download links, metadata, file sizes
   - Auto-refresh every 5 seconds

9. **`frontend/src/App.tsx`** — Added `/clip-studio` route

10. **`frontend/src/components/layout/Navbar.tsx`** — Added Clip Studio nav icon

### Infrastructure

11. **`docker-compose.yml`** — Added Clip Studio env vars to both `momiji-clipper` and `celery-worker`
12. **`.env.example`** — Added Clip Studio env var documentation

## Architecture

```
User selects videos → POST /clip-studio/enqueue
                         ↓
ClipStudioQueue (status=queued)
                         ↓
PipelineDispatcher polls → dispatches to Celery
                         ↓
process_clip_studio_task:
  1. transcribe (Whisper)
  2. highlights (LLM detection)
  3. export_segments (FFmpeg stream copy at source quality)
                         ↓
ClipStudioExport records (one per clip segment)
                         ↓
User browses exports → downloads source-quality clips
```

## Key Design Decisions

- **Source quality = stream copy**: Uses `ffmpeg -c:v copy -c:a copy` for zero quality loss. Falls back to CRF 18 re-encode if stream copy fails (e.g., non-seekable containers).
- **No subtitles burned in**: Clips are exported clean. The purpose is finding clips, not creating final content.
- **Per-clip metadata JSON**: Each export gets a `.json` sidecar with clip title, timestamps, virality score, source codec info, export quality.
- **EDL export option**: CMX 3600 format for importing into DaVinci Resolve or Premiere Pro for further editing.
- **Batch processing**: Multiple videos can be enqueued at once. Dispatcher respects GPU/CPU/per-user concurrency limits.