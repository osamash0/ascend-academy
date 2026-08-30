"""Access control for the per-lecture concepts endpoint.

Regression: `_verify_access` authorized on `professor_id` or course
membership only. A student-uploaded lecture has `professor_id = NULL` and
(today) `course_id = NULL`, so `c_id` was always `None`, `None` was never in
the accessible-course set, and the endpoint 403'd for the very student who
uploaded the file. Every student-owned lecture in the database was affected.

The canonical model these endpoints should mirror lives in
`localized_content._can_view_lecture`: professor OR student owner OR
enrolment.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.api.v1 import concepts as concepts_module

STUDENT_ID = "f9ab8d7a-d6d1-4657-8f99-fba9b4b91aa6"
OTHER_ID = "11111111-2222-3333-4444-555555555555"
LECTURE_ID = "37fbaf56-e85b-40bb-96c7-882e092554de"


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    """Minimal chainable stub matching the supabase-py surface used here."""

    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def in_(self, *_a, **_k):
        return self

    def execute(self):
        return _Result(self._rows)


def _patch_lectures(monkeypatch, rows):
    """Point the concepts module's supabase_admin at a fixed `lectures` row."""

    class _Admin:
        def table(self, name):
            # Any table other than `lectures` (e.g. the user_roles /
            # enrollments lookups) resolves to "no access" so the test
            # isolates the ownership arm.
            return _Query(rows if name == "lectures" else [])

    monkeypatch.setattr(concepts_module, "supabase_admin", _Admin())


@pytest.fixture
def student_owned_lecture(monkeypatch):
    _patch_lectures(
        monkeypatch,
        [{"id": LECTURE_ID, "course_id": None, "professor_id": None, "student_owner_id": STUDENT_ID}],
    )

    async def _fake_concepts(_lecture_id):
        return [{"id": "c1", "name": "Data Integration"}]

    monkeypatch.setattr(concepts_module, "concepts_for_lecture", _fake_concepts)


def test_owner_of_a_student_uploaded_lecture_can_read_its_concepts(
    app, authed, student_owned_lecture,
):
    authed.as_user(SimpleNamespace(id=STUDENT_ID))
    res = TestClient(app).get(f"/api/v1/concepts/lecture/{LECTURE_ID}")

    # Before the fix this was 403: no professor_id match, and course_id=None
    # is never a member of the accessible-course set.
    assert res.status_code == 200, res.text
    assert res.json()["data"] == [{"id": "c1", "name": "Data Integration"}]


def test_a_stranger_still_cannot_read_another_students_upload(
    app, authed, student_owned_lecture,
):
    """The widened check must grant the owner only — not every authenticated user."""
    authed.as_user(SimpleNamespace(id=OTHER_ID))
    res = TestClient(app).get(f"/api/v1/concepts/lecture/{LECTURE_ID}")

    assert res.status_code == 403


def test_missing_lecture_is_404_not_403(app, authed, monkeypatch):
    _patch_lectures(monkeypatch, [])
    authed.as_user(SimpleNamespace(id=STUDENT_ID))
    res = TestClient(app).get(f"/api/v1/concepts/lecture/{LECTURE_ID}")

    assert res.status_code == 404
