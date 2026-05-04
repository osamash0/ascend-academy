"""Integration tests for /api/assignments/* endpoints.

Covers CRUD + role-based access + the four status values returned by the
status helper.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import (
    require_professor,
    verify_token,
)


def _enroll(fake, assignment_id: str, user_id: str) -> None:
    fake.tables.setdefault("assignment_enrollments", []).append(
        {"assignment_id": assignment_id, "user_id": user_id, "enrolled_at": "2026-01-01"}
    )


def _seed_lecture(fake, lecture_id: str, professor_id: str) -> None:
    fake.tables.setdefault("lectures", []).append(
        {
            "id": lecture_id,
            "professor_id": professor_id,
            "title": f"Lecture {lecture_id}",
            "description": "",
            "total_slides": 5,
            "created_at": "2026-01-01",
            "pdf_url": None,
        }
    )


def _auth_as(app, user) -> None:
    app.dependency_overrides[verify_token] = lambda: user
    # Only bypass the role gate for actual professors so role-enforcement
    # tests (e.g. "student cannot create") still hit the real check.
    role = getattr(user, "app_metadata", {}).get("role")
    if role == "professor":
        app.dependency_overrides[require_professor] = lambda: user
    else:
        app.dependency_overrides.pop(require_professor, None)


def _future() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()


def _past() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()


# ── Create / list / get ──────────────────────────────────────────────────────

class TestCreateAssignment:
    def test_professor_can_create_without_roster(
        self, app, patch_supabase, professor_user
    ):
        """Per spec, only title/lectures/due_at are required at create time."""
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        _seed_lecture(patch_supabase, "L2", professor_user.id)
        _auth_as(app, professor_user)
        client = TestClient(app)

        r = client.post(
            "/api/assignments",
            headers={"Authorization": "Bearer t"},
            json={
                "title": "Week 1",
                "description": "Read lectures 1 and 2",
                "lecture_ids": ["L1", "L2"],
                "due_at": _future(),
                "min_quiz_score": 70,
            },
        )
        assert r.status_code == 201, r.text
        data = r.json()["data"]
        assert data["title"] == "Week 1"
        assert sorted(data["lecture_ids"]) == ["L1", "L2"]
        assert data["min_quiz_score"] == 70
        assert data["student_ids"] == []
        assert len(patch_supabase.tables.get("assignment_lectures", [])) == 2
        # No roster requested → no enrollments inserted.
        assert len(patch_supabase.tables.get("assignment_enrollments", [])) == 0

    def test_professor_can_create_with_roster(
        self, app, patch_supabase, professor_user, student_user
    ):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        _auth_as(app, professor_user)
        client = TestClient(app)
        r = client.post(
            "/api/assignments",
            headers={"Authorization": "Bearer t"},
            json={
                "title": "Week 2",
                "lecture_ids": ["L1"],
                "student_ids": [student_user.id],
                "due_at": _future(),
            },
        )
        assert r.status_code == 201, r.text
        assert r.json()["data"]["student_ids"] == [student_user.id]
        assert len(patch_supabase.tables.get("assignment_enrollments", [])) == 1

    def test_create_rejects_lecture_owned_by_other_professor(
        self, app, patch_supabase, professor_user, other_professor_user
    ):
        _seed_lecture(patch_supabase, "L1", other_professor_user.id)
        _auth_as(app, professor_user)
        client = TestClient(app)
        r = client.post(
            "/api/assignments",
            headers={"Authorization": "Bearer t"},
            json={"title": "Hijack", "lecture_ids": ["L1"], "due_at": _future()},
        )
        assert r.status_code == 403

    def test_create_requires_existing_lectures(self, app, patch_supabase, professor_user):
        _auth_as(app, professor_user)
        client = TestClient(app)
        r = client.post(
            "/api/assignments",
            headers={"Authorization": "Bearer t"},
            json={
                "title": "Bad",
                "lecture_ids": ["does-not-exist"],
                "due_at": _future(),
            },
        )
        assert r.status_code == 400

    def test_student_cannot_create(self, app, patch_supabase, student_user):
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.post(
            "/api/assignments",
            headers={"Authorization": "Bearer t"},
            json={"title": "Nope", "lecture_ids": ["L1"], "due_at": _future()},
        )
        assert r.status_code == 403


class TestListAssignments:
    def _make(self, fake, professor_user, lecture_ids, due_at=None, min_score=None, enroll=None):
        for lid in lecture_ids:
            if not any(l.get("id") == lid for l in fake.tables.get("lectures", [])):
                _seed_lecture(fake, lid, professor_user.id)
        a_id = f"A{len(fake.tables.get('assignments', [])) + 1}"
        fake.tables.setdefault("assignments", []).append(
            {
                "id": a_id,
                "professor_id": professor_user.id,
                "course_id": None,
                "title": f"Assignment {a_id}",
                "description": None,
                "due_at": due_at or _future(),
                "min_quiz_score": min_score,
                "created_at": "2026-01-01",
            }
        )
        for lid in lecture_ids:
            fake.tables.setdefault("assignment_lectures", []).append(
                {"assignment_id": a_id, "lecture_id": lid}
            )
        for sid in enroll or []:
            _enroll(fake, a_id, sid)
        return a_id

    def test_professor_sees_own_assignments(
        self, app, patch_supabase, professor_user, other_professor_user
    ):
        self._make(patch_supabase, professor_user, ["L1"])
        self._make(patch_supabase, other_professor_user, ["L2"])
        _auth_as(app, professor_user)
        client = TestClient(app)
        r = client.get("/api/assignments", headers={"Authorization": "Bearer t"})
        assert r.status_code == 200
        data = r.json()["data"]
        assert len(data) == 1
        assert data[0]["professor_id"] == professor_user.id

    def test_student_sees_all_with_status(
        self, app, patch_supabase, professor_user, student_user
    ):
        # Two lecture assignment, student completed one with passing score.
        a_id = self._make(
            patch_supabase, professor_user, ["L1", "L2"], min_score=50,
            enroll=[student_user.id],
        )
        patch_supabase.tables["student_progress"] = [
            {
                "user_id": student_user.id,
                "lecture_id": "L1",
                "quiz_score": 80,
                "completed_at": "2026-01-02",
            }
        ]
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get("/api/assignments", headers={"Authorization": "Bearer t"})
        assert r.status_code == 200
        data = r.json()["data"]
        assert len(data) == 1
        assert data[0]["status"] == "in_progress"
        assert data[0]["completed_count"] == 1
        assert data[0]["total_count"] == 2

    def test_status_overdue_when_past_due_and_incomplete(
        self, app, patch_supabase, professor_user, student_user
    ):
        self._make(
            patch_supabase, professor_user, ["L1"], due_at=_past(),
            enroll=[student_user.id],
        )
        patch_supabase.tables.setdefault("student_progress", [])
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get("/api/assignments", headers={"Authorization": "Bearer t"})
        assert r.json()["data"][0]["status"] == "overdue"

    def test_status_completed_when_all_lectures_done(
        self, app, patch_supabase, professor_user, student_user
    ):
        self._make(
            patch_supabase, professor_user, ["L1"], min_score=50,
            enroll=[student_user.id],
        )
        patch_supabase.tables["student_progress"] = [
            {
                "user_id": student_user.id,
                "lecture_id": "L1",
                "quiz_score": 90,
                "completed_at": "2026-01-02",
            }
        ]
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get("/api/assignments", headers={"Authorization": "Bearer t"})
        assert r.json()["data"][0]["status"] == "completed"

    def test_status_not_started_when_no_progress(
        self, app, patch_supabase, professor_user, student_user
    ):
        # Enrolled student with zero progress should still see the assignment
        # with status="not_started" — this is the core "newly enrolled" path.
        self._make(patch_supabase, professor_user, ["L1"], enroll=[student_user.id])
        patch_supabase.tables.setdefault("student_progress", [])
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get("/api/assignments", headers={"Authorization": "Bearer t"})
        assert r.json()["data"][0]["status"] == "not_started"

    def test_status_not_completed_if_below_min_quiz_score(
        self, app, patch_supabase, professor_user, student_user
    ):
        self._make(
            patch_supabase, professor_user, ["L1"], min_score=80,
            enroll=[student_user.id],
        )
        patch_supabase.tables["student_progress"] = [
            {
                "user_id": student_user.id,
                "lecture_id": "L1",
                "quiz_score": 60,
                "completed_at": "2026-01-02",
            }
        ]
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get("/api/assignments", headers={"Authorization": "Bearer t"})
        # Lecture is finished but quiz score is below threshold → in_progress.
        assert r.json()["data"][0]["status"] == "in_progress"


# ── Update / delete ─────────────────────────────────────────────────────────

class TestMutateAssignment:
    def _seed_assignment(self, fake, professor_user, lecture_ids):
        for lid in lecture_ids:
            _seed_lecture(fake, lid, professor_user.id)
        fake.tables.setdefault("assignments", []).append(
            {
                "id": "A1",
                "professor_id": professor_user.id,
                "course_id": None,
                "title": "Original",
                "description": None,
                "due_at": _future(),
                "min_quiz_score": None,
                "created_at": "2026-01-01",
            }
        )
        for lid in lecture_ids:
            fake.tables.setdefault("assignment_lectures", []).append(
                {"assignment_id": "A1", "lecture_id": lid}
            )

    def test_owner_can_update_title(self, app, patch_supabase, professor_user):
        self._seed_assignment(patch_supabase, professor_user, ["L1"])
        _auth_as(app, professor_user)
        client = TestClient(app)
        r = client.patch(
            "/api/assignments/A1",
            headers={"Authorization": "Bearer t"},
            json={"title": "Renamed"},
        )
        assert r.status_code == 200
        assert r.json()["data"]["title"] == "Renamed"

    def test_other_professor_cannot_update(
        self, app, patch_supabase, professor_user, other_professor_user
    ):
        self._seed_assignment(patch_supabase, professor_user, ["L1"])
        _auth_as(app, other_professor_user)
        client = TestClient(app)
        r = client.patch(
            "/api/assignments/A1",
            headers={"Authorization": "Bearer t"},
            json={"title": "Hacked"},
        )
        assert r.status_code == 403

    def test_owner_can_delete(self, app, patch_supabase, professor_user):
        self._seed_assignment(patch_supabase, professor_user, ["L1"])
        _auth_as(app, professor_user)
        client = TestClient(app)
        r = client.delete("/api/assignments/A1", headers={"Authorization": "Bearer t"})
        assert r.status_code == 204
        assert all(a["id"] != "A1" for a in patch_supabase.tables.get("assignments", []))

    def test_other_professor_cannot_delete(
        self, app, patch_supabase, professor_user, other_professor_user
    ):
        self._seed_assignment(patch_supabase, professor_user, ["L1"])
        _auth_as(app, other_professor_user)
        client = TestClient(app)
        r = client.delete("/api/assignments/A1", headers={"Authorization": "Bearer t"})
        assert r.status_code == 403

    def test_unauthenticated_returns_401_or_403(self, app, patch_supabase):
        client = TestClient(app)
        r = client.get("/api/assignments")
        assert r.status_code in (401, 403)


# ── /_meta/students (server-side roster lookup) ─────────────────────────────

class TestPatchMinQuizScoreClear:
    def test_patch_can_explicitly_clear_min_quiz_score(
        self, app, patch_supabase, professor_user
    ):
        _seed_lecture(patch_supabase, "L1", professor_user.id)
        a = {
            "id": "A1",
            "professor_id": professor_user.id,
            "title": "T",
            "description": None,
            "course_id": None,
            "due_at": _future(),
            "min_quiz_score": 70,
            "created_at": _future(),
        }
        patch_supabase.tables.setdefault("assignments", []).append(a)
        patch_supabase.tables.setdefault("assignment_lectures", []).append(
            {"assignment_id": "A1", "lecture_id": "L1"}
        )
        _auth_as(app, professor_user)
        client = TestClient(app)
        r = client.patch(
            "/api/assignments/A1",
            headers={"Authorization": "Bearer t"},
            json={"min_quiz_score": None},
        )
        assert r.status_code == 200, r.text
        assert r.json()["data"]["min_quiz_score"] is None
        # And confirm omission leaves it untouched on a subsequent call.
        # (Re-set to 80 then PATCH with no min_quiz_score key.)
        a["min_quiz_score"] = 80
        r2 = client.patch(
            "/api/assignments/A1",
            headers={"Authorization": "Bearer t"},
            json={"title": "T2"},
        )
        assert r2.status_code == 200
        assert r2.json()["data"]["min_quiz_score"] == 80


class TestEnrollableStudents:
    def test_professor_only_sees_their_own_engaged_students(
        self,
        app,
        patch_supabase,
        professor_user,
        other_professor_user,
        student_user,
    ):
        # Professor's own lecture, with a student who progressed on it.
        _seed_lecture(patch_supabase, "L_mine", professor_user.id)
        # Another professor's lecture, with a *different* student.
        _seed_lecture(patch_supabase, "L_other", other_professor_user.id)
        patch_supabase.tables.setdefault("student_progress", []).extend(
            [
                {"user_id": student_user.id, "lecture_id": "L_mine"},
                {"user_id": "stranger-uid", "lecture_id": "L_other"},
            ]
        )
        patch_supabase.tables.setdefault("profiles", []).extend(
            [
                {"user_id": student_user.id, "full_name": "Stu Dent"},
                {"user_id": "stranger-uid", "full_name": "Not Mine"},
            ]
        )
        _auth_as(app, professor_user)
        client = TestClient(app)
        r = client.get(
            "/api/assignments/_meta/students",
            headers={"Authorization": "Bearer t"},
        )
        assert r.status_code == 200
        data = r.json()["data"]
        ids = [s["id"] for s in data]
        # Only "their" student appears; the stranger from another professor
        # is filtered out — least privilege.
        assert ids == [student_user.id]
        # Email is intentionally not part of the response (PII minimization).
        assert "email" not in data[0]

    def test_student_gets_403(self, app, patch_supabase, student_user):
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get(
            "/api/assignments/_meta/students",
            headers={"Authorization": "Bearer t"},
        )
        assert r.status_code == 403


# ── Visibility / access scoping ─────────────────────────────────────────────

class TestStudentVisibility:
    """Students see only assignments they are explicitly enrolled in.

    Visibility flows from `assignment_enrollments` rows — both at the API
    layer (these tests) and at the DB layer (RLS in
    `20260503000009_assignments.sql`).
    """

    def _seed(self, fake, professor_user, lecture_ids, a_id="A1", enroll=None):
        for lid in lecture_ids:
            _seed_lecture(fake, lid, professor_user.id)
        fake.tables.setdefault("assignments", []).append(
            {
                "id": a_id,
                "professor_id": professor_user.id,
                "course_id": None,
                "title": f"{a_id} title",
                "description": None,
                "due_at": _future(),
                "min_quiz_score": None,
                "created_at": "2026-01-01",
            }
        )
        for lid in lecture_ids:
            fake.tables.setdefault("assignment_lectures", []).append(
                {"assignment_id": a_id, "lecture_id": lid}
            )
        for sid in enroll or []:
            _enroll(fake, a_id, sid)

    def test_unenrolled_student_sees_no_assignments(
        self, app, patch_supabase, professor_user, student_user
    ):
        self._seed(patch_supabase, professor_user, ["L1"])  # no enrollments
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get("/api/assignments", headers={"Authorization": "Bearer t"})
        assert r.status_code == 200
        assert r.json()["data"] == []

    def test_student_only_sees_assignments_they_are_enrolled_in(
        self, app, patch_supabase, professor_user, other_professor_user, student_user
    ):
        self._seed(patch_supabase, professor_user, ["L1"], a_id="A1", enroll=[student_user.id])
        # Same professor, second assignment, student NOT enrolled.
        self._seed(patch_supabase, professor_user, ["L2"], a_id="A2")
        # Different professor, student also NOT enrolled.
        self._seed(patch_supabase, other_professor_user, ["L9"], a_id="A3")
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get("/api/assignments", headers={"Authorization": "Bearer t"})
        ids = [a["id"] for a in r.json()["data"]]
        assert ids == ["A1"]

    def test_newly_enrolled_student_sees_not_started(
        self, app, patch_supabase, professor_user, student_user
    ):
        # Enrollment exists but the student has zero progress — must still
        # see the assignment with status="not_started" so they can start it.
        self._seed(patch_supabase, professor_user, ["L1"], a_id="A1", enroll=[student_user.id])
        patch_supabase.tables["student_progress"] = []
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get("/api/assignments", headers={"Authorization": "Bearer t"})
        data = r.json()["data"]
        assert len(data) == 1
        assert data[0]["status"] == "not_started"

    def test_get_by_id_404_for_unenrolled_student(
        self, app, patch_supabase, professor_user, student_user
    ):
        self._seed(patch_supabase, professor_user, ["L1"], a_id="A1")  # no enrollment
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get("/api/assignments/A1", headers={"Authorization": "Bearer t"})
        # 404 (not 403) so we don't leak existence to unauthorised callers.
        assert r.status_code == 404

    def test_get_by_id_404_for_other_professor(
        self, app, patch_supabase, professor_user, other_professor_user
    ):
        self._seed(patch_supabase, professor_user, ["L1"], a_id="A1")
        _auth_as(app, other_professor_user)
        client = TestClient(app)
        r = client.get("/api/assignments/A1", headers={"Authorization": "Bearer t"})
        assert r.status_code == 404

    def test_owner_can_get_own_by_id(self, app, patch_supabase, professor_user):
        self._seed(patch_supabase, professor_user, ["L1"], a_id="A1")
        _auth_as(app, professor_user)
        client = TestClient(app)
        r = client.get("/api/assignments/A1", headers={"Authorization": "Bearer t"})
        assert r.status_code == 200
        assert r.json()["data"]["id"] == "A1"

    def test_enrolled_student_can_get_by_id(
        self, app, patch_supabase, professor_user, student_user
    ):
        self._seed(patch_supabase, professor_user, ["L1"], a_id="A1", enroll=[student_user.id])
        _auth_as(app, student_user)
        client = TestClient(app)
        r = client.get("/api/assignments/A1", headers={"Authorization": "Bearer t"})
        assert r.status_code == 200
        assert r.json()["data"]["id"] == "A1"
