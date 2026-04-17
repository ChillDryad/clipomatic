"""
Highlight detection — sends transcript chunks to a Cloud LLM and extracts
structured clip candidates based on VTuber brand pillars.
"""

import json
import logging
import re

from pipeline.transcription import transcript_to_text

BRAND_PILLARS = """
- "cozy big sister energy": warm, nurturing moments; soft gameplay commentary; comforting monologues
- "gap moe / sudden gaming rage": unexpected emotional outbursts, sudden screaming/swearing mid-cozy moment, intense skill expression
- "deep lore drops / funny out-of-context quotes": surprisingly philosophical tangents, absurdist one-liners, lore-heavy character backstory drops
"""

def _build_step1_system(target_clips: int) -> str:
    """Build the Turn 1 system prompt with a dynamic clip target."""
    return f"""You are a viral clip editor specialising in VTuber content.
You will be given a timestamped transcript. Each line looks like:
  [MM:SS.ss] spoken words

Find exactly {target_clips} moments that would make great short clips (9–90 seconds each).
Score each clip 0–100 purely on viral potential — hook strength, emotional peak, shareability —
IGNORING whether it fits any brand. Then separately note which brand pillars it touches (if any).

The brand pillars are:{BRAND_PILLARS}
For each moment write ONE line in this exact format:
  CLIP: <start> to <end> | <punchy title> | <one sentence reason> | score=<0-100> | brand=<pillar name or "none"> | <#tag1 #tag2 #tag3>

Clips MUST be between 9 and 90 seconds long. Trim ruthlessly — cut in just before the moment and out right after it lands.
Use the exact timestamps from the transcript. Example:
  CLIP: 02:05.00 to 02:52.00 | She absolutely lost it | Peak emotional outburst with perfect timing | score=91 | brand=gap moe / sudden gaming rage | #VTuber #GapMoe #GamingRage
  CLIP: 09:00.00 to 09:45.00 | Wait that actually happened?? | Absurdist one-liner lands perfectly | score=78 | brand=deep lore drops / funny out-of-context quotes | #VTuber #Lore #OutOfContext
  CLIP: 14:30.00 to 15:05.00 | Unexpected gameplay clutch | Insane skill moment with no setup needed | score=85 | brand=none | #Gaming #Clutch #VTuber

Only output CLIP lines. No other text."""


# Turn 2 — now ask for JSON. The model has already done the hard thinking in turn 1.
STEP2_SYSTEM = """Convert the clip list into a JSON array.
Each item must have exactly these keys:
  "title"           (string)
  "start"           (number of seconds, e.g. 125.0)
  "end"             (number of seconds, e.g. 192.0)
  "reason"          (string)
  "virality_score"  (integer 0–100, purely viral potential ignoring brand fit)
  "brand_alignment" (array of strings — brand pillar names that apply, or empty array if none)
  "hashtags"        (array of strings, e.g. ["#VTuber", "#GapMoe"])

Output ONLY the JSON array. No markdown, no explanation."""

# Rough token limit for transcript chunk sent to LLM (~12k tokens ≈ 48k chars)
_MAX_CHUNK_CHARS = 48_000


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


def _chat(client, model: str, system: str, messages: list[dict], temperature: float = 0.4) -> str:
    """Send a chat request, falling back if json_object response_format is unsupported."""
    kwargs = dict(
        model=model,
        messages=[{"role": "system", "content": system}] + messages,
        temperature=temperature,
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
) -> list[dict]:
    """
    Two-turn approach for reliable clip detection on small and large models alike.

    Turn 1: ask the model to identify clip moments in plain English (CLIP: lines).
    Turn 2: ask the model to convert its own answer into JSON.

    This separates the reasoning step from the formatting step, which small models
    handle much better than trying to do both at once.
    """
    from openai import OpenAI

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
    # Each chunk has 2 turns (identify → convert to JSON).
    total_turns = n_chunks * 2

    for i, chunk in enumerate(chunks):
        chunk_label = f"Part {i + 1}/{n_chunks}"
        step1_system = _build_step1_system(per_chunk_target)
        # --- Turn 1: identify clips in plain English ---
        turn1_base = (i * 2) / total_turns
        _cb(turn1_base, f"{chunk_label} — identifying clips…")
        turn1_user = f"Transcript (part {i + 1} of {n_chunks}):\n\n{chunk}"
        turn1_answer = _chat(client, model, step1_system, [{"role": "user", "content": turn1_user}])

        if not turn1_answer.strip():
            _cb((i * 2 + 1) / total_turns, f"{chunk_label} — no clips found, skipping…")
            continue

        # --- Turn 2: convert the answer to JSON ---
        turn2_base = (i * 2 + 1) / total_turns
        _cb(turn2_base, f"{chunk_label} — formatting clips as JSON…")
        turn2_messages = [
            {"role": "user", "content": turn1_user},
            {"role": "assistant", "content": turn1_answer},
            {"role": "user", "content": "Now convert those clips to the JSON array format."},
        ]
        turn2_answer = _chat(client, model, STEP2_SYSTEM, turn2_messages, temperature=0.1)

        clips = _parse_clips(turn2_answer)
        all_clips.extend(clips)

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
