"""
POST /api/v1/ask-luna — one Ask Luna tutor turn.

Mounted only when FEATURE_ASK_LUNA=1 (see backend/main.py). Student-only.
The learner context (profile + quiz accuracy per lecture) is read with the
caller's own JWT through the RLS-enforcing client — this router does not
import ``supabase_admin``.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from backend.core.auth_middleware import _user_id, require_student
from backend.core.database import ANON_KEY, SUPABASE_URL, create_client
from backend.core.rate_limit import limiter
from backend.services.ai import ask_luna as ask_luna_service
from backend.services.llm_client import LLMBudgetExceededError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ask-luna", tags=["ask-luna"])
_security = HTTPBearer()


class HistoryMessage(BaseModel):
    role: Literal["user", "luna"]
    # Luna turns are flattened client-side to their text plus a one-line
    # widget outcome ("[widget JoinPlayground: solved after a hint]").
    content: str = Field(..., max_length=2_000)


class AskLunaRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2_000)
    history: List[HistoryMessage] = Field(default_factory=list, max_length=20)


class AskLunaResponse(BaseModel):
    parts: List[Dict[str, Any]]


def _rls_client(token: str):
    if not ANON_KEY:
        raise RuntimeError("ANON_KEY not configured; cannot create RLS client.")
    client = create_client(SUPABASE_URL, ANON_KEY)
    client.postgrest.auth(token)
    return client


def _load_learner(token: str, user_id: str) -> tuple[Optional[Dict[str, Any]], List[Dict[str, Any]], str]:
    """Profile + per-lecture quiz accuracy, as the user. Best-effort: a read
    failure just means Luna answers without personal context."""
    profile: Optional[Dict[str, Any]] = None
    progress: List[Dict[str, Any]] = []
    try:
        client = _rls_client(token)
        res = (
            client.table("profiles")
            .select("current_level, current_streak, preferred_language")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        profile = (res.data or [None])[0]
        res = (
            client.table("student_progress")
            .select("total_questions_answered, correct_answers, lectures(title)")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(20)
            .execute()
        )
        progress = res.data or []
    except Exception as e:  # noqa: BLE001 — context is optional
        logger.warning("ask_luna: learner context unavailable: %s", e)
    language = (profile or {}).get("preferred_language")
    return profile, progress, language if language in {"en", "de"} else "en"


@router.post("", response_model=AskLunaResponse)
@limiter.limit("20/minute")
async def ask_luna_endpoint(
    request: Request,
    body: AskLunaRequest,
    user: Any = Depends(require_student),
    creds: HTTPAuthorizationCredentials = Depends(_security),
):
    user_id = _user_id(user)
    # The supabase client is sync; keep it off the event loop.
    profile, progress, language = await asyncio.to_thread(_load_learner, creds.credentials, user_id)
    try:
        parts = await ask_luna_service.ask_luna(
            user_id=user_id,
            question=body.question,
            history=[m.model_dump() for m in body.history],
            language=language,
            learner_context=ask_luna_service.build_learner_context(profile, progress),
        )
    except LLMBudgetExceededError:
        raise HTTPException(status_code=429, detail="ask_luna_budget")
    except Exception as e:  # noqa: BLE001
        logger.error("ask_luna failed: %s", e)
        raise HTTPException(status_code=503, detail="ask_luna_unavailable")
    return AskLunaResponse(parts=parts)
