"""Regression tests for persistent first-run configuration storage."""

import importlib


def _store(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKSPACE_DIR", str(tmp_path))
    monkeypatch.delenv("OAUTH_ENCRYPTION_KEY", raising=False)
    import config_store
    return importlib.reload(config_store)


def test_generated_key_and_encrypted_provider_secret_persist(monkeypatch, tmp_path):
    store = _store(monkeypatch, tmp_path)
    encrypted = store.encrypt_secret("sk-test-secret")
    store.save_config({
        "setup_complete": True,
        "provider": "openai",
        "base_url": "https://api.openai.com/v1",
        "llm_model": "gpt-4o-mini",
        "highlight_model": "gpt-4o-mini",
        "vision_model": "gpt-4o-mini",
        "api_key_encrypted": encrypted,
    })

    reloaded = importlib.reload(store)
    assert reloaded.provider_config()["api_key"] == "sk-test-secret"
    assert reloaded.public_config()["has_api_key"] is True
    assert "sk-test-secret" not in str(reloaded.public_config())
    assert (tmp_path / ".secrets" / "fernet.key").exists()


def test_legacy_env_key_is_migrated_to_workspace(monkeypatch, tmp_path):
    from cryptography.fernet import Fernet
    legacy_key = Fernet.generate_key().decode()
    monkeypatch.setenv("WORKSPACE_DIR", str(tmp_path))
    monkeypatch.setenv("OAUTH_ENCRYPTION_KEY", legacy_key)
    import config_store
    store = importlib.reload(config_store)
    encrypted = store.encrypt_secret("legacy-secret")
    monkeypatch.delenv("OAUTH_ENCRYPTION_KEY")
    reloaded = importlib.reload(store)
    assert reloaded.decrypt_secret(encrypted) == "legacy-secret"


def test_env_is_only_a_fallback_before_setup(monkeypatch, tmp_path):
    monkeypatch.setenv("LLM_BASE_URL", "http://ollama:11434/v1")
    monkeypatch.setenv("LLM_API_KEY", "ollama")
    store = _store(monkeypatch, tmp_path)
    assert store.provider_config()["base_url"] == "http://ollama:11434/v1"
    assert store.provider_config()["api_key"] == "ollama"
