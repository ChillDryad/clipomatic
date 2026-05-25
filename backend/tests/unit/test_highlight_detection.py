"""
Unit tests for pipeline/highlight_detection.py.

Tests cover:
- Transcript chunking (with [OVERLAP] annotation)
- Clip parsing from LLM response
- Clip coercion and validation
- Timestamp snapping
- Transcript to text conversion
"""

import json

import pytest

from pipeline.highlight_detection import (
    BRAND_PILLARS,
    SINGLE_TURN_SYSTEM,
    _coerce_clip,
    _find_lists,
    _parse_clips,
    _chunk_transcript,
    _build_timestamp_indices,
    _snap_to_index,
    _parse_timestamp,
)
from pipeline.transcription import transcript_to_text


# ---------------------------------------------------------------------------
# Prompt Tests
# ---------------------------------------------------------------------------


class TestSingleTurnSystem:
    """Tests for SINGLE_TURN_SYSTEM prompt constant."""

    def test_prompt_includes_brand_pillars(self):
        """Test that brand pillars are included in prompt."""
        assert "cozy" in SINGLE_TURN_SYSTEM.lower() or BRAND_PILLARS in SINGLE_TURN_SYSTEM

    def test_prompt_includes_output_format(self):
        """Test that output format instructions are present."""
        assert "JSON" in SINGLE_TURN_SYSTEM
        assert "start" in SINGLE_TURN_SYSTEM
        assert "end" in SINGLE_TURN_SYSTEM

    def test_prompt_includes_overlap_avoidance(self):
        """Test that [OVERLAP] avoidance instruction is present."""
        assert "[OVERLAP]" in SINGLE_TURN_SYSTEM

    def test_prompt_includes_clip_length_validation(self):
        """Test that clip length validation is present."""
        assert "9" in SINGLE_TURN_SYSTEM
        assert "90" in SINGLE_TURN_SYSTEM

    def test_prompt_includes_timestamp_format_instruction(self):
        """Test that the prompt instructs LLM to copy timestamps directly."""
        assert "EXACTLY as" in SINGLE_TURN_SYSTEM
        assert "Do NOT convert" in SINGLE_TURN_SYSTEM


# ---------------------------------------------------------------------------
# Timestamp Snapping Tests
# ---------------------------------------------------------------------------


class TestBuildTimestampIndices:
    """Tests for _build_timestamp_indices function."""

    def test_empty_transcript(self):
        """Test with empty transcript returns empty indices."""
        starts, ends = _build_timestamp_indices({"segments": []})
        assert starts == []
        assert ends == []

    def test_single_segment_with_words(self):
        """Test building indices from a single segment with words."""
        transcript = {
            "segments": [{
                "start": 0,
                "end": 5,
                "text": "Hello world",
                "words": [
                    {"word": "Hello", "start": 0.0, "end": 0.5},
                    {"word": "world", "start": 0.5, "end": 1.0},
                ]
            }]
        }
        starts, ends = _build_timestamp_indices(transcript)
        assert starts == [0.0, 0.5]  # word starts
        assert ends == [0.5, 1.0]  # word ends

    def test_multiple_segments_sorted(self):
        """Test that timestamps are sorted in each index."""
        transcript = {
            "segments": [
                {"start": 10, "end": 15, "text": "Later", "words": [
                    {"word": "Later", "start": 10.0, "end": 11.0}
                ]},
                {"start": 0, "end": 5, "text": "First", "words": [
                    {"word": "First", "start": 0.0, "end": 1.0}
                ]},
            ]
        }
        starts, ends = _build_timestamp_indices(transcript)
        assert starts == sorted(starts)
        assert ends == sorted(ends)
        assert starts[0] == 0.0

    def test_segment_without_words(self):
        """Test building indices from segments that lack word-level data."""
        transcript = {
            "segments": [
                {"start": 5, "end": 10, "text": "No words"},
            ]
        }
        starts, ends = _build_timestamp_indices(transcript)
        assert starts == []
        assert ends == []


class TestSnapToIndex:
    """Tests for _snap_to_index function."""

    def test_snap_exact_match(self):
        """Test snapping when timestamp exactly matches an index entry."""
        index = [0.0, 0.5, 1.0, 1.5, 2.0, 5.0, 10.0, 15.0, 20.0]
        result = _snap_to_index(1.0, index)
        assert result == 1.0

    def test_snap_nearby_timestamp(self):
        """Test snapping to nearest word boundary."""
        index = [0.0, 0.5, 1.0, 1.5, 2.0, 5.0, 10.0, 15.0, 20.0]
        # 1.2 snaps to 1.0 (nearest)
        result = _snap_to_index(1.2, index)
        assert result == 1.0

    def test_snap_with_small_tolerance(self):
        """Test that timestamps beyond tolerance are rejected."""
        index = [0.0, 1.0, 5.0, 10.0, 15.0, 20.0]
        # 3.0 is 2.0 away from nearest (1.0 or 5.0), beyond tolerance of 1.0
        result = _snap_to_index(3.0, index, tolerance=1.0)
        assert result is None

    def test_snap_with_default_tolerance(self):
        """Test that timestamps within 30s tolerance are snapped."""
        index = [0.0, 90.0, 125.0, 192.0, 3600.0]
        # 5400.0 is a mis-converted [0:01:30] -> should be 90.0
        # With default 30s tolerance, 5400 is far from everything -> None
        result = _snap_to_index(5400.0, index)
        assert result is None

    def test_snap_hallucinated_timestamp(self):
        """Test that a 30+ minute hallucination is rejected."""
        index = [0.0, 1.0, 5.0, 10.0, 50.0, 100.0, 200.0, 500.0, 3600.0]
        # 5400 is far from any real timestamp
        result = _snap_to_index(5400.0, index)
        assert result is None

    def test_snap_nearby_timestamp_default_tolerance(self):
        """Test snapping with default 30s tolerance."""
        index = [0.0, 90.0, 125.0, 192.0]
        # 125.5 is within 30s of 125.0
        result = _snap_to_index(125.5, index)
        assert result == 125.0

    def test_snap_empty_index(self):
        """Test snapping with empty index returns None."""
        result = _snap_to_index(10.0, [])
        assert result is None

    def test_snap_between_two_values(self):
        """Test snapping to nearest of two equidistant values."""
        index = [0.0, 10.0, 20.0]
        # 15.0 is equidistant between 10 and 20
        result = _snap_to_index(15.0, index)
        assert result == 10.0 or result == 20.0  # Either is valid

    def test_snap_start_to_word_start(self):
        """Test that start timestamps snap to word-start boundaries."""
        starts = [0.0, 1.2, 3.5, 5.0, 10.0]
        # 1.3 snaps to nearest word start (1.2)
        result = _snap_to_index(1.3, starts)
        assert result == 1.2

    def test_snap_end_to_word_end(self):
        """Test that end timestamps snap to word-end boundaries."""
        ends = [0.5, 1.8, 4.2, 6.0, 11.5]
        # 4.0 snaps to nearest word end (4.2)
        result = _snap_to_index(4.0, ends)
        assert result == 4.2


# ---------------------------------------------------------------------------
# Transcript Chunking Tests
# ---------------------------------------------------------------------------


class TestChunkTranscript:
    """Tests for _chunk_transcript function (text string chunking)."""

    @pytest.fixture
    def long_text(self):
        """Create a long text string for chunking tests."""
        return "\n".join([f"Line {i}: This is some test content for chunking." for i in range(1000)])

    def test_chunk_short_text(self):
        """Test that short text is not chunked."""
        text = "Short text content"
        chunks = _chunk_transcript(text, max_chars=48000)
        assert len(chunks) == 1
        assert chunks[0] == text

    def test_chunk_long_text(self, long_text):
        """Test that long text is chunked."""
        chunks = _chunk_transcript(long_text, max_chars=48000)
        assert len(chunks) > 1

    def test_chunk_respects_max_chars(self, long_text):
        """Test that chunks respect the max character limit."""
        chunks = _chunk_transcript(long_text, max_chars=48000)
        for chunk in chunks:
            assert len(chunk) <= 48000 + 1000  # Small tolerance for line boundaries

    def test_chunk_overlap_annotated(self):
        """Test that overlap lines are annotated with [OVERLAP]."""
        lines = [f"[0:{i // 60:02d}:{i % 60:02d}.00] Word {i}" for i in range(100)]
        text = "\n".join(lines)
        chunks = _chunk_transcript(text, max_chars=500)
        if len(chunks) > 1:
            # Second chunk should start with [OVERLAP] lines
            assert "[OVERLAP]" in chunks[1]

    def test_chunk_overlap_preserves_content(self):
        """Test that overlap preserves the original content after [OVERLAP] prefix."""
        text = "\n".join([f"[0:00:{i:02d}.00] Content line {i}" for i in range(200)])
        chunks = _chunk_transcript(text, max_chars=1000)
        if len(chunks) > 1:
            # [OVERLAP] lines should still contain the original content
            overlap_lines = [l for l in chunks[1].split("\n") if l.startswith("[OVERLAP]")]
            for line in overlap_lines:
                assert "Content line" in line or "[0:" in line


# ---------------------------------------------------------------------------
# Clip Parsing Tests
# ---------------------------------------------------------------------------


class TestFindLists:
    """Tests for _find_lists function."""

    def test_find_json_array(self):
        """Test finding JSON array in text."""
        text = json.dumps([{"title": "Test", "start": 10, "end": 20}])
        lists = _find_lists(json.loads(text))
        assert len(lists) >= 1

    def test_find_json_object(self):
        """Test finding lists inside JSON object."""
        obj = {"clips": [{"title": "Test", "start": 10, "end": 20}]}
        lists = _find_lists(obj)
        assert len(lists) >= 1

    def test_find_no_json(self):
        """Test empty structure returns empty."""
        lists = _find_lists({})
        assert lists == []

    def test_find_multiple_jsons(self):
        """Test finding multiple lists in nested structure."""
        obj = {"first": [{"a": 1}], "second": [{"b": 2}]}
        lists = _find_lists(obj)
        assert len(lists) >= 2


class TestParseClips:
    """Tests for _parse_clips function."""

    def test_parse_valid_json_list(self):
        """Test parsing a valid JSON list of clips."""
        json_text = json.dumps([
            {
                "title": "Test Clip",
                "start": 10.0,
                "end": 40.0,
                "reason": "Test reason",
                "virality_score": 85,
                "brand_alignment": ["test pillar"],
                "hashtags": ["#Test"]
            }
        ])

        clips = _parse_clips(json_text)
        assert len(clips) == 1
        assert clips[0]["title"] == "Test Clip"
        assert clips[0]["start"] == 10.0
        assert clips[0]["end"] == 40.0

    def test_parse_valid_json_object(self):
        """Test parsing a single JSON object wrapped in list."""
        json_text = json.dumps([{
            "title": "Single Clip",
            "start": 5.0,
            "end": 35.0,
            "reason": "Because",
            "virality_score": 70,
            "brand_alignment": [],
            "hashtags": []
        }])

        clips = _parse_clips(json_text)
        assert len(clips) == 1
        assert clips[0]["title"] == "Single Clip"

    def test_parse_empty_list(self):
        """Test parsing empty list raises ValueError (no clips found)."""
        with pytest.raises(ValueError, match="No JSON found|no recognisable"):
            _parse_clips("[]")

    def test_parse_invalid_json(self):
        """Test parsing invalid JSON raises ValueError."""
        with pytest.raises(ValueError):
            _parse_clips("not valid json")

    def test_parse_missing_fields(self):
        """Test parsing clips with missing required fields - coerced clips need start/end."""
        json_text = json.dumps([{"title": "Incomplete"}])
        # _coerce_clip returns None for missing start/end, so no valid clips
        with pytest.raises(ValueError):
            _parse_clips(json_text)


# ---------------------------------------------------------------------------
# Clip Coercion Tests
# ---------------------------------------------------------------------------


class TestParseTimestamp:
    """Tests for _parse_timestamp function."""

    def test_float_value(self):
        assert _parse_timestamp(125.0) == 125.0
        assert _parse_timestamp(0) == 0.0
        assert _parse_timestamp(8615) == 8615.0

    def test_string_float(self):
        assert _parse_timestamp("125.0") == 125.0
        assert _parse_timestamp("8615") == 8615.0

    def test_hms_format(self):
        """Test H:MM:SS.ss format (same as transcript)."""
        assert _parse_timestamp("0:02:05.00") == 125.0
        assert _parse_timestamp("1:30:00.00") == 5400.0
        assert _parse_timestamp("2:23:35.00") == 8615.0
        assert _parse_timestamp("0:00:45.50") == 45.5

    def test_hms_no_decimal(self):
        """Test H:MM:SS format without decimals."""
        assert _parse_timestamp("0:02:05") == 125.0
        assert _parse_timestamp("2:23:35") == 8615.0

    def test_mmss_format(self):
        """Test MM:SS.ss format."""
        assert _parse_timestamp("2:05.00") == 125.0
        assert _parse_timestamp("45:30") == 2730.0

    def test_brackets_stripped(self):
        """Test that surrounding brackets are stripped."""
        assert _parse_timestamp("[2:23:35.00]") == 8615.0

    def test_none_returns_none(self):
        assert _parse_timestamp(None) is None

    def test_unparseable_returns_none(self):
        assert _parse_timestamp("not a time") is None


class TestCoerceClip:
    """Tests for _coerce_clip function."""

    def test_coerce_complete_clip(self):
        """Test coercing a complete clip."""
        clip = {
            "title": "Complete Clip",
            "start": 10.0,
            "end": 40.0,
            "reason": "Test",
            "virality_score": 85,
            "brand_alignment": ["pillar"],
            "hashtags": ["#Tag"]
        }

        coerced = _coerce_clip(clip)

        assert coerced["title"] == "Complete Clip"
        assert coerced["start"] == 10.0
        assert coerced["end"] == 40.0
        assert coerced["virality_score"] == 85

    def test_coerce_clip_string_times(self):
        """Test coercing clip with string timestamps."""
        clip = {
            "title": "String Times",
            "start": "10.5",
            "end": "40.5",
        }

        coerced = _coerce_clip(clip)

        assert coerced["start"] == 10.5
        assert coerced["end"] == 40.5

    def test_coerce_clip_hms_times(self):
        """Test coercing clip with H:MM:SS.ss timestamps (transcript format)."""
        clip = {
            "title": "HMS Clip",
            "start": "2:23:35.00",
            "end": "2:24:15.00",
        }

        coerced = _coerce_clip(clip)

        assert coerced["start"] == 8615.0
        assert coerced["end"] == 8655.0

    def test_coerce_clip_start_zero(self):
        """Test coercing clip with start=0 (falsy value)."""
        clip = {"title": "Complete", "start": 0, "end": 60}
        coerced = _coerce_clip(clip)
        assert coerced is not None
        assert coerced["title"] == "Complete"
        assert coerced["start"] == 0.0

    def test_coerce_clip_missing_fields(self):
        """Test coercing clip with missing required fields returns None."""
        clip = {"title": "Minimal"}
        coerced = _coerce_clip(clip)
        assert coerced is None

    def test_coerce_clip_score_bounds(self):
        """Test that virality score is clamped to 0-100."""
        # Score > 100
        clip_high = {"title": "High", "start": 5, "end": 60, "virality_score": 150}
        coerced_high = _coerce_clip(clip_high)
        assert coerced_high is not None
        assert coerced_high["virality_score"] <= 100

        # Score < 0
        clip_low = {"title": "Low", "start": 5, "end": 60, "virality_score": -20}
        coerced_low = _coerce_clip(clip_low)
        assert coerced_low is not None
        assert coerced_low["virality_score"] >= 0


# ---------------------------------------------------------------------------
# Transcript to Text Tests
# ---------------------------------------------------------------------------


class TestTranscriptToText:
    """Tests for transcript_to_text function (from pipeline.transcription)."""

    def test_transcript_to_text_empty(self):
        """Test converting empty transcript."""
        from pipeline.transcription import transcript_to_text
        result = transcript_to_text({"segments": []})
        assert result == ""

    def test_transcript_to_text_single_segment(self):
        """Test converting single segment transcript."""
        from pipeline.transcription import transcript_to_text
        transcript = {
            "segments": [{"text": "Hello world", "start": 0, "end": 5}]
        }
        result = transcript_to_text(transcript)
        assert "Hello world" in result

    def test_transcript_to_text_multiple_segments(self):
        """Test converting multiple segments."""
        from pipeline.transcription import transcript_to_text
        transcript = {
            "segments": [
                {"text": "First segment", "start": 0, "end": 5},
                {"text": "Second segment", "start": 10, "end": 15},
                {"text": "Third segment", "start": 20, "end": 25}
            ]
        }
        result = transcript_to_text(transcript)
        assert "First segment" in result
        assert "Second segment" in result
        assert "Third segment" in result

    def test_transcript_to_text_preserves_order(self):
        """Test that segment order is preserved."""
        from pipeline.transcription import transcript_to_text
        transcript = {
            "segments": [
                {"text": "A", "start": 0, "end": 1},
                {"text": "B", "start": 2, "end": 3},
                {"text": "C", "start": 4, "end": 5}
            ]
        }
        result = transcript_to_text(transcript)
        assert result.index("A") < result.index("B") < result.index("C")