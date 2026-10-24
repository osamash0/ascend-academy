"""The AI tutor must respect lecture visibility for every role.

Mirrors the RLS rule ``lecture_visible_to_caller`` (migration
20260710040000): a lecture is readable by any signed-in user unless it is a
``private_student`` upload owned by someone else. Professors additionally may
only chat against their own lectures (pre-existing rule).

Before this test the student branch had no check at all: a student could chat
against — and extract the content of — any lecture by id or pdf_hash.
"""
from __future__ import annotations

import pytest

from backend.services.ai import chat_service

OWNER = "00000000-0000-0000-0000-000000000002"
OTHER = "00000000-0000-0000-0000-000000000009"
PROF = "00000000-0000-0000-0000-000000000001"


@pytest.fixture
def chat(monkeypatch, fake_supabase):
    monkeypatch.setattr(chat_service, "supabase_admin", fake_supabase, raising=True)

    calls: list[dict] = []

    async def _fake_chat_with_lecture(**kwargs):
        calls.append(kwargs)
        return {"reply": "ok", "citations": []}

    monkeypatch.setattr(chat_service, "chat_with_lecture", _fake_chat_with_lecture)
    fake_supabase.seed("lectures", [
        {"id": "L-private", "professor_id": None, "pdf_hash": "h-private",
         "visibility": "private_student", "student_owner_id": OWNER},
        {"id": "L-public", "professor_id": PROF, "pdf_hash": "h-public",
         "visibility": "course", "student_owner_id": None},
    ])
    return calls


async def _chat_as(user_id: str, role: str, **kw):
    return await chat_service.process_chat_request(
        user_id=user_id, user_role=role, slide_text="t", user_message="q",
        chat_history=None, ai_model="auto", **kw,
    )


async def test_student_cannot_chat_against_another_students_private_upload(chat):
    with pytest.raises(PermissionError):
        await _chat_as(OTHER, "student", lecture_id="L-private")
    assert chat == []


async def test_private_upload_is_also_hidden_when_addressed_by_pdf_hash(chat):
    with pytest.raises(PermissionError):
        await _chat_as(OTHER, "student", pdf_hash="h-private")
    assert chat == []


async def test_owner_can_chat_against_own_private_upload(chat):
    res = await _chat_as(OWNER, "student", lecture_id="L-private")
    assert res["reply"] == "ok"
    assert chat[0]["lecture_id"] == "L-private"


async def test_student_can_chat_against_a_course_lecture(chat):
    res = await _chat_as(OTHER, "student", lecture_id="L-public")
    assert res["reply"] == "ok"


async def test_professor_still_limited_to_own_lectures(chat):
    with pytest.raises(PermissionError):
        await _chat_as(OTHER, "professor", lecture_id="L-public")


async def test_session_bound_to_private_upload_is_checked_too(chat, monkeypatch):
    """A session created earlier must not become a side door."""
    from backend.services import chat_memory

    async def _meta(session_id):
        return {"user_id": OTHER, "lecture_id": "L-private"}

    async def _history(session_id, limit=20):
        return []

    monkeypatch.setattr(chat_memory, "get_session_metadata", _meta)
    monkeypatch.setattr(chat_memory, "get_history", _history)

    with pytest.raises(PermissionError):
        await _chat_as(OTHER, "student", session_id="s1")
    assert chat == []
