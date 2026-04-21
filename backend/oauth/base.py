"""
OAuth2 base class with PKCE support (RFC 9700).

Provides shared functionality for all OAuth providers:
- PKCE code verifier/challenge generation
- State parameter handling
- Token exchange patterns
"""

import base64
import hashlib
import os
import secrets
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class OAuthConfig:
    """OAuth2 configuration for a provider."""
    client_id: str
    client_secret: str
    redirect_uri: str
    auth_url: str
    token_url: str
    scopes: list[str]
    extra_auth_params: dict[str, str] = field(default_factory=dict)


@dataclass
class OAuthTokenResult:
    """Result of OAuth2 token exchange."""
    provider_account_id: str
    access_token: str
    refresh_token: str | None
    expires_at: float | None
    email: str | None = None
    extra_data: dict[str, Any] = field(default_factory=dict)


class OAuthProvider(ABC):
    """
    Abstract base class for OAuth2 providers with PKCE support.

    Implements RFC 9700 PKCE (Proof Key for Code Exchange) for enhanced security
    against authorization code interception attacks.

    Subclasses must implement:
    - _get_config(): Return OAuthConfig for the provider
    - _exchange_code(): Exchange authorization code for tokens
    - _fetch_user_info(): Fetch user info from the provider's API
    """

    def __init__(self):
        self._config: OAuthConfig | None = None

    @property
    def config(self) -> OAuthConfig:
        """Get OAuth configuration (lazily loaded)."""
        if self._config is None:
            self._config = self._get_config()
        return self._config

    @abstractmethod
    def _get_config(self) -> OAuthConfig:
        """Return OAuth configuration for this provider."""
        pass

    @abstractmethod
    async def _exchange_code(self, code: str, code_verifier: str) -> dict[str, Any]:
        """
        Exchange authorization code for tokens.

        Args:
            code: Authorization code from OAuth callback
            code_verifier: PKCE code verifier

        Returns:
            Dict with access_token, refresh_token, expires_in, etc.
        """
        pass

    @abstractmethod
    async def _fetch_user_info(self, access_token: str) -> dict[str, Any]:
        """
        Fetch user information from provider's API.

        Args:
            access_token: Valid OAuth access token

        Returns:
            Dict with provider_account_id, email, and other user info
        """
        pass

    @staticmethod
    def generate_pkce_pair() -> tuple[str, str]:
        """
        Generate PKCE code_verifier and code_challenge (S256 method per RFC 9700).

        Returns:
            Tuple of (code_verifier, code_challenge)
        """
        code_verifier = secrets.token_urlsafe(32)
        code_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(code_verifier.encode()).digest()
        ).rstrip(b'=').decode()
        return code_verifier, code_challenge

    def build_auth_url(
        self,
        state: str,
        code_challenge: str,
        extra_params: dict[str, str] | None = None,
    ) -> str:
        """
        Build OAuth2 authorization URL with PKCE.

        Args:
            state: CSRF protection state parameter
            code_challenge: PKCE code challenge
            extra_params: Additional query parameters

        Returns:
            Full authorization URL
        """
        from urllib.parse import urlencode

        params = {
            "client_id": self.config.client_id,
            "redirect_uri": self.config.redirect_uri,
            "response_type": "code",
            "scope": " ".join(self.config.scopes),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            **self.config.extra_auth_params,
            **(extra_params or {}),
        }

        return f"{self.config.auth_url}?{urlencode(params)}"

    async def handle_callback(
        self,
        code: str,
        state: str,
        code_verifier: str,
    ) -> OAuthTokenResult:
        """
        Handle OAuth2 callback and return token result.

        Args:
            code: Authorization code from callback
            state: State parameter (already validated)
            code_verifier: PKCE code verifier

        Returns:
            OAuthTokenResult with tokens and user info
        """
        # Exchange code for tokens
        token_response = await self._exchange_code(code, code_verifier)

        # Extract token information
        access_token = token_response.get("access_token", "")
        refresh_token = token_response.get("refresh_token")
        expires_in = token_response.get("expires_in")
        expires_at = time.time() + expires_in if expires_in else None

        # Fetch user info
        user_info = await self._fetch_user_info(access_token)

        return OAuthTokenResult(
            provider_account_id=user_info.get("provider_account_id", ""),
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=expires_at,
            email=user_info.get("email"),
            extra_data=user_info,
        )

    async def refresh_access_token(
        self,
        refresh_token: str,
    ) -> dict[str, Any]:
        """
        Refresh an expired access token using the refresh token.

        Args:
            refresh_token: Valid refresh token

        Returns:
            Dict with new access_token, refresh_token, expires_in
        """
        import httpx

        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.config.token_url,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": self.config.client_id,
                    "client_secret": self.config.client_secret,
                },
            )
            response.raise_for_status()
            return response.json()
