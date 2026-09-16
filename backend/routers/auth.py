"""
Momiji Clipper — Authentication router.

Endpoints:
- POST /api/auth/register — Register with email/password
- POST /api/auth/login — Login with email/password
- GET /api/auth/me — Get current user profile
- POST /api/auth/logout — Logout user
- POST /api/auth/refresh — Refresh access token
- GET /api/auth/{provider}/authorize — OAuth provider redirect
- GET /api/auth/{provider}/callback — OAuth callback handler
"""

import re
import time
from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select

from db import User, UserOAuthAccount, get_session_cm
from auth import (
    get_current_user,
    get_current_user_or_api_key,
    hash_password,
    verify_password,
    validate_password_strength,
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    encrypt_oauth_token,
)
from utils.helpers import _user_dict, _set_auth_cookies
from utils.state import _pending_auth_states, _AUTH_STATE_EXPIRY_SECONDS

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


class RegisterRequest(BaseModel):
    email: str
    password: str
    display_name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/register")
async def register(request: Request, req: RegisterRequest, response: Response):
    """
    Register new user with email/password and set HttpOnly cookie.

    Password requirements:
    - Minimum 8 characters
    - Not in top 20 common passwords list
    """
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

    access_token = create_access_token(user.id, user.email)
    refresh_token = create_refresh_token(user.id)
    _set_auth_cookies(response, access_token, refresh_token)
    return {"user": _user_dict(user)}


@router.post("/login")
async def login(request: Request, req: LoginRequest, response: Response):
    """Login with email/password and set HttpOnly cookie."""
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

    access_token = create_access_token(user.id, user.email)
    refresh_token = create_refresh_token(user.id)
    _set_auth_cookies(response, access_token, refresh_token)
    return {"user": _user_dict(user)}


@router.get("/me")
async def get_current_user_profile(user: User = Depends(get_current_user_or_api_key)):
    """Get current authenticated user profile."""
    return {**_user_dict(user), "created_at": user.created_at}


@router.post("/logout")
async def logout(response: Response):
    """Logout user by clearing the HttpOnly cookies."""
    response.delete_cookie(key="access_token", httponly=True, samesite="lax", secure=False, path="/")
    response.delete_cookie(key="refresh_token", httponly=True, samesite="lax", secure=False, path="/")
    return {"success": True}


@router.post("/refresh")
async def refresh_token(
    refresh_cookie: str | None = Cookie(None, alias="refresh_token"),
    response: Response = None,
):
    """Refresh access token using refresh token cookie."""
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

    new_access_token = create_access_token(user.id, user.email)
    new_refresh_token = create_refresh_token(user.id)
    _set_auth_cookies(response, new_access_token, new_refresh_token)
    return {"user": _user_dict(user)}


@router.get("/{provider}/authorize")
async def auth_authorize(provider: str, redirect_uri: str | None = None):
    """
    Redirect to OAuth provider for authentication (Google, Twitch, YouTube).

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

    return RedirectResponse(auth_url)


@router.get("/{provider}/callback")
async def auth_callback(provider: str, code: str = Query(...), state: str = Query(...)):
    """
    Handle OAuth callback from Google / Twitch / YouTube for authentication.

    Creates User + UserOAuthAccount or logs in existing user, then redirects to frontend.
    """
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
        raise HTTPException(status_code=400, detail="PKCE code_verifier not found.")

    try:
        if provider == "google":
            from oauth.google import exchange_google_code
            provider_account_id, email, access_token, refresh_token, expires_at = await exchange_google_code(code, code_verifier)
        elif provider == "twitch":
            from oauth.twitch import exchange_twitch_code
            provider_account_id, email, access_token, refresh_token, expires_at = await exchange_twitch_code(code, code_verifier)
        else:  # youtube
            from oauth.youtube import exchange_youtube_code
            provider_account_id, access_token, refresh_token, expires_at = await exchange_youtube_code(code, code_verifier)
            email = None
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OAuth token exchange failed: {exc}")

    async with get_session_cm() as session:
        # Check if this OAuth account already exists
        result = await session.execute(
            select(UserOAuthAccount).where(
                UserOAuthAccount.provider == provider,
                UserOAuthAccount.provider_account_id == provider_account_id,
            )
        )
        existing_oauth = result.scalar_one_or_none()

        # Encrypt OAuth tokens at rest
        encrypted_access_token = encrypt_oauth_token(access_token)
        encrypted_refresh_token = encrypt_oauth_token(refresh_token) if refresh_token else None

        if existing_oauth:
            # Update tokens and log in
            existing_oauth.access_token = encrypted_access_token
            existing_oauth.refresh_token = encrypted_refresh_token
            existing_oauth.expires_at = expires_at
            await session.commit()

            user = await session.get(User, existing_oauth.user_id)
            if not user or not user.is_active:
                raise HTTPException(status_code=401, detail="User not found or inactive")
        else:
            # Create new user + OAuth account
            if email:
                display_name = email.split("@")[0]
            else:
                email = f"{provider}_{provider_account_id}@oauth.momiji.local"
                display_name = f"{provider.capitalize()} User {provider_account_id[:8]}"

            user = User(email=email, display_name=display_name, is_verified=True)
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

    # Generate JWT and redirect to frontend
    access_token = create_access_token(user.id, user.email)
    refresh_token = create_refresh_token(user.id)

    response = RedirectResponse("/dashboard")
    _set_auth_cookies(response, access_token, refresh_token)
    return response
