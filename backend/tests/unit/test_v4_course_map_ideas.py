"""course_map: a concept with no pages has no place on the map — it must not
take the whole Space down (seen live 2026-10-11 once the concept graph was
backfilled: min() of an empty slide_indices list → 500)."""
from __future__ import annotations

from uuid import uuid4

import pytest

from backend.services import v4_reader_service as svc


class _Conn:
    def __init__(self, rows):
        self.rows = rows

    async def fetch(self, *_a):
        return self.rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return None


@pytest.fixture
def lecture_id():
    return str(uuid4())


async def test_ideas_without_pages_are_left_off_and_the_rest_are_in_page_order(monkeypatch, lecture_id):
    async def fake_course(_cid):
        return {"id": "c", "title": "DBS", "lectures": [{"id": lecture_id, "title": "SQL", "order": 1}]}

    async def fake_conn():
        return _Conn([{"id": lecture_id, "poster_url": None, "content_revision": 1}])

    async def fake_graph(_lid):
        return [
            {"name": "Joins", "slide_indices": [7, 9]},
            {"name": "Whole-deck theme", "slide_indices": []},
            {"name": "SELECT", "slide_indices": [2]},
        ]

    async def none(*_a, **_k):
        return None

    monkeypatch.setattr(svc, "get_course", fake_course)
    monkeypatch.setattr(svc, "get_db_connection", fake_conn)
    monkeypatch.setattr(svc, "graph_concepts", fake_graph)
    monkeypatch.setattr(svc, "get_cache", none)
    monkeypatch.setattr(svc, "signed_pdf_url", none)

    result = await svc.course_map(uuid4())
    assert result["lectures"][0]["ideas"] == [
        {"name": "SELECT", "first_page": 3},
        {"name": "Joins", "first_page": 8},
    ]
