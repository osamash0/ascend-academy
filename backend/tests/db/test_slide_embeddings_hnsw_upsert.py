"""DB regression tests for 20260719000000_slide_embeddings_hnsw_and_upsert_constraint.sql
(roadmap P3-3, docs/ROADMAP_10X_FOUNDATION.md §8).

Before this migration, `slide_embeddings` had no unique constraint on
(pdf_hash, slide_index, pipeline_version), so `cache.py`'s
`store_slide_embedding` emulated an upsert with an explicit
delete-then-insert — racy under concurrent parses of the same PDF, and its
vector index was `ivfflat`, which needs periodic REINDEX/data-at-build-time
and degrades in recall as the table outgrows its `lists` value.

These tests assert:
  - the unique constraint exists and a single `INSERT ... ON CONFLICT DO
    UPDATE` upsert (the pattern `store_slide_embedding` now uses) is truly
    idempotent under concurrency: two connections racing the same logical
    key never produce duplicate rows.
  - the vector index is `hnsw`, not `ivfflat`, and the planner actually uses
    it for a nearest-neighbor query, with correct similarity ordering.

Gated behind the `db` marker (boots a real Postgres via testcontainers).
"""
from __future__ import annotations

import threading

import pytest

pytestmark = pytest.mark.db

UPSERT_SQL = """
    INSERT INTO public.slide_embeddings
        (lecture_id, pdf_hash, slide_index, embedding, content_hash, pipeline_version)
    VALUES (%s, %s, %s, %s::vector, %s, %s)
    ON CONFLICT (pdf_hash, slide_index, pipeline_version)
    DO UPDATE SET
        embedding = EXCLUDED.embedding,
        content_hash = EXCLUDED.content_hash
"""


def test_unique_constraint_exists(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.slide_embeddings'::regclass
              AND contype = 'u'
            """
        )
        names = {r[0] for r in cur.fetchall()}
    assert "slide_embeddings_pdf_hash_slide_index_pipeline_version_key" in names


def test_vector_index_is_hnsw_not_ivfflat(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT am.amname
            FROM pg_index i
            JOIN pg_class c ON c.oid = i.indexrelid
            JOIN pg_am am ON am.oid = c.relam
            WHERE c.relname = 'slide_embeddings_vector_idx'
            """
        )
        row = cur.fetchone()
    assert row is not None, "slide_embeddings_vector_idx must exist"
    assert row[0] == "hnsw", f"expected hnsw index, got {row[0]!r}"


def test_concurrent_upserts_of_same_key_produce_no_duplicates(pg_dsn, applied_migrations):
    """Two real, concurrent Postgres connections race an ON CONFLICT DO
    UPDATE upsert of the identical (pdf_hash, slide_index, pipeline_version)
    key — the exact race `store_slide_embedding`'s old delete-then-insert
    could lose. Asserts exactly one row survives."""
    import psycopg

    pdf_hash = "concurrency-test-pg-hnsw"
    slide_index = 3
    pipeline_version = "1"
    vector_a = "[" + ",".join(["0.1"] * 768) + "]"
    vector_b = "[" + ",".join(["0.9"] * 768) + "]"

    with psycopg.connect(pg_dsn, autocommit=True) as setup_conn:
        with setup_conn.cursor() as cur:
            cur.execute(
                "DELETE FROM public.slide_embeddings WHERE pdf_hash = %s", (pdf_hash,)
            )

    barrier = threading.Barrier(2)
    errors: list[Exception] = []

    def _run(vector: str, content_hash: str):
        try:
            with psycopg.connect(pg_dsn, autocommit=True) as conn:
                with conn.cursor() as cur:
                    barrier.wait(timeout=5)
                    for _ in range(10):
                        cur.execute(
                            UPSERT_SQL,
                            (None, pdf_hash, slide_index, vector, content_hash, pipeline_version),
                        )
        except Exception as exc:  # pragma: no cover - failure path surfaced via assert below
            errors.append(exc)

    t1 = threading.Thread(target=_run, args=(vector_a, "hashA"))
    t2 = threading.Thread(target=_run, args=(vector_b, "hashB"))
    t1.start()
    t2.start()
    t1.join(timeout=10)
    t2.join(timeout=10)

    assert not errors, f"concurrent upserts raised: {errors}"

    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM public.slide_embeddings "
                "WHERE pdf_hash = %s AND slide_index = %s AND pipeline_version = %s",
                (pdf_hash, slide_index, pipeline_version),
            )
            rows = cur.fetchall()

    assert len(rows) == 1, (
        f"expected exactly 1 row after concurrent upserts of the same key, got {len(rows)}"
    )


def test_hnsw_index_used_and_similarity_order_correct(db_conn, make_user, make_lecture):
    """Confirms the hnsw index actually serves a nearest-neighbor query and
    match_slides returns results in the correct similarity order (not just
    that the index exists)."""
    prof = make_user(role="professor")
    lecture = make_lecture(prof)

    base = [1.0] * 384 + [0.0] * 384
    close = [0.9] * 384 + [0.1] * 384
    far = [0.0] * 384 + [1.0] * 384

    with db_conn.cursor() as cur:
        for idx, embedding in [(0, base), (1, close), (2, far)]:
            cur.execute(
                """
                INSERT INTO public.slide_embeddings
                    (lecture_id, pdf_hash, slide_index, embedding, content_hash)
                VALUES (%s, 'hnsw-planner-test', %s, %s::vector, %s)
                """,
                (str(lecture), idx, embedding, f"content-{idx}"),
            )

        cur.execute("SET enable_seqscan = off")
        cur.execute(
            "EXPLAIN SELECT id FROM public.slide_embeddings "
            "ORDER BY embedding <=> %s::vector LIMIT 3",
            (base,),
        )
        plan_text = "\n".join(r[0] for r in cur.fetchall())
        cur.execute("SET enable_seqscan = on")

        # match_slides is the deliberately-unscoped global RPC and its LIMIT
        # applies before the outer pdf_hash filter — in the shared
        # session-scoped test DB, other db-test files' rows can occupy the
        # top-N slots ahead of this test's own 3 rows. A generously large
        # candidate count keeps this test correct regardless of how much
        # other fixture data already exists in the table.
        cur.execute(
            "SELECT slide_index, similarity FROM match_slides(%s::vector, -1.0, 1000) "
            "WHERE pdf_hash = 'hnsw-planner-test' ORDER BY similarity DESC",
            (base,),
        )
        rows = cur.fetchall()

    assert "slide_embeddings_vector_idx" in plan_text, (
        f"expected the hnsw index to be used by the planner:\n{plan_text}"
    )
    assert [r[0] for r in rows] == [0, 1, 2]
    assert rows[0][1] == pytest.approx(1.0)
    assert rows[0][1] > rows[1][1] > rows[2][1]
