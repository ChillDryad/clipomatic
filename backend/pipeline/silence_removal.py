"""
Silence removal — detects and removes silent gaps from clips.

Uses transcript word timestamps (from Whisper) and audio energy analysis
to identify silences, then computes "keep segments" — the parts of the
clip that should be preserved. A dynamic noise floor preserves meaningful
background audio (game music, sound effects) even when the streamer
isn't speaking.
"""

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class KeepSegment:
    """A time segment to preserve after silence removal."""
    start: float  # original timeline seconds
    end: float     # original timeline seconds


@dataclass
class SilenceRemovalResult:
    """Result of silence detection and removal."""
    keep_segments: list[KeepSegment]
    removed_silences: list[tuple[float, float]]  # (start, end) of each gap
    original_duration: float
    output_duration: float


def compute_dynamic_noise_floor(audio_energy: list[dict]) -> float:
    """Compute a dynamic noise floor from per-second audio energy data.

    Uses the 25th percentile of RMS values as a baseline, multiplied by 2.0.
    This adapts to each stream: quiet streams get a low threshold (preserving
    more audio), noisy streams get a higher one (only cutting true dead air).

    Returns at least 0.01 to avoid cutting near-silent but meaningful audio.
    """
    if not audio_energy:
        return 0.01

    rms_values = sorted(seg["rms"] for seg in audio_energy)
    if not rms_values:
        return 0.01

    # 25th percentile — the "quiet but present" baseline
    p25_idx = max(0, len(rms_values) // 4)
    p25 = rms_values[p25_idx]

    # Noise floor: 2x the quiet baseline, minimum 0.01
    return max(p25 * 2.0, 0.01)


def _merge_intervals(intervals: list[tuple[float, float]], gap: float = 0.0) -> list[tuple[float, float]]:
    """Merge overlapping or adjacent intervals.

    Args:
        intervals: Sorted list of (start, end) tuples.
        gap: Merge intervals separated by less than this many seconds.

    Returns:
        Merged list of (start, end) tuples.
    """
    if not intervals:
        return []

    merged = [intervals[0]]
    for start, end in intervals[1:]:
        if start <= merged[-1][1] + gap:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def detect_keep_segments(
    transcript: dict,
    audio_energy: list[dict] | None = None,
    clip_start: float = 0.0,
    clip_end: float = 0.0,
    min_silence: float = 1.0,
    min_output_duration: float = 3.0,
    padding: float = 0.15,
) -> SilenceRemovalResult:
    """Detect silent gaps within a clip and return segments to keep.

    Combines transcript word timestamps (for speech) with audio energy
    data (for background audio like game music) to identify silences worth
    removing. Preserves segments where meaningful audio is present even
    without speech.

    Args:
        transcript: Transcript dict with segments containing word timestamps.
        audio_energy: Per-second audio energy data from analyze_audio_energy().
        clip_start: Start time of the clip in seconds.
        clip_end: End time of the clip in seconds.
        min_silence: Minimum silence gap in seconds to remove (default 1.0).
        min_output_duration: Minimum output duration; fall back if shorter (default 3.0).
        padding: Seconds of breathing room around each word (default 0.15).

    Returns:
        SilenceRemovalResult with keep_segments, removed_silences, and durations.
    """
    if clip_end <= clip_start:
        return SilenceRemovalResult(
            keep_segments=[KeepSegment(start=clip_start, end=clip_end)],
            removed_silences=[],
            original_duration=0.0,
            output_duration=0.0,
        )

    original_duration = clip_end - clip_start

    # 1. Build speech intervals from word timestamps
    speech_intervals: list[tuple[float, float]] = []
    for seg in transcript.get("segments", []):
        for w in seg.get("words", []):
            if "start" in w and "end" in w:
                w_start = w["start"] - padding
                w_end = w["end"] + padding
                if w_end > clip_start and w_start < clip_end:
                    speech_intervals.append(
                        (max(w_start, clip_start), min(w_end, clip_end))
                    )

    speech_intervals.sort()

    # 2. Build audio-activity intervals from energy data
    noise_floor = compute_dynamic_noise_floor(audio_energy) if audio_energy else 0.01
    audio_intervals: list[tuple[float, float]] = []

    if audio_energy:
        for seg in audio_energy:
            # A segment is "active" if it has meaningful audio above the noise floor
            has_speech = seg.get("silence_ratio", 1.0) < 0.7
            has_energy = seg.get("rms", 0.0) > noise_floor
            has_peak = seg.get("peak", 0.0) > noise_floor * 3
            is_spike = seg.get("is_spike", False)

            if has_speech or has_energy or has_peak or is_spike:
                s_start = max(seg["start"], clip_start)
                s_end = min(seg["end"], clip_end)
                if s_end > s_start:
                    audio_intervals.append((s_start, s_end))

    audio_intervals.sort()

    # 3. Union speech + audio-activity intervals
    all_intervals = sorted(speech_intervals + audio_intervals)
    merged = _merge_intervals(all_intervals, gap=0.0)

    if not merged:
        # No speech or audio activity found — fall back to original clip
        return SilenceRemovalResult(
            keep_segments=[KeepSegment(start=clip_start, end=clip_end)],
            removed_silences=[],
            original_duration=original_duration,
            output_duration=original_duration,
        )

    # 4. Merge short gaps (gaps < min_silence are too short to cut)
    # Invert: find gaps between keep intervals
    merged_with_short_gaps: list[tuple[float, float]] = [merged[0]]
    for start, end in merged[1:]:
        prev_end = merged_with_short_gaps[-1][1]
        gap_duration = start - prev_end
        if gap_duration < min_silence:
            # Gap too short — merge with previous interval
            merged_with_short_gaps[-1] = (merged_with_short_gaps[-1][0], end)
        else:
            merged_with_short_gaps.append((start, end))

    # 5. Build keep_segments and removed_silences
    keep_segments: list[KeepSegment] = []
    removed_silences: list[tuple[float, float]] = []

    # Add silence before first keep segment
    if merged_with_short_gaps[0][0] > clip_start:
        removed_silences.append((clip_start, merged_with_short_gaps[0][0]))

    for i, (start, end) in enumerate(merged_with_short_gaps):
        keep_segments.append(KeepSegment(start=start, end=end))
        # Add silence between keep segments
        if i + 1 < len(merged_with_short_gaps):
            next_start = merged_with_short_gaps[i + 1][0]
            if next_start - end >= min_silence:
                removed_silences.append((end, next_start))

    # Add silence after last keep segment
    if merged_with_short_gaps[-1][1] < clip_end:
        removed_silences.append((merged_with_short_gaps[-1][1], clip_end))

    # 6. Validate output
    output_duration = sum(seg.end - seg.start for seg in keep_segments)

    if output_duration < min_output_duration:
        # Output too short after silence removal — fall back
        logger.info(
            f"Silence removal would produce {output_duration:.1f}s output "
            f"(min {min_output_duration:.1f}s) — falling back to original clip"
        )
        return SilenceRemovalResult(
            keep_segments=[KeepSegment(start=clip_start, end=clip_end)],
            removed_silences=[],
            original_duration=original_duration,
            output_duration=original_duration,
        )

    if len(keep_segments) <= 1:
        # No meaningful silences found — single segment covers the whole clip
        return SilenceRemovalResult(
            keep_segments=[KeepSegment(start=clip_start, end=clip_end)],
            removed_silences=[],
            original_duration=original_duration,
            output_duration=original_duration,
        )

    return SilenceRemovalResult(
        keep_segments=keep_segments,
        removed_silences=removed_silences,
        original_duration=original_duration,
        output_duration=output_duration,
    )


def remap_time(t: float, keep_segments: list[KeepSegment], clip_start: float) -> float:
    """Remap a timestamp from the original timeline to the output timeline.

    Subtracts cumulative removed silence before time `t` so that
    subtitles, SFX, and zoom effects land at the correct output position.

    Args:
        t: Original timeline time in seconds.
        keep_segments: List of KeepSegment objects (sorted by start).
        clip_start: Start time of the original clip.

    Returns:
        Remapped time in the output timeline (relative to clip start).
    """
    if not keep_segments:
        return max(t - clip_start, 0.0)

    removed_before_t = 0.0
    for i, seg in enumerate(keep_segments):
        if t < seg.start:
            # Time is in a gap before this segment
            break
        if t >= seg.start:
            # Add gap before this segment
            if i == 0:
                removed_before_t += seg.start - clip_start
            else:
                removed_before_t += seg.start - keep_segments[i - 1].end

        if t <= seg.end:
            # Time is within this segment
            break
    else:
        # Time is after all segments — add remaining gap
        pass

    return max(t - clip_start - removed_before_t, 0.0)


def remap_segments(
    segments: list[dict],
    clip_start: float,
    keep_segments: list[KeepSegment],
) -> list[dict]:
    """Remap word timestamps in transcript segments for silence-removed output.

    Words that fall in removed silences are dropped. Surviving words have
    their timestamps shifted to output-relative positions.

    Args:
        segments: Transcript segment list with word-level timestamps.
        clip_start: Start time of the original clip.
        keep_segments: Keep segments from detect_keep_segments().

    Returns:
        New segment list with remapped timestamps.
    """
    # Build a set of valid time ranges for quick lookup
    keep_ranges = [(seg.start, seg.end) for seg in keep_segments]

    def is_in_keep_range(t: float) -> bool:
        for ks, ke in keep_ranges:
            if ks <= t <= ke:
                return True
        return False

    remapped: list[dict] = []

    for seg in segments:
        new_words = []
        for w in seg.get("words", []):
            if "start" not in w or "end" not in w:
                continue
            w_start = w["start"]
            w_end = w["end"]

            # Skip words that start in a removed silence
            if not is_in_keep_range(w_start):
                continue

            new_start = remap_time(w_start, keep_segments, clip_start)
            new_end = remap_time(w_end, keep_segments, clip_start)

            # Skip words with invalid durations after remapping
            if new_end <= new_start:
                continue

            new_words.append({
                "word": w["word"],
                "start": round(new_start, 3),
                "end": round(new_end, 3),
                "probability": w.get("probability", 1.0),
            })

        if new_words:
            remapped.append({
                "start": new_words[0]["start"],
                "end": new_words[-1]["end"],
                "text": " ".join(w["word"].strip() for w in new_words),
                "words": new_words,
            })

    return remapped