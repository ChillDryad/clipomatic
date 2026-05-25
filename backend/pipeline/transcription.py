"""
Transcription pipeline — faster-whisper with automatic GPU detection.

Device priority:  CUDA (Nvidia / AMD ROCm)  →  Apple Silicon CPU  →  generic CPU
compute_type:     float16                       int8 (via Accelerate)   int8
"""

import json
import logging
import os
import platform
import subprocess
import sys
import tempfile
from typing import Callable

from pipeline.media import get_media_duration

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[float, str], None]

# ---------------------------------------------------------------------------
# Model cache — avoids reloading WhisperModel on every call.
# Keyed by (model_size, device, compute_type). Each unique combination is
# loaded once and reused for subsequent transcriptions.
# ---------------------------------------------------------------------------
_model_cache: dict[tuple[str, str, str], "WhisperModel"] = {}


def _get_model(model_size: str, device: str, compute_type: str) -> "WhisperModel":
    """Return a cached WhisperModel, loading it on first use."""
    from faster_whisper import WhisperModel

    key = (model_size, device, compute_type)
    if key not in _model_cache:
        logger.info(f"Loading WhisperModel({model_size}, device={device}, compute_type={compute_type})")
        _model_cache[key] = WhisperModel(model_size, device=device, compute_type=compute_type)
    return _model_cache[key]


def detect_device() -> tuple[str, str]:
    """
    Auto-detect the best available compute backend.
    Returns (device, compute_type) for WhisperModel.

    - CUDA:  device="cuda",  compute_type="float16"
      Detected via ctranslate2 (the same library faster-whisper uses internally),
      which avoids PyTorch's CUDA toolkit version-mismatch warnings entirely.
      Covers Nvidia and AMD (ROCm).
    - Apple Silicon: device="cpu", compute_type="int8"
      CTranslate2 uses Apple Accelerate on ARM — fast without any GPU passthrough.
    - CPU fallback: device="cpu", compute_type="int8"
    """
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass

    if sys.platform == "darwin" and platform.machine() == "arm64":
        return "cpu", "int8"

    return "cpu", "int8"


def _resolve_device(device_arg: str) -> tuple[str, str]:
    if device_arg == "auto":
        return detect_device()
    compute_type = "float16" if device_arg == "cuda" else "int8"
    return device_arg, compute_type


def _fire(callback: Callable | None, fraction: float, label: str) -> None:
    if callback:
        callback(fraction, label)


def _extract_audio(video_path: str, audio_path: str) -> None:
    """Extract a 16kHz mono WAV from the video for Whisper."""
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-vn",
        "-af",
        "asetpts=PTS-STARTPTS",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        audio_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg audio extraction failed:\n{result.stderr.strip()}")


def transcribe(
    video_path: str | None,
    output_dir: str,
    model_size: str = "large-v3",
    device: str = "auto",
    language: str | None = None,
    progress_callback: ProgressCallback = None,
    audio_path: str | None = None,
) -> dict:
    """
    Transcribe a video or audio file using faster-whisper.

    Pass either video_path (any video file — audio will be extracted) or
    audio_path (a pre-extracted 16 kHz mono WAV — skips ffmpeg extraction).
    When audio_path is provided, video_path may be None.

    Returns a dict:
    {
        "segments": [
            {
                "start": float,
                "end": float,
                "text": str,
                "words": [{"word": str, "start": float, "end": float, "probability": float}]
            },
            ...
        ]
    }

    The result is also saved as <stem>_transcript.json in output_dir.
    """
    if video_path is None and audio_path is None:
        raise ValueError("Either video_path or audio_path must be provided.")

    os.makedirs(output_dir, exist_ok=True)

    device, compute_type = _resolve_device(device)

    # If a pre-extracted audio file is provided, use it directly.
    _temp_audio: str | None = None
    if audio_path is not None:
        _audio_to_transcribe = audio_path
    else:
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.close()
        _temp_audio = tmp.name
        _audio_to_transcribe = _temp_audio

    try:
        if _temp_audio is not None:
            _fire(progress_callback, 0.0, "Extracting audio…")
            _extract_audio(video_path, _temp_audio)
        else:
            _fire(progress_callback, 0.0, "Using pre-streamed audio…")

        _fire(progress_callback, 0.05, f"Loading Whisper model ({model_size})…")
        model = _get_model(model_size, device, compute_type)

        transcribe_kwargs = dict(word_timestamps=True, beam_size=5)
        if language:
            transcribe_kwargs["language"] = language

        total_duration = get_media_duration(_audio_to_transcribe) or 1.0

        _fire(
            progress_callback, 0.10,
            f"Transcribing {total_duration / 3600:.1f}h of audio…",
        )

        segments_iter, info = model.transcribe(
            _audio_to_transcribe, **transcribe_kwargs
        )
        detected_language = info.language
        language_probability = round(info.language_probability, 4)
        audio_duration = info.duration or 1.0

        all_segments: list[dict] = []
        for seg in segments_iter:
            words = []
            if seg.words:
                for w in seg.words:
                    words.append(
                        {
                            "word": w.word,
                            "start": round(w.start, 3),
                            "end": round(w.end, 3),
                            "probability": round(w.probability, 4),
                        }
                    )
            all_segments.append(
                {
                    "start": round(seg.start, 3),
                    "end": round(seg.end, 3),
                    "text": seg.text.strip(),
                    "words": words,
                }
            )
            seg_progress = seg.end / audio_duration
            elapsed_mins = int(seg.end // 60)
            elapsed_secs = int(seg.end % 60)
            total_mins = int(total_duration // 60)
            total_secs = int(total_duration % 60)
            _fire(
                progress_callback,
                min(0.10 + seg_progress * 0.87, 0.97),
                f"{elapsed_mins}:{elapsed_secs:02d} / {total_mins}:{total_secs:02d}",
            )

        result = {
            "language": detected_language,
            "language_probability": language_probability,
            "duration": round(total_duration, 3),
            "segments": all_segments,
        }

    finally:
        # Only delete temp audio if we created it (not if the caller provided it)
        if _temp_audio and os.path.exists(_temp_audio):
            os.unlink(_temp_audio)

    _fire(progress_callback, 0.97, "Saving transcript…")
    source_path = audio_path if video_path is None else video_path
    stem = os.path.splitext(os.path.basename(source_path))[0]
    transcript_path = os.path.join(output_dir, f"{stem}_transcript.json")
    with open(transcript_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # Remove any leftover partial chunk files from previous runs
    for fname in os.listdir(output_dir):
        if fname.startswith(stem + "_chunk_") and fname.endswith(".json"):
            try:
                os.unlink(os.path.join(output_dir, fname))
            except OSError as exc:
                logger.warning("Failed to remove partial chunk file %s: %s", fname, exc)

    _fire(progress_callback, 1.0, "Transcription complete.")
    return result


def transcript_to_text(transcript: dict) -> str:
    """Flatten transcript to plain timestamped text for LLM consumption."""
    lines = []
    for seg in transcript.get("segments", []):
        start = seg["start"]
        hours = int(start // 3600)
        mins = int((start % 3600) // 60)
        secs = start % 60
        lines.append(f"[{hours}:{mins:02d}:{secs:05.2f}] {seg['text']}")
    return "\n".join(lines)


def transcribe_segment(
    video_path: str | None = None,
    audio_path: str | None = None,
    start: float = 0.0,
    end: float = 0.0,
    model_size: str = "large-v3",
    device: str = "auto",
    language: str | None = None,
    progress_callback: ProgressCallback = None,
    source_url: str | None = None,
) -> dict:
    """
    Transcribe a specific time window of a video or audio file using faster-whisper.

    Pass either video_path or audio_path. Extracts the time slice and runs Whisper on it,
    then adjusts all timestamps to be relative to the original video/audio.

    Returns the same dict shape as transcribe():
    {
        "language": str,
        "language_probability": float,
        "duration": float,        # actual segment duration
        "segments": [
            {
                "start": float,   # relative to original source, not segment
                "end": float,
                "text": str,
                "words": [{"word": str, "start": float, "end": float, "probability": float}]
            }
        ]
    }
    """
    if video_path is None and audio_path is None:
        raise ValueError("Either video_path or audio_path must be provided.")

    device, compute_type = _resolve_device(device)

    _fire(progress_callback, 0.05, "Extracting clip audio segment…")

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    tmp_path = tmp.name

    try:
        if audio_path:
            # Stream from existing audio file with a time window
            cmd = [
                "ffmpeg",
                "-y",
                "-ss",
                str(start),
                "-i",
                audio_path,
                "-t",
                str(end - start),
                "-vn",
                "-af",
                "asetpts=PTS-STARTPTS",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                tmp_path,
            ]
        else:
            # Extract from video file
            cmd = [
                "ffmpeg",
                "-y",
                "-ss",
                str(start),
                "-i",
                video_path,
                "-t",
                str(end - start),
                "-vn",
                "-af",
                "asetpts=PTS-STARTPTS",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                tmp_path,
            ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            # Check if this is a "file not found" error and we have a source URL to redownload
            if "No such file or directory" in result.stderr and source_url:
                logger.warning(
                    f"Audio file not found ({audio_path}), redownloading from source..."
                )
                _fire(
                    progress_callback,
                    0.05,
                    "Audio file missing - redownloading from source...",
                )

                # Redownload audio from source URL
                from pipeline.ingestion import stream_audio_to_file

                stream_audio_to_file(
                    source_url, audio_path, progress_callback=lambda f, l: None
                )

                # Retry ffmpeg extraction
                logger.info(
                    f"Retrying audio extraction from redownloaded file: {audio_path}"
                )
                result = subprocess.run(cmd, capture_output=True, text=True)
                if result.returncode != 0:
                    raise RuntimeError(
                        f"ffmpeg segment audio extraction failed after redownload:\n{result.stderr.strip()}"
                    )
            else:
                raise RuntimeError(
                    f"ffmpeg segment audio extraction failed:\n{result.stderr.strip()}"
                )

        _fire(progress_callback, 0.15, f"Loading Whisper model ({model_size})…")
        model = _get_model(model_size, device, compute_type)

        transcribe_kwargs = dict(word_timestamps=True, beam_size=5)
        if language:
            transcribe_kwargs["language"] = language

        _fire(progress_callback, 0.25, "Transcribing segment…")
        segments_iter, info = model.transcribe(tmp_path, **transcribe_kwargs)

        segment_duration = end - start
        all_segments = []
        for seg in segments_iter:
            words = []
            if seg.words:
                for w in seg.words:
                    words.append(
                        {
                            "word": w.word,
                            # Adjust word timestamps to be relative to the original video
                            "start": round(w.start + start, 3),
                            "end": round(w.end + start, 3),
                            "probability": round(w.probability, 4),
                        }
                    )
            all_segments.append(
                {
                    "start": round(seg.start + start, 3),
                    "end": round(seg.end + start, 3),
                    "text": seg.text.strip(),
                    "words": words,
                }
            )

        _fire(progress_callback, 0.95, "Done.")

        return {
            "language": info.language,
            "language_probability": round(info.language_probability, 4),
            "duration": round(segment_duration, 3),
            "segments": all_segments,
        }
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)