# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Momiji Clipper** is a self-hosted AI clip factory for VTuber VODs. It transcribes videos with GPU-accelerated Whisper, identifies viral moments using an LLM, and renders 9:16 vertical clips with karaoke-style word-highlight subtitles.

### Architecture

The system follows a 4-step pipeline:

1. **Ingestion** — Upload MP4/MKV files or download from YouTube/Twitch/Kick URLs
2. **Transcription** — GPU-accelerated Whisper transcription with word-level timestamps
3. **Highlight Detection** — LLM analyzes transcript to identify 6-12 viral clip candidates per hour of content
4. **Review & Render** — Interactive crop selection and FFmpeg rendering with stacked layout

### Key Components

#### Backend Services

- **`api.py`** — FastAPI backend with Server-Sent Events (SSE) for progress tracking
- **`pipeline/`** — Core processing modules:
  - `ingestion.py` — Video/audio downloads, Twitch streaming, file handling
  - `transcription.py` — Whisper-based transcription with automatic GPU detection
  - `highlight_detection.py` — LLM-based viral moment identification
  - `renderer.py` — FFmpeg-based video rendering with ASS subtitles

#### Frontend

- **`frontend/`** — React + Vite frontend (TypeScript, Tailwind CSS, Konva for canvas)
- Communicates with FastAPI backend via REST API
- Provides interactive UI for the 4-step pipeline

#### Infrastructure

- **Docker-based** — Two compose files:
  - `docker-compose.yml` — Base configuration (CPU, Apple Silicon, AMD)
  - `docker-compose.nvidia.yml` — Nvidia GPU override
- **Ollama integration** — Bundled LLM service for local inference
- **Workspace volume** — Persistent storage for videos, transcripts, and renders

## Development Setup

### Prerequisites

- Docker and Docker Compose
- Nvidia container toolkit (for GPU support)
- Ollama (bundled in compose)

### Common Commands

#### Build and Run

```bash
# CPU / Apple Silicon / AMD
docker compose up --build

# Nvidia GPU (transcription + Ollama on GPU)
docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up --build

# Access the UI
# Open http://localhost:7860 in browser
```

#### Environment Configuration

```bash
# Copy and edit .env
cp .env.example .env

# Pull LLM model (after stack is running)
docker exec -it momiji-ollama ollama pull llama3.1:8b
```

#### Testing

```bash
# Test highlight detection without UI
python test_highlight_detection.py workspace/<stem>_transcript.json

# Test subtitle rendering
python test_subtitle_rendering.py
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LLM_BASE_URL` | `http://ollama:11434/v1` | OpenAI-compatible API endpoint |
| `LLM_API_KEY` | `ollama` | API key for LLM endpoint |
| `LLM_MODEL` | `llama3.1:8b` | Default model |
| `WHISPER_MODEL` | `large-v3` | Whisper model size |
| `WHISPER_DEVICE` | `auto` | `auto`, `cuda`, or `cpu` |

## Code Structure

### Backend Architecture

#### API Endpoints

The FastAPI backend (`api.py`) provides these key endpoints:

- **Ingestion**: `/api/ingest/upload`, `/api/ingest/url`, `/api/ingest/twitch/*`
- **Transcription**: `/api/transcribe`, `/api/transcribe/cached`
- **Highlight Detection**: `/api/highlights`, `/api/highlights/cached`
- **Rendering**: `/api/render/clip`, `/api/render/segment`, `/api/frame`
- **Configuration**: `/api/config`, `/api/models`

All long-running operations use **Server-Sent Events (SSE)** for real-time progress updates.

#### Pipeline Modules

1. **`pipeline/ingestion.py`**
   - `download_video()` — Download from YouTube/Twitch/Kick URLs
   - `stream_audio_to_file()` — Stream Twitch audio-only (no video storage)
   - `download_segment()` — Download specific time ranges
   - `save_upload()` — Handle file uploads

2. **`pipeline/transcription.py`**
   - `transcribe()` — Main transcription function with automatic GPU detection
   - `detect_device()` — Auto-detect CUDA/Apple Silicon/CPU
   - Supports chunked transcription for long videos (>30 minutes)

3. **`pipeline/highlight_detection.py`**
   - `detect_highlights()` — Two-turn LLM approach for reliable clip detection
   - Uses brand pillars: cozy energy, gap moe rage, lore drops/quotes
   - Handles transcript chunking for large files

4. **`pipeline/renderer.py`**
   - `render_clip()` — FFmpeg rendering with stacked layout
   - `_build_ass()` — ASS subtitle generation with karaoke highlighting
   - Supports custom crop regions, fonts, colors

### Frontend Architecture

- **React + Vite** — Modern frontend build system
- **TypeScript** — Type-safe components
- **Konva** — Interactive canvas for crop region selection
- **Tailwind CSS** — Utility-first styling
- **API Client** — `frontend/src/api.ts` handles backend communication

### Data Flow

1. User uploads video or provides URL
2. Video is downloaded/streamed to workspace
3. Whisper transcribes audio with word-level timestamps
4. Transcript is chunked and sent to LLM for highlight detection
5. User reviews clips, adjusts timestamps, and selects crop regions
6. FFmpeg renders final clip with burned-in subtitles

## Key Technical Details

### GPU Detection

The transcription module automatically detects the best available compute backend:
- **CUDA** → Nvidia/AMD GPUs (via ctranslate2)
- **Apple Silicon** → CPU with Accelerate framework
- **CPU fallback** → Generic CPU with int8 quantization

### Transcript Format

```json
{
  "language": "en",
  "language_probability": 0.99,
  "duration": 3600.5,
  "segments": [
    {
      "start": 12.5,
      "end": 18.2,
      "text": "Hello world",
      "words": [
        {"word": "Hello", "start": 12.5, "end": 13.1, "probability": 0.99},
        {"word": "world", "start": 13.1, "end": 13.8, "probability": 0.98}
      ]
    }
  ]
}
```

### Clip Format

```json
{
  "title": "She absolutely lost it",
  "start": 125.0,
  "end": 192.0,
  "reason": "Peak emotional outburst with perfect timing",
  "virality_score": 91,
  "brand_alignment": ["gap moe / sudden gaming rage"],
  "hashtags": ["#VTuber", "#GapMoe", "#GamingRage"]
}
```

### Video Rendering

- **Stacked layout**: Avatar (top 50%) + Gameplay (bottom 50%)
- **ASS subtitles**: Karaoke-style word highlighting
- **FFmpeg filtergraph**: Complex filter chain for cropping, scaling, and stacking
- **Output**: 1080×1920 MP4 with burned-in subtitles

## Testing and Debugging

### Running Tests

```bash
# Test highlight detection
python test_highlight_detection.py workspace/test_transcript.json

# Test subtitle rendering (if available)
python test_subtitle_rendering.py
```

### Debugging Tips

1. **Check workspace directory** — All intermediate files are stored there
2. **Review SSE events** — Progress updates are streamed in real-time
3. **Inspect FFmpeg output** — Rendering errors often show in stderr
4. **Validate JSON formats** — Transcript and clip formats must match expected schemas

### Common Issues

- **CUDA detection failures** — Ensure `nvidia-container-toolkit` is installed
- **Ollama connection issues** — Verify container networking and API key
- **FFmpeg errors** — Check video codec compatibility and file paths
- **Whisper memory issues** — Use smaller models or enable chunking

## Deployment Notes

### Production Configuration

- Set appropriate resource limits in docker-compose
- Configure workspace volume for persistent storage
- Set up proper authentication for LLM endpoints
- Monitor GPU memory usage for long transcriptions

### Scaling Considerations

- Transcription is CPU/GPU-bound
- Highlight detection is LLM-bound (can be rate-limited)
- Rendering is CPU/GPU-bound (FFmpeg)
- Consider separate workers for each pipeline stage in high-volume setups
