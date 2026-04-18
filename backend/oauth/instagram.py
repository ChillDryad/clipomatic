"""
Instagram / Facebook OAuth2 helpers with PKCE (RFC 9700).

FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, and FACEBOOK_REDIRECT_URI are read from env vars.
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


FACEBOOK_APP_ID = os.environ.get("FACEBOOK_APP_ID", "")
FACEBOOK_APP_SECRET = os.environ.get("FACEBOOK_APP_SECRET", "")
FACEBOOK_REDIRECT_URI = os.environ.get("FACEBOOK_OAUTH_REDIRECT_URI", "http://localhost:7860/api/oauth/instagram/callback")

INSTAGRAM_SCOPES = "instagram_business_basic,instagram_business_content_publish"


def build_instagram_auth_url(state: str, code_challenge: str) -> str:
    from urllib.parse import urlencode
    params = {
        "client_id": FACEBOOK_APP_ID,
        "redirect_uri": FACEBOOK_REDIRECT_URI,
        "scope": INSTAGRAM_SCOPES,
        "response_type": "code",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return "https://www.facebook.com/v18.0/dialog/oauth?" + urlencode(params)


async def exchange_instagram_code(code: str, code_verifier: str) -> tuple[str, str, str | None, float | None]:
    """
    Exchange Facebook auth code for Instagram tokens.

    1. Exchange code for Facebook short-lived access token.
    2. Extend to long-lived (60 days).
    3. Fetch Instagram Business Account ID from the associated Facebook Page.

    Returns (instagram_account_id, access_token, refresh_token, expires_at).
    """
    import time

    import httpx

    # Step 1: Exchange code for short-lived token (with PKCE code_verifier)
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://graph.facebook.com/v18.0/oauth/access_token",
            params={
                "client_id": FACEBOOK_APP_ID,
                "client_secret": FACEBOOK_APP_SECRET,
                "redirect_uri": FACEBOOK_REDIRECT_URI,
                "code": code,
                "grant_type": "authorization_code",
                "code_verifier": code_verifier,
            },
        )
        resp.raise_for_status()
        short_lived = resp.json()
        short_token = short_lived["access_token"]

    # Step 2: Extend to long-lived token
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://graph.facebook.com/v18.0/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": FACEBOOK_APP_ID,
                "client_secret": FACEBOOK_APP_SECRET,
                "fb_exchange_token": short_token,
            },
        )
        resp.raise_for_status()
        long_lived = resp.json()
        access_token = long_lived["access_token"]
        # Long-lived tokens expire in ~60 days; we record that as expires_at
        expires_in = long_lived.get("expires_in", 60 * 24 * 3600)
        expires_at = time.time() + expires_in

    # Step 3: Get Facebook Page linked to this user
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://graph.facebook.com/v18.0/me/accounts",
            params={"access_token": access_token},
        )
        resp.raise_for_status()
        pages = resp.json().get("data", [])
        if not pages:
            raise RuntimeError("No Facebook Pages found for this user.")
        page_access_token = pages[0]["access_token"]
        page_id = pages[0]["id"]

    # Step 4: Get Instagram Business Account ID from the Page
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://graph.facebook.com/v18.0/{page_id}",
            params={
                "fields": "instagram_business_account",
                "access_token": page_access_token,
            },
        )
        resp.raise_for_status()
        instagram_business_id = resp.json().get("instagram_business_account", {}).get("id")
        if not instagram_business_id:
            raise RuntimeError("No Instagram Business account linked to this Facebook Page.")

    return instagram_business_id, access_token, None, expires_at
