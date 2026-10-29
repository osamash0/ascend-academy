"""The legacy analytics views never show a v4 reader's question word for word.

Spec §0: the v4 reader's questions reach owners only as themes over five or
more askers, never verbatim. Two legacy surfaces return question text straight
from learning_events, so each must skip rows the v4 reader wrote.
"""
from __future__ import annotations

import json

from backend.services import analytics_service
from backend.services.insights import evidence


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    """The slice of the PostgREST builder these functions use.

    Filters are accepted and ignored: the rows handed in already match the
    query, so the only thing under test is the Python-side skip.
    """

    def __init__(self, rows):
        self._rows = rows

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def contains(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def range(self, *_args, **_kwargs):
        return self

    def execute(self):
        return _Result(self._rows)


class _Client:
    def __init__(self, rows):
        self._rows = rows

    def table(self, _name):
        return _Query(self._rows)


LEGACY = {
    "query": "what is a tuple?",
    "slideTitle": "Tuples",
    "lectureId": "lec1",
    "slideId": "s1",
}
V4_READER = {
    "query": "why does this page loop back?",
    "lectureId": "lec1",
    "slideId": "s1",
    "page": 1,
    "kind": "ask",
    "sessionId": "sess-1",
    "timestamp": "2026-10-28T10:00:00Z",
    "source": "v4_reader",
}


def _rows():
    return [
        {"event_data": V4_READER, "created_at": "2026-10-28T10:00:00Z"},
        {"event_data": LEGACY, "created_at": "2026-10-27T10:00:00Z"},
    ]


def test_ai_query_feed_skips_v4_reader_questions(monkeypatch):
    monkeypatch.setattr(analytics_service, "get_auth_client", lambda token=None: _Client(_rows()))
    # `__wrapped__` is the uncached compute function under @cached_analytic, so
    # the test reads the rows rather than a cache entry from an earlier run.
    out = analytics_service.get_ai_query_feed.__wrapped__("lec1", "tok")
    assert [row["query_text"] for row in out] == ["what is a tuple?"]


def test_ai_queries_evidence_skips_v4_reader_questions(monkeypatch):
    monkeypatch.setattr(analytics_service, "get_auth_client", lambda token=None: _Client(_rows()))
    out = evidence.get_ai_queries_evidence("lec1", "s1", "tok")
    assert [row["query"] for row in out["queries"]] == ["what is a tuple?"]
    assert out["totalCount"] == 1


def test_dashboard_feed_and_ticker_skip_v4_reader_questions():
    # asyncpg returns jsonb as text, so the v4 row arrives as a JSON string and
    # exercises the parse branch in the helper.
    rows = [
        {"type": "ai_tutor_query", "event_data": json.dumps(V4_READER), "time": "2026-10-28T10:00:00Z"},
        {"type": "ai_tutor_query", "event_data": LEGACY, "time": "2026-10-27T10:00:00Z"},
    ]
    feed, ticker = analytics_service._feed_and_ticker(rows)
    assert [row["query_text"] for row in feed] == ["what is a tuple?"]
    assert [row["description"] for row in ticker] == ['Asked AI Tutor: "what is a tuple?..."']
