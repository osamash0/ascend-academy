"""Review API — the SRS "Daily Ascent" queue/grade/stats endpoints.

Endpoints:
    GET  /api/v1/review/queue                  — due + newly-activated cards
    POST /api/v1/review/{card_id}/grade        — grade a card, advance its schedule
    GET  /api/v1/review/stats                  — due-today / streak / retention
    POST /api/v1/review/cards/{card_id}/suspend

Gamification is 100% client-driven in this app (grant_xp/award_badge RPCs run
under auth.uid(), zero Python callers anywhere) — this router never grants XP;
the client does, after a successful grade response.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.core.auth_middleware import _user_id, require_student
from backend.core.database import get_db_connection
from backend.core.idempotency import check_idempotency
from backend.core.rate_limit import limiter
from backend.services.review import mastery
from backend.services.review.scheduler import ReviewState, schedule

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/review", tags=["review"])

DEFAULT_NEW_CARD_CAP = 20
DEFAULT_TOTAL_CAP = 100


def _row_to_state(row) -> ReviewState:
    return ReviewState(
        stability=row["stability"], difficulty=row["difficulty"], reps=row["reps"],
        lapses=row["lapses"], state=row["state"], due_at=row["due_at"],
        last_reviewed=row["last_reviewed"],
    )


async def _activate_new_cards(conn, user_id: str, cap: int, now: datetime) -> None:
    """Lazily create review_schedule rows for cards the student can see
    (enrolled on the lecture) but hasn't started reviewing yet, up to `cap`.

    Simplification vs. the original "first quiz attempt or slide completion"
    activation trigger: this activates on enrollment alone. The finer
    per-lecture-engagement trigger is a real follow-up, not built here.
    """
    rows = await conn.fetch(
        """
        SELECT rc.id FROM review_cards rc
        JOIN lectures l ON l.id = rc.lecture_id
        JOIN assignment_lectures al ON al.lecture_id = l.id
        JOIN assignment_enrollments ae ON ae.assignment_id = al.assignment_id
        WHERE ae.user_id = $1
          AND NOT EXISTS (
              SELECT 1 FROM review_schedule rs WHERE rs.user_id = $1 AND rs.card_id = rc.id
          )
        LIMIT $2
        """,
        user_id, cap,
    )
    if not rows:
        return
    await conn.executemany(
        """
        INSERT INTO review_schedule (user_id, card_id, due_at, stability, difficulty, reps, lapses, state)
        VALUES ($1, $2, $3, 0, 2.5, 0, 0, 'new')
        ON CONFLICT (user_id, card_id) DO NOTHING
        """,
        [(user_id, r["id"], now) for r in rows],
    )


def _interleave_by_lecture(rows: List[Any]) -> List[Any]:
    """Round-robin across lectures so the queue isn't dominated by one deck."""
    buckets: Dict[Any, List[Any]] = {}
    order: List[Any] = []
    for r in rows:
        lid = r["lecture_id"]
        if lid not in buckets:
            buckets[lid] = []
            order.append(lid)
        buckets[lid].append(r)
    out: List[Any] = []
    while any(buckets[lid] for lid in order):
        for lid in order:
            if buckets[lid]:
                out.append(buckets[lid].pop(0))
    return out


@router.get("/queue")
@limiter.limit("30/minute")
async def get_queue(
    request: Request,
    limit: int = DEFAULT_TOTAL_CAP,
    user: Any = Depends(require_student),
):
    user_id = _user_id(user)
    now = datetime.now(timezone.utc)
    limit = max(1, min(limit, DEFAULT_TOTAL_CAP))

    async with await get_db_connection() as conn:
        await _activate_new_cards(conn, user_id, DEFAULT_NEW_CARD_CAP, now)

        rows = await conn.fetch(
            """
            SELECT rc.id AS card_id, rc.lecture_id, rc.source_type, rc.front, rc.back,
                   rs.due_at, rs.stability, rs.difficulty, rs.reps, rs.lapses, rs.state, rs.last_reviewed
            FROM review_schedule rs
            JOIN review_cards rc ON rc.id = rs.card_id
            WHERE rs.user_id = $1 AND NOT rs.suspended AND rs.due_at <= $2
            ORDER BY rs.due_at
            LIMIT $3
            """,
            user_id, now, limit,
        )

    ordered = _interleave_by_lecture(rows)
    return {
        "cards": [
            {
                "card_id": str(r["card_id"]),
                "lecture_id": str(r["lecture_id"]),
                "source_type": r["source_type"],
                "front": r["front"],
                "back": r["back"],
                "state": r["state"],
            }
            for r in ordered
        ],
        "total_due": len(ordered),
    }


class GradeRequest(BaseModel):
    rating: int
    elapsed_ms: Optional[int] = None


@router.post("/{card_id}/grade")
@limiter.limit("120/minute")
async def grade_card(
    request: Request,
    card_id: str,
    body: GradeRequest,
    user: Any = Depends(require_student),
    _idempotency: Optional[str] = Depends(check_idempotency),
):
    if body.rating not in (1, 2, 3, 4):
        raise HTTPException(status_code=400, detail="rating must be 1-4.")
    user_id = _user_id(user)
    now = datetime.now(timezone.utc)

    try:
        card_uuid = UUID(card_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid card_id.")

    async with await get_db_connection() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM review_schedule WHERE user_id = $1 AND card_id = $2",
            user_id, card_uuid,
        )
        if row is None:
            # Card was never activated for this student (or a forged id) —
            # lazily activate it now rather than 404, so a client that races
            # ahead of /queue still succeeds.
            await conn.execute(
                """
                INSERT INTO review_schedule (user_id, card_id, due_at, stability, difficulty, reps, lapses, state)
                VALUES ($1, $2, $3, 0, 2.5, 0, 0, 'new')
                ON CONFLICT (user_id, card_id) DO NOTHING
                """,
                user_id, card_uuid, now,
            )
            row = await conn.fetchrow(
                "SELECT * FROM review_schedule WHERE user_id = $1 AND card_id = $2",
                user_id, card_uuid,
            )
            if row is None:
                raise HTTPException(status_code=404, detail="Card not found or not visible to you.")

        prior_state = _row_to_state(row)
        new_state = schedule(prior_state, body.rating, now)

        await conn.execute(
            """
            UPDATE review_schedule
            SET due_at = $1, stability = $2, difficulty = $3, reps = $4,
                lapses = $5, state = $6, last_reviewed = $7
            WHERE user_id = $8 AND card_id = $9
            """,
            new_state.due_at, new_state.stability, new_state.difficulty, new_state.reps,
            new_state.lapses, new_state.state, new_state.last_reviewed, user_id, card_uuid,
        )
        await conn.execute(
            "INSERT INTO review_log (user_id, card_id, rating, elapsed_ms) VALUES ($1, $2, $3, $4)",
            user_id, card_uuid, body.rating, body.elapsed_ms,
        )
        await conn.execute(
            "INSERT INTO learning_events (user_id, event_type, event_data) VALUES ($1, 'review_graded', $2::jsonb)",
            user_id, f'{{"card_id": "{card_id}", "rating": {body.rating}}}',
        )

        await mastery.record_grade(conn, user_id, card_uuid, body.rating)

    return {
        "card_id": card_id,
        "rating": body.rating,
        "due_at": new_state.due_at.isoformat(),
        "state": new_state.state,
        "interval_days": new_state.stability,
    }


@router.get("/stats")
@limiter.limit("30/minute")
async def get_stats(request: Request, user: Any = Depends(require_student)):
    user_id = _user_id(user)
    now = datetime.now(timezone.utc)
    end_of_today = now.replace(hour=23, minute=59, second=59, microsecond=0)

    async with await get_db_connection() as conn:
        due_today = await conn.fetchval(
            "SELECT COUNT(*) FROM review_schedule WHERE user_id = $1 AND NOT suspended AND due_at <= $2",
            user_id, end_of_today,
        )
        window_rows = await conn.fetch(
            "SELECT rating, reviewed_at FROM review_log WHERE user_id = $1 AND reviewed_at > $2",
            user_id, now - timedelta(days=30),
        )
        total = len(window_rows)
        correct = sum(1 for r in window_rows if r["rating"] >= 3)
        retention_pct = round(100 * correct / total, 1) if total else None

        # Streak: consecutive days (ending today or yesterday) with >=1 graded review.
        day_rows = await conn.fetch(
            "SELECT DISTINCT reviewed_at::date AS d FROM review_log WHERE user_id = $1 ORDER BY d DESC",
            user_id,
        )
        streak = 0
        expected = now.date()
        for r in day_rows:
            if r["d"] == expected:
                streak += 1
                expected = expected - timedelta(days=1)
            elif r["d"] == expected + timedelta(days=1):
                continue  # tolerate not-yet-reviewed-today
            else:
                break

    return {
        "due_today": due_today,
        "streak": streak,
        "retention_pct": retention_pct,
        "reviews_last_30d": total,
    }


@router.post("/cards/{card_id}/suspend")
@limiter.limit("60/minute")
async def suspend_card(request: Request, card_id: str, user: Any = Depends(require_student)):
    user_id = _user_id(user)
    try:
        card_uuid = UUID(card_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid card_id.")

    async with await get_db_connection() as conn:
        await conn.execute(
            """
            INSERT INTO review_schedule (user_id, card_id, due_at, stability, difficulty, reps, lapses, state, suspended)
            VALUES ($1, $2, now(), 0, 2.5, 0, 0, 'new', true)
            ON CONFLICT (user_id, card_id) DO UPDATE SET suspended = true
            """,
            user_id, card_uuid,
        )
    return {"card_id": card_id, "suspended": True}
