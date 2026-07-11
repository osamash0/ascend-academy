"""Real-Postgres validation of repos.get_or_create_run's Phase-1 upsert
behavior — the ON CONFLICT(pdf_hash, pipeline_version) DO UPDATE semantics
can't be meaningfully asserted against a mocked pool, since the point is the
actual SQL's COALESCE/overwrite behavior.

Gated behind `db` (needs Docker + testcontainers), same setup as
test_unified_pipeline_e2e.py.
"""
from __future__ import annotations

from uuid import uuid4

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


async def test_first_call_creates_a_queued_run(wired_pool, make_user):
    from backend.services.parser import repos

    prof = make_user(role="professor")
    batch = uuid4()
    run = await repos.get_or_create_run(
        "h" * 64, None, "5",
        batch_id=batch, user_id=prof, filename="a.pdf", parsing_mode="ai",
    )
    assert run.batch_id == batch
    assert run.user_id == prof
    assert run.filename == "a.pdf"
    assert run.parsing_mode == "ai"
    assert run.status.value == "queued"


async def test_second_call_same_hash_overwrites_with_new_explicit_values(wired_pool, make_user):
    """Re-enqueuing byte-identical content in a LATER batch is intentional
    "last batch wins" — explicit new values overwrite the old ones."""
    from backend.services.parser import repos

    prof = make_user(role="professor")
    batch1, batch2 = uuid4(), uuid4()

    first = await repos.get_or_create_run(
        "same-hash" + "0" * 55, None, "5",
        batch_id=batch1, user_id=prof, filename="first-name.pdf", parsing_mode="ai",
    )
    second = await repos.get_or_create_run(
        "same-hash" + "0" * 55, None, "5",
        batch_id=batch2, user_id=prof, filename="second-name.pdf", parsing_mode="on_demand",
    )

    assert second.run_id == first.run_id  # same row, not a new one
    assert second.batch_id == batch2
    assert second.filename == "second-name.pdf"
    assert second.parsing_mode == "on_demand"


async def test_internal_refetch_without_batch_id_preserves_prior_value(wired_pool, make_user, db_conn):
    """The orchestrator's own internal re-fetch (e.g. mid-pipeline) doesn't
    know batch_id/course_id — it must NEVER wipe values an earlier call (the
    batch endpoint's pre-create) already recorded."""
    from backend.services.parser import repos

    prof = make_user(role="professor")
    batch = uuid4()
    course = uuid4()
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO courses (id, professor_id, title) VALUES (%s, %s, %s)",
            (str(course), str(prof), "Test Course"),
        )

    pre_created = await repos.get_or_create_run(
        "refetch-hash" + "0" * 52, None, "5",
        batch_id=batch, user_id=prof, course_id=course, filename="x.pdf", parsing_mode="ai",
    )

    refetched = await repos.get_or_create_run("refetch-hash" + "0" * 52, None, "5")

    assert refetched.run_id == pre_created.run_id
    assert refetched.batch_id == batch
    assert refetched.course_id == course
    assert refetched.filename == "x.pdf"
    assert refetched.user_id == prof
