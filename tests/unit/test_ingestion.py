"""
Unit tests for pipeline/ingestion.py.

Tests cover:
- VOD ID extraction from URLs
- URL validation
"""

import pytest

from pipeline.ingestion import extract_vod_id


# ---------------------------------------------------------------------------
# Twitch VOD ID Extraction Tests
# ---------------------------------------------------------------------------


class TestExtractVodId:
    """Tests for extract_vod_id function."""

    def test_extract_vod_id_standard_url(self):
        """Test extracting VOD ID from standard Twitch URL."""
        url = "https://www.twitch.tv/videos/123456789"
        vod_id = extract_vod_id(url)
        assert vod_id == "123456789"

    def test_extract_vod_id_no_www(self):
        """Test extracting VOD ID from URL without www."""
        url = "https://twitch.tv/videos/987654321"
        vod_id = extract_vod_id(url)
        assert vod_id == "987654321"

    def test_extract_vod_id_with_query_params(self):
        """Test extracting VOD ID from URL with query parameters."""
        url = "https://www.twitch.tv/videos/123456789?t=1h2m3s"
        vod_id = extract_vod_id(url)
        assert vod_id == "123456789"

    def test_extract_vod_id_with_fragment(self):
        """Test extracting VOD ID from URL with fragment."""
        url = "https://www.twitch.tv/videos/123456789#section"
        vod_id = extract_vod_id(url)
        assert vod_id == "123456789"

    def test_extract_vod_id_http(self):
        """Test extracting VOD ID from HTTP URL."""
        url = "http://www.twitch.tv/videos/111222333"
        vod_id = extract_vod_id(url)
        assert vod_id == "111222333"

    def test_extract_vod_id_clip_url_invalid(self):
        """Test that clip URLs raise ValueError."""
        url = "https://www.twitch.tv/clips/SomeClipName"
        with pytest.raises(ValueError) as exc_info:
            extract_vod_id(url)
        assert "Could not extract" in str(exc_info.value)

    def test_extract_vod_id_channel_url_invalid(self):
        """Test that channel URLs raise ValueError."""
        url = "https://www.twitch.tv/some_channel"
        with pytest.raises(ValueError):
            extract_vod_id(url)

    def test_extract_vod_id_random_url_invalid(self):
        """Test that random URLs raise ValueError."""
        url = "https://example.com/not-a-twitch-url"
        with pytest.raises(ValueError):
            extract_vod_id(url)

    def test_extract_vod_id_empty_string(self):
        """Test that empty string raises ValueError."""
        with pytest.raises(ValueError):
            extract_vod_id("")

    def test_extract_vod_id_malformed_id(self):
        """Test that malformed VOD ID raises ValueError."""
        url = "https://www.twitch.tv/videos/not-a-number"
        with pytest.raises(ValueError):
            extract_vod_id(url)

    def test_extract_vod_id_trailing_slash(self):
        """Test extracting VOD ID from URL with trailing slash."""
        url = "https://www.twitch.tv/videos/444555666/"
        vod_id = extract_vod_id(url)
        assert vod_id == "444555666"


# ---------------------------------------------------------------------------
# Integration-style Tests
# ---------------------------------------------------------------------------


class TestExtractVodIdIntegration:
    """Integration-style tests for VOD ID extraction."""

    def test_round_trip_extraction(self):
        """Test that extracted ID can be used to reconstruct URL."""
        original_url = "https://www.twitch.tv/videos/789123456"
        vod_id = extract_vod_id(original_url)
        reconstructed = f"https://www.twitch.tv/videos/{vod_id}"

        # Extract again from reconstructed URL
        vod_id_2 = extract_vod_id(reconstructed)
        assert vod_id == vod_id_2

    def test_multiple_urls_same_id(self):
        """Test that different URL formats return same ID."""
        urls = [
            "https://www.twitch.tv/videos/123456",
            "https://twitch.tv/videos/123456",
            "http://www.twitch.tv/videos/123456",
            "https://www.twitch.tv/videos/123456?t=0",
        ]

        ids = [extract_vod_id(url) for url in urls]
        assert len(set(ids)) == 1  # All should be the same
        assert ids[0] == "123456"
