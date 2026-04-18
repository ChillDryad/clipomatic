"""
Google OAuth2 helpers for Google Sign-In (separate from YouTube).

GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are read from env vars.
The redirect URI must match what is registered in the Google Cloud Console.

Implements PKCE (RFC 9700) for enhanced security.
"""

import base64
import hashlib
import os
import secrets

GOOGLE_OAUTH_CLIENT_ID = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:7860/api/auth/google/callback")

# Scope for basic user info (email, profile)
GOOGLE_SIGNIN_SCOPE = "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile"


def generate_pkce_pair() -> tuple[str, str]:
    """Generate PKCE code_verifier and code_challenge (S256 method) per RFC 9700."""
    code_verifier = secrets.token_urlsafe(32)
    code_challenge = base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode()).digest()).rstrip(b'=').decode()
    return code_verifier, code_challenge


def build_google_auth_url(state: str, code_challenge: str) -> str:
    from urllib.parse import urlencode
    params = {
        "client_id": GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": GOOGLE_SIGNIN_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)


async def exchange_google_code(code: str, code_verifier: str) -> tuple[str, str, str, str | None, float | None]:
    """
    Exchange auth code for Google tokens using PKCE.

    Returns (google_user_id, email, access_token, refresh_token, expires_at).
    """
    import asyncio
    import time

    import httpx
    from google.auth.transport.requests import Request as GoogleRequest
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import Flow

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
        scopes=GOOGLE_SIGNIN_SCOPE.split(),
    )
    flow.redirect_uri = GOOGLE_REDIRECT_URI

    # flow.fetch_token is synchronous — run in thread to avoid blocking
    # Include code_verifier for PKCE (RFC 9700)
    credentials = await asyncio.to_thread(flow.fetch_token, code=code, code_verifier=code_verifier)

    creds = Credentials.from_authorized_user_info(credentials, scopes=GOOGLE_SIGNIN_SCOPE.split())

    # creds.refresh is synchronous — wrap in thread
    await asyncio.to_thread(creds.refresh, GoogleRequest())

    # Fetch the user's info from Google userinfo endpoint
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {creds.token}"},
        )
        resp.raise_for_status()
        user_info = resp.json()
        google_user_id = user_info.get("id", "")
        email = user_info.get("email", "")

    expires_at = creds.expiry.timestamp() if creds.expiry else None
    return (
        google_user_id,
        email,
        creds.token,
        creds.refresh_token,
        expires_at,
    )
