"""
Twitch OAuth2 helpers with PKCE (RFC 9700).

TWITCH_CLIENT_ID and TWITCH_REDIRECT_URI are read from env vars.
Scopes needed: user:read:email (required), channel:read:videos (for VOD listing).
"""

import base64
import hashlib
import os
import secrets


def generate_pkce_pair() -> tuple[str, str]:
    """Generate PKCE code_verifier and code_challenge (S256 method)."""
    code_verifier = secrets.token_urlsafe(32)
    code_challenge = base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode()).digest()).rstrip(b'=').decode()
    return code_verifier, code_challenge


TWITCH_CLIENT_ID = os.environ.get("TWITCH_CLIENT_ID", "")
TWITCH_REDIRECT_URI = os.environ.get("TWITCH_OAUTH_REDIRECT_URI", "http://localhost:7860/api/oauth/twitch/callback")

TWITCH_SCOPES = "user:read:email channel:read:videos"


def build_twitch_auth_url(state: str, code_challenge: str) -> str:
    from urllib.parse import urlencode
    params = {
        "client_id": TWITCH_CLIENT_ID,
        "redirect_uri": TWITCH_REDIRECT_URI,
        "response_type": "code",
        "scope": TWITCH_SCOPES,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return "https://id.twitch.tv/oauth2/authorize?" + urlencode(params)


async def exchange_twitch_code(code: str, code_verifier: str) -> tuple[str, str | None, str, str | None, float | None]:
    """
    Exchange auth code for Twitch tokens.

    Returns (user_id, email, access_token, refresh_token, expires_at_seconds).
    Note: Twitch requires the 'user:read:email' scope to get email, and even then
    email is only available if the user has made it public on Twitch.
    """
    import time

    import httpx

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://id.twitch.tv/oauth2/token",
            data={
                "client_id": TWITCH_CLIENT_ID,
                "client_secret": os.environ.get("TWITCH_CLIENT_SECRET", ""),
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": TWITCH_REDIRECT_URI,
                "code_verifier": code_verifier,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    access_token = data["access_token"]
    refresh_token = data.get("refresh_token")
    expires_in = data.get("expires_in", 0)  # seconds
    expires_at = time.time() + expires_in if expires_in else None

    # Fetch the authenticated user's info from Helix API
    async with httpx.AsyncClient() as client:
        user_resp = await client.get(
            "https://api.twitch.tv/helix/users",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Client-Id": TWITCH_CLIENT_ID,
            },
        )
        user_resp.raise_for_status()
        user_data = user_resp.json()
        user_info = user_data["data"][0] if user_data.get("data") else {}
        user_id = user_info.get("id", "")
        email = user_info.get("email", None)  # Only available if user made it public

    return user_id, email, access_token, refresh_token, expires_at


async def refresh_twitch_token(refresh_token: str) -> tuple[str, float | None]:
    """Refresh an expired Twitch access token. Returns (new_access_token, new_expires_at)."""
    import time

    import httpx

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://id.twitch.tv/oauth2/token",
            data={
                "client_id": TWITCH_CLIENT_ID,
                "client_secret": os.environ.get("TWITCH_CLIENT_SECRET", ""),
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    expires_in = data.get("expires_in", 0)
    expires_at = time.time() + expires_in if expires_in else None
    return data["access_token"], expires_at


async def get_user_vods(
    access_token: str,
    user_id: str,
    limit: int = 20,
) -> list[dict]:
    """
    Fetch a user's VODs (past broadcasts + uploads) via Helix API.

    Returns a list of VOD objects with id, title, thumbnail_url, duration, view_count, created_at.
    """
    import httpx

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            "https://api.twitch.tv/helix/videos",
            params={"user_id": user_id, "first": limit, "sort": "time", "type": "all"},
            headers={
                "Authorization": f"Bearer {access_token}",
                "Client-Id": TWITCH_CLIENT_ID,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    return data.get("data", [])
