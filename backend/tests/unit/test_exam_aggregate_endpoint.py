"""Endpoint-level tests for GET /api/analytics/course/{course_id}/exam-aggregate.

Roadmap P2-2 pilot slice: this endpoint's ownership check
(``_assert_course_owner_async`` in backend/api/v1/analytics.py) was moved off
the sync Supabase REST client (threadpool) onto asyncpg via
``get_db_connection`` / ``handle_db_errors``. No prior test exercised this
endpoint end-to-end (only the pure aggregation helper in
test_exam_aggregate.py), so these are net-new coverage proving the response
shape and the 404/403 semantics are unchanged from the sync version.

A fake asyncpg connection stands in for both the ownership-check `fetchrow`
and `exam_service.get_course_exam_aggregate`'s `fetch` — no real Postgres
needed, mirroring the pattern already used in test_parser_persist.py.
"""
from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import require_professor, verify_token
from backend.services.exam_service import MIN_ATTEMPTS_FOR_AGGREGATE


class _FakeRecord(dict):
    """asyncpg Records support ``r["col"]`` access; dict already does."""


class _FakeConn:
    def __init__(self, course_owner_id: str | None, attempt_rows: list | None = None):
        self._course_owner_id = course_owner_id
        self._attempt_rows = attempt_rows or []
        self.calls: list[tuple] = []

    async def fetchrow(self, query, *args):
        self.calls.append(("fetchrow", query, args))
        if self._course_owner_id is None:
            return None
        return _FakeRecord(professor_id=self._course_owner_id)

    async def fetch(self, query, *args):
        self.calls.append(("fetch", query, args))
        return self._attempt_rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


def _patch_conn(monkeypatch, conn: _FakeConn) -> None:
    import backend.api.v1.analytics as analytics_module
    import backend.services.exam_service as exam_service_module

    async def _get():
        return conn

    monkeypatch.setattr(analytics_module, "get_db_connection", _get)
    monkeypatch.setattr(exam_service_module, "get_db_connection", _get, raising=False)


def _attempt(user_id: str, score: float) -> dict:
    import json
    return {
        "user_id": user_id,
        "score": score,
        "concept_report": json.dumps({"weakest_concepts": []}),
    }


@pytest.fixture
def client(app):
    return TestClient(app)


def test_404_when_course_missing(client, app, professor_user, monkeypatch):
    conn = _FakeConn(course_owner_id=None)
    _patch_conn(monkeypatch, conn)
    app.dependency_overrides[verify_token] = lambda: professor_user
    app.dependency_overrides[require_professor] = lambda: professor_user

    course_id = str(uuid4())
    r = client.get(
        f"/api/analytics/course/{course_id}/exam-aggregate",
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 404


def test_403_when_other_professor(client, app, professor_user, other_professor_user, monkeypatch):
    conn = _FakeConn(course_owner_id=professor_user.id)
    _patch_conn(monkeypatch, conn)
    app.dependency_overrides[verify_token] = lambda: other_professor_user
    app.dependency_overrides[require_professor] = lambda: other_professor_user

    course_id = str(uuid4())
    r = client.get(
        f"/api/analytics/course/{course_id}/exam-aggregate",
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 403


def test_404_when_below_min_attempts(client, app, professor_user, monkeypatch):
    rows = [_attempt(f"user-{i}", 80.0) for i in range(MIN_ATTEMPTS_FOR_AGGREGATE - 1)]
    conn = _FakeConn(course_owner_id=professor_user.id, attempt_rows=rows)
    _patch_conn(monkeypatch, conn)
    app.dependency_overrides[verify_token] = lambda: professor_user
    app.dependency_overrides[require_professor] = lambda: professor_user

    course_id = str(uuid4())
    r = client.get(
        f"/api/analytics/course/{course_id}/exam-aggregate",
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 404


def test_200_with_aggregate_shape_for_owner(client, app, professor_user, monkeypatch):
    rows = [_attempt(f"user-{i}", 80.0) for i in range(MIN_ATTEMPTS_FOR_AGGREGATE)]
    conn = _FakeConn(course_owner_id=professor_user.id, attempt_rows=rows)
    _patch_conn(monkeypatch, conn)
    app.dependency_overrides[verify_token] = lambda: professor_user
    app.dependency_overrides[require_professor] = lambda: professor_user

    course_id = str(uuid4())
    r = client.get(
        f"/api/analytics/course/{course_id}/exam-aggregate",
        headers={"Authorization": "Bearer t"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    # Response shape identical to the pure-function contract already covered
    # in test_exam_aggregate.py — never a per-student row, only the aggregate.
    assert set(data.keys()) == {"n", "total_attempts", "mean_score", "weakest_concepts"}
    assert data["n"] == MIN_ATTEMPTS_FOR_AGGREGATE
    assert data["mean_score"] == 80.0
    assert "user_id" not in str(data)

    # Ownership check ran through the new asyncpg path, not the sync REST one.
    kinds = [c[0] for c in conn.calls]
    assert "fetchrow" in kinds  # _assert_course_owner_async
    assert "fetch" in kinds  # get_course_exam_aggregate
