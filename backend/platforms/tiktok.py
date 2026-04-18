"""
TikTok Content Posting API adapter.

Requires:
  - httpx (for async HTTP calls)
  - TikTok Content Posting API approval + credentials

Note: TikTok's Content Posting API is gated — access requires approval from TikTok.
"""

import os
import time
from typing import Any

from platforms.base import PlatformAdapter, register_adapter


@register_adapter
class TikTokAdapter(PlatformAdapter):
    platform = "tiktok"

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

        # Assemble caption: title + description + hashtags
        caption = f"{title}\n\n{description}\n\n" + " ".join(hashtags)
        if len(caption) > 2200:
            caption = caption[:2197] + "..."

        # Determine post mode: 'direct' (immediate) or 'schedule' (Inbox upload)
        post_mode = metadata.get("post_mode", "direct")

        async with httpx.AsyncClient(timeout=60.0) as client:
            # Step 1: Initialize upload — get an upload_id
            init_resp = await client.post(
                "https://open.tiktokapis.com/v2/upload/token/",
                json={
                    "upload_token": token,
                    "upload_type": "video",
                    "file_name": os.path.basename(video_path),
                    "file_size": os.path.getsize(video_path),
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            init_resp.raise_for_status()
            init_data = init_resp.json()
            upload_url = init_data.get("upload_url", "")
            upload_id = init_data.get("upload_id", "")

            # Step 2: Upload the video bytes to the TikTok upload URL
            with open(video_path, "rb") as f:
                video_data = f.read()

            upload_resp = await client.post(
                upload_url,
                content=video_data,
                headers={
                    "Content-Type": "video/mp4",
                    "Content-Length": str(len(video_data)),
                },
            )
            upload_resp.raise_for_status()

            # Step 3: Create the video post
            post_payload = {
                "upload_id": upload_id,
                "caption": caption,
                "post_mode": post_mode,
                "visibility": metadata.get("visibility", "public"),
                "brand_content_toggle": False,
                "brand_extension_toggle": False,
                "creation_id": str(int(time.time() * 1000)),
            }

            post_resp = await client.post(
                "https://open.tiktokapis.com/v2/video/submit/",
                json=post_payload,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
            post_resp.raise_for_status()
            post_data = post_resp.json()

        post_id = post_data.get("video_id", "")
        return f"https://www.tiktok.com/@me/video/{post_id}"

    async def refresh_token(self, token_row: Any, access_token: str | None = None) -> dict[str, Any]:
        import httpx

        if not token_row.refresh_token:
            raise RuntimeError("TikTok: No refresh token available.")

        # Decrypt refresh token
        from auth import decrypt_oauth_token
        refresh_token = decrypt_oauth_token(token_row.refresh_token)

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://open.tiktokapis.com/v2/oauth/token/",
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_key": os.environ.get("TIKTOK_CLIENT_KEY"),
                    "client_secret": os.environ.get("TIKTOK_CLIENT_SECRET"),
                },
            )
            resp.raise_for_status()
            data = resp.json()

        return {
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token"),
            "expires_at": time.time() + data.get("expires_in", 0),
        }
