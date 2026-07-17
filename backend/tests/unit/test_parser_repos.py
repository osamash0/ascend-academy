"""Unit tests for backend.services.parser.repos.

These are asyncpg wrappers around parse_runs / parse_pages. We mock the pool at
``backend.core.database.db_pool`` with a fake connection so no Postgres is
needed, and assert the Python-side logic: ParseRun row mapping (incl. outline
JSON handling and missing optional columns), the batch-summary rollup with its
title/summary fallbacks, the set_status finished_at branch, and the
deserialize-tolerant page getters.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from uuid import uuid4

import pytest

import backend.core.database as _db
from backend.services.parser import repos
from backend.domain.parse_models import (
    DeckOutline,
    PageStatus,
    RunStatus,
    SlideContent,
    ExtractedPage,
)


class _FakeConn:
    def __init__(self):
        self.fetchrow_result = None
        self.fetch_queue: list = []
        self.executed: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def fetchrow(self, query, *args):
        self.executed.append(("fetchrow", query, args))
        return self.fetchrow_result

    async def fetch(self, query, *args):
        self.executed.append(("fetch", query, args))
        return self.fetch_queue.pop(0) if self.fetch_queue else []

    async def execute(self, query, *args):
        self.executed.append(("execute", query, args))
        return "OK"

    async def executemany(self, query, seq):
        self.executed.append(("executemany", query, list(seq)))
        return "OK"


class _FakePool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        return self._conn


@pytest.fixture
def conn(monkeypatch):
    c = _FakeConn()
    monkeypatch.setattr(_db, "db_pool", _FakePool(c), raising=False)
    return c


def _now():
    return datetime.now(timezone.utc)


def _run_row(**overrides) -> dict:
    row = {
        "run_id": uuid4(),
        "pdf_hash": "hash123",
        "lecture_id": uuid4(),
        "pipeline_version": "5",
        "status": "queued",
        "page_count": 10,
        "started_at": _now(),
        "finished_at": None,
        "outline": None,
        "error": None,
        "batch_id": uuid4(),
        "user_id": uuid4(),
        "course_id": uuid4(),
        "filename": "deck.pdf",
        "parsing_mode": "ai",
    }
    row.update(overrides)
    return row


# ── _pool ────────────────────────────────────────────────────────────────────

async def test_pool_initializes_when_none(monkeypatch):
    monkeypatch.setattr(_db, "db_pool", None, raising=False)
    initialized = {"called": False}

    async def _init():
        initialized["called"] = True
        _db.db_pool = _FakePool(_FakeConn())

    monkeypatch.setattr(_db, "init_db_pool", _init)
    pool = await repos._pool()
    assert initialized["called"] is True
    assert pool is not None


async def test_pool_raises_when_still_none(monkeypatch):
    monkeypatch.setattr(_db, "db_pool", None, raising=False)

    async def _init():
        pass  # never sets the pool

    monkeypatch.setattr(_db, "init_db_pool", _init)
    with pytest.raises(RuntimeError, match="pool not available"):
        await repos._pool()


# ── _run_from_row ────────────────────────────────────────────────────────────

def test_run_from_row_maps_all_fields():
    row = _run_row(status="analyzing", filename="lec.pdf")
    run = repos._run_from_row(row)
    assert run.pdf_hash == "hash123"
    assert run.status == RunStatus.ANALYZING
    assert run.filename == "lec.pdf"
    assert run.page_count == 10


def test_run_from_row_parses_outline_from_dict():
    outline = {"course_topic": "Graphs", "sections": [], "glossary": {}}
    run = repos._run_from_row(_run_row(outline=outline))
    assert isinstance(run.outline, DeckOutline)
    assert run.outline.course_topic == "Graphs"


def test_run_from_row_parses_outline_from_json_string():
    run = repos._run_from_row(_run_row(outline='{"course_topic": "T", "sections": [], "glossary": {}}'))
    assert run.outline.course_topic == "T"


def test_run_from_row_tolerates_bad_outline():
    run = repos._run_from_row(_run_row(outline="{not valid json"))
    assert run.outline is None


def test_run_from_row_handles_missing_optional_columns():
    # A v3-shaped row without the Phase-1 batch columns must not KeyError.
    row = {
        "run_id": uuid4(), "pdf_hash": "h", "lecture_id": None,
        "pipeline_version": "3", "status": "completed", "page_count": None,
        "started_at": _now(), "finished_at": None, "outline": None, "error": None,
    }
    run = repos._run_from_row(row)
    assert run.batch_id is None
    assert run.user_id is None
    assert run.filename is None


# ── get_or_create_run / get_run_by_id / list_runs_by_user ────────────────────

async def test_get_or_create_run_maps_row(conn):
    conn.fetchrow_result = _run_row()
    run = await repos.get_or_create_run("hash123", None, user_id=uuid4())
    assert run.pdf_hash == "hash123"
    # The insert used the QUEUED status default.
    _, _q, args = conn.executed[-1]
    assert RunStatus.QUEUED.value in args


async def test_get_run_by_id_returns_none_when_absent(conn):
    conn.fetchrow_result = None
    assert await repos.get_run_by_id(uuid4()) is None


async def test_get_run_by_id_maps_row(conn):
    conn.fetchrow_result = _run_row()
    run = await repos.get_run_by_id(uuid4())
    assert run is not None
    assert run.pdf_hash == "hash123"


async def test_list_runs_by_user_batch_branch(conn):
    conn.fetch_queue = [[_run_row(), _run_row()]]
    uid, bid = uuid4(), uuid4()
    runs = await repos.list_runs_by_user(uid, batch_id=bid)
    assert len(runs) == 2
    # The batch branch filters on both user_id and batch_id.
    _, q, args = conn.executed[-1]
    assert "batch_id" in q
    assert bid in args


async def test_list_runs_by_user_recent_branch(conn):
    conn.fetch_queue = [[_run_row()]]
    runs = await repos.list_runs_by_user(uuid4(), limit=50)
    assert len(runs) == 1
    _, q, _args = conn.executed[-1]
    assert "24 hours" in q  # the recent/non-terminal branch


# ── get_batch_summary ────────────────────────────────────────────────────────

async def test_get_batch_summary_rolls_up_counts_and_titles(conn):
    lid = uuid4()
    run_rows = [
        {"run_id": uuid4(), "pdf_hash": "h1", "lecture_id": lid, "status": "completed",
         "error": None, "filename": "graphs.pdf", "finished_at": _now()},
        {"run_id": uuid4(), "pdf_hash": "h2", "lecture_id": None, "status": "failed",
         "error": "boom", "filename": "broken.pdf", "finished_at": _now()},
    ]
    agg_rows = [
        {"lecture_id": lid, "slide_count": 12, "flagged_count": 2, "quiz_count": 8},
    ]
    lecture_rows = [{"id": lid, "title": "Graph Theory", "description": "About graphs"}]
    conn.fetch_queue = [run_rows, agg_rows, lecture_rows]

    out = await repos.get_batch_summary(uuid4(), uuid4())
    assert len(out) == 2

    done = out[0]
    assert done["title"] == "Graph Theory"
    assert done["slide_count"] == 12
    assert done["quiz_count"] == 8
    assert done["flagged_count"] == 2
    assert done["deck_summary"] == "About graphs"

    failed = out[1]
    # No lecture yet → title falls back to the filename, zero counts.
    assert failed["title"] == "broken.pdf"
    assert failed["slide_count"] == 0
    assert failed["deck_summary"] is None
    assert failed["error"] == "boom"


async def test_get_batch_summary_skips_aggregation_when_no_lectures(conn):
    run_rows = [
        {"run_id": uuid4(), "pdf_hash": "h", "lecture_id": None, "status": "queued",
         "error": None, "filename": "pending.pdf", "finished_at": None},
    ]
    conn.fetch_queue = [run_rows]  # only the run query runs; no agg/lecture fetches
    out = await repos.get_batch_summary(uuid4(), uuid4())
    assert out[0]["title"] == "pending.pdf"
    assert out[0]["slide_count"] == 0
    # Exactly one fetch happened (the run rows); aggregation was skipped.
    assert sum(1 for e in conn.executed if e[0] == "fetch") == 1


# ── set_status / set_* / ensure_page_rows ────────────────────────────────────

async def test_set_status_completed_sets_finished_at(conn):
    await repos.set_status(uuid4(), RunStatus.COMPLETED)
    _, q, args = conn.executed[-1]
    assert "finished_at" in q
    assert RunStatus.COMPLETED.value in args


async def test_set_status_non_terminal_omits_finished_at(conn):
    await repos.set_status(uuid4(), RunStatus.ANALYZING)
    _, q, _args = conn.executed[-1]
    assert "finished_at" not in q


async def test_set_page_count(conn):
    rid = uuid4()
    await repos.set_page_count(rid, 42)
    _, _q, args = conn.executed[-1]
    assert 42 in args and rid in args


async def test_set_outline_serializes_model(conn):
    outline = DeckOutline(course_topic="T", sections=[], glossary={})
    await repos.set_outline(uuid4(), outline)
    _, q, args = conn.executed[-1]
    assert "::jsonb" in q
    assert any('"course_topic"' in a for a in args if isinstance(a, str))


async def test_set_error_marks_failed(conn):
    await repos.set_error(uuid4(), "kaboom")
    _, _q, args = conn.executed[-1]
    assert RunStatus.FAILED.value in args
    assert "kaboom" in args


async def test_ensure_page_rows_builds_one_tuple_per_page(conn):
    rid = uuid4()
    await repos.ensure_page_rows(rid, 3)
    kind, _q, seq = conn.executed[-1]
    assert kind == "executemany"
    assert len(seq) == 3
    assert seq[0] == (rid, 0, PageStatus.PENDING.value)
    assert seq[2][1] == 2


async def test_list_pending_pages_returns_indices(conn):
    conn.fetch_queue = [[{"page_index": 0}, {"page_index": 2}]]
    assert await repos.list_pending_pages(uuid4()) == [0, 2]


async def test_list_unanalyzed_pages_returns_indices(conn):
    conn.fetch_queue = [[{"page_index": 1}]]
    assert await repos.list_unanalyzed_pages(uuid4()) == [1]


# ── page getters with deserialize tolerance ──────────────────────────────────

def _slide_content(page_index: int = 0) -> SlideContent:
    return SlideContent(
        page_index=page_index, title="T", markdown="m", summary="s",
        questions=[], is_metadata=False, route="text",
        meta={"word_count": 1, "vision_used": False, "tokens_input": 0,
              "tokens_output": 0, "model": "x", "latency_ms": 1},
    )


def _extracted_page(page_index: int = 0) -> ExtractedPage:
    return ExtractedPage(
        page_index=page_index, text="t", word_count=1, has_vector_drawings=False,
        image_count=0, table_count=0, route="text",
    )


async def test_get_completed_pages_skips_undeserializable(conn):
    good = _slide_content(0)
    conn.fetch_queue = [[
        {"content": good.model_dump_json()},
        {"content": "{not valid json"},   # skipped, logged
    ]]
    out = await repos.get_completed_pages(uuid4())
    assert len(out) == 1
    assert out[0].page_index == 0


async def test_get_extracted_pages_skips_undeserializable(conn):
    good = _extracted_page(1)
    conn.fetch_queue = [[
        {"extract": good.model_dump_json()},
        {"extract": "garbage"},
    ]]
    out = await repos.get_extracted_pages(uuid4())
    assert len(out) == 1
    assert out[0].page_index == 1


async def test_replay_slides_yields_completed(conn):
    conn.fetch_queue = [[{"content": _slide_content(0).model_dump_json()}]]
    seen = [s async for s in repos.replay_slides(uuid4())]
    assert len(seen) == 1


async def test_commit_extract_and_content_update_pages(conn):
    await repos.commit_extract(uuid4(), _extracted_page(0))
    _, q1, _a1 = conn.executed[-1]
    assert "parse_pages" in q1 and PageStatus.EXTRACTED.value in _a1

    await repos.commit_content(uuid4(), _slide_content(0))
    _, q2, _a2 = conn.executed[-1]
    assert PageStatus.ANALYZED.value in _a2
