"""Practice for the v4 reader, on a lecture's real quiz questions.

Questions come from `quiz_questions` (the same rows the old reader quizzes
from), shaped as the v4 `PracticeQuestion`. An answer is graded HERE, against
the stored correct option — never on the client's word — and then counts the
way the old reader's did: a learning event (professor analytics, the
activation funnel) — a `quiz_attempt` for a question's first answer, a
`quiz_retry_attempt` for every later one, so first-try rates stay true — and,
when right, 10 XP through the same ledger `grant_xp()` writes. XP is once per
question (`dedupe_key`), so answering the same question again teaches but does
not farm.

`concept_mastery` is deliberately not touched: the review engine's rollup
owns it, with its own smoothing, and a second writer would disagree with it.
"""
from __future__ import annotations

import json
from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException

from backend.core.database import get_db_connection
from backend.repositories.event_repo import record_event
from backend.services.v4_telemetry import now_iso

XP_PER_CORRECT = 10

_QUESTIONS_SQL = """
SELECT q.id, q.question_text, q.options, q.correct_answer, q.metadata, s.slide_number
FROM quiz_questions q
JOIN slides s ON s.id = q.slide_id
WHERE s.lecture_id = $1
ORDER BY s.slide_number, q.created_at
"""

# Earlier answers by this person to this question, and what they chose first.
# The cast is guarded: this runs inside the answer's transaction, and one stored
# row with a non-integer selectedAnswer must not abort it and fail the answer.
_PRIOR_SQL = """
SELECT count(*) AS n,
       (array_agg(CASE WHEN event_data->>'selectedAnswer' ~ '^[0-9]{1,9}$'
                       THEN (event_data->>'selectedAnswer')::int END
                  ORDER BY created_at))[1] AS first_answer
FROM learning_events
WHERE user_id = $1::uuid
  AND event_type IN ('quiz_attempt', 'quiz_retry_attempt')
  AND event_data->>'questionId' = $2
"""


def _choices(options: Any) -> list[str]:
    if isinstance(options, str):
        try:
            options = json.loads(options)
        except ValueError:
            return []
    return [str(o) for o in options or [] if str(o).strip()]


def _meta(metadata: Any) -> dict[str, Any]:
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except ValueError:
            return {}
    return metadata if isinstance(metadata, dict) else {}


def to_question(row: Any, lecture_id: str) -> Optional[dict[str, Any]]:
    """A quiz_questions row as a v4 PracticeQuestion, or None if unusable."""
    choices = _choices(row["options"])
    idx = row["correct_answer"]
    if len(choices) < 2 or not isinstance(idx, int) or not 0 <= idx < len(choices):
        return None
    meta = _meta(row["metadata"])
    explanation = str(meta.get("explanation") or "").strip()
    return {
        "id": str(row["id"]),
        "lessonId": lecture_id,
        "prompt": row["question_text"],
        "choices": choices,
        "correctAnswer": choices[idx],
        # Every question explains itself; where the generator left none, say
        # where the answer lives rather than nothing.
        "explanation": explanation or f"The answer is on page {row['slide_number']} of this Lesson.",
    }


async def questions_for(lecture_id: UUID) -> list[dict[str, Any]]:
    async with await get_db_connection() as conn:
        rows = await conn.fetch(_QUESTIONS_SQL, lecture_id)
    return [q for q in (to_question(r, str(lecture_id)) for r in rows) if q]


async def answer(
    lecture_id: UUID, user_id: str, question_id: UUID, chosen: str, *, session_id: str
) -> dict[str, Any]:
    async with await get_db_connection() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                SELECT q.id, q.question_text, q.options, q.correct_answer, q.metadata,
                       s.slide_number, s.id AS slide_id
                FROM quiz_questions q JOIN slides s ON s.id = q.slide_id
                WHERE q.id = $1 AND s.lecture_id = $2
                """,
                question_id, lecture_id,
            )
            question = to_question(row, str(lecture_id)) if row else None
            if question is None:
                raise HTTPException(status_code=404, detail="Question not found.")
            correct = chosen == question["correctAnswer"]

            selected = question["choices"].index(chosen) if chosen in question["choices"] else None
            prior = await conn.fetchrow(_PRIOR_SQL, user_id, str(question_id))
            base = {
                "lectureId": str(lecture_id),
                "slideId": str(row["slide_id"]),
                "questionId": str(question_id),
                "correct": correct,
                "selectedAnswer": selected,
                "sessionId": session_id,
                "timestamp": now_iso(),
                "source": "v4_practice",
            }
            if prior and prior["n"]:
                # Second looks, restarts, a reopened bench: not first tries.
                await record_event(conn, user_id, "quiz_retry_attempt", {
                    **base, "firstAttemptAnswer": prior["first_answer"], "reviewIndex": int(prior["n"]),
                })
            else:
                await record_event(conn, user_id, "quiz_attempt", base)

            xp = 0
            if correct:
                inserted = await conn.fetchval(
                    """
                    INSERT INTO xp_events (user_id, xp, reason, dedupe_key)
                    VALUES ($1::uuid, $2, 'quiz_correct', $3)
                    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
                    RETURNING 1
                    """,
                    user_id, XP_PER_CORRECT, f"v4quiz:{question_id}",
                )
                if inserted:
                    xp = XP_PER_CORRECT
                    await conn.execute(
                        """
                        UPDATE profiles
                           SET total_xp = COALESCE(total_xp, 0) + $2,
                               current_level = FLOOR((COALESCE(total_xp, 0) + $2) / 100) + 1
                         WHERE user_id = $1::uuid
                        """,
                        user_id, XP_PER_CORRECT,
                    )

    return {
        "correct": correct,
        "correctAnswer": question["correctAnswer"],
        "explanation": question["explanation"],
        "xp": xp,
    }
