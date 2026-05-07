"""
Pipeline module for audio processing.

Handles audio upload, waveform generation, mixing, and effects for the timeline editor.
Includes security validation: extension whitelist, magic byte validation, file size limits.
"""

import asyncio
import json
import os
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from typing import Callable


@dataclass
class AudioAsset:
    """Represents an uploaded audio asset."""
    id: str
    filename: str
    original_filename: str
    file_path: str
    file_size: int
    duration: float
    sample_rate: int
    channels: int
    created_at: float


# Supported audio extensions (whitelist)
AUDIO_EXTENSIONS = {".mp3", ".wav", ".aac", ".m4a", ".ogg", ".flac"}
# Maximum file size (100 MB default)
MAX_FILE_SIZE = 100 * 1024 * 1024

# Audio magic bytes for MIME type detection
AUDIO_MAGIC_BYTES = {
    b"\xff\xfb": "audio/mp3",  # MP3 frame sync
    b"\xff\xfa": "audio/mp3",
    b"\xff\xf2": "audio/mp3",
    b"\xff\xf3": "audio/mp3",
    b"RIFF": "audio/wav",  # WAV (RIFF container)
    b"OggS": "audio/ogg",  # Ogg Vorbis/Opus
    b"fLaC": "audio/flac",  # FLAC
    b"\x00\x00\x00\x1cftyp": "audio/mp4",  # M4A/AAC (MP4 container)
    b"\x00\x00\x00\x18ftyp": "audio/mp4",
    b"\x00\x00\x00\x20ftypM4A": "audio/mp4",
}


def _detect_audio_type(file_content: bytes) -> str | None:
    """Detect audio type from magic bytes."""
    for magic, audio_type in AUDIO_MAGIC_BYTES.items():
        if file_content.startswith(magic):
            return audio_type
    # Special handling for WAV (RIFF at start, WAVE at offset 8)
    if file_content[:8] == b"RIFF....WAVE":
        return "audio/wav"
    return None


def _get_audio_info(audio_path: str) -> dict:
    """Get audio file information using ffprobe."""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-hide_banner",
        "-show_entries", "stream=codec_type,sample_rate,channels,duration",
        "-show_entries", "format=duration",
        "-of", "json",
        audio_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr.strip()}")

    data = json.loads(result.stdout)

    # Get stream info
    streams = data.get("streams", [])
    audio_stream = None
    for stream in streams:
        if stream.get("codec_type") == "audio":
            audio_stream = stream
            break

    if not audio_stream:
        raise RuntimeError("No audio stream found")

    # Get duration from format if not in stream
    duration = float(audio_stream.get("duration", 0) or data.get("format", {}).get("duration", 0))

    return {
        "sample_rate": int(audio_stream.get("sample_rate", 44100)),
        "channels": int(audio_stream.get("channels", 2)),
        "duration": duration,
    }

# TODO: deprecate, we should be streaming full video download.
async def save_audio_file(
    file_content: bytes,
    original_filename: str,
    audio_dir: str,
    progress_callback: Callable[[float, str], None] | None = None,
) -> AudioAsset:
    """
    Save an uploaded audio file to the workspace.

    Security validations:
    - Path traversal prevention (strips path components from filename)
    - Extension whitelist (only allowed audio formats)
    - Magic byte validation (detects MIME type spoofing)
    - File size limit (100 MB max)

    Args:
        file_content: Raw file bytes
        original_filename: Original filename from upload
        audio_dir: Directory to save the file (e.g., workspace/audio)
        progress_callback: Optional callback for upload progress

    Returns:
        AudioAsset with file metadata

    Raises:
        ValueError: If file fails any security validation
    """
    # SECURITY: Strip path components to prevent path traversal attacks
    safe_filename = os.path.basename(original_filename)
    if safe_filename != original_filename:
        raise ValueError(
            f"Invalid filename: path components not allowed. "
            f"Original: {original_filename!r}"
        )

    # Validate file size (reject before processing)
    if len(file_content) == 0:
        raise ValueError("Empty file not allowed")
    if len(file_content) > MAX_FILE_SIZE:
        raise ValueError(f"File too large: {len(file_content)} bytes (max {MAX_FILE_SIZE})")

    # Validate extension against whitelist
    ext = os.path.splitext(safe_filename)[1].lower()
    if ext not in AUDIO_EXTENSIONS:
        raise ValueError(
            f"Unsupported audio format: {ext!r}. Allowed: {', '.join(sorted(AUDIO_EXTENSIONS))}"
        )

    # SECURITY: Validate file type from magic bytes
    detected_audio = _detect_audio_type(file_content)
    if detected_audio is None:
        raise ValueError(
            f"Unable to validate audio file. Magic bytes not recognized. "
            f"Extension: {ext!r}"
        )

    # Validate asset type

    # Generate unique filename (convert to WAV for consistent processing)
    safe_id = uuid.uuid4().hex[:12]
    new_filename = f"{safe_id}.wav"
    file_path = os.path.join(audio_dir, new_filename)

    # Ensure directory exists
    os.makedirs(audio_dir, exist_ok=True)

    # Write temporary file first
    temp_fd, temp_path = tempfile.mkstemp(suffix=ext)
    try:
        with os.fdopen(temp_fd, "wb") as f:
            f.write(file_content)
            if progress_callback:
                progress_callback(0.5, f"Processing {original_filename}...")

        # Convert to WAV for consistent processing
        cmd = [
            "ffmpeg", "-y",
            "-i", temp_path,
            "-acodec", "pcm_s16le",
            "-ar", "44100",
            "-ac", "2",
            file_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg conversion failed: {result.stderr.strip()}")

        if progress_callback:
            progress_callback(1.0, "Audio processing complete")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    # Get audio info
    info = _get_audio_info(file_path)

    import time
    return AudioAsset(
        id=uuid.uuid4().hex,
        filename=new_filename,
        original_filename=original_filename,
        file_path=file_path,
        file_size=os.path.getsize(file_path),
        duration=info["duration"],
        sample_rate=info["sample_rate"],
        channels=info["channels"],
        created_at=time.time(),
    )


def generate_waveform(
    audio_path: str,
    output_path: str | None = None,
    num_points: int = 1000,
    samples_per_point: int = 1024,
) -> dict:
    """
    Generate waveform data from an audio file.

    Args:
        audio_path: Path to audio file
        output_path: Optional path to save waveform image (PNG)
        num_points: Number of data points to generate
        samples_per_point: Number of audio samples per data point

    Returns:
        Dict with waveform data:
        {
            "duration": float,
            "sample_rate": int,
            "channels": int,
            "peaks": list[float],  # normalized 0-1
            "rms": list[float],    # normalized 0-1
        }
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    info = _get_audio_info(audio_path)
    duration = info["duration"]
    sample_rate = info["sample_rate"]

    # Use ffmpeg to extract raw audio data and compute waveform
    # Output as f32le for easy parsing
    temp_fd, temp_path = tempfile.mkstemp(suffix=".f32")
    try:
        cmd = [
            "ffmpeg", "-y",
            "-i", audio_path,
            "-acodec", "pcm_f32le",
            "-ar", str(sample_rate),
            "-ac", "1",  # Convert to mono for waveform
            "-f", "f32le",
            temp_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg extraction failed: {result.stderr.strip()}")

        # Read raw audio data
        with open(temp_path, "rb") as f:
            raw_data = f.read()

        import struct
        import math

        # Calculate samples per point based on desired output size
        total_samples = len(raw_data) // 4  # 4 bytes per float32
        actual_samples_per_point = max(1, total_samples // num_points)

        peaks = []
        rms_values = []

        for i in range(0, total_samples, actual_samples_per_point):
            chunk = raw_data[i:i + actual_samples_per_point * 4]
            if len(chunk) < 4:
                break

            # Decode samples
            samples = struct.unpack(f"{len(chunk) // 4}f", chunk)

            if not samples:
                continue

            # Calculate peak (max absolute value)
            peak = max(abs(s) for s in samples)

            # Calculate RMS (root mean square)
            sum_squares = sum(s * s for s in samples)
            rms = math.sqrt(sum_squares / len(samples))

            # Normalize to 0-1 range (typical audio peaks at ~0.7-1.0)
            peaks.append(min(1.0, peak))
            rms_values.append(min(1.0, rms))

        # Generate waveform image if requested
        if output_path:
            _generate_waveform_image(peaks, output_path)

        return {
            "duration": duration,
            "sample_rate": sample_rate,
            "channels": info["channels"],
            "peaks": peaks,
            "rms": rms_values,
            "num_points": len(peaks),
        }

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def _generate_waveform_image(peaks: list[float], output_path: str, width: int = 1000, height: int = 200):
    """Generate a PNG waveform image from peak data."""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        # PIL not available, skip image generation
        return

    # Create image with transparent background
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Calculate bar width and spacing
    num_points = len(peaks)
    bar_width = max(1, width // num_points)
    spacing = 1

    # Draw waveform
    for i, peak in enumerate(peaks):
        if i >= num_points:
            break

        x = i * (bar_width + spacing)
        if x >= width:
            break

        # Height based on peak value
        peak_height = int(peak * height / 2)

        # Center the waveform vertically
        y_top = height // 2 - peak_height
        y_bottom = height // 2 + peak_height

        # Gradient color based on amplitude
        intensity = int(255 * peak)
        color = (intensity, min(255, intensity + 50), 255, 200)

        draw.rectangle([x, y_top, x + bar_width, y_bottom], fill=color)

    img.save(output_path, "PNG")


def mix_audio_tracks(
    tracks: list[dict],
    output_path: str,
    video_path: str | None = None,
) -> str:
    """
    Mix multiple audio tracks together.

    Args:
        tracks: List of track dicts with:
            - path: str (audio file path)
            - volume: float (0.0-1.0, default 1.0)
            - start: float (start time in output, default 0)
            - fade_in: float (fade in duration in seconds, default 0)
            - fade_out: float (fade out duration in seconds, default 0)
        output_path: Path for output mixed audio file
        video_path: Optional video path to extract original audio

    Returns:
        Path to mixed audio file
    """
    if not tracks:
        raise ValueError("At least one audio track required")

    # Build FFmpeg filter complex for mixing
    inputs = []
    filter_parts = []
    output_labels = []

    # Add video audio if provided
    if video_path and os.path.exists(video_path):
        inputs.extend(["-i", video_path])
        filter_parts.append(f"[0:a]volume=0.8[audio0]")
        output_labels.append("[audio0]")

    # Add each BGM/SFX track
    for i, track in enumerate(tracks):
        track_path = track.get("path")
        if not track_path or not os.path.exists(track_path):
            continue

        inputs.extend(["-i", track_path])

        base_label = f"[{i + 1}:a]"
        chain = []

        # Apply volume
        volume = track.get("volume", 1.0)
        if volume != 1.0:
            chain.append(f"volume={volume}")

        # Apply fade in
        fade_in = track.get("fade_in", 0)
        if fade_in > 0:
            chain.append(f"afade=t=in:st={track.get('start', 0)}:d={fade_in}")

        # Apply fade out
        fade_out = track.get("fade_out", 0)
        if fade_out > 0:
            track_end = track.get("start", 0) + track.get("duration", 0)
            chain.append(f"afade=t=out:st={track_end - fade_out}:d={fade_out}")

        # Apply delay if track has start offset
        start = track.get("start", 0)
        if start > 0:
            chain.append(f"adelay={int(start * 1000)}|{int(start * 1000)}")

        if chain:
            filter_str = ",".join(chain)
            filter_parts.append(f"{base_label}{filter_str}[track{i + 1}]")
            output_labels.append(f"[track{i + 1}]")
        else:
            output_labels.append(base_label)

    # Mix all tracks
    if len(output_labels) > 1:
        mix_inputs = "".join(output_labels)
        filter_parts.append(f"{mix_inputs}amix=inputs={len(output_labels)}:duration=first:dropout_action=0[out]")
    else:
        filter_parts.append(f"{output_labels[0]}anull[out]")

    filter_complex = ";".join(filter_parts)

    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-c:a", "aac",
        "-b:a", "192k",
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg audio mix failed: {result.stderr.strip()}")

    return output_path


def apply_audio_effects(
    input_path: str,
    output_path: str,
    volume: float = 1.0,
    fade_in: float = 0,
    fade_out: float = 0,
    normalize: bool = False,
) -> str:
    """
    Apply audio effects to a file.

    Args:
        input_path: Input audio file path
        output_path: Output audio file path
        volume: Volume multiplier (0.0-2.0)
        fade_in: Fade in duration in seconds
        fade_out: Fade out duration in seconds
        normalize: Whether to normalize audio levels

    Returns:
        Path to processed audio file
    """
    info = _get_audio_info(input_path)
    duration = info["duration"]

    filters = []

    # Volume adjustment
    if volume != 1.0:
        filters.append(f"volume={volume}")

    # Fade in
    if fade_in > 0:
        filters.append(f"afade=t=in:st=0:d={fade_in}")

    # Fade out
    if fade_out > 0:
        fade_start = duration - fade_out
        filters.append(f"afade=t=out:st={fade_start}:d={fade_out}")

    # Normalize
    if normalize:
        filters.append("loudnorm")

    if not filters:
        # No effects, just copy
        filters.append("anull")

    filter_str = ",".join(filters)

    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-af", filter_str,
        "-c:a", "aac",
        "-b:a", "192k",
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg audio effects failed: {result.stderr.strip()}")

    return output_path


def delete_audio_asset(file_path: str) -> bool:
    """
    Delete an audio asset file.

    Args:
        file_path: Path to the file to delete

    Returns:
        True if deleted, False if file didn't exist
    """
    if os.path.exists(file_path):
        os.remove(file_path)
        return True
    return False
