"""Integration tests for Phase 1 (course-at-once ingestion) batch endpoints:

  POST /api/upload/batch                — multi-file enqueue, per-file isolation
  GET  /api/upload/jobs                 — in-flight/recent runs for the uploads indicator
  GET  /api/upload/batches/{batch_id}   — per-lecture batch review summary
  POST /api/upload/jobs/{run_id}/retry  — retry a FAILED run without re-uploading bytes

These mock upload_service's storage/arq calls and parser.repos' DB calls so
they run fast and offline; the real upsert/COALESCE SQL semantics of
repos.get_or_create_run are covered separately by the -m db e2e suite against
a real Postgres.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

import backend.services.parser.repos as repos_module
from backend.api.v1 import upload as upload_api
from backend.domain.parse_models import ParseRun, RunStatus

PROFESSOR_ID = "00000000-0000-0000-0000-000000000001"
OTHER_ID = "00000000-0000-0000-0000-000000000003"


def _make_run(**overrides) -> ParseRun:
    defaults = dict(
        run_id=uuid4(),
        pdf_hash="a" * 64,
        lecture_id=None,
        pipeline_version="5",
        status=RunStatus.QUEUED,
        page_count=None,
        started_at=datetime.now(timezone.utc),
        finished_at=None,
        outline=None,
        error=None,
        batch_id=None,
        user_id=UUID(PROFESSOR_ID),
        course_id=None,
        filename="a.pdf",
        parsing_mode="ai",
    )
    defaults.update(overrides)
    return ParseRun(**defaults)


@pytest.fixture
def fake_arq_pool(monkeypatch):
    calls = []

    class _FakePool:
        async def enqueue_job(self, name, **kwargs):
            calls.append((name, kwargs))

    async def _get_arq_pool():
        return _FakePool()

    monkeypatch.setattr(upload_api.upload_service, "get_arq_pool", _get_arq_pool)
    return calls


@pytest.fixture
def fake_storage(monkeypatch):
    async def _noop(pdf_hash, content):
        return None

    monkeypatch.setattr(upload_api.upload_service, "upload_pdf_to_storage", _noop)


class TestBatchUpload:
    def test_mixed_valid_and_corrupt_files_isolated(
        self, app_client, patch_supabase, fake_arq_pool, fake_storage, monkeypatch
    ):
        async def fake_validate(filename, content):
            if "corrupt" in (filename or ""):
                raise ValueError("File appears to be corrupted or password-protected.")
            return 3

        monkeypatch.setattr(upload_api.upload_service, "validate_upload", fake_validate)

        created_runs = []

        async def fake_get_or_create_run(pdf_hash, lecture_id, pipeline_version, **kwargs):
            run = _make_run(pdf_hash=pdf_hash, filename=kwargs.get("filename"),
                             batch_id=kwargs.get("batch_id"), course_id=kwargs.get("course_id"),
                             parsing_mode=kwargs.get("parsing_mode"))
            created_runs.append(run)
            return run

        monkeypatch.setattr(repos_module, "get_or_create_run", fake_get_or_create_run)

        r = app_client.post(
            "/api/upload/batch",
            files=[
                ("files", ("good1.pdf", b"%PDF-1.4 fake", "application/pdf")),
                ("files", ("corrupt.pdf", b"not a pdf", "application/pdf")),
                ("files", ("good2.pdf", b"%PDF-1.4 fake2", "application/pdf")),
            ],
            data={"parsing_mode": "ai"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["batch_id"]
        statuses = {f["filename"]: f["status"] for f in body["files"]}
        assert statuses["good1.pdf"] == "queued"
        assert statuses["good2.pdf"] == "queued"
        assert statuses["corrupt.pdf"] == "failed"
        corrupt_entry = next(f for f in body["files"] if f["filename"] == "corrupt.pdf")
        assert corrupt_entry["run_id"] is None
        assert "corrupted" in corrupt_entry["error"]

        # The two good files got real run_ids and share one batch_id; the
        # corrupt file never reached get_or_create_run at all.
        assert len(created_runs) == 2
        good_entries = [f for f in body["files"] if f["status"] == "queued"]
        assert len({f["run_id"] for f in good_entries}) == 2
        assert len({f["pdf_hash"] for f in good_entries}) == 2  # distinct content -> distinct hash

        enqueued_names = [c[0] for c in fake_arq_pool]
        assert enqueued_names == ["parse_pdf_unified", "parse_pdf_unified"]

    def test_pptx_rejected_without_touching_pipeline(
        self, app_client, patch_supabase, fake_arq_pool, fake_storage, monkeypatch
    ):
        called = {"validate": False}

        async def fake_validate(filename, content):
            called["validate"] = True
            return 3

        monkeypatch.setattr(upload_api.upload_service, "validate_upload", fake_validate)

        r = app_client.post(
            "/api/upload/batch",
            files=[("files", ("deck.pptx", b"PK\x03\x04fake", "application/octet-stream"))],
        )
        assert r.status_code == 200
        body = r.json()
        assert body["files"][0]["status"] == "failed"
        assert body["files"][0]["run_id"] is None
        assert not called["validate"]  # rejected before even validating
        assert fake_arq_pool == []

    def test_batch_cap_rejected(self, app_client, patch_supabase):
        from backend.core.config import settings
        files = [
            ("files", (f"f{i}.pdf", b"%PDF-1.4", "application/pdf"))
            for i in range(settings.max_batch_files + 1)
        ]
        r = app_client.post("/api/upload/batch", files=files)
        assert r.status_code == 400
        assert str(settings.max_batch_files) in r.text

    def test_course_ownership_enforced(self, app_client, patch_supabase):
        patch_supabase.seed("courses", [
            {"id": "C1", "professor_id": OTHER_ID},
        ])
        r = app_client.post(
            "/api/upload/batch",
            files=[("files", ("a.pdf", b"%PDF-1.4", "application/pdf"))],
            data={"course_id": "C1"},
        )
        assert r.status_code == 403


class TestListUploadJobs:
    def test_returns_jobs_for_authenticated_user(self, app_client, patch_supabase, monkeypatch):
        run1 = _make_run(status=RunStatus.EXTRACTING, filename="one.pdf")
        run2 = _make_run(status=RunStatus.COMPLETED, filename="two.pdf",
                          lecture_id=uuid4(), finished_at=datetime.now(timezone.utc))

        async def fake_list(user_id, batch_id=None, limit=100):
            return [run1, run2]

        monkeypatch.setattr(repos_module, "list_runs_by_user", fake_list)

        r = app_client.get("/api/upload/jobs")
        assert r.status_code == 200
        jobs = r.json()["jobs"]
        assert len(jobs) == 2
        assert {j["filename"] for j in jobs} == {"one.pdf", "two.pdf"}
        completed = next(j for j in jobs if j["filename"] == "two.pdf")
        assert completed["status"] == "completed"
        assert completed["lecture_id"] is not None


class TestGetBatchSummary:
    def test_returns_per_lecture_rollup(self, app_client, patch_supabase, monkeypatch):
        batch_id = uuid4()

        async def fake_summary(bid, uid):
            assert bid == batch_id
            return [
                {"run_id": uuid4(), "status": "completed", "error": None, "filename": "a.pdf",
                 "lecture_id": uuid4(), "title": "Lecture A", "deck_summary": "Summary A",
                 "slide_count": 10, "quiz_count": 5, "flagged_count": 1},
            ]

        monkeypatch.setattr(repos_module, "get_batch_summary", fake_summary)

        r = app_client.get(f"/api/upload/batches/{batch_id}")
        assert r.status_code == 200
        lectures = r.json()["lectures"]
        assert len(lectures) == 1
        assert lectures[0]["title"] == "Lecture A"
        assert lectures[0]["slide_count"] == 10

    def test_unknown_batch_404s(self, app_client, patch_supabase, monkeypatch):
        async def fake_summary(bid, uid):
            return []

        monkeypatch.setattr(repos_module, "get_batch_summary", fake_summary)
        r = app_client.get(f"/api/upload/batches/{uuid4()}")
        assert r.status_code == 404

    def test_invalid_batch_id_400s(self, app_client, patch_supabase):
        r = app_client.get("/api/upload/batches/not-a-uuid")
        assert r.status_code == 400


class TestRetryRun:
    def test_retry_requires_ownership(self, app_client, patch_supabase, monkeypatch):
        run = _make_run(status=RunStatus.FAILED, user_id=UUID(OTHER_ID))

        async def fake_get(run_id):
            return run

        monkeypatch.setattr(repos_module, "get_run_by_id", fake_get)
        r = app_client.post(f"/api/upload/jobs/{run.run_id}/retry")
        assert r.status_code == 403

    def test_retry_requires_failed_status(self, app_client, patch_supabase, monkeypatch):
        run = _make_run(status=RunStatus.COMPLETED)

        async def fake_get(run_id):
            return run

        monkeypatch.setattr(repos_module, "get_run_by_id", fake_get)
        r = app_client.post(f"/api/upload/jobs/{run.run_id}/retry")
        assert r.status_code == 409

    def test_retry_404_when_missing(self, app_client, patch_supabase, monkeypatch):
        async def fake_get(run_id):
            return None

        monkeypatch.setattr(repos_module, "get_run_by_id", fake_get)
        r = app_client.post(f"/api/upload/jobs/{uuid4()}/retry")
        assert r.status_code == 404

    def test_retry_success_re_enqueues_with_original_params(
        self, app_client, patch_supabase, fake_arq_pool, monkeypatch
    ):
        run = _make_run(
            status=RunStatus.FAILED, parsing_mode="on_demand",
            batch_id=uuid4(), course_id=uuid4(), filename="retry-me.pdf",
        )

        async def fake_get(run_id):
            return run

        statuses_set = []

        async def fake_set_status(run_id, status):
            statuses_set.append(status)

        monkeypatch.setattr(repos_module, "get_run_by_id", fake_get)
        monkeypatch.setattr(repos_module, "set_status", fake_set_status)

        r = app_client.post(f"/api/upload/jobs/{run.run_id}/retry")
        assert r.status_code == 200
        assert r.json()["run_id"] == str(run.run_id)
        assert RunStatus.QUEUED in statuses_set

        assert len(fake_arq_pool) == 1
        name, kwargs = fake_arq_pool[0]
        assert name == "parse_pdf_unified"
        assert kwargs["pdf_hash"] == run.pdf_hash
        assert kwargs["force_reparse"] is True
        # Retry must reproduce the ORIGINAL parsing_mode — a naive retry that
        # always forces "ai" would silently run full LLM synthesis on a file
        # the professor explicitly chose "Skip AI" for.
        assert kwargs["parsing_mode"] == "on_demand"
        assert kwargs["batch_id"] == str(run.batch_id)
        assert kwargs["course_id"] == str(run.course_id)
