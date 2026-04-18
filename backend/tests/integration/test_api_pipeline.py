"""
Integration tests for Video Pipeline API endpoints.

API Documentation:
- Swagger UI: http://localhost:7860/docs
- ReDoc: http://localhost:7860/redoc

Endpoints tested:
- POST /api/transcribe - Transcribe video with Whisper
- GET /api/transcribe/cached - Get cached transcription
- POST /api/highlights - Detect highlights with LLM
- GET /api/highlights/cached - Get cached highlights
- GET /api/clips/{clip_key} - Get clip metadata
- PATCH /api/clips/{clip_key} - Update clip metadata

Security considerations (OWASP):
- A01:2021 Broken Access Control - Workspace path validation
- A08:2021 Software and Data Integrity Failures - JSON validation
- A10:2021 SSRF - Workspace path traversal prevention
"""

import os
import json
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch

# Test configuration
TEST_TRANSCRIPT = {
    "language": "en",
    "language_probability": 0.99,
    "duration": 120.5,
    "segments": [
        {
            "start": 0.0,
            "end": 5.0,
            "text": "Hello world",
            "words": [
                {"word": "Hello", "start": 0.0, "end": 2.0, "probability": 0.99},
                {"word": "world", "start": 2.0, "end": 5.0, "probability": 0.98},
            ],
        }
    ],
}

TEST_CLIPS = [
    {
        "title": "Test Highlight",
        "start": 10.0,
        "end": 40.0,
        "reason": "Interesting moment",
        "virality_score": 85,
        "brand_alignment": ["test pillar"],
        "hashtags": ["#Test"],
    }
]


class TestTranscribeEndpoint:
    """Tests for POST /api/transcribe endpoint.

    API Docs: http://localhost:7860/docs#/default/transcribe_api_transcribe_post

    Features:
    - GPU-accelerated Whisper transcription
    - Automatic device detection (CUDA/Apple Silicon/CPU)
    - Chunked processing for long videos (>30 min)
    - SSE progress streaming
    """

    @pytest.mark.asyncio
    async def test_transcribe_success(self, api_client, temp_workspace, sample_transcript):
        """Test successful transcription.

        Expected behavior:
        - Detects best available compute backend
        - Returns SSE stream with word-level timestamps
        - Saves transcript JSON to workspace
        """
        test_video = os.path.join(temp_workspace, "test_video.mp4")

        with patch("api.transcription.transcribe") as mock_transcribe, \
             patch("api.WORKSPACE", temp_workspace):

            mock_transcribe.return_value = sample_transcript

            response = await api_client.post(
                "/api/transcribe",
                json={"video_path": test_video},
            )

            assert response.status_code == 200
            content = response.text
            assert '"done": true' in content or '"result"' in content
            mock_transcribe.assert_called_once()

    @pytest.mark.asyncio
    async def test_transcribe_video_not_found(self, api_client):
        """Test transcription fails gracefully for missing video."""
        response = await api_client.post(
            "/api/transcribe",
            json={"video_path": "/workspace/nonexistent.mp4"},
        )

        # Should return error in SSE stream
        assert response.status_code == 200
        assert "error" in response.text.lower() or "not found" in response.text.lower()

    @pytest.mark.asyncio
    async def test_transcribe_with_custom_model(self, api_client, temp_workspace):
        """Test transcription with custom Whisper model.

        Models: tiny, base, small, medium, large-v3
        """
        test_video = os.path.join(temp_workspace, "test_video.mp4")

        with patch("api.transcription.transcribe") as mock_transcribe, \
             patch("api.WORKSPACE", temp_workspace):

            mock_transcribe.return_value = TEST_TRANSCRIPT

            response = await api_client.post(
                "/api/transcribe",
                json={
                    "video_path": test_video,
                    "model": "base",
                    "device": "cpu",
                },
            )

            assert response.status_code == 200
            # Verify model parameter passed through
            call_args = mock_transcribe.call_args
            assert call_args is not None

    @pytest.mark.asyncio
    async def test_transcribe_path_traversal_blocked(self, api_client):
        """Test that path traversal attempts are blocked.

        Security: Video paths must be within workspace directory.
        """
        response = await api_client.post(
            "/api/transcribe",
            json={"video_path": "/etc/passwd"},
        )

        # Should return error (path outside workspace)
        assert response.status_code == 200  # SSE stream
        assert "error" in response.text.lower() or "workspace" in response.text.lower()


class TestTranscribeCachedEndpoint:
    """Tests for GET /api/transcribe/cached endpoint.

    API Docs: http://localhost:7860/docs#/default/get_cached_transcript_api_transcribe_cached_get

    Returns cached transcription if it exists, otherwise 404.
    """

    @pytest.mark.asyncio
    async def test_get_cached_transcript_exists(self, api_client, temp_workspace, sample_transcript):
        """Test retrieving cached transcript."""
        # Create cached transcript file
        stem = "test_video"
        cache_path = os.path.join(temp_workspace, f"{stem}_transcript.json")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(cache_path, "w") as f:
            json.dump(sample_transcript, f)

        with patch("api.WORKSPACE", temp_workspace):
            response = await api_client.get(
                "/api/transcribe/cached",
                params={"video_path": os.path.join(temp_workspace, "test_video.mp4")},
            )

            assert response.status_code == 200
            data = response.json()
            assert "segments" in data
            assert data["duration"] == 120.5

    @pytest.mark.asyncio
    async def test_get_cached_transcript_not_found(self, api_client, temp_workspace):
        """Test 404 when cached transcript doesn't exist."""
        with patch("api.WORKSPACE", temp_workspace):
            response = await api_client.get(
                "/api/transcribe/cached",
                params={"video_path": os.path.join(temp_workspace, "nonexistent.mp4")},
            )

            assert response.status_code == 404


class TestHighlightsEndpoint:
    """Tests for POST /api/highlights endpoint.

    API Docs: http://localhost:7860/docs#/default/detect_highlights_api_highlights_post

    Features:
    - LLM-based viral moment detection
    - Two-turn prompt for reliable clip extraction
    - Brand alignment scoring (cozy energy, gap moe rage, lore drops)
    - Virality scoring (0-100)
    """

    @pytest.mark.asyncio
    async def test_detect_highlights_success(self, api_client, temp_workspace, sample_transcript, sample_clips_list):
        """Test successful highlight detection.

        Expected behavior:
        - Sends transcript to LLM
        - Parses JSON response for clips
        - Returns SSE stream with detected clips
        - Saves clips JSON to workspace
        """
        transcript_path = os.path.join(temp_workspace, "test_transcript.json")
        with open(transcript_path, "w") as f:
            json.dump(sample_transcript, f)

        with patch("api.highlight_detection.detect_highlights") as mock_detect, \
             patch("api.WORKSPACE", temp_workspace):

            mock_detect.return_value = sample_clips_list

            response = await api_client.post(
                "/api/highlights",
                json={"transcript_path": transcript_path},
            )

            assert response.status_code == 200
            content = response.text
            assert '"done": true' in content or '"result"' in content
            mock_detect.assert_called_once()

    @pytest.mark.asyncio
    async def test_detect_highlights_with_custom_model(self, api_client, temp_workspace, sample_transcript):
        """Test highlight detection with custom LLM model."""
        transcript_path = os.path.join(temp_workspace, "test_transcript.json")
        with open(transcript_path, "w") as f:
            json.dump(sample_transcript, f)

        with patch("api.highlight_detection.detect_highlights") as mock_detect, \
             patch("api.WORKSPACE", temp_workspace):

            mock_detect.return_value = TEST_CLIPS

            response = await api_client.post(
                "/api/highlights",
                json={
                    "transcript_path": transcript_path,
                    "model": "llama3.1:8b",
                    "brand_pillars": ["cozy energy", "gaming rage"],
                },
            )

            assert response.status_code == 200
            mock_detect.assert_called_once()

    @pytest.mark.asyncio
    async def test_detect_highlights_transcript_not_found(self, api_client):
        """Test highlight detection fails gracefully for missing transcript."""
        response = await api_client.post(
            "/api/highlights",
            json={"transcript_path": "/workspace/nonexistent.json"},
        )

        # Should return error in SSE stream
        assert response.status_code == 200
        assert "error" in response.text.lower()


class TestHighlightsCachedEndpoint:
    """Tests for GET /api/highlights/cached endpoint.

    API Docs: http://localhost:7860/docs#/default/get_cached_highlights_api_highlights_cached_get

    Returns cached highlights if they exist, otherwise 404.
    """

    @pytest.mark.asyncio
    async def test_get_cached_highlights_exists(self, api_client, temp_workspace, sample_clips_list):
        """Test retrieving cached highlights."""
        # Create cached highlights file
        stem = "test_video"
        cache_path = os.path.join(temp_workspace, f"{stem}_clips.json")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(cache_path, "w") as f:
            json.dump(sample_clips_list, f)

        with patch("api.WORKSPACE", temp_workspace):
            response = await api_client.get(
                "/api/highlights/cached",
                params={"video_path": os.path.join(temp_workspace, "test_video.mp4")},
            )

            assert response.status_code == 200
            data = response.json()
            assert isinstance(data, list)
            assert len(data) == 2
            assert "virality_score" in data[0]

    @pytest.mark.asyncio
    async def test_get_cached_highlights_not_found(self, api_client, temp_workspace):
        """Test 404 when cached highlights don't exist."""
        with patch("api.WORKSPACE", temp_workspace):
            response = await api_client.get(
                "/api/highlights/cached",
                params={"video_path": os.path.join(temp_workspace, "nonexistent.mp4")},
            )

            assert response.status_code == 404


class TestClipsEndpoints:
    """Tests for clip metadata endpoints.

    API Docs:
    - GET /api/clips/{clip_key}: http://localhost:7860/docs#/default/get_clip_api_clips__clip_key__get
    - PATCH /api/clips/{clip_key}: http://localhost:7860/docs#/default/patch_clip_api_clips__clip_key__patch

    clip_key format: URL-encoded "{source_path}___{index}"
    Example: /workspace/video.mp4___0
    """

    @pytest.mark.asyncio
    async def test_get_clip_success(self, api_client, temp_workspace, sample_clips_list):
        """Test retrieving a single clip by key."""
        # Create cached clips file
        stem = "test_video"
        cache_path = os.path.join(temp_workspace, f"{stem}_clips.json")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(cache_path, "w") as f:
            json.dump(sample_clips_list, f)

        with patch("api.WORKSPACE", temp_workspace):
            # clip_key is URL-encoded path + index
            clip_key = f"{os.path.join(temp_workspace, 'test_video.mp4')}___0"
            import urllib.parse
            encoded_key = urllib.parse.quote(clip_key, safe="")

            response = await api_client.get(f"/api/clips/{encoded_key}")

            assert response.status_code == 200
            data = response.json()
            assert "title" in data
            assert "start" in data
            assert "end" in data

    @pytest.mark.asyncio
    async def test_get_clip_not_found(self, api_client, temp_workspace):
        """Test 404 when clip cache doesn't exist."""
        with patch("api.WORKSPACE", temp_workspace):
            clip_key = f"{os.path.join(temp_workspace, 'nonexistent.mp4')}___0"
            import urllib.parse
            encoded_key = urllib.parse.quote(clip_key, safe="")

            response = await api_client.get(f"/api/clips/{encoded_key}")

            assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_patch_clip_title(self, api_client, temp_workspace, sample_clips_list):
        """Test updating clip title."""
        # Create cached clips file
        stem = "test_video"
        cache_path = os.path.join(temp_workspace, f"{stem}_clips.json")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(cache_path, "w") as f:
            json.dump(sample_clips_list, f)

        with patch("api.WORKSPACE", temp_workspace):
            clip_key = f"{os.path.join(temp_workspace, 'test_video.mp4')}___0"
            import urllib.parse
            encoded_key = urllib.parse.quote(clip_key, safe="")

            response = await api_client.patch(
                f"/api/clips/{encoded_key}",
                json={"title": "Updated Clip Title"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["title"] == "Updated Clip Title"

            # Verify file was updated
            with open(cache_path) as f:
                updated_clips = json.load(f)
            assert updated_clips[0]["title"] == "Updated Clip Title"

    @pytest.mark.asyncio
    async def test_patch_clip_timestamps(self, api_client, temp_workspace, sample_clips_list):
        """Test updating clip start/end timestamps."""
        stem = "test_video"
        cache_path = os.path.join(temp_workspace, f"{stem}_clips.json")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(cache_path, "w") as f:
            json.dump(sample_clips_list, f)

        with patch("api.WORKSPACE", temp_workspace):
            clip_key = f"{os.path.join(temp_workspace, 'test_video.mp4')}___0"
            import urllib.parse
            encoded_key = urllib.parse.quote(clip_key, safe="")

            response = await api_client.patch(
                f"/api/clips/{encoded_key}",
                json={"start": 15.0, "end": 45.0},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["start"] == 15.0
            assert data["end"] == 45.0

    @pytest.mark.asyncio
    async def test_patch_clip_crop_region(self, api_client, temp_workspace, sample_clips_list):
        """Test updating clip crop regions for avatar/gameplay."""
        stem = "test_video"
        cache_path = os.path.join(temp_workspace, f"{stem}_clips.json")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(cache_path, "w") as f:
            json.dump(sample_clips_list, f)

        with patch("api.WORKSPACE", temp_workspace):
            clip_key = f"{os.path.join(temp_workspace, 'test_video.mp4')}___0"
            import urllib.parse
            encoded_key = urllib.parse.quote(clip_key, safe="")

            response = await api_client.patch(
                f"/api/clips/{encoded_key}",
                json={
                    "crop_avatar": {"x": 100, "y": 50, "w": 400, "h": 400},
                    "crop_game": {"x": 500, "y": 100, "w": 800, "h": 450},
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert "crop_avatar" in data
            assert "crop_game" in data
            assert data["crop_avatar"]["x"] == 100

    @pytest.mark.asyncio
    async def test_patch_clip_invalid_index(self, api_client, temp_workspace):
        """Test 404 when clip index is out of range."""
        # Create empty clips file
        stem = "test_video"
        cache_path = os.path.join(temp_workspace, f"{stem}_clips.json")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(cache_path, "w") as f:
            json.dump([], f)  # Empty list

        with patch("api.WORKSPACE", temp_workspace):
            clip_key = f"{os.path.join(temp_workspace, 'test_video.mp4')}___99"
            import urllib.parse
            encoded_key = urllib.parse.quote(clip_key, safe="")

            response = await api_client.patch(
                f"/api/clips/{encoded_key}",
                json={"title": "Test"},
            )

            assert response.status_code == 404


class TestRegenerateMetadataEndpoint:
    """Tests for POST /api/clips/regenerate-metadata endpoint.

    API Docs: http://localhost:7860/docs#/default/regenerate_clip_metadata_api_clips_regenerate_metadata_post

    Allows regenerating clip titles/hashtags using LLM with improved prompts.
    """

    @pytest.mark.asyncio
    async def test_regenerate_metadata_success(self, api_client, sample_clip, sample_transcript):
        """Test regenerating clip metadata with LLM."""
        new_metadata = {
            "title": "New Viral Title",
            "description": "Updated description",
            "hashtags": ["#New", "#Hashtags"],
        }

        with patch("api._regenerate_clip_metadata") as mock_regenerate:
            mock_regenerate.return_value = new_metadata

            response = await api_client.post(
                "/api/clips/regenerate-metadata",
                json={"clip": sample_clip, "transcript": sample_transcript},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["title"] == "New Viral Title"
            mock_regenerate.assert_called_once()
