"""DB test: why an all-zero embedding is actively harmful, not merely useless.

This is the justification test for the application-level guards in
backend/tests/unit/test_embedding_zero_vector_guard.py. It pins down the
actual database behaviour those guards exist to prevent, so nobody later
"simplifies" them away on the assumption that a zero row would just be
ignored by retrieval.

The mechanism, in three steps:

  1. pgvector's cosine distance against a zero vector is NaN -- the metric
     divides by the vector norm, and the zero vector has none:
         SELECT '[0,0,0]'::vector <=> '[1,0,0]'::vector;   -->  NaN

  2. `match_slides_by_lecture` filters on
     `1 - (embedding <=> query) > match_threshold`. Postgres orders NaN as
     GREATER THAN every non-NaN float, so `NaN > 0.65` is TRUE and the zero
     row is NOT excluded by the threshold -- the filter that exists precisely
     to drop irrelevant slides lets it through.

  3. The RPC's ranking, however, is `ORDER BY embedding <=> query` -- that is
     distance ASCENDING, where NaN sorts LAST. So a zero row does not
     outrank genuine matches; it trails them.

Net effect if zeros ever reach the table: they do not displace good results,
but they DO consume the leftover top-k slots whenever fewer than
`match_count` slides genuinely clear the threshold. Retrieval then enriches
each hit with that slide's real text, so an arbitrary, semantically
unrelated slide is injected into the tutor's grounding context -- in exactly
the situation where the tutor should instead be reporting that the topic is
not covered by the material.

An earlier draft of this test asserted that zero rows sort FIRST and displace
a perfect match. That was wrong, and the test caught it: the ORDER BY is on
distance ascending, not similarity descending. The assertions below pin the
real behaviour of both halves -- the filter that fails to exclude, and the
ranking that does contain it.

Gated behind the `db` marker (needs a real Postgres with pgvector).
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.db

DIMS = 768


def _vec(values: list[float]) -> str:
    """Render a Python list as a pgvector literal."""
    return "[" + ",".join(str(v) for v in values) + "]"


def _unit_vector() -> list[float]:
    """A well-formed vector: first component 1, rest 0."""
    return [1.0] + [0.0] * (DIMS - 1)


def _orthogonal_vector() -> list[float]:
    """A well-formed vector orthogonal to _unit_vector (similarity 0)."""
    return [0.0, 1.0] + [0.0] * (DIMS - 2)


def _zero_vector() -> list[float]:
    return [0.0] * DIMS


def _insert_embedding(db_conn, lecture_id, pdf_hash, slide_index, vector, content_hash):
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.slide_embeddings
                (lecture_id, pdf_hash, slide_index, embedding, content_hash)
            VALUES (%s, %s, %s, %s::vector, %s)
            """,
            (str(lecture_id), pdf_hash, slide_index, _vec(vector), content_hash),
        )


# ── the raw pgvector / Postgres behaviour ────────────────────────────────────


def test_cosine_distance_against_zero_vector_is_nan(db_conn):
    """Step 1: the metric is undefined, and pgvector reports NaN."""
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT (%s::vector <=> %s::vector)",
            (_vec(_zero_vector()), _vec(_unit_vector())),
        )
        distance = cur.fetchone()[0]

    assert distance != distance, f"expected NaN, got {distance!r}"


def test_nan_similarity_is_not_excluded_by_the_threshold_filter(db_conn):
    """Step 2: the threshold filter fails to reject a zero row.

    This is the counter-intuitive half. A reader would reasonably assume a
    zero row scores 0 and is filtered out. In fact it scores NaN, and
    Postgres orders NaN above every real float -- so it survives a filter
    that correctly rejects a genuinely poor (orthogonal) match.
    """
    with db_conn.cursor() as cur:
        cur.execute(
            """
            WITH t(label, sim) AS (
              VALUES ('zero',      1 - (%s::vector <=> %s::vector)),
                     ('orthogonal',1 - (%s::vector <=> %s::vector))
            )
            SELECT label, (sim > 0.65) AS passes FROM t
            """,
            (
                _vec(_zero_vector()), _vec(_unit_vector()),
                _vec(_orthogonal_vector()), _vec(_unit_vector()),
            ),
        )
        passes = {r[0]: r[1] for r in cur.fetchall()}

    assert passes["zero"] is True, (
        "NaN > 0.65 is TRUE in Postgres, so the zero row is NOT filtered out"
    )
    assert passes["orthogonal"] is False, "a genuinely poor match IS correctly filtered"


def test_nan_distance_sorts_last_under_the_rpc_ordering(db_conn):
    """Step 3: the ranking does contain the damage.

    `match_slides_by_lecture` orders by `embedding <=> query` -- distance
    ASCENDING -- and NaN sorts last there. So zero rows trail genuine
    matches rather than displacing them.
    """
    with db_conn.cursor() as cur:
        cur.execute(
            """
            WITH t(label, dist) AS (
              VALUES ('perfect', (%s::vector <=> %s::vector)),
                     ('zero',    (%s::vector <=> %s::vector))
            )
            SELECT label FROM t ORDER BY dist
            """,
            (
                _vec(_unit_vector()), _vec(_unit_vector()),
                _vec(_zero_vector()), _vec(_unit_vector()),
            ),
        )
        ordered = [r[0] for r in cur.fetchall()]

    assert ordered == ["perfect", "zero"], (
        f"expected NaN distance to sort last under ASC ordering, got {ordered}"
    )


# ── the consequence through the real retrieval RPC ──────────────────────────


def test_genuine_match_still_outranks_a_zero_row(db_conn, make_user, make_lecture):
    """The reassuring half, end to end: with more genuine matches than slots,
    zero rows are harmless. They lose the ranking."""
    prof = make_user(role="professor")
    lecture = make_lecture(prof, title="Zero Vector Ranking")
    pdf_hash = f"zerorank-{lecture}"

    _insert_embedding(db_conn, lecture, pdf_hash, 0, _unit_vector(), "real-0")
    _insert_embedding(db_conn, lecture, pdf_hash, 1, _zero_vector(), "zero-1")

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT slide_index FROM match_slides_by_lecture "
            "(%s::vector, %s::uuid, NULL, 0.65, 1)",
            (_vec(_unit_vector()), str(lecture)),
        )
        rows = cur.fetchall()

    assert [r[0] for r in rows] == [0], (
        "the perfect match must win the single top-k slot; if this flips, "
        "pgvector or Postgres NaN ordering changed"
    )


def test_zero_vector_row_fills_leftover_topk_slots(db_conn, make_user, make_lecture):
    """The actual hazard, end to end.

    One genuinely relevant slide, one orthogonal slide, one zero-vector
    slide, asking for the top 5. Correct behaviour would return exactly one
    row -- the orthogonal slide is legitimately below threshold and dropped.
    Instead the zero row rides along, because NaN defeats the threshold
    filter, and retrieval will enrich it with that slide's real text and feed
    it to the tutor as grounding context.
    """
    prof = make_user(role="professor")
    lecture = make_lecture(prof, title="Zero Vector Leftover Slots")
    pdf_hash = f"zeroleft-{lecture}"

    _insert_embedding(db_conn, lecture, pdf_hash, 0, _unit_vector(), "real-0")
    _insert_embedding(db_conn, lecture, pdf_hash, 1, _orthogonal_vector(), "orth-1")
    _insert_embedding(db_conn, lecture, pdf_hash, 2, _zero_vector(), "zero-2")

    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT slide_index FROM match_slides_by_lecture "
            "(%s::vector, %s::uuid, NULL, 0.65, 5)",
            (_vec(_unit_vector()), str(lecture)),
        )
        returned = [r[0] for r in cur.fetchall()]

    assert 1 not in returned, "the orthogonal slide is below threshold and must be dropped"
    assert returned == [0, 2], (
        "Behaviour pin: the zero-vector slide (2) is returned alongside the "
        "genuine match (0) despite carrying no semantic signal, because "
        f"NaN > threshold is TRUE in Postgres. Got {returned}. This is why "
        "cache.store_slide_embedding must refuse to write zero vectors."
    )
