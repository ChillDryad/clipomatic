"""
Unit tests for pipeline/audio.py.

Tests cover:
- Audio type detection from magic bytes
- File validation logic
"""

import pytest

from pipeline.audio import (
    AUDIO_EXTENSIONS,
    AUDIO_MAGIC_BYTES,
    _detect_audio_type,
)


# ---------------------------------------------------------------------------
# Audio Type Detection Tests
# ---------------------------------------------------------------------------


class TestDetectAudioType:
    """Tests for _detect_audio_type function."""

    def test_detect_mp3_fffb(self):
        """Test detecting MP3 with 0xFFFB frame sync."""
        audio_data = b"\xff\xfb" + b"\x00" * 100
        result = _detect_audio_type(audio_data)
        assert result == "audio/mp3"

    def test_detect_mp3_fffa(self):
        """Test detecting MP3 with 0xFFFA frame sync."""
        audio_data = b"\xff\xfa" + b"\x00" * 100
        result = _detect_audio_type(audio_data)
        assert result == "audio/mp3"

    def test_detect_mp3_fff2(self):
        """Test detecting MP3 with 0xFFF2 frame sync."""
        audio_data = b"\xff\xf2" + b"\x00" * 100
        result = _detect_audio_type(audio_data)
        assert result == "audio/mp3"

    def test_detect_mp3_fff3(self):
        """Test detecting MP3 with 0xFFF3 frame sync."""
        audio_data = b"\xff\xf3" + b"\x00" * 100
        result = _detect_audio_type(audio_data)
        assert result == "audio/mp3"

    def test_detect_wav_riff(self):
        """Test detecting WAV with RIFF header."""
        audio_data = b"RIFF....WAVE" + b"\x00" * 100
        result = _detect_audio_type(audio_data)
        assert result == "audio/wav"

    def test_detect_wav_special_case(self):
        """Test detecting WAV with special 8-byte check."""
        audio_data = b"RIFF....WAVE" + b"\x00" * 100
        result = _detect_audio_type(audio_data)
        assert result == "audio/wav"

    def test_detect_ogg(self):
        """Test detecting Ogg Vorbis/Opus."""
        audio_data = b"OggS" + b"\x00" * 100
        result = _detect_audio_type(audio_data)
        assert result == "audio/ogg"

    def test_detect_flac(self):
        """Test detecting FLAC."""
        audio_data = b"fLaC" + b"\x00" * 100
        result = _detect_audio_type(audio_data)
        assert result == "audio/flac"

    def test_detect_m4a_aac(self):
        """Test detecting M4A/AAC with ftyp."""
        audio_data = b"\x00\x00\x00\x1cftyp" + b"\x00" * 100
        result = _detect_audio_type(audio_data)
        assert result == "audio/mp4"

    def test_detect_m4a_variant(self):
        """Test detecting M4A with variant ftyp."""
        audio_data = b"\x00\x00\x00\x18ftyp" + b"\x00" * 100
        result = _detect_audio_type(audio_data)
        assert result == "audio/mp4"

    def test_detect_m4a_specific(self):
        """Test detecting M4A with specific ftyp."""
        audio_data = b"\x00\x00\x00\x20ftypM4A" + b"\x00" * 100
        result = _detect_audio_type(audio_data)
        assert result == "audio/mp4"

    def test_detect_unknown_type(self):
        """Test detecting unknown audio type."""
        audio_data = b"UNKNOWN" + b"\x00" * 100
        result = _detect_audio_type(audio_data)
        assert result is None

    def test_detect_empty_data(self):
        """Test detecting empty audio data."""
        audio_data = b""
        result = _detect_audio_type(audio_data)
        assert result is None

    def test_detect_short_data(self):
        """Test detecting very short audio data."""
        audio_data = b"\xff"
        result = _detect_audio_type(audio_data)
        assert result is None

    def test_detect_priority_order(self):
        """Test that detection uses correct priority (first match wins)."""
        # If data starts with MP3 magic, should detect as MP3
        audio_data = b"\xff\xfb" + b"RIFF" + b"\x00" * 100
        result = _detect_audio_type(audio_data)
        assert result == "audio/mp3"


# ---------------------------------------------------------------------------
# Audio Extension Whitelist Tests
# ---------------------------------------------------------------------------


class TestAudioExtensions:
    """Tests for AUDIO_EXTENSIONS whitelist."""

    def test_mp3_extension(self):
        """Test .mp3 is in whitelist."""
        assert ".mp3" in AUDIO_EXTENSIONS

    def test_wav_extension(self):
        """Test .wav is in whitelist."""
        assert ".wav" in AUDIO_EXTENSIONS

    def test_aac_extension(self):
        """Test .aac is in whitelist."""
        assert ".aac" in AUDIO_EXTENSIONS

    def test_m4a_extension(self):
        """Test .m4a is in whitelist."""
        assert ".m4a" in AUDIO_EXTENSIONS

    def test_ogg_extension(self):
        """Test .ogg is in whitelist."""
        assert ".ogg" in AUDIO_EXTENSIONS

    def test_flac_extension(self):
        """Test .flac is in whitelist."""
        assert ".flac" in AUDIO_EXTENSIONS

    def test_invalid_extension_not_in_whitelist(self):
        """Test that invalid extensions are not in whitelist."""
        assert ".exe" not in AUDIO_EXTENSIONS
        assert ".txt" not in AUDIO_EXTENSIONS
        assert ".mp4" not in AUDIO_EXTENSIONS  # Video, not audio

    def test_case_sensitivity(self):
        """Test that extensions are lowercase."""
        assert ".MP3" not in AUDIO_EXTENSIONS  # Should be lowercase
        assert ".Mp3" not in AUDIO_EXTENSIONS


# ---------------------------------------------------------------------------
# Magic Bytes Coverage Tests
# ---------------------------------------------------------------------------


class TestAudioMagicBytes:
    """Tests for AUDIO_MAGIC_BYTES dictionary."""

    def test_mp3_has_multiple_signatures(self):
        """Test that MP3 has multiple frame sync signatures."""
        mp3_magics = [k for k in AUDIO_MAGIC_BYTES.keys() if AUDIO_MAGIC_BYTES[k] == "audio/mp3"]
        assert len(mp3_magics) >= 4  # At least 4 MP3 signatures

    def test_all_magic_bytes_are_bytes(self):
        """Test that all magic bytes are bytes objects."""
        for magic in AUDIO_MAGIC_BYTES.keys():
            assert isinstance(magic, bytes)

    def test_all_magic_bytes_have_mime_type(self):
        """Test that all magic bytes map to a MIME type."""
        for mime_type in AUDIO_MAGIC_BYTES.values():
            assert isinstance(mime_type, str)
            assert "/" in mime_type  # Should be like "audio/xxx"

    def test_wav_uses_riff(self):
        """Test that WAV uses RIFF container signature."""
        assert b"RIFF" in AUDIO_MAGIC_BYTES

    def test_ogg_uses_ogg_s(self):
        """Test that Ogg uses OggS signature."""
        assert b"OggS" in AUDIO_MAGIC_BYTES

    def test_flac_uses_flac_marker(self):
        """Test that FLAC uses fLaC marker."""
        assert b"fLaC" in AUDIO_MAGIC_BYTES
