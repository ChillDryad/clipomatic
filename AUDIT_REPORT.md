# Clipomatic (Momiji Clipper) — Comprehensive Audit Report

**Date:** September 15, 2026  
**Branch:** `feat/api-keys`  
**Auditor:** Hermes Agent  

---

## 1. Architecture Overview

### 1.1 Stack

| Layer | Technology |
|-------|-----------|
| Backend | FastAPI (Python 3.10), async SQLAlchemy 2.0 |
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Task Queue | Celery + Redis (broker DB 0, results DB 1) |
| LLM | Ollama (local, in-compose) — Gemma3/Gemma4 models |
| Transcription | faster-whisper (CTranslate2 backend) |
| Media | FFmpeg / ffprobe (subprocess calls) |
| Database | SQLite (dev) / PostgreSQL (prod-ready via `DATABASE_URL`) |
| Auth | JWT RS256 (HttpOnly cookies) + API keys (bcrypt-hashed, scoped) |

### 1.2 Docker Services (`docker-compose.yml`)

| Service | Container | Purpose |
|---------|-----------|---------|
| `ollama` | `momiji-ollama` | Local LLM inference, no host port exposed |
| `momiji-clipper` | `momiji-clipper` | FastAPI backend (API + dispatcher) |
| `redis` | `momiji-redis` | Celery broker + result backend |
| `celery-worker` | `momiji-celery` | Pipeline task execution (Whisper, LLM, FFmpeg) |
| `frontend` | `momiji-frontend` | Nginx-served React build on port 7860 |

### 1.3 Data Flow

```
User → POST /api/ingest/url or /api/ingest/upload
       → VideoProject created (status="loaded")
       → File saved to ./workspace/

User → POST /api/pipeline/enqueue  (or /api/pipeline/clip-studio/enqueue)
       → PipelineJob or ClipStudioQueue created (status="queued")

PipelineDispatcher (asyncio loop in FastAPI process)
       → Polls queued jobs every 2s
       → Round-robin fairness per user, GPU/CPU concurrency limits
       → Dispatches to Celery: pipeline_chain.delay() or process_clip_studio_task.delay()

Celery Worker:
  pipeline_chain (regular pipeline):
    1. transcribe  → faster-whisper → transcript saved to DB + file
    2. highlights  → LLM chunked detection → clips saved to DB + file
    3. export_segments → FFmpeg stream copy → ClipStudioExport records

  process_clip_studio_task (Clip Studio):
    Same 3 steps, but driven by ClipStudioQueue item
    Progress written to ClipStudioQueue.progress/current_step

SSE: GET /api/pipeline/jobs/{id}/stream → Redis Pub/Sub → real-time progress

Frontend: ClipStudioPage polls /api/pipeline/clip-studio/queue every 5s
```

### 1.4 Key Database Models

- **`VideoProject`** — Source video, owner, status, clips relationship
- **`GeneratedClip`** — Detected clips with timestamps, virality scores, render paths
- **`Transcript`** — Full transcript with segments, audio energy, vision analysis
- **`PipelineJob` / `PipelineEvent`** — Regular pipeline queue + progress events
- **`ClipStudioQueue` / `ClipStudioExport`** — Batch processing queue + exported segments
- **`ApiKey`** — Bcrypt-hashed API keys with scopes and expiry
- **`User` / `UserOAuthAccount`** — User auth, OAuth provider linking
- **`Team` / `TeamMember` / `TeamInvite`** — Team collaboration

---

## 2. Current Capabilities

### 2.1 What Works End-to-End

| Capability | Status | Notes |
|-----------|--------|-------|
| Video ingestion (URL download) | ✅ Working | yt-dlp for YouTube/Twitch/Kick, parallel HLS fragments |
| Video ingestion (file upload) | ✅ Working | 100MB limit, MIME validation, SHA-256 hashing |
| Twitch audio-only streaming | ✅ Working | 16kHz mono WAV, no video stored |
| Transcription (short videos) | ✅ Working | faster-whisper, auto device detection (CUDA→Apple Silicon→CPU) |
| Chunked transcription (long VODs) | ✅ Working | 30-min chunks with 30s overlap, dedup, >1h threshold |
| Audio energy analysis | ✅ Working | Per-second RMS, spike/silence detection |
| Vision analysis | ✅ Working | Frame sampling, LLM scene analysis, batch processing with cache |
| Highlight detection | ✅ Working | Chunked LLM, timestamp snapping, dedup, fallback model |
| Clip Studio batch processing | ✅ Working | Queue → transcribe → highlights → source quality export |
| Source quality export | ✅ Working | FFmpeg stream copy (`-c:v copy -c:a copy`), fallback to re-encode |
| EDL generation | ✅ Working | CMX 3600 format for DaVinci/Premiere |
| Per-clip metadata JSON | ✅ Working | Codec, resolution, bitrate, file size, virality score |
| API key authentication | ✅ Working | `mc_live_` prefix, bcrypt hashed, scope-checked |
| JWT cookie authentication | ✅ Working | RS256, 24h access token, 90d refresh token |
| OAuth (Google/Twitch/YouTube) | ✅ Working | PKCE, token encryption at rest (Fernet) |
| Pipeline dispatcher | ✅ Working | Round-robin fairness, GPU/CPU limits, crash recovery |
| SSE progress streaming | ✅ Working | Redis Pub/Sub for real-time updates |
| Scheduled social posting | ✅ Working | PostJob model, scheduler, YouTube/TikTok/Instagram |
| Team collaboration | ✅ Working | Teams, invites, roles (owner/admin/editor/viewer) |

### 2.2 Partial / Incomplete

| Item | Status | Details |
|------|--------|---------|
| API key scope enforcement | ⚠️ Partial | See §3.2 — several routers still use JWT-only `get_current_user` |
| Agent pairing flow | ❌ Not implemented | No endpoint for agent-to-account binding; keys created via UI only |
| Clip Studio as default mode | ⚠️ Partial | Pipeline supports both regular + Clip Studio; UI has separate pages |
| PostgreSQL production setup | ⚠️ Partial | Models support it, but prod compose missing Celery + Redis |
| NVIDIA GPU support | ⚠️ Partial | Override file exists but not tested with Clip Studio pipeline |

### 2.3 Broken / Problematic

| Item | Status | Details |
|------|--------|---------|
| `docker-compose.prod.yml` | 🐛 Bug | Missing Redis, Celery worker, and Celery/Redis env vars; `WHISPER_prodICE` typo (line 19) |
| `POST /api/transcribe` endpoint | 🐛 Bug | No auth dependency — anyone can call it (`transcribe.py:46`) |
| `POST /api/highlights` endpoint | 🐛 Bug | No auth dependency — anyone can call it (`highlights.py:37`) |
| `POST /api/transcribe/segment` | 🐛 Bug | No auth dependency (`transcribe.py:232`) |
| `POST /api/timeline/batch` | 🐛 Bug | No auth dependency (`timeline.py:50`) |
| `PATCH /api/clips/{clip_key}` | 🐛 Bug | No auth dependency (`clips.py:66`) |
| `POST /api/clips/{clip_key}/regenerate-metadata` | 🐛 Bug | No auth — modifies cache files (`clips.py:116`) |

---

## 3. Agent Access Readiness

### 3.1 Authentication System Overview

Two auth paths exist:

1. **JWT Cookie Auth** (`get_current_user`) — `auth.py:343` — Reads `access_token` HttpOnly cookie, validates RS256 JWT, loads User from DB.

2. **API Key + JWT Fallback** (`get_current_user_or_api_key`) — `auth.py:359` — Checks `Authorization: Bearer mc_live_...` header first, falls back to JWT cookie. Scope-checked on endpoint path prefix.

### 3.2 Scope System: Complete but NOT Enforced Everywhere

**Available scopes** (`api_keys.py:34-43`):
```python
AVAILABLE_SCOPES = [
    "ingest", "transcribe", "highlights", "pipeline",
    "clips", "projects", "render", "clip-studio",
]
```

**Scope enforcement logic** (`auth.py:407-435`):
- Derives scope from URL path: `/api/pipeline/...` → scope `pipeline`
- Special mapping: `render`, `timeline`, `media`, `markers` → scope `render`
- Special case: `/api/pipeline/clip-studio/*` accepts `clip-studio` OR `pipeline` scope
- If key has `scopes=None` (null), ALL scopes are granted (no restriction)

**Endpoints using `get_current_user_or_api_key` (API key compatible): 39 endpoints**

**Endpoints using JWT-only `get_current_user` (NO API key access): 24 endpoints**, including:

| Router | Endpoints | Impact |
|--------|-----------|--------|
| `timeline.py` | `/api/render/clip`, `/api/render/segment`, `/api/render/timeline`, `/api/render/preview`, `/api/timeline/batch` | **Agent cannot render clips** |
| `api_keys.py` | All 4 endpoints (create/list/revoke/scopes) | **Agent cannot manage its own keys** |
| `teams.py` | All 8 endpoints | Agent cannot manage teams |
| `thumbnails.py` | All 5 endpoints | Agent cannot manage thumbnails |
| `config.py` | `/api/models` | Agent cannot list available models |
| `auth.py` | `/api/auth/me` | Agent cannot check its own user profile |
| `media.py` | 1 endpoint | Agent cannot upload media assets |

### 3.3 Endpoints with NO Authentication At All

```python
# transcribe.py:46 — NO auth dependency
async def transcribe(req: TranscribeRequest):

# highlights.py:37 — NO auth dependency  
async def highlights(req: HighlightsRequest):

# transcribe.py:232 — NO auth dependency
async def transcribe_segment(req: TranscribeSegmentRequest):

# timeline.py:50 — NO auth dependency
async def batch_edit(req: BatchEditRequest):

# clips.py:66 — NO auth dependency
async def patch_clip(clip_key: str, req: ClipPatchRequest):
```

These are **critical security gaps**. Any unauthenticated user can:
- Run transcription on arbitrary file paths (server-side file read)
- Run highlight detection with arbitrary transcript data
- Modify cached clip files via path injection
- Execute timeline batch operations

### 3.4 Can an Agent Fully Operate the Pipeline via API Keys?

**Almost, but not quite.** The core Clip Studio flow works:

| Step | Endpoint | API Key? | Scope |
|------|----------|----------|-------|
| 1. Ingest URL | `POST /api/ingest/url` | ✅ | `ingest` |
| 2. Ingest upload | `POST /api/ingest/upload` | ✅ | `ingest` |
| 3. Enqueue Clip Studio | `POST /api/pipeline/clip-studio/enqueue` | ✅ | `clip-studio` or `pipeline` |
| 4. Monitor queue | `GET /api/pipeline/clip-studio/queue` | ✅ | `clip-studio` or `pipeline` |
| 5. Get exports | `GET /api/pipeline/clip-studio/queue/{id}` | ✅ | `clip-studio` or `pipeline` |
| 6. Cancel | `POST /api/pipeline/clip-studio/queue/{id}/cancel` | ✅ | `clip-studio` or `pipeline` |
| 7. List projects | `GET /api/projects` | ✅ | `projects` |
| 8. Get project clips | `GET /api/projects/{id}/clips` | ✅ | `projects` |
| 9. Download export | `GET /workspace/...` | ✅ | Static file (no auth) |

**What's missing for full agent operation:**
- ❌ Cannot list available LLM models (`/api/models` — JWT only)
- ❌ Cannot render clips with subtitles (`/api/render/clip` — JWT only)
- ❌ Cannot download segments (`/api/render/segment` — JWT only)
- ❌ Cannot check own user identity (`/api/auth/me` — JWT only)
- ❌ Cannot manage API keys programmatically (create/list/revoke — JWT only)
- ❌ SSE stream endpoint (`/api/pipeline/jobs/{id}/stream`) uses `get_current_user_or_api_key` but SSE over `fetch()` with Bearer headers is non-standard for browsers; agents using `curl`/HTTP clients can use it fine

### 3.5 What's Needed for "Agent Pairing" to a User Account

Currently, API key creation requires:
1. User logs in via web UI (JWT cookie)
2. Calls `POST /api/api-keys` with label + scopes
3. Receives plaintext key once

**For agent pairing, the system needs:**

1. **OAuth-like device flow or pairing endpoint** — A way for an agent to obtain an API key without a browser session:
   - `POST /api/api-keys/pair` — accepts user credentials (email/password) or existing JWT, returns API key
   - Or a "device code" flow: agent displays a code, user approves in web UI

2. **API key self-management** — All `api_keys.py` endpoints should accept API key auth with an `api-keys` scope (or `admin` scope for key management)

3. **Agent identity endpoint** — `GET /api/auth/me` should accept API keys so agents can verify their identity and scopes

4. **Scope documentation / discovery** — `GET /api/api-keys/scopes` should accept API key auth so agents can discover available scopes

5. **Key rotation** — Endpoint to rotate an existing key without losing scope/label

---

## 4. Source Quality Rendering

### 4.1 Is Source Quality the Default for All Exports?

**Yes, for Clip Studio exports.** The default is explicitly set in multiple places:

- `docker-compose.yml:53` — `CLIP_STUDIO_EXPORT_QUALITY=source`
- `.env.example:67` — `CLIP_STUDIO_EXPORT_QUALITY=source`
- `pipeline.py:749` — `_default_clip_studio_config()` defaults to `"source"`
- `renderer.py:582` — `ClipStudioExportConfig.export_quality` defaults to `"source"`
- `tasks.py:291` — `clip_studio_config.get("export_quality", "source")`

### 4.2 Are There Code Paths That Still Render to 1080x1920 with Burned-in Subtitles?

**Yes.** The `render_clip()` function in `renderer.py:879` is a separate code path that:
- Renders to 1080×1920 vertical MP4 (`output_width=1080, output_height=1920` — `renderer.py:895-896`)
- Burns in ASS karaoke subtitles via FFmpeg `subtitles=` filter
- Applies crop/scale/zoom/stack layouts
- This is the **"viral clip" rendering path**, not the Clip Studio path

This path is exposed via:
- `POST /api/render/clip` (`timeline.py:143`) — JWT only, no API key
- `POST /api/render/preview` (`timeline.py:284`) — JWT only
- `POST /api/render/timeline` (`timeline.py:241`) — JWT only

**The two paths coexist but serve different purposes:**
- **Clip Studio path** (`export_source_quality_segments`) — Find and extract clips at source quality, no subtitles
- **Render clip path** (`render_clip`) — Create final vertical clips with subtitles for social media

The Clip Studio path is the **correct default for the "find and extract clips" use case**. The render clip path is legacy/social-media oriented and should be explicitly opt-in.

### 4.3 Is the Clip Studio Pipeline the Default Processing Mode?

**Partially.** Both modes are available simultaneously:

1. **Regular pipeline** (`POST /api/pipeline/enqueue`) — Steps: `transcribe → highlights → export_segments`
   - Default steps include `export_segments` (`pipeline.py:111`)
   - Uses `pipeline_chain` Celery task
   - Export uses ClipStudioExportConfig with source quality default

2. **Clip Studio batch** (`POST /api/pipeline/clip-studio/enqueue`) — Same 3 steps, but:
   - Processes multiple projects at once
   - Uses `process_clip_studio_task` Celery task
   - Dedicated queue with progress tracking
   - Same source quality export

The regular pipeline **does** include `export_segments` as a default step, so source quality export is now part of both paths. The Clip Studio path adds batch processing and better queue management.

**Frontend routing:** Clip Studio has its own page at `/clip-studio` (`App.tsx:142`). The regular pipeline page is at `/pipeline`. Both are accessible from the navbar.

---

## 5. Code Quality Issues

### 5.1 Bugs

| Severity | Location | Issue |
|----------|----------|-------|
| **Critical** | `transcribe.py:46` | `POST /api/transcribe` has NO auth dependency — unauthenticated access |
| **Critical** | `highlights.py:37` | `POST /api/highlights` has NO auth dependency |
| **Critical** | `clips.py:66` | `PATCH /api/clips/{clip_key}` has NO auth — arbitrary file write to cache |
| **Critical** | `transcribe.py:232` | `POST /api/transcribe/segment` has NO auth |
| **Critical** | `timeline.py:50` | `POST /api/timeline/batch` has NO auth |
| **High** | `docker-compose.prod.yml:19` | Typo: `WHISPER_prodICE` instead of `WHISPER_DEVICE` |
| **High** | `docker-compose.prod.yml` | Missing Redis, Celery worker, Celery/Redis env vars — prod stack non-functional |
| **Medium** | `docker-compose.yml:48` | `JWT_SECRET` env var is set but `auth.py` uses `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` (RS256) — `JWT_SECRET` is unused dead config |
| **Medium** | `auth.py:198-218` | Docstring says "15-minute expiry" but code sets 1440 minutes (24h) — `ACCESS_TOKEN_EXPIRE_MINUTES = 1440` |
| **Medium** | `auth.py:232-249` | Docstring says "30-day expiry" but code sets 90 days — `REFRESH_TOKEN_EXPIRE_DAYS = 90` |
| **Medium** | `pipeline.py:285-287` | SSE generator `get_session()` called directly on `AsyncSession` object — should use `get_session_cm()` or `async with` |
| **Low** | `celery_app.py:207` | `import tasks` at end of file for side effect — fragile pattern, should use `celery_app.autodiscover_tasks()` |
| **Low** | `transcribe.py:269-273` | `WORKSPACE` variable defined at bottom of file, used in functions above — works due to module-level execution order but fragile |

### 5.2 Dead Code / Inconsistencies

| Location | Issue |
|----------|-------|
| `docker-compose.yml:48` | `JWT_SECRET` passed to containers but never read by code (RS256 uses `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`) |
| `.env.example:34` | `JWT_SECRET=change-me-to-a-random-secret` — misleading; should be `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` |
| `.env.prod.example:23` | `DATABASE_URL=sqlite+aiosqlite:///./momiji.db` — prod should use PostgreSQL, and the path is relative (not in workspace) |
| `.env.dev.example:28` | `OAUTH_ENCRYPTION_KEY=ZmFrZS1rZXkt...` — looks like a real-looking fake key, could cause confusion |
| `pipeline_dispatcher.py:110` | Clip Studio items tracked as `cs_{queue_id}` but `_active_jobs` dict uses raw `queue_id` for some lookups — inconsistent prefixing |
| `renderer.py:13` | Re-exports `extract_frame, get_video_dimensions` from `pipeline.media` with `# noqa: F401` — should import directly where needed |
| `docker-compose.prod.yml` | No `celery-worker` service — pipeline won't work in prod |
| `docker-compose.dev.yml:84` | `LLM_ALLOW_CLOUD=1` set for dev celery worker but not for backend — highlight detection from API will reject cloud models |

### 5.3 Architecture Inconsistencies

1. **Two pipeline dispatch paths** — `pipeline_chain` (regular) and `process_clip_studio_task` (Clip Studio) duplicate much logic. Both call `_run_transcribe`, `_run_highlights`, `_run_export_segments` but have separate queue/status management.

2. **Dual data storage** — Transcript and clips are stored in both DB (Transcript/GeneratedClip tables) and JSON cache files (`{stem}_transcript.json`, `{stem}_clips.json`). Code falls back from DB to file, creating migration complexity.

3. **`_run_async` pattern** (`tasks.py:641-663`) — Celery workers are sync but DB is async. Every DB operation requires `_run_async(async_fn)`. This creates a ThreadPoolExecutor per call when inside a running loop, which is inefficient. Consider using sync SQLAlchemy sessions in Celery workers instead.

### 5.4 TODO Items

Only one explicit TODO found:
- `backend/pipeline/audio.py:99` — `# TODO: deprecate, we should be streaming full video download.`

---

## 6. Security Concerns

### 6.1 Critical: Unauthenticated Endpoints

Five endpoints have **no authentication at all** (see §5.1). These allow:
- Arbitrary file path access via `video_path`/`audio_path` parameters
- Server-side transcription of any file the process can read
- Modification of clip cache files
- Highlight detection consuming LLM resources without auth

### 6.2 API Key Scope Bypass Risk

The scope derivation logic (`auth.py:407-435`) maps URL path segments to scopes:
```python
path_parts = request.url.path.strip("/").split("/")
endpoint_scope = path_parts[1]  # /api/{scope}/...
```

**Potential bypass:** If an endpoint path doesn't match the expected pattern (e.g., nested routes, custom prefixes), the scope check may be skipped or map to the wrong scope. The `scope_map` dict only handles 4 cases; all other paths use the raw path segment.

### 6.3 Secrets in Environment / Config

| Item | Risk | Details |
|------|------|---------|
| `JWT_SECRET` in env files | 🟡 Misleading | Set but unused — RS256 uses `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`. If someone sets `JWT_SECRET` thinking auth is configured, they get ephemeral RSA keys (insecure). |
| `OAUTH_ENCRYPTION_KEY` in `.env.dev.example` | 🟡 Low | Fake key in example file — but if used as-is in dev, OAuth tokens are "encrypted" with a known key. |
| Ephemeral RSA keys | 🔴 High | If `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` not set (which they aren't in any env example), `auth.py:73-88` generates ephemeral keys on startup. All JWTs become invalid on restart, and in multi-process deployments, different processes have different keys. |
| `LLM_API_KEY=ollama` | 🟢 OK | Ollama doesn't require real auth; this is a placeholder for the OpenAI client library. |
| OAuth client secrets | 🟡 Medium | In `.env.example` with placeholder values — fine, but no validation that they're set before OAuth endpoints are called. |

### 6.4 CORS Configuration

`api.py:67-97` — Properly configured:
- Explicit origins (no wildcards) ✅
- `allow_credentials=True` (needed for HttpOnly cookies) ✅
- Explicit methods and headers ✅
- Security headers middleware (X-Frame-Options, CSP, etc.) ✅

### 6.5 Path Traversal

- `ingest.py:87-92` — Filename sanitization with `os.path.basename()` check ✅
- `ingest.py:103` — UUID-based filename generation ✅
- `clips.py:68` — `_parse_clip_key()` extracts `source_path` from URL path — **potential path traversal** if source_path contains `../`
- `timeline.py:69-70` — `/workspace/` prefix stripping without validation
- `timeline.py:152-153` — Same pattern, no path validation

### 6.6 Rate Limiting

`api.py:32` — Rate limiter is initialized (`Limiter(key_func=get_remote_address)`) but **never applied to any route**. No `@limiter.limit()` decorators anywhere in the codebase. The limiter is effectively dead code.

---

## 7. Recommendations (Prioritized)

### P0 — Critical Security Fixes (Do Immediately)

1. **Add auth to all unauthenticated endpoints**
   - `transcribe.py:46` → Add `user: User = Depends(get_current_user_or_api_key)`
   - `highlights.py:37` → Same
   - `transcribe.py:232` → Same
   - `timeline.py:50` → Same
   - `clips.py:66` → Same
   - `clips.py:116` (regenerate-metadata) → Already has auth ✅ but `patch_clip` doesn't

2. **Switch all JWT-only endpoints to `get_current_user_or_api_key`**
   - `timeline.py` — All 4 render endpoints (clip, segment, timeline, preview)
   - `api_keys.py` — All 4 endpoints (agent needs to self-manage keys)
   - `config.py` — `/api/models` (agent needs to discover available models)
   - `auth.py` — `/api/auth/me` (agent needs identity verification)
   - `thumbnails.py` — All endpoints
   - `teams.py` — All endpoints (for agent team collaboration)

3. **Fix `docker-compose.prod.yml`**
   - Fix `WHISPER_prodICE` → `WHISPER_DEVICE` typo
   - Add Redis service
   - Add Celery worker service
   - Add all missing env vars (CELERY_BROKER_URL, CELERY_RESULT_BACKEND, Clip Studio vars)

### P1 — Agent Access Completeness

4. **Implement agent pairing flow**
   - Add `POST /api/api-keys/pair` endpoint that accepts user credentials and returns an API key
   - Or implement device code flow: `POST /api/api-keys/device-code` → user approves in UI → `POST /api/api-keys/device-code/{code}/exchange`
   - Document the pairing flow for agent developers

5. **Add `api-keys` scope for self-management**
   - Allow API keys with `api-keys` scope to list/revoke their own keys
   - Prevent key from deleting itself (or allow with explicit confirmation)

6. **Add agent discovery endpoints**
   - `GET /api/agent/info` — Returns user info, available scopes, pipeline capabilities
   - `GET /api/agent/status` — Returns active jobs, queue position, resource availability
   - Document the full agent API surface (OpenAPI/Swagger is auto-generated by FastAPI at `/docs`)

7. **Make SSE stream work with API keys**
   - Current `stream_job_progress` accepts API keys via `get_current_user_or_api_key` ✅
   - But SSE clients typically use `EventSource` API which doesn't support custom headers
   - Add support for API key as query parameter: `?api_key=mc_live_...` for SSE endpoints only
   - Or document that agents should use `fetch()` with `ReadableStream` instead of `EventSource`

### P2 — Source Quality as True Default

8. **Make Clip Studio the primary pipeline path**
   - Consider merging `pipeline_chain` and `process_clip_studio_task` — they run the same 3 steps
   - The regular pipeline already includes `export_segments` as a default step, so the distinction is mainly queue management
   - Frontend: Make Clip Studio the default landing page for new videos

9. **Deprecate or gate the 1080×1920 render path**
   - `render_clip()` should be explicitly opt-in (e.g., `?mode=viral` parameter)
   - Add a clear distinction in the API: "source quality extraction" vs "viral clip rendering"
   - Keep the render path for users who want final clips with subtitles, but don't make it the default

10. **Add `render` scope to Clip Studio flow**
    - The Clip Studio export uses `export_source_quality_segments()` which doesn't need the `render` scope
    - But the scope mapping in `auth.py` maps `timeline` → `render`, which could confuse agents
    - Consider adding an `export` scope for Clip Studio exports

### P3 — Code Quality & Reliability

11. **Fix JWT configuration**
    - Replace `JWT_SECRET` in env files with `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` (PEM-encoded RSA keys)
    - Add startup validation that keys are set (fail fast instead of generating ephemeral keys)
    - Generate key pair in Docker entrypoint if not provided (persist to volume)

12. **Fix docstring/code mismatches**
    - `auth.py:198` — Update docstring to say "24 hours" not "15 minutes"
    - `auth.py:232` — Update docstring to say "90 days" not "30 days"

13. **Enable rate limiting**
    - Apply `@limiter.limit()` to auth endpoints (login, register) to prevent brute force
    - Apply to ingestion endpoints to prevent abuse
    - Apply to pipeline enqueue to prevent queue flooding

14. **Consolidate pipeline dispatch**
    - Merge `pipeline_chain` and `process_clip_studio_task` into a single task that accepts a queue type
    - Or have `process_clip_studio_task` call `pipeline_chain` internally
    - This eliminates ~100 lines of duplicated queue/status management code

15. **Fix `_run_async` pattern**
    - Consider using sync SQLAlchemy sessions in Celery workers (`create_engine` instead of `create_async_engine`)
    - This eliminates the ThreadPoolExecutor overhead and potential event loop nesting issues
    - The `_run_async` helper is a workaround, not a solution

16. **Fix `pipeline.py:285` SSE generator**
    - `get_session()` yields an `AsyncSession` but is used as `async with get_session() as session` — this is incorrect
    - Should use `get_session_cm()` instead: `async with get_session_cm() as session`

17. **Add path validation utility**
    - Create `_validate_workspace_path(path: str) -> str` that resolves and checks paths are within WORKSPACE
    - Apply to all endpoints that accept file paths as parameters
    - Prevents path traversal attacks

### P4 — Production Readiness

18. **PostgreSQL for production**
    - Test all models and queries against PostgreSQL
    - The `init_db()` function uses `ALTER TABLE ... ADD COLUMN` with `try/except` — this is SQLite-specific
    - Use Alembic migrations for schema changes

19. **Add health checks for all services**
    - `docker-compose.yml` has health checks for Redis and Ollama but not for the backend or Celery
    - Add `/health` check for backend (already exists at `api.py:277`)
    - Add Celery worker health check (`celery inspect ping`)

20. **Add `HIGHLIGHT_LLM_*` env vars to docker-compose.yml**
    - The base `docker-compose.yml` doesn't pass `HIGHLIGHT_LLM_BASE_URL`, `HIGHLIGHT_LLM_API_KEY`, or `HIGHLIGHT_LLM_MODEL`
    - The dev compose file does — but base/prod don't
    - This means highlight detection falls back to `LLM_*` vars, which may point to a different model

21. **Add `LLM_ALLOW_CLOUD` to base compose**
    - The `llm_policy.py` validator rejects models not in `LOCAL_LLM_MODELS`
    - `LLM_ALLOW_CLOUD` bypasses this, but it's only set in `docker-compose.dev.yml`
    - Document when this should be enabled vs disabled

---

## Appendix: File Reference Index

| File | Lines | Purpose |
|------|-------|---------|
| `backend/api.py` | 279 | FastAPI app setup, lifespan, CORS, security headers, router includes |
| `backend/auth.py` | 450 | JWT RS256, password hashing, OAuth encryption, auth dependencies |
| `backend/db.py` | 663 | SQLAlchemy models, session factory, migrations |
| `backend/tasks.py` | 662 | Celery pipeline tasks, _run_async helper, DB persistence |
| `backend/celery_app.py` | 206 | Celery config, process_clip_studio_task |
| `backend/pipeline_dispatcher.py` | 277 | Async dispatcher, round-robin fairness, crash recovery |
| `backend/llm_policy.py` | 34 | Local model allowlist enforcement |
| `backend/routers/pipeline.py` | 755 | Pipeline queue + Clip Studio queue endpoints |
| `backend/routers/api_keys.py` | 184 | API key CRUD + scope listing |
| `backend/routers/ingest.py` | 411 | Video upload, URL download, Twitch streaming |
| `backend/routers/transcribe.py` | 273 | Transcription endpoints (⚠️ missing auth) |
| `backend/routers/highlights.py` | 172 | Highlight detection (⚠️ missing auth) |
| `backend/routers/clips.py` | 211 | Clip metadata operations (⚠️ patch missing auth) |
| `backend/routers/timeline.py` | 383 | Timeline batch + render endpoints (JWT only) |
| `backend/routers/projects.py` | 651 | Project CRUD, clip management |
| `backend/routers/auth.py` | 285 | User registration, login, OAuth, token refresh |
| `backend/pipeline/renderer.py` | 1750 | ASS subtitles, FFmpeg render_clip, source quality export |
| `backend/pipeline/transcription.py` | 660 | faster-whisper, chunked transcription, vision analysis |
| `backend/pipeline/highlight_detection.py` | 651 | LLM chunked detection, timestamp parsing, dedup |
| `backend/pipeline/ingestion.py` | 431 | yt-dlp download, Twitch audio streaming |
| `backend/pipeline/vision.py` | 504 | Frame sampling, LLM vision analysis, caching |
| `frontend/src/api.ts` | 1830 | API client functions, SSE reader, TypeScript types |
| `frontend/src/pages/ClipStudioPage.tsx` | 313 | Clip Studio UI |
| `frontend/src/App.tsx` | 176 | Router, route guards |
| `docker-compose.yml` | 128 | Base stack (Ollama + backend + Redis + Celery + frontend) |
| `docker-compose.prod.yml` | 57 | Prod stack (⚠️ broken — missing Redis/Celery) |
| `docker-compose.dev.yml` | 119 | Dev stack (working, with cloud LLM support) |

---

*End of report.*