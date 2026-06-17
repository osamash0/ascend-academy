"""End-to-end validation of the unified pipeline's server-authoritative
persistence against a REAL Postgres (testcontainers + all migrations).

The synthesis (per-slide LLM, vision, extraction) is mocked; persistence runs
for real against the actual schema — validating that lectures/slides/deck-quiz
persist correctly (column types, NOT NULL, FK to auth.users, jsonb, cascade),
the parse_runs lifecycle records, quiz answers drop-not-default, deck questions
anchor to a slide, and a re-run replays without duplicating the lecture.

Gated behind `db` (needs Docker + testcontainers).
"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db


def _areturn(val):
    async def _f(*_a, **_k):
        return val
    return _f


@pytest.fixture
async def wired_pool(pg_dsn, applied_migrations):
    """Point the app's global asyncpg pool at the throwaway container."""
    import asyncpg
    import backend.core.database as core

    pool = await asyncpg.create_pool(pg_dsn, min_size=1, max_size=4, statement_cache_size=0)
    old = core.db_pool
    core.db_pool = pool
    try:
        yield pool
    finally:
        core.db_pool = old
        await pool.close()


def _patch_synthesis(monkeypatch, *, pages, deck_quiz):
    """Mock everything except persistence (which hits the real DB)."""
    import backend.services.parser.unified_orchestrator as uo
    import backend.services.parser.v4_orchestrator as v4
    import backend.services.file_parse_service as fps
    import backend.services.cache as cache

    async def synth(idx, text, ctx, model, pdf):
        return {"title": f"Slide {idx} title", "content": text,
                "summary": f"Explanation for slide {idx}.", "slide_type": "text"}

    monkeypatch.setattr(uo, "_fetch_pdf_bytes", _areturn(b"%PDF-fake"))
    monkeypatch.setattr(uo, "_store_lecture_pdf", _areturn(None))
    monkeypatch.setattr(uo, "_extract_pages", lambda pdf, odl=None: pages)
    monkeypatch.setattr(uo, "_synthesize_slide", synth)
    monkeypatch.setattr(v4, "analyze_lecture_meta", _areturn({"title": "E2E Lecture", "summary": "Deck summary."}))
    monkeypatch.setattr(v4, "generate_quiz_questions", _areturn(deck_quiz))
    monkeypatch.setattr(fps, "_safe_embedding_task", _areturn(None))
    monkeypatch.setattr(cache, "attach_lecture_id_to_embeddings", _areturn(0))


async def _run(pdf_hash, professor):
    import backend.services.parser.unified_orchestrator as uo
    events = []

    async def emit(t, d):
        events.append((t, d))

    await uo.parse_pdf_unified({}, pdf_hash=pdf_hash, user_id=str(professor), emit_fn=emit, filename="Deck.pdf")
    return events


async def test_unified_persists_full_hierarchy(wired_pool, db_conn, make_user, monkeypatch):
    prof = make_user(role="professor")
    _patch_synthesis(monkeypatch, pages=["t0", "t1", "t2"], deck_quiz=[
        {"question": "dq", "options": ["a", "b", "c", "d"], "correctAnswer": "a", "slideId": 1},
    ])

    events = await _run("hash_full", prof)
    assert [t for t, _ in events][-1] == "complete"
    assert next(d for t, d in events if t == "meta").get("lecture_id")

    cur = db_conn.cursor()
    cur.execute("SELECT id, title, total_slides, professor_id FROM lectures WHERE pdf_hash=%s", ("hash_full",))
    rows = cur.fetchall()
    assert len(rows) == 1
    lid, title, total, prof_id = rows[0]
    assert title == "E2E Lecture" and total == 3 and str(prof_id) == str(prof)

    cur.execute("SELECT count(*), bool_and(summary <> '') FROM slides WHERE lecture_id=%s", (str(lid),))
    cnt, all_explained = cur.fetchone()
    assert cnt == 3 and all_explained  # every slide titled + explained

    cur.execute(
        "SELECT count(*) FROM quiz_questions q JOIN slides s ON s.id=q.slide_id "
        "WHERE s.lecture_id=%s AND (q.metadata->>'is_deck')='true'", (str(lid),))
    assert cur.fetchone()[0] == 1  # deck quiz anchored to a slide

    cur.execute("SELECT status, pipeline_version FROM parse_runs WHERE pdf_hash=%s", ("hash_full",))
    status, ver = cur.fetchone()
    assert status == "completed" and ver == "5"


async def test_unified_drops_unresolvable_deck_quiz(wired_pool, db_conn, make_user, monkeypatch):
    prof = make_user(role="professor")
    _patch_synthesis(monkeypatch, pages=["t0", "t1"], deck_quiz=[
        {"question": "bad", "options": ["a", "b", "c", "d"], "correctAnswer": "zzz", "slideId": 1},
    ])
    await _run("hash_bad", prof)
    cur = db_conn.cursor()
    cur.execute("SELECT id FROM lectures WHERE pdf_hash=%s", ("hash_bad",))
    lid = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM quiz_questions q JOIN slides s ON s.id=q.slide_id WHERE s.lecture_id=%s", (str(lid),))
    assert cur.fetchone()[0] == 0  # unresolvable answer dropped, not defaulted


async def test_unified_rerun_replays_no_duplicate(wired_pool, db_conn, make_user, monkeypatch):
    prof = make_user(role="professor")
    _patch_synthesis(monkeypatch, pages=["t0", "t1", "t2"], deck_quiz=[])
    await _run("hash_dup", prof)   # first parse
    await _run("hash_dup", prof)   # re-run → COMPLETED → replay
    cur = db_conn.cursor()
    cur.execute("SELECT count(*) FROM lectures WHERE pdf_hash=%s", ("hash_dup",))
    assert cur.fetchone()[0] == 1
    cur.execute("SELECT count(*) FROM slides s JOIN lectures l ON l.id=s.lecture_id WHERE l.pdf_hash=%s", ("hash_dup",))
    assert cur.fetchone()[0] == 3
