"""
Momiji Clipper — Database layer.

SQLAlchemy 2.0 async models. Supports two backends:
  - Local dev  : DATABASE_URL=sqlite+aiosqlite:///./momiji.db
  - Production  : DATABASE_URL=postgresql+asyncpg://user:pass@host/db

 Switching requires only changing the DATABASE_URL env var — same models,
 same query code.
"""

import os
import time
import uuid
from typing import AsyncGenerator

from sqlalchemy import Boolean, Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# ---------------------------------------------------------------------------
# Engine & session factory
# ---------------------------------------------------------------------------

# P1 Task #6: Move SQLite database to ./data/ directory
# Ensure data/*.db is in .gitignore for security
try:
    DATABASE_URL = os.environ["DATABASE_URL"]
except KeyError:
    raise RuntimeError(
        "DATABASE_URL environment variable is not set. "
        "Create a .env file (see .env.example) or set it in your environment.\n"
        "Examples:\n"
        "  SQLite:  DATABASE_URL=sqlite+aiosqlite:///./data/momiji.db\n"
        "  PostgreSQL: DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/momiji"
    ) from None

# Create data directory if it doesn't exist (for SQLite database)
if DATABASE_URL.startswith("sqlite"):
    import re
    db_path_match = re.search(r'sqlite[^:]*:///(.+)', DATABASE_URL)
    if db_path_match:
        db_dir = os.path.dirname(db_path_match.group(1))
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)

# P3 Task #13: Connection pool tuning for PostgreSQL
# SQLite doesn't support connection pooling, but these settings apply to PostgreSQL
_engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=20,  # Number of connections to keep open
    max_overflow=40,  # Additional connections beyond pool_size
    pool_pre_ping=True,  # Verify connections before use
    pool_recycle=3600,  # Recycle connections after 1 hour
)
_async_session_factory = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency that yields an async database session.

    Usage:
        db: AsyncSession = Depends(get_session)

    The session is committed on success, rolled back on exception, and always closed.
    """
    session = _async_session_factory()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


class SessionContextManager:
    """Async context manager for use outside FastAPI (e.g., scheduler.py)."""

    __slots__ = ('_gen', '_session')

    def __init__(self):
        self._gen = get_session()
        self._session: AsyncSession | None = None

    async def __aenter__(self) -> AsyncSession:
        self._session = await self._gen.__anext__()
        return self._session

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        try:
            if exc_type is not None:
                await self._session.rollback()
            else:
                await self._session.commit()
        except Exception:
            pass
        finally:
            await self._session.close()
        return None


# Alias for backward compatibility with async with usage
get_session_cm = SessionContextManager


async def init_db() -> None:
    """Create all tables and apply migrations. Safe to call multiple times (idempotent)."""
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Migration: add crop_avatar / crop_game columns to generated_clips
    try:
        async with _engine.begin() as conn:
            await conn.exec_driver_sql(
                "ALTER TABLE generated_clips ADD COLUMN crop_avatar TEXT"
            )
    except Exception:
        pass  # Column already exists

    try:
        async with _engine.begin() as conn:
            await conn.exec_driver_sql(
                "ALTER TABLE generated_clips ADD COLUMN crop_game TEXT"
            )
    except Exception:
        pass  # Column already exists

    # Migration: add thumbnail_path column to video_projects
    try:
        async with _engine.begin() as conn:
            await conn.exec_driver_sql(
                "ALTER TABLE video_projects ADD COLUMN thumbnail_path TEXT"
            )
    except Exception:
        pass  # Column already exists

    # Migration: add audio_energy column to transcripts
    try:
        async with _engine.begin() as conn:
            await conn.exec_driver_sql(
                "ALTER TABLE transcripts ADD COLUMN audio_energy TEXT"
            )
    except Exception:
        pass  # Column already exists


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Base(DeclarativeBase):
    pass


class PlatformAccount(Base):
    __tablename__ = "platform_accounts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    platform: Mapped[str] = mapped_column(String, nullable=False)  # 'youtube' | 'tiktok' | 'instagram'
    label: Mapped[str] = mapped_column(String, nullable=False)
    account_id: Mapped[str | None] = mapped_column(String, nullable=True)  # platform's native ID
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())
    updated_at: Mapped[float] = mapped_column(Float, default=lambda: time.time(), onupdate=lambda: time.time())

    tokens: Mapped[list["OAuthToken"]] = relationship(
        back_populates="account",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    post_jobs: Mapped[list["PostJob"]] = relationship(
        back_populates="account",
        lazy="selectin",
    )


class OAuthToken(Base):
    """
    OAuth tokens for platform accounts (YouTube, TikTok, Instagram for posting).

    Supports RFC 9700 refresh token rotation with reuse detection.
    """
    __tablename__ = "oauth_tokens"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    platform_account_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("platform_accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[float | None] = mapped_column(Float, nullable=True)  # unix timestamp
    refresh_token_used_at: Mapped[float | None] = mapped_column(Float, nullable=True)  # For RFC 9700 rotation tracking
    updated_at: Mapped[float] = mapped_column(Float, default=lambda: time.time(), onupdate=lambda: time.time())

    account: Mapped[PlatformAccount] = relationship(back_populates="tokens")


class PostJob(Base):
    """
    Scheduled post job for social media platforms.

    P3 Task #10: Added indexes on status, schedule_at, and platform for faster job queries.
    """
    __tablename__ = "post_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    clip_key: Mapped[str] = mapped_column(String, nullable=False)  # "{source_path}___{index}"
    video_path: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    hashtags: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array string
    schedule_at: Mapped[float] = mapped_column(Float, nullable=False, index=True)  # unix timestamp
    posted_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(
        String,
        default="pending",
        index=True,
    )  # 'pending' | 'scheduled' | 'posted' | 'failed' | 'cancelled'
    platform: Mapped[str] = mapped_column(String, nullable=False, index=True)
    platform_account_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("platform_accounts.id"),
        nullable=True,
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    post_metadata: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON blob
    created_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())
    updated_at: Mapped[float] = mapped_column(Float, default=lambda: time.time(), onupdate=lambda: time.time())

    account: Mapped[PlatformAccount | None] = relationship(back_populates="post_jobs", lazy="selectin")


# ---------------------------------------------------------------------------
# Video Editor Models (Phase 5)
# ---------------------------------------------------------------------------


class MediaAsset(Base):
    """Uploaded media asset for overlay tracks (images/videos)."""
    __tablename__ = "media_assets"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    original_filename: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    file_size: Mapped[int] = mapped_column(nullable=False)
    mime_type: Mapped[str] = mapped_column(String, nullable=False)
    asset_type: Mapped[str] = mapped_column(String, nullable=False)  # 'image' or 'video'
    width: Mapped[int | None] = mapped_column(nullable=True)
    height: Mapped[int | None] = mapped_column(nullable=True)
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)  # for video assets
    created_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())
    updated_at: Mapped[float] = mapped_column(Float, default=lambda: time.time(), onupdate=lambda: time.time())


class AudioAsset(Base):
    """Uploaded audio asset for BGM/SFX tracks."""
    __tablename__ = "audio_assets"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    original_filename: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    file_size: Mapped[int] = mapped_column(nullable=False)
    duration: Mapped[float] = mapped_column(Float, nullable=False)
    sample_rate: Mapped[int] = mapped_column(nullable=False)
    channels: Mapped[int] = mapped_column(nullable=False)
    created_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())
    updated_at: Mapped[float] = mapped_column(Float, default=lambda: time.time(), onupdate=lambda: time.time())


class Marker(Base):
    """Timeline marker for chapter points and annotations."""
    __tablename__ = "markers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    project_id: Mapped[str | None] = mapped_column(String, nullable=True)  # Optional project association
    time: Mapped[float] = mapped_column(Float, nullable=False)  # Timestamp in video
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)  # Optional duration for range markers
    label: Mapped[str] = mapped_column(String, nullable=False)
    color: Mapped[str] = mapped_column(String, nullable=False)  # Hex color code
    extra_data: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON blob for extra data
    created_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())
    updated_at: Mapped[float] = mapped_column(Float, default=lambda: time.time(), onupdate=lambda: time.time())


# ---------------------------------------------------------------------------
# Authentication & User Models
# ---------------------------------------------------------------------------


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)  # Null for OAuth-only users
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())
    updated_at: Mapped[float] = mapped_column(Float, default=lambda: time.time(), onupdate=lambda: time.time())

    # Relationships
    oauth_accounts: Mapped[list["UserOAuthAccount"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )
    projects: Mapped[list["VideoProject"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan", lazy="selectin"
    )
    teams: Mapped[list["TeamMember"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )
    sent_invites: Mapped[list["TeamInvite"]] = relationship(
        back_populates="inviter", cascade="all, delete-orphan", foreign_keys="TeamInvite.inviter_id", lazy="selectin"
    )
    received_invites: Mapped[list["TeamInvite"]] = relationship(
        back_populates="invitee", cascade="all, delete-orphan", foreign_keys="TeamInvite.invitee_id", lazy="selectin"
    )


class UserOAuthAccount(Base):
    """
    Links OAuth providers to User - replaces PlatformAccount for auth purposes.

    Supports RFC 9700 refresh token rotation with reuse detection.
    """
    __tablename__ = "user_oauth_accounts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False)  # 'google', 'twitch', 'youtube', 'tiktok'
    provider_account_id: Mapped[str] = mapped_column(String, nullable=False)  # Platform's user ID
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    refresh_token_used_at: Mapped[float | None] = mapped_column(Float, nullable=True)  # For RFC 9700 rotation tracking
    created_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())

    user: Mapped[User] = relationship(back_populates="oauth_accounts")

    __table_args__ = (
        UniqueConstraint('provider', 'provider_account_id', name='unique_provider_account'),
    )


# ---------------------------------------------------------------------------
# Team & Collaboration Models
# ---------------------------------------------------------------------------


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    name: Mapped[str] = mapped_column(String, nullable=False)
    owner_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    created_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())
    updated_at: Mapped[float] = mapped_column(Float, default=lambda: time.time(), onupdate=lambda: time.time())

    owner: Mapped[User] = relationship(foreign_keys=[owner_id])
    members: Mapped[list["TeamMember"]] = relationship(
        back_populates="team", cascade="all, delete-orphan", lazy="selectin"
    )
    invites: Mapped[list["TeamInvite"]] = relationship(
        back_populates="team", cascade="all, delete-orphan", lazy="selectin"
    )
    projects: Mapped[list["VideoProject"]] = relationship(
        back_populates="team", cascade="all, delete-orphan", lazy="selectin"
    )


class TeamMember(Base):
    __tablename__ = "team_members"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    team_id: Mapped[str] = mapped_column(String, ForeignKey("teams.id"), nullable=False)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    role: Mapped[str] = mapped_column(String, default="editor")  # 'owner' | 'admin' | 'editor' | 'viewer'
    joined_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())

    team: Mapped[Team] = relationship(back_populates="members", foreign_keys=[team_id])
    user: Mapped[User] = relationship(back_populates="teams", foreign_keys=[user_id])

    __table_args__ = (
        UniqueConstraint('team_id', 'user_id', name='unique_team_member'),
    )


class TeamInvite(Base):
    __tablename__ = "team_invites"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    team_id: Mapped[str] = mapped_column(String, ForeignKey("teams.id"), nullable=False)
    invitee_email: Mapped[str] = mapped_column(String, nullable=False)
    invitee_id: Mapped[str | None] = mapped_column(String, ForeignKey("users.id"), nullable=True)
    inviter_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    role: Mapped[str] = mapped_column(String, default="editor")
    status: Mapped[str] = mapped_column(String, default="pending")  # 'pending' | 'accepted' | 'declined' | 'expired'
    expires_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())

    team: Mapped[Team] = relationship(back_populates="invites", foreign_keys=[team_id])
    invitee: Mapped[User | None] = relationship(back_populates="received_invites", foreign_keys=[invitee_id])
    inviter: Mapped[User] = relationship(back_populates="sent_invites", foreign_keys=[inviter_id])


# ---------------------------------------------------------------------------
# Video Project Models
# ---------------------------------------------------------------------------


class VideoProject(Base):
    """
    Video project with user/team ownership.

    P3 Task #10: Added indexes on owner_id and team_id for faster lookups.
    """
    __tablename__ = "video_projects"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    owner_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    team_id: Mapped[str | None] = mapped_column(String, ForeignKey("teams.id"), nullable=True, index=True)
    source_path: Mapped[str] = mapped_column(String, nullable=False)  # Original file path or URL
    original_source: Mapped[str | None] = mapped_column(String, nullable=True)  # Original URL (YouTube/Twitch/Kick)
    original_filename: Mapped[str] = mapped_column(String, nullable=False)
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(
        String, default="pending", index=True
    )  # pending, loaded, queued, transcribing, transcribed, detecting, completed, rendering, rendered, failed, cancelled
    thumbnail_path: Mapped[str | None] = mapped_column(String, nullable=True)  # path to user-uploaded or auto-generated thumbnail image
    created_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())
    updated_at: Mapped[float] = mapped_column(Float, default=lambda: time.time(), onupdate=lambda: time.time())

    # Relationships
    owner: Mapped[User] = relationship(back_populates="projects", foreign_keys=[owner_id])
    team: Mapped[Team | None] = relationship(back_populates="projects", foreign_keys=[team_id])
    clips: Mapped[list["GeneratedClip"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", lazy="selectin"
    )


class GeneratedClip(Base):
    """
    Generated clip from a video project.

    P3 Task #10: Added index on project_id for faster lookups.
    """
    __tablename__ = "generated_clips"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    project_id: Mapped[str] = mapped_column(String, ForeignKey("video_projects.id"), nullable=False, index=True)
    index: Mapped[int] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    recommendation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    virality_score: Mapped[int | None] = mapped_column(nullable=True)
    brand_alignment: Mapped[str | None] = mapped_column(Text, nullable=True)
    hashtags: Mapped[str | None] = mapped_column(Text, nullable=True)
    render_path: Mapped[str | None] = mapped_column(String, nullable=True)
    crop_avatar: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON CropBox
    crop_game: Mapped[str | None] = mapped_column(Text, nullable=True)    # JSON CropBox
    created_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())
    updated_at: Mapped[float] = mapped_column(Float, default=lambda: time.time(), onupdate=lambda: time.time())

    project: Mapped[VideoProject] = relationship(back_populates="clips")


class Transcript(Base):
    """
    Transcription data for a video project.
    Stores the full transcript with segments and word-level timestamps.
    """
    __tablename__ = "transcripts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    project_id: Mapped[str] = mapped_column(String, ForeignKey("video_projects.id"), nullable=False, index=True)
    source_path: Mapped[str] = mapped_column(String, nullable=False, unique=True)  # Original file path or URL
    language: Mapped[str | None] = mapped_column(String, nullable=True)
    language_probability: Mapped[float | None] = mapped_column(Float, nullable=True)
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    segments: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array of segments with words
    audio_energy: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of per-second audio energy data
    created_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())
    updated_at: Mapped[float] = mapped_column(Float, default=lambda: time.time(), onupdate=lambda: time.time())

    project: Mapped[VideoProject] = relationship(back_populates="transcript")


# Add back-populates to VideoProject for transcript relationship
VideoProject.transcript = relationship(
    "Transcript",
    back_populates="project",
    cascade="all, delete-orphan",
    lazy="selectin",
    uselist=False,
)


# ---------------------------------------------------------------------------
# Pipeline Job Queue Models
# ---------------------------------------------------------------------------


class PipelineJob(Base):
    """Queued pipeline job for automated processing (transcribe → highlights)."""
    __tablename__ = "pipeline_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    project_id: Mapped[str] = mapped_column(
        String, ForeignKey("video_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), nullable=False, index=True
    )
    celery_task_id: Mapped[str | None] = mapped_column(String, nullable=True)
    steps: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array, e.g. ["transcribe", "highlights"]
    current_step: Mapped[int] = mapped_column(default=0)
    status: Mapped[str] = mapped_column(
        String, default="queued", index=True
    )  # queued, running, paused, completed, failed, cancelled
    config: Mapped[str] = mapped_column(Text, nullable=False)  # JSON: whisper_model, llm_model, device, etc.
    step_progress: Mapped[float] = mapped_column(Float, default=0.0)
    step_label: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    failed_step: Mapped[str | None] = mapped_column(String, nullable=True)
    retry_count: Mapped[int] = mapped_column(default=0)
    max_retries: Mapped[int] = mapped_column(default=2)
    priority: Mapped[int] = mapped_column(default=0)
    queued_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())
    started_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    completed_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    auto_advance: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())
    updated_at: Mapped[float] = mapped_column(Float, default=lambda: time.time(), onupdate=lambda: time.time())

    project: Mapped[VideoProject] = relationship()
    pipeline_events: Mapped[list["PipelineEvent"]] = relationship(
        back_populates="job", cascade="all, delete-orphan", lazy="selectin"
    )


class PipelineEvent(Base):
    """Progress event for a pipeline job. Enables catch-up after disconnect."""
    __tablename__ = "pipeline_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    job_id: Mapped[str] = mapped_column(
        String, ForeignKey("pipeline_jobs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String, nullable=False)  # progress, step_start, step_done, error
    step: Mapped[str | None] = mapped_column(String, nullable=True)
    progress: Mapped[float | None] = mapped_column(Float, nullable=True)
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON for structured data
    created_at: Mapped[float] = mapped_column(Float, default=lambda: time.time())

    job: Mapped[PipelineJob] = relationship(back_populates="pipeline_events")
