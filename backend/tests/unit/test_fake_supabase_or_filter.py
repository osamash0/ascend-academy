"""Fidelity tests for `fake_supabase`'s PostgREST or-filter emulation.

The double is only useful if it filters the way PostgREST does. It previously
split the or-filter string on every comma before parsing clauses, which
shredded parenthesised `in.(...)` lists: `id.in.(a,b)` became `id.in.(a` plus
a stray `b)`, so only the first id ever matched and the rest were dropped with
no error. `list_courses` builds exactly that shape --
`professor_id.eq.<uid>,id.in.(<ids>)` -- so any test covering a caller with
two or more enrolled courses was silently under-testing.
"""
from __future__ import annotations

import pytest

from backend.tests.fake_supabase import (
    FakeSupabaseClient,
    _or_clause_matches,
    _split_or_clauses,
)


# ── the splitter ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "value,expected",
    [
        ("professor_id.eq.u1", ["professor_id.eq.u1"]),
        ("a.eq.1,b.eq.2", ["a.eq.1", "b.eq.2"]),
        # the regression: commas inside (...) must NOT split
        ("id.in.(x,y)", ["id.in.(x,y)"]),
        ("professor_id.eq.u1,id.in.(x,y)", ["professor_id.eq.u1", "id.in.(x,y)"]),
        ("id.in.(x,y,z),status.eq.published", ["id.in.(x,y,z)", "status.eq.published"]),
        ("id.in.()", ["id.in.()"]),
        ("", []),
    ],
)
def test_split_or_clauses_is_paren_aware(value, expected):
    assert _split_or_clauses(value) == expected


# ── clause evaluation ───────────────────────────────────────────────────────


def test_or_clause_matches_every_member_of_a_multi_id_in_list():
    """The actual bug: previously only "x" matched and "y"/"z" were dropped."""
    f = "id.in.(x,y,z)"
    assert _or_clause_matches({"id": "x"}, f)
    assert _or_clause_matches({"id": "y"}, f), "second id in the IN list was dropped"
    assert _or_clause_matches({"id": "z"}, f), "third id in the IN list was dropped"
    assert not _or_clause_matches({"id": "q"}, f)


def test_or_clause_matches_eq_branch_or_in_branch():
    f = "professor_id.eq.prof-1,id.in.(c1,c2)"
    assert _or_clause_matches({"professor_id": "prof-1", "id": "other"}, f)
    assert _or_clause_matches({"professor_id": "prof-2", "id": "c2"}, f)
    assert not _or_clause_matches({"professor_id": "prof-2", "id": "c9"}, f)


def test_or_clause_empty_in_list_matches_nothing():
    assert not _or_clause_matches({"id": "c1"}, "id.in.()")


def test_or_clause_supports_is_null_and_gt():
    assert _or_clause_matches({"deleted_at": None}, "deleted_at.is.null")
    assert _or_clause_matches({"created_at": "2026-05-01"}, "created_at.gt.2026-01-01")
    assert not _or_clause_matches({"created_at": "2025-05-01"}, "created_at.gt.2026-01-01")


# ── end-to-end through the query builder ────────────────────────────────────


def _seed(fake: FakeSupabaseClient) -> None:
    for cid, prof in [("c1", "p1"), ("c2", "p2"), ("c3", "p2"), ("c4", "p3")]:
        fake.table("courses").insert({"id": cid, "professor_id": prof}).execute()


def test_query_builder_or_returns_all_ids_in_a_multi_id_in_list():
    fake = FakeSupabaseClient()
    _seed(fake)

    rows = (
        fake.table("courses")
        .select("id, professor_id")
        .or_("professor_id.eq.p1,id.in.(c2,c3)")
        .execute()
        .data
    )

    assert {r["id"] for r in rows} == {"c1", "c2", "c3"}, (
        "expected the owned row plus BOTH ids from the IN list"
    )


def test_query_builder_or_composes_with_a_following_eq():
    """`.or_(...).eq(...)` must AND the two, as PostgREST does."""
    fake = FakeSupabaseClient()
    for cid, prof, archived in [
        ("c1", "p1", False),
        ("c2", "p2", False),
        ("c3", "p2", True),
    ]:
        fake.table("courses").insert(
            {"id": cid, "professor_id": prof, "is_archived": archived}
        ).execute()

    rows = (
        fake.table("courses")
        .select("id")
        .or_("professor_id.eq.p1,id.in.(c2,c3)")
        .eq("is_archived", False)
        .execute()
        .data
    )

    assert {r["id"] for r in rows} == {"c1", "c2"}, "archived row should be excluded"
