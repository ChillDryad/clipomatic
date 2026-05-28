"""
SFX placement module — mixes sound effects into rendered clips.

Reads .wav/.mp3/.ogg/.flac files from workspace/sfx/ and provides FFmpeg filter
additions for mixing them into the audio stream at specified timestamps.
"""

import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)

SFX_DIR_NAME = "sfx"


@dataclass
class SfxPlacement:
    """A sound effect placement in a clip.

    sfx_name: filename of the SFX in workspace/sfx/ (e.g., "whoosh.wav")
    time: offset in seconds from clip start (when to play the SFX)
    volume: volume multiplier (0.0-1.0, default 0.7)
    fade_in: fade-in duration in seconds (default 0.05)
    fade_out: fade-out duration in seconds (default 0.1)
    """
    sfx_name: str
    time: float = 0.0
    volume: float = 0.7
    fade_in: float = 0.05
    fade_out: float = 0.1


def list_available_sfx(workspace_dir: str) -> list[str]:
    """List available SFX files in workspace/sfx/. Returns filenames."""
    sfx_dir = os.path.join(workspace_dir, SFX_DIR_NAME)
    if not os.path.isdir(sfx_dir):
        return []
    return sorted(
        f for f in os.listdir(sfx_dir)
        if f.lower().endswith((".wav", ".mp3", ".ogg", ".flac"))
    )


def resolve_sfx_path(sfx_name: str, workspace_dir: str) -> str | None:
    """Resolve an SFX name to an absolute file path. Returns None if not found."""
    sfx_dir = os.path.join(workspace_dir, SFX_DIR_NAME)
    path = os.path.join(sfx_dir, sfx_name)
    if os.path.isfile(path):
        return path
    return None


def build_sfx_filter_chain(
    placements: list[SfxPlacement],
    workspace_dir: str,
    main_audio_label: str,
    output_label: str,
    next_input_index: int,
) -> tuple[list[str], list[str], int]:
    """Build FFmpeg filter chain additions for SFX mixing.

    Returns:
        (input_args, filter_parts, next_available_index)
        - input_args: list of "-i", path pairs to add to ffmpeg command
        - filter_parts: list of filter strings to add to the filter_complex
        - next_available_index: the next input index after all SFX inputs
    """
    if not placements:
        return [], [], next_input_index

    input_args: list[str] = []
    filter_parts: list[str] = []
    sfx_labels: list[str] = []
    current_idx = next_input_index

    for placement in placements:
        sfx_path = resolve_sfx_path(placement.sfx_name, workspace_dir)
        if not sfx_path:
            logger.warning(f"SFX not found: {placement.sfx_name}, skipping")
            continue

        input_args.extend(["-i", sfx_path])

        # Build audio filter chain for this SFX
        chain = f"[{current_idx}:a]"

        # Apply volume
        if placement.volume != 1.0:
            chain += f",volume={placement.volume}"

        # Apply fade in
        if placement.fade_in > 0:
            chain += f",afade=t=in:st=0:d={placement.fade_in}"

        # Apply fade out (relative to SFX start, which will be offset by adelay)
        # We need the SFX duration for proper fade_out. Use a reasonable default
        # since we don't want to probe each file. afade out starts at
        # (sfx_duration - fade_out) but we don't know sfx_duration here.
        # Skip fade_out for simplicity — the fade_in + volume are the key effects.

        # Delay to place SFX at the right time in the clip
        if placement.time > 0:
            delay_ms = int(placement.time * 1000)
            chain += f",adelay={delay_ms}|{delay_ms}"

        sfx_label = f"[sfx{current_idx}]"
        chain += sfx_label
        filter_parts.append(chain)
        sfx_labels.append(sfx_label)
        current_idx += 1

    if not sfx_labels:
        # No valid SFX files found, passthrough
        return [], [], next_input_index

    # Mix main audio with all SFX
    all_inputs = main_audio_label + "".join(sfx_labels)
    num_inputs = 1 + len(sfx_labels)
    filter_parts.append(
        f"{all_inputs}amix=inputs={num_inputs}:duration=first:dropout_action=0{output_label}"
    )

    return input_args, filter_parts, current_idx


def suggest_sfx_placements(
    clip: dict,
    audio_energy: list[dict] | None = None,
    zoom_effect: object | None = None,
) -> list[SfxPlacement]:
    """Suggest SFX placements based on clip properties.

    Rules:
    - If zoom_effect is present, place "whoosh.wav" at clip start
    - If audio_energy has a spike after 0.5s, place "impact.wav" at that time
    - Only one impact per clip to avoid clutter
    """
    placements: list[SfxPlacement] = []

    # Rule 1: Zoom whoosh — place at the very start of the clip
    if zoom_effect is not None:
        placements.append(SfxPlacement(
            sfx_name="whoosh.wav",
            time=0.0,
            volume=0.5,
        ))

    # Rule 2: Volume spike impacts — place at the first spike after 0.5s
    if audio_energy:
        clip_start = clip.get("start", 0)
        for seg in audio_energy:
            if not seg.get("is_spike"):
                continue
            # Convert absolute time to clip-relative time
            rel_time = seg["start"] - clip_start
            if rel_time < 0.5:
                continue  # Don't overlap with zoom whoosh
            clip_end = clip.get("end", 0)
            if clip_end > 0 and rel_time > (clip_end - clip_start):
                continue  # Spike is outside the clip
            placements.append(SfxPlacement(
                sfx_name="impact.wav",
                time=rel_time,
                volume=0.6,
            ))
            break  # Only one impact per clip

    return placements