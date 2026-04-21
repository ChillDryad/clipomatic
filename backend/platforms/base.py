"""
Platform adapter base class.

Implements RFC 9700 refresh token rotation with reuse detection.
"""

import logging
import time
from abc import ABC, abstractmethod
from typing import Any

logger = logging.getLogger(__name__)


class PlatformAdapter(ABC):
    @property
    @abstractmethod
    def platform(self) -> str:
        """Platform identifier: 'youtube' | 'tiktok' | 'instagram'."""

    @abstractmethod
    async def upload(
        self,
        video_path: str,
        title: str,
        description: str,
        hashtags: list[str],
        metadata: dict[str, Any],
        token: str,
    ) -> str:
        """
        Upload a video file to the platform.

        Args:
            video_path: Absolute path to the rendered MP4 file.
            title: Post title.
            description: Post description/caption.
            hashtags: List of hashtag strings to append.
            metadata: Platform-specific metadata (e.g. privacy_status for YouTube).
            token: Valid OAuth2 access token.

        Returns:
            The public URL / post ID of the published post.
        """

    @abstractmethod
    async def refresh_token(self, token_row: Any, access_token: str | None = None) -> dict[str, Any]:
        """
        Refresh an expired OAuth2 token.

        Args:
            token_row: The OAuthToken model row (contains access_token, refresh_token, expires_at).
            access_token: Optional already-decrypted access token.

        Returns:
            A dict with new access_token (and optionally new refresh_token and expires_at).
        """

    async def _refresh_oauth_token(
        self,
        token_row: Any,
        session: Any,
        access_token: str | None = None,
    ) -> dict[str, Any]:
        """
        Refresh OAuth token with RFC 9700 rotation and reuse detection.

        RFC 9700 requires:
        1. Rotating refresh tokens on each use
        2. Tracking when each refresh token was used
        3. Revoking the entire token family if reuse is detected

        Args:
            token_row: OAuthToken or UserOAuthAccount row
            session: Database session for committing updates
            access_token: Optional already-decrypted access token

        Returns:
            New token dict with access_token, refresh_token, expires_at

        Raises:
            RuntimeError: If refresh token reuse detected (entire family revoked)
        """
        import math

        # Decrypt tokens
        from auth import decrypt_oauth_token

        current_refresh_token = None
        if token_row.refresh_token:
            current_refresh_token = decrypt_oauth_token(token_row.refresh_token)

        # Check for refresh token reuse (RFC 9700 Section 3.3)
        # If the refresh token was used within the last 60 seconds, it's a replay attack
        if token_row.refresh_token_used_at:
            time_since_use = time.time() - token_row.refresh_token_used_at
            if time_since_use < 60:
                # Potential token replay attack - revoke entire token family
                logger.warning(
                    "Refresh token reuse detected for %s/%s. Revoking token family.",
                    getattr(token_row, 'platform', 'unknown'),
                    getattr(token_row, 'provider', 'unknown'),
                )
                token_row.refresh_token = None
                token_row.access_token = encrypt_oauth_token("")  # Invalidate access token too
                await session.commit()
                raise RuntimeError(
                    "Refresh token reuse detected. All tokens in this family have been revoked for security."
                )

        if not current_refresh_token:
            raise RuntimeError("No refresh token available for token refresh.")

        # Call subclass implementation to get new tokens
        new_tokens = await self.refresh_token(token_row, access_token)

        # Update token row with new tokens
        from auth import encrypt_oauth_token

        token_row.access_token = encrypt_oauth_token(new_tokens["access_token"])
        if new_tokens.get("refresh_token"):
            token_row.refresh_token = encrypt_oauth_token(new_tokens["refresh_token"])
        if new_tokens.get("expires_at"):
            token_row.expires_at = new_tokens["expires_at"]

        # Mark when this refresh token was used (for reuse detection)
        token_row.refresh_token_used_at = time.time()

        await session.commit()

        return new_tokens


# Registry
_ADAPTERS: dict[str, type[PlatformAdapter]] = {}


def register_adapter(adapter_class: type[PlatformAdapter]) -> type[PlatformAdapter]:
    """Decorator to register a platform adapter class."""
    _ADAPTERS[adapter_class.platform] = adapter_class
    return adapter_class


def get_adapter(platform: str) -> PlatformAdapter:
    """Return a new instance of the adapter for the given platform."""
    cls = _ADAPTERS.get(platform)
    if cls is None:
        raise ValueError(f"No adapter registered for platform: {platform}")
    return cls()
