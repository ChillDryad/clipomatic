"""
Momiji Clipper — API Routers.

Each router module handles a specific domain:
- ingest: Video/audio ingestion (upload, URL download, Twitch streaming)
- transcribe: Whisper transcription
- highlights: LLM-based highlight detection
- projects: Video project CRUD
- clips: Clip metadata operations
- schedule: Scheduled post jobs
- media: Media/audio asset library
- markers: Timeline markers
- timeline: Batch marker operations, timeline rendering
- auth: User authentication (register, login, OAuth)
- oauth: Platform OAuth for posting (YouTube, TikTok, Instagram)
- teams: Team management
- config: App configuration and models
"""

from routers.config import router as config_router
from routers.auth import router as auth_router
from routers.ingest import router as ingest_router
from routers.transcribe import router as transcribe_router
from routers.highlights import router as highlights_router
from routers.projects import router as projects_router
from routers.clips import router as clips_router
from routers.schedule import router as schedule_router
from routers.media import router as media_router
from routers.markers import router as markers_router
from routers.timeline import router as timeline_router, render_router
from routers.oauth import router as oauth_router
from routers.teams import router as teams_router
from routers.thumbnails import router as thumbnails_router

__all__ = [
    "config_router",
    "auth_router",
    "ingest_router",
    "transcribe_router",
    "highlights_router",
    "projects_router",
    "clips_router",
    "schedule_router",
    "media_router",
    "markers_router",
    "timeline_router",
    "render_router",
    "oauth_router",
    "teams_router",
    "thumbnails_router",
]
