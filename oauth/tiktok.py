"""
TikTok OAuth2 helpers with PKCE (RFC 9700).

TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are read from env vars.
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


TIKTOK_CLIENT_KEY = os.environ.get("TIKTOK_CLIENT_KEY", "")
TIKTOK_CLIENT_SECRET = os.environ.get("TIKTOK_CLIENT_SECRET", "")
TIKTOK_REDIRECT_URI = os.environ.get("TIKTOK_OAUTH_REDIRECT_URI", "http://localhost:7860/api/oauth/tiktok/callback")


def build_tiktok_auth_url(state: str, code_challenge: str) -> str:
    from urllib.parse import urlencode
    params = {
        "client_key": TIKTOK_CLIENT_KEY,
        "redirect_uri": TIKTOK_REDIRECT_URI,
        "response_type": "code",
        "scope": "video.upload,user.info.basic",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return "https://www.tiktok.com/v2/auth/authorize?" + urlencode(params)


async def exchange_tiktok_code(code: str, code_verifier: str) -> tuple[str, str, str | None, float | None]:
    """
    Exchange TikTok auth code for tokens.

    Returns (open_id, access_token, refresh_token, expires_in_seconds).
    """
    import time

    import httpx

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://open.tiktokapis.com/v2/oauth/token/",
            data={
                "client_key": TIKTOK_CLIENT_KEY,
                "client_secret": TIKTOK_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": TIKTOK_REDIRECT_URI,
                "code_verifier": code_verifier,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    open_id = data.get("open_id", "")
    access_token = data.get("access_token", "")
    refresh_token = data.get("refresh_token")
    expires_in = data.get("expires_in")  # seconds from now
    expires_at = (time.time() + expires_in) if expires_in else None

    return open_id, access_token, refresh_token, expires_at
