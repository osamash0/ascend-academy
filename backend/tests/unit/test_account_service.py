"""Unit coverage for GDPR export and non-cascading account-erasure cleanup."""
from __future__ import annotations

import asyncio

from backend.services import account_service


def test_export_user_data_collects_user_rows_and_both_lecture_ownership_paths(
    fake_supabase, monkeypatch
):
    monkeypatch.setattr(account_service, "supabase_admin", fake_supabase)
    fake_supabase.seed("profiles", [{"user_id": "u1", "email": "u1@example.test"}])
    fake_supabase.seed("learning_events", [{"user_id": "u1", "event_type": "slide_view"}])
    fake_supabase.seed(
        "lectures",
        [
            {"id": "professor-lecture", "professor_id": "u1"},
            {"id": "private-upload", "student_owner_id": "u1"},
            {"id": "someone-else", "professor_id": "u2"},
        ],
    )
    fake_supabase.seed("worksheets", [{"id": "w1", "uploaded_by": "u1"}])

    exported = asyncio.run(account_service.export_user_data("u1"))

    assert exported["user_id"] == "u1"
    assert exported["profiles"] == [{"user_id": "u1", "email": "u1@example.test"}]
    assert exported["learning_events"] == [{"user_id": "u1", "event_type": "slide_view"}]
    assert {lecture["id"] for lecture in exported["lectures"]} == {
        "professor-lecture",
        "private-upload",
    }
    assert exported["worksheets_uploaded"] == [{"id": "w1", "uploaded_by": "u1"}]


def test_erasure_cleans_private_data_without_removing_shared_pdf_blob(
    fake_supabase, monkeypatch
):
    monkeypatch.setattr(account_service, "supabase_admin", fake_supabase)
    fake_supabase.seed(
        "lectures",
        [
            {"id": "owned-professor", "professor_id": "u1", "pdf_hash": "solo"},
            {"id": "owned-student", "student_owner_id": "u1", "pdf_hash": "shared"},
            {"id": "other-owner", "professor_id": "u2", "pdf_hash": "shared"},
        ],
    )
    fake_supabase.seed(
        "slide_embeddings",
        [
            {"id": "embedding-1", "lecture_id": "owned-professor"},
            {"id": "embedding-2", "lecture_id": "owned-student"},
            {"id": "embedding-other", "lecture_id": "other-owner"},
        ],
    )
    fake_supabase.seed(
        "worksheets",
        [
            {"id": "worksheet-1", "lecture_id": "owned-professor", "file_url": "u1/worksheet.pdf"},
            {"id": "worksheet-other", "lecture_id": "other-owner", "file_url": "u2/worksheet.pdf"},
        ],
    )

    summary = asyncio.run(account_service.erase_user_storage_and_derived_data("u1"))

    assert summary == {
        "pdf_blobs_deleted": 1,
        "pdf_blobs_retained_shared": 1,
        "worksheet_files_deleted": 1,
        "slide_embeddings_deleted": 2,
    }
    assert fake_supabase.storage.removed == [
        ("pdf-uploads", ["solo.pdf"]),
        ("worksheets", ["u1/worksheet.pdf"]),
    ]
    assert fake_supabase.tables["slide_embeddings"] == [
        {"id": "embedding-other", "lecture_id": "other-owner"}
    ]
