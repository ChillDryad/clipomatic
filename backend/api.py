"""
Momiji Clipper — FastAPI backend.

All pipeline modules are called directly. Progress is streamed to the browser
via Server-Sent Events (SSE).
"""

import asyncio
import json
import logging
import os
import re
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from datetime import timedelta
from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from db import PostJob, User, get_session_cm
from auth import get_current_user
from pipeline import highlight_detection, ingestion, transcription
from pipeline.ingestion import extract_vod_id
from pipeline.renderer import CropBox, extract_frame, get_video_dimensions, render_clip

# ---------------------------------------------------------------------------
# App setup with lifespan
# ---------------------------------------------------------------------------

# Rate limiter - uses client IP for rate limiting
limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan — runs on startup and shutdown."""
    from db import init_db
    from scheduler import recover_scheduled_jobs, start_scheduler

    # Set up rate limiter state
    app.state.limiter = limiter

    await init_db()
    start_scheduler()
    await recover_scheduled_jobs()
    yield
    from scheduler import stop_scheduler
    stop_scheduler()


app = FastAPI(title="Momiji Clipper API", version="2.0.0", lifespan=lifespan)

# Rate limit exceeded handler
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — explicit configuration, no wildcards (security best practice)
_cors_origins = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", "http://localhost:7860").split(",")
    if o.strip()
]

# Validate that no wildcard is in origins
if "*" in _cors_origins:
    raise RuntimeError(
        "CORS_ORIGINS must not contain wildcard '*'. "
        "Specify explicit origins like: http://localhost:7860,https://app.example.com"
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,  # Required for HttpOnly cookies with CORS
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],  # Explicit methods only
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "Accept",
        "Origin",
    ],  # Explicit headers only
    expose_headers=[
        "Content-Length",
        "X-Request-Id",
    ],  # Headers browser can access
    max_age=600,  # Cache preflight for 10 minutes
)

WORKSPACE = os.environ.get(
    "WORKSPACE_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "workspace"),
)

os.makedirs(WORKSPACE, exist_ok=True)
os.makedirs(os.path.join(WORKSPACE, "audio"), exist_ok=True)
os.makedirs(os.path.join(WORKSPACE, "frames"), exist_ok=True)
os.makedirs(os.path.join(WORKSPACE, "renders"), exist_ok=True)

# Serve workspace files (frames, renders, audio) as static files
app.mount("/workspace", StaticFiles(directory=WORKSPACE), name="workspace")

# ---------------------------------------------------------------------------
# SSE helper
# ---------------------------------------------------------------------------

_CHUNK_SIZE = 4 * 1024 * 1024  # 4 MB for upload progress


_sse_event = lambda data: f"data: {json.dumps(data)}\n\n"


async def _sse_stream(fn, *args, **kwargs) -> AsyncGenerator[str, None]:
    """
    Run a blocking pipeline function in a thread pool, yielding SSE events.
    The function must accept a `progress_callback` kwarg.
    Final event is either {"done": true, "result": ...} or {"error": "..."}.
    """
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def cb(fraction: float, label: str) -> None:
        loop.call_soon_threadsafe(
            queue.put_nowait, {"progress": fraction, "label": label}
        )

    async def _run() -> None:
        try:
            result = await asyncio.to_thread(fn, *args, progress_callback=cb, **kwargs)
            queue.put_nowait({"done": True, "result": result})
        except Exception as exc:
            queue.put_nowait({"error": str(exc)})

    task = asyncio.create_task(_run())
    while True:
        try:
            event = await asyncio.wait_for(queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            yield _sse_event({"heartbeat": True})
            continue
        yield _sse_event(event)
        if "done" in event or "error" in event:
            break
    await task


def _sse_response(generator) -> StreamingResponse:
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------

class UrlRequest(BaseModel):
    url: str


# Allowed video/audio extensions for ingestion
_ALLOWED_INGEST_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".m4v", ".mp3", ".wav", ".aac", ".ogg"}
_MAX_INGEST_FILE_SIZE = 2 * 1024 * 1024 * 1024  # 2 GB for video files


@app.post("/api/ingest/upload")
@limiter.limit("10/hour")
async def ingest_upload(request: Request, file: UploadFile = File(...), user: User = Depends(get_current_user)):
    """
    Save an uploaded video/audio file to the workspace, streaming to disk in chunks.

    Security validations:
    - Path traversal prevention
    - Extension whitelist
    - File size limit (2 GB)
    - Rate limit: 10/hour (prevents storage DoS)
    """
    # SECURITY: Validate filename
    original_name = file.filename or "upload"

    # Strip path components to prevent path traversal
    safe_basename = os.path.basename(original_name)
    if safe_basename != original_name:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid filename: path components not allowed. Original: {original_name!r}"
        )

    # Validate extension
    ext = os.path.splitext(safe_basename)[1].lower()
    if ext not in _ALLOWED_INGEST_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file extension: {ext!r}. Allowed: {', '.join(sorted(_ALLOWED_INGEST_EXTENSIONS))}"
        )

    # Generate secure filename (UUID to prevent collisions)
    safe_name = f"{uuid.uuid4().hex[:12]}{ext}"
    dest_path = os.path.join(WORKSPACE, safe_name)

    written = 0
    with open(dest_path, "wb") as f:
        while chunk := file.file.read(_CHUNK_SIZE):
            # SECURITY: Check file size during streaming
            written += len(chunk)
            if written > _MAX_INGEST_FILE_SIZE:
                # Clean up partial file
                f.close()
                os.remove(dest_path)
                raise HTTPException(
                    status_code=413,
                    detail=f"File too large: exceeds {_MAX_INGEST_FILE_SIZE / (1024**3):.1f} GB limit"
                )
            f.write(chunk)
            mb_done = written / (1024 * 1024)
            yield _sse_event({
                "progress": -1,  # unknown total, just report bytes
                "label": f"Saving… {mb_done:.0f} MB",
            })
            await asyncio.sleep(0)

    yield _sse_event({"done": True, "result": dest_path})


@app.post("/api/ingest/url")
async def ingest_url(req: UrlRequest, user: User = Depends(get_current_user)):
    """Download a video from any yt-dlp-supported URL with SSE progress."""
    return _sse_response(
        _sse_stream(ingestion.download_video, req.url, WORKSPACE)
    )


@app.post("/api/ingest/twitch/stream")
async def ingest_twitch_stream(req: UrlRequest, user: User = Depends(get_current_user)):
    """Stream only the audio from a Twitch VOD with SSE progress."""
    vod_id = extract_vod_id(req.url)
    audio_path = os.path.join(WORKSPACE, "audio", f"{vod_id}_audio.wav")
    return _sse_response(
        _sse_stream(ingestion.stream_audio_to_file, req.url, audio_path)
    )


@app.get("/api/ingest/twitch/check")
async def ingest_twitch_check(url: str = Query(...), user: User = Depends(get_current_user)):
    """Check whether a transcript already exists for a Twitch VOD URL."""
    try:
        vod_id = extract_vod_id(url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    audio_path = os.path.join(WORKSPACE, "audio", f"{vod_id}_audio.wav")
    transcript_path = os.path.join(WORKSPACE, f"{vod_id}_audio_transcript.json")

    if os.path.exists(transcript_path):
        with open(transcript_path, "r", encoding="utf-8") as f:
            transcript = json.load(f)
        return {
            "cached": True,
            "transcript": transcript,
            "audio_path": audio_path if os.path.exists(audio_path) else None,
        }
    return {"cached": False}


# ---------------------------------------------------------------------------
# Twitch OAuth + VOD browser
# ---------------------------------------------------------------------------

@app.get("/api/oauth/twitch/authorize")
async def oauth_twitch_authorize(label: str = Query(...)):
    """Redirect to Twitch OAuth authorization URL."""
    import secrets
    state = secrets.token_hex(16)
    _pending_oauth_states[state] = {"platform": "twitch", "label": label}
    from oauth.twitch import build_twitch_auth_url
    return {"auth_url": build_twitch_auth_url(state)}


@app.get("/api/oauth/twitch/callback")
async def oauth_twitch_callback(code: str = Query(...), state: str = Query(...)):
    """Handle Twitch OAuth callback. Creates User + UserOAuthAccount and redirects to frontend."""
    from fastapi.responses import RedirectResponse

    state_data = _pending_oauth_states.pop(state, None)
    if not state_data:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state.")

    try:
        from oauth.twitch import exchange_twitch_code
        provider_account_id, access_token, refresh_token, expires_at = await exchange_twitch_code(code)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Twitch token exchange failed: {exc}")

    from db import User, UserOAuthAccount, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        # Check if this OAuth account already exists
        result = await session.execute(
            select(UserOAuthAccount).where(
                UserOAuthAccount.provider == "twitch",
                UserOAuthAccount.provider_account_id == provider_account_id,
            )
        )
        existing_oauth = result.scalar_one_or_none()

        if existing_oauth:
            # User already exists, just update tokens
            existing_oauth.access_token = access_token
            existing_oauth.refresh_token = refresh_token
            existing_oauth.expires_at = expires_at
            await session.commit()
            user_id = existing_oauth.user_id
        else:
            # Create new user + OAuth account
            # Generate a display name from the label or use a default
            display_name = state_data.get("label", f"Twitch User {provider_account_id[:8]}")
            user = User(
                email=f"twitch_{provider_account_id}@oauth.momiji.local",
                display_name=display_name,
                is_verified=True,  # OAuth users are verified by the provider
            )
            session.add(user)
            await session.flush()

            oauth_account = UserOAuthAccount(
                user_id=user.id,
                provider="twitch",
                provider_account_id=provider_account_id,
                access_token=access_token,
                refresh_token=refresh_token,
                expires_at=expires_at,
            )
            session.add(oauth_account)
            await session.commit()
            user_id = user.id

    # Generate JWT token and set HttpOnly cookie
    from auth import create_access_token
    async with get_session_cm() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

    from auth import ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS
    token = create_access_token(user.id, user.email)
    refresh_token = create_refresh_token(user.id)

    # Redirect to dashboard with HttpOnly cookie set
    from starlette.responses import RedirectResponse
    response = RedirectResponse("/dashboard")
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # 24 hours
        expires=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
        secure=False,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,  # 30 days
        expires=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        samesite="lax",
        secure=False,
        path="/",
    )
    return response


@app.get("/api/ingest/twitch/vods")
async def list_twitch_vods(user: User = Depends(get_current_user)):
    """
    Fetch the authenticated user's Twitch VODs using their stored OAuth token.
    Returns the list of VODs or 401 if no token is available.
    """
    from db import UserOAuthAccount, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        result = await session.execute(
            select(UserOAuthAccount).where(
                UserOAuthAccount.provider == "twitch",
                UserOAuthAccount.access_token.isnot(None),
            )
            .order_by(UserOAuthAccount.created_at.desc())
            .limit(1)
        )
        oauth_account = result.scalar_one_or_none()

    if not oauth_account:
        raise HTTPException(status_code=401, detail="No Twitch account connected. Use the Connect Twitch button.")

    # Decrypt OAuth token before use
    from auth import decrypt_oauth_token
    access_token = decrypt_oauth_token(oauth_account.access_token)

    from oauth.twitch import get_user_vods
    vods = await get_user_vods(access_token, oauth_account.provider_account_id)
    return {"vods": vods}


# ---------------------------------------------------------------------------
# Transcription
# ---------------------------------------------------------------------------

class TranscribeRequest(BaseModel):
    video_path: str | None = None
    audio_path: str | None = None
    model_size: str = "large-v3"
    device: str = "auto"
    language: str | None = None


@app.post("/api/transcribe")
async def transcribe(req: TranscribeRequest):
    """Transcribe a video or audio file with SSE progress."""
    if not req.video_path and not req.audio_path:
        raise HTTPException(status_code=400, detail="Either video_path or audio_path required.")
    return _sse_response(
        _sse_stream(
            transcription.transcribe,
            video_path=req.video_path,
            output_dir=WORKSPACE,
            model_size=req.model_size,
            device=req.device,
            language=req.language or None,
            audio_path=req.audio_path,
        )
    )


@app.get("/api/transcribe/cached")
async def transcribe_cached(path: str = Query(...), user: User = Depends(get_current_user)):
    """Return cached transcript JSON for a given video/audio path, or 404."""
    stem = os.path.splitext(os.path.basename(path))[0]
    transcript_path = os.path.join(WORKSPACE, f"{stem}_transcript.json")
    if not os.path.exists(transcript_path):
        raise HTTPException(status_code=404, detail="No cached transcript found.")
    with open(transcript_path, "r", encoding="utf-8") as f:
        return json.load(f)


class TranscribeSegmentRequest(BaseModel):
    video_path: str | None = None
    audio_path: str | None = None
    start: float
    end: float
    model_size: str = "large-v3"
    device: str = "auto"
    language: str | None = None


@app.post("/api/transcribe/segment")
async def transcribe_segment(req: TranscribeSegmentRequest):
    """Re-transcribe a specific time window with a chosen Whisper model. SSE progress."""
    if not req.video_path and not req.audio_path:
        raise HTTPException(status_code=400, detail="Either video_path or audio_path required.")
    return _sse_response(
        _sse_stream(
            transcription.transcribe_segment,
            video_path=req.video_path,
            audio_path=req.audio_path,
            start=req.start,
            end=req.end,
            model_size=req.model_size,
            device=req.device,
            language=req.language or None,
        )
    )


# ---------------------------------------------------------------------------
# Highlight detection
# ---------------------------------------------------------------------------

class HighlightsRequest(BaseModel):
    transcript: dict
    model: str
    source_path: str | None = None  # used to derive cache file name


@app.post("/api/highlights")
async def highlights(req: HighlightsRequest):
    """Detect viral clip candidates using the configured LLM. SSE: progress events + final done."""
    api_key = os.environ.get("LLM_API_KEY", "")
    base_url = os.environ.get("LLM_BASE_URL", "")
    if not api_key or not base_url:
        raise HTTPException(status_code=500, detail="LLM_API_KEY and LLM_BASE_URL must be set.")

    async def _generate():
        async for event_str in _sse_stream(
            highlight_detection.detect_highlights,
            transcript=req.transcript,
            api_key=api_key,
            base_url=base_url,
            model=req.model,
        ):
            yield event_str
            # When done, persist the clips to disk
            try:
                raw = event_str.removeprefix("data: ").strip()
                event = json.loads(raw) if raw.startswith("{") else {}
                if event.get("done") and req.source_path and event.get("result") is not None:
                    cache_path = _clips_cache_path(req.source_path)
                    with open(cache_path, "w", encoding="utf-8") as f:
                        json.dump(event["result"], f, ensure_ascii=False, indent=2)
            except Exception:
                logger = logging.getLogger(__name__)
                logger.warning("Failed to write clips cache: %s", exc)

    return _sse_response(_generate())


@app.get("/api/highlights/cached")
async def highlights_cached(path: str = Query(...), user: User = Depends(get_current_user)):
    """Return cached clips JSON for a given source path, or 404."""
    cache_path = _clips_cache_path(path)
    if not os.path.exists(cache_path):
        raise HTTPException(status_code=404, detail="No cached clips found.")
    with open(cache_path, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Frame extraction
# ---------------------------------------------------------------------------

@app.get("/api/frame")
async def get_frame(video: str = Query(...), t: float = Query(2.0), user: User = Depends(get_current_user)):
    """Extract a single frame from a video at timestamp t and return it as JPEG."""
    # Resolve /workspace/... URL paths to the actual workspace directory
    if video.startswith("/workspace/"):
        video = os.path.join(WORKSPACE, video.removeprefix("/workspace/"))
    # Validate video path is inside WORKSPACE
    try:
        video_abs = os.path.abspath(video)
        workspace_abs = os.path.abspath(WORKSPACE)
        if not video_abs.startswith(workspace_abs + os.sep) and video_abs != workspace_abs:
            raise HTTPException(status_code=400, detail="Video path is outside workspace.")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid video path.")

    if not os.path.exists(video):
        raise HTTPException(status_code=404, detail="Video file not found.")
    frames_dir = os.path.join(WORKSPACE, "frames")
    try:
        frame_path = await asyncio.to_thread(extract_frame, video, t, frames_dir)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return FileResponse(frame_path, media_type="image/jpeg")


@app.get("/api/video/dimensions")
async def get_video_dimensions_endpoint(video: str = Query(...)):
    """Return (width, height) of a video using ffprobe, no frame extraction needed."""
    # Resolve /workspace/... URL paths to the actual workspace directory
    if video.startswith("/workspace/"):
        video = os.path.join(WORKSPACE, video.removeprefix("/workspace/"))
    # Validate video path is inside WORKSPACE
    try:
        video_abs = os.path.abspath(video)
        workspace_abs = os.path.abspath(WORKSPACE)
        if not video_abs.startswith(workspace_abs + os.sep) and video_abs != workspace_abs:
            raise HTTPException(status_code=400, detail="Video path is outside workspace.")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid video path.")

    if not os.path.exists(video):
        raise HTTPException(status_code=404, detail="Video file not found.")

    try:
        w, h = await asyncio.to_thread(get_video_dimensions, video)
        return {"width": w, "height": h}
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"ffprobe error for {video!r}: {exc}")


# ---------------------------------------------------------------------------
# LLM model discovery
# ---------------------------------------------------------------------------

@app.get("/api/models")
async def get_models(
    base_url: str = Query(default=""),
    api_key: str = Query(default=""),
):
    _base_url = base_url or os.environ.get("LLM_BASE_URL", "")
    _api_key = api_key or os.environ.get("LLM_API_KEY", "")
    if not _base_url or not _api_key:
        raise HTTPException(status_code=400, detail="base_url and api_key required.")
    try:
        from openai import OpenAI
        client = OpenAI(api_key=_api_key, base_url=_base_url)
        models = await asyncio.to_thread(lambda: client.models.list())
        return {"models": sorted(m.id for m in models.data)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

class RenderSegmentRequest(BaseModel):
    url: str
    start: float
    end: float


@app.post("/api/render/segment")
async def render_segment(req: RenderSegmentRequest, user: User = Depends(get_current_user)):
    """Download a specific time segment of a VOD with SSE progress."""
    renders_dir = os.path.join(WORKSPACE, "renders")
    return _sse_response(
        _sse_stream(ingestion.download_segment, req.url, req.start, req.end, renders_dir)
    )


class CropBoxModel(BaseModel):
    x: int
    y: int
    w: int
    h: int


class RenderClipRequest(BaseModel):
    video_path: str
    clip: dict
    crop_avatar: CropBoxModel
    crop_game: CropBoxModel
    segments: list[dict]
    font_name: str = "Arial Bold"
    font_color: str = "#FFFFFF"
    highlight_color: str = "#FFFF00"
    outline_color: str = "#000000"
    outline_width: float = 2.0
    shadow_color: str = "#000000"
    shadow_depth: float = 1.0
    shadow_opacity: float = 0.5
    font_size: int = 22
    subtitle_fade_in_ms: int = 100
    subtitle_fade_out_ms: int = 100
    caption_style: str = "karaoke"
    words_per_line: int = 1
    quality_preset: str = "standard"


@app.post("/api/render/clip")
async def render_clip_endpoint(req: RenderClipRequest, user: User = Depends(get_current_user)):
    """Render a clip to 9:16 vertical MP4 with subtitles. SSE: single done event."""
    renders_dir = os.path.join(WORKSPACE, "renders")

    async def generate():
        yield _sse_event({"progress": 0.1, "label": "Running FFmpeg…"})
        try:
            out_path = await asyncio.to_thread(
                render_clip,
                video_path=req.video_path,
                clip=req.clip,
                crop_avatar=CropBox(**req.crop_avatar.model_dump()),
                crop_game=CropBox(**req.crop_game.model_dump()),
                segments=req.segments,
                output_dir=renders_dir,
                font_name=req.font_name,
                font_color=req.font_color,
                highlight_color=req.highlight_color,
                outline_color=req.outline_color,
                outline_width=req.outline_width,
                shadow_color=req.shadow_color,
                shadow_depth=req.shadow_depth,
                shadow_opacity=req.shadow_opacity,
                font_size=req.font_size,
                subtitle_fade_in_ms=req.subtitle_fade_in_ms,
                subtitle_fade_out_ms=req.subtitle_fade_out_ms,
                caption_style=req.caption_style,
                words_per_line=req.words_per_line,
                quality_preset=req.quality_preset,
            )
            rel = os.path.relpath(out_path, WORKSPACE)
            yield _sse_event({"done": True, "result": f"/workspace/{rel}"})
        except Exception as exc:
            yield _sse_event({"error": str(exc)})

    return _sse_response(generate())


# ---------------------------------------------------------------------------
# Config endpoint (env vars exposed to frontend)
# ---------------------------------------------------------------------------

@app.get("/api/config")
async def get_config():
    return {
        "llm_base_url": os.environ.get("LLM_BASE_URL", ""),
        "llm_model": os.environ.get("LLM_MODEL", ""),
        "whisper_model": os.environ.get("WHISPER_MODEL", "large-v3"),
        "whisper_device": os.environ.get("WHISPER_DEVICE", "auto"),
    }


# ---------------------------------------------------------------------------
# Subtitle parsing
# ---------------------------------------------------------------------------

def _parse_srt(text: str) -> list[dict]:
    """Parse SRT content into a list of cue dicts."""
    # Normalize line endings
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    cues = []
    blocks = text.split("\n\n")
    for block in blocks:
        if not block.strip():
            continue
        lines = block.split("\n")
        if len(lines) < 3:
            continue
        try:
            index = int(lines[0].strip())
        except ValueError:
            continue
        # Parse timestamp line: HH:MM:SS,mmm --> HH:MM:SS,mmm
        ts_match = re.match(r"(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})", lines[1])
        if not ts_match:
            continue
        h, m, s, ms, h2, m2, s2, ms2 = (int(x) for x in ts_match.groups())
        start = h * 3600 + m * 60 + s + ms / 1000.0
        end = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000.0
        cue_text = "\n".join(lines[2:]).strip()
        cues.append({"text": cue_text, "startTime": start, "duration": end - start})
    return cues


def _parse_ass(text: str) -> list[dict]:
    """Parse ASS/SSA content into a list of cue dicts."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    cues = []
    # Split into sections by lines starting with '['
    sections = re.split(r"(?=^\[)", text, flags=re.MULTILINE)
    events_section = ""
    for section in sections:
        if section.startswith("[Events]"):
            events_section = section
            break
    if not events_section:
        return cues
    for line in events_section.split("\n"):
        if not line.startswith("Dialogue:"):
            continue
        # Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
        # Text starts after the 9th comma
        parts = line[len("Dialogue:"):].split(",", 9)
        if len(parts) < 10:
            continue
        start_str = parts[1].strip()
        end_str = parts[2].strip()
        raw_text = parts[9].rstrip()

        # Parse times in H:MM:SS.cc format
        def parse_ass_time(ts: str) -> float:
            m = re.match(r"(\d+):(\d{2}):(\d{2})\.(\d{2})", ts)
            if not m:
                return 0.0
            h, m_, s, cs = (int(x) for x in m.groups())
            return h * 3600 + m_ * 60 + s + cs / 100.0

        start = parse_ass_time(start_str)
        end = parse_ass_time(end_str)
        # Strip ASS override tags: {.*?} and \N -> newline
        cleaned = re.sub(r"\{.*?\}", "", raw_text)
        cleaned = cleaned.replace("\\N", "\n")
        cues.append({"text": cleaned.strip(), "startTime": start, "duration": end - start})
    return cues


@app.post("/api/subtitles/parse")
async def parse_subtitles(file: UploadFile = File(...)):
    filename = file.filename or ""
    content = await file.read()
    text = content.decode("utf-8", errors="replace")
    if filename.lower().endswith(".srt"):
        cues = _parse_srt(text)
    elif filename.lower().endswith(".ass") or filename.lower().endswith(".ssa"):
        cues = _parse_ass(text)
    else:
        raise HTTPException(status_code=400, detail="Unsupported subtitle format. Use .srt or .ass")
    return {"cues": cues}


# ---------------------------------------------------------------------------
# Clip metadata editing
# ---------------------------------------------------------------------------

def _parse_clip_key(encoded: str) -> tuple[str, int]:
    """Parse '{source_path}___{index}' into (source_path, index)."""
    parts = encoded.rsplit("___", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Invalid clip_key format.")
    try:
        index = int(parts[1])
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid clip index.")
    return parts[0], index


def _clips_cache_path(source_path: str) -> str:
    stem = os.path.splitext(os.path.basename(source_path))[0]
    return os.path.join(WORKSPACE, f"{stem}_clips.json")


class ClipPatchRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    hashtags: list[str] | None = None
    brand_alignment: list[str] | None = None
    start: float | None = None
    end: float | None = None
    crop_avatar: dict | None = None  # {x: int, y: int, w: int, h: int}
    crop_game: dict | None = None


@app.patch("/api/clips/{clip_key}")
async def patch_clip(clip_key: str, req: ClipPatchRequest):
    """
    Partially update a clip's metadata in the cached clips JSON file.

    clip_key is URL-encoded "{source_path}___{index}".
    """
    source_path, index = _parse_clip_key(clip_key)
    cache_path = _clips_cache_path(source_path)

    if not os.path.exists(cache_path):
        raise HTTPException(status_code=404, detail="Clip cache file not found.")

    with open(cache_path, "r", encoding="utf-8") as f:
        clips = json.load(f)

    if not isinstance(clips, list) or index < 0 or index >= len(clips):
        raise HTTPException(status_code=404, detail=f"Clip index {index} out of range (clips has {len(clips) if isinstance(clips, list) else 'N/A'} items). clip_key={clip_key!r}, source_path={source_path!r}")

    # Merge patch into the target clip
    patch = req.model_dump(exclude_none=True)
    for key, value in patch.items():
        clips[index][key] = value
    if req.crop_avatar:
        clips[index]["crop_avatar"] = req.crop_avatar
    if req.crop_game:
        clips[index]["crop_game"] = req.crop_game

    # Write atomically
    tmp = cache_path + f".{uuid.uuid4().hex[:8]}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(clips, f, ensure_ascii=False, indent=2)
    os.replace(tmp, cache_path)

    return clips[index]


@app.get("/api/clips/{clip_key}")
async def get_clip(clip_key: str, user: User = Depends(get_current_user)):
    """Return a single clip from the cache by clip_key."""
    source_path, index = _parse_clip_key(clip_key)
    cache_path = _clips_cache_path(source_path)

    if not os.path.exists(cache_path):
        raise HTTPException(status_code=404, detail="Clip cache file not found.")

    with open(cache_path, "r", encoding="utf-8") as f:
        clips = json.load(f)

    if not isinstance(clips, list) or index < 0 or index >= len(clips):
        raise HTTPException(status_code=404, detail=f"Clip index {index} out of range (clips has {len(clips) if isinstance(clips, list) else 'N/A'} items). clip_key={clip_key!r}, source_path={source_path!r}")

    return clips[index]


# ---------------------------------------------------------------------------
# Clip metadata regeneration
# ---------------------------------------------------------------------------

class RegenerateMetadataRequest(BaseModel):
    clip: dict
    transcript: dict


def _extract_clip_segment(transcript: dict, clip_start: float, clip_end: float, words_per_line: int = 2) -> list[dict]:
    """
    Pull words from the transcript that fall within [clip_start, clip_end]
    and group them into lines of `words_per_line` words each.
    Returns a list of {"word": str, "start": float, "end": float} dicts.
    """
    all_words: list[dict] = []
    for seg in transcript.get("segments", []):
        for w in seg.get("words", []):
            if w["start"] >= clip_start and w["end"] <= clip_end:
                all_words.append(w)

    lines = []
    for i in range(0, len(all_words), words_per_line):
        chunk = all_words[i:i + words_per_line]
        if not chunk:
            continue
        lines.append({
            "start": chunk[0]["start"],
            "end": chunk[-1]["end"],
            "text": " ".join(w["word"] for w in chunk),
            "words": chunk,
        })
    return lines


async def _regenerate_clip_metadata(clip: dict, transcript: dict) -> dict:
    """
    Send the clip's transcript segment to the LLM and get back an
    improved title and hashtags.
    """
    from openai import OpenAI

    api_key = os.environ.get("LLM_API_KEY", "")
    base_url = os.environ.get("LLM_BASE_URL", "")
    model = os.environ.get("LLM_MODEL", "llama3.1:8b")

    client = OpenAI(api_key=api_key, base_url=base_url)

    clip_start = clip["start"]
    clip_end = clip["end"]

    # Build a readable transcript snippet for the prompt
    words = _extract_clip_segment(transcript, clip_start, clip_end, words_per_line=2)
    if not words:
        return clip  # nothing to work with, return unchanged

    # Format as [MM:SS.ss] text lines
    def fmt(t: float) -> str:
        m = int(t // 60)
        s = t % 60
        return f"{m:02d}:{s:05.2f}"

    lines_text = "\n".join(f"[{fmt(w['start'])}] {w['text']}" for w in words)


    small_system_prompt = """You are a viral clip editor for a VTuber YouTube channel.
Given a short transcript segment, generate a complete social media post:

1. **Title**: Short, punchy, clickable (max 60 chars, no quotes or special chars)
2. **Description**: A brief engaging description that hooks viewers (1-2 sentences, max 150 chars)
3. **Hashtags**: 5-8 relevant hashtags (VTuber-style, include #VTuber, lean into community trends and current viral formats)

Respond ONLY with a JSON object with keys:
  "title" (string, max 60 chars)
  "description" (string, max 150 chars)
  "hashtags" (array of strings, e.g. ["#VTuber", "#Gaming", "#Meme", "#Shorts"])
Do not add explanations or surrounding text."""

    system_prompt = """You are a Viral Growth Strategist for Momiji Yoru's VTuber channel.
Your goal: Convert scrollers into viewers. Clips are the funnel; the stream is the destination.

BRAND ESSENCE:
- Core Identity: The "Big Sister" of gaming. Calm, cozy, and nurturing until the game breaks her.
- The Hook: "Gap Moe." The contrast between her soothing lo-fi balcony vibe and sudden, unfiltered gaming rage.
- Audience: People looking for authenticity, comfort, and genuine reactions in a sea of fake hype.

INSTRUCTIONS:
Analyze the transcript for moments with high "stopping power."
Prioritize: 
1. Immediate Conflict (starts in the middle of action/emotion).
2. Relatable Struggle (dying to a boss, game bugs, lag).
3. Wholesome Connection (genuine advice, comforting chat).
4. "Gap Moe" Swings (calm voice suddenly snapping into rage).

For EACH candidate, generate a JSON object with:

1. "title": Max 50 chars. Lowercase aesthetic preferred. No emojis. Create a curiosity gap or state a strong emotion.
2. "description": Max 140 chars. Direct address to the viewer. Invite them to the "balcony." Use phrases like "come hang out," "we're live," or "join the family."
3. "hashtags": Array of 6-8 tags. Mix high-volume discovery tags (#fyp, #gaming) with community tags (#VTuberEN, #Shorts).
4. "virality_score": Integer 1–10. 
   - 10 = Instant meme potential / Extreme Rage / Peak Wholesome.
   - 7–9 = Strong hook, very relatable.
   - 4–6 = Good context, but niche.
   - 1–3 = Skip unless desperate for content.
OUTPUT FORMAT:
Return ONLY a valid JSON array of objects. No markdown, no explanations.

Example Output Structure:
[
  {
    "title": "when the boss hits you through the wall",
    "description": "tell me i'm not the only one dealing with this. come rant about it on stream, we're live.",
    "hashtags": ["#fyp", "#gaming", "#VTuberEN", "#Shorts", "#EldenRing", "#MomijiYoru"],
    "virality_score": 9
  },
  {
    "title": "big sister advice for a bad day",
    "description": "sometimes you just need to hear it's going to be okay. come sit on the balcony with us.",
    "hashtags": ["#wholesome", "#vtuber", "#advice", "#cozy", "#Shorts", "#MomijiYoru"],
    "virality_score": 8
  }
]
"""


    user_prompt = f"Transcript segment ({fmt(clip_start)} – {fmt(clip_end)}):\n\n{lines_text}"

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
        )
        raw = resp.choices[0].message.content or "{}"
        result = json.loads(raw)
        title = (result.get("title") or clip.get("title") or "").strip()
        description = (result.get("description") or clip.get("description") or "").strip()
        hashtags = result.get("hashtags") or clip.get("hashtags") or []
        return {
            **clip,
            "title": title[:60],
            "description": description[:150] if description else "",
            "hashtags": list(hashtags) if isinstance(hashtags, list) else clip.get("hashtags", []),
        }
    except Exception as exc:
        logger = logging.getLogger(__name__)
        logger.error("Failed to regenerate clip metadata: %s", exc)
        return clip  # on any failure, return unchanged


@app.post("/api/clips/{clip_key}/regenerate-metadata")
async def regenerate_clip_metadata(
    clip_key: str,
    req: RegenerateMetadataRequest,
    user: User = Depends(get_current_user),
):
    """
    Regenerate title and hashtags for a single clip using the LLM.
    The request body must include the full clip dict and the source transcript dict.

    clip_key is URL-encoded "{source_path}___{index}".
    """
    source_path, index = _parse_clip_key(clip_key)
    cache_path = _clips_cache_path(source_path)

    if not os.path.exists(cache_path):
        raise HTTPException(status_code=404, detail="Clip cache file not found.")

    with open(cache_path, "r", encoding="utf-8") as f:
        clips = json.load(f)

    if not isinstance(clips, list) or index < 0 or index >= len(clips):
        raise HTTPException(status_code=404, detail=f"Clip index {index} out of range (clips has {len(clips) if isinstance(clips, list) else 'N/A'} items). clip_key={clip_key!r}, source_path={source_path!r}")

    updated = await _regenerate_clip_metadata(req.clip, req.transcript)
    clips[index] = updated

    # Persist
    tmp = cache_path + f".{uuid.uuid4().hex[:8]}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(clips, f, ensure_ascii=False, indent=2)
    os.replace(tmp, cache_path)

    return updated


# ---------------------------------------------------------------------------
# Scheduling
# ---------------------------------------------------------------------------

class SchedulePostRequest(BaseModel):
    clip_key: str
    video_path: str
    title: str
    description: str
    hashtags: list[str]
    platform: str  # 'youtube' | 'tiktok' | 'instagram'
    platform_account_id: str
    schedule_at: float  # unix timestamp
    metadata: dict | None = None


@app.post("/api/schedule")
async def create_schedule_post(req: SchedulePostRequest):
    """Create a new scheduled post job."""
    import time as _time

    if req.schedule_at <= _time.time():
        raise HTTPException(status_code=400, detail="schedule_at must be in the future.")

    from db import PostJob, get_session
    from scheduler import schedule_job

    async with get_session_cm() as session:
        job = PostJob(
            clip_key=req.clip_key,
            video_path=req.video_path,
            title=req.title,
            description=req.description,
            hashtags=json.dumps(req.hashtags),
            platform=req.platform,
            platform_account_id=req.platform_account_id,
            schedule_at=req.schedule_at,
            status="scheduled",
            post_metadata=json.dumps(req.metadata) if req.metadata else None,
        )
        session.add(job)
        try:
            schedule_job(job.id, req.schedule_at)
        except Exception as exc:
            await session.rollback()
            raise
        await session.flush()
        await session.refresh(job)

    return {"job_id": job.id}


@app.get("/api/schedule")
async def list_schedule_posts(
    status: str | None = Query(None),
    platform: str | None = Query(None),
):
    """List post jobs, optionally filtered by status and/or platform."""
    from db import PostJob, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        query = select(PostJob).order_by(PostJob.schedule_at.desc())
        if status:
            query = query.where(PostJob.status == status)
        if platform:
            query = query.where(PostJob.platform == platform)
        result = await session.execute(query)
        jobs = result.scalars().all()

    return [_post_job_to_dict(j) for j in jobs]


@app.get("/api/schedule/{job_id}")
async def get_schedule_post(job_id: str):
    """Get a single post job by ID."""
    from db import PostJob, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        result = await session.execute(select(PostJob).where(PostJob.id == job_id))
        job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Post job not found.")
    return _post_job_to_dict(job)


class UpdateSchedulePostRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    hashtags: list[str] | None = None
    schedule_at: float | None = None
    metadata: dict | None = None


@app.patch("/api/schedule/{job_id}")
async def update_schedule_post(job_id: str, req: UpdateSchedulePostRequest):
    """Update a pending/scheduled post job. Reschedules APScheduler if schedule_at changes."""
    import time as _time
    from db import PostJob, get_session
    from scheduler import cancel_job, schedule_job
    from sqlalchemy import select

    new_schedule_at = req.schedule_at
    if new_schedule_at is not None and new_schedule_at <= _time.time():
        raise HTTPException(status_code=400, detail="schedule_at must be in the future.")

    async with get_session_cm() as session:
        from sqlalchemy import select as _select

        result = await session.execute(
            _select(PostJob).where(PostJob.id == job_id).with_for_update()
        )
        job: PostJob | None = result.scalar_one_or_none()

        if not job:
            raise HTTPException(status_code=404, detail="Post job not found.")
        if job.status not in ("pending", "scheduled"):
            raise HTTPException(status_code=409, detail=f"Cannot update job with status '{job.status}'.")

        if req.title is not None:
            job.title = req.title
        if req.description is not None:
            job.description = req.description
        if req.hashtags is not None:
            job.hashtags = json.dumps(req.hashtags)
        if req.metadata is not None:
            job.post_metadata = json.dumps(req.metadata)

        if new_schedule_at is not None:
            cancel_job(job_id)
            schedule_job(job_id, new_schedule_at)
            job.schedule_at = new_schedule_at

        await session.commit()

    return _post_job_to_dict(job)


@app.delete("/api/schedule/{job_id}")
async def delete_schedule_post(job_id: str):
    """Cancel a post job (sets status='cancelled') and removes it from APScheduler."""
    from db import PostJob, get_session
    from scheduler import cancel_job
    from sqlalchemy import select

    async with get_session_cm() as session:
        result = await session.execute(select(PostJob).where(PostJob.id == job_id))
        job: PostJob | None = result.scalar_one_or_none()

        if not job:
            raise HTTPException(status_code=404, detail="Post job not found.")

        cancel_job(job_id)
        job.status = "cancelled"
        await session.commit()
        await session.refresh(job)

    return {"ok": True}


def _post_job_to_dict(job: PostJob) -> dict:
    import time as _time
    return {
        "id": job.id,
        "clip_key": job.clip_key,
        "video_path": job.video_path,
        "title": job.title,
        "description": job.description,
        "hashtags": json.loads(job.hashtags) if job.hashtags else [],
        "schedule_at": job.schedule_at,
        "posted_at": job.posted_at,
        "status": job.status,
        "platform": job.platform,
        "platform_account_id": job.platform_account_id,
        "error_message": job.error_message,
        "metadata": json.loads(job.post_metadata) if job.post_metadata else {},
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


# ---------------------------------------------------------------------------
# Recent videos (HomePage)
# ---------------------------------------------------------------------------


@app.get("/api/videos/recent")
async def get_recent_videos(limit: int = Query(default=10, le=100)):
    """
    List recent videos from workspace with clip counts.
    Used by the HomePage dashboard.
    """
    videos = []
    for filename in os.listdir(WORKSPACE):
        if not filename.endswith(('.mp4', '.mkv', '.webm')):
            continue
        stem = os.path.splitext(filename)[0]
        video_path = os.path.join(WORKSPACE, filename)
        clips_path = os.path.join(WORKSPACE, f"{stem}_clips.json")

        clip_count = 0
        if os.path.exists(clips_path):
            try:
                with open(clips_path, "r", encoding="utf-8") as f:
                    clips = json.load(f)
                    if isinstance(clips, list):
                        clip_count = len(clips)
            except (json.JSONDecodeError, OSError):
                pass

        try:
            stat = os.stat(video_path)
        except OSError:
            continue

        videos.append({
            "sourcePath": video_path,
            "title": filename,
            "clipCount": clip_count,
            "createdAt": stat.st_mtime,
        })

    videos.sort(key=lambda v: v["createdAt"], reverse=True)
    return {"videos": videos[:limit]}


# ---------------------------------------------------------------------------
# Phase 5: Video Editor Backend Extensions
# ---------------------------------------------------------------------------

# Media directory setup
MEDIA_DIR = os.path.join(WORKSPACE, "media")
os.makedirs(MEDIA_DIR, exist_ok=True)

AUDIO_DIR = os.path.join(WORKSPACE, "audio_assets")
os.makedirs(AUDIO_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Media/Overlay Endpoints
# ---------------------------------------------------------------------------

class MediaResponse(BaseModel):
    id: str
    filename: str
    original_filename: str
    file_path: str
    file_size: int
    mime_type: str
    asset_type: str
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    url: str


@app.post("/api/media/upload")
async def upload_media(file: UploadFile = File(...)):
    """
    Upload an image or video file for overlay tracks.
    Returns media asset metadata and URL for use in timeline.
    """
    from pipeline import media as media_pipeline

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    try:
        content = await file.read()
        asset = await media_pipeline.save_media_file(
            file_content=content,
            original_filename=file.filename,
            media_dir=MEDIA_DIR,
        )

        # Persist to database
        from db import MediaAsset as MediaAssetModel, get_session
        async with get_session_cm() as session:
            db_asset = MediaAssetModel(
                id=asset.id,
                filename=asset.filename,
                original_filename=asset.original_filename,
                file_path=asset.file_path,
                file_size=asset.file_size,
                mime_type=asset.mime_type,
                asset_type=asset.asset_type,
                width=asset.width,
                height=asset.height,
                duration=asset.duration,
            )
            session.add(db_asset)
            await session.commit()
            await session.refresh(db_asset)

        # Return URL relative to workspace
        rel_path = os.path.relpath(asset.file_path, WORKSPACE)

        return MediaResponse(
            id=asset.id,
            filename=asset.filename,
            original_filename=asset.original_filename,
            file_path=asset.file_path,
            file_size=asset.file_size,
            mime_type=asset.mime_type,
            asset_type=asset.asset_type,
            width=asset.width,
            height=asset.height,
            duration=asset.duration,
            url=f"/workspace/{rel_path}",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/media/list")
async def list_media(asset_type: str | None = Query(None)):
    """
    List all uploaded media assets, optionally filtered by type.
    asset_type: 'image' or 'video'
    """
    from pipeline import media as media_pipeline
    from db import MediaAsset as MediaAssetModel, get_session
    from sqlalchemy import select

    # Get assets from database
    async with get_session_cm() as session:
        query = select(MediaAssetModel).order_by(MediaAssetModel.created_at.desc())
        if asset_type:
            query = query.where(MediaAssetModel.asset_type == asset_type)
        result = await session.execute(query)
        db_assets = result.scalars().all()

    return {
        "assets": [
            {
                "id": a.id,
                "filename": a.filename,
                "original_filename": a.original_filename,
                "file_path": a.file_path,
                "file_size": a.file_size,
                "mime_type": a.mime_type,
                "asset_type": a.asset_type,
                "width": a.width,
                "height": a.height,
                "duration": a.duration,
                "url": f"/workspace/{os.path.relpath(a.file_path, WORKSPACE)}",
            }
            for a in db_assets
        ]
    }


@app.delete("/api/media/{asset_id}")
async def delete_media(asset_id: str):
    """Delete a media asset."""
    from db import MediaAsset as MediaAssetModel, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        result = await session.execute(
            select(MediaAssetModel).where(MediaAssetModel.id == asset_id)
        )
        asset = result.scalar_one_or_none()

        if not asset:
            raise HTTPException(status_code=404, detail="Media asset not found")

        # Delete file
        if os.path.exists(asset.file_path):
            os.remove(asset.file_path)

        # Delete from database
        await session.delete(asset)
        await session.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# Audio Endpoints
# ---------------------------------------------------------------------------

class AudioResponse(BaseModel):
    id: str
    filename: str
    original_filename: str
    file_path: str
    file_size: int
    duration: float
    sample_rate: int
    channels: int
    url: str


class WaveformResponse(BaseModel):
    duration: float
    sample_rate: int
    channels: int
    peaks: list[float]
    rms: list[float]
    num_points: int


@app.post("/api/audio/upload")
async def upload_audio(file: UploadFile = File(...)):
    """
    Upload an audio file for BGM/SFX tracks.
    Returns audio asset metadata and URL for use in timeline.
    """
    from pipeline import audio as audio_pipeline

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    try:
        content = await file.read()
        asset = await audio_pipeline.save_audio_file(
            file_content=content,
            original_filename=file.filename,
            audio_dir=AUDIO_DIR,
        )

        # Persist to database
        from db import AudioAsset as AudioAssetModel, get_session
        async with get_session_cm() as session:
            db_asset = AudioAssetModel(
                id=asset.id,
                filename=asset.filename,
                original_filename=asset.original_filename,
                file_path=asset.file_path,
                file_size=asset.file_size,
                duration=asset.duration,
                sample_rate=asset.sample_rate,
                channels=asset.channels,
            )
            session.add(db_asset)
            await session.commit()
            await session.refresh(db_asset)

        # Return URL relative to workspace
        rel_path = os.path.relpath(asset.file_path, WORKSPACE)

        return AudioResponse(
            id=asset.id,
            filename=asset.filename,
            original_filename=asset.original_filename,
            file_path=asset.file_path,
            file_size=asset.file_size,
            duration=asset.duration,
            sample_rate=asset.sample_rate,
            channels=asset.channels,
            url=f"/workspace/{rel_path}",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/api/audio/waveform")
async def get_waveform(audio_path: str = Query(...)):
    """
    Generate waveform data for an audio file.
    Returns peak and RMS data for visualization.
    """
    from pipeline import audio as audio_pipeline

    # Resolve workspace paths
    if audio_path.startswith("/workspace/"):
        audio_path = os.path.join(WORKSPACE, audio_path.removeprefix("/workspace/"))

    # Validate path is inside workspace
    try:
        audio_abs = os.path.abspath(audio_path)
        workspace_abs = os.path.abspath(WORKSPACE)
        if not audio_abs.startswith(workspace_abs + os.sep) and audio_abs != workspace_abs:
            raise HTTPException(status_code=400, detail="Audio path must be within workspace")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid audio path")

    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")

    try:
        waveform_data = audio_pipeline.generate_waveform(audio_path)
        return WaveformResponse(**waveform_data)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.delete("/api/audio/{asset_id}")
async def delete_audio(asset_id: str):
    """Delete an audio asset."""
    from db import AudioAsset as AudioAssetModel, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        result = await session.execute(
            select(AudioAssetModel).where(AudioAssetModel.id == asset_id)
        )
        asset = result.scalar_one_or_none()

        if not asset:
            raise HTTPException(status_code=404, detail="Audio asset not found")

        # Delete file
        if os.path.exists(asset.file_path):
            os.remove(asset.file_path)

        # Delete from database
        await session.delete(asset)
        await session.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# Marker Endpoints
# ---------------------------------------------------------------------------

class MarkerRequest(BaseModel):
    time: float
    duration: float | None = None
    label: str
    color: str = "#FF5733"  # Default orange-red
    project_id: str | None = None
    extra_data: dict | None = None


class MarkerResponse(BaseModel):
    id: str
    time: float
    duration: float | None
    label: str
    color: str
    project_id: str | None
    extra_data: dict | None
    created_at: float
    updated_at: float


@app.post("/api/markers")
async def create_marker(req: MarkerRequest):
    """Create a new timeline marker."""
    from db import Marker as MarkerModel, get_session
    import time

    async with get_session_cm() as session:
        marker = MarkerModel(
            id=uuid.uuid4().hex,
            project_id=req.project_id,
            time=req.time,
            duration=req.duration,
            label=req.label,
            color=req.color,
            extra_data=json.dumps(req.extra_data) if req.extra_data else None,
            created_at=time.time(),
            updated_at=time.time(),
        )
        session.add(marker)
        await session.commit()
        await session.refresh(marker)

        return MarkerResponse(
            id=marker.id,
            time=marker.time,
            duration=marker.duration,
            label=marker.label,
            color=marker.color,
            project_id=marker.project_id,
            extra_data=json.loads(marker.extra_data) if marker.extra_data else None,
            created_at=marker.created_at,
            updated_at=marker.updated_at,
        )


@app.get("/api/markers")
async def list_markers(project_id: str | None = Query(None)):
    """List all markers, optionally filtered by project."""
    from db import Marker as MarkerModel, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        query = select(MarkerModel).order_by(MarkerModel.time)
        if project_id:
            query = query.where(MarkerModel.project_id == project_id)
        result = await session.execute(query)
        markers = result.scalars().all()

    return {
        "markers": [
            MarkerResponse(
                id=m.id,
                time=m.time,
                duration=m.duration,
                label=m.label,
                color=m.color,
                project_id=m.project_id,
                extra_data=json.loads(m.extra_data) if m.extra_data else None,
                created_at=m.created_at,
                updated_at=m.updated_at,
            )
            for m in markers
        ]
    }


@app.put("/api/markers/{marker_id}")
async def update_marker(marker_id: str, req: MarkerRequest):
    """Update an existing marker."""
    from db import Marker as MarkerModel, get_session
    from sqlalchemy import select
    import time

    async with get_session_cm() as session:
        result = await session.execute(
            select(MarkerModel).where(MarkerModel.id == marker_id)
        )
        marker = result.scalar_one_or_none()

        if not marker:
            raise HTTPException(status_code=404, detail="Marker not found")

        marker.time = req.time
        marker.duration = req.duration
        marker.label = req.label
        marker.color = req.color
        marker.project_id = req.project_id
        marker.extra_data = json.dumps(req.extra_data) if req.extra_data else None
        marker.updated_at = time.time()

        await session.commit()
        await session.refresh(marker)

        return MarkerResponse(
            id=marker.id,
            time=marker.time,
            duration=marker.duration,
            label=marker.label,
            color=marker.color,
            project_id=marker.project_id,
            extra_data=json.loads(marker.extra_data) if marker.extra_data else None,
            created_at=marker.created_at,
            updated_at=marker.updated_at,
        )


@app.delete("/api/markers/{marker_id}")
async def delete_marker(marker_id: str):
    """Delete a marker."""
    from db import Marker as MarkerModel, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        result = await session.execute(
            select(MarkerModel).where(MarkerModel.id == marker_id)
        )
        marker = result.scalar_one_or_none()

        if not marker:
            raise HTTPException(status_code=404, detail="Marker not found")

        await session.delete(marker)
        await session.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# Timeline Batch Operations
# ---------------------------------------------------------------------------

class TimelineBatchOperation(BaseModel):
    """A single batch operation."""
    operation: str  # 'add_segment', 'remove_segment', 'move_segment', 'trim_segment', 'add_track', 'remove_track'
    track_id: str | None = None
    segment_id: str | None = None
    data: dict | None = None


class BatchEditRequest(BaseModel):
    """Batch edit request for multiple timeline operations."""
    operations: list[TimelineBatchOperation]
    video_path: str


class BatchEditResponse(BaseModel):
    success: bool
    message: str | None = None
    error: str | None = None


@app.post("/api/timeline/batch")
async def batch_edit(req: BatchEditRequest):
    """
    Execute multiple timeline operations atomically.
    Operations are validated but not persisted server-side
    (timeline state is managed client-side with Zustand).
    """
    # Validate operations
    errors = []
    for i, op in enumerate(req.operations):
        if op.operation not in (
            "add_segment", "remove_segment", "move_segment",
            "trim_segment", "add_track", "remove_track"
        ):
            errors.append(f"Operation {i}: unknown operation '{op.operation}'")
        if op.operation in ("add_segment", "move_segment", "trim_segment") and not op.data:
            errors.append(f"Operation {i}: '{op.operation}' requires data")

    if errors:
        raise HTTPException(
            status_code=400,
            detail={"errors": errors}
        )

    # Validate video path
    video_path = req.video_path
    if video_path.startswith("/workspace/"):
        video_path = os.path.join(WORKSPACE, video_path.removeprefix("/workspace/"))

    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Video file not found")

    # In a full implementation, we would:
    # 1. Validate each operation against current timeline state
    # 2. Apply operations in a transaction
    # 3. Return updated timeline state
    # For now, we just validate and return success

    return BatchEditResponse(
        success=True,
        message=f"Successfully validated {len(req.operations)} operations",
    )


# ---------------------------------------------------------------------------
# Enhanced Timeline Rendering
# ---------------------------------------------------------------------------

class OverlayTrack(BaseModel):
    """Overlay track segment for rendering."""
    path: str
    start: float  # Start time in output
    end: float  # End time in output
    x: float = 0.5  # Normalized position (0-1)
    y: float = 0.5  # Normalized position (0-1)
    scale: float = 1.0
    rotation: float = 0
    opacity: float = 1.0
    blend_mode: str = "normal"  # normal, multiply, screen, overlay


class AudioTrack(BaseModel):
    """Audio track for mixing."""
    path: str
    start: float = 0
    volume: float = 1.0
    fade_in: float = 0
    fade_out: float = 0


class TextAnnotation(BaseModel):
    """Text annotation for rendering."""
    text: str
    start: float
    end: float
    x: float = 0.5
    y: float = 0.5
    font_size: int = 24
    font_family: str = "Arial"
    font_color: str = "#FFFFFF"
    background_color: str | None = None
    align: str = "center"  # left, center, right


class TimelineRenderRequest(BaseModel):
    """Request for enhanced timeline rendering."""
    video_path: str
    output_width: int = 1080
    output_height: int = 1920
    start: float
    end: float
    # Video tracks
    crop_avatar: CropBoxModel | None = None
    crop_game: CropBoxModel | None = None
    # Subtitle segments (existing format)
    segments: list[dict] | None = None
    # Overlay tracks
    overlays: list[OverlayTrack] | None = None
    # Audio tracks (BGM/SFX)
    audio_tracks: list[AudioTrack] | None = None
    # Text annotations
    text_annotations: list[TextAnnotation] | None = None
    # Markers for chapter export
    markers: list[MarkerRequest] | None = None
    # Subtitle styling
    font_name: str = "Arial Bold"
    font_color: str = "#FFFFFF"
    highlight_color: str = "#FFFF00"
    outline_color: str = "#000000"
    outline_width: float = 2.0
    shadow_color: str = "#000000"
    shadow_depth: float = 1.0
    shadow_opacity: float = 0.5
    font_size: int = 22
    subtitle_fade_in_ms: int = 100
    subtitle_fade_out_ms: int = 100
    caption_style: str = "karaoke"
    words_per_line: int = 1
    quality_preset: str = "standard"


@app.post("/api/render/timeline")
async def render_timeline_endpoint(req: TimelineRenderRequest, user: User = Depends(get_current_user)):
    """
    Render full timeline with all tracks:
    - Video crops (avatar + gameplay)
    - Overlay images/videos with position/scale
    - Text annotations with custom fonts
    - Subtitles with karaoke effects
    - Audio mixing (multiple tracks)
    - Marker chapters

    Returns SSE stream with progress updates.
    """
    from pipeline import renderer

    # Resolve workspace paths
    video_path = req.video_path
    if video_path.startswith("/workspace/"):
        video_path = os.path.join(WORKSPACE, video_path.removeprefix("/workspace/"))

    # Validate video path
    try:
        video_abs = os.path.abspath(video_path)
        workspace_abs = os.path.abspath(WORKSPACE)
        if not video_abs.startswith(workspace_abs + os.sep) and video_abs != workspace_abs:
            raise HTTPException(status_code=400, detail="Video path must be within workspace")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid video path")

    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Video file not found")

    # Validate overlay paths
    if req.overlays:
        for overlay in req.overlays:
            overlay_path = overlay.path
            if overlay_path.startswith("/workspace/"):
                overlay_path = os.path.join(WORKSPACE, overlay_path.removeprefix("/workspace/"))
            if not os.path.exists(overlay_path):
                raise HTTPException(status_code=404, detail=f"Overlay file not found: {overlay.path}")

    # Validate audio paths
    if req.audio_tracks:
        for audio in req.audio_tracks:
            audio_path = audio.path
            if audio_path.startswith("/workspace/"):
                audio_path = os.path.join(WORKSPACE, audio_path.removeprefix("/workspace/"))
            if not os.path.exists(audio_path):
                raise HTTPException(status_code=404, detail=f"Audio file not found: {audio.path}")

    renders_dir = os.path.join(WORKSPACE, "renders")

    async def generate():
        yield _sse_event({"progress": 0.1, "label": "Starting render..."})

        try:
            # Call enhanced renderer
            out_path = await asyncio.to_thread(
                renderer.render_timeline,
                video_path=video_path,
                output_width=req.output_width,
                output_height=req.output_height,
                start=req.start,
                end=req.end,
                crop_avatar=CropBox(**req.crop_avatar.model_dump()) if req.crop_avatar else None,
                crop_game=CropBox(**req.crop_game.model_dump()) if req.crop_game else None,
                segments=req.segments or [],
                overlays=req.overlays or [],
                audio_tracks=req.audio_tracks or [],
                text_annotations=req.text_annotations or [],
                markers=req.markers or [],
                font_name=req.font_name,
                font_color=req.font_color,
                highlight_color=req.highlight_color,
                outline_color=req.outline_color,
                outline_width=req.outline_width,
                shadow_color=req.shadow_color,
                shadow_depth=req.shadow_depth,
                shadow_opacity=req.shadow_opacity,
                font_size=req.font_size,
                subtitle_fade_in_ms=req.subtitle_fade_in_ms,
                subtitle_fade_out_ms=req.subtitle_fade_out_ms,
                caption_style=req.caption_style,
                words_per_line=req.words_per_line,
                quality_preset=req.quality_preset,
                output_dir=renders_dir,
            )

            rel = os.path.relpath(out_path, WORKSPACE)
            yield _sse_event({"done": True, "result": f"/workspace/{rel}"})

        except Exception as exc:
            yield _sse_event({"error": str(exc)})

    return _sse_response(generate())


# ---------------------------------------------------------------------------
# OAuth
# ---------------------------------------------------------------------------

# In-memory CSRF state store: state -> {platform, platform_account_id, redirect_uri, expires_at}
# States expire after 10 minutes for security
_pending_oauth_states: dict[str, dict] = {}
_OAUTH_STATE_EXPIRY_SECONDS = 600  # 10 minutes


@app.get("/api/oauth/{platform}/authorize")
async def oauth_authorize(platform: str, label: str = Query(...), redirect_uri: str | None = Query(None)):
    """
    Redirect to the platform's OAuth authorization URL.

    platform: 'youtube' | 'tiktok' | 'instagram'
    label: user-chosen display name for this account
    redirect_uri: optional custom redirect URI (defaults to the callback endpoint)
    """
    import secrets
    import time

    if platform not in ("youtube", "tiktok", "instagram"):
        raise HTTPException(status_code=400, detail="Unsupported platform.")

    state = secrets.token_hex(16)

    # Generate PKCE pair per RFC 9700
    if platform == "youtube":
        from oauth.youtube import generate_pkce_pair, build_youtube_auth_url
        code_verifier, code_challenge = generate_pkce_pair()
        auth_url = build_youtube_auth_url(state, code_challenge)
    elif platform == "tiktok":
        from oauth.tiktok import generate_pkce_pair, build_tiktok_auth_url
        code_verifier, code_challenge = generate_pkce_pair()
        auth_url = build_tiktok_auth_url(state, code_challenge)
    else:
        from oauth.instagram import generate_pkce_pair, build_instagram_auth_url
        code_verifier, code_challenge = generate_pkce_pair()
        auth_url = build_instagram_auth_url(state, code_challenge)

    _pending_oauth_states[state] = {
        "platform": platform,
        "label": label,
        "redirect_uri": redirect_uri,
        "code_verifier": code_verifier,
        "expires_at": time.time() + _OAUTH_STATE_EXPIRY_SECONDS,
    }

    from fastapi.responses import RedirectResponse
    return RedirectResponse(auth_url)


@app.get("/api/oauth/{platform}/callback")
async def oauth_callback(platform: str, code: str = Query(...), state: str = Query(...)):
    """
    Handle the OAuth2 callback from YouTube / TikTok / Instagram.

    Creates User + UserOAuthAccount or updates existing OAuth account, then redirects to frontend.
    """
    from fastapi.responses import RedirectResponse
    import time

    if platform not in ("youtube", "tiktok", "instagram"):
        raise HTTPException(status_code=400, detail="Unsupported platform.")

    state_data = _pending_oauth_states.pop(state, None)
    if not state_data:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state.")

    # Check if state has expired (CSRF protection)
    if state_data.get("expires_at") and time.time() > state_data["expires_at"]:
        raise HTTPException(status_code=400, detail="OAuth state has expired. Please try again.")

    if state_data["platform"] != platform:
        raise HTTPException(status_code=400, detail="Platform mismatch in OAuth state.")

    # Retrieve PKCE code_verifier from state
    code_verifier = state_data.get("code_verifier")
    if not code_verifier:
        raise HTTPException(status_code=400, detail="PKCE code_verifier not found. Please restart authentication.")

    try:
        if platform == "youtube":
            from oauth.youtube import exchange_youtube_code
            provider_account_id, access_token, refresh_token, expires_at = await exchange_youtube_code(code, code_verifier)
        elif platform == "tiktok":
            from oauth.tiktok import exchange_tiktok_code
            provider_account_id, access_token, refresh_token, expires_at = await exchange_tiktok_code(code, code_verifier)
        else:
            from oauth.instagram import exchange_instagram_code
            provider_account_id, access_token, refresh_token, expires_at = await exchange_instagram_code(code, code_verifier)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OAuth token exchange failed: {exc}")

    from db import User, UserOAuthAccount, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        # Check if this OAuth account already exists
        result = await session.execute(
            select(UserOAuthAccount).where(
                UserOAuthAccount.provider == platform,
                UserOAuthAccount.provider_account_id == provider_account_id,
            )
        )
        existing_oauth = result.scalar_one_or_none()

        # Encrypt OAuth tokens at rest for security (OWASP A02:2021 - Broken Authentication)
        from auth import encrypt_oauth_token
        encrypted_access_token = encrypt_oauth_token(access_token)
        encrypted_refresh_token = encrypt_oauth_token(refresh_token) if refresh_token else None

        if existing_oauth:
            # User already exists, just update tokens
            existing_oauth.access_token = encrypted_access_token
            existing_oauth.refresh_token = encrypted_refresh_token
            existing_oauth.expires_at = expires_at
            await session.commit()
            user_id = existing_oauth.user_id
        else:
            # Create new user + OAuth account
            display_name = state_data.get("label", f"{platform.capitalize()} User {provider_account_id[:8]}")
            user = User(
                email=f"{platform}_{provider_account_id}@oauth.momiji.local",
                display_name=display_name,
                is_verified=True,  # OAuth users are verified by the provider
            )
            session.add(user)
            await session.flush()
            user_id = user.id

            oauth_account = UserOAuthAccount(
                user_id=user.id,
                provider=platform,
                provider_account_id=provider_account_id,
                access_token=encrypted_access_token,
                refresh_token=encrypted_refresh_token,
                expires_at=expires_at,
            )
            session.add(oauth_account)
            await session.commit()

    # Generate JWT token for the user
    from auth import create_access_token
    async with get_session_cm() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

    from auth import ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS
    token = create_access_token(user.id, user.email)
    refresh_token = create_refresh_token(user.id)

    # Redirect to dashboard with HttpOnly cookie set
    from starlette.responses import RedirectResponse
    response = RedirectResponse("/dashboard")
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # 24 hours
        expires=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
        secure=False,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,  # 30 days
        expires=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        samesite="lax",
        secure=False,
        path="/",
    )
    return response


@app.get("/api/oauth/{platform}/accounts")
async def list_oauth_accounts(platform: str):
    """List all OAuth accounts for a platform (linked to users)."""
    from db import UserOAuthAccount, get_session
    from sqlalchemy import select

    if platform not in ("youtube", "tiktok", "instagram"):
        raise HTTPException(status_code=400, detail="Unsupported platform.")

    async with get_session_cm() as session:
        result = await session.execute(
            select(UserOAuthAccount).where(
                UserOAuthAccount.provider == platform,
            )
        )
        accounts = result.scalars().all()

    return [
        {
            "id": a.id,
            "user_id": a.user_id,
            "provider": a.provider,
            "provider_account_id": a.provider_account_id,
            "has_refresh_token": a.refresh_token is not None,
            "expires_at": a.expires_at,
        }
        for a in accounts
    ]


@app.delete("/api/oauth/{platform}/accounts/{account_id}")
async def delete_oauth_account(platform: str, account_id: str):
    """Delete a UserOAuthAccount record."""
    from db import UserOAuthAccount, get_session
    from sqlalchemy import select, delete

    async with get_session_cm() as session:
        result = await session.execute(
            select(UserOAuthAccount).where(
                UserOAuthAccount.id == account_id,
                UserOAuthAccount.provider == platform,
            )
        )
        oauth_account = result.scalar_one_or_none()

    if not oauth_account:
        raise HTTPException(status_code=404, detail="Account not found.")

    async with get_session_cm() as session:
        await session.delete(oauth_account)
        await session.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# Authentication Endpoints
# ---------------------------------------------------------------------------


class RegisterRequest(BaseModel):
    email: str
    password: str
    display_name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/register")
@limiter.limit("3/minute")
async def register(request: Request, req: RegisterRequest, response: Response):
    """Register new user with email/password and set HttpOnly cookie.

    Password requirements:
    - Minimum 8 characters
    - Not in top 20 common passwords list
    """
    from db import User, get_session
    from sqlalchemy import select
    from auth import hash_password, create_access_token, validate_password_strength

    # Validate email format
    if not re.match(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$", req.email):
        raise HTTPException(status_code=400, detail="Invalid email format")

    # Validate password strength
    is_valid, error_message = validate_password_strength(req.password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_message)

    async with get_session_cm() as session:
        # Check if email already exists
        result = await session.execute(select(User).where(User.email == req.email))
        existing = result.scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")

        # Create new user
        user = User(
            email=req.email,
            password_hash=hash_password(req.password),
            display_name=req.display_name or req.email.split("@")[0],
            is_verified=False,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

    # Set HttpOnly cookies (24-hour access + 30-day refresh)
    from auth import create_access_token, create_refresh_token, ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS
    access_token = create_access_token(user.id, user.email)
    refresh_token = create_refresh_token(user.id)

    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # 24 hours
        expires=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
        secure=False,  # Set to True in production with HTTPS
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,  # 30 days
        expires=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        samesite="lax",
        secure=False,
        path="/",
    )
    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "is_verified": user.is_verified,
        },
    }


@app.post("/api/auth/login")
@limiter.limit("5/minute")
async def login(request: Request, req: LoginRequest, response: Response):
    """Login with email/password and set HttpOnly cookie."""
    from db import User, get_session
    from sqlalchemy import select
    from auth import verify_password, create_access_token

    async with get_session_cm() as session:
        result = await session.execute(select(User).where(User.email == req.email))
        user = result.scalar_one_or_none()

        if not user:
            raise HTTPException(status_code=401, detail="Invalid email or password")

        if not user.is_active:
            raise HTTPException(status_code=401, detail="Account is deactivated")

        if not user.password_hash:
            raise HTTPException(status_code=401, detail="User has no password set (OAuth account?)")

        if not verify_password(req.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid email or password")

    # Set HttpOnly cookies (24-hour access + 30-day refresh)
    from auth import create_access_token, create_refresh_token, ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS
    access_token = create_access_token(user.id, user.email)
    refresh_token = create_refresh_token(user.id)

    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # 24 hours
        expires=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
        secure=False,  # Set to True in production with HTTPS
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,  # 30 days
        expires=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        samesite="lax",
        secure=False,
        path="/",
    )
    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "is_verified": user.is_verified,
        },
    }


@app.get("/api/auth/me")
async def get_current_user_profile(user: User = Depends(get_current_user)):
    """Get current authenticated user profile."""
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "is_verified": user.is_verified,
        "created_at": user.created_at,
    }


@app.post("/api/auth/logout")
async def logout(response: Response):
    """Logout user by clearing the HttpOnly cookies."""
    response.delete_cookie(
        key="access_token",
        httponly=True,
        samesite="lax",
        secure=False,
        path="/api",
    )
    response.delete_cookie(
        key="refresh_token",
        httponly=True,
        samesite="lax",
        secure=False,
        path="/api/auth/refresh",
    )
    return {"success": True}


@app.post("/api/auth/refresh")
async def refresh_token(refresh_cookie: str | None = Cookie(None, alias="refresh_token"), response: Response = None):
    """Refresh access token using refresh token cookie."""
    from auth import decode_refresh_token, create_access_token, create_refresh_token
    from db import User, get_session

    if not refresh_cookie:
        raise HTTPException(status_code=401, detail="Refresh token not found")

    # Decode and validate refresh token
    payload = decode_refresh_token(refresh_cookie)
    user_id = payload.get("sub")

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    # Verify user still exists and is active
    async with get_session_cm() as session:
        user = await session.get(User, user_id)
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="User not found or inactive")

    # Generate new access token and refresh token (rotation)
    from auth import ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS
    new_access_token = create_access_token(user.id, user.email)
    new_refresh_token = create_refresh_token(user.id)

    # Set new cookies (24-hour access + 30-day refresh)
    response.set_cookie(
        key="access_token",
        value=new_access_token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # 24 hours
        expires=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
        secure=False,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=new_refresh_token,
        httponly=True,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,  # 30 days
        expires=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        samesite="lax",
        secure=False,
        path="/",
    )

    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "is_verified": user.is_verified,
        },
    }


# ---------------------------------------------------------------------------
# OAuth Authentication Endpoints (Google, Twitch, YouTube for Sign-In)
# ---------------------------------------------------------------------------

# In-memory CSRF state store for auth flow (separate from platform OAuth)
# States expire after 10 minutes for security
_pending_auth_states: dict[str, dict] = {}
_AUTH_STATE_EXPIRY_SECONDS = 600  # 10 minutes


@app.get("/api/auth/{provider}/authorize")
async def auth_authorize(provider: str, redirect_uri: str | None = None):
    """
    Redirect to OAuth provider for authentication (Google, Twitch, YouTube).

    provider: 'google' | 'twitch' | 'youtube'
    redirect_uri: optional custom redirect URI (defaults to the callback endpoint)

    Implements PKCE (RFC 9700) for all providers.
    """
    import secrets

    if provider not in ("google", "twitch", "youtube"):
        raise HTTPException(status_code=400, detail="Unsupported OAuth provider.")

    state = secrets.token_hex(16)

    # Generate PKCE pair per RFC 9700
    if provider == "google":
        from oauth.google import generate_pkce_pair, build_google_auth_url
        code_verifier, code_challenge = generate_pkce_pair()
        auth_url = build_google_auth_url(state, code_challenge)
    elif provider == "twitch":
        from oauth.twitch import generate_pkce_pair, build_twitch_auth_url
        code_verifier, code_challenge = generate_pkce_pair()
        auth_url = build_twitch_auth_url(state, code_challenge)
    else:  # youtube
        from oauth.youtube import generate_pkce_pair, build_youtube_auth_url
        code_verifier, code_challenge = generate_pkce_pair()
        auth_url = build_youtube_auth_url(state, code_challenge)

    _pending_auth_states[state] = {
        "provider": provider,
        "redirect_uri": redirect_uri,
        "code_verifier": code_verifier,
        "expires_at": time.time() + _AUTH_STATE_EXPIRY_SECONDS,
    }

    from fastapi.responses import RedirectResponse
    return RedirectResponse(auth_url)


@app.get("/api/auth/{provider}/callback")
async def auth_callback(provider: str, code: str = Query(...), state: str = Query(...)):
    """
    Handle OAuth callback from Google / Twitch / YouTube for authentication.

    Creates User + UserOAuthAccount or logs in existing user, then redirects to frontend with JWT.
    """
    from fastapi.responses import RedirectResponse
    from auth import create_access_token

    if provider not in ("google", "twitch", "youtube"):
        raise HTTPException(status_code=400, detail="Unsupported OAuth provider.")

    state_data = _pending_auth_states.pop(state, None)
    if not state_data:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state.")

    if state_data["provider"] != provider:
        raise HTTPException(status_code=400, detail="Provider mismatch in OAuth state.")

    # Retrieve PKCE code_verifier from state
    code_verifier = state_data.get("code_verifier")
    if not code_verifier:
        raise HTTPException(status_code=400, detail="PKCE code_verifier not found. Please restart authentication.")

    try:
        if provider == "google":
            from oauth.google import exchange_google_code
            provider_account_id, email, access_token, refresh_token, expires_at = await exchange_google_code(code, code_verifier)
        elif provider == "twitch":
            from oauth.twitch import exchange_twitch_code
            provider_account_id, email, access_token, refresh_token, expires_at = await exchange_twitch_code(code, code_verifier)
            # Twitch email is None if user hasn't made it public
        else:  # youtube
            from oauth.youtube import exchange_youtube_code
            provider_account_id, access_token, refresh_token, expires_at = await exchange_youtube_code(code, code_verifier)
            email = None  # YouTube doesn't give email directly
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OAuth token exchange failed: {exc}")

    from db import User, UserOAuthAccount, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        # Check if this OAuth account already exists
        result = await session.execute(
            select(UserOAuthAccount).where(
                UserOAuthAccount.provider == provider,
                UserOAuthAccount.provider_account_id == provider_account_id,
            )
        )
        existing_oauth = result.scalar_one_or_none()

        # Encrypt OAuth tokens at rest for security (OWASP A02:2021 - Broken Authentication)
        from auth import encrypt_oauth_token
        encrypted_access_token = encrypt_oauth_token(access_token)
        encrypted_refresh_token = encrypt_oauth_token(refresh_token) if refresh_token else None

        if existing_oauth:
            # User already exists, just update tokens and log in
            existing_oauth.access_token = encrypted_access_token
            existing_oauth.refresh_token = encrypted_refresh_token
            existing_oauth.expires_at = expires_at
            await session.commit()

            # Generate JWT for existing user
            user = await session.get(User, existing_oauth.user_id)
            if not user or not user.is_active:
                raise HTTPException(status_code=401, detail="User not found or inactive")
        else:
            # Create new user + OAuth account
            if email:
                # Use email from provider (Google or Twitch if public)
                display_name = email.split("@")[0]
            else:
                # Generate placeholder email
                email = f"{provider}_{provider_account_id}@oauth.momiji.local"
                display_name = f"{provider.capitalize()} User {provider_account_id[:8]}"

            user = User(
                email=email,
                display_name=display_name,
                is_verified=True,  # OAuth users are verified by the provider
            )
            session.add(user)
            await session.flush()

            oauth_account = UserOAuthAccount(
                user_id=user.id,
                provider=provider,
                provider_account_id=provider_account_id,
                access_token=encrypted_access_token,
                refresh_token=encrypted_refresh_token,
                expires_at=expires_at,
            )
            session.add(oauth_account)
            await session.commit()

    # Generate JWT token
    token = create_access_token(user.id, user.email)

    # Redirect to frontend with token in URL fragment (not sent to server)
    redirect_to = f"/dashboard#token={token}"
    return RedirectResponse(redirect_to)


# ---------------------------------------------------------------------------
# Team Endpoints
# ---------------------------------------------------------------------------


class CreateTeamRequest(BaseModel):
    name: str


class InviteToTeamRequest(BaseModel):
    email: str
    role: str = "editor"


@app.post("/api/teams")
async def create_team(req: CreateTeamRequest, user: User = Depends(get_current_user)):
    """Create a new team. The creator becomes the owner."""
    from db import Team, TeamMember, get_session

    async with get_session_cm() as session:
        team = Team(name=req.name, owner_id=user.id)
        session.add(team)
        await session.flush()

        # Add creator as owner member
        member = TeamMember(team_id=team.id, user_id=user.id, role="owner")
        session.add(member)
        await session.commit()
        await session.refresh(team)

    return {
        "id": team.id,
        "name": team.name,
        "owner_id": team.owner_id,
        "created_at": team.created_at,
    }


@app.get("/api/teams")
async def list_teams(user: User = Depends(get_current_user)):
    """List all teams the current user belongs to."""
    from db import Team, TeamMember, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        result = await session.execute(
            select(Team)
            .join(TeamMember)
            .where(TeamMember.user_id == user.id)
            .order_by(Team.created_at.desc())
        )
        teams = result.scalars().all()

    return [
        {
            "id": t.id,
            "name": t.name,
            "owner_id": t.owner_id,
            "created_at": t.created_at,
        }
        for t in teams
    ]


@app.get("/api/teams/{team_id}")
async def get_team(team_id: str, user: User = Depends(get_current_user)):
    """Get team details including members."""
    from db import Team, TeamMember, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        # Get team
        result = await session.execute(select(Team).where(Team.id == team_id))
        team = result.scalar_one_or_none()
        if not team:
            raise HTTPException(status_code=404, detail="Team not found")

        # Check user is a member
        member_result = await session.execute(
            select(TeamMember).where(
                TeamMember.team_id == team_id,
                TeamMember.user_id == user.id,
            )
        )
        member = member_result.scalar_one_or_none()
        if not member:
            raise HTTPException(status_code=403, detail="Not a member of this team")

        # Get members
        members_result = await session.execute(
            select(TeamMember, User)
            .join(User, User.id == TeamMember.user_id)
            .where(TeamMember.team_id == team_id)
        )
        members = [
            {
                "user_id": m.user_id,
                "email": u.email,
                "display_name": u.display_name,
                "role": m.role,
                "joined_at": m.joined_at,
            }
            for m, u in members_result.all()
        ]

    return {
        "id": team.id,
        "name": team.name,
        "owner_id": team.owner_id,
        "created_at": team.created_at,
        "members": members,
    }


@app.post("/api/teams/{team_id}/invites")
async def invite_to_team(
    team_id: str,
    req: InviteToTeamRequest,
    user: User = Depends(get_current_user),
):
    """Invite a user to join a team."""
    from db import Team, TeamInvite, TeamMember, User as UserDB, get_session
    from sqlalchemy import select
    from datetime import datetime, timedelta

    async with get_session_cm() as session:
        # Get team and verify user is owner or admin
        result = await session.execute(select(Team).where(Team.id == team_id))
        team = result.scalar_one_or_none()
        if not team:
            raise HTTPException(status_code=404, detail="Team not found")

        member_result = await session.execute(
            select(TeamMember).where(
                TeamMember.team_id == team_id,
                TeamMember.user_id == user.id,
            )
        )
        member = member_result.scalar_one_or_none()
        if not member or member.role not in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="Not authorized to invite members")

        # Check if user is already a member
        existing_member = await session.execute(
            select(TeamMember).where(
                TeamMember.team_id == team_id,
                TeamMember.user_id == UserDB.id,
            ).join(UserDB, UserDB.email == req.email)
        )
        if existing_member.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="User is already a member")

        # Check for existing pending invite
        existing_invite = await session.execute(
            select(TeamInvite).where(
                TeamInvite.team_id == team_id,
                TeamInvite.invitee_email == req.email,
                TeamInvite.status == "pending",
            )
        )
        if existing_invite.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Invite already sent")

        # Find user by email if they exist
        user_result = await session.execute(select(UserDB).where(UserDB.email == req.email))
        invitee_user = user_result.scalar_one_or_none()

        # Create invite (expires in 7 days)
        expires_at = (datetime.utcnow() + timedelta(days=7)).timestamp()
        invite = TeamInvite(
            team_id=team_id,
            invitee_email=req.email,
            invitee_id=invitee_user.id if invitee_user else None,
            inviter_id=user.id,
            role=req.role,
            expires_at=expires_at,
        )
        session.add(invite)
        await session.commit()
        await session.refresh(invite)

    return {
        "id": invite.id,
        "team_id": invite.team_id,
        "invitee_email": invite.invitee_email,
        "role": invite.role,
        "expires_at": invite.expires_at,
    }


@app.get("/api/teams/{team_id}/members")
async def list_team_members(team_id: str, user: User = Depends(get_current_user)):
    """List all members of a team."""
    from db import Team, TeamMember, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        # Verify user is a member
        member_result = await session.execute(
            select(TeamMember).where(
                TeamMember.team_id == team_id,
                TeamMember.user_id == user.id,
            )
        )
        member = member_result.scalar_one_or_none()
        if not member:
            raise HTTPException(status_code=403, detail="Not a member of this team")

        # Get all members
        members_result = await session.execute(
            select(TeamMember, User)
            .join(User, User.id == TeamMember.user_id)
            .where(TeamMember.team_id == team_id)
        )
        members = [
            {
                "user_id": m.user_id,
                "email": u.email,
                "display_name": u.display_name,
                "role": m.role,
                "joined_at": m.joined_at,
            }
            for m, u in members_result.all()
        ]

    return {"members": members}


@app.post("/api/teams/invites/{invite_id}/accept")
async def accept_invite(invite_id: str, user: User = Depends(get_current_user)):
    """Accept a team invite."""
    from db import TeamInvite, TeamMember, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        result = await session.execute(
            select(TeamInvite).where(TeamInvite.id == invite_id)
        )
        invite = result.scalar_one_or_none()
        if not invite:
            raise HTTPException(status_code=404, detail="Invite not found")

        # Check invite is for this user
        if invite.invitee_id and invite.invitee_id != user.id:
            raise HTTPException(status_code=403, detail="Invite is not for this user")

        # Check email matches
        if invite.invitee_email != user.email:
            raise HTTPException(status_code=403, detail="Invite email does not match")

        # Check not expired
        import time
        if invite.expires_at and time.time() > invite.expires_at:
            invite.status = "expired"
            raise HTTPException(status_code=400, detail="Invite has expired")

        # Add as member
        member = TeamMember(
            team_id=invite.team_id,
            user_id=user.id,
            role=invite.role,
        )
        session.add(member)

        # Mark invite as accepted
        invite.status = "accepted"
        await session.commit()

    return {"ok": True, "team_id": invite.team_id}


@app.delete("/api/teams/{team_id}/members/{user_id}")
async def remove_member(
    team_id: str,
    user_id: str,
    user: User = Depends(get_current_user),
):
    """Remove a member from a team. Only owner/admin can remove."""
    from db import Team, TeamMember, get_session
    from sqlalchemy import select, delete

    async with get_session_cm() as session:
        # Verify user is owner or admin
        member_result = await session.execute(
            select(TeamMember).where(
                TeamMember.team_id == team_id,
                TeamMember.user_id == user.id,
            )
        )
        member = member_result.scalar_one_or_none()
        if not member or member.role not in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="Not authorized to remove members")

        # Cannot remove owner
        team_result = await session.execute(select(Team).where(Team.id == team_id))
        team = team_result.scalar_one_or_none()
        if user_id == team.owner_id:
            raise HTTPException(status_code=400, detail="Cannot remove team owner")

        # Delete member
        await session.execute(
            delete(TeamMember).where(
                TeamMember.team_id == team_id,
                TeamMember.user_id == user_id,
            )
        )
        await session.commit()

    return {"ok": True}


@app.get("/api/user/invites")
async def list_user_invites(user: User = Depends(get_current_user)):
    """List all pending team invites for the current user."""
    from db import TeamInvite, Team, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        result = await session.execute(
            select(TeamInvite, Team)
            .join(Team, Team.id == TeamInvite.team_id)
            .where(TeamInvite.invitee_id == user.id)
            .where(TeamInvite.status == "pending")
            .order_by(TeamInvite.created_at.desc())
        )
        invites = result.all()

    return {
        "invites": [
            {
                "id": invite.id,
                "team_id": invite.team_id,
                "team_name": team.name,
                "invitee_email": invite.invitee_email,
                "role": invite.role,
                "status": invite.status,
                "expires_at": invite.expires_at,
                "created_at": invite.created_at,
            }
            for invite, team in invites
        ]
    }


@app.post("/api/teams/invites/{invite_id}/decline")
async def decline_invite(invite_id: str, user: User = Depends(get_current_user)):
    """Decline a team invite."""
    from db import TeamInvite, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        result = await session.execute(
            select(TeamInvite).where(TeamInvite.id == invite_id)
        )
        invite = result.scalar_one_or_none()
        if not invite:
            raise HTTPException(status_code=404, detail="Invite not found")

        # Check invite is for this user
        if invite.invitee_id and invite.invitee_id != user.id:
            raise HTTPException(status_code=403, detail="Invite is not for this user")

        invite.status = "declined"
        await session.commit()

    return {"ok": True}


@app.delete("/api/teams/invites/{invite_id}")
async def cancel_invite(
    invite_id: str,
    user: User = Depends(get_current_user),
):
    """Cancel a team invite (only inviter or team owner/admin can cancel)."""
    from db import TeamInvite, Team, TeamMember, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        result = await session.execute(
            select(TeamInvite).where(TeamInvite.id == invite_id)
        )
        invite = result.scalar_one_or_none()
        if not invite:
            raise HTTPException(status_code=404, detail="Invite not found")

        # Check if user is the inviter
        if invite.inviter_id != user.id:
            # Check if user is team owner/admin
            member_result = await session.execute(
                select(TeamMember).where(
                    TeamMember.team_id == invite.team_id,
                    TeamMember.user_id == user.id,
                )
            )
            member = member_result.scalar_one_or_none()
            if not member or member.role not in ("owner", "admin"):
                raise HTTPException(status_code=403, detail="Not authorized to cancel this invite")

        invite.status = "expired"  # or could use "cancelled" if you add it to the enum
        await session.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# Video Project Endpoints
# ---------------------------------------------------------------------------


class CreateProjectRequest(BaseModel):
    source_path: str
    original_filename: str
    duration: float | None = None
    team_id: str | None = None


class AddClipsRequest(BaseModel):
    clips: list[dict]


@app.post("/api/projects")
async def create_project(req: CreateProjectRequest, user: User = Depends(get_current_user)):
    """Create a new video project."""
    from db import VideoProject, get_session

    async with get_session_cm() as session:
        # If team_id provided, verify user is a member
        if req.team_id:
            from db import TeamMember
            from sqlalchemy import select
            member_result = await session.execute(
                select(TeamMember).where(
                    TeamMember.team_id == req.team_id,
                    TeamMember.user_id == user.id,
                )
            )
            member = member_result.scalar_one_or_none()
            if not member:
                raise HTTPException(status_code=403, detail="Not a member of this team")

        project = VideoProject(
            owner_id=user.id,
            team_id=req.team_id,
            source_path=req.source_path,
            original_filename=req.original_filename,
            duration=req.duration,
            status="pending",
        )
        session.add(project)
        await session.commit()
        await session.refresh(project)

    return {
        "id": project.id,
        "owner_id": project.owner_id,
        "team_id": project.team_id,
        "source_path": project.source_path,
        "original_filename": project.original_filename,
        "duration": project.duration,
        "status": project.status,
        "created_at": project.created_at,
    }


@app.get("/api/projects")
async def list_projects(team_id: str | None = Query(None), user: User = Depends(get_current_user)):
    """List user's video projects, optionally filtered by team."""
    from db import VideoProject, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        query = select(VideoProject).where(VideoProject.owner_id == user.id)

        if team_id:
            # Verify user is a member of the team
            from db import TeamMember
            member_result = await session.execute(
                select(TeamMember).where(
                    TeamMember.team_id == team_id,
                    TeamMember.user_id == user.id,
                )
            )
            member = member_result.scalar_one_or_none()
            if not member:
                raise HTTPException(status_code=403, detail="Not a member of this team")

            # Include projects owned by user OR projects in this team
            from sqlalchemy import or_
            query = select(VideoProject).where(
                or_(
                    VideoProject.owner_id == user.id,
                    VideoProject.team_id == team_id,
                )
            )

        query = query.order_by(VideoProject.created_at.desc())
        result = await session.execute(query)
        projects = result.scalars().all()

    return [
        {
            "id": p.id,
            "owner_id": p.owner_id,
            "team_id": p.team_id,
            "source_path": p.source_path,
            "original_filename": p.original_filename,
            "duration": p.duration,
            "status": p.status,
            "created_at": p.created_at,
        }
        for p in projects
    ]


@app.get("/api/projects/{project_id}")
async def get_project(project_id: str, user: User = Depends(get_current_user)):
    """Get a video project by ID."""
    from db import VideoProject, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        result = await session.execute(select(VideoProject).where(VideoProject.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Check access: owner or team member
        if project.owner_id != user.id:
            if project.team_id:
                from db import TeamMember
                member_result = await session.execute(
                    select(TeamMember).where(
                        TeamMember.team_id == project.team_id,
                        TeamMember.user_id == user.id,
                    )
                )
                member = member_result.scalar_one_or_none()
                if not member:
                    raise HTTPException(status_code=403, detail="Access denied")
            else:
                raise HTTPException(status_code=403, detail="Access denied")

    return {
        "id": project.id,
        "owner_id": project.owner_id,
        "team_id": project.team_id,
        "source_path": project.source_path,
        "original_filename": project.original_filename,
        "duration": project.duration,
        "status": project.status,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }


@app.post("/api/projects/{project_id}/clips")
async def add_clips_to_project(
    project_id: str,
    req: AddClipsRequest,
    user: User = Depends(get_current_user),
):
    """Add generated clips to a project."""
    from db import GeneratedClip, VideoProject, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        # Verify project access
        result = await session.execute(select(VideoProject).where(VideoProject.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.owner_id != user.id:
            if project.team_id:
                from db import TeamMember
                member_result = await session.execute(
                    select(TeamMember).where(
                        TeamMember.team_id == project.team_id,
                        TeamMember.user_id == user.id,
                    )
                )
                member = member_result.scalar_one_or_none()
                if not member:
                    raise HTTPException(status_code=403, detail="Access denied")
            else:
                raise HTTPException(status_code=403, detail="Access denied")

        # Add clips
        added_clips = []
        for clip_data in req.clips:
            clip = GeneratedClip(
                project_id=project_id,
                index=clip_data.get("index", 0),
                title=clip_data.get("title", ""),
                start_time=clip_data.get("start_time", 0),
                end_time=clip_data.get("end_time", 0),
                reason=clip_data.get("reason"),
                virality_score=clip_data.get("virality_score"),
                brand_alignment=clip_data.get("brand_alignment"),
                hashtags=clip_data.get("hashtags"),
                render_path=clip_data.get("render_path"),
            )
            session.add(clip)
            added_clips.append(clip)

        await session.commit()

    return {
        "clips": [
            {
                "id": c.id,
                "project_id": c.project_id,
                "index": c.index,
                "title": c.title,
                "start": c.start_time,
                "end": c.end_time,
                "reason": c.reason,
                "virality_score": c.virality_score,
                "brand_alignment": c.brand_alignment,
                "hashtags": c.hashtags,
                "render_path": c.render_path,
                "created_at": c.created_at,
            }
            for c in added_clips
        ]
    }


@app.get("/api/projects/{project_id}/clips")
async def get_project_clips(project_id: str, user: User = Depends(get_current_user)):
    """Get all clips for a project."""
    from db import GeneratedClip, VideoProject, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        # Verify project access
        result = await session.execute(select(VideoProject).where(VideoProject.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.owner_id != user.id:
            if project.team_id:
                from db import TeamMember
                member_result = await session.execute(
                    select(TeamMember).where(
                        TeamMember.team_id == project.team_id,
                        TeamMember.user_id == user.id,
                    )
                )
                member = member_result.scalar_one_or_none()
                if not member:
                    raise HTTPException(status_code=403, detail="Access denied")
            else:
                raise HTTPException(status_code=403, detail="Access denied")

        # Get clips
        clips_result = await session.execute(
            select(GeneratedClip).where(GeneratedClip.project_id == project_id)
            .order_by(GeneratedClip.index)
        )
        clips = clips_result.scalars().all()

    return [
        {
            "id": c.id,
            "project_id": c.project_id,
            "index": c.index,
            "title": c.title,
            "start": c.start_time,
            "end": c.end_time,
            "reason": c.reason,
            "virality_score": c.virality_score,
            "brand_alignment": c.brand_alignment,
            "hashtags": c.hashtags,
            "render_path": c.render_path,
            "created_at": c.created_at,
        }
        for c in clips
    ]


@app.get("/api/projects/{project_id}/clips/{clip_id}")
async def get_project_clip(project_id: str, clip_id: str, user: User = Depends(get_current_user)):
    """Get a single clip for a project by clip ID or index. Creates clip entry if not found."""
    from db import GeneratedClip, VideoProject, get_session
    from sqlalchemy import select

    async with get_session_cm() as session:
        # Verify project access
        result = await session.execute(select(VideoProject).where(VideoProject.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        if project.owner_id != user.id:
            if project.team_id:
                from db import TeamMember
                member_result = await session.execute(
                    select(TeamMember).where(
                        TeamMember.team_id == project.team_id,
                        TeamMember.user_id == user.id,
                    )
                )
                member = member_result.scalar_one_or_none()
                if not member:
                    raise HTTPException(status_code=403, detail="Access denied")
            else:
                raise HTTPException(status_code=403, detail="Access denied")

        # Get clip - try by ID first, then by index if clip_id is numeric
        clip = None
        clip_result = await session.execute(
            select(GeneratedClip).where(
                GeneratedClip.project_id == project_id,
                GeneratedClip.id == clip_id,
            )
        )
        clip = clip_result.scalar_one_or_none()

        # If not found by ID and clip_id looks like an index, try by index
        if clip is None and clip_id.isdigit():
            index = int(clip_id)
            clip_result = await session.execute(
                select(GeneratedClip).where(
                    GeneratedClip.project_id == project_id,
                    GeneratedClip.index == index,
                )
            )
            clip = clip_result.scalar_one_or_none()

        # If still not found, create a placeholder clip entry for on-demand editing
        if clip is None and clip_id.isdigit():
            index = int(clip_id)
            clip = GeneratedClip(
                project_id=project_id,
                index=index,
                title=f"Clip {index + 1}",
                start_time=0,
                end_time=60,
                reason="On-demand clip",
                virality_score=50,
                brand_alignment=[],
                hashtags=[],
            )
            session.add(clip)
            await session.commit()

        if not clip:
            raise HTTPException(status_code=404, detail="Clip not found")

    return {
        "id": clip.id,
        "project_id": clip.project_id,
        "index": clip.index,
        "title": clip.title,
        "start": clip.start_time,
        "end": clip.end_time,
        "reason": clip.reason,
        "virality_score": clip.virality_score,
        "brand_alignment": clip.brand_alignment,
        "hashtags": clip.hashtags,
        "render_path": clip.render_path,
        "created_at": clip.created_at,
    }


@app.patch("/api/projects/{project_id}")
async def update_project(
    project_id: str,
    updates: dict,
    user: User = Depends(get_current_user),
):
    """Update a project (status, etc.)."""
    from db import VideoProject, get_session
    from sqlalchemy import select

    allowed_fields = {"status", "duration"}

    async with get_session_cm() as session:
        result = await session.execute(select(VideoProject).where(VideoProject.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Check access
        if project.owner_id != user.id:
            if project.team_id:
                from db import TeamMember
                member_result = await session.execute(
                    select(TeamMember).where(
                        TeamMember.team_id == project.team_id,
                        TeamMember.user_id == user.id,
                    )
                )
                member = member_result.scalar_one_or_none()
                if not member or member.role not in ("owner", "admin", "editor"):
                    raise HTTPException(status_code=403, detail="Access denied")
            else:
                raise HTTPException(status_code=403, detail="Access denied")

        # Apply allowed updates
        for key, value in updates.items():
            if key in allowed_fields:
                setattr(project, key, value)

        await session.commit()
        await session.refresh(project)

    return {
        "id": project.id,
        "status": project.status,
        "duration": project.duration,
        "updated_at": project.updated_at,
    }


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str, user: User = Depends(get_current_user)):
    """Delete a project and all its clips."""
    from db import GeneratedClip, VideoProject, get_session
    from sqlalchemy import delete, select

    async with get_session_cm() as session:
        result = await session.execute(select(VideoProject).where(VideoProject.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        # Only owner can delete
        if project.owner_id != user.id:
            raise HTTPException(status_code=403, detail="Only project owner can delete")

        # Delete clips first (cascade should handle this, but being explicit)
        await session.execute(delete(GeneratedClip).where(GeneratedClip.project_id == project_id))

        # Delete project
        await session.delete(project)
        await session.commit()

    return {"ok": True}
