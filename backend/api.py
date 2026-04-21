"""
Momiji Clipper — FastAPI backend.

This is the main application entry point. All API endpoints are organized
into routers under the routers/ package. Shared utilities are in utils/.
"""

import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

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


# ---------------------------------------------------------------------------
# Security Headers Middleware (OWASP security best practices)
# ---------------------------------------------------------------------------

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """
    Add security headers to all responses.

    Headers added:
    - X-Frame-Options: DENY (prevent clickjacking)
    - X-Content-Type-Options: nosniff (prevent MIME sniffing)
    - X-XSS-Protection: 1; mode=block (legacy XSS filter)
    - Referrer-Policy: strict-origin-when-cross-origin
    - Content-Security-Policy: Default-src self (prevent XSS)
    - Permissions-Policy: Restrict browser features
    - Cache-Control: no-store for HTML responses

    Note: SSE (text/event-stream) responses are exempted to avoid breaking streaming.
    """
    response = await call_next(request)

    # Skip SSE streaming responses - security headers can break streaming
    content_type = response.headers.get("Content-Type", "")
    if "text/event-stream" in content_type:
        return response

    # Prevent clickjacking attacks
    response.headers["X-Frame-Options"] = "DENY"

    # Prevent MIME type sniffing
    response.headers["X-Content-Type-Options"] = "nosniff"

    # Legacy XSS filter (for older browsers)
    response.headers["X-XSS-Protection"] = "1; mode=block"

    # Control referrer information
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

    # Content Security Policy - restrict resource loading to same origin
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self'; "
        "connect-src 'self'; "
        "frame-ancestors 'none'"
    )

    # Restrict browser features/permissions
    response.headers["Permissions-Policy"] = (
        "accelerometer=(), "
        "camera=(), "
        "geolocation=(), "
        "gyroscope=(), "
        "magnetometer=(), "
        "microphone=(), "
        "payment=(), "
        "usb=()"
    )

    # Prevent caching of HTML responses (for security)
    content_type = response.headers.get("Content-Type", "")
    if "text/html" in content_type or "application/json" in content_type:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"

    return response


# ---------------------------------------------------------------------------
# Workspace directory setup
# ---------------------------------------------------------------------------

WORKSPACE = os.environ.get(
    "WORKSPACE_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "workspace"),
)

os.makedirs(WORKSPACE, exist_ok=True)
os.makedirs(os.path.join(WORKSPACE, "audio"), exist_ok=True)
os.makedirs(os.path.join(WORKSPACE, "frames"), exist_ok=True)
os.makedirs(os.path.join(WORKSPACE, "renders"), exist_ok=True)


# ---------------------------------------------------------------------------
# Cached Static Files
# ---------------------------------------------------------------------------

class CachedStaticFiles(StaticFiles):
    """
    StaticFiles subclass with Cache-Control headers for static assets.
    """

    def __init__(
        self,
        *args: Any,
        cache_max_age: int = 3600,  # Default: 1 hour
        **kwargs: Any,
    ):
        self.cache_max_age = cache_max_age
        super().__init__(*args, **kwargs)

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        """Add Cache-Control header to static file responses."""
        async def send_with_cache(message: dict[str, Any]) -> None:
            if message.get("type") == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append(
                    (
                        b"cache-control",
                        f"public, max-age={self.cache_max_age}, immutable".encode(),
                    )
                )
                headers.append((b"x-content-type-options", b"nosniff"))
                message["headers"] = headers
            await send(message)

        await super().__call__(scope, receive, send_with_cache)


# Serve workspace files (frames, renders, audio) as static files with caching
app.mount("/workspace", CachedStaticFiles(directory=WORKSPACE, cache_max_age=86400), name="workspace")


# ---------------------------------------------------------------------------
# Include routers
# ---------------------------------------------------------------------------

from routers import (
    config_router,
    auth_router,
    ingest_router,
    transcribe_router,
    highlights_router,
    projects_router,
    clips_router,
    schedule_router,
    media_router,
    markers_router,
    timeline_router,
    render_router,
    oauth_router,
    teams_router,
)

app.include_router(config_router)
app.include_router(auth_router)
app.include_router(ingest_router)
app.include_router(transcribe_router)
app.include_router(highlights_router)
app.include_router(projects_router)
app.include_router(clips_router)
app.include_router(schedule_router)
app.include_router(media_router)
app.include_router(markers_router)
app.include_router(timeline_router)
app.include_router(render_router)
app.include_router(oauth_router)
app.include_router(teams_router)


# ---------------------------------------------------------------------------
# Health check endpoint
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring."""
    return {"status": "healthy"}
