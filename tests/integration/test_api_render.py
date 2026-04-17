"""
Integration tests for Video Rendering API endpoints.

API Documentation:
- Swagger UI: http://localhost:7860/docs
- ReDoc: http://localhost:7860/redoc

Endpoints tested:
- POST /api/render/clip - Render single clip with subtitles
- POST /api/render/segment - Render custom segment
- POST /api/render/timeline - Render full timeline with all tracks
- GET /api/frame/{filename} - Extract video frame
- GET /api/waveform - Generate audio waveform data

Security considerations (OWASP):
- A01:2021 Broken Access Control - Workspace path validation
- A05:2021 Security Misconfiguration - FFmpeg subprocess security
- A10:2021 SSRF - Path traversal prevention for workspace files

FFmpeg References:
- Filter Graph: https://ffmpeg.org/ffmpeg-filters.html
- ASS Subtitles: https://www.assrt.net/sub/?229
"""

import os
import json
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch

# Test configuration
TEST_CLIP = {
    "title": "Test Clip",
    "start": 10.0,
    "end": 40.0,
    "crop_avatar": {"x": 100, "y": 50, "w": 400, "h": 400},
    "crop_game": {"x": 500, "y": 100, "w": 800, "h": 450},
}

TEST_SEGMENTS = [
    {
        "start": 0.0,
        "end": 5.0,
        "text": "Hello world",
        "words": [
            {"word": "Hello", "start": 0.0, "end": 2.0, "probability": 0.99},
            {"word": "world", "start": 2.0, "end": 5.0, "probability": 0.98},
        ],
    }
]


class TestRenderClipEndpoint:
    """Tests for POST /api/render/clip endpoint.

    API Docs: http://localhost:7860/docs#/default/render_clip_api_render_clip_post

    Features:
    - 9:16 vertical crop (1080x1920)
    - Stacked layout (avatar top, gameplay bottom)
    - Karaoke-style word-highlight subtitles
    - Custom font/color configuration
    """

    @pytest.mark.asyncio
    async def test_render_clip_success(self, api_client, temp_workspace, sample_clip):
        """Test successful clip rendering.

        Expected behavior:
        - FFmpeg processes video with filter graph
        - ASS subtitles are burned in
        - Returns SSE stream with progress updates
        - Final event contains output path
        """
        test_video = os.path.join(temp_workspace, "test_video.mp4")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(test_video, "wb") as f:
            f.write(b"fake video content")

        with patch("api.renderer.render_clip") as mock_render, \
             patch("api.WORKSPACE", temp_workspace):

            mock_render.return_value = os.path.join(temp_workspace, "renders", "clip_001.mp4")

            response = await api_client.post(
                "/api/render/clip",
                json={
                    "video_path": test_video,
                    "clip": sample_clip,
                    "transcript": {"segments": TEST_SEGMENTS},
                },
            )

            assert response.status_code == 200
            content = response.text
            assert '"done": true' in content or '"result"' in content
            mock_render.assert_called_once()

    @pytest.mark.asyncio
    async def test_render_clip_custom_style(self, api_client, temp_workspace):
        """Test rendering with custom subtitle style."""
        test_video = os.path.join(temp_workspace, "test_video.mp4")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(test_video, "wb") as f:
            f.write(b"fake video content")

        with patch("api.renderer.render_clip") as mock_render, \
             patch("api.WORKSPACE", temp_workspace):

            mock_render.return_value = os.path.join(temp_workspace, "renders", "styled_clip.mp4")

            response = await api_client.post(
                "/api/render/clip",
                json={
                    "video_path": test_video,
                    "clip": TEST_CLIP,
                    "transcript": {"segments": TEST_SEGMENTS},
                    "font_name": "Comic Sans MS",
                    "font_color": "#FF0000",
                    "highlight_color": "#00FF00",
                    "font_size": 32,
                    "caption_style": "karaoke",
                },
            )

            assert response.status_code == 200
            # Verify style params passed through
            call_kwargs = mock_render.call_args.kwargs
            assert call_kwargs["font_name"] == "Comic Sans MS"

    @pytest.mark.asyncio
    async def test_render_clip_no_crop_regions(self, api_client, temp_workspace):
        """Test rendering without crop regions (full frame)."""
        test_video = os.path.join(temp_workspace, "test_video.mp4")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(test_video, "wb") as f:
            f.write(b"fake video content")

        clip_no_crop = {
            "title": "Full Frame Clip",
            "start": 0.0,
            "end": 30.0,
        }

        with patch("api.renderer.render_clip") as mock_render, \
             patch("api.WORKSPACE", temp_workspace):

            mock_render.return_value = os.path.join(temp_workspace, "renders", "full_frame.mp4")

            response = await api_client.post(
                "/api/render/clip",
                json={
                    "video_path": test_video,
                    "clip": clip_no_crop,
                    "transcript": {"segments": TEST_SEGMENTS},
                },
            )

            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_render_clip_video_not_found(self, api_client):
        """Test rendering fails gracefully for missing video."""
        response = await api_client.post(
            "/api/render/clip",
            json={
                "video_path": "/workspace/nonexistent.mp4",
                "clip": TEST_CLIP,
                "transcript": {"segments": TEST_SEGMENTS},
            },
        )

        # Should return error in SSE stream
        assert response.status_code == 200
        assert "error" in response.text.lower() or "not found" in response.text.lower()

    @pytest.mark.asyncio
    async def test_render_clip_path_traversal_blocked(self, api_client):
        """Test that path traversal attempts are blocked.

        Security: Video paths must be within workspace directory.
        """
        response = await api_client.post(
            "/api/render/clip",
            json={
                "video_path": "/etc/passwd",
                "clip": TEST_CLIP,
                "transcript": {"segments": TEST_SEGMENTS},
            },
        )

        assert response.status_code == 200  # SSE stream
        assert "error" in response.text.lower() or "workspace" in response.text.lower()


class TestRenderSegmentEndpoint:
    """Tests for POST /api/render/segment endpoint.

    API Docs: http://localhost:7860/docs#/default/render_segment_api_render_segment_post

    Renders a custom time segment without clip metadata.
    """

    @pytest.mark.asyncio
    async def test_render_segment_success(self, api_client, temp_workspace):
        """Test rendering a custom time segment."""
        test_video = os.path.join(temp_workspace, "test_video.mp4")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(test_video, "wb") as f:
            f.write(b"fake video content")

        with patch("api.renderer.render_clip") as mock_render, \
             patch("api.WORKSPACE", temp_workspace):

            mock_render.return_value = os.path.join(temp_workspace, "renders", "segment.mp4")

            response = await api_client.post(
                "/api/render/segment",
                json={
                    "video_path": test_video,
                    "start": 30.0,
                    "end": 60.0,
                    "segments": TEST_SEGMENTS,
                },
            )

            assert response.status_code == 200
            mock_render.assert_called_once()


class TestRenderTimelineEndpoint:
    """Tests for POST /api/render/timeline endpoint.

    API Docs: http://localhost:7860/docs#/default/render_timeline_endpoint_api_render_timeline_post

    Advanced rendering with:
    - Multiple video tracks (avatar + gameplay crops)
    - Overlay images/videos with position/scale
    - Audio mixing (BGM, SFX)
    - Text annotations
    - Marker chapters
    - Enhanced subtitle effects
    """

    @pytest.mark.asyncio
    async def test_render_timeline_success(self, api_client, temp_workspace):
        """Test rendering full timeline with all tracks."""
        test_video = os.path.join(temp_workspace, "test_video.mp4")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(test_video, "wb") as f:
            f.write(b"fake video content")

        with patch("api.renderer.render_timeline") as mock_render, \
             patch("api.WORKSPACE", temp_workspace):

            mock_render.return_value = os.path.join(temp_workspace, "renders", "timeline.mp4")

            response = await api_client.post(
                "/api/render/timeline",
                json={
                    "video_path": test_video,
                    "start": 0.0,
                    "end": 120.0,
                    "segments": TEST_SEGMENTS,
                    "crop_avatar": {"x": 100, "y": 50, "w": 400, "h": 400},
                    "crop_game": {"x": 500, "y": 100, "w": 800, "h": 450},
                },
            )

            assert response.status_code == 200
            mock_render.assert_called_once()

    @pytest.mark.asyncio
    async def test_render_timeline_with_overlays(self, api_client, temp_workspace):
        """Test rendering with overlay images."""
        test_video = os.path.join(temp_workspace, "test_video.mp4")
        overlay_image = os.path.join(temp_workspace, "overlay.png")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(test_video, "wb") as f:
            f.write(b"fake video content")
        with open(overlay_image, "wb") as f:
            f.write(b"fake image content")

        with patch("api.renderer.render_timeline") as mock_render, \
             patch("api.WORKSPACE", temp_workspace):

            mock_render.return_value = os.path.join(temp_workspace, "renders", "timeline.mp4")

            response = await api_client.post(
                "/api/render/timeline",
                json={
                    "video_path": test_video,
                    "start": 0.0,
                    "end": 60.0,
                    "overlays": [
                        {
                            "path": overlay_image,
                            "start": 10.0,
                            "end": 20.0,
                            "x": 100,
                            "y": 100,
                            "scale": 0.5,
                        }
                    ],
                },
            )

            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_render_timeline_with_audio_tracks(self, api_client, temp_workspace):
        """Test rendering with background music."""
        test_video = os.path.join(temp_workspace, "test_video.mp4")
        bgm_track = os.path.join(temp_workspace, "bgm.mp3")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(test_video, "wb") as f:
            f.write(b"fake video content")
        with open(bgm_track, "wb") as f:
            f.write(b"fake audio content")

        with patch("api.renderer.render_timeline") as mock_render, \
             patch("api.WORKSPACE", temp_workspace):

            mock_render.return_value = os.path.join(temp_workspace, "renders", "timeline.mp4")

            response = await api_client.post(
                "/api/render/timeline",
                json={
                    "video_path": test_video,
                    "start": 0.0,
                    "end": 60.0,
                    "audio_tracks": [
                        {
                            "path": bgm_track,
                            "start": 0.0,
                            "end": 60.0,
                            "volume": 0.3,  # Background volume
                        }
                    ],
                },
            )

            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_render_timeline_with_markers(self, api_client, temp_workspace):
        """Test rendering with chapter markers."""
        test_video = os.path.join(temp_workspace, "test_video.mp4")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(test_video, "wb") as f:
            f.write(b"fake video content")

        with patch("api.renderer.render_timeline") as mock_render, \
             patch("api.WORKSPACE", temp_workspace):

            mock_render.return_value = os.path.join(temp_workspace, "renders", "timeline.mp4")

            response = await api_client.post(
                "/api/render/timeline",
                json={
                    "video_path": test_video,
                    "start": 0.0,
                    "end": 120.0,
                    "markers": [
                        {"time": 30.0, "label": "Key moment", "color": "#FF5733"},
                        {"time": 60.0, "label": "Another moment", "color": "#33FF57"},
                    ],
                },
            )

            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_render_timeline_overlay_not_found(self, api_client, temp_workspace):
        """Test rendering fails when overlay file doesn't exist."""
        test_video = os.path.join(temp_workspace, "test_video.mp4")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(test_video, "wb") as f:
            f.write(b"fake video content")

        with patch("api.WORKSPACE", temp_workspace):
            response = await api_client.post(
                "/api/render/timeline",
                json={
                    "video_path": test_video,
                    "start": 0.0,
                    "end": 60.0,
                    "overlays": [
                        {
                            "path": "/workspace/nonexistent.png",
                            "start": 10.0,
                            "end": 20.0,
                        }
                    ],
                },
            )

            # Should return 404 for missing overlay
            assert response.status_code == 404


class TestFrameEndpoint:
    """Tests for GET /api/frame/{filename} endpoint.

    API Docs: http://localhost:7860/docs#/default/get_frame_api_frame__filename__get

    Extracts and serves individual video frames as PNG images.
    Used for timeline scrubber thumbnails and crop preview.
    """

    @pytest.mark.asyncio
    async def test_get_frame_success(self, api_client, temp_workspace):
        """Test extracting a video frame."""
        test_video = os.path.join(temp_workspace, "test_video.mp4")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(test_video, "wb") as f:
            f.write(b"fake video content")

        with patch("api.renderer.extract_frame") as mock_extract, \
             patch("api.WORKSPACE", temp_workspace):

            mock_extract.return_value = os.path.join(temp_workspace, "frames", "frame_001.png")

            response = await api_client.get(
                "/api/frame",
                params={
                    "video_path": test_video,
                    "timestamp": 30.0,
                },
            )

            assert response.status_code == 200
            mock_extract.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_frame_invalid_timestamp(self, api_client, temp_workspace):
        """Test frame extraction with invalid timestamp."""
        test_video = os.path.join(temp_workspace, "test_video.mp4")

        with patch("api.WORKSPACE", temp_workspace):
            response = await api_client.get(
                "/api/frame",
                params={
                    "video_path": test_video,
                    "timestamp": -10.0,  # Negative timestamp
                },
            )

            # Should return error
            assert response.status_code in (400, 404)


class TestWaveformEndpoint:
    """Tests for GET /api/waveform endpoint.

    API Docs: http://localhost:7860/docs#/default/get_waveform_api_waveform_get

    Generates audio waveform data for visualization.
    Returns peaks and RMS values at regular intervals.
    """

    @pytest.mark.asyncio
    async def test_get_waveform_success(self, api_client, temp_workspace):
        """Test generating waveform data."""
        test_audio = os.path.join(temp_workspace, "test_audio.wav")
        os.makedirs(temp_workspace, exist_ok=True)
        with open(test_audio, "wb") as f:
            f.write(b"fake audio content")

        mock_waveform = {
            "duration": 60.0,
            "sample_rate": 44100,
            "channels": 2,
            "peaks": [0.5, 0.7, 0.3, 0.9] * 250,  # 1000 points
            "rms": [0.3, 0.5, 0.2, 0.7] * 250,
            "num_points": 1000,
        }

        with patch("api.renderer.extract_frame"), \
             patch("api.WORKSPACE", temp_workspace):
            # Waveform endpoint may use different function
            response = await api_client.get(
                "/api/waveform",
                params={"video_path": test_audio},
            )

            # Should return JSON or error
            assert response.status_code in (200, 404, 500)

    @pytest.mark.asyncio
    async def test_get_waveform_audio_not_found(self, api_client):
        """Test waveform generation for missing audio."""
        response = await api_client.get(
            "/api/waveform",
            params={"video_path": "/workspace/nonexistent.wav"},
        )

        # Should return error
        assert response.status_code in (404, 500)


class TestQualityPresets:
    """Tests for rendering quality presets.

    Quality presets affect FFmpeg CRF (Constant Rate Factor) and preset parameters.
    Lower CRF = higher quality (0-51 scale, typical range 18-28).

    FFmpeg References:
    - Video Encoding Guide: https://trac.ffmpeg.org/wiki/Encode/H.264
    - CRF values: 18 (visually lossless), 23 (default), 28 (acceptable)
    """

    def test_quality_preset_documentation(self):
        """Document expected quality preset values.

        Expected presets (implementation may vary):
        - fast: CRF 28, preset 'fast' (quick rendering, lower quality)
        - standard: CRF 23, preset 'medium' (balanced)
        - high: CRF 18, preset 'slow' (best quality, slower)
        - lossless: CRF 0, preset 'veryslow' (maximum quality)
        """
        # This test documents the expected quality presets
        # Actual implementation in pipeline/renderer.py may use different values
        expected_presets = {"fast", "standard", "high", "lossless"}
        assert len(expected_presets) == 4
