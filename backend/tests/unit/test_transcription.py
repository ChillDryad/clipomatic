"""
Unit tests for pipeline/transcription.py.

Tests cover:
- Device detection logic
- Transcript to text conversion
- Device/compute type resolution
"""

import sys
from unittest.mock import patch

import pytest

from pipeline.transcription import (
    _resolve_device,
    detect_device,
    transcript_to_text,
)


# ---------------------------------------------------------------------------
# Device Detection Tests
# ---------------------------------------------------------------------------


class TestDetectDevice:
    """Tests for detect_device function."""

    def test_detect_device_returns_tuple(self):
        """Test that detect_device returns a tuple."""
        device, compute_type = detect_device()
        assert isinstance(device, str)
        assert isinstance(compute_type, str)

    def test_detect_device_valid_device(self):
        """Test that detected device is valid."""
        device, compute_type = detect_device()
        assert device in ("cuda", "cpu")
        assert compute_type in ("float16", "int8")

    @patch("sys.platform", "darwin")
    @patch("platform.machine", return_value="arm64")
    def test_detect_device_apple_silicon(self, mock_machine, mock_platform):
        """Test device detection on Apple Silicon."""
        # Should return CPU with int8 on Apple Silicon
        device, compute_type = detect_device()
        assert device == "cpu"
        assert compute_type == "int8"

    @patch("sys.platform", "linux")
    def test_detect_device_linux_no_cuda(self, mock_platform):
        """Test device detection on Linux without CUDA."""
        # Without ctranslate2 CUDA support, should fall back to CPU
        with patch("ctranslate2.get_cuda_device_count", return_value=0):
            device, compute_type = detect_device()
            assert device == "cpu"
            assert compute_type == "int8"


class TestResolveDevice:
    """Tests for _resolve_device function."""

    def test_resolve_cuda(self):
        device, compute_type = _resolve_device("cuda")
        assert device == "cuda"
        assert compute_type == "float16"

    def test_resolve_cpu(self):
        device, compute_type = _resolve_device("cpu")
        assert device == "cpu"
        assert compute_type == "int8"

    def test_resolve_unknown_defaults_to_int8(self):
        device, compute_type = _resolve_device("unknown")
        assert device == "unknown"
        assert compute_type == "int8"

    def test_resolve_auto_delegates_to_detect_device(self):
        with patch("pipeline.transcription.detect_device", return_value=("cpu", "int8")) as mock:
            device, compute_type = _resolve_device("auto")
        mock.assert_called_once()
        assert device == "cpu"
        assert compute_type == "int8"


# ---------------------------------------------------------------------------
# Transcript to Text Tests
# ---------------------------------------------------------------------------


class TestTranscriptToText:
    """Tests for transcript_to_text function."""

    def test_transcript_to_text_empty_segments(self):
        """Test converting transcript with empty segments."""
        transcript = {"segments": [], "duration": 0}
        result = transcript_to_text(transcript)
        assert result == ""

    def test_transcript_to_text_single_segment(self):
        """Test converting single segment."""
        transcript = {
            "segments": [{"start": 0, "end": 5, "text": "Hello", "words": []}],
            "duration": 5
        }
        result = transcript_to_text(transcript)
        assert result == "Hello"

    def test_transcript_to_text_multiple_segments(self):
        """Test converting multiple segments."""
        transcript = {
            "segments": [
                {"start": 0, "end": 2, "text": "First", "words": []},
                {"start": 3, "end": 5, "text": "Second", "words": []},
                {"start": 6, "end": 8, "text": "Third", "words": []},
            ],
            "duration": 8
        }
        result = transcript_to_text(transcript)
        assert result == "First Second Third"

    def test_transcript_to_text_preserves_spacing(self):
        """Test that spacing is preserved between segments."""
        transcript = {
            "segments": [
                {"start": 0, "end": 2, "text": "Hello", "words": []},
                {"start": 3, "end": 5, "text": "world", "words": []},
            ],
            "duration": 5
        }
        result = transcript_to_text(transcript)
        assert " " in result

    def test_transcript_to_text_with_punctuation(self):
        """Test converting transcript with punctuation."""
        transcript = {
            "segments": [
                {"start": 0, "end": 2, "text": "Hello!", "words": []},
                {"start": 3, "end": 5, "text": "How are you?", "words": []},
            ],
            "duration": 5
        }
        result = transcript_to_text(transcript)
        assert "Hello!" in result
        assert "How are you?" in result

    def test_transcript_to_text_unicode(self):
        """Test converting transcript with unicode text."""
        transcript = {
            "segments": [
                {"start": 0, "end": 2, "text": "こんにちは", "words": []},
                {"start": 3, "end": 5, "text": "👋", "words": []},
            ],
            "duration": 5
        }
        result = transcript_to_text(transcript)
        assert "こんにちは" in result
        assert "👋" in result

    def test_transcript_to_text_no_segments_key(self):
        """Test converting transcript without segments key."""
        transcript = {"duration": 5}
        result = transcript_to_text(transcript)
        assert result == ""

    def test_transcript_to_text_none_segments(self):
        """Test converting transcript with None segments."""
        transcript = {"segments": None, "duration": 5}
        result = transcript_to_text(transcript)
        assert result == ""


# ---------------------------------------------------------------------------
# Device Detection with Mocked ctranslate2
# ---------------------------------------------------------------------------


class TestDetectDeviceWithCuda:
    """Tests for device detection with CUDA available."""

    @patch("ctranslate2.get_cuda_device_count", return_value=1)
    def test_detect_device_cuda_available(self, mock_cuda):
        """Test that CUDA detection works when available."""
        device, compute_type = detect_device()
        assert device == "cuda"
        assert compute_type == "float16"

    @patch("ctranslate2.get_cuda_device_count", return_value=2)
    def test_detect_device_multiple_cuda(self, mock_cuda):
        """Test detection with multiple CUDA devices."""
        device, compute_type = detect_device()
        assert device == "cuda"
        assert compute_type == "float16"

    @patch("ctranslate2.get_cuda_device_count", side_effect=ImportError)
    def test_detect_device_ctranslate2_not_installed(self, mock_cuda):
        """Test detection when ctranslate2 is not installed."""
        device, compute_type = detect_device()
        # Should fall back to CPU
        assert device == "cpu"
        assert compute_type in ("int8",)


# ---------------------------------------------------------------------------
# Audio Duration Calculation Tests
# ---------------------------------------------------------------------------


class TestGetDuration:
    """Tests for audio duration calculation."""

    def test_duration_calculation_from_segments(self):
        """Test calculating duration from segments."""
        transcript = {
            "segments": [
                {"start": 0, "end": 10, "text": "First", "words": []},
                {"start": 10, "end": 20, "text": "Second", "words": []},
                {"start": 20, "end": 30, "text": "Third", "words": []},
            ],
            "duration": 30
        }
        # Duration should match the last segment end
        assert transcript["duration"] == 30

    def test_duration_from_last_segment(self):
        """Test that duration is based on last segment."""
        transcript = {
            "segments": [
                {"start": 0, "end": 5, "text": "A", "words": []},
                {"start": 100, "end": 150, "text": "B", "words": []},
            ],
            "duration": 150
        }
        assert transcript["duration"] == 150
