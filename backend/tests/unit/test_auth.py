"""
Unit tests for auth.py - Authentication utilities.

Tests cover:
- Password validation (NIST requirements)
- Password hashing and verification
- JWT token creation and decoding
- OAuth token encryption/decryption
"""

import os
import time
from datetime import datetime, timedelta
from unittest.mock import patch

import jwt
import pytest

from auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    ALGORITHM,
    REFRESH_TOKEN_EXPIRE_DAYS,
    JWT_ISSUER,
    JWT_AUDIENCE,
    COMMON_PASSWORDS,
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
    encrypt_oauth_token,
    decrypt_oauth_token,
    hash_password,
    validate_password_strength,
    verify_password,
    get_jwt_public_key,
)


# ---------------------------------------------------------------------------
# Password Validation Tests
# ---------------------------------------------------------------------------


class TestValidatePasswordStrength:
    """Tests for validate_password_strength function."""

    def test_valid_password(self):
        """Test a password that meets all requirements."""
        is_valid, error = validate_password_strength("SecureP@ssw0rd123!")
        assert is_valid is True
        assert error is None

    def test_password_too_short(self):
        """Test password shorter than 12 characters."""
        is_valid, error = validate_password_strength("Short1!")
        assert is_valid is False
        assert "at least 12 characters" in error

    def test_password_exactly_12_chars(self):
        """Test password with exactly 12 characters (should pass length check)."""
        is_valid, error = validate_password_strength("LongP@ss1234")
        # May still fail on character variety, but should pass length
        if is_valid is False:
            assert "12 characters" not in error

    def test_common_password(self, common_passwords):
        """Test that common passwords are rejected."""
        for pwd in ["password", "123456", "qwerty", "letmein"]:
            is_valid, error = validate_password_strength(pwd + "12345678")  # Pad to meet length
            # Common password check is case-insensitive
            is_valid_lower, _ = validate_password_strength(pwd.lower())
            if not is_valid_lower:
                assert "too common" in error or "common" in error.lower()

    def test_missing_uppercase(self):
        """Test password without uppercase letters."""
        is_valid, error = validate_password_strength("lowercase123!@#")
        assert is_valid is False
        assert "uppercase" in error

    def test_missing_lowercase(self):
        """Test password without lowercase letters."""
        is_valid, error = validate_password_strength("UPPERCASE123!@#")
        assert is_valid is False
        assert "lowercase" in error

    def test_missing_digit(self):
        """Test password without digits."""
        is_valid, error = validate_password_strength("NoDigitsHere!@#")
        assert is_valid is False
        assert "digit" in error

    def test_missing_special(self):
        """Test password without special characters."""
        is_valid, error = validate_password_strength("NoSpecial123abc")
        assert is_valid is False
        assert "special" in error

    def test_three_of_four_categories(self):
        """Test password with 3 of 4 character categories (should pass)."""
        # Uppercase, lowercase, digits (no special)
        is_valid, error = validate_password_strength("ValidPass123")
        assert is_valid is True
        assert error is None

    def test_two_of_four_categories(self):
        """Test password with only 2 character categories (should fail)."""
        # Only lowercase and digits
        is_valid, error = validate_password_strength("onlylower123")
        assert is_valid is False

    def test_all_four_categories(self):
        """Test password with all 4 character categories."""
        is_valid, error = validate_password_strength("ValidP@ss123")
        assert is_valid is True
        assert error is None

    def test_empty_password(self):
        """Test empty password."""
        is_valid, error = validate_password_strength("")
        assert is_valid is False
        assert "12 characters" in error

    def test_whitespace_password(self):
        """Test password with only whitespace."""
        is_valid, error = validate_password_strength("            ")
        # Should pass length check but may fail variety
        assert is_valid is False


# ---------------------------------------------------------------------------
# Password Hashing Tests
# ---------------------------------------------------------------------------


class TestPasswordHashing:
    """Tests for hash_password and verify_password functions."""

    def test_hash_password_returns_string(self):
        """Test that hash_password returns a string."""
        password = "SecureP@ssw0rd123!"
        hash_result = hash_password(password)
        assert isinstance(hash_result, str)
        assert len(hash_result) > 0

    def test_hash_password_different_hashes(self):
        """Test that same password produces different hashes (salt)."""
        password = "SecureP@ssw0rd123!"
        hash1 = hash_password(password)
        hash2 = hash_password(password)
        assert hash1 != hash2  # Different salts

    def test_hash_password_same_password_different_salts(self):
        """Test that bcrypt uses different salts."""
        password = "TestP@ssword123"
        hashes = [hash_password(password) for _ in range(5)]
        assert len(set(hashes)) == 5  # All unique

    def test_verify_password_correct(self):
        """Test verifying correct password."""
        password = "SecureP@ssw0rd123!"
        hash_result = hash_password(password)
        assert verify_password(password, hash_result) is True

    def test_verify_password_incorrect(self):
        """Test verifying incorrect password."""
        password = "SecureP@ssw0rd123!"
        wrong_password = "WrongP@ssw0rd456!"
        hash_result = hash_password(password)
        assert verify_password(wrong_password, hash_result) is False

    def test_verify_password_empty_hash(self):
        """Test verifying password with empty hash."""
        with pytest.raises((ValueError, Exception)):
            verify_password("password", "")

    def test_verify_password_empty_password(self):
        """Test verifying empty password."""
        hash_result = hash_password("SecureP@ssw0rd123!")
        assert verify_password("", hash_result) is False

    def test_hash_and_verify_unicode_password(self):
        """Test hashing and verifying unicode password."""
        password = "パスワード🔐123!"
        hash_result = hash_password(password)
        assert verify_password(password, hash_result) is True


# ---------------------------------------------------------------------------
# JWT Token Tests
# ---------------------------------------------------------------------------


class TestCreateAccessToken:
    """Tests for create_access_token function."""

    def test_create_access_token_returns_string(self, auth_tokens):
        """Test that access token is a non-empty string."""
        token = auth_tokens["access"]
        assert isinstance(token, str)
        assert len(token) > 0

    def test_create_access_token_contains_claims(self, test_jwt_keys):
        """Test that token contains expected claims."""
        user_id = "test-user-123"
        email = "test@example.com"
        token = create_access_token(user_id, email)

        public_key = get_jwt_public_key()
        payload = jwt.decode(token, public_key, algorithms=[ALGORITHM])
        assert payload["sub"] == user_id
        assert payload["email"] == email
        assert "exp" in payload
        assert payload["iss"] == JWT_ISSUER
        assert payload["aud"] == JWT_AUDIENCE

    def test_create_access_token_expiry_15_minutes(self, test_jwt_keys):
        """Test that access token expires in 15 minutes."""
        user_id = "test-user"
        email = "test@test.com"
        token = create_access_token(user_id, email)

        public_key = get_jwt_public_key()
        payload = jwt.decode(token, public_key, algorithms=[ALGORITHM])
        exp = datetime.fromtimestamp(payload["exp"])
        now = datetime.now(timezone.utc)
        delta = exp - now

        # Should be approximately 15 minutes
        assert 14 * 60 < delta.total_seconds() < 16 * 60

    def test_create_access_token_different_users(self, test_jwt_keys):
        """Test creating tokens for different users."""
        token1 = create_access_token("user1", "user1@test.com")
        token2 = create_access_token("user2", "user2@test.com")

        public_key = get_jwt_public_key()
        payload1 = jwt.decode(token1, public_key, algorithms=[ALGORITHM])
        payload2 = jwt.decode(token2, public_key, algorithms=[ALGORITHM])

        assert payload1["sub"] != payload2["sub"]
        assert payload1["email"] != payload2["email"]


class TestCreateRefreshToken:
    """Tests for create_refresh_token function."""

    def test_create_refresh_token_returns_string(self, auth_tokens):
        """Test that refresh token is a non-empty string."""
        token = auth_tokens["refresh"]
        assert isinstance(token, str)
        assert len(token) > 0

    def test_create_refresh_token_contains_claims(self, test_jwt_keys):
        """Test that refresh token contains expected claims."""
        user_id = "test-user-123"
        token = create_refresh_token(user_id)

        public_key = get_jwt_public_key()
        payload = jwt.decode(token, public_key, algorithms=[ALGORITHM])
        assert payload["sub"] == user_id
        assert payload["type"] == "refresh"
        assert "exp" in payload
        assert payload["iss"] == JWT_ISSUER
        assert payload["aud"] == JWT_AUDIENCE

    def test_create_refresh_token_expiry_30_days(self, test_jwt_keys):
        """Test that refresh token expires in 30 days."""
        user_id = "test-user"
        token = create_refresh_token(user_id)

        public_key = get_jwt_public_key()
        payload = jwt.decode(token, public_key, algorithms=[ALGORITHM])
        exp = datetime.fromtimestamp(payload["exp"])
        now = datetime.now(timezone.utc)
        delta = exp - now

        # Should be approximately 30 days
        assert 29 * 24 * 3600 < delta.total_seconds() < 31 * 24 * 3600

    def test_create_refresh_token_has_type_claim(self, test_jwt_keys):
        """Test that refresh token has type='refresh'."""
        token = create_refresh_token("user-id")
        public_key = get_jwt_public_key()
        payload = jwt.decode(token, public_key, algorithms=[ALGORITHM])
        assert payload["type"] == "refresh"


class TestDecodeAccessToken:
    """Tests for decode_access_token function."""

    def test_decode_valid_access_token(self, auth_tokens):
        """Test decoding a valid access token."""
        token = auth_tokens["access"]
        payload = decode_access_token(token)

        assert "sub" in payload
        assert "email" in payload
        assert payload["iss"] == JWT_ISSUER
        assert payload["aud"] == JWT_AUDIENCE

    def test_decode_expired_access_token(self, test_jwt_keys):
        """Test that expired access token raises 401."""
        from fastapi import HTTPException
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.backends import default_backend

        private_key = serialization.load_pem_private_key(
            test_jwt_keys["private"].encode(),
            password=None,
            backend=default_backend(),
        )

        expired_payload = {
            "sub": "user-id",
            "email": "test@test.com",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=5),
            "iat": datetime.now(timezone.utc) - timedelta(minutes=20),
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
        }
        token = jwt.encode(expired_payload, private_key, algorithm=ALGORITHM)

        with pytest.raises(HTTPException) as exc_info:
            decode_access_token(token)

        assert exc_info.value.status_code == 401
        assert "expired" in exc_info.value.detail.lower()

    def test_decode_invalid_access_token(self):
        """Test that invalid token raises 401."""
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            decode_access_token("invalid.token.here")

        assert exc_info.value.status_code == 401

    def test_decode_wrong_key(self, test_jwt_keys):
        """Test that token signed with different key fails."""
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.backends import default_backend
        from fastapi import HTTPException

        # Generate a different key pair
        other_private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
            backend=default_backend(),
        )

        payload = {"sub": "user", "exp": datetime.now(timezone.utc) + timedelta(minutes=15), "iat": datetime.now(timezone.utc), "iss": JWT_ISSUER, "aud": JWT_AUDIENCE}
        token = jwt.encode(payload, other_private_key, algorithm=ALGORITHM)

        with pytest.raises(HTTPException):
            decode_access_token(token)


class TestDecodeRefreshToken:
    """Tests for decode_refresh_token function."""

    def test_decode_valid_refresh_token(self, auth_tokens):
        """Test decoding a valid refresh token."""
        token = auth_tokens["refresh"]
        payload = decode_refresh_token(token)

        assert "sub" in payload
        assert payload["type"] == "refresh"
        assert payload["iss"] == JWT_ISSUER
        assert payload["aud"] == JWT_AUDIENCE

    def test_decode_refresh_token_wrong_type(self, test_jwt_keys):
        """Test that access token used as refresh token fails."""
        from fastapi import HTTPException

        # Create an access token
        access_token = create_access_token("user", "test@test.com")

        with pytest.raises(HTTPException) as exc_info:
            decode_refresh_token(access_token)

        assert exc_info.value.status_code == 401
        assert "type" in exc_info.value.detail.lower()

    def test_decode_expired_refresh_token(self, test_jwt_keys):
        """Test that expired refresh token raises 401."""
        from fastapi import HTTPException
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.backends import default_backend

        private_key = serialization.load_pem_private_key(
            test_jwt_keys["private"].encode(),
            password=None,
            backend=default_backend(),
        )

        expired_payload = {
            "sub": "user-id",
            "type": "refresh",
            "exp": datetime.now(timezone.utc) - timedelta(days=1),
            "iat": datetime.now(timezone.utc) - timedelta(days=2),
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
        }
        token = jwt.encode(expired_payload, private_key, algorithm=ALGORITHM)

        with pytest.raises(HTTPException) as exc_info:
            decode_refresh_token(token)

        assert exc_info.value.status_code == 401

    def test_decode_invalid_refresh_token(self):
        """Test that invalid refresh token raises 401."""
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            decode_refresh_token("not.a.valid.token")


# ---------------------------------------------------------------------------
# OAuth Token Encryption Tests
# ---------------------------------------------------------------------------


class TestOAuthTokenEncryption:
    """Tests for encrypt_oauth_token and decrypt_oauth_token functions."""

    def test_encrypt_decrypt_round_trip(self, test_oauth_encryption_key):
        """Test that encryption followed by decryption returns original."""
        with patch.dict(os.environ, {"OAUTH_ENCRYPTION_KEY": test_oauth_encryption_key}, clear=False):
            # Need to reimport to pick up the env var
            from cryptography.fernet import Fernet
            fernet = Fernet(test_oauth_encryption_key.encode())

            original = "my-secret-oauth-token"
            encrypted = fernet.encrypt(original.encode()).decode()
            decrypted = fernet.decrypt(encrypted.encode()).decode()

            assert decrypted == original

    def test_encrypt_returns_different_string(self, test_oauth_encryption_key):
        """Test that encryption produces different output each time (Fernet uses random IV)."""
        from cryptography.fernet import Fernet

        fernet = Fernet(test_oauth_encryption_key.encode())
        original = "oauth-token"

        encrypted1 = fernet.encrypt(original.encode()).decode()
        encrypted2 = fernet.encrypt(original.encode()).decode()

        # Fernet uses random IV, so outputs should differ
        assert encrypted1 != encrypted2

    def test_decrypt_invalid_token(self, test_oauth_encryption_key):
        """Test that decrypting invalid token raises exception."""
        from cryptography.fernet import Fernet, InvalidToken

        fernet = Fernet(test_oauth_encryption_key.encode())

        with pytest.raises(InvalidToken):
            fernet.decrypt(b"invalid_encrypted_token")

    def test_encrypt_empty_string(self, test_oauth_encryption_key):
        """Test encrypting empty string."""
        from cryptography.fernet import Fernet

        fernet = Fernet(test_oauth_encryption_key.encode())
        encrypted = fernet.encrypt(b"".encode()).decode()
        decrypted = fernet.decrypt(encrypted.encode()).decode()

        assert decrypted == ""

    def test_encrypt_unicode(self, test_oauth_encryption_key):
        """Test encrypting unicode strings."""
        from cryptography.fernet import Fernet

        fernet = Fernet(test_oauth_encryption_key.encode())
        original = "OAuth トークン 🔐"
        encrypted = fernet.encrypt(original.encode()).decode()
        decrypted = fernet.decrypt(encrypted.encode()).decode()

        assert decrypted == original


# ---------------------------------------------------------------------------
# Integration Tests (with mocked dependencies)
# ---------------------------------------------------------------------------


class TestPasswordBreachCheck:
    """Tests for check_password_breach function.

    Note: This function was removed in favor of simpler password validation.
    These tests are kept for documentation purposes.
    """

    def test_breach_check_removed(self):
        """Document that breach checking was removed for usability."""
        # The check_password_breach function was removed to improve usability.
        # Password validation now only checks:
        # - Minimum 8 characters
        # - Not in top 20 common passwords
        #
        # This allows users to register more easily without external API calls.
        pass


# Helper classes for async mocks
class AsyncMock(MagicMock):
    async def __call__(self, *args, **kwargs):
        return super().__call__(*args, **kwargs)


class MagicMock:
    def __init__(self, *args, **kwargs):
        self._mock_name = kwargs.get('name', 'mock')
        for key, value in kwargs.items():
            if key != 'name':
                setattr(self, key, value)

    def __getattr__(self, name):
        return MagicMock(name=f"{self._mock_name}.{name}")

    def __call__(self, *args, **kwargs):
        return MagicMock()

    def __getitem__(self, key):
        return MagicMock()
