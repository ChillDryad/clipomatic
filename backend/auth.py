"""
Momiji Clipper — Authentication utilities.

Password hashing with bcrypt, JWT token management, and FastAPI dependency
for getting the current authenticated user.
"""

import os
from datetime import datetime, timedelta

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db import User, get_session

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# CRITICAL: JWT_SECRET must be set via environment variable
# Using a default/weak secret allows attackers to forge JWT tokens (OWASP A01:2021)
SECRET_KEY = os.environ.get("JWT_SECRET")
if not SECRET_KEY:
    raise RuntimeError(
        "JWT_SECRET environment variable is required for security. "
        "Generate a secure key with: python -c 'import secrets; print(secrets.token_urlsafe(32))' "
        "Then set it via: export JWT_SECRET='your-generated-key'"
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 24-hour access token (1440 minutes)
REFRESH_TOKEN_EXPIRE_DAYS = 30      # 30-day refresh token

security = HTTPBearer()


# ---------------------------------------------------------------------------
# OAuth Token Encryption (Fernet/AES-256)
# ---------------------------------------------------------------------------

# OAUTH_ENCRYPTION_KEY must be a 32-byte URL-safe base64-encoded Fernet key
# Generate with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
OAUTH_ENCRYPTION_KEY = os.environ.get("OAUTH_ENCRYPTION_KEY")
if not OAUTH_ENCRYPTION_KEY:
    raise RuntimeError(
        "OAUTH_ENCRYPTION_KEY environment variable is required for security. "
        "Generate a secure key with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())' "
        "Then set it via: export OAUTH_ENCRYPTION_KEY='your-generated-key'"
    )

from cryptography.fernet import Fernet

_fernet = Fernet(OAUTH_ENCRYPTION_KEY.encode())


def encrypt_oauth_token(token: str) -> str:
    """Encrypt OAuth token at rest using Fernet (AES-128-CBC)."""
    return _fernet.encrypt(token.encode()).decode()


def decrypt_oauth_token(encrypted_token: str) -> str:
    """Decrypt OAuth token from database."""
    return _fernet.decrypt(encrypted_token.encode()).decode()


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


def create_access_token(user_id: str, email: str) -> str:
    """Create JWT access token with 24-hour expiry."""
    expires = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": user_id, "email": email, "exp": expires},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def create_refresh_token(user_id: str) -> str:
    """Create JWT refresh token with 30-day expiry."""
    expires = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": user_id, "type": "refresh", "exp": expires},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def decode_refresh_token(token: str) -> dict:
    """Decode and validate refresh token."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")


def decode_access_token(token: str) -> dict:
    """Decode and validate JWT token."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------


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
