"""Unit tests for the unified parse pipeline (PARSER_VERSION=5).

These mock the DB layer and the v2 engine (parse_pdf_stream) so they run fast
and offline. They pin:
  - server-authoritative persistence is invoked (lecture/slides/quiz/deck),
  - the flat SSE contract is emitted (info/phase/meta/progress/slide/
    deck_complete/complete) with lecture_id surfaced on meta,
  - quiz answer indices are resolved + dropped-not-defaulted on mismatch,
  - deck questions anchor to their linked slide,
  - an already-COMPLETED run replays from the DB (no duplicate lecture),
  - an engine error marks the run failed and stops.
"""
from __future__ import annotations

import json
import types
from uuid import UUID, uuid4

import pytest

from backend.domain.parse_models import RunStatus
from backend.services.parser import persist, unified_orchestrator as uo

OWNER = "11111111-1111-1111-1111-111111111111"


# ── pure helpers ─────────────────────────────────────────────────────────────

def test_clean_title_strips_path_and_extension():
    assert uo._clean_title("/tmp/My Lecture.pdf") == "My Lecture"
    assert uo._clean_title("deck.PDF") == "deck"
    assert uo._clean_title("") == "Untitled Lecture"


# ── persist: quiz mapping (drop-not-default + deck anchoring) ────────────────

async def test_insert_slide_quizzes_drops_unresolvable(monkeypatch):
    calls = []

    async def fake_execute(query, *args):
        calls.append(args)

    monkeypatch.setattr(persist, "_execute", fake_execute)

    questions = [
        {"question": "good", "options": ["a", "b", "c", "d"], "correctAnswer": "c"},
        {"question": "bad", "options": ["a", "b", "c", "d"], "correctAnswer": "nope"},
    ]
    count = await persist.insert_slide_quizzes(uuid4(), questions)

    assert count == 1                 # the unresolvable one was dropped
    assert len(calls) == 1
    # args = (slide_id, question_text, options_json, correct_answer, metadata_json)
    assert calls[0][1] == "good"
    assert calls[0][3] == 2           # "c" -> index 2, never defaulted to 0


async def test_insert_deck_quizzes_anchors_to_linked_slide(monkeypatch):
    calls = []

    async def fake_execute(query, *args):
        calls.append(args)

    monkeypatch.setattr(persist, "_execute", fake_execute)

    sid0, sid1 = uuid4(), uuid4()
    slide_db_ids = {0: sid0, 1: sid1}
    deck_quiz = [{
        "question": "dq", "options": ["a", "b", "c", "d"],
        "correctAnswer": "b", "linked_slides": [1],
    }]
    count = await persist.insert_deck_quizzes(uuid4(), slide_db_ids, deck_quiz)

    assert count == 1
    assert calls[0][0] == sid1                       # anchored to linked slide 1
    meta = json.loads(calls[0][4])
    assert meta["is_deck"] is True
    assert meta["linked_slides"] == [1]


async def test_create_lecture_requires_owner(monkeypatch):
    async def fake_execute(query, *args):
        return None
    monkeypatch.setattr(persist, "_execute", fake_execute)
    with pytest.raises(ValueError):
        await persist.create_lecture(title="x", professor_id=None, pdf_hash="h")


# ── orchestrator: end-to-end with mocked engine + DB ─────────────────────────

def _fake_engine_events(pdf_hash="h"):
    """An async generator mimicking parse_pdf_stream's flat event stream."""
    async def _gen(*_args, **_kwargs):
        yield {"type": "meta", "pdf_hash": pdf_hash}
        yield {"type": "phase", "phase": "extract"}
        yield {"type": "progress", "current": 0, "total": 2, "message": "…"}
        yield {"type": "phase", "phase": "enhance"}
        yield {"type": "slide", "index": 0, "slide": {
            "title": "S1", "content": "c1", "summary": "sm1", "slide_type": "text",
            "questions": [{"question": "q", "options": ["a", "b", "c", "d"], "correctAnswer": "a"}],
        }}
        yield {"type": "slide", "index": 1, "slide": {
            "title": "S2", "content": "c2", "summary": "sm2", "slide_type": "text", "questions": [],
        }}
        yield {"type": "phase", "phase": "finalize"}
        yield {"type": "deck_complete", "deck_summary": "DS", "deck_quiz": [
            {"question": "dq", "options": ["a", "b", "c", "d"], "correctAnswer": "b", "linked_slides": [0, 1]},
        ]}
        yield {"type": "complete", "total": 2}
    return _gen


def _patch_common(monkeypatch, run_status=RunStatus.QUEUED, lecture_id=None):
    """Patch repos + storage + persist + cache; return a recorder dict."""
    rec = {"status": [], "errors": [], "lectures": [], "slides": [], "slide_quiz": [],
           "deck_quiz": [], "finalize": [], "attach": [], "run_lecture": [], "cleared": [],
           "pdf": []}
    run = types.SimpleNamespace(run_id=uuid4(), status=run_status, lecture_id=lecture_id)

    async def get_or_create_run(pdf_hash, lid, ver):
        return run

    async def set_status(rid, status):
        rec["status"].append(status)

    async def set_error(rid, msg):
        rec["errors"].append(msg)

    async def fetch_pdf(pdf_hash):
        return b"%PDF-fake"

    async def create_lecture(*, title, professor_id, pdf_hash, pdf_url=None):
        lid = uuid4()
        rec["lectures"].append((title, professor_id, lid))
        return lid

    async def set_run_lecture(rid, lid):
        rec["run_lecture"].append((rid, lid))

    async def clear_lecture_content(lid):
        rec["cleared"].append(lid)

    async def store_pdf(lecture_id, filename, pdf_bytes):
        rec["pdf"].append(("stored", lecture_id))
        return f"lectures/{lecture_id}/x.pdf"

    async def set_lecture_pdf_url(lid, url):
        rec["pdf"].append(("url", lid, url))

    async def insert_slide(lecture_id, idx, slide):
        sid = uuid4()
        rec["slides"].append((idx, slide.get("title")))
        return sid

    async def insert_slide_quizzes(sid, questions):
        rec["slide_quiz"].append(len(questions or []))
        return len(questions or [])

    async def insert_deck_quizzes(lid, slide_db_ids, deck_quiz):
        rec["deck_quiz"].append(len(deck_quiz or []))
        return len(deck_quiz or [])

    async def finalize_lecture(lid, desc, total):
        rec["finalize"].append((desc, total))

    monkeypatch.setattr(uo.repos, "get_or_create_run", get_or_create_run)
    monkeypatch.setattr(uo.repos, "set_status", set_status)
    monkeypatch.setattr(uo.repos, "set_error", set_error)
    monkeypatch.setattr(uo, "_fetch_pdf_bytes", fetch_pdf)
    monkeypatch.setattr(persist, "create_lecture", create_lecture)
    monkeypatch.setattr(persist, "set_run_lecture", set_run_lecture)
    monkeypatch.setattr(persist, "clear_lecture_content", clear_lecture_content)
    monkeypatch.setattr(persist, "set_lecture_pdf_url", set_lecture_pdf_url)
    monkeypatch.setattr(uo, "_store_lecture_pdf", store_pdf)
    monkeypatch.setattr(persist, "insert_slide", insert_slide)
    monkeypatch.setattr(persist, "insert_slide_quizzes", insert_slide_quizzes)
    monkeypatch.setattr(persist, "insert_deck_quizzes", insert_deck_quizzes)
    monkeypatch.setattr(persist, "finalize_lecture", finalize_lecture)

    import backend.services.cache as cache

    async def attach(pdf_hash, lid):
        rec["attach"].append((pdf_hash, lid))
        return 0

    monkeypatch.setattr(cache, "attach_lecture_id_to_embeddings", attach)
    return rec, run


async def test_parse_pdf_unified_happy_path(monkeypatch):
    rec, run = _patch_common(monkeypatch)
    import backend.services.file_parse_service as fps
    monkeypatch.setattr(fps, "parse_pdf_stream", _fake_engine_events("h"))

    events = []

    async def emit_fn(etype, data):
        events.append((etype, data))

    out = await uo.parse_pdf_unified(
        {}, pdf_hash="h", user_id=OWNER, emit_fn=emit_fn, filename="My Lecture.pdf",
    )

    assert out == str(run.run_id)
    types_seq = [e[0] for e in events]
    # flat SSE contract, in order
    assert types_seq[0] == "info"
    assert "meta" in types_seq and "deck_complete" in types_seq
    assert types_seq[-1] == "complete"
    # meta surfaces the server-created lecture_id
    meta_evt = next(d for t, d in events if t == "meta")
    assert "lecture_id" in meta_evt and meta_evt["pdf_hash"] == "h"
    # persistence happened server-side
    assert len(rec["lectures"]) == 1 and rec["lectures"][0][0] == "My Lecture"
    assert [s[0] for s in rec["slides"]] == [0, 1]
    assert rec["slide_quiz"] == [1, 0]            # slide 0 had 1 q, slide 1 had 0
    assert rec["deck_quiz"] == [1]
    assert rec["finalize"] == [("DS", 2)]
    assert len(rec["attach"]) == 1
    assert RunStatus.COMPLETED in rec["status"]


async def test_parse_pdf_unified_replays_when_completed(monkeypatch):
    existing_lecture = uuid4()
    rec, run = _patch_common(monkeypatch, run_status=RunStatus.COMPLETED, lecture_id=existing_lecture)

    async def fake_replay(lecture_id):
        return {"slides": [{"index": 0, "title": "S1", "content": "c", "summary": "",
                            "slide_type": "text", "questions": []}], "deck_summary": "DS"}

    monkeypatch.setattr(persist, "fetch_lecture_for_replay", fake_replay)

    events = []

    async def emit_fn(etype, data):
        events.append((etype, data))

    await uo.parse_pdf_unified({}, pdf_hash="h", user_id=OWNER, emit_fn=emit_fn)

    types_seq = [e[0] for e in events]
    assert types_seq[-1] == "complete"
    assert "slide" in types_seq
    meta_evt = next(d for t, d in events if t == "meta")
    assert meta_evt["lecture_id"] == str(existing_lecture)
    # critical: no NEW lecture created on replay
    assert rec["lectures"] == []


async def test_parse_pdf_unified_engine_error_marks_failed(monkeypatch):
    rec, run = _patch_common(monkeypatch)

    def _err_engine():
        async def _gen(*_a, **_k):
            yield {"type": "meta", "pdf_hash": "h"}
            yield {"type": "error", "message": "boom"}
        return _gen

    import backend.services.file_parse_service as fps
    monkeypatch.setattr(fps, "parse_pdf_stream", _err_engine())

    events = []

    async def emit_fn(etype, data):
        events.append((etype, data))

    await uo.parse_pdf_unified({}, pdf_hash="h", user_id=OWNER, emit_fn=emit_fn)

    assert rec["errors"] == ["boom"]
    assert any(t == "error" for t, _ in events)
    assert "complete" not in [t for t, _ in events]


async def test_resume_reuses_lecture_and_clears_no_duplicate(monkeypatch):
    """A re-run of a non-completed run reuses its lecture (clearing stale
    slides) instead of creating a duplicate lecture row."""
    existing = uuid4()
    rec, run = _patch_common(monkeypatch, run_status=RunStatus.FAILED, lecture_id=existing)
    import backend.services.file_parse_service as fps
    monkeypatch.setattr(fps, "parse_pdf_stream", _fake_engine_events("h"))

    events = []

    async def emit_fn(etype, data):
        events.append((etype, data))

    await uo.parse_pdf_unified({}, pdf_hash="h", user_id=OWNER, emit_fn=emit_fn, filename="L.pdf")

    assert rec["cleared"] == [existing]      # stale slides cleared
    assert rec["lectures"] == []             # NO new lecture created
    meta_evt = next(d for t, d in events if t == "meta")
    assert meta_evt["lecture_id"] == str(existing)
    assert RunStatus.COMPLETED in rec["status"]


async def test_error_after_slides_finalizes_total(monkeypatch):
    """If the engine errors after slides persisted (e.g. deck-summary failure),
    the lecture is still finalized with the persisted slide count."""
    rec, run = _patch_common(monkeypatch)

    def _err_after_slide():
        async def _gen(*_a, **_k):
            yield {"type": "meta", "pdf_hash": "h"}
            yield {"type": "slide", "index": 0, "slide": {
                "title": "S1", "content": "c", "summary": "", "slide_type": "text", "questions": []}}
            yield {"type": "error", "message": "deck boom"}
        return _gen

    import backend.services.file_parse_service as fps
    monkeypatch.setattr(fps, "parse_pdf_stream", _err_after_slide())

    events = []

    async def emit_fn(etype, data):
        events.append((etype, data))

    await uo.parse_pdf_unified({}, pdf_hash="h", user_id=OWNER, emit_fn=emit_fn)

    assert rec["finalize"] == [("", 1)]      # total_slides set despite the error
    assert rec["errors"] == ["deck boom"]
    assert "complete" not in [t for t, _ in events]
