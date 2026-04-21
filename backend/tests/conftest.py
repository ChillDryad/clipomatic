"""
Pytest fixtures for Momiji Clipper tests.

Provides:
- Temporary workspace directories
- Mock FFmpeg/ffprobe subprocess calls
- Mock HTTP clients (httpx, openai)
- Test database sessions
- Sample data fixtures (transcripts, clips)
- Authentication helpers
"""

import os
import sys

# Ensure backend root is on sys.path for bare module imports (api, db, auth, etc.)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio
import base64
import hashlib
import json
import secrets
import shutil
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

# Optional imports - tests requiring these will skip if not available
try:
    import jwt
    JWT_AVAILABLE = True
except ImportError:
    JWT_AVAILABLE = False

try:
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    SQLALCHEMY_AVAILABLE = True
except ImportError:
    SQLALCHEMY_AVAILABLE = False

# Test directory
TEST_DIR = Path(__file__).parent
FIXTURES_DIR = TEST_DIR / "fixtures"


# ---------------------------------------------------------------------------
# Temporary Workspace
# ---------------------------------------------------------------------------


@pytest.fixture
def temp_workspace():
    """Create a temporary workspace directory for file operations."""
    workspace = tempfile.mkdtemp(prefix="momiji_test_workspace_")
    try:
        yield workspace
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


@pytest.fixture
def temp_file(temp_workspace):
    """Create a temporary file in the workspace."""
    def _create_file(name="test.txt", content=b"test content"):
        path = os.path.join(temp_workspace, name)
        with open(path, "wb") as f:
            f.write(content)
        return path
    return _create_file


# ---------------------------------------------------------------------------
# Mock FFmpeg/ffprobe
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_ffprobe_video_dimensions():
    """Mock ffprobe returning video dimensions."""
    def _mock(width=1920, height=1080):
        def _run(*args, capture_output=True, text=True, **kwargs):
            result = MagicMock()
            result.returncode = 0
            result.stdout = json.dumps({
                "streams": [{"width": width, "height": height}]
            })
            result.stderr = ""
            return result
        return _run
    return _mock


@pytest.fixture
def mock_ffprobe_audio_info():
    """Mock ffprobe returning audio info."""
    def _mock(duration=60.0, sample_rate=44100, channels=2):
        def _run(*args, capture_output=True, text=True, **kwargs):
            result = MagicMock()
            result.returncode = 0
            result.stdout = json.dumps({
                "streams": [{
                    "codec_type": "audio",
                    "sample_rate": str(sample_rate),
                    "channels": channels,
                    "duration": str(duration)
                }],
                "format": {"duration": str(duration)}
            })
            result.stderr = ""
            return result
        return _run
    return _mock


@pytest.fixture
def mock_ffmpeg_success():
    """Mock successful FFmpeg subprocess call."""
    def _run(*args, capture_output=True, text=True, **kwargs):
        result = MagicMock()
        result.returncode = 0
        result.stdout = ""
        result.stderr = "Conversion complete"
        return result
    return _run


@pytest.fixture
def mock_ffmpeg_failure():
    """Mock failed FFmpeg subprocess call."""
    def _run(*args, capture_output=True, text=True, **kwargs):
        result = MagicMock()
        result.returncode = 1
        result.stdout = ""
        result.stderr = "FFmpeg error: invalid input"
        return result
    return _run


# ---------------------------------------------------------------------------
# Mock HTTP Clients
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_httpx_async_client():
    """Mock httpx.AsyncClient for testing OAuth and API calls."""
    with patch("httpx.AsyncClient") as mock_class:
        mock_client = MagicMock()

        async def async_mock(*args, **kwargs):
            return mock_client

        mock_class.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_class.return_value.__aexit__ = AsyncMock(return_value=None)

        yield mock_client


@pytest.fixture
def mock_httpx_get_success():
    """Fixture to mock successful httpx GET requests."""
    def _mock(url_pattern, response_data, status_code=200):
        async def mock_get(url, **kwargs):
            if url_pattern in url:
                response = MagicMock()
                response.status_code = status_code
                response.raise_for_status = MagicMock()
                response.json = MagicMock(return_value=response_data)
                response.text = json.dumps(response_data)
                return response
            raise ValueError(f"Unexpected URL: {url}")
        return mock_get
    return _mock


@pytest.fixture
def mock_httpx_post_success():
    """Fixture to mock successful httpx POST requests."""
    def _mock(url_pattern, response_data, status_code=200):
        async def mock_post(url, **kwargs):
            if url_pattern in url:
                response = MagicMock()
                response.status_code = status_code
                response.raise_for_status = MagicMock()
                response.json = MagicMock(return_value=response_data)
                return response
            raise ValueError(f"Unexpected URL: {url}")
        return mock_post
    return _mock


# ---------------------------------------------------------------------------
# Mock OpenAI Client
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_openai_client():
    """Mock OpenAI client for highlight detection tests."""
    with patch("openai.OpenAI") as mock_class:
        mock_client = MagicMock()

        # Mock chat completions
        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.content = json.dumps([
            {
                "title": "Test Clip",
                "start": 10.0,
                "end": 40.0,
                "reason": "Test reason",
                "virality_score": 85,
                "brand_alignment": ["test pillar"],
                "hashtags": ["#Test"]
            }
        ])
        mock_client.chat.completions.create = MagicMock(return_value=mock_completion)

        mock_class.return_value = mock_client
        yield mock_client


# ---------------------------------------------------------------------------
# Sample Data Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_transcript():
    """Sample transcript data for testing."""
    return {
        "language": "en",
        "language_probability": 0.99,
        "duration": 120.5,
        "segments": [
            {
                "start": 0.0,
                "end": 5.2,
                "text": "Hello everyone, welcome to the stream!",
                "words": [
                    {"word": "Hello", "start": 0.0, "end": 0.5, "probability": 0.99},
                    {"word": "everyone,", "start": 0.5, "end": 1.2, "probability": 0.98},
                    {"word": "welcome", "start": 1.2, "end": 1.8, "probability": 0.97},
                    {"word": "to", "start": 1.8, "end": 2.0, "probability": 0.99},
                    {"word": "the", "start": 2.0, "end": 2.2, "probability": 0.99},
                    {"word": "stream!", "start": 2.2, "end": 3.0, "probability": 0.95}
                ]
            },
            {
                "start": 10.0,
                "end": 18.5,
                "text": "Oh my god, I can't believe this is happening!",
                "words": [
                    {"word": "Oh", "start": 10.0, "end": 10.2, "probability": 0.99},
                    {"word": "my", "start": 10.2, "end": 10.4, "probability": 0.99},
                    {"word": "god,", "start": 10.4, "end": 10.8, "probability": 0.98},
                    {"word": "I", "start": 11.0, "end": 11.1, "probability": 0.99},
                    {"word": "can't", "start": 11.1, "end": 11.4, "probability": 0.97},
                    {"word": "believe", "start": 11.4, "end": 11.8, "probability": 0.96},
                    {"word": "this", "start": 11.8, "end": 12.0, "probability": 0.99},
                    {"word": "is", "start": 12.0, "end": 12.2, "probability": 0.99},
                    {"word": "happening!", "start": 12.2, "end": 13.0, "probability": 0.94}
                ]
            },
            {
                "start": 60.0,
                "end": 72.3,
                "text": "This is the coziest gaming session ever. Just me, my chat, and some wholesome vibes.",
                "words": [
                    {"word": "This", "start": 60.0, "end": 60.2, "probability": 0.99},
                    {"word": "is", "start": 60.2, "end": 60.4, "probability": 0.99},
                    {"word": "the", "start": 60.4, "end": 60.6, "probability": 0.99},
                    {"word": "coziest", "start": 60.6, "end": 61.2, "probability": 0.95},
                    {"word": "gaming", "start": 61.2, "end": 61.8, "probability": 0.97},
                    {"word": "session", "start": 61.8, "end": 62.4, "probability": 0.96},
                    {"word": "ever.", "start": 62.4, "end": 63.0, "probability": 0.98}
                ]
            }
        ]
    }


@pytest.fixture
def sample_clip():
    """Sample clip data for testing."""
    return {
        "title": "She absolutely lost it",
        "start": 125.0,
        "end": 192.0,
        "reason": "Peak emotional outburst with perfect timing",
        "virality_score": 91,
        "brand_alignment": ["gap moe / sudden gaming rage"],
        "hashtags": ["#VTuber", "#GapMoe", "#GamingRage"]
    }


@pytest.fixture
def sample_clips_list():
    """Sample list of detected clips."""
    return [
        {
            "title": "Unexpected gaming rage moment",
            "start": 125.0,
            "end": 192.0,
            "reason": "Peak emotional outburst",
            "virality_score": 91,
            "brand_alignment": ["gap moe / sudden gaming rage"],
            "hashtags": ["#VTuber", "#GapMoe", "#GamingRage"]
        },
        {
            "title": "Wholesome chat interaction",
            "start": 300.0,
            "end": 345.0,
            "reason": "Heartwarming moment with viewers",
            "virality_score": 78,
            "brand_alignment": ["cozy big sister energy"],
            "hashtags": ["#VTuber", "#Wholesome", "#Chat"]
        }
    ]


@pytest.fixture
def sample_ass_subtitle():
    """Sample ASS subtitle content."""
    return """[Script Info]
Title: Test Subtitles
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.20,Default,,0,0,0,,{\\pos(960,980)}Hello everyone, welcome to the stream!
Dialogue: 0,0:00:10.00,0:00:18.50,Default,,0,0,0,,{\\pos(960,980)}Oh my god, I can't believe this is happening!
"""


# ---------------------------------------------------------------------------
# Authentication Helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def test_jwt_keys():
    """Generate test RSA key pair for JWT RS256 testing."""
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.backends import default_backend
    except ImportError:
        pytest.skip("cryptography not available")

    # Generate RSA key pair
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
        backend=default_backend(),
    )
    public_key = private_key.public_key()

    # Serialize to PEM format
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()

    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()

    return {"private": private_pem, "public": public_pem}


@pytest.fixture
def test_oauth_encryption_key():
    """Generate a test Fernet encryption key."""
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()


@pytest.fixture
def auth_tokens(test_jwt_keys):
    """Generate test JWT tokens for authentication testing using RS256."""
    if not JWT_AVAILABLE:
        pytest.skip("PyJWT not available")

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.backends import default_backend

    user_id = "test-user-123"
    email = "test@example.com"

    # Load private key for signing
    private_key = serialization.load_pem_private_key(
        test_jwt_keys["private"].encode(),
        password=None,
        backend=default_backend(),
    )

    # Access token (15 minutes)
    access_payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
        "iat": datetime.now(timezone.utc),
        "iss": "momiji-clipper",
        "aud": "momiji-frontend",
    }
    access_token = jwt.encode(access_payload, private_key, algorithm="RS256")

    # Refresh token (30 days)
    refresh_payload = {
        "sub": user_id,
        "type": "refresh",
        "exp": datetime.now(timezone.utc) + timedelta(days=30),
        "iat": datetime.now(timezone.utc),
        "iss": "momiji-clipper",
        "aud": "momiji-frontend",
    }
    refresh_token = jwt.encode(refresh_payload, private_key, algorithm="RS256")

    # Expired token
    expired_payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) - timedelta(minutes=5),
        "iat": datetime.now(timezone.utc) - timedelta(minutes=20),
        "iss": "momiji-clipper",
        "aud": "momiji-frontend",
    }
    expired_token = jwt.encode(expired_payload, private_key, algorithm="RS256")

    return {
        "access": access_token,
        "refresh": refresh_token,
        "expired": expired_token,
        "user_id": user_id,
        "email": email
    }


@pytest.fixture
def valid_password():
    """Return a valid password that passes NIST requirements."""
    return "SecureP@ssw0rd123!"


@pytest.fixture
def common_passwords():
    """List of common passwords for testing."""
    return {
        "password", "123456", "12345678", "qwerty", "abc123", "monkey", "1234567",
        "letmein", "trustno1", "dragon", "baseball", "iloveyou", "master", "sunshine",
        "ashley", "bailey", "passw0rd", "shadow", "123123", "654321", "superman",
        "qazwsx", "michael", "football", "password1", "password123", "welcome",
    }


# ---------------------------------------------------------------------------
# PKCE Helpers for OAuth Tests
# ---------------------------------------------------------------------------


@pytest.fixture
def pkce_pair():
    """Generate a PKCE code verifier/challenge pair."""
    code_verifier = secrets.token_urlsafe(32)
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).rstrip(b'=').decode()
    return {"verifier": code_verifier, "challenge": code_challenge}


# ---------------------------------------------------------------------------
# Crop Box Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_crop_avatar():
    """Sample avatar crop box."""
    return {"x": 100, "y": 50, "w": 400, "h": 400}


@pytest.fixture
def sample_crop_game():
    """Sample gameplay crop box."""
    return {"x": 500, "y": 100, "w": 800, "h": 450}


# ---------------------------------------------------------------------------
# Database Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def test_db_engine():
    """Create an in-memory SQLite database for testing."""
    if not SQLALCHEMY_AVAILABLE:
        pytest.skip("SQLAlchemy not available")
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
        future=True,
    )
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def test_db_session(test_db_engine):
    """Create an async session factory for testing."""
    if not SQLALCHEMY_AVAILABLE:
        pytest.skip("SQLAlchemy not available")
    async_session_factory = async_sessionmaker(
        test_db_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    yield async_session_factory


@pytest_asyncio.fixture
async def initialized_db(test_db_engine):
    """Initialize database tables."""
    if not SQLALCHEMY_AVAILABLE:
        pytest.skip("SQLAlchemy not available")
    from db import Base
    async with test_db_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield test_db_engine


@pytest_asyncio.fixture
async def db_session(initialized_db):
    """Yield a database session with automatic rollback."""
    if not SQLALCHEMY_AVAILABLE:
        pytest.skip("SQLAlchemy not available")
    async_session_factory = async_sessionmaker(
        initialized_db,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with async_session_factory() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def test_user(db_session):
    """Create a test user in the database."""
    if not SQLALCHEMY_AVAILABLE:
        pytest.skip("SQLAlchemy not available")
    from db import User
    from auth import hash_password

    user = User(
        email="test@example.com",
        password_hash=hash_password("SecureP@ssw0rd123!"),
        display_name="Test User",
        is_active=True,
        is_verified=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


# ---------------------------------------------------------------------------
# API Test Client
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def api_client(test_jwt_keys, test_oauth_encryption_key):
    """Create a test client for the FastAPI app.

    Sets up test environment variables and uses httpx AsyncClient
    with ASGITransport for direct FastAPI app testing (no network).
    """
    if not SQLALCHEMY_AVAILABLE:
        pytest.skip("SQLAlchemy not available - install with: pip install sqlalchemy aiosqlite")

    try:
        from httpx import AsyncClient, ASGITransport
    except ImportError:
        pytest.skip("httpx not available - install with: pip install httpx")

    # Set test environment variables for RS256 JWT
    old_jwt_private = os.environ.get("JWT_PRIVATE_KEY")
    old_jwt_public = os.environ.get("JWT_PUBLIC_KEY")
    old_oauth = os.environ.get("OAUTH_ENCRYPTION_KEY")

    os.environ["JWT_PRIVATE_KEY"] = test_jwt_keys["private"]
    os.environ["JWT_PUBLIC_KEY"] = test_jwt_keys["public"]
    os.environ["OAUTH_ENCRYPTION_KEY"] = test_oauth_encryption_key

    # Import app after env vars are set (avoids RuntimeError on import)
    # Need to reload api module if already imported
    import importlib
    if "api" in sys.modules:
        importlib.reload(sys.modules["api"])
    from api import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        try:
            yield client
        finally:
            # Restore original env vars
            if old_jwt_private:
                os.environ["JWT_PRIVATE_KEY"] = old_jwt_private
            elif "JWT_PRIVATE_KEY" in os.environ:
                del os.environ["JWT_PRIVATE_KEY"]

            if old_jwt_public:
                os.environ["JWT_PUBLIC_KEY"] = old_jwt_public
            elif "JWT_PUBLIC_KEY" in os.environ:
                del os.environ["JWT_PUBLIC_KEY"]

            if old_oauth:
                os.environ["OAUTH_ENCRYPTION_KEY"] = old_oauth
            elif "OAUTH_ENCRYPTION_KEY" in os.environ:
                del os.environ["OAUTH_ENCRYPTION_KEY"]


# ---------------------------------------------------------------------------
# Video/Media Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_video_frame():
    """Generate a simple test video frame (1x1 pixel)."""
    # This would be a small numpy array representing a frame
    import numpy as np
    return np.zeros((1080, 1920, 3), dtype=np.uint8)


@pytest.fixture
def sample_waveform_data():
    """Sample waveform data for audio visualization."""
    return {
        "duration": 60.0,
        "sample_rate": 44100,
        "channels": 2,
        "peaks": [0.5, 0.7, 0.3, 0.9, 0.2, 0.8, 0.4, 0.6] * 125,  # 1000 points
        "rms": [0.3, 0.5, 0.2, 0.7, 0.1, 0.6, 0.3, 0.4] * 125,
        "num_points": 1000
    }


# ---------------------------------------------------------------------------
# Marker Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_marker():
    """Sample timeline marker."""
    return {
        "time": 30.5,
        "duration": 5.0,
        "label": "Key moment",
        "color": "#FF5733",
        "extra_data": json.dumps({"notes": "Important highlight"})
    }


# ---------------------------------------------------------------------------
# Team/Project Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def test_team(db_session, test_user):
    """Create a test team."""
    from db import Team

    team = Team(
        name="Test Team",
        owner_id=test_user.id,
    )
    db_session.add(team)
    await db_session.commit()
    await db_session.refresh(team)
    return team


@pytest_asyncio.fixture
async def test_project(db_session, test_user):
    """Create a test video project."""
    from db import VideoProject

    project = VideoProject(
        owner_id=test_user.id,
        source_path="/app/workspace/test_video.mp4",
        original_filename="test_video.mp4",
        duration=300.0,
        status="pending",
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    return project
