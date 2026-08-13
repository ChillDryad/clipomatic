"""
Vision analysis — samples frames from the video and sends them to a
vision-capable LLM for scene understanding.

Works alongside transcription to provide a second signal for highlight
detection: visual energy, scene changes, emotional reactions, and
on-screen events that transcripts alone would miss.

Uses the same OpenAI-compatible API as highlight_detection, but with
image content in the message.  Works with:
  - Ollama models that support vision (e.g. llava, llama3.2-vision)
  - OpenAI gpt-4o-mini
  - Any OpenAI-compatible endpoint that accepts image_url content parts
"""

import base64
import json
import logging
import os
import subprocess
import tempfile
from typing import Callable

from pipeline.media import get_media_duration

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[float, str], None]

# Sample one frame every N seconds.  Higher = fewer frames = faster + cheaper.
# 30s is a good default — catches scene changes without flooding the LLM.
DEFAULT_SAMPLE_INTERVAL = 30.0

# Maximum frames to analyse per video to bound cost.
# For a 4h stream at 30s intervals that's 480 frames — cap at 120 (every ~2min).
MAX_FRAMES = 120

# JPEG quality for sampled frames (lower = smaller payloads to the LLM)
JPEG_QUALITY = 2  # ffmpeg -q:v scale (2 = high quality, reasonable size)

# Resolution to downscale frames to before sending (keeps payloads small)
SAMPLE_WIDTH = 512  # pixels — wide enough for the LLM to understand the scene


def _fire(callback: ProgressCallback | None, fraction: float, label: str) -> None:
    if callback:
        callback(fraction, label)


def _sample_frame(video_path: str, timestamp: float, output_dir: str, width: int = SAMPLE_WIDTH) -> str | None:
    """Extract a single downscaled JPEG frame from the video at the given timestamp.

    Returns the path to the JPEG, or None on failure.
    """
    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, f"vframe_{timestamp:.1f}.jpg")

    if os.path.exists(out_path):
        return out_path

    cmd = [
        "ffmpeg", "-y",
        "-ss", str(timestamp),
        "-i", video_path,
        "-vframes", "1",
        "-vf", f"scale={width}:-1",
        "-q:v", str(JPEG_QUALITY),
        out_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.debug(f"Frame extraction failed at {timestamp}s: {result.stderr.strip()[:200]}")
        return None
    if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        return None
    return out_path


def _encode_frame_b64(frame_path: str) -> str:
    """Encode a frame file as base64 for the OpenAI image_url format."""
    with open(frame_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def _build_vision_prompt() -> str:
    """System prompt for the vision LLM — single frame scene analysis."""
    return """You are a visual scene analyzer for VTuber VOD content.
You will receive a single frame from a stream recording.

Analyze the frame and respond with a JSON object containing exactly these keys:
  "visual_energy" (integer 1-10) — How visually active/dramatic is this frame?
      1 = static/loading screen/menu, 5 = normal gameplay, 10 = intense action/clutch/funny on-screen moment.
  "scene_type" (string) — One of: "gameplay", "talking_head", "loading", "menu", "transition", "overlay", "other".
  "description" (string) — One sentence describing what's visible (game, UI state, character expressions, on-screen events).
  "has_text_overlay" (boolean) — Is there significant on-screen text (donation, notification, alert)?
  "emotional_tone" (string) — If a face/avatar is visible, guess the emotion: "neutral", "happy", "angry", "surprised", "sad", "laughing", "fear", "". Empty string if no face visible.

Output ONLY the JSON object. No markdown, no explanations."""


def _parse_vision_response(raw: str) -> dict | None:
    """Parse the vision LLM response into a structured dict. Tolerates markdown fences."""
    import re
    cleaned = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to extract a JSON object from surrounding prose
        obj_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if obj_match:
            try:
                return json.loads(obj_match.group())
            except json.JSONDecodeError:
                pass
    logger.warning(f"Failed to parse vision response: {raw[:200]}")
    return None


def analyze_video_frames(
    video_path: str,
    output_dir: str,
    api_key: str,
    base_url: str,
    model: str,
    sample_interval: float = DEFAULT_SAMPLE_INTERVAL,
    max_frames: int = MAX_FRAMES,
    progress_callback: ProgressCallback | None = None,
) -> list[dict]:
    """Sample frames from the video and analyze each with a vision LLM.

    Args:
        video_path: Path to the local video file.
        output_dir: Directory to store extracted frames (reused as frame cache).
        api_key: LLM API key.
        base_url: OpenAI-compatible base URL.
        model: Vision-capable model name (e.g. "llava:13b", "gpt-4o-mini").
        sample_interval: Seconds between sampled frames.
        max_frames: Hard cap on number of frames to analyze.
        progress_callback: Optional (fraction, label) callback.

    Returns:
        List of frame analysis dicts:
        [
            {
                "timestamp": 30.0,
                "visual_energy": 7,
                "scene_type": "gameplay",
                "description": "Intense boss fight with the player at low health.",
                "has_text_overlay": false,
                "emotional_tone": "surprised",
            },
            ...
        ]
    """
    from openai import OpenAI

    duration = get_media_duration(video_path)
    if duration <= 0:
        logger.warning("Cannot determine video duration for vision analysis")
        return []

    # Calculate sample timestamps
    raw_count = int(duration / sample_interval)
    if raw_count > max_frames:
        # Spread evenly across the video instead of just sampling the first N
        sample_interval = duration / max_frames

    timestamps = []
    t = sample_interval / 2  # start at half-interval to avoid pure black intro
    while t < duration:
        timestamps.append(round(t, 1))
        t += sample_interval

    if not timestamps:
        return []

    _fire(progress_callback, 0.0, f"Sampling {len(timestamps)} frames for vision analysis…")

    client = OpenAI(api_key=api_key, base_url=base_url)
    system_prompt = _build_vision_prompt()
    frames_dir = os.path.join(output_dir, "vision_frames")
    results: list[dict] = []

    for i, ts in enumerate(timestamps):
        progress = i / len(timestamps)
        _fire(progress_callback, progress, f"Vision analysis {i+1}/{len(timestamps)} (t={ts:.0f}s)…")

        frame_path = _sample_frame(video_path, ts, frames_dir)
        if frame_path is None:
            continue

        try:
            b64 = _encode_frame_b64(frame_path)
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": f"Analyze this frame from timestamp {ts:.1f}s of a VTuber stream.",
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{b64}",
                                },
                            },
                        ],
                    },
                ],
                temperature=0.3,
                timeout=60.0,
            )
            raw = resp.choices[0].message.content or ""
            analysis = _parse_vision_response(raw)
            if analysis:
                analysis["timestamp"] = ts
                results.append(analysis)
        except Exception as exc:
            logger.warning(f"Vision analysis failed for frame at {ts}s: {exc}")
            # Continue — one failed frame shouldn't kill the whole analysis

    _fire(progress_callback, 1.0, f"Vision analysis complete — {len(results)} frames analyzed.")

    # Clean up frame images to save disk (keep the analysis, not the pixels)
    for fname in os.listdir(frames_dir) if os.path.isdir(frames_dir) else []:
        try:
            os.unlink(os.path.join(frames_dir, fname))
        except OSError:
            pass

    return results


def format_vision_annotations(vision_data: list[dict] | None) -> str:
    """Format vision analysis as LLM-readable annotations for the highlight prompt.

    Only includes notable frames (high visual energy, interesting scene types,
    emotional tones) to keep the prompt concise. Returns empty string if no
    notable events.
    """
    if not vision_data:
        return ""

    lines: list[str] = []
    for frame in vision_data:
        ts = frame.get("timestamp", 0)
        energy = frame.get("visual_energy", 0)
        scene = frame.get("scene_type", "")
        desc = frame.get("description", "")
        tone = frame.get("emotional_tone", "")
        has_overlay = frame.get("has_text_overlay", False)

        # Only annotate frames with notable visual activity
        if energy < 6 and scene in ("loading", "menu", "transition") and not has_overlay:
            continue

        h = int(ts // 3600)
        m = int((ts % 3600) // 60)
        s = ts % 60
        ts_str = f"{h}:{m:02d}:{s:05.2f}"

        tags = []
        if energy >= 7:
            tags.append(f"HIGH_ENERGY({energy}/10)")
        if tone:
            tags.append(f"EMOTION:{tone}")
        if has_overlay:
            tags.append("ON_SCREEN_TEXT")
        if scene not in ("gameplay", "talking_head"):
            tags.append(f"SCENE:{scene}")

        if tags or energy >= 6:
            tag_str = " ".join(tags) if tags else f"ENERGY({energy}/10)"
            lines.append(f"[{ts_str}] VISUAL - {tag_str} — {desc}")

    if not lines:
        return ""

    return "\n\n## VISUAL ANALYSIS (timestamp - label — description)\n" + "\n".join(lines)