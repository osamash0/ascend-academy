"""What the v4 reader tells the insight engine, written one validated row at a time.

The routes call these once their own work is settled, with two exceptions:
Explain and Ask record before the AI call, so a failed Explain still counts as
the learner asking for help. Each opens its own connection, looks up the page's
``slides.id`` (the key the engine joins on; null when the lecture has no slides
row for that page), and writes through ``record_event`` — so a refused row, or
a database that is down, is logged and costs the reader nothing.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from backend.core.database import get_db_connection
from backend.repositories.event_repo import record_event

logger = logging.getLogger(__name__)

SOURCE = "v4_reader"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def session_or_new(session_id: str) -> str:
    """The reader's session, or a fresh one: an older client sends none, and one row per request beats a shared bucket."""
    return session_id or str(uuid.uuid4())


async def slide_id_for(conn: Any, lecture_id: UUID, page: int) -> str | None:
    sid = await conn.fetchval(
        "SELECT id FROM slides WHERE lecture_id = $1 AND slide_number = $2 LIMIT 1", lecture_id, page
    )
    return str(sid) if sid else None


async def _write(lecture_id: UUID, user_id: str, page: int, event_type: str, data: dict[str, Any]) -> None:
    try:
        async with await get_db_connection() as conn:
            data = {"lectureId": str(lecture_id), "slideId": await slide_id_for(conn, lecture_id, page), **data}
            await record_event(conn, user_id, event_type, data)
    except Exception:  # noqa: BLE001 — telemetry must not fail the request
        logger.warning("v4 telemetry: %s for %s p%s not written", event_type, lecture_id, page, exc_info=True)


async def record_help(
    lecture_id: UUID, user_id: str, page: int, kind: Literal["explain", "ask"], query: str, session_id: str
) -> None:
    """Explain opened or a question asked on a page. The question is kept; the reply never is."""
    await _write(lecture_id, user_id, page, "ai_tutor_query", {
        "page": page, "kind": kind, "query": query[:400], "sessionId": session_id,
        "timestamp": now_iso(), "source": SOURCE,
    })


async def record_check_in(
    lecture_id: UUID, user_id: str, page: int, idea: str, rating: Literal["got_it", "confused"], session_id: str
) -> None:
    """The quiet "Clicked / Still foggy" at an idea's checkpoint, anchored on the idea's first page."""
    await _write(lecture_id, user_id, page, "confidence_rating", {
        "page": page, "idea": idea[:60], "rating": rating, "sessionId": session_id,
        "timestamp": now_iso(), "source": SOURCE,
    })


async def record_checkpoint(
    lecture_id: UUID, user_id: str, page: int, idea: str, kind: str, correct: bool, session_id: str
) -> None:
    """One checkpoint question or teach-back, graded on the server."""
    await _write(lecture_id, user_id, page, "checkpoint_attempt", {
        "page": page, "idea": idea[:60], "kind": kind, "correct": correct, "sessionId": session_id,
        "timestamp": now_iso(), "source": SOURCE,
    })
