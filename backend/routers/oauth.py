"""
Momiji Clipper — Platform OAuth router.

Endpoints for connecting YouTube, TikTok, and Instagram accounts for posting.

Endpoints:
- GET /api/oauth/{platform}/authorize — Start OAuth flow
- GET /api/oauth/{platform}/callback — OAuth callback
- GET /api/oauth/{platform}/accounts — List connected accounts
- DELETE /api/oauth/{platform}/accounts/{account_id} — Disconnect account
- GET /api/oauth/twitch/authorize — Twitch OAuth (for VOD access)
- GET /api/oauth/twitch/callback — Twitch callback
"""

import time
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select

from db import User, UserOAuthAccount, get_session_cm
from auth import get_current_user, encrypt_oauth_token, create_access_token, create_refresh_token
from utils.helpers import _user_dict, _set_auth_cookies
from utils.state import _pending_oauth_states, _OAUTH_STATE_EXPIRY_SECONDS

router = APIRouter(prefix="/api/oauth", tags=["Platform OAuth"])


@router.get("/{platform}/authorize")
async def oauth_authorize(platform: str, label: str = Query(...), redirect_uri: str | None = Query(None)):
    """
    Redirect to the platform's OAuth authorization URL.

    Implements PKCE (RFC 9700) for all providers.
    """
    import secrets

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

    return RedirectResponse(auth_url)


@router.get("/{platform}/callback")
async def oauth_callback(platform: str, code: str = Query(...), state: str = Query(...)):
    """
    Handle the OAuth2 callback from YouTube / TikTok / Instagram.

    Creates User + UserOAuthAccount or updates existing OAuth account.
    """
    if platform not in ("youtube", "tiktok", "instagram"):
        raise HTTPException(status_code=400, detail="Unsupported platform.")

    state_data = _pending_oauth_states.pop(state, None)
    if not state_data:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state.")

    if state_data.get("expires_at") and time.time() > state_data["expires_at"]:
        raise HTTPException(status_code=400, detail="OAuth state has expired.")

    if state_data["platform"] != platform:
        raise HTTPException(status_code=400, detail="Platform mismatch in OAuth state.")

    code_verifier = state_data.get("code_verifier")
    if not code_verifier:
        raise HTTPException(status_code=400, detail="PKCE code_verifier not found.")

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

    async with get_session_cm() as session:
        result = await session.execute(
            select(UserOAuthAccount).where(
                UserOAuthAccount.provider == platform,
                UserOAuthAccount.provider_account_id == provider_account_id,
            )
        )
        existing_oauth = result.scalar_one_or_none()

        encrypted_access_token = encrypt_oauth_token(access_token)
        encrypted_refresh_token = encrypt_oauth_token(refresh_token) if refresh_token else None

        if existing_oauth:
            existing_oauth.access_token = encrypted_access_token
            existing_oauth.refresh_token = encrypted_refresh_token
            existing_oauth.expires_at = expires_at
            await session.commit()
            user_id = existing_oauth.user_id
        else:
            display_name = state_data.get("label", f"{platform.capitalize()} User {provider_account_id[:8]}")
            user = User(
                email=f"{platform}_{provider_account_id}@oauth.momiji.local",
                display_name=display_name,
                is_verified=True,
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

    token = create_access_token(user.id, user.email)
    refresh_token_val = create_refresh_token(user.id)
    response = RedirectResponse("/dashboard")
    _set_auth_cookies(response, token, refresh_token_val)
    return response


@router.get("/{platform}/accounts")
async def list_oauth_accounts(platform: str):
    """List all OAuth accounts for a platform."""
    if platform not in ("youtube", "tiktok", "instagram"):
        raise HTTPException(status_code=400, detail="Unsupported platform.")

    async with get_session_cm() as session:
        result = await session.execute(
            select(UserOAuthAccount).where(UserOAuthAccount.provider == platform)
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


@router.delete("/{platform}/accounts/{account_id}")
async def delete_oauth_account(platform: str, account_id: str):
    """Delete a UserOAuthAccount record."""
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

    return {"success": True}


# Twitch-specific OAuth for VOD access (separate from auth flow)
@router.get("/twitch/authorize")
async def oauth_twitch_authorize(label: str = Query(...)):
    """Redirect to Twitch OAuth authorization URL with PKCE."""
    import secrets

    state = secrets.token_hex(16)
    from oauth.twitch import generate_pkce_pair, build_twitch_auth_url
    code_verifier, code_challenge = generate_pkce_pair()

    _pending_oauth_states[state] = {
        "platform": "twitch",
        "label": label,
        "code_verifier": code_verifier,
        "expires_at": time.time() + _OAUTH_STATE_EXPIRY_SECONDS,
    }

    auth_url = build_twitch_auth_url(state, code_challenge)
    return {"auth_url": auth_url}


@router.get("/twitch/callback")
async def oauth_twitch_callback(code: str = Query(...), state: str = Query(...)):
    """Handle Twitch OAuth callback."""
    state_data = _pending_oauth_states.pop(state, None)
    if not state_data:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state.")

    if state_data.get("expires_at") and time.time() > state_data["expires_at"]:
        raise HTTPException(status_code=400, detail="OAuth state has expired.")

    if state_data["platform"] != "twitch":
        raise HTTPException(status_code=400, detail="Platform mismatch.")

    code_verifier = state_data.get("code_verifier")
    if not code_verifier:
        raise HTTPException(status_code=400, detail="PKCE code_verifier not found.")

    try:
        from oauth.twitch import exchange_twitch_code
        provider_account_id, email, access_token, refresh_token, expires_at = await exchange_twitch_code(code, code_verifier)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Twitch token exchange failed: {exc}")

    async with get_session_cm() as session:
        result = await session.execute(
            select(UserOAuthAccount).where(
                UserOAuthAccount.provider == "twitch",
                UserOAuthAccount.provider_account_id == provider_account_id,
            )
        )
        existing_oauth = result.scalar_one_or_none()

        encrypted_access_token = encrypt_oauth_token(access_token)
        encrypted_refresh_token = encrypt_oauth_token(refresh_token) if refresh_token else None

        if existing_oauth:
            existing_oauth.access_token = encrypted_access_token
            existing_oauth.refresh_token = encrypted_refresh_token
            existing_oauth.expires_at = expires_at
            await session.commit()
            user_id = existing_oauth.user_id
        else:
            display_name = state_data.get("label", f"Twitch User {provider_account_id[:8]}")
            user = User(
                email=f"twitch_{provider_account_id}@oauth.momiji.local",
                display_name=display_name,
                is_verified=True,
            )
            session.add(user)
            await session.flush()
            user_id = user.id

            oauth_account = UserOAuthAccount(
                user_id=user.id,
                provider="twitch",
                provider_account_id=provider_account_id,
                access_token=encrypted_access_token,
                refresh_token=encrypted_refresh_token,
                expires_at=expires_at,
            )
            session.add(oauth_account)
            await session.commit()

    token = create_access_token(user.id, user.email)
    refresh_token_val = create_refresh_token(user.id)
    response = RedirectResponse("/dashboard")
    _set_auth_cookies(response, token, refresh_token_val)
    return response


