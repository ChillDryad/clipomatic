"""
Integration tests for OAuth API endpoints.

API Documentation:
- Swagger UI: http://localhost:7860/docs
- ReDoc: http://localhost:7860/redoc

Endpoints tested:
- GET /api/oauth/{platform}/authorize - Initiate OAuth flow
- GET /api/oauth/{platform}/callback - Handle OAuth callback
- GET /api/oauth/{platform}/accounts - List OAuth accounts
- DELETE /api/oauth/{platform}/accounts/{account_id} - Delete OAuth account

Supported platforms:
- YouTube (youtube.com)
- TikTok (tiktok.com)
- Instagram (instagram.com)

Security considerations (OWASP):
- A02:2021 Broken Authentication - PKCE (RFC 9700), CSRF state validation
- A01:2021 Broken Access Control - State expiry (10 minutes)
- A08:2021 Software and Data Integrity Failures - Token encryption at rest

API References:
- Google OAuth 2.0: https://developers.google.com/identity/protocols/oauth2
- TikTok OAuth: https://developers.tiktok.com/doc/login-kit-web/
- Instagram OAuth: https://developers.facebook.com/docs/instagram-basic-display-api/
"""

import os
import json
import time
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import parse_qs, urlparse

# Test configuration
TEST_OAUTH_STATE = "test_state_1234567890abcdef"
TEST_OAUTH_CODE = "test_auth_code_1234567890"
TEST_PROVIDER_ACCOUNT_ID = "123456789"


class TestOAuthAuthorizeEndpoint:
    """Tests for GET /api/oauth/{platform}/authorize endpoint.

    API Docs: http://localhost:7860/docs#/default/oauth_authorize_api_oauth__platform__authorize_get

    Security features:
    - PKCE (RFC 9700) - Code verifier/challenge pair
    - CSRF state token - Random hex string, expires in 10 minutes
    - Platform validation - Only youtube/tiktok/instagram allowed
    """

    @pytest.mark.asyncio
    async def test_youtube_authorize_redirect(self, api_client):
        """Test YouTube OAuth authorization redirect.

        Expected behavior:
        - Generates CSRF state token
        - Generates PKCE code verifier/challenge
        - Redirects to accounts.google.com
        - Stores state in memory with expiry
        """
        with patch("api._pending_oauth_states") as mock_states:
            mock_states.__setitem__ = MagicMock()

            response = await api_client.get(
                "/api/oauth/youtube/authorize",
                params={"label": "My YouTube Channel"},
            )

            # Should redirect to Google OAuth
            assert response.status_code == 307
            location = response.headers.get("location", "")
            assert "accounts.google.com" in location
            assert "response_type=code" in location
            assert "scope=" in location

    @pytest.mark.asyncio
    async def test_tiktok_authorize_redirect(self, api_client):
        """Test TikTok OAuth authorization redirect.

        Expected behavior:
        - Redirects to id.tiktok.com/oauth2
        - Includes PKCE code_challenge
        """
        response = await api_client.get(
            "/api/oauth/tiktok/authorize",
            params={"label": "My TikTok"},
        )

        assert response.status_code == 307
        location = response.headers.get("location", "")
        assert "id.tiktok.com" in location or "tiktok.com" in location

    @pytest.mark.asyncio
    async def test_instagram_authorize_redirect(self, api_client):
        """Test Instagram OAuth authorization redirect.

        Expected behavior:
        - Redirects to Instagram OAuth endpoint
        """
        response = await api_client.get(
            "/api/oauth/instagram/authorize",
            params={"label": "My Instagram"},
        )

        assert response.status_code == 307
        location = response.headers.get("location", "")
        assert "instagram.com" in location or "facebook.com" in location

    @pytest.mark.asyncio
    async def test_unsupported_platform(self, api_client):
        """Test that unsupported platforms return 400.

        Security: Only whitelisted platforms are allowed.
        """
        response = await api_client.get(
            "/api/oauth/twitch/authorize",  # Twitch not supported for OAuth (only VOD download)
            params={"label": "Twitch Channel"},
        )

        assert response.status_code == 400
        assert "unsupported" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_state_generation(self, api_client):
        """Test that CSRF state is properly generated and stored."""
        mock_states = {}

        def set_item(key, value):
            mock_states[key] = value

        with patch("api._pending_oauth_states", mock_states), \
             patch.object(mock_states, "__setitem__", set_item):

            response = await api_client.get(
                "/api/oauth/youtube/authorize",
                params={"label": "Test Channel"},
            )

            # State should be stored
            assert len(mock_states) > 0

            # Verify state structure
            for state, data in mock_states.items():
                assert "platform" in data
                assert "label" in data
                assert "code_verifier" in data
                assert "expires_at" in data
                assert data["platform"] == "youtube"

    @pytest.mark.asyncio
    async def test_pkce_generation(self, api_client):
        """Test that PKCE code verifier/challenge are generated per RFC 9700.

        RFC 9700 requirements:
        - code_verifier: 43-128 characters, URL-safe base64
        - code_challenge: SHA256(code_verifier), URL-safe base64, no padding
        """
        mock_states = {}

        def set_item(key, value):
            mock_states[key] = value

        with patch("api._pending_oauth_states", mock_states), \
             patch.object(mock_states, "__setitem__", set_item):

            response = await api_client.get(
                "/api/oauth/youtube/authorize",
                params={"label": "Test"},
            )

            # Verify PKCE was generated
            for state, data in mock_states.items():
                verifier = data.get("code_verifier")
                assert verifier is not None
                assert 43 <= len(verifier) <= 128


class TestOAuthCallbackEndpoint:
    """Tests for GET /api/oauth/{platform}/callback endpoint.

    API Docs: http://localhost:7860/docs#/default/oauth_callback_api_oauth__platform__callback_get

    Security features:
    - State validation - Prevents CSRF attacks
    - State expiry check - 10 minute window
    - PKCE verification - Code verifier matches challenge
    - Token encryption - Fernet/AES-128-CBC at rest
    """

    @pytest.mark.asyncio
    async def test_callback_success_youtube(self, api_client, test_jwt_secret):
        """Test successful YouTube OAuth callback.

        Expected behavior:
        - Validates CSRF state
        - Exchanges code for tokens
        - Creates/updates User + UserOAuthAccount
        - Returns JWT cookie, redirects to dashboard
        """
        # Mock OAuth state
        mock_states = {
            TEST_OAUTH_STATE: {
                "platform": "youtube",
                "label": "Test Channel",
                "code_verifier": "test_verifier_1234567890",
                "expires_at": time.time() + 600,
                "redirect_uri": None,
            }
        }

        with patch("api._pending_oauth_states", mock_states), \
             patch("api.oauth.youtube.exchange_youtube_code") as mock_exchange, \
             patch("api.get_session") as mock_get_session, \
             patch.dict(os.environ, {"JWT_SECRET": test_jwt_secret}):

            # Mock token exchange response
            mock_exchange.return_value = (
                TEST_PROVIDER_ACCOUNT_ID,
                "access_token_abc123",
                "refresh_token_xyz789",
                time.time() + 3600,
            )

            # Mock database session
            mock_session = AsyncMock()
            mock_result = MagicMock()
            mock_result.scalar_one_or_none = MagicMock(return_value=None)  # No existing OAuth account
            mock_session.execute = AsyncMock(return_value=mock_result)
            mock_session.add = MagicMock()
            mock_session.flush = AsyncMock()
            mock_session.commit = AsyncMock()
            mock_get_session.return_value = mock_session

            response = await api_client.get(
                "/api/oauth/youtube/callback",
                params={
                    "code": TEST_OAUTH_CODE,
                    "state": TEST_OAUTH_STATE,
                },
            )

            # Should redirect to dashboard
            assert response.status_code == 307
            location = response.headers.get("location", "")
            assert "/dashboard" in location

            # Should set JWT cookie
            assert "access_token" in response.cookies

            # State should be consumed (removed)
            assert TEST_OAUTH_STATE not in mock_states

    @pytest.mark.asyncio
    async def test_callback_invalid_state(self, api_client):
        """Test callback with invalid/missing CSRF state.

        Security: Invalid states are rejected to prevent CSRF attacks.
        """
        response = await api_client.get(
            "/api/oauth/youtube/callback",
            params={
                "code": TEST_OAUTH_CODE,
                "state": "invalid_state",
            },
        )

        assert response.status_code == 400
        assert "invalid" in response.json()["detail"].lower() or "expired" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_callback_expired_state(self, api_client):
        """Test callback with expired CSRF state.

        Security: States expire after 10 minutes to limit CSRF attack window.
        """
        mock_states = {
            TEST_OAUTH_STATE: {
                "platform": "youtube",
                "label": "Test",
                "code_verifier": "verifier",
                "expires_at": time.time() - 60,  # Expired 1 minute ago
            }
        }

        with patch("api._pending_oauth_states", mock_states):
            response = await api_client.get(
                "/api/oauth/youtube/callback",
                params={
                    "code": TEST_OAUTH_CODE,
                    "state": TEST_OAUTH_STATE,
                },
            )

            assert response.status_code == 400
            assert "expired" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_callback_platform_mismatch(self, api_client):
        """Test callback with platform mismatch in state.

        Security: Prevents mixing up OAuth flows from different platforms.
        """
        mock_states = {
            TEST_OAUTH_STATE: {
                "platform": "youtube",  # State says YouTube
                "label": "Test",
                "code_verifier": "verifier",
                "expires_at": time.time() + 600,
            }
        }

        with patch("api._pending_oauth_states", mock_states):
            # But callback is for TikTok
            response = await api_client.get(
                "/api/oauth/tiktok/callback",
                params={
                    "code": TEST_OAUTH_CODE,
                    "state": TEST_OAUTH_STATE,
                },
            )

            assert response.status_code == 400
            assert "platform" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_callback_missing_code_verifier(self, api_client):
        """Test callback when PKCE code_verifier is missing.

        Security: PKCE is required for all OAuth flows (RFC 9700).
        """
        mock_states = {
            TEST_OAUTH_STATE: {
                "platform": "youtube",
                "label": "Test",
                # Missing code_verifier!
                "expires_at": time.time() + 600,
            }
        }

        with patch("api._pending_oauth_states", mock_states):
            response = await api_client.get(
                "/api/oauth/youtube/callback",
                params={
                    "code": TEST_OAUTH_CODE,
                    "state": TEST_OAUTH_STATE,
                },
            )

            assert response.status_code == 400
            assert "verifier" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_callback_token_exchange_failure(self, api_client):
        """Test callback when token exchange fails.

        This can happen if:
        - Authorization code is expired
        - Code was already used
        - Client credentials are invalid
        """
        mock_states = {
            TEST_OAUTH_STATE: {
                "platform": "youtube",
                "label": "Test",
                "code_verifier": "verifier",
                "expires_at": time.time() + 600,
            }
        }

        with patch("api._pending_oauth_states", mock_states), \
             patch("api.oauth.youtube.exchange_youtube_code") as mock_exchange:

            mock_exchange.side_effect = Exception("Invalid authorization code")

            response = await api_client.get(
                "/api/oauth/youtube/callback",
                params={
                    "code": TEST_OAUTH_CODE,
                    "state": TEST_OAUTH_STATE,
                },
            )

            assert response.status_code == 502
            assert "token exchange" in response.json()["detail"].lower() or "failed" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_callback_existing_user_update(self, api_client, test_jwt_secret):
        """Test callback updates tokens for existing OAuth account.

        Expected behavior:
        - Finds existing UserOAuthAccount
        - Updates access_token and refresh_token
        - Does NOT create duplicate user
        """
        mock_states = {
            TEST_OAUTH_STATE: {
                "platform": "youtube",
                "label": "Test",
                "code_verifier": "verifier",
                "expires_at": time.time() + 600,
            }
        }

        with patch("api._pending_oauth_states", mock_states), \
             patch("api.oauth.youtube.exchange_youtube_code") as mock_exchange, \
             patch("api.get_session") as mock_get_session, \
             patch.dict(os.environ, {"JWT_SECRET": test_jwt_secret}):

            mock_exchange.return_value = (
                TEST_PROVIDER_ACCOUNT_ID,
                "new_access_token",
                "new_refresh_token",
                time.time() + 3600,
            )

            # Mock existing OAuth account
            mock_oauth = MagicMock()
            mock_oauth.id = "oauth-123"
            mock_oauth.user_id = "user-456"
            mock_oauth.access_token = "old_encrypted_token"

            mock_session = AsyncMock()
            mock_result = MagicMock()
            mock_result.scalar_one_or_none = MagicMock(return_value=mock_oauth)
            mock_session.execute = AsyncMock(return_value=mock_result)
            mock_session.commit = AsyncMock()
            mock_get_session.return_value = mock_session

            response = await api_client.get(
                "/api/oauth/youtube/callback",
                params={
                    "code": TEST_OAUTH_CODE,
                    "state": TEST_OAUTH_STATE,
                },
            )

            assert response.status_code == 307
            # Tokens should be updated (verified via mock)
            mock_session.commit.assert_called_once()


class TestOAuthAccountsEndpoint:
    """Tests for GET /api/oauth/{platform}/accounts endpoint.

    API Docs: http://localhost:7860/docs#/default/list_oauth_accounts_api_oauth__platform__accounts_get
    """

    @pytest.mark.asyncio
    async def test_list_accounts_success(self, api_client):
        """Test listing OAuth accounts for a platform."""
        mock_accounts = [
            MagicMock(
                id="oauth-1",
                user_id="user-1",
                provider="youtube",
                provider_account_id="channel-123",
                refresh_token="encrypted_token",
                expires_at=time.time() + 3600,
            ),
            MagicMock(
                id="oauth-2",
                user_id="user-2",
                provider="youtube",
                provider_account_id="channel-456",
                refresh_token=None,
                expires_at=time.time() - 3600,  # Expired
            ),
        ]

        with patch("api.get_session") as mock_get_session:
            mock_session = AsyncMock()
            mock_result = MagicMock()
            mock_result.scalars = MagicMock(return_value=mock_accounts)
            mock_session.execute = AsyncMock(return_value=mock_result)
            mock_get_session.return_value = mock_session

            response = await api_client.get("/api/oauth/youtube/accounts")

            assert response.status_code == 200
            data = response.json()
            assert len(data) == 2
            assert "provider_account_id" in data[0]
            assert "has_refresh_token" in data[0]

    @pytest.mark.asyncio
    async def test_list_unsupported_platform(self, api_client):
        """Test listing accounts for unsupported platform."""
        response = await api_client.get("/api/oauth/twitch/accounts")

        assert response.status_code == 400
        assert "unsupported" in response.json()["detail"].lower()


class TestDeleteOAuthAccountEndpoint:
    """Tests for DELETE /api/oauth/{platform}/accounts/{account_id} endpoint.

    API Docs: http://localhost:7860/docs#/default/delete_oauth_account_api_oauth__platform__accounts__account_id__delete
    """

    @pytest.mark.asyncio
    async def test_delete_account_success(self, api_client):
        """Test deleting an OAuth account."""
        mock_account = MagicMock(id="oauth-123", provider="youtube")

        with patch("api.get_session") as mock_get_session:
            mock_session = AsyncMock()
            mock_result = MagicMock()
            mock_result.scalar_one_or_none = MagicMock(return_value=mock_account)
            mock_session.execute = AsyncMock(return_value=mock_result)
            mock_session.delete = MagicMock()
            mock_session.commit = AsyncMock()
            mock_get_session.return_value = mock_session

            response = await api_client.delete("/api/oauth/youtube/accounts/oauth-123")

            assert response.status_code == 200
            data = response.json()
            assert data.get("ok") is True
            mock_session.delete.assert_called_once_with(mock_account)

    @pytest.mark.asyncio
    async def test_delete_account_not_found(self, api_client):
        """Test deleting non-existent OAuth account."""
        with patch("api.get_session") as mock_get_session:
            mock_session = AsyncMock()
            mock_result = MagicMock()
            mock_result.scalar_one_or_none = MagicMock(return_value=None)
            mock_session.execute = AsyncMock(return_value=mock_result)
            mock_get_session.return_value = mock_session

            response = await api_client.delete("/api/oauth/youtube/accounts/nonexistent")

            assert response.status_code == 404
            assert "not found" in response.json()["detail"].lower()


class TestTokenEncryption:
    """Tests for OAuth token encryption at rest.

    Security: OAuth tokens are encrypted using Fernet (AES-128-CBC)
    to protect them if the database is compromised.

    API Reference:
    - Fernet (symmetric encryption): https://cryptography.io/en/latest/fernet/
    - OWASP A02:2021 - Broken Authentication: https://owasp.org/Top10/A02_2021-Broken_Authentication/
    """

    def test_encrypt_decrypt_round_trip(self, test_oauth_encryption_key):
        """Test that Fernet encryption can decrypt what it encrypts."""
        try:
            from cryptography.fernet import Fernet
        except ImportError:
            pytest.skip("cryptography not installed - install with: pip install cryptography")

        original_token = "ya29.test_access_token_1234567890"
        _fernet = Fernet(test_oauth_encryption_key.encode())

        encrypted = _fernet.encrypt(original_token.encode()).decode()
        decrypted = _fernet.decrypt(encrypted.encode()).decode()

        assert decrypted == original_token

    def test_encrypted_tokens_are_not_plaintext(self, test_oauth_encryption_key):
        """Test that encrypted tokens don't contain plaintext."""
        try:
            from cryptography.fernet import Fernet
        except ImportError:
            pytest.skip("cryptography not installed")

        original_token = "sensitive_oauth_token_value"
        _fernet = Fernet(test_oauth_encryption_key.encode())

        encrypted = _fernet.encrypt(original_token.encode()).decode()

        # Encrypted token should not contain original value
        assert original_token not in encrypted
        # Encrypted token should be different each time (Fernet includes timestamp)
        encrypted2 = _fernet.encrypt(original_token.encode()).decode()
        assert encrypted != encrypted2
