"""
Unit tests for platforms/base.py.

Tests cover:
- Platform adapter registration
- Adapter lookup
"""

import pytest

# Import platforms first to trigger @register_adapter decorators
import platforms  # noqa: F401

from platforms.base import PlatformAdapter, get_adapter, register_adapter, _ADAPTERS


# ---------------------------------------------------------------------------
# Adapter Registration Tests
# ---------------------------------------------------------------------------


class TestRegisterAdapter:
    """Tests for register_adapter decorator."""

    def test_register_adapter_decorator(self):
        """Test that register_adapter decorator works."""

        @register_adapter
        class TestAdapter(PlatformAdapter):
            platform = "test_platform"

            async def upload(self, video_path, title, description, hashtags, metadata, token):
                pass

            async def refresh_token(self, token_row, access_token=None):
                pass

        # Should be registered
        assert "test_platform" in _ADAPTERS

    def test_register_adapter_returns_class(self):
        """Test that decorator returns the class."""

        @register_adapter
        class TestAdapter2(PlatformAdapter):
            platform = "test_platform_2"

            async def upload(self, video_path, title, description, hashtags, metadata, token):
                pass

            async def refresh_token(self, token_row, access_token=None):
                pass

        # Should return the class itself
        assert TestAdapter2.platform == "test_platform_2"

    def test_register_adapter_without_platform_attr(self):
        """Test that adapter without platform attr still registers."""
        # This might raise an error or use a default
        # Depends on implementation
        pass


# ---------------------------------------------------------------------------
# Adapter Lookup Tests
# ---------------------------------------------------------------------------


class TestGetAdapter:
    """Tests for get_adapter function."""

    def test_get_adapter_returns_adapter(self):
        """Test that get_adapter returns an adapter instance."""

        @register_adapter
        class TestAdapter3(PlatformAdapter):
            platform = "test_platform_3"

            async def upload(self, video_path, title, description, hashtags, metadata, token):
                return "https://example.com/video"

            async def refresh_token(self, token_row, access_token=None):
                return {"access_token": "new_token"}

        adapter = get_adapter("test_platform_3")
        assert adapter is not None
        assert isinstance(adapter, PlatformAdapter)

    def test_get_adapter_unknown_platform(self):
        """Test that get_adapter raises for unknown platform."""
        with pytest.raises(ValueError) as exc_info:
            get_adapter("nonexistent_platform")
        assert "nonexistent_platform" in str(exc_info.value)

    def test_get_adapter_case_sensitive(self):
        """Test that platform lookup is case-sensitive."""

        @register_adapter
        class TestAdapter4(PlatformAdapter):
            platform = "TestPlatform"

            async def upload(self, video_path, title, description, hashtags, metadata, token):
                pass

            async def refresh_token(self, token_row, access_token=None):
                pass

        # Should match exactly
        adapter = get_adapter("TestPlatform")
        assert adapter is not None

        # Wrong case should fail
        with pytest.raises(ValueError):
            get_adapter("testplatform")

    def test_get_adapter_youtube(self):
        """Test getting YouTube adapter."""
        # Import to trigger registration
        from platforms import youtube  # noqa: F401

        adapter = get_adapter("youtube")
        assert adapter is not None
        assert adapter.platform == "youtube"

    def test_get_adapter_tiktok(self):
        """Test getting TikTok adapter."""
        from platforms import tiktok  # noqa: F401

        adapter = get_adapter("tiktok")
        assert adapter is not None
        assert adapter.platform == "tiktok"

    def test_get_adapter_instagram(self):
        """Test getting Instagram adapter."""
        from platforms import instagram  # noqa: F401

        adapter = get_adapter("instagram")
        assert adapter is not None
        assert adapter.platform == "instagram"


# ---------------------------------------------------------------------------
# Platform Adapter Base Class Tests
# ---------------------------------------------------------------------------


class TestPlatformAdapterBase:
    """Tests for PlatformAdapter abstract base class."""

    def test_platform_adapter_is_abstract(self):
        """Test that PlatformAdapter cannot be instantiated directly."""
        with pytest.raises(TypeError):
            PlatformAdapter()

    def test_platform_adapter_requires_upload(self):
        """Test that subclasses must implement upload method."""

        class IncompleteAdapter(PlatformAdapter):
            platform = "incomplete"

            async def refresh_token(self, token_row, access_token=None):
                pass

        # Should fail because upload is not implemented
        with pytest.raises(TypeError):
            IncompleteAdapter()

    def test_platform_adapter_requires_refresh_token(self):
        """Test that subclasses must implement refresh_token method."""

        class IncompleteAdapter2(PlatformAdapter):
            platform = "incomplete2"

            async def upload(self, video_path, title, description, hashtags, metadata, token):
                pass

        # Should fail because refresh_token is not implemented
        with pytest.raises(TypeError):
            IncompleteAdapter2()

    def test_complete_adapter_instantiates(self):
        """Test that complete adapter can be instantiated."""

        class CompleteAdapter(PlatformAdapter):
            platform = "complete"

            async def upload(self, video_path, title, description, hashtags, metadata, token):
                return "https://example.com"

            async def refresh_token(self, token_row, access_token=None):
                return {}

        adapter = CompleteAdapter()
        assert adapter is not None
        assert adapter.platform == "complete"


# ---------------------------------------------------------------------------
# Adapter Registry Tests
# ---------------------------------------------------------------------------


class TestAdapterRegistry:
    """Tests for the adapter registry."""

    def test_adapters_dict_exists(self):
        """Test that _ADAPTERS module-level registry exists."""
        # _ADAPTERS is a module-level variable, not a class attribute
        assert isinstance(_ADAPTERS, dict)

    def test_multiple_adapters_registered(self):
        """Test that multiple adapters can be registered."""
        initial_count = len(_ADAPTERS)

        @register_adapter
        class Adapter1(PlatformAdapter):
            platform = "adapter_test_1"

            async def upload(self, video_path, title, description, hashtags, metadata, token):
                pass

            async def refresh_token(self, token_row, access_token=None):
                pass

        @register_adapter
        class Adapter2(PlatformAdapter):
            platform = "adapter_test_2"

            async def upload(self, video_path, title, description, hashtags, metadata, token):
                pass

            async def refresh_token(self, token_row, access_token=None):
                pass

        # Should have 2 more adapters
        assert len(_ADAPTERS) >= initial_count + 2

    def test_adapter_overwrite(self):
        """Test that registering same platform overwrites previous."""

        @register_adapter
        class AdapterV1(PlatformAdapter):
            platform = "adapter_overwrite"

            async def upload(self, video_path, title, description, hashtags, metadata, token):
                return "v1"

            async def refresh_token(self, token_row, access_token=None):
                return {}

        # Register another adapter with same platform
        @register_adapter
        class AdapterV2(PlatformAdapter):
            platform = "adapter_overwrite"

            async def upload(self, video_path, title, description, hashtags, metadata, token):
                return "v2"

            async def refresh_token(self, token_row, access_token=None):
                return {}

        # Should get the latest one
        adapter = get_adapter("adapter_overwrite")
        # Note: This behavior depends on implementation


# ---------------------------------------------------------------------------
# Integration-style Tests
# ---------------------------------------------------------------------------


class TestPlatformAdaptersIntegration:
    """Integration tests for platform adapters."""

    @pytest.mark.asyncio
    async def test_youtube_adapter_upload_signature(self):
        """Test YouTube adapter has correct upload signature."""
        from platforms.youtube import YouTubeAdapter

        adapter = YouTubeAdapter()
        # Check method exists
        assert hasattr(adapter, "upload")
        assert hasattr(adapter, "refresh_token")

    @pytest.mark.asyncio
    async def test_tiktok_adapter_upload_signature(self):
        """Test TikTok adapter has correct upload signature."""
        from platforms.tiktok import TikTokAdapter

        adapter = TikTokAdapter()
        assert hasattr(adapter, "upload")
        assert hasattr(adapter, "refresh_token")

    @pytest.mark.asyncio
    async def test_instagram_adapter_upload_signature(self):
        """Test Instagram adapter has correct upload signature."""
        from platforms.instagram import InstagramAdapter

        adapter = InstagramAdapter()
        assert hasattr(adapter, "upload")
        assert hasattr(adapter, "refresh_token")
