"""Unit tests for the unified parse pipeline (PARSER_VERSION=5).

Per-slide synthesis (v4-style) wrapped in server-authoritative persistence.
These mock the DB, the LLM synthesis, and PDF extraction so they run fast and
offline, pinning: lecture/slide/quiz persistence, the flat SSE contract,
quiz-answer drop-not-default, deck anchoring, replay (no duplicate lecture),
resume-reuse, and the text-vs-vision per-slide routing.
"""
from __future__ import annotations

import json
import types
from uuid import uuid4

import pytest

from backend.domain.parse_models import RunStatus
from backend.services.parser import persist, unified_orchestrator as uo

OWNER = "11111111-1111-1111-1111-111111111111"


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
    assert count == 1
    assert len(calls) == 1
    assert calls[0][1] == "good"
    assert calls[0][3] == 2  # "c" -> index 2, never defaulted to 0


async def test_insert_deck_quizzes_anchors_to_linked_slide(monkeypatch):
    calls = []

    async def fake_execute(query, *args):
        calls.append(args)

    monkeypatch.setattr(persist, "_execute", fake_execute)
    sid0, sid1 = uuid4(), uuid4()
    deck_quiz = [{"question": "dq", "options": ["a", "b", "c", "d"], "correctAnswer": "b", "linked_slides": [1]}]
    count = await persist.insert_deck_quizzes(uuid4(), {0: sid0, 1: sid1}, deck_quiz)
    assert count == 1
    assert calls[0][0] == sid1
    meta = json.loads(calls[0][4])
    assert meta["is_deck"] is True and meta["linked_slides"] == [1]


async def test_create_lecture_requires_owner(monkeypatch):
    async def fake_execute(query, *args):
        return None
    monkeypatch.setattr(persist, "_execute", fake_execute)
    with pytest.raises(ValueError):
        await persist.create_lecture(title="x", professor_id=None, pdf_hash="h")


# ── _synthesize_slide: text vs vision routing ────────────────────────────────

async def test_synthesize_slide_uses_text_when_present(monkeypatch):
    import backend.services.parser.v4_orchestrator as v4

    async def fake_analyze_slide(num, text, ctx, model):
        return {"title": "Real Title", "aiInsight": "A clear explanation.", "slideType": "text"}

    monkeypatch.setattr(v4, "analyze_slide", fake_analyze_slide)
    out = await uo._synthesize_slide(0, "A slide with plenty of real text content here.", "ctx", "openai", b"")
    assert out["title"] == "Real Title"
    assert out["summary"] == "A clear explanation."


async def test_synthesize_slide_uses_vision_when_text_empty(monkeypatch):
    import backend.services.ai.vision as vision

    monkeypatch.setattr(uo, "_render_page_jpeg", lambda pdf, idx: b"jpegbytes")

    async def fake_vision(b64, text, model, ctx):
        return {"content_extraction": {"main_topic": "Diagram Topic", "summary": "What the diagram shows."}}

    monkeypatch.setattr(vision, "analyze_slide_vision", fake_vision)
    out = await uo._synthesize_slide(2, "", "ctx", "openai", b"%PDF")
    assert out["title"] == "Diagram Topic"
    assert out["summary"] == "What the diagram shows."


# ── orchestrator: end-to-end with mocked synthesis + DB ──────────────────────

def _patch_common(monkeypatch, run_status=RunStatus.QUEUED, lecture_id=None, pages=None):
    rec = {"status": [], "errors": [], "lectures": [], "slides": [], "deck_quiz": [],
           "finalize": [], "run_lecture": [], "cleared": [], "titled": [], "pdf": []}
    run = types.SimpleNamespace(run_id=uuid4(), status=run_status, lecture_id=lecture_id)
    pages = pages if pages is not None else ["text 0", "text 1", "text 2"]

    async def get_or_create_run(pdf_hash, lid, ver):
        return run

    async def set_status(rid, status):
        rec["status"].append(status)

    async def set_error(rid, msg):
        rec["errors"].append(msg)

    async def fetch_pdf(pdf_hash):
        return b"%PDF-fake"

    async def synth(idx, text, ctx, model, pdf):
        return {"title": f"S{idx}", "content": text, "summary": f"sum{idx}", "slide_type": "text"}

    async def store_pdf(lecture_id, filename, pdf_bytes):
        rec["pdf"].append(lecture_id)
        return f"lectures/{lecture_id}/x.pdf"

    async def create_lecture(*, title, professor_id, pdf_hash, pdf_url=None):
        lid = uuid4()
        rec["lectures"].append((title, professor_id, lid))
        return lid

    async def set_run_lecture(rid, lid):
        rec["run_lecture"].append((rid, lid))

    async def clear_lecture_content(lid):
        rec["cleared"].append(lid)

    async def set_lecture_title(lid, title):
        rec["titled"].append((lid, title))

    async def set_lecture_pdf_url(lid, url):
        rec["pdf"].append((lid, url))

    async def insert_slide(lecture_id, idx, slide):
        rec["slides"].append((idx, slide.get("title"), slide.get("summary")))
        return uuid4()

    async def insert_slide_quizzes(sid, questions):
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
    monkeypatch.setattr(uo, "_extract_pages", lambda pdf, odl=None: pages)
    monkeypatch.setattr(uo, "_synthesize_slide", synth)
    monkeypatch.setattr(uo, "_store_lecture_pdf", store_pdf)
    monkeypatch.setattr(persist, "create_lecture", create_lecture)
    monkeypatch.setattr(persist, "set_run_lecture", set_run_lecture)
    monkeypatch.setattr(persist, "clear_lecture_content", clear_lecture_content)
    monkeypatch.setattr(persist, "set_lecture_title", set_lecture_title)
    monkeypatch.setattr(persist, "set_lecture_pdf_url", set_lecture_pdf_url)
    monkeypatch.setattr(persist, "insert_slide", insert_slide)
    monkeypatch.setattr(persist, "insert_slide_quizzes", insert_slide_quizzes)
    monkeypatch.setattr(persist, "insert_deck_quizzes", insert_deck_quizzes)
    monkeypatch.setattr(persist, "finalize_lecture", finalize_lecture)

    import backend.services.parser.v4_orchestrator as v4
    import backend.services.file_parse_service as fps
    import backend.services.cache as cache

    async def meta(slides, model):
        return {"title": "DB Lecture", "summary": "Deck summary."}

    async def quiz(slides, title, model):
        return [{"question": "dq", "options": ["a", "b", "c", "d"], "correctAnswer": "a", "slideId": 1}]

    async def embed(idx, slide, pdf_hash, q, sem):
        return None

    async def attach(pdf_hash, lid):
        return 0

    monkeypatch.setattr(v4, "analyze_lecture_meta", meta)
    monkeypatch.setattr(v4, "generate_quiz_questions", quiz)
    monkeypatch.setattr(fps, "_safe_embedding_task", embed)
    monkeypatch.setattr(cache, "attach_lecture_id_to_embeddings", attach)
    return rec, run


async def _run(pdf_hash, professor, **kw):
    events = []

    async def emit(t, d):
        events.append((t, d))

    await uo.parse_pdf_unified({}, pdf_hash=pdf_hash, user_id=str(professor), emit_fn=emit, **kw)
    return events


async def test_parse_pdf_unified_happy_path(monkeypatch):
    rec, run = _patch_common(monkeypatch)
    events = await _run("h", OWNER, filename="My Deck.pdf")

    types_seq = [t for t, _ in events]
    assert types_seq[0] == "info"
    assert types_seq[-1] == "complete"
    assert "meta" in types_seq and "deck_complete" in types_seq
    meta_evt = next(d for t, d in events if t == "meta")
    assert "lecture_id" in meta_evt

    # lecture title comes from analyze_lecture_meta, not the filename
    assert len(rec["lectures"]) == 1 and rec["lectures"][0][0] == "DB Lecture"
    # every slide persisted with a real title + explanation
    assert [s[0] for s in rec["slides"]] == [0, 1, 2]
    assert all(s[1] and s[2] for s in rec["slides"])  # title + summary non-empty
    assert rec["deck_quiz"] == [1]
    assert rec["finalize"] == [("Deck summary.", 3)]
    assert RunStatus.COMPLETED in rec["status"]


async def test_parse_pdf_unified_replays_when_completed(monkeypatch):
    existing = uuid4()
    rec, run = _patch_common(monkeypatch, run_status=RunStatus.COMPLETED, lecture_id=existing)

    async def fake_replay(lecture_id):
        return {"slides": [{"index": 0, "title": "S1", "content": "c", "summary": "",
                            "slide_type": "text", "questions": []}], "deck_summary": "DS"}

    monkeypatch.setattr(persist, "fetch_lecture_for_replay", fake_replay)
    events = await _run("h", OWNER)
    types_seq = [t for t, _ in events]
    assert types_seq[-1] == "complete" and "slide" in types_seq
    meta_evt = next(d for t, d in events if t == "meta")
    assert meta_evt["lecture_id"] == str(existing)
    assert rec["lectures"] == []  # no new lecture on replay


async def test_parse_pdf_unified_resume_reuses_lecture(monkeypatch):
    existing = uuid4()
    rec, run = _patch_common(monkeypatch, run_status=RunStatus.FAILED, lecture_id=existing)
    await _run("h", OWNER, filename="L.pdf")
    assert rec["cleared"] == [existing]          # stale slides cleared
    assert rec["lectures"] == []                 # NO new lecture
    assert rec["titled"] and rec["titled"][0][0] == existing
    assert RunStatus.COMPLETED in rec["status"]


async def test_parse_pdf_unified_pdf_missing_errors(monkeypatch):
    rec, run = _patch_common(monkeypatch)

    async def no_pdf(pdf_hash):
        return None

    monkeypatch.setattr(uo, "_fetch_pdf_bytes", no_pdf)

    events = []

    async def emit(t, d):
        events.append((t, d))

    with pytest.raises(Exception):
        await uo.parse_pdf_unified({}, pdf_hash="h", user_id=OWNER, emit_fn=emit)

    assert any(t == "error" for t, _ in events)
    assert rec["errors"]  # run marked failed
    assert "complete" not in [t for t, _ in events]
