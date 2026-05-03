"""
Multi-provider LLM orchestrator with automatic failover.

Provider chain (rate-limit data: github.com/cheahjs/free-llm-api-resources):

  ID            Model                       Daily req   TPM      Notes
  ──────────────────────────────────────────────────────────────────────
  cerebras      gpt-oss-120b                14,400      60,000   Best bulk option
  groq_fast     llama-3.1-8b-instant        14,400       6,000   Fast fallback
  gemma         gemma-3-27b-it              14,400      15,000   Google SDK
  mistral       mistral-small-latest        ~unlimited  500,000  Needs phone verify
  openrouter    llama-3.3-70b:free              50          —    50/day free; 1K/day w/ $10
  gemini        gemini-2.0-flash             ~1,500     250,000  Google SDK
  groq          llama-3.3-70b-versatile      1,000      12,000   Quality; conserved for blueprints
  ──────────────────────────────────────────────────────────────────────

Two chains:
  BULK_CHAIN    — slide text analysis (high volume, use capacity-first)
  QUALITY_CHAIN — blueprints / planning (low volume, quality-first)

Required env vars (add what you have; missing keys disable that provider gracefully):
  GROQ_API_KEY          https://console.groq.com
  CEREBRAS_API_KEY      https://cloud.cerebras.ai
  GEMINI_API_KEY        https://aistudio.google.com/apikey
  OPENROUTER_API_KEY    https://openrouter.ai/keys
  MISTRAL_API_KEY       https://console.mistral.ai  (requires phone)
"""

import os
import logging
import json
import re
import asyncio
import datetime
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterator, List, Optional, Tuple
from pathlib import Path
from dotenv import load_dotenv

logger = logging.getLogger(__name__)


def _init_env() -> None:
    _root    = Path(__file__).resolve().parent.parent.parent.parent / ".env"
    _backend = Path(__file__).resolve().parent.parent.parent / ".env"
    if _root.exists():    load_dotenv(dotenv_path=_root,    override=True)
    if _backend.exists(): load_dotenv(dotenv_path=_backend, override=True)

_init_env()

# ---------------------------------------------------------------------------
# Backward-compat model-name constants (used by vision.py / ai_service.py)
# ---------------------------------------------------------------------------
OLLAMA_MODEL      = "llama3"
GEMINI_MODEL      = "gemini-2.0-flash"
GROQ_MODEL        = "llama-3.3-70b-versatile"
GROQ_FAST_MODEL   = "llama-3.1-8b-instant"
# llama-3.2-11b-vision-preview was decommissioned by Groq (Apr 2026).
# meta-llama/llama-4-scout-17b-16e-instruct is the current free-tier vision
# model on Groq with the same OpenAI-compatible chat-completions schema.
GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
CEREBRAS_MODEL    = "gpt-oss-120b"

_VISION_SLIDE_TYPES_METADATA = {"title_slide", "meta_slide"}

# ---------------------------------------------------------------------------
# Per-slide quiz batching configuration
# ---------------------------------------------------------------------------
# Smaller batches with overlap give the LLM cross-slide context (so slide N+1
# can resolve "this method" / "this algorithm" referring back to slide N)
# without growing the token budget of any single call. See replit.md
# "Quiz batch tuning" for the trade-off.

@dataclass(frozen=True)
class QuizBatchConfig:
    batch_size: int        # max slides per LLM call (including context)
    context_overlap: int   # last K slides of batch N reappear as context in N+1


def _load_quiz_batch_config() -> QuizBatchConfig:
    try:
        bs = int(os.environ.get("QUIZ_BATCH_SIZE", "5"))
    except (TypeError, ValueError):
        bs = 5
    try:
        ov = int(os.environ.get("QUIZ_BATCH_OVERLAP", "1"))
    except (TypeError, ValueError):
        ov = 1
    if bs < 1:
        logger.warning("QUIZ_BATCH_SIZE %d invalid, falling back to 5", bs)
        bs = 5
    if ov < 0 or ov >= bs:
        logger.warning(
            "QUIZ_BATCH_OVERLAP %d invalid for batch_size %d, clamping",
            ov, bs,
        )
        ov = min(max(ov, 0), bs - 1)
    return QuizBatchConfig(batch_size=bs, context_overlap=ov)


QUIZ_BATCH_CONFIG: QuizBatchConfig = _load_quiz_batch_config()


def iter_overlapping_windows(
    items: List[Any],
    batch_size: int,
    overlap: int,
) -> Iterator[Tuple[List[Any], int]]:
    """Yield ``(window, context_count)`` pairs covering ``items``.

    The first ``context_count`` entries of each window are read-only context
    carried over from the previous window; the remaining entries are new
    items the caller is responsible for processing. Every input item appears
    as a non-context entry in exactly one window.
    """
    if batch_size < 1:
        raise ValueError("batch_size must be >= 1")
    if overlap < 0 or overlap >= batch_size:
        raise ValueError("overlap must satisfy 0 <= overlap < batch_size")
    n = len(items)
    pos = 0
    while pos < n:
        ctx = 0 if pos == 0 else min(overlap, pos)
        new_capacity = batch_size - ctx
        end = min(pos + new_capacity, n)
        yield items[pos - ctx:end], ctx
        pos = end

# ---------------------------------------------------------------------------
# Provider registry
# ---------------------------------------------------------------------------

@dataclass
class ProviderConfig:
    id:          str
    model:       str
    daily_limit: int      # requests/day (0 = unlimited / unknown)
    rpm:         int      # requests/minute (0 = unknown)
    tpm:         int      # tokens/minute   (0 = unknown)
    env_var:     str      # name of API-key env var
    base_url:    Optional[str]   # None → uses Google genai SDK
    uses_google_sdk: bool = False


# Order within this list is irrelevant; chains below define priority.
PROVIDER_REGISTRY: Dict[str, ProviderConfig] = {
    p.id: p for p in [
        ProviderConfig(
            id="cerebras",
            model="gpt-oss-120b",
            daily_limit=14_400, rpm=30, tpm=60_000,
            env_var="CEREBRAS_API_KEY",
            base_url="https://api.cerebras.ai/v1",
        ),
        ProviderConfig(
            id="groq_fast",
            model="llama-3.1-8b-instant",
            daily_limit=14_400, rpm=30, tpm=6_000,
            env_var="GROQ_API_KEY",
            base_url="https://api.groq.com/openai/v1",
        ),
        ProviderConfig(
            id="gemma",
            model="gemma-3-27b-it",
            daily_limit=14_400, rpm=30, tpm=15_000,
            env_var="GEMINI_API_KEY",
            base_url=None,
            uses_google_sdk=True,
        ),
        ProviderConfig(
            id="mistral",
            model="mistral-small-latest",
            daily_limit=0, rpm=60, tpm=500_000,
            env_var="MISTRAL_API_KEY",
            base_url="https://api.mistral.ai/v1",
        ),
        ProviderConfig(
            id="openrouter",
            model="meta-llama/llama-3.3-70b-instruct:free",
            daily_limit=50, rpm=20, tpm=0,
            env_var="OPENROUTER_API_KEY",
            base_url="https://openrouter.ai/api/v1",
        ),
        ProviderConfig(
            id="gemini",
            model="gemini-2.0-flash",
            daily_limit=1_500, rpm=15, tpm=250_000,
            env_var="GEMINI_API_KEY",
            base_url=None,
            uses_google_sdk=True,
        ),
        ProviderConfig(
            id="groq",
            model="llama-3.3-70b-versatile",
            daily_limit=1_000, rpm=30, tpm=12_000,
            env_var="GROQ_API_KEY",
            base_url="https://api.groq.com/openai/v1",
        ),
    ]
}

# ---------------------------------------------------------------------------
# Failover chains
# ---------------------------------------------------------------------------

# Bulk slide processing: highest daily capacity first; Groq 70B last (conserve quota)
BULK_CHAIN:    List[str] = ["cerebras", "groq_fast", "gemma", "mistral", "openrouter", "gemini", "groq"]

# Blueprint / planning / deck summaries: quality first
QUALITY_CHAIN: List[str] = ["groq", "cerebras", "openrouter", "gemini", "mistral", "groq_fast", "gemma"]

# ---------------------------------------------------------------------------
# Client initialisation
# ---------------------------------------------------------------------------

try:
    import ollama as _ollama_lib
except ImportError:
    _ollama_lib = None

try:
    from openai import OpenAI as _OpenAI
except ImportError:
    _OpenAI = None

try:
    from google import genai as _genai
    _gem_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    # Use the SDK's default API version (v1beta). The previous v1 pin caused
    # 404s for `gemma-3-27b-it` (gemma is v1beta-only) and 400s for vision
    # calls that pass `responseMimeType` (rejected by v1). v1beta accepts both
    # and is what `google-genai` ships as the default for production usage.
    _google_client = _genai.Client(api_key=_gem_key) if _gem_key else None
except Exception:
    _genai = None
    _google_client = None


def _make_openai_client(env_var: str, base_url: str) -> Optional[Any]:
    """Creates an OpenAI-compatible client if the API key env var is set."""
    if _OpenAI is None:
        return None
    key = os.environ.get(env_var, "")
    if not key or len(key) < 8:
        return None
    try:
        extra = {}
        if "openrouter" in base_url:
            extra["default_headers"] = {"HTTP-Referer": "https://ascend.academy"}
        return _OpenAI(api_key=key, base_url=base_url, max_retries=0, **extra)
    except Exception as exc:
        logger.debug("Could not init client for %s: %s", env_var, exc)
        return None


# Build clients at startup; None means provider is disabled (key not set)
_clients: Dict[str, Optional[Any]] = {}
for _cfg in PROVIDER_REGISTRY.values():
    if _cfg.uses_google_sdk:
        _clients[_cfg.id] = _google_client   # shared Google client for gemini + gemma
    elif _cfg.base_url:
        _clients[_cfg.id] = _make_openai_client(_cfg.env_var, _cfg.base_url)

# Backward-compat module-level references (used by vision.py / ai_service.py)
try:
    from groq import Groq as _GroqSDK
    _g_key = os.environ.get("GROQ_API_KEY", "")
    groq_client = _GroqSDK(api_key=_g_key, max_retries=0) if len(_g_key) > 20 else None
except Exception:
    groq_client = None

cerebras_client = _clients.get("cerebras")
gemini_client   = _google_client
ollama          = _ollama_lib

# ---------------------------------------------------------------------------
# Provider rotator — daily budget + backoff tracking
# ---------------------------------------------------------------------------

class ProviderRotator:
    """
    Thread-safe tracker of daily request counts and temporary 429 backoffs.
    Skips providers that have hit their daily limit or are in backoff window.
    Resets counts at UTC midnight.
    """

    def __init__(self) -> None:
        self._lock          = threading.Lock()
        self._counts:  Dict[str, int]   = {}
        self._backoff: Dict[str, float] = {}
        self._day:     str              = datetime.date.today().isoformat()

    def _reset_if_new_day(self) -> None:
        today = datetime.date.today().isoformat()
        if today != self._day:
            self._day     = today
            self._counts  = {}
            self._backoff = {}

    def record_success(self, provider_id: str) -> None:
        with self._lock:
            self._reset_if_new_day()
            self._counts[provider_id] = self._counts.get(provider_id, 0) + 1

    def record_rate_limit(self, provider_id: str, backoff_seconds: float = 90.0) -> None:
        with self._lock:
            self._backoff[provider_id] = time.monotonic() + backoff_seconds
        logger.warning("🔄 Provider '%s' rate-limited — backing off %.0fs", provider_id, backoff_seconds)

    def available(self, chain: List[str]) -> List[str]:
        """
        Returns the subset of `chain` that is currently usable, in order.
        Skips providers whose daily limit is hit or are in a 429 backoff window.
        Skips providers without a configured client (no API key).
        Falls back to the full chain if everything is technically exhausted.
        """
        now = time.monotonic()
        with self._lock:
            self._reset_if_new_day()
            ok = []
            for pid in chain:
                cfg = PROVIDER_REGISTRY.get(pid)
                if cfg is None:
                    continue
                # Skip if no client (key not set)
                if _clients.get(pid) is None and not (pid == "groq" and groq_client):
                    continue
                # Skip if daily limit reached
                limit = cfg.daily_limit
                used  = self._counts.get(pid, 0)
                if limit > 0 and used >= limit:
                    logger.debug("Provider '%s' daily limit reached (%d/%d)", pid, used, limit)
                    continue
                # Skip if in 429 backoff
                if now < self._backoff.get(pid, 0.0):
                    remaining = self._backoff[pid] - now
                    logger.debug("Provider '%s' in backoff (%.0fs left)", pid, remaining)
                    continue
                ok.append(pid)
        return ok or chain   # if everything exhausted, try anyway (may still work)


_rotator = ProviderRotator()

# Keep old class name as alias for any direct references
_ProviderRotator = ProviderRotator

# ---------------------------------------------------------------------------
# Per-provider call implementations
# ---------------------------------------------------------------------------

def _call_openai_compat(client: Any, model: str, prompt: str) -> str:
    """Unified caller for all OpenAI-compatible providers."""
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.choices[0].message.content or ""


def _call_google(model: str, prompt: str) -> str:
    """Caller for Google AI Studio (Gemini + Gemma models)."""
    if _google_client is None:
        raise RuntimeError("Google AI client not initialised (GEMINI_API_KEY missing)")
    return _google_client.models.generate_content(model=model, contents=prompt).text


def _call_provider(provider_id: str, prompt: str) -> str:
    """
    Dispatches a prompt to the named provider.
    Raises RuntimeError if the provider is not configured.
    """
    cfg = PROVIDER_REGISTRY.get(provider_id)
    if cfg is None:
        raise ValueError(f"Unknown provider: {provider_id}")

    # Ollama local
    if provider_id == "llama3":
        if _ollama_lib is None:
            raise RuntimeError("Ollama not installed")
        res = _ollama_lib.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
        return res["message"]["content"]

    # Google SDK path (Gemini + Gemma)
    if cfg.uses_google_sdk:
        return _call_google(cfg.model, prompt)

    # Groq uses the native Groq SDK (keeps backward compat for vision.py)
    if provider_id in ("groq", "groq_fast"):
        if groq_client is None:
            raise RuntimeError("Groq client not initialised (GROQ_API_KEY missing)")
        resp = groq_client.chat.completions.create(
            model=cfg.model,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.choices[0].message.content or ""

    # All other OpenAI-compat providers
    client = _clients.get(provider_id)
    if client is None:
        raise RuntimeError(f"Provider '{provider_id}' client not initialised ({cfg.env_var} missing)")
    return _call_openai_compat(client, cfg.model, prompt)


# ---------------------------------------------------------------------------
# Rotation engine
# ---------------------------------------------------------------------------

def _generate_with_rotation(prompt: str, chain: List[str]) -> str:
    """
    Tries each provider in `chain` (skipping unavailable ones), rotates on 429.
    Raises the last exception if every provider fails.
    """
    available = _rotator.available(chain)
    if not available:
        available = chain   # last-ditch: try all

    last_exc: Optional[Exception] = None

    for pid in available:
        try:
            result = _call_provider(pid, prompt)
            _rotator.record_success(pid)
            logger.debug("✅ Provider '%s' served request", pid)
            return result
        except Exception as exc:
            msg = str(exc).lower()
            is_rate_limit = any(k in msg for k in ("429", "rate limit", "quota", "too many requests", "rate_limit"))
            if is_rate_limit:
                _rotator.record_rate_limit(pid)
                last_exc = exc
                logger.warning("⚠️  Provider '%s' rate-limited, trying next", pid)
            else:
                logger.warning("Provider '%s' error (non-rate-limit): %s", pid, exc)
                last_exc = exc
                # Still try next provider for non-fatal errors (network glitches, etc.)
                continue

    raise last_exc or RuntimeError(f"All providers in chain {chain} failed")


# ---------------------------------------------------------------------------
# JSON utilities
# ---------------------------------------------------------------------------

_CTRL_ESCAPE = {"\n": "\\n", "\r": "\\r", "\t": "\\t"}


def _sanitize_json_string(raw: str) -> str:
    """
    Fixes common LLM JSON defects:
    - Unrepresentable control chars stripped
    - Lone backslashes doubled
    - Literal newlines/tabs inside strings escaped
    """
    result: list = []
    in_string = False
    escaped   = False
    i = 0
    n = len(raw)
    while i < n:
        ch = raw[i]
        if escaped:
            result.append(ch)
            escaped = False
            i += 1
            continue
        if in_string:
            if ch == "\\":
                nxt = raw[i + 1] if i + 1 < n else ""
                if nxt in ('"', "\\", "/", "b", "f", "n", "r", "t", "u"):
                    result.append(ch)
                    escaped = True
                else:
                    result.append("\\\\")
                i += 1
                continue
            if ch == '"':
                result.append(ch)
                in_string = False
                i += 1
                continue
            if ord(ch) < 0x20:
                result.append(_CTRL_ESCAPE.get(ch, f"\\u{ord(ch):04x}"))
                i += 1
                continue
        else:
            if 0x00 < ord(ch) < 0x20 and ch not in ("\n", "\r", "\t"):
                i += 1
                continue
            if ch == '"':
                in_string = True
        result.append(ch)
        i += 1
    return "".join(result)


def parse_json_response(raw: str) -> Any:
    """Robustly extracts and parses JSON from an LLM response."""
    raw = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]+?)```", raw)
    if fence:
        raw = fence.group(1).strip()
    raw = _sanitize_json_string(raw)
    match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", raw)
    candidate = match.group(1) if match else raw
    try:
        return json.loads(candidate)
    except json.JSONDecodeError as e:
        logger.warning("JSON parsing failed: %s. Raw: %.300s", e, candidate)
        return {}


# ---------------------------------------------------------------------------
# Token truncation
# ---------------------------------------------------------------------------

try:
    import tiktoken
    _enc = tiktoken.get_encoding("cl100k_base")
    MAX_TEXT_TOKENS = 800

    def safe_truncate_text(text: str) -> Tuple[str, int]:
        tokens = _enc.encode(text)
        count  = len(tokens)
        if count > MAX_TEXT_TOKENS:
            text = _enc.decode(tokens[:MAX_TEXT_TOKENS]).strip() + "\n[content truncated]"
        return text, min(count, MAX_TEXT_TOKENS)
except ImportError:
    def safe_truncate_text(text: str) -> Tuple[str, int]:
        trunc = text[:4000] + "\n...[truncated]" if len(text) > 4000 else text
        return trunc, len(trunc) // 4


# ---------------------------------------------------------------------------
# Public generation API
# ---------------------------------------------------------------------------

def _llm_generate_text_sync(prompt: str, ai_model: str = "groq") -> str:
    """
    Backward-compat sync entry point.
    Routes to the appropriate chain based on ai_model hint.
    """
    if ai_model == "llama3":
        return _call_provider("llama3", prompt)
    return _generate_with_rotation(prompt, QUALITY_CHAIN)


async def generate_text(prompt: str, ai_model: str = "groq") -> str:
    """
    Quality chain: Groq 70B → Cerebras → OpenRouter → Gemini → Mistral → …
    Use for blueprints, planning, deck summaries.
    """
    from backend.services.llm_client import call_llm
    return await call_llm(lambda: _generate_with_rotation(prompt, QUALITY_CHAIN))


async def generate_text_bulk(prompt: str) -> str:
    """
    Bulk chain: Cerebras → Groq 8B → Gemma → Mistral → OpenRouter → Gemini → Groq 70B
    Use for slide-by-slide processing to preserve the scarce Groq 70B quota.
    """
    from backend.services.llm_client import call_llm
    return await call_llm(lambda: _generate_with_rotation(prompt, BULK_CHAIN))


def process_slide_batch(text: str, ai_model: str = "groq") -> Dict[str, Any]:
    """Synchronous single-slide processing (legacy/internal)."""
    prompt = (
        "Analyze this lecture slide and return JSON with "
        "{title, content, summary, questions, slide_type, is_metadata}:\n\n" + text
    )
    raw = _generate_with_rotation(prompt, BULK_CHAIN)
    return parse_json_response(raw)


async def enhance_slide_content(text: str, ai_model: str = "groq") -> Dict[str, Any]:
    from backend.services.ai.prompts import ENHANCE_PROMPT
    raw = await generate_text(ENHANCE_PROMPT.format(text=text))
    return parse_json_response(raw)


async def generate_deck_summary(content: str, ai_model: str = "groq") -> str:
    return await generate_text(
        f"Summarize this lecture content into a cohesive narrative:\n\n{content}"
    )


def _build_cross_slide_quiz_prompt(blueprint: Dict[str, Any], summary: str) -> str:
    """Render the cross-slide quiz prompt from a Master Plan blueprint.

    Surfaces ``cross_slide_quiz_concepts``, slide titles, narrative-arc
    takeaways, and per-slide ``related_previous_slides`` bridges so the LLM
    grounds ``linked_slides`` in real planner indices.
    """
    from backend.services.ai.prompts import CROSS_SLIDE_DECK_QUIZ_PROMPT

    concepts = blueprint.get("cross_slide_quiz_concepts") or []
    plans    = blueprint.get("slide_plans") or []
    arc      = blueprint.get("narrative_arc") or []

    cross_concepts = "\n".join(f"- {c}" for c in concepts if c) or "- (none provided)"

    slide_titles_lines: List[str] = []
    for p in plans:
        if not isinstance(p, dict):
            continue
        idx = p.get("index")
        title = (p.get("proposed_title") or "").strip()
        if idx is None or not title:
            continue
        slide_titles_lines.append(f"- slide {idx}: {title}")
    slide_titles = "\n".join(slide_titles_lines) or "- (no slide titles)"

    # Build "slide N depends on slides X, Y" lines from related_previous_slides,
    # filtered to indices the planner actually emitted.
    valid_indices = {
        p.get("index") for p in plans
        if isinstance(p, dict) and isinstance(p.get("index"), int)
    }
    bridge_lines: List[str] = []
    for p in plans:
        if not isinstance(p, dict):
            continue
        idx = p.get("index")
        rel = p.get("related_previous_slides") or []
        if not isinstance(idx, int) or not isinstance(rel, list):
            continue
        valid_rel = sorted({
            r for r in rel
            if isinstance(r, int) and r != idx and r in valid_indices and r >= 0
        })
        if valid_rel:
            bridge_lines.append(
                f"- slide {idx} builds on slide(s) "
                + ", ".join(str(r) for r in valid_rel)
            )
    slide_bridges = "\n".join(bridge_lines) or "- (no explicit bridges from planner)"

    takeaways_lines: List[str] = []
    for s in arc:
        if not isinstance(s, dict):
            continue
        section = s.get("section_name", "")
        for kt in s.get("key_takeaways") or []:
            if kt:
                takeaways_lines.append(f"- {section}: {kt}")
    section_takeaways = "\n".join(takeaways_lines) or "- (none provided)"

    return CROSS_SLIDE_DECK_QUIZ_PROMPT.format(
        cross_concepts=cross_concepts,
        section_takeaways=section_takeaways,
        slide_titles=slide_titles,
        slide_bridges=slide_bridges,
        summary=(summary or "").strip()[:3000],
    )


def _has_cross_slide_signal(blueprint: Optional[Dict[str, Any]]) -> bool:
    """True when the blueprint has both cross-slide concepts AND slide_plans
    (without slide titles the LLM has no grounded indices for ``linked_slides``)."""
    if not blueprint:
        return False
    concepts = blueprint.get("cross_slide_quiz_concepts") or []
    plans    = blueprint.get("slide_plans") or []
    return bool(concepts) and bool(plans)


async def generate_deck_quiz(
    summary: str,
    ai_model: str = "groq",
    blueprint: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Generate a 5-question deck quiz.

    With a blueprint carrying cross-slide signal we use the cross-slide
    prompt and require ``len(linked_slides) >= 2``; otherwise we fall back
    to the legacy summary-only prompt. Each question gets one validator
    retry; cross-slide questions that still fail are repaired
    deterministically against the planner's concept→indices map and
    dropped if no valid pair can be assembled.
    """
    from backend.services.ai.prompts import DECK_QUIZ_PROMPT
    from backend.services.ai.quiz_validator import (
        coerce_linked_slides,
        validate_and_regenerate,
        validate_cross_slide_question,
        validate_mcq,
    )

    use_cross = _has_cross_slide_signal(blueprint)
    if use_cross:
        prompt = _build_cross_slide_quiz_prompt(blueprint, summary)
    else:
        prompt = DECK_QUIZ_PROMPT + (summary or "")

    raw = await generate_text(prompt)
    parsed = parse_json_response(raw)
    if not isinstance(parsed, list):
        return []

    # Slide-index set + concept→indices map for cross-slide validate/repair.
    slide_index_set: set = set()
    concept_to_indices: Dict[str, List[int]] = {}
    if use_cross and blueprint:
        for p in blueprint.get("slide_plans") or []:
            if not isinstance(p, dict):
                continue
            i = p.get("index")
            if isinstance(i, int):
                slide_index_set.add(i)
                title = (p.get("proposed_title") or "").lower()
                for c in (p.get("concepts") or []):
                    if isinstance(c, str) and c.strip():
                        concept_to_indices.setdefault(c.strip().lower(), []).append(i)
                if title:
                    concept_to_indices.setdefault(title, []).append(i)

    # Lazy single regeneration shared across all failing questions, so the
    # deck quiz never costs more than 2 LLM calls.
    regen_cache: Dict[str, Any] = {"items": None, "called": False}

    async def _get_regen_for(i: int, original: Dict[str, Any]) -> Dict[str, Any]:
        if not regen_cache["called"]:
            regen_cache["called"] = True
            try:
                raw2 = await generate_text(prompt)
                items = parse_json_response(raw2)
                regen_cache["items"] = items if isinstance(items, list) else []
            except Exception as exc:
                logger.warning("Deck quiz regeneration failed: %s", exc)
                regen_cache["items"] = []
        items = regen_cache["items"] or []
        if i < len(items) and isinstance(items[i], dict):
            return items[i]
        return original

    def _validator(q: Dict[str, Any]) -> Tuple[bool, str]:
        if use_cross:
            return validate_cross_slide_question(q, slide_index_set or None)
        return validate_mcq(q)

    def _repair_linked_slides(q: Dict[str, Any]) -> List[int]:
        """Deterministic fix when the LLM returns < 2 indices: keep valid
        ones, then look up ``concept`` in the planner map, then pad from
        the slide-index set."""
        existing = [
            i for i in coerce_linked_slides(q.get("linked_slides"))
            if not slide_index_set or i in slide_index_set
        ]
        if len(existing) >= 2:
            return existing

        concept = (q.get("concept") or "").strip().lower()
        candidate_pool: List[int] = list(existing)
        if concept and concept in concept_to_indices:
            for idx in concept_to_indices[concept]:
                if idx not in candidate_pool:
                    candidate_pool.append(idx)
        if len(candidate_pool) < 2:
            # Fuzzy contains-match against any concept key
            if concept:
                for key, idxs in concept_to_indices.items():
                    if key in concept or concept in key:
                        for idx in idxs:
                            if idx not in candidate_pool:
                                candidate_pool.append(idx)
                                if len(candidate_pool) >= 2:
                                    break
                    if len(candidate_pool) >= 2:
                        break
        if len(candidate_pool) < 2:
            # Final fallback: pad from the slide map's lowest indices.
            for idx in sorted(slide_index_set):
                if idx not in candidate_pool:
                    candidate_pool.append(idx)
                if len(candidate_pool) >= 2:
                    break
        return sorted(set(candidate_pool[:max(2, len(candidate_pool))]))

    out: List[Dict[str, Any]] = []
    for i, item in enumerate(parsed):
        if not isinstance(item, dict):
            continue
        validated = await validate_and_regenerate(
            item,
            lambda i=i, item=item: _get_regen_for(i, item),
            validator=_validator,
        )
        if use_cross:
            cleaned = coerce_linked_slides(validated.get("linked_slides"))
            if slide_index_set:
                cleaned = [c for c in cleaned if c in slide_index_set]
            if len(cleaned) < 2:
                # Validator + one regen failed. Repair deterministically so
                # the cross-slide contract (>= 2 linked slides) is never
                # violated downstream.
                repaired = _repair_linked_slides(validated)
                if len(repaired) >= 2:
                    logger.info(
                        "Repaired linked_slides for cross-slide question "
                        "%d (LLM gave %s → using %s).",
                        i, validated.get("linked_slides"), repaired,
                    )
                    cleaned = repaired
                else:
                    logger.warning(
                        "Could not repair linked_slides for question %d; "
                        "dropping it from the deck quiz.", i,
                    )
                    continue
            validated["linked_slides"] = cleaned
        out.append(validated)
    return out


async def batch_analyze_text_slides(
    slides: List[Dict[str, Any]],
    ai_model: str = "groq",
    blueprint: Optional[Dict] = None,
) -> List[Dict[str, Any]]:
    """
    Analyzes a batch of slides in a SINGLE LLM call (true batching).

    All slides are packed into one prompt → one API request for N slides.
    Uses BULK_CHAIN so the scarce Groq 70B quota is preserved for blueprints.
    """
    from backend.services.ai.prompts import BATCH_SLIDE_PROMPT

    if not slides:
        return []

    # Blueprint header — injected once at the top, not per slide
    bp_header   = ""
    idx_to_plan: Dict[int, Dict] = {}
    if blueprint:
        bp_title   = blueprint.get("lecture_title", "")
        bp_summary = blueprint.get("overall_summary", "")
        if bp_title or bp_summary:
            bp_header = (
                f"\n\nLECTURE MASTER PLAN:\nTitle: {bp_title}\n"
                f"Summary: {bp_summary[:800]}\n"
            )
        idx_to_plan = {p["index"]: p for p in blueprint.get("slide_plans", [])}

    # Build === SLIDE N === sections. Slides flagged ``context_only`` are
    # carried over from a previous overlapping window — they exist purely so
    # the LLM can resolve back-references like "this method" / "as shown
    # earlier" without us having to expand the active batch. We must NOT
    # generate questions for them, and we drop any returned object whose
    # index lands in ``context_only_indices`` below.
    context_only_indices = {s["index"] for s in slides if s.get("context_only")}
    slide_sections: List[str] = []
    for s in slides:
        body = s["text"] or "(no extracted text)"
        plan = idx_to_plan.get(s["index"])
        if plan:
            proposed = plan.get("proposed_title", "")
            concepts = ", ".join(plan.get("concepts", [])[:4])
            body = f"[Proposed title: {proposed}] [Key concepts: {concepts}]\n" + body
        section = f"=== SLIDE {s['page_number']} (index={s['index']}) ===\n{body}"
        if s.get("context_only"):
            section = f"<context_only>\n{section}\n</context_only>"
        slide_sections.append(section)

    context_header = ""
    if context_only_indices:
        context_header = (
            "\n\nIMPORTANT: Slides wrapped in <context_only>...</context_only> "
            "are provided ONLY so you can resolve references in the other "
            "slides. Do NOT generate a question for any slide inside a "
            "<context_only> block; omit them from your JSON array entirely.\n"
        )

    full_prompt = (
        BATCH_SLIDE_PROMPT + bp_header + context_header + "\n\n"
        + "\n\n".join(slide_sections)
    )

    # Single LLM call via BULK chain
    try:
        from backend.services.llm_client import call_llm
        raw = await call_llm(
            lambda: _generate_with_rotation(full_prompt, BULK_CHAIN)
        )
    except Exception as exc:
        logger.error("Bulk batch call failed: %s", exc)
        return [
            {
                "index": s["index"], "title": f"Slide {s['index']+1}",
                "content": s["text"], "summary": "", "questions": [],
                "slide_type": "content_slide", "parse_error": str(exc),
            }
            for s in slides if s["index"] not in context_only_indices
        ]

    parsed = parse_json_response(raw)
    if isinstance(parsed, dict):
        parsed = [parsed]

    # Only the non-context (active) slides should appear in the output.
    active_slides = [s for s in slides if s["index"] not in context_only_indices]
    page_to_idx = {s["page_number"]: s["index"] for s in active_slides}
    results: List[Dict] = []

    # When there are context slides we cannot trust positional alignment:
    # a misbehaving model might include a context entry and drop an active
    # one while still returning a list of equal length, which would silently
    # attach context content to an active index. Force the page_number-keyed
    # branch in that case so context entries get filtered out.
    if (
        isinstance(parsed, list)
        and len(parsed) == len(active_slides)
        and not context_only_indices
    ):
        for s, item in zip(active_slides, parsed):
            if isinstance(item, dict):
                item["index"] = s["index"]
                results.append(item)
            else:
                results.append({"index": s["index"], "title": f"Slide {s['index']+1}",
                                 "content": s["text"], "parse_error": "bad_item"})
    elif isinstance(parsed, list):
        for item in parsed:
            if not isinstance(item, dict):
                continue
            idx = page_to_idx.get(item.get("page_number"))
            if idx is not None:
                item["index"] = idx
                results.append(item)
        # Drop any LLM-emitted entries for context-only slides (the prompt
        # forbids them, but defensively filter in case the model misbehaves).
        results = [r for r in results if r["index"] not in context_only_indices]
        found = {r["index"] for r in results}
        for s in active_slides:
            if s["index"] not in found:
                logger.warning("Slide %d missing from batch response — using fallback", s["index"])
                results.append({"index": s["index"], "title": f"Slide {s['index']+1}",
                                 "content": s["text"], "summary": "", "questions": []})
    else:
        results = [{"index": s["index"], "title": f"Slide {s['index']+1}",
                    "content": s["text"], "summary": "", "questions": []}
                   for s in active_slides]

    # Validate the per-slide MCQ. To honour the one-shot regenerate contract
    # for per-slide quizzes too — without burning N extra LLM calls — we
    # collect every failing slide and re-prompt them together in a single
    # follow-up batch call. That keeps cost bounded at O(2 calls per upload)
    # while still letting us replace the worst MCQs (duplicate options,
    # all/none-of-the-above, missing answers) with cleaner ones.
    from backend.services.ai.quiz_validator import validate_mcq

    failing: List[Tuple[int, Dict[str, Any]]] = []  # (results-list pos, slide row)
    for pos, r in enumerate(results):
        questions = r.get("questions") if isinstance(r, dict) else None
        if not isinstance(questions, list) or not questions:
            continue
        q0 = questions[0]
        ok, reason = validate_mcq(q0) if isinstance(q0, dict) else (False, "not a dict")
        if not ok:
            logger.info(
                "Slide %s quiz failed validation (%s); will re-prompt in batch.",
                r.get("index"), reason,
            )
            failing.append((pos, r))

    if failing:
        await _regenerate_failing_slide_quizzes(failing, slides, idx_to_plan)

    return results


async def _regenerate_failing_slide_quizzes(
    failing: List[Tuple[int, Dict[str, Any]]],
    slides: List[Dict[str, Any]],
    idx_to_plan: Dict[int, Dict],
) -> None:
    """One batched LLM retry for per-slide quizzes that failed validation.

    Mutates ``failing``'s result dicts in place when the regenerated
    question validates, otherwise keeps the original (one-retry contract).
    Cost is bounded at +1 call per upload regardless of failure count.
    """
    from backend.services.ai.prompts import BATCH_SLIDE_QUIZ_REGEN_PROMPT
    from backend.services.ai.quiz_validator import validate_mcq

    pn_to_slide = {s["page_number"]: s for s in slides}

    # Compact regen prompt: failing slides' text + planner concepts, marked
    # with === SLIDE N === so the LLM can echo page_number back.
    sections: List[str] = []
    failing_pages: List[int] = []
    for _pos, r in failing:
        idx = r.get("index")
        slide_row = next((s for s in slides if s["index"] == idx), None)
        if slide_row is None:
            continue
        page = slide_row["page_number"]
        failing_pages.append(page)
        body = slide_row["text"] or "(no extracted text)"
        plan = idx_to_plan.get(idx) or {}
        proposed = plan.get("proposed_title") or r.get("title") or ""
        concepts = ", ".join(plan.get("concepts", [])[:4])
        header_bits = []
        if proposed:
            header_bits.append(f"Proposed title: {proposed}")
        if concepts:
            header_bits.append(f"Key concepts: {concepts}")
        header = f"[{' | '.join(header_bits)}]\n" if header_bits else ""
        sections.append(f"=== SLIDE {page} ===\n{header}{body}")

    if not sections:
        return

    full_prompt = BATCH_SLIDE_QUIZ_REGEN_PROMPT + "\n\n" + "\n\n".join(sections)

    try:
        from backend.services.llm_client import call_llm
        raw = await call_llm(
            lambda: _generate_with_rotation(full_prompt, BULK_CHAIN)
        )
    except Exception as exc:
        logger.warning(
            "Per-slide quiz regeneration batch failed (%s); keeping originals.",
            exc,
        )
        return

    parsed = parse_json_response(raw)
    if isinstance(parsed, dict):
        parsed = [parsed]
    if not isinstance(parsed, list):
        logger.info(
            "Per-slide quiz regeneration produced no usable list; keeping originals.",
        )
        return

    # Index by page_number when present; fall back to positional alignment.
    by_page: Dict[int, Dict[str, Any]] = {}
    leftover: List[Dict[str, Any]] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        page = item.get("page_number")
        if isinstance(page, int) and page in pn_to_slide:
            by_page[page] = item
        else:
            leftover.append(item)

    replaced = 0
    for (pos, r), page in zip(failing, failing_pages):
        new_item = by_page.get(page)
        if new_item is None and leftover:
            new_item = leftover.pop(0)
        if not isinstance(new_item, dict):
            continue
        new_qs = new_item.get("questions")
        if not isinstance(new_qs, list) or not new_qs:
            continue
        new_q0 = new_qs[0]
        if not isinstance(new_q0, dict):
            continue
        # One-retry contract (matches validate_and_regenerate): accept the
        # regen result as-is even if it's still imperfect — we promised one
        # regeneration, not infinite quality. Validation is just informational.
        ok, _reason = validate_mcq(new_q0)
        if not ok:
            logger.info(
                "Per-slide quiz regen for slide %s still failed validation "
                "(%s); accepting per one-retry contract.",
                page, _reason,
            )
        r["questions"] = [new_q0]
        replaced += 1

    if replaced:
        logger.info(
            "Per-slide quiz regeneration: replaced %d/%d failing slide "
            "quizzes via single batched retry.",
            replaced, len(failing),
        )


# ---------------------------------------------------------------------------
# Legacy aliases
# ---------------------------------------------------------------------------
_llm_generate_text = _llm_generate_text_sync
generate_summary   = generate_deck_summary
generate_quiz      = generate_deck_quiz
generate_slide_title = lambda t: process_slide_batch(t).get("title", "Untitled")
