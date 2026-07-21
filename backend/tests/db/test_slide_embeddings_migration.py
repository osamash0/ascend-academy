"""DB regression tests for 20260430120000_promote_slide_embeddings_and_match_slides.sql.

Before this migration, `slide_embeddings`, `pdf_parse_cache`, and `match_slides`
existed only in un-versioned `backend/scripts/*.sql`, applied by hand against
the live project at some point and never captured in `supabase/migrations/`.
A `supabase db reset` from migrations alone left the tutor/RAG retrieval path
broken (missing table + missing RPC) — every later migration that touches
these objects (20260501000001, 20260502000001, 20260710030000's comments)
only ALTERs them, assuming they already exist.

These tests assert the promoted schema matches what the application code
actually depends on (not the two scripts' drifted, disagreeing definitions):
  - `match_slides` returns `pdf_hash` — `backend/services/ai/retrieval.py`
    filters candidates on it, and it would previously silently never match
    if the deployed function lacked the column (one of the two script copies
    did, one didn't).
  - `pdf_parse_cache` has a `result` column — `backend/services/cache.py`'s
    `get_cached_parse`/`store_cached_parse` read and write exactly that.
  - The whole chain works end-to-end: store an embedding, retrieve it via
    `match_slides`, get the right `pdf_hash` back.

Gated behind the `db` marker (boots a real Postgres via testcontainers).
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.db


def test_pdf_parse_cache_has_result_column_matching_real_usage(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'pdf_parse_cache'"
        )
        columns = {r[0] for r in cur.fetchall()}
    # backend/services/cache.py's get_cached_parse/store_cached_parse read
    # and write exactly these three columns — not the stale `slides`/`deck`
    # shape a previous version of this test's own bootstrap stubbed in.
    assert columns == {"pdf_hash", "result", "created_at"}


def test_match_slides_returns_pdf_hash(db_conn):
    """The single canonical contract going forward — retrieval.py depends on
    this column being present (it filters candidates on r.get("pdf_hash"))."""
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.proname
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname = 'match_slides'
              AND pg_get_function_result(p.oid) LIKE '%pdf_hash text%'
            """
        )
        assert cur.fetchone() is not None, (
            "match_slides must return a pdf_hash column — retrieval.py "
            "depends on it for pdf_hash-scoped candidate filtering"
        )


def test_match_slides_end_to_end_retrieves_stored_embedding(db_conn, make_user, make_lecture):
    """Exercises the actual upload -> embed -> tutor-retrieval path: a
    stored slide_embeddings row is retrievable via match_slides with its
    pdf_hash intact — the concrete thing that was broken by a migrations-only
    `supabase db reset` before this migration existed."""
    prof = make_user(role="professor")
    lecture = make_lecture(prof)
    query_vector = [0.1] * 768

    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.slide_embeddings
                (lecture_id, pdf_hash, slide_index, embedding, content_hash)
            VALUES (%s, %s, 1, %s::vector, 'hash1')
            """,
            (str(lecture), "deadbeef1234", query_vector),
        )
        cur.execute(
            "SELECT id, lecture_id, pdf_hash, slide_index, similarity "
            "FROM match_slides(%s::vector, 0.5, 5)",
            (query_vector,),
        )
        rows = cur.fetchall()

    assert len(rows) == 1
    _id, lecture_id, pdf_hash, slide_index, similarity = rows[0]
    assert str(lecture_id) == str(lecture)
    assert pdf_hash == "deadbeef1234"
    assert slide_index == 1
    assert similarity == pytest.approx(1.0)


def test_slide_embeddings_has_pipeline_version_column(db_conn):
    """pipeline_version is added by the later 20260502000001 migration via
    ALTER TABLE ... ADD COLUMN IF NOT EXISTS — confirms the base table this
    migration creates doesn't conflict with that later ALTER."""
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'slide_embeddings' AND column_name = 'pipeline_version'"
        )
        assert cur.fetchone() is not None
