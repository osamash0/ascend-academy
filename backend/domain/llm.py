"""
LLM Provider abstraction.

Defines the LLMProvider Protocol so ai_service.py can dispatch to Groq,
Gemini, or Ollama through a single interface instead of if/elif chains.

Usage:
    from backend.domain.llm import provider_factory
    provider = provider_factory.get("groq")
    text = provider.generate_text("Your prompt here")
"""
from __future__ import annotations
import json
import logging
import re
import time
from typing import Protocol, runtime_checkable

logger = logging.getLogger(__name__)

# ─── Protocol ────────────────────────────────────────────────────────────────

@runtime_checkable
class LLMProvider(Protocol):
    """Minimal contract every LLM backend must satisfy."""

    def generate_text(self, prompt: str) -> str:
        """Generate a plain-text completion from a prompt."""
        ...

    def generate_json(self, prompt: str, schema: type | None = None) -> dict:
        """Generate a JSON object. Schema hint is optional for structured output."""
        ...

    def analyze_image(self, base64_image: str, prompt: str) -> dict:
        """Analyze a slide image and return structured JSON.
        Returns an empty dict if the provider does not support vision."""
        ...


# ─── Retry helper ─────────────────────────────────────────────────────────────

def _with_retry(fn, *args, max_attempts: int = 3, **kwargs):
    delay = 2.0
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:
            last_exc = exc
            msg = str(exc).lower()
            if ("429" in msg or "rate_limit" in msg or "rate limit" in msg) and attempt < max_attempts:
                logger.warning("Rate-limit (attempt %s/%s), retry in %.0fs", attempt, max_attempts, delay)
                time.sleep(delay)
                delay *= 2
            else:
                raise
    raise last_exc  # type: ignore[misc]


# ─── Groq Provider ────────────────────────────────────────────────────────────

class GroqProvider:
    _TEXT_MODEL = "llama-3.1-8b-instant"
    # llama-3.2-11b-vision-preview was decommissioned by Groq (Apr 2026).
    # llama-4-scout is the current free-tier vision model on Groq.
    _VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"

    def __init__(self, api_key: str) -> None:
        from groq import Groq
        self._client = Groq(api_key=api_key, max_retries=0)

    def generate_text(self, prompt: str) -> str:
        res = _with_retry(
            self._client.chat.completions.create,
            model=self._TEXT_MODEL,
            messages=[{"role": "user", "content": prompt}],
        )
        return res.choices[0].message.content.strip()

    def generate_json(self, prompt: str, schema: type | None = None) -> dict:
        res = _with_retry(
            self._client.chat.completions.create,
            model=self._TEXT_MODEL,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        return json.loads(res.choices[0].message.content)

    def analyze_image(self, base64_image: str, prompt: str) -> dict:
        user_content: list = [
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}},
            {"type": "text", "text": prompt},
        ]
        try:
            res = _with_retry(
                self._client.chat.completions.create,
                model=self._VISION_MODEL,
                messages=[{"role": "user", "content": user_content}],
                temperature=0.2,
                max_tokens=1024,
                response_format={"type": "json_object"},
            )
            raw = res.choices[0].message.content
            return _parse_json(raw)
        except Exception as exc:
            logger.error("Groq vision error: %s", exc, exc_info=True)
            return {}


# ─── Gemini Provider ──────────────────────────────────────────────────────────

class GeminiProvider:
    _MODEL = "gemini-1.5-flash"

    def __init__(self, api_key: str) -> None:
        from google import genai
        from google.genai import types as _gtypes
        self._client = genai.Client(api_key=api_key)
        self._types = _gtypes

    def generate_text(self, prompt: str) -> str:
        res = self._client.models.generate_content(model=self._MODEL, contents=prompt)
        return res.text.strip()

    def generate_json(self, prompt: str, schema: type | None = None) -> dict:
        cfg = self._types.GenerateContentConfig(response_mime_type="application/json")
        if schema:
            cfg = self._types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema,
            )
        res = self._client.models.generate_content(model=self._MODEL, contents=prompt, config=cfg)
        return json.loads(res.text)

    def analyze_image(self, base64_image: str, prompt: str) -> dict:
        import base64 as _b64
        try:
            image_bytes = _b64.b64decode(base64_image)
            res = self._client.models.generate_content(
                model=self._MODEL,
                contents=[
                    self._types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    prompt,
                ],
                config=self._types.GenerateContentConfig(response_mime_type="application/json"),
            )
            return _parse_json(res.text)
        except Exception as exc:
            logger.error("Gemini vision error: %s", exc, exc_info=True)
            return {}


# ─── Ollama Provider ──────────────────────────────────────────────────────────

class OllamaProvider:
    _MODEL = "llama3"

    def generate_text(self, prompt: str) -> str:
        import ollama
        res = ollama.chat(model=self._MODEL, messages=[{"role": "user", "content": prompt}])
        return res["message"]["content"].strip()

    def generate_json(self, prompt: str, schema: type | None = None) -> dict:
        raw = self.generate_text(prompt)
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        return json.loads(m.group()) if m else {}

    def analyze_image(self, base64_image: str, prompt: str) -> dict:
        # Ollama vision support is model-dependent; safe fallback is empty
        logger.warning("OllamaProvider.analyze_image is not supported; returning empty dict")
        return {}


# ─── Factory ─────────────────────────────────────────────────────────────────

class _ProviderFactory:
    """Lazily instantiates providers and caches them."""

    def __init__(self) -> None:
        self._cache: dict[str, LLMProvider] = {}

    def get(self, model_key: str) -> LLMProvider:
        """Return a provider for the given model key.

        Recognized keys:
          'groq'               → GroqProvider
          'gemini-1.5-flash'   → GeminiProvider
          'gemini-1.5-flash'   → GeminiProvider
          'llama3'             → OllamaProvider
        """
        if model_key in self._cache:
            return self._cache[model_key]

        provider: LLMProvider
        if model_key == "groq":
            from backend.core.config import settings
            if not settings.groq_api_key:
                raise RuntimeError("GROQ_API_KEY is not configured")
            provider = GroqProvider(api_key=settings.groq_api_key)
        elif model_key in ("gemini-1.5-flash", "gemini-1.5-flash"):
            from backend.core.config import settings
            key = settings.effective_gemini_key
            if not key:
                raise RuntimeError("GEMINI_API_KEY / GOOGLE_API_KEY is not configured")
            provider = GeminiProvider(api_key=key)
        elif model_key == "llama3":
            provider = OllamaProvider()
        else:
            raise ValueError(f"Unknown LLM model key: {model_key!r}")

        self._cache[model_key] = provider
        return provider


provider_factory = _ProviderFactory()


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _parse_json(raw: str) -> dict:
    """Extract JSON from a model response, handling markdown code fences."""
    raw = raw.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]+?)```", raw)
    if m:
        raw = m.group(1).strip()
    m = re.search(r"\{[\s\S]*\}", raw)
    if m:
        return json.loads(m.group())
    return json.loads(raw)
