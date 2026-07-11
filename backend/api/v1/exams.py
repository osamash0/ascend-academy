"""Exam Mode API — mock exams sampled from a course's own quiz_questions
(Roadmap Phase 1.2, "Daily Ascent"'s sibling).

Endpoints:
    POST /api/v1/exams/course/{course_id}/generate     — sample + start an attempt
    GET  /api/v1/exams/{exam_id}                         — fetch an attempt (own-row)
    POST /api/v1/exams/{exam_id}/answer                  — autosave one answer
    POST /api/v1/exams/{exam_id}/submit                  — grade, server-enforced timer
    GET  /api/v1/exams/mine?course_id=                   — attempt history
    POST /api/v1/exams/{exam_id}/send-misses-to-review   — bridge into Daily Ascent

`exam_attempts` RLS is pure own-row (no professor policy at all — see
20260710020000_exam_mode.sql). This router enforces course-access
authorization in Python at generate-time, the same "RLS is defense-in-depth"
convention as review.py. Like review.py, this router never grants XP — that's
100% client-driven after a successful response (grant_xp/award_badge RPCs).
"""
from __future__ import annotations

import json
import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from backend.api.v1.courses import _student_visible_course_ids
from backend.core.auth_middleware import _user_id, require_student
from backend.core.database import get_db_connection
from backend.core.idempotency import check_idempotency
from backend.core.rate_limit import limiter
from backend.services import exam_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/exams", tags=["exams"])

MIN_QUESTIONS = 20
MAX_QUESTIONS = 40
DEFAULT_TIME_LIMIT_S = 45 * 60
GRACE_SECONDS = 30


async def _assert_course_access(user_id: str, course_uuid: UUID) -> None:
    visible = await run_in_threadpool(_student_visible_course_ids, user_id)
    if str(course_uuid) not in visible:
        raise HTTPException(status_code=403, detail="Not enrolled in this course.")


def _parse_uuid(value: str, field_name: str) -> UUID:
    try:
        return UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}.")


def _report_response(row) -> Dict[str, Any]:
    report = row["concept_report"]
    if isinstance(report, str):
        report = json.loads(report) if report else None
    return {
        "exam_id": str(row["id"]),
        "course_id": str(row["course_id"]),
        "started_at": row["started_at"].isoformat(),
        "submitted_at": row["submitted_at"].isoformat() if row["submitted_at"] else None,
        "time_limit_s": row["time_limit_s"],
        "expired": row["expired"],
        "score": row["score"],
        "report": report,
    }


# ── Generate ───────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    num_questions: int = Field(default=30, ge=MIN_QUESTIONS, le=MAX_QUESTIONS)
    time_limit_s: Optional[int] = Field(default=None, ge=60)


@router.post("/course/{course_id}/generate")
@limiter.limit("3/hour")
async def generate_exam(
    request: Request,
    course_id: str,
    body: GenerateRequest,
    user: Any = Depends(require_student),
):
    user_id = _user_id(user)
    course_uuid = _parse_uuid(course_id, "course_id")
    await _assert_course_access(user_id, course_uuid)

    async with await get_db_connection() as conn:
        pool = await exam_service.fetch_course_question_pool(conn, course_uuid)
        if len(pool) < MIN_QUESTIONS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"This course doesn't have enough quiz questions yet "
                    f"({len(pool)} available, {MIN_QUESTIONS} needed)."
                ),
            )
        weights = await exam_service.compute_weakness_weights(user_id, pool)
        # Server-generated seed (never client-supplied) so a student can't
        # replay a favorable seed; still stored for the sampler's own
        # determinism/reproducibility guarantees.
        seed = random.SystemRandom().getrandbits(63)
        question_ids = exam_service.sample_questions(pool, weights, body.num_questions, seed)
        time_limit_s = body.time_limit_s or DEFAULT_TIME_LIMIT_S

        row = await conn.fetchrow(
            """
            INSERT INTO exam_attempts (user_id, course_id, question_ids, time_limit_s, seed)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, started_at
            """,
            user_id, course_uuid, question_ids, time_limit_s, seed,
        )
        await conn.execute(
            "INSERT INTO learning_events (user_id, event_type, event_data) VALUES ($1, 'exam_generated', $2::jsonb)",
            user_id, f'{{"exam_id": "{row["id"]}", "course_id": "{course_id}"}}',
        )

        by_id = {q["id"]: q for q in pool}
        questions_out = [
            {
                "id": qid,
                "question_text": by_id[qid]["question_text"],
                "options": by_id[qid]["options"],
                "slide_id": by_id[qid]["slide_id"],
            }
            for qid in question_ids
        ]

    return {
        "exam_id": str(row["id"]),
        "started_at": row["started_at"].isoformat(),
        "time_limit_s": time_limit_s,
        "questions": questions_out,
    }


# ── Fetch ──────────────────────────────────────────────────────────────────

@router.get("/mine")
@limiter.limit("30/minute")
async def list_my_exams(
    request: Request,
    course_id: Optional[str] = None,
    user: Any = Depends(require_student),
):
    user_id = _user_id(user)
    async with await get_db_connection() as conn:
        if course_id:
            course_uuid = _parse_uuid(course_id, "course_id")
            rows = await conn.fetch(
                """
                SELECT id, course_id, started_at, submitted_at, time_limit_s, expired, score
                FROM exam_attempts WHERE user_id = $1 AND course_id = $2
                ORDER BY started_at DESC
                """,
                user_id, course_uuid,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT id, course_id, started_at, submitted_at, time_limit_s, expired, score
                FROM exam_attempts WHERE user_id = $1
                ORDER BY started_at DESC
                """,
                user_id,
            )
    return {
        "attempts": [
            {
                "exam_id": str(r["id"]),
                "course_id": str(r["course_id"]),
                "started_at": r["started_at"].isoformat(),
                "submitted_at": r["submitted_at"].isoformat() if r["submitted_at"] else None,
                "time_limit_s": r["time_limit_s"],
                "expired": r["expired"],
                "score": r["score"],
            }
            for r in rows
        ]
    }


@router.get("/{exam_id}")
@limiter.limit("60/minute")
async def get_exam(request: Request, exam_id: str, user: Any = Depends(require_student)):
    user_id = _user_id(user)
    exam_uuid = _parse_uuid(exam_id, "exam_id")

    async with await get_db_connection() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM exam_attempts WHERE id = $1 AND user_id = $2", exam_uuid, user_id,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Exam not found.")

        question_rows = await conn.fetch(
            "SELECT id, slide_id, question_text, options FROM quiz_questions WHERE id = ANY($1::uuid[])",
            row["question_ids"],
        )

    by_id = {}
    for r in question_rows:
        options = r["options"] or []
        if isinstance(options, str):
            options = json.loads(options)
        by_id[str(r["id"])] = {"question_text": r["question_text"], "options": options, "slide_id": str(r["slide_id"])}

    answers = row["answers"] or {}
    if isinstance(answers, str):
        answers = json.loads(answers) if answers else {}

    resp = _report_response(row)
    resp["answers"] = answers
    resp["questions"] = [
        {"id": qid, **by_id[qid]} for qid in [str(q) for q in row["question_ids"]] if qid in by_id
    ]
    return resp


# ── Autosave ───────────────────────────────────────────────────────────────

class AnswerRequest(BaseModel):
    question_id: str
    selected: int


@router.post("/{exam_id}/answer")
@limiter.limit("240/minute")
async def autosave_answer(
    request: Request,
    exam_id: str,
    body: AnswerRequest,
    user: Any = Depends(require_student),
):
    user_id = _user_id(user)
    exam_uuid = _parse_uuid(exam_id, "exam_id")

    async with await get_db_connection() as conn:
        row = await conn.fetchrow(
            "SELECT submitted_at, answers FROM exam_attempts WHERE id = $1 AND user_id = $2",
            exam_uuid, user_id,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Exam not found.")
        if row["submitted_at"] is not None:
            raise HTTPException(status_code=409, detail="Exam already submitted.")

        answers = row["answers"] or {}
        if isinstance(answers, str):
            answers = json.loads(answers) if answers else {}
        answers[body.question_id] = body.selected

        await conn.execute(
            "UPDATE exam_attempts SET answers = $1::jsonb WHERE id = $2",
            json.dumps(answers), exam_uuid,
        )

    return {"ok": True}


# ── Submit ─────────────────────────────────────────────────────────────────

class SubmitRequest(BaseModel):
    answers: Dict[str, int] = Field(default_factory=dict)


@router.post("/{exam_id}/submit")
@limiter.limit("30/minute")
async def submit_exam(
    request: Request,
    exam_id: str,
    body: SubmitRequest,
    user: Any = Depends(require_student),
    _idempotency: Optional[str] = Depends(check_idempotency),
):
    user_id = _user_id(user)
    exam_uuid = _parse_uuid(exam_id, "exam_id")
    now = datetime.now(timezone.utc)

    async with await get_db_connection() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM exam_attempts WHERE id = $1 AND user_id = $2", exam_uuid, user_id,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Exam not found.")
        if row["submitted_at"] is not None:
            return _report_response(row)

        # Server clock is authoritative — never trust a client-sent elapsed
        # time. `answers` sent in the submit body wins over any autosaved
        # answers for the same question (last write before grading).
        deadline = row["started_at"] + timedelta(seconds=row["time_limit_s"] + GRACE_SECONDS)
        expired = now > deadline

        merged_answers: Dict[str, Any] = row["answers"] or {}
        if isinstance(merged_answers, str):
            merged_answers = json.loads(merged_answers) if merged_answers else {}
        merged_answers.update(body.answers)

        report = await exam_service.grade(conn, row, merged_answers)

        updated = await conn.fetchrow(
            """
            UPDATE exam_attempts
            SET answers = $1::jsonb, submitted_at = $2, expired = $3, score = $4, concept_report = $5::jsonb
            WHERE id = $6
            RETURNING *
            """,
            json.dumps(merged_answers), now, expired, report["score"], json.dumps(report), exam_uuid,
        )
        await conn.execute(
            "INSERT INTO learning_events (user_id, event_type, event_data) VALUES ($1, 'exam_submitted', $2::jsonb)",
            user_id, f'{{"exam_id": "{exam_id}", "score": {report["score"]}, "expired": {str(expired).lower()}}}',
        )

    return _report_response(updated)


# ── Send misses to review ─────────────────────────────────────────────────

@router.post("/{exam_id}/send-misses-to-review")
@limiter.limit("30/minute")
async def send_misses_to_review(
    request: Request,
    exam_id: str,
    user: Any = Depends(require_student),
    _idempotency: Optional[str] = Depends(check_idempotency),
):
    user_id = _user_id(user)
    exam_uuid = _parse_uuid(exam_id, "exam_id")

    async with await get_db_connection() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM exam_attempts WHERE id = $1 AND user_id = $2", exam_uuid, user_id,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Exam not found.")
        if row["submitted_at"] is None:
            raise HTTPException(status_code=400, detail="Submit the exam before sending misses to review.")

        result = await exam_service.send_misses_to_review(conn, row, user_id)

    return result
