"""
Unit tests for OAuth helpers in oauth/*.py files.

Tests cover:
- PKCE code verifier/challenge generation
- Auth URL building
"""

import base64
import hashlib
from urllib.parse import parse_qs, urlparse

import pytest

from oauth import google as google_oauth
from oauth import youtube as youtube_oauth
from oauth import twitch as twitch_oauth
from oauth import tiktok as tiktok_oauth
from oauth import instagram as instagram_oauth


# ---------------------------------------------------------------------------
# PKCE Generation Tests (All Providers)
# ---------------------------------------------------------------------------


class TestGooglePKCE:
    """Tests for Google PKCE generation."""

    def test_generate_pkce_pair_returns_tuple(self):
        """Test that generate_pkce_pair returns a tuple."""
        verifier, challenge = google_oauth.generate_pkce_pair()
        assert isinstance(verifier, str)
        assert isinstance(challenge, str)

    def test_generate_pkce_verifier_length(self):
        """Test that code verifier has correct length."""
        verifier, _ = google_oauth.generate_pkce_pair()
        # token_urlsafe(32) produces ~43 characters
        assert 40 <= len(verifier) <= 50

    def test_generate_pkce_challenge_is_base64url(self):
        """Test that code challenge is valid base64url."""
        _, challenge = google_oauth.generate_pkce_pair()
        # Should be decodable
        decoded = base64.urlsafe_b64decode(challenge + "==")
        assert len(decoded) == 32  # SHA256 produces 32 bytes

    def test_generate_pkce_different_each_time(self):
        """Test that each call produces different values."""
        v1, c1 = google_oauth.generate_pkce_pair()
        v2, c2 = google_oauth.generate_pkce_pair()
        assert v1 != v2
        assert c1 != c2

    def test_generate_pkce_challenge_matches_verifier(self):
        """Test that challenge is SHA256 of verifier."""
        verifier, challenge = google_oauth.generate_pkce_pair()
        expected = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode()).digest()
        ).rstrip(b'=').decode()
        assert challenge == expected


class TestYouTubePKCE:
    """Tests for YouTube PKCE generation."""

    def test_generate_pkce_pair_returns_tuple(self):
        """Test that generate_pkce_pair returns a tuple."""
        verifier, challenge = youtube_oauth.generate_pkce_pair()
        assert isinstance(verifier, str)
        assert isinstance(challenge, str)

    def test_generate_pkce_verifier_length(self):
        """Test that code verifier has correct length."""
        verifier, _ = youtube_oauth.generate_pkce_pair()
        assert 40 <= len(verifier) <= 50

    def test_generate_pkce_challenge_matches_verifier(self):
        """Test that challenge is SHA256 of verifier."""
        verifier, challenge = youtube_oauth.generate_pkce_pair()
        expected = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode()).digest()
        ).rstrip(b'=').decode()
        assert challenge == expected


class TestTwitchPKCE:
    """Tests for Twitch PKCE generation."""

    def test_generate_pkce_pair_returns_tuple(self):
        """Test that generate_pkce_pair returns a tuple."""
        verifier, challenge = twitch_oauth.generate_pkce_pair()
        assert isinstance(verifier, str)
        assert isinstance(challenge, str)

    def test_generate_pkce_challenge_matches_verifier(self):
        """Test that challenge is SHA256 of verifier."""
        verifier, challenge = twitch_oauth.generate_pkce_pair()
        expected = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode()).digest()
        ).rstrip(b'=').decode()
        assert challenge == expected


class TestTikTokPKCE:
    """Tests for TikTok PKCE generation."""

    def test_generate_pkce_pair_returns_tuple(self):
        """Test that generate_pkce_pair returns a tuple."""
        verifier, challenge = tiktok_oauth.generate_pkce_pair()
        assert isinstance(verifier, str)
        assert isinstance(challenge, str)

    def test_generate_pkce_challenge_matches_verifier(self):
        """Test that challenge is SHA256 of verifier."""
        verifier, challenge = tiktok_oauth.generate_pkce_pair()
        expected = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode()).digest()
        ).rstrip(b'=').decode()
        assert challenge == expected


class TestInstagramPKCE:
    """Tests for Instagram PKCE generation."""

    def test_generate_pkce_pair_returns_tuple(self):
        """Test that generate_pkce_pair returns a tuple."""
        verifier, challenge = instagram_oauth.generate_pkce_pair()
        assert isinstance(verifier, str)
        assert isinstance(challenge, str)

    def test_generate_pkce_challenge_matches_verifier(self):
        """Test that challenge is SHA256 of verifier."""
        verifier, challenge = instagram_oauth.generate_pkce_pair()
        expected = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode()).digest()
        ).rstrip(b'=').decode()
        assert challenge == expected


# ---------------------------------------------------------------------------
# Auth URL Building Tests
# ---------------------------------------------------------------------------


class TestGoogleAuthUrl:
    """Tests for Google auth URL building."""

    def test_build_auth_url_contains_base(self):
        """Test that auth URL contains base Google URL."""
        url = google_oauth.build_google_auth_url("state123", "challenge456")
        assert "https://accounts.google.com" in url
        assert "/o/oauth2/v2/auth" in url

    def test_build_auth_url_contains_state(self):
        """Test that auth URL contains state parameter."""
        url = google_oauth.build_google_auth_url("my_state", "challenge")
        parsed = parse_qs(urlparse(url).query)
        assert parsed.get("state") == ["my_state"]

    def test_build_auth_url_contains_code_challenge(self):
        """Test that auth URL contains code_challenge parameter."""
        url = google_oauth.build_google_auth_url("state", "my_challenge")
        parsed = parse_qs(urlparse(url).query)
        assert parsed.get("code_challenge") == ["my_challenge"]

    def test_build_auth_url_contains_code_challenge_method(self):
        """Test that auth URL contains S256 method."""
        url = google_oauth.build_google_auth_url("state", "challenge")
        parsed = parse_qs(urlparse(url).query)
        assert parsed.get("code_challenge_method") == ["S256"]

    def test_build_auth_url_contains_client_id(self):
        """Test that auth URL contains client_id.

        Note: This test fails if GOOGLE_CLIENT_ID is not set.
        This is expected - in production, the env var would be configured.
        """
        import os
        if not os.environ.get("GOOGLE_CLIENT_ID"):
            pytest.skip("GOOGLE_CLIENT_ID not set - expected in production only")
        url = google_oauth.build_google_auth_url("state", "challenge")
        parsed = parse_qs(urlparse(url).query)
        assert parsed.get("client_id")

    def test_build_auth_url_contains_redirect_uri(self):
        """Test that auth URL contains redirect_uri."""
        url = google_oauth.build_google_auth_url("state", "challenge")
        parsed = parse_qs(urlparse(url).query)
        assert "redirect_uri" in parsed

    def test_build_auth_url_contains_response_type(self):
        """Test that auth URL contains response_type=code."""
        url = google_oauth.build_google_auth_url("state", "challenge")
        parsed = parse_qs(urlparse(url).query)
        assert parsed.get("response_type") == ["code"]

    def test_build_auth_url_contains_scope(self):
        """Test that auth URL contains scope."""
        url = google_oauth.build_google_auth_url("state", "challenge")
        parsed = parse_qs(urlparse(url).query)
        assert "scope" in parsed


class TestYouTubeAuthUrl:
    """Tests for YouTube auth URL building."""

    def test_build_auth_url_contains_base(self):
        """Test that auth URL contains base Google URL."""
        url = youtube_oauth.build_youtube_auth_url("state123", "challenge456")
        assert "https://accounts.google.com" in url
        assert "/o/oauth2/v2/auth" in url

    def test_build_auth_url_contains_youtube_scope(self):
        """Test that auth URL contains YouTube upload scope."""
        url = youtube_oauth.build_youtube_auth_url("state", "challenge")
        parsed = parse_qs(urlparse(url).query)
        scope = parsed.get("scope", [""])[0]
        assert "youtube.upload" in scope

    def test_build_auth_url_contains_state(self):
        """Test that auth URL contains state parameter."""
        url = youtube_oauth.build_youtube_auth_url("my_state", "challenge")
        parsed = parse_qs(urlparse(url).query)
        assert parsed.get("state") == ["my_state"]


class TestTwitchAuthUrl:
    """Tests for Twitch auth URL building."""

    def test_build_auth_url_contains_base(self):
        """Test that auth URL contains base Twitch URL."""
        url = twitch_oauth.build_twitch_auth_url("state123", "challenge456")
        assert "https://id.twitch.tv" in url
        assert "/oauth2/authorize" in url

    def test_build_auth_url_contains_state(self):
        """Test that auth URL contains state parameter."""
        url = twitch_oauth.build_twitch_auth_url("my_state", "challenge")
        parsed = parse_qs(urlparse(url).query)
        assert parsed.get("state") == ["my_state"]

    def test_build_auth_url_contains_client_id(self):
        """Test that auth URL contains client_id.

        Note: This test fails if TWITCH_CLIENT_ID is not set.
        This is expected - in production, the env var would be configured.
        """
        import os
        if not os.environ.get("TWITCH_CLIENT_ID"):
            pytest.skip("TWITCH_CLIENT_ID not set - expected in production only")
        url = twitch_oauth.build_twitch_auth_url("state", "challenge")
        parsed = parse_qs(urlparse(url).query)
        assert "client_id" in parsed

    def test_build_auth_url_contains_scope(self):
        """Test that auth URL contains scope."""
        url = twitch_oauth.build_twitch_auth_url("state", "challenge")
        parsed = parse_qs(urlparse(url).query)
        scope = parsed.get("scope", [""])[0]
        assert "user:read:email" in scope


class TestTikTokAuthUrl:
    """Tests for TikTok auth URL building."""

    def test_build_auth_url_contains_base(self):
        """Test that auth URL contains base TikTok URL."""
        url = tiktok_oauth.build_tiktok_auth_url("state123", "challenge456")
        assert "https://www.tiktok.com" in url
        assert "/v2/auth/authorize" in url

    def test_build_auth_url_contains_client_key(self):
        """Test that auth URL contains client_key.

        Note: This test fails if TIKTOK_CLIENT_KEY is not set.
        This is expected - in production, the env var would be configured.
        """
        import os
        if not os.environ.get("TIKTOK_CLIENT_KEY"):
            pytest.skip("TIKTOK_CLIENT_KEY not set - expected in production only")
        url = tiktok_oauth.build_tiktok_auth_url("state", "challenge")
        parsed = parse_qs(urlparse(url).query)
        assert parsed.get("client_key")

    def test_build_auth_url_contains_scope(self):
        """Test that auth URL contains video.upload scope."""
        url = tiktok_oauth.build_tiktok_auth_url("state", "challenge")
        parsed = parse_qs(urlparse(url).query)
        scope = parsed.get("scope", [""])[0]
        assert "video.upload" in scope


class TestInstagramAuthUrl:
    """Tests for Instagram auth URL building."""

    def test_build_auth_url_contains_base(self):
        """Test that auth URL contains base Facebook URL."""
        url = instagram_oauth.build_instagram_auth_url("state123", "challenge456")
        assert "https://www.facebook.com" in url
        assert "/v18.0/dialog/oauth" in url

    def test_build_auth_url_contains_client_id(self):
        """Test that auth URL contains client_id (app_id for Facebook).

        Note: This test fails if INSTAGRAM_CLIENT_ID is not set.
        This is expected - in production, the env var would be configured.
        """
        import os
        if not os.environ.get("INSTAGRAM_CLIENT_ID"):
            pytest.skip("INSTAGRAM_CLIENT_ID not set - expected in production only")
        url = instagram_oauth.build_instagram_auth_url("state", "challenge")
        parsed = parse_qs(urlparse(url).query)
        assert parsed.get("client_id")

    def test_build_auth_url_contains_scope(self):
        """Test that auth URL contains Instagram scopes."""
        url = instagram_oauth.build_instagram_auth_url("state", "challenge")
        parsed = parse_qs(urlparse(url).query)
        scope = parsed.get("scope", [""])[0]
        assert "instagram_business" in scope


# ---------------------------------------------------------------------------
# Environment Variable Tests
# ---------------------------------------------------------------------------


class TestEnvironmentVariables:
    """Tests for environment variable configuration."""

    def test_google_oauth_has_client_id(self):
        """Test that Google OAuth has client_id configured."""
        assert hasattr(google_oauth, "GOOGLE_OAUTH_CLIENT_ID")

    def test_google_oauth_has_client_secret(self):
        """Test that Google OAuth has client_secret configured."""
        assert hasattr(google_oauth, "GOOGLE_OAUTH_CLIENT_SECRET")

    def test_google_oauth_has_redirect_uri(self):
        """Test that Google OAuth has redirect_uri configured."""
        assert hasattr(google_oauth, "GOOGLE_REDIRECT_URI")

    def test_youtube_uses_same_credentials(self):
        """Test that YouTube uses same Google credentials."""
        assert youtube_oauth.GOOGLE_OAUTH_CLIENT_ID == google_oauth.GOOGLE_OAUTH_CLIENT_ID

    def test_twitch_has_client_id(self):
        """Test that Twitch OAuth has client_id configured."""
        assert hasattr(twitch_oauth, "TWITCH_CLIENT_ID")

    def test_tiktok_has_client_key(self):
        """Test that TikTok OAuth has client_key configured."""
        assert hasattr(tiktok_oauth, "TIKTOK_CLIENT_KEY")

    def test_instagram_has_app_id(self):
        """Test that Instagram OAuth has app_id configured."""
        assert hasattr(instagram_oauth, "FACEBOOK_APP_ID")
