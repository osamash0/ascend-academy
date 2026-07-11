"""Integration tests for practice-sheet attempt submission access control.

The grading math is unit-tested (test_practice_sheet_grading.py); here we pin the
authorization around it, which is where a regression leaks data: students must
not submit on unpublished sheets or lectures they aren't enrolled in, and only
the owning professor may mark an attempt as a preview (a student-supplied
is_preview must be ignored so preview attempts can't pollute analytics).
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token

H = {"Authorization": "Bearer x"}
PROF = "00000000-0000-0000-0000-000000000001"
STUDENT = "00000000-0000-0000-0000-000000000002"


def _seed(fake, *, sheet_status="published", enroll_student=True):
    fake.seed("lectures", [{"id": "L1", "professor_id": PROF, "course_id": "C1"}])
    fake.seed("practice_sheets", [{
        "id": "PS1", "lecture_id": "L1", "kind": "manual",
        "title": "Sheet", "status": sheet_status, "created_by": PROF,
        "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
    }])
    fake.seed("practice_sheet_questions", [{
        "id": "Q1", "sheet_id": "PS1", "order_index": 0, "type": "short_answer",
        "prompt": "2+2?", "choices": None, "correct_answer": "4",
        "explanation": None, "source_quiz_question_id": None,
        "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
    }])
    fake.seed("course_enrollments", [{"user_id": STUDENT, "course_id": "C1"}] if enroll_student else [])
    fake.seed("assignment_enrollments", [])
    fake.seed("practice_attempts", [])


def test_enrolled_student_submits_published_sheet_and_is_graded(app, student_user, patch_supabase):
    _seed(patch_supabase, sheet_status="published", enroll_student=True)
    app.dependency_overrides[verify_token] = lambda: student_user
    r = TestClient(app).post(
        "/api/practice-sheets/PS1/attempts", json={"answers": {"Q1": "4"}}, headers=H
    )
    assert r.status_code == 201
    data = r.json()["data"]
    assert data["score"] == 100.0
    assert data["is_preview"] is False
    assert len(patch_supabase.tables["practice_attempts"]) == 1


def test_student_cannot_submit_on_draft_sheet_404(app, student_user, patch_supabase):
    # Unpublished sheets are hidden from students entirely (404, not 403).
    _seed(patch_supabase, sheet_status="draft", enroll_student=True)
    app.dependency_overrides[verify_token] = lambda: student_user
    r = TestClient(app).post(
        "/api/practice-sheets/PS1/attempts", json={"answers": {"Q1": "4"}}, headers=H
    )
    assert r.status_code == 404
    assert patch_supabase.tables["practice_attempts"] == []


def test_unenrolled_student_is_forbidden_403(app, student_user, patch_supabase):
    _seed(patch_supabase, sheet_status="published", enroll_student=False)
    app.dependency_overrides[verify_token] = lambda: student_user
    r = TestClient(app).post(
        "/api/practice-sheets/PS1/attempts", json={"answers": {"Q1": "4"}}, headers=H
    )
    assert r.status_code == 403
    assert patch_supabase.tables["practice_attempts"] == []


def test_student_supplied_is_preview_is_ignored(app, student_user, patch_supabase):
    # A student must not be able to flag their attempt as a preview (which would
    # exclude it from analytics). Server forces is_preview=False for non-profs.
    _seed(patch_supabase, sheet_status="published", enroll_student=True)
    app.dependency_overrides[verify_token] = lambda: student_user
    r = TestClient(app).post(
        "/api/practice-sheets/PS1/attempts",
        json={"answers": {"Q1": "4"}, "is_preview": True}, headers=H
    )
    assert r.status_code == 201
    assert r.json()["data"]["is_preview"] is False
    assert patch_supabase.tables["practice_attempts"][0]["is_preview"] is False


def test_professor_can_preview_own_sheet(app, professor_user, patch_supabase):
    _seed(patch_supabase, sheet_status="draft", enroll_student=False)
    app.dependency_overrides[verify_token] = lambda: professor_user
    r = TestClient(app).post(
        "/api/practice-sheets/PS1/attempts",
        json={"answers": {"Q1": "wrong"}, "is_preview": True}, headers=H
    )
    assert r.status_code == 201
    body = r.json()["data"]
    assert body["is_preview"] is True       # prof preview honored
    assert body["score"] == 0.0             # graded against the seeded answer
