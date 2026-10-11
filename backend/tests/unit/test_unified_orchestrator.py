"""Unit tests for the unified parse pipeline (PARSER_VERSION=5).

Per-slide synthesis (v4-style) wrapped in server-authoritative persistence.
These mock the DB, the LLM synthesis, and PDF extraction so they run fast and
offline, pinning: lecture/slide/quiz persistence, the flat SSE contract,
quiz-answer drop-not-default, deck anchoring, replay (no duplicate lecture),
resume-reuse, and the text-vs-vision per-slide routing.
"""
from __future__ import annotations

import asyncio
import json
import types
from uuid import uuid4

import pytest

from backend.domain.parse_models import RunStatus
from backend.services.parser import persist, unified_orchestrator as uo

OWNER = "11111111-1111-1111-1111-111111111111"
QUIZ_STATS = {"proposed": 2, "kept": 1, "repaired": 0, "dropped": 1, "drop_reasons": {"no_source": 1}}
LONG_A = "Breadth-first search visits every vertex level by level from the source."
LONG_B = "Depth-first search follows one branch to its end before it backtracks."


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
    import backend.services.parser.synthesis as synthesis

    async def fake_analyze_slide(num, text, ctx, model, source_language="en"):
        return {"title": "Real Title", "aiInsight": "A clear explanation.", "slideType": "text"}

    monkeypatch.setattr(synthesis, "analyze_slide", fake_analyze_slide)
    out = await uo._synthesize_slide(0, "A slide with plenty of real text content here.", "ctx", "openai", b"")
    assert out["title"] == "Real Title"
    assert out["summary"] == "A clear explanation."
    assert out["vision_routed"] is False


async def test_synthesize_slide_uses_vision_when_text_empty(monkeypatch):
    import backend.services.ai.vision as vision

    monkeypatch.setattr(uo, "_render_page_jpeg", lambda pdf, idx: b"jpegbytes")

    async def fake_vision(b64, text, model, ctx):
        return {"content_extraction": {"main_topic": "Diagram Topic", "summary": "What the diagram shows."}}

    monkeypatch.setattr(vision, "analyze_slide_vision", fake_vision)
    out = await uo._synthesize_slide(2, "", "ctx", "openai", b"%PDF")
    assert out["title"] == "Diagram Topic"
    assert out["summary"] == "What the diagram shows."
    assert out["vision_routed"] is True


async def test_synthesize_slide_vision_routed_true_even_when_typed_non_image(monkeypatch):
    """Roadmap Phase 2.2: vision_routed must be the reliable "needed OCR/
    vision rescue" signal — independent of slide_type, since a vision-routed
    slide can still come back typed math-diagram/graph/mixed, not just
    "image-only"."""
    import backend.services.ai.vision as vision

    monkeypatch.setattr(uo, "_render_page_jpeg", lambda pdf, idx: b"jpegbytes")

    async def fake_vision(b64, text, model, ctx):
        return {
            "slide_type": "math-diagram",
            "content_extraction": {"main_topic": "Integral", "summary": "A calculus diagram."},
        }

    monkeypatch.setattr(vision, "analyze_slide_vision", fake_vision)
    out = await uo._synthesize_slide(0, "", "ctx", "openai", b"%PDF")
    assert out["slide_type"] == "math-diagram"
    assert out["vision_routed"] is True


async def test_synthesize_slide_vision_failure_still_marks_vision_routed(monkeypatch):
    import backend.services.ai.vision as vision

    monkeypatch.setattr(uo, "_render_page_jpeg", lambda pdf, idx: b"jpegbytes")

    async def failing_vision(b64, text, model, ctx):
        raise RuntimeError("vision provider down")

    monkeypatch.setattr(vision, "analyze_slide_vision", failing_vision)
    out = await uo._synthesize_slide(0, "", "ctx", "openai", b"%PDF")
    assert out["vision_routed"] is True  # the attempt was made, even though it failed


# ── _review_flag_for: Roadmap Phase 5.1 "needs review" heuristic ─────────────

def test_review_flag_synthesis_failed_takes_priority():
    needs_review, reason = uo._review_flag_for(
        synthesis_failed=True, vision_routed=True, raw_title="Has A Title", raw_summary="Has a summary"
    )
    assert needs_review is True
    assert reason == "synthesis_failed"


def test_review_flag_vision_rescue():
    needs_review, reason = uo._review_flag_for(
        synthesis_failed=False, vision_routed=True, raw_title="Diagram", raw_summary="Shows a graph"
    )
    assert needs_review is True
    assert reason == "vision_rescue"


def test_review_flag_empty_content():
    needs_review, reason = uo._review_flag_for(
        synthesis_failed=False, vision_routed=False, raw_title="", raw_summary=""
    )
    assert needs_review is True
    assert reason == "empty_content"


def test_review_flag_title_present_but_summary_empty_still_flagged():
    """Regression guard: the batch-review flagged_count heuristic this
    replaced (repos.py) flagged on an empty summary ALONE, regardless of
    title — an AND-only check here would silently under-flag slides like an
    agenda/divider where the LLM produces a title but no real explanation."""
    needs_review, reason = uo._review_flag_for(
        synthesis_failed=False, vision_routed=False, raw_title="Course Roadmap", raw_summary=""
    )
    assert needs_review is True
    assert reason == "empty_content"


def test_review_flag_summary_present_but_title_empty_still_flagged():
    needs_review, reason = uo._review_flag_for(
        synthesis_failed=False, vision_routed=False, raw_title="", raw_summary="Some real explanation."
    )
    assert needs_review is True
    assert reason == "empty_content"


def test_review_flag_healthy_slide_not_flagged():
    needs_review, reason = uo._review_flag_for(
        synthesis_failed=False, vision_routed=False, raw_title="Real Title", raw_summary="Real summary"
    )
    assert needs_review is False
    assert reason is None


# ── orchestrator: end-to-end with mocked synthesis + DB ──────────────────────

def _patch_common(monkeypatch, run_status=RunStatus.QUEUED, lecture_id=None, pages=None):
    rec = {"status": [], "errors": [], "lectures": [], "slides": [], "deck_quiz": [],
           "finalize": [], "run_lecture": [], "cleared": [], "titled": [], "pdf": [],
           "poster": [], "poster_url": []}
    run = types.SimpleNamespace(run_id=uuid4(), status=run_status, lecture_id=lecture_id)
    pages = pages if pages is not None else ["text 0", "text 1", "text 2"]

    async def get_or_create_run(pdf_hash, lid, ver, **_kwargs):
        return run

    async def set_status(rid, status):
        rec["status"].append(status)

    async def set_error(rid, msg):
        rec["errors"].append(msg)

    async def fetch_pdf(pdf_hash):
        return b"%PDF-fake"

    async def synth(idx, text, ctx, model, pdf, source_language="en"):
        return {"title": f"S{idx}", "content": text, "summary": f"sum{idx}", "slide_type": "text"}

    async def store_pdf(lecture_id, filename, pdf_bytes):
        rec["pdf"].append(lecture_id)
        return f"lectures/{lecture_id}/x.pdf"

    async def create_lecture(*, title, professor_id=None, pdf_hash, pdf_url=None, course_id=None,
                             visibility="course", student_owner_id=None, source_language="en"):
        lid = uuid4()
        rec["lectures"].append((title, professor_id, lid))
        rec.setdefault("source_language", []).append(source_language)
        return lid

    async def set_run_lecture(rid, lid):
        rec["run_lecture"].append((rid, lid))

    async def clear_lecture_content(lid):
        rec["cleared"].append(lid)

    async def fetch_regen_instructions(lid):
        return rec.get("regen_instructions", {})

    async def set_lecture_title(lid, title):
        rec["titled"].append((lid, title))

    async def set_lecture_source_language(lid, source_language):
        rec.setdefault("source_language", []).append(source_language)

    async def set_lecture_pdf_url(lid, url):
        rec["pdf"].append((lid, url))

    # The poster hook performs a real Supabase Storage upload, so it needs a stub
    # like every other outbound call in this fixture. Without one the suite only
    # passes by accident: `fetch_pdf` hands back b"%PDF-fake", which fails to
    # parse, so render_poster returns None and store_lecture_poster short-circuits
    # before ever reaching the upload. Give this fixture a valid PDF -- conftest
    # already builds real ones with fitz elsewhere -- and it uploads for real.
    #
    # Verified directly: with those bytes the upload path is never reached; with a
    # valid PDF it is. Once the unit-test outbound guard lands it turns that latent
    # upload into a hard failure that is also awkward to read, because the guard
    # raises from BaseException specifically so that product code cannot absorb it
    # -- poster.py's deliberately non-fatal `except Exception` would not catch it.
    async def store_poster(lecture_id, pdf_bytes):
        rec["poster"].append(lecture_id)
        return f"lectures/{lecture_id}/poster.webp"

    async def set_lecture_poster_url(lid, url):
        rec["poster_url"].append((lid, url))

    async def insert_slide(lecture_id, idx, slide, *, ai_enhanced=True, parser_engine="unified"):
        rec["slides"].append((idx, slide.get("title"), slide.get("summary")))
        rec.setdefault("slide_flags", []).append((idx, ai_enhanced, parser_engine))
        return uuid4()

    async def insert_slide_quizzes(sid, questions):
        return len(questions or [])

    async def insert_deck_quizzes(lid, slide_db_ids, deck_quiz):
        rec["deck_quiz"].append(len(deck_quiz or []))
        return len(deck_quiz or [])

    async def finalize_lecture(lid, desc, total):
        rec["finalize"].append((desc, total))

    async def save_parse_receipt(run_id, lecture_id, *, deck_skeleton, slide_provenance, quiz_grounding,
                                 llm_usage=None):
        rec.setdefault("receipts", []).append({
            "run_id": run_id, "lecture_id": lecture_id, "deck_skeleton": deck_skeleton,
            "slide_provenance": slide_provenance, "quiz_grounding": quiz_grounding,
            "llm_usage": llm_usage,
        })

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
    monkeypatch.setattr(persist, "fetch_regen_instructions", fetch_regen_instructions)
    monkeypatch.setattr(persist, "set_lecture_title", set_lecture_title)
    monkeypatch.setattr(persist, "set_lecture_source_language", set_lecture_source_language)
    monkeypatch.setattr(persist, "set_lecture_pdf_url", set_lecture_pdf_url)
    monkeypatch.setattr(uo.poster, "store_lecture_poster", store_poster)
    monkeypatch.setattr(persist, "set_lecture_poster_url", set_lecture_poster_url)
    monkeypatch.setattr(persist, "insert_slide", insert_slide)
    monkeypatch.setattr(persist, "insert_slide_quizzes", insert_slide_quizzes)
    monkeypatch.setattr(persist, "insert_deck_quizzes", insert_deck_quizzes)
    monkeypatch.setattr(persist, "finalize_lecture", finalize_lecture)
    monkeypatch.setattr(uo.repos, "save_parse_receipt", save_parse_receipt)

    import backend.services.parser.synthesis as synthesis
    import backend.services.file_parse_service as fps
    import backend.services.cache as cache
    import backend.services.concept_graph as concept_graph
    import backend.services.content_filter as content_filter
    import backend.services.course_context_service as course_context_service
    import backend.services.localization_service as localization_service
    import backend.services.ai.orchestrator as ai_orchestrator

    async def meta(slides, model, course_context_hint="", source_language="en", skeleton=None):
        return {"title": "DB Lecture", "summary": "Deck summary.", "keyTopics": ["Gradient Descent", "Loss Functions"]}

    async def quiz(slides, title, model, source_language="en", skeleton=None, stats=None):
        if stats is not None:
            stats.update(QUIZ_STATS)
        return [{"question": "dq", "options": ["a", "b", "c", "d"], "correctAnswer": "a", "slideId": 1}]

    async def localize_lecture(lecture_id, ai_model):
        # Safe no-op default: the real one opens an asyncpg connection and
        # calls the LLM. Without it every completing parse in this module
        # would reach the REAL pool (and leak it across event loops).
        rec.setdefault("localized_lectures", []).append(lecture_id)

    async def localize_course(course_id, ai_model):
        rec.setdefault("localized_courses", []).append(course_id)

    async def attach_blueprint_material(run_id, lecture_id):
        # Same reason: the real one talks to Supabase over HTTP.
        rec.setdefault("blueprint_attach", []).append((run_id, lecture_id))

    async def embed(idx, slide, pdf_hash, q, sem):
        return None

    async def attach(pdf_hash, lid):
        return 0

    async def ingest_concepts(lecture_id, **kwargs):
        # Safe no-op default so any test that sets feature_course_brain=True
        # (task #10's server-side trigger) never falls through to the REAL
        # concept_graph — which would attempt real network/DB calls. Tests
        # that care about this call override it themselves, AFTER calling
        # _patch_common, so their override wins.
        rec.setdefault("concept_ingest", []).append((lecture_id, kwargs))
        return {"lecture_id": lecture_id, "concepts": 0, "linked": 0, "created": 0}

    def is_metadata_default(text, idx, total, ai_model):
        # Safe "never an admin slide" default for the same reason — tests
        # exercising the syllabus-extraction path override this themselves,
        # AFTER calling _patch_common.
        return {"is_metadata": False}

    async def course_ctx_default(course_id, exclude_lecture_id=None, max_lectures=10):
        # Safe "no prior lectures" default — tests exercising course-context
        # threading / cross-lecture quizzes override this themselves, AFTER
        # calling _patch_common. Without this, any test with
        # feature_course_brain=True + a course_id would hit the REAL asyncpg
        # pool (whatever DATABASE_URL happens to resolve to in this env).
        return {"prior_lectures": [], "instructor": None, "grading_scheme": None}

    async def cross_lecture_default(*_args, **_kwargs):
        # Safe "no cross-lecture questions" default. A test that overrides
        # get_course_synthesis_context to return prior_lectures unlocks this
        # branch as a side effect, and without a default it reaches the REAL
        # provider chain (a live https://api.cerebras.ai call). Tests asserting
        # on this call override it themselves, AFTER calling _patch_common.
        rec.setdefault("cross_lecture", []).append(_kwargs)
        return []

    async def fake_batch_analyze_text_slides(slides_input, ai_model="cerebras", blueprint=None, **_kw):
        # Roadmap P3-1: default fake for the batched text-synthesis path so
        # any test whose fixture pages happen to be >= _MIN_TEXT_FOR_SYNTH
        # chars (routing them through the batch call, not _synthesize_slide)
        # still gets deterministic, offline output shaped like the "synth"
        # per-slide fake above — same title/summary pattern — so existing
        # assertions on slide title/summary content stay valid regardless of
        # which path a given slide's text length routes it through.
        rec.setdefault("batch_calls", []).append([s["index"] for s in slides_input])
        return [
            {"index": s["index"], "title": f"S{s['index']}", "summary": f"sum{s['index']}",
             "slide_type": "text"}
            for s in slides_input
        ]

    class _FakeRotator:
        def remaining_headroom(self, chain):
            return 100_000

    monkeypatch.setattr(synthesis, "analyze_lecture_meta", meta)
    monkeypatch.setattr(synthesis, "generate_quiz_questions", quiz)
    monkeypatch.setattr(fps, "_safe_embedding_task", embed)
    monkeypatch.setattr(cache, "attach_lecture_id_to_embeddings", attach)
    monkeypatch.setattr(concept_graph, "ingest_lecture_concepts", ingest_concepts)
    monkeypatch.setattr(content_filter, "is_metadata_slide", is_metadata_default)
    monkeypatch.setattr(course_context_service, "get_course_synthesis_context", course_ctx_default)
    monkeypatch.setattr(synthesis, "generate_cross_lecture_questions", cross_lecture_default)
    monkeypatch.setattr(localization_service, "localize_lecture", localize_lecture)
    monkeypatch.setattr(localization_service, "localize_course", localize_course)
    monkeypatch.setattr(uo, "_attach_completed_blueprint_material", attach_blueprint_material)
    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", fake_batch_analyze_text_slides)
    monkeypatch.setattr(ai_orchestrator, "get_rotator", lambda: _FakeRotator())
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


async def test_parse_pdf_unified_survives_skeleton_failure(monkeypatch):
    """The deck skeleton is an optimisation input: failing to build it must
    never abort a parse (callees build their own or fall back)."""
    rec, run = _patch_common(monkeypatch)

    def boom(pages):
        raise RuntimeError("skeleton exploded")

    monkeypatch.setattr("backend.services.parser.deck_plan.build_deck_skeleton", boom)
    events = await _run("h", OWNER, filename="My Deck.pdf")
    assert events[-1][0] == "complete"
    assert RunStatus.COMPLETED in rec["status"]


async def test_parse_pdf_unified_stores_a_hero_poster(monkeypatch):
    """The pipeline renders the console hero's key art during ingest.

    It happens here, while the PDF bytes are already in memory, because the
    alternative -- letting the frontend rasterise page 1 out of the source PDF --
    downloaded the whole document per focused lecture and was the dominant cause
    of a Supabase egress overage. See backend/services/parser/poster.py.
    """
    rec, run = _patch_common(monkeypatch)
    await _run("h", OWNER, filename="My Deck.pdf")

    lecture_id = rec["lectures"][0][2]
    assert rec["poster"] == [lecture_id], "ingest must render a poster for the lecture"
    # ...and the path must be recorded, or the frontend has no poster to resolve
    # and the hero silently falls back to the ambient gradient forever.
    assert rec["poster_url"] == [(lecture_id, f"lectures/{lecture_id}/poster.webp")]


async def test_parse_pdf_unified_survives_poster_failure(monkeypatch):
    """Key art is decorative: a poster failure must never fail the parse."""
    rec, run = _patch_common(monkeypatch)

    async def failing_poster(lecture_id, pdf_bytes):
        return None  # what store_lecture_poster returns on render/upload failure

    monkeypatch.setattr(uo.poster, "store_lecture_poster", failing_poster)
    events = await _run("h", OWNER, filename="My Deck.pdf")

    assert [t for t, _ in events][-1] == "complete"
    assert RunStatus.COMPLETED in rec["status"]
    # no poster path recorded, and crucially no attempt to persist a null one
    assert rec["poster_url"] == []


async def test_parse_pdf_unified_propagates_vision_routed_on_slide_event(monkeypatch):
    """Roadmap Phase 2.2: vision_routed must survive from _synthesize_slide's
    return value into the per-slide SSE ui_slide dict, so the frontend
    overlay can show a "vision-assisted" signal for scanned/handwritten
    pages."""
    rec, run = _patch_common(monkeypatch, pages=["text 0", "", "text 2"])

    async def synth(idx, text, ctx, model, pdf, source_language="en"):
        if idx == 1:
            return {"title": "Scan", "content": text, "summary": "s", "slide_type": "image-only", "vision_routed": True}
        return {"title": f"S{idx}", "content": text, "summary": f"sum{idx}", "slide_type": "text", "vision_routed": False}

    monkeypatch.setattr(uo, "_synthesize_slide", synth)
    events = await _run("h", OWNER, filename="Deck.pdf")

    slide_events = {d["index"]: d["slide"] for t, d in events if t == "slide"}
    assert slide_events[0]["vision_routed"] is False
    assert slide_events[1]["vision_routed"] is True
    assert slide_events[2]["vision_routed"] is False


async def test_parse_pdf_unified_marks_needs_review_on_synthesis_exception(monkeypatch):
    """Roadmap Phase 5.1 AC3 (zero silent failures): a slide whose synthesis
    raised is caught at the call site and re-wrapped into a plain fallback
    dict that has no `vision_routed` key — previously that meant the failure
    left literally no trace anywhere. It must now be visibly flagged."""
    rec, run = _patch_common(monkeypatch, pages=["text 0", "text 1", "text 2"])

    async def synth(idx, text, ctx, model, pdf, source_language="en"):
        if idx == 1:
            raise RuntimeError("LLM timed out")
        return {"title": f"S{idx}", "content": text, "summary": f"sum{idx}", "slide_type": "text", "vision_routed": False}

    monkeypatch.setattr(uo, "_synthesize_slide", synth)
    events = await _run("h", OWNER, filename="Deck.pdf")

    slide_events = {d["index"]: d["slide"] for t, d in events if t == "slide"}
    assert slide_events[1]["needs_review"] is True
    assert slide_events[1]["review_reason"] == "synthesis_failed"
    assert slide_events[0]["needs_review"] is False
    assert slide_events[2]["needs_review"] is False


async def test_parse_pdf_unified_marks_needs_review_on_vision_rescue(monkeypatch):
    rec, run = _patch_common(monkeypatch, pages=["text 0", "", "text 2"])

    async def synth(idx, text, ctx, model, pdf, source_language="en"):
        if idx == 1:
            return {"title": "Scan", "content": text, "summary": "s", "slide_type": "image-only", "vision_routed": True}
        return {"title": f"S{idx}", "content": text, "summary": f"sum{idx}", "slide_type": "text", "vision_routed": False}

    monkeypatch.setattr(uo, "_synthesize_slide", synth)
    events = await _run("h", OWNER, filename="Deck.pdf")

    slide_events = {d["index"]: d["slide"] for t, d in events if t == "slide"}
    assert slide_events[1]["needs_review"] is True
    assert slide_events[1]["review_reason"] == "vision_rescue"
    assert slide_events[0]["needs_review"] is False


async def test_parse_pdf_unified_skip_ai_never_flags_needs_review(monkeypatch):
    """On-demand (Skip AI) slides never run synthesis at all, so there's
    nothing to flag — needs_review must stay False regardless of content."""
    rec, run = _patch_common(monkeypatch, pages=["", "", ""])
    events = await _run("h", OWNER, filename="Deck.pdf", parsing_mode="on_demand")

    slide_events = {d["index"]: d["slide"] for t, d in events if t == "slide"}
    assert all(s["needs_review"] is False for s in slide_events.values())


async def test_parse_pdf_unified_passes_review_flags_to_persist_insert_slide(monkeypatch):
    """needs_review/review_reason/vision_routed must reach persist.insert_slide,
    not just the SSE event — Roadmap 5.1 requires the signal to survive a
    page reload, not just live in-flight for the current upload session."""
    rec, run = _patch_common(monkeypatch, pages=["text 0", "", "text 2"])

    async def synth(idx, text, ctx, model, pdf, source_language="en"):
        if idx == 1:
            return {"title": "Scan", "content": text, "summary": "s", "slide_type": "image-only", "vision_routed": True}
        return {"title": f"S{idx}", "content": text, "summary": f"sum{idx}", "slide_type": "text", "vision_routed": False}

    monkeypatch.setattr(uo, "_synthesize_slide", synth)

    captured: dict = {}

    async def insert_slide(lecture_id, idx, slide, *, ai_enhanced=True, parser_engine="unified"):
        captured[idx] = dict(slide)
        return uuid4()

    monkeypatch.setattr(persist, "insert_slide", insert_slide)
    await _run("h", OWNER, filename="Deck.pdf")

    assert captured[1]["vision_routed"] is True
    assert captured[1]["needs_review"] is True
    assert captured[1]["review_reason"] == "vision_rescue"
    assert captured[0]["needs_review"] is False


async def test_parse_pdf_unified_ingests_concepts_when_flag_on(monkeypatch):
    """Roadmap Phase 3: with FEATURE_COURSE_BRAIN on, finalize feeds the
    lecture's keyTopics (already generated by analyze_lecture_meta, previously
    discarded) into the shared concept graph via a blueprint-shaped payload —
    NOT via ingest_lecture_concepts' own auto-fetch (which would read the
    dead lecture_blueprints table / mistake quiz difficulty for a concept)."""
    from backend.core.config import settings
    import backend.services.concept_graph as cg

    monkeypatch.setattr(settings, "feature_course_brain", True, raising=False)
    # _patch_common installs its own (safe, no-op) ingest_lecture_concepts
    # default — call it FIRST so this test's override (which it asserts on) wins.
    rec, run = _patch_common(monkeypatch)
    calls = []

    async def fake_ingest(lecture_id, **kwargs):
        calls.append((lecture_id, kwargs))
        return {"lecture_id": lecture_id, "concepts": 2, "linked": 2, "created": 2}

    monkeypatch.setattr(cg, "ingest_lecture_concepts", fake_ingest)
    await _run("h", OWNER, filename="My Deck.pdf")

    assert len(calls) == 1
    lecture_id, kwargs = calls[0]
    assert lecture_id == str(rec["lectures"][0][2])
    assert kwargs["blueprint"]["cross_slide_quiz_concepts"] == ["Gradient Descent", "Loss Functions"]
    assert kwargs["questions"] == []
    assert kwargs["slide_id_to_index"] == {}


async def test_parse_pdf_unified_skips_concept_ingestion_when_flag_off(monkeypatch):
    from backend.core.config import settings
    import backend.services.concept_graph as cg

    monkeypatch.setattr(settings, "feature_course_brain", False, raising=False)

    async def boom(*a, **k):
        raise AssertionError("ingest_lecture_concepts must not run when the flag is off")

    monkeypatch.setattr(cg, "ingest_lecture_concepts", boom)
    _patch_common(monkeypatch)
    await _run("h", OWNER, filename="My Deck.pdf")  # must not raise


async def test_parse_pdf_unified_skips_concept_ingestion_for_on_demand(monkeypatch):
    """Skip-AI slides have no synthesized keyTopics to extract concepts from."""
    from backend.core.config import settings
    import backend.services.concept_graph as cg

    monkeypatch.setattr(settings, "feature_course_brain", True, raising=False)
    _patch_common(monkeypatch)  # installs its own default first; override below wins

    async def boom(*a, **k):
        raise AssertionError("ingest_lecture_concepts must not run for on_demand parses")

    monkeypatch.setattr(cg, "ingest_lecture_concepts", boom)
    await _run("h", OWNER, filename="My Deck.pdf", parsing_mode="on_demand")  # must not raise


async def test_parse_pdf_unified_concept_ingestion_failure_is_non_fatal(monkeypatch):
    from backend.core.config import settings
    import backend.services.concept_graph as cg

    monkeypatch.setattr(settings, "feature_course_brain", True, raising=False)
    _patch_common(monkeypatch)  # installs its own default first; override below wins

    async def failing_ingest(*a, **k):
        raise RuntimeError("embedding service down")

    monkeypatch.setattr(cg, "ingest_lecture_concepts", failing_ingest)
    events = await _run("h", OWNER, filename="My Deck.pdf")
    types_seq = [t for t, _ in events]
    assert types_seq[-1] == "complete"  # parse still completes despite the failure


# ── Roadmap Phase 3: course-context extraction from administrative slides ────

def _patch_syllabus_extraction(monkeypatch, *, is_metadata_by_index):
    """Patch content_filter/synthesis/course_context_service and return a
    dict of call-recorders: {"classify": [...], "extract": [...], "upsert": [...]}."""
    import backend.services.content_filter as content_filter
    import backend.services.parser.synthesis as synthesis
    import backend.services.course_context_service as ccs

    calls = {"classify": [], "extract": [], "upsert": []}

    def fake_is_metadata(text, idx, total, ai_model):
        calls["classify"].append(idx)
        return {"is_metadata": is_metadata_by_index.get(idx, False)}

    async def fake_extract(text, ai_model):
        calls["extract"].append(text)
        return {"instructor": "Prof. Ada", "exam_dates": [], "grading_scheme": "", "other_facts": {}}

    async def fake_upsert(course_id, facts):
        calls["upsert"].append((course_id, facts))

    monkeypatch.setattr(content_filter, "is_metadata_slide", fake_is_metadata)
    monkeypatch.setattr(synthesis, "extract_syllabus_facts", fake_extract)
    monkeypatch.setattr(ccs, "upsert_course_context_facts", fake_upsert)
    return calls


async def test_admin_slide_triggers_syllabus_extraction_and_upsert(monkeypatch):
    from backend.core.config import settings

    monkeypatch.setattr(settings, "feature_course_brain", True, raising=False)
    course = uuid4()
    # _patch_common installs its own (safe, no-op) is_metadata_slide default —
    # call it FIRST so this test's override (which it actually asserts on) wins.
    _patch_common(monkeypatch, pages=["Intro content", "Instructor: Ada, Exam: June 1", "More content"])
    calls = _patch_syllabus_extraction(monkeypatch, is_metadata_by_index={1: True})

    await _run("h", OWNER, filename="Deck.pdf", course_id=str(course))

    assert calls["classify"] == [0, 1, 2]  # every slide classified
    assert calls["extract"] == ["Instructor: Ada, Exam: June 1"]  # only the flagged slide's text
    assert len(calls["upsert"]) == 1
    upserted_course_id, facts = calls["upsert"][0]
    assert upserted_course_id == course
    assert facts["instructor"] == "Prof. Ada"


async def test_no_admin_slides_skips_extraction_entirely(monkeypatch):
    from backend.core.config import settings

    monkeypatch.setattr(settings, "feature_course_brain", True, raising=False)
    _patch_common(monkeypatch)
    calls = _patch_syllabus_extraction(monkeypatch, is_metadata_by_index={})

    await _run("h", OWNER, filename="Deck.pdf", course_id=str(uuid4()))

    assert calls["classify"] == [0, 1, 2]
    assert calls["extract"] == []
    assert calls["upsert"] == []


async def test_syllabus_extraction_skipped_without_course_id(monkeypatch):
    """Even with the flag on, a course-less (or private-student) upload must
    never run admin-slide classification — there is nowhere to write facts."""
    from backend.core.config import settings

    monkeypatch.setattr(settings, "feature_course_brain", True, raising=False)
    _patch_common(monkeypatch)
    calls = _patch_syllabus_extraction(monkeypatch, is_metadata_by_index={0: True})

    await _run("h", OWNER, filename="Deck.pdf")  # no course_id

    assert calls["classify"] == []
    assert calls["extract"] == []


async def test_syllabus_extraction_skipped_when_flag_off(monkeypatch):
    from backend.core.config import settings

    monkeypatch.setattr(settings, "feature_course_brain", False, raising=False)
    _patch_common(monkeypatch)
    calls = _patch_syllabus_extraction(monkeypatch, is_metadata_by_index={0: True})

    await _run("h", OWNER, filename="Deck.pdf", course_id=str(uuid4()))

    assert calls["classify"] == []
    assert calls["extract"] == []


async def test_syllabus_extraction_failure_is_non_fatal(monkeypatch):
    from backend.core.config import settings
    import backend.services.parser.synthesis as synthesis

    monkeypatch.setattr(settings, "feature_course_brain", True, raising=False)
    _patch_common(monkeypatch)
    _patch_syllabus_extraction(monkeypatch, is_metadata_by_index={0: True})

    async def boom(text, ai_model):
        raise RuntimeError("LLM unavailable")

    monkeypatch.setattr(synthesis, "extract_syllabus_facts", boom)
    _patch_common(monkeypatch)

    events = await _run("h", OWNER, filename="Deck.pdf", course_id=str(uuid4()))
    types_seq = [t for t, _ in events]
    assert types_seq[-1] == "complete"  # parse still completes despite the failure


# ── Roadmap Phase 3.4: new-upload course-context awareness ───────────────────

async def test_course_context_hint_threaded_into_meta_and_per_slide_context(monkeypatch):
    from backend.core.config import settings
    import backend.services.course_context_service as ccs
    import backend.services.parser.synthesis as synthesis

    monkeypatch.setattr(settings, "feature_course_brain", True, raising=False)

    # _patch_common installs its own defaults for get_course_synthesis_context/
    # analyze_lecture_meta/_synthesize_slide — call it FIRST so the overrides
    # below (which this test actually asserts on) win, not the other way around.
    _patch_common(monkeypatch)

    async def fake_ctx(course_id, exclude_lecture_id=None, max_lectures=10):
        return {
            "prior_lectures": [{"id": "L0", "title": "Intro to Linear Algebra", "top_concept": "Vectors"}],
            "instructor": None, "grading_scheme": None,
        }

    monkeypatch.setattr(ccs, "get_course_synthesis_context", fake_ctx)

    captured_hints = []

    async def fake_meta(slides, model, course_context_hint="", source_language="en", skeleton=None):
        captured_hints.append(course_context_hint)
        return {"title": "DB Lecture", "summary": "Deck summary.", "keyTopics": []}

    monkeypatch.setattr(synthesis, "analyze_lecture_meta", fake_meta)

    captured_slide_ctx = []

    async def fake_synth(idx, text, ctx, model, pdf, source_language="en"):
        captured_slide_ctx.append(ctx)
        return {"title": f"S{idx}", "content": text, "summary": "s", "slide_type": "text"}

    monkeypatch.setattr(uo, "_synthesize_slide", fake_synth)

    await _run("h", OWNER, filename="Deck.pdf", course_id=str(uuid4()))

    assert captured_hints and captured_hints[0] != ""
    assert "Intro to Linear Algebra" in captured_hints[0]
    assert "Vectors" in captured_hints[0]
    # The same hint is folded into the per-slide lecture_context.
    assert all("Intro to Linear Algebra" in c for c in captured_slide_ctx)


async def test_course_context_hint_absent_without_course_id_is_byte_identical(monkeypatch):
    """Regression guard: no course_id means zero course-context fetch, and
    analyze_lecture_meta / per-slide lecture_context are EXACTLY what they
    were before Phase 3 (no hint text appended anywhere)."""
    from backend.core.config import settings
    import backend.services.course_context_service as ccs
    import backend.services.parser.synthesis as synthesis

    monkeypatch.setattr(settings, "feature_course_brain", True, raising=False)

    # _patch_common installs its own defaults for get_course_synthesis_context/
    # analyze_lecture_meta/_synthesize_slide — call it FIRST so the overrides
    # below (which this test actually asserts on) win, not the other way around.
    _patch_common(monkeypatch)

    async def boom_ctx(*a, **k):
        raise AssertionError("get_course_synthesis_context must not run without a course_id")

    monkeypatch.setattr(ccs, "get_course_synthesis_context", boom_ctx)

    captured_hints = []

    async def fake_meta(slides, model, course_context_hint="", source_language="en", skeleton=None):
        captured_hints.append(course_context_hint)
        return {"title": "DB Lecture", "summary": "Deck summary.", "keyTopics": []}

    monkeypatch.setattr(synthesis, "analyze_lecture_meta", fake_meta)

    captured_slide_ctx = []

    async def fake_synth(idx, text, ctx, model, pdf, source_language="en"):
        captured_slide_ctx.append(ctx)
        return {"title": f"S{idx}", "content": text, "summary": "s", "slide_type": "text"}

    monkeypatch.setattr(uo, "_synthesize_slide", fake_synth)

    await _run("h", OWNER, filename="Deck.pdf")  # no course_id

    assert captured_hints == [""]
    assert all(c == "DB Lecture: Deck summary." for c in captured_slide_ctx)


async def test_course_context_hint_absent_when_flag_off(monkeypatch):
    from backend.core.config import settings
    import backend.services.course_context_service as ccs

    monkeypatch.setattr(settings, "feature_course_brain", False, raising=False)
    _patch_common(monkeypatch)  # installs its own default first; override below wins

    async def boom_ctx(*a, **k):
        raise AssertionError("get_course_synthesis_context must not run when the flag is off")

    monkeypatch.setattr(ccs, "get_course_synthesis_context", boom_ctx)
    await _run("h", OWNER, filename="Deck.pdf", course_id=str(uuid4()))  # must not raise


async def test_course_context_fetch_failure_is_non_fatal(monkeypatch):
    from backend.core.config import settings
    import backend.services.course_context_service as ccs

    monkeypatch.setattr(settings, "feature_course_brain", True, raising=False)
    _patch_common(monkeypatch)  # installs its own default first; override below wins

    async def failing_ctx(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(ccs, "get_course_synthesis_context", failing_ctx)

    events = await _run("h", OWNER, filename="Deck.pdf", course_id=str(uuid4()))
    types_seq = [t for t, _ in events]
    assert types_seq[-1] == "complete"


async def test_cross_lecture_questions_appended_and_tagged(monkeypatch):
    from backend.core.config import settings
    import backend.services.course_context_service as ccs
    import backend.services.parser.synthesis as synthesis

    monkeypatch.setattr(settings, "feature_course_brain", True, raising=False)
    prior_lecture_id = str(uuid4())
    rec, run = _patch_common(monkeypatch)  # installs its own defaults first; overrides below win

    async def fake_ctx(course_id, exclude_lecture_id=None, max_lectures=10):
        return {
            "prior_lectures": [{"id": prior_lecture_id, "title": "Intro to Linear Algebra", "top_concept": "Vectors"}],
            "instructor": None, "grading_scheme": None,
        }

    monkeypatch.setattr(ccs, "get_course_synthesis_context", fake_ctx)

    async def fake_cross(lecture_title, prior_lectures, ai_model):
        return [{
            "question": "How do vectors relate?", "options": ["a", "b", "c", "d"], "correctAnswer": "a",
            "explanation": "...", "source_concept": "Vectors",
            "_source_lecture_id": prior_lecture_id, "_source_lecture_title": "Intro to Linear Algebra",
        }]

    monkeypatch.setattr(synthesis, "generate_cross_lecture_questions", fake_cross)

    await _run("h", OWNER, filename="Deck.pdf", course_id=str(uuid4()))

    # 1 normal deck question (from _patch_common's shared quiz() mock) + 1 cross-lecture question.
    assert rec["deck_quiz"] == [2]


async def test_cross_lecture_questions_skipped_without_prior_lectures(monkeypatch):
    from backend.core.config import settings
    import backend.services.course_context_service as ccs
    import backend.services.parser.synthesis as synthesis

    monkeypatch.setattr(settings, "feature_course_brain", True, raising=False)
    _patch_common(monkeypatch)  # installs its own defaults first; overrides below win

    async def fake_ctx(course_id, exclude_lecture_id=None, max_lectures=10):
        return {"prior_lectures": [], "instructor": None, "grading_scheme": None}

    monkeypatch.setattr(ccs, "get_course_synthesis_context", fake_ctx)

    async def boom_cross(*a, **k):
        raise AssertionError("generate_cross_lecture_questions must not run without prior_lectures")

    monkeypatch.setattr(synthesis, "generate_cross_lecture_questions", boom_cross)
    await _run("h", OWNER, filename="Deck.pdf", course_id=str(uuid4()))  # must not raise


async def test_cross_lecture_question_generation_failure_is_non_fatal(monkeypatch):
    from backend.core.config import settings
    import backend.services.course_context_service as ccs
    import backend.services.parser.synthesis as synthesis

    monkeypatch.setattr(settings, "feature_course_brain", True, raising=False)
    rec, run = _patch_common(monkeypatch)  # installs its own defaults first; overrides below win

    async def fake_ctx(course_id, exclude_lecture_id=None, max_lectures=10):
        return {
            "prior_lectures": [{"id": "L0", "title": "Intro", "top_concept": "Vectors"}],
            "instructor": None, "grading_scheme": None,
        }

    monkeypatch.setattr(ccs, "get_course_synthesis_context", fake_ctx)

    async def failing_cross(*a, **k):
        raise RuntimeError("LLM unavailable")

    monkeypatch.setattr(synthesis, "generate_cross_lecture_questions", failing_cross)

    events = await _run("h", OWNER, filename="Deck.pdf", course_id=str(uuid4()))
    types_seq = [t for t, _ in events]
    assert types_seq[-1] == "complete"
    assert rec["deck_quiz"] == [1]  # normal deck quiz still persisted; only the extra step failed


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


async def test_parse_pdf_unified_force_reparse_rebuilds_completed(monkeypatch):
    """force_reparse=True must NOT replay a COMPLETED run — it re-synthesizes and
    rebuilds the existing lecture in place (same lecture_id, no duplicate)."""
    existing = uuid4()
    rec, run = _patch_common(monkeypatch, run_status=RunStatus.COMPLETED, lecture_id=existing)

    async def fake_replay(lecture_id):
        raise AssertionError("replay must not run when force_reparse=True")

    monkeypatch.setattr(persist, "fetch_lecture_for_replay", fake_replay)
    events = await _run("h", OWNER, filename="L.pdf", force_reparse=True)

    types_seq = [t for t, _ in events]
    assert types_seq[-1] == "complete"
    assert rec["cleared"] == [existing]      # stale slides cleared, lecture reused
    assert rec["lectures"] == []             # NO new lecture created
    assert [s[0] for s in rec["slides"]] == [0, 1, 2]  # re-synthesized fresh
    assert RunStatus.COMPLETED in rec["status"]


async def test_parse_pdf_unified_completed_replays_without_force(monkeypatch):
    """The default (force_reparse=False) still replays a COMPLETED run from DB."""
    existing = uuid4()
    rec, run = _patch_common(monkeypatch, run_status=RunStatus.COMPLETED, lecture_id=existing)

    replayed = {"called": False}

    async def fake_replay(lecture_id):
        replayed["called"] = True
        return {"slides": [], "deck_summary": "DS"}

    monkeypatch.setattr(persist, "fetch_lecture_for_replay", fake_replay)
    await _run("h", OWNER, force_reparse=False)
    assert replayed["called"] is True
    assert rec["cleared"] == []              # no re-synthesis on replay
    assert rec["slides"] == []


async def test_parse_pdf_unified_reuses_persisted_regen_instruction_on_reparse(monkeypatch):
    """Roadmap Phase 5.2: a professor's persisted per-slide instruction must
    survive a re-parse's destroy-and-recreate flow — threaded into that
    slide's synthesis context and carried forward onto the new row."""
    existing = uuid4()
    rec, run = _patch_common(monkeypatch, run_status=RunStatus.COMPLETED, lecture_id=existing)
    rec["regen_instructions"] = {1: "Focus on the proof steps."}

    captured_ctx: dict = {}

    async def synth(idx, text, ctx, model, pdf, source_language="en"):
        captured_ctx[idx] = ctx
        return {"title": f"S{idx}", "content": text, "summary": f"sum{idx}", "slide_type": "text"}

    monkeypatch.setattr(uo, "_synthesize_slide", synth)

    captured_insert: dict = {}

    async def insert_slide(lecture_id, idx, slide, *, ai_enhanced=True, parser_engine="unified"):
        captured_insert[idx] = dict(slide)
        return uuid4()

    monkeypatch.setattr(persist, "insert_slide", insert_slide)

    await _run("h", OWNER, filename="L.pdf", force_reparse=True)

    assert "Focus on the proof steps." in captured_ctx[1]
    assert "Focus on the proof steps." not in captured_ctx[0]
    assert "Focus on the proof steps." not in captured_ctx[2]
    assert captured_insert[1]["regen_instruction"] == "Focus on the proof steps."
    assert captured_insert[0]["regen_instruction"] is None


async def test_parse_pdf_unified_resume_reuses_lecture(monkeypatch):
    existing = uuid4()
    rec, run = _patch_common(monkeypatch, run_status=RunStatus.FAILED, lecture_id=existing)
    await _run("h", OWNER, filename="L.pdf")
    assert rec["cleared"] == [existing]          # stale slides cleared
    assert rec["lectures"] == []                 # NO new lecture
    assert rec["titled"] and rec["titled"][0][0] == existing
    assert RunStatus.COMPLETED in rec["status"]


async def test_parse_pdf_unified_on_demand_skips_all_ai(monkeypatch):
    """parsing_mode='on_demand' persists raw slides with NO LLM calls, no deck
    quiz, and ai_enhanced=False / parser_engine='heuristic-v1'."""
    rec, run = _patch_common(monkeypatch, pages=["raw text 0", "raw text 1"])

    import backend.services.parser.synthesis as synthesis

    async def boom_meta(slides, model, course_context_hint="", source_language="en"):
        raise AssertionError("analyze_lecture_meta must not run in on_demand")

    async def boom_synth(idx, text, ctx, model, pdf, source_language="en"):
        raise AssertionError("_synthesize_slide must not run in on_demand")

    async def boom_quiz(slides, title, model, source_language="en"):
        raise AssertionError("generate_quiz_questions must not run in on_demand")

    monkeypatch.setattr(synthesis, "analyze_lecture_meta", boom_meta)
    monkeypatch.setattr(uo, "_synthesize_slide", boom_synth)
    monkeypatch.setattr(synthesis, "generate_quiz_questions", boom_quiz)

    events = await _run("h", OWNER, filename="Deck.pdf", parsing_mode="on_demand")

    types_seq = [t for t, _ in events]
    assert types_seq[-1] == "complete"
    # All slides persisted, flagged not-AI-enhanced via the heuristic engine.
    assert [f[1] for f in rec["slide_flags"]] == [False, False]
    assert all(f[2] == "heuristic-v1" for f in rec["slide_flags"])
    # No deck quiz persisted; content is the raw extracted text.
    assert rec["deck_quiz"] == [0]
    slide_evts = [d["slide"] for t, d in events if t == "slide"]
    assert slide_evts[0]["content"] == "raw text 0"
    assert slide_evts[0]["ai_enhanced"] is False


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

    # The raw exception (whatever "PDF not found" internally raises) must
    # not reach the DB error column or the SSE stream verbatim — both get
    # the same generic message. Full detail is in the server log
    # (logger.exception in the except block) instead.
    error_event = next(d for t, d in events if t == "error")
    assert error_event["message"] == "PDF parsing failed. Please try again or contact support if this keeps happening."
    assert rec["errors"][0] == error_event["message"]


async def test_parse_pdf_unified_marks_failed_on_cancellation_not_left_stuck(monkeypatch):
    """R51/R52 root-cause fix: Arq enforces WorkerSettings.job_timeout by
    cancelling this coroutine at whatever await point it's stuck on, which
    raises asyncio.CancelledError — a BaseException, NOT an Exception. A
    plain `except Exception` would let that fall straight through, skipping
    set_error entirely and leaving the run in 'extracting' with error=NULL
    forever (exactly the Milestone-4 "stuck forever" shape). The except
    clause must catch CancelledError too, mark the run FAILED with a real
    message, and then re-raise it (required for correct asyncio cancellation
    semantics — never swallow it)."""
    rec, run = _patch_common(monkeypatch)

    # Simulate the cancellation landing on this coroutine's OWN await point
    # (what Arq's job_timeout actually does — it cancels the task running
    # parse_pdf_unified itself). This is deliberately NOT raised from inside
    # a per-slide synthesis call: those run under
    # `asyncio.gather(..., return_exceptions=True)`, which absorbs a child's
    # CancelledError as an ordinary per-slide failure rather than propagating
    # it — realistic cancellation happens at a directly-awaited call like
    # this one, not inside a gathered sub-task.
    async def cancelled_fetch(pdf_hash):
        raise asyncio.CancelledError()

    monkeypatch.setattr(uo, "_fetch_pdf_bytes", cancelled_fetch)

    events = []

    async def emit(t, d):
        events.append((t, d))

    with pytest.raises(asyncio.CancelledError):
        await uo.parse_pdf_unified({}, pdf_hash="h", user_id=OWNER, emit_fn=emit, filename="Deck.pdf")

    # The run was marked failed (not left dangling in 'extracting').
    assert rec["errors"]
    assert rec["errors"][0] == "Processing timed out before it could finish. Please try again or contact support if this keeps happening."
    assert any(t == "error" for t, _ in events)
    assert "complete" not in [t for t, _ in events]


# ── Roadmap P3-1: batch synthesis + budget pre-flight gate ───────────────────

_LONG_SLIDE_TEXT = "This is a real lecture slide with plenty of extractable text content, well past the threshold. "


def _long_pages(n: int) -> list:
    return [f"{_LONG_SLIDE_TEXT}Slide {i}." for i in range(n)]


async def test_batch_synthesis_reduces_call_count_to_n_over_8(monkeypatch):
    """Core P3-1 acceptance criterion: a 30-slide deck of text-bearing slides
    parses with ~N/8 synthesis (batch) calls, not N — each call handles a
    whole chunk of QUIZ_BATCH_CONFIG.batch_size (default 8) slides."""
    from backend.services.ai.orchestrator import QUIZ_BATCH_CONFIG

    n = 30
    rec, run = _patch_common(monkeypatch, pages=_long_pages(n))

    async def boom_synth(*a, **kw):
        raise AssertionError("per-slide _synthesize_slide must NOT run when batching succeeds")

    monkeypatch.setattr(uo, "_synthesize_slide", boom_synth)

    events = await _run("h", OWNER, filename="Deck.pdf")

    assert [t for t, _ in events][-1] == "complete"
    assert len(rec["slides"]) == n  # every slide still persisted

    expected_batch_calls = -(-n // QUIZ_BATCH_CONFIG.batch_size)  # ceil(30/8) = 4
    assert expected_batch_calls == 4
    assert len(rec["batch_calls"]) == expected_batch_calls
    # Every slide index appears in exactly one batch call.
    all_batched_indices = sorted(i for batch in rec["batch_calls"] for i in batch)
    assert all_batched_indices == list(range(n))


async def test_batch_failure_falls_back_to_per_slide_for_that_batch_only(monkeypatch):
    """A forced failure on one batch call falls back to per-slide synthesis
    for JUST that batch's slides — the rest of the lecture still uses the
    batched path, and the lecture still completes with the correct total
    slide count."""
    import backend.services.ai.orchestrator as ai_orchestrator
    from backend.services.ai.orchestrator import QUIZ_BATCH_CONFIG

    n = 30
    rec, run = _patch_common(monkeypatch, pages=_long_pages(n))

    call_count = {"n": 0}

    async def flaky_batch(slides_input, ai_model="cerebras", blueprint=None, **_kw):
        call_count["n"] += 1
        if call_count["n"] == 2:  # second chunk's batch call fails
            raise RuntimeError("simulated LLM batch failure")
        rec.setdefault("batch_calls", []).append([s["index"] for s in slides_input])
        return [
            {"index": s["index"], "title": f"S{s['index']}", "summary": f"sum{s['index']}",
             "slide_type": "text"}
            for s in slides_input
        ]

    per_slide_calls = []

    async def fallback_synth(idx, text, ctx, model, pdf, source_language="en"):
        per_slide_calls.append(idx)
        return {"title": f"F{idx}", "content": text, "summary": f"fsum{idx}", "slide_type": "text"}

    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", flaky_batch)
    monkeypatch.setattr(uo, "_synthesize_slide", fallback_synth)

    events = await _run("h", OWNER, filename="Deck.pdf")

    assert [t for t, _ in events][-1] == "complete"
    # Correct total slide count despite the mid-lecture batch failure.
    assert len(rec["slides"]) == n

    bs = QUIZ_BATCH_CONFIG.batch_size
    second_chunk_indices = list(range(bs, min(2 * bs, n)))
    # Per-slide fallback ran for exactly the failing batch's slides — no more.
    assert sorted(per_slide_calls) == second_chunk_indices
    # The other (successful) batches never touched the per-slide path.
    successful_batched = sorted(i for batch in rec["batch_calls"] for i in batch)
    assert set(successful_batched).isdisjoint(second_chunk_indices)
    assert set(successful_batched) | set(second_chunk_indices) == set(range(n))


async def test_preflight_gate_aborts_before_parsing_on_insufficient_headroom(monkeypatch):
    """A parse started with deliberately-insufficient daily provider headroom
    aborts pre-flight with a clear typed error — BEFORE any synthesis or
    lecture creation — not a mid-parse failure."""
    import backend.services.ai.orchestrator as ai_orchestrator

    n = 40
    rec, run = _patch_common(monkeypatch, pages=_long_pages(n))

    class _StarvedRotator:
        def remaining_headroom(self, chain):
            return 3  # far below the ~42-call floor (40 slides + 2)

    monkeypatch.setattr(ai_orchestrator, "get_rotator", lambda: _StarvedRotator())

    async def boom_synth(*a, **kw):
        raise AssertionError("synthesis must never start when pre-flight aborts")

    monkeypatch.setattr(uo, "_synthesize_slide", boom_synth)

    events = []

    async def emit(t, d):
        events.append((t, d))

    with pytest.raises(uo.InsufficientHeadroomError):
        await uo.parse_pdf_unified({}, pdf_hash="h", user_id=OWNER, emit_fn=emit)

    assert rec["errors"]  # run marked FAILED via repos.set_error
    assert any(t == "error" for t, _ in events)
    assert "complete" not in [t for t, _ in events]
    # Never got as far as creating the lecture or persisting a slide.
    assert rec["lectures"] == []
    assert rec["slides"] == []


def test_batch_slide_prompt_labels_slide_text_as_data_not_instructions():
    # Uploads aren't professor-only (require_creator/require_student both
    # gate the upload routes), so slide text embedded under === SLIDE N ===
    # markers can be attacker-controlled. This is a cheap substring pin, not
    # a full LLM-mocked test — it just confirms the guardrail sentence
    # reaches BATCH_SLIDE_PROMPT, mirroring the tutor prompts' HARD RULE.
    from backend.services.ai.prompts import BATCH_SLIDE_PROMPT

    assert "not instructions to you" in BATCH_SLIDE_PROMPT


# ── Arc 5: parse receipt ─────────────────────────────────────────────────────

async def test_parse_pdf_unified_writes_a_parse_receipt(monkeypatch):
    rec, run = _patch_common(monkeypatch)
    await _run("h", OWNER, filename="My Deck.pdf")
    (receipt,) = rec["receipts"]
    assert receipt["run_id"] == run.run_id
    assert receipt["lecture_id"] == rec["lectures"][0][2]
    assert [s["index"] for s in receipt["deck_skeleton"]["slides"]] == [0, 1, 2]
    assert receipt["deck_skeleton"]["slides"][0]["role"] == "title"
    assert [p["index"] for p in receipt["slide_provenance"]] == [0, 1, 2]
    assert receipt["quiz_grounding"] == QUIZ_STATS


async def test_receipt_provenance_records_batch_and_vision_routes(monkeypatch):
    from backend.services.ai.prompts import PROMPT_VERSIONS
    rec, run = _patch_common(monkeypatch, pages=[LONG_A, LONG_B, ""])
    await _run("h", OWNER, filename="Deck.pdf", ai_model="groq")
    prov = rec["receipts"][0]["slide_provenance"]
    assert prov[0] == {
        "index": 0, "route": "batch", "prompt": "BATCH_SLIDE_PROMPT",
        "prompt_version": PROMPT_VERSIONS["BATCH_SLIDE_PROMPT"], "requested_model": "groq",
        "input_text": "raw", "served_by": [], "cost_usd": 0.0,
        "synthesis_failed": False, "needs_review": False, "review_reason": None,
    }
    assert prov[2]["input_text"] == "raw"
    assert prov[1]["route"] == "batch"
    assert prov[2]["route"] == "vision"
    assert prov[2]["prompt"] == "SLIDE_VISION_PROMPT"
    assert prov[2]["requested_model"] == uo.settings.vision_model


async def test_receipt_marks_per_slide_fallback_when_batch_fails(monkeypatch):
    import backend.services.ai.orchestrator as ai_orchestrator
    rec, run = _patch_common(monkeypatch, pages=[LONG_A, LONG_B])

    async def failing_batch(*_a, **_k):
        raise RuntimeError("batch provider down")

    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", failing_batch)
    await _run("h", OWNER, filename="Deck.pdf")
    prov = rec["receipts"][0]["slide_provenance"]
    assert [p["route"] for p in prov] == ["per_slide", "per_slide"]
    assert prov[0]["prompt"] == "SLIDE_ANALYSIS_PROMPT"


async def test_receipt_flags_a_failed_slide(monkeypatch):
    rec, run = _patch_common(monkeypatch)

    async def synth(idx, text, ctx, model, pdf, source_language="en"):
        if idx == 1:
            raise RuntimeError("provider exploded")
        return {"title": f"S{idx}", "content": text, "summary": f"sum{idx}", "slide_type": "text"}

    monkeypatch.setattr(uo, "_synthesize_slide", synth)
    await _run("h", OWNER, filename="Deck.pdf")
    prov = rec["receipts"][0]["slide_provenance"]
    assert prov[1]["synthesis_failed"] is True and prov[1]["needs_review"] is True
    assert prov[0]["synthesis_failed"] is False


async def test_on_demand_receipt_is_heuristic_with_no_quiz_grounding(monkeypatch):
    rec, run = _patch_common(monkeypatch, pages=["raw text 0", "raw text 1"])
    await _run("h", OWNER, filename="Deck.pdf", parsing_mode="on_demand")
    (receipt,) = rec["receipts"]
    assert [p["route"] for p in receipt["slide_provenance"]] == ["heuristic", "heuristic"]
    assert receipt["slide_provenance"][0]["prompt"] is None
    assert receipt["slide_provenance"][0]["prompt_version"] is None
    assert receipt["slide_provenance"][0]["requested_model"] is None
    assert receipt["quiz_grounding"] is None


async def test_receipt_written_without_skeleton_when_skeleton_fails(monkeypatch):
    rec, run = _patch_common(monkeypatch)

    def boom(pages):
        raise RuntimeError("skeleton exploded")

    monkeypatch.setattr("backend.services.parser.deck_plan.build_deck_skeleton", boom)
    await _run("h", OWNER, filename="Deck.pdf")
    (receipt,) = rec["receipts"]
    assert receipt["deck_skeleton"] is None
    assert len(receipt["slide_provenance"]) == 3


async def test_receipt_write_failure_never_fails_the_parse(monkeypatch, caplog):
    import logging
    rec, run = _patch_common(monkeypatch)

    async def boom(*_a, **_k):
        raise RuntimeError("parse_receipts table missing")

    monkeypatch.setattr(uo.repos, "save_parse_receipt", boom)
    caplog.set_level(logging.WARNING, logger=uo.logger.name)
    events = await _run("h", OWNER, filename="Deck.pdf")
    assert events[-1][0] == "complete"
    assert RunStatus.COMPLETED in rec["status"]
    assert rec["errors"] == []
    assert "parse receipt write failed" in caplog.text


# ── Arc 7: per-slide synthesis input ─────────────────────────────────────────

ARC7_FOOTER = "Prof Example Course Footer"
ARC7_DECK = [
    f"Short Title Bravo\n{ARC7_FOOTER}",  # stripped = 17 chars -> raw fallback
    f"Breadth-first search visits every vertex level by level.\n{ARC7_FOOTER}",
    f"Depth-first search follows one branch to its end first.\n{ARC7_FOOTER}",
    f"Dijkstra finds shortest paths with nonnegative weights.\n{ARC7_FOOTER}",
]


def _slide_contents(events):
    return {d["index"]: d["slide"]["content"] for t, d in events if t == "slide"}


async def test_batch_synthesis_gets_stripped_text_but_slides_keep_raw_content(monkeypatch):
    import backend.services.ai.orchestrator as ai_orchestrator
    rec, run = _patch_common(monkeypatch, pages=ARC7_DECK)
    sent = {}

    async def capturing_batch(slides_input, ai_model="cerebras", blueprint=None, **_kw):
        sent.update({s["index"]: s["text"] for s in slides_input})
        return [{"index": s["index"], "title": f"S{s['index']}", "summary": f"sum{s['index']}",
                 "slide_type": "text"} for s in slides_input]

    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", capturing_batch)
    events = await _run("h", OWNER, filename="Deck.pdf")

    assert sent[1] == "Breadth-first search visits every vertex level by level."
    assert all(ARC7_FOOTER not in sent[i] for i in (1, 2, 3))
    assert sent[0] == ARC7_DECK[0]  # never sent near-empty
    assert _slide_contents(events) == dict(enumerate(ARC7_DECK))


async def test_per_slide_fallback_gets_stripped_text_but_slides_keep_raw_content(monkeypatch):
    import backend.services.ai.orchestrator as ai_orchestrator
    rec, run = _patch_common(monkeypatch, pages=ARC7_DECK)

    async def failing_batch(*_a, **_k):
        raise RuntimeError("batch provider down")

    seen = {}

    async def synth(idx, text, ctx, model, pdf, source_language="en"):
        seen[idx] = text
        return {"title": f"S{idx}", "content": text, "summary": f"sum{idx}", "slide_type": "text"}

    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", failing_batch)
    monkeypatch.setattr(uo, "_synthesize_slide", synth)
    events = await _run("h", OWNER, filename="Deck.pdf")

    assert seen[2] == "Depth-first search follows one branch to its end first."
    assert seen[0] == ARC7_DECK[0]
    assert _slide_contents(events) == dict(enumerate(ARC7_DECK))


def test_input_text_kind():
    assert uo._input_text_kind("heuristic", "raw", None) is None
    assert uo._input_text_kind("batch", "raw page", "stripped page") == "stripped"
    assert uo._input_text_kind("per_slide", "raw page", "raw page") == "raw"
    assert uo._input_text_kind("per_slide", "raw page", None) == "raw"
    assert uo._input_text_kind("batch", "raw page", None) == "raw"
    assert uo._input_text_kind("vision", "raw page", "stripped page") == "raw"


def test_input_text_kind_is_raw_when_only_blank_lines_were_dropped():
    # strip_boilerplate always joins non-blank lines, so a page with a trailing
    # newline or blank line differs from its "stripped" text even when no
    # boilerplate line was removed. That is "raw", not "stripped".
    from backend.services.parser.deck_plan import strip_boilerplate
    bp = frozenset({"footer #"})
    plain = "Depth-first search\n\nfollows one branch\n"
    footed = "Depth-first search\nfollows one branch\nFooter 3\n"
    assert uo._input_text_kind("batch", plain, strip_boilerplate(plain, bp)) == "raw"
    assert uo._input_text_kind("per_slide", footed, strip_boilerplate(footed, bp)) == "stripped"
    # synthesis_text's raw fallback hands the raw page back unchanged
    assert uo._input_text_kind("batch", footed, footed) == "raw"


async def test_receipt_records_what_text_each_slide_prompt_received(monkeypatch):
    rec, run = _patch_common(monkeypatch, pages=ARC7_DECK)
    await _run("h", OWNER, filename="Deck.pdf")
    prov = rec["receipts"][0]["slide_provenance"]
    assert [p["input_text"] for p in prov] == ["raw", "stripped", "stripped", "stripped"]


async def test_on_demand_receipt_has_no_input_text(monkeypatch):
    rec, run = _patch_common(monkeypatch, pages=["raw text 0", "raw text 1"])
    await _run("h", OWNER, filename="Deck.pdf", parsing_mode="on_demand")
    assert [p["input_text"] for p in rec["receipts"][0]["slide_provenance"]] == [None, None]


def test_prompt_versions_follow_the_input_contract_policy():
    from backend.services.ai.prompts import PROMPT_VERSIONS
    # Single-caller prompts whose input changed: bumped.
    assert PROMPT_VERSIONS["SLIDE_ANALYSIS_PROMPT"] == "v3"
    assert PROMPT_VERSIONS["LECTURE_META_ANALYSIS_PROMPT"] == "v3"
    # Shared with raw-text callers (file_parse_service, slide_synth_service): not
    # bumped; slide_provenance[].input_text says what each slide received.
    assert PROMPT_VERSIONS["BATCH_SLIDE_PROMPT"] == "v3"


# ── Arc 7: LLM call context ──────────────────────────────────────────────────

async def test_each_parse_llm_call_runs_inside_its_scope(monkeypatch):
    import backend.services.ai.orchestrator as ai_orchestrator
    import backend.services.parser.synthesis as synthesis
    from backend.services.ai.call_context import current_llm_call_context

    rec, run = _patch_common(monkeypatch, pages=[LONG_A, LONG_B, ""])
    seen = {}

    def snap(key):
        c = current_llm_call_context()
        seen[key] = (c.run_id, c.slide_indices, c.prompt_name, c.calls is not None)

    async def batch(slides_input, ai_model="cerebras", blueprint=None, **_kw):
        snap("batch")
        return [{"index": s["index"], "title": "T", "summary": "S", "slide_type": "text"}
                for s in slides_input]

    async def synth(idx, text, ctx, model, pdf, source_language="en"):
        snap(f"slide{idx}")
        return {"title": "T", "content": text, "summary": "S", "slide_type": "text", "vision_routed": True}

    async def meta(slides, model, course_context_hint="", source_language="en", skeleton=None):
        snap("meta")
        return {"title": "L", "summary": "D"}

    async def quiz(slides, title, model, source_language="en", skeleton=None, stats=None):
        snap("quiz")
        return []

    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", batch)
    monkeypatch.setattr(uo, "_synthesize_slide", synth)
    monkeypatch.setattr(synthesis, "analyze_lecture_meta", meta)
    monkeypatch.setattr(synthesis, "generate_quiz_questions", quiz)
    await _run("h", OWNER, filename="Deck.pdf")

    rid = str(run.run_id)
    assert seen["meta"] == (rid, None, "LECTURE_META_ANALYSIS_PROMPT", True)
    assert seen["batch"] == (rid, (0, 1), "BATCH_SLIDE_PROMPT", True)
    assert seen["slide2"] == (rid, (2,), "SLIDE_VISION_PROMPT", True)
    assert seen["quiz"] == (rid, None, "SYNTHESIS_DECK_QUIZ_PROMPT", True)
    assert current_llm_call_context().run_id is None  # reset after the parse


async def test_per_slide_fallback_calls_are_scoped_to_their_own_slide(monkeypatch):
    import backend.services.ai.orchestrator as ai_orchestrator
    from backend.services.ai.call_context import current_llm_call_context

    rec, run = _patch_common(monkeypatch, pages=[LONG_A, LONG_B])

    async def failing_batch(*_a, **_k):
        raise RuntimeError("batch provider down")

    seen = {}

    async def synth(idx, text, ctx, model, pdf, source_language="en"):
        await asyncio.sleep(0)  # interleave the gathered tasks
        c = current_llm_call_context()
        seen[idx] = (c.slide_indices, c.prompt_name)
        return {"title": "T", "content": text, "summary": "S", "slide_type": "text"}

    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", failing_batch)
    monkeypatch.setattr(uo, "_synthesize_slide", synth)
    await _run("h", OWNER, filename="Deck.pdf")
    assert seen == {0: ((0,), "SLIDE_ANALYSIS_PROMPT"), 1: ((1,), "SLIDE_ANALYSIS_PROMPT")}


async def test_call_context_is_reset_when_the_parse_fails(monkeypatch):
    import backend.services.ai.orchestrator as ai_orchestrator
    from backend.services.ai.call_context import current_llm_call_context

    rec, run = _patch_common(monkeypatch, pages=_long_pages(40))

    class _StarvedRotator:
        def remaining_headroom(self, chain):
            return 3

    monkeypatch.setattr(ai_orchestrator, "get_rotator", lambda: _StarvedRotator())
    with pytest.raises(uo.InsufficientHeadroomError):
        await _run("h", OWNER)
    assert current_llm_call_context() == type(current_llm_call_context())()


async def test_each_parse_attempt_and_concurrent_parse_gets_its_own_calls_list(monkeypatch):
    """A re-parse must not inherit the previous attempt's calls, and two parses
    running at once must never share a list."""
    import backend.services.ai.orchestrator as ai_orchestrator
    from backend.services.ai.call_context import current_llm_call_context

    _patch_common(monkeypatch, pages=[LONG_A, LONG_B])
    lists = []

    async def batch(slides_input, ai_model="cerebras", blueprint=None, **_kw):
        await asyncio.sleep(0)  # let the concurrent parse interleave
        lists.append(current_llm_call_context().calls)
        return [{"index": s["index"], "title": "T", "summary": "S", "slide_type": "text"}
                for s in slides_input]

    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", batch)
    await asyncio.gather(_run("h1", OWNER, filename="A.pdf"), _run("h2", OWNER, filename="B.pdf"))
    await _run("h3", OWNER, filename="C.pdf")
    assert len(lists) == 3
    assert all(l is not None for l in lists)
    assert len({id(l) for l in lists}) == 3


# ── Arc 7: serving provider/cost in the receipt ─────────────────────────────

def _served(provider, model, pt, ct, cost, prompt, slides, version=None):
    from backend.services.ai.call_context import ServedCall
    return ServedCall(provider=provider, model=model, prompt_tokens=pt, completion_tokens=ct,
                      cost_usd=cost, prompt_name=prompt, slide_indices=slides,
                      prompt_version=version)


def test_llm_usage_receipt_splits_a_batch_call_and_totals_the_run():
    prov = [{"index": 0, "route": "batch"}, {"index": 1, "route": "batch"}, {"index": 2, "route": "vision"}]
    calls = [
        _served("openai", "gpt-4o-mini", 2000, 1000, 0.0009, "BATCH_SLIDE_PROMPT", (0, 1), "v3"),
        _served("groq", "gpt-oss-120b", 500, 100, 0.0, "LECTURE_META_ANALYSIS_PROMPT", None),
        _served("groq", "gpt-oss-20b", 300, 50, 0.0, None, (7,)),  # slide not in receipt
    ]
    out, usage = uo._llm_usage_receipt(prov, calls)
    assert "served_by" not in prov[0]  # input not mutated
    assert out[0]["served_by"] == [{
        "provider": "openai", "model": "gpt-4o-mini", "prompt": "BATCH_SLIDE_PROMPT",
        "prompt_version": "v3",
        "prompt_tokens": 2000, "completion_tokens": 1000, "cost_usd": 0.0009, "shared_by": 2,
    }]
    assert out[0]["cost_usd"] == pytest.approx(0.00045)
    assert out[2]["served_by"] == [] and out[2]["cost_usd"] == 0.0
    assert usage["calls"] == 3
    assert (usage["prompt_tokens"], usage["completion_tokens"]) == (2800, 1150)
    assert usage["cost_usd"] == pytest.approx(0.0009)
    assert usage["by_prompt"]["LECTURE_META_ANALYSIS_PROMPT"] == {"calls": 1, "cost_usd": 0.0}
    assert usage["by_prompt"]["unnamed"]["calls"] == 1
    assert usage["by_provider"]["openai"] == {"calls": 1, "cost_usd": 0.0009}
    assert usage["vision_metered"] is False
    assert usage["unmetered"] == ["vision", "embeddings", "admin_slide_classifier"]
    assert usage["dropped_calls"] == 0


def test_llm_usage_receipt_surfaces_dropped_calls():
    from backend.services.ai.call_context import CallLog
    log = CallLog([_served("groq", "m", 1, 1, 0.0, "P", (0,))])
    log.dropped = 4
    _, usage = uo._llm_usage_receipt([{"index": 0}], log)
    assert usage["dropped_calls"] == 4


def test_run_level_calls_count_in_totals_but_never_in_a_slide():
    prov = [{"index": 0, "route": "batch"}]
    calls = [_served("groq", "m", 10, 5, 0.01, "CROSS_LECTURE_QUIZ_PROMPT", None)]
    out, usage = uo._llm_usage_receipt(prov, calls)
    assert out[0]["served_by"] == [] and out[0]["cost_usd"] == 0.0
    assert usage["cost_usd"] == pytest.approx(0.01)
    assert usage["by_prompt"]["CROSS_LECTURE_QUIZ_PROMPT"]["calls"] == 1


async def test_receipt_records_serving_provider_and_cost(monkeypatch):
    import backend.services.ai.orchestrator as ai_orchestrator
    import backend.services.parser.synthesis as synthesis
    from backend.services.ai import cost as cost_module
    from backend.services.ai.cost import LLMUsage

    rec, run = _patch_common(monkeypatch, pages=[LONG_A, LONG_B, ""])
    logged = []

    async def fake_log(**kw):
        logged.append(kw)

    async def noop(*_a, **_k):
        return None

    monkeypatch.setattr(cost_module, "log_llm_call", fake_log)
    monkeypatch.setattr(cost_module, "get_redis_or_none", lambda: None)
    monkeypatch.setattr(ai_orchestrator._rotator, "flush_openai_cost_to_redis", noop)

    async def metered(provider, model, pt, ct):
        await ai_orchestrator._account_for_call(
            provider, model, LLMUsage(prompt_tokens=pt, completion_tokens=ct),
            user_id=None, course_id=None, feature="test", duration_seconds=0.0,
        )

    async def batch(slides_input, ai_model="cerebras", blueprint=None, **_kw):
        await metered("openai", "gpt-4o-mini", 2000, 1000)  # $0.0003 + $0.0006
        return [{"index": s["index"], "title": f"S{s['index']}", "summary": f"sum{s['index']}",
                 "slide_type": "text"} for s in slides_input]

    async def meta(slides, model, course_context_hint="", source_language="en", skeleton=None):
        await metered("groq", "gpt-oss-120b", 500, 100)
        return {"title": "L", "summary": "D"}

    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", batch)
    monkeypatch.setattr(synthesis, "analyze_lecture_meta", meta)
    await _run("h", OWNER, filename="Deck.pdf")

    (receipt,) = rec["receipts"]
    prov = receipt["slide_provenance"]
    assert prov[0]["served_by"][0]["provider"] == "openai"
    assert prov[0]["served_by"][0]["shared_by"] == 2
    assert prov[0]["cost_usd"] == pytest.approx(0.00045)
    assert prov[2]["served_by"] == []  # vision: not metered
    usage = receipt["llm_usage"]
    assert usage["calls"] == 2 and usage["cost_usd"] == pytest.approx(0.0009)
    assert usage["by_prompt"]["LECTURE_META_ANALYSIS_PROMPT"]["calls"] == 1
    assert {row["run_id"] for row in logged} == {str(run.run_id)}


async def test_usage_fold_failure_still_writes_the_receipt(monkeypatch):
    rec, run = _patch_common(monkeypatch)

    def boom(*_a, **_k):
        raise RuntimeError("fold exploded")

    monkeypatch.setattr(uo, "_llm_usage_receipt", boom)
    events = await _run("h", OWNER, filename="Deck.pdf")
    assert events[-1][0] == "complete"
    (receipt,) = rec["receipts"]
    assert receipt["llm_usage"] is None
    assert "served_by" not in receipt["slide_provenance"][0]
