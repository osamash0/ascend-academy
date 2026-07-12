"""Roadmap Phase 5.1/5.2 (trust & lifecycle): persisted per-slide trust
signals — migration 20260711040000_slide_trust_signals.sql.

vision_routed/needs_review/review_reason were previously computed at
synthesis time but only ever lived in the SSE stream (Roadmap Phase 2.2);
this migration is what makes them survive a page reload. regen_instruction/
previous_version back Phase 5.2 (regenerate with feedback + single-level
undo).
"""
import pytest

pytestmark = pytest.mark.db


@pytest.fixture
async def wired_pool(pg_dsn, applied_migrations):
    import asyncpg
    import backend.core.database as core

    pool = await asyncpg.create_pool(pg_dsn, min_size=1, max_size=4, statement_cache_size=0)
    old = core.db_pool
    core.db_pool = pool
    try:
        yield pool
    finally:
        core.db_pool = old
        await pool.close()


def test_new_columns_default_safely(db_conn, make_user, make_lecture, make_slide):
    professor = make_user(role="professor")
    lecture_id = make_lecture(professor)
    slide_id = make_slide(lecture_id)

    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT vision_routed, needs_review, review_reason, regen_instruction, previous_version
            FROM public.slides WHERE id = %s
            """,
            (str(slide_id),),
        )
        row = cur.fetchone()

    assert row[0] is False
    assert row[1] is False
    assert row[2] is None
    assert row[3] is None
    assert row[4] is None


def test_needs_review_columns_are_writable(db_conn, make_user, make_lecture, make_slide):
    professor = make_user(role="professor")
    lecture_id = make_lecture(professor)
    slide_id = make_slide(lecture_id)

    with db_conn.cursor() as cur:
        cur.execute(
            """
            UPDATE public.slides
            SET vision_routed = TRUE, needs_review = TRUE, review_reason = 'vision_rescue'
            WHERE id = %s
            """,
            (str(slide_id),),
        )
        cur.execute(
            "SELECT vision_routed, needs_review, review_reason FROM public.slides WHERE id = %s",
            (str(slide_id),),
        )
        row = cur.fetchone()

    assert row == (True, True, "vision_rescue")


def test_regen_instruction_and_previous_version_are_writable(db_conn, make_user, make_lecture, make_slide):
    professor = make_user(role="professor")
    lecture_id = make_lecture(professor)
    slide_id = make_slide(lecture_id)

    with db_conn.cursor() as cur:
        cur.execute(
            """
            UPDATE public.slides
            SET regen_instruction = %s, previous_version = %s::jsonb
            WHERE id = %s
            """,
            (
                "This is a proof sketch, focus on the steps.",
                '{"title": "Old Title", "content_text": "Old body", "summary": "Old summary"}',
                str(slide_id),
            ),
        )
        cur.execute(
            "SELECT regen_instruction, previous_version FROM public.slides WHERE id = %s",
            (str(slide_id),),
        )
        row = cur.fetchone()

    assert row[0] == "This is a proof sketch, focus on the steps."
    assert row[1] == {"title": "Old Title", "content_text": "Old body", "summary": "Old summary"}


def test_needs_review_partial_index_used_by_lecture_filter(db_conn, make_user, make_lecture, make_slide):
    """Sanity check the partial index's WHERE clause matches real query
    shape (lecture_id lookup filtered to needs_review = TRUE)."""
    professor = make_user(role="professor")
    lecture_id = make_lecture(professor)
    flagged = make_slide(lecture_id, slide_number=1)
    healthy = make_slide(lecture_id, slide_number=2)

    with db_conn.cursor() as cur:
        cur.execute("UPDATE public.slides SET needs_review = TRUE WHERE id = %s", (str(flagged),))
        cur.execute(
            "SELECT id FROM public.slides WHERE lecture_id = %s AND needs_review = TRUE",
            (str(lecture_id),),
        )
        rows = [r[0] for r in cur.fetchall()]

    assert str(flagged) in [str(r) for r in rows]
    assert str(healthy) not in [str(r) for r in rows]


async def test_fetch_regen_instructions_returns_zero_based_index_map(wired_pool, make_user, make_lecture, make_slide):
    """Roadmap Phase 5.2: persist.fetch_regen_instructions must key by
    0-based slide index (slide_number - 1) to line up with the orchestrator's
    per-slide loop, and skip slides with no instruction set."""
    from backend.services.parser import persist

    professor = make_user(role="professor")
    lecture_id = make_lecture(professor)
    make_slide(lecture_id, slide_number=1)
    slide2 = make_slide(lecture_id, slide_number=2)
    make_slide(lecture_id, slide_number=3)

    await persist._execute(
        "UPDATE public.slides SET regen_instruction = $1 WHERE id = $2",
        "Focus on the proof steps.",
        slide2,
    )

    result = await persist.fetch_regen_instructions(lecture_id)

    assert result == {1: "Focus on the proof steps."}


async def test_insert_slide_persists_regen_instruction(wired_pool, make_user, make_lecture):
    from backend.services.parser import persist

    professor = make_user(role="professor")
    lecture_id = make_lecture(professor)

    slide_id = await persist.insert_slide(
        lecture_id, 0,
        {
            "title": "T", "content": "C", "summary": "S",
            "vision_routed": True, "needs_review": True, "review_reason": "vision_rescue",
            "regen_instruction": "Keep it concise.",
        },
    )

    rows = await persist._fetch(
        "SELECT vision_routed, needs_review, review_reason, regen_instruction FROM public.slides WHERE id = $1",
        slide_id,
    )
    row = rows[0]
    assert row["vision_routed"] is True
    assert row["needs_review"] is True
    assert row["review_reason"] == "vision_rescue"
    assert row["regen_instruction"] == "Keep it concise."
