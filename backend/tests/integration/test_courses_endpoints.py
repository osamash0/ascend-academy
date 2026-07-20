"""Integration tests for /api/courses/*."""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from fastapi.security import HTTPAuthorizationCredentials

from backend.core.auth_middleware import verify_token, require_professor, security


@pytest.fixture
def client(app):
    return TestClient(app)


def _auth_as(app, user: SimpleNamespace) -> None:
    app.dependency_overrides[verify_token] = lambda: user
    # P2-1: list_courses/get_course/browse_courses now also depend on
    # `security` (HTTPBearer) to build an RLS-enforcing per-user client via
    # analytics_service.get_auth_client — override it same as verify_token so
    # these tests (which send no real Authorization header) don't 500.
    app.dependency_overrides[security] = lambda: HTTPAuthorizationCredentials(
        scheme="Bearer", credentials="fake-token"
    )
    role = (user.app_metadata or {}).get("role")
    if role == "professor":
        app.dependency_overrides[require_professor] = lambda: user
    else:
        app.dependency_overrides.pop(require_professor, None)


def _seed_user_role(fake, uid: str, role: str) -> None:
    fake.table("user_roles").insert({"user_id": uid, "role": role}).execute()


def test_create_list_get_course(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    _seed_user_role(fake_supabase, professor_user.id, "professor")

    r = client.post("/api/courses", json={"title": "Databases", "description": "DB basics"})
    assert r.status_code == 201, r.text
    course = r.json()["data"]
    assert course["title"] == "Databases"
    assert course["lecture_count"] == 0

    r = client.get("/api/courses")
    assert r.status_code == 200
    items = r.json()["data"]
    assert any(c["id"] == course["id"] for c in items)

    r = client.get(f"/api/courses/{course['id']}")
    assert r.status_code == 200
    body = r.json()["data"]
    assert body["title"] == "Databases"
    assert body["lectures"] == []


def test_update_course(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    _seed_user_role(fake_supabase, professor_user.id, "professor")

    cid = client.post("/api/courses", json={"title": "Old"}).json()["data"]["id"]
    r = client.patch(f"/api/courses/{cid}", json={"title": "New", "color": "#fff"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["title"] == "New"
    assert r.json()["data"]["color"] == "#fff"


def test_assign_unassign_lecture(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    _seed_user_role(fake_supabase, professor_user.id, "professor")

    cid = client.post("/api/courses", json={"title": "C"}).json()["data"]["id"]
    fake_supabase.table("lectures").insert({
        "id": "lec-1",
        "professor_id": professor_user.id,
        "title": "L1",
        "description": None,
        "total_slides": 0,
        "course_id": None,
    }).execute()

    r = client.post(f"/api/courses/{cid}/lectures/lec-1")
    assert r.status_code == 200, r.text

    detail = client.get(f"/api/courses/{cid}").json()["data"]
    assert len(detail["lectures"]) == 1
    assert detail["lectures"][0]["id"] == "lec-1"

    r = client.delete(f"/api/courses/{cid}/lectures/lec-1")
    assert r.status_code == 204
    detail = client.get(f"/api/courses/{cid}").json()["data"]
    assert detail["lectures"] == []


def test_delete_nonempty_course_requires_reassign(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    _seed_user_role(fake_supabase, professor_user.id, "professor")

    a = client.post("/api/courses", json={"title": "A"}).json()["data"]["id"]
    b = client.post("/api/courses", json={"title": "B"}).json()["data"]["id"]

    fake_supabase.table("lectures").insert({
        "id": "lec-x",
        "professor_id": professor_user.id,
        "title": "L",
        "description": None,
        "total_slides": 0,
        "course_id": a,
    }).execute()

    # No reassign → 409
    r = client.delete(f"/api/courses/{a}")
    assert r.status_code == 409, r.text

    # With reassign → 204 and lecture moved
    r = client.delete(f"/api/courses/{a}?reassign_to={b}")
    assert r.status_code == 204
    detail = client.get(f"/api/courses/{b}").json()["data"]
    assert any(l["id"] == "lec-x" for l in detail["lectures"])


def test_other_professor_cannot_modify(client, app, fake_supabase, professor_user, other_professor_user):
    _auth_as(app, professor_user)
    _seed_user_role(fake_supabase, professor_user.id, "professor")
    cid = client.post("/api/courses", json={"title": "Mine"}).json()["data"]["id"]

    _auth_as(app, other_professor_user)
    _seed_user_role(fake_supabase, other_professor_user.id, "professor")
    r = client.patch(f"/api/courses/{cid}", json={"title": "Hijack"})
    assert r.status_code == 403


def test_student_course_detail_hides_unenrolled_lectures(
    client, app, fake_supabase, professor_user, student_user
):
    """A student enrolled in *one* lecture of a course must not see other
    lectures of that course — only the lectures their assignments cover.
    """
    _auth_as(app, professor_user)
    _seed_user_role(fake_supabase, professor_user.id, "professor")
    cid = client.post("/api/courses", json={"title": "Mixed"}).json()["data"]["id"]
    # A non-owner student can only reach a course that is published; set it
    # directly (the publish endpoint would require a fully-parsed lecture).
    fake_supabase.table("courses").update({"status": "published"}).eq("id", cid).execute()
    for lid in ("lec-enrolled", "lec-secret"):
        fake_supabase.table("lectures").insert({
            "id": lid, "professor_id": professor_user.id,
            "title": lid, "description": None, "total_slides": 0, "course_id": cid,
        }).execute()
    fake_supabase.table("assignment_enrollments").insert({
        "user_id": student_user.id, "assignment_id": "a-1",
    }).execute()
    fake_supabase.table("assignment_lectures").insert({
        "assignment_id": "a-1", "lecture_id": "lec-enrolled",
    }).execute()

    _auth_as(app, student_user)
    body = client.get(f"/api/courses/{cid}").json()["data"]
    ids = {l["id"] for l in body["lectures"]}
    assert ids == {"lec-enrolled"}, f"unexpected lectures leaked: {ids}"


def test_list_courses_smoke_for_student(client, app, fake_supabase, professor_user, student_user):
    """
    P2-1 (RLS-as-API-boundary): `list_courses` used to filter visibility in
    Python with `_student_visible_course_ids` against the service-role
    `supabase_admin` client — that's what this test originally asserted
    end-to-end here. It's now converted to query through the RLS-enforcing
    per-user client (`analytics_service.get_auth_client`) and relies on the
    `courses` table's own SELECT policies to do the filtering in Postgres.

    `fake_supabase` (this test double) has no RLS engine — patch_supabase
    hands both the "admin" and the "RLS-enforcing" client the exact same
    in-memory fake, so it cannot distinguish an enrolled student from an
    unenrolled one. Cross-tenant visibility for the new RLS-backed path is
    covered instead by the real-Postgres regression test in
    backend/tests/db/test_courses_rls_boundary.py (gated `-m db`), which
    proves a non-enrolled student sees zero rows via the actual `courses`
    RLS policies. This test remains only as an endpoint smoke check —
    verifying the route returns 200 for a student and includes a course
    they're enrolled in via assignment enrollment.
    """
    # Professor creates two courses + lectures
    _auth_as(app, professor_user)
    _seed_user_role(fake_supabase, professor_user.id, "professor")
    c_visible = client.post("/api/courses", json={"title": "Visible"}).json()["data"]["id"]
    fake_supabase.table("lectures").insert({
        "id": "lec-v", "professor_id": professor_user.id,
        "title": "V", "description": None, "total_slides": 0, "course_id": c_visible,
    }).execute()
    # Enrol student in an assignment that covers lec-v
    fake_supabase.table("assignment_enrollments").insert({
        "user_id": student_user.id, "assignment_id": "a-1",
    }).execute()
    fake_supabase.table("assignment_lectures").insert({
        "assignment_id": "a-1", "lecture_id": "lec-v",
    }).execute()

    _auth_as(app, student_user)
    r = client.get("/api/courses")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    ids = {c["id"] for c in body["data"]}
    assert c_visible in ids
