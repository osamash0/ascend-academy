"""DB regression tests for match_slides_by_lecture (Roadmap Foundation 10x,
Phase 1 P1-4 — migration 20260719020001_match_slides_by_lecture.sql).

Before this migration, the single-lecture tutor's retrieval
(backend/services/ai/retrieval.py) queried the UNSCOPED match_slides RPC
with an over-fetched candidate window and filtered to the target lecture in
Python. The core regression this test proves: as the number of OTHER
lectures' embeddings in the corpus grows, an unscoped top-N scan eventually
fills entirely with other lectures' slides and the target lecture's
genuinely-relevant slides silently stop appearing — even though they'd
easily clear the threshold if the scope were applied in SQL first.

Gated behind the `db` marker (boots a real Postgres via testcontainers).
"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db


def _insert_embedding(db_conn, lecture_id, pdf_hash, slide_index, vector, content_hash):
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.slide_embeddings
                (lecture_id, pdf_hash, slide_index, embedding, content_hash)
            VALUES (%s, %s, %s, %s::vector, %s)
            """,
            (str(lecture_id), pdf_hash, slide_index, vector, content_hash),
        )


def test_match_slides_by_lecture_returns_only_target_lecture(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    target = make_lecture(prof, title="Target Lecture")
    other = make_lecture(prof, title="Other Lecture")

    query_vector = [0.1] * 768
    _insert_embedding(db_conn, target, "target-hash", 0, query_vector, "h0")
    _insert_embedding(db_conn, target, "target-hash", 1, query_vector, "h1")
    # A slide in a DIFFERENT lecture with an IDENTICAL embedding (would win
    # every ANN comparison) — must never appear in target-lecture-scoped results.
    _insert_embedding(db_conn, other, "other-hash", 0, query_vector, "h2")

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT lecture_id, slide_index, similarity FROM match_slides_by_lecture "
            "(%s::vector, %s::uuid, NULL, 0.5, 5)",
            (query_vector, str(target)),
        )
        rows = cur.fetchall()

    lecture_ids = {str(r[0]) for r in rows}
    assert lecture_ids == {str(target)}
    assert {r[1] for r in rows} == {0, 1}


def test_match_slides_by_lecture_scales_with_many_other_lectures(db_conn, make_user, make_lecture):
    """The concrete "decays at scale" scenario from the acceptance criteria:
    seed N other lectures' embeddings and confirm the target lecture's
    slide is still returned. An unscoped top-5 scan (the pre-fix behavior)
    would lose the target slide once 5+ other identical-similarity slides
    exist ahead of it in ANN order."""
    prof = make_user(role="professor")
    target = make_lecture(prof, title="Target Lecture")
    query_vector = [0.1] * 768
    # pdf_hash must be globally unique: P3-3's UNIQUE(pdf_hash, slide_index,
    # pipeline_version) constraint spans the whole table, and the db-test
    # session DB isn't truncated between tests — so derive the hash from the
    # unique lecture uuid rather than a fixed string that collides with the
    # sibling test's "target-hash".
    _insert_embedding(db_conn, target, f"scale-{target}", 0, query_vector, "target0")

    # 20 other lectures, each with a slide at the SAME similarity as the
    # target's — enough to have filled (and overflowed) the old unscoped
    # top-5/top-20 candidate window entirely with non-target slides.
    for i in range(20):
        other = make_lecture(prof, title=f"Other Lecture {i}")
        _insert_embedding(db_conn, other, f"scale-{other}", 0, query_vector, f"other{i}")

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT lecture_id, slide_index FROM match_slides_by_lecture "
            "(%s::vector, %s::uuid, NULL, 0.5, 5)",
            (query_vector, str(target)),
        )
        rows = cur.fetchall()

    assert len(rows) == 1
    assert str(rows[0][0]) == str(target)
    assert rows[0][1] == 0


def test_match_slides_by_lecture_scopes_by_pdf_hash_when_lecture_id_absent(db_conn, make_user, make_lecture):
    """Some call sites only have pdf_hash (lecture not yet persisted) —
    confirm the pdf_hash-only scoping path also works and stays isolated
    from other pdf_hash-tagged embeddings."""
    prof = make_user(role="professor")
    lecture = make_lecture(prof)
    query_vector = [0.2] * 768
    _insert_embedding(db_conn, lecture, "hash-a", 0, query_vector, "ha0")
    _insert_embedding(db_conn, lecture, "hash-b", 0, query_vector, "hb0")

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT pdf_hash, slide_index FROM match_slides_by_lecture "
            "(%s::vector, NULL, %s, 0.5, 5)",
            (query_vector, "hash-a"),
        )
        rows = cur.fetchall()

    assert len(rows) == 1
    assert rows[0][0] == "hash-a"


def test_match_slides_by_lecture_returns_nothing_when_no_scope_given(db_conn, make_user, make_lecture):
    """Both p_lecture_id and p_pdf_hash NULL must return zero rows, not a
    global scan — the whole point of this migration is that SQL-side
    scoping is mandatory, never optional."""
    prof = make_user(role="professor")
    lecture = make_lecture(prof)
    query_vector = [0.3] * 768
    _insert_embedding(db_conn, lecture, "some-hash", 0, query_vector, "hx")

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM match_slides_by_lecture (%s::vector, NULL, NULL, 0.5, 5)",
            (query_vector,),
        )
        rows = cur.fetchall()

    assert rows == []
