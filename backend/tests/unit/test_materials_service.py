"""Unit tests for backend/services/materials_service.py (Roadmap Phase 3.1,
"My Materials"). DB-touching behavior (RLS, the increment_upload_quota RPC
itself) is covered by backend/tests/db/test_student_uploads_rls.py against a
real Postgres; these tests isolate the orchestration order-of-operations in
`create_upload`, mocking out its collaborators.
"""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.services import materials_service
from backend.services.materials_service import QuotaExceededError, _current_period
from backend.services.parser.unified_orchestrator import PIPELINE_VERSION_UNIFIED


def test_student_pipeline_version_is_distinct_from_professor_pipeline():
    """Private uploads must never share a (pdf_hash, pipeline_version) key
    with a professor's — that would trigger the replay-from-someone-else's-
    lecture branch in parse_pdf_unified instead of creating this student's
    own lecture."""
    assert materials_service.STUDENT_PIPELINE_VERSION != PIPELINE_VERSION_UNIFIED
    assert materials_service.STUDENT_PIPELINE_VERSION.startswith(PIPELINE_VERSION_UNIFIED)


def test_current_period_formats_year_month():
    now = datetime(2026, 7, 10, tzinfo=timezone.utc)
    assert _current_period(now) == "2026-07"

    now = datetime(2026, 1, 3, tzinfo=timezone.utc)
    assert _current_period(now) == "2026-01"


@pytest.fixture
def fake_file():
    return SimpleNamespace(filename="notes.pdf")


@pytest.mark.asyncio
async def test_create_upload_short_circuits_on_duplicate_without_touching_quota(fake_file):
    with patch.object(materials_service.upload_service, "read_upload_capped", new=AsyncMock(return_value=b"%PDF-1.4 ...")), \
         patch.object(materials_service.upload_service, "validate_upload", new=AsyncMock(return_value=3)), \
         patch.object(materials_service, "compute_pdf_hash", return_value="deadbeef"), \
         patch.object(materials_service, "find_existing_upload", new=AsyncMock(
             return_value={"id": "lec-1", "title": "notes.pdf", "total_slides": 3, "created_at": None}
         )) as mock_find, \
         patch.object(materials_service, "_increment_quota", new=AsyncMock()) as mock_quota, \
         patch.object(materials_service.upload_service, "upload_pdf_to_storage", new=AsyncMock()) as mock_store, \
         patch.object(materials_service.parser_repos, "get_or_create_run", new=AsyncMock()) as mock_run:

        result = await materials_service.create_upload("user-1", fake_file)

    assert result == {"status": "duplicate", "lecture_id": "lec-1", "title": "notes.pdf"}
    mock_find.assert_awaited_once_with("user-1", "deadbeef")
    mock_quota.assert_not_awaited()
    mock_store.assert_not_awaited()
    mock_run.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_upload_raises_when_quota_exceeded_before_storing_or_enqueueing(fake_file):
    with patch.object(materials_service.upload_service, "read_upload_capped", new=AsyncMock(return_value=b"%PDF-1.4 ...")), \
         patch.object(materials_service.upload_service, "validate_upload", new=AsyncMock(return_value=3)), \
         patch.object(materials_service, "compute_pdf_hash", return_value="deadbeef"), \
         patch.object(materials_service, "find_existing_upload", new=AsyncMock(return_value=None)), \
         patch.object(materials_service, "_increment_quota", new=AsyncMock(
             return_value={"allowed": False, "uploads_used": 5, "quota_limit": 5}
         )), \
         patch.object(materials_service.upload_service, "upload_pdf_to_storage", new=AsyncMock()) as mock_store, \
         patch.object(materials_service.parser_repos, "get_or_create_run", new=AsyncMock()) as mock_run:

        with pytest.raises(QuotaExceededError) as exc_info:
            await materials_service.create_upload("user-1", fake_file)

    assert exc_info.value.limit == 5
    mock_store.assert_not_awaited()
    mock_run.assert_not_awaited()


@pytest.mark.asyncio
async def test_create_upload_happy_path_enqueues_with_private_visibility(fake_file):
    user_id = "11111111-1111-1111-1111-111111111111"
    fake_run = SimpleNamespace(run_id="run-123")
    with patch.object(materials_service.upload_service, "read_upload_capped", new=AsyncMock(return_value=b"%PDF-1.4 ...")), \
         patch.object(materials_service.upload_service, "validate_upload", new=AsyncMock(return_value=3)), \
         patch.object(materials_service, "compute_pdf_hash", return_value="deadbeef"), \
         patch.object(materials_service, "find_existing_upload", new=AsyncMock(return_value=None)), \
         patch.object(materials_service, "_increment_quota", new=AsyncMock(
             return_value={"allowed": True, "uploads_used": 1, "quota_limit": 5}
         )), \
         patch.object(materials_service.upload_service, "upload_pdf_to_storage", new=AsyncMock()) as mock_store, \
         patch.object(materials_service.parser_repos, "get_or_create_run", new=AsyncMock(return_value=fake_run)), \
         patch.object(materials_service.upload_service, "get_arq_pool", new=AsyncMock(
             return_value=SimpleNamespace(enqueue_job=AsyncMock())
         )) as mock_pool_factory:

        result = await materials_service.create_upload(user_id, fake_file)

    assert result["status"] == "queued"
    assert result["run_id"] == "run-123"
    mock_store.assert_awaited_once_with("deadbeef", b"%PDF-1.4 ...")

    enqueue_mock = mock_pool_factory.return_value.enqueue_job
    enqueue_mock.assert_awaited_once()
    _, kwargs = enqueue_mock.call_args
    assert kwargs["visibility"] == "private_student"
    assert kwargs["student_owner_id"] == user_id
    assert kwargs["user_id"] == user_id
    assert "course_id" not in kwargs
    assert "batch_id" not in kwargs


@pytest.mark.asyncio
async def test_create_upload_propagates_validation_error_without_side_effects(fake_file):
    with patch.object(materials_service.upload_service, "read_upload_capped", new=AsyncMock(return_value=b"not a pdf")), \
         patch.object(materials_service.upload_service, "validate_upload", new=AsyncMock(
             side_effect=ValueError("Only PDF and PowerPoint (.pptx) files are supported.")
         )), \
         patch.object(materials_service, "_increment_quota", new=AsyncMock()) as mock_quota:

        with pytest.raises(ValueError):
            await materials_service.create_upload("user-1", fake_file)

    mock_quota.assert_not_awaited()
