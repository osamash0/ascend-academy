"""DB regression guard for the concept-map endpoint's no-orphan requirement
(Roadmap Phase 3.2 acceptance criterion): deleting a lecture must not leave
an orphaned concept_lectures row a course's concept-map could still surface.

The FK (concept_lectures.lecture_id REFERENCES lectures(id) ON DELETE CASCADE)
was established by the original concept-graph migration
(20260503000011_concept_graph.sql) — this test is a regression guard for that
contract now that a course-level view depends on it, not new schema.

Gated behind the `db` marker (boots a real Postgres via testcontainers).
"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db


def _make_concept(cur, name: str | None = None) -> uuid.UUID:
    cid = uuid.uuid4()
    name = name or f"Concept {cid}"
    cur.execute(
        "INSERT INTO public.concepts (id, canonical_name, name_key) VALUES (%s, %s, %s)",
        (str(cid), name, name.lower()),
    )
    return cid


def test_deleting_lecture_removes_its_concept_lectures_row(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    lecture = make_lecture(prof)
    with db_conn.cursor() as cur:
        concept = _make_concept(cur)
        cur.execute(
            "INSERT INTO public.concept_lectures (concept_id, lecture_id, slide_indices, weight) "
            "VALUES (%s, %s, %s, %s)",
            (str(concept), str(lecture), [0, 1], 1.5),
        )
        cur.execute("DELETE FROM public.lectures WHERE id = %s", (str(lecture),))
        cur.execute(
            "SELECT 1 FROM public.concept_lectures WHERE lecture_id = %s", (str(lecture),)
        )
        remaining = cur.fetchall()
    assert remaining == []


def test_deleting_one_lecture_leaves_other_lectures_appearance_intact(
    db_conn, make_user, make_lecture
):
    """A concept shared by two lectures: deleting one must not orphan the
    other's appearance — the concept-map's remaining view stays correct."""
    prof = make_user(role="professor")
    lec_a = make_lecture(prof, title="Week 1")
    lec_b = make_lecture(prof, title="Week 5")
    with db_conn.cursor() as cur:
        concept = _make_concept(cur)
        cur.execute(
            "INSERT INTO public.concept_lectures (concept_id, lecture_id, slide_indices, weight) "
            "VALUES (%s, %s, %s, %s)",
            (str(concept), str(lec_a), [0], 1.0),
        )
        cur.execute(
            "INSERT INTO public.concept_lectures (concept_id, lecture_id, slide_indices, weight) "
            "VALUES (%s, %s, %s, %s)",
            (str(concept), str(lec_b), [2], 1.0),
        )
        cur.execute("DELETE FROM public.lectures WHERE id = %s", (str(lec_a),))
        cur.execute(
            "SELECT lecture_id FROM public.concept_lectures WHERE concept_id = %s", (str(concept),)
        )
        remaining = [str(r[0]) for r in cur.fetchall()]
    assert remaining == [str(lec_b)]
