"""Regression tests for the P4-2 `list_courses` pagination bug.

docs/ROADMAP_10X_FOUNDATION.md §9 (P4-2): the pre-fix `list_courses`
(`backend/api/v1/courses.py`) fetched `limit + 1` rows, sliced to `limit`,
and only THEN applied the student-visibility filter
(`_student_visible_course_ids`) in Python — with `has_more`/`cursor` computed
against the PRE-filter set. Whenever a page's raw window happened to be
dominated by courses the caller can't see, the response under-filled (or, in
the worst case, returned zero rows while still claiming `has_more=True` with
no `cursor` to continue from — a dead end for the client).

These tests build exactly that scenario against the real endpoint (through
`fake_supabase`, no real DB) and assert the FIXED behavior:
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


def _make_course(fake_supabase, owner_id: str, title: str) -> str:
    row = (
        fake_supabase.table("courses")
        .insert({"professor_id": owner_id, "title": title, "status": "published"})
        .execute()
        .data[0]
    )
    return row["id"]


def test_list_courses_page_dominated_by_invisible_rows_returns_visible_rows_not_a_dead_end(
    client, app, fake_supabase, other_professor_user, student_user
):
    """3 courses the student is enrolled in (created FIRST, so they sort as
    the OLDEST / last page under `created_at desc`), followed by 12 courses
    owned by another professor the student cannot see (created after, so
    they fill the entire first `limit + 1 = 11` window).

    Pre-fix: the raw `limit + 1` fetch is 11 invisible rows; visibility
    filtering then empties the page while `has_more`/`cursor` were computed
    on the unfiltered 11 — response is `data=[]`, `has_more=True`,
    `cursor=None`: a dead end, since the client has nothing to page past yet
    is told more exists.

    Post-fix: the endpoint must surface the 3 actually-visible courses with
    `has_more=False`.
    """
    visible_ids = [
        _make_course(fake_supabase, other_professor_user.id, f"Visible {i}")
        for i in range(3)
    ]
    for cid in visible_ids:
        fake_supabase.table("course_enrollments").insert(
            {"user_id": student_user.id, "course_id": cid}
        ).execute()

    for i in range(12):
        _make_course(fake_supabase, other_professor_user.id, f"Invisible {i}")

    _auth_as(app, student_user)
    resp = client.get("/api/courses", params={"limit": 10})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    returned_ids = {c["id"] for c in body["data"]}
    assert returned_ids == set(visible_ids), (
        f"expected exactly the 3 visible courses, got {len(body['data'])} rows "
        f"(has_more={body['has_more']!r}, cursor={body['cursor']!r})"
    )
    assert body["has_more"] is False
    # A non-empty page must always carry either has_more=False or a usable
    # cursor — never the "more exists but nothing to page with" dead end.
    assert body["cursor"] is not None or not body["has_more"]


def test_list_courses_pagination_returns_exactly_limit_visible_rows_and_walks_the_full_set(
    client, app, fake_supabase, other_professor_user, student_user
):
    """15 visible courses interleaved with 15 invisible ones (30 total). With
    `limit=10`, each page must return EXACTLY 10 visible rows (never fewer,
    never leaking invisible ones) until the visible set is exhausted, and
    paging via the returned cursor must visit all 15 visible rows exactly
    once with no gaps or duplicates.
    """
    visible_ids: list[str] = []
    for i in range(15):
        # Interleave so a naive limit-then-filter window is never uniformly
        # visible or uniformly invisible.
        _make_course(fake_supabase, other_professor_user.id, f"Invisible {i}")
        cid = _make_course(fake_supabase, other_professor_user.id, f"Visible {i}")
        visible_ids.append(cid)
        fake_supabase.table("course_enrollments").insert(
            {"user_id": student_user.id, "course_id": cid}
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
        resp = client.get("/api/courses", params=params)
        assert resp.status_code == 200, resp.text
        body = resp.json()

        page_ids = [c["id"] for c in body["data"]]
        assert set(page_ids) <= set(visible_ids), "an invisible course leaked into a page"
        seen.extend(page_ids)

        if not body["has_more"]:
            break
        assert body["cursor"], "has_more=True but no cursor to continue with"
        cursor = body["cursor"]

    assert len(seen) == len(set(seen)) == 15, (
        f"expected to visit all 15 visible courses exactly once, saw {len(seen)} "
        f"({len(set(seen))} unique)"
    )
    assert set(seen) == set(visible_ids)

    # First page in particular must be exactly `limit` rows, not fewer, even
    # though visible/invisible rows are interleaved 1:1 in creation order.
    first_page = client.get("/api/courses", params={"limit": 10}).json()
    assert len(first_page["data"]) == 10
    assert first_page["has_more"] is True
