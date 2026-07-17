"""Branch / error-path / helper coverage to complete api/v1/courses.py.

Complements the CRUD/visibility suites by pinning: the `_is_professor` helper
(dead-but-defined), `_student_visible_course_ids` edge, the browse endpoint,
list pagination branches, every `invalid uid → 401` guard, every
`except Exception → 500` handler, and the small 404/400/skip branches in
get_course / context / concept-map / study-guide / delete / unassign.

Everything routes through the fake Supabase; the two AI-backed services
(course_context_service, study_guide_service) are mocked where a 500 handler
must be exercised. No real network, no LLM.
"""
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.api.v1 import courses as capi
from backend.core.auth_middleware import verify_token, require_student


def _cid() -> str:
    return str(uuid.uuid4())


def _auth(app, user):
    app.dependency_overrides[verify_token] = lambda: user


def _no_id_user(role: str | None = None):
    meta = {"role": role} if role else {}
    return SimpleNamespace(app_metadata=meta, user_metadata={})


@pytest.fixture
def table_raises(monkeypatch):
    """Make every supabase_admin.table(...) call raise → exercises the generic
    500 handlers that wrap the threadpool bodies."""
    def _boom(*a, **k):
        raise RuntimeError("db unavailable")
    monkeypatch.setattr(capi.supabase_admin, "table", _boom)


# ── _is_professor (defined-but-unused helper) ────────────────────────────────

def test_is_professor_true_from_app_metadata():
    assert capi._is_professor(SimpleNamespace(app_metadata={"role": "professor"}, id="p1")) is True


def test_is_professor_true_from_dict_metadata():
    assert capi._is_professor({"app_metadata": {"role": "professor"}, "id": "p1"}) is True


def test_is_professor_db_fallback(patch_supabase):
    patch_supabase.table("user_roles").insert({"user_id": "u9", "role": "professor"}).execute()
    user = SimpleNamespace(app_metadata={"role": "student"}, id="u9")
    assert capi._is_professor(user) is True


def test_is_professor_false_when_no_uid():
    assert capi._is_professor(SimpleNamespace(app_metadata={})) is False


def test_is_professor_false_on_db_error(patch_supabase, monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("db down")
    monkeypatch.setattr(capi.supabase_admin, "table", _boom)
    user = SimpleNamespace(app_metadata={"role": "student"}, id="u1")
    assert capi._is_professor(user) is False


# ── _student_visible_course_ids edge (assignment enrollments, no lectures) ────

def test_student_visible_ids_assignment_without_lectures(patch_supabase):
    patch_supabase.table("course_enrollments").insert(
        {"user_id": "s1", "course_id": "c-direct"}
    ).execute()
    patch_supabase.table("assignment_enrollments").insert(
        {"user_id": "s1", "assignment_id": "a-1"}
    ).execute()
    # assignment_lectures rows exist but carry no lecture_id → lecture_ids empty.
    patch_supabase.table("assignment_lectures").insert(
        {"assignment_id": "a-1", "lecture_id": None}
    ).execute()
    out = capi._student_visible_course_ids("s1")
    assert out == {"c-direct"}


# ── list_courses branches ─────────────────────────────────────────────────────

def test_list_invalid_uid_401(app):
    _auth(app, _no_id_user())
    r = TestClient(app).get("/api/v1/courses")
    assert r.status_code == 401


def test_list_only_archived(app_client, fake_supabase, professor_user):
    fake_supabase.seed("courses", [
        {"id": _cid(), "professor_id": professor_user.id, "title": "Arch",
         "is_archived": True, "created_at": "2026-01-01"},
        {"id": _cid(), "professor_id": professor_user.id, "title": "Active",
         "is_archived": False, "created_at": "2026-01-02"},
    ])
    r = app_client.get("/api/v1/courses?only_archived=true")
    assert r.status_code == 200
    titles = {c["title"] for c in r.json()["data"]}
    assert titles == {"Arch"}


def test_list_cursor_and_has_more(app_client, fake_supabase, professor_user):
    # Seed limit+1 (21) rows so has_more triggers and the slice runs.
    rows = [
        {"id": _cid(), "professor_id": professor_user.id, "title": f"C{i}",
         "is_archived": False, "created_at": f"2026-02-{i+1:02d}"}
        for i in range(21)
    ]
    fake_supabase.seed("courses", rows)
    r = app_client.get("/api/v1/courses?cursor=2026-12-31")
    assert r.status_code == 200
    body = r.json()
    assert body["has_more"] is True
    assert len(body["data"]) == 20


def test_list_500_on_db_error(app_client, table_raises):
    r = app_client.get("/api/v1/courses")
    assert r.status_code == 500


# ── browse_courses ────────────────────────────────────────────────────────────

def test_browse_invalid_uid_401(app):
    _auth(app, _no_id_user())
    r = TestClient(app).get("/api/v1/courses/browse")
    assert r.status_code == 401


def test_browse_returns_published_professor_courses(app_client, fake_supabase, professor_user):
    fake_supabase.seed("user_roles", [{"user_id": professor_user.id, "role": "professor"}])
    cid = _cid()
    fake_supabase.seed("courses", [
        {"id": cid, "professor_id": professor_user.id, "title": "Pub",
         "is_archived": False, "status": "published", "created_at": "2026-03-01"},
        {"id": _cid(), "professor_id": professor_user.id, "title": "Draft",
         "is_archived": False, "status": "draft", "created_at": "2026-03-02"},
    ])
    fake_supabase.seed("lectures", [
        {"id": _cid(), "course_id": cid, "is_archived": False},
    ])
    r = app_client.get("/api/v1/courses/browse")
    assert r.status_code == 200
    data = r.json()["data"]
    assert len(data) == 1
    assert data[0]["title"] == "Pub"
    assert data[0]["professor_id"] is None       # professor identity hidden in catalog
    assert data[0]["lecture_count"] == 1


def test_browse_empty_when_no_professors(app_client, fake_supabase):
    # No user_roles rows → prof_ids empty → sentinel query → no results.
    fake_supabase.seed("courses", [
        {"id": _cid(), "professor_id": "p1", "title": "X",
         "is_archived": False, "status": "published", "created_at": "2026-03-01"},
    ])
    r = app_client.get("/api/v1/courses/browse")
    assert r.status_code == 200
    assert r.json()["data"] == []


def test_browse_cursor_and_has_more(app_client, fake_supabase, professor_user):
    fake_supabase.seed("user_roles", [{"user_id": professor_user.id, "role": "professor"}])
    fake_supabase.seed("courses", [
        {"id": _cid(), "professor_id": professor_user.id, "title": f"C{i}",
         "is_archived": False, "status": "published", "created_at": f"2026-04-{i+1:02d}"}
        for i in range(21)
    ])
    r = app_client.get("/api/v1/courses/browse?cursor=2026-12-31")
    assert r.status_code == 200
    body = r.json()
    assert body["has_more"] is True
    assert len(body["data"]) == 20


def test_browse_500_on_db_error(app_client, table_raises):
    r = app_client.get("/api/v1/courses/browse")
    assert r.status_code == 500


# ── enroll / unenroll guards + 500 ────────────────────────────────────────────

def test_enroll_invalid_uid_401(app):
    _auth(app, _no_id_user("student"))
    r = TestClient(app).post(f"/api/v1/courses/{_cid()}/enroll")
    assert r.status_code == 401


def test_enroll_500_on_db_error(app, authed, student_user, table_raises):
    authed.as_user(student_user)
    r = TestClient(app).post(f"/api/v1/courses/{_cid()}/enroll")
    assert r.status_code == 500


def test_unenroll_invalid_uid_401(app):
    _auth(app, _no_id_user("student"))
    r = TestClient(app).delete(f"/api/v1/courses/{_cid()}/enroll")
    assert r.status_code == 401


def test_unenroll_500_on_db_error(app, authed, student_user, table_raises):
    authed.as_user(student_user)
    r = TestClient(app).delete(f"/api/v1/courses/{_cid()}/enroll")
    assert r.status_code == 500


# ── get_course guards ─────────────────────────────────────────────────────────

def test_get_course_invalid_uid_401(app):
    _auth(app, _no_id_user())
    r = TestClient(app).get(f"/api/v1/courses/{_cid()}")
    assert r.status_code == 401


def test_get_course_missing_404(app_client):
    r = app_client.get(f"/api/v1/courses/{_cid()}")
    assert r.status_code == 404


def test_get_course_non_owner_unpublished_404(app, authed, student_user, fake_supabase):
    authed.as_user(student_user)
    cid = _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": "other",
                                    "title": "Draft", "status": "draft"}])
    r = TestClient(app).get(f"/api/v1/courses/{cid}")
    assert r.status_code == 404  # forbidden collapses to 404 to avoid leaking existence


# ── create / update 500 + icon branch ────────────────────────────────────────

def test_create_500_on_db_error(app_client, table_raises):
    r = app_client.post("/api/v1/courses", json={"title": "T"})
    assert r.status_code == 500


def test_update_icon_field(app_client, fake_supabase, professor_user):
    cid = _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": professor_user.id,
                                    "title": "C", "icon": "old"}])
    r = app_client.patch(f"/api/v1/courses/{cid}", json={"icon": "rocket"})
    assert r.status_code == 200
    assert fake_supabase.table("courses").select("*").eq("id", cid).execute().data[0]["icon"] == "rocket"


def test_update_500_on_db_error(app_client, table_raises):
    r = app_client.patch(f"/api/v1/courses/{_cid()}", json={"title": "X"})
    assert r.status_code == 500


# ── context endpoint guards + 500 ─────────────────────────────────────────────

def test_context_get_invalid_uid_401(app):
    _auth(app, _no_id_user())
    r = TestClient(app).get(f"/api/v1/courses/{_cid()}/context")
    assert r.status_code == 401


def test_context_patch_missing_course_404(app_client):
    r = app_client.patch(f"/api/v1/courses/{_cid()}/context", json={"instructor": "X"})
    assert r.status_code == 404


def test_context_patch_500_on_service_error(app_client, fake_supabase, professor_user, monkeypatch):
    cid = _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": professor_user.id, "title": "C"}])
    import backend.services.course_context_service as ccs

    async def _boom(*a, **k):
        raise RuntimeError("ctx write failed")

    monkeypatch.setattr(ccs, "replace_course_context_fields", _boom)
    r = app_client.patch(f"/api/v1/courses/{cid}/context", json={"instructor": "Dr X"})
    assert r.status_code == 500


# ── concept-map guards + branches + 500 ──────────────────────────────────────

def test_concept_map_invalid_uid_401(app):
    _auth(app, _no_id_user())
    r = TestClient(app).get(f"/api/v1/courses/{_cid()}/concept-map")
    assert r.status_code == 401


def test_concept_map_empty_when_no_concept_lectures(app_client, fake_supabase, professor_user):
    cid = _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": professor_user.id, "title": "C"}])
    fake_supabase.seed("lectures", [{"id": "l1", "course_id": cid, "title": "L1",
                                     "created_at": "2026-01-01", "is_archived": False}])
    # No concept_lectures rows → early [] return.
    r = app_client.get(f"/api/v1/courses/{cid}/concept-map")
    assert r.status_code == 200
    assert r.json()["data"] == []


def test_concept_map_skips_orphan_concept_rows(app_client, fake_supabase, professor_user):
    cid = _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": professor_user.id, "title": "C"}])
    fake_supabase.seed("lectures", [{"id": "l1", "course_id": cid, "title": "L1",
                                     "created_at": "2026-01-01", "is_archived": False}])
    # concept_lectures references a concept_id with no matching concepts row → skipped.
    fake_supabase.seed("concept_lectures", [
        {"concept_id": "missing", "lecture_id": "l1", "slide_indices": [1], "weight": 1.0},
        {"concept_id": "c-real", "lecture_id": "l1", "slide_indices": [2], "weight": 1.0},
    ])
    fake_supabase.seed("concepts", [{"id": "c-real", "canonical_name": "Real Concept"}])
    r = app_client.get(f"/api/v1/courses/{cid}/concept-map")
    assert r.status_code == 200
    data = r.json()["data"]
    assert len(data) == 1
    assert data[0]["canonical_name"] == "Real Concept"


def test_concept_map_500_on_db_error(app_client, table_raises):
    r = app_client.get(f"/api/v1/courses/{_cid()}/concept-map")
    assert r.status_code == 500


# ── study-guide invalid uid ───────────────────────────────────────────────────

def test_study_guide_invalid_uid_401(app, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "feature_study_guide", True, raising=False)
    _auth(app, _no_id_user())
    r = TestClient(app).get(f"/api/v1/courses/{_cid()}/study-guide")
    assert r.status_code == 401


# ── delete / assign / unassign 404 + 500 ─────────────────────────────────────

def test_delete_missing_course_404(app_client):
    r = app_client.delete(f"/api/v1/courses/{_cid()}")
    assert r.status_code == 404


def test_delete_500_on_db_error(app_client, table_raises):
    r = app_client.delete(f"/api/v1/courses/{_cid()}")
    assert r.status_code == 500


def test_assign_500_on_db_error(app_client, table_raises):
    r = app_client.post(f"/api/v1/courses/{_cid()}/lectures/{_cid()}")
    assert r.status_code == 500


def test_unassign_course_not_found_404(app_client, fake_supabase):
    # Course owned by someone else → 404.
    cid = _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": "other", "title": "C"}])
    r = app_client.delete(f"/api/v1/courses/{cid}/lectures/{_cid()}")
    assert r.status_code == 404


def test_unassign_lecture_not_found_404(app_client, fake_supabase, professor_user):
    cid = _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": professor_user.id, "title": "C"}])
    r = app_client.delete(f"/api/v1/courses/{cid}/lectures/{_cid()}")
    assert r.status_code == 404


def test_unassign_500_on_db_error(app_client, table_raises):
    r = app_client.delete(f"/api/v1/courses/{_cid()}/lectures/{_cid()}")
    assert r.status_code == 500


# ── enroll/unenroll handler-level guards behind require_student ───────────────
# require_student already rejects a missing uid, so the handlers' own `if not uid`
# guard is only reachable by injecting a no-id user via the dependency override.

def test_enroll_handler_uid_guard(app):
    from backend.core.auth_middleware import require_student
    app.dependency_overrides[require_student] = lambda: _no_id_user("student")
    r = TestClient(app).post(f"/api/v1/courses/{_cid()}/enroll")
    assert r.status_code == 401


def test_unenroll_handler_uid_guard(app):
    from backend.core.auth_middleware import require_student
    app.dependency_overrides[require_student] = lambda: _no_id_user("student")
    r = TestClient(app).delete(f"/api/v1/courses/{_cid()}/enroll")
    assert r.status_code == 401


def test_unenroll_reraises_httpexception(app, authed, student_user, monkeypatch):
    # If the delete itself raises an HTTPException, the `except HTTPException: raise`
    # branch must propagate it unchanged (not swallow it into a 500).
    from fastapi import HTTPException

    authed.as_user(student_user)

    def _raise_http(*a, **k):
        raise HTTPException(status_code=418, detail="teapot")

    monkeypatch.setattr(capi.supabase_admin, "table", _raise_http)
    r = TestClient(app).delete(f"/api/v1/courses/{_cid()}/enroll")
    assert r.status_code == 418
