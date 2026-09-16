"""Local-only LLM model policy for Clipomatic.

The compose installation must never route inference to Ollama cloud models.
Every model used by the pipeline must be explicitly allowlisted.
"""

import os


_DEFAULT_LOCAL_MODELS = "gemma4:12b,gemma3:latest"


def configured_local_models() -> set[str]:
    """Return exact local model names allowed for pipeline inference."""
    raw = os.environ.get("LOCAL_LLM_MODELS", _DEFAULT_LOCAL_MODELS)
    return {model.strip() for model in raw.split(",") if model.strip()}


def validate_local_model(model: str) -> str:
    """Validate and return a model name, rejecting cloud or unlisted models."""
    normalized = model.strip()
    if not normalized:
        raise ValueError("LLM model name cannot be empty")

    lowered = normalized.lower()
    if ":cloud" in lowered or lowered.endswith("-cloud"):
        raise ValueError(f"Cloud models are disabled for this installation: {normalized}")

    allowed = configured_local_models()
    if normalized not in allowed:
        raise ValueError(
            f"Model {normalized!r} is not in LOCAL_LLM_MODELS: {sorted(allowed)}"
        )
    return normalized
