"""
Highlight detection — sends transcript chunks to an LLM and extracts
structured clip candidates based on VTuber brand pillars.

Optimized for Gemma4 (single-turn JSON output) with fallback to smaller models.
"""

import json
import logging
import re

from pipeline.transcription import transcript_to_text

logger = logging.getLogger(__name__)

BRAND_PILLARS = """
- "cozy big sister energy": warm, nurturing moments; soft gameplay commentary; comforting monologues
- "gap moe / sudden gaming rage": unexpected emotional outbursts, sudden screaming/swearing mid-cozy moment, intense skill expression
- "deep lore drops / funny out-of-context quotes": surprisingly philosophical tangents, absurdist one-liners, lore-heavy character backstory drops
"""

# Single-turn system prompt for Gemma4 — outputs JSON directly
SINGLE_TURN_SYSTEM = f"""You are a viral clip editor specializing in VTuber VOD content.
You will receive a timestamped transcript. Each line looks like:
  [MM:SS.ss] spoken words

Find 3-5 moments that would make great short clips (9–90 seconds each).
Score each clip 0–100 purely on viral potential — hook strength, emotional peak, shareability.
Note which brand pillars it touches (if any).

The brand pillars are:{BRAND_PILLARS}

Output a JSON array. Each clip object must have exactly these keys:
  "title"           (string) — punchy, clickbaity title
  "start"           (NUMBER) — start time in SECONDS only (e.g., 125.0 NOT "02:05.00")
  "end"             (NUMBER) — end time in SECONDS only (e.g., 192.0 NOT "03:12.00")
  "reason"          (string) — one sentence explaining why it's viral
  "virality_score"  (integer 0–100) — viral potential only
  "brand_alignment" (array of strings) — matching pillar names, or empty array
  "hashtags"        (array of strings) — e.g. ["#VTuber", "#GapMoe"]

CRITICAL: Convert timestamps to SECONDS. Example: [02:05.00] → start: 125.0 (NOT "02:05.00")
Formula: seconds = minutes * 60 + seconds

Clips MUST be 9–90 seconds. Trim ruthlessly — cut in just before the moment, out right after it lands.

Example output:
[
  {{"title": "She absolutely lost it", "start": 125.0, "end": 192.0, "reason": "Peak emotional outburst", "virality_score": 91, "brand_alignment": ["gap moe / sudden gaming rage"], "hashtags": ["#VTuber", "#GapMoe"]}},
  {{"title": "Wait what happened??", "start": 540.0, "end": 585.0, "reason": "Absurdist one-liner", "virality_score": 78, "brand_alignment": ["deep lore drops / funny out-of-context quotes"], "hashtags": ["#VTuber", "#Lore"]}}
]

Output ONLY the JSON array. No markdown, no explanations, no code fences."""

# Token limit for transcript chunk — increased for Gemma4's larger context
# ~24k tokens ≈ 96k chars (Gemma4 can handle more than llama3)
_MAX_CHUNK_CHARS = 96_000

# Fallback model for when primary model times out (smaller, faster)
_FALLBACK_MODEL = "phi3:mini"  # or "tinyllama:1.1b" for even faster fallback


def _chunk_transcript(text: str, max_chars: int = _MAX_CHUNK_CHARS) -> list[str]:
    """Split transcript text into chunks that fit within token limits."""
    if len(text) <= max_chars:
        return [text]

    chunks = []
    lines = text.splitlines(keepends=True)
    current = []
    current_len = 0

    for line in lines:
        if current_len + len(line) > max_chars and current:
            chunks.append("".join(current))
            # Overlap: keep last 20 lines for context continuity
            current = current[-20:]
            current_len = sum(len(l) for l in current)
        current.append(line)
        current_len += len(line)

    if current:
        chunks.append("".join(current))

    return chunks


def _find_lists(obj) -> list:
    """Recursively collect all lists found anywhere inside a parsed JSON structure."""
    results = []
    if isinstance(obj, list):
        results.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            results.extend(_find_lists(v))
    return results


def _coerce_clip(c: dict) -> dict | None:
    """
    Try to extract a valid clip from a dict, tolerating varied key names.
    Returns a normalised clip dict or None if it can't be coerced.
    """
    # Flexible key aliases models commonly use
    title = (c.get("title") or c.get("clip_title") or c.get("name") or "")
    start = c.get("start") or c.get("start_time") or c.get("start_seconds")
    end   = c.get("end")   or c.get("end_time")   or c.get("end_seconds")
    reason = (c.get("reason") or c.get("why") or c.get("description") or c.get("explanation") or "")
    virality_score = c.get("virality_score") or c.get("score") or c.get("viral_score") or 0
    hashtags = c.get("hashtags") or c.get("tags") or []
    brand_alignment = c.get("brand_alignment") or c.get("brand") or c.get("brand_pillars") or []

    if not title or start is None or end is None:
        return None
    try:
        score = int(virality_score) if virality_score else 0
        tags = list(hashtags) if isinstance(hashtags, (list, tuple)) else []
        # brand_alignment may come back as a string ("none", a pillar name, or comma-separated)
        if isinstance(brand_alignment, str):
            if brand_alignment.lower() == "none":
                brand_alignment = []
            else:
                brand_alignment = [p.strip() for p in brand_alignment.split(",") if p.strip()]
        else:
            brand_alignment = [str(p) for p in brand_alignment if str(p).lower() != "none"]
        return {
            "title": str(title),
            "start": float(start),
            "end":   float(end),
            "reason": str(reason),
            "virality_score": max(0, min(100, score)),
            "brand_alignment": brand_alignment,
            "hashtags": tags,
        }
    except (TypeError, ValueError):
        return None


def _parse_clips(raw: str) -> list[dict]:
    """
    Extract and validate clip dicts from an LLM response.
    Tolerates: markdown fences, prose wrappers, arrays, objects-as-arrays,
    nested structures, and varied key names.
    """
    # 1. Strip markdown code fences
    cleaned = re.sub(r"```(?:json)?\s*", "", raw).strip().rstrip("`").strip()

    # 2. Parse every JSON structure we can find (array or object)
    candidates: list[list] = []

    # Try direct parse first — handles the common case where the model outputs
    # clean JSON with no surrounding prose
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, list):
            candidates.append(parsed)
        elif isinstance(parsed, dict):
            for lst in _find_lists(parsed):
                candidates.append(lst)
            candidates.append(list(parsed.values()))
    except json.JSONDecodeError:
        pass

    # Fall back to regex extraction for responses with surrounding prose.
    # Use a non-greedy inner match to avoid overshooting when there are
    # multiple brackets in the text (e.g. URLs, trailing remarks).
    if not candidates:
        arr_match = re.search(r"\[.*?\]", cleaned, re.DOTALL)
        if not arr_match:
            # Last resort: greedy match (original behaviour)
            arr_match = re.search(r"\[.*\]", cleaned, re.DOTALL)
        if arr_match:
            try:
                parsed = json.loads(arr_match.group())
                if isinstance(parsed, list):
                    candidates.append(parsed)
            except json.JSONDecodeError:
                pass

    if not candidates:
        obj_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if obj_match:
            try:
                parsed = json.loads(obj_match.group())
                for lst in _find_lists(parsed):
                    candidates.append(lst)
                if isinstance(parsed, dict):
                    candidates.append(list(parsed.values()))
            except json.JSONDecodeError:
                pass

    if not candidates:
        raise ValueError(
            f"No JSON found in LLM response.\n"
            f"Raw output:\n{raw[:800]}"
        )

    # 3. Validate and coerce — use the first candidate that yields clips
    for candidate in candidates:
        validated = []
        for item in candidate:
            if not isinstance(item, dict):
                continue
            clip = _coerce_clip(item)
            if clip:
                validated.append(clip)
        if validated:
            return validated

    raise ValueError(
        f"LLM returned JSON but no recognisable clip objects.\n"
        f"Raw output:\n{raw[:800]}"
    )


def _chat(client, model: str, system: str, messages: list[dict], temperature: float = 0.4, timeout: float = 120.0) -> str:
    """
    Send a chat request, falling back if json_object response_format is unsupported.

    Args:
        client: OpenAI-compatible client
        model: Model name
        system: System prompt
        messages: User/assistant messages
        temperature: Sampling temperature
        timeout: Request timeout in seconds (default 120s)
    """
    kwargs = dict(
        model=model,
        messages=[{"role": "system", "content": system}] + messages,
        temperature=temperature,
        timeout=timeout,
    )
    try:
        resp = client.chat.completions.create(**kwargs, response_format={"type": "json_object"})
    except Exception:
        resp = client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content or ""


def detect_highlights(
    transcript: dict,
    api_key: str,
    base_url: str,
    model: str,
    progress_callback=None,
    timeout_per_chunk: float = 120.0,  # 2 minutes per LLM call (Gemma4 is faster)
    fallback_model: str = _FALLBACK_MODEL,
) -> list[dict]:
    """
    Single-turn approach optimized for Gemma4 with automatic fallback.

    Primary model (Gemma4) handles the full task in one call with JSON output.
    On timeout or API error, falls back to a smaller, faster model (Phi-3).

    Args:
        transcript: Transcript dict with segments and duration
        api_key: LLM API key
        base_url: LLM base URL
        model: Primary model name (e.g., "gemma4:latest")
        progress_callback: Progress callback
        timeout_per_chunk: Timeout per LLM call in seconds (default 120s)
        fallback_model: Fallback model name when primary fails (default "phi3:mini")
    """
    from openai import OpenAI
    from openai import APIError, APITimeoutError

    def _cb(fraction: float, label: str):
        if progress_callback:
            progress_callback(fraction, label)

    flat_text = transcript_to_text(transcript)
    chunks = _chunk_transcript(flat_text)

    # Target 6-12 clips per hour of stream (use ~9/hour as midpoint), minimum 8 total
    duration_hours = transcript.get("duration", 0) / 3600
    total_target = max(8, round(duration_hours * 9))
    # Distribute evenly across chunks; each chunk gets at least 1
    per_chunk_target = max(1, round(total_target / len(chunks)))

    client = OpenAI(api_key=api_key, base_url=base_url)

    _cb(0.0, "Preparing transcript for LLM…")

    all_clips: list[dict] = []
    n_chunks = len(chunks)

    for i, chunk in enumerate(chunks):
        chunk_label = f"Part {i + 1}/{n_chunks}"
        base_progress = i / n_chunks

        # Build prompt with dynamic clip target
        system_prompt = SINGLE_TURN_SYSTEM.replace("3-5 moments", f"{per_chunk_target} moments")
        user_message = f"Transcript (part {i + 1} of {n_chunks}):\n\n{chunk}"

        # Try primary model first (Gemma4)
        _cb(base_progress, f"{chunk_label} — analyzing with {model}…")

        try:
            answer = _chat(client, model, system_prompt, [{"role": "user", "content": user_message}],
                          temperature=0.7, timeout=timeout_per_chunk)
            clips = _parse_clips(answer)
            if clips:
                all_clips.extend(clips)
                _cb(base_progress + 0.05, f"{chunk_label} — found {len(clips)} clips")
                continue
        except APITimeoutError as e:
            logger.warning(f"Primary model {model} timed out for chunk {i+1}: {e}")
            _cb(base_progress + 0.02, f"{chunk_label} — timeout, falling back to {fallback_model}…")
        except APIError as e:
            logger.warning(f"Primary model {model} failed for chunk {i+1}: {e}")
            _cb(base_progress + 0.02, f"{chunk_label} — API error, falling back to {fallback_model}…")
        except ValueError as e:
            logger.warning(f"Primary model {model} returned invalid output for chunk {i+1}: {e}")
            _cb(base_progress + 0.02, f"{chunk_label} — invalid output, falling back to {fallback_model}…")

        # Fallback to smaller model
        try:
            _cb(base_progress + 0.05, f"{chunk_label} — retrying with {fallback_model}…")
            answer = _chat(client, fallback_model, system_prompt, [{"role": "user", "content": user_message}],
                          temperature=0.7, timeout=timeout_per_chunk)
            clips = _parse_clips(answer)
            if clips:
                all_clips.extend(clips)
                _cb(base_progress + 0.1, f"{chunk_label} — found {len(clips)} clips (fallback)")
        except (APITimeoutError, APIError, ValueError) as e:
            logger.warning(f"Fallback model {fallback_model} failed for chunk {i+1}: {e}")
            _cb(base_progress + 0.1, f"{chunk_label} — skipped (both models failed)")
            continue

    _cb(0.95, f"Found {len(all_clips)} raw clips — deduplicating…")

    # Deduplicate by time-window overlap (>50% of the shorter clip's duration).
    # When two clips overlap, keep the one with the higher virality_score.
    def _overlaps(a: dict, b: dict, threshold: float = 0.5) -> bool:
        overlap = max(0.0, min(a["end"], b["end"]) - max(a["start"], b["start"]))
        duration = min(a["end"] - a["start"], b["end"] - b["start"])
        return duration > 0 and (overlap / duration) > threshold

    kept: list[dict] = []
    for clip in all_clips:
        conflict = next((k for k in kept if _overlaps(k, clip)), None)
        if conflict is None:
            kept.append(clip)
        elif clip.get("virality_score", 0) > conflict.get("virality_score", 0):
            kept[kept.index(conflict)] = clip

    _cb(1.0, f"Highlight detection complete — {len(kept)} clips.")
    return kept
