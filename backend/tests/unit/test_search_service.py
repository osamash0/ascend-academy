"""Unit tests for search_service's course-scoping (DB-mocked).

The DB-level scoping of the new RPCs is covered by
`tests/db/test_global_search_scope.py`. These tests cover the Python layer
above it: which course_ids a caller is allowed to search/ask within, and
that `ask_course` enforces that scope *before* any retrieval or LLM call
runs (roadmap 2.2: "results never include unenrolled ... content").
"""
from __future__ import annotations

import pytest

from backend.services import search_service


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, data):
        self._data = data

    def select(self, *_a, **_kw):
        return self

    def eq(self, *_a, **_kw):
        return self

    def execute(self):
        return _FakeResult(self._data)


class _FakeSupabase:
    def __init__(self, tables: dict):
        self._tables = tables

    def table(self, name):
        return _FakeQuery(self._tables.get(name, []))


# ── _resolve_scope_course_ids ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_scope_professor_returns_own_courses(monkeypatch):
    fake = _FakeSupabase({"courses": [{"id": "c1"}, {"id": "c2"}]})
    monkeypatch.setattr(search_service, "supabase_admin", fake)

    ids = await search_service._resolve_scope_course_ids("prof-1", is_professor=True)

    assert set(ids) == {"c1", "c2"}


@pytest.mark.asyncio
async def test_resolve_scope_student_delegates_to_visible_courses(monkeypatch):
    monkeypatch.setattr(
        search_service, "_student_visible_course_ids", lambda uid: {"c3", "c4"}
    )

    ids = await search_service._resolve_scope_course_ids("student-1", is_professor=False)

    assert set(ids) == {"c3", "c4"}


# ── ask_course authorization ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ask_course_rejects_out_of_scope_course(monkeypatch):
    monkeypatch.setattr(
        search_service, "_resolve_scope_course_ids", lambda *a, **kw: _immediate({"c1"})
    )
    called = {"retrieval": False, "chat": False}

    async def _fail_retrieval(*a, **kw):
        called["retrieval"] = True
        return []

    async def _fail_chat(*a, **kw):
        called["chat"] = True
        return {"reply": "", "citations": [], "grounded": False}

    monkeypatch.setattr(search_service, "retrieve_relevant_slides_course_scoped", _fail_retrieval)
    monkeypatch.setattr(search_service, "chat_with_course", _fail_chat)

    with pytest.raises(PermissionError):
        await search_service.ask_course("student-1", False, "not-my-course", "What is X?")

    assert called["retrieval"] is False, "retrieval must not run before the scope check"
    assert called["chat"] is False, "the LLM must not be called before the scope check"


@pytest.mark.asyncio
async def test_ask_course_allows_in_scope_course(monkeypatch):
    monkeypatch.setattr(
        search_service, "_resolve_scope_course_ids", lambda *a, **kw: _immediate({"c1"})
    )

    async def _fake_retrieval(*a, **kw):
        return [{"lecture_id": "l1", "slide_index": 0, "similarity": 0.9}]

    async def _fake_chat(question, retrieved, **kw):
        return {"reply": "ok", "citations": [], "grounded": True}

    monkeypatch.setattr(search_service, "retrieve_relevant_slides_course_scoped", _fake_retrieval)
    monkeypatch.setattr(search_service, "chat_with_course", _fake_chat)

    result = await search_service.ask_course("student-1", False, "c1", "What is X?")

    assert result["grounded"] is True


# ── global_search short-circuits ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_global_search_blank_query_returns_empty_without_touching_db(monkeypatch):
    def _boom(*_a, **_kw):
        raise AssertionError("must not query the DB for a blank query")

    monkeypatch.setattr(search_service, "_resolve_scope_course_ids", _boom)

    result = await search_service.global_search("student-1", False, "   ")

    assert result == {"lectures": [], "slides": [], "concepts": [], "worksheets": []}


@pytest.mark.asyncio
async def test_global_search_no_accessible_courses_returns_empty(monkeypatch):
    monkeypatch.setattr(
        search_service, "_resolve_scope_course_ids", lambda *a, **kw: _immediate([])
    )

    result = await search_service.global_search("student-1", False, "mitochondria")

    assert result == {"lectures": [], "slides": [], "concepts": [], "worksheets": []}


async def _immediate(value):
    return value
