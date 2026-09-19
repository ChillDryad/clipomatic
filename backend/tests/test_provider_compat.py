"""Provider compatibility regression tests."""

from types import SimpleNamespace

from pipeline.highlight_detection import _chat


class _Create:
    def __init__(self):
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="[]"))])


def _client(create):
    return SimpleNamespace(chat=SimpleNamespace(completions=create))


def test_openai_chat_omits_ollama_num_ctx():
    create = _Create()
    _chat(_client(create), "gpt-4o-mini", "system", [{"role": "user", "content": "hello"}], use_ollama_options=False)
    assert "extra_body" not in create.calls[0]


def test_ollama_chat_keeps_num_ctx():
    create = _Create()
    _chat(_client(create), "gemma3:latest", "system", [{"role": "user", "content": "hello"}], num_ctx=8192)
    assert create.calls[0]["extra_body"] == {"num_ctx": 8192}
