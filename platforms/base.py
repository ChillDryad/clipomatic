"""
Platform adapter base class.
"""

from abc import ABC, abstractmethod
from typing import Any


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
    async def refresh_token(self, token_row: Any) -> dict[str, Any]:
        """
        Refresh an expired OAuth2 token.

        Args:
            token_row: The OAuthToken model row (contains access_token, refresh_token, expires_at).

        Returns:
            A dict with new access_token (and optionally new refresh_token and expires_at).
        """


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
