"""Integration tests for the on-demand slide AI endpoints (backend/api/v1/slides_ai.py).

These endpoints persist AI output straight into slides / quiz_questions and flip
slides.ai_enhanced, so the risks are: writing on someone else's lecture (authz),
shipping a malformed quiz row, and the deck-quiz linked-slides repair. The LLM
calls are the only real I/O — patched to canned values. Supabase is the in-memory
fake; we assert on the fake's tables to prove what was (and wasn't) persisted.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token
from backend.api.v1 import slides_ai
from backend.services import analytics_cache

H = {"Authorization": "Bearer x"}


@pytest.fixture(autouse=True)
def _no_cache_io(monkeypatch):
    # Keep tests focused on the endpoint; don't exercise the analytics cache.
    monkeypatch.setattr(
        analytics_cache, "invalidate_course_overview_for_lecture", lambda *_a, **_k: None
    )


def _seed_one_slide(fake, *, owner="00000000-0000-0000-0000-000000000001", content="Newton's laws of motion."):
    fake.seed("lectures", [{"id": "L1", "professor_id": owner}])
    fake.seed("slides", [{
        "id": "S1", "lecture_id": "L1", "slide_number": 1,
        "title": "Slide 1", "content_text": content, "summary": "",
        "ai_enhanced": False, "parser_engine": "pymupdf",
        "lectures": {"professor_id": owner},
    }])
    fake.seed("quiz_questions", [])


# ── ownership / not-found / validation ────────────────────────────────────────

def test_regenerate_title_403_for_non_owner(app, other_professor_user, patch_supabase, monkeypatch):
    _seed_one_slide(patch_supabase, owner="00000000-0000-0000-0000-000000000001")
    monkeypatch.setattr(slides_ai, "generate_slide_title", _afn("should not be called"))
    app.dependency_overrides[verify_token] = lambda: other_professor_user  # prof-2
    r = TestClient(app).post("/api/ai/slides/S1/regenerate-title", json={}, headers=H)
    assert r.status_code == 403


def test_regenerate_title_404_when_slide_missing(app, professor_user, patch_supabase, monkeypatch):
    patch_supabase.seed("slides", [])
    monkeypatch.setattr(slides_ai, "generate_slide_title", _afn("x"))
    app.dependency_overrides[verify_token] = lambda: professor_user
    r = TestClient(app).post("/api/ai/slides/NOPE/regenerate-title", json={}, headers=H)
    assert r.status_code == 404


def test_regenerate_title_400_when_slide_has_no_text(app, professor_user, patch_supabase, monkeypatch):
    patch_supabase.seed("lectures", [{"id": "L1", "professor_id": "00000000-0000-0000-0000-000000000001"}])
    patch_supabase.seed("slides", [{
        "id": "S1", "lecture_id": "L1", "slide_number": 1,
        "title": "", "content_text": "", "summary": "", "ai_enhanced": False,
        "lectures": {"professor_id": "00000000-0000-0000-0000-000000000001"},
    }])
    monkeypatch.setattr(slides_ai, "generate_slide_title", _afn("x"))
    app.dependency_overrides[verify_token] = lambda: professor_user
    r = TestClient(app).post("/api/ai/slides/S1/regenerate-title", json={}, headers=H)
    assert r.status_code == 400


def test_invalid_ai_model_is_rejected_422(app, professor_user, patch_supabase):
    # AI-20: 'deepseek' was dropped from the allow-list; it must now 422.
    _seed_one_slide(patch_supabase)
    app.dependency_overrides[verify_token] = lambda: professor_user
    r = TestClient(app).post(
        "/api/ai/slides/S1/regenerate-title", json={"ai_model": "deepseek"}, headers=H
    )
    assert r.status_code == 422


# ── happy paths + persistence ─────────────────────────────────────────────────

def test_regenerate_title_persists_and_flips_ai_enhanced(app, professor_user, patch_supabase, monkeypatch):
    _seed_one_slide(patch_supabase)
    monkeypatch.setattr(slides_ai, "generate_slide_title", _afn("Newton's Three Laws"))
    app.dependency_overrides[verify_token] = lambda: professor_user

    r = TestClient(app).post("/api/ai/slides/S1/regenerate-title", json={}, headers=H)
    assert r.status_code == 200
    assert r.json()["title"] == "Newton's Three Laws"

    row = next(s for s in patch_supabase.tables["slides"] if s["id"] == "S1")
    assert row["title"] == "Newton's Three Laws"
    assert row["ai_enhanced"] is True


def test_regenerate_title_502_on_ai_failure(app, professor_user, patch_supabase, monkeypatch):
    _seed_one_slide(patch_supabase)

    async def _boom(*_a, **_k):
        raise RuntimeError("provider down")
    monkeypatch.setattr(slides_ai, "generate_slide_title", _boom)
    app.dependency_overrides[verify_token] = lambda: professor_user

    r = TestClient(app).post("/api/ai/slides/S1/regenerate-title", json={}, headers=H)
    assert r.status_code == 502
    # Nothing should have been flipped when generation failed.
    row = next(s for s in patch_supabase.tables["slides"] if s["id"] == "S1")
    assert row["ai_enhanced"] is False


def test_generate_slide_quiz_persists_question_row(app, professor_user, patch_supabase, monkeypatch):
    _seed_one_slide(patch_supabase)
    quiz = {
        "question": "Which law explains recoil?",
        "options": ["First", "Second", "Third", "Fourth"],
        "correctAnswer": 2,
        "explanation": "Action-reaction.",
    }
    monkeypatch.setattr(slides_ai, "generate_quiz", _afn(quiz))
    app.dependency_overrides[verify_token] = lambda: professor_user

    r = TestClient(app).post("/api/ai/slides/S1/generate-quiz", json={}, headers=H)
    assert r.status_code == 200

    qrows = patch_supabase.tables["quiz_questions"]
    assert len(qrows) == 1
    saved = qrows[0]
    assert saved["slide_id"] == "S1"
    assert saved["question_text"] == "Which law explains recoil?"
    assert saved["correct_answer"] == 2          # coerced to int
    assert saved["options"] == ["First", "Second", "Third", "Fourth"]
    assert saved["metadata"].get("explanation") == "Action-reaction."


def test_generate_slide_quiz_coerces_noninteger_correct_answer_to_zero(app, professor_user, patch_supabase, monkeypatch):
    _seed_one_slide(patch_supabase)
    quiz = {"question": "Q", "options": ["a", "b"], "correctAnswer": "not-a-number"}
    monkeypatch.setattr(slides_ai, "generate_quiz", _afn(quiz))
    app.dependency_overrides[verify_token] = lambda: professor_user

    r = TestClient(app).post("/api/ai/slides/S1/generate-quiz", json={}, headers=H)
    assert r.status_code == 200
    assert patch_supabase.tables["quiz_questions"][0]["correct_answer"] == 0


# ── deck quiz: linked-slides repair ───────────────────────────────────────────

def _seed_deck(fake, owner="00000000-0000-0000-0000-000000000001", n=4):
    fake.seed("lectures", [{"id": "L1", "professor_id": owner}])
    fake.seed("slides", [
        {"id": f"S{i}", "lecture_id": "L1", "slide_number": i + 1,
         "title": f"Slide {i+1}", "content_text": f"content {i}", "summary": ""}
        for i in range(n)
    ])
    fake.seed("quiz_questions", [])


def test_deck_quiz_drops_items_with_fewer_than_two_valid_links(app, professor_user, patch_supabase, monkeypatch):
    _seed_deck(patch_supabase, n=4)
    monkeypatch.setattr(slides_ai, "generate_deck_summary", _afn("a deck summary"))
    monkeypatch.setattr(slides_ai, "generate_deck_quiz", _afn([
        {"question": "Valid", "options": ["a", "b"], "correctAnswer": 1, "linked_slides": [0, 2]},
        {"question": "OneLink", "options": ["a", "b"], "correctAnswer": 0, "linked_slides": [1]},   # <2 -> drop
        {"question": "", "options": ["a"], "correctAnswer": 0, "linked_slides": [0, 1]},            # empty -> drop
        {"question": "OutOfRange", "options": ["a"], "correctAnswer": 0, "linked_slides": [0, 99]}, # 99 invalid -> 1 link -> drop
    ]))
    app.dependency_overrides[verify_token] = lambda: professor_user

    r = TestClient(app).post("/api/ai/decks/L1/generate-quiz", json={}, headers=H)
    assert r.status_code == 200
    assert r.json()["persisted"] == 1

    qrows = patch_supabase.tables["quiz_questions"]
    assert len(qrows) == 1
    saved = qrows[0]
    assert saved["question_text"] == "Valid"
    assert saved["slide_id"] == "S0"                       # anchored to first linked slide
    assert saved["metadata"]["linked_slides"] == [0, 2]


def test_deck_quiz_403_for_non_owner(app, other_professor_user, patch_supabase, monkeypatch):
    _seed_deck(patch_supabase, owner="00000000-0000-0000-0000-000000000001")
    monkeypatch.setattr(slides_ai, "generate_deck_summary", _afn("x"))
    monkeypatch.setattr(slides_ai, "generate_deck_quiz", _afn([]))
    app.dependency_overrides[verify_token] = lambda: other_professor_user
    r = TestClient(app).post("/api/ai/decks/L1/generate-quiz", json={}, headers=H)
    assert r.status_code == 403


# ── helpers ───────────────────────────────────────────────────────────────────

def _afn(return_value):
    """Build an async function that ignores args and returns return_value."""
    async def _fn(*_a, **_k):
        return return_value
    return _fn
