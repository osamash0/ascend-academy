"""Unit tests for Roadmap Phase 5.2 ("regenerate with feedback"):
tutor_service.regenerate_slide's instruction persistence/reuse and the new
undo_regenerate_slide single-level undo.

regenerate_slide talks to Supabase via a fluent postgrest-style client
(client.table(...).select(...).eq(...).maybe_single().execute()), plus a real
PDF download + vision call — none of which existed test coverage for before
this pass. These tests fake the client and stub the download/vision/extract
steps so the persistence logic (the actual new behavior) runs for real.
"""
from __future__ import annotations

import types

import pytest

from backend.services.ai import tutor_service


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, table_name, rows_by_id, updates):
        self._table = table_name
        self._rows_by_id = rows_by_id
        self._updates = updates
        self._filter_id = None
        self._update_payload = None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        if col == "id":
            self._filter_id = val
        return self

    def maybe_single(self):
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def delete(self):
        return self

    def insert(self, _payload):
        return self

    def execute(self):
        if self._update_payload is not None:
            self._updates.append((self._table, self._filter_id, dict(self._update_payload)))
            row = self._rows_by_id.get(self._filter_id)
            if row is not None:
                row.update(self._update_payload)
            return _FakeResult(None)
        return _FakeResult(self._rows_by_id.get(self._filter_id))


class _FakeClient:
    def __init__(self, rows_by_id):
        self._rows_by_id = rows_by_id
        self.updates = []
        self.postgrest = types.SimpleNamespace(auth=lambda _token: None)

    def table(self, name):
        return _FakeQuery(name, self._rows_by_id, self.updates)


PROF_ID = "prof-1"
OTHER_PROF_ID = "prof-2"


def _slide_row(**overrides):
    row = {
        "slide_number": 3,
        "lecture_id": "lec-1",
        "title": "Old Title",
        "content_text": "Old body",
        "summary": "Old summary",
        "regen_instruction": None,
        "previous_version": None,
        "lectures": {"pdf_url": "https://x.supabase.co/storage/v1/object/lecture-pdfs/x.pdf", "professor_id": PROF_ID},
    }
    row.update(overrides)
    return row


def _patch_regenerate_internals(monkeypatch, quiz=None):
    monkeypatch.setattr(tutor_service, "_validate_supabase_storage_url", lambda *_a, **_k: None)

    async def fake_to_thread(fn, *args, **kwargs):
        name = getattr(fn, "__name__", "")
        if name == "_download":
            return b"%PDF-fake"
        if name == "_extract":
            return b"jpegbytes", "raw text from page"
        return fn(*args, **kwargs)

    monkeypatch.setattr(tutor_service.asyncio, "to_thread", fake_to_thread)

    captured_context = {}

    async def fake_vision(b64, raw_text, ai_model="groq", blueprint_context=""):
        captured_context["blueprint_context"] = blueprint_context
        return {
            "metadata": {"lecture_title": "New Title"},
            "content_extraction": {"summary": "New summary", "main_topic": "New Topic"},
            "quiz": quiz,
        }

    monkeypatch.setattr(tutor_service, "analyze_slide_vision", fake_vision)
    monkeypatch.setattr(tutor_service.analytics_cache, "invalidate_course_overview_for_lecture", lambda *_a, **_k: None)
    return captured_context


async def test_regenerate_persists_new_instruction(monkeypatch):
    rows = {"slide-1": _slide_row()}
    client = _FakeClient(rows)
    monkeypatch.setattr("backend.core.database.create_client", lambda *_a, **_k: client)
    ctx = _patch_regenerate_internals(monkeypatch)

    result = await tutor_service.regenerate_slide(
        "slide-1", PROF_ID, "openai", "tok", instruction="Focus on the proof steps."
    )

    assert result["regen_instruction"] == "Focus on the proof steps."
    assert rows["slide-1"]["regen_instruction"] == "Focus on the proof steps."
    assert "Focus on the proof steps." in ctx["blueprint_context"]
    # The frontend patches its local slide state from this normalized shape.
    # format_slide_content({"main_topic": "New Topic", "summary": "New summary"}) == "## New Topic"
    assert result["slide"] == {
        "id": "slide-1",
        "title": "New Title",
        "content_text": "## New Topic",
        "summary": "New summary",
        "regen_instruction": "Focus on the proof steps.",
    }


async def test_regenerate_reuses_persisted_instruction_when_omitted(monkeypatch):
    rows = {"slide-1": _slide_row(regen_instruction="Keep it brief.")}
    client = _FakeClient(rows)
    monkeypatch.setattr("backend.core.database.create_client", lambda *_a, **_k: client)
    ctx = _patch_regenerate_internals(monkeypatch)

    result = await tutor_service.regenerate_slide("slide-1", PROF_ID, "openai", "tok", instruction=None)

    assert result["regen_instruction"] == "Keep it brief."
    assert "Keep it brief." in ctx["blueprint_context"]


async def test_regenerate_new_instruction_overrides_persisted_one(monkeypatch):
    rows = {"slide-1": _slide_row(regen_instruction="Old instruction.")}
    client = _FakeClient(rows)
    monkeypatch.setattr("backend.core.database.create_client", lambda *_a, **_k: client)
    ctx = _patch_regenerate_internals(monkeypatch)

    result = await tutor_service.regenerate_slide("slide-1", PROF_ID, "openai", "tok", instruction="New instruction.")

    assert result["regen_instruction"] == "New instruction."
    assert "New instruction." in ctx["blueprint_context"]
    assert "Old instruction." not in ctx["blueprint_context"]


async def test_regenerate_snapshots_previous_version_before_overwriting(monkeypatch):
    rows = {"slide-1": _slide_row(title="Old Title", content_text="Old body", summary="Old summary")}
    client = _FakeClient(rows)
    monkeypatch.setattr("backend.core.database.create_client", lambda *_a, **_k: client)
    _patch_regenerate_internals(monkeypatch)

    await tutor_service.regenerate_slide("slide-1", PROF_ID, "openai", "tok")

    assert rows["slide-1"]["previous_version"] == {
        "title": "Old Title",
        "content_text": "Old body",
        "summary": "Old summary",
    }
    # And the row was actually overwritten with the new content.
    assert rows["slide-1"]["title"] == "New Title"


async def test_regenerate_rejects_non_owner(monkeypatch):
    rows = {"slide-1": _slide_row()}
    client = _FakeClient(rows)
    monkeypatch.setattr("backend.core.database.create_client", lambda *_a, **_k: client)
    _patch_regenerate_internals(monkeypatch)

    with pytest.raises(PermissionError):
        await tutor_service.regenerate_slide("slide-1", OTHER_PROF_ID, "openai", "tok")


async def test_regenerate_missing_slide_raises_not_found(monkeypatch):
    client = _FakeClient({})
    monkeypatch.setattr("backend.core.database.create_client", lambda *_a, **_k: client)
    _patch_regenerate_internals(monkeypatch)

    with pytest.raises(FileNotFoundError):
        await tutor_service.regenerate_slide("nope", PROF_ID, "openai", "tok")


# ── undo_regenerate_slide ──────────────────────────────────────────────────

async def test_undo_restores_previous_version_and_clears_snapshot(monkeypatch):
    rows = {
        "slide-1": {
            "title": "New Title",
            "content_text": "New body",
            "summary": "New summary",
            "previous_version": {"title": "Old Title", "content_text": "Old body", "summary": "Old summary"},
            "lectures": {"professor_id": PROF_ID},
        }
    }
    client = _FakeClient(rows)
    monkeypatch.setattr("backend.core.database.create_client", lambda *_a, **_k: client)

    result = await tutor_service.undo_regenerate_slide("slide-1", PROF_ID, "tok")

    assert result["title"] == "Old Title"
    assert result["content_text"] == "Old body"
    assert result["summary"] == "Old summary"
    assert rows["slide-1"]["title"] == "Old Title"
    assert rows["slide-1"]["previous_version"] is None


async def test_undo_raises_when_no_previous_version(monkeypatch):
    rows = {
        "slide-1": {
            "title": "New Title",
            "content_text": "New body",
            "summary": "New summary",
            "previous_version": None,
            "lectures": {"professor_id": PROF_ID},
        }
    }
    client = _FakeClient(rows)
    monkeypatch.setattr("backend.core.database.create_client", lambda *_a, **_k: client)

    with pytest.raises(ValueError):
        await tutor_service.undo_regenerate_slide("slide-1", PROF_ID, "tok")


async def test_undo_rejects_non_owner(monkeypatch):
    rows = {
        "slide-1": {
            "previous_version": {"title": "Old", "content_text": "Old body", "summary": "Old summary"},
            "lectures": {"professor_id": PROF_ID},
        }
    }
    client = _FakeClient(rows)
    monkeypatch.setattr("backend.core.database.create_client", lambda *_a, **_k: client)

    with pytest.raises(PermissionError):
        await tutor_service.undo_regenerate_slide("slide-1", OTHER_PROF_ID, "tok")


async def test_undo_missing_slide_raises_not_found(monkeypatch):
    client = _FakeClient({})
    monkeypatch.setattr("backend.core.database.create_client", lambda *_a, **_k: client)

    with pytest.raises(FileNotFoundError):
        await tutor_service.undo_regenerate_slide("nope", PROF_ID, "tok")
