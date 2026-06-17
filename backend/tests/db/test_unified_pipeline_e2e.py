"""End-to-end validation of the unified pipeline's server-authoritative
persistence against a REAL Postgres (testcontainers + all migrations).

What this covers that the unit tests can't (they mock the DB):
  - persist.* writes lectures/slides/quiz_questions against the real schema
    (column types, NOT NULL, FK to auth.users, jsonb casts, cascade);
  - repos run lifecycle (get_or_create_run/set_status) works against the real
    asyncpg pool — this is the path that exposed the repos pool-staleness bug;
  - quiz answer indices resolve, and unresolvable ones are DROPPED not defaulted;
  - cross-slide deck questions anchor to a real slide_id;
  - re-running a completed parse replays from the DB (no duplicate lecture).

The v2 engine (parse_pdf_stream) and the LLM are stubbed with a scripted event
stream that mirrors the real flat-SSE shape — the engine's extraction/LLM is
validated separately (its own suite + the offline routing check). Storage and
embedding-attach (network) are stubbed. No LLM cost, no prod, fully local.

Gated behind `db` (needs Docker + testcontainers), like the other db tests.
"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db


def _areturn(val):
    async def _f(*_a, **_k):
        return val
    return _f


def _scripted_engine(pdf_hash: str, n: int = 3, with_bad_quiz: bool = False):
    """An async generator mirroring parse_pdf_stream's flat event stream."""
    async def _gen(*_a, **_k):
        yield {"type": "meta", "pdf_hash": pdf_hash}
        yield {"type": "phase", "phase": "extract"}
        yield {"type": "phase", "phase": "enhance"}
        for i in range(n):
            questions = [{
                "question": f"q{i}", "options": ["a", "b", "c", "d"], "correctAnswer": "b",
                "explanation": "because", "concept": "topic",
            }]
            if with_bad_quiz and i == 0:
                questions.append({
                    "question": "bad", "options": ["a", "b", "c", "d"], "correctAnswer": "zzz",
                })
            yield {"type": "slide", "index": i, "slide": {
                "title": f"S{i}", "content": f"content {i}", "summary": f"sum {i}",
                "slide_type": "text", "questions": questions,
            }}
        yield {"type": "phase", "phase": "finalize"}
        yield {"type": "deck_complete", "deck_summary": "DECK SUMMARY", "deck_quiz": [{
            "question": "dq", "options": ["a", "b", "c", "d"], "correctAnswer": "a",
            "linked_slides": [0, 1],
        }]}
        yield {"type": "complete", "total": n}
    return _gen


@pytest.fixture
async def wired_pool(pg_dsn, applied_migrations):
    """Point the app's global asyncpg pool at the throwaway container so
    persist/repos write to it; restore afterwards."""
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


def _patch_externals(monkeypatch, engine):
    """Stub everything that would hit the network/LLM/storage; keep the DB real."""
    import backend.services.parser.unified_orchestrator as uo
    import backend.services.file_parse_service as fps
    import backend.services.cache as cache

    monkeypatch.setattr(uo, "_fetch_pdf_bytes", _areturn(b"%PDF-fake"))
    monkeypatch.setattr(uo, "_store_lecture_pdf", _areturn(None))
    monkeypatch.setattr(cache, "attach_lecture_id_to_embeddings", _areturn(0))
    monkeypatch.setattr(fps, "parse_pdf_stream", engine)


async def _run(pdf_hash, professor, **kw):
    import backend.services.parser.unified_orchestrator as uo
    events = []

    async def emit(t, d):
        events.append((t, d))

    await uo.parse_pdf_unified(
        {}, pdf_hash=pdf_hash, user_id=str(professor), emit_fn=emit, **kw
    )
    return events


async def test_unified_persists_full_hierarchy(wired_pool, db_conn, make_user, monkeypatch):
    prof = make_user(role="professor")
    _patch_externals(monkeypatch, _scripted_engine("hash_full", n=3))

    events = await _run("hash_full", prof, filename="My Deck.pdf")

    # SSE contract: lecture_id surfaced on meta, ends with complete
    assert [t for t, _ in events][-1] == "complete"
    meta = next(d for t, d in events if t == "meta")
    assert "lecture_id" in meta

    cur = db_conn.cursor()
    cur.execute("SELECT id, title, total_slides, professor_id FROM lectures WHERE pdf_hash=%s", ("hash_full",))
    rows = cur.fetchall()
    assert len(rows) == 1
    lid, title, total, prof_id = rows[0]
    assert title == "My Deck"
    assert total == 3
    assert str(prof_id) == str(prof)

    cur.execute("SELECT count(*) FROM slides WHERE lecture_id=%s", (str(lid),))
    assert cur.fetchone()[0] == 3

    # 3 per-slide quizzes + 1 cross-slide deck quiz
    cur.execute(
        "SELECT count(*) FROM quiz_questions q JOIN slides s ON s.id=q.slide_id WHERE s.lecture_id=%s",
        (str(lid),),
    )
    assert cur.fetchone()[0] == 4

    # the deck question is anchored + carries linked_slides in metadata
    cur.execute(
        "SELECT correct_answer, metadata FROM quiz_questions q JOIN slides s ON s.id=q.slide_id "
        "WHERE s.lecture_id=%s AND (q.metadata->>'is_deck')='true'",
        (str(lid),),
    )
    deck_rows = cur.fetchall()
    assert len(deck_rows) == 1
    assert deck_rows[0][0] == 0                       # "a" -> index 0
    assert deck_rows[0][1]["linked_slides"] == [0, 1]

    # run lifecycle recorded correctly
    cur.execute("SELECT status, pipeline_version, lecture_id FROM parse_runs WHERE pdf_hash=%s", ("hash_full",))
    status, ver, run_lid = cur.fetchone()
    assert status == "completed"
    assert ver == "5"
    assert str(run_lid) == str(lid)


async def test_unified_drops_unresolvable_quiz(wired_pool, db_conn, make_user, monkeypatch):
    prof = make_user(role="professor")
    _patch_externals(monkeypatch, _scripted_engine("hash_bad", n=2, with_bad_quiz=True))

    await _run("hash_bad", prof, filename="Deck.pdf")

    cur = db_conn.cursor()
    cur.execute("SELECT id FROM lectures WHERE pdf_hash=%s", ("hash_bad",))
    lid = cur.fetchone()[0]
    # slide 0: 1 good + 1 unresolvable (dropped); slide 1: 1 good; + 1 deck = 3
    cur.execute(
        "SELECT count(*) FROM quiz_questions q JOIN slides s ON s.id=q.slide_id WHERE s.lecture_id=%s",
        (str(lid),),
    )
    assert cur.fetchone()[0] == 3


async def test_unified_rerun_replays_no_duplicate(wired_pool, db_conn, make_user, monkeypatch):
    prof = make_user(role="professor")
    _patch_externals(monkeypatch, _scripted_engine("hash_dup", n=3))

    await _run("hash_dup", prof, filename="Deck.pdf")   # first parse
    await _run("hash_dup", prof, filename="Deck.pdf")   # re-run → COMPLETED → replay

    cur = db_conn.cursor()
    cur.execute("SELECT count(*) FROM lectures WHERE pdf_hash=%s", ("hash_dup",))
    assert cur.fetchone()[0] == 1                       # no duplicate lecture
    cur.execute(
        "SELECT count(*) FROM slides s JOIN lectures l ON l.id=s.lecture_id WHERE l.pdf_hash=%s",
        ("hash_dup",),
    )
    assert cur.fetchone()[0] == 3                       # slides not duplicated
