"""
Highlight detection — sends transcript chunks to an LLM and extracts
structured clip candidates based on VTuber brand pillars.

Optimized for Gemma4 (single-turn JSON output) with fallback to smaller models.
"""

import bisect
import json
import logging
import os
import re

from pipeline.transcription import transcript_to_text

logger = logging.getLogger(__name__)

BRAND_PILLARS = """
- "cozy big sister energy": warm, nurturing moments; soft gameplay commentary; comforting monologues; tea-sipping calm; encouraging viewers
- "gap moe / sudden gaming rage": unexpected emotional outbursts; sudden screaming/swearing mid-cozy moment; intense skill expression; dramatic mood whiplash
- "deep lore drops / funny out-of-context quotes": surprisingly philosophical tangents; absurdist one-liners; lore-heavy character backstory drops; memorable quotable moments
"""

SINGLE_TURN_SYSTEM = f"""You are a viral clip editor specializing in VTuber VOD content.
You will receive a timestamped transcript. Each line looks like:
 [H:MM:SS.ss] spoken words (e.g. [0:02:05.00] = 2 minutes 5 seconds, [1:30:00.00] = 1 hour 30 minutes)
## YOUR TASK
Find 3-5 moments that would make great short clips (9–90 seconds each).

## VIRALITY SCORING CRITERIA (0-100)
Score based on these factors:
- **Hook in first 3 seconds** (+25 pts): Question, surprise, emotion, or punchline immediately
- **Emotional peak** (+25 pts): Laugh, rage, awe, vulnerability, or unexpected twist
- **Standalone clarity** (+25 pts): Makes sense without prior context; no "wait, who is that?" confusion
- **Shareability** (+25 pts): Relatable, quotable, or "you have to see this" energy

## BRAND PILLAR MATCHING
Only assign a pillar if the clip CLEARLY demonstrates it. It's okay to have empty brand_alignment.
The brand pillars are:{BRAND_PILLARS}
## WHAT TO AVOID
- Dead air, loading screens, or setup chatter
- Unresolved moments (clip ends before payoff)
- Inside jokes that require 10 minutes of context
- Clips where the best line is cut off
- Timestamps marked [OVERLAP] — already covered in a previous part; prefer timestamps from non-overlap lines

## HOOK TYPES TO LOOK FOR
- **Question hook**: "Wait, did I just...?"
- **Emotional shift**: Calm → rage, confident → humbled
- **Punchline**: Setup → payoff within the clip
- **Surprise**: Unexpected game event, plot twist, viewer donation shock
- **Relatability**: "We've all been there" gaming fails

## OUTPUT FORMAT
Output a JSON array. Each clip object must have exactly these keys:
 "title" (string) — Enticing but not clickbait-y. MUST include exactly 2-3 relevant hashtags at the end.
 "start" (string) — start timestamp EXACTLY as shown in the transcript (e.g., "2:23:35.00" NOT 8615 or "23:35")
 "end" (string) — end timestamp EXACTLY as shown in the transcript (e.g., "2:24:15.00" NOT 8655 or "24:15")
 "reason" (string) — one sentence explaining why it's viral
 "virality_score" (integer 0–100) — based on criteria above
 "brand_alignment" (array of strings) — matching pillar names ONLY if clear fit, or empty array
 "description" (string) — A punchy caption that expands on the hook and encourages viewers to visit the stream.
 "description_hashtags" (array of strings) — Tiered hashtags: Broad (#VTuber, #Gaming), Niche (#CozyGaming, #GapMoe), Brand (#MomijiYoru)
 "recommendation_reason" (string) — Detailed explanation referencing transcript content, hook type, and brand pillars.

## TIMESTAMP FORMAT (CRITICAL)
Copy timestamps EXACTLY as they appear in the transcript. Do NOT convert to seconds or drop the hours.
The transcript uses [H:MM:SS.ss] format — your start/end values MUST match this format WITHOUT the brackets.
CORRECT: "start": "2:23:35.00"
WRONG: "start": 8615 (converted to seconds)
WRONG: "start": "23:35" (dropped hours)
WRONG: "start": "0:23:35.00" (wrong hours — copy exactly what the transcript shows)

## CLIP LENGTH
Target clip length: 9–90 seconds. Pick start and end timestamps that create clips of this length.

## EXAMPLE OUTPUT
[
 {{"title": "She absolutely lost it 💀 #GamingFail #Shorts", "start": "0:02:05.00", "end": "0:03:12.00", "reason": "Peak emotional outburst with perfect comedic timing", "virality_score": 91, "brand_alignment": ["gap moe / sudden gaming rage"], "description": "Momiji's patience finally snapped and the result was pure chaos. Come hang out on the balcony for more rage-fueled gaming! 🏮", "description_hashtags": ["#VTuber", "#GapMoe", "#CozyGaming", "#MomijiYoru"], "recommendation_reason": "This moment captures a sudden shift from cozy energy to intense gaming rage - the contrast is what makes it viral. The screaming reaction at 2:05 followed by immediate apology hits the 'gap moe' pillar perfectly. Hook type: emotional shift. Comment engagement will be high because viewers love relatable gaming frustration."}}
]

Output ONLY the JSON array. No markdown, no explanations, no code fences."""

_AUDIO_ENERGY_SYSTEM_APPEND = """

## AUDIO ENERGY ANNOTATIONS
The transcript includes audio energy annotations marked as:
- SPIKE: Sudden volume increase — potential emotional peak or hook moment
- SILENCE: Quiet pause — often precedes important moments or punchlines
- RAPID_SPEECH: Speaking rate above average — may indicate excitement or urgency
Use these annotations to better score the Hook and Emotional Peak criteria. A SPIKE near the start of a clip strongly suggests a good hook. A SILENCE followed by a SPIKE is a classic setup-payoff pattern."""

_VISION_SYSTEM_APPEND = """

## VISUAL ANALYSIS ANNOTATIONS
The transcript includes visual frame analysis marked as:
- HIGH_ENERGY: Frame with high visual activity — intense gameplay, dramatic on-screen moment
- EMOTION: Detected facial/avatar expression (happy, angry, surprised, laughing, etc.)
- ON_SCREEN_TEXT: Donation alert, notification, or significant text overlay visible
- SCENE: Non-standard scene type (loading, menu, transition, overlay)
Use these to catch moments that transcripts miss — laughter visible on a face, clutch gameplay moments, or donation reactions. A HIGH_ENERGY frame near a transcript spike strongly suggests a viral moment."""

# Token limit for transcript chunk — increased for Gemma4's larger context
# ~24k tokens ≈ 96k chars (Gemma4 can handle more than llama3)
_MAX_CHUNK_CHARS = 12_000  # Fits cloud model 262k context with system prompt

# Fallback model for when primary model times out (smaller, faster)
_FALLBACK_MODEL = "gemma3:latest"


def _build_timestamp_indices(transcript: dict) -> tuple[list[float], list[float]]:
    """Build sorted lists of word start and end timestamps from the transcript.

    Returns (starts, ends) where starts are all word-start times and ends are
    all word-end times. Used to snap clip boundaries to actual speech.
    """
    starts: list[float] = []
    ends: list[float] = []
    for seg in transcript.get("segments", []):
        for w in seg.get("words", []):
            if "start" in w:
                starts.append(w["start"])
            if "end" in w:
                ends.append(w["end"])
    starts.sort()
    ends.sort()
    return starts, ends


def _snap_to_index(
    timestamp: float, index: list[float], tolerance: float = 30.0
) -> float | None:
    """Find the nearest timestamp in the index within tolerance.

    Returns the snapped timestamp, or None if no timestamp is within tolerance
    (likely a hallucination or mis-conversion).
    """
    if not index:
        return None

    pos = bisect.bisect_left(index, timestamp)
    candidates = []
    if pos < len(index):
        candidates.append(index[pos])
    if pos > 0:
        candidates.append(index[pos - 1])
    nearest = min(candidates, key=lambda t: abs(t - timestamp))
    if abs(nearest - timestamp) <= tolerance:
        return nearest
    return None


def _chunk_transcript(text: str, max_chars: int = _MAX_CHUNK_CHARS) -> list[str]:
    """Split transcript text into chunks that fit within token limits.

    Overlap lines from the previous chunk are prefixed with [OVERLAP]
    so the LLM knows they were already covered and should not be selected
    as clip boundaries.
    """
    if len(text) <= max_chars:
        return [text]

    chunks = []
    lines = text.splitlines(keepends=True)
    current = []
    current_len = 0
    OVERLAP_LINES = 20

    for line in lines:
        if current_len + len(line) > max_chars and current:
            chunks.append("".join(current))
            # Overlap: keep last N lines, marked as already covered
            overlap = current[-OVERLAP_LINES:]
            current = [f"[OVERLAP]{ol}" for ol in overlap]
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


def _parse_timestamp(value) -> float | None:
    """Parse a timestamp to float seconds.

    Accepts numeric values (int/float) and time strings in H:MM:SS.ss,
    MM:SS.ss, or plain float format. Returns None if unparseable.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().strip("[]")
    # Try plain float (e.g., "125.0" or "8615")
    try:
        return float(s)
    except ValueError:
        pass
    # Try H:MM:SS.ss (e.g., "2:23:35.00" or "0:00:45.50")
    m = re.match(r"(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)", s)
    if m:
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    # Try MM:SS.ss (e.g., "23:35" or "22:05.00")
    m = re.match(r"(\d+):(\d{1,2}(?:\.\d+)?)", s)
    if m:
        return int(m.group(1)) * 60 + float(m.group(2))
    return None


def _coerce_clip(c: dict) -> dict | None:
    """
    Try to extract a valid clip from a dict, tolerating varied key names.
    Returns a normalised clip dict or None if it can't be coerced.
    """
    # Flexible key aliases models commonly use
    title = (c.get("title") or c.get("clip_title") or c.get("name") or "")
    start_raw = c.get("start") if c.get("start") is not None else (c.get("start_time") if c.get("start_time") is not None else c.get("start_seconds"))
    end_raw   = c.get("end")   if c.get("end") is not None   else (c.get("end_time")   if c.get("end_time") is not None   else c.get("end_seconds"))
    start = _parse_timestamp(start_raw)
    end = _parse_timestamp(end_raw)
    reason = (c.get("reason") or c.get("why") or c.get("description") or c.get("explanation") or "")
    recommendation_reason = c.get("recommendation_reason") or c.get("detailed_reason") or c.get("why_recommended") or ""
    virality_score = c.get("virality_score") or c.get("score") or c.get("viral_score") or 0
    hashtags = c.get("hashtags") or c.get("tags") or []
    brand_alignment = c.get("brand_alignment") or c.get("brand") or c.get("brand_pillars") or []

    if not title or start is None or end is None:
        return None
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
        "start": start,
        "end":   end,
        "reason": str(reason),
        "recommendation_reason": str(recommendation_reason) if recommendation_reason else None,
        "virality_score": max(0, min(100, score)),
        "brand_alignment": brand_alignment,
        "hashtags": tags,
    }


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


def _chat(
    client,
    model: str,
    system: str,
    messages: list[dict],
    temperature: float = 0.4,
    timeout: float = 300.0,
    num_ctx: int = 8192,
) -> str:
    """
    Send a chat request, falling back if json_object response_format is unsupported.

    Args:
        client: OpenAI-compatible client
        model: Model name
        system: System prompt
        messages: User/assistant messages
        temperature: Sampling temperature
        timeout: Request timeout in seconds (default 300s / 5 minutes)
    """
    kwargs = dict(
        model=model,
        messages=[{"role": "system", "content": system}] + messages,
        temperature=temperature,
        timeout=timeout,
        extra_body={"num_ctx": num_ctx},
    )
    try:
        resp = client.chat.completions.create(**kwargs, response_format={"type": "json_object"})
    except Exception:
        resp = client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content or ""


def compute_word_density(
    transcript: dict, window: float = 1.0
) -> list[dict]:
    """Compute words-per-second per time window from transcript word timestamps.

    Args:
        transcript: Transcript dict with segments containing word-level timestamps.
        window: Window duration in seconds (default 1.0).

    Returns:
        List of dicts with start, end, word_count, is_rapid.
    """
    if not transcript.get("segments"):
        return []

    # Collect all word timestamps
    word_times: list[float] = []
    for seg in transcript["segments"]:
        for w in seg.get("words", []):
            if "start" in w:
                word_times.append(w["start"])

    if not word_times:
        return []

    duration = transcript.get("duration", word_times[-1] + 1.0)
    bins: list[dict] = []
    idx = 0

    t = 0.0
    while t < duration:
        end = t + window
        count = 0
        while idx < len(word_times) and word_times[idx] < end:
            count += 1
            idx += 1
        bins.append({
            "start": round(t, 3),
            "end": round(end, 3),
            "word_count": count,
        })
        t = end

    # Reset idx and recount for mean
    mean_count = sum(b["word_count"] for b in bins) / len(bins) if bins else 0
    for b in bins:
        b["is_rapid"] = b["word_count"] > 1.5 * mean_count if mean_count > 0 else False

    return bins


def _format_audio_annotations(
    audio_energy: list[dict] | None = None,
    word_density: list[dict] | None = None,
) -> str:
    """Format audio energy and word density data as LLM-readable annotations.

    Only includes notable events (spikes, silence, rapid speech) to keep the
    prompt concise. Returns an empty string if no notable events are found.
    """
    lines: list[str] = []
    seen_times: set[float] = set()
    _MAX_ANNOTATIONS = 200  # Cap to prevent context overflow

    if audio_energy:
        for seg in audio_energy:
            if len(lines) >= _MAX_ANNOTATIONS:
                break
            if seg.get("is_spike"):
                t = seg["start"]
                lines.append(
                    f"[{_seconds_to_timestamp(t)}] SPIKE - sudden volume increase "
                    f"(peak={seg['peak']:.2f})"
                )
                seen_times.add(t)
            if seg.get("silence_ratio", 0) > 0.7 and not seg.get("is_spike"):
                t = seg["start"]
                if t not in seen_times:
                    lines.append(
                        f"[{_seconds_to_timestamp(t)}] SILENCE - "
                        f"quiet pause ({seg['silence_ratio']:.0%} silent)"
                    )
                    seen_times.add(t)

    if word_density:
        for seg in word_density:
            if seg.get("is_rapid"):
                t = seg["start"]
                if t not in seen_times:
                    lines.append(
                        f"[{_seconds_to_timestamp(t)}] RAPID_SPEECH - "
                        f"{seg['word_count']} words/sec"
                    )
                    seen_times.add(t)

    if not lines:
        return ""

    return "\n\n## AUDIO ENERGY (timestamp - label)\n" + "\n".join(lines)


def _seconds_to_timestamp(seconds: float) -> str:
    """Convert float seconds to H:MM:SS.ss timestamp matching transcript format."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def detect_highlights(
    transcript: dict,
    api_key: str,
    base_url: str,
    model: str,
    progress_callback=None,
    timeout_per_chunk: float = 300.0,  # 5 minutes per LLM call (increased for larger models)
    fallback_model: str = _FALLBACK_MODEL,
    audio_energy: list[dict] | None = None,
    vision_data: list[dict] | None = None,
    max_chunk_chars: int = _MAX_CHUNK_CHARS,
    num_ctx: int = 8192,
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
        timeout_per_chunk: Timeout per LLM call in seconds (default 300s)
        fallback_model: Fallback model name when primary fails (default "gemma3:latest")
        audio_energy: Optional per-second audio energy data from analyze_audio_energy()
    """
    from llm_policy import validate_local_model

    # Allow cloud models if LLM_ALLOW_CLOUD is set
    if os.environ.get("LLM_ALLOW_CLOUD", "").lower() in ("1", "true", "yes"):
        pass  # Skip validation — cloud models allowed
    else:
        model = validate_local_model(model)
    fallback_model = validate_local_model(fallback_model)

    from openai import OpenAI
    from openai import APIError, APITimeoutError

    def _cb(fraction: float, label: str):
        if progress_callback:
            progress_callback(fraction, label)

    flat_text = transcript_to_text(transcript)
    chunks = _chunk_transcript(flat_text, max_chars=max_chunk_chars)

    # Build audio energy annotations if available
    word_density = compute_word_density(transcript) if audio_energy else None
    audio_annotations = _format_audio_annotations(audio_energy, word_density)
    system_prompt_suffix = _AUDIO_ENERGY_SYSTEM_APPEND if audio_annotations else ""

    # Build vision annotations if available
    from pipeline.vision import format_vision_annotations
    vision_annotations = format_vision_annotations(vision_data)
    if vision_annotations:
        system_prompt_suffix += _VISION_SYSTEM_APPEND

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
        if system_prompt_suffix:
            system_prompt += system_prompt_suffix
        user_message = f"Transcript (part {i + 1} of {n_chunks}):\n\n{chunk}"
        if audio_annotations:
            user_message += audio_annotations
        if vision_annotations:
            user_message += vision_annotations

        # Try primary model first (Gemma4)
        _cb(base_progress, f"{chunk_label} — analyzing with {model}…")

        try:
            answer = _chat(client, model, system_prompt, [{"role": "user", "content": user_message}],
                          temperature=0.7, timeout=timeout_per_chunk, num_ctx=num_ctx)
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
                          temperature=0.7, timeout=timeout_per_chunk, num_ctx=num_ctx)
            clips = _parse_clips(answer)
            if clips:
                all_clips.extend(clips)
                _cb(base_progress + 0.1, f"{chunk_label} — found {len(clips)} clips (fallback)")
        except (APITimeoutError, APIError, ValueError) as e:
            logger.warning(f"Fallback model {fallback_model} failed for chunk {i+1}: {e}")
            _cb(base_progress + 0.1, f"{chunk_label} — skipped (both models failed)")
            continue

    _cb(0.95, f"Found {len(all_clips)} raw clips — deduplicating…")

    # Filter out clips outside video duration (LLM hallucination guard)
    video_duration = transcript.get("duration", 0)
    if video_duration > 0:
        before = len(all_clips)
        all_clips = [
            c for c in all_clips
            if c["start"] >= 0 and c["end"] <= video_duration and c["start"] < c["end"]
        ]
        if len(all_clips) < before:
            _cb(0.95, f"Filtered {before - len(all_clips)} clips outside video duration ({video_duration:.0f}s)")

    # Snap clip timestamps to nearest word boundaries from the transcript.
    # Snap start to nearest word-start and end to nearest word-end so clips
    # begin and end on actual speech boundaries.
    start_idx, end_idx = _build_timestamp_indices(transcript)
    if start_idx and end_idx:
        before = len(all_clips)
        snapped = []
        for c in all_clips:
            start_snap = _snap_to_index(c["start"], start_idx)
            end_snap = _snap_to_index(c["end"], end_idx)
            if start_snap is None or end_snap is None:
                logger.warning(
                    f"Dropping clip {c.get('title', '?')}: "
                    f"start={c['start']} snap={start_snap}, end={c['end']} snap={end_snap} "
                    f"— too far from any word in transcript"
                )
                continue
            duration = end_snap - start_snap
            if duration < 9 or duration > 90:
                logger.warning(
                    f"Dropping clip {c.get('title', '?')}: "
                    f"snapped duration {duration:.1f}s outside 9-90s range"
                )
                continue
            c["start"] = start_snap
            c["end"] = end_snap
            snapped.append(c)
        all_clips = snapped
        if len(all_clips) < before:
            _cb(0.95, f"Snapped timestamps, filtered {before - len(all_clips)} clips")

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
