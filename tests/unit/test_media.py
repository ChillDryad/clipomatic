"""
Unit tests for pipeline/media.py.

Tests cover:
- MIME type detection from magic bytes
- Asset type classification
- Extension validation
"""

import pytest

from pipeline.media import (
    IMAGE_EXTENSIONS,
    MAGIC_BYTES,
    VIDEO_EXTENSIONS,
    _detect_mime_type_from_magic,
    _get_asset_type,
    _get_mime_type,
)


# ---------------------------------------------------------------------------
# MIME Type Detection Tests
# ---------------------------------------------------------------------------


class TestDetectMimeTypeFromMagic:
    """Tests for _detect_mime_type_from_magic function."""

    def test_detect_png(self):
        """Test detecting PNG image."""
        data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        result = _detect_mime_type_from_magic(data)
        assert result == "image/png"

    def test_detect_jpeg(self):
        """Test detecting JPEG image."""
        data = b"\xff\xd8\xff" + b"\x00" * 100
        result = _detect_mime_type_from_magic(data)
        assert result == "image/jpeg"

    def test_detect_gif87a(self):
        """Test detecting GIF87a."""
        data = b"GIF87a" + b"\x00" * 100
        result = _detect_mime_type_from_magic(data)
        assert result == "image/gif"

    def test_detect_gif89a(self):
        """Test detecting GIF89a."""
        data = b"GIF89a" + b"\x00" * 100
        result = _detect_mime_type_from_magic(data)
        assert result == "image/gif"

    def test_detect_webp(self):
        """Test detecting WebP image."""
        data = b"RIFF" + b"\x00" * 100
        result = _detect_mime_type_from_magic(data)
        assert result == "image/webp"

    def test_detect_mp4_1c(self):
        """Test detecting MP4 with 1c ftyp."""
        data = b"\x00\x00\x00\x1cftyp" + b"\x00" * 100
        result = _detect_mime_type_from_magic(data)
        assert result == "video/mp4"

    def test_detect_mp4_18(self):
        """Test detecting MP4 with 18 ftyp."""
        data = b"\x00\x00\x00\x18ftyp" + b"\x00" * 100
        result = _detect_mime_type_from_magic(data)
        assert result == "video/mp4"

    def test_detect_mp4_14(self):
        """Test detecting MP4 with 14 ftyp."""
        data = b"\x00\x00\x00\x14ftyp" + b"\x00" * 100
        result = _detect_mime_type_from_magic(data)
        assert result == "video/mp4"

    def test_detect_webm(self):
        """Test detecting WebM video."""
        data = b"\x1aE\xdf\xa3" + b"\x00" * 100
        result = _detect_mime_type_from_magic(data)
        assert result == "video/webm"

    def test_detect_moov(self):
        """Test detecting MP4 with moov atom."""
        data = b"moov" + b"\x00" * 100
        result = _detect_mime_type_from_magic(data)
        assert result == "video/mp4"

    def test_detect_ftyp_in_data(self):
        """Test detecting MP4 with ftyp anywhere in first 12 bytes."""
        data = b"....ftyp" + b"\x00" * 100
        result = _detect_mime_type_from_magic(data)
        assert result == "video/mp4"

    def test_detect_unknown_type(self):
        """Test detecting unknown file type."""
        data = b"UNKNOWN" + b"\x00" * 100
        result = _detect_mime_type_from_magic(data)
        assert result is None

    def test_detect_empty_data(self):
        """Test detecting empty data."""
        data = b""
        result = _detect_mime_type_from_magic(data)
        assert result is None

    def test_detect_insufficient_data(self):
        """Test detecting very short data."""
        data = b"\x89"  # Not enough for PNG signature
        result = _detect_mime_type_from_magic(data)
        assert result is None


# ---------------------------------------------------------------------------
# MIME Type from Extension Tests
# ---------------------------------------------------------------------------


class TestGetMimeType:
    """Tests for _get_mime_type function."""

    def test_png_extension(self):
        """Test PNG MIME type from extension."""
        assert _get_mime_type("image.png") == "image/png"

    def test_jpg_extension(self):
        """Test JPEG MIME type from .jpg extension."""
        assert _get_mime_type("image.jpg") == "image/jpeg"

    def test_jpeg_extension(self):
        """Test JPEG MIME type from .jpeg extension."""
        assert _get_mime_type("image.jpeg") == "image/jpeg"

    def test_gif_extension(self):
        """Test GIF MIME type from extension."""
        assert _get_mime_type("image.gif") == "image/gif"

    def test_webp_extension(self):
        """Test WebP MIME type from extension."""
        assert _get_mime_type("image.webp") == "image/webp"

    def test_mp4_extension(self):
        """Test MP4 MIME type from extension."""
        assert _get_mime_type("video.mp4") == "video/mp4"

    def test_webm_extension(self):
        """Test WebM MIME type from extension."""
        assert _get_mime_type("video.webm") == "video/webm"

    def test_mov_extension(self):
        """Test MOV MIME type from extension."""
        assert _get_mime_type("video.mov") == "video/quicktime"

    def test_unknown_extension(self):
        """Test unknown extension returns octet-stream."""
        assert _get_mime_type("file.xyz") == "application/octet-stream"

    def test_no_extension(self):
        """Test file without extension."""
        assert _get_mime_type("noextension") == "application/octet-stream"

    def test_uppercase_extension(self):
        """Test uppercase extension handling."""
        # Function uses lower() internally
        assert _get_mime_type("IMAGE.PNG") == "image/png"

    def test_mixed_case_extension(self):
        """Test mixed case extension handling."""
        assert _get_mime_type("video.MP4") == "video/mp4"


# ---------------------------------------------------------------------------
# Asset Type Classification Tests
# ---------------------------------------------------------------------------


class TestGetAssetType:
    """Tests for _get_asset_type function."""

    def test_image_extensions(self):
        """Test image asset type classification."""
        for ext in [".png", ".jpg", ".jpeg", ".gif", ".webp"]:
            assert _get_asset_type(f"file{ext}") == "image"

    def test_video_extensions(self):
        """Test video asset type classification."""
        for ext in [".mp4", ".webm", ".mov"]:
            assert _get_asset_type(f"file{ext}") == "video"

    def test_unknown_extension(self):
        """Test unknown extension returns 'unknown'."""
        assert _get_asset_type("file.xyz") == "unknown"
        assert _get_asset_type("file.txt") == "unknown"
        assert _get_asset_type("file.pdf") == "unknown"

    def test_no_extension(self):
        """Test file without extension."""
        assert _get_asset_type("noextension") == "unknown"

    def test_uppercase_extension(self):
        """Test uppercase extension handling."""
        assert _get_asset_type("FILE.PNG") == "image"
        assert _get_asset_type("FILE.MP4") == "video"

    def test_double_extension(self):
        """Test file with double extension."""
        # Should use last extension
        assert _get_asset_type("file.tar.gz") == "unknown"


# ---------------------------------------------------------------------------
# Extension Whitelist Tests
# ---------------------------------------------------------------------------


class TestImageExtensions:
    """Tests for IMAGE_EXTENSIONS whitelist."""

    def test_png_in_whitelist(self):
        """Test .png is in whitelist."""
        assert ".png" in IMAGE_EXTENSIONS

    def test_jpg_in_whitelist(self):
        """Test .jpg is in whitelist."""
        assert ".jpg" in IMAGE_EXTENSIONS

    def test_jpeg_in_whitelist(self):
        """Test .jpeg is in whitelist."""
        assert ".jpeg" in IMAGE_EXTENSIONS

    def test_gif_in_whitelist(self):
        """Test .gif is in whitelist."""
        assert ".gif" in IMAGE_EXTENSIONS

    def test_webp_in_whitelist(self):
        """Test .webp is in whitelist."""
        assert ".webp" in IMAGE_EXTENSIONS

    def test_video_not_in_image_whitelist(self):
        """Test video extensions not in image whitelist."""
        assert ".mp4" not in IMAGE_EXTENSIONS
        assert ".webm" not in IMAGE_EXTENSIONS


class TestVideoExtensions:
    """Tests for VIDEO_EXTENSIONS whitelist."""

    def test_mp4_in_whitelist(self):
        """Test .mp4 is in whitelist."""
        assert ".mp4" in VIDEO_EXTENSIONS

    def test_webm_in_whitelist(self):
        """Test .webm is in whitelist."""
        assert ".webm" in VIDEO_EXTENSIONS

    def test_mov_in_whitelist(self):
        """Test .mov is in whitelist."""
        assert ".mov" in VIDEO_EXTENSIONS

    def test_image_not_in_video_whitelist(self):
        """Test image extensions not in video whitelist."""
        assert ".png" not in VIDEO_EXTENSIONS
        assert ".jpg" not in VIDEO_EXTENSIONS


# ---------------------------------------------------------------------------
# Magic Bytes Coverage Tests
# ---------------------------------------------------------------------------


class TestMagicBytes:
    """Tests for MAGIC_BYTES dictionary."""

    def test_all_keys_are_bytes(self):
        """Test that all magic bytes are bytes objects."""
        for magic in MAGIC_BYTES.keys():
            assert isinstance(magic, bytes)

    def test_all_values_are_mime_types(self):
        """Test that all values are valid MIME types."""
        for mime_type in MAGIC_BYTES.values():
            assert isinstance(mime_type, str)
            assert "/" in mime_type

    def test_png_signature(self):
        """Test PNG signature is correct."""
        assert b"\x89PNG\r\n\x1a\n" in MAGIC_BYTES
        assert MAGIC_BYTES[b"\x89PNG\r\n\x1a\n"] == "image/png"

    def test_jpeg_signature(self):
        """Test JPEG signature is correct."""
        assert b"\xff\xd8\xff" in MAGIC_BYTES
        assert MAGIC_BYTES[b"\xff\xd8\xff"] == "image/jpeg"

    def test_gif_signatures(self):
        """Test GIF signatures are correct."""
        assert b"GIF87a" in MAGIC_BYTES
        assert b"GIF89a" in MAGIC_BYTES
        assert MAGIC_BYTES[b"GIF87a"] == "image/gif"
        assert MAGIC_BYTES[b"GIF89a"] == "image/gif"

    def test_webp_uses_riff(self):
        """Test WebP uses RIFF container signature."""
        assert b"RIFF" in MAGIC_BYTES
        assert MAGIC_BYTES[b"RIFF"] == "image/webp"

    def test_mp4_has_multiple_signatures(self):
        """Test MP4 has multiple ftyp signatures."""
        mp4_magics = [k for k in MAGIC_BYTES.keys() if MAGIC_BYTES[k] == "video/mp4"]
        assert len(mp4_magics) >= 3

    def test_webm_signature(self):
        """Test WebM signature is correct."""
        assert b"\x1aE\xdf\xa3" in MAGIC_BYTES
        assert MAGIC_BYTES[b"\x1aE\xdf\xa3"] == "video/webm"
