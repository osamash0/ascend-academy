"""build_layouts: one Layout row per page, a failing page stored as original, one transaction, no database."""
import asyncio
import subprocess
import sys
from pathlib import Path

import fitz
import pytest

from backend.services.parser.layout import store
from backend.services.parser.layout.build import LAYOUT_VERSION, build_page_layout

ROOT = Path(__file__).resolve().parents[3]
PDF = ROOT / "public/v4-mock/normalization.pdf"
LECTURE = "11111111-1111-1111-1111-111111111111"


@pytest.fixture(scope="module")
def pdf_bytes():
    return PDF.read_bytes()


@pytest.fixture(scope="module")
def page_count(pdf_bytes):
    with fitz.open(stream=pdf_bytes, filetype="pdf") as d:
        return d.page_count


def run_build(monkeypatch, pdf_bytes):
    written = []

    async def fake_upsert(lecture_id, pages):
        written.append((str(lecture_id), pages))

    monkeypatch.setattr(store, "upsert_layouts", fake_upsert)
    n = asyncio.run(store.build_layouts(LECTURE, pdf_bytes))
    return n, written


def test_one_row_per_page_in_page_order(monkeypatch, pdf_bytes, page_count):
    n, written = run_build(monkeypatch, pdf_bytes)
    assert n == page_count
    assert len(written) == 1
    lecture_id, pages = written[0]
    assert lecture_id == LECTURE
    assert [p["page"] for p in pages] == list(range(1, page_count + 1))
    assert all(p["version"] == LAYOUT_VERSION and p["verdict"] in ("layout", "original") for p in pages)


def test_a_page_that_raises_is_stored_as_original_and_the_others_still_get_written(monkeypatch, pdf_bytes, page_count):
    def flaky(page, n, repeated):
        if n == 3:
            raise RuntimeError("boom")
        return build_page_layout(page, n, repeated)

    monkeypatch.setattr(store, "build_page_layout", flaky)
    n, written = run_build(monkeypatch, pdf_bytes)
    pages = written[0][1]
    assert n == page_count == len(pages)
    assert pages[2] == {"page": 3, "verdict": "original", "reasons": ["layout failed"], "blocks": [], "paths": [],
                        "version": LAYOUT_VERSION}
    assert all(p["page"] == i + 1 for i, p in enumerate(pages))
    assert sum(1 for p in pages if p["reasons"] == ["layout failed"]) == 1
    assert any(p["blocks"] for i, p in enumerate(pages) if i != 2)


def test_compute_layouts_builds_the_pages_without_writing(monkeypatch, pdf_bytes, page_count):
    async def no_db(*a):
        raise AssertionError("compute_layouts must not write")

    monkeypatch.setattr(store, "upsert_layouts", no_db)
    pages = asyncio.run(store.compute_layouts(pdf_bytes))
    assert [p["page"] for p in pages] == list(range(1, page_count + 1))


def test_fitz_lock_is_taken_per_call_and_never_nested(monkeypatch, pdf_bytes):
    holds = []

    class Probe:
        def __init__(self):
            self.inner = store.FITZ_LOCK
            self.depth = 0

        def __enter__(self):
            self.inner.acquire()
            holds.append("in")
            return self

        def __exit__(self, *a):
            holds.append("out")
            self.inner.release()

    monkeypatch.setattr(store, "FITZ_LOCK", Probe())
    run_build(monkeypatch, pdf_bytes)
    # strictly alternating in/out: never two "in" in a row
    assert holds[::2] == ["in"] * (len(holds) // 2) and holds[1::2] == ["out"] * (len(holds) // 2)


class FakeConn:
    def __init__(self, log, rows=None):
        self.log, self.rows = log, rows or []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def transaction(self):
        log = self.log

        class Tx:
            async def __aenter__(s):
                log.append(("begin",))

            async def __aexit__(s, *a):
                log.append(("commit",) if a[0] is None else ("rollback",))
                return False

        return Tx()

    async def execute(self, sql, *args):
        self.log.append(("execute", " ".join(sql.split()), args))

    async def executemany(self, sql, rows):
        self.log.append(("executemany", " ".join(sql.split()), list(rows)))

    async def fetch(self, sql, *args):
        self.log.append(("fetch", " ".join(sql.split()), args))
        return self.rows


def patch_db(monkeypatch, conn):
    import backend.core.database as database

    async def get_conn():
        return conn

    monkeypatch.setattr(database, "get_db_connection", get_conn)


def test_upsert_writes_all_rows_in_one_batch_then_deletes_the_rest_in_one_transaction(monkeypatch):
    log = []
    patch_db(monkeypatch, FakeConn(log))
    pages = [{"page": i, "verdict": "layout", "reasons": [], "blocks": [], "paths": [], "version": LAYOUT_VERSION}
             for i in (1, 2, 3)]
    asyncio.run(store.upsert_layouts(LECTURE, pages))
    assert [e[0] for e in log] == ["begin", "executemany", "execute", "commit"]
    _, insert, rows = log[1]
    assert "INSERT INTO public.lecture_layouts" in insert and "ON CONFLICT (lecture_id, page) DO UPDATE" in insert
    assert "::jsonb" in insert
    assert [r[1] for r in rows] == [1, 2, 3] and all(str(r[0]) == LECTURE and r[3] == LAYOUT_VERSION for r in rows)
    _, delete, args = log[2]
    assert delete.startswith("DELETE FROM public.lecture_layouts") and "page > $2" in delete
    assert args[1] == 3  # delete after the last page


def test_load_layouts_returns_the_pages_in_order(monkeypatch):
    log = []
    patch_db(monkeypatch, FakeConn(log, rows=[{"layout": '{"page": 1}'}, {"layout": {"page": 2}}]))
    assert asyncio.run(store.load_layouts(LECTURE)) == [{"page": 1}, {"page": 2}]
    assert "ORDER BY page" in log[0][1]


def test_load_layouts_reads_only_the_verdict_of_an_original_page(monkeypatch):
    log = []
    patch_db(monkeypatch, FakeConn(log))
    asyncio.run(store.load_layouts(LECTURE))
    sql = log[0][1]
    # blocks and paths of a held page never leave the database: they are never shown
    assert "layout->>'verdict' = 'layout'" in sql
    assert "jsonb_build_object('page', layout->'page', 'verdict', layout->'verdict', 'reasons', layout->'reasons', " \
           "'version', layout->'version')" in sql


def test_served_keeps_a_layout_page_whole_and_an_original_page_to_its_verdict():
    lp = {"page": 1, "verdict": "layout", "reasons": [], "blocks": [1], "paths": [2], "version": 1}
    held = dict(lp, verdict="original", reasons=["x"])
    assert store.served(lp) == lp
    assert store.served(held) == {"page": 1, "verdict": "original", "reasons": ["x"], "version": 1}


def test_the_migration_timestamp_is_unique_and_passes_the_checker():
    files = sorted((ROOT / "supabase/migrations").glob("20261106120000_*.sql"))
    assert [f.name for f in files] == ["20261106120000_lecture_layouts.sql"]
    done = subprocess.run([sys.executable, str(ROOT / "backend/scripts/check_migration_timestamps.py")],
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stdout + done.stderr


def test_the_flag_defaults_off():
    from backend.core.config import Settings
    assert Settings.model_fields["feature_layout_face"].default is False
