"""
Momiji Clipper — Shared helper functions.

Cross-router utilities for user serialization, path handling, cache management,
subtitle parsing, and clip metadata operations.
"""

import json
import logging
import os
import re
from functools import lru_cache
from typing import Any

from fastapi import HTTPException, Response
from fastapi.responses import Response as FastAPIResponse

from db import User, VideoProject, get_session_cm

logger = logging.getLogger(__name__)

# Get WORKSPACE from environment (matches api.py definition)
WORKSPACE = os.environ.get(
    "WORKSPACE_DIR",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "workspace"),
)


# ---------------------------------------------------------------------------
# Path utilities
# ---------------------------------------------------------------------------

def _resolve_workspace_path(path: str) -> str:
    """
    Translate /workspace/... URL paths to the real filesystem path.

    Args:
        path: URL path starting with /workspace/ or raw filesystem path

    Returns:
        Absolute filesystem path
    """
    if path.startswith("/workspace/"):
        return os.path.join(WORKSPACE, path.removeprefix("/workspace/"))
    return path


def _validate_workspace_path(path: str) -> None:
    """
    Raise HTTPException(400) if path escapes the workspace directory.

    Args:
        path: Filesystem path to validate

    Raises:
        HTTPException: If path is outside workspace
    """
    try:
        path_abs = os.path.abspath(path)
        workspace_abs = os.path.abspath(WORKSPACE)
        if not path_abs.startswith(workspace_abs + os.sep) and path_abs != workspace_abs:
            raise HTTPException(status_code=400, detail="Path is outside the workspace directory.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path.")


# ---------------------------------------------------------------------------
# User serialization
# ---------------------------------------------------------------------------

def _user_dict(user: "User") -> dict:
    """
    Serialize a User ORM object to the standard 4-field response dict.

    Args:
        user: SQLAlchemy User ORM object

    Returns:
        Dict with id, email, display_name, is_verified
    """
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "is_verified": user.is_verified,
    }


# ---------------------------------------------------------------------------
# Auth cookies
# ---------------------------------------------------------------------------

def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    """
    Attach HttpOnly access + refresh token cookies to any Response.

    Args:
        response: FastAPI Response object to modify
        access_token: JWT access token
        refresh_token: JWT refresh token
    """
    from auth import ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        expires=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
        secure=False,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        expires=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        samesite="lax",
        secure=False,
        path="/",
    )


# ---------------------------------------------------------------------------
# Cache path helpers
# ---------------------------------------------------------------------------

def _clips_cache_path(source_path: str) -> str:
    """
    Get the clips cache file path for a given source path.

    Args:
        source_path: Source video file path

    Returns:
        Full path to clips cache JSON file
    """
    stem = os.path.splitext(os.path.basename(source_path))[0]
    return os.path.join(WORKSPACE, f"{stem}_clips.json")


def _parse_clip_key(encoded: str) -> tuple[str, int]:
    """
    Parse '{source_path}___{index}' into (source_path, index).

    Args:
        encoded: Clip key in format "video_path___index"

    Returns:
        Tuple of (source_path, index)

    Raises:
        HTTPException: If format is invalid
    """
    parts = encoded.rsplit("___", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Invalid clip_key format.")
    try:
        index = int(parts[1])
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid clip index.")
    return parts[0], index


# ---------------------------------------------------------------------------
# LRU-cached path lookups
# ---------------------------------------------------------------------------

@lru_cache(maxsize=500)
def _get_cached_frame_path(video_path: str, timestamp_rounded: int) -> str | None:
    """
    LRU-cached frame path lookup (maxsize=500).

    Args:
        video_path: Path to the video file
        timestamp_rounded: Rounded timestamp (to nearest second)

    Returns:
        Path to cached frame or None if not found
    """
    frame_path = os.path.join(WORKSPACE, "frames", f"{os.path.basename(video_path)}_{timestamp_rounded}.jpg")
    if os.path.exists(frame_path):
        return frame_path
    return None


def _invalidate_frame_cache(video_path: str) -> None:
    """Clear LRU cache entries for a specific video."""
    _get_cached_frame_path.cache_clear()


@lru_cache(maxsize=100)
def _get_cached_transcript_path(stem: str) -> str | None:
    """
    LRU-cached transcript path lookup (maxsize=100).

    Args:
        stem: Video filename without extension

    Returns:
        Path to cached transcript or None if not found
    """
    transcript_path = os.path.join(WORKSPACE, f"{stem}_transcript.json")
    if os.path.exists(transcript_path):
        return transcript_path
    return None


def _invalidate_transcript_cache(stem: str) -> None:
    """Clear LRU cache entry for a specific transcript."""
    _get_cached_transcript_path.cache_clear()


@lru_cache(maxsize=200)
def _get_cached_clips_path(stem: str) -> str | None:
    """
    LRU-cached clips path lookup (maxsize=200).

    Args:
        stem: Video filename without extension

    Returns:
        Path to cached clips JSON or None if not found
    """
    clips_path = os.path.join(WORKSPACE, f"{stem}_clips.json")
    if os.path.exists(clips_path):
        return clips_path
    return None


def _invalidate_clips_cache(stem: str) -> None:
    """Clear LRU cache entry for a specific clips file."""
    _get_cached_clips_path.cache_clear()


# ---------------------------------------------------------------------------
# Project status updates
# ---------------------------------------------------------------------------

async def _update_project_status(source_path: str, status: str) -> None:
    """
    Update project status by source_path.

    Args:
        source_path: Source video path to look up project
        status: New status value ('pending', 'processing', 'complete', 'failed')
    """
    from sqlalchemy import select

    async with get_session_cm() as session:
        result = await session.execute(
            select(VideoProject).where(VideoProject.source_path == source_path)
        )
        project = result.scalar_one_or_none()
        if project:
            project.status = status
            await session.commit()


# ---------------------------------------------------------------------------
# Subtitle parsers
# ---------------------------------------------------------------------------

def _parse_srt(text: str) -> list[dict]:
    """
    Parse SRT content into a list of cue dicts.

    Args:
        text: SRT file content

    Returns:
        List of {text, startTime, duration} dicts
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    cues = []
    blocks = text.split("\n\n")
    for block in blocks:
        if not block.strip():
            continue
        lines = block.split("\n")
        if len(lines) < 3:
            continue
        try:
            index = int(lines[0].strip())
        except ValueError:
            continue
        ts_match = re.match(r"(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})", lines[1])
        if not ts_match:
            continue
        h, m, s, ms, h2, m2, s2, ms2 = (int(x) for x in ts_match.groups())
        start = h * 3600 + m * 60 + s + ms / 1000.0
        end = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000.0
        cue_text = "\n".join(lines[2:]).strip()
        cues.append({"text": cue_text, "startTime": start, "duration": end - start})
    return cues


def _parse_ass(text: str) -> list[dict]:
    """
    Parse ASS/SSA content into a list of cue dicts.

    Args:
        text: ASS/SSA file content

    Returns:
        List of {text, startTime, duration} dicts
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    cues = []
    sections = re.split(r"(?=^\[)", text, flags=re.MULTILINE)
    events_section = ""
    for section in sections:
        if section.startswith("[Events]"):
            events_section = section
            break
    if not events_section:
        return cues
    for line in events_section.split("\n"):
        if not line.startswith("Dialogue:"):
            continue
        parts = line[len("Dialogue:"):].split(",", 9)
        if len(parts) < 10:
            continue
        start_str = parts[1].strip()
        end_str = parts[2].strip()
        raw_text = parts[9].rstrip()

        def parse_ass_time(ts: str) -> float:
            m = re.match(r"(\d+):(\d{2}):(\d{2})\.(\d{2})", ts)
            if not m:
                return 0.0
            h, m_, s, cs = (int(x) for x in m.groups())
            return h * 3600 + m_ * 60 + s + cs / 100.0

        start = parse_ass_time(start_str)
        end = parse_ass_time(end_str)
        cleaned = re.sub(r"\{.*?\}", "", raw_text)
        cleaned = cleaned.replace("\\N", "\n")
        cues.append({"text": cleaned.strip(), "startTime": start, "duration": end - start})
    return cues


# ---------------------------------------------------------------------------
# Clip helpers
# ---------------------------------------------------------------------------

def _extract_clip_segment(transcript: dict, clip_start: float, clip_end: float, words_per_line: int = 2) -> list[dict]:
    """
    Pull words from the transcript that fall within [clip_start, clip_end]
    and group them into lines of `words_per_line` words each.

    Args:
        transcript: Full transcript dict with segments and words
        clip_start: Start time in seconds
        clip_end: End time in seconds
        words_per_line: Number of words per output line

    Returns:
        List of {start, end, text, words} dicts
    """
    all_words: list[dict] = []
    for seg in transcript.get("segments", []):
        for w in seg.get("words", []):
            if w["start"] >= clip_start and w["end"] <= clip_end:
                all_words.append(w)

    lines = []
    for i in range(0, len(all_words), words_per_line):
        chunk = all_words[i:i + words_per_line]
        if not chunk:
            continue
        lines.append({
            "start": chunk[0]["start"],
            "end": chunk[-1]["end"],
            "text": " ".join(w["word"] for w in chunk),
            "words": chunk,
        })
    return lines


async def _regenerate_clip_metadata(clip: dict, transcript: dict) -> dict:
    """
    Send the clip's transcript segment to the LLM and get back an
    improved title and hashtags.

    Args:
        clip: Clip dict with start/end times
        transcript: Full transcript dict

    Returns:
        Updated clip dict with new title, description, hashtags
    """
    from openai import OpenAI

    api_key = os.environ.get("LLM_API_KEY", "")
    base_url = os.environ.get("LLM_BASE_URL", "")
    model = os.environ.get("LLM_MODEL", "llama3.1:8b")

    client = OpenAI(api_key=api_key, base_url=base_url)

    clip_start = clip["start"]
    clip_end = clip["end"]

    words = _extract_clip_segment(transcript, clip_start, clip_end, words_per_line=2)
    if not words:
        return clip

    def fmt(t: float) -> str:
        m = int(t // 60)
        s = t % 60
        return f"{m:02d}:{s:05.2f}"

    lines_text = "\n".join(f"[{fmt(w['start'])}] {w['text']}" for w in words)

    system_prompt = """You are a Viral Growth Strategist for Momiji Yoru's VTuber channel.
Your goal: Convert scrollers into viewers. Clips are the funnel; the stream is the destination.

BRAND ESSENCE:
- Core Identity: The "Big Sister" of gaming. Calm, cozy, and nurturing until the game breaks her.
- The Hook: "Gap Moe." The contrast between her soothing lo-fi vibe and sudden gaming rage.
- Audience: People looking for authenticity, comfort, and genuine reactions.

INSTRUCTIONS:
Analyze the transcript for moments with high "stopping power."
Prioritize:
1. Immediate Conflict (starts in the middle of action/emotion).
2. Relatable Struggle (dying to a boss, game bugs, lag).
3. Wholesome Connection (genuine advice, comforting chat).
4. "Gap Moe" Swings (calm voice suddenly snapping into rage).

Return ONLY a valid JSON array of objects with:
- "title": Max 50 chars, lowercase, no emojis, curiosity gap
- "description": Max 140 chars, direct address to viewer
- "hashtags": Array of 6-8 tags
- "virality_score": Integer 1-10

Example:
[
  {
    "title": "when the boss hits you through the wall",
    "description": "tell me i'm not the only one dealing with this. come rant about it on stream.",
    "hashtags": ["#fyp", "#gaming", "#VTuberEN", "#Shorts", "#EldenRing"],
    "virality_score": 9
  }
]
"""

    user_prompt = f"Transcript segment ({fmt(clip_start)} – {fmt(clip_end)}):\n\n{lines_text}"

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.4,
        )
        raw = resp.choices[0].message.content or "{}"
        result = json.loads(raw)
        title = (result.get("title") or clip.get("title") or "").strip()
        description = (result.get("description") or clip.get("description") or "").strip()
        hashtags = result.get("hashtags") or clip.get("hashtags") or []
        return {
            **clip,
            "title": title[:60],
            "description": description[:150] if description else "",
            "hashtags": list(hashtags) if isinstance(hashtags, list) else clip.get("hashtags", []),
        }
    except Exception as exc:
        logger.error("Failed to regenerate clip metadata: %s", exc)
        return clip


async def _generate_post_description(clip: dict, transcript: dict) -> str:
    """
    Generate a social media post description based on the clip's transcript.
    Does NOT mention AI - written as if a human fan edited and posted this.

    Args:
        clip: Clip dict with title, hashtags
        transcript: Full transcript dict

    Returns:
        Post description string (1-3 lines, engaging, human-written style)
    """
    from openai import OpenAI

    api_key = os.environ.get("LLM_API_KEY", "")
    base_url = os.environ.get("LLM_BASE_URL", "")
    model = os.environ.get("LLM_MODEL", "llama3.1:8b")

    client = OpenAI(api_key=api_key, base_url=base_url)

    clip_start = clip["start"]
    clip_end = clip["end"]

    words = _extract_clip_segment(transcript, clip_start, clip_end, words_per_line=1)
    if not words:
        return "Check out this moment from the stream!"

    def fmt(t: float) -> str:
        m = int(t // 60)
        s = t % 60
        return f"{m:02d}:{s:05.2f}"

    lines_text = "\n".join(f"[{fmt(w['start'])}] {w['text']}" for w in words)

    system_prompt = """You are a social media manager writing a post description for a VTuber clip from Momiji Yoru — a lo-fi urban elf VTuber known for the "cozy big sister to gaming rage" personality shift, late-night balcony streams, and accidental humor.

YOUR GOAL: Write a post description that makes someone feel like they just stumbled onto a genuinely iconic moment from someone they're already friends with.

CRITICAL RULES:
- NEVER mention AI, bots, automation, clipping, "clipping by", or any production tooling
- Write as if a passionate fan edited and posted this in their own words
- Sound like a real person talking to their friends — not a marketing team
- Create curiosity OR relatability OR hype (ideally two of the three)
- NO corporate energy. NO hype language. NO generic VTuber energy.
- 1-3 lines maximum, under 280 characters total
- The description should SELL the moment, not just label it

BRAND VOICE (Momiji-specific):
- Cozy, nurturing big sister energy (makes tea, checks in on chat, cares deeply)
- Sudden, hilarious pivot to gaming rage (then resets with a breath or sip of tea)
- Dry wit, self-aware humor, accidental innuendo
- Deep lore/worldbuilding tangents (Monster Hunter, D&D)
- Authentic chaos — says what's actually on her mind
- Community rituals: "Tea Time", "Rage Marathon", "Oops All Elves" D&D series

WHAT MAKES A CLIP VIRAL:
1. The RAGE SHIFT — calm → passionate frustration → comedic reset. These are your gold clips.
2. ACCIDENTAL INNUENDO — moments where something comes out wrong in the funniest way
3. RELATABLE CHAOS — things viewers have also experienced (losing to easy bosses, rage-quitting, forgetting controls)
4. PEAK LORE DROPS — passionate tangents about game worlds, worldbuilding, or character motivations
5. COMMUNITY CALLBACKS — references to established stream rituals or ongoing jokes

NEVER DO:
- Don't be generic ("This is hilarious", "You have to see this")
- Don't over-explain the clip — trust the viewer to get it
- Don't make it sound like an advertisement
- Don't use more than 3 lines

FORMAT:
Return ONLY the post description text. No quotes. No JSON. No explanation. Just raw, human energy text."""

    user_prompt = f"""Clip title: {clip.get("title", "Untitled")}
Timestamp: {clip.get("start", "0:00")} to {clip.get("end", "0:00")}
Transcript segment:
{lines_text}

Based on the clip title and transcript, write a short, punchy post description that:
- Hooks the viewer in the first 5 words
- Sells the specific MOMENT (not just "watch this")
- Sounds like a real human fan posted it
- Fits one of these vibes (pick what matches the clip):
  • Hype/excitement (something cool happened)
  • Relatable chaos (something frustrating/funny happened)
  • Genuine warmth (something wholesome happened)
  • Curious hook (something weird happened and you need context)
  • Rage energy (she LOST it and it's hilarious)
Output only the description text. Nothing else."""

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.7,
        )
        raw = resp.choices[0].message.content or ""
        logger.info("LLM raw response for post description: %s", raw[:500] if len(raw) > 500 else raw)
        # Clean up the response - remove quotes, trim whitespace
        cleaned = raw.strip().strip('"').strip("'")
        logger.info("Cleaned post description: %s", cleaned)
        return cleaned[:280] if cleaned else f"Check out: {clip.get('title', 'this moment')}!"
    except Exception as exc:
        logger.error("Failed to generate post description: %s", exc)
        return f"Check out: {clip.get('title', 'this moment')}!"
