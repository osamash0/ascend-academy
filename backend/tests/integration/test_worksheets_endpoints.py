"""Integration tests for worksheets endpoints."""
from __future__ import annotations

import io
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token, require_professor


@pytest.fixture
def client(app):
    return TestClient(app)


def _auth_as(app, user: SimpleNamespace) -> None:
    app.dependency_overrides[verify_token] = lambda: user
    role = (user.app_metadata or {}).get("role")
    if role == "professor":
        app.dependency_overrides[require_professor] = lambda: user
    else:
        app.dependency_overrides.pop(require_professor, None)


def _seed_lecture(fake, lecture_id: str, professor_id: str) -> None:
    fake.table("lectures").insert({
        "id": lecture_id, "professor_id": professor_id,
        "title": "L", "description": None, "total_slides": 0,
    }).execute()


def test_upload_list_download_delete(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    _seed_lecture(fake_supabase, "lec-1", professor_user.id)

    files = {"file": ("notes.pdf", b"PDF DATA", "application/pdf")}
    r = client.post("/api/lectures/lec-1/worksheets", files=files)
    assert r.status_code == 201, r.text
    ws = r.json()["data"]
    assert ws["title"] == "notes.pdf"
    assert ws["file_url"].startswith("worksheets/lec-1/")
    assert ws["size_bytes"] == len(b"PDF DATA")

    r = client.get("/api/lectures/lec-1/worksheets")
    assert r.status_code == 200
    assert len(r.json()["data"]) == 1

    r = client.get(f"/api/worksheets/{ws['id']}/download_url")
    assert r.status_code == 200, r.text
    assert "url" in r.json()["data"]

    r = client.delete(f"/api/worksheets/{ws['id']}")
    assert r.status_code == 204

    r = client.get("/api/lectures/lec-1/worksheets")
    assert r.json()["data"] == []


def test_upload_rejects_oversize(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    _seed_lecture(fake_supabase, "lec-1", professor_user.id)
    big = b"x" * (26 * 1024 * 1024)
    files = {"file": ("huge.pdf", big, "application/pdf")}
    r = client.post("/api/lectures/lec-1/worksheets", files=files)
    assert r.status_code == 413, r.text


def test_upload_rejects_bad_mime(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    _seed_lecture(fake_supabase, "lec-1", professor_user.id)
    files = {"file": ("evil.exe", b"MZ", "application/x-msdownload")}
    r = client.post("/api/lectures/lec-1/worksheets", files=files)
    assert r.status_code == 400, r.text


def test_other_professor_cannot_upload(client, app, fake_supabase, professor_user, other_professor_user):
    _seed_lecture(fake_supabase, "lec-1", professor_user.id)
    _auth_as(app, other_professor_user)
    files = {"file": ("notes.pdf", b"PDF", "application/pdf")}
    r = client.post("/api/lectures/lec-1/worksheets", files=files)
    assert r.status_code == 403, r.text


def test_rename_worksheet(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    _seed_lecture(fake_supabase, "lec-1", professor_user.id)
    files = {"file": ("a.pdf", b"X", "application/pdf")}
    ws = client.post("/api/lectures/lec-1/worksheets", files=files).json()["data"]

    r = client.patch(f"/api/worksheets/{ws['id']}", json={"title": "Better Name"})
    assert r.status_code == 200
    assert r.json()["data"]["title"] == "Better Name"


def test_student_can_download_when_enrolled(
    client, app, fake_supabase, professor_user, student_user
):
    _auth_as(app, professor_user)
    _seed_lecture(fake_supabase, "lec-1", professor_user.id)
    files = {"file": ("a.pdf", b"X", "application/pdf")}
    ws = client.post("/api/lectures/lec-1/worksheets", files=files).json()["data"]

    fake_supabase.table("assignment_enrollments").insert({
        "user_id": student_user.id, "assignment_id": "a-1",
    }).execute()
    fake_supabase.table("assignment_lectures").insert({
        "assignment_id": "a-1", "lecture_id": "lec-1",
    }).execute()

    _auth_as(app, student_user)
    r = client.get(f"/api/worksheets/{ws['id']}/download_url")
    assert r.status_code == 200, r.text


def test_student_blocked_when_not_enrolled(
    client, app, fake_supabase, professor_user, student_user
):
    _auth_as(app, professor_user)
    _seed_lecture(fake_supabase, "lec-1", professor_user.id)
    files = {"file": ("a.pdf", b"X", "application/pdf")}
    ws = client.post("/api/lectures/lec-1/worksheets", files=files).json()["data"]

    _auth_as(app, student_user)
    r = client.get(f"/api/worksheets/{ws['id']}/download_url")
    assert r.status_code == 404, r.text
