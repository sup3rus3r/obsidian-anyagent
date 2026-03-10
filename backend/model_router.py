"""
Model router — resolves a model config string to an Agno model instance.

Resolution order for API keys:
  1. User's vault (project-scoped first, then global)
  2. Server-level .env fallback

Supported providers:
  - claude-*          → Agno Claude (Anthropic)
  - gpt-* / o1 / o3 / o4  → Agno OpenAIChat
  - lmstudio/*        → Agno OpenAILike (local LM Studio)
  - ollama/*          → Agno Ollama (local Ollama)
"""

import os
from typing import Optional

from agno.models.anthropic import Claude
from agno.models.openai import OpenAIChat
from agno.models.openai.like import OpenAILike

from crypto_utils import decrypt_value


# ── Server-level fallback keys ───────────────────────────────────────────────

_ANTHROPIC_KEY  = os.getenv("ANTHROPIC_API_KEY", "")
_OPENAI_KEY     = os.getenv("OPENAI_API_KEY", "")
_LMSTUDIO_URL   = os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1")
_OLLAMA_URL     = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")


def _resolve_key(label: str, vault_secrets: list[dict]) -> Optional[str]:
    """
    Resolve an API key from the vault secrets list (already fetched for this run),
    falling back to server env vars.
    """
    for s in vault_secrets:
        if s.get("label") == label and s.get("encrypted_value"):
            try:
                return decrypt_value(s["encrypted_value"])
            except Exception:
                pass

    # Env fallback
    return os.getenv(label) or None


def build_model(model_id: str, vault_secrets: list[dict] = [], lmstudio_url: Optional[str] = None):
    """
    Build an Agno model instance from a model_id string.

    model_id examples:
      "claude-sonnet-4-6"
      "claude-opus-4-6"
      "gpt-4o"
      "gpt-5"
      "o3"
      "o4-mini"
      "lmstudio/llama3"          (anything after lmstudio/ is the model name)
      "ollama/llama3.1"          (anything after ollama/ is the model name)
    """
    mid = model_id.strip().lower()

    # ── Anthropic Claude ────────────────────────────────────────────────────
    if mid.startswith("claude"):
        api_key = _resolve_key("ANTHROPIC_API_KEY", vault_secrets) or _ANTHROPIC_KEY
        if not api_key:
            raise ValueError(
                "No Anthropic API key found. Add ANTHROPIC_API_KEY to your vault or server .env."
            )
        return Claude(
            id=model_id,
            api_key=api_key,
            cache_system_prompt=True,
        )

    # ── OpenAI ──────────────────────────────────────────────────────────────
    if (
        mid.startswith("gpt-")
        or mid.startswith("o1")
        or mid.startswith("o3")
        or mid.startswith("o4")
        or mid.startswith("chatgpt")
        or mid.startswith("codex")
    ):
        api_key = _resolve_key("OPENAI_API_KEY", vault_secrets) or _OPENAI_KEY
        if not api_key:
            raise ValueError(
                "No OpenAI API key found. Add OPENAI_API_KEY to your vault or server .env."
            )
        kwargs = dict(id=model_id, api_key=api_key)
        # Reasoning effort for o-series and gpt-5
        if mid.startswith("o1") or mid.startswith("o3") or mid.startswith("o4") or mid.startswith("gpt-5"):
            kwargs["reasoning_effort"] = "medium"
        return OpenAIChat(**kwargs)

    # ── LM Studio ───────────────────────────────────────────────────────────
    if mid.startswith("lmstudio/"):
        local_model_id = model_id[len("lmstudio/"):]
        return OpenAILike(
            id=local_model_id,
            base_url=lmstudio_url or _LMSTUDIO_URL,
            api_key="lm-studio",
        )

    # ── Ollama ──────────────────────────────────────────────────────────────
    if mid.startswith("ollama/"):
        try:
            from agno.models.ollama import Ollama
        except ImportError:
            raise ValueError(
                "Ollama provider requires the 'ollama' package. Run: pip install ollama"
            )
        local_model_id = model_id[len("ollama/"):]
        return Ollama(
            id=local_model_id,
            host=_OLLAMA_URL,
        )

    raise ValueError(
        f"Unknown model_id '{model_id}'. "
        "Use claude-*, gpt-*, o3, o4-mini, lmstudio/<model>, or ollama/<model>."
    )


def default_model(vault_secrets: list[dict] = []):
    """Returns the default orchestrator model."""
    return build_model("claude-sonnet-4-6", vault_secrets)
