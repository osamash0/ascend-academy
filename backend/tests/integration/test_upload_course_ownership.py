"""Course ownership on the upload routes that accept a ``course_id``.

The single-file route ``POST /api/upload/parse-pdf-stream`` used to accept any
``course_id`` and forward it to the parse job, which writes the new lecture
over asyncpg (bypassing RLS) into that course. Because ``require_creator``
admits students, any account that knew a course id could attach a lecture to
somebody else's course. The batch route already checked; both now share
``_assert_owns_course``.

These tests stub everything after the ownership gate (body read, validation,
cache, the streaming parse) so the only thing under test is whether a request
reaches the pipeline.
"""
from __future__ import annotations

import pytest

from backend.api.v1 import upload as upload_api
from backend.core.auth_middleware import verify_token

PROFESSOR_ID = "00000000-0000-0000-0000-000000000001"
STUDENT_ID = "00000000-0000-0000-0000-000000000002"
OTHER_ID = "00000000-0000-0000-0000-000000000003"

FOREIGN_COURSE = "11111111-1111-1111-1111-111111111111"
PROFESSOR_COURSE = "22222222-2222-2222-2222-222222222222"
STUDENT_COURSE = "33333333-3333-3333-3333-333333333333"
MISSING_COURSE = "44444444-4444-4444-4444-444444444444"

PDF = ("files", ("deck.pdf", b"%PDF-1.4 fake", "application/pdf"))


@pytest.fixture
def courses(patch_supabase):
    patch_supabase.seed("courses", [
        {"id": FOREIGN_COURSE, "professor_id": OTHER_ID},
        {"id": PROFESSOR_COURSE, "professor_id": PROFESSOR_ID},
        # Creator uploads: a student who creates a course owns it.
        {"id": STUDENT_COURSE, "professor_id": STUDENT_ID},
    ])
    return patch_supabase


@pytest.fixture
def pipeline(monkeypatch):
    """Stub everything past the gate; record what reached the parse stream."""
    reached: list[dict] = []
    reads: list[str] = []

    async def fake_read(file, max_mb):
        reads.append(file.filename)
        return b"%PDF-1.4 fake"

    async def fake_validate(filename, content):
        return 3

    async def fake_cache(pdf_hash, parsing_mode=None):
        return None

    async def fake_stream(**kwargs):
        reached.append(kwargs)
        yield "data: {}\n\n"

    monkeypatch.setattr(upload_api.upload_service, "read_upload_capped", fake_read)
    monkeypatch.setattr(upload_api.upload_service, "validate_upload", fake_validate)
    monkeypatch.setattr(upload_api, "get_cached_parse", fake_cache)
    monkeypatch.setattr(upload_api.upload_service, "process_pdf_stream", fake_stream)

    # A student's private upload claims a monthly-quota slot before the
    # stream; the real claim is a SECURITY DEFINER RPC over asyncpg.
    async def fake_quota(user_id):
        return {"allowed": True, "uploads_used": 1, "quota_limit": 5}

    from backend.services import materials_service
    monkeypatch.setattr(materials_service, "_increment_quota", fake_quota)
    return {"reached": reached, "reads": reads}


def _as(client, user):
    client.app.dependency_overrides[verify_token] = lambda: user


def _single(client, course_id=None):
    data = {"course_id": course_id} if course_id else {}
    return client.post(
        "/api/upload/parse-pdf-stream",
        files={"file": PDF[1]},
        data=data,
    )


class TestSingleFileUploadCourseOwnership:
    def test_student_cannot_upload_into_another_users_course(
        self, app_client, student_user, courses, pipeline
    ):
        _as(app_client, student_user)
        r = _single(app_client, FOREIGN_COURSE)
        assert r.status_code == 403
        assert "own this course" in r.json()["detail"]
        # Rejected before the body is even read, let alone parsed.
        assert pipeline["reads"] == []
        assert pipeline["reached"] == []

    def test_professor_cannot_upload_into_another_professors_course(
        self, app_client, courses, pipeline
    ):
        r = _single(app_client, FOREIGN_COURSE)
        assert r.status_code == 403
        assert pipeline["reached"] == []

    def test_nonexistent_course_is_indistinguishable_from_a_foreign_one(
        self, app_client, courses, pipeline
    ):
        r_missing = _single(app_client, MISSING_COURSE)
        r_foreign = _single(app_client, FOREIGN_COURSE)
        assert r_missing.status_code == r_foreign.status_code == 403
        assert r_missing.json() == r_foreign.json()
        assert pipeline["reached"] == []

    def test_owner_upload_reaches_the_pipeline_with_the_course(
        self, app_client, courses, pipeline
    ):
        r = _single(app_client, PROFESSOR_COURSE)
        assert r.status_code == 200
        assert len(pipeline["reached"]) == 1
        assert pipeline["reached"][0]["course_id"] == PROFESSOR_COURSE
        assert pipeline["reached"][0]["visibility"] == "course"

    def test_student_owner_of_a_course_may_upload_into_it(
        self, app_client, student_user, courses, pipeline
    ):
        _as(app_client, student_user)
        r = _single(app_client, STUDENT_COURSE)
        assert r.status_code == 200
        assert pipeline["reached"][0]["course_id"] == STUDENT_COURSE

    def test_no_course_id_is_unchanged(self, app_client, student_user, courses, pipeline):
        _as(app_client, student_user)
        r = _single(app_client)
        assert r.status_code == 200
        assert pipeline["reached"][0]["course_id"] is None
        assert pipeline["reached"][0]["visibility"] == "private_student"


class TestBatchUploadCourseOwnership:
    """The batch route had a check already; it now goes through the same
    helper, so pin the behaviour that moved with it."""

    def test_student_cannot_batch_into_another_users_course(
        self, app_client, student_user, courses
    ):
        _as(app_client, student_user)
        r = app_client.post("/api/upload/batch", files=[PDF], data={"course_id": FOREIGN_COURSE})
        assert r.status_code == 403

    def test_batch_into_missing_course_is_403(self, app_client, courses):
        r = app_client.post("/api/upload/batch", files=[PDF], data={"course_id": MISSING_COURSE})
        assert r.status_code == 403


class TestAssertOwnsCourse:
    @pytest.mark.asyncio
    async def test_callers_without_an_id_never_own_anything(self, patch_supabase):
        # An ownerless row must not match an id-less caller via str(None) == str(None).
        patch_supabase.seed("courses", [{"id": FOREIGN_COURSE, "professor_id": None}])
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            await upload_api._assert_owns_course(FOREIGN_COURSE, None)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_ownerless_course_is_owned_by_nobody(self, patch_supabase):
        patch_supabase.seed("courses", [{"id": FOREIGN_COURSE, "professor_id": None}])
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            await upload_api._assert_owns_course(FOREIGN_COURSE, PROFESSOR_ID)
        assert exc.value.status_code == 403
