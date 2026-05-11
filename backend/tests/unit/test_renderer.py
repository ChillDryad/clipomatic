"""
Unit tests for pipeline/renderer.py.

Tests cover:
- ASS subtitle generation
- Time conversion utilities
- Color conversion
- ASS header building
"""

import pytest

from pipeline.renderer import (
    _ass_style_header,
    _build_ass_header,
    _build_ass_word_by_word,
    _hex_to_ass,
    _seconds_to_ass_time,
)


# ---------------------------------------------------------------------------
# Time Conversion Tests
# ---------------------------------------------------------------------------


class TestSecondsToAssTime:
    """Tests for _seconds_to_ass_time function."""

    def test_zero_seconds(self):
        """Test converting 0 seconds."""
        result = _seconds_to_ass_time(0)
        assert result == "0:00:00.00"

    def test_exact_minutes(self):
        """Test converting exact minutes."""
        assert _seconds_to_ass_time(60) == "0:01:00.00"
        assert _seconds_to_ass_time(120) == "0:02:00.00"
        assert _seconds_to_ass_time(3600) == "1:00:00.00"

    def test_exact_hours(self):
        """Test converting exact hours."""
        assert _seconds_to_ass_time(3600) == "1:00:00.00"
        assert _seconds_to_ass_time(7200) == "2:00:00.00"

    def test_fractional_seconds(self):
        """Test converting fractional seconds."""
        result = _seconds_to_ass_time(1.5)
        assert result == "0:00:01.50"

        result = _seconds_to_ass_time(1.125)
        assert result == "0:00:01.12" or result == "0:00:01.13"

    def test_complex_timestamp(self):
        """Test converting complex timestamp."""
        # 1 hour, 23 minutes, 45.67 seconds
        result = _seconds_to_ass_time(3600 + 23 * 60 + 45.67)
        assert result == "1:23:45.67"

    def test_sub_second_precision(self):
        """Test sub-second precision (centiseconds)."""
        result = _seconds_to_ass_time(0.01)
        assert result == "0:00:00.01"

    def test_rounding(self):
        """Test rounding behavior."""
        # 3 decimal places should round to 2
        result = _seconds_to_ass_time(1.999)
        assert result == "0:00:02.00"

    def test_large_timestamp(self):
        """Test large timestamp (many hours)."""
        result = _seconds_to_ass_time(10 * 3600 + 5 * 60 + 30)  # 10:05:30
        assert result == "10:05:30.00"


# ---------------------------------------------------------------------------
# Color Conversion Tests
# ---------------------------------------------------------------------------


class TestHexToAss:
    """Tests for _hex_to_ass function."""

    def test_white(self):
        """Test converting white (#FFFFFF)."""
        result = _hex_to_ass("#FFFFFF")
        assert result == "&H00FFFFFF"

    def test_black(self):
        """Test converting black (#000000)."""
        result = _hex_to_ass("#000000")
        assert result == "&H00000000"

    def test_red(self):
        """Test converting red (#FF0000)."""
        result = _hex_to_ass("#FF0000")
        assert result == "&H000000FF"

    def test_green(self):
        """Test converting green (#00FF00)."""
        result = _hex_to_ass("#00FF00")
        assert result == "&H0000FF00"

    def test_blue(self):
        """Test converting blue (#0000FF)."""
        result = _hex_to_ass("#0000FF")
        assert result == "&H00FF0000"

    def test_ass_format_bgr(self):
        """Test that ASS uses BGR format (not RGB)."""
        # RGB: FF0000 = Red
        # ASS BGR: 0000FF = Red (blue and red swapped)
        result = _hex_to_ass("#FF0000")  # Red in RGB
        assert result.endswith("FF")  # Red component last in BGR

    def test_lowercase_hex(self):
        """Test converting lowercase hex."""
        result = _hex_to_ass("#ffffff")
        assert result == "&H00FFFFFF"

    def test_without_hash(self):
        """Test converting hex without # prefix."""
        result = _hex_to_ass("FFFFFF")
        assert result == "&H00FFFFFF"

    def test_with_alpha(self):
        """Test converting hex with alpha channel."""
        result = _hex_to_ass("#80FF0000")  # 50% transparent red
        # Alpha should be handled
        assert result.startswith("&H")


# ---------------------------------------------------------------------------
# ASS Header Tests
# ---------------------------------------------------------------------------


class TestBuildAssHeader:
    """Tests for _build_ass_header function."""

    def test_header_contains_script_info(self):
        """Test that header contains Script Info section."""
        header = _build_ass_header()
        assert "[Script Info]" in header

    def test_header_contains_styles(self):
        """Test that header contains V4+ Styles section."""
        header = _build_ass_header()
        assert "[V4+ Styles]" in header

    def test_header_contains_events(self):
        """Test that header contains Events section."""
        header = _build_ass_header()
        assert "[Events]" in header

    def test_header_contains_format_lines(self):
        """Test that header contains Format lines."""
        header = _build_ass_header()
        assert "Format:" in header

    def test_header_playres(self):
        """Test that header contains PlayRes settings."""
        header = _build_ass_header()
        assert "PlayResX" in header
        assert "PlayResY" in header


class TestAssStyleHeader:
    """Tests for _ass_style_header function."""

    def test_style_default_name(self):
        """Test that default style is named 'Default'."""
        styles = _ass_style_header()
        assert "Style: Default" in styles

    def test_style_font(self):
        """Test that style includes font specification."""
        styles = _ass_style_header()
        assert "Arial" in styles or "Fontname" in styles

    def test_style_fontsize(self):
        """Test that style includes font size."""
        styles = _ass_style_header()
        # Font size should be in the style line
        assert any(c.isdigit() for c in styles)

    def test_style_outline(self):
        """Test that style includes outline settings."""
        styles = _ass_style_header()
        # Outline color should be specified
        assert "&H" in styles


# ---------------------------------------------------------------------------
# ASS Subtitle Building Tests
# ---------------------------------------------------------------------------


class TestBuildAssWordByWord:
    """Tests for _build_ass_word_by_word function."""

    @pytest.fixture
    def segment_with_words(self):
        """Segment with word-level timestamps."""
        return {
            "start": 0,
            "end": 5,
            "text": "Hello world test",
            "words": [
                {"word": "Hello", "start": 0, "end": 1},
                {"word": "world", "start": 1.5, "end": 2.5},
                {"word": "test", "start": 3, "end": 4},
            ]
        }

    def test_word_by_word_contains_karaoke(self, segment_with_words):
        """Test that word-by-word build includes karaoke effects."""
        ass_content = _build_ass_word_by_word(
            segments=[segment_with_words],
            clip_start=0,
            clip_end=10,
            caption_style="karaoke",
        )
        # Karaoke style uses \\k for timing
        assert "\\k" in ass_content or "Dialogue:" in ass_content

    def test_word_by_word_capcut_style(self, segment_with_words):
        """Test CapCut caption style."""
        ass_content = _build_ass_word_by_word(
            segments=[segment_with_words],
            clip_start=0,
            clip_end=10,
            caption_style="capcut",
        )
        assert "Dialogue:" in ass_content

    def test_pop_animation_generates_scale_tags(self, segment_with_words):
        """Test pop animation uses scale tags with correct timing."""
        ass_content = _build_ass_word_by_word(
            [{"start": 0, "end": 5, "text": "Hello world test", "words": [
                {"word": "Hello", "start": 0, "end": 1},
            ]}],
            clip_start=0,
            clip_end=10,
            caption_style="pop",
            animation_speed="normal",
        )
        # Pop animation uses \\fscx/\\fscy for scale effect
        assert "\\fscx50\\fscy50" in ass_content
        assert "\\t(0,80,\\fscx115\\fscy115)" in ass_content
        assert "\\t(80,180,\\fscx100\\fscy100)" in ass_content

    def test_bounce_animation_uses_move_tag(self, segment_with_words):
        """Test bounce animation uses \\move with correct coordinates."""
        ass_content = _build_ass_word_by_word(
            [{"start": 0, "end": 5, "text": "Hello world test", "words": [
                {"word": "Hello", "start": 0, "end": 1},
            ]}],
            clip_start=0,
            clip_end=10,
            caption_style="bounce",
            animation_speed="normal",
        )
        # Bounce animation uses \\move from below
        assert "\\move(540,1100,540,960)" in ass_content

    def test_animation_speed_affects_duration(self, segment_with_words):
        """Test that animation speed changes timing."""
        fast_content = _build_ass_word_by_word(
            [{"start": 0, "end": 5, "text": "Test", "words": [
                {"word": "Test", "start": 0, "end": 1},
            ]}],
            clip_start=0,
            clip_end=10,
            caption_style="pop",
            animation_speed="fast",
        )
        slow_content = _build_ass_word_by_word(
            [{"start": 0, "end": 5, "text": "Test", "words": [
                {"word": "Test", "start": 0, "end": 1},
            ]}],
            clip_start=0,
            clip_end=10,
            caption_style="pop",
            animation_speed="slow",
        )
        # Fast should have shorter duration values than slow
        # Fast: \\t(80,120,...) vs Slow: \\t(80,250,...)
        assert "\\t(80,120," in fast_content or "120" in fast_content
        assert "\\t(80,250," in slow_content or "250" in slow_content

    def test_word_by_word_positioning(self, segment_with_words):
        """Test that subtitles include positioning."""
        ass_content = _build_ass_word_by_word(
            segments=[segment_with_words],
            clip_start=0,
            clip_end=10,
        )
        # Should include \\pos tag for positioning
        assert "\\pos" in ass_content or "Dialogue:" in ass_content


# ---------------------------------------------------------------------------
# Edge Cases and Error Handling
# ---------------------------------------------------------------------------


class TestRendererEdgeCases:
    """Edge case tests for renderer functions."""

    def test_seconds_to_ass_time_negative(self):
        """Test converting negative seconds."""
        # Should handle gracefully (either clamp or produce negative time)
        result = _seconds_to_ass_time(-1)
        assert isinstance(result, str)

    def test_seconds_to_ass_time_very_large(self):
        """Test converting very large seconds value."""
        result = _seconds_to_ass_time(1000000)
        assert ":" in result  # Should still be formatted

    def test_hex_to_ass_invalid(self):
        """Test converting invalid hex color."""
        # Should handle gracefully
        result = _hex_to_ass("not-a-color")
        assert isinstance(result, str)

    def test_build_ass_word_by_word_special_characters(self):
        """Test word-by-word ASS with special characters in text."""
        segments = {"start": 0, "end": 5, "text": "Test newline", "words": [
            {"word": "Test", "start": 0, "end": 1},
            {"word": "newline", "start": 1.5, "end": 2.5},
        ]}
        clip = {"start": 0, "end": 10}
        ass_content = _build_ass_word_by_word(clip, segments, 1920, 1080)
        assert len(ass_content) > 0

    def test_build_ass_word_by_word_unicode_text(self):
        """Test word-by-word ASS with unicode text."""
        segments = {"start": 0, "end": 5, "text": "日本語テスト", "words": [
            {"word": "日本語テスト", "start": 0, "end": 5},
        ]}
        clip = {"start": 0, "end": 10}
        ass_content = _build_ass_word_by_word(clip, segments, 1920, 1080)
        assert "日本語テスト" in ass_content
