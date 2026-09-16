import pytest

from llm_policy import validate_local_model
from pipeline import highlight_detection, vision


def test_allows_explicitly_configured_local_model(monkeypatch):
    monkeypatch.setenv("LOCAL_LLM_MODELS", "gemma4:12b,gemma3:latest")

    assert validate_local_model("gemma3:latest") == "gemma3:latest"


def test_rejects_cloud_model_even_if_misconfigured_in_allowlist(monkeypatch):
    monkeypatch.setenv("LOCAL_LLM_MODELS", "gemma3:latest,glm-5.2:cloud")

    with pytest.raises(ValueError, match="Cloud models are disabled"):
        validate_local_model("glm-5.2:cloud")


def test_rejects_unlisted_model(monkeypatch):
    monkeypatch.setenv("LOCAL_LLM_MODELS", "gemma4:12b,gemma3:latest")

    with pytest.raises(ValueError, match="not in LOCAL_LLM_MODELS"):
        validate_local_model("llama3.1:latest")


def test_vision_rejects_cloud_model_before_processing(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCAL_LLM_MODELS", "gemma3:latest")
    monkeypatch.setattr(vision, "get_media_duration", lambda _: 0)

    with pytest.raises(ValueError, match="Cloud models are disabled"):
        vision.analyze_video_frames(
            video_path="unused.mp4",
            output_dir=str(tmp_path),
            api_key="ollama",
            base_url="http://ollama-shared:11434/v1",
            model="glm-5.2:cloud",
        )


def test_highlights_reject_cloud_model_before_request(monkeypatch):
    monkeypatch.setenv("LOCAL_LLM_MODELS", "gemma4:12b")

    with pytest.raises(ValueError, match="Cloud models are disabled"):
        highlight_detection.detect_highlights(
            transcript={"segments": [], "duration": 0},
            api_key="ollama",
            base_url="http://ollama-shared:11434/v1",
            model="glm-5.2:cloud",
        )
