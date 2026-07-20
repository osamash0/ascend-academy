"""Review-card factory (Arq job): generates spaced-repetition cards for a
lecture from its quiz_questions (transform-only, no LLM).

Idempotent on review_cards.content_hash (UNIQUE with lecture_id) — safe to
re-run for the same lecture (e.g. a re-parse, or the backfill script) without
duplicating cards.

Scoped OUT of v1, on purpose (not a bug): the plan originally called for a
second card source — 1-2 LLM-generated QA/cloze cards per concept, built from
`slide_chunks.text`. Verified against the live pipeline before building it and
found two real gaps: `slide_chunks` has zero writers anywhere in the current
codebase (only the archived v3 stage4_embed.py ever wrote it), and
`concept_lectures` is only populated by an explicit `/concepts` API call or
the manual `backfill_concept_graph.py` script — never automatically by the
v5 parse pipeline. Building concept cards on top of that would either always
produce zero cards (silently) or require also wiring `ingest_lecture_concepts`
into the parse pipeline and re-sourcing excerpt text from `slides.content_text`
instead of the dead table — real scope, not a drop-in addition. Deferred; the
`review_cards.source_type` CHECK constraint already allows `concept_qa`/
`concept_cloze` so adding this later needs no schema change.
"""
from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Dict, Optional
from uuid import UUID

from backend.core.config import settings
from backend.core.database import get_db_connection
from backend.core.job_locks import acquire_job_lock, release_job_lock, review_cards_lock_key

logger = logging.getLogger(__name__)

# In-flight lock TTL (Roadmap P2-3) — generous relative to how long a single
# lecture's quiz-question set takes to transform into review cards (a pure
# DB transform, seconds not minutes), but bounded so a leaked lock self-heals.
REVIEW_CARDS_LOCK_TTL_SECONDS = 300


def _content_hash(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


async def _insert_card(
    conn, lecture_id: UUID, concept_id: Optional[UUID], source_type: str,
    source_id: Optional[UUID], front: Dict[str, Any], back: Dict[str, Any], content_hash: str,
) -> bool:
    row = await conn.fetchrow(
        """
        INSERT INTO review_cards (lecture_id, concept_id, source_type, source_id, front, back, content_hash)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
        ON CONFLICT (lecture_id, content_hash) DO NOTHING
        RETURNING id
        """,
        lecture_id, concept_id, source_type, source_id,
        json.dumps(front), json.dumps(back), content_hash,
    )
    return row is not None


async def _generate_quiz_cards(conn, lecture_id: UUID) -> int:
    """One card per quiz_questions row, joined through slides. Pure transform."""
    rows = await conn.fetch(
        """
        SELECT q.id, q.question_text, q.options, q.correct_answer, q.metadata
        FROM quiz_questions q
        JOIN slides s ON s.id = q.slide_id
        WHERE s.lecture_id = $1
        """,
        lecture_id,
    )
    created = 0
    for r in rows:
        options = r["options"] or []
        if isinstance(options, str):
            options = json.loads(options)
        correct_idx = r["correct_answer"]
        correct_text = options[correct_idx] if isinstance(correct_idx, int) and 0 <= correct_idx < len(options) else ""
        metadata = r["metadata"] or {}
        if isinstance(metadata, str):
            metadata = json.loads(metadata)
        front = {"question": r["question_text"], "options": options}
        back = {"correct_answer": correct_text, "explanation": metadata.get("explanation", "")}
        content_hash = _content_hash("quiz_question", str(r["id"]))
        if await _insert_card(conn, lecture_id, None, "quiz_question", r["id"], front, back, content_hash):
            created += 1
    return created


async def generate_review_cards(ctx: dict, lecture_id: str) -> Dict[str, int]:
    """Arq job entry point. Idempotent — safe to re-run for the same lecture
    (re-parse, or scripts/backfill_review_cards.py) without duplicating cards.

    Also dedupes *in-flight* by lecture_id (Roadmap P2-3): if another attempt
    for this lecture is currently running, this call is a cheap no-op instead
    of racing the same INSERT ... ON CONFLICT DO NOTHING transform twice.
    """
    lid = UUID(lecture_id)

    lock_key = review_cards_lock_key(lecture_id)
    lock_redis = ctx.get("redis") if isinstance(ctx, dict) else None
    owns_lock_conn = lock_redis is None
    if owns_lock_conn:
        import redis.asyncio as aioredis
        lock_redis = aioredis.from_url(settings.redis_queue_url, decode_responses=True)

    got_lock = await acquire_job_lock(lock_redis, lock_key, REVIEW_CARDS_LOCK_TTL_SECONDS)
    try:
        if not got_lock:
            logger.info(
                "generate_review_cards: lecture %s already in flight, skipping duplicate run", lid,
            )
            return {"quiz_cards": 0}

        async with await get_db_connection() as conn:
            quiz_count = await _generate_quiz_cards(conn, lid)
        logger.info("review cards generated for lecture %s: %d quiz cards", lid, quiz_count)
        return {"quiz_cards": quiz_count}
    finally:
        if got_lock:
            await release_job_lock(lock_redis, lock_key)
        if owns_lock_conn and lock_redis is not None:
            await lock_redis.aclose()
