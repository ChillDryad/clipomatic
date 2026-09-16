import json
import sys
import types

from pipeline import vision
from pipeline.vision import (
    _load_vision_cache,
    _parse_vision_batch_response,
    _save_vision_cache,
)


def test_batch_parser_assigns_input_timestamps_in_order():
    raw = json.dumps([
        {
            "visual_energy": 7,
            "scene_type": "gameplay",
            "description": "Boss fight",
            "has_text_overlay": False,
            "emotional_tone": "surprised",
        },
        {
            "visual_energy": 2,
            "scene_type": "menu",
            "description": "Inventory screen",
            "has_text_overlay": True,
            "emotional_tone": "neutral",
        },
    ])

    parsed = _parse_vision_batch_response(raw, [30.5, 60.5])

    assert [item["timestamp"] for item in parsed] == [30.5, 60.5]
    assert parsed[0]["description"] == "Boss fight"


def test_batch_parser_accepts_object_wrapped_frames():
    raw = json.dumps({
        "frames": [
            {
                "visual_energy": 5,
                "scene_type": "talking_head",
                "description": "Chatting",
                "has_text_overlay": False,
                "emotional_tone": "happy",
            }
        ]
    })

    parsed = _parse_vision_batch_response(raw, [90.5])

    assert parsed[0]["timestamp"] == 90.5


def test_cache_round_trip_requires_matching_fingerprint(tmp_path):
    cache_path = tmp_path / "vision-cache.json"
    payload = {
        "fingerprint": {"size": 123, "mtime_ns": 456},
        "config": {"model": "gemma3:latest", "scan_fps": 1.0},
        "complete": False,
        "results": [{"timestamp": 10.5, "visual_energy": 4}],
    }

    _save_vision_cache(str(cache_path), payload)

    assert _load_vision_cache(
        str(cache_path), payload["fingerprint"], payload["config"]
    ) == payload
    assert _load_vision_cache(
        str(cache_path), {"size": 999, "mtime_ns": 456}, payload["config"]
    ) is None


def test_analysis_batches_requests_and_reuses_completed_cache(monkeypatch, tmp_path):
    video_path = tmp_path / "vod.mp4"
    video_path.write_bytes(b"video")
    frames = []
    for index in range(4):
        path = tmp_path / f"frame-{index}.jpg"
        path.write_bytes(b"jpeg")
        frames.append({
            "timestamp": index * 60.0 + 30.0,
            "path": str(path),
            "activity": 0.1,
        })

    scan_calls = []
    monkeypatch.setattr(vision, "get_media_duration", lambda _: 240.0)
    monkeypatch.setattr(
        vision,
        "_scan_video_frames",
        lambda *args, **kwargs: scan_calls.append(1) or frames,
    )
    monkeypatch.setattr(
        vision,
        "_materialize_selected_frames",
        lambda _video, candidates, _output: candidates,
    )
    monkeypatch.setenv("LOCAL_LLM_MODELS", "gemma3:latest")

    request_count = 0

    class Completions:
        def create(self, **kwargs):
            nonlocal request_count
            request_count += 1
            image_count = sum(
                item.get("type") == "image_url"
                for item in kwargs["messages"][1]["content"]
            )
            payload = [
                {
                    "visual_energy": 5,
                    "scene_type": "gameplay",
                    "description": "Frame",
                    "has_text_overlay": False,
                    "emotional_tone": "neutral",
                }
                for _ in range(image_count)
            ]
            message = types.SimpleNamespace(content=json.dumps(payload))
            return types.SimpleNamespace(
                choices=[types.SimpleNamespace(message=message)]
            )

    fake_client = types.SimpleNamespace(
        chat=types.SimpleNamespace(completions=Completions())
    )
    fake_openai = types.SimpleNamespace(OpenAI=lambda **kwargs: fake_client)
    monkeypatch.setitem(sys.modules, "openai", fake_openai)

    first = vision.analyze_video_frames(
        video_path=str(video_path),
        output_dir=str(tmp_path),
        api_key="ollama",
        base_url="http://ollama-shared:11434/v1",
        model="gemma3:latest",
        scan_fps=1.0,
        window_seconds=60,
        max_frames=4,
        batch_size=2,
    )
    second = vision.analyze_video_frames(
        video_path=str(video_path),
        output_dir=str(tmp_path),
        api_key="ollama",
        base_url="http://ollama-shared:11434/v1",
        model="gemma3:latest",
        scan_fps=1.0,
        window_seconds=60,
        max_frames=4,
        batch_size=2,
    )

    assert len(first) == 4
    assert second == first
    assert request_count == 2
    assert len(scan_calls) == 1
