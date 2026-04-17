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

# Audio files longer than this are split into chunks before transcription.
# 30 minutes keeps memory usage manageable even on small-VRAM GPUs.
_CHUNK_SECONDS = 1800

ProgressCallback = Callable[[float, str], None]


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


def _compute_type_for_device(device: str) -> str:
    if device == "cuda":
        return "float16"
    return "int8"


def _get_duration(audio_path: str) -> float:
    """Return the duration of an audio file in seconds via ffprobe."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json",
        audio_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return 0.0
    try:
        return float(json.loads(result.stdout)["format"]["duration"])
    except (KeyError, ValueError):
        return 0.0


def _split_audio(audio_path: str, chunk_dir: str, chunk_seconds: int = _CHUNK_SECONDS) -> list[tuple[str, float]]:
    """
    Split a WAV file into fixed-length chunks using ffmpeg segment.
    Returns a list of (chunk_path, start_offset_seconds) tuples in order.
    """
    os.makedirs(chunk_dir, exist_ok=True)
    chunk_pattern = os.path.join(chunk_dir, "chunk_%04d.wav")
    cmd = [
        "ffmpeg", "-y",
        "-i", audio_path,
        "-f", "segment",
        "-segment_time", str(chunk_seconds),
        "-c", "copy",
        chunk_pattern,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg audio split failed:\n{result.stderr.strip()}")

    chunks = sorted(
        f for f in os.listdir(chunk_dir) if f.startswith("chunk_") and f.endswith(".wav")
    )
    return [(os.path.join(chunk_dir, f), i * chunk_seconds) for i, f in enumerate(chunks)]


def _extract_audio(video_path: str, audio_path: str) -> None:
    """Extract a 16kHz mono WAV from the video for Whisper."""
    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
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
    from faster_whisper import WhisperModel  # imported here to avoid slow startup

    if video_path is None and audio_path is None:
        raise ValueError("Either video_path or audio_path must be provided.")

    os.makedirs(output_dir, exist_ok=True)

    if device == "auto":
        device, compute_type = detect_device()
    else:
        compute_type = _compute_type_for_device(device)

    def _cb(fraction: float, label: str):
        if progress_callback:
            progress_callback(fraction, label)

    # If a pre-extracted audio file is provided, use it directly.
    _temp_audio: str | None = None
    if audio_path is not None:
        _audio_to_transcribe = audio_path
    else:
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.close()
        _temp_audio = tmp.name
        _audio_to_transcribe = _temp_audio

    chunk_dir: str | None = None

    try:
        if _temp_audio is not None:
            _cb(0.0, "Extracting audio…")
            _extract_audio(video_path, _temp_audio)
        else:
            _cb(0.0, "Using pre-streamed audio…")

        _cb(0.05, f"Loading Whisper model ({model_size})…")
        model = WhisperModel(model_size, device=device, compute_type=compute_type)

        transcribe_kwargs = dict(word_timestamps=True, beam_size=5)
        if language:
            transcribe_kwargs["language"] = language

        total_duration = _get_duration(_audio_to_transcribe) or 1.0

        # --- Chunked transcription for long files ---
        if total_duration > _CHUNK_SECONDS:
            chunk_dir = tempfile.mkdtemp(prefix="momiji_chunks_")
            _cb(0.08, f"Audio is {total_duration/3600:.1f}h — splitting into 30-min chunks…")
            chunks = _split_audio(_audio_to_transcribe, chunk_dir)
        else:
            chunks = [(_audio_to_transcribe, 0.0)]

        n_chunks = len(chunks)
        all_segments: list[dict] = []
        detected_language = "unknown"
        language_probability = 0.0

        for chunk_idx, (chunk_path, offset) in enumerate(chunks):
            # Check for previously saved partial progress
            partial_key = f"_chunk_{chunk_idx:04d}"
            partial_path = os.path.join(
                output_dir,
                f"{os.path.splitext(os.path.basename(os.path.abspath(_audio_to_transcribe)))[0]}{partial_key}.json"
            )
            if os.path.exists(partial_path):
                with open(partial_path, "r", encoding="utf-8") as pf:
                    partial = json.load(pf)
                all_segments.extend(partial["segments"])
                detected_language = partial.get("language", detected_language)
                language_probability = partial.get("language_probability", language_probability)
                chunk_progress = (chunk_idx + 1) / n_chunks
                _cb(0.10 + chunk_progress * 0.85,
                    f"Chunk {chunk_idx + 1}/{n_chunks} loaded from cache…")
                continue

            _cb(0.10 + (chunk_idx / n_chunks) * 0.85,
                f"Transcribing chunk {chunk_idx + 1}/{n_chunks} "
                f"(starting at {int(offset//60)}:{int(offset%60):02d})…")

            segments_iter, info = model.transcribe(chunk_path, **transcribe_kwargs)
            detected_language = info.language
            language_probability = round(info.language_probability, 4)
            chunk_duration = info.duration or 1.0

            chunk_segments: list[dict] = []
            for seg in segments_iter:
                words = []
                if seg.words:
                    for w in seg.words:
                        words.append({
                            "word": w.word,
                            "start": round(w.start + offset, 3),
                            "end": round(w.end + offset, 3),
                            "probability": round(w.probability, 4),
                        })
                chunk_segments.append({
                    "start": round(seg.start + offset, 3),
                    "end": round(seg.end + offset, 3),
                    "text": seg.text.strip(),
                    "words": words,
                })
                # Progress within this chunk mapped into its slice of the bar
                seg_progress = (chunk_idx + seg.end / chunk_duration) / n_chunks
                elapsed_total = offset + seg.end
                _cb(
                    min(0.10 + seg_progress * 0.85, 0.95),
                    f"Chunk {chunk_idx + 1}/{n_chunks} — "
                    f"{int(elapsed_total//60)}:{int(elapsed_total%60):02d} / "
                    f"{int(total_duration//60)}:{int(total_duration%60):02d}",
                )

            # Save partial progress immediately so a crash doesn't lose this chunk
            with open(partial_path, "w", encoding="utf-8") as pf:
                json.dump({
                    "language": detected_language,
                    "language_probability": language_probability,
                    "segments": chunk_segments,
                }, pf, ensure_ascii=False)

            all_segments.extend(chunk_segments)

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
        # Clean up chunk wav files (partial JSON progress files are kept for resume)
        if chunk_dir and os.path.isdir(chunk_dir):
            import shutil
            shutil.rmtree(chunk_dir, ignore_errors=True)

    _cb(0.97, "Saving transcript…")
    source_path = audio_path if video_path is None else video_path
    stem = os.path.splitext(os.path.basename(source_path))[0]
    transcript_path = os.path.join(output_dir, f"{stem}_transcript.json")
    with open(transcript_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # Remove partial chunk files now that the merged transcript is saved
    for fname in os.listdir(output_dir):
        if fname.startswith(stem + "_chunk_") and fname.endswith(".json"):
            try:
                os.unlink(os.path.join(output_dir, fname))
            except OSError as exc:
                logger = logging.getLogger(__name__)
                logger.warning("Failed to remove partial chunk file %s: %s", fname, exc)

    _cb(1.0, "Transcription complete.")
    return result


def transcript_to_text(transcript: dict) -> str:
    """Flatten transcript to plain timestamped text for LLM consumption."""
    lines = []
    for seg in transcript.get("segments", []):
        start = seg["start"]
        mins = int(start // 60)
        secs = start % 60
        lines.append(f"[{mins:02d}:{secs:05.2f}] {seg['text']}")
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
    import tempfile

    from faster_whisper import WhisperModel

    if video_path is None and audio_path is None:
        raise ValueError("Either video_path or audio_path must be provided.")

    if device == "auto":
        device, compute_type = detect_device()
    else:
        compute_type = _compute_type_for_device(device)

    def _cb(fraction: float, label: str):
        if progress_callback:
            progress_callback(fraction, label)

    _cb(0.05, "Extracting clip audio segment…")

    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    tmp_path = tmp.name

    try:
        if audio_path:
            # Stream from existing audio file with a time window
            cmd = [
                "ffmpeg", "-y",
                "-ss", str(start),
                "-i", audio_path,
                "-t", str(end - start),
                "-vn",
                "-acodec", "pcm_s16le",
                "-ar", "16000",
                "-ac", "1",
                tmp_path,
            ]
        else:
            # Extract from video file
            cmd = [
                "ffmpeg", "-y",
                "-ss", str(start),
                "-i", video_path,
                "-t", str(end - start),
                "-vn",
                "-acodec", "pcm_s16le",
                "-ar", "16000",
                "-ac", "1",
                tmp_path,
            ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg segment audio extraction failed:\n{result.stderr.strip()}")

        _cb(0.15, f"Loading Whisper model ({model_size})…")
        model = WhisperModel(model_size, device=device, compute_type=compute_type)

        transcribe_kwargs = dict(word_timestamps=True, beam_size=5)
        if language:
            transcribe_kwargs["language"] = language

        _cb(0.25, "Transcribing segment…")
        segments_iter, info = model.transcribe(tmp_path, **transcribe_kwargs)

        segment_duration = end - start
        all_segments = []
        for seg in segments_iter:
            words = []
            if seg.words:
                for w in seg.words:
                    words.append({
                        "word": w.word,
                        # Adjust word timestamps to be relative to the original video
                        "start": round(w.start + start, 3),
                        "end": round(w.end + start, 3),
                        "probability": round(w.probability, 4),
                    })
            all_segments.append({
                "start": round(seg.start + start, 3),
                "end": round(seg.end + start, 3),
                "text": seg.text.strip(),
                "words": words,
            })

        _cb(0.95, "Done.")

        return {
            "language": info.language,
            "language_probability": round(info.language_probability, 4),
            "duration": round(segment_duration, 3),
            "segments": all_segments,
        }
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
