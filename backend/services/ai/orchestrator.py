"""
Multi-provider LLM orchestrator with automatic failover.

Provider chain (rate-limit data: github.com/cheahjs/free-llm-api-resources):

  ID            Model                       Daily req   TPM      Notes
  ──────────────────────────────────────────────────────────────────────
  cerebras      gpt-oss-120b                 14,400      60,000   OUT OF CHAINS (402 billing, 2026-10-10)
  groq_fast     llama-3.1-8b-instant        14,400       6,000   Fast fallback
  gemma         gemma-3-27b-it              14,400      15,000   Google SDK
  mistral       mistral-small-latest        ~unlimited  500,000  Needs phone verify
  openrouter    gpt-oss-20b:free                50          —    50/day free; 1K/day w/ $10
  cloudflare    llama-3.3-70b               10,000          —    Workers AI free tier
  gemini        gemini-2.0-flash             ~1,500     250,000  Google SDK
  groq          llama-3.3-70b-versatile      1,000      12,000   Quality; conserved for blueprints
  ──────────────────────────────────────────────────────────────────────

Two chains:
  BULK_CHAIN    — slide text analysis (high volume, use capacity-first)
  QUALITY_CHAIN — blueprints / planning (low volume, quality-first)

Required env vars (add what you have; missing keys disable that provider gracefully):
  CEREBRAS_API_KEY      https://cloud.cerebras.ai          (unused while out of the chains)
  GROQ_API_KEY          https://console.groq.com
  GEMINI_API_KEY        https://aistudio.google.com/apikey
  OPENROUTER_API_KEY    https://openrouter.ai/keys
  CLOUDFLARE_API_TOKEN  https://dash.cloudflare.com/profile/api-tokens
  CLOUDFLARE_ACCOUNT_ID https://dash.cloudflare.com (URL of any Cloudflare page)
  MISTRAL_API_KEY       https://console.mistral.ai  (requires phone)
"""

import os
import logging
import json
import re
import datetime
import threading
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Dict, Iterator, List, Optional, Tuple
from pathlib import Path
from dotenv import load_dotenv

if TYPE_CHECKING:
    # Runtime imports of LLMUsage stay function-local (see _call_google etc.).
    from backend.services.ai.cost import LLMUsage

logger = logging.getLogger(__name__)


_ROOT_ENV = Path(__file__).resolve().parent.parent.parent.parent / ".env"
_BACKEND_ENV = Path(__file__).resolve().parent.parent.parent / ".env"


def _init_env(root: Path = _ROOT_ENV, backend: Path = _BACKEND_ENV) -> None:
    """Fill in variables the process doesn't already have; never overwrite.

    backend/.env is read first so it still wins over the root .env (as it did
    when both were loaded with override=True, root first). What the process
    already has always wins: with override=True, importing this module put
    .env values over a caller's DATABASE_URL, including tests/conftest.py's
    guard DSN and a harness's blanked one, which then wrote to production.
    Docker images carry no .env (see .dockerignore), so this only affects
    local runs."""
    for path in (backend, root):
        if path.exists():
            load_dotenv(dotenv_path=path, override=False)

_init_env()

# ---------------------------------------------------------------------------
# Standalone model constants (not part of the failover chains)
# ---------------------------------------------------------------------------
# The chain providers' model ids live in PROVIDER_REGISTRY below, and the
# GEMINI_MODEL / GROQ_MODEL / GROQ_FAST_MODEL / CEREBRAS_MODEL aliases are
# derived from it right after. Only the two ids that have no registry entry
# are defined here.
OLLAMA_MODEL      = "llama3"

# Groq no longer serves ANY vision model — llama-3.2-11b-vision-preview was
# decommissioned (Apr 2026) and its replacement
# meta-llama/llama-4-scout-17b-16e-instruct now 404s too; Groq's current
# catalogue is text-only, and the remaining models reject the multi-part
# `content` array a vision request needs with a 400. Set GROQ_VISION_MODEL in
# the environment to re-enable that leg if Groq ships vision again; while it
# is None, vision.py does not offer groq as a vision provider at all.
GROQ_VISION_MODEL = os.environ.get("GROQ_VISION_MODEL") or None

# ---------------------------------------------------------------------------
# Provider mode
# ---------------------------------------------------------------------------
# AI_PROVIDER_MODE=openai_only runs every text, vision and embedding call on
# the one paid OpenAI account: both chains collapse to ["openai"], the
# user-facing model picker is ignored, and vision/embeddings skip Google.
# "multi" (the default) keeps the free-tier failover chains below, so dev
# without an OpenAI key keeps working. main.py and the Arq worker refuse to
# boot in openai_only while any other provider key is set (see
# assert_provider_mode), so nothing can silently fall back to a free tier.
AI_PROVIDER_MODE = (os.environ.get("AI_PROVIDER_MODE") or "multi").strip().lower()
OPENAI_ONLY = AI_PROVIDER_MODE == "openai_only"

# OPENAI_MODEL serves the quality chain (tutor, quizzes, summaries);
# OPENAI_BULK_MODEL serves the high-volume per-slide bulk chain and defaults
# to the same model, so setting only OPENAI_MODEL behaves exactly as before.
OPENAI_QUALITY_MODEL = os.environ.get("OPENAI_MODEL") or "gpt-4o-mini"
OPENAI_BULK_MODEL = os.environ.get("OPENAI_BULK_MODEL") or OPENAI_QUALITY_MODEL
OPENAI_VISION_MODEL = os.environ.get("OPENAI_VISION_MODEL") or OPENAI_QUALITY_MODEL
# When the bulk and vision tier models were last confirmed live (one real
# call each — gpt-4.1-nano text, gpt-4.1-mini with an image). Same 45-day rule
# as every registry pin (test_provider_pin_freshness): re-probe, never re-date.
OPENAI_TIER_MODELS_VERIFIED_ON = datetime.date(2026, 10, 11)

# Keys whose presence in openai_only mode means some leg could still reach a
# provider other than OpenAI.
_NON_OPENAI_KEY_VARS = (
    "GROQ_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "CEREBRAS_API_KEY",
    "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "CLOUDFLARE_API_TOKEN",
)


def assert_provider_mode() -> None:
    """Fail fast when AI_PROVIDER_MODE=openai_only is not actually true.

    Called at API and worker startup. Raises RuntimeError naming the stray
    keys (never their values) so a misconfigured deploy refuses to boot
    instead of quietly sending student data to a provider the privacy policy
    does not name.
    """
    if not OPENAI_ONLY:
        return
    stray = [v for v in _NON_OPENAI_KEY_VARS if (os.environ.get(v) or "").strip()]
    if stray:
        raise RuntimeError(
            "AI_PROVIDER_MODE=openai_only but other provider keys are set: "
            f"{', '.join(stray)}. Remove them from the environment."
        )
    if not (os.environ.get("OPENAI_API_KEY") or "").strip():
        raise RuntimeError("AI_PROVIDER_MODE=openai_only but OPENAI_API_KEY is not set.")

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
        bs = int(os.environ.get("QUIZ_BATCH_SIZE", "8"))
    except (TypeError, ValueError):
        bs = 8
    try:
        ov = int(os.environ.get("QUIZ_BATCH_OVERLAP", "1"))
    except (TypeError, ValueError):
        ov = 1
    if bs < 1:
        logger.warning("QUIZ_BATCH_SIZE %d invalid, falling back to 8", bs)
        bs = 8
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
    # Last date someone confirmed `model` is still served at this provider (a
    # real call, not "it was in the docs"). Providers retire slugs without
    # notice and the rotator just fails over, so a dead pin is otherwise
    # invisible. tests/unit/test_provider_pin_freshness.py fails once this is
    # older than PIN_MAX_AGE_DAYS — re-probe and bump it, or swap the slug.
    verified_on: datetime.date
    uses_google_sdk: bool = False
    # For a leg nobody CAN verify right now (no API key, account issue): why,
    # and when that was last confirmed. Exempts verified_on from the age check,
    # but expires after PIN_MAX_AGE_DAYS itself so the exemption gets
    # re-confirmed rather than forgotten. Set both or neither.
    unverifiable_reason: Optional[str] = None
    unverifiable_noted_on: Optional[datetime.date] = None


# How old a verified_on (or unverifiable_noted_on) may get before the unit
# test goes red. Only legs a call can reach are checked — see the test.
PIN_MAX_AGE_DAYS = 45


# Order within this list is irrelevant; chains below define priority.
PROVIDER_REGISTRY: Dict[str, ProviderConfig] = {
    p.id: p for p in [
        ProviderConfig(
            # Cerebras GPT-OSS 120B. REMOVED FROM BOTH CHAINS and from
            # _USER_MODEL_TO_PROVIDER on 2026-10-10: the account answers
            # 402 payment_required, and as the head of both chains every call
            # paid a failed round-trip first. Kept registered so re-enabling is
            # a re-probe plus putting "cerebras" back in the chains and the map.
            id="cerebras",
            model="gpt-oss-120b",
            verified_on=datetime.date(2026, 6, 5),
            daily_limit=14_400, rpm=30, tpm=60_000,
            env_var="CEREBRAS_API_KEY",
            base_url="https://api.cerebras.ai/v1",
        ),
        ProviderConfig(
            # `llama-3.1-8b-instant` was retired by Groq (verified 404, Sep
            # 2026) along with every other llama slug. `openai/gpt-oss-20b` is
            # the current small model on Groq's free tier and honors
            # response_format=json_object.
            id="groq_fast",
            model=os.environ.get("GROQ_FAST_MODEL") or "openai/gpt-oss-20b",
            verified_on=datetime.date(2026, 10, 10),
            daily_limit=14_400, rpm=30, tpm=6_000,
            env_var="GROQ_API_KEY",
            base_url="https://api.groq.com/openai/v1",
        ),
        ProviderConfig(
            # Google retires dated Gemini slugs aggressively — `gemini-2.0-flash-lite`
            # 404s with "no longer available". The floating `-latest` alias
            # tracks the current lite flash model, which is the whole point
            # here: this leg is the cheap bulk workhorse, not a model we need
            # pinned for reproducibility.
            id="gemma",
            model=os.environ.get("GEMMA_MODEL") or "gemini-flash-lite-latest",
            verified_on=datetime.date(2026, 10, 10),
            daily_limit=14_400, rpm=30, tpm=15_000,
            env_var="GEMINI_API_KEY",
            base_url=None,
            uses_google_sdk=True,
        ),
        ProviderConfig(
            id="mistral",
            model="mistral-small-latest",
            verified_on=datetime.date(2026, 5, 2),
            unverifiable_reason="no MISTRAL_API_KEY configured; leg is disabled at runtime while keyless",
            unverifiable_noted_on=datetime.date(2026, 10, 10),
            daily_limit=0, rpm=60, tpm=500_000,
            env_var="MISTRAL_API_KEY",
            base_url="https://api.mistral.ai/v1",
        ),
        ProviderConfig(
            # OpenRouter retires `:free` variants without notice — the previous
            # default (`meta-llama/llama-3.3-70b-instruct:free`) started 404ing
            # with "This model is unavailable for free. The paid version is
            # available now". `openai/gpt-oss-20b:free` is the current free slug
            # (131k context, honors response_format=json_object, same family as
            # the cerebras primary). Env-overridable so the next retirement is a
            # config change, not a code change.
            id="openrouter",
            # `or` not a get() default: .env.example ships the key blank, and an
            # empty string would otherwise be sent to the API as the model id.
            # `openai/gpt-oss-20b:free` was itself withdrawn ("unavailable for
            # free") — the third retirement on this leg, hence the env override.
            # Nemotron Lightning is the current free slug that both answers and
            # honors response_format=json_object; several other `:free` models
            # (qwen3.8, glm-5.2) are listed but 429 immediately upstream.
            model=os.environ.get("OPENROUTER_MODEL") or "nvidia/nemotron-3.5-lightning:free",
            verified_on=datetime.date(2026, 10, 10),
            daily_limit=50, rpm=20, tpm=0,
            env_var="OPENROUTER_API_KEY",
            base_url="https://openrouter.ai/api/v1",
        ),
        ProviderConfig(
            # Cloudflare Workers AI is OpenAI-compatible at
            # /accounts/{account_id}/ai/v1. The account ID is appended to
            # the base URL at client-init time (see _make_cloudflare_client).
            id="cloudflare",
            model="@cf/meta/llama-3.3-70b-instruct-fp8-fast",
            verified_on=datetime.date(2026, 5, 2),
            unverifiable_reason="no CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID configured; leg is disabled at runtime while keyless",
            unverifiable_noted_on=datetime.date(2026, 10, 10),
            daily_limit=10_000, rpm=300, tpm=0,
            env_var="CLOUDFLARE_API_TOKEN",
            base_url="https://api.cloudflare.com/client/v4/accounts",
        ),
        ProviderConfig(
            # `gemini-2.0-flash` 404s ("no longer available"). Prefer the
            # floating alias over a pinned successor: pinned `gemini-3.5-flash`
            # answered 503 "high demand" during the Sep 2026 audit, while
            # `gemini-flash-latest` served fine.
            id="gemini",
            model=os.environ.get("GEMINI_MODEL") or "gemini-flash-latest",
            verified_on=datetime.date(2026, 10, 10),
            daily_limit=1_500, rpm=15, tpm=250_000,
            env_var="GEMINI_API_KEY",
            base_url=None,
            uses_google_sdk=True,
        ),
        ProviderConfig(
            # Groq retired the whole llama-3.x line; `llama-3.3-70b-versatile`
            # 404s. `openai/gpt-oss-120b` is the current large model on Groq's
            # free tier. Note it is a reasoning model: it spends tokens on a
            # `reasoning` field before `content`, so callers that cap
            # max_tokens too low get an empty string back with
            # finish_reason="length". We send no max_tokens (provider default),
            # so this is safe here — but see prompts that set their own.
            id="groq",
            model=os.environ.get("GROQ_MODEL") or "openai/gpt-oss-120b",
            verified_on=datetime.date(2026, 10, 10),
            daily_limit=1_000, rpm=30, tpm=12_000,
            env_var="GROQ_API_KEY",
            base_url="https://api.groq.com/openai/v1",
        ),
        ProviderConfig(
            # OpenAI-compatible provider. model + base_url are env-overridable
            # so the same path serves OpenAI now and a self-hosted university
            # LLM later (any OpenAI-compatible endpoint) by changing env only.
            id="openai",
            # `or` rather than a get() default, so a key that is present but
            # blank in .env falls back instead of being sent to the API.
            model=OPENAI_QUALITY_MODEL,
            verified_on=datetime.date(2026, 10, 10),
            daily_limit=0, rpm=60, tpm=100000,
            env_var="OPENAI_API_KEY",
            base_url=os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1",
        ),
    ]
}

# ---------------------------------------------------------------------------
# Backward-compat model-name constants (used by vision.py and other callers)
# ---------------------------------------------------------------------------
# Derived from PROVIDER_REGISTRY above so there is exactly one place a model
# id is chosen. These used to be separate literals and silently drifted out of
# sync with the registry as providers retired models underneath them — a Sep
# 2026 audit found GEMINI_MODEL and GROQ_MODEL still naming retired models.
GEMINI_MODEL    = PROVIDER_REGISTRY["gemini"].model
GROQ_MODEL      = PROVIDER_REGISTRY["groq"].model
GROQ_FAST_MODEL = PROVIDER_REGISTRY["groq_fast"].model
CEREBRAS_MODEL  = PROVIDER_REGISTRY["cerebras"].model


# ---------------------------------------------------------------------------
# Failover chains
# ---------------------------------------------------------------------------

# cerebras is out of both chains (402 billing, 2026-10-10) — see its registry entry.

# Bulk slide processing: highest daily capacity first; Groq 70B last (conserve quota)
BULK_CHAIN:    List[str] = ["groq_fast", "cloudflare", "gemma", "mistral", "openrouter", "gemini", "groq", "openai"]

# Blueprint / planning / deck summaries: quality-first. Groq's gpt-oss-120b
# leads now that Cerebras (same model, previously the head) is out.
QUALITY_CHAIN: List[str] = ["groq", "openrouter", "cloudflare", "gemini", "mistral", "groq_fast", "gemma", "openai"]

if OPENAI_ONLY:
    BULK_CHAIN = ["openai"]
    QUALITY_CHAIN = ["openai"]


def _model_for(provider_id: str, tier: str) -> str:
    """The model a provider serves for a chain tier ("quality" or "bulk").

    Only openai distinguishes tiers; every other provider has one model.
    """
    if provider_id == "openai" and tier == "bulk":
        return OPENAI_BULK_MODEL
    return PROVIDER_REGISTRY[provider_id].model

# Maps the user-facing ai_model string (sent from the frontend) to the
# orchestrator's internal provider id. Values that don't map fall back to
# the chain's natural head.
#
# "cerebras" is deliberately absent (2026-10-10): it is the app-wide default
# ai_model, and _chain_with_preferred INSERTS a preferred provider even when it
# is not in the chain — so mapping it would put the 402ing leg back at the
# front of every call. Unmapped, "cerebras" now means "natural chain head".
_USER_MODEL_TO_PROVIDER: Dict[str, str] = {
    "groq":              "groq",
    "groq_fast":         "groq_fast",
    "openrouter":        "openrouter",
    "cloudflare":        "cloudflare",
    "gemini":            "gemini",
    "gemini-2.0-flash":  "gemini",
    "gemini-1.5-flash":  "gemini",
    "gemini-2.5-flash":  "gemini",
    "gemma":             "gemma",
    "mistral":           "mistral",
    "openai":            "openai",
    "gpt-4o-mini":       "openai",
}


def _resolve_preferred(ai_model: Optional[str]) -> Optional[str]:
    """Map a user-facing model selection to a provider id, or None."""
    if OPENAI_ONLY:
        # _chain_with_preferred would INSERT any other preference into the
        # one-leg chain, so a stale "gemini" picker value must not survive.
        return "openai"
    if not ai_model or ai_model.lower() == "auto":
        from backend.core.config import settings
        ai_model = settings.parser_llm_model or "cerebras"
    return _USER_MODEL_TO_PROVIDER.get(ai_model.lower())


def _chain_with_preferred(chain: List[str], preferred: Optional[str]) -> List[str]:
    """Return ``chain`` with ``preferred`` moved to (or inserted at) the front.

    If ``preferred`` is a valid registered provider it is promoted to position 0
    regardless of whether it already appears in ``chain``. This ensures that a
    user-selected provider (e.g. openai) is always tried first even if the
    default chain doesn't include it.
    """
    if not preferred or preferred not in PROVIDER_REGISTRY:
        return chain
    rest = [p for p in chain if p != preferred]
    return [preferred, *rest]

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
    import httpx as _httpx
except ImportError:
    _httpx = None

# Bounded HTTP config shared by every OpenAI-compatible provider client.
# Without this the OpenAI SDK defaults to a 600s timeout and an unbounded
# connection pool: a slow/hung provider would keep an executor thread parked
# for up to 10 minutes (call_llm's asyncio timeout cancels the awaiter, not the
# underlying blocking thread), leaking threadpool capacity under load. read=120s
# is a hard backstop well above the app-level LLM_TIMEOUT_SECONDS (25–90s).
_LLM_HTTP_LIMITS = None
_LLM_HTTP_TIMEOUT = None
if _httpx is not None:
    _LLM_HTTP_LIMITS = _httpx.Limits(max_connections=20, max_keepalive_connections=10)
    _LLM_HTTP_TIMEOUT = _httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)


def _bounded_http_client():
    """A sync httpx client with bounded timeout + pool for OpenAI-compatible
    clients. Returns None when httpx is unavailable (falls back to SDK defaults)."""
    if _httpx is None:
        return None
    return _httpx.Client(limits=_LLM_HTTP_LIMITS, timeout=_LLM_HTTP_TIMEOUT)

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
        http_client = _bounded_http_client()
        if http_client is not None:
            extra["http_client"] = http_client
        return _OpenAI(api_key=key, base_url=base_url, max_retries=0, **extra)
    except Exception as exc:
        logger.debug("Could not init client for %s: %s", env_var, exc)
        return None


def _make_cloudflare_client() -> Optional[Any]:
    """Cloudflare Workers AI requires both an API token AND an account id —
    the OpenAI-compatible base URL is /accounts/{account_id}/ai/v1.
    Returns None if either env var is missing.
    """
    if _OpenAI is None:
        return None
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    if not token or len(token) < 8 or not account_id:
        return None
    try:
        cf_extra = {}
        http_client = _bounded_http_client()
        if http_client is not None:
            cf_extra["http_client"] = http_client
        return _OpenAI(
            api_key=token,
            base_url=f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
            max_retries=0,
            **cf_extra,
        )
    except Exception as exc:
        logger.debug("Could not init Cloudflare Workers AI client: %s", exc)
        return None


# Build clients at startup; None means provider is disabled (key not set)
_clients: Dict[str, Optional[Any]] = {}
for _cfg in PROVIDER_REGISTRY.values():
    if _cfg.uses_google_sdk:
        _clients[_cfg.id] = _google_client   # shared Google client for gemini + gemma
    elif _cfg.id == "cloudflare":
        _clients[_cfg.id] = _make_cloudflare_client()
    elif _cfg.base_url:
        _clients[_cfg.id] = _make_openai_client(_cfg.env_var, _cfg.base_url)

# Backward-compat module-level references (used by vision.py and other callers)
try:
    from groq import Groq as _GroqSDK
    _g_key = os.environ.get("GROQ_API_KEY", "")
    groq_client = _GroqSDK(api_key=_g_key, max_retries=0) if len(_g_key) > 20 else None
except Exception:
    groq_client = None

cerebras_client   = _clients.get("cerebras")
openrouter_client = _clients.get("openrouter")
cloudflare_client = _clients.get("cloudflare")
openai_client     = _clients.get("openai")  # OpenAI-compatible; used for vision too
gemini_client     = _google_client
ollama            = _ollama_lib

# ---------------------------------------------------------------------------
# Provider rotator — daily budget + backoff tracking
# ---------------------------------------------------------------------------

class ProviderRotator:
    """
    Thread-safe tracker of daily request counts and temporary 429 backoffs.
    Skips providers that have hit their daily limit or are in backoff window.
    Resets counts at UTC midnight.

    Counts are per-process in-memory (fast, lock-protected) but mirrored to
    Redis (Roadmap P1-1) so the fleet as a whole shares one daily budget
    instead of each worker independently thinking it has the full quota:
      - `refresh_from_redis()` pulls other processes' counts + openai's
        fleet-wide daily cost into this process's view before a call.
      - `flush_success_to_redis()` / `flush_openai_cost_to_redis()` push this
        process's increments back after a call.
    Both are best-effort — a Redis outage degrades to the pre-P1-1
    per-process behavior rather than breaking LLM calls.
    """

    def __init__(self) -> None:
        self._lock          = threading.Lock()
        self._counts:  Dict[str, int]   = {}
        self._backoff: Dict[str, float] = {}
        self._streak:  Dict[str, int]   = {}
        self._disabled: Dict[str, str]  = {}   # provider_id -> reason
        self._day:     str              = datetime.date.today().isoformat()
        self._openai_daily_cost_usd: float = 0.0

    def _reset_if_new_day(self) -> None:
        today = datetime.date.today().isoformat()
        if today != self._day:
            self._day     = today
            self._counts  = {}
            self._backoff = {}
            self._streak  = {}
            self._openai_daily_cost_usd = 0.0
            # `_disabled` is deliberately NOT cleared: it holds providers whose
            # configured model no longer exists upstream, which midnight does
            # not fix. Only a process restart (picking up a corrected model id)
            # clears it.

    def record_success(self, provider_id: str) -> None:
        with self._lock:
            self._reset_if_new_day()
            self._counts[provider_id] = self._counts.get(provider_id, 0) + 1
            self._streak[provider_id] = 0

    def record_rate_limit(self, provider_id: str, backoff_seconds: float = 90.0) -> None:
        with self._lock:
            streak = self._streak.get(provider_id, 0) + 1
            self._streak[provider_id] = streak
            # Exponential backoff: 90s, 180s, 360s, … capped at 600s.
            scaled = min(backoff_seconds * (2 ** (streak - 1)), 600.0)
            self._backoff[provider_id] = time.monotonic() + scaled
        logger.warning(
            "🔄 Provider '%s' rate-limited — backing off %.0fs (streak=%d)",
            provider_id, scaled, streak,
        )

    def record_unavailable(self, provider_id: str, reason: str) -> None:
        """Permanently disable a provider for this process.

        Unlike `record_rate_limit`'s timed backoff, this is for failures that
        no amount of waiting fixes — chiefly a 404 saying the configured model
        id no longer exists at that provider. Without it, a retired model slug
        re-fires a doomed HTTP request on every single call once the ≤600s
        backoff lapses (and again after every UTC-midnight reset).
        """
        with self._lock:
            already = provider_id in self._disabled
            self._disabled[provider_id] = reason
        if not already:
            logger.error(
                "⛔ Provider '%s' disabled for this process: %s", provider_id, reason
            )

    def is_disabled(self, provider_id: str) -> bool:
        """True if `provider_id` was permanently disabled this process.

        Public counterpart to `available()` for callers whose provider ids are
        not in PROVIDER_REGISTRY — chiefly the vision path, whose
        "groq_vision"/"gemini_vision"/"openai_vision" ids are tracked here for
        backoff but have no registry entry, so `available()` would report them
        as unknown rather than answering the question asked.
        """
        with self._lock:
            return provider_id in self._disabled

    def available(self, chain: List[str]) -> List[str]:
        """
        Returns the subset of `chain` that is currently usable, in order.

        Two classes of gate, and the difference matters:

        * HARD gates — unknown provider, permanently disabled by
          `record_unavailable`, no configured client, or (for openai) the
          fleet-wide daily cost ceiling. These describe calls that either
          cannot succeed or must not be made. Nothing relaxes them.
        * SOFT gates — daily request limit and 429 backoff windows. These are
          local *estimates* that can be stale (another process may have reset,
          a backoff may be over-cautious), so if every candidate is filtered
          out by a soft gate we return the hard-eligible set anyway and let
          the provider itself arbitrate.

        Returning `[]` is a real answer meaning "every leg is disabled,
        keyless, or over budget" — callers must treat it as such rather than
        falling back to the raw chain, which would re-admit exactly the
        providers the hard gates just excluded. That fallback is how the
        openai cost ceiling used to be bypassable: once every other leg was
        disabled, `ok` came back empty and the old `last_ditch` list handed
        openai straight back, uncapped.
        """
        now = time.monotonic()
        with self._lock:
            self._reset_if_new_day()
            ok: List[str] = []
            hard_eligible: List[str] = []
            skipped: List[str] = []
            for pid in chain:
                cfg = PROVIDER_REGISTRY.get(pid)
                if cfg is None:
                    skipped.append(f"{pid}=unknown")
                    continue
                if pid in self._disabled:
                    skipped.append(f"{pid}=disabled({self._disabled[pid]})")
                    continue
                if _clients.get(pid) is None and not (pid == "groq" and groq_client):
                    skipped.append(f"{pid}=no_client")
                    continue
                if pid == "openai":
                    from backend.core.config import settings
                    ceiling = settings.llm_openai_daily_cost_ceiling_usd
                    if ceiling > 0 and self._openai_daily_cost_usd >= ceiling:
                        skipped.append(
                            f"openai=daily_cost_ceiling(${self._openai_daily_cost_usd:.4f}/${ceiling:.2f})"
                        )
                        continue
                # Past every hard gate: this provider is callable in principle.
                hard_eligible.append(pid)

                limit = cfg.daily_limit
                used  = self._counts.get(pid, 0)
                if limit > 0 and used >= limit:
                    skipped.append(f"{pid}=daily_limit({used}/{limit})")
                    continue
                if now < self._backoff.get(pid, 0.0):
                    remaining = self._backoff[pid] - now
                    skipped.append(f"{pid}=backoff({remaining:.0f}s)")
                    continue
                ok.append(pid)
        if skipped:
            logger.info(
                "Provider availability: ok=%s skipped=[%s]",
                ok or "(none)", ", ".join(skipped),
            )
        # Soft gates only: if they excluded everything, try the hard-eligible
        # set anyway (a daily-limit or backoff estimate may be stale; a dead
        # model, a missing key or a blown cost ceiling is not).
        return ok or hard_eligible

    def remaining_headroom(self, chain: List[str]) -> int:
        """Sum of remaining daily quota across configured providers in `chain`.

        Used by callers (e.g. PDF import) to bail fast when a long-running job
        clearly cannot complete with today's remaining budget. Providers with
        ``daily_limit == 0`` (unmetered) contribute a large constant so they
        dominate the sum and effectively disable the gate.
        """
        with self._lock:
            self._reset_if_new_day()
            total = 0
            for pid in chain:
                cfg = PROVIDER_REGISTRY.get(pid)
                if cfg is None:
                    continue
                if _clients.get(pid) is None and not (pid == "groq" and groq_client):
                    continue
                if cfg.daily_limit <= 0:
                    total += 100_000
                else:
                    total += max(0, cfg.daily_limit - self._counts.get(pid, 0))
        return total

    async def refresh_from_redis(self, chain: List[str]) -> None:
        """Pull today's fleet-wide provider counts + openai's fleet-wide
        daily cost from Redis into this process's in-memory view. Best-
        effort: any Redis failure just leaves the in-memory state as-is."""
        from backend.services.ai.cost import (
            get_redis_or_none, provider_daily_count_key, openai_daily_cost_key,
        )
        redis = get_redis_or_none()
        if redis is None:
            return
        with self._lock:
            self._reset_if_new_day()
        try:
            for pid in chain:
                raw = await redis.get(provider_daily_count_key(pid))
                if raw is not None:
                    with self._lock:
                        self._counts[pid] = max(self._counts.get(pid, 0), int(raw))
            raw_cost = await redis.get(openai_daily_cost_key())
            if raw_cost is not None:
                with self._lock:
                    self._openai_daily_cost_usd = max(self._openai_daily_cost_usd, float(raw_cost))
        except Exception as exc:
            logger.debug("ProviderRotator.refresh_from_redis degraded to local state: %s", exc)

    async def flush_success_to_redis(self, provider_id: str) -> None:
        """Atomically increments this provider's fleet-wide daily count."""
        from backend.services.ai.cost import get_redis_or_none, provider_daily_count_key
        redis = get_redis_or_none()
        if redis is None:
            return
        try:
            key = provider_daily_count_key(provider_id)
            await redis.incr(key)
            await redis.expire(key, 2 * 86400)
        except Exception as exc:
            logger.debug("ProviderRotator.flush_success_to_redis failed for %s: %s", provider_id, exc)

    async def flush_openai_cost_to_redis(self, cost_usd: float) -> None:
        """Adds to openai's daily cost: always to this process's in-memory
        total, then best-effort to the fleet-wide Redis counter.

        The local add must not depend on Redis. A process with Redis down —
        or never initialised, which is every Arq worker (only main.py calls
        init_redis()) — used to skip it, so the ceiling in `available()`
        compared against a total stuck at $0 and never tripped.
        `refresh_from_redis` takes max(local, fleet), so this never
        double-counts.
        """
        with self._lock:
            self._reset_if_new_day()
            self._openai_daily_cost_usd += cost_usd
        from backend.services.ai.cost import get_redis_or_none, openai_daily_cost_key
        redis = get_redis_or_none()
        if redis is None:
            return
        try:
            key = openai_daily_cost_key()
            await redis.incrbyfloat(key, cost_usd)
            await redis.expire(key, 2 * 86400)
        except Exception as exc:
            logger.debug("ProviderRotator.flush_openai_cost_to_redis failed: %s", exc)


_rotator = ProviderRotator()


def get_rotator() -> ProviderRotator:
    return _rotator

# Keep old class name as alias for any direct references
_ProviderRotator = ProviderRotator

# ---------------------------------------------------------------------------
# Per-provider call implementations
# ---------------------------------------------------------------------------

# Providers that have, at some point in this process's life, rejected the
# `response_format={"type": "json_object"}` parameter (400/"unsupported" type
# errors). Once a provider lands here we stop asking it for JSON mode for the
# rest of the process — cheaper than re-discovering the failure every call,
# and safe because provider capability doesn't change mid-process.
_JSON_MODE_UNSUPPORTED: set = set()


def _usage_from_openai_compat(resp: Any) -> Optional["LLMUsage"]:
    """Extracts prompt/completion token counts from an OpenAI-compatible
    (and Groq-native, which mirrors the same schema) chat-completion
    response's ``.usage``. Returns None if the SDK didn't populate it."""
    from backend.services.ai.cost import LLMUsage
    u = getattr(resp, "usage", None)
    if u is None:
        return None
    return LLMUsage(
        prompt_tokens=getattr(u, "prompt_tokens", 0) or 0,
        completion_tokens=getattr(u, "completion_tokens", 0) or 0,
    )


def _call_openai_compat(
    client: Any,
    model: str,
    prompt: str,
    *,
    provider_id: Optional[str] = None,
    json_mode: bool = False,
) -> Tuple[str, Optional["LLMUsage"]]:
    """Unified caller for all OpenAI-compatible providers.

    Returns ``(text, usage)`` — usage is the token counts for cost
    accounting (Roadmap P1-1), or None if the SDK didn't report them.

    Foundation Roadmap P4-3: bulk/quality chains that parse the reply as JSON
    (`parse_json_response`) can pass ``json_mode=True`` to request the
    provider's native JSON-object response format, which removes a whole
    class of "model wrapped it in prose" / truncation-adjacent parse
    failures for free on providers that support it.

    Not every OpenAI-compatible free-tier endpoint honors `response_format`
    (some free-tier proxies 400 on unrecognized params). We optimistically
    ask for it, and if the provider rejects it we retry once WITHOUT the
    parameter and remember not to ask that provider again this process
    lifetime — see ``_JSON_MODE_UNSUPPORTED``. Errors unrelated to the param
    (auth, rate limit, network) are NOT swallowed here; they propagate so the
    existing rotation/backoff logic in ``_generate_with_rotation`` handles
    them as it always has.
    """
    use_json_mode = json_mode and provider_id not in _JSON_MODE_UNSUPPORTED
    kwargs: Dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
    }
    if use_json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    try:
        resp = client.chat.completions.create(**kwargs)
    except Exception as exc:
        if not use_json_mode:
            raise
        msg = str(exc).lower()
        looks_like_param_rejection = any(
            k in msg for k in (
                "response_format", "json_object", "json_schema",
                "unsupported", "not support", "unknown parameter",
                "unrecognized",
            )
        )
        if not looks_like_param_rejection:
            raise
        logger.warning(
            "Provider '%s' rejected response_format=json_object; retrying "
            "without JSON mode and disabling it for this provider for the "
            "rest of the process: %s",
            provider_id, exc,
        )
        if provider_id:
            _JSON_MODE_UNSUPPORTED.add(provider_id)
        kwargs.pop("response_format", None)
        resp = client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content or "", _usage_from_openai_compat(resp)


def _call_google(model: str, prompt: str) -> Tuple[str, Optional["LLMUsage"]]:
    """Caller for Google AI Studio (Gemini + Gemma models)."""
    from backend.services.ai.cost import LLMUsage
    if _google_client is None:
        raise RuntimeError("Google AI client not initialised (GEMINI_API_KEY missing)")
    resp = _google_client.models.generate_content(model=model, contents=prompt)
    u = getattr(resp, "usage_metadata", None)
    usage = None
    if u is not None:
        usage = LLMUsage(
            prompt_tokens=getattr(u, "prompt_token_count", 0) or 0,
            completion_tokens=getattr(u, "candidates_token_count", 0) or 0,
        )
    return resp.text, usage


def _call_provider(
    provider_id: str, prompt: str, *, json_mode: bool = False, model: Optional[str] = None,
) -> Tuple[str, Optional["LLMUsage"]]:
    """
    Dispatches a prompt to the named provider. Returns (text, usage) — usage
    is None for providers/SDKs that don't report token counts (Ollama).
    Raises RuntimeError if the provider is not configured.

    ``json_mode`` (Foundation Roadmap P4-3) is only wired through to the
    OpenAI-compatible client path below (``_call_openai_compat``), which is
    where `response_format` lives. The Ollama/Google-SDK/native-Groq-SDK
    branches don't take this parameter today — follow-up if we want JSON
    mode there too (Google's SDK has an equivalent via
    ``response_mime_type``, already used by vision.py, but wiring it into
    this text path is out of scope for this pass).

    ``model`` overrides the registry model for the OpenAI-compatible path
    (the bulk tier's cheaper openai model, see ``_model_for``).
    """
    cfg = PROVIDER_REGISTRY.get(provider_id)
    if cfg is None:
        raise ValueError(f"Unknown provider: {provider_id}")

    # Ollama local
    if provider_id == "llama3":
        if _ollama_lib is None:
            raise RuntimeError("Ollama not installed")
        res = _ollama_lib.chat(model=OLLAMA_MODEL, messages=[{"role": "user", "content": prompt}])
        return res["message"]["content"], None

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
        return resp.choices[0].message.content or "", _usage_from_openai_compat(resp)

    # All other OpenAI-compat providers
    client = _clients.get(provider_id)
    if client is None:
        raise RuntimeError(f"Provider '{provider_id}' client not initialised ({cfg.env_var} missing)")
    return _call_openai_compat(
        client, model or cfg.model, prompt, provider_id=provider_id, json_mode=json_mode,
    )


# ---------------------------------------------------------------------------
# Rotation engine
# ---------------------------------------------------------------------------

def _http_status(exc: BaseException) -> Optional[int]:
    """The HTTP status a provider SDK exception carries, or None.

    openai/groq SDK errors expose it as ``status_code``. google-genai's
    ``APIError`` (gemini, gemma, gemini_vision) exposes it as ``code`` and words
    its message "404 NOT_FOUND. {...}", which none of the string sniffs match,
    so a retired Gemini slug used to be retried on every call. Only ints count:
    openai's APIError also has a ``code`` attribute, but there it is the
    string error code (e.g. "model_not_found").
    """
    for attr in ("status_code", "code"):
        value = getattr(exc, attr, None)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None


def _generate_with_rotation(
    prompt: str,
    chain: List[str],
    preferred: Optional[str] = None,
    *,
    json_mode: bool = False,
    prompt_name: Optional[str] = None,
    tier: str = "quality",
) -> Tuple[str, str, str, Optional["LLMUsage"]]:
    """
    Tries each provider in `chain` (skipping unavailable ones), rotates on 429.
    If ``preferred`` is a known provider id it is moved to the head of the
    chain so the user's selection is honored first when available.
    Raises the last exception if every provider fails.

    Returns ``(text, provider_id, model, usage)`` — the last three identify
    which provider actually served the request, for cost accounting (P1-1)
    by the async wrappers (``generate_text``/``generate_text_bulk``).

    ``json_mode`` is passed to ``_call_provider`` ONLY when truthy — this
    keeps the call signature backward-compatible with test doubles that
    monkeypatch ``_call_provider`` with the pre-P4-3 positional signature.

    ``prompt_name`` (optional) is a ``prompts.PROMPT_VERSIONS`` key, logged
    alongside the serving provider as a breadcrumb correlating a provider
    choice to the prompt/version that produced it.
    ``_account_for_call`` writes ``prompt_name`` to ``llm_calls`` (Arc 7).

    ``tier`` ("quality" or "bulk") picks the model a multi-model provider
    serves — today only openai, whose bulk tier is a cheaper model. Like
    ``json_mode``, the model is passed to ``_call_provider`` only when it
    differs from the registry default, for the same test-double reason.
    """
    chain = _chain_with_preferred(chain, preferred)
    available = _rotator.available(chain)
    if not available:
        # `available()` already relaxes its soft gates (daily limit, backoff)
        # before returning empty, so an empty list means every leg is
        # permanently disabled, has no API key, or is over its cost ceiling.
        # Retrying the raw chain here would re-admit precisely those — it was
        # the second of two paths by which the openai daily cost ceiling could
        # be bypassed. Fail loudly instead of billing past the cap.
        raise RuntimeError(
            f"No LLM provider available in chain {chain}: every candidate is "
            f"disabled (dead model), missing an API key, or over its cost "
            f"ceiling. Check provider model ids and credentials."
        )

    last_exc: Optional[Exception] = None

    for pid in available:
        try:
            model = _model_for(pid, tier)
            call_kwargs: Dict[str, Any] = {}
            if json_mode:
                call_kwargs["json_mode"] = True
            if model != PROVIDER_REGISTRY[pid].model:
                call_kwargs["model"] = model
            result, usage = _call_provider(pid, prompt, **call_kwargs)
            _rotator.record_success(pid)
            if prompt_name:
                from backend.services.ai.prompts import get_prompt_version
                logger.info(
                    "✅ Provider '%s' served request (prompt=%s version=%s)",
                    pid, prompt_name, get_prompt_version(prompt_name),
                )
            else:
                logger.info("✅ Provider '%s' served request", pid)
            return result, pid, model, usage
        except Exception as exc:
            msg = str(exc).lower()
            # A 402 is a billing wall, not a throttle — no amount of waiting
            # clears it. It must be checked BEFORE the rate-limit sniff:
            # Cerebras' 402 body is
            #   {'message': 'Payment required ...', 'param': 'quota',
            #    'code': 'payment_required'}
            # whose bare "quota" substring otherwise matches below, which
            # demoted a permanent failure to a 90s backoff and left the head
            # of both chains re-firing one doomed request per call forever.
            is_payment_required = (
                _http_status(exc) == 402
                or "error code: 402" in msg
                or "status 402" in msg
                or "payment_required" in msg
                or "payment required" in msg
                or "insufficient_quota" in msg
            )
            is_rate_limit = not is_payment_required and any(
                k in msg for k in ("429", "rate limit", "quota", "too many requests", "rate_limit")
            )
            # A 404 from a chat-completions endpoint means the route or the
            # configured model id does not exist at that provider — never a
            # transient condition, so retrying it is pure waste. Key off the
            # HTTP status rather than message wording: the previous
            # `model_not_found`/`does not exist` sniff missed OpenRouter's
            # "This model is unavailable for free. The paid version is
            # available now — use this slug instead: …", which then fell into
            # the generic branch below and re-fired on every subsequent call.
            # Rate-limits are checked first, and the string fallback matches the
            # SDK's "Error code: 404" preamble rather than a bare "404", so a
            # request id that happens to contain those digits can't disable a
            # working provider.
            is_model_not_found = (
                _http_status(exc) == 404
                or "error code: 404" in msg
                or "status 404" in msg
            )
            if is_payment_required:
                _rotator.record_unavailable(pid, "402 payment required (billing)")
                last_exc = exc
                logger.error(
                    "💳 Provider '%s' requires payment — disabling for the rest "
                    "of this process: %s",
                    pid, exc,
                )
            elif is_rate_limit:
                _rotator.record_rate_limit(pid)
                last_exc = exc
                logger.warning("⚠️  Provider '%s' rate-limited, trying next", pid)
            elif is_model_not_found:
                _rotator.record_unavailable(pid, "404 from provider (model or route gone)")
                last_exc = exc
                logger.error(
                    "❌ Provider '%s' returned 404 — skipping for the rest of this process: %s",
                    pid, exc,
                )
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
    """Robustly extracts and parses JSON from an LLM response.

    Handles three failure modes:
    1. JSON wrapped in ```json ... ``` fences — strips fence, parses inner text.
    2. Valid JSON embedded inside prose — extracts first {...} or [...] block.
    3. Truncated JSON array — the LLM hit its output token limit mid-object.
       Instead of returning {} (which poisons the whole batch), we salvage
       every *complete* object from the partial array so already-finished
       slides are not lost.
    """
    if isinstance(raw, (dict, list)):
        return raw

    if not isinstance(raw, str):
        raw = str(raw)

    raw = raw.strip()
    # A well-formed reply parses as is. This must come first: the batch prompts
    # ask for Markdown content, so a reply can carry ```sql blocks INSIDE its
    # JSON strings, and stripping "the first fence" would cut that code out and
    # try to parse it as the JSON (every batch of an SQL deck was discarded).
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    # Only a fence that wraps the WHOLE reply is a wrapper; inner fences are content.
    fence = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", raw)
    if fence:
        raw = fence.group(1).strip()
    raw = _sanitize_json_string(raw)
    match = re.search(r"(\{[\s\S]*\}|\[[\s\S]*\])", raw)
    candidate = match.group(1) if match else raw
    try:
        return json.loads(candidate)
    except json.JSONDecodeError as e:
        logger.warning("JSON parsing failed: %s. Raw: %.300s", e, candidate)
        # --- Truncation recovery for arrays ---
        # When an LLM hits its output token limit the JSON array is cut off
        # mid-object (e.g. "[{...}, {\"title\": \"Foo\",").  We can still
        # salvage all *complete* objects that appear before the truncation
        # point by scanning for self-contained {...} blocks inside the array.
        #
        # Salvage from `raw` (the full sanitized text) when it is an array: a
        # genuinely truncated array has no closing ']', so the extraction regex
        # above can't match the '[...]' span and falls back to the inner
        # '{...}' span — `candidate` then starts with '{', not '[', and gating
        # salvage on `candidate` alone would miss the exact case this recovery
        # exists for. Fall back to `candidate` for the closed-but-malformed
        # array case (a valid '[...]' whose contents don't parse).
        salvage_source = None
        if raw.lstrip().startswith("["):
            salvage_source = raw
        elif candidate.lstrip().startswith("["):
            salvage_source = candidate
        if salvage_source is not None:
            salvaged = []
            # Greedily extract every balanced {…} block from the partial text
            depth = 0
            start = None
            for i, ch in enumerate(salvage_source):
                if ch == "{":
                    if depth == 0:
                        start = i
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0 and start is not None:
                        fragment = salvage_source[start:i + 1]
                        try:
                            obj = json.loads(fragment)
                            if isinstance(obj, dict):
                                salvaged.append(obj)
                        except json.JSONDecodeError:
                            pass
                        start = None
            if salvaged:
                logger.info(
                    "Truncated JSON array: salvaged %d complete objects "
                    "out of partial response.",
                    len(salvaged),
                )
                return salvaged
        return {}


def as_slide_item_list(parsed: Any) -> List[Any]:
    """Normalise a parsed LLM response into a list of per-slide objects.

    Our batch prompts ask for a bare JSON *array*, but we send them with
    ``json_mode=True`` and JSON mode requires a top-level JSON *object* — so
    the model physically cannot comply and wraps the array instead, typically
    as ``{"slides": [...]}``.

    The previous ``if isinstance(parsed, dict): parsed = [parsed]`` treated
    that envelope as a single slide. The resulting item had no ``page_number``,
    so page-keyed matching found nothing and every batch was discarded as an
    "unusable JSON response" — falling back to per-slide synthesis at ~5x the
    LLM calls, for a response whose contents were perfectly good.

    Unwrap the envelope; only treat a dict as a lone slide when it actually
    looks like one.
    """
    if isinstance(parsed, list):
        return parsed
    if not isinstance(parsed, dict):
        return []

    for key in ("slides", "items", "results", "data", "output"):
        value = parsed.get(key)
        if isinstance(value, list):
            return value

    # Unknown envelope key: accept a sole list-valued entry as the payload,
    # but never when the dict is itself slide-shaped.
    if "page_number" not in parsed:
        list_values = [v for v in parsed.values() if isinstance(v, list)]
        if len(list_values) == 1:
            return list_values[0]

    return [parsed]


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

def _llm_generate_text_sync(prompt: str, ai_model: str = "cerebras") -> str:
    """
    Backward-compat sync entry point.
    Routes to the appropriate chain based on ai_model hint.
    """
    if ai_model == "llama3":
        text, _usage = _call_provider("llama3", prompt)
        return text
    text, _pid, _model, _usage = _generate_with_rotation(
        prompt, QUALITY_CHAIN, preferred=_resolve_preferred(ai_model)
    )
    return text


async def _account_for_call(
    provider_id: str,
    model: str,
    usage: Optional["LLMUsage"],
    *,
    user_id: Optional[str],
    course_id: Optional[str],
    feature: str,
    duration_seconds: float,
    prompt_name: Optional[str] = None,
) -> None:
    """Shared cost-accounting tail for generate_text/generate_text_bulk
    (Roadmap P1-1): mirrors this call's provider count (and openai's cost, if
    any) to Redis for fleet-wide budget tracking, logs the completion to
    ``public.llm_calls``, and — when ``user_id`` is given — adds to that
    user's running monthly spend. It also emits the completed call's latency,
    cost, and token usage to Prometheus.

    Arc 7: the current ``call_context`` (set by the parse orchestrator) tags
    the row with run_id / slide_indices / prompt_name, and the serving call is
    recorded for the parse receipt. An explicit ``prompt_name`` wins over the
    context's.

    Arc 9: a call made inside a parse without its own ``user_id`` /
    ``course_id`` is billed to the parse's uploader and course from the
    context. Explicit arguments always win, and the spend is recorded exactly
    once per call. Entirely best-effort; never raises."""
    from backend.services.ai.call_context import (
        ServedCall,
        current_llm_call_context,
        record_served_call,
    )
    from backend.services.ai.cost import estimate_cost, log_llm_call, record_user_llm_spend
    from backend.core.metrics import (
        LLM_CALL_COST_USD_TOTAL,
        LLM_CALL_DURATION_SECONDS,
        LLM_CALL_TOKENS_TOTAL,
    )

    call_ctx = current_llm_call_context()
    # "" is as unattributed as None (FK columns; log_llm_call swallows errors).
    user_id = user_id or None
    course_id = course_id or None
    if user_id is None:
        # The course follows the user: only a context-derived user inherits
        # the parse's course, never an explicit caller.
        user_id = call_ctx.user_id or None
        if course_id is None:
            course_id = call_ctx.course_id or None

    await _rotator.flush_success_to_redis(provider_id)
    cost = estimate_cost(provider_id, model, usage)
    if provider_id == "openai" and cost > 0:
        await _rotator.flush_openai_cost_to_redis(cost)
    name = prompt_name or call_ctx.prompt_name
    from backend.services.ai.prompts import PROMPT_VERSIONS, get_prompt_version
    # Recorded at call time so a later prompt bump never rewrites history;
    # None for a free-form name that is not a registered prompt.
    version = get_prompt_version(name) if name in PROMPT_VERSIONS else None
    record_served_call(ServedCall(
        provider=provider_id,
        model=model,
        prompt_tokens=usage.prompt_tokens if usage else 0,
        completion_tokens=usage.completion_tokens if usage else 0,
        cost_usd=cost,
        prompt_name=name,
        slide_indices=call_ctx.slide_indices,
        prompt_version=version,
    ))
    await log_llm_call(
        user_id=user_id, course_id=course_id, feature=feature,
        provider_id=provider_id, model=model, usage=usage, cost_usd=cost,
        run_id=call_ctx.run_id, slide_indices=call_ctx.slide_indices, prompt_name=name,
        prompt_version=version,
    )
    # An UNENFORCED parse is attributed (the row above) but must not feed the
    # same Redis counter that interactive features check with an explicit
    # user_id, or a heavy ingest could lock a professor out of them.
    parse_budget = call_ctx.budget
    unenforced_parse_spend = (
        parse_budget is not None and not parse_budget.enforce and user_id == call_ctx.user_id
    )
    if user_id and cost > 0 and not unenforced_parse_spend:
        await record_user_llm_spend(user_id, cost)

    labels = {"provider": provider_id, "model": model, "feature": feature}
    LLM_CALL_DURATION_SECONDS.labels(**labels).observe(duration_seconds)
    LLM_CALL_COST_USD_TOTAL.labels(**labels).inc(cost)
    if usage:
        LLM_CALL_TOKENS_TOTAL.labels(**labels, kind="prompt").inc(usage.prompt_tokens)
        LLM_CALL_TOKENS_TOTAL.labels(**labels, kind="completion").inc(usage.completion_tokens)


async def enforce_llm_budget(user_id: Optional[str] = None) -> None:
    """Per-call spend gate, run BEFORE any provider is invoked.

    An explicit ``user_id`` is checked exactly as before (Roadmap P1-1).
    Without one, a parse whose budget is enforced (Arc 9) checks the parse's
    uploader from the call context. The first refusal latches
    ``budget.exceeded`` so the pipeline can stop even where a step swallows
    the error, and every later call of that parse is refused without another
    Redis read. Raises ``LLMBudgetExceededError``."""
    from backend.services.ai.call_context import current_llm_call_context
    from backend.services.ai.cost import check_user_llm_budget
    from backend.services.llm_client import LLMBudgetExceededError

    ctx = current_llm_call_context()
    budget = ctx.budget
    if user_id and not (budget is not None and budget.enforce and user_id == ctx.user_id):
        await check_user_llm_budget(user_id)
        return
    if budget is None or not budget.enforce or not ctx.user_id:
        return
    if budget.exceeded:
        raise LLMBudgetExceededError("Monthly LLM spend cap reached earlier in this parse.")
    try:
        await check_user_llm_budget(ctx.user_id)
    except LLMBudgetExceededError:
        budget.exceeded = True
        raise


async def generate_text(
    prompt: str,
    ai_model: str = "cerebras",
    *,
    json_mode: bool = False,
    prompt_name: Optional[str] = None,
    user_id: Optional[str] = None,
    course_id: Optional[str] = None,
    feature: Optional[str] = None,
) -> str:
    """
    Quality chain: Groq gpt-oss-120b → OpenRouter → Cloudflare → Gemini → …
    Use for blueprints, planning, deck summaries.
    The user-selected ``ai_model`` is moved to the head of the chain when
    it maps to a known provider (groq, openrouter, cloudflare, gemini, ...).

    Pass ``json_mode=True`` when the caller will run ``parse_json_response``
    on the reply (Foundation Roadmap P4-3) — this requests provider-native
    JSON-object mode where supported, with an automatic per-provider
    fallback (see ``_call_openai_compat``). ``prompt_name`` optionally tags
    the request with a ``prompts.PROMPT_VERSIONS`` key for the success log.

    ``user_id``/``course_id``/``feature`` are optional cost-accounting
    context (Roadmap P1-1). When ``user_id`` is given, the caller's monthly
    LLM spend cap is checked BEFORE any provider is invoked — raises
    ``LLMBudgetExceededError`` if already over cap — and the completion's
    cost is added to their running monthly total afterward. Every call is
    best-effort logged to ``public.llm_calls`` regardless (``feature``
    defaults to "generate_text" for call sites that haven't threaded a more
    specific feature name through yet).
    """
    from backend.services.llm_client import call_llm
    from backend.services.ai.prompt_log import log_prompt_response

    await enforce_llm_budget(user_id)

    if ai_model == "llama3":
        call_started = time.perf_counter()
        text, usage = await call_llm(lambda: _call_provider("llama3", prompt))
        await _account_for_call(
            "llama3", OLLAMA_MODEL, usage,
            user_id=user_id, course_id=course_id, feature=feature or "generate_text",
            duration_seconds=time.perf_counter() - call_started,
        )
        await log_prompt_response("generate_text", prompt, text)
        return text

    preferred = _resolve_preferred(ai_model)
    await _rotator.refresh_from_redis(QUALITY_CHAIN)
    call_started = time.perf_counter()
    text, provider_id, model, usage = await call_llm(
        lambda: _generate_with_rotation(
            prompt, QUALITY_CHAIN, preferred=preferred,
            json_mode=json_mode, prompt_name=prompt_name,
        )
    )
    await _account_for_call(
        provider_id, model, usage,
        user_id=user_id, course_id=course_id, feature=feature or "generate_text",
        prompt_name=prompt_name,
        duration_seconds=time.perf_counter() - call_started,
    )
    await log_prompt_response("generate_text", prompt, text)
    return text


async def generate_text_bulk(
    prompt: str,
    ai_model: str = "cerebras",
    *,
    json_mode: bool = False,
    prompt_name: Optional[str] = None,
    user_id: Optional[str] = None,
    course_id: Optional[str] = None,
    feature: Optional[str] = None,
) -> str:
    """
    Bulk chain: Groq gpt-oss-20b → Cloudflare → Gemma → Mistral → OpenRouter → …
    Use for slide-by-slide processing to preserve the scarce Groq 70B quota.
    User-selected ``ai_model`` is honored at the head of the chain when known.

    See ``generate_text`` for the ``user_id``/``course_id``/``feature``
    cost-accounting contract (Roadmap P1-1) — identical here.
    """
    from backend.services.llm_client import call_llm
    from backend.services.ai.prompt_log import log_prompt_response

    await enforce_llm_budget(user_id)

    preferred = _resolve_preferred(ai_model)
    await _rotator.refresh_from_redis(BULK_CHAIN)
    call_started = time.perf_counter()
    text, provider_id, model, usage = await call_llm(
        lambda: _generate_with_rotation(
            prompt, BULK_CHAIN, preferred=preferred,
            json_mode=json_mode, prompt_name=prompt_name, tier="bulk",
        )
    )
    await _account_for_call(
        provider_id, model, usage,
        user_id=user_id, course_id=course_id, feature=feature or "generate_text_bulk",
        prompt_name=prompt_name,
        duration_seconds=time.perf_counter() - call_started,
    )
    await log_prompt_response("generate_text_bulk", prompt, text)
    return text


def process_slide_batch(text: str, ai_model: str = "cerebras") -> Dict[str, Any]:
    """Synchronous single-slide processing (legacy/internal)."""
    prompt = (
        "Analyze this lecture slide and return JSON with "
        "{title, content, summary, questions, slide_type, is_metadata}:\n\n" + text
    )
    raw, _pid, _model, _usage = _generate_with_rotation(
        prompt, BULK_CHAIN, preferred=_resolve_preferred(ai_model), json_mode=True,
        prompt_name="process_slide_batch_inline", tier="bulk",
    )
    return parse_json_response(raw)


async def enhance_slide_content(text: str, ai_model: str = "cerebras") -> Dict[str, Any]:
    from backend.services.ai.prompts import ENHANCE_PROMPT
    from backend.services.ai.voice import with_voice
    raw = await generate_text(
        with_voice(ENHANCE_PROMPT.format(text=text), structured=True),
        ai_model=ai_model, json_mode=True, prompt_name="ENHANCE_PROMPT",
    )
    return parse_json_response(raw)


async def generate_deck_summary(content: str, ai_model: str = "cerebras") -> str:
    return await generate_text(
        f"Summarize this lecture content into a cohesive narrative:\n\n{content}",
        ai_model=ai_model,
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
    ai_model: str = "cerebras",
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
    from backend.services.ai.voice import with_voice

    use_cross = _has_cross_slide_signal(blueprint)
    if use_cross:
        prompt = _build_cross_slide_quiz_prompt(blueprint, summary)
    else:
        prompt = DECK_QUIZ_PROMPT + (summary or "")

    raw = await generate_text(
        with_voice(prompt, structured=True), ai_model=ai_model,
        json_mode=True, prompt_name="deck_quiz_prompt",
    )
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
                raw2 = await generate_text(
                    prompt, ai_model=ai_model,
                    json_mode=True, prompt_name="deck_quiz_prompt",
                )
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
    *,
    batch_size: Optional[int] = None,
    context_overlap: Optional[int] = None,
    source_language: str = "en",
) -> List[Dict[str, Any]]:
    """Analyze a batch of slides in (typically) ONE LLM call.

    When ``len(slides) > batch_size`` and the caller has NOT already pre-
    chunked (no slide carries ``context_only=True``), the input is split
    into overlapping windows via :func:`iter_overlapping_windows` and each
    window runs as its own LLM call. This is the convenience path so any
    caller can hand us the full list of pending slides; the
    file-parse pipeline still pre-chunks externally to gain parallelism.

    Each batch beyond the first reuses the trailing ``context_overlap``
    slides as ``<context_only>``-wrapped sections so the LLM can resolve
    back-references like "this method" / "as shown earlier" across the
    chunk boundary.

    On LLM-call exception or unusable JSON the function RAISES — callers
    such as :func:`_process_text_batch_safe` then fall back to per-slide
    retry for active (non-context) slides.

    Defaults for ``batch_size`` / ``context_overlap`` come from
    ``QUIZ_BATCH_CONFIG`` (env-tunable via ``QUIZ_BATCH_SIZE`` /
    ``QUIZ_BATCH_OVERLAP``).

    ``source_language`` mirrors the ``{output_language}`` rule the per-slide
    synthesis prompts already carry: generated titles/summaries stay in the
    deck's own language instead of drifting to English. The rule is appended
    ONLY for non-English decks, so at the ``"en"`` default the prompt is
    BYTE-IDENTICAL to before this parameter existed (regression guard for the
    other callers -- file_parse_service, slide_synth_service).
    """
    from backend.services.ai.prompts import BATCH_SLIDE_PROMPT, output_language as _output_language
    from backend.services.ai.voice import with_voice

    if not slides:
        return []

    bs = batch_size if batch_size is not None else QUIZ_BATCH_CONFIG.batch_size
    ov = (
        context_overlap if context_overlap is not None
        else QUIZ_BATCH_CONFIG.context_overlap
    )

    # Internal overlapping chunking — only when the caller hasn't already
    # marked context slides (i.e. it isn't doing its own windowing).
    has_context_flags = any(s.get("context_only") for s in slides)
    if not has_context_flags and len(slides) > bs:
        merged: List[Dict[str, Any]] = []
        for window, ctx in iter_overlapping_windows(slides, bs, ov):
            tagged: List[Dict[str, Any]] = []
            for pos, s in enumerate(window):
                if pos < ctx:
                    tagged.append({**s, "context_only": True})
                else:
                    tagged.append(s)
            window_results = await batch_analyze_text_slides(
                tagged,
                ai_model=ai_model,
                blueprint=blueprint,
                batch_size=bs,
                context_overlap=ov,
                source_language=source_language,
            )
            merged.extend(window_results)
        return merged

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

    # Empty for English decks so the default-path prompt is unchanged.
    lang_header = ""
    if source_language and source_language != "en":
        lang_header = (
            f"\n\nIMPORTANT: Write every title and summary in "
            f"{_output_language(source_language)}, the language of the slides, "
            f"even if parts of the source text use another language.\n"
        )

    full_prompt = with_voice(
        BATCH_SLIDE_PROMPT + bp_header + context_header + lang_header + "\n\n"
        + "\n\n".join(slide_sections),
        structured=True,
    )

    # Arc 9: the parse's spend gate (outside the try, so a refusal is not
    # logged as a failed batch call; callers decide what a refusal means).
    await enforce_llm_budget()

    # Single LLM call via BULK chain
    try:
        from backend.services.llm_client import call_llm
        preferred = _resolve_preferred(ai_model)
        await _rotator.refresh_from_redis(BULK_CHAIN)
        call_started = time.perf_counter()
        raw, provider_id, model, usage = await call_llm(
            lambda: _generate_with_rotation(
                full_prompt, BULK_CHAIN, preferred=preferred,
                json_mode=True, prompt_name="BATCH_SLIDE_PROMPT", tier="bulk",
            )
        )
        await _account_for_call(
            provider_id, model, usage,
            user_id=None, course_id=None, feature="batch_analyze_text_slides",
            prompt_name="BATCH_SLIDE_PROMPT",
            duration_seconds=time.perf_counter() - call_started,
        )
    except Exception as exc:
        # Re-raise so the outer per-slide retry path (e.g.
        # ``_process_text_batch_safe`` in file_parse_service) can fall
        # back to single-slide calls for the ACTIVE slides only. We used
        # to swallow this and synthesize parse_error rows, which silently
        # gave up on retry.
        logger.error("Bulk batch call failed: %s", exc)
        raise

    parsed = as_slide_item_list(parse_json_response(raw))

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

        # If we couldn't extract anything usable for the active slides,
        # raise so the outer per-slide retry path takes over instead of
        # silently returning empty fallback rows for every slide.
        if active_slides and not results:
            logger.error(
                "Batch response yielded zero usable items for %d active "
                "slides; raising for per-slide retry.",
                len(active_slides),
            )
            raise ValueError("batch_analyze_text_slides: unusable JSON response")

        found = {r["index"] for r in results}
        for s in active_slides:
            if s["index"] not in found:
                logger.warning("Slide %d missing from batch response — using fallback", s["index"])
                results.append({"index": s["index"], "title": f"Slide {s['index']+1}",
                                 "content": s["text"], "summary": "", "questions": []})
    else:
        # parse_json_response normally returns [] on garbage input, so this
        # branch is rare — but guard against non-list/non-dict outputs.
        logger.error(
            "Batch response not a list (%s); raising for per-slide retry.",
            type(parsed).__name__,
        )
        raise ValueError("batch_analyze_text_slides: unusable JSON response")

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
        await _regenerate_failing_slide_quizzes(failing, slides, idx_to_plan, ai_model=ai_model)

    # Stable order by slide index — model output order is not guaranteed,
    # and downstream SSE consumers (and our own coverage assertions) read
    # cleaner when results match input order.
    results.sort(key=lambda r: r.get("index", 0))
    return results


async def _regenerate_failing_slide_quizzes(
    failing: List[Tuple[int, Dict[str, Any]]],
    slides: List[Dict[str, Any]],
    idx_to_plan: Dict[int, Dict],
    ai_model: str = "cerebras",
) -> None:
    """One batched LLM retry for per-slide quizzes that failed validation.

    Mutates ``failing``'s result dicts in place when the regenerated
    question validates, otherwise keeps the original (one-retry contract).
    Cost is bounded at +1 call per upload regardless of failure count.
    """
    from backend.services.ai.prompts import BATCH_SLIDE_QUIZ_REGEN_PROMPT
    from backend.services.ai.quiz_validator import validate_mcq
    from backend.services.ai.voice import with_voice

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

    full_prompt = with_voice(
        BATCH_SLIDE_QUIZ_REGEN_PROMPT + "\n\n" + "\n\n".join(sections),
        structured=True,
    )

    try:
        # Arc 9: a refusal lands in the except below (keep originals); the
        # latched parse budget still stops the parse.
        await enforce_llm_budget()
        from backend.services.llm_client import call_llm
        preferred = _resolve_preferred(ai_model)
        await _rotator.refresh_from_redis(BULK_CHAIN)
        call_started = time.perf_counter()
        raw, provider_id, model, usage = await call_llm(
            lambda: _generate_with_rotation(
                full_prompt, BULK_CHAIN, preferred=preferred,
                json_mode=True, prompt_name="BATCH_SLIDE_QUIZ_REGEN_PROMPT", tier="bulk",
            )
        )
        await _account_for_call(
            provider_id, model, usage,
            user_id=None, course_id=None, feature="regenerate_failing_slide_quizzes",
            duration_seconds=time.perf_counter() - call_started,
        )
    except Exception as exc:
        logger.warning(
            "Per-slide quiz regeneration batch failed (%s); keeping originals.",
            exc,
        )
        return

    parsed = as_slide_item_list(parse_json_response(raw))
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

async def generate_slide_quiz(text: str, ai_model: str = "cerebras") -> Dict[str, Any]:
    """Generate a single-slide quiz using the specialized single-slide prompt."""
    from backend.services.ai.prompts import SINGLE_SLIDE_QUIZ_PROMPT
    from backend.services.ai.quiz_validator import validate_mcq, validate_and_regenerate
    from backend.services.ai.voice import with_voice

    prompt = with_voice(SINGLE_SLIDE_QUIZ_PROMPT + text, structured=True)
    
    # Lazy regenerator for the single slide quiz
    regen_cache: Dict[str, Any] = {"item": None, "called": False}
    
    async def _get_regen() -> Dict[str, Any]:
        if not regen_cache["called"]:
            regen_cache["called"] = True
            try:
                raw2 = await generate_text(
                    prompt, ai_model=ai_model,
                    json_mode=True, prompt_name="SINGLE_SLIDE_QUIZ_PROMPT",
                )
                item = parse_json_response(raw2)
                if isinstance(item, list) and item:
                    item = item[0]
                regen_cache["item"] = item if isinstance(item, dict) else {}
            except Exception as exc:
                logger.warning("Single slide quiz regeneration failed: %s", exc)
                regen_cache["item"] = {}
        return regen_cache["item"]

    raw = await generate_text(
        prompt, ai_model=ai_model,
        json_mode=True, prompt_name="SINGLE_SLIDE_QUIZ_PROMPT",
    )
    parsed = parse_json_response(raw)
    
    if isinstance(parsed, list) and parsed:
        parsed = parsed[0]
    if not isinstance(parsed, dict):
        return {}
        
    validated = await validate_and_regenerate(
        parsed,
        _get_regen,
        validator=validate_mcq,
    )
    return validated


# ---------------------------------------------------------------------------
# Legacy aliases
# ---------------------------------------------------------------------------
_llm_generate_text = _llm_generate_text_sync
generate_summary   = generate_deck_summary
generate_quiz      = generate_slide_quiz
generate_slide_title = lambda t: process_slide_batch(t).get("title", "Untitled")
