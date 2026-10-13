"""Unit tests for repos.save_parse_receipt (Arc 5). The asyncpg pool is faked
(same approach as test_parser_repos.py) so no Postgres is needed; the real
schema round-trip is covered by db/test_unified_pipeline_e2e.py."""
from __future__ import annotations

import json
from uuid import uuid4

import pytest

import backend.core.database as _db
from backend.services.parser import repos


class _FakeConn:
    def __init__(self):
        self.executed: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def execute(self, query, *args):
        self.executed.append((query, args))
        return "INSERT 0 1"


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


async def test_save_parse_receipt_upserts_by_run_id_with_jsonb_payloads(conn):
    run_id, lecture_id = uuid4(), uuid4()
    skeleton = {"boilerplate": ["footer seite #"],
                "slides": [{"index": 0, "role": "title", "section": 0, "chars": 9}],
                "sections": [{"index": 0, "title": "Graphs", "start": 0, "end": 0}]}
    provenance = [{"index": 0, "route": "batch", "prompt": "BATCH_SLIDE_PROMPT"}]
    grounding = {"proposed": 3, "kept": 2, "repaired": 1, "dropped": 1, "drop_reasons": {"no_source": 1}}

    await repos.save_parse_receipt(
        run_id, lecture_id,
        deck_skeleton=skeleton, slide_provenance=provenance, quiz_grounding=grounding,
    )

    ((query, args),) = conn.executed
    assert "INSERT INTO parse_receipts" in query
    assert "ON CONFLICT (run_id) DO UPDATE" in query
    assert args[0] == run_id and args[1] == lecture_id
    assert json.loads(args[2]) == skeleton
    assert json.loads(args[3]) == provenance
    assert json.loads(args[4]) == grounding


async def test_save_parse_receipt_stores_sql_null_for_missing_parts(conn):
    await repos.save_parse_receipt(
        uuid4(), uuid4(), deck_skeleton=None, slide_provenance=[], quiz_grounding=None,
    )
    ((_query, args),) = conn.executed
    assert args[2] is None and args[4] is None
    assert json.loads(args[3]) == []


async def test_save_parse_receipt_writes_llm_usage_as_jsonb(conn):
    usage = {"calls": 2, "cost_usd": 0.0009, "by_prompt": {}, "by_provider": {}}
    await repos.save_parse_receipt(
        uuid4(), uuid4(), deck_skeleton=None, slide_provenance=[], quiz_grounding=None,
        llm_usage=usage,
    )
    ((query, args),) = conn.executed
    assert "llm_usage = EXCLUDED.llm_usage" in query
    assert json.loads(args[5]) == usage


async def test_save_parse_receipt_stores_sql_null_without_llm_usage(conn):
    await repos.save_parse_receipt(
        uuid4(), uuid4(), deck_skeleton=None, slide_provenance=[], quiz_grounding=None,
    )
    ((_query, args),) = conn.executed
    assert args[5] is None
