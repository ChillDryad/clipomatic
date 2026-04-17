# Momiji Clipper 🍁

Self-hosted AI clip factory for VTuber VODs. Transcribes with GPU-accelerated Whisper, identifies viral moments with an LLM, and renders 9:16 vertical clips with a stacked layout and karaoke-style word-highlight subtitles.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Ollama](https://ollama.com/) (bundled in the compose — no separate install needed)
- For Nvidia GPU: `nvidia-container-toolkit` installed on the host

## Quick start

1. Copy `.env.example` to `.env` and fill in your values (see below).
2. Pull a model into Ollama (once the stack is running):
   ```
   docker exec -it momiji-ollama ollama pull llama3.1:8b
   ```

**CPU / Apple Silicon / AMD:**
```bash
docker compose up --build
```

**Nvidia GPU (transcription + Ollama on GPU):**
```bash
docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up --build
```

Open [http://localhost:7860](http://localhost:7860) in your browser.

## Environment variables

Copy `.env.example` → `.env` and set these:

| Variable | Default | Description |
|---|---|---|
| `LLM_BASE_URL` | `http://ollama:11434/v1` | OpenAI-compatible API endpoint. Works with Ollama, OpenAI, LiteLLM, Groq. |
| `LLM_API_KEY` | `ollama` | API key for the LLM endpoint. Use `ollama` for local Ollama; your OpenAI key for `api.openai.com`. |
| `LLM_MODEL` | `llama3.1:8b` | Default model to pre-select in the UI. |
| `WHISPER_MODEL` | `large-v3` | Whisper model size. Larger = more accurate but slower and more VRAM. |
| `WHISPER_DEVICE` | `auto` | `auto` detects CUDA → Apple Silicon → CPU. Override with `cuda` or `cpu`. |

## Recommended Ollama models

| Model | VRAM | Notes |
|---|---|---|
| `llama3.1:8b` | ~6 GB | Good balance, recommended default |
| `gemma3:27b` | ~18 GB | Better quality, mid-range GPU |
| `llama3.1:70b` | ~40 GB | Best quality, high-end GPU |
| `mistral:7b` | ~5 GB | Fast, CPU-viable fallback |

## Using OpenAI instead of Ollama

Set in `.env`:
```
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

## Pipeline

1. **Ingest** — upload an MP4/MKV or paste a YouTube, Twitch, or Kick VOD URL.
2. **Transcribe** — faster-whisper runs on GPU (or CPU) and saves a JSON transcript with word-level timestamps.
3. **Highlight detection** — the transcript is chunked and sent to the LLM, which identifies 3–5 clip candidates scored by virality.
4. **Review & Render** — drag the crop boxes to mark your facecam and gameplay regions, adjust timestamps, preview inline, then render a 9:16 vertical MP4 with burned-in karaoke subtitles.

## Workspace

All downloaded videos, transcripts, frames, and renders are saved to `./workspace/` (mounted into the container). Transcripts are cached — re-uploading the same video skips transcription.

## Test highlight detection without the UI

```bash
python test_highlight_detection.py workspace/<stem>_transcript.json
```

Reads `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` from `.env` or environment.
