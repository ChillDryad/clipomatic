"""
Pipeline module for media asset handling.

Handles upload, storage, and retrieval of overlay images/videos for the timeline editor.
Includes security validation: extension whitelist, MIME type detection, magic byte validation.
"""

import asyncio
import json
import os
import subprocess
import uuid
from dataclasses import dataclass
from typing import Callable


@dataclass
class MediaAsset:
    """Represents an uploaded media asset."""
    id: str
    filename: str
    original_filename: str
    file_path: str
    file_size: int
    mime_type: str
    asset_type: str  # 'image' or 'video'
    width: int | None = None
    height: int | None = None
    duration: float | None = None  # for video assets
    created_at: float | None = None


# Supported image extensions (whitelist)
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
# Supported video extensions for overlay videos (whitelist)
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov"}
# Maximum file size (50 MB default)
MAX_FILE_SIZE = 50 * 1024 * 1024

# Magic bytes for MIME type detection (prevent extension spoofing)
MAGIC_BYTES = {
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
    b"GIF87a": "image/gif",
    b"GIF89a": "image/gif",
    b"RIFF": "image/webp",  # WebP starts with RIFF
    b"\x00\x00\x00\x1cftyp": "video/mp4",
    b"\x00\x00\x00\x18ftyp": "video/mp4",
    b"\x00\x00\x00\x14ftyp": "video/mp4",
    b"\x1aE\xdf\xa3": "video/webm",
    b"moov": "video/mp4",
    b"ftyp": "video/mp4",
}


def _detect_mime_type_from_magic(file_content: bytes) -> str | None:
    """Detect MIME type from magic bytes (first bytes of file)."""
    # Check for common magic bytes
    for magic, mime_type in MAGIC_BYTES.items():
        if file_content.startswith(magic):
            return mime_type
    # Special handling for JPEG (can have varying start)
    if file_content[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    # Special handling for MP4 (ftyp can be at different offsets)
    if b"ftyp" in file_content[:12]:
        return "video/mp4"
    return None


def _get_mime_type(filename: str) -> str:
    """Get MIME type based on file extension."""
    ext = os.path.splitext(filename)[1].lower()
    mime_map = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
    }
    return mime_map.get(ext, "application/octet-stream")


def _get_asset_type(filename: str) -> str:
    """Determine if file is image or video."""
    ext = os.path.splitext(filename)[1].lower()
    if ext in IMAGE_EXTENSIONS:
        return "image"
    if ext in VIDEO_EXTENSIONS:
        return "video"
    return "unknown"


def get_video_dimensions(video_path: str) -> tuple[int, int]:
    """Return (width, height) of the video using ffprobe."""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-hide_banner",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "json",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed (code {result.returncode}):\n{result.stderr.strip()}")
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"ffprobe returned invalid JSON: {result.stdout[:200]!r} (exc: {exc})")
    if not isinstance(data, dict) or "streams" not in data:
        raise RuntimeError(f"ffprobe returned unexpected structure: {result.stdout[:200]!r}")
    streams = data["streams"]
    if not streams:
        raise RuntimeError(f"ffprobe: no video streams found for {video_path!r}")
    stream = streams[0]
    if "width" not in stream or "height" not in stream:
        raise RuntimeError(f"ffprobe: stream missing width/height: {stream}")
    return int(stream["width"]), int(stream["height"])


def extract_frame(video_path: str, timestamp: float, output_dir: str) -> str:
    """
    Extract a single frame from the video at the given timestamp.
    Supports both file paths and URLs (YouTube, Twitch, etc.).
    Returns the JPEG path.
    """
    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, f"frame_{timestamp:.2f}.jpg")

    # Return cached frame if it already exists
    if os.path.exists(out_path):
        return out_path

    # Check if video_path is a URL (starts with http/https)
    is_url = video_path.startswith("http://") or video_path.startswith("https://")

    if is_url:
        # For URLs, use yt-dlp to get the direct stream URL, then ffmpeg to extract frame
        url_result = subprocess.run(
            ["yt-dlp", "-f", "best", "--get-url", video_path],
            capture_output=True, text=True,
        )
        if url_result.returncode != 0 or not url_result.stdout.strip():
            raise RuntimeError(
                f"yt-dlp could not resolve video URL:\n{url_result.stderr.strip()}"
            )
        stream_url = url_result.stdout.strip().splitlines()[-1]

        cmd = [
            "ffmpeg", "-y",
            "-ss", str(timestamp),
            "-i", stream_url,
            "-vframes", "1",
            "-q:v", "2",
            out_path,
        ]
    else:
        # For file paths, use direct ffmpeg
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(timestamp),
            "-i", video_path,
            "-vframes", "1",
            "-q:v", "2",
            out_path,
        ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Frame extraction failed:\n{result.stderr.strip()}")
    return out_path


def get_media_duration(media_path: str) -> float:
    """Return duration in seconds of any media file via ffprobe. Returns 0.0 on failure."""
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json",
        media_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return 0.0
    try:
        return float(json.loads(result.stdout)["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError):
        return 0.0


def get_image_dimensions(image_path: str) -> tuple[int, int]:
    """Get image dimensions using PIL or ffprobe."""
    try:
        from PIL import Image
        with Image.open(image_path) as img:
            return img.width, img.height
    except ImportError:
        # Fallback to ffprobe
        import subprocess
        import json

        cmd = [
            "ffprobe", "-v", "quiet",
            "-hide_banner",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "json",
            image_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffprobe failed: {result.stderr.strip()}")

        data = json.loads(result.stdout)
        streams = data.get("streams", [])
        if not streams:
            raise RuntimeError("No video stream found")

        stream = streams[0]
        return int(stream["width"]), int(stream["height"])


async def save_media_file(
    file_content: bytes,
    original_filename: str,
    media_dir: str,
    progress_callback: Callable[[float, str], None] | None = None,
) -> MediaAsset:
    """
    Save an uploaded media file to the workspace.

    Security validations:
    - Path traversal prevention (strips path components from filename)
    - Extension whitelist (only allowed extensions)
    - Magic byte validation (detects MIME type spoofing)
    - File size limit (50 MB max)

    Args:
        file_content: Raw file bytes
        original_filename: Original filename from upload
        media_dir: Directory to save the file (e.g., workspace/media)
        progress_callback: Optional callback for upload progress

    Returns:
        MediaAsset with file metadata

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
    allowed_extensions = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
    if ext not in allowed_extensions:
        raise ValueError(
            f"Unsupported file extension: {ext!r}. "
            f"Allowed: {', '.join(sorted(allowed_extensions))}"
        )

    # SECURITY: Validate MIME type from magic bytes (prevent extension spoofing)
    detected_mime = _detect_mime_type_from_magic(file_content)
    expected_mime = _get_mime_type(safe_filename)

    if detected_mime is None:
        raise ValueError(
            f"Unable to validate file type. Magic bytes not recognized. "
            f"Extension: {ext!r}"
        )

    # Validate that detected MIME type matches extension
    if not detected_mime.startswith(expected_mime.split("/")[0]):
        raise ValueError(
            f"MIME type mismatch: file content is {detected_mime!r} "
            f"but extension suggests {expected_mime!r}. "
            f"This may indicate a malicious file."
        )

    # Validate asset type
    asset_type = _get_asset_type(safe_filename)
    if asset_type == "unknown":
        raise ValueError(
            f"Unsupported file type. Allowed: {IMAGE_EXTENSIONS | VIDEO_EXTENSIONS}"
        )

    # Generate unique filename (UUID to prevent collisions and info disclosure)
    safe_id = uuid.uuid4().hex[:12]
    new_filename = f"{safe_id}{ext}"
    file_path = os.path.join(media_dir, new_filename)

    # Ensure directory exists
    os.makedirs(media_dir, exist_ok=True)

    # Write file with progress tracking
    with open(file_path, "wb") as f:
        chunk_size = 4 * 1024 * 1024  # 4 MB chunks
        for i in range(0, len(file_content), chunk_size):
            chunk = file_content[i:i + chunk_size]
            f.write(chunk)
            if progress_callback:
                progress = (i + len(chunk)) / len(file_content)
                progress_callback(progress, f"Saving {original_filename}...")

    # Get dimensions
    try:
        if asset_type == "image":
            width, height = get_image_dimensions(file_path)
        else:
            width, height = get_video_dimensions(file_path)
    except Exception:
        width, height = None, None

    import time
    return MediaAsset(
        id=uuid.uuid4().hex,
        filename=new_filename,
        original_filename=original_filename,
        file_path=file_path,
        file_size=len(file_content),
        mime_type=_get_mime_type(original_filename),
        asset_type=asset_type,
        width=width,
        height=height,
        created_at=time.time(),
    )


def list_media_assets(media_dir: str, asset_type: str | None = None) -> list[MediaAsset]:
    """
    List all media assets in the media directory.

    Args:
        media_dir: Directory to scan
        asset_type: Optional filter ('image' or 'video')

    Returns:
        List of MediaAsset objects
    """
    if not os.path.exists(media_dir):
        return []

    assets = []
    for filename in os.listdir(media_dir):
        file_path = os.path.join(media_dir, filename)
        if not os.path.isfile(file_path):
            continue

        # Check if it's a supported media file
        if _get_asset_type(filename) == "unknown":
            continue

        # Apply type filter
        if asset_type and _get_asset_type(filename) != asset_type:
            continue

        try:
            stat = os.stat(file_path)
            if _get_asset_type(filename) == "image":
                width, height = get_image_dimensions(file_path)
                duration = None
            else:
                width, height = get_video_dimensions(file_path)
                duration = _get_video_duration(file_path)

            assets.append(MediaAsset(
                id=uuid.uuid4().hex,
                filename=filename,
                original_filename=filename,
                file_path=file_path,
                file_size=stat.st_size,
                mime_type=_get_mime_type(filename),
                asset_type=_get_asset_type(filename),
                width=width,
                height=height,
                duration=duration,
                created_at=stat.st_ctime,
            ))
        except Exception:
            # Skip files that can't be processed
            continue

    # Sort by creation time (newest first)
    assets.sort(key=lambda a: a.created_at or 0, reverse=True)
    return assets


def _get_video_duration(video_path: str) -> float:
    return get_media_duration(video_path)


def delete_media_asset(file_path: str) -> bool:
    """
    Delete a media asset file.

    Args:
        file_path: Path to the file to delete

    Returns:
        True if deleted, False if file didn't exist
    """
    if os.path.exists(file_path):
        os.remove(file_path)
        return True
    return False


async def validate_media_file(file_path: str) -> dict:
    """
    Validate a media file and return detailed metadata.

    Args:
        file_path: Path to the media file

    Returns:
        Dict with validation results and metadata
    """
    if not os.path.exists(file_path):
        return {"valid": False, "error": "File not found"}

    asset_type = _get_asset_type(file_path)
    if asset_type == "unknown":
        return {"valid": False, "error": "Unsupported file type"}

    result = {
        "valid": True,
        "asset_type": asset_type,
        "mime_type": _get_mime_type(file_path),
        "file_size": os.path.getsize(file_path),
    }

    try:
        if asset_type == "image":
            width, height = get_image_dimensions(file_path)
            result["width"] = width
            result["height"] = height
        else:
            width, height = get_video_dimensions(file_path)
            duration = _get_video_duration(file_path)
            result["width"] = width
            result["height"] = height
            result["duration"] = duration
    except Exception as e:
        result["valid"] = False
        result["error"] = str(e)

    return result
