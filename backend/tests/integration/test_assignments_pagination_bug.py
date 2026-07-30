"""Regression tests for the P4-2 filter-after-limit pagination bug.

docs/ROADMAP_10X_FOUNDATION.md §9 (P4-2): `list_assignments`
(`backend/api/v1/assignments.py`) fetched `limit` rows, then applied the
student-enrollment visibility filter (`_enrolled_assignment_ids`) in Python
— with `has_more`/`cursor` computed against the PRE-filter set. Whenever a
page's raw window happened to be dominated by assignments the caller isn't
enrolled in, the response under-filled (or, in the worst case, returned zero
rows while still claiming `has_more=True` with no `cursor` to continue from —
a dead end for the client).

`list_courses` (`backend/api/v1/courses.py`) had the identical pattern, but
P2-1 (RLS-as-API-boundary) independently eliminated it there by moving
visibility enforcement into Postgres RLS policies — there's no post-filter
left in `list_courses` for this bug class to occur in (see
`backend/tests/db/test_courses_rls_boundary.py` for that endpoint's real-DB
RLS verification instead).

These tests build the dead-end scenario against `list_assignments` through
`fake_supabase` (no real DB) and assert the FIXED behavior:
`paginate_with_predicate` (backend/core/pagination.py) filters each batch
before deciding whether another is needed, so `has_more`/`cursor` are always
computed against what the caller can actually see.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(app):
    return TestClient(app)


def _auth_as(app, user: SimpleNamespace) -> None:
    from backend.core.auth_middleware import verify_token
    app.dependency_overrides[verify_token] = lambda: user


_due_at_counter = 0


def _make_assignment(fake_supabase, owner_id: str, title: str) -> str:
    """`list_assignments` orders/pages by `due_at` ascending, so each call
    needs a strictly-increasing `due_at` to control which page a row lands
    on — a monotonic counter stands in for creation order."""
    global _due_at_counter
    _due_at_counter += 1
    due_at = f"2026-01-{_due_at_counter:02d}T00:00:00+00:00"
    row = (
        fake_supabase.table("assignments")
        .insert({"professor_id": owner_id, "title": title, "course_id": None, "due_at": due_at})
        .execute()
        .data[0]
    )
    return row["id"]


def test_list_assignments_page_dominated_by_invisible_rows_returns_visible_rows_not_a_dead_end(
    client, app, fake_supabase, other_professor_user, student_user
):
    """12 assignments the student is NOT enrolled in, given the EARLIEST
    `due_at` values (so they fill the entire first `limit=10` window under
    ascending `due_at` order), followed by 3 the student IS enrolled in with
    later `due_at` values.

    Pre-fix: the raw `limit` fetch is 10 invisible rows; visibility filtering
    then empties the page while `has_more`/`cursor` were computed on the
    unfiltered 10 — response is `data=[]`, `has_more=True`, `cursor=None`: a
    dead end, since the client has nothing to page past yet is told more
    exists.

    Post-fix: the endpoint must surface the 3 actually-visible assignments
    with `has_more=False`.
    """
    for i in range(12):
        _make_assignment(fake_supabase, other_professor_user.id, f"Invisible {i}")

    visible_ids = [
        _make_assignment(fake_supabase, other_professor_user.id, f"Visible {i}")
        for i in range(3)
    ]
    for aid in visible_ids:
        fake_supabase.table("assignment_enrollments").insert(
            {"user_id": student_user.id, "assignment_id": aid}
        ).execute()

    _auth_as(app, student_user)
    resp = client.get("/api/assignments", params={"limit": 10})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    returned_ids = {a["id"] for a in body["data"]}
    assert returned_ids == set(visible_ids), (
        f"expected exactly the 3 visible assignments, got {len(body['data'])} rows "
        f"(has_more={body['has_more']!r}, cursor={body['cursor']!r})"
    )
    assert body["has_more"] is False
    # A non-empty page must always carry either has_more=False or a usable
    # cursor — never the "more exists but nothing to page with" dead end.
    assert body["cursor"] is not None or not body["has_more"]


def test_list_assignments_pagination_returns_exactly_limit_visible_rows_and_walks_the_full_set(
    client, app, fake_supabase, other_professor_user, student_user
):
    """15 visible assignments interleaved with 15 invisible ones (30 total).
    With `limit=10`, each page must return EXACTLY 10 visible rows (never
    fewer, never leaking invisible ones) until the visible set is exhausted,
    and paging via the returned cursor must visit all 15 visible rows
    exactly once with no gaps or duplicates.
    """
    visible_ids: list[str] = []
    for i in range(15):
        # Interleave so a naive limit-then-filter window is never uniformly
        # visible or uniformly invisible.
        _make_assignment(fake_supabase, other_professor_user.id, f"Invisible {i}")
        aid = _make_assignment(fake_supabase, other_professor_user.id, f"Visible {i}")
        visible_ids.append(aid)
        fake_supabase.table("assignment_enrollments").insert(
            {"user_id": student_user.id, "assignment_id": aid}
        ).execute()

    _auth_as(app, student_user)

    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        pages += 1
        assert pages <= 10, "pagination did not terminate"
        params = {"limit": 10}
        if cursor:
            params["cursor"] = cursor
        resp = client.get("/api/assignments", params=params)
        assert resp.status_code == 200, resp.text
        body = resp.json()

        page_ids = [a["id"] for a in body["data"]]
        assert set(page_ids) <= set(visible_ids), "an invisible assignment leaked into a page"
        seen.extend(page_ids)

        if not body["has_more"]:
            break
        assert body["cursor"], "has_more=True but no cursor to continue with"
        cursor = body["cursor"]

    assert len(seen) == len(set(seen)) == 15, (
        f"expected to visit all 15 visible assignments exactly once, saw {len(seen)} "
        f"({len(set(seen))} unique)"
    )
    assert set(seen) == set(visible_ids)

    # First page in particular must be exactly `limit` rows, not fewer, even
    # though visible/invisible rows are interleaved 1:1 in creation order.
    first_page = client.get("/api/assignments", params={"limit": 10}).json()
    assert len(first_page["data"]) == 10
    assert first_page["has_more"] is True
