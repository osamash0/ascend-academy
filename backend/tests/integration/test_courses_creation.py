"""Endpoint tests for course create / edit / delete / assign + title suggestion.

Complements test_courses_admin_endpoints.py / test_courses_endpoints.py by
pinning the branches those don't reach: the LLM-backed title suggestion (mocked
at the OpenAI boundary, incl. its fallbacks), the publish-readiness gate on
update, lecture assignment ownership + private→course conversion, unassign
guards, delete-reassign ownership, and student enroll/unenroll.
"""
import uuid
from types import SimpleNamespace

from fastapi.testclient import TestClient


def _cid() -> str:
    return str(uuid.uuid4())


# ── generate_title_suggestion (LLM mocked at the OpenAI boundary) ─────────────

def _patch_openai(monkeypatch, *, content=None, raises=False):
    import openai

    class _Completions:
        async def create(self, **kwargs):
            if raises:
                raise RuntimeError("litellm unavailable")
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
            )

    class _Chat:
        completions = _Completions()

    class _FakeAsyncOpenAI:
        def __init__(self, *a, **k):
            self.chat = _Chat()

    monkeypatch.setattr(openai, "AsyncOpenAI", _FakeAsyncOpenAI)


def test_title_suggestion_reachable_by_normal_authed_call(app_client, monkeypatch):
    # Regression guard for BUG B2 (fixed): the endpoint used Depends(_user_id) — a
    # plain helper — which made `user` a required query param, 422-ing every real
    # call. It now uses Depends(verify_token) and is reachable with no query param.
    _patch_openai(monkeypatch, content="Databases 101")
    res = app_client.post(
        "/api/v1/courses/generate-title-suggestion", json={"lectures": ["SQL basics"]}
    )
    assert res.status_code == 200
    assert res.json()["title"] == "Databases 101"


def test_title_suggestion_empty_lectures_returns_default(app_client):
    res = app_client.post(
        "/api/v1/courses/generate-title-suggestion", json={"lectures": []}
    )
    assert res.status_code == 200
    assert res.json()["title"] == "My New Course"


def test_title_suggestion_success_strips_quotes(app_client, monkeypatch):
    _patch_openai(monkeypatch, content='  "Intro to Databases"  ')
    res = app_client.post(
        "/api/v1/courses/generate-title-suggestion",
        json={"lectures": ["SQL basics", "Normalization"]},
    )
    assert res.status_code == 200
    assert res.json()["title"] == "Intro to Databases"  # whitespace + quotes stripped


def test_title_suggestion_llm_failure_falls_back(app_client, monkeypatch):
    _patch_openai(monkeypatch, raises=True)
    res = app_client.post(
        "/api/v1/courses/generate-title-suggestion",
        json={"lectures": ["A", "B"]},
    )
    assert res.status_code == 200
    assert res.json()["title"] == "My AI Generated Course"  # graceful fallback


# ── create_course ─────────────────────────────────────────────────────────────

def test_create_course_blank_description_stored_as_null(app_client, fake_supabase):
    res = app_client.post("/api/v1/courses", json={"title": "T", "description": "   "})
    assert res.status_code == 201
    rows = fake_supabase.table("courses").select("*").execute().data
    assert rows[0]["description"] is None


def test_create_course_insert_failure_returns_500(app_client, monkeypatch):
    # Force the insert to return no data → the endpoint raises 500.
    from backend.api.v1 import courses as courses_api

    class _NoData:
        def insert(self, *a, **k):
            return self

        def execute(self):
            return SimpleNamespace(data=[])

    real_table = courses_api.supabase_admin.table

    def _table(name):
        if name == "courses":
            return _NoData()
        return real_table(name)

    monkeypatch.setattr(courses_api.supabase_admin, "table", _table)
    res = app_client.post("/api/v1/courses", json={"title": "T"})
    assert res.status_code == 500


# ── update_course publish gate ────────────────────────────────────────────────

def test_publish_without_parsed_lecture_rejected(app_client, fake_supabase, professor_user):
    cid = _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": professor_user.id,
                                    "title": "C", "status": "draft"}])
    # A lecture exists but has 0 slides → not "ready".
    fake_supabase.seed("lectures", [{"id": _cid(), "course_id": cid,
                                     "professor_id": professor_user.id,
                                     "total_slides": 0, "is_archived": False}])
    res = app_client.patch(f"/api/v1/courses/{cid}", json={"status": "published"})
    assert res.status_code == 400
    assert "fully-parsed lecture" in res.json()["detail"]


def test_publish_with_parsed_lecture_succeeds(app_client, fake_supabase, professor_user):
    cid = _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": professor_user.id,
                                    "title": "C", "status": "draft"}])
    fake_supabase.seed("lectures", [{"id": _cid(), "course_id": cid,
                                     "professor_id": professor_user.id,
                                     "total_slides": 12, "is_archived": False}])
    res = app_client.patch(f"/api/v1/courses/{cid}", json={"status": "published"})
    assert res.status_code == 200
    rows = fake_supabase.table("courses").select("*").eq("id", cid).execute().data
    assert rows[0]["status"] == "published"


def test_update_clears_description_and_updates_color(app_client, fake_supabase, professor_user):
    cid = _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": professor_user.id,
                                    "title": "C", "description": "old", "color": "#000"}])
    res = app_client.patch(f"/api/v1/courses/{cid}", json={"description": "  ", "color": "#fff"})
    assert res.status_code == 200
    rows = fake_supabase.table("courses").select("*").eq("id", cid).execute().data
    assert rows[0]["description"] is None   # blanked → NULL
    assert rows[0]["color"] == "#fff"


def test_update_missing_course_404(app_client):
    res = app_client.patch(f"/api/v1/courses/{_cid()}", json={"title": "X"})
    assert res.status_code == 404


# ── delete_course reassign ownership ──────────────────────────────────────────

def test_delete_reassign_to_not_owned_rejected(app_client, fake_supabase, professor_user):
    cid, other = _cid(), _cid()
    fake_supabase.seed("courses", [
        {"id": cid, "professor_id": professor_user.id, "title": "Mine"},
        {"id": other, "professor_id": "someone_else", "title": "Theirs"},
    ])
    fake_supabase.seed("lectures", [{"id": _cid(), "course_id": cid,
                                     "professor_id": professor_user.id}])
    res = app_client.delete(f"/api/v1/courses/{cid}?reassign_to={other}")
    assert res.status_code == 400
    assert "not found or not owned" in res.json()["detail"]


# ── assign_lecture ────────────────────────────────────────────────────────────

def test_assign_lecture_happy(app_client, fake_supabase, professor_user):
    cid, lid = _cid(), _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": professor_user.id, "title": "C"}])
    fake_supabase.seed("lectures", [{"id": lid, "professor_id": professor_user.id,
                                     "course_id": None, "visibility": "course"}])
    res = app_client.post(f"/api/v1/courses/{cid}/lectures/{lid}")
    assert res.status_code == 200
    rows = fake_supabase.table("lectures").select("*").eq("id", lid).execute().data
    assert rows[0]["course_id"] == cid


def test_assign_private_student_lecture_converts_to_course(app_client, fake_supabase, professor_user):
    cid, lid = _cid(), _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": professor_user.id, "title": "C"}])
    fake_supabase.seed("lectures", [{"id": lid, "student_owner_id": professor_user.id,
                                     "professor_id": None, "course_id": None,
                                     "visibility": "private_student"}])
    res = app_client.post(f"/api/v1/courses/{cid}/lectures/{lid}")
    assert res.status_code == 200
    row = fake_supabase.table("lectures").select("*").eq("id", lid).execute().data[0]
    assert row["visibility"] == "course"
    assert row["professor_id"] == professor_user.id
    assert row["student_owner_id"] is None


def test_assign_lecture_not_owned_forbidden(app_client, fake_supabase, professor_user):
    cid, lid = _cid(), _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": professor_user.id, "title": "C"}])
    fake_supabase.seed("lectures", [{"id": lid, "professor_id": "someone_else"}])
    res = app_client.post(f"/api/v1/courses/{cid}/lectures/{lid}")
    assert res.status_code == 403


def test_assign_lecture_missing_lecture_404(app_client, fake_supabase, professor_user):
    cid = _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": professor_user.id, "title": "C"}])
    res = app_client.post(f"/api/v1/courses/{cid}/lectures/{_cid()}")
    assert res.status_code == 404


def test_assign_lecture_course_not_owned_404(app_client, fake_supabase):
    cid = _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": "someone_else", "title": "C"}])
    res = app_client.post(f"/api/v1/courses/{cid}/lectures/{_cid()}")
    assert res.status_code == 404


# ── unassign_lecture ──────────────────────────────────────────────────────────

def test_unassign_lecture_happy(app_client, fake_supabase, professor_user):
    cid, lid = _cid(), _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": professor_user.id, "title": "C"}])
    fake_supabase.seed("lectures", [{"id": lid, "professor_id": professor_user.id, "course_id": cid}])
    res = app_client.delete(f"/api/v1/courses/{cid}/lectures/{lid}")
    assert res.status_code == 204
    row = fake_supabase.table("lectures").select("*").eq("id", lid).execute().data[0]
    assert row["course_id"] is None


def test_unassign_lecture_not_in_course_400(app_client, fake_supabase, professor_user):
    cid, other, lid = _cid(), _cid(), _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": professor_user.id, "title": "C"}])
    fake_supabase.seed("lectures", [{"id": lid, "professor_id": professor_user.id, "course_id": other}])
    res = app_client.delete(f"/api/v1/courses/{cid}/lectures/{lid}")
    assert res.status_code == 400
    assert "not assigned" in res.json()["detail"]


# ── enroll / unenroll (student) ───────────────────────────────────────────────

def test_enroll_published_course(app, authed, student_user, fake_supabase):
    client = TestClient(app)
    authed.as_user(student_user)
    cid = _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": "prof-x",
                                    "title": "Published", "status": "published"}])
    res = client.post(f"/api/v1/courses/{cid}/enroll")
    assert res.status_code == 200
    assert res.json()["data"]["enrolled"] is True
    enr = fake_supabase.table("course_enrollments").select("*").eq("course_id", cid).execute().data
    assert enr and enr[0]["user_id"] == student_user.id


def test_enroll_unpublished_course_hidden_404(app, authed, student_user, fake_supabase):
    client = TestClient(app)
    authed.as_user(student_user)
    cid = _cid()
    fake_supabase.seed("courses", [{"id": cid, "professor_id": "prof-x",
                                    "title": "Draft", "status": "draft"}])
    res = client.post(f"/api/v1/courses/{cid}/enroll")
    assert res.status_code == 404


def test_enroll_missing_course_404(app, authed, student_user):
    client = TestClient(app)
    authed.as_user(student_user)
    res = client.post(f"/api/v1/courses/{_cid()}/enroll")
    assert res.status_code == 404


def test_unenroll_removes_enrollment(app, authed, student_user, fake_supabase):
    client = TestClient(app)
    authed.as_user(student_user)
    cid = _cid()
    fake_supabase.seed("course_enrollments", [{"user_id": student_user.id, "course_id": cid}])
    res = client.delete(f"/api/v1/courses/{cid}/enroll")
    assert res.status_code == 204
    rows = fake_supabase.table("course_enrollments").select("*").eq("course_id", cid).execute().data
    assert rows == []
