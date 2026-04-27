"""
Ingestion pipeline — handles YouTube/Twitch downloads, audio streaming, and local file uploads.
"""

import logging
import os
import re
import subprocess
import threading
from typing import Callable

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[float, str], None]

# yt-dlp stderr progress line:
# [download]  12.3% of  1.23GiB at    2.34MiB/s ETA 00:42
_YTDLP_PROGRESS_RE = re.compile(r"\[download\]\s+([\d.]+)%")

# ffmpeg stderr time progress: time=00:12:34.56
_FFMPEG_TIME_RE = re.compile(r"time=(\d+):(\d+):([\d.]+)")

_YTDLP_DEST_RE = re.compile(r"\[download\] Destination: (.+)")
_YTDLP_ALREADY_RE = re.compile(r"\[download\] (.+) has already been downloaded")


def _fire(callback: ProgressCallback | None, fraction: float, label: str) -> None:
    if callback:
        logger.debug("_fire called: fraction=%s, label=%s", fraction, label)
        callback(fraction, label)
    else:
        logger.debug("_fire called but no callback set: fraction=%s, label=%s", fraction, label)


def _apply_browser_cookies(cmd: list[str]) -> list[str]:
    cookies_browser = os.environ.get("YTDLP_COOKIES_FROM_BROWSER", "").strip()
    if cookies_browser:
        cmd += ["--cookies-from-browser", cookies_browser]
    return cmd


def _resolve_ytdlp_output(stdout_data: str, last_destination: list[str]) -> str:
    output_path = stdout_data.strip().splitlines()[-1].strip() if stdout_data.strip() else ""
    if not output_path and last_destination:
        output_path = last_destination[-1]
    return output_path


def _read_stream_to_list(stream, lines_list: list[str]) -> None:
    """Read all lines from a stream into a list. Used for subprocess pipes."""
    for line in stream:
        lines_list.append(line.rstrip())


# ---------------------------------------------------------------------------
# Twitch helpers
# ---------------------------------------------------------------------------

def extract_vod_id(url: str) -> str:
    """Extract the numeric VOD ID from a Twitch VOD URL."""
    m = re.search(r"twitch\.tv/videos/(\d+)", url)
    if not m:
        raise ValueError(f"Could not extract Twitch VOD ID from URL: {url!r}")
    return m.group(1)


def stream_audio_to_file(
    url: str,
    audio_path: str,
    progress_callback: ProgressCallback = None,
) -> str:
    """
    Stream only the audio from a Twitch (or any yt-dlp-supported) VOD to a
    16 kHz mono WAV file. No video is downloaded or stored.

    Steps:
      1. Fetch total duration via yt-dlp --print duration
      2. Get the direct audio stream URL via yt-dlp -f bestaudio --get-url
      3. Pipe through ffmpeg to resample to 16 kHz PCM WAV
      4. Report progress by parsing ffmpeg stderr time= lines
    """
    os.makedirs(os.path.dirname(audio_path) or ".", exist_ok=True)

    _fire(progress_callback, 0.0, "Fetching stream info…")

    # Step 1 — duration
    dur_result = subprocess.run(
        ["yt-dlp", "--print", "duration", url],
        capture_output=True, text=True,
    )
    total_seconds = 1.0
    if dur_result.returncode == 0 and dur_result.stdout.strip():
        try:
            total_seconds = float(dur_result.stdout.strip().splitlines()[-1])
        except ValueError:
            pass

    _fire(progress_callback, 0.02, "Getting audio stream URL…")

    # Step 2 — direct stream URL
    url_result = subprocess.run(
        ["yt-dlp", "-f", "bestaudio", "--get-url", url],
        capture_output=True, text=True,
    )
    if url_result.returncode != 0 or not url_result.stdout.strip():
        raise RuntimeError(
            f"yt-dlp could not resolve audio stream URL:\n{url_result.stderr.strip()}"
        )
    stream_url = url_result.stdout.strip().splitlines()[-1]

    _fire(progress_callback, 0.05, "Streaming audio…")

    # Step 3 — ffmpeg transcode
    cmd = [
        "ffmpeg", "-y",
        "-i", stream_url,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        audio_path,
    ]

    # ffmpeg writes to audio_path (a file) so stdout is unused — read stderr
    # directly in the main thread to avoid Streamlit's NoSessionContext error.
    process = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)

    stderr_lines: list[str] = []
    for line in process.stderr:
        line = line.rstrip()
        stderr_lines.append(line)
        m = _FFMPEG_TIME_RE.search(line)
        if m:
            elapsed = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
            fraction = 0.05 + min(elapsed / total_seconds, 1.0) * 0.93
            mins = int(elapsed // 60)
            secs = int(elapsed % 60)
            total_mins = int(total_seconds // 60)
            total_secs = int(total_seconds % 60)
            _fire(progress_callback, fraction, f"Streaming audio… {mins}:{secs:02d} / {total_mins}:{total_secs:02d}")

    process.wait()

    if process.returncode != 0:
        raise RuntimeError(
            f"ffmpeg audio stream failed (exit {process.returncode}):\n"
            + "\n".join(stderr_lines[-20:])
        )

    _fire(progress_callback, 1.0, "Audio stream complete.")
    return audio_path


def download_segment(
    url: str,
    start: float,
    end: float,
    output_dir: str,
    progress_callback: ProgressCallback = None,
) -> str:
    """
    Download a specific time range of a VOD using yt-dlp --download-sections.
    Returns the path to the downloaded segment MP4.
    """
    os.makedirs(output_dir, exist_ok=True)

    output_template = os.path.join(output_dir, "%(id)s_seg_%(section_start)s.%(ext)s")

    cmd = [
        "yt-dlp",
        "--download-sections", f"*{start}-{end}",
        "-f", "best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "--no-playlist",
        "--concurrent-fragments", "8",  # parallel HLS fragment download
        "--http-chunk-size", "10M",  # larger HTTP chunks
        "--output", output_template,
        "--print", "after_move:filepath",
        "--newline",
        url,
    ]

    _apply_browser_cookies(cmd)

    _fire(progress_callback, 0.0, "Starting segment download…")

    # Use threads to read stdout/stderr concurrently — avoids deadlock when
    # pipe buffers fill up on long downloads or error-heavy output.
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    stderr_lines: list[str] = []
    stdout_lines: list[str] = []
    last_destination: list[str] = []

    def _read_stderr():
        for line in process.stderr:
            line = line.rstrip()
            stderr_lines.append(line)
            m = _YTDLP_PROGRESS_RE.search(line)
            if m:
                pct = float(m.group(1)) / 100.0
                _fire(progress_callback, pct * 0.95, f"Downloading segment… {m.group(1)}%")
            elif "Merging formats" in line or "[Merger]" in line or "[ffmpeg]" in line:
                _fire(progress_callback, 0.96, "Merging segment…")
            dm = _YTDLP_DEST_RE.search(line)
            if dm:
                last_destination.append(dm.group(1).strip())
            else:
                am = _YTDLP_ALREADY_RE.search(line)
                if am:
                    last_destination.append(am.group(1).strip())

    def _read_stdout():
        for line in process.stdout:
            stdout_lines.append(line.rstrip())

    t_stderr = threading.Thread(target=_read_stderr)
    t_stdout = threading.Thread(target=_read_stdout)
    t_stderr.start()
    t_stdout.start()
    t_stderr.join()
    t_stdout.join()
    process.wait()

    stdout_data = "\n".join(stdout_lines)

    if process.returncode != 0:
        raise RuntimeError(
            f"yt-dlp segment download failed (exit {process.returncode}):\n"
            + "\n".join(stderr_lines[-20:])
        )

    _fire(progress_callback, 1.0, "Segment download complete.")

    output_path = _resolve_ytdlp_output(stdout_data, last_destination)
    if not output_path or not os.path.exists(output_path):
        raise RuntimeError(
            f"yt-dlp finished but segment file not found.\n"
            f"Expected: {output_path!r}\n"
            f"stderr: {chr(10).join(stderr_lines[-10:])}"
        )

    # Validate the downloaded segment has content (non-zero duration)
    import json as _json
    probe_result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "json", output_path],
        capture_output=True, text=True,
    )
    if probe_result.returncode == 0 and probe_result.stdout.strip():
        try:
            probe_data = _json.loads(probe_result.stdout)
            seg_duration = float(probe_data.get("format", {}).get("duration", 0))
            if seg_duration <= 0:
                raise RuntimeError(
                    f"Downloaded segment has zero duration - yt-dlp returned an empty file. "
                    f"Requested: {start:.1f}s to {end:.1f}s. File: {output_path}"
                )
            expected_duration = end - start
            if seg_duration < expected_duration * 0.5:
                logger.warning(
                    f"Downloaded segment duration ({seg_duration:.1f}s) is much shorter than expected ({expected_duration:.1f}s). "
                    f"This may indicate a partial download or stream unavailability."
                )
        except (_json.JSONDecodeError, KeyError, ValueError):
            pass  # If we can't parse, proceed and let caller handle it

    return output_path


def download_video(
    url: str,
    output_dir: str,
    progress_callback: ProgressCallback = None,
) -> str:
    """
    Download a video (YouTube, Twitch, Kick, or any yt-dlp-supported URL) into output_dir.
    Returns the path of the downloaded file.

    Twitch VODs use HLS (no separate audio stream) so the format selector falls
    back to 'best'. HLS fragments are downloaded in parallel via
    --concurrent-fragments. Cookie-based auth is supported via the
    YTDLP_COOKIES_FROM_BROWSER env var (e.g. "chrome" or "firefox").
    """
    os.makedirs(output_dir, exist_ok=True)

    output_template = os.path.join(output_dir, "%(id)s.%(ext)s")

    cmd = [
        "yt-dlp",
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "--no-playlist",
        "--concurrent-fragments", "8",  # parallel HLS fragment download (increased from 4)
        "--http-chunk-size", "10M",  # larger HTTP chunks for faster downloads
        "--output", output_template,
        "--print", "after_move:filepath",
        "--newline",
        "--force-overwrites",
        url,
    ]

    # Optional: authenticate via browser cookies (needed for subscriber-only Twitch VODs)
    _apply_browser_cookies(cmd)

    _fire(progress_callback, 0.0, "Starting download…")

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,  # Line buffered for real-time progress
    )

    # Use threads to read stdout/stderr concurrently — avoids deadlock when
    # pipe buffers fill up on long downloads or error-heavy output.
    stderr_lines: list[str] = []
    stdout_lines: list[str] = []
    download_phase = -1
    last_destination: list[str] = []

    def _read_stderr():
        nonlocal download_phase
        for line in process.stderr:
            line = line.rstrip()
            stderr_lines.append(line)
            logger.debug("yt-dlp stderr: %s", line)
            m = _YTDLP_PROGRESS_RE.search(line)
            if m:
                pct = float(m.group(1)) / 100.0
                if download_phase <= 0:
                    logger.debug("Video progress: %s%% -> fraction %s", m.group(1), pct * 0.5)
                    _fire(progress_callback, pct * 0.5, f"Downloading video… {m.group(1)}%")
                else:
                    logger.debug("Audio progress: %s%% -> fraction %s", m.group(1), 0.5 + pct * 0.45)
                    _fire(progress_callback, 0.5 + pct * 0.45, f"Downloading audio… {m.group(1)}%")
            elif "has already been downloaded" in line or \
                 "Merging formats" in line or \
                 "[Merger]" in line or \
                 "[ffmpeg]" in line:
                logger.debug("Merging phase detected")
                _fire(progress_callback, 0.95, "Merging video and audio…")
            if "[download] Destination:" in line:
                download_phase += 1
                logger.debug("Download phase changed to: %d", download_phase)
                dm = _YTDLP_DEST_RE.search(line)
                if dm:
                    last_destination.append(dm.group(1).strip())
            else:
                am = _YTDLP_ALREADY_RE.search(line)
                if am:
                    last_destination.append(am.group(1).strip())

    def _read_stdout():
        for line in process.stdout:
            stdout_lines.append(line.rstrip())

    t_stderr = threading.Thread(target=_read_stderr)
    t_stdout = threading.Thread(target=_read_stdout)
    t_stderr.start()
    t_stdout.start()
    t_stderr.join()
    t_stdout.join()
    process.wait()

    stdout_data = "\n".join(stdout_lines)

    if process.returncode != 0:
        raise RuntimeError(
            f"yt-dlp failed (exit {process.returncode}):\n"
            + "\n".join(stderr_lines[-20:])
        )

    _fire(progress_callback, 1.0, "Download complete.")

    # Prefer the path printed by --print after_move:filepath; fall back to the
    # last Destination line (HLS single-stream downloads skip the merge/move step).
    output_path = _resolve_ytdlp_output(stdout_data, last_destination)
    if not output_path or not os.path.exists(output_path):
        raise RuntimeError(
            f"yt-dlp finished but the output file was not found.\n"
            f"Expected: {output_path!r}\n"
            f"yt-dlp stdout: {stdout_data.strip()}\n"
            f"yt-dlp stderr: {chr(10).join(stderr_lines[-10:])}"
        )

    return output_path


