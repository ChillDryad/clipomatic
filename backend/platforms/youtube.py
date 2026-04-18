"""
YouTube Data API v3 adapter for uploading YouTube Shorts.

Requires:
  - google-api-python-client
  - google-auth-oauthlib / google-auth
"""

import os
import time
from typing import Any

from platforms.base import PlatformAdapter, register_adapter


@register_adapter
class YouTubeAdapter(PlatformAdapter):
    platform = "youtube"

    async def upload(
        self,
        video_path: str,
        title: str,
        description: str,
        hashtags: list[str],
        metadata: dict[str, Any],
        token: str,
    ) -> str:
        import asyncio
        import httpx
        from google.auth.transport.requests import Request as GoogleRequest
        from google.oauth2.credentials import Credentials
        from googleapiclient.http import MediaFileUpload
        from googleapiclient.discovery import build

        # Rebuild credentials from stored token
        creds = Credentials(
            token=token,
            refresh_token=metadata.get("refresh_token"),
            client_id=os.environ.get("GOOGLE_OAUTH_CLIENT_ID"),
            client_secret=os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET"),
            token_uri="https://oauth2.googleapis.com/token",
            scopes=["https://www.googleapis.com/auth/youtube.upload"],
        )

        if creds.expired:
            await asyncio.to_thread(creds.refresh, GoogleRequest())
            token = creds.token

        youtube = build("youtube", "v3", credentials=creds)

        privacy = metadata.get("privacy_status", "public")
        if privacy not in ("public", "unlisted", "private"):
            privacy = "public"

        body = {
            "snippet": {
                "title": title,
                "description": description + "\n\n" + " ".join(hashtags) + "\n\n#Shorts",
                "tags": [h.lstrip("#") for h in hashtags],
                "categoryId": str(metadata.get("category_id", "22")),  # 22 = People & Blogs
            },
            "status": {
                "privacyStatus": privacy,
                "selfDeclaredMadeForKids": False,
            },
        }

        # YouTube Shorts must be ≤ 3 minutes. The API doesn't enforce this;
        # it's up to the uploader to ensure compliance.
        media = MediaFileUpload(video_path, chunksize=-1, resumable=True)
        request = youtube.videos().insert(
            part="snippet,status",
            body=body,
            media_body=media,
        )

        # Run the actual insert in a thread to avoid blocking
        import asyncio

        async def _run():
            result = await asyncio.to_thread(request.execute)
            return result["id"]

        video_id = await _run()
        return f"https://youtu.be/{video_id}"

    async def refresh_token(self, token_row: Any, access_token: str | None = None) -> dict[str, Any]:
        import asyncio
        from google.auth.transport.requests import Request as GoogleRequest
        from google.oauth2.credentials import Credentials

        # Decrypt tokens if they're encrypted at rest
        from auth import decrypt_oauth_token
        token = access_token if access_token else decrypt_oauth_token(token_row.access_token)
        refresh_token = decrypt_oauth_token(token_row.refresh_token) if token_row.refresh_token else None

        creds = Credentials(
            token=token,
            refresh_token=refresh_token,
            client_id=os.environ.get("GOOGLE_OAUTH_CLIENT_ID"),
            client_secret=os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET"),
            token_uri="https://oauth2.googleapis.com/token",
            scopes=["https://www.googleapis.com/auth/youtube.upload"],
        )
        await asyncio.to_thread(creds.refresh, GoogleRequest())
        return {
            "access_token": creds.token,
            "refresh_token": creds.refresh_token,
            "expires_at": creds.expiry.timestamp() if creds.expiry else None,
        }
