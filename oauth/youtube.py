"""
YouTube OAuth2 helpers with PKCE (RFC 9700).

GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are read from env vars.
The redirect URI must match what is registered in the Google Cloud Console.
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


GOOGLE_OAUTH_CLIENT_ID = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:7860/api/oauth/youtube/callback")

YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload"


def build_youtube_auth_url(state: str, code_challenge: str) -> str:
    from urllib.parse import urlencode
    params = {
        "client_id": GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": YOUTUBE_UPLOAD_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)


async def exchange_youtube_code(code: str, code_verifier: str) -> tuple[str, str, str | None, float | None]:
    """
    Exchange auth code for YouTube tokens.

    Returns (channel_id, access_token, refresh_token, expires_at).
    """
    import asyncio
    import time

    import httpx
    from google.auth.transport.requests import Request as GoogleRequest
    from google.oauth2.credentials import Credentials
    from google_auth_oauth2.flow import Flow

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": GOOGLE_OAUTH_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [GOOGLE_REDIRECT_URI],
            }
        },
        scopes=[YOUTUBE_UPLOAD_SCOPE],
    )
    flow.redirect_uri = GOOGLE_REDIRECT_URI

    # flow.fetch_token is synchronous — run in thread to avoid blocking
    # Include code_verifier for PKCE
    credentials = await asyncio.to_thread(flow.fetch_token, code=code, code_verifier=code_verifier)

    creds = Credentials.from_authorized_user_info(credentials, scopes=[YOUTUBE_UPLOAD_SCOPE])

    # creds.refresh is synchronous — wrap in thread
    await asyncio.to_thread(creds.refresh, GoogleRequest())

    # Fetch the user's YouTube channel ID
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://www.googleapis.com/youtube/v3/channels",
            params={"part": "id", "mine": "true"},
            headers={"Authorization": f"Bearer {creds.token}"},
        )
        resp.raise_for_status()
        channel_id = resp.json()["items"][0]["id"]

    expires_at = creds.expiry.timestamp() if creds.expiry else None
    return (
        channel_id,
        creds.token,
        creds.refresh_token,
        expires_at,
    )
