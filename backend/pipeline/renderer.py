"""
Renderer — builds ASS subtitle files and runs the FFmpeg stacked-layout filtergraph.
"""

import logging
import os
import re
import subprocess
import tempfile
import uuid
from dataclasses import dataclass

from pipeline.media import extract_frame, get_video_dimensions  # noqa: F401 — re-exported for api.py
from pipeline.silence_removal import KeepSegment, remap_time, remap_segments  # noqa: F401

logger = logging.getLogger(__name__)


@dataclass
class CropBox:
    x: int
    y: int
    w: int
    h: int


@dataclass
class ZoomEffect:
    """Configure a zoom effect for the start of a clip.

    start_scale: Initial zoom factor (1.0 = no zoom, 1.5 = 50% zoomed in)
    end_scale: Final zoom factor at zoom_duration (1.0 = normal framing)
    zoom_duration: How many seconds the zoom transition takes
    easing: Easing function — "ease_out" (starts fast, decelerates) or "linear"
    """
    start_scale: float = 1.5
    end_scale: float = 1.0
    zoom_duration: float = 1.0
    easing: str = "ease_out"


_NVENC_AVAILABLE: bool | None = None


def _nvenc_available() -> bool:
    """Check if h264_nvenc encoder is available (cached after first call)."""
    global _NVENC_AVAILABLE
    if _NVENC_AVAILABLE is not None:
        return _NVENC_AVAILABLE
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-encoders"],
        capture_output=True,
        text=True,
    )
    _NVENC_AVAILABLE = "h264_nvenc" in result.stdout
    return _NVENC_AVAILABLE


def _build_zoom_expression(zoom: ZoomEffect, fps: int = 30) -> str:
    """Build FFmpeg zoompan z= expression for a zoom effect.

    The zoompan filter generates frames with per-frame zoom values.
    On frames 0 through zoom_frames, zoom transitions from start_scale to end_scale.
    After that, zoom stays at end_scale.

    Escaping: inside the zoompan filter value, colons separate parameters.
    The z expression is enclosed in single quotes in the filtergraph, so
    we escape single quotes and commas that appear inside the expression.
    """
    zoom_frames = int(zoom.zoom_duration * fps)
    if zoom_frames <= 0:
        return f"{zoom.end_scale}"

    s = zoom.start_scale
    e = zoom.end_scale

    if zoom.easing == "ease_out":
        # Ease-out: starts fast (zoomed in), decelerates to end_scale
        # z(on) = S - (S-E) * (1 - (1 - on/ZF)^2)
        return (
            f"if(lte(on\\,{zoom_frames})"
            f"\\,{s}-({s}-{e})*(1-(1-on/{zoom_frames})^2)"
            f"\\,{e})"
        )
    else:
        # Linear interpolation
        return (
            f"if(lte(on\\,{zoom_frames})"
            f"\\,{s}+({e}-{s})*on/{zoom_frames}"
            f"\\,{e})"
        )


_QUALITY_SETTINGS: dict[str, dict] = {
    "standard": {
        "preset": "medium",
        "crf": "18",
        "tune": "film",
        "level": "4.0",
        "audio_bitrate": "192k",
    },
    "production": {
        "preset": "veryslow",
        "crf": "12",
        "tune": "grain",
        "level": "4.2",
        "audio_bitrate": "320k",
    },
    "fast": {
        "preset": "fast",
        "crf": "23",
        "tune": "fastdecode",
        "level": "4.0",
        "audio_bitrate": "128k",
    },
    "nvenc": {
        "encoder": "h264_nvenc",
        "preset": "p4",
        "tune": "hq",
        "level": "auto",
        "audio_bitrate": "192k",
    },
}


def _escape_ass_path(path: str) -> str:
    path = path.replace("\\", "/").replace(":", "\\:")
    return path.replace("'", "'\"'\"'")


def _build_crop_filter(
    input_label: str,
    output_label: str,
    crop: CropBox,
    start: float,
    end: float,
    target_w: int,
    target_h: int,
) -> str:
    return (
        f"{input_label}"
        f"setpts=PTS-STARTPTS,"
        f"trim=start={start}:end={end},setpts=PTS-STARTPTS,"
        f"crop={crop.w}:{crop.h}:{crop.x}:{crop.y},"
        f"scale={target_w}:{target_h}:flags=bicubic,"
        f"setsar=1{output_label}"
    )


# ---------------------------------------------------------------------------
# ASS subtitle generation (karaoke word-highlight style)
# ---------------------------------------------------------------------------


def _seconds_to_ass_time(seconds: float) -> str:
    """Convert float seconds to ASS timestamp H:MM:SS.cc"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    cs = round((s % 1) * 100)  # centiseconds
    return f"{h}:{m:02d}:{int(s):02d}.{cs:02d}"


def _hex_to_ass(html_hex: str, default: str = "&H00FFFFFF") -> str:
    """Convert #RRGGBB or #RRGGBBAA to ASS &HAABBGGRR format."""
    h = html_hex.lstrip("#")
    if len(h) == 6:
        r, g, b = h[0:2], h[2:4], h[4:6]
        return f"&H00{b}{g}{r}"
    if len(h) == 8:
        r, g, b, a = h[0:2], h[2:4], h[4:6], h[6:8]
        return f"&H{a}{b}{g}{r}"
    return default  # fallback


def _build_ass_header(
    font_name: str,
    font_size: int,
    primary: str,
    secondary: str,
    outline: str,
    outline_width: float,
    shadow_with_alpha: str,
    output_width: int,
    output_height: int,
    alignment: int = 2,
    margin_v: int = 970,
) -> str:
    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {output_width}
PlayResY: {output_height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{font_size},{primary},{secondary},{outline},&H00000000,1,0,0,0,100,100,0,0,1,{outline_width},{shadow_with_alpha},{alignment},20,20,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _ass_style_header(
    font_name: str,
    font_size: int,
    font_color: str,
    highlight_color: str,
    outline_color: str,
    outline_width: float,
    shadow_color: str,
    shadow_opacity: float,
    output_width: int,
    output_height: int,
    layout_mode: str = "stacked",
    style_preset: str | None = None,
) -> str:
    """Build the shared ASS header + style block, factoring out duplicated hex conversions.

    style_preset: Optional preset name (tiktok_viral, youtube_pro, instagram_reels) to override style settings.
    """
    # Apply preset overrides if specified
    if style_preset and style_preset in _STYLE_PRESETS:
        preset = _STYLE_PRESETS[style_preset]
        font_name = preset.get("font", font_name)
        font_size = preset.get("size", font_size)
        font_color = preset.get("primary", font_color)
        highlight_color = preset.get("highlight", highlight_color)
        outline_color = preset.get("outline", outline_color)
        outline_width = preset.get("outline_width", outline_width)

    primary = font_color if font_color.startswith("&H") else _hex_to_ass(font_color)
    secondary = (
        highlight_color
        if highlight_color.startswith("&H")
        else _hex_to_ass(highlight_color, highlight_color)
    )
    outline = (
        outline_color if outline_color.startswith("&H") else _hex_to_ass(outline_color)
    )
    shadow = (
        shadow_color if shadow_color.startswith("&H") else _hex_to_ass(shadow_color)
    )
    shadow_alpha = int(shadow_opacity * 255)
    shadow_with_alpha = f"&H{shadow_alpha:02X}{shadow[3:]}"

    # Position subtitles in upper 25% for camera_only/gameplay_only modes
    # For stacked mode, subtitles are at bottom (default)
    if layout_mode in ("camera_only", "gameplay_only"):
        alignment = 8  # Top Center
        margin_v = 50  # 50px from top (upper 25% of 1920px frame)
    else:
        alignment = 2  # Bottom Center
        margin_v = 970  # Default bottom position

    return _build_ass_header(
        font_name,
        font_size,
        primary,
        secondary,
        outline,
        outline_width,
        shadow_with_alpha,
        output_width,
        output_height,
        alignment,
        margin_v,
    )


# ---------------------------------------------------------------------------
# Animation style generators (Phase 1: pop, bounce)
# ---------------------------------------------------------------------------


def _generate_pop_animation(word: str, duration_ms: int = 180) -> str:
    """
    Pop animation: scale 50% → 115% → 100%

    ASS tags:
    - \\fscx/\\fscy: Font scale X/Y
    - \\t(start,end,transform): Animate over milliseconds

    Example: {\\fscx50\\fscy50\\t(0,80,\\fscx115\\fscy115)\\t(80,180,\\fscx100\\fscy100)}Word
    """
    return f"{{\\fscx50\\fscy50\\t(0,80,\\fscx115\\fscy115)\\t(80,{duration_ms},\\fscx100\\fscy100)}}{word}"


def _generate_bounce_animation(word: str, duration_ms: int = 280) -> str:
    """
    Bounce from below with overshoot

    ASS tags:
    - \\move(x1,y1,x2,y2): Move from (x1,y1) to (x2,y2)
    - \\t(): Scale overshoot (115% → 95% → 100%)

    Example: {\\move(540,1100,540,960)\\t(0,120,\\fscx115\\fscy115)\\t(120,200,\\fscx95\\fscy95)\\t(200,280,\\fscx100\\fscy100)}Word
    """
    # Calculate timing phases for overshoot effect
    phase1 = int(duration_ms * 0.43)  # ~120ms for initial bounce
    phase2 = int(duration_ms * 0.71)  # ~200ms for first overshoot
    phase3 = duration_ms              # ~280ms for settle

    return (
        f"{{\\move(540,1100,540,960)"
        f"\\t(0,{phase1},\\fscx115\\fscy115)"
        f"\\t({phase1},{phase2},\\fscx95\\fscy95)"
        f"\\t({phase2},{phase3},\\fscx100\\fscy100)}}{word}"
    )


_SPEED_MAP = {
    "fast": {"pop_duration": 120, "bounce_duration": 200},
    "normal": {"pop_duration": 180, "bounce_duration": 280},
    "slow": {"pop_duration": 250, "bounce_duration": 400},
}


_STYLE_PRESETS = {
    "tiktok_viral": {
        "font": "Arial Black",
        "size": 84,
        "primary": "&H00FFFFFF",
        "highlight": "&H0000FFFF",
        "outline": "&H00000000",
        "outline_width": 6.0,
        "margin_v": 300,
    },
    "youtube_pro": {
        "font": "Arial",
        "size": 72,
        "primary": "&H00FFFFFF",
        "highlight": "&H00FFD700",
        "outline": "&H00333333",
        "outline_width": 4.0,
        "margin_v": 280,
    },
    "instagram_reels": {
        "font": "Impact",
        "size": 80,
        "primary": "&H00FFFFFF",
        "highlight": "&H00FF00FF",
        "outline": "&H00000000",
        "outline_width": 5.0,
        "margin_v": 260,
    },
}


def _build_ass_word_by_word(
    segments: list[dict],
    clip_start: float,
    clip_end: float,
    font_name: str = "Arial",
    font_color: str = "&H00FFFFFF",
    highlight_color: str = "&H0000FFFF",
    outline_color: str = "&H00000000",
    outline_width: float = 2.0,
    shadow_color: str = "&H00000000",
    shadow_opacity: float = 0.5,
    font_size: int = 22,
    output_height: int = 1920,
    output_width: int = 1080,
    fade_in_ms: int = 0,
    caption_style: str = "karaoke",
    words_per_line: int = 1,
    layout_mode: str = "stacked",
    animation_speed: str | None = None,
    style_preset: str | None = None,
) -> str:
    """
    Generate an ASS subtitle file with CapCut-style per-word karaoke.

    When words_per_line=1 (default), each word gets its own Dialogue line.
    When words_per_line>1, words are grouped into lines of that many words,
    creating a more traditional multi-word subtitle appearance.

    caption_style controls how the highlight is applied:
    - "karaoke" (default): uses \\kf for animated sweep fill highlight
    - "capcut": uses solid highlight — the word appears instantly highlighted
      with no sweep animation, using \\c to switch to highlight color
    - "pop": words bounce in with scale animation (50% → 115% → 100%)
    - "bounce": words bounce up from below frame with overshoot

    animation_speed: "fast", "normal", or "slow" — affects pop/bounce duration

    A short fade-in softens word entrance. No fade-out within the word's window —
    the next word's line simply replaces it cleanly.

    For segments without word timestamps, outputs a single Dialogue line.
    """
    header = _ass_style_header(
        font_name,
        font_size,
        font_color,
        highlight_color,
        outline_color,
        outline_width,
        shadow_color,
        shadow_opacity,
        output_width,
        output_height,
        layout_mode,
    )

    words_out: list[tuple[float, float, str]] = []
    for seg in segments:
        seg_start = seg["start"]
        seg_end = seg["end"]
        if seg_end <= clip_start or seg_start >= clip_end:
            continue
        wlist = seg.get("words", [])
        if not wlist:
            t0 = max(seg_start - clip_start, 0.0)
            t1 = min(seg_end - clip_start, clip_end - clip_start)
            text = seg.get("text", "").strip()
            if text:
                words_out.append((t0, t1, text))
        else:
            for w in wlist:
                w0, w1 = w["start"], w["end"]
                if w1 <= clip_start or w0 >= clip_end:
                    continue
                t0 = max(w0 - clip_start, 0.0)
                t1 = min(w1 - clip_start, clip_end - clip_start)
                word_text = w["word"].strip()
                if word_text:
                    words_out.append((t0, t1, word_text))

    words_out.sort(key=lambda x: x[0])
    lines = [header]
    if not words_out:
        return "".join(lines)

    if words_per_line <= 1:
        # One word per line mode
        # Default to "normal" if animation_speed is None or invalid
        speed_config = _SPEED_MAP.get(animation_speed or "normal", _SPEED_MAP["normal"])

        for i, (t0, t1, text) in enumerate(words_out):
            if t1 <= t0:
                continue
            # Each word displays for its natural duration, with a minimum of 0.2s
            # and extends slightly past the next word's start for smoother reading
            word_duration = t1 - t0
            if i + 1 < len(words_out):
                next_t0 = words_out[i + 1][0]
                # End at next word start, but ensure minimum display time
                t_end = max(next_t0, t0 + max(word_duration, 0.2))
            else:
                # Last word: add extra display time
                t_end = t1 + 0.3

            # Fade in/out: quick fade in, noticeable fade out
            fade_out_ms = 150
            fade_tag = f"{{\\fad({fade_in_ms},{fade_out_ms})}}"

            if caption_style == "capcut":
                ass_highlight = _hex_to_ass(highlight_color)
                dialogue_text = f"{{\\c{ass_highlight}}}{text}"
            elif caption_style == "pop":
                pop_dur = speed_config["pop_duration"]
                dialogue_text = _generate_pop_animation(text, pop_dur)
            elif caption_style == "bounce":
                bounce_dur = speed_config["bounce_duration"]
                dialogue_text = _generate_bounce_animation(text, bounce_dur)
            else:
                # Default karaoke style
                kf_dur = max(1, round((t1 - t0) * 100))
                dialogue_text = f"{{\\kf{kf_dur}}}{text}"

            lines.append(
                f"Dialogue: 0,{_seconds_to_ass_time(t0)},"
                f"{_seconds_to_ass_time(t_end)},Default,,0,0,0,,"
                f"{fade_tag}{dialogue_text}\n"
            )
    else:
        # Multi-word per line mode - group words into chunks
        i = 0
        while i < len(words_out):
            group = words_out[i : i + words_per_line]
            if not group:
                i += 1
                continue

            # Line spans from first word start to last word end
            line_t0 = group[0][0]
            line_t1 = group[-1][1]

            if line_t1 <= line_t0:
                i += words_per_line
                continue

            # Fade in/out: quick fade in, noticeable fade out
            fade_out_ms = 150
            fade_tag = f"{{\\fad({fade_in_ms},{fade_out_ms})}}"

            # Common positioning for multi-word line
            base_x = 540  # Center of 1080 width output
            word_spacing = 60  # Approximate pixels per word
            start_offset = -((len(group) - 1) * word_spacing) / 2
            pos_y = 50 if layout_mode in ("camera_only", "gameplay_only") else 950

            if caption_style == "capcut":
                ass_highlight = _hex_to_ass(highlight_color)
                for wi, (w_t0, w_t1, w_text) in enumerate(group):
                    if w_t1 <= w_t0:
                        continue
                    # Each word displays for its natural duration with minimum 0.2s
                    word_duration = w_t1 - w_t0
                    if wi + 1 < len(group):
                        w_end = max(group[wi + 1][0], w_t0 + max(word_duration, 0.2))
                    else:
                        w_end = w_t1 + 0.3

                    pos_x = base_x + start_offset + wi * word_spacing
                    word_tag = f"{{\\pos({pos_x},{pos_y})\\c{ass_highlight}}}{w_text}"

                    lines.append(
                        f"Dialogue: 0,{_seconds_to_ass_time(w_t0)},"
                        f"{_seconds_to_ass_time(w_end)},Default,,0,0,0,,"
                        f"{fade_tag}{word_tag}\n"
                    )

            elif caption_style in ("pop", "bounce"):
                # Each word animates independently at its own timestamp
                # Default to "normal" if animation_speed is None or invalid
                speed_config = _SPEED_MAP.get(animation_speed or "normal", _SPEED_MAP["normal"])
                for wi, (w_t0, w_t1, w_text) in enumerate(group):
                    if w_t1 <= w_t0:
                        continue
                    # Each word displays for its natural duration with minimum 0.2s
                    word_duration = w_t1 - w_t0
                    if wi + 1 < len(group):
                        w_end = max(group[wi + 1][0], w_t0 + max(word_duration, 0.2))
                    else:
                        w_end = w_t1 + 0.3

                    pos_x = base_x + start_offset + wi * word_spacing

                    if caption_style == "pop":
                        pop_dur = speed_config["pop_duration"]
                        word_tag = _generate_pop_animation(w_text, pop_dur)
                    else:
                        bounce_dur = speed_config["bounce_duration"]
                        word_tag = _generate_bounce_animation(w_text, bounce_dur)

                    lines.append(
                        f"Dialogue: 0,{_seconds_to_ass_time(w_t0)},"
                        f"{_seconds_to_ass_time(w_end)},Default,,0,0,0,,"
                        f"{fade_tag}{{\\pos({pos_x},{pos_y})}}{word_tag}\n"
                    )

            else:
                # Karaoke style - grouped approach (single Dialogue line per word group)
                text_parts = []
                for w_t0, w_t1, w_text in group:
                    kf_dur = max(1, round((w_t1 - w_t0) * 100))
                    text_parts.append(f"{{\\kf{kf_dur}}}{w_text} ")

                dialogue_text = "".join(text_parts).strip()

                lines.append(
                    f"Dialogue: 0,{_seconds_to_ass_time(line_t0)},"
                    f"{_seconds_to_ass_time(line_t1)},Default,,0,0,0,,"
                    f"{fade_tag}{dialogue_text}\n"
                )

            i += words_per_line

    return "".join(lines)


# ---------------------------------------------------------------------------
# FFmpeg rendering
# ---------------------------------------------------------------------------


def render_clip(
    video_path: str,
    clip: dict,
    crop_avatar: CropBox,
    crop_game: CropBox,
    segments: list[dict],
    output_dir: str,
    font_name: str = "Arial",
    font_color: str = "#FFFFFF",
    highlight_color: str = "#FFFF00",
    outline_color: str = "#000000",
    outline_width: float = 2.0,
    shadow_depth: float = 1.0,
    shadow_color: str = "#000000",
    shadow_opacity: float = 0.5,
    font_size: int = 22,
    output_width: int = 1080,
    output_height: int = 1920,
    subtitle_fade_in_ms: int = 0,
    subtitle_fade_out_ms: int = 0,
    caption_style: str = "karaoke",
    words_per_line: int = 1,
    quality_preset: str = "standard",
    layout_mode: str = "stacked",
    animation_speed: str = "normal",
    style_preset: str | None = None,
    thumbnail_path: str | None = None,
    thumbnail_duration: float = 5.0,
    zoom_effect: ZoomEffect | None = None,
    sfx_placements: list | None = None,
    workspace_dir: str | None = None,
    keep_segments: list[KeepSegment] | None = None,
) -> str:
    """
    Render a single clip to a 9:16 vertical MP4 with per-word karaoke subtitles.

    caption_style: "karaoke" for sweep highlight, "capcut" for solid highlight,
                   "pop" for word bounce in, "bounce" for words bouncing from below.
    words_per_line: 1 for word-by-word, 2-4 for multi-word subtitle style.
    animation_speed: "fast", "normal", or "slow" — affects pop/bounce duration.
    style_preset: Optional preset (tiktok_viral, youtube_pro, instagram_reels) for font/size/colors.
    quality_preset: "standard" or "production" for FFmpeg encoding settings.
    layout_mode: "stacked" (gameplay top, avatar bottom),
                 "camera_only" (avatar full-frame),
                 "gameplay_only" (gameplay full-frame).

    Returns the path to the rendered .mp4 file.
    """
    os.makedirs(output_dir, exist_ok=True)

    start = float(clip["start"])
    end = float(clip["end"])
    duration = end - start

    if duration <= 0:
        raise ValueError(f"Invalid clip duration: start={start}, end={end}")

    # Validate input video exists and has sufficient duration
    if not os.path.exists(video_path):
        raise RuntimeError(f"Input video file not found: {video_path}")

    # Check video duration using ffprobe to catch empty/corrupted segments
    import subprocess
    import json

    probe_cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        video_path,
    ]
    result = subprocess.run(probe_cmd, capture_output=True, text=True)
    if result.returncode == 0 and result.stdout.strip():
        try:
            data = json.loads(result.stdout)
            video_duration = float(data.get("format", {}).get("duration", 0))
            if video_duration <= 0:
                raise RuntimeError(
                    f"Input video has zero duration - segment download failed or returned empty content. "
                    f"Requested clip: {start:.1f}s to {end:.1f}s ({duration:.1f}s total). "
                    f"File: {video_path}"
                )
            if video_duration < duration:
                shortfall = duration - video_duration
                if shortfall > 5.0:
                    raise RuntimeError(
                        f"Input video duration ({video_duration:.1f}s) is much shorter than requested clip ({duration:.1f}s). "
                        f"Requested clip: {start:.1f}s to {end:.1f}s. "
                        f"This likely indicates a failed segment download. File: {video_path}"
                    )
                # Small shortfall — clamp to actual video duration
                logger.info(
                    f"Clamping clip end from {end:.1f}s to {start + video_duration:.1f}s "
                    f"(video {video_duration:.1f}s, clip {duration:.1f}s, shortfall {shortfall:.1f}s)"
                )
                end = start + video_duration
                duration = video_duration
                # Clamp keep_segments so no segment extends past the video
                if keep_segments:
                    keep_segments = [
                        KeepSegment(start=seg.start, end=min(seg.end, end))
                        for seg in keep_segments
                        if seg.start < end
                    ]
                    keep_segments = [seg for seg in keep_segments if seg.end > seg.start]
        except (json.JSONDecodeError, KeyError, ValueError):
            pass  # If we can't parse duration, proceed and let ffmpeg fail with more info

    half_h = output_height // 2  # each panel takes half the output height

    if layout_mode == "camera_only" and not crop_avatar:
        raise ValueError("layout_mode='camera_only' requires crop_avatar")
    if layout_mode == "gameplay_only" and not crop_game:
        raise ValueError("layout_mode='gameplay_only' requires crop_game")

    # Determine effective duration (may be shorter after silence removal)
    use_silence_removal = keep_segments is not None and len(keep_segments) > 1
    if use_silence_removal:
        output_duration = sum(seg.end - seg.start for seg in keep_segments)
        # Remap subtitle timestamps for silence-removed output
        segments = remap_segments(segments, start, keep_segments)
        effective_start = 0.0
        effective_end = output_duration
    else:
        output_duration = duration
        effective_start = start
        effective_end = end

    # Validate crop dimensions before calling FFmpeg
    for label, crop in [("crop_avatar", crop_avatar), ("crop_game", crop_game)]:
        if crop is not None and (
            crop.w <= 0 or crop.h <= 0 or crop.x < 0 or crop.y < 0
        ):
            raise ValueError(
                f"Invalid {label}: x={crop.x}, y={crop.y}, w={crop.w}, h={crop.h} — "
                f"all dimensions must be positive"
            )

    # ---- Build ASS subtitle file (per-word karaoke, CapCut style) ----
    ass_content = _build_ass_word_by_word(
        segments=segments,
        clip_start=effective_start,
        clip_end=effective_end,
        font_name=font_name,
        font_color=font_color,
        highlight_color=highlight_color,
        outline_color=outline_color,
        outline_width=outline_width,
        shadow_color=shadow_color,
        shadow_opacity=shadow_opacity,
        font_size=font_size,
        output_height=output_height,
        output_width=output_width,
        fade_in_ms=subtitle_fade_in_ms,
        caption_style=caption_style,
        words_per_line=words_per_line,
        layout_mode=layout_mode,
        animation_speed=animation_speed,
        style_preset=style_preset,
    )

    ass_fd, ass_path = tempfile.mkstemp(suffix=".ass")
    try:
        with os.fdopen(ass_fd, "w", encoding="utf-8") as f:
            f.write(ass_content)

        # Escape path for FFmpeg filter (backslashes and colons on Linux are fine,
        # but spaces need escaping)
        ass_escaped = _escape_ass_path(ass_path)


        # ---- Build FFmpeg filtergraph ----
        filter_parts: list[str] = []

        # Silence removal: split video into keep segments, trim each, concat
        if use_silence_removal:
            n = len(keep_segments)
            v_splits = ",".join(f"[vseg{i}]" for i in range(n))
            filter_parts.append(f"[0:v]split={n}{v_splits}")
            for i, seg in enumerate(keep_segments):
                filter_parts.append(
                    f"[vseg{i}]setpts=PTS-STARTPTS,trim=start={seg.start}:end={seg.end},setpts=PTS-STARTPTS[vtrim{i}]"
                )
            v_trims = "".join(f"[vtrim{i}]" for i in range(n))
            filter_parts.append(f"{v_trims}concat=n={n}:v=1:a=0[concat_v]")
            video_input = "[concat_v]"
        else:
            video_input = "[0:v]"

        # Layout processing on the (possibly concatenated) video
        if layout_mode == "stacked":
            split = f"{video_input}split=2[v1][v2]"
            avatar_crop = _build_crop_filter(
                "[v1]", "[avatar]", crop_avatar, effective_start, effective_end, output_width, half_h
            )
            game_crop = _build_crop_filter(
                "[v2]", "[game]", crop_game, effective_start, effective_end, output_width, half_h
            )
            stack = "[game][avatar]vstack=inputs=2[stacked]"
            filter_parts.extend([split, avatar_crop, game_crop, stack])
            video_label = "[stacked]"
            if zoom_effect:
                zoom_frames = int(output_duration * 30)
                zoom_expr = _build_zoom_expression(zoom_effect)
                zoom_filter = (
                    f"{video_label}zoompan=z='{zoom_expr}'"
                    f":x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'"
                    f":d={zoom_frames}:s={output_width}x{output_height}:fps=30"
                    f",setsar=1[zoomed]"
                )
                filter_parts.append(zoom_filter)
                video_label = "[zoomed]"
            sub_filter = f"{video_label}subtitles='{ass_escaped.replace(chr(39), chr(39) + chr(39))}':force_style='Outline={outline_width},Shadow={shadow_depth}'[out]"
            filter_parts.append(sub_filter)
        elif layout_mode == "camera_only":
            cam_crop = _build_crop_filter(
                video_input, "[cam]", crop_avatar, effective_start, effective_end, output_width, output_height
            )
            filter_parts.append(cam_crop)
            video_label = "[cam]"
            if zoom_effect:
                zoom_frames = int(output_duration * 30)
                zoom_expr = _build_zoom_expression(zoom_effect)
                zoom_filter = (
                    f"{video_label}zoompan=z='{zoom_expr}'"
                    f":x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'"
                    f":d={zoom_frames}:s={output_width}x{output_height}:fps=30"
                    f",setsar=1[zoomed]"
                )
                filter_parts.append(zoom_filter)
                video_label = "[zoomed]"
            sub_filter = f"{video_label}subtitles='{ass_escaped.replace(chr(39), chr(39) + chr(39))}':force_style='Outline={outline_width},Shadow={shadow_depth}'[out]"
            filter_parts.append(sub_filter)
        elif layout_mode == "gameplay_only":
            game_crop = _build_crop_filter(
                video_input, "[game]", crop_game, effective_start, effective_end, output_width, output_height
            )
            filter_parts.append(game_crop)
            video_label = "[game]"
            if zoom_effect:
                zoom_frames = int(output_duration * 30)
                zoom_expr = _build_zoom_expression(zoom_effect)
                zoom_filter = (
                    f"{video_label}zoompan=z='{zoom_expr}'"
                    f":x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'"
                    f":d={zoom_frames}:s={output_width}x{output_height}:fps=30"
                    f",setsar=1[zoomed]"
                )
                filter_parts.append(zoom_filter)
                video_label = "[zoomed]"
            sub_filter = f"{video_label}subtitles='{ass_escaped.replace(chr(39), chr(39) + chr(39))}':force_style='Outline={outline_width},Shadow={shadow_depth}'[out]"
            filter_parts.append(sub_filter)
        else:
            raise ValueError(f"Unknown layout_mode: {layout_mode}")

        # ---- Thumbnail embedding (append as final frames, audio continues) ----
        extra_inputs = []
        map_video = "[out]"
        if thumbnail_path and os.path.exists(thumbnail_path):
            main_duration = max(1.0, output_duration - thumbnail_duration)
            thumb_frames = int(thumbnail_duration * 30)

            trim_main = f"[out]trim=end={main_duration},setpts=PTS-STARTPTS[main_v]"
            thumb_still = (
                f"[1:v]scale={output_width}:{output_height}"
                f":force_original_aspect_ratio=decrease"
                f",pad={output_width}:{output_height}:(ow-iw)/2:(oh-ih)/2:color=black"
                f",loop=loop={thumb_frames}:size=1,setpts=PTS-STARTPTS[thumb_v]"
            )
            concat = "[main_v][thumb_v]concat=n=2:v=1:a=0[final_v]"
            filter_parts.extend([trim_main, thumb_still, concat])
            map_video = "[final_v]"
            extra_inputs = ["-i", thumbnail_path]

        # Check if video has an audio stream; skip audio filters if not
        has_audio = False
        aprobe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "quiet",
                "-show_entries",
                "stream=codec_type",
                "-of",
                "json",
                video_path,
            ],
            capture_output=True,
            text=True,
        )
        if aprobe.returncode == 0 and aprobe.stdout.strip():
            try:
                streams = json.loads(aprobe.stdout).get("streams", [])
                has_audio = any(s.get("codec_type") == "audio" for s in streams)
            except json.JSONDecodeError:
                has_audio = True  # assume audio if we can't probe

        # Audio: trim to clip window and reset timestamps
        # Normalize PTS before atrim so start_time offsets don't shift the window
        sfx_extra_inputs: list[str] = []
        sfx_audio_filters: list[str] = []
        audio_output_label = "[aout]"
        audio_parts: list[str] = []

        if has_audio:
            if use_silence_removal:
                # Multi-segment audio: split, atrim each keep segment, concat
                n = len(keep_segments)
                a_splits = ",".join(f"[aseg{i}]" for i in range(n))
                audio_parts.append(f"[0:a]asplit={n}{a_splits}")
                for i, seg in enumerate(keep_segments):
                    audio_parts.append(
                        f"[aseg{i}]asetpts=PTS-STARTPTS,atrim=start={seg.start}:end={seg.end},asetpts=PTS-STARTPTS[atrim{i}]"
                    )
                a_trims = "".join(f"[atrim{i}]" for i in range(n))
                audio_parts.append(f"{a_trims}concat=n={n}:v=0:a=1[audio_base]")
            else:
                audio_parts.append(
                    f"[0:a]asetpts=PTS-STARTPTS,atrim=start={start}:end={end},asetpts=PTS-STARTPTS[audio_base]"
                )

            # Mix SFX if placements are provided
            if sfx_placements and workspace_dir:
                from pipeline.sfx import build_sfx_filter_chain, SfxPlacement

                placements = []
                for sp in sfx_placements:
                    if isinstance(sp, dict):
                        placements.append(SfxPlacement(**sp))
                    else:
                        placements.append(sp)

                # Remap SFX times when silence removal is active
                if use_silence_removal:
                    for p in placements:
                        p.time = remap_time(p.time, keep_segments, start)

                # SFX inputs start after the video input (index 0) and any thumbnail input (index 1)
                next_idx = 2 if (thumbnail_path and os.path.exists(thumbnail_path)) else 1
                sfx_inputs, sfx_filters, _ = build_sfx_filter_chain(
                    placements=placements,
                    workspace_dir=workspace_dir,
                    main_audio_label="[audio_base]",
                    output_label=audio_output_label,
                    next_input_index=next_idx,
                )
                if sfx_inputs:
                    sfx_extra_inputs = sfx_inputs
                    sfx_audio_filters = sfx_filters
                    audio_parts.extend(sfx_audio_filters)
                else:
                    # SFX mixing failed (no valid files), just use base audio
                    audio_parts.append(f"[audio_base]anull{audio_output_label}")
            else:
                audio_parts.append(f"[audio_base]anull{audio_output_label}")

        filtergraph = "; ".join(filter_parts)
        audio_filter = "; ".join(audio_parts) if audio_parts else ""

        # ---- Output path ----
        safe_title = re.sub(r"[^\w\- ]", "", clip.get("title", "clip"))[:40].strip()
        out_filename = f"{safe_title}_{uuid.uuid4().hex[:6]}.mp4"
        out_path = os.path.join(output_dir, out_filename)

        settings = _QUALITY_SETTINGS.get(quality_preset, _QUALITY_SETTINGS["standard"])
        encoder = settings.get("encoder", "libx264")
        # Fall back to libx264 if NVENC is not available
        if encoder == "h264_nvenc" and not _nvenc_available():
            encoder = "libx264"
            settings = _QUALITY_SETTINGS["fast"]
        is_nvenc = encoder == "h264_nvenc"

        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            video_path,
            *extra_inputs,
            *sfx_extra_inputs,
            "-filter_complex",
            (filtergraph + "; " + audio_filter) if has_audio else filtergraph,
            "-map",
            map_video,
        ]

        if has_audio:
            cmd.extend(["-map", "[aout]"])

        cmd.extend(["-c:v", encoder])

        if is_nvenc:
            # NVENC uses bitrate control instead of CRF
            cmd.extend(["-preset", settings["preset"]])
            cmd.extend(["-tune", settings["tune"]])
            cmd.extend(["-rc", "vbr"])
            cmd.extend(["-cq", "23"])  # Quality level for NVENC (similar to CRF)
            cmd.extend(["-profile:v", "high"])
            # Level must be explicit number for NVENC, skip if "auto"
            if settings.get("level") != "auto":
                cmd.extend(["-level", settings["level"]])
            cmd.extend(["-pix_fmt", "yuv420p"])
        else:
            # CPU x264 settings
            cmd.extend(["-preset", settings["preset"]])
            cmd.extend(["-crf", settings["crf"]])
            cmd.extend(["-tune", settings["tune"]])
            cmd.extend(["-profile:v", "high"])
            cmd.extend(["-level", settings["level"]])
            cmd.extend(["-pix_fmt", "yuv420p"])

        if has_audio:
            cmd.extend(
                [
                    "-c:a",
                    "aac",
                    "-b:a",
                    settings["audio_bitrate"],
                ]
            )

        cmd.extend(["-movflags", "+faststart", out_path])

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            stderr = result.stderr[-3000:]
            # Provide actionable error messages for common issues
            if "No such file or directory" in stderr:
                raise RuntimeError(
                    f"FFmpeg rendering failed: Input file not found.\n"
                    f"This usually means the video file was deleted or moved.\n"
                    f"FFmpeg error:\n{stderr}"
                )
            if "Invalid argument" in stderr or "Invalid data" in stderr:
                raise RuntimeError(
                    f"FFmpeg rendering failed: Invalid argument.\n"
                    f"This may indicate a problem with the clip region (crop dimensions), "
                    f"subtitle file, or encoding settings.\n"
                    f"Crop avatar: {crop_avatar}\n"
                    f"Crop game: {crop_game}\n"
                    f"Layout: {layout_mode}\n"
                    f"Start: {start}, End: {end}\n"
                    f"FFmpeg error:\n{stderr}"
                )
            if "matches no streams" in stderr:
                raise RuntimeError(
                    f"FFmpeg rendering failed: Clip timestamps don't match the video.\n"
                    f"This can happen when the clip start/end times are outside the video duration.\n"
                    f"Requested: {start:.1f}s to {end:.1f}s ({duration:.1f}s)\n"
                    f"FFmpeg error:\n{stderr}"
                )
            # Check for ASS subtitle specific errors
            if "subtitles" in stderr.lower() or "ass" in stderr.lower():
                raise RuntimeError(
                    f"FFmpeg subtitle processing failed.\n"
                    f"This may indicate an issue with the ASS subtitle file format.\n"
                    f"Caption style: {caption_style}, Animation speed: {animation_speed}\n"
                    f"FFmpeg error:\n{stderr}"
                )
            raise RuntimeError(
                f"FFmpeg rendering failed (exit {result.returncode}):\n{stderr}"
            )

    finally:
        if os.path.exists(ass_path):
            os.unlink(ass_path)

    return out_path


# ---------------------------------------------------------------------------
# Enhanced Timeline Rendering (Phase 5)
# ---------------------------------------------------------------------------


def render_timeline(
    video_path: str,
    output_width: int,
    output_height: int,
    start: float,
    end: float,
    output_dir: str,
    crop_avatar: CropBox | None = None,
    crop_game: CropBox | None = None,
    segments: list[dict] | None = None,
    overlays: list[dict] | None = None,
    audio_tracks: list[dict] | None = None,
    text_annotations: list[dict] | None = None,
    markers: list[dict] | None = None,
    font_name: str = "Arial",
    font_color: str = "#FFFFFF",
    highlight_color: str = "#FFFF00",
    outline_color: str = "#000000",
    outline_width: float = 2.0,
    shadow_depth: float = 1.0,
    shadow_color: str = "#000000",
    shadow_opacity: float = 0.5,
    font_size: int = 22,
    subtitle_fade_in_ms: int = 0,
    subtitle_fade_out_ms: int = 0,
    caption_style: str = "karaoke",
    words_per_line: int = 1,
    quality_preset: str = "standard",
    layout_mode: str = "stacked",
    animation_speed: str = "normal",
    zoom_effect: ZoomEffect | None = None,
) -> str:
    """
    Render full timeline with multi-track support.

    Features:
    - Video crops (avatar + gameplay) in stacked layout
    - Overlay images/videos with position/scale/rotation
    - Text annotations with custom fonts
    - Subtitles with karaoke effects
    - Audio mixing (multiple BGM/SFX tracks)
    - Marker chapters (embedded in output metadata)

    layout_mode: "stacked" (gameplay top, avatar bottom),
                 "camera_only" (avatar full-frame),
                 "gameplay_only" (gameplay full-frame).

    Returns the path to the rendered .mp4 file.
    """
    os.makedirs(output_dir, exist_ok=True)

    duration = end - start
    if duration <= 0:
        raise ValueError(f"Invalid clip duration: start={start}, end={end}")

    half_h = output_height // 2

    # ---- Build ASS subtitle file ----
    segments = segments or []
    ass_content = _build_ass_word_by_word(
        segments=segments,
        clip_start=start,
        clip_end=end,
        font_name=font_name,
        font_color=font_color,
        highlight_color=highlight_color,
        outline_color=outline_color,
        outline_width=outline_width,
        shadow_color=shadow_color,
        shadow_opacity=shadow_opacity,
        font_size=font_size,
        output_height=output_height,
        output_width=output_width,
        fade_in_ms=subtitle_fade_in_ms,
        caption_style=caption_style,
        words_per_line=words_per_line,
        layout_mode=layout_mode,
        animation_speed=animation_speed,
    )

    ass_fd, ass_path = tempfile.mkstemp(suffix=".ass")
    temp_files = [ass_path]

    try:
        with os.fdopen(ass_fd, "w", encoding="utf-8") as f:
            f.write(ass_content)

        ass_escaped = _escape_ass_path(ass_path)

        # ---- Build FFmpeg filtergraph ----
        filter_parts = []
        input_args = ["-i", video_path]
        output_map = []

        if layout_mode == "camera_only":
            if not crop_avatar:
                video_w, video_h = get_video_dimensions(video_path)
                crop_avatar = CropBox(
                    x=video_w // 4, y=video_h // 4, w=video_w // 2, h=video_h // 2
                )
            cam_crop = _build_crop_filter(
                "[0:v]", "[cam]", crop_avatar, start, end, output_width, output_height
            )
            filter_parts.append(cam_crop)
            # Apply zoom between crop and subtitles so captions stay stable
            video_label = "[cam]"
            if zoom_effect:
                zoom_frames = int(duration * 30)
                zoom_expr = _build_zoom_expression(zoom_effect)
                zoom_filter = (
                    f"{video_label}zoompan=z='{zoom_expr}'"
                    f":x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'"
                    f":d={zoom_frames}:s={output_width}x{output_height}:fps=30"
                    f",setsar=1[zoomed]"
                )
                filter_parts.append(zoom_filter)
                video_label = "[zoomed]"
            subtitle_filter = f"{video_label}subtitles='{ass_escaped.replace(chr(39), chr(39) + chr(39))}':force_style='Outline={outline_width},Shadow={shadow_depth}'[subtitled]"
            filter_parts.append(subtitle_filter)
            current_input = "[subtitled]"
        elif layout_mode == "gameplay_only":
            if not crop_game:
                video_w, video_h = get_video_dimensions(video_path)
                crop_game = CropBox(x=0, y=0, w=video_w, h=video_h // 2)
            game_crop = _build_crop_filter(
                "[0:v]", "[game]", crop_game, start, end, output_width, output_height
            )
            filter_parts.append(game_crop)
            video_label = "[game]"
            if zoom_effect:
                zoom_frames = int(duration * 30)
                zoom_expr = _build_zoom_expression(zoom_effect)
                zoom_filter = (
                    f"{video_label}zoompan=z='{zoom_expr}'"
                    f":x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'"
                    f":d={zoom_frames}:s={output_width}x{output_height}:fps=30"
                    f",setsar=1[zoomed]"
                )
                filter_parts.append(zoom_filter)
                video_label = "[zoomed]"
            sub_f = f"{video_label}subtitles='{ass_escaped.replace(chr(39), chr(39) + chr(39))}':force_style='Outline={outline_width},Shadow={shadow_depth}'[subtitled]"
            filter_parts.append(sub_f)
            current_input = "[subtitled]"
        else:
            if layout_mode != "stacked":
                raise ValueError(f"Unknown layout_mode: {layout_mode}")
            # Base video processing — split into two streams
            split = "[0:v]split=2[v1][v2]"
            filter_parts.append(split)

            # Avatar crop
            if not crop_avatar:
                video_w, video_h = get_video_dimensions(video_path)
                crop_avatar = CropBox(
                    x=video_w // 4, y=video_h // 4, w=video_w // 2, h=video_h // 2
                )
            filter_parts.append(
                _build_crop_filter(
                    "[v1]", "[avatar]", crop_avatar, start, end, output_width, half_h
                )
            )

            # Gameplay crop
            if not crop_game:
                video_w, video_h = get_video_dimensions(video_path)
                crop_game = CropBox(x=0, y=0, w=video_w, h=video_h // 2)
            filter_parts.append(
                _build_crop_filter(
                    "[v2]", "[game]", crop_game, start, end, output_width, half_h
                )
            )

            # Stack gameplay over avatar
            stack = "[game][avatar]vstack=inputs=2[stacked]"
            filter_parts.append(stack)

            # Apply zoom between stack and subtitles so captions stay stable
            video_label = "[stacked]"
            if zoom_effect:
                zoom_frames = int(duration * 30)
                zoom_expr = _build_zoom_expression(zoom_effect)
                zoom_filter = (
                    f"{video_label}zoompan=z='{zoom_expr}'"
                    f":x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2'"
                    f":d={zoom_frames}:s={output_width}x{output_height}:fps=30"
                    f",setsar=1[zoomed]"
                )
                filter_parts.append(zoom_filter)
                video_label = "[zoomed]"

            # Apply subtitles
            subtitle_filter = f"{video_label}subtitles='{ass_escaped.replace(chr(39), chr(39) + chr(39))}':force_style='Outline={outline_width},Shadow={shadow_depth}'[subtitled]"
            filter_parts.append(subtitle_filter)
            current_input = "[subtitled]"

        # Process overlays

        if overlays:
            for i, overlay in enumerate(overlays):
                overlay_path = overlay.get("path", "")
                if not os.path.exists(overlay_path):
                    continue

                overlay_start = overlay.get("start", 0)
                overlay_end = overlay.get("end", duration)
                x = overlay.get("x", 0.5)
                y = overlay.get("y", 0.5)
                scale = overlay.get("scale", 1.0)
                rotation = overlay.get("rotation", 0)
                opacity = overlay.get("opacity", 1.0)

                # Calculate position in output coordinates
                pos_x = int(x * output_width)
                pos_y = int(y * output_height)

                # Add overlay input
                input_args.extend(["-i", overlay_path])
                overlay_idx = len(input_args) // 2 - 1  # Account for main video

                # Determine if overlay is video or image
                is_video = overlay_path.lower().endswith((".mp4", ".webm", ".mov"))

                # Build overlay filter
                if is_video:
                    # Video overlay with trim — normalize PTS first
                    overlay_filter = (
                        f"[{overlay_idx}:v]"
                        f"setpts=PTS-STARTPTS,"
                        f"trim=start={overlay_start}:end={overlay_end},setpts=PTS-STARTPTS,"
                        f"scale=iw*{scale}:ih*{scale},"
                        f"rotate={rotation * 3.14159 / 180}:ow=hypot(iw,ih):oh=ow,"
                        f"format=rgba,setsar=1[overlay{i}]"
                    )
                else:
                    # Image overlay
                    overlay_filter = (
                        f"[{overlay_idx}:v]"
                        f"scale=iw*{scale}:ih*{scale},"
                        f"rotate={rotation * 3.14159 / 180}:ow=hypot(iw,ih):oh=ow,"
                        f"format=rgba,setsar=1[overlay{i}]"
                    )

                filter_parts.append(overlay_filter)

                # Chain overlay onto current output
                overlay_input = f"[overlay{i}]"
                next_output = f"[after_overlay{i}]"

                # Calculate overlay position (centered on x,y)
                overlay_w = int(output_width * 0.3 * scale)  # Estimate
                overlay_h = int(output_height * 0.3 * scale)
                offset_x = pos_x - overlay_w // 2
                offset_y = pos_y - overlay_h // 2

                chain_overlay = f"[{current_input}][overlay{i}]overlay=x={offset_x}:y={offset_y}:alpha={'mul' if opacity < 1.0 else '1'}{next_output}"
                filter_parts.append(chain_overlay)
                current_input = next_output

        output_map.append(current_input)

        filtergraph = "; ".join(filter_parts)

        # Audio processing
        audio_filters = []

        # Base audio from video — normalize PTS before atrim to handle start_time offsets
        audio_filters.append(
            f"[0:a]asetpts=PTS-STARTPTS,atrim=start={start}:end={end},asetpts=PTS-STARTPTS[main_audio]"
        )

        # Mix in additional audio tracks
        if audio_tracks:
            for i, audio in enumerate(audio_tracks):
                audio_path = audio.get("path", "")
                if not os.path.exists(audio_path):
                    continue

                audio_start = audio.get("start", 0)
                volume = audio.get("volume", 1.0)
                fade_in = audio.get("fade_in", 0)
                fade_out = audio.get("fade_out", 0)

                input_args.extend(["-i", audio_path])
                audio_idx = len(input_args) // 2 - 1

                # Build audio filter chain
                chain = f"[{audio_idx}:a]"

                # Apply delay for start offset
                if audio_start > 0:
                    chain += (
                        f"adelay={int(audio_start * 1000)}|{int(audio_start * 1000)}"
                    )

                # Apply volume
                if volume != 1.0:
                    chain += f",volume={volume}"

                # Apply fade in
                if fade_in > 0:
                    chain += f",afade=t=in:st={audio_start}:d={fade_in}"

                # Apply fade out
                if fade_out > 0:
                    track_end = audio_start + audio.get("duration", duration)
                    chain += f",afade=t=out:st={track_end - fade_out}:d={fade_out}"

                chain += f"[audio_track{i}]"
                audio_filters.append(chain)

            # Mix all audio tracks
            all_audio = "[main_audio]" + "".join(
                f"[audio_track{i}]" for i in range(len(audio_tracks))
            )
            audio_filters.append(
                f"{all_audio}amix=inputs={len(audio_tracks) + 1}:duration=first:dropout_action=0[final_audio]"
            )
        else:
            audio_filters.append("[main_audio]anull[final_audio]")

        full_filtergraph = filtergraph + "; " + "; ".join(audio_filters)

        # ---- Output path ----
        safe_title = re.sub(r"[^\w\- ]", "", "timeline_render")[:40].strip()
        out_filename = f"{safe_title}_{uuid.uuid4().hex[:6]}.mp4"
        out_path = os.path.join(output_dir, out_filename)

        settings = _QUALITY_SETTINGS.get(quality_preset, _QUALITY_SETTINGS["standard"])
        encoder = settings.get("encoder", "libx264")
        # Fall back to libx264 if NVENC is not available
        if encoder == "h264_nvenc" and not _nvenc_available():
            encoder = "libx264"
            settings = _QUALITY_SETTINGS["fast"]
        is_nvenc = encoder == "h264_nvenc"

        cmd = [
            "ffmpeg",
            "-y",
            *input_args,
            "-filter_complex",
            full_filtergraph,
            "-map",
            "[out]" if "[out]" in full_filtergraph else f"{current_input}",
            "-map",
            "[final_audio]",
            "-c:v",
            encoder,
        ]

        if is_nvenc:
            cmd.extend(["-preset", settings["preset"]])
            cmd.extend(["-tune", settings["tune"]])
            cmd.extend(["-rc", "vbr"])
            cmd.extend(["-cq", "23"])
            cmd.extend(["-profile:v", "high"])
            # Level must be explicit number for NVENC, skip if "auto"
            if settings.get("level") != "auto":
                cmd.extend(["-level", settings["level"]])
            cmd.extend(["-pix_fmt", "yuv420p"])
        else:
            cmd.extend(["-preset", settings["preset"]])
            cmd.extend(["-crf", settings["crf"]])
            cmd.extend(["-tune", settings["tune"]])
            cmd.extend(["-profile:v", "high"])
            cmd.extend(["-level", settings["level"]])
            cmd.extend(["-pix_fmt", "yuv420p"])

        cmd.extend(
            [
                "-c:a",
                "aac",
                "-b:a",
                settings["audio_bitrate"],
                "-movflags",
                "+faststart",
                out_path,
            ]
        )

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            raise RuntimeError(
                f"FFmpeg rendering failed (exit {result.returncode}):\n"
                f"{result.stderr[-3000:]}"
            )

    finally:
        for temp_file in temp_files:
            if os.path.exists(temp_file):
                os.unlink(temp_file)

    return out_path
