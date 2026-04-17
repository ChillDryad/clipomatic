#!/usr/bin/env python3
"""
Standalone test for highlight detection.
Loads a cached transcript JSON and runs the LLM clip detection pipeline.

Usage:
    python test_highlight_detection.py <transcript.json>
    python test_highlight_detection.py workspace/myvideo_transcript.json

Credentials are read from .env or environment variables:
    LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
"""

import json
import os
import sys

from dotenv import load_dotenv  # optional — silently skipped if not installed

try:
    load_dotenv()
except Exception:
    pass

from pipeline.highlight_detection import detect_highlights


def main():
    if len(sys.argv) < 2:
        print("Usage: python test_highlight_detection.py <transcript.json>")
        sys.exit(1)

    transcript_path = sys.argv[1]
    if not os.path.exists(transcript_path):
        print(f"Error: file not found: {transcript_path}")
        sys.exit(1)

    with open(transcript_path, "r", encoding="utf-8") as f:
        transcript = json.load(f)

    base_url = os.environ.get("LLM_BASE_URL", "")
    api_key  = os.environ.get("LLM_API_KEY", "")
    model    = os.environ.get("LLM_MODEL", "")

    if not base_url or not api_key or not model:
        print("Error: LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL must be set.")
        print("Add them to .env or export them before running.")
        sys.exit(1)

    print(f"Transcript: {transcript_path}")
    print(f"Segments:   {len(transcript.get('segments', []))}")
    print(f"Duration:   {transcript.get('duration', '?')}s")
    print(f"Endpoint:   {base_url}")
    print(f"Model:      {model}")
    print()
    print("Running highlight detection…")

    clips = detect_highlights(
        transcript=transcript,
        api_key=api_key,
        base_url=base_url,
        model=model,
    )

    print(f"\nFound {len(clips)} clip(s):\n")
    for i, clip in enumerate(clips, 1):
        start_m, start_s = divmod(int(clip["start"]), 60)
        end_m,   end_s   = divmod(int(clip["end"]),   60)
        print(f"  {i}. {clip['title']}")
        print(f"     {start_m}:{start_s:02d} → {end_m}:{end_s:02d}")
        print(f"     {clip['reason']}")
        print()


if __name__ == "__main__":
    main()
