"""
Momiji Clipper — Authentication utilities.

Password hashing with bcrypt, JWT token management with RS256 (asymmetric keys),
and FastAPI dependency for getting the current authenticated user.
"""

import os
from datetime import datetime, timedelta, timezone
from typing import TypedDict

import bcrypt
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.backends import default_backend
from fastapi import Cookie, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import User, get_session

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# JWT Configuration - RS256 (asymmetric keys) for enhanced security
# Access token: 24 hours for extended sessions (single-device VTuber app)
# Refresh token: 90 days for persistent login
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 24 hours
REFRESH_TOKEN_EXPIRE_DAYS = 90

# JWT Claims configuration
JWT_ISSUER = os.environ.get("JWT_ISSUER", "momiji-clipper")
JWT_AUDIENCE = os.environ.get("JWT_AUDIENCE", "momiji-frontend")

# RSA Key management - RS256 requires asymmetric key pair
_JWT_PRIVATE_KEY: rsa.RSAPrivateKey | None = None
_JWT_PUBLIC_KEY: rsa.RSAPublicKey | None = None


def _load_or_generate_rsa_keys() -> tuple[rsa.RSAPrivateKey, rsa.RSAPublicKey]:
    """
    Load RSA keys from environment or generate new key pair.

    In production, set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY environment variables
    with PEM-encoded keys. For development, generates a new key pair on startup.

    Returns:
        Tuple of (private_key, public_key)
    """
    global _JWT_PRIVATE_KEY, _JWT_PUBLIC_KEY

    if _JWT_PRIVATE_KEY is not None and _JWT_PUBLIC_KEY is not None:
        return _JWT_PRIVATE_KEY, _JWT_PUBLIC_KEY

    private_key_pem = os.environ.get("JWT_PRIVATE_KEY")
    public_key_pem = os.environ.get("JWT_PUBLIC_KEY")

    if private_key_pem and public_key_pem:
        # Load from environment
        _JWT_PRIVATE_KEY = serialization.load_pem_private_key(
            private_key_pem.encode(),
            password=None,
            backend=default_backend(),
        )
        _JWT_PUBLIC_KEY = serialization.load_pem_public_key(
            public_key_pem.encode(),
            backend=default_backend(),
        )
    else:
        # Persist generated keys in the workspace so cookies survive container restarts.
        from pathlib import Path
        key_dir = Path(os.environ.get("JWT_KEY_DIR", os.path.join(os.environ.get("WORKSPACE_DIR", "/app/workspace"), ".keys")))
        key_dir.mkdir(parents=True, exist_ok=True)
        private_path = key_dir / "jwt-private.pem"
        public_path = key_dir / "jwt-public.pem"
        try:
            os.chmod(key_dir, 0o700)
        except OSError:
            pass
        if private_path.exists() and public_path.exists():
            _JWT_PRIVATE_KEY = serialization.load_pem_private_key(
                private_path.read_bytes(), password=None, backend=default_backend()
            )
            _JWT_PUBLIC_KEY = serialization.load_pem_public_key(
                public_path.read_bytes(), backend=default_backend()
            )
        else:
            private_key = rsa.generate_private_key(
                public_exponent=65537, key_size=2048, backend=default_backend()
            )
            private_pem = private_key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
            public_pem = private_key.public_key().public_bytes(
                serialization.Encoding.PEM,
                serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            for path, content, mode in ((private_path, private_pem, 0o600), (public_path, public_pem, 0o644)):
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
                with os.fdopen(fd, "wb") as handle:
                    handle.write(content)
            _JWT_PRIVATE_KEY = private_key
            _JWT_PUBLIC_KEY = private_key.public_key()

    return _JWT_PRIVATE_KEY, _JWT_PUBLIC_KEY


def get_jwt_private_key() -> rsa.RSAPrivateKey:
    """Get the JWT private key for signing tokens."""
    private_key, _ = _load_or_generate_rsa_keys()
    return private_key


def get_jwt_public_key() -> rsa.RSAPublicKey:
    """Get the JWT public key for verifying tokens."""
    _, public_key = _load_or_generate_rsa_keys()
    return public_key


ALGORITHM = "RS256"
security = HTTPBearer()


# ---------------------------------------------------------------------------
# OAuth Token Encryption (Fernet/AES-256)
# ---------------------------------------------------------------------------

# OAuth and provider credentials share the persistent workspace Fernet key.
# OAUTH_ENCRYPTION_KEY remains an optional migration override for existing installs.
from config_store import decrypt_secret, encrypt_secret


def encrypt_oauth_token(token: str) -> str:
    """Encrypt OAuth token at rest using the persistent Fernet key."""
    return encrypt_secret(token)


def decrypt_oauth_token(encrypted_token: str) -> str:
    """Decrypt OAuth token from database."""
    return decrypt_secret(encrypted_token)


# ---------------------------------------------------------------------------
# Password utilities
# ---------------------------------------------------------------------------

# Common passwords blocklist (top 20 most common)
# Reduced list to avoid blocking reasonable passwords
COMMON_PASSWORDS = {
    "password", "123456", "12345678", "qwerty", "abc123", "monkey", "1234567",
    "letmein", "trustno1", "dragon", "baseball", "iloveyou", "master", "sunshine",
    "ashley", "bailey", "shadow", "123123", "654321", "superman",
}

# Relaxed password length for usability
_MIN_PASSWORD_LENGTH = 8


def validate_password_strength(password: str) -> tuple[bool, str | None]:
    """
    Validate password strength with relaxed requirements for usability.

    Checks:
    - Minimum 8 characters
    - Not in top common passwords list

    Returns:
        (is_valid, error_message or None)
    """
    if len(password) < _MIN_PASSWORD_LENGTH:
        return False, f"Password must be at least {_MIN_PASSWORD_LENGTH} characters"

    if password.lower() in COMMON_PASSWORDS:
        return False, "Password is too common. Please choose a stronger password."

    return True, None


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hash: str) -> bool:
    """Verify password against bcrypt hash."""
    return bcrypt.checkpw(password.encode(), hash.encode())


# ---------------------------------------------------------------------------
# JWT token utilities
# ---------------------------------------------------------------------------

class JWTPayload(TypedDict, total=False):
    """Type definition for JWT token payload."""
    sub: str
    email: str
    exp: float
    iat: float
    iss: str
    aud: str
    type: str


def create_access_token(user_id: str, email: str) -> str:
    """
    Create JWT access token with 15-minute expiry using RS256.

    Args:
        user_id: The user's unique identifier
        email: The user's email address

    Returns:
        Signed JWT access token string

    Claims included:
        - sub: Subject (user ID)
        - email: User's email
        - exp: Expiration time (15 minutes)
        - iat: Issued at time
        - iss: Issuer
        - aud: Audience
    """
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    private_key = get_jwt_private_key()

    payload = {
        "sub": user_id,
        "email": email,
        "exp": expires,
        "iat": now,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
    }
    return jwt.encode(payload, private_key, algorithm=ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    """
    Create JWT refresh token with 30-day expiry using RS256.

    Args:
        user_id: The user's unique identifier

    Returns:
        Signed JWT refresh token string

    Claims included:
        - sub: Subject (user ID)
        - type: "refresh"
        - exp: Expiration time (30 days)
        - iat: Issued at time
        - iss: Issuer
        - aud: Audience
    """
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    private_key = get_jwt_private_key()

    payload = {
        "sub": user_id,
        "type": "refresh",
        "exp": expires,
        "iat": now,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
    }
    return jwt.encode(payload, private_key, algorithm=ALGORITHM)


def decode_refresh_token(token: str) -> dict:
    """
    Decode and validate refresh token with full claims validation.

    Args:
        token: The JWT refresh token string

    Returns:
        Decoded token payload dict

    Raises:
        HTTPException: If token is invalid, expired, or missing required claims
    """
    public_key = get_jwt_public_key()
    try:
        payload = jwt.decode(
            token,
            public_key,
            algorithms=[ALGORITHM],
            issuer=JWT_ISSUER,
            audience=JWT_AUDIENCE,
            options={"require": ["exp", "iat", "sub"]},
        )
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidIssuerError:
        raise HTTPException(status_code=401, detail="Invalid token issuer")
    except jwt.InvalidAudienceError:
        raise HTTPException(status_code=401, detail="Invalid token audience")
    except jwt.MissingRequiredClaimError as exc:
        raise HTTPException(status_code=401, detail=f"Missing required claim: {exc}")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")


def decode_access_token(token: str) -> dict:
    """
    Decode and validate JWT access token with full claims validation.

    Args:
        token: The JWT access token string

    Returns:
        Decoded token payload dict

    Raises:
        HTTPException: If token is invalid, expired, or missing required claims
    """
    public_key = get_jwt_public_key()
    try:
        return jwt.decode(
            token,
            public_key,
            algorithms=[ALGORITHM],
            issuer=JWT_ISSUER,
            audience=JWT_AUDIENCE,
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidIssuerError:
        raise HTTPException(status_code=401, detail="Invalid token issuer")
    except jwt.InvalidAudienceError:
        raise HTTPException(status_code=401, detail="Invalid token audience")
    except jwt.MissingRequiredClaimError as exc:
        raise HTTPException(status_code=401, detail=f"Missing required claim: {exc}")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------


_API_SCOPE_RULES: tuple[tuple[str, set[str]], ...] = (
    ("/api/pipeline/clip-studio", {"pipeline", "clip-studio"}),
    ("/api/api-keys", {"api-keys"}),
    ("/api/api-keys/device-code", {"api-keys"}),  # device code endpoints accept api-keys scope
    ("/api/auth/me", {"agent"}),
    ("/api/models", {"agent"}),
    ("/api/agent", {"agent"}),
    ("/api/thumbnails", {"projects"}),
    ("/api/transcribe", {"transcribe"}),
    ("/api/highlights", {"highlights"}),
    ("/api/pipeline", {"pipeline"}),
    ("/api/projects", {"projects"}),
    ("/api/ingest", {"ingest"}),
    ("/api/clips", {"clips"}),
    ("/api/render", {"render"}),
    ("/api/timeline", {"render"}),
    ("/api/media", {"render"}),
    ("/api/markers", {"render"}),
)


def required_api_key_scopes(path: str) -> set[str]:
    """Return accepted scopes for an API path, denying unknown API routes."""
    normalized = "/" + path.strip("/")
    for prefix, scopes in _API_SCOPE_RULES:
        if normalized == prefix or normalized.startswith(prefix + "/"):
            return set(scopes)
    raise HTTPException(status_code=403, detail="API key access is not allowed for this endpoint")


async def get_current_user(
    access_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_session),
) -> User:
    """Get current authenticated user from JWT cookie."""
    if not access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_access_token(access_token)
    result = await db.execute(select(User).where(User.id == payload["sub"]))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


async def get_current_user_or_api_key(
    request: Request,
    access_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_session),
) -> User:
    """Authenticate via Bearer API key OR fall through to JWT cookie.

    Checks the Authorization header for an API key (mc_live_...).
    If not found, falls back to the existing JWT cookie auth.
    """
    from db import ApiKey
    import json as _json
    import time as _time

    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer mc_live_"):
        raw_key = auth_header.removeprefix("Bearer ").strip()

        # Find all active keys and check the hash.
        # bcrypt doesn't support lookup-by-hash, so we check by prefix
        # first (indexed) then verify with bcrypt.
        key_prefix = raw_key[:12]
        result = await db.execute(
            select(ApiKey).where(
                ApiKey.key_prefix == key_prefix,
                ApiKey.is_active == True,  # noqa: E712
            )
        )
        candidates = result.scalars().all()

        for candidate in candidates:
            if verify_password(raw_key, candidate.key_hash):
                # Check expiry
                if candidate.expires_at and candidate.expires_at < _time.time():
                    raise HTTPException(status_code=401, detail="API key expired")

                # Load the user
                user_result = await db.execute(
                    select(User).where(User.id == candidate.user_id)
                )
                user = user_result.scalar_one_or_none()
                if not user or not user.is_active:
                    raise HTTPException(status_code=401, detail="User not found or inactive")

                # Update last_used_at (fire and forget — don't block the request)
                candidate.last_used_at = _time.time()

                # Scope check is fail-closed and uses explicit path mappings.
                scopes = _json.loads(candidate.scopes) if candidate.scopes else []
                required_scopes = required_api_key_scopes(request.url.path)
                if not required_scopes.intersection(scopes):
                    required = " or ".join(sorted(required_scopes))
                    raise HTTPException(
                        status_code=403,
                        detail=f"API key lacks scope: {required}",
                    )

                request.state.api_key = candidate
                request.state.api_key_scopes = scopes
                return user

        raise HTTPException(status_code=401, detail="Invalid API key")

    # Fall through to JWT cookie auth
    if not access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_access_token(access_token)
    result = await db.execute(select(User).where(User.id == payload["sub"]))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user
