"""
LLM cost + token accounting (Roadmap Foundation 10x, Phase 1 P1-1).

Before this module, LLM usage was totally unmetered in dollar/token terms:
ProviderRotator (orchestrator.py) counted *requests* per day, not tokens or
cost, and did so per-process (each Arq/uvicorn worker had its own counter).
There was no per-user spend visibility and no way to cap the one provider
that actually bills per-token and has no daily request ceiling ("openai",
daily_limit=0 in PROVIDER_REGISTRY).

This module adds:
  - A static $/1K-token pricing table and `estimate_cost()`.
  - A Redis-backed fleet-global daily cost counter for the "openai" provider,
    so ProviderRotator can gate it once the fleet's combined spend (not just
    one process's) crosses `settings.llm_openai_daily_cost_ceiling_usd`.
  - A per-user monthly cost cap (`check_user_llm_budget`), enforced BEFORE
    any provider is called, for call sites that pass a `user_id`.
  - Best-effort persistence of every completion to `public.llm_calls` (see
    migration 20260719010000_llm_calls_cost_accounting.sql) for per-user/
    course/feature/provider/model breakdowns.

Redis and Postgres access here are deliberately best-effort (log + continue
on failure) — a metering outage must never break the actual LLM response
path, matching the fail-open precedent already established in
backend/core/idempotency.py.
"""
from __future__ import annotations

import datetime
import logging
from dataclasses import dataclass
from typing import Optional

from backend.core.config import settings
from backend.services.llm_client import LLMBudgetExceededError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LLMUsage:
    prompt_tokens: int
    completion_tokens: int


# $ per 1,000 tokens (prompt, completion). Every provider in
# orchestrator.PROVIDER_REGISTRY except "openai" is a free-tier endpoint (see
# orchestrator.py's module docstring) — rate-limited, not billed per-token —
# so they price at $0. "openai" is the one provider with a real per-token
# bill and no daily request ceiling, which is exactly the risk this module
# exists to bound. Prices below are OpenAI's published per-1K-token rates;
# update here if OPENAI_MODEL (env-overridable) changes to a different tier.
_OPENAI_PRICING_PER_1K = {
    "gpt-4o-mini": (0.00015, 0.0006),
    "gpt-4o":      (0.0025,  0.01),
    "gpt-4.1":     (0.002,   0.008),
    "gpt-4.1-mini": (0.0004, 0.0016),
}
# Conservative fallback for an OPENAI_MODEL not in the table above (or a
# self-hosted OpenAI-compatible endpoint via OPENAI_BASE_URL) — better to
# over-estimate cost than silently record $0 for a real bill.
_OPENAI_FALLBACK_PRICING_PER_1K = (0.0025, 0.01)


def estimate_cost(provider_id: str, model: str, usage: Optional[LLMUsage]) -> float:
    """Returns estimated USD cost for one completion. $0 for free-tier
    providers or when usage wasn't captured (e.g. Ollama)."""
    if usage is None or provider_id != "openai":
        return 0.0
    prompt_rate, completion_rate = _OPENAI_PRICING_PER_1K.get(
        model, _OPENAI_FALLBACK_PRICING_PER_1K
    )
    return (
        usage.prompt_tokens / 1000.0 * prompt_rate
        + usage.completion_tokens / 1000.0 * completion_rate
    )


def _utc_today() -> str:
    return datetime.datetime.now(datetime.timezone.utc).date().isoformat()


def _utc_month() -> str:
    return datetime.datetime.now(datetime.timezone.utc).date().isoformat()[:7]


def openai_daily_cost_key() -> str:
    return f"llm:cost:openai:{_utc_today()}"


def provider_daily_count_key(provider_id: str) -> str:
    return f"llm:count:{provider_id}:{_utc_today()}"


def _user_monthly_cost_key(user_id: str) -> str:
    return f"llm:user_cost:{user_id}:{_utc_month()}"


def get_redis_or_none():
    """Best-effort Redis accessor — returns None (instead of raising) when
    the client isn't initialized, so callers can fail open in dev/test."""
    from backend.core.redis import get_redis_client
    try:
        return get_redis_client()
    except RuntimeError:
        return None


async def check_user_llm_budget(user_id: str) -> None:
    """Raises LLMBudgetExceededError if `user_id` has exceeded their monthly
    cost cap. Must be called BEFORE any provider is invoked. Fails open (logs
    + allows) if Redis is unavailable or the cap is disabled (0)."""
    cap = settings.llm_monthly_user_cost_cap_usd
    if cap <= 0:
        return
    redis = get_redis_or_none()
    if redis is None:
        return
    try:
        raw = await redis.get(_user_monthly_cost_key(user_id))
        spent = float(raw) if raw else 0.0
    except Exception as exc:
        logger.warning("LLM budget check failed open for user %s: %s", user_id, exc)
        return
    if spent >= cap:
        raise LLMBudgetExceededError(
            f"Monthly LLM spend cap of ${cap:.2f} reached (${spent:.4f} spent this month)."
        )


async def record_user_llm_spend(user_id: str, cost_usd: float) -> None:
    """Best-effort: adds `cost_usd` to the user's running monthly total."""
    if cost_usd <= 0:
        return
    redis = get_redis_or_none()
    if redis is None:
        return
    key = _user_monthly_cost_key(user_id)
    try:
        await redis.incrbyfloat(key, cost_usd)
        # ~40 days: comfortably survives the longest calendar month plus
        # clock skew, without keys accumulating forever.
        await redis.expire(key, 40 * 86400)
    except Exception as exc:
        logger.warning("Failed to record LLM spend for user %s: %s", user_id, exc)


async def log_llm_call(
    *,
    user_id: Optional[str],
    course_id: Optional[str],
    feature: str,
    provider_id: str,
    model: str,
    usage: Optional[LLMUsage],
    cost_usd: float,
) -> None:
    """Best-effort INSERT into public.llm_calls. Never raises — a logging
    failure must not surface as an LLM-call failure to the caller."""
    from backend.core.database import get_db_connection

    prompt_tokens = usage.prompt_tokens if usage else 0
    completion_tokens = usage.completion_tokens if usage else 0
    try:
        conn_cm = await get_db_connection()
        async with conn_cm as conn:
            await conn.execute(
                """
                INSERT INTO public.llm_calls
                    (user_id, course_id, feature, provider, model,
                     prompt_tokens, completion_tokens, est_cost_usd)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                user_id, course_id, feature, provider_id, model,
                prompt_tokens, completion_tokens, cost_usd,
            )
    except Exception as exc:
        logger.warning("Failed to log llm_calls row (feature=%s provider=%s): %s",
                        feature, provider_id, exc)


async def get_user_monthly_spend_from_db(user_id: str) -> float:
    """Authoritative (DB-backed, not the Redis cache) monthly spend for a
    user — for admin visibility. Sums llm_calls.est_cost_usd for the current
    UTC calendar month."""
    from backend.core.database import get_db_connection

    conn_cm = await get_db_connection()
    async with conn_cm as conn:
        row = await conn.fetchrow(
            """
            SELECT COALESCE(SUM(est_cost_usd), 0)::float8 AS total
            FROM public.llm_calls
            WHERE user_id = $1
              AND created_at >= date_trunc('month', now())
            """,
            user_id,
        )
        return float(row["total"]) if row else 0.0
