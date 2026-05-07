# AGENTS.md

## Behavioral Guidelines

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
  Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**
When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.
  When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.
  The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**
Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"
  For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## Project-Specific Instructions for Momiji Clipper

### CRITICAL Knowledge

- Most user reported errors are for a different server, you will not be provided direct access to the logs but user copied versions of them.

### Essential Commands

#### Development

- **Start dev stack**: `docker compose up --build`
- **Start with NVIDIA GPU**: `docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up --build`
- **Access UI**: http://localhost:7860
- **Rebuild containers**: `docker compose build`

#### Model Management

- **Pull LLM model**: `docker exec -it momiji-ollama ollama pull llama3.1:8b`
- **Available models**: llama3.1:8b (~6GB VRAM), gemma3:27b (~18GB), llama3.1:70b (~40GB), mistral:7b (~5GB)

#### Environment

- Copy `.env.example` → `.env` and configure:
  - `LLM_BASE_URL`: Default `http://ollama:11434/v1`
  - `LLM_API_KEY`: Default `ollama` (use OpenAI key for external APIs)
  - `LLM_MODEL`: Default `llama3.1:8b`
  - `WHISPER_MODEL`: Default `large-v3`
  - `WHISPER_DEVICE`: Default `auto` (detects CUDA → Apple Silicon → CPU)

#### Testing

- **Test highlight detection**: `python test_highlight_detection.py workspace/<stem>_transcript.json`
- **Frontend dev**: `cd frontend && npm run dev`
- **Frontend build**: `cd frontend && npm run build`

### Architecture Notes

#### Service Structure

- **Backend**: FastAPI (`backend/api.py`) with modular pipeline
- **Frontend**: React + Vite + TypeScript + Tailwind (`frontend/`)
- **Communication**: REST API with SSE for progress updates

#### Pipeline Flow

1. Ingestion → `backend/pipeline/ingestion.py`
2. Transcription → `backend/pipeline/transcription.py` (GPU-accelerated Whisper)
3. Highlight Detection → `backend/pipeline/highlight_detection.py` (LLM-based)
4. Rendering → `backend/pipeline/renderer.py` (FFmpeg with ASS subtitles)

#### Data Storage

- All media stored in `./workspace/` (mounted into containers)
- Transcripts cached to avoid reprocessing same videos

### Important Notes

#### GPU Usage

- Transcription automatically uses best available device (CUDA → Apple Silicon → CPU)
- For NVIDIA GPU acceleration, ensure `nvidia-container-toolkit` is installed
- Use `docker-compose.nvidia.yml` override for GPU support

#### Common Operations

- Video upload: Drag & drop or paste URL in UI
- Clip selection: Adjust timestamps and crop regions in preview
- Rendering: Produces 1080×1920 MP4 with burned-in karaoke subtitles

#### Environment Variants

- `docker-compose.dev.yml`: Development configuration
- `docker-compose.prod.yml`: Production configuration
- `docker-compose.shared.yml`: Shared service definitions
