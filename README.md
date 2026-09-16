# Momiji Clipper 🍁

Self-hosted clip extraction pipeline for VTuber VODs. Transcribes with Whisper, identifies viral moments with an LLM, and exports clips at **source quality** — no re-encoding, no burned-in subtitles.

## Architecture

```
Video URL/Upload → Ingest → Chunked Transcription → LLM Highlight Detection → Source Quality Export
                                                                             ↓
                                                                    Clip Studio Queue
                                                                    (batch processing)
```

**Clip Studio mode** is the default: process videos through the full pipeline and export identified clips at original resolution and codec via FFmpeg stream copy (`-c:v copy -c:a copy`).

The legacy 1080×1920 vertical render with karaoke subtitles is still available as an explicitly opt-in path via `/api/render/*` endpoints.

## Agent Access

AI agents can connect to a user account via **API keys** or **device-code pairing**:

1. **Device code flow** (no browser needed):
   - Agent: `POST /api/api-keys/device-code` with requested scopes
   - User: `POST /api/api-keys/device-code/approve` from the web UI
   - Agent: `POST /api/api-keys/device-code/exchange` to get the API key

2. **API key auth**: `Authorization: Bearer mc_live_...` header on all endpoints

3. **Agent discovery**: `GET /api/agent/info` — returns identity, scopes, capabilities

Available scopes: `ingest`, `transcribe`, `highlights`, `pipeline`, `clips`, `projects`, `render`, `clip-studio`, `api-keys`, `agent`

## Quick start

1. Copy `.env.example` to `.env` and fill in values
2. Pull models: `docker exec -it momiji-ollama ollama pull gemma3:latest && ollama pull gemma4:12b`
3. Start: `docker compose up --build`
4. Open http://localhost:7860

## Environment

| Variable | Default | Description |
|---|---|---|
| `LLM_MODEL` | `gemma3:latest` | Default LLM for general tasks |
| `HIGHLIGHT_LLM_MODEL` | `gemma4:12b` | LLM for highlight detection |
| `WHISPER_MODEL` | `small` | Whisper model size |
| `RAM_TIER` | `standard` | `low` (8GB), `standard` (16GB), `high` (32GB+) |
| `OLLAMA_NUM_CTX` | `8192` | Ollama context window limit |
| `VISION_SCAN_FPS` | `0.25` | Frame sampling rate |
| `CLIP_STUDIO_EXPORT_QUALITY` | `source` | `source`, `visually_lossless`, `high` |

## Resource limits

All Docker containers have memory limits tuned for 16GB machines. Adjust via env vars:

| Variable | Default | Container |
|---|---|---|
| `OLLAMA_MEMORY_LIMIT` | `9g` | Ollama |
| `CELERY_MEMORY_LIMIT` | `3g` | Celery worker |
| `BACKEND_MEMORY_LIMIT` | `1g` | FastAPI |
| `REDIS_MAXMEMORY` | `256mb` | Redis |

For 8GB machines, set `RAM_TIER=low` and reduce memory limits accordingly.