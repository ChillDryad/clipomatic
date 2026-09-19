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
from pipeline.performance import get_ram_tier_config

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[float, str], None]

_DEFAULT_LIMITS = get_ram_tier_config()
# Constrained-safe defaults: one scan frame every four seconds and at most
# two hours' worth of one-per-minute LLM candidates.
DEFAULT_SCAN_FPS = _DEFAULT_LIMITS.vision_fps
DEFAULT_WINDOW_SECONDS = 60.0
MAX_FRAMES = _DEFAULT_LIMITS.vision_max_frames
DEFAULT_BATCH_SIZE = 4
DEFAULT_CACHE_BATCHES = _DEFAULT_LIMITS.vision_cache_batches
DEFAULT_NUM_CTX = _DEFAULT_LIMITS.ollama_num_ctx

# JPEG quality for sampled frames (lower = smaller payloads to the LLM)
JPEG_QUALITY = 2  # ffmpeg -q:v scale (2 = high quality, reasonable size)

# Resolution to downscale frames to before sending (keeps payloads small)
SAMPLE_WIDTH = 512  # pixels — wide enough for the LLM to understand the scene
SCAN_WIDTH = 160


def _score_scanned_frames(frame_paths: list[str], fps: float) -> list[dict]:
    """Attach timestamps and normalized frame-to-frame activity scores."""
    from PIL import Image, ImageChops, ImageStat

    if fps <= 0:
        raise ValueError("fps must be greater than zero")

    scored: list[dict] = []
    previous = None
    for index, frame_path in enumerate(frame_paths):
        with Image.open(frame_path) as image:
            current = image.convert("L")
            activity = 0.0
            if previous is not None:
                difference = ImageChops.difference(previous, current)
                activity = float(ImageStat.Stat(difference).mean[0]) / 255.0
            previous = current.copy()
        scored.append({
            "timestamp": round((index + 0.5) / fps, 3),
            "path": frame_path,
            "activity": activity,
        })
    return scored


def _select_frame_candidates(
    frames: list[dict],
    window_seconds: float,
    max_frames: int,
) -> list[dict]:
    """Select timeline representatives plus the most active remaining frames."""
    if not frames or max_frames <= 0 or window_seconds <= 0:
        return []

    ordered = sorted(frames, key=lambda frame: float(frame["timestamp"]))
    windows: dict[int, list[dict]] = {}
    for frame in ordered:
        window = int(float(frame["timestamp"]) // window_seconds)
        windows.setdefault(window, []).append(frame)

    # One median frame per window preserves the stream's overall visual rhythm.
    representatives = [
        window_frames[len(window_frames) // 2]
        for window_frames in windows.values()
    ]

    if len(representatives) >= max_frames:
        if max_frames == 1:
            return [representatives[len(representatives) // 2]]
        # Evenly reduce representatives while retaining both ends of the VOD.
        indices = {
            round(i * (len(representatives) - 1) / (max_frames - 1))
            for i in range(max_frames)
        }
        return sorted(
            (representatives[index] for index in indices),
            key=lambda frame: float(frame["timestamp"]),
        )

    selected = list(representatives)
    selected_ids = {id(frame) for frame in selected}
    activity_candidates = sorted(
        (frame for frame in ordered if id(frame) not in selected_ids),
        key=lambda frame: float(frame.get("activity", 0.0)),
        reverse=True,
    )
    selected.extend(activity_candidates[: max_frames - len(selected)])
    return sorted(selected, key=lambda frame: float(frame["timestamp"]))


def _materialize_selected_frames(
    video_path: str,
    candidates: list[dict],
    output_dir: str,
) -> list[dict]:
    """Re-extract selected timestamps at analysis resolution."""
    materialized = []
    for candidate in candidates:
        timestamp = float(candidate["timestamp"])
        frame_path = _sample_frame(video_path, timestamp, output_dir)
        if frame_path is None:
            continue
        frame = dict(candidate)
        frame["path"] = frame_path
        materialized.append(frame)
    return materialized


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


def _parse_vision_batch_response(raw: str, timestamps: list[float]) -> list[dict]:
    """Parse a JSON batch response and bind analyses to requested timestamps."""
    import re

    cleaned = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        array_match = re.search(r"\[.*\]", cleaned, re.DOTALL)
        if not array_match:
            logger.warning("Failed to parse vision batch response: %s", raw[:200])
            return []
        try:
            parsed = json.loads(array_match.group())
        except json.JSONDecodeError:
            logger.warning("Failed to parse vision batch response: %s", raw[:200])
            return []

    if isinstance(parsed, dict):
        parsed = parsed.get("frames") or parsed.get("analyses") or parsed.get("results")
    if not isinstance(parsed, list):
        return []

    results = []
    for timestamp, analysis in zip(timestamps, parsed):
        if isinstance(analysis, dict):
            item = dict(analysis)
            item["timestamp"] = timestamp
            results.append(item)
    return results


def _load_vision_cache(
    cache_path: str,
    fingerprint: dict,
    config: dict,
) -> dict | None:
    """Load cache only when the source fingerprint and analysis config match."""
    try:
        with open(cache_path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    if payload.get("fingerprint") != fingerprint or payload.get("config") != config:
        return None
    return payload


def _save_vision_cache(cache_path: str, payload: dict) -> None:
    """Atomically persist resumable vision progress."""
    os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
    temp_path = f"{cache_path}.tmp"
    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)
    os.replace(temp_path, cache_path)


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


def _scan_video_frames(
    video_path: str,
    output_dir: str,
    fps: float = DEFAULT_SCAN_FPS,
    width: int = SCAN_WIDTH,
) -> list[dict]:
    """Extract a low-resolution 1-FPS scan in one sequential FFmpeg pass."""
    if fps <= 0:
        raise ValueError("scan fps must be greater than zero")

    stem = os.path.splitext(os.path.basename(video_path))[0]
    scan_dir = os.path.join(output_dir, f".{stem}_vision_scan")
    os.makedirs(scan_dir, exist_ok=True)
    for name in os.listdir(scan_dir):
        if name.endswith(".jpg"):
            try:
                os.unlink(os.path.join(scan_dir, name))
            except OSError:
                pass

    output_pattern = os.path.join(scan_dir, "scan_%08d.jpg")
    command = [
        "ffmpeg", "-y", "-i", video_path,
        "-vf", f"fps={fps},scale={width}:-1",
        "-q:v", "8",
        output_pattern,
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Vision scan failed: {result.stderr.strip()[:500]}")

    frame_paths = sorted(
        os.path.join(scan_dir, name)
        for name in os.listdir(scan_dir)
        if name.endswith(".jpg")
    )
    return _score_scanned_frames(frame_paths, fps)


def _vision_scan_dir(video_path: str, output_dir: str) -> str:
    stem = os.path.splitext(os.path.basename(video_path))[0]
    return os.path.join(output_dir, f".{stem}_vision_scan")


def analyze_video_frames(
    video_path: str,
    output_dir: str,
    api_key: str,
    base_url: str,
    model: str,
    scan_fps: float = DEFAULT_SCAN_FPS,
    window_seconds: float = DEFAULT_WINDOW_SECONDS,
    max_frames: int = MAX_FRAMES,
    batch_size: int = DEFAULT_BATCH_SIZE,
    cache_every_batches: int = DEFAULT_CACHE_BATCHES,
    num_ctx: int = DEFAULT_NUM_CTX,
    progress_callback: ProgressCallback | None = None,
    allow_remote_provider: bool = False,
) -> list[dict]:
    """Scan at 1 FPS, select representative frames, and analyze in batches."""
    from llm_policy import validate_local_model
    if not allow_remote_provider:
        model = validate_local_model(model)
    if (
        scan_fps <= 0 or window_seconds <= 0 or max_frames <= 0
        or batch_size <= 0 or cache_every_batches <= 0 or num_ctx <= 0
    ):
        raise ValueError("Vision scan and budget settings must be greater than zero")

    stat = os.stat(video_path)
    fingerprint = {"size": stat.st_size, "mtime_ns": stat.st_mtime_ns}
    config = {
        "model": model,
        "scan_fps": scan_fps,
        "window_seconds": window_seconds,
        "max_frames": max_frames,
        "batch_size": batch_size,
        "num_ctx": num_ctx,
    }
    stem = os.path.splitext(os.path.basename(video_path))[0]
    cache_path = os.path.join(output_dir, f"{stem}_vision_analysis.json")
    cache = _load_vision_cache(cache_path, fingerprint, config)
    if cache and cache.get("complete"):
        return cache.get("results", [])

    duration = get_media_duration(video_path)
    if duration <= 0:
        logger.warning("Cannot determine video duration for vision analysis")
        return []

    from openai import OpenAI
    import shutil

    results = list(cache.get("results", [])) if cache else []
    completed_timestamps = {
        float(item["timestamp"])
        for item in results
        if "timestamp" in item
    }
    scan_dir = _vision_scan_dir(video_path, output_dir)
    selected_dir = os.path.join(output_dir, f".{stem}_vision_selected")

    try:
        _fire(progress_callback, 0.0, f"Scanning video at {scan_fps:g} FPS…")
        scanned = _scan_video_frames(video_path, output_dir, fps=scan_fps)
        candidates = _select_frame_candidates(scanned, window_seconds, max_frames)
        pending = [
            frame for frame in candidates
            if float(frame["timestamp"]) not in completed_timestamps
        ]
        pending = _materialize_selected_frames(video_path, pending, selected_dir)
        if not candidates:
            return []

        client = OpenAI(api_key=api_key, base_url=base_url)
        system_prompt = _build_vision_prompt() + (
            "\nYou may receive multiple frames. Return a JSON array with exactly one "
            "analysis object per frame, in the same order as the images."
        )
        total_batches = max(1, (len(pending) + batch_size - 1) // batch_size)

        for batch_index in range(0, len(pending), batch_size):
            batch = pending[batch_index:batch_index + batch_size]
            batch_number = batch_index // batch_size + 1
            _fire(
                progress_callback,
                batch_number / total_batches,
                f"Vision batch {batch_number}/{total_batches} "
                f"({len(results)}/{len(candidates)} frames complete)…",
            )

            content: list[dict] = [{
                "type": "text",
                "text": (
                    f"Analyze these {len(batch)} VTuber stream frames. "
                    "Return one JSON object per image in the same order."
                ),
            }]
            timestamps = []
            for frame in batch:
                timestamp = float(frame["timestamp"])
                timestamps.append(timestamp)
                content.append({
                    "type": "text",
                    "text": f"Frame timestamp: {timestamp:.1f}s",
                })
                content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{_encode_frame_b64(frame['path'])}",
                    },
                })

            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": content},
                    ],
                    temperature=0.3,
                    timeout=120.0,
                    extra_body={"num_ctx": num_ctx},
                )
                raw = response.choices[0].message.content or ""
                parsed = _parse_vision_batch_response(raw, timestamps)
                results.extend(parsed)
                completed_timestamps.update(
                    float(item["timestamp"]) for item in parsed
                )
                if (
                    batch_number % cache_every_batches == 0
                    or batch_number == total_batches
                ):
                    _save_vision_cache(cache_path, {
                        "fingerprint": fingerprint,
                        "config": config,
                        "complete": False,
                        "results": results,
                    })
            except Exception as exc:
                logger.warning(
                    "Vision batch %s/%s failed: %s",
                    batch_number,
                    total_batches,
                    exc,
                )

        results.sort(key=lambda item: float(item.get("timestamp", 0)))
        is_complete = len(completed_timestamps) >= len(candidates)
        _save_vision_cache(cache_path, {
            "fingerprint": fingerprint,
            "config": config,
            "complete": is_complete,
            "results": results,
        })
        _fire(
            progress_callback,
            1.0,
            f"Vision analysis complete — {len(results)} frames analyzed.",
        )
        return results
    finally:
        shutil.rmtree(scan_dir, ignore_errors=True)
        shutil.rmtree(selected_dir, ignore_errors=True)


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