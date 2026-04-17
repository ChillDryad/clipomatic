"""
Momiji Clipper — Database layer.

SQLAlchemy 2.0 async models. Supports two backends:
  - Local dev  : DATABASE_URL=sqlite+aiosqlite:///./momiji.db
  - Production  : DATABASE_URL=postgresql+asyncpg://user:pass@host/db

 Switching requires only changing the DATABASE_URL env var — same models,
 same query code.
"""

import os
import uuid
from typing import AsyncGenerator

from sqlalchemy import Boolean, Float, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# ---------------------------------------------------------------------------
# Engine & session factory
# ---------------------------------------------------------------------------

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "sqlite+aiosqlite:///./momiji.db",  # default: local SQLite
)

_engine = create_async_engine(DATABASE_URL, echo=False)
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
    """Create all tables. Safe to call multiple times (idempotent)."""
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


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
    created_at: Mapped[float] = mapped_column(Float, default=func.now())
    updated_at: Mapped[float] = mapped_column(Float, default=func.now(), onupdate=func.now())

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
    updated_at: Mapped[float] = mapped_column(Float, default=func.now(), onupdate=func.now())

    account: Mapped[PlatformAccount] = relationship(back_populates="tokens")


class PostJob(Base):
    __tablename__ = "post_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    clip_key: Mapped[str] = mapped_column(String, nullable=False)  # "{source_path}___{index}"
    video_path: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    hashtags: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array string
    schedule_at: Mapped[float] = mapped_column(Float, nullable=False)  # unix timestamp
    posted_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(
        String,
        default="pending",
    )  # 'pending' | 'scheduled' | 'posted' | 'failed' | 'cancelled'
    platform: Mapped[str] = mapped_column(String, nullable=False)
    platform_account_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("platform_accounts.id"),
        nullable=True,
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    post_metadata: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON blob
    created_at: Mapped[float] = mapped_column(Float, default=func.now())
    updated_at: Mapped[float] = mapped_column(Float, default=func.now(), onupdate=func.now())

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
    created_at: Mapped[float] = mapped_column(Float, default=func.now())
    updated_at: Mapped[float] = mapped_column(Float, default=func.now(), onupdate=func.now())


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
    created_at: Mapped[float] = mapped_column(Float, default=func.now())
    updated_at: Mapped[float] = mapped_column(Float, default=func.now(), onupdate=func.now())


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
    created_at: Mapped[float] = mapped_column(Float, default=func.now())
    updated_at: Mapped[float] = mapped_column(Float, default=func.now(), onupdate=func.now())


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
    created_at: Mapped[float] = mapped_column(Float, default=func.now())
    updated_at: Mapped[float] = mapped_column(Float, default=func.now(), onupdate=func.now())

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
    """Links OAuth providers to User - replaces PlatformAccount for auth purposes."""
    __tablename__ = "user_oauth_accounts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    provider: Mapped[str] = mapped_column(String, nullable=False)  # 'google', 'twitch', 'youtube', 'tiktok'
    provider_account_id: Mapped[str] = mapped_column(String, nullable=False)  # Platform's user ID
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[float] = mapped_column(Float, default=func.now())

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
    created_at: Mapped[float] = mapped_column(Float, default=func.now())
    updated_at: Mapped[float] = mapped_column(Float, default=func.now(), onupdate=func.now())

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
    joined_at: Mapped[float] = mapped_column(Float, default=func.now())

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
    created_at: Mapped[float] = mapped_column(Float, default=func.now())

    team: Mapped[Team] = relationship(back_populates="invites", foreign_keys=[team_id])
    invitee: Mapped[User | None] = relationship(back_populates="received_invites", foreign_keys=[invitee_id])
    inviter: Mapped[User] = relationship(back_populates="sent_invites", foreign_keys=[inviter_id])


# ---------------------------------------------------------------------------
# Video Project Models
# ---------------------------------------------------------------------------


class VideoProject(Base):
    """Video project with user/team ownership."""
    __tablename__ = "video_projects"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    owner_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    team_id: Mapped[str | None] = mapped_column(String, ForeignKey("teams.id"), nullable=True)
    source_path: Mapped[str] = mapped_column(String, nullable=False)  # Original file path or URL
    original_filename: Mapped[str] = mapped_column(String, nullable=False)
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")  # pending, processing, complete, failed
    created_at: Mapped[float] = mapped_column(Float, default=func.now())
    updated_at: Mapped[float] = mapped_column(Float, default=func.now(), onupdate=func.now())

    # Relationships
    owner: Mapped[User] = relationship(back_populates="projects", foreign_keys=[owner_id])
    team: Mapped[Team | None] = relationship(back_populates="projects", foreign_keys=[team_id])
    clips: Mapped[list["GeneratedClip"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", lazy="selectin"
    )


class GeneratedClip(Base):
    """Generated clip from a video project."""
    __tablename__ = "generated_clips"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    project_id: Mapped[str] = mapped_column(String, ForeignKey("video_projects.id"), nullable=False)
    index: Mapped[int] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    start_time: Mapped[float] = mapped_column(Float, nullable=False)
    end_time: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    virality_score: Mapped[int | None] = mapped_column(nullable=True)
    brand_alignment: Mapped[str | None] = mapped_column(Text, nullable=True)
    hashtags: Mapped[str | None] = mapped_column(Text, nullable=True)
    render_path: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[float] = mapped_column(Float, default=func.now())
    updated_at: Mapped[float] = mapped_column(Float, default=func.now(), onupdate=func.now())

    project: Mapped[VideoProject] = relationship(back_populates="clips")
