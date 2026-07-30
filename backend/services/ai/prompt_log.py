"""Flag-gated prompt+response logging for reproducibility (Roadmap P1-3).

Before this module, no prompt or response was ever logged anywhere
(orchestrator.py, llm_client.py) — a flagged bad AI output had no way to be
replayed from its actual inputs. This is opt-in (settings.feature_llm_prompt_logging,
default off) since logging every prompt/response is a real storage and PII
cost, and TTL'd (settings.llm_prompt_log_ttl_seconds) rather than kept
forever.

Best-effort throughout: a logging failure must never break the actual LLM
call it's trying to log.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, Optional

from backend.core.config import settings

logger = logging.getLogger(__name__)


def _get_redis_or_none():
    from backend.core.redis import get_redis_client
    try:
        return get_redis_client()
    except RuntimeError:
        return None


def _log_key(log_id: str) -> str:
    return f"llm:prompt_log:{log_id}"


async def log_prompt_response(
    feature: str, prompt: str, response: str
) -> Optional[str]:
    """Logs one prompt/response pair if the feature flag is on. Returns the
    log_id (for later replay) or None if logging is disabled/unavailable."""
    if not settings.feature_llm_prompt_logging:
        return None
    redis = _get_redis_or_none()
    if redis is None:
        return None
    log_id = str(uuid.uuid4())
    payload = {"feature": feature, "prompt": prompt, "response": response}
    try:
        await redis.setex(
            _log_key(log_id), settings.llm_prompt_log_ttl_seconds, json.dumps(payload)
        )
        return log_id
    except Exception as exc:
        logger.warning("Failed to log prompt/response for feature=%s: %s", feature, exc)
        return None


async def get_logged_prompt_response(log_id: str) -> Optional[Dict[str, Any]]:
    """Replays a previously-logged prompt/response pair, or None if it was
    never logged, has expired, or Redis is unavailable."""
    redis = _get_redis_or_none()
    if redis is None:
        return None
    try:
        raw = await redis.get(_log_key(log_id))
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as exc:
        logger.warning("Failed to replay prompt log %s: %s", log_id, exc)
        return None
