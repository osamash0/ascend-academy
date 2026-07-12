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
    import backend.services.parser.synthesis as synthesis

    async def fake_analyze_slide(num, text, ctx, model):
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
           "finalize": [], "run_lecture": [], "cleared": [], "titled": [], "pdf": []}
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

    async def synth(idx, text, ctx, model, pdf):
        return {"title": f"S{idx}", "content": text, "summary": f"sum{idx}", "slide_type": "text"}

    async def store_pdf(lecture_id, filename, pdf_bytes):
        rec["pdf"].append(lecture_id)
        return f"lectures/{lecture_id}/x.pdf"

    async def create_lecture(*, title, professor_id, pdf_hash, pdf_url=None, course_id=None):
        lid = uuid4()
        rec["lectures"].append((title, professor_id, lid))
        return lid

    async def set_run_lecture(rid, lid):
        rec["run_lecture"].append((rid, lid))

    async def clear_lecture_content(lid):
        rec["cleared"].append(lid)

    async def fetch_regen_instructions(lid):
        return rec.get("regen_instructions", {})

    async def set_lecture_title(lid, title):
        rec["titled"].append((lid, title))

    async def set_lecture_pdf_url(lid, url):
        rec["pdf"].append((lid, url))

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
    monkeypatch.setattr(persist, "set_lecture_pdf_url", set_lecture_pdf_url)
    monkeypatch.setattr(persist, "insert_slide", insert_slide)
    monkeypatch.setattr(persist, "insert_slide_quizzes", insert_slide_quizzes)
    monkeypatch.setattr(persist, "insert_deck_quizzes", insert_deck_quizzes)
    monkeypatch.setattr(persist, "finalize_lecture", finalize_lecture)

    import backend.services.parser.synthesis as synthesis
    import backend.services.file_parse_service as fps
    import backend.services.cache as cache
    import backend.services.concept_graph as concept_graph
    import backend.services.content_filter as content_filter
    import backend.services.course_context_service as course_context_service

    async def meta(slides, model, course_context_hint=""):
        return {"title": "DB Lecture", "summary": "Deck summary.", "keyTopics": ["Gradient Descent", "Loss Functions"]}

    async def quiz(slides, title, model):
        return [{"question": "dq", "options": ["a", "b", "c", "d"], "correctAnswer": "a", "slideId": 1}]

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

    monkeypatch.setattr(synthesis, "analyze_lecture_meta", meta)
    monkeypatch.setattr(synthesis, "generate_quiz_questions", quiz)
    monkeypatch.setattr(fps, "_safe_embedding_task", embed)
    monkeypatch.setattr(cache, "attach_lecture_id_to_embeddings", attach)
    monkeypatch.setattr(concept_graph, "ingest_lecture_concepts", ingest_concepts)
    monkeypatch.setattr(content_filter, "is_metadata_slide", is_metadata_default)
    monkeypatch.setattr(course_context_service, "get_course_synthesis_context", course_ctx_default)
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


async def test_parse_pdf_unified_propagates_vision_routed_on_slide_event(monkeypatch):
    """Roadmap Phase 2.2: vision_routed must survive from _synthesize_slide's
    return value into the per-slide SSE ui_slide dict, so the frontend
    overlay can show a "vision-assisted" signal for scanned/handwritten
    pages."""
    rec, run = _patch_common(monkeypatch, pages=["text 0", "", "text 2"])

    async def synth(idx, text, ctx, model, pdf):
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

    async def synth(idx, text, ctx, model, pdf):
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

    async def synth(idx, text, ctx, model, pdf):
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

    async def synth(idx, text, ctx, model, pdf):
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

    async def fake_meta(slides, model, course_context_hint=""):
        captured_hints.append(course_context_hint)
        return {"title": "DB Lecture", "summary": "Deck summary.", "keyTopics": []}

    monkeypatch.setattr(synthesis, "analyze_lecture_meta", fake_meta)

    captured_slide_ctx = []

    async def fake_synth(idx, text, ctx, model, pdf):
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

    async def fake_meta(slides, model, course_context_hint=""):
        captured_hints.append(course_context_hint)
        return {"title": "DB Lecture", "summary": "Deck summary.", "keyTopics": []}

    monkeypatch.setattr(synthesis, "analyze_lecture_meta", fake_meta)

    captured_slide_ctx = []

    async def fake_synth(idx, text, ctx, model, pdf):
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

    async def synth(idx, text, ctx, model, pdf):
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

    async def boom_meta(slides, model):
        raise AssertionError("analyze_lecture_meta must not run in on_demand")

    async def boom_synth(idx, text, ctx, model, pdf):
        raise AssertionError("_synthesize_slide must not run in on_demand")

    async def boom_quiz(slides, title, model):
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
