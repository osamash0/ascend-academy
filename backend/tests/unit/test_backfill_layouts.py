"""Unit tests for `backend.scripts.backfill_layouts`.

No database and no storage: the lecture query, the download, `compute_layouts`
and `upsert_layouts` are stubbed. Selection (missing / stale / current / --force),
one download and one build per pdf_hash, --local-dir and --dry-run (downloads
nothing, builds nothing).
"""
from __future__ import annotations

import hashlib

import pytest

from backend.scripts import backfill_layouts as bf
from backend.services.parser.layout.build import LAYOUT_VERSION

H1, H2 = "a" * 64, "b" * 64


def _row(i: str, *, h: str = H1, rows: int = 0, min_version=None) -> dict:
    return {"id": i, "title": f"Lecture {i}", "pdf_hash": h, "pdf_url": None,
            "layout_rows": rows, "min_version": min_version}


MISSING = _row("missing", rows=0)
STALE = _row("stale", rows=3, min_version=LAYOUT_VERSION - 1)
CURRENT = _row("current", rows=3, min_version=LAYOUT_VERSION)


class Env:
    def __init__(self, monkeypatch, lectures):
        self.lectures = lectures
        self.queried: list = []
        self.downloads: list = []
        self.built: list = []
        self.computed: list = []

        async def fake_fetch(*, lecture_id=None):
            self.queried.append(lecture_id)
            return [r for r in self.lectures if lecture_id in (None, r["id"])]

        def fake_download(pdf_hash, pdf_url):
            self.downloads.append(pdf_hash)
            return b"%PDF-" + (pdf_hash or "x").encode()

        async def fake_compute(pdf_bytes):
            self.computed.append(pdf_bytes)
            return [{"page": 1, "src": pdf_bytes}]

        async def fake_upsert(lecture_id, pages):
            self.built.append((str(lecture_id), pages[0]["src"]))

        monkeypatch.setattr(bf, "_fetch_lectures", fake_fetch)
        monkeypatch.setattr(bf, "_download_pdf", fake_download)
        monkeypatch.setattr(bf, "compute_layouts", fake_compute)
        monkeypatch.setattr(bf, "upsert_layouts", fake_upsert)

    def built_ids(self):
        return sorted(i for i, _ in self.built)


async def _run(**kw):
    args = dict(dry_run=False, force=False, lecture_id=None, limit=None, local_dir=None)
    args.update(kw)
    return await bf.run(**args)


def test_needs_layout_selection():
    assert bf.needs_layout(MISSING, force=False)
    assert bf.needs_layout(STALE, force=False)
    assert not bf.needs_layout(CURRENT, force=False)
    assert bf.needs_layout(CURRENT, force=True)


@pytest.mark.asyncio
async def test_missing_and_stale_picked_current_skipped(monkeypatch):
    env = Env(monkeypatch, [MISSING, STALE, CURRENT])
    assert await _run() == 0
    assert env.built_ids() == ["missing", "stale"]


@pytest.mark.asyncio
async def test_force_picks_current_too(monkeypatch):
    env = Env(monkeypatch, [MISSING, STALE, CURRENT])
    await _run(force=True)
    assert env.built_ids() == ["current", "missing", "stale"]


@pytest.mark.asyncio
async def test_lecture_id_and_limit(monkeypatch):
    env = Env(monkeypatch, [_row("a"), _row("b"), _row("c")])
    await _run(lecture_id="b")
    assert env.built_ids() == ["b"]
    env2 = Env(monkeypatch, [_row("a"), _row("b"), _row("c")])
    await _run(limit=2)
    assert env2.built_ids() == ["a", "b"]


@pytest.mark.asyncio
async def test_limit_counts_selected_lectures_not_skipped_ones(monkeypatch):
    env = Env(monkeypatch, [CURRENT, _row("x"), _row("y")])
    await _run(limit=1)
    assert env.built_ids() == ["x"]


@pytest.mark.asyncio
async def test_one_download_per_hash(monkeypatch):
    env = Env(monkeypatch, [_row("a", h=H1), _row("b", h=H1), _row("c", h=H2)])
    await _run()
    assert sorted(env.downloads) == [H1, H2]
    assert env.built_ids() == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_dry_run_downloads_and_builds_nothing(monkeypatch):
    env = Env(monkeypatch, [MISSING, STALE, CURRENT])
    assert await _run(dry_run=True) == 0
    assert env.downloads == [] and env.built == []


@pytest.mark.asyncio
async def test_local_dir_matches_by_sha256_without_download(monkeypatch, tmp_path):
    data = b"%PDF-local"
    (tmp_path / "x.pdf").write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    env = Env(monkeypatch, [_row("a", h=digest), _row("b", h=H2)])
    await _run(local_dir=str(tmp_path))
    assert env.downloads == [H2]
    assert dict(env.built)["a"] == data


@pytest.mark.asyncio
async def test_missing_pdf_counts_as_failed_and_goes_on(monkeypatch):
    env = Env(monkeypatch, [_row("a", h=H1), _row("b", h=H2)])
    monkeypatch.setattr(bf, "_download_pdf", lambda h, u: None if h == H1 else b"%PDF-ok")
    assert await _run() == 1
    assert env.built_ids() == ["b"]


@pytest.mark.asyncio
async def test_build_failure_goes_on_and_exits_nonzero(monkeypatch):
    env = Env(monkeypatch, [_row("a"), _row("b")])

    async def boom(lecture_id, pages):
        if str(lecture_id) == "a":
            raise RuntimeError("db down")
        env.built.append((str(lecture_id), pages[0]["src"]))

    monkeypatch.setattr(bf, "upsert_layouts", boom)
    assert await _run() == 1
    assert env.built_ids() == ["b"]


@pytest.mark.asyncio
async def test_lectures_sharing_one_pdf_are_built_once_and_written_each(monkeypatch):
    env = Env(monkeypatch, [_row("a", h=H1), _row("b", h=H1), _row("c", h=H2)])
    assert await _run() == 0
    assert len(env.computed) == 2
    assert env.built_ids() == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_a_pdf_that_cannot_be_built_fails_every_lecture_sharing_it(monkeypatch):
    env = Env(monkeypatch, [_row("a", h=H1), _row("b", h=H1), _row("c", h=H2)])

    async def compute(pdf_bytes):
        if pdf_bytes.endswith(H1.encode()):
            raise RuntimeError("bad pdf")
        return [{"page": 1, "src": pdf_bytes}]

    monkeypatch.setattr(bf, "compute_layouts", compute)
    assert await _run() == 1
    assert env.built_ids() == ["c"]
