# Parser Bench, Plan 1 of 3: Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run any of the five fast extraction methods on a PDF from the command line and keep each result as a permanent run record. A run holds one Markdown file per page, the automatic checks per page, and its time, memory, versions and git commit.

**Architecture:** A new package `backend/eval/parser_bench/`, run under the backend `.venv`. It has four parts:
- **Runners.** Each method has a small standalone runner script that executes in that method's own interpreter (its own `uv` environment, the backend `.venv`, or Node) and writes `{version, settings, pages}` JSON.
- **Execution.** `execute.py` spawns a runner. It first does a warm-up on two pages, then a timed run sampled for peak memory with `psutil`. It then writes an `ExtractRun` folder through `store.py`.
- **Checks.** `checks.py` scores every page against the PDF's own text layer.
- **Isolation.** Nothing imports the app (`backend.core`, `backend.services`, …), and a test enforces it.

**Tech Stack:** Python 3.14 (backend `.venv`), PyMuPDF 1.27.1, psutil 7.2.2, pytest 9, `uv` for per-tool Python 3.12 environments, Node 22 with this repo's `pdfjs-dist` 5.4.296, and Java 22 (for OpenDataLoader).

**Spec:** `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md`

**Roadmap:** This plan builds the engine. **Plan 2** (judging) adds the duel schedule, Bradley–Terry ranking, the local server and the five-screen webpage, including New run (upload + method picker) over this engine. **Plan 3** (experiment) adds the heavy runners (`docling`, `marker`, `mineru`, `paddleocr`) and `ai_vision`, then `PROTOCOL.md`, the benchmark runs, judging, results, figures and the thesis export. Plans 2 and 3 are written when this one is done.

## Global Constraints

- **Python for everything in this plan:** `PY=~/Desktop/ascend-academy/.venv/bin/python`. Run commands from the worktree root `~/Desktop/ascend-academy/.claude/worktrees/file-upload-workflow-e9126d`.
- **Test command form:** `$PY -m pytest backend/tests/unit/<file> -q`
- **No app imports.** No module under `backend/eval/parser_bench/` may import `backend.core`, `backend.services`, `backend.api`, `backend.repositories` or `backend.workers`. Importing them loads the main checkout's `.env` with production credentials.
- **No slide text and no PDFs in git.** Data lives in `PARSER_BENCH_DIR`, by default `~/Documents/learnstation-parser-bench/`. Tool environments live in `PARSER_BENCH_ENVS`, by default `~/.cache/learnstation-parser-bench/envs/`.
- **A finished run is never changed.** Failed runs are kept with their reason.
- **`purpose` is `explore` or `benchmark`.** Benchmark runs require `docs/thesis/experiments/parser-benchmark/PROTOCOL.md` committed and unmodified.
- **Footer band rule.** A line is at the edge when its vertical centre lies in the top or bottom **15%** of the page. A boilerplate line appears on at least **50%** of pages, and at least 2.
- **Installing is refused** if it would leave less than **3 GB** free.
- **Production is never touched.** No network calls are made in this plan except `uv` downloading packages during `install`.
- **Commit messages end with:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## File Structure

```
backend/eval/parser_bench/
  __init__.py                 package docstring
  store.py                    run IDs, ExtractRun folder (create/write/finish/seal), list, find, export
  sources.py                  benchmark source decks, sha256, page count, warm-up sample, PNG render, seeded selection
  normalize.py                images → "[figure]"
  checks.py                   PDF page facts + the per-page automatic checks
  tools.py                    the method registry, readiness, commands, uv install, exact environment
  execute.py                  invoke a runner (time, memory, timeout) and run_tool → ExtractRun
  __main__.py                 CLI: tools | install | run | runs | export
  runners/
    current_runner.py         production's page.get_text("text"), standalone
    pymupdf4llm_runner.py
    markitdown_runner.py      one page at a time (pypdf splits)
    opendataloader_runner.py  its own page separator
    pdfjs_runner.mjs          getTextContent, newline on hasEOL
backend/tests/unit/
  parser_bench_fixtures.py    make_deck(): a 6-page synthetic deck with a footer
  test_parser_bench_store.py
  test_parser_bench_sources.py
  test_parser_bench_checks.py
  test_parser_bench_runners.py
  test_parser_bench_tools.py
  test_parser_bench_execute.py
  test_parser_bench_cli.py
  test_parser_bench_runners_live.py   skipped unless a method's environment exists
docs/thesis/experiments/parser-benchmark/
  LAB_LOG.md                  started in Task 8
```

---

### Task 1: Run records (`store.py`) and the isolation guard

**Files:**
- Create: `backend/eval/parser_bench/__init__.py`
- Create: `backend/eval/parser_bench/store.py`
- Test: `backend/tests/unit/test_parser_bench_store.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `store.REPO: Path`
  - `store.EXPORT_DIR: Path`
  - `store.PURPOSES = ("explore", "benchmark")`
  - `store.data_root() -> Path`
  - `store.new_run_id(tool: str, version: str, *, now: datetime | None = None, token: str | None = None) -> str`
  - `store.now_iso() -> str`
  - `store.git_state() -> dict`
  - `store.machine() -> dict`
  - `store.RunFinishedError`
  - `store.ExtractRun(path)`, with:
    - `.create(*, tool, version, source, purpose, settings=None, started_at=None, extra=None, root=None)`
    - `.run_id`, `.meta`
    - `.write_page(page: int, text: str)`, `.write_checks(rows)`, `.append_log(text)`
    - `.finish(status, *, reason=None, **fields)`
    - `.pages() -> dict[int, str]`, `.checks() -> list[dict[str, str]]`
  - `store.list_runs(root=None) -> list[dict]`
  - `store.find_run(run_id, root=None) -> Path`
  - `store.export_run(run_id, *, root=None, dest=EXPORT_DIR) -> Path`

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_parser_bench_store.py`:

```python
import re
from datetime import datetime, timezone
from pathlib import Path

import pytest

import backend.eval.parser_bench as bench_pkg
from backend.eval.parser_bench import store

SRC = {"path": "/x/deck.pdf", "name": "deck.pdf", "sha256": "ab" * 32, "pages_total": 3}


def make(tmp_path, **kw):
    args = dict(tool="current", version="1.27.1", source=SRC, purpose="explore", root=tmp_path)
    args.update(kw)
    return store.ExtractRun.create(**args)


def test_run_id_format():
    rid = store.new_run_id("Doc ling", "2.92.0", now=datetime(2026, 10, 30, tzinfo=timezone.utc), token="7f3a")
    assert rid == "2026-10-30_doc-ling-2.92.0_7f3a"


def test_create_writes_a_running_record(tmp_path):
    run = make(tmp_path)
    m = run.meta
    assert (m["status"], m["kind"], m["purpose"], m["tool"]) == ("running", "extract", "explore", "current")
    assert m["source"]["sha256"] == SRC["sha256"]
    assert set(m["git"]) == {"commit", "dirty"}
    assert m["machine"]["ram_gb"] > 0
    assert run.path.parent == tmp_path / "runs" / "extract"


def test_two_runs_never_share_a_folder(tmp_path):
    assert make(tmp_path).path != make(tmp_path).path


def test_rejects_an_unknown_purpose(tmp_path):
    with pytest.raises(ValueError):
        make(tmp_path, purpose="thesis")


def test_a_finished_run_refuses_every_write(tmp_path):
    run = make(tmp_path)
    run.write_page(2, "hello")
    run.finish("finished", seconds_per_page=0.1)
    assert run.meta["status"] == "finished" and run.meta["finished_at"]
    assert run.meta["seconds_per_page"] == 0.1
    assert run.pages() == {2: "hello"}
    for write in (
        lambda: run.write_page(3, "x"),
        lambda: run.write_checks([{"page": 1}]),
        lambda: run.append_log("x"),
        lambda: run.finish("failed"),
    ):
        with pytest.raises(store.RunFinishedError):
            write()


def test_a_failed_run_is_kept_with_its_reason(tmp_path):
    run = make(tmp_path)
    run.finish("failed", reason="exited with code 3")
    assert (run.meta["status"], run.meta["reason"]) == ("failed", "exited with code 3")
    assert [m["run_id"] for m in store.list_runs(tmp_path)] == [run.run_id]


def test_checks_round_trip(tmp_path):
    run = make(tmp_path)
    run.write_checks([{"page": 1, "footer_leaks": 0}, {"page": 2, "footer_leaks": 3}])
    assert run.checks() == [{"page": "1", "footer_leaks": "0"}, {"page": "2", "footer_leaks": "3"}]


def test_export_leaves_out_slide_text_and_the_log(tmp_path):
    run = make(tmp_path, purpose="benchmark")
    run.write_page(1, "slide text")
    run.append_log("tool output")
    run.write_checks([{"page": 1}])
    run.finish("finished")
    out = store.export_run(run.run_id, root=tmp_path, dest=tmp_path / "export")
    assert sorted(p.name for p in out.iterdir()) == ["checks.csv", "run.json"]


def test_export_refuses_explore_and_running_runs(tmp_path):
    explore = make(tmp_path)
    explore.finish("finished")
    with pytest.raises(ValueError, match="explore"):
        store.export_run(explore.run_id, root=tmp_path, dest=tmp_path / "e")
    running = make(tmp_path, purpose="benchmark")
    with pytest.raises(ValueError, match="running"):
        store.export_run(running.run_id, root=tmp_path, dest=tmp_path / "e")


def test_find_run_names_what_is_missing(tmp_path):
    with pytest.raises(FileNotFoundError, match="nope"):
        store.find_run("nope", tmp_path)


def test_the_bench_never_imports_the_app():
    """Importing backend.core loads the main checkout's .env (production credentials)."""
    root = Path(bench_pkg.__file__).parent
    pattern = re.compile(r"^\s*(?:from|import)\s+backend\.(?:core|services|api|repositories|workers)\b", re.M)
    offenders = [str(f) for f in root.rglob("*.py") if pattern.search(f.read_text(encoding="utf-8"))]
    assert offenders == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_store.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.eval.parser_bench'`

- [ ] **Step 3: Write the package and `store.py`**

`backend/eval/parser_bench/__init__.py`:

```python
"""Parser benchmark: which extraction gives learners clean text.

Spec: docs/superpowers/specs/2026-10-30-parser-benchmark-design.md

Runs PDF extraction methods on lecture decks, keeps every run as a permanent
record outside git (slide text must never reach the public repo), and scores
each page with automatic checks. It imports nothing from the app: importing
backend.core loads the main checkout's .env, which holds production credentials.

    python -m backend.eval.parser_bench tools
"""
```

`backend/eval/parser_bench/store.py`:

```python
"""Run records: every extraction is a permanent, uniquely named folder.

A run is written while its status is "running" and sealed by finish(). After
that every write raises RunFinishedError, so a result is never edited in place:
running again makes a new run. Failed runs are kept, with their reason.
"""
from __future__ import annotations

import csv
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

REPO = Path(__file__).resolve().parents[3]
EXPORT_DIR = REPO / "docs" / "thesis" / "experiments" / "parser-benchmark" / "data"
PURPOSES = ("explore", "benchmark")
NOT_EXPORTED = ("pages", "log.txt")


class RunFinishedError(RuntimeError):
    """A finished run is a permanent record; nothing may be written into it."""


def data_root() -> Path:
    return Path(os.environ.get("PARSER_BENCH_DIR") or Path.home() / "Documents" / "learnstation-parser-bench")


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9.]+", "-", s).strip("-").lower() or "x"


def new_run_id(tool: str, version: str, *, now: datetime | None = None, token: str | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    return f"{now:%Y-%m-%d}_{_slug(tool)}-{_slug(version)}_{token or secrets.token_hex(2)}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def git_state(repo: Path = REPO) -> dict[str, Any]:
    def git(*args: str) -> str:
        return subprocess.run(
            ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True
        ).stdout.strip()

    try:
        return {"commit": git("rev-parse", "HEAD"), "dirty": bool(git("status", "--porcelain"))}
    except (OSError, subprocess.CalledProcessError):
        return {"commit": None, "dirty": None}


def machine() -> dict[str, Any]:
    import psutil

    return {
        "platform": platform.platform(),
        "macos": platform.mac_ver()[0] or None,
        "arch": platform.machine(),
        "cpu_count": os.cpu_count(),
        "ram_gb": round(psutil.virtual_memory().total / 2**30, 1),
        "python": platform.python_version(),
    }


def _write_json(path: Path, data: Mapping[str, Any]) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


@dataclass(frozen=True)
class ExtractRun:
    path: Path

    @property
    def run_id(self) -> str:
        return self.path.name

    @property
    def meta(self) -> dict[str, Any]:
        return json.loads((self.path / "run.json").read_text(encoding="utf-8"))

    @classmethod
    def create(
        cls,
        *,
        tool: str,
        version: str,
        source: Mapping[str, Any],
        purpose: str,
        settings: Mapping[str, Any] | None = None,
        started_at: str | None = None,
        extra: Mapping[str, Any] | None = None,
        root: Path | None = None,
    ) -> "ExtractRun":
        if purpose not in PURPOSES:
            raise ValueError(f"purpose must be one of {PURPOSES}, not {purpose!r}")
        base = (root or data_root()) / "runs" / "extract"
        base.mkdir(parents=True, exist_ok=True)
        while True:
            path = base / new_run_id(tool, version)
            try:
                path.mkdir()
                break
            except FileExistsError:
                continue
        (path / "pages").mkdir()
        _write_json(path / "run.json", {
            "run_id": path.name,
            "kind": "extract",
            "tool": tool,
            "version": version,
            "settings": dict(settings or {}),
            "purpose": purpose,
            "source": dict(source),
            "git": git_state(),
            "machine": machine(),
            "started_at": started_at or now_iso(),
            "finished_at": None,
            "status": "running",
            "reason": None,
            **dict(extra or {}),
        })
        return cls(path)

    def _open(self) -> dict[str, Any]:
        meta = self.meta
        if meta["status"] != "running":
            raise RunFinishedError(f"{self.run_id} is {meta['status']}; start a new run instead")
        return meta

    def write_page(self, page: int, text: str) -> None:
        self._open()
        (self.path / "pages" / f"p{page:04d}.md").write_text(text, encoding="utf-8")

    def write_checks(self, rows: Sequence[Mapping[str, Any]]) -> None:
        self._open()
        if not rows:
            return
        with open(self.path / "checks.csv", "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)

    def append_log(self, text: str) -> None:
        self._open()
        with open(self.path / "log.txt", "a", encoding="utf-8") as f:
            f.write(text)

    def finish(self, status: str, *, reason: str | None = None, **fields: Any) -> None:
        if status not in ("finished", "failed"):
            raise ValueError("a run finishes as 'finished' or 'failed'")
        meta = self._open()
        meta.update(fields)
        meta.update(status=status, reason=reason, finished_at=now_iso())
        _write_json(self.path / "run.json", meta)

    def pages(self) -> dict[int, str]:
        return {
            int(p.stem[1:]): p.read_text(encoding="utf-8")
            for p in sorted((self.path / "pages").glob("p*.md"))
        }

    def checks(self) -> list[dict[str, str]]:
        f = self.path / "checks.csv"
        if not f.exists():
            return []
        with open(f, newline="", encoding="utf-8") as fh:
            return list(csv.DictReader(fh))


def _record(run_dir: Path) -> Path | None:
    for name in ("run.json", "compare.json"):
        if (run_dir / name).exists():
            return run_dir / name
    return None


def list_runs(root: Path | None = None) -> list[dict[str, Any]]:
    base = (root or data_root()) / "runs"
    metas = []
    for kind in ("extract", "compare"):
        folder = base / kind
        if not folder.is_dir():
            continue
        for run_dir in folder.iterdir():
            rec = _record(run_dir) if run_dir.is_dir() else None
            if rec:
                metas.append(json.loads(rec.read_text(encoding="utf-8")))
    return sorted(metas, key=lambda m: m.get("started_at") or "", reverse=True)


def find_run(run_id: str, root: Path | None = None) -> Path:
    base = (root or data_root()) / "runs"
    for kind in ("extract", "compare"):
        if (base / kind / run_id).is_dir():
            return base / kind / run_id
    raise FileNotFoundError(f"no run {run_id!r} under {base}")


def export_run(run_id: str, *, root: Path | None = None, dest: Path = EXPORT_DIR) -> Path:
    """Copy a benchmark run's number-only files into the repo for the thesis."""
    src = find_run(run_id, root)
    meta = json.loads(_record(src).read_text(encoding="utf-8"))
    if meta.get("status") == "running":
        raise ValueError(f"{run_id} is still running")
    if meta.get("purpose") == "explore":
        raise ValueError(f"{run_id} is an explore run; only benchmark runs count for the thesis")
    out = dest / run_id
    shutil.copytree(
        src,
        out,
        ignore=lambda d, names: [n for n in names if n in NOT_EXPORTED and Path(d) == src],
        dirs_exist_ok=True,
    )
    return out
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_store.py -q`
Expected: `11 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/__init__.py backend/eval/parser_bench/store.py backend/tests/unit/test_parser_bench_store.py
git commit -m "feat(parser-bench): permanent run records + guard against app imports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Sources, the synthetic deck, and figure normalisation

**Files:**
- Create: `backend/eval/parser_bench/sources.py`
- Create: `backend/eval/parser_bench/normalize.py`
- Create: `backend/tests/unit/parser_bench_fixtures.py`
- Test: `backend/tests/unit/test_parser_bench_sources.py`

**Interfaces:**
- Consumes: `backend.eval.decks.DECK_DIR` (side-effect-free; it reads `$DECK_LAB_DIR`, by default `~/Downloads`).
- Produces:
  - `sources.Source(id, label, files)`, with `.paths(deck_dir=DECK_DIR) -> tuple[Path, ...]`
  - `sources.BENCHMARK_SOURCES`
  - `sources.PageRef = tuple[str, int]`
  - `sources.sha256_file(path) -> str`
  - `sources.page_count(path) -> int`
  - `sources.two_page_sample(path, dest) -> Path`
  - `sources.render_png(path, page, zoom=1.4) -> bytes`
  - `sources.select_pages(candidates, chosen, n_random, seed) -> list[PageRef]`
  - `sources.candidates_of(source, deck_dir=DECK_DIR) -> list[PageRef]`
  - `normalize.FIGURE = "[figure]"`, `normalize.normalize_figures(text) -> str`
  - `parser_bench_fixtures.TITLES`, `parser_bench_fixtures.make_deck(path, n=6) -> Path`

- [ ] **Step 1: Write the fixture deck helper**

`backend/tests/unit/parser_bench_fixtures.py`:

```python
"""A small synthetic deck that looks like a lecture: a large title, body lines
(one of them a broken line), and a three-part footer at 88% of page height,
like the SWT decks. Not a test module (no test_ prefix)."""
from pathlib import Path

import fitz

W, H = 842, 595
TITLES = ("Introduction", "Version Control", "Merge Conflicts", "Branching Models", "Release Planning", "Summary")


def make_deck(path: Path, n: int = 6) -> Path:
    doc = fitz.open()
    for i in range(1, n + 1):
        title = TITLES[(i - 1) % len(TITLES)]
        page = doc.new_page(width=W, height=H)
        page.insert_text((60, 110), title, fontsize=28)
        page.insert_text((60, 170), f"First point about {title.lower()}", fontsize=16)
        page.insert_text((60, 195), "continues here in lower case", fontsize=16)
        page.insert_text((60, 250), "Second point.", fontsize=16)
        page.insert_text((40, 530), "Lecturer", fontsize=9)
        page.insert_text((380, 530), "Softwaretechnik", fontsize=9)
        page.insert_text((790, 530), str(i), fontsize=9)
    doc.save(path)
    doc.close()
    return path
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/unit/test_parser_bench_sources.py`:

```python
import hashlib

import fitz
import pytest

from backend.eval.parser_bench import normalize, sources
from backend.tests.unit.parser_bench_fixtures import make_deck


def test_sha256_matches_hashlib(tmp_path):
    f = tmp_path / "x.bin"
    f.write_bytes(b"lecture" * 1000)
    assert sources.sha256_file(f) == hashlib.sha256(b"lecture" * 1000).hexdigest()


def test_page_count_and_two_page_sample(tmp_path):
    deck = make_deck(tmp_path / "deck.pdf")
    assert sources.page_count(deck) == 6
    sample = sources.two_page_sample(deck, tmp_path / "warm.pdf")
    assert sources.page_count(sample) == 2
    one = make_deck(tmp_path / "one.pdf", n=1)
    assert sources.page_count(sources.two_page_sample(one, tmp_path / "warm1.pdf")) == 1


def test_render_png_is_a_png(tmp_path):
    png = sources.render_png(make_deck(tmp_path / "deck.pdf"), 3)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


CANDIDATES = [("a.pdf", n) for n in range(1, 21)]


def test_select_pages_is_reproducible_and_keeps_chosen_first():
    chosen = [("a.pdf", 15), ("a.pdf", 3)]
    first = sources.select_pages(CANDIDATES, chosen, 2, seed=20261030)
    assert first == sources.select_pages(CANDIDATES, chosen, 2, seed=20261030)
    assert first[:2] == chosen and len(set(first)) == 4
    assert not set(first[2:]) & set(chosen)


def test_select_pages_refuses_pages_from_elsewhere():
    with pytest.raises(ValueError, match="not in this source"):
        sources.select_pages(CANDIDATES, [("b.pdf", 1)], 2, seed=1)
    with pytest.raises(ValueError, match="only"):
        sources.select_pages(CANDIDATES[:3], [("a.pdf", 1)], 5, seed=1)


def test_benchmark_sources_exclude_the_demo_deck():
    ids = [s.id for s in sources.BENCHMARK_SOURCES]
    assert ids == ["swt", "dbs", "sr", "sheets"]
    files = [f for s in sources.BENCHMARK_SOURCES for f in s.files]
    assert "Course SWT/Slides/1.pdf" not in files


def test_candidates_cover_every_file_of_a_source(tmp_path):
    make_deck(tmp_path / "s1.pdf", n=2)
    make_deck(tmp_path / "s2.pdf", n=3)
    src = sources.Source("sheets", "two files", ("s1.pdf", "s2.pdf"))
    assert sources.candidates_of(src, tmp_path) == [("s1.pdf", 1), ("s1.pdf", 2), ("s2.pdf", 1), ("s2.pdf", 2), ("s2.pdf", 3)]


@pytest.mark.parametrize("raw", ["![logo](img/1.png)", '<img src="a.png" alt="x">', "<!-- image -->"])
def test_every_image_becomes_a_figure_marker(raw):
    assert normalize.normalize_figures(f"Title\n{raw}\nText") == "Title\n[figure]\nText"
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_sources.py -q`
Expected: FAIL with `ImportError: cannot import name 'normalize'`

- [ ] **Step 4: Write `sources.py` and `normalize.py`**

`backend/eval/parser_bench/normalize.py`:

```python
"""Images become one plain marker for every method (spec: judge content, not pictures)."""
import re

FIGURE = "[figure]"
_IMAGES = (
    re.compile(r"!\[[^\]]*\]\([^)]*\)"),
    re.compile(r"<img\b[^>]*>", re.I),
    re.compile(r"<!--\s*image\s*-->", re.I),
)


def normalize_figures(text: str) -> str:
    for pattern in _IMAGES:
        text = pattern.sub(FIGURE, text)
    return text
```

`backend/eval/parser_bench/sources.py`:

```python
"""The benchmark's source decks, the page-selection rule, and PDF helpers."""
from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from backend.eval.decks import DECK_DIR

PageRef = tuple[str, int]  # (file name relative to DECK_DIR, 1-based page)


@dataclass(frozen=True)
class Source:
    id: str
    label: str
    files: tuple[str, ...]  # relative to DECK_DIR; some names start with a space on purpose

    def paths(self, deck_dir: Path = DECK_DIR) -> tuple[Path, ...]:
        return tuple(deck_dir / f for f in self.files)


# Spec "Test set". Softwaretechnik 1 is excluded: Abi saw its outputs with
# tool names in the 2026-10-30 design demo, so it is no longer blind.
BENCHMARK_SOURCES = (
    Source("swt", "Softwaretechnik 2 — Versionsmanagement", ("Course SWT/Slides/2.pdf",)),
    Source("dbs", "DBS Normalization", ("03 DBS Normalization.pdf",)),
    Source("sr", "SR Prozesse", (" 03__SR_Prozesse_v07_27.04.2025.pdf",)),
    Source("sheets", "SWT exercise sheets 1–2", ("Course SWT/ueb01.pdf", "Course SWT/ueb02.pdf")),
)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def page_count(path: Path) -> int:
    import fitz

    with fitz.open(path) as doc:
        return len(doc)


def two_page_sample(path: Path, dest: Path) -> Path:
    """The warm-up input: the first two pages, so a model download is never timed."""
    import fitz

    with fitz.open(path) as doc, fitz.open() as out:
        out.insert_pdf(doc, from_page=0, to_page=min(1, len(doc) - 1))
        out.save(dest)
    return dest


def render_png(path: Path, page: int, zoom: float = 1.4) -> bytes:
    import fitz

    with fitz.open(path) as doc:
        return doc[page - 1].get_pixmap(matrix=fitz.Matrix(zoom, zoom)).tobytes("png")


def candidates_of(source: Source, deck_dir: Path = DECK_DIR) -> list[PageRef]:
    return [
        (name, n)
        for name, path in zip(source.files, source.paths(deck_dir))
        for n in range(1, page_count(path) + 1)
    ]


def select_pages(candidates: Sequence[PageRef], chosen: Sequence[PageRef], n_random: int, seed: int) -> list[PageRef]:
    """Spec selection rule: the deliberately chosen pages first, then n_random
    drawn from the rest with a recorded seed. Same inputs, same pages."""
    missing = [c for c in chosen if c not in candidates]
    if missing:
        raise ValueError(f"chosen pages not in this source: {missing}")
    taken = set(chosen)
    rest = sorted(c for c in candidates if c not in taken)
    if n_random > len(rest):
        raise ValueError(f"only {len(rest)} pages left to draw {n_random} from")
    return list(chosen) + sorted(random.Random(seed).sample(rest, n_random))
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_sources.py -q`
Expected: `10 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/eval/parser_bench/sources.py backend/eval/parser_bench/normalize.py backend/tests/unit/parser_bench_fixtures.py backend/tests/unit/test_parser_bench_sources.py
git commit -m "feat(parser-bench): benchmark sources, seeded page selection, figure markers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The automatic checks (`checks.py`)

**Files:**
- Create: `backend/eval/parser_bench/checks.py`
- Test: `backend/tests/unit/test_parser_bench_checks.py`

**Interfaces:**
- Consumes: `normalize.FIGURE`.
- Produces:
  - `checks.Line(text, size, y0, y1)`
  - `checks.PageFacts(number, height, lines, median_size, symbol_chars=set())`
  - `checks.DocFacts(pages, boilerplate, boilerplate_tokens)`
  - `checks.document_facts(pdf: Path) -> DocFacts`
  - `checks.title_of(pf: PageFacts) -> str | None`
  - `checks.is_footer_line(line: str, page: int, doc: DocFacts) -> bool`
  - `checks.check_page(text: str, pf: PageFacts, doc: DocFacts) -> dict`, whose keys are exactly `checks.CHECK_FIELDS`:
    - `page`, `footer_leaks`, `title_first`, `wrong_symbols`, `lonely_bullets`, `broken_line_pct`
    - `headings`, `list_items`, `max_depth`, `tables`, `math_spans`
    - `dropped_words_pct`, `invented_words_pct`, `chars`

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_parser_bench_checks.py`:

```python
import fitz
import pytest

from backend.eval.decks import DECK_DIR
from backend.eval.parser_bench import checks
from backend.tests.unit.parser_bench_fixtures import TITLES, make_deck


@pytest.fixture(scope="module")
def deck(tmp_path_factory):
    return make_deck(tmp_path_factory.mktemp("deck") / "deck.pdf")


@pytest.fixture(scope="module")
def facts(deck):
    return checks.document_facts(deck)


def check(text, facts, page=3):
    return checks.check_page(text, facts.pages[page], facts)


def test_the_footer_is_boilerplate(facts):
    assert facts.boilerplate == {"lecturer", "softwaretechnik", "#"}


def test_the_title_is_the_largest_line(facts):
    assert checks.title_of(facts.pages[3]) == TITLES[2]


def test_every_field_is_reported_in_order(facts):
    assert tuple(check("x", facts)) == checks.CHECK_FIELDS


def test_raw_extraction_leaks_the_footer_but_loses_no_words(deck, facts):
    with fitz.open(deck) as d:
        raw = d[2].get_text("text")
    r = check(raw, facts)
    assert (r["footer_leaks"], r["title_first"]) == (3, True)
    assert (r["dropped_words_pct"], r["invented_words_pct"]) == (0.0, 0.0)


def test_footer_before_the_title_fails_title_first(facts):
    r = check(f"Lecturer\nSoftwaretechnik\n3\n{TITLES[2]}\n", facts)
    assert (r["title_first"], r["footer_leaks"]) == (False, 3)


def test_a_merged_footer_line_counts_once(facts):
    assert check("## Lecturer Softwaretechnik 3", facts)["footer_leaks"] == 1


def test_a_year_is_not_a_page_number(facts):
    assert check("Sommerville\n2016\n", facts)["footer_leaks"] == 0


def test_clean_markdown_scores_clean(facts):
    md = (
        f"# {TITLES[2]}\n\n"
        "- First point about merge conflicts continues here in lower case\n"
        "- Second point.\n"
    )
    r = check(md, facts)
    assert (r["footer_leaks"], r["title_first"], r["headings"], r["list_items"], r["max_depth"]) == (0, True, 1, 2, 1)
    assert (r["broken_line_pct"], r["dropped_words_pct"], r["invented_words_pct"]) == (0.0, 0.0, 0.0)


def test_a_line_broken_mid_sentence(facts):
    assert check("Software\nengineering is fun.", facts)["broken_line_pct"] == 100.0


def test_mismapped_symbols_count_only_where_a_symbol_font_put_them():
    pf = checks.PageFacts(1, 595.0, [], 0.0, symbol_chars={"§"})
    doc = checks.DocFacts({1: pf}, frozenset(), frozenset())
    r = checks.check_page("§ Komplexität ®\n§\nnext ", pf, doc)
    assert r["wrong_symbols"] == 3  # two § and one private-use glyph; this ® is not from a symbol font
    assert r["lonely_bullets"] == 1
    assert r["title_first"] is None


def test_dropped_and_invented_words(facts):
    r = check(f"# {TITLES[2]}\nbanana banana", facts)
    assert r["dropped_words_pct"] > 50 and r["invented_words_pct"] == 50.0


def test_tables_and_math(facts):
    r = check("| a | b |\n|---|---|\n| 1 | 2 |\n\n$x^2$ and $$y$$", facts)
    assert (r["tables"], r["math_spans"]) == (1, 2)


def test_figure_markers_are_not_the_first_line(facts):
    assert check(f"[figure]\n# {TITLES[2]}", facts)["title_first"] is True


SWT1 = DECK_DIR / "Course SWT" / "Slides" / "1.pdf"


@pytest.mark.skipif(not SWT1.exists(), reason="real SWT deck not available")
def test_real_swt_deck():
    f = checks.document_facts(SWT1)
    assert {"lecturer", "softwaretechnik"} <= f.boilerplate
    assert "§" in f.pages[15].symbol_chars
    assert checks.title_of(f.pages[21]) == "Software-Pflege, -Wartung und -Evolution"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_checks.py -q`
Expected: FAIL with `ImportError: cannot import name 'checks'`

- [ ] **Step 3: Write `checks.py`**

`backend/eval/parser_bench/checks.py`:

```python
"""The automatic checks (spec "Automatic checks").

The reference is the page's own text layer, read with PyMuPDF. Known bias,
stated in the protocol: that makes `current` perfect by construction on
dropped and invented words.
"""
from __future__ import annotations

import difflib
import math
import re
import statistics
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from backend.eval.parser_bench.normalize import FIGURE

SYMBOL_FONTS = ("symbol", "wingdings", "zapf", "dingbat")
MISMAPPED = ("§", "®")
BULLETS = set("§•▪◦●■□–-*®")
EDGE = 0.15          # outer share of the page height, by line centre
BOILER_SHARE = 0.5   # share of pages a boilerplate line appears on
TITLE_RATIO = 1.2    # the title is at least this much larger than the median line
TITLE_MATCH = 0.8    # similarity for "title first"
CHECK_FIELDS = (
    "page", "footer_leaks", "title_first", "wrong_symbols", "lonely_bullets", "broken_line_pct",
    "headings", "list_items", "max_depth", "tables", "math_spans",
    "dropped_words_pct", "invented_words_pct", "chars",
)

_PUA = re.compile(r"[-�]")
_MD_PREFIX = re.compile(r"^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s")
_ITEM = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s+")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$")
_MATH = re.compile(r"\$\$.+?\$\$|(?<!\$)\$[^$\n]+\$(?!\$)|\\\(.+?\\\)", re.S)
_ENDS_SENTENCE = re.compile(r"[.:;!?]\s*$")


@dataclass(frozen=True)
class Line:
    text: str
    size: float
    y0: float
    y1: float


@dataclass
class PageFacts:
    number: int
    height: float
    lines: list[Line]
    median_size: float
    symbol_chars: set[str] = field(default_factory=set)


@dataclass
class DocFacts:
    pages: dict[int, PageFacts]
    boilerplate: frozenset[str]
    boilerplate_tokens: frozenset[str]


def norm_line(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).casefold()
    return re.sub(r"\s+", " ", re.sub(r"\d+", "#", s)).strip()


def tokens(text: str) -> list[str]:
    s = unicodedata.normalize("NFKC", text).casefold()
    s = re.sub(r"(\w)-\n(\w)", r"\1\2", s)
    return re.findall(r"[^\W_]{2,}", s)


def _at_edge(line: Line, height: float) -> bool:
    mid = (line.y0 + line.y1) / 2
    return mid < EDGE * height or mid > (1 - EDGE) * height


def document_facts(pdf: Path) -> DocFacts:
    import fitz

    pages: dict[int, PageFacts] = {}
    seen: Counter[str] = Counter()
    with fitz.open(pdf) as doc:
        for number, page in enumerate(doc, start=1):
            height = page.rect.height
            lines: list[Line] = []
            symbol_chars: set[str] = set()
            for block in page.get_text("dict")["blocks"]:
                for raw in block.get("lines", []):
                    spans = raw["spans"]
                    for span in spans:
                        if any(f in span["font"].lower() for f in SYMBOL_FONTS):
                            symbol_chars.update(ch for ch in span["text"] if not ch.isspace())
                    text = "".join(span["text"] for span in spans).strip()
                    if text:
                        lines.append(Line(text, max(s["size"] for s in spans), raw["bbox"][1], raw["bbox"][3]))
            median = statistics.median(l.size for l in lines) if lines else 0.0
            pages[number] = PageFacts(number, height, lines, median, symbol_chars)
            seen.update({norm_line(l.text) for l in lines if _at_edge(l, height)})
    need = max(2, math.ceil(BOILER_SHARE * len(pages)))
    boiler = frozenset(t for t, c in seen.items() if c >= need)
    boiler_tokens = frozenset(w for b in boiler for w in re.findall(r"[^\W\d_]+", b))
    return DocFacts(pages, boiler, boiler_tokens)


def title_of(pf: PageFacts) -> str | None:
    if not pf.lines:
        return None
    best = max(pf.lines, key=lambda l: (l.size, -l.y0))
    return best.text if best.size >= TITLE_RATIO * pf.median_size else None


def strip_md(line: str) -> str:
    s = line
    while (t := _MD_PREFIX.sub("", s, count=1)) != s:
        s = t
    return re.sub(r"[*_`]", "", s).strip().strip("|").strip()


def is_footer_line(line: str, page: int, doc: DocFacts) -> bool:
    s = strip_md(line)
    if not s:
        return False
    if s == str(page):
        return True
    if re.search(r"[^\W\d_]", s) and norm_line(s) in doc.boilerplate:
        return True
    folded = unicodedata.normalize("NFKC", s).casefold()
    words = re.findall(r"[^\W\d_]+", folded)
    numbers = re.findall(r"\d+", folded)
    leftover = re.sub(r"[^\W_]+|\s+", "", folded)
    return (
        bool(words)
        and set(words) <= doc.boilerplate_tokens
        and all(n == str(page) for n in numbers)
        and not leftover
    )


def _ref_text(pf: PageFacts, doc: DocFacts) -> str:
    def boiler(l: Line) -> bool:
        return _at_edge(l, pf.height) and (norm_line(l.text) in doc.boilerplate or l.text.strip() == str(pf.number))

    return "\n".join(l.text for l in pf.lines if not boiler(l))


def check_page(text: str, pf: PageFacts, doc: DocFacts) -> dict:
    lines = text.splitlines()
    content = [l for l in lines if l.strip() and l.strip() != FIGURE]
    footer = [is_footer_line(l, pf.number, doc) for l in content]

    title = title_of(pf)
    if title is None:
        title_first = None
    else:
        first, want = norm_line(strip_md(content[0])) if content else "", norm_line(title)
        title_first = first.startswith(want) or difflib.SequenceMatcher(None, first, want).ratio() >= TITLE_MATCH

    wrong = len(_PUA.findall(text)) + sum(text.count(ch) for ch in MISMAPPED if ch in pf.symbol_chars)
    lonely = sum(1 for l in content if l.strip() in BULLETS or strip_md(l) in BULLETS)

    breaks = broken = 0
    for a, b in zip(lines, lines[1:]):
        if not a.strip() or not b.strip():
            continue
        if _HEADING.match(a) or _ITEM.match(a) or _HEADING.match(b) or a.lstrip().startswith("|") or b.lstrip().startswith("|"):
            continue
        breaks += 1
        head = b.lstrip()[0]
        if not _ENDS_SENTENCE.search(a) and head.isalpha() and head.islower():
            broken += 1

    items = [m for l in content if (m := _ITEM.match(l))]
    depth = len({len(m.group(1).expandtabs(4)) for m in items})

    ref = Counter(tokens(_ref_text(pf, doc)))
    kept = "\n".join(l for l, is_footer in zip(content, footer) if not is_footer)
    out = Counter(tokens(kept))
    total_ref, total_out = sum(ref.values()), sum(out.values())
    dropped = 100 * (1 - sum((ref & out).values()) / total_ref) if total_ref else 0.0
    invented = 100 * sum((out - ref).values()) / total_out if total_out else 0.0

    return dict(zip(CHECK_FIELDS, (
        pf.number,
        sum(footer),
        title_first,
        wrong,
        lonely,
        round(100 * broken / breaks, 1) if breaks else 0.0,
        sum(1 for l in content if _HEADING.match(l)),
        len(items),
        depth,
        sum(1 for l in lines if _TABLE_SEP.match(l)),
        len(_MATH.findall(text)),
        round(dropped, 1),
        round(invented, 1),
        len(text),
    )))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_checks.py -q`
Expected: `14 passed` (or `13 passed, 1 skipped` where the SWT deck is absent)

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/checks.py backend/tests/unit/test_parser_bench_checks.py
git commit -m "feat(parser-bench): automatic page checks against the PDF's own text layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The five fast runners

**Files:**
- Create: `backend/eval/parser_bench/runners/current_runner.py`
- Create: `backend/eval/parser_bench/runners/pymupdf4llm_runner.py`
- Create: `backend/eval/parser_bench/runners/markitdown_runner.py`
- Create: `backend/eval/parser_bench/runners/opendataloader_runner.py`
- Create: `backend/eval/parser_bench/runners/pdfjs_runner.mjs`
- Test: `backend/tests/unit/test_parser_bench_runners.py`

**Interfaces:**
- Consumes: `store.REPO`, `parser_bench_fixtures.make_deck`, `TITLES`.
- Produces: every runner is invoked as `<interpreter> <runner> <in.pdf> <out.json>`. It writes UTF-8 JSON `{"version": str, "settings": {...}, "pages": {"1": "...", ...}}` and exits 0. `current_runner.extract(pdf_bytes: bytes) -> list[str]`.
- The `runners/` folder has **no** `__init__.py`. Runners run with `python -I` in foreign environments and must import nothing from this repo.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_parser_bench_runners.py`:

```python
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

import backend.eval.parser_bench as bench_pkg
from backend.eval.parser_bench.store import REPO
from backend.tests.unit.parser_bench_fixtures import TITLES, make_deck

RUNNERS = Path(bench_pkg.__file__).parent / "runners"


def _load(name):
    spec = importlib.util.spec_from_file_location(name, RUNNERS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current_matches_production(tmp_path):
    """The standalone copy must equal production's own function, byte for byte."""
    from backend.services.parser.unified_orchestrator import _extract_pages

    pdf = make_deck(tmp_path / "deck.pdf").read_bytes()
    assert _load("current_runner").extract(pdf) == _extract_pages(pdf)


def test_current_runner_writes_the_contract(tmp_path):
    deck, out = make_deck(tmp_path / "deck.pdf"), tmp_path / "out.json"
    subprocess.run([sys.executable, "-I", str(RUNNERS / "current_runner.py"), str(deck), str(out)], check=True)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert set(data) == {"version", "settings", "pages"}
    assert sorted(data["pages"], key=int) == [str(n) for n in range(1, 7)]
    assert TITLES[2] in data["pages"]["3"]


def test_every_runner_has_usage_in_its_docstring():
    runners = [f for f in RUNNERS.iterdir() if f.is_file() and f.suffix in (".py", ".mjs")]
    assert len(runners) == 5
    for f in runners:
        assert "Usage:" in f.read_text(encoding="utf-8"), f.name


NODE = shutil.which("node")
PDFJS = REPO / "node_modules" / "pdfjs-dist"


@pytest.mark.skipif(not NODE or not PDFJS.exists(), reason="node or node_modules/pdfjs-dist missing")
def test_pdfjs_runner(tmp_path):
    deck, out = make_deck(tmp_path / "deck.pdf"), tmp_path / "out.json"
    subprocess.run([NODE, str(RUNNERS / "pdfjs_runner.mjs"), str(deck), str(out)], check=True)
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["version"].startswith("5.")
    assert TITLES[2] in data["pages"]["3"]
```

(The test imports `backend.services.parser.unified_orchestrator` on purpose. It runs under pytest, where `backend/tests/conftest.py` stubs every credential before any backend import. The benchmark itself never imports it.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_runners.py -q`
Expected: FAIL. `FileNotFoundError` on `current_runner.py`, and `test_every_runner_has_usage_in_its_docstring` fails because `RUNNERS` doesn't exist.

- [ ] **Step 3: Write the runners**

`backend/eval/parser_bench/runners/current_runner.py`:

```python
"""`current`: our production extraction, exactly as
backend.services.parser.unified_orchestrator._extract_pages does it.

Standalone on purpose: importing the orchestrator imports backend.core.database,
whose load_dotenv() reaches the main checkout's .env (production credentials)
from a worktree. test_parser_bench_runners.py::test_current_matches_production
pins this copy to the production function, so the two cannot drift apart.

Usage: python -I current_runner.py <in.pdf> <out.json>
"""
import json
import sys
from importlib.metadata import version


def extract(pdf_bytes: bytes) -> list:
    import fitz

    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        return [page.get_text("text") or "" for page in doc]


def main(argv: list) -> None:
    src, out = argv[1], argv[2]
    with open(src, "rb") as f:
        pages = extract(f.read())
    result = {
        "version": version("pymupdf"),
        "settings": {"call": 'page.get_text("text")', "copy_of": "unified_orchestrator._extract_pages"},
        "pages": {str(n): text for n, text in enumerate(pages, start=1)},
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
```

`backend/eval/parser_bench/runners/pymupdf4llm_runner.py`:

```python
"""`pymupdf4llm`: the Markdown mode of PyMuPDF, one chunk per page, default settings.

Usage: python -I pymupdf4llm_runner.py <in.pdf> <out.json>
"""
import json
import sys
from importlib.metadata import version


def main(argv: list) -> None:
    import pymupdf4llm

    src, out = argv[1], argv[2]
    chunks = pymupdf4llm.to_markdown(src, page_chunks=True)
    result = {
        "version": version("pymupdf4llm"),
        "settings": {"page_chunks": True},
        "pages": {str(n): chunk.get("text", "") for n, chunk in enumerate(chunks, start=1)},
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
```

`backend/eval/parser_bench/runners/markitdown_runner.py`:

```python
"""`markitdown`: Microsoft MarkItDown, default settings, one page at a time,
because a whole-document conversion marks no page boundaries. pypdf splits the pages.

Usage: python -I markitdown_runner.py <in.pdf> <out.json>
"""
import json
import os
import sys
import tempfile
from importlib.metadata import version


def main(argv: list) -> None:
    from markitdown import MarkItDown
    from pypdf import PdfReader, PdfWriter

    src, out = argv[1], argv[2]
    converter = MarkItDown()
    pages = {}
    with tempfile.TemporaryDirectory() as tmp:
        for n, page in enumerate(PdfReader(src).pages, start=1):
            single = os.path.join(tmp, f"p{n}.pdf")
            writer = PdfWriter()
            writer.add_page(page)
            with open(single, "wb") as f:
                writer.write(f)
            pages[str(n)] = converter.convert(single).text_content
    result = {
        "version": version("markitdown"),
        "settings": {"per_page": True, "splitter": f"pypdf {version('pypdf')}"},
        "pages": pages,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
```

`backend/eval/parser_bench/runners/opendataloader_runner.py`:

```python
"""`opendataloader`: OpenDataLoader PDF (runs Java), Markdown output, default
settings except images off. Its own page separator splits the pages.

Usage: python -I opendataloader_runner.py <in.pdf> <out.json>
"""
import glob
import json
import os
import re
import shutil
import sys
import tempfile
from importlib.metadata import version

SEPARATOR = "<<<LS-PAGE %page-number%>>>"
SPLIT = re.compile(r"\n?<<<LS-PAGE (\d+)>>>\n")


def main(argv: list) -> None:
    import opendataloader_pdf

    src, out = argv[1], argv[2]
    with tempfile.TemporaryDirectory() as tmp:
        # A plain copy: the output is named after the input, and some deck names start with a space.
        source = os.path.join(tmp, "input.pdf")
        shutil.copyfile(src, source)
        target = os.path.join(tmp, "out")
        opendataloader_pdf.convert(
            input_path=source,
            output_dir=target,
            format="markdown",
            quiet=True,
            markdown_page_separator="\n" + SEPARATOR + "\n",
            image_output="off",
        )
        [md_file] = glob.glob(os.path.join(target, "**", "*.md"), recursive=True)
        with open(md_file, encoding="utf-8") as f:
            markdown = f.read()
    parts = SPLIT.split(markdown)  # ['', '1', page1, '2', page2, ...]
    pages = {parts[i]: parts[i + 1].strip() for i in range(1, len(parts) - 1, 2)}
    result = {
        "version": version("opendataloader-pdf"),
        "settings": {"format": "markdown", "image_output": "off", "include_header_footer": False},
        "pages": pages,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
```

`backend/eval/parser_bench/runners/pdfjs_runner.mjs`:

```js
// `pdfjs`: the PDF.js text layer, as a browser builds it. A page's text is its
// text items joined, with a newline wherever PDF.js marks an end of line.
// Resolves pdfjs-dist from this repo's node_modules.
//
// Usage: node pdfjs_runner.mjs <in.pdf> <out.json>
import { readFile, writeFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const [, , src, out] = process.argv;
const data = new Uint8Array(await readFile(src));
const doc = await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
const pages = {};
for (let n = 1; n <= doc.numPages; n++) {
  const content = await (await doc.getPage(n)).getTextContent();
  pages[n] = content.items.map((item) => ('str' in item ? item.str : '') + (item.hasEOL ? '\n' : '')).join('');
}
await writeFile(
  out,
  JSON.stringify({ version: pdfjs.version, settings: { call: 'getTextContent', join: 'items, newline on hasEOL' }, pages }),
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_runners.py -q`
Expected: `4 passed`

- [ ] **Step 5: Re-run the isolation guard (runners now exist)**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_store.py::test_the_bench_never_imports_the_app -q`
Expected: `1 passed`. The runner docstrings mention `backend.services` but never import it.

- [ ] **Step 6: Commit**

```bash
git add backend/eval/parser_bench/runners backend/tests/unit/test_parser_bench_runners.py
git commit -m "feat(parser-bench): five fast runners; current pinned to production's _extract_pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The method registry and environments (`tools.py`)

**Files:**
- Create: `backend/eval/parser_bench/tools.py`
- Test: `backend/tests/unit/test_parser_bench_tools.py`

**Interfaces:**
- Consumes: `store.REPO`, the runner files from Task 4.
- Produces:
  - `tools.RUNNERS: Path`
  - `tools.GROUPS = ("fast", "heavy", "paid")`
  - `tools.FREE_FLOOR = 3 * 2**30`
  - `tools.Tool(id, label, group, runner, description, kind="python", requirements=(), python="3.12", needs=(), size_mb=0)`, with `.runner_path`
  - `tools.TOOLS: dict[str, Tool]`, holding `current`, `pymupdf4llm`, `pdfjs`, `markitdown`, `opendataloader`
  - `tools.envs_root() -> Path`
  - `tools.env_python(tool) -> Path`
  - `tools.pdfjs_package() -> Path`
  - `tools.missing(tool) -> list[str]`
  - `tools.is_ready(tool) -> bool`
  - `tools.command(tool) -> list[str]`
  - `tools.install(tool, *, free_bytes=None) -> list[str]`
  - `tools.environment(tool) -> list[str]`
  - `tools.DiskSpaceError`, `tools.ToolNotReady` (both subclass `RuntimeError`)

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_parser_bench_tools.py`:

```python
import sys

import pytest

from backend.eval.parser_bench import tools


def test_every_runner_exists_and_every_group_is_known():
    for tool in tools.TOOLS.values():
        assert tool.runner_path.exists(), tool.id
        assert tool.group in tools.GROUPS, tool.id
        assert tool.kind in ("python", "node"), tool.id


def test_the_five_fast_methods_are_registered():
    assert list(tools.TOOLS) == ["current", "pymupdf4llm", "pdfjs", "markitdown", "opendataloader"]


def test_current_runs_in_this_interpreter_isolated():
    cmd = tools.command(tools.TOOLS["current"])
    assert cmd[:2] == [sys.executable, "-I"] and cmd[2].endswith("current_runner.py")
    assert tools.is_ready(tools.TOOLS["current"])


def test_env_methods_use_their_own_environment(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    tool = tools.TOOLS["markitdown"]
    assert tools.command(tool)[0] == str(tmp_path / "markitdown" / "bin" / "python")
    assert any("environment" in gap for gap in tools.missing(tool))


def test_install_refuses_when_too_little_disk_would_remain(monkeypatch):
    monkeypatch.setattr(tools.subprocess, "run", lambda *a, **k: pytest.fail("must not install"))
    with pytest.raises(tools.DiskSpaceError, match="3 GB"):
        tools.install(tools.TOOLS["opendataloader"], free_bytes=3 * 2**30)


def test_a_runner_path_can_be_absolute(tmp_path):
    script = tmp_path / "fake.py"
    tool = tools.Tool("fake", "Fake", "fast", str(script), "test double")
    assert tool.runner_path == script


def test_environment_of_current_names_pymupdf():
    env = tools.environment(tools.TOOLS["current"])
    assert any(line.startswith("pymupdf==") for line in env)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_tools.py -q`
Expected: FAIL with `ImportError: cannot import name 'tools'`

- [ ] **Step 3: Write `tools.py`**

`backend/eval/parser_bench/tools.py`:

```python
"""Which extraction methods exist, where each one runs, and how it is installed.

Each method with requirements gets its own uv environment (Python 3.12), because
the tools pin conflicting libraries. `current` runs in this interpreter, the
backend .venv, so it uses production's own PyMuPDF version. `pdfjs` runs on Node
with this repo's node_modules.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from importlib.metadata import version as dist_version
from pathlib import Path

from backend.eval.parser_bench.store import REPO

RUNNERS = Path(__file__).resolve().parent / "runners"
GROUPS = ("fast", "heavy", "paid")
FREE_FLOOR = 3 * 2**30


class DiskSpaceError(RuntimeError):
    """Installing would leave less than FREE_FLOOR on the disk."""


class ToolNotReady(RuntimeError):
    """A method is missing its environment or a program it needs."""


@dataclass(frozen=True)
class Tool:
    id: str
    label: str
    group: str
    runner: str
    description: str
    kind: str = "python"                 # "python" | "node"
    requirements: tuple[str, ...] = ()   # empty: runs in an interpreter that already has it
    python: str = "3.12"
    needs: tuple[str, ...] = ()          # programs that must be on PATH
    size_mb: int = 0                     # rough install size, for the disk guard

    @property
    def runner_path(self) -> Path:
        p = Path(self.runner)
        return p if p.is_absolute() else RUNNERS / p


TOOLS: dict[str, Tool] = {t.id: t for t in (
    Tool("current", "Our pipeline (PyMuPDF)", "fast", "current_runner.py",
         "exactly what production stores today"),
    Tool("pymupdf4llm", "pymupdf4llm", "fast", "pymupdf4llm_runner.py",
         "Markdown mode of the same library", requirements=("pymupdf4llm",), size_mb=80),
    Tool("pdfjs", "PDF.js", "fast", "pdfjs_runner.mjs",
         "the browser's text layer", kind="node", needs=("node",)),
    Tool("markitdown", "MarkItDown", "fast", "markitdown_runner.py",
         "Microsoft's converter, page by page", requirements=("markitdown[pdf]==0.1.6", "pypdf"), size_mb=60),
    Tool("opendataloader", "OpenDataLoader", "fast", "opendataloader_runner.py",
         "layout-aware, uses Java", requirements=("opendataloader-pdf==2.4.1",), needs=("java",), size_mb=120),
)}


def envs_root() -> Path:
    return Path(os.environ.get("PARSER_BENCH_ENVS") or Path.home() / ".cache" / "learnstation-parser-bench" / "envs")


def env_python(tool: Tool) -> Path:
    return envs_root() / tool.id / "bin" / "python"


def pdfjs_package() -> Path:
    return REPO / "node_modules" / "pdfjs-dist" / "package.json"


def missing(tool: Tool) -> list[str]:
    gaps = [program for program in tool.needs if shutil.which(program) is None]
    if tool.kind == "node" and not pdfjs_package().exists():
        gaps.append("node_modules/pdfjs-dist (run npm install)")
    if tool.requirements and not env_python(tool).exists():
        gaps.append(f"its environment (python -m backend.eval.parser_bench install {tool.id})")
    return gaps


def is_ready(tool: Tool) -> bool:
    return not missing(tool)


def command(tool: Tool) -> list[str]:
    if tool.kind == "node":
        return [shutil.which("node") or "node", str(tool.runner_path)]
    python = str(env_python(tool)) if tool.requirements else sys.executable
    return [python, "-I", str(tool.runner_path)]


def _uv() -> str:
    uv = shutil.which("uv") or str(Path.home() / ".local" / "bin" / "uv")
    if not Path(uv).exists():
        raise ToolNotReady("uv is not installed (https://docs.astral.sh/uv/)")
    return uv


def install(tool: Tool, *, free_bytes: int | None = None) -> list[str]:
    """Create the method's own environment; return its exact package list."""
    if not tool.requirements:
        return environment(tool)
    free = shutil.disk_usage(Path.home()).free if free_bytes is None else free_bytes
    if free - tool.size_mb * 2**20 < FREE_FLOOR:
        raise DiskSpaceError(f"installing {tool.id} (~{tool.size_mb} MB) would leave less than 3 GB free")
    uv = _uv()
    env = envs_root() / tool.id
    if not env_python(tool).exists():
        subprocess.run([uv, "venv", "--python", tool.python, str(env)], check=True)
    subprocess.run([uv, "pip", "install", "--python", str(env_python(tool)), *tool.requirements], check=True)
    return environment(tool)


def environment(tool: Tool) -> list[str]:
    """Exact versions of what runs, recorded in every run.json."""
    if tool.kind == "node":
        node = subprocess.run([shutil.which("node") or "node", "--version"], capture_output=True, text=True).stdout.strip()
        pkg = json.loads(pdfjs_package().read_text()) if pdfjs_package().exists() else {}
        return [f"node {node}", f"pdfjs-dist=={pkg.get('version', '?')}"]
    if not tool.requirements:
        return [f"pymupdf=={dist_version('pymupdf')}", f"python {sys.version.split()[0]}"]
    frozen = subprocess.run(
        [_uv(), "pip", "freeze", "--python", str(env_python(tool))], capture_output=True, text=True, check=True
    ).stdout
    return sorted(line for line in frozen.splitlines() if line.strip())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_tools.py -q`
Expected: `7 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/tools.py backend/tests/unit/test_parser_bench_tools.py
git commit -m "feat(parser-bench): method registry, per-tool uv environments, 3 GB disk guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Running a method (`execute.py`)

**Files:**
- Create: `backend/eval/parser_bench/execute.py`
- Test: `backend/tests/unit/test_parser_bench_execute.py`

**Interfaces:**
- Consumes:
  - `store.ExtractRun.create(...)`, `.write_page`, `.write_checks`, `.append_log`, `.finish`, `store.now_iso`, `store.REPO`
  - `checks.document_facts`, `checks.check_page`
  - `normalize.normalize_figures`
  - `sources.page_count`, `sources.sha256_file`, `sources.two_page_sample`
  - `tools.TOOLS`, `tools.Tool`, `tools.ToolNotReady`, `tools.command`, `tools.environment`, `tools.missing`
- Produces:
  - `execute.PROTOCOL: Path`
  - `execute.DEFAULT_TIMEOUT = 3600.0`
  - `execute.RunnerError(message, log="")`, with `.log`
  - `execute.Invocation(pages, version, settings, seconds, peak_mb, log)`
  - `execute.invoke(tool, pdf, *, timeout=DEFAULT_TIMEOUT) -> Invocation`
  - `execute.protocol_commit() -> str | None`
  - `execute.run_tool(tool_id, pdf, *, pages=None, purpose="explore", warmup=True, root=None, registry=TOOLS, timeout=DEFAULT_TIMEOUT) -> store.ExtractRun`. It raises `ToolNotReady`, `ValueError` (pages out of range) or `RuntimeError` (benchmark without protocol). A runner failure **returns** a failed run; it does not raise.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_parser_bench_execute.py`:

```python
import pytest

from backend.eval.parser_bench import execute
from backend.eval.parser_bench.tools import Tool
from backend.tests.unit.parser_bench_fixtures import make_deck

FAKE_OK = '''
import json, sys
import fitz
with fitz.open(sys.argv[1]) as d:
    pages = {str(n): p.get_text("text") for n, p in enumerate(d, start=1)}
json.dump({"version": "9.9", "settings": {"fake": True}, "pages": pages}, open(sys.argv[2], "w"))
'''
FAKE_FAIL = 'import sys\nprint("boom")\nsys.exit(3)\n'
FAKE_SLOW = 'import time\ntime.sleep(30)\n'


def registry(tmp_path, name, body):
    script = tmp_path / f"{name}.py"
    script.write_text(body)
    return {name: Tool(name, name, "fast", str(script), "test double")}


@pytest.fixture
def deck(tmp_path):
    return make_deck(tmp_path / "deck.pdf")


def test_a_finished_run_has_pages_checks_and_cost(tmp_path, deck):
    run = execute.run_tool("fake", deck, pages=[3, 2], root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))
    m = run.meta
    assert (m["status"], m["version"], m["pages_scored"], m["missing_pages"]) == ("finished", "9.9", [2, 3], [])
    assert m["settings"] == {"fake": True}
    assert set(run.pages()) == {2, 3}
    rows = run.checks()
    assert [r["page"] for r in rows] == ["2", "3"] and rows[0]["footer_leaks"] == "3"
    assert m["seconds_per_page"] >= 0 and m["peak_memory_mb"] >= 0 and m["warmup_seconds"] is not None
    assert m["source"]["pages_total"] == 6 and len(m["source"]["sha256"]) == 64
    assert any(line.startswith("pymupdf==") for line in m["environment"])


def test_a_failing_method_leaves_a_failed_run(tmp_path, deck):
    run = execute.run_tool("bad", deck, root=tmp_path / "data", registry=registry(tmp_path, "bad", FAKE_FAIL))
    assert run.meta["status"] == "failed" and "code 3" in run.meta["reason"]
    assert "boom" in (run.path / "log.txt").read_text()


def test_a_timeout_is_a_failed_run(tmp_path, deck):
    run = execute.run_tool("slow", deck, root=tmp_path / "data", warmup=False, timeout=1,
                           registry=registry(tmp_path, "slow", FAKE_SLOW))
    assert run.meta["status"] == "failed" and "timed out" in run.meta["reason"]


def test_pages_outside_the_file_are_refused(tmp_path, deck):
    with pytest.raises(ValueError, match="outside"):
        execute.run_tool("fake", deck, pages=[7], root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))


def test_benchmark_runs_need_a_committed_protocol(tmp_path, deck, monkeypatch):
    reg = registry(tmp_path, "fake", FAKE_OK)
    monkeypatch.setattr(execute, "protocol_commit", lambda: None)
    with pytest.raises(RuntimeError, match="PROTOCOL.md"):
        execute.run_tool("fake", deck, purpose="benchmark", root=tmp_path / "data", registry=reg)
    monkeypatch.setattr(execute, "protocol_commit", lambda: "abc123")
    run = execute.run_tool("fake", deck, purpose="benchmark", warmup=False, root=tmp_path / "data", registry=reg)
    assert (run.meta["purpose"], run.meta["protocol_commit"]) == ("benchmark", "abc123")


def test_a_method_that_is_not_ready_is_refused(tmp_path, deck):
    reg = {"ghost": Tool("ghost", "Ghost", "fast", "ghost_runner.py", "missing", requirements=("nothing",))}
    with pytest.raises(execute.ToolNotReady):
        execute.run_tool("ghost", deck, root=tmp_path / "data", registry=reg)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_execute.py -q`
Expected: FAIL with `ImportError: cannot import name 'execute'`

- [ ] **Step 3: Write `execute.py`**

`backend/eval/parser_bench/execute.py`:

```python
"""Run one method on one PDF and keep the result as a permanent run.

Every method first runs once on a two-page sample (warm-up), so a first-time
model download is never timed. The timed run's peak memory is the largest
resident size of the runner's whole process tree, sampled every 0.2 s; that
includes OpenDataLoader's Java child.
"""
from __future__ import annotations

import json
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

import psutil

from backend.eval.parser_bench import checks, store
from backend.eval.parser_bench.normalize import normalize_figures
from backend.eval.parser_bench.sources import page_count, sha256_file, two_page_sample
from backend.eval.parser_bench.tools import TOOLS, Tool, ToolNotReady, command, environment, missing

PROTOCOL = store.REPO / "docs" / "thesis" / "experiments" / "parser-benchmark" / "PROTOCOL.md"
DEFAULT_TIMEOUT = 3600.0
SAMPLE_EVERY = 0.2

__all__ = ["Invocation", "RunnerError", "ToolNotReady", "invoke", "protocol_commit", "run_tool"]


class RunnerError(RuntimeError):
    def __init__(self, message: str, log: str = ""):
        super().__init__(message)
        self.log = log


@dataclass
class Invocation:
    pages: dict[int, str]
    version: str
    settings: dict
    seconds: float
    peak_mb: float
    log: str


def _tree_rss(root: psutil.Process) -> int:
    total = 0
    for proc in [root, *root.children(recursive=True)]:
        try:
            total += proc.memory_info().rss
        except psutil.Error:
            pass
    return total


def _kill_tree(root: psutil.Process) -> None:
    for proc in [*root.children(recursive=True), root]:
        try:
            proc.kill()
        except psutil.Error:
            pass


def invoke(tool: Tool, pdf: Path, *, timeout: float = DEFAULT_TIMEOUT) -> Invocation:
    with tempfile.TemporaryDirectory() as tmp:
        out, log_file = Path(tmp) / "out.json", Path(tmp) / "log.txt"
        with open(log_file, "w") as log:
            start = time.monotonic()
            proc = subprocess.Popen([*command(tool), str(pdf), str(out)], stdout=log, stderr=subprocess.STDOUT, cwd=tmp)
            try:
                watched = psutil.Process(proc.pid)
            except psutil.Error:
                watched = None
            peak = 0
            while proc.poll() is None:
                if time.monotonic() - start > timeout:
                    if watched:
                        _kill_tree(watched)
                    proc.kill()
                    proc.wait()
                    raise RunnerError(f"{tool.id} timed out after {timeout:.0f} s", log_file.read_text(errors="replace"))
                if watched:
                    peak = max(peak, _tree_rss(watched))
                time.sleep(SAMPLE_EVERY)
            seconds = time.monotonic() - start
        text = log_file.read_text(errors="replace")
        if proc.returncode != 0:
            raise RunnerError(f"{tool.id} exited with code {proc.returncode}", text)
        try:
            data = json.loads(out.read_text(encoding="utf-8"))
            pages = {int(k): v for k, v in data["pages"].items()}
        except (OSError, ValueError, KeyError, TypeError) as e:
            raise RunnerError(f"{tool.id} wrote no readable output: {e}", text) from e
    return Invocation(pages, str(data.get("version", "unknown")), dict(data.get("settings", {})), seconds, round(peak / 2**20, 1), text)


def protocol_commit() -> str | None:
    """The commit that last changed PROTOCOL.md, or None if it is missing, uncommitted or edited since."""
    if not PROTOCOL.exists():
        return None
    rel = str(PROTOCOL.relative_to(store.REPO))
    git = ["git", "-C", str(store.REPO)]
    if subprocess.run([*git, "status", "--porcelain", "--", rel], capture_output=True, text=True).stdout.strip():
        return None
    return subprocess.run([*git, "log", "-1", "--format=%H", "--", rel], capture_output=True, text=True).stdout.strip() or None


def run_tool(
    tool_id: str,
    pdf: Path,
    *,
    pages: Sequence[int] | None = None,
    purpose: str = "explore",
    warmup: bool = True,
    root: Path | None = None,
    registry: Mapping[str, Tool] = TOOLS,
    timeout: float = DEFAULT_TIMEOUT,
) -> store.ExtractRun:
    tool = registry[tool_id]
    gaps = missing(tool)
    if gaps:
        raise ToolNotReady(f"{tool_id} is not ready: {'; '.join(gaps)}")
    extra: dict = {}
    if purpose == "benchmark":
        commit = protocol_commit()
        if commit is None:
            raise RuntimeError("benchmark runs need PROTOCOL.md committed and unmodified first (spec: protocol before the first run)")
        extra["protocol_commit"] = commit

    pdf = Path(pdf).resolve()
    total = page_count(pdf)
    wanted = sorted(set(pages)) if pages else list(range(1, total + 1))
    outside = [p for p in wanted if not 1 <= p <= total]
    if outside:
        raise ValueError(f"pages {outside} are outside 1–{total}")
    source = {"path": str(pdf), "name": pdf.name, "sha256": sha256_file(pdf), "pages_total": total}

    started, version, warm_seconds = store.now_iso(), "unknown", None
    try:
        if warmup:
            with tempfile.TemporaryDirectory() as tmp:
                warm = invoke(tool, two_page_sample(pdf, Path(tmp) / "warmup.pdf"), timeout=timeout)
            version, warm_seconds = warm.version, round(warm.seconds, 2)
        result = invoke(tool, pdf, timeout=timeout)
    except RunnerError as e:
        run = store.ExtractRun.create(tool=tool_id, version=version, source=source, purpose=purpose,
                                      started_at=started, extra=extra, root=root)
        run.append_log(e.log)
        run.finish("failed", reason=str(e), pages_scored=wanted)
        return run

    facts = checks.document_facts(pdf)
    run = store.ExtractRun.create(tool=tool_id, version=result.version, source=source, purpose=purpose,
                                  settings=result.settings, started_at=started, extra=extra, root=root)
    run.append_log(result.log)
    rows = []
    for page in wanted:
        text = normalize_figures(result.pages.get(page, ""))
        run.write_page(page, text)
        rows.append(checks.check_page(text, facts.pages[page], facts))
    run.write_checks(rows)
    run.finish(
        "finished",
        pages_scored=wanted,
        missing_pages=[p for p in wanted if p not in result.pages],
        seconds_total=round(result.seconds, 2),
        seconds_per_page=round(result.seconds / total, 3),
        peak_memory_mb=result.peak_mb,
        warmup_seconds=warm_seconds,
        environment=environment(tool),
    )
    return run
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_execute.py -q`
Expected: `6 passed` (the timeout test takes about 1 s)

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/execute.py backend/tests/unit/test_parser_bench_execute.py
git commit -m "feat(parser-bench): run a method with warm-up, timing, peak memory, timeout, protocol guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The command line (`__main__.py`)

**Files:**
- Create: `backend/eval/parser_bench/__main__.py`
- Test: `backend/tests/unit/test_parser_bench_cli.py`

**Interfaces:**
- Consumes: `execute.run_tool`, `execute.protocol_commit`, `store.list_runs`, `store.export_run`, `store.PURPOSES`, `tools.TOOLS`, `tools.missing`, `tools.install`, `tools.DiskSpaceError`.
- Produces:
  - `main(argv: list[str] | None = None) -> int`, which returns 0 on success, 1 for a failed run, and 2 for a refusal.
  - `_pages("1,4-6") -> [1, 4, 5, 6]`
  - Subcommands: `tools`, `install <tool>`, `run <tool> <pdf> [--pages] [--purpose] [--no-warmup]`, `runs`, `export <run_id>`. Plans 2 and 3 add `serve`, `compare` and `select`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_parser_bench_cli.py`:

```python
from backend.eval.parser_bench import __main__ as cli
from backend.eval.parser_bench import execute, store, tools
from backend.tests.unit.parser_bench_fixtures import make_deck


def test_page_ranges():
    assert cli._pages("1,4-6") == [1, 4, 5, 6]


def test_tools_lists_every_method(capsys):
    assert cli.main(["tools"]) == 0
    out = capsys.readouterr().out
    for tool_id in tools.TOOLS:
        assert tool_id in out
    assert "current" in out and "ready" in out


def test_run_current_makes_a_finished_run(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    deck = make_deck(tmp_path / "deck.pdf")
    assert cli.main(["run", "current", str(deck), "--pages", "2-3", "--no-warmup"]) == 0
    assert "finished" in capsys.readouterr().out
    [meta] = store.list_runs()
    assert (meta["tool"], meta["pages_scored"], meta["purpose"]) == ("current", [2, 3], "explore")


def test_benchmark_without_a_protocol_is_refused(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(execute, "protocol_commit", lambda: None)
    deck = make_deck(tmp_path / "deck.pdf")
    assert cli.main(["run", "current", str(deck), "--purpose", "benchmark", "--no-warmup"]) == 2
    assert "PROTOCOL.md" in capsys.readouterr().err
    assert store.list_runs() == []


def test_runs_and_export(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    deck = make_deck(tmp_path / "deck.pdf")
    cli.main(["run", "current", str(deck), "--no-warmup"])
    capsys.readouterr()
    assert cli.main(["runs"]) == 0
    [meta] = store.list_runs()
    assert meta["run_id"] in capsys.readouterr().out
    assert cli.main(["export", meta["run_id"]]) == 2  # an explore run never reaches the thesis
    assert "explore" in capsys.readouterr().err
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_cli.py -q`
Expected: FAIL with `ImportError: cannot import name '__main__'`

- [ ] **Step 3: Write `__main__.py`**

`backend/eval/parser_bench/__main__.py`:

```python
"""python -m backend.eval.parser_bench <tools|install|run|runs|export>

    tools                         list methods and whether each is ready
    install <tool>                create a method's own environment
    run <tool> <pdf> [--pages 1,4-6] [--purpose explore|benchmark] [--no-warmup]
    runs                          list every run, newest first
    export <run_id>               copy a benchmark run's numbers into the repo
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from backend.eval.parser_bench import execute, store, tools


def _pages(spec: str) -> list[int]:
    pages: list[int] = []
    for part in spec.split(","):
        first, _, last = part.partition("-")
        pages += list(range(int(first), int(last or first) + 1))
    return pages


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m backend.eval.parser_bench")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("tools", help="list methods and whether each is ready")
    p = sub.add_parser("install", help="create a method's own environment")
    p.add_argument("tool", choices=sorted(tools.TOOLS))
    p = sub.add_parser("run", help="run one method on one PDF")
    p.add_argument("tool", choices=sorted(tools.TOOLS))
    p.add_argument("pdf", type=Path)
    p.add_argument("--pages", type=_pages, help="e.g. 1,4-6 (default: every page)")
    p.add_argument("--purpose", choices=store.PURPOSES, default="explore")
    p.add_argument("--no-warmup", action="store_true", help="skip the two-page warm-up run")
    sub.add_parser("runs", help="list every run, newest first")
    p = sub.add_parser("export", help="copy a benchmark run's numbers into the repo")
    p.add_argument("run_id")
    args = parser.parse_args(argv)

    if args.cmd == "tools":
        for tool in tools.TOOLS.values():
            gaps = tools.missing(tool)
            state = "ready" if not gaps else "needs " + "; ".join(gaps)
            print(f"{tool.id:15} {tool.group:6} {state}")
        return 0

    if args.cmd == "install":
        try:
            print("\n".join(tools.install(tools.TOOLS[args.tool])))
        except (tools.DiskSpaceError, tools.ToolNotReady) as e:
            print(e, file=sys.stderr)
            return 2
        return 0

    if args.cmd == "run":
        try:
            run = execute.run_tool(args.tool, args.pdf, pages=args.pages, purpose=args.purpose, warmup=not args.no_warmup)
        except (RuntimeError, ValueError) as e:
            print(e, file=sys.stderr)
            return 2
        meta = run.meta
        detail = meta["reason"] or f"{meta['seconds_per_page']} s/page, peak {meta['peak_memory_mb']} MB"
        print(f"{meta['run_id']}  {meta['status']}  {detail}")
        print(run.path)
        return 0 if meta["status"] == "finished" else 1

    if args.cmd == "runs":
        for meta in store.list_runs():
            print(f"{meta['run_id']:46} {meta.get('tool', ''):15} {meta['status']:9} "
                  f"{meta.get('purpose', ''):9} {meta.get('seconds_per_page', '')}")
        return 0

    if args.cmd == "export":
        try:
            print(store.export_run(args.run_id))
        except (ValueError, FileNotFoundError) as e:
            print(e, file=sys.stderr)
            return 2
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_cli.py -q`
Expected: `5 passed`

- [ ] **Step 5: Run the whole benchmark suite**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_*.py -q`
Expected: every test passes (the real-deck and Node tests are skipped where their inputs are missing).

- [ ] **Step 6: Commit**

```bash
git add backend/eval/parser_bench/__main__.py backend/tests/unit/test_parser_bench_cli.py
git commit -m "feat(parser-bench): command line — tools, install, run, runs, export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Install the fast methods, prove each one live, start the lab log

**Files:**
- Create: `backend/tests/unit/test_parser_bench_runners_live.py`
- Create: `docs/thesis/experiments/parser-benchmark/LAB_LOG.md`

**Interfaces:**
- Consumes: `tools.TOOLS`, `tools.is_ready`, `execute.invoke`, `parser_bench_fixtures.make_deck`, and the CLI.
- Produces: three installed environments (`pymupdf4llm`, `markitdown`, `opendataloader`), five explore runs on *Softwaretechnik 1*, and the first lab-log entries.

- [ ] **Step 1: Write the live test (skips any method not installed)**

`backend/tests/unit/test_parser_bench_runners_live.py`:

```python
"""Each installed method, end to end, on the synthetic deck. Skipped in CI and
for any method whose environment does not exist yet."""
import pytest

from backend.eval.parser_bench import execute, tools
from backend.tests.unit.parser_bench_fixtures import TITLES, make_deck


@pytest.mark.slow
@pytest.mark.parametrize("tool_id", list(tools.TOOLS))
def test_method_reads_the_title_of_every_page(tool_id, tmp_path):
    tool = tools.TOOLS[tool_id]
    if not tools.is_ready(tool):
        pytest.skip(f"{tool_id} not installed: {tools.missing(tool)}")
    result = execute.invoke(tool, make_deck(tmp_path / "deck.pdf"), timeout=600)
    assert sorted(result.pages) == [1, 2, 3, 4, 5, 6]
    for page, title in zip(range(1, 7), TITLES):
        assert title.split()[0].lower() in result.pages[page].lower(), (tool_id, page)
```

- [ ] **Step 2: Record the disk space, then install the three environments**

```bash
df -h / | tail -1
$PY -m backend.eval.parser_bench install pymupdf4llm
$PY -m backend.eval.parser_bench install markitdown
$PY -m backend.eval.parser_bench install opendataloader
df -h / | tail -1
$PY -m backend.eval.parser_bench tools
```

Expected: each install prints its exact package list, and `tools` shows all five methods as `ready`. If `uv` cannot fetch Python 3.12, the install stops with uv's message. Report that, don't work around it.

- [ ] **Step 3: Run the live test**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_runners_live.py -q`
Expected: `5 passed`. If one method fails, read its log in the assertion output, fix that runner, and repeat this step.

- [ ] **Step 4: Smoke run all five on *Softwaretechnik 1* (explore — never the benchmark set)**

```bash
for t in current pymupdf4llm pdfjs markitdown opendataloader; do
  $PY -m backend.eval.parser_bench run "$t" "$HOME/Downloads/Course SWT/Slides/1.pdf" --pages 5,15,17,21
done
$PY -m backend.eval.parser_bench runs
```

Expected: five lines reading `finished`, each with seconds per page and peak memory. Sanity-check one `checks.csv`: `current` page 21 should show `footer_leaks` 3 and `title_first` False. That matches the hand-read finding in the spec.

- [ ] **Step 5: Start the lab log**

Create `docs/thesis/experiments/parser-benchmark/LAB_LOG.md`. Fill every bracketed value from Steps 2–4's real output; a value you didn't observe stays out. The log holds numbers only, no slide text.

```markdown
# Parser benchmark — lab log

Dated, append-only. What was installed, what ran, what failed, and every
deviation from the protocol. Numbers only, never slide text.

## 2026-10-30 — design demo (before any protocol)

- Ran `current`, `opendataloader` (in the backend .venv) and `docling` 2.92.0 on
  *Softwaretechnik 1* (27 pages) to build the design demo. Docling's first run
  took 100.9 s including its one-time model download.
- Abi saw those outputs **with tool names**, so *Softwaretechnik 1* is excluded
  from the benchmark set (spec "Test set"). It stays available for Explore.
- The demo showed the SWT footer sits at 87–90% of page height. The footer
  band rule was changed to the outer 15% by line centre before any benchmark run.
- Disk before installing: [free GB from `df`]. Freed ~4.4 GB on 2026-10-30 by
  removing `node_modules` from six idle worktrees.

## [date] — engine (Plan 1) installs and smoke runs

| Method | Environment (key versions) | Disk after install | s/page on SWT 1 | Peak MB |
|---|---|---|---|---|
| current | [pymupdf==…] | — | [ ] | [ ] |
| pymupdf4llm | [pymupdf4llm==…] | [ ] | [ ] | [ ] |
| pdfjs | [node …, pdfjs-dist==5.4.296] | — | [ ] | [ ] |
| markitdown | [markitdown==0.1.6, pypdf==…] | [ ] | [ ] | [ ] |
| opendataloader | [opendataloader-pdf==2.4.1, Java …] | [ ] | [ ] | [ ] |

Failures and surprises: [each one, or "none"].
```

- [ ] **Step 6: Commit**

```bash
git add backend/tests/unit/test_parser_bench_runners_live.py docs/thesis/experiments/parser-benchmark/LAB_LOG.md
git commit -m "test(parser-bench): live end-to-end check per installed method; start the lab log

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage (Plan 1's share)

| Spec requirement | Task |
|---|---|
| Permanent runs, failed runs kept, results never edited in place | 1 |
| `run.json` with tool, version, settings, git commit and dirty flag, machine, times, status, PDF hash | 1, 6 |
| Export copies number-only files; explore runs never reach the thesis | 1 |
| No app imports; no slide text in git | 1 (guard), 4 (standalone `current`) |
| Benchmark sources with SWT deck 2; deck 1 excluded | 2 |
| Seeded 4 chosen + 2 random selection | 2 (function; the pages themselves are fixed in Plan 3's protocol) |
| Images become `[figure]` | 2 |
| Checks 1–7 with the exact definitions, including the 15% band by line centre | 3 |
| Check 8: warm-up, then seconds per page and peak memory | 6 |
| `current` identical to production | 4 |
| `pymupdf4llm`, `pdfjs`, `markitdown` (per page), `opendataloader` (images off) | 4, 5 |
| Own `uv` environments on Python 3.12; refuse to install below 3 GB free | 5 |
| Exact environment recorded per run | 5, 6 |
| Benchmark runs require a committed protocol | 6 |
| Lab log started | 8 |
| Heavy methods, `ai_vision`, PROTOCOL.md, duels, ranking, webpage, results, figures | Plans 2 and 3 |
