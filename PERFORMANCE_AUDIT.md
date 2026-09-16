# Clipomatic (Momiji Clipper) — Performance & Memory Audit

**Date:** 2025-09-15  
**Branch:** `feat/api-keys`  
**Target Machines:** Apple Silicon M1 16GB unified memory, small VPS 4–8GB RAM  
**Reference VOD:** 5h43m, 18GB file → observed Ollama at 8.3GB, vision analysis 5+ hours

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Memory Bottlenecks by Pipeline Stage](#2-memory-bottlenecks-by-pipeline-stage)
3. [Peak Memory Estimation](#3-peak-memory-estimation)
4. [OOM Risk Areas](#4-oom-risk-areas)
5. [Docker Memory Analysis](#5-docker-memory-analysis)
6. [Prioritized Optimization Recommendations](#6-prioritized-optimization-recommendations)

---

## 1. Executive Summary

The Clipomatic pipeline has **critical memory pressure points** that make processing long VODs (>1h) on RAM-constrained machines (16GB or less) highly likely to OOM. The three worst offenders are:

| Rank | Bottleneck | Peak RAM | OOM Risk |
|------|-----------|----------|----------|
| 🔴 1 | Full-audio WAV extraction + energy analysis on 5h+ VODs | ~660MB WAV file + ~330MB raw PCM in RAM | **CRITICAL** on 8GB |
| 🔴 2 | Vision frame scan: 1 FPS → ~20,000 low-res frames on disk + all frame paths/scores in RAM | ~200MB frame files + ~4MB scored list + PIL processing | **HIGH** on 8GB, **MEDIUM** on 16GB |
| 🔴 3 | Ollama model loading with `KEEP_ALIVE=5m` — gemma4:12b holds 7.6GB + gemma3:latest 3.3GB if both loaded | 7.6–11GB in Ollama container | **CRITICAL** on 16GB when concurrent |
| 🟡 4 | Transcript JSON duplicated across DB + file + in-memory dict | 5–15MB per copy, 3+ copies alive simultaneously | **MEDIUM** |
| 🟡 5 | No Docker memory limits on any container | Unbounded | **HIGH** — one container can OOM-kill the host |

**No Docker memory limits are set on any container** — not Ollama, not Celery, not Redis, not the backend. This is the single highest-impact fix.

---

## 2. Memory Bottlenecks by Pipeline Stage

### 2.1 Video File Handling (18GB VODs)

**File:** `backend/pipeline/ingestion.py`

The video file itself is never loaded into RAM — yt-dlp streams to disk and FFmpeg reads via file path. This is correct.

- **`download_video()`** (line 312): Streams via yt-dlp with `--concurrent-fragments 8` — disk-only, minimal RAM. The `stderr_lines` and `stdout_lines` lists (lines 359–360) accumulate all yt-dlp output lines in memory, but this is typically <1MB.
- **`normalize_video_pts()`** (line 56): Uses `-c copy` remux — stream copy, minimal RAM. ✅ Good.
- **`stream_audio_to_file()`** (line 109): Streams audio-only to a 16kHz mono WAV file. The file on disk for a 5h43m VOD would be: `20600s × 16000 samples/s × 2 bytes = ~660MB`. The `stderr_lines` list (line 170) accumulates ffmpeg stderr — typically <100KB.

**Concern:** The downloaded 18GB video file sits on disk through the entire pipeline. Not a RAM issue, but a disk space issue.

### 2.2 Transcription — Whisper Model Loading

**File:** `backend/pipeline/transcription.py`

#### Model Cache (line 28–39)
```python
_model_cache: dict[tuple[str, str, str], "WhisperModel"] = {}
```
- The Whisper model is cached globally and **never evicted**. For `large-v3` on CPU with `int8`, this holds ~1.5–3GB in process memory permanently.
- For `small` model (default in dev), this is ~250–500MB.
- **Problem:** If the model size changes between runs (e.g., `small` for chunked, `large-v3` for full), both models stay cached. No eviction mechanism exists.

#### `_extract_audio()` (line 81–101) — **CRITICAL BOTTLENECK**
Extracts the **entire audio track** from the video into a single WAV file:
```python
cmd = ["ffmpeg", "-y", "-i", video_path, "-vn", "-af", "asetpts=PTS-STARTPTS",
       "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", audio_path]
```
For a 5h43m (20,600s) VOD:
- **Disk:** 20,600 × 16,000 × 2 = **~660MB WAV file on disk**
- ffmpeg itself uses ~50–100MB RAM for the stream copy (no video decode, just audio demux + resample)
- The WAV file is then loaded by faster-whisper which memory-maps it (doesn't load all into RAM), but the OS page cache will gradually fill with the 660MB file.

#### `transcribe()` (line 300–480) — Full transcription path
- **Line 343–346:** Creates temp WAV file, extracts full audio (see above).
- **Line 356:** Loads Whisper model (cached).
- **Line 369–370:** `model.transcribe()` — faster-whisper streams the audio file via memory-mapped I/O. Peak RAM during transcription is model size + ~50MB working buffer.
- **Line 376–406:** **Accumulates all segments in a list** (`all_segments`). For a 5h VOD with ~4,000 segments and word-level timestamps, this list holds ~5–10MB in memory. Moderate, but grows linearly with video length.
- **Line 408–413:** Builds `result` dict containing all segments — second copy of the same data.
- **Line 419:** Runs `analyze_audio_energy()` on the full WAV (see §2.3 below).
- **Line 440–452:** Runs vision analysis on the full video (see §2.4 below).
- **Line 468–469:** Writes result to JSON file — third copy of transcript data (serialized).

**Total in-memory copies of transcript during `transcribe()`:** 3 (segments list, result dict, JSON serialization buffer)

#### `transcribe_chunked()` (line 104–297) — Chunked path for >1h videos
- **Line 150–158:** Splits into 30-min chunks with 30s overlap. For a 5h43m VOD: ~12 chunks.
- **Line 165:** `all_segments = []` — accumulates all segments from all chunks in a single list. Same linear growth as `transcribe()`.
- **Line 179–191:** Calls `transcribe_segment()` per chunk — each extracts a 30-min WAV slice (~58MB) to disk, transcribes, returns segments. Temp WAV is deleted in `transcribe_segment()`'s `finally` block (line 659–660). ✅ Good per-chunk memory.
- **Line 201–214:** Deduplication loop — iterates all segments, builds `new_segments` list. Temporary duplicate of segment references.
- **🔴 Line 224–238:** **Audio energy analysis on the FULL video.** After chunked transcription completes, `_extract_audio(video_path, tmp_wav.name)` extracts the entire 5h43m audio into a ~660MB WAV file again, then `analyze_audio_energy()` loads the entire raw PCM into RAM (see §2.3). **This defeats the purpose of chunked transcription for memory.**
- **Line 252–253:** Saves transcript JSON (first save, before vision).
- **Line 257–286:** Runs vision analysis on the full video (see §2.4). Then re-saves the transcript JSON with vision data — **fourth copy** of transcript data.
- **Line 288–294:** Cleanup of chunk files.

#### `transcribe_segment()` (line 495–660)
- Extracts a time-sliced WAV (30 min = ~58MB). Reasonable.
- Model is loaded from cache. Each chunk's segments are accumulated in `all_segments` (line 629) — small, <1MB per chunk.
- Temp WAV is cleaned up in `finally` (line 659–660). ✅

### 2.3 Audio Energy Analysis — **CRITICAL**

**File:** `backend/pipeline/audio.py`, `analyze_audio_energy()` (line 313–428)

This function loads the **entire raw PCM audio into RAM** as a byte string:

```python
# Line 358–368: Extract to mono f32le PCM at 16kHz
cmd = ["ffmpeg", "-y", "-i", audio_path, "-acodec", "pcm_f32le",
       "-ar", "16000", "-ac", "1", "-f", "f32le", temp_path]

# Line 373–374: READ THE ENTIRE FILE INTO MEMORY
with open(temp_path, "rb") as f:
    raw_data = f.read()
```

For a 5h43m VOD:
- PCM at 16kHz, f32le (4 bytes/sample): 20,600 × 16,000 × 4 = **~1.3GB raw_data byte string**
- Then `struct.unpack()` on each segment (line 391) creates a tuple of 16,000 floats per segment — these are created and discarded per iteration, but the `raw_data` buffer persists for the entire function.
- The `segments` list (line 385) accumulates one dict per second: ~20,600 dicts × ~100 bytes each = ~2MB. Small.
- **Second pass** (line 414–422): Iterates segments with a rolling window — creates temporary `window_peaks` lists. Minimal additional memory.

**Peak RAM for `analyze_audio_energy()`:** ~1.3GB (raw_data) + ~2MB (segments) + ~660MB (input WAV file on disk, mmap'd by ffmpeg) ≈ **~1.3GB**

**Called twice in `transcribe_chunked()`:**
1. Line 232: `_extract_audio(video_path, tmp_wav.name)` — extracts full audio to WAV (~660MB on disk)
2. Line 233: `analyze_audio_energy(tmp_wav.name)` — extracts that WAV to PCM (~1.3GB in RAM)

**This is the #1 OOM trigger.** On an 8GB VPS with Ollama holding 3.3GB+ and Celery worker holding 500MB+, a 1.3GB allocation will OOM.

### 2.4 Vision Analysis — Frame Sampling

**File:** `backend/pipeline/vision.py`

#### `_scan_video_frames()` (line 265–301) — **HIGH RISK**
```python
command = ["ffmpeg", "-y", "-i", video_path,
           "-vf", f"fps={fps},scale={width}:-1", "-q:v", "8",
           output_pattern]
```
- At 1 FPS for a 5h43m VOD: **~20,600 frames** extracted to disk as 160px-wide JPEGs.
- Each 160×90 JPEG at q:v 8: ~5–15KB → **~100–300MB on disk**.
- ffmpeg memory: ~50–100MB for the decode pipeline (sequential, not loaded into Python RAM).
- **Line 296–300:** All frame file paths are loaded into a sorted list: `frame_paths = sorted(...)`. 20,600 strings × ~100 bytes = ~2MB. Small.

#### `_score_scanned_frames()` (line 46–68) — **MODERATE**
```python
from PIL import Image, ImageChops, ImageStat
```
- Opens each frame with PIL, converts to grayscale ("L"), computes frame-to-frame difference.
- **Line 56:** `Image.open(frame_path)` — opens one at a time (context manager). Each 160×90 L image: ~14KB in RAM.
- **Line 62:** `previous = current.copy()` — holds one previous frame in memory. ~14KB.
- **Line 63:** Builds `scored` list: 20,600 dicts × ~100 bytes = ~2MB.
- **PIL is sequential** — only 2 frames in RAM at once. ✅ Good.
- **But:** 20,600 file opens/closes is slow. This contributes to the 5+ hour vision time.

#### `_select_frame_candidates()` (line 71–113)
- Groups 20,600 frames into 60s windows: ~343 windows for 5h43m.
- Selects median frame per window: ~343 representatives.
- Caps at `max_frames=360` (default). If representatives ≥ 360, evenly samples.
- `selected_ids = {id(frame) for frame in selected}` — uses `id()` for identity comparison. **Fragile** — Python object IDs can be reused after garbage collection, but since all frames are alive in the `ordered` list, this works.
- Memory: ~343–360 dict references. Minimal.

#### `_materialize_selected_frames()` (line 116–131)
- Re-extracts selected frames at 512px width (higher quality) via ffmpeg, one at a time.
- Each 512×288 JPEG at q:v 2: ~20–50KB on disk.
- 360 frames × 35KB avg = ~12MB on disk. Small.

#### `analyze_video_frames()` (line 309–457) — Main orchestrator
- **Line 362:** `scanned = _scan_video_frames(...)` — 20,600 frames scored (see above).
- **Line 363:** `candidates = _select_frame_candidates(scanned, ...)` — 360 selected.
- **Line 368:** `pending = _materialize_selected_frames(...)` — 360 high-res frames on disk.
- **Line 379–432:** Batch loop — 360 frames / batch_size 4 = 90 batches.
  - **Line 407:** `_encode_frame_b64(frame['path'])` — reads each JPEG file and base64-encodes it. For a batch of 4 frames at ~35KB each: ~140KB raw + ~190KB base64 = ~330KB per batch in the `content` list. Small.
  - **Line 412–420:** Sends batch to Ollama vision model. The response is a JSON string — typically <10KB.
  - **Line 423:** `results.extend(parsed)` — accumulates results: 360 dicts × ~200 bytes = ~72KB. Small.
  - **Line 427–432:** `_save_vision_cache()` — writes ALL results to a JSON cache file after each batch. This re-serializes the entire results list every batch. For 360 results: ~72KB JSON. Negligible but wasteful I/O.
- **Line 455–457:** Cleans up scan_dir and selected_dir in `finally`. ✅

**Vision peak RAM:** ~50–100MB (ffmpeg) + ~2MB (scored list) + ~14KB (PIL frames) + ~330KB (batch content) + ~72KB (results) ≈ **~100MB**

**Vision disk peak:** ~300MB (scan frames) + ~12MB (selected frames) ≈ **~312MB temporary**

**The 5+ hour vision time is NOT a memory problem — it's an LLM throughput problem.** 90 sequential Ollama vision calls with a 12B model, each taking 2–4 minutes = 3–6 hours. The memory footprint is moderate.

### 2.5 Highlight Detection — LLM Context

**File:** `backend/pipeline/highlight_detection.py`

#### Chunking (line 153–182)
- `_MAX_CHUNK_CHARS = 24,000` (line 105) — ~24k chars ≈ ~6k tokens per chunk.
- For a 5h VOD with ~50,000 words of transcript: ~200,000 chars → ~9 chunks with 20-line overlap.
- Each chunk is a string of ~24KB. All chunks: `chunks = _chunk_transcript(flat_text)` — ~216KB in memory. Small.

#### `detect_highlights()` (line 472–651)
- **Line 515:** `flat_text = transcript_to_text(transcript)` — flattens entire transcript to a string. For 5h VOD: ~200KB. Small.
- **Line 519:** `compute_word_density(transcript)` — iterates all word timestamps. For ~50,000 words: builds `word_times` list (~400KB) + `bins` list (~20,600 dicts × ~80 bytes = ~1.6MB). Moderate.
- **Line 520–521:** `_format_audio_annotations(audio_energy, word_density)` — iterates audio_energy list (~20,600 dicts) and word_density list. Builds annotation string. Moderate.
- **Line 524–527:** `format_vision_annotations(vision_data)` — iterates vision results (~360 dicts). Small.
- **Line 539:** `all_clips = []` — accumulates clips from all chunks. Typically 20–80 clips × ~500 bytes = ~40KB. Small.
- **Line 560:** Each LLM call sends system prompt (~3KB) + user message (~24KB + annotations). Total request payload: ~30–50KB. Response: ~5–10KB.
- **Line 607:** `_build_timestamp_indices(transcript)` — builds sorted lists of all word start/end times. For ~50,000 words: two lists of 50,000 floats each = ~800KB each, ~1.6MB total. Moderate, but transient.

**Highlight detection peak RAM:** ~200KB (flat_text) + ~216KB (chunks) + ~1.6MB (word_density bins) + ~1.6MB (timestamp indices) + ~2MB (audio_energy in transcript dict) + request/response buffers ≈ **~6MB**. Low.

**However:** The `transcript` dict passed in contains ALL segments + audio_energy + vision_analysis. For a 5h VOD:
- segments: ~4,000 × ~1.5KB (with words) = ~6MB
- audio_energy: ~20,600 × ~100 bytes = ~2MB
- vision_analysis: ~360 × ~200 bytes = ~72KB
- Total transcript dict: **~8MB**

### 2.6 Export / Rendering

**File:** `backend/pipeline/renderer.py`

#### `export_source_quality_segments()` (line 622–750+)
- **Line 707–718:** Source quality export uses `-c:v copy -c:a copy` (stream copy). **Zero re-encode, minimal RAM.** ✅
- **Line 720–739:** Re-encode fallback uses libx264 — ffmpeg uses ~100–200MB for encoding buffers.
- Each clip is exported sequentially. No accumulation of results in memory — the `results` list (line 683) holds metadata dicts only: ~10–80 × ~500 bytes = ~40KB. Small.

#### `render_clip()` (line 879–928+)
- Full re-encode with ASS subtitles, crop, scale, zoompan. ffmpeg memory: ~200–400MB depending on resolution and filter complexity.
- ASS subtitle file is generated in memory (line 350–571) — for a 60s clip with ~150 words: ~20KB. Small.
- No significant memory accumulation.

**Export peak RAM:** ~200–400MB (ffmpeg re-encode) or ~50MB (stream copy). **Low risk.**

### 2.7 Redis / Celery Memory

**File:** `backend/celery_app.py`, `backend/utils/progress.py`

#### Redis
- **Broker (DB 0):** Celery task messages. Each `pipeline_chain.delay(job_id)` message: ~200 bytes. With `worker_prefetch_multiplier=1` (line 31), only 1 task is prefetched per worker. Low.
- **Result backend (DB 1):** Celery stores task results. **No `result_expires` configured** — results persist indefinitely. For long-running tasks, this is just the return value (a dict or list). The `pipeline_chain` task returns `None` (no explicit return), but `process_clip_studio_task` returns a dict with export metadata (~1KB). Low.
- **Pub/Sub (DB 0):** `RedisProgressCallback` (progress.py line 40) publishes JSON to `pipeline:{job_id}` channel. Messages are fire-and-forget (Pub/Sub doesn't persist). ~200 bytes per update, ~1 update/second. Low.
- **No `maxmemory` configured** on Redis container. If task results accumulate, Redis can grow unbounded.

#### Celery Worker
- **Concurrency:** `--concurrency=${CELERY_CONCURRENCY:-1}` (docker-compose.yml line 81). Default 1 worker process. ✅ Good for memory-constrained machines.
- **No `max_tasks_per_child`** configured — worker process never recycles. The Whisper model cache (`_model_cache`) persists for the worker's lifetime. If a worker processes multiple jobs with different model sizes, multiple models accumulate.
- **No `task_time_limit` or `task_soft_time_limit`** — a stuck task (e.g., Ollama hang) runs forever.
- **No `worker_max_memory_per_child`** — no memory-based recycling.

### 2.8 Ollama Model Loading

**File:** `docker-compose.shared.yml`, `docker-compose.yml`

- **`OLLAMA_KEEP_ALIVE=5m`** (shared.yml line 12, docker-compose.yml line 11) — models stay loaded for 5 minutes after last use. This means:
  - After transcription's vision analysis, the vision model (gemma3:latest, ~3.3GB) stays loaded.
  - When highlight detection starts with gemma4:12b (~7.6GB), both models may briefly coexist: **~11GB**.
  - After highlights complete, gemma4:12b stays loaded for 5 minutes.
- **No Ollama memory limit** — the container can use all available RAM.
- **No `num_ctx` (context window) configuration** — Ollama defaults vary by model. For gemma4:12b, the default context window may be 8K tokens, but the model weights dominate memory regardless.
- The `OLLAMA_NO_CLOUD=1` env var (line 10/11) is a custom guard, not an Ollama standard — it prevents cloud routing but doesn't affect memory.

**Observed:** Ollama at 8.3GB for gemma4:12b. This is model weights (~7.6GB) + KV cache + runtime overhead.

---

## 3. Peak Memory Estimation

### 3.1 Per-Step Estimates (5h43m VOD, 18GB file)

| Pipeline Step | Peak RAM | Key Allocations | Duration |
|--------------|----------|----------------|----------|
| **Download** | ~50MB | yt-dlp process + stderr buffer | 10–60 min |
| **Transcribe (chunked)** | ~2.5GB | Whisper model (500MB) + chunk WAV (58MB) + segment accumulation (10MB) + **audio energy WAV extraction (660MB disk) + audio energy PCM (1.3GB RAM)** | 30–60 min |
| **Transcribe (full)** | ~4.5GB | Whisper model (3GB large-v3) + full WAV (660MB disk) + **audio energy PCM (1.3GB RAM)** + segments (10MB) | 30–90 min |
| **Vision scan** | ~100MB | ffmpeg decode (50MB) + PIL frames (14KB) + scored list (2MB) + scan frames on disk (300MB) | 10–20 min |
| **Vision LLM** | ~50MB Python + **7.6GB Ollama** | Base64 batches (330KB) + results (72KB) + Ollama model | 3–6 hours |
| **Highlights** | ~15MB Python + **7.6GB Ollama** | Transcript dict (8MB) + chunks (216KB) + word density (1.6MB) + timestamp indices (1.6MB) + LLM request/response (50KB) | 10–30 min |
| **Export (source)** | ~50MB | ffmpeg stream copy | 1–5 min |
| **Export (re-encode)** | ~200–400MB | ffmpeg libx264 encode | 5–20 min |

### 3.2 Concurrent Operation Estimates

The dispatcher allows: **GPU=1, CPU=2, per_user=2** (`pipeline_dispatcher.py` lines 30–32).

| Scenario | RAM Estimate | Fits 16GB? | Fits 8GB? |
|----------|-------------|------------|-----------|
| 1 transcription (chunked) + Ollama idle | ~3GB + ~8GB = 11GB | ✅ | ❌ |
| 1 transcription + 1 highlight detection (concurrent) | ~2.5GB + ~15MB + ~8GB Ollama = ~10.5GB | ✅ (tight) | ❌ |
| 2 highlight detections + Ollama (gemma4:12b) | ~30MB + ~8GB = ~8GB | ✅ (tight) | ❌ |
| 1 transcription (audio energy phase) + Ollama (gemma4:12b) | ~1.3GB + ~500MB + ~8GB = ~9.8GB | ✅ (tight) | ❌ |
| 1 vision LLM + Ollama (gemma4:12b + gemma3:latest transition) | ~100MB + ~11GB = ~11.1GB | ✅ (very tight) | ❌ |
| Post-transcription: Ollama has vision model + highlight model | ~11GB Ollama + ~500MB worker = ~11.5GB | ⚠️ Danger | ❌ |

**On 16GB Apple Silicon (unified memory shared with OS):**
- macOS uses ~4–5GB, leaving ~11–12GB for Docker.
- The `OLLAMA_KEEP_ALIVE=5m` window means both models can coexist during the transition from vision to highlights: ~11GB in Ollama alone.
- **This is the likely cause of the observed 8.3GB Ollama usage** — gemma4:12b loaded for highlights while gemma3:latest is still warm from vision.

**On 8GB VPS:**
- Only the export step (stream copy) and idle states fit comfortably.
- **Any step involving Ollama will OOM** unless only a small model (gemma3:latest, 3.3GB) is used.
- Transcription with audio energy analysis (~1.8GB) + small Whisper model (~500MB) + Ollama small model (~3.3GB) = ~5.6GB — might fit if OS is minimal, but dangerously tight.

### 3.3 Container Memory Breakdown (Idle State)

| Container | Idle RAM | Loaded RAM |
|-----------|---------|------------|
| Ollama | ~200MB | 3.3GB (gemma3) to 7.6GB (gemma4:12b) + overhead = up to 8.3GB |
| Celery worker | ~150MB (Python + libs) | + 500MB (Whisper small) to 3GB (large-v3) = 650MB–3.2GB |
| Backend (FastAPI) | ~100MB | + SSE connections (~1MB each) |
| Redis | ~10MB | + task results (unbounded without maxmemory) |
| Frontend (nginx) | ~20MB | Static |

---

## 4. OOM Risk Areas

### 4.1 🔴 CRITICAL: `analyze_audio_energy()` — Full PCM in RAM

**File:** `backend/pipeline/audio.py:373–374`
```python
with open(temp_path, "rb") as f:
    raw_data = f.read()  # ~1.3GB for 5h43m VOD
```

**Risk:** OOM on any machine with <12GB free RAM when combined with other running services.

**Called from:**
- `transcribe_chunked()` line 232–233 — extracts full audio AGAIN after chunked transcription
- `transcribe()` line 419 — on the already-extracted full WAV

**The chunked transcription was designed to avoid OOM by processing 30-min chunks, but the audio energy step at the end re-introduces the full-video memory pressure.**

### 4.2 🔴 CRITICAL: No Docker Memory Limits

**Files:** All `docker-compose*.yml`

No `mem_limit`, `deploy.resources.limits.memory`, or `--memory` flag on any container. Docker containers can consume all host RAM, and the OOM killer will kill random processes (often the most memory-hungry, which may be Ollama or the Celery worker).

**Impact:** A single runaway container can bring down the entire host, including the OS.

### 4.3 🔴 CRITICAL: Ollama Dual-Model Memory Spike

**File:** `docker-compose.shared.yml:12`, `docker-compose.yml:11`

`OLLAMA_KEEP_ALIVE=5m` means the vision model (gemma3:latest, 3.3GB) stays loaded when highlight detection starts loading gemma4:12b (7.6GB). Brief overlap: ~11GB.

**Impact:** On 16GB Apple Silicon with ~11–12GB available to Docker, this leaves <1GB headroom. Any concurrent Python process will trigger OOM.

### 4.4 🟡 HIGH: Whisper Model Cache Never Evicted

**File:** `backend/pipeline/transcription.py:28–39`

```python
_model_cache: dict[tuple[str, str, str], "WhisperModel"] = {}
```

The cache is a module-level dict with no eviction. If the worker processes a job with `small` model, then another with `large-v3`, both stay loaded: ~3.5GB combined.

**No `gc.collect()` or `del` is ever called on cached models.**

### 4.5 🟡 HIGH: Transcript Data Duplicated 3–4×

**File:** `backend/tasks.py`, `backend/pipeline/transcription.py`

The transcript dict travels through multiple representations simultaneously:

1. **In-memory dict** returned from `transcribe()`/`transcribe_chunked()` (line 242–249 / 408–413)
2. **JSON file** on disk (line 252–253 / 468–469)
3. **DB record** via `_persist_transcript_sync()` (tasks.py line 193/209) — `json.dumps(result.get("segments"))` creates another full serialization
4. **Re-loaded from DB** in `_run_highlights()` via `_load_transcript_from_db()` (tasks.py line 223) — `json.loads(record.segments)` creates another in-memory copy

For a 5h VOD, each copy is ~8–15MB. With 3 copies alive during the highlights step: ~30–45MB. Not catastrophic, but wasteful.

### 4.6 🟡 HIGH: Vision Scan Frame Count (20,000 frames)

**File:** `backend/pipeline/vision.py:265–301`

At 1 FPS, a 5h43m VOD produces ~20,600 scan frames. While each frame is small in RAM, the issues are:

1. **Disk I/O:** 20,600 file writes + reads during scoring = slow
2. **PIL processing:** 20,600 sequential `Image.open()` + `convert("L")` + `ImageChops.difference()` + `ImageStat.Stat()` = ~20,600 file I/O operations. This is the primary cause of the 5+ hour vision time (not LLM calls alone).
3. **Disk space:** ~300MB of temporary scan frames

**The frame count is configurable** via `VISION_SCAN_FPS` env var, but default is 1.0. Lowering to 0.2 (1 frame per 5 seconds) would reduce to ~4,120 frames — a 5× reduction in scan time and disk I/O.

### 4.7 🟡 MEDIUM: `_save_vision_cache()` Re-serializes All Results Every Batch

**File:** `backend/pipeline/vision.py:427–432`

```python
_save_vision_cache(cache_path, {
    "fingerprint": fingerprint,
    "config": config,
    "complete": False,
    "results": results,  # ALL results so far
})
```

Called after every batch (90 batches). Each call serializes the entire `results` list to JSON and writes to disk. After 90 batches with 360 results: 90 × growing JSON = 90 × (72KB avg) = ~6.5MB of total I/O. Not a memory issue, but wasteful I/O that slows the already-slow vision step.

### 4.8 🟡 MEDIUM: Celery Worker Never Recycles

**File:** `backend/celery_app.py`

No `max_tasks_per_child` or `worker_max_memory_per_child` configured. The worker process accumulates:
- Whisper model cache (500MB–3GB)
- Python heap fragmentation
- Any memory leaks in faster-whisper or PIL

**Impact:** Over multiple jobs, worker memory monotonically increases.

### 4.9 🟢 LOW: SSE Connections

**File:** `backend/utils/sse.py`, `backend/utils/progress.py`

SSE connections are lightweight — each holds an async generator and a Redis Pub/Sub subscription. ~1MB per connection. The backend isn't a memory bottleneck for SSE.

### 4.10 🟢 LOW: `generate_waveform()` — Raw PCM in RAM

**File:** `backend/pipeline/audio.py:260–261`

```python
with open(temp_path, "rb") as f:
    raw_data = f.read()
```

Same pattern as `analyze_audio_energy()`, but this function is only called for short audio clips (uploaded audio assets, not full VODs). The 100MB file size limit (line 35) caps the PCM at ~100MB. Low risk.

---

## 5. Docker Memory Analysis

### 5.1 Current State — No Limits

| Container | mem_limit | deploy.resources | shm_size | Notes |
|-----------|-----------|-----------------|----------|-------|
| ollama / ollama-shared | ❌ None | ❌ None | ❌ Default (64MB) | Can consume all host RAM |
| momiji-clipper (backend) | ❌ None | ❌ None | ❌ Default | FastAPI + dispatcher |
| celery-worker | ❌ None | ❌ None | ❌ Default | Holds Whisper model cache |
| redis | ❌ None | ❌ None | ❌ Default | Broker + results + pub/sub |
| frontend (nginx) | ❌ None | ❌ None | ❌ Default | Static serving |

**No `mem_limit`, no `deploy.resources.limits.memory`, no `shm_size` on any container in any compose file.**

### 5.2 Ollama Container

- `OLLAMA_KEEP_ALIVE=5m` — models persist 5 minutes after last use
- No memory limit — observed at 8.3GB
- The `deploy.resources.reservations.devices` GPU section is commented out (shared.yml lines 24–32)
- **Ollama uses /dev/shm for model loading** — default 64MB shm_size may cause issues with large models. Should be increased.

### 5.3 Celery Worker Container

- `--concurrency=1` by default (good for memory)
- Same image as backend (includes all Python deps: faster-whisper, PIL, openai client, sqlalchemy)
- No memory limit — Whisper model cache + audio energy buffers can grow unbounded
- No task time limit — stuck Ollama calls run forever

### 5.4 Redis Container

- `redis:7-alpine` — minimal image, ~10MB base
- No `maxmemory` or `maxmemory-policy` configured
- No `redis.conf` mounted
- Two databases: DB 0 (broker + pub/sub), DB 1 (results)
- **Task results never expire** (no `result_expires` in Celery config)
- **Risk:** Low immediate risk, but results accumulate over time. On a long-running server, Redis could slowly grow.

### 5.5 Backend Container

- FastAPI + uvicorn + dispatcher
- Dispatcher tracks `_active_jobs` dict in memory (line 37) — small, ~1KB per job
- SSE connections via Redis Pub/Sub subscriptions — each holds a Redis connection
- No memory limit

### 5.6 Recommended Container Memory Limits

For a **16GB Apple Silicon** machine (leaving ~4GB for macOS):

| Container | Recommended Limit | Rationale |
|-----------|------------------|-----------|
| ollama | 10g | gemma4:12b (7.6GB) + overhead, but prevents total host exhaustion |
| celery-worker | 4g | Whisper model + audio energy (1.3GB) + headroom |
| momiji-clipper (backend) | 512m | FastAPI + dispatcher + SSE |
| redis | 128m | Broker + results; tiny data |
| frontend | 64m | Nginx static |

For an **8GB VPS** (leaving ~1GB for OS):

| Container | Recommended Limit | Rationale |
|-----------|------------------|-----------|
| ollama | 5g | Only gemma3:latest (3.3GB) fits |
| celery-worker | 1.5g | Small Whisper + limited audio energy |
| momiji-clipper (backend) | 256m | Minimal |
| redis | 64m | Minimal |
| frontend | 32m | Minimal |

---

## 6. Prioritized Optimization Recommendations

### Priority 1 — Critical (Do First)

#### 6.1 Add Docker Memory Limits to All Containers

**Files:** `docker-compose.yml`, `docker-compose.dev.yml`, `docker-compose.prod.yml`, `docker-compose.shared.yml`

Add to each service:
```yaml
deploy:
  resources:
    limits:
      memory: <value>g
```

Or use `mem_limit` for Docker Compose v2 compatibility:
```yaml
mem_limit: <value>g
```

Also increase `shm_size` for Ollama:
```yaml
shm_size: 2g
```

**Impact:** Prevents any single container from OOM-killing the host. The OOM killer will instead kill the container (which can restart) rather than random OS processes.

#### 6.2 Stream Audio Energy Analysis — Eliminate 1.3GB RAM Spike

**File:** `backend/pipeline/audio.py:313–428`

**Current:** Reads entire PCM file into `raw_data` byte string (~1.3GB for 5h VOD).

**Fix:** Stream the PCM file in chunks, computing per-second statistics incrementally:

```python
def analyze_audio_energy(audio_path, segment_duration=1.0, ...):
    # Stream ffmpeg output directly to a pipe instead of temp file
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-i", audio_path, "-acodec", "pcm_f32le",
         "-ar", "16000", "-ac", "1", "-f", "f32le", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    )
    
    samples_per_segment = int(16000 * segment_duration)
    segments = []
    while True:
        chunk = proc.stdout.read(samples_per_segment * 4)  # 4 bytes per float32
        if not chunk or len(chunk) < 4:
            break
        samples = struct.unpack(f"{len(chunk) // 4}f", chunk)
        # Compute peak, rms, silence_ratio for this segment
        segments.append({...})
    
    proc.stdout.close()
    proc.wait()
```

**Impact:** Reduces audio energy peak RAM from ~1.3GB to ~64KB (one segment at a time). **This is the single largest memory reduction in the codebase.**

#### 6.3 Chunked Audio Energy Analysis (or Skip for Long VODs)

**File:** `backend/pipeline/transcription.py:224–238`

**Current:** `transcribe_chunked()` extracts the full audio AGAIN for energy analysis after chunked transcription.

**Fix options (pick one):**

1. **Best:** Run audio energy analysis per-chunk during `transcribe_segment()`, then merge. Pass the energy data back with each chunk result.
2. **Simplest:** Skip audio energy analysis for videos >2h. It's a "nice to have" signal for highlight detection, not critical.
3. **Alternative:** Use the existing chunk WAVs (they're deleted after each chunk, but could be retained briefly for energy analysis).

**Impact:** Eliminates the ~660MB WAV extraction + ~1.3GB RAM spike in the chunked path. Combined with 6.2, this removes the #1 OOM trigger entirely.

#### 6.4 Unload Whisper Model After Transcription

**File:** `backend/pipeline/transcription.py:28–39`

Add an eviction function and call it after transcription completes:

```python
def _evict_model_cache() -> None:
    """Unload all cached Whisper models to free memory."""
    global _model_cache
    for key, model in _model_cache.items():
        del model
    _model_cache.clear()
    import gc
    gc.collect()
```

Call in `transcribe_chunked()` and `transcribe()` after all segments are collected, before vision analysis:
```python
# After segment accumulation, before vision/highlights
_evict_model_cache()
```

**Impact:** Frees 500MB–3GB after transcription, before the Ollama-heavy vision and highlight steps. On 16GB machines, this gives Ollama ~3GB more headroom.

#### 6.5 Configure Ollama Model Unload After Highlights

**Approach:** Set `OLLAMA_KEEP_ALIVE=0` (or `1m`) to unload models immediately after use, OR call the Ollama API to unload specific models:

```bash
curl http://ollama:11434/api/generate -d '{"model": "gemma4:12b", "keep_alive": 0}'
```

Add this call after highlight detection completes (in `tasks.py` `_run_highlights()` or after the `detect_highlights()` call).

**Alternative:** Set `OLLAMA_KEEP_ALIVE=1m` in docker-compose to reduce the overlap window.

**Impact:** Prevents the dual-model ~11GB spike when transitioning from vision (gemma3) to highlights (gemma4:12b). Saves ~3.3GB during the transition.

### Priority 2 — High

#### 6.6 Reduce Vision Scan FPS for Long VODs

**File:** `docker-compose*.yml` (env vars), `backend/pipeline/vision.py:31`

Change `VISION_SCAN_FPS` from `1` to `0.25` (1 frame per 4 seconds) for VODs >2h.

Or implement adaptive FPS in `analyze_video_frames()`:
```python
if duration > 7200:  # >2h
    scan_fps = min(scan_fps, 0.25)  # 1 frame per 4 seconds
elif duration > 3600:  # >1h
    scan_fps = min(scan_fps, 0.5)   # 1 frame per 2 seconds
```

**Impact:** For a 5h43m VOD: 20,600 → 5,150 scan frames. 4× reduction in:
- Disk I/O (300MB → 75MB scan frames)
- PIL processing time (20,600 → 5,150 image opens)
- Overall vision scan time (~75% faster scan phase)

#### 6.7 Add Celery Worker Recycling

**File:** `backend/celery_app.py`

```python
celery_app.conf.update(
    # ...existing config...
    max_tasks_per_child=3,           # Recycle after 3 jobs
    task_time_limit=7200,            # 2h hard limit per task
    task_soft_time_limit=6900,       # 1h55m soft limit
    worker_max_memory_per_child=4_000_000_000,  # 4GB limit (in bytes)
    result_expires=3600,             # Results expire after 1h
)
```

**Impact:** Prevents memory accumulation across jobs. Time limits prevent stuck Ollama calls from blocking workers forever.

#### 6.8 Configure Redis maxmemory

**File:** `docker-compose.yml` (redis service)

Add a custom redis config or command-line flags:
```yaml
redis:
  image: redis:7-alpine
  command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru
  # ...rest of config...
```

**Impact:** Prevents unbounded Redis growth. LRU eviction is safe for Celery — task messages are consumed quickly, and results are expendable after reading.

#### 6.9 Reduce Transcript Data Duplication

**File:** `backend/tasks.py`

**Current flow:**
1. `transcribe_chunked()` returns result dict (copy 1)
2. Saves to JSON file (copy 2 on disk)
3. `_persist_transcript_sync()` serializes to DB (copy 3)
4. `_run_highlights()` loads from DB (copy 4 in RAM)

**Fix:** Pass the transcript file path between steps instead of the full dict. Load lazily in `_run_highlights()`:

```python
def _run_highlights(project_data, config, progress_cb):
    # Load from file (already saved by transcribe step)
    stem = os.path.splitext(os.path.basename(source_path))[0]
    transcript_path = os.path.join(WORKSPACE, f"{stem}_transcript.json")
    with open(transcript_path, "r") as f:
        transcript_data = json.load(f)
    # Don't also load from DB — the file IS the cache
```

Remove the DB round-trip for transcript data (keep it in DB for persistence, but don't read it back when the file exists).

**Impact:** Eliminates 1–2 in-memory copies (~8–15MB each). Minor RAM savings, but simpler data flow.

### Priority 3 — Medium

#### 6.10 Stream Audio to Whisper Instead of Extracting Full WAV

**File:** `backend/pipeline/transcription.py:81–101`

**Current:** `_extract_audio()` writes a full WAV file to disk, then Whisper reads it.

**Fix:** Pipe ffmpeg output directly to Whisper via a file-like object or named pipe:

```python
import subprocess

def _extract_audio_stream(video_path):
    """Stream 16kHz mono PCM to a pipe for Whisper."""
    proc = subprocess.Popen(
        ["ffmpeg", "-i", video_path, "-vn", "-acodec", "pcm_s16le",
         "-ar", "16000", "-ac", "1", "-f", "wav", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    )
    return proc.stdout  # Whisper can read from this
```

**Caveat:** faster-whisper's `model.transcribe()` accepts a file path, not a file object. Would need a named pipe (FIFO) or `tempfile` with streaming.

**Simpler alternative:** Keep the WAV file approach but use a FIFO to avoid the 660MB disk write:

```bash
mkfifo /tmp/audio_pipe
ffmpeg -i video.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 /tmp/audio_pipe &
# Whisper reads from /tmp/audio_pipe
```

**Impact:** Eliminates ~660MB disk I/O per transcription. RAM impact is minimal (faster-whisper already memory-maps the file), but disk space and I/O time improve.

#### 6.11 Optimize Vision Cache Saving

**File:** `backend/pipeline/vision.py:427–432`

Save cache every 5 batches instead of every batch:

```python
if batch_number % 5 == 0 or batch_number == total_batches:
    _save_vision_cache(cache_path, {...})
```

**Impact:** 5× reduction in cache I/O during vision analysis. Minor, but removes unnecessary overhead from the already-slow vision step.

#### 6.12 Use `format_vision_annotations()` Before Sending to LLM (Already Done)

The code already filters vision annotations to notable frames only (energy ≥6, non-standard scenes). ✅ Good.

#### 6.13 Add `num_ctx` to Ollama Model Calls

When calling Ollama via the OpenAI-compatible API, pass `num_ctx` to limit the context window:

```python
response = client.chat.completions.create(
    model=model,
    messages=messages,
    extra_body={"num_ctx": 8192},  # Limit context to 8K tokens
    ...
)
```

**Impact:** Reduces Ollama KV cache memory usage. For gemma4:12b with a 128K default context, limiting to 8K can save ~2–3GB of KV cache memory.

#### 6.14 Chunk Size Tuning by RAM Tier

Add environment-based chunk size configuration:

```python
# In tasks.py _run_transcribe()
ram_tier = os.environ.get("RAM_TIER", "standard")  # "low", "standard", "high"
chunk_minutes = {"low": 15.0, "standard": 30.0, "high": 60.0}[ram_tier]
```

| RAM Tier | Chunk Minutes | Max Chunk WAV | Target Machine |
|----------|--------------|--------------|----------------|
| low | 15 | ~29MB | 8GB VPS |
| standard | 30 | ~58MB | 16GB Apple Silicon |
| high | 60 | ~115MB | 32GB+ workstation |

**Impact:** Allows tuning per deployment without code changes.

### Priority 4 — Low

#### 6.15 Monitor Memory Usage in Pipeline

Add memory logging to each pipeline step:

```python
import resource

def _log_memory_usage(step: str):
    usage = resource.getrusage(resource.RUSAGE_SELF)
    logger.info(f"[{step}] Peak RSS: {usage.ru_maxrss / 1024:.0f}MB")
```

Call at the start and end of each step in `pipeline_chain()`.

**Impact:** Visibility into memory usage for debugging OOM issues.

#### 6.16 Consider External LLM for Vision on Low-RAM Machines

For 8GB VPS machines, running a vision-capable LLM locally is impractical. Allow cloud vision API (e.g., OpenAI gpt-4o-mini) for vision analysis while keeping highlights local:

```python
if os.environ.get("VISION_USE_CLOUD", "").lower() in ("1", "true"):
    vision_api_key = os.environ.get("VISION_CLOUD_API_KEY", "")
    vision_base_url = os.environ.get("VISION_CLOUD_BASE_URL", "https://api.openai.com/v1")
```

**Impact:** Eliminates the Ollama vision model memory burden on low-RAM machines.

---

## Appendix A: File Reference Summary

| File | Key Lines | Issue |
|------|----------|-------|
| `backend/pipeline/audio.py` | 373–374 | Full PCM read into RAM (~1.3GB) |
| `backend/pipeline/audio.py` | 358–368 | Full WAV extraction to temp file |
| `backend/pipeline/transcription.py` | 28–39 | Whisper model cache never evicted |
| `backend/pipeline/transcription.py` | 81–101 | Full audio extraction to WAV |
| `backend/pipeline/transcription.py` | 224–238 | Audio energy on full video after chunked transcription |
| `backend/pipeline/transcription.py` | 376–406 | Segment accumulation in list |
| `backend/pipeline/transcription.py` | 468–469 | Transcript JSON file write |
| `backend/pipeline/vision.py` | 31 | Default scan FPS = 1.0 (20k frames for 5h) |
| `backend/pipeline/vision.py` | 46–68 | PIL sequential frame scoring |
| `backend/pipeline/vision.py` | 265–301 | FFmpeg frame extraction (20k frames to disk) |
| `backend/pipeline/vision.py` | 427–432 | Cache re-serialized every batch |
| `backend/pipeline/highlight_detection.py` | 105 | Chunk size: 24k chars |
| `backend/pipeline/highlight_detection.py` | 366–414 | Word density computation |
| `backend/pipeline/highlight_detection.py` | 607 | Timestamp index building |
| `backend/tasks.py` | 193, 209 | Transcript persisted to DB (json.dumps) |
| `backend/tasks.py` | 223–230 | Transcript loaded from DB (json.loads) |
| `backend/pipeline_dispatcher.py` | 30–32 | Concurrency: GPU=1, CPU=2, per_user=2 |
| `backend/celery_app.py` | 26–32 | No max_tasks_per_child, no time limits |
| `backend/utils/progress.py` | 40–43 | Redis Pub/Sub per progress update |
| `docker-compose.yml` | 6–21 | Ollama: no mem_limit, KEEP_ALIVE=5m |
| `docker-compose.yml` | 64–72 | Redis: no maxmemory |
| `docker-compose.yml` | 74–114 | Celery: no mem_limit, no recycling |
| `docker-compose.shared.yml` | 6–23 | Shared Ollama: no mem_limit |
| `docker-compose.dev.yml` | 44–54 | Redis dev: no maxmemory |
| `docker-compose.prod.yml` | 8–37 | Prod: no mem_limits on any service |
| `backend/Dockerfile` | 1–40 | No memory-related build args |

---

## Appendix B: OOM Risk Rating Matrix

| Code Path | 8GB VPS | 16GB Apple Silicon | 32GB+ Workstation |
|-----------|---------|-------------------|-------------------|
| `transcribe()` full audio extraction | 🔴 HIGH | 🟡 MEDIUM | 🟢 LOW |
| `transcribe_chunked()` audio energy on full video | 🔴 CRITICAL | 🔴 HIGH | 🟡 MEDIUM |
| `analyze_audio_energy()` full PCM read | 🔴 CRITICAL | 🔴 HIGH | 🟡 MEDIUM |
| `analyze_video_frames()` 1 FPS scan | 🟡 MEDIUM | 🟡 MEDIUM | 🟢 LOW |
| Ollama dual-model (gemma4 + gemma3) | 🔴 CRITICAL | 🔴 HIGH | 🟡 MEDIUM |
| Whisper model cache accumulation | 🟡 MEDIUM | 🟡 MEDIUM | 🟢 LOW |
| Transcript data duplication | 🟢 LOW | 🟢 LOW | 🟢 LOW |
| Redis unbounded growth | 🟢 LOW | 🟢 LOW | 🟢 LOW |
| Export stream copy | 🟢 LOW | 🟢 LOW | 🟢 LOW |
| Export re-encode (libx264) | 🟡 MEDIUM | 🟢 LOW | 🟢 LOW |
| Concurrent GPU=1 + CPU=2 jobs | 🔴 CRITICAL | 🟡 MEDIUM | 🟢 LOW |

---

*This audit complements the existing `AUDIT_REPORT.md` (security/code quality) and should be used alongside it for deployment planning on RAM-constrained machines.*