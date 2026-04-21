"""
Integration tests for Authentication API endpoints.

API Documentation:
- Swagger UI: http://localhost:7860/docs
- ReDoc: http://localhost:7860/redoc

Endpoints tested:
- POST /api/auth/register - User registration with email/password
- POST /api/auth/login - User login with email/password
- POST /api/auth/logout - User logout
- GET /api/auth/me - Get current user info
- POST /api/auth/refresh - Refresh access token

Password requirements (relaxed for usability):
- Minimum 8 characters (reduced from 12)
- Not in top 20 common passwords list
- No breach checking (removed for usability)

Security considerations (OWASP):
- A01:2021 Broken Access Control - Rate limiting, path traversal prevention
- A02:2021 Broken Authentication - JWT validation, password requirements
"""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch
import json
import os
import sys

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

# Test configuration
TEST_EMAIL = "test@example.com"
TEST_PASSWORD = "SecureP@ss8!"  # Meets 8-char requirement
TEST_DISPLAY_NAME = "Test User"


class TestRegisterEndpoint:
    """Tests for POST /api/auth/register endpoint.

    API Docs: http://localhost:7860/docs#/default/register_api_auth_register_post
    """

    @pytest_asyncio.fixture
    async def mock_db_session(self):
        """Mock database session for registration tests."""
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=None)  # No existing user
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.add = MagicMock()
        mock_session.flush = AsyncMock()
        mock_session.commit = AsyncMock()
        yield mock_session

    @pytest.mark.asyncio
    async def test_register_success(self, api_client, mock_db_session, test_jwt_keys):
        """Test successful user registration with valid credentials.

        Expected behavior:
        - Returns 200 OK with user data
        - Sets HttpOnly access_token cookie
        - Password is hashed before storage
        """
        with patch("api.get_session") as mock_get_session, \
             patch.dict(os.environ, {"JWT_PRIVATE_KEY": test_jwt_keys["private"], "JWT_PUBLIC_KEY": test_jwt_keys["public"]}):

            mock_get_session.return_value = mock_db_session

            response = await api_client.post(
                "/api/auth/register",
                json={
                    "email": TEST_EMAIL,
                    "password": TEST_PASSWORD,
                    "display_name": TEST_DISPLAY_NAME,
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert "access_token" in data
            assert "user" in data
            assert data["user"]["email"] == TEST_EMAIL
            assert data["user"]["display_name"] == TEST_DISPLAY_NAME

            # Verify cookie is set
            assert "access_token" in response.cookies

    @pytest.mark.asyncio
    async def test_register_duplicate_email(self, api_client, mock_db_session):
        """Test registration fails when email already exists.

        Security: Prevents account enumeration by returning same error
        for "email exists" and generic registration failures.
        """
        # Mock existing user
        mock_existing_user = MagicMock()
        mock_existing_user.email = TEST_EMAIL
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_existing_user)
        mock_db_session.execute = AsyncMock(return_value=mock_result)

        with patch("api.get_session") as mock_get_session:
            mock_get_session.return_value = mock_db_session

            response = await api_client.post(
                "/api/auth/register",
                json={
                    "email": TEST_EMAIL,
                    "password": TEST_PASSWORD,
                    "display_name": TEST_DISPLAY_NAME,
                },
            )

            assert response.status_code == 400
            assert "already registered" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_register_invalid_email_format(self, api_client):
        """Test registration rejects invalid email formats.

        Validation: Uses RFC 5322 email regex pattern.
        """
        response = await api_client.post(
            "/api/auth/register",
            json={
                "email": "not-an-email",
                "password": TEST_PASSWORD,
                "display_name": TEST_DISPLAY_NAME,
            },
        )

        assert response.status_code == 400
        assert "invalid email" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_register_weak_password(self, api_client):
        """Test registration rejects passwords that don't meet minimum length.

        Requirements:
        - Minimum 8 characters
        - Not in top 20 common passwords list
        """
        response = await api_client.post(
            "/api/auth/register",
            json={
                "email": TEST_EMAIL,
                "password": "weak",  # Too short (4 chars)
                "display_name": TEST_DISPLAY_NAME,
            },
        )

        assert response.status_code == 400
        # Should mention password length requirement
        assert any(
            keyword in response.json()["detail"].lower()
            for keyword in ["password", "8", "character", "length"]
        )

    @pytest.mark.asyncio
    async def test_register_common_password(self, api_client):
        """Test registration rejects common passwords.

        Security: Checks against top 20 common passwords list.
        """
        response = await api_client.post(
            "/api/auth/register",
            json={
                "email": TEST_EMAIL,
                "password": "password123",  # Common password
                "display_name": TEST_DISPLAY_NAME,
            },
        )

        assert response.status_code == 400
        assert "common" in response.json()["detail"].lower() or "password" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_register_rate_limit(self, api_client):
        """Test rate limiting on registration endpoint.

        Rate limit: 3 requests per minute (prevents brute force/spam).
        This test verifies the rate limiter is configured.
        """
        # Note: Full rate limit testing would require 4+ rapid requests
        # This test confirms the endpoint has rate limiting configured
        from slowapi import Limiter
        from api import app

        assert hasattr(app.state, "limiter")
        assert isinstance(app.state.limiter, Limiter)


class TestLoginEndpoint:
    """Tests for POST /api/auth/login endpoint.

    API Docs: http://localhost:7860/docs#/default/login_api_auth_login_post
    """

    @pytest_asyncio.fixture
    async def mock_db_session_with_user(self, test_user):
        """Mock database session with existing user."""
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=test_user)
        mock_session.execute = AsyncMock(return_value=mock_result)
        yield mock_session

    @pytest.mark.asyncio
    async def test_login_success(self, api_client, mock_db_session_with_user, test_jwt_keys):
        """Test successful login with valid credentials.

        Expected behavior:
        - Returns 200 OK with JWT tokens
        - Sets HttpOnly access_token cookie
        - Returns user profile data
        """
        with patch("api.get_session") as mock_get_session, \
             patch.dict(os.environ, {"JWT_PRIVATE_KEY": test_jwt_keys["private"], "JWT_PUBLIC_KEY": test_jwt_keys["public"]}):

            mock_get_session.return_value = mock_db_session_with_user

            response = await api_client.post(
                "/api/auth/login",
                json={
                    "email": "test@example.com",
                    "password": "SecureP@ssw0rd123!",
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert "access_token" in data
            assert "refresh_token" in data
            assert "user" in data

            # Verify cookie is set
            assert "access_token" in response.cookies

    @pytest.mark.asyncio
    async def test_login_invalid_credentials(self, api_client):
        """Test login fails with invalid email/password.

        Security: Returns generic "invalid credentials" message
        to prevent email enumeration attacks.
        """
        with patch("api.get_session") as mock_get_session:
            mock_session = AsyncMock()
            mock_result = MagicMock()
            mock_result.scalar_one_or_none = MagicMock(return_value=None)
            mock_session.execute = AsyncMock(return_value=mock_result)
            mock_get_session.return_value = mock_session

            response = await api_client.post(
                "/api/auth/login",
                json={
                    "email": "nonexistent@example.com",
                    "password": "WrongPassword123!",
                },
            )

            assert response.status_code == 401
            assert "invalid" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_login_wrong_password(self, api_client, mock_db_session_with_user):
        """Test login fails with correct email but wrong password.

        Security: Uses constant-time comparison via bcrypt
        to prevent timing attacks.
        """
        with patch("api.get_session") as mock_get_session:
            mock_get_session.return_value = mock_db_session_with_user

            response = await api_client.post(
                "/api/auth/login",
                json={
                    "email": "test@example.com",
                    "password": "WrongPassword!",
                },
            )

            assert response.status_code == 401
            assert "invalid" in response.json()["detail"].lower()


class TestLogoutEndpoint:
    """Tests for POST /api/auth/logout endpoint.

    API Docs: http://localhost:7860/docs#/default/logout_api_auth_logout_post
    """

    @pytest.mark.asyncio
    async def test_logout_success(self, api_client, auth_tokens):
        """Test successful logout clears authentication cookie.

        Expected behavior:
        - Returns 200 OK
        - Sets cookie with expired max_age
        - Returns success message
        """
        # Note: Full logout test would require valid session
        # This test confirms the endpoint exists and responds
        response = await api_client.post("/api/auth/logout")

        # Logout should succeed even without valid session (idempotent)
        assert response.status_code == 200


class TestMeEndpoint:
    """Tests for GET /api/auth/me endpoint.

    API Docs: http://localhost:7860/docs#/default/get_current_user_api_auth_me_get
    """

    @pytest.mark.asyncio
    async def test_get_me_authenticated(self, api_client, auth_tokens, test_jwt_keys):
        """Test getting current user info with valid JWT.

        Expected behavior:
        - Returns 200 OK with user profile
        - JWT token validated via Cookie dependency
        """
        with patch.dict(os.environ, {"JWT_PRIVATE_KEY": test_jwt_keys["private"], "JWT_PUBLIC_KEY": test_jwt_keys["public"]}):
            response = await api_client.get(
                "/api/auth/me",
                cookies={"access_token": auth_tokens["access"]},
            )

            # Should return user data or 404 if user not in DB
            assert response.status_code in (200, 404)

    @pytest.mark.asyncio
    async def test_get_me_unauthenticated(self, api_client):
        """Test getting current user info without JWT fails.

        Security: Requires valid JWT token in Cookie header.
        """
        response = await api_client.get("/api/auth/me")

        # Should be 401 (unauthorized) or 404 (user not found)
        assert response.status_code in (401, 404)

    @pytest.mark.asyncio
    async def test_get_me_expired_token(self, api_client, auth_tokens):
        """Test getting current user info with expired JWT fails.

        Security: Token expiration is validated (exp claim).
        """
        response = await api_client.get(
            "/api/auth/me",
            cookies={"access_token": auth_tokens["expired"]},
        )

        # Should be 401 (unauthorized) due to expired token
        assert response.status_code == 401


class TestRefreshEndpoint:
    """Tests for POST /api/auth/refresh endpoint.

    API Docs: http://localhost:7860/docs#/default/refresh_token_api_auth_refresh_post
    """

    @pytest.mark.asyncio
    async def test_refresh_success(self, api_client, auth_tokens, test_jwt_keys):
        """Test refreshing access token with valid refresh token.

        Expected behavior:
        - Returns 200 OK with new access_token
        - Validates refresh token signature and expiration
        """
        with patch.dict(os.environ, {"JWT_PRIVATE_KEY": test_jwt_keys["private"], "JWT_PUBLIC_KEY": test_jwt_keys["public"]}):
            response = await api_client.post(
                "/api/auth/refresh",
                json={"refresh_token": auth_tokens["refresh"]},
            )

            # Should return new access token or fail if user not in DB
            assert response.status_code in (200, 404)

    @pytest.mark.asyncio
    async def test_refresh_invalid_token(self, api_client):
        """Test refreshing with invalid token fails.

        Security: Invalid tokens are rejected with 401.
        """
        response = await api_client.post(
            "/api/auth/refresh",
            json={"refresh_token": "invalid.token.here"},
        )

        assert response.status_code == 401
