import json
import struct
import sys
import types

from pipeline import audio, highlight_detection, vision


def test_ram_tiers_bound_pipeline_work(monkeypatch):
    from pipeline.performance import get_ram_tier_config

    monkeypatch.setenv("RAM_TIER", "low")
    low = get_ram_tier_config()
    monkeypatch.setenv("RAM_TIER", "standard")
    standard = get_ram_tier_config()
    monkeypatch.setenv("RAM_TIER", "high")
    high = get_ram_tier_config()

    assert (low.transcription_chunk_minutes, standard.transcription_chunk_minutes, high.transcription_chunk_minutes) == (15.0, 30.0, 60.0)
    assert low.vision_fps < standard.vision_fps <= high.vision_fps
    assert low.vision_max_frames < standard.vision_max_frames < high.vision_max_frames
    assert low.highlight_chars < standard.highlight_chars < high.highlight_chars
    assert low.vision_max_frames <= 120


def test_whisper_model_cache_eviction_releases_all_models(monkeypatch):
    from pipeline import transcription

    model = object()
    transcription._model_cache[("small", "cpu", "int8")] = model
    collected = []
    monkeypatch.setattr("gc.collect", lambda: collected.append(True))

    transcription.evict_model_cache()

    assert transcription._model_cache == {}
    assert collected == [True]


def test_num_ctx_is_propagated_to_highlight_and_vision_calls(monkeypatch, tmp_path):
    highlight_calls = []

    class HighlightCompletions:
        def create(self, **kwargs):
            highlight_calls.append(kwargs)
            message = types.SimpleNamespace(content="[]")
            return types.SimpleNamespace(choices=[types.SimpleNamespace(message=message)])

    highlight_client = types.SimpleNamespace(
        chat=types.SimpleNamespace(completions=HighlightCompletions())
    )
    highlight_detection._chat(
        highlight_client,
        "gemma3:latest",
        "system",
        [{"role": "user", "content": "text"}],
        num_ctx=2048,
    )
    assert highlight_calls[0]["extra_body"] == {"num_ctx": 2048}

    video_path = tmp_path / "vod.mp4"
    frame_path = tmp_path / "frame.jpg"
    video_path.write_bytes(b"video")
    frame_path.write_bytes(b"jpeg")
    monkeypatch.setenv("LOCAL_LLM_MODELS", "gemma3:latest")
    monkeypatch.setattr(vision, "get_media_duration", lambda _: 60.0)
    monkeypatch.setattr(
        vision,
        "_scan_video_frames",
        lambda *args, **kwargs: [
            {"timestamp": 30.0, "path": str(frame_path), "activity": 0.1}
        ],
    )
    monkeypatch.setattr(
        vision,
        "_materialize_selected_frames",
        lambda _video, candidates, _output: candidates,
    )
    vision_calls = []

    class VisionCompletions:
        def create(self, **kwargs):
            vision_calls.append(kwargs)
            payload = json.dumps([{
                "visual_energy": 5,
                "scene_type": "gameplay",
                "description": "Frame",
                "has_text_overlay": False,
                "emotional_tone": "neutral",
            }])
            message = types.SimpleNamespace(content=payload)
            return types.SimpleNamespace(choices=[types.SimpleNamespace(message=message)])

    fake_client = types.SimpleNamespace(
        chat=types.SimpleNamespace(completions=VisionCompletions())
    )
    monkeypatch.setitem(
        sys.modules,
        "openai",
        types.SimpleNamespace(OpenAI=lambda **kwargs: fake_client),
    )
    vision.analyze_video_frames(
        str(video_path),
        str(tmp_path),
        "ollama",
        "http://localhost:11434/v1",
        "gemma3:latest",
        max_frames=1,
        num_ctx=2048,
    )
    assert vision_calls[0]["extra_body"] == {"num_ctx": 2048}


def test_audio_energy_streams_bounded_pcm_blocks(monkeypatch, tmp_path):
    audio_path = tmp_path / "input.wav"
    audio_path.write_bytes(b"wav")
    pcm = b"".join(
        struct.pack("16000f", *([level] * 16000))
        for level in (0.1, 1.0, 0.1)
    )

    class BoundedStream:
        def __init__(self, data):
            self.data = data
            self.offset = 0
            self.read_sizes = []

        def read(self, size=-1):
            self.read_sizes.append(size)
            assert size > 0, "PCM reads must always be bounded"
            chunk = self.data[self.offset:self.offset + size]
            self.offset += len(chunk)
            return chunk

        def close(self):
            pass

    stream = BoundedStream(pcm)
    process = types.SimpleNamespace(
        stdout=stream,
        stderr=types.SimpleNamespace(read=lambda: b""),
        wait=lambda: 0,
        kill=lambda: None,
    )
    monkeypatch.setattr(audio, "_get_audio_info", lambda _: {
        "duration": 3.0,
        "sample_rate": 16000,
        "channels": 1,
    })
    monkeypatch.setattr(audio.subprocess, "Popen", lambda *args, **kwargs: process)

    segments = audio.analyze_audio_energy(
        str(audio_path), spike_threshold=2.0, spike_window=1.0
    )

    assert len(segments) == 3
    assert segments[1]["is_spike"] is True
    assert max(stream.read_sizes) == 16000 * 4
