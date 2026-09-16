"""RAM-tiered performance limits for pipeline stages."""

from dataclasses import dataclass
import os


@dataclass(frozen=True)
class RamTierConfig:
    transcription_chunk_minutes: float
    vision_fps: float
    vision_max_frames: int
    highlight_chars: int
    ollama_num_ctx: int
    vision_cache_batches: int


_RAM_TIERS = {
    "low": RamTierConfig(15.0, 0.10, 60, 12_000, 4096, 10),
    "standard": RamTierConfig(30.0, 0.25, 120, 24_000, 8192, 5),
    "high": RamTierConfig(60.0, 0.50, 240, 48_000, 16_384, 2),
}


def get_ram_tier_config(tier: str | None = None) -> RamTierConfig:
    """Return bounded pipeline settings for RAM_TIER (default: standard)."""
    name = (tier or os.environ.get("RAM_TIER", "standard")).strip().lower()
    return _RAM_TIERS.get(name, _RAM_TIERS["standard"])
