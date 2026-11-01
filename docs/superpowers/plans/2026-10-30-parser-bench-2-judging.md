# Parser Bench, Plan 2 of 3: Judging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Judge the methods' outputs blind in a local webpage and rank them. Abi can bring in any PDF and run methods from the browser, judge duels with the keys 1–4, see the ranking with 95% intervals once judging is finished, compare outputs with names, and look back at every run. The plan ends with the protocol frozen and the first comparison (the five fast methods on the 24 benchmark pages) ready to judge.

**Architecture:** Four layers on top of Plan 1's engine, all in `backend/eval/parser_bench/`:
- **Engine fixes before the freeze.** Checks version 3 (footer parts found across split output lines, plus the footer token share), the main-checkout guard, typed checks, and the benchmark integrity rules (warm-up on, committed code, exactly the page set's pages, one timed run at a time, Tesseract recorded).
- **Judging.** `pageset.py` freezes the 24 pages in `pages.json`. `schedule.py` makes the seeded duel schedule. `compare.py` keeps a comparison run and its append-only vote log. `ranking.py` fits Bradley–Terry with a bootstrap. `results.py` recomputes `results.json` from the votes and applies the stopping rule.
- **Webpage.** `server.py` is a FastAPI app on 127.0.0.1 with three routers (`api_runs.py`, `api_compare.py`, `api_newrun.py`). It is backed by `files.py` (uploads by SHA-256, page images), `blinding.py` (the lock) and `jobs.py` (background runs with a journal). The viewer in `viewer/` is a separate Vite build. It imports the reading face's `Prose`, so outputs render exactly as learners would see them.
- **Protocol.** `PROTOCOL.md` and `pages.json` are committed before any benchmark run. Then come 25 benchmark runs (5 methods × 5 PDFs) and the first comparison.

**Tech Stack:** Python 3.13 (backend `.venv`), FastAPI 0.124, uvicorn 0.33 and python-multipart (already in the `.venv`), PyMuPDF 1.27.1, psutil, pytest. Node 22 with this repo's React 18, Vite 6, Tailwind 3, Vitest 3, TypeScript 5, and `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` through `@/components/markdown`.

**Spec:** `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md`. Decisions 8 and 9, Duels, Analysis, Storing runs, The webpage and Thesis documentation are the parts this plan builds.

**Builds on:** Plan 1 as built (branch `claude/file-upload-workflow-e9126d` at `cbba4295`). The code is authoritative where it differs from Plan 1's text. In particular:
- `is_footer_line(line, pf, doc)` takes `PageFacts`.
- `run_tool` seals failed runs with a `failed_stage`.
- `ExtractRun.create` takes `git=` and `checks_version=`.
- `RECORD_VERSION = 1`.

**Roadmap:** Plan 3 (experiment) adds the heavy runners (`docling`, `marker`, `mineru`, `paddleocr`) and `ai_vision` with its cost OK. It then runs the second comparison against the same opponents, and does the improvement loop, the export, `RESULTS.md` and the figures. Plan 3 also takes the parked engine items listed in the coverage table at the end.

## Global Constraints

- **Python:** `PY=~/Desktop/ascend-academy/.venv/bin/python`. **Node:** `NODE=~/.nvm/versions/node/v22.23.1/bin/node`. Run every command from the worktree root `~/Desktop/ascend-academy/.claude/worktrees/file-upload-workflow-e9126d`.
- **Test commands:** `$PY -m pytest backend/tests/unit/<file> -q` and `$NODE node_modules/vitest/vitest.mjs run --config backend/eval/parser_bench/viewer/vite.config.ts`.
- **No app imports.** No module under `backend/eval/parser_bench/` may import `backend.core`, `backend.services`, `backend.api`, `backend.repositories` or `backend.workers`. Importing them loads the main checkout's `.env` with production credentials. FastAPI, uvicorn and pydantic are libraries, not the app, and are allowed.
- **No slide text, PDFs or home paths in git.** Data lives in `PARSER_BENCH_DIR` (default `~/Documents/learnstation-parser-bench/`), never inside this worktree or the main checkout. Uploaded PDFs go to `<data>/files/<sha256>/<name>.pdf`.
  - `pages.json` and `PROTOCOL.md` describe a page's *structure* ("two-column layout with coloured boxes"). They never quote slide text.
  - Titles printed by `select show` stay in the terminal and in messages to the controller.
  - The lab log uses `~`, never `/Users/<name>`.
- **Records.** A finished extraction run is never changed. A comparison changes only while its status is `judging`. `votes.jsonl` is append-only and fsynced, and undo appends a retraction. `results.json` is always recomputed from the votes.
- **`purpose` is `explore` or `benchmark`.** A benchmark run must meet all four of these:
  - `PROTOCOL.md` is committed and unmodified.
  - No uncommitted change touches `backend/eval/parser_bench/`, `PROTOCOL.md` or `pages.json`.
  - The warm-up is on.
  - The run scores exactly the page set's pages of that PDF.
- **Footer band rule** (unchanged): a line is at the edge when its vertical centre lies in the outer **15%**. A boilerplate line appears on at least **50%** of pages, and on at least 2.
- **One timed run at a time** on this Mac. The lock is `<data>/timed-run.lock`, shared by the command line and the webpage.
- **The server** listens on `127.0.0.1` only. It accepts the Host `127.0.0.1` or `localhost`. Any request that changes something needs the header `X-Parser-Bench: 1`. There is no login and no Supabase.
- **Blinding.** While a benchmark comparison is being judged, nothing shows a method's name next to an output of a benchmark-set page: not Runs, Compare, the Scoreboard or My votes. This applies to implementers too:
  - **never vote and never unlock.** The votes are Abi's.
  - Never put per-method check numbers or output text of benchmark pages into a report or message.
- **Production is never touched.** No network calls, except `uv` during an install.
- **Commit messages end with:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## File Structure

```
backend/eval/parser_bench/
  checks.py        MODIFY  checks v3: footer parts covered by the output's footer lines together,
                           footer_token_share, list item on either side ends a break, footer_line_numbers()
  store.py         MODIFY  main-checkout guard, typed_check(), record_version()/checks_version(),
                           export refuses a comparison still judging
  tools.py         MODIFY  bounded version probes (ENV_TIMEOUT), Tool.ocr, Tesseract version
  execute.py       MODIFY  benchmark integrity, on_stage, cancel, the one-timed-run slot
  __main__.py      MODIFY  + select show|draw, compare create|status, serve
  pageset.py       CREATE  the frozen page set (pages.json): load, validate, draw, describe
  schedule.py      CREATE  round 1 + hidden repeats, the round-2 stopping rule
  ranking.py       CREATE  Bradley–Terry by MM with a weak prior, bootstrap intervals, points
  compare.py       CREATE  CompareRun: compare.json, votes.jsonl (vote, undo), outputs; create_benchmark()
  results.py       CREATE  results.json from the votes; advance() applies the stopping rule
  files.py         CREATE  uploads by SHA-256, resolve a PDF by hash, cached page PNGs
  blinding.py      CREATE  which pages are locked; early unlock written to the lab log
  jobs.py          CREATE  JobQueue: journalled background runs and installs, one at a time, cancel
  server.py        CREATE  create_app(): FastAPI on 127.0.0.1, safety middleware, static viewer
  api_runs.py      CREATE  runs, run detail, page output with footer lines, diff, PNGs, sources, outputs
  api_compare.py   CREATE  comparisons, next duel, vote, undo, results, my votes, unlock
  api_newrun.py    CREATE  methods, files (upload), jobs, cancel, install
  viewer/          CREATE  own Vite build; dist/ is git-ignored
    vite.config.ts  tailwind.config.ts  tsconfig.json  index.html
    src/main.tsx  src/App.tsx  src/api.ts  src/lib.ts  src/lib.test.ts  src/styles.css
    src/components/Output.tsx  CheckChips.tsx  Zoom.tsx
    src/screens/Judge.tsx  MyVotes.tsx  Scoreboard.tsx  Compare.tsx  Runs.tsx  NewRun.tsx
backend/tests/unit/
  test_parser_bench_checks.py    MODIFY   test_parser_bench_store.py   MODIFY
  test_parser_bench_tools.py     MODIFY   test_parser_bench_execute.py MODIFY
  test_parser_bench_cli.py       MODIFY
  parser_bench_compare_fixtures.py  CREATE  a small comparison on disk (not a test module)
  test_parser_bench_pageset.py  test_parser_bench_schedule.py  test_parser_bench_ranking.py
  test_parser_bench_compare.py  test_parser_bench_results.py  test_parser_bench_files.py
  test_parser_bench_jobs.py     test_parser_bench_server.py                    CREATE
docs/superpowers/specs/2026-10-30-parser-benchmark-design.md   MODIFY  checks v3 wording, repeat and prior rules, code layout
docs/thesis/experiments/parser-benchmark/
  pages.json    CREATE (Task 16)  the 24 pages: key, file, sha256, page, type, how, reason
  PROTOCOL.md   CREATE (Task 16)
  LAB_LOG.md    MODIFY (Tasks 16–17)
eslint.config.js   MODIFY  ignore the viewer's build output
.claude/launch.json  (git-ignored, local only) + a "parser-bench" entry
```

---

### Task 1: Checks version 3: footer parts across split lines, the footer token share, list items

**Files:**
- Modify: `backend/eval/parser_bench/checks.py`
- Modify: `backend/tests/unit/test_parser_bench_checks.py`
- Modify: `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md` (checks 1 and 4, code layout)

**Interfaces:**
- Consumes: `checks.footer_tokens`, `footer_parts`, `is_footer_line(line, pf, doc)` (Plan 1).
- Produces:
  - `checks.CHECKS_VERSION == 3`.
  - `checks.CHECK_FIELDS` with `"footer_token_share"` right after `"footer_leaked"`.
  - `checks.footer_line_numbers(text: str, pf: PageFacts, doc: DocFacts) -> list[int]`, the 0-based output lines the footer rule removes, used by the viewer to mark junk.
  - `check_page(...)["footer_leaks"]` counts the parts whose tokens all appear in the union of the output's footer lines.
  - `check_page(...)["footer_token_share"]` is a float rounded to 3 places, or `None` when the page has no footer parts.
  - A break next to a list item on either side is not counted as a line break.

This is Plan 3 input #1, done now because `PROTOCOL.md` freezes the checks at the end of this plan. In v2 a part had to sit whole in one output line, so a tool that split a three-word footer across two lines scored 0 leaks.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_parser_bench_checks.py`, replace

```python
    assert checks.CHECKS_VERSION == 2
```

with

```python
    assert checks.CHECKS_VERSION == 3
```

and replace

```python
    assert f[f.index("footer_leaks") + 1] == "footer_leaked"
```

with

```python
    assert f[f.index("footer_leaks") + 1: f.index("footer_leaks") + 3] == ("footer_leaked", "footer_token_share")
```

Then append to the end of the file:

```python
# --- checks v3: a footer part split across lines still leaks ------------------------


def multi_token_footer():
    """One edge line holds a three-word footer, as real decks often print it."""
    foot = "Software Engineering Lecturer"
    lines = [
        checks.Line("Welcome", 28.0, 100.0, 130.0),
        checks.Line("body text here", 14.0, 200.0, 214.0),
        checks.Line(foot, 9.0, 520.0, 530.0),
    ]
    pf = checks.PageFacts(1, 595.0, lines, 14.0)
    doc = checks.DocFacts({1: pf}, frozenset({checks.norm_line(foot)}), frozenset({"software", "engineering", "lecturer"}))
    return pf, doc


def test_a_footer_part_split_across_two_lines_still_leaks():
    pf, doc = multi_token_footer()
    r = checks.check_page("Welcome\nSoftware Engineering\nLecturer\n", pf, doc)
    assert (r["footer_leaks"], r["footer_leaked"], r["footer_token_share"]) == (1, True, 1.0)  # v2 counted 0


def test_a_footer_cut_short_shows_in_the_token_share():
    pf, doc = multi_token_footer()
    r = checks.check_page("Welcome\nSoftware Engineering\n", pf, doc)
    assert (r["footer_leaks"], r["footer_leaked"], r["footer_token_share"]) == (0, False, 0.667)


@pytest.mark.parametrize(("text", "share"), [
    ("Lecturer\nSoftwaretechnik\n3", 1.0),
    ("Lecturer Softwaretechnik", 0.667),
    (f"# {TITLES[2]}\nbody", 0.0),
])
def test_the_footer_token_share_on_the_deck(facts, text, share):
    assert check(text, facts)["footer_token_share"] == share


def test_a_page_without_footer_parts_has_no_token_share():
    lines = [checks.Line("Welcome", 28.0, 100.0, 130.0)]
    pf = checks.PageFacts(1, 595.0, lines, 14.0)
    doc = checks.DocFacts({1: pf}, frozenset(), frozenset())
    assert checks.check_page("Welcome", pf, doc)["footer_token_share"] is None


def test_a_list_item_after_running_text_is_not_a_line_break(facts):
    r = check("The steps are\n- commit your work", facts)
    assert (r["line_breaks"], r["broken_lines"], r["broken_line_pct"]) == (0, 0, None)


def test_footer_line_numbers_name_the_lines_the_viewer_marks(facts):
    text = f"# {TITLES[2]}\nbody line\nLecturer Softwaretechnik 3\n3"
    assert checks.footer_line_numbers(text, facts.pages[3], facts) == [2, 3]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_checks.py -q`
Expected: FAIL. You should see `assert 2 == 3`, `KeyError: 'footer_token_share'`, `AttributeError: ... no attribute 'footer_line_numbers'`, and the list-item test reporting `(1, 0, 0.0)`.

- [ ] **Step 3: Change `checks.py`**

Make these four replacements in `backend/eval/parser_bench/checks.py`.

(a) The version and the field list:

```python
CHECKS_VERSION = 2   # bumped whenever a check's definition changes; recorded in every run.json
```
becomes
```python
CHECKS_VERSION = 3   # bumped whenever a check's definition changes; recorded in every run.json
```
and
```python
    "page", "footer_leaks", "footer_leaked", "title_first", "wrong_symbols", "lonely_bullets",
```
becomes
```python
    "page", "footer_leaks", "footer_leaked", "footer_token_share", "title_first", "wrong_symbols", "lonely_bullets",
```

(b) Insert this function directly above `def _is_footer_part(`:

```python
def footer_line_numbers(text: str, pf: PageFacts, doc: DocFacts) -> list[int]:
    """0-based numbers of the output lines the footer rule removes; the viewer marks them as junk."""
    return [i for i, line in enumerate(text.splitlines()) if is_footer_line(line, pf, doc)]


```

(c) In `check_page`, replace

```python
    # A leak is a part of this page's footer found whole in some output footer line, so the
    # score is the same whether a tool prints the footer on three lines or joins it on one.
    out_footers = [footer_tokens(l) for l, f in zip(content, footer) if f]
    leaks = sum(1 for part in footer_parts(pf, doc) if any(part <= o for o in out_footers))
```

with

```python
    # A part leaks when the output's footer lines, taken together, hold every one of its words and
    # numbers: the score is the same whether a tool prints the footer on three lines, joins it on
    # one, or splits one part across two (v3). The token share shows a footer cut short.
    out_footer = frozenset().union(*(footer_tokens(l) for l, f in zip(content, footer) if f))
    parts = footer_parts(pf, doc)
    leaks = sum(1 for part in parts if part <= out_footer)
    part_tokens = frozenset().union(*parts)
    token_share = round(len(part_tokens & out_footer) / len(part_tokens), 3) if part_tokens else None
```

and in the line-break loop replace

```python
        if _HEADING.match(a) or _ITEM.match(a) or _HEADING.match(b) or a.lstrip().startswith("|") or b.lstrip().startswith("|"):
```

with

```python
        if _HEADING.match(a) or _HEADING.match(b) or _ITEM.match(a) or _ITEM.match(b) or a.lstrip().startswith("|") or b.lstrip().startswith("|"):
```

(d) In the returned tuple, replace

```python
        leaks,
        leaks > 0,
        title_first,
```

with

```python
        leaks,
        leaks > 0,
        token_share,
        title_first,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_checks.py -q`
Expected: `43 passed`. On a machine without the real decks in `~/Downloads`, the deck tests are skipped instead.

- [ ] **Step 5: Bring the spec in line with the code**

In `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md`, section "Automatic checks", check 1, replace the bullet that starts `   - **`footer_leaks`.** This is how many of the page's footer parts appear whole` (the whole bullet) with:

```markdown
   - **Footer lines in the output.** An output line is a *footer line* when the same footer rule would remove it from the reference: it is the printed number, a boilerplate line, or made only of boilerplate words and the printed number.
   - **`footer_leaks`.** This is how many of the page's footer parts are covered by the output's footer lines taken together: a part leaks when every one of its words and numbers appears in some footer line. The score is the same whether a tool prints the footer on three lines, joins it into one, or splits one part across two lines (checks version 3; version 2 needed a part whole in one line and missed split parts; version 1 counted output lines, which rewarded joining).
   - **`footer_token_share`.** This is the share of the page's footer words and numbers found in the output's footer lines, so a footer cut short still shows. It is null on a page without footer parts.
```

In check 4, replace

```markdown
   - **Excluded:** headings, list markers, table rows, `[figure]` lines and footer-like lines.
```

with

```markdown
   - **Excluded:** breaks next to a heading, a list item or a table row (on either side), a `[figure]` line or a footer line.
```

In "Where the code lives", replace the `backend/eval/parser_bench/` block (from `backend/eval/parser_bench/` down to `  viewer/       React page (Duel, Scoreboard, Compare, Runs)`) with:

```
backend/eval/parser_bench/
  sources.py    source decks, hashes, page images, seeded selection
  pageset.py    the frozen page set (pages.json)
  runners/      one module per tool, run inside that tool's own environment
  checks.py     automatic checks
  schedule.py   duel schedule, hidden repeats, round-2 rule
  ranking.py    Bradley–Terry + bootstrap
  compare.py    comparison runs and the vote log
  results.py    results.json from the votes, the stopping rule
  store.py      run IDs, folders, immutability, export
  files.py      uploads by SHA-256, page images
  blinding.py   the blinding lock
  jobs.py       background runs for the webpage
  server.py     local API for the viewer (api_runs.py, api_compare.py, api_newrun.py)
  __main__.py   python -m backend.eval.parser_bench <tools|install|run|runs|export|select|compare|serve>
  viewer/       React page (New run, Judge, Compare, Scoreboard, Runs)
```

- [ ] **Step 6: Commit**

```bash
git add backend/eval/parser_bench/checks.py backend/tests/unit/test_parser_bench_checks.py docs/superpowers/specs/2026-10-30-parser-benchmark-design.md
git commit -m "feat(parser-bench): checks v3 — footer parts across split lines, footer token share, list items end no break

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Store: the main-checkout guard, typed checks, old records, judging comparisons

**Files:**
- Modify: `backend/eval/parser_bench/store.py`
- Modify: `backend/tests/unit/test_parser_bench_store.py`

**Interfaces:**
- Consumes: `store.REPO`, `store.ExtractRun`.
- Produces:
  - `store._main_checkout() -> Path | None`, cached. It returns the parent of `git rev-parse --git-common-dir`.
  - `store.data_root()` now also refuses the main checkout.
  - `store.typed_check(row: Mapping[str, str]) -> dict[str, Any]`.
  - `ExtractRun.typed_checks() -> list[dict[str, Any]]`.
  - `store.record_version(meta) -> int`: a missing value means 0.
  - `store.checks_version(meta) -> int`: a missing value means 1.
  - `export_run` refuses a record whose status is `running` or `judging`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_parser_bench_store.py`:

```python
# --- Plan 2: the main checkout, typed checks, old records, judging comparisons ---------


def test_the_data_root_may_not_lie_inside_the_main_checkout(tmp_path, monkeypatch):
    main = tmp_path / "main"
    monkeypatch.setattr(store, "_main_checkout", lambda: main)
    monkeypatch.setenv("PARSER_BENCH_DIR", str(main / "bench-data"))
    with pytest.raises(ValueError, match="inside the repository"):
        store.data_root()
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "elsewhere"))
    assert store.data_root() == (tmp_path / "elsewhere").resolve()


def test_the_main_checkout_is_found_from_git():
    main = store._main_checkout()
    assert main is not None and (main / ".git").exists()


def test_typed_checks_give_back_numbers_flags_and_nulls(tmp_path):
    run = make(tmp_path)
    run.write_checks([{"page": 2, "footer_leaks": 1, "footer_leaked": True, "footer_token_share": 0.5,
                       "title_first": None, "broken_line_pct": None, "chars": 10, "note": "x"}])
    assert run.typed_checks() == [{"page": 2, "footer_leaks": 1, "footer_leaked": True, "footer_token_share": 0.5,
                                   "title_first": None, "broken_line_pct": None, "chars": 10, "note": "x"}]


def test_old_records_read_as_record_version_0_and_checks_version_1():
    assert (store.record_version({}), store.checks_version({})) == (0, 1)
    assert (store.record_version({"record_version": 1}), store.checks_version({"checks_version": 3})) == (1, 3)


def test_export_refuses_a_comparison_still_being_judged(tmp_path):
    folder = tmp_path / "runs" / "compare" / "cmp-2026-10-30_abcd"
    folder.mkdir(parents=True)
    (folder / "compare.json").write_text(json.dumps({"run_id": folder.name, "status": "judging", "purpose": "benchmark"}))
    with pytest.raises(ValueError, match="judging"):
        store.export_run(folder.name, root=tmp_path, dest=tmp_path / "export")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_store.py -q`
Expected: 5 failures (`_main_checkout`, `typed_checks`, `record_version` missing; the judging comparison is exported).

- [ ] **Step 3: Change `store.py`**

Add `import functools` after `import csv`. Replace the whole `data_root` function with:

```python
@functools.lru_cache(maxsize=1)
def _main_checkout() -> Path | None:
    """The main checkout when this code runs from a git worktree: the folder holding the shared .git."""
    try:
        out = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--git-common-dir"],
                             capture_output=True, text=True, timeout=10, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    if not out:
        return None
    common = Path(out)
    return (common if common.is_absolute() else REPO / common).resolve().parent


def _guarded() -> list[Path]:
    """Folders the data may never live in: this checkout, and the main checkout it was made from."""
    main = _main_checkout()
    return [REPO] + ([main] if main is not None and main != REPO else [])


def data_root() -> Path:
    """Where runs live. Never inside a checkout of the repository: slide text must not reach the public repo."""
    root = Path(os.environ.get("PARSER_BENCH_DIR") or Path.home() / "Documents" / "learnstation-parser-bench")
    root = root.expanduser().resolve()
    for repo in _guarded():
        if root.is_relative_to(repo):
            raise ValueError(f"PARSER_BENCH_DIR {root} is inside the repository {repo}; slide text must stay out of git")
    return root


# checks.csv holds text; these are the types its columns were written from (checks.CHECK_FIELDS).
_INT_FIELDS = frozenset({
    "page", "footer_leaks", "wrong_symbols", "lonely_bullets", "line_breaks", "broken_lines",
    "headings", "list_items", "max_depth", "tables", "math_spans", "chars",
})
_FLOAT_FIELDS = frozenset({"footer_token_share", "broken_line_pct", "dropped_words_pct", "invented_words_pct"})
_BOOL_FIELDS = frozenset({"footer_leaked", "title_first"})


def typed_check(row: Mapping[str, str]) -> dict[str, Any]:
    """One checks.csv row with its numbers, flags and nulls back (csv writes None as an empty cell).
    Unknown columns stay text; columns an older checks version did not write stay absent."""
    out: dict[str, Any] = {}
    for key, raw in row.items():
        if raw is None or raw == "":
            out[key] = None
        elif key in _BOOL_FIELDS:
            out[key] = {"True": True, "False": False}.get(raw)
        elif key in _INT_FIELDS:
            out[key] = int(raw)
        elif key in _FLOAT_FIELDS:
            out[key] = float(raw)
        else:
            out[key] = raw
    return out


def record_version(meta: Mapping[str, Any]) -> int:
    """Records written before run.json carried a version are version 0."""
    return int(meta.get("record_version") or 0)


def checks_version(meta: Mapping[str, Any]) -> int:
    """Runs scored before run.json named the checks version were scored by checks version 1."""
    value = meta.get("checks_version")
    return 1 if value is None else int(value)
```

In `class ExtractRun`, directly after the `checks()` method, add:

```python

    def typed_checks(self) -> list[dict[str, Any]]:
        return [typed_check(row) for row in self.checks()]
```

In `export_run`, replace

```python
    if meta.get("status") == "running":
        raise ValueError(f"{run_id} is still running")
```

with

```python
    if meta.get("status") in ("running", "judging"):
        raise ValueError(f"{run_id} is still {meta['status']}")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_store.py -q`
Expected: `57 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/store.py backend/tests/unit/test_parser_bench_store.py
git commit -m "feat(parser-bench): store refuses the main checkout, reads checks typed, old records as v0/checks v1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The benchmark page set (`pageset.py`) and `select`

**Files:**
- Create: `backend/eval/parser_bench/pageset.py`
- Create: `backend/tests/unit/test_parser_bench_pageset.py`
- Modify: `backend/eval/parser_bench/__main__.py`
- Modify: `backend/tests/unit/test_parser_bench_cli.py`

**Interfaces:**
- Consumes: `sources.BENCHMARK_SOURCES`, `candidates_of`, `select_pages`, `sha256_file`; `checks.document_facts`, `title_of`; `decks.DECK_DIR`.
- Produces:
  - `pageset.PAGESET` (`docs/thesis/experiments/parser-benchmark/pages.json`).
  - `pageset.PAGE_TYPES = ("layout", "lists", "table_formula", "diagram", "dense_text")`.
  - `pageset.CHOSEN, pageset.RANDOM = 4, 2`.
  - `@dataclass(frozen=True) BenchPage(key, source, file, sha256, page, type, how, reason)`.
  - `validate(pages) -> list[str]`, `load(path=PAGESET) -> list[BenchPage]` (raises on any problem) and `load_or_empty(path=PAGESET) -> list[BenchPage]`.
  - `seed_of(path=PAGESET) -> int` and `pages_for(sha256, pages) -> list[int]`.
  - `draw(chosen: Mapping[str, Sequence[Mapping]], seed: int, deck_dir=DECK_DIR) -> dict`. Drawn pages carry `type: None` until tagged.
  - `write(data, path=PAGESET) -> Path`, `as_entry(page) -> dict` (no reason) and `describe(pdf) -> list[dict]`.
  - CLI: `select show <source>` and `select draw <chosen.json> --seed N [--out path]`.
- Page keys: `swt-p12`. A source with several files numbers them: `sheets1-p3`, `sheets2-p4`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_parser_bench_pageset.py`:

```python
import json

import pytest

from backend.eval.parser_bench import pageset, sources
from backend.tests.unit.parser_bench_fixtures import TITLES, make_deck

TYPES = pageset.PAGE_TYPES


@pytest.fixture
def decks(tmp_path):
    """Every benchmark source file, as a synthetic deck at its real relative path."""
    for source in sources.BENCHMARK_SOURCES:
        for path in source.paths(tmp_path):
            path.parent.mkdir(parents=True, exist_ok=True)
            make_deck(path, n=8)
    return tmp_path


def chosen_for_all():
    return {
        s.id: [{"file": s.files[0], "page": n, "type": TYPES[n % len(TYPES)], "reason": f"structure {n}"} for n in (1, 2, 3, 4)]
        for s in sources.BENCHMARK_SOURCES
    }


def tagged(data):
    for p in data["pages"]:
        p["type"] = p["type"] or "dense_text"
    return data


def test_draw_keeps_the_chosen_pages_and_draws_two_more_per_source(decks):
    data = pageset.draw(chosen_for_all(), seed=7, deck_dir=decks)
    assert data["seed"] == 7 and len(data["pages"]) == 24
    swt = [p for p in data["pages"] if p["source"] == "swt"]
    assert [p["page"] for p in swt[:4]] == [1, 2, 3, 4] and all(p["how"] == "chosen" for p in swt[:4])
    assert [p["how"] for p in swt[4:]] == ["random", "random"] and all(p["type"] is None for p in swt[4:])
    assert {p["key"] for p in swt[:1]} == {"swt-p1"}
    assert {p["key"][:7] for p in data["pages"] if p["source"] == "sheets"} <= {"sheets1", "sheets2"}
    assert all(len(p["sha256"]) == 64 for p in data["pages"])


def test_draw_is_reproducible_and_the_seed_matters(decks):
    def drawn(seed):
        return [(p["file"], p["page"]) for p in pageset.draw(chosen_for_all(), seed=seed, deck_dir=decks)["pages"] if p["how"] == "random"]

    assert drawn(7) == drawn(7)
    assert any(drawn(7) != drawn(s) for s in range(8, 20))


def test_draw_refuses_the_wrong_number_of_chosen_pages_and_untyped_ones(decks):
    picks = chosen_for_all()
    picks["dbs"] = picks["dbs"][:3]
    with pytest.raises(ValueError, match="dbs: 3 chosen"):
        pageset.draw(picks, seed=1, deck_dir=decks)
    picks = chosen_for_all()
    picks["sr"][0]["type"] = "slides"
    with pytest.raises(ValueError, match="type 'slides'"):
        pageset.draw(picks, seed=1, deck_dir=decks)


def test_load_refuses_untagged_drawn_pages_then_accepts_them_tagged(decks, tmp_path):
    data = pageset.draw(chosen_for_all(), seed=7, deck_dir=decks)
    path = pageset.write(data, tmp_path / "pages.json")
    with pytest.raises(ValueError, match="page type None"):
        pageset.load(path)
    pageset.write(tagged(data), path)
    pages = pageset.load(path)
    assert len(pages) == 24 and pageset.seed_of(path) == 7
    sha = pages[0].sha256
    assert pageset.pages_for(sha, pages) == sorted(p.page for p in pages if p.sha256 == sha)
    assert pageset.pages_for("0" * 64, pages) == []
    assert "reason" not in pageset.as_entry(pages[0])


def test_load_or_empty_before_the_protocol_step(tmp_path):
    assert pageset.load_or_empty(tmp_path / "missing.json") == []


def test_validate_names_every_problem(decks, tmp_path):
    data = tagged(pageset.draw(chosen_for_all(), seed=7, deck_dir=decks))
    data["pages"][0]["reason"] = " "
    data["pages"][1]["key"] = data["pages"][2]["key"]
    problems = pageset.validate([pageset.BenchPage(**p) for p in data["pages"]])
    assert any("needs its reason" in p for p in problems) and any("appears twice" in p for p in problems)


def test_describe_lists_every_page_with_its_title(tmp_path):
    rows = pageset.describe(make_deck(tmp_path / "deck.pdf"))
    assert [r["title"] for r in rows] == list(TITLES)
    assert set(rows[0]) == {"page", "title", "lines", "words", "images", "drawings", "symbol_font"}
```

Append to `backend/tests/unit/test_parser_bench_cli.py`:

```python


# --- Plan 2: select ------------------------------------------------------------------

from backend.eval.parser_bench import pageset, sources  # noqa: E402


def test_select_show_prints_each_page_title(tmp_path, monkeypatch, capsys):
    swt = sources.BENCHMARK_SOURCES[0]
    deck = tmp_path / swt.files[0]
    deck.parent.mkdir(parents=True)
    make_deck(deck)
    monkeypatch.setattr(sources.Source, "paths", lambda self, deck_dir=tmp_path: tuple(deck_dir / f for f in self.files))
    assert cli.main(["select", "show", "swt"]) == 0
    out = capsys.readouterr().out
    assert "(6 pages)" in out and "Merge Conflicts" in out


def test_select_draw_writes_the_page_set(tmp_path, monkeypatch, capsys):
    chosen = tmp_path / "chosen.json"
    chosen.write_text("{}")
    assert cli.main(["select", "draw", str(chosen), "--seed", "1", "--out", str(tmp_path / "p.json")]) == 2
    assert "swt: 0 chosen" in capsys.readouterr().err
    monkeypatch.setattr(pageset, "draw", lambda picks, seed: {"seed": seed, "pages": [{"key": "swt-p9", "file": "2.pdf", "page": 9, "how": "random"}]})
    assert cli.main(["select", "draw", str(chosen), "--seed", "1", "--out", str(tmp_path / "p.json")]) == 0
    assert "drawn: swt-p9" in capsys.readouterr().out and (tmp_path / "p.json").exists()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_pageset.py backend/tests/unit/test_parser_bench_cli.py -q`
Expected: FAIL with `ImportError: cannot import name 'pageset'`.

- [ ] **Step 3: Write `pageset.py`**

`backend/eval/parser_bench/pageset.py`:

```python
"""The frozen benchmark page set (spec "Test set").

Per source, 4 pages chosen on purpose (each with a page type and a written reason) and 2 drawn at
random from the rest with a recorded seed. The set is the file
docs/thesis/experiments/parser-benchmark/pages.json, committed with PROTOCOL.md before any
benchmark run. It holds file names, page numbers, types and reasons: never slide text.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from backend.eval.decks import DECK_DIR
from backend.eval.parser_bench import checks
from backend.eval.parser_bench.sources import BENCHMARK_SOURCES, candidates_of, select_pages, sha256_file
from backend.eval.parser_bench.store import REPO

PAGESET = REPO / "docs" / "thesis" / "experiments" / "parser-benchmark" / "pages.json"
PAGE_TYPES = ("layout", "lists", "table_formula", "diagram", "dense_text")
CHOSEN, RANDOM = 4, 2


@dataclass(frozen=True)
class BenchPage:
    key: str      # "swt-p12", "sheets2-p3": unique, safe in a URL
    source: str   # sources.Source.id
    file: str     # relative to DECK_DIR
    sha256: str
    page: int     # 1-based
    type: str     # one of PAGE_TYPES
    how: str      # "chosen" | "random"
    reason: str


def _key(source_id: str, files: Sequence[str], file: str, page: int) -> str:
    number = "" if len(files) == 1 else str(files.index(file) + 1)
    return f"{source_id}{number}-p{page}"


def validate(pages: Sequence[BenchPage]) -> list[str]:
    """Everything wrong with a page set, in words; empty when it follows the selection rule."""
    problems: list[str] = []
    keys = [p.key for p in pages]
    for key in sorted({k for k in keys if keys.count(k) > 1}):
        problems.append(f"{key} appears twice")
    known = {s.id for s in BENCHMARK_SOURCES}
    for p in pages:
        if p.source not in known:
            problems.append(f"{p.key}: unknown source {p.source!r}")
        if p.type not in PAGE_TYPES:
            problems.append(f"{p.key}: page type {p.type!r} is not one of {', '.join(PAGE_TYPES)}")
        if p.how not in ("chosen", "random"):
            problems.append(f"{p.key}: 'how' must be chosen or random")
        if p.how == "chosen" and not p.reason.strip():
            problems.append(f"{p.key}: a chosen page needs its reason")
    for source in BENCHMARK_SOURCES:
        mine = [p for p in pages if p.source == source.id]
        chosen = sum(p.how == "chosen" for p in mine)
        drawn = sum(p.how == "random" for p in mine)
        if (chosen, drawn) != (CHOSEN, RANDOM):
            problems.append(f"{source.id}: {chosen} chosen and {drawn} random pages, need {CHOSEN} and {RANDOM}")
    return problems


def load(path: Path = PAGESET) -> list[BenchPage]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    pages = [BenchPage(**p) for p in data["pages"]]
    problems = validate(pages)
    if problems:
        raise ValueError("the page set breaks the selection rule: " + "; ".join(problems))
    return pages


def load_or_empty(path: Path = PAGESET) -> list[BenchPage]:
    """The page set, or no pages before the protocol step has written it."""
    return load(path) if Path(path).exists() else []


def seed_of(path: Path = PAGESET) -> int:
    return int(json.loads(Path(path).read_text(encoding="utf-8"))["seed"])


def pages_for(sha256: str, pages: Sequence[BenchPage]) -> list[int]:
    """The benchmark pages of one PDF, by its SHA-256; empty when the file is not in the set."""
    return sorted(p.page for p in pages if p.sha256 == sha256)


def draw(chosen: Mapping[str, Sequence[Mapping[str, Any]]], seed: int, deck_dir: Path = DECK_DIR) -> dict[str, Any]:
    """The pages.json content: per source the 4 chosen pages ({file, page, type, reason}), then 2
    drawn from the rest with `seed`. Drawn pages carry type None until someone looks at them and
    tags them; load() refuses the set until every page has a type."""
    out: list[dict[str, Any]] = []
    for source in BENCHMARK_SOURCES:
        picks = list(chosen.get(source.id, []))
        if len(picks) != CHOSEN:
            raise ValueError(f"{source.id}: {len(picks)} chosen pages, need {CHOSEN}")
        refs = [(str(p["file"]), int(p["page"])) for p in picks]
        if len(set(refs)) != len(refs):
            raise ValueError(f"{source.id}: a chosen page appears twice")
        for p in picks:
            if p["type"] not in PAGE_TYPES:
                raise ValueError(f"{source.id} page {p['page']}: type {p['type']!r} is not one of {', '.join(PAGE_TYPES)}")
            if not str(p.get("reason", "")).strip():
                raise ValueError(f"{source.id} page {p['page']}: a chosen page needs its reason")
        selected = select_pages(candidates_of(source, deck_dir), refs, RANDOM, seed)
        shas = {f: sha256_file(path) for f, path in zip(source.files, source.paths(deck_dir))}
        by_ref = dict(zip(refs, picks))
        for file, page in selected:
            pick = by_ref.get((file, page))
            out.append({
                "key": _key(source.id, source.files, file, page),
                "source": source.id,
                "file": file,
                "sha256": shas[file],
                "page": page,
                "type": pick["type"] if pick else None,
                "how": "chosen" if pick else "random",
                "reason": str(pick["reason"]) if pick else f"random draw, seed {seed}",
            })
    return {"seed": seed, "pages": out}


def write(data: Mapping[str, Any], path: Path = PAGESET) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def as_entry(page: BenchPage) -> dict[str, Any]:
    """A page as a comparison records it (compare.json): everything but the reason."""
    entry = asdict(page)
    entry.pop("reason")
    return entry


def describe(pdf: Path) -> list[dict[str, Any]]:
    """Per page: its title and structure, to help choose pages. Printed locally, never committed."""
    import fitz

    facts = checks.document_facts(pdf)
    rows = []
    with fitz.open(pdf) as doc:
        for number, page in enumerate(doc, start=1):
            pf = facts.pages[number]
            rows.append({
                "page": number,
                "title": checks.title_of(pf) or "",
                "lines": len(pf.lines),
                "words": len(page.get_text("words")),
                "images": len(page.get_images()),
                "drawings": len(page.get_drawings()),
                "symbol_font": bool(pf.symbol_chars),
            })
    return rows
```

- [ ] **Step 4: Add `select` to the command line**

In `backend/eval/parser_bench/__main__.py`:

(a) In the module docstring, replace the first line with `"""python -m backend.eval.parser_bench <tools|install|run|runs|export|select>` and add these lines after the `export <run_id>` line:

```
    select show <source>          each page's title and structure, to choose pages (local only)
    select draw <chosen.json> --seed N [--out pages.json]
                                  keep the chosen pages, draw 2 more per source, write the page set
```

(b) Replace the imports

```python
import argparse
import subprocess
import sys
from pathlib import Path

from backend.eval.parser_bench import execute, store, tools
```

with

```python
import argparse
import json
import subprocess
import sys
from pathlib import Path

from backend.eval.parser_bench import execute, pageset, sources, store, tools
```

(c) After the `export` parser (`p.add_argument("run_id")`), before `args = parser.parse_args(argv)`, add:

```python
    p = sub.add_parser("select", help="choose and freeze the benchmark page set")
    select = p.add_subparsers(dest="action", required=True)
    s = select.add_parser("show", help="each page's title and structure (printed here, never committed)")
    s.add_argument("source", choices=[src.id for src in sources.BENCHMARK_SOURCES])
    s = select.add_parser("draw", help="keep the chosen pages and draw 2 more per source")
    s.add_argument("chosen", type=Path, help="JSON: {source id: [{file, page, type, reason}, ×4]}")
    s.add_argument("--seed", type=int, required=True)
    s.add_argument("--out", type=Path, default=pageset.PAGESET)
```

(d) Replace the last `    return 2` of `main` (after the `export` branch) with:

```python
    if args.cmd == "select":
        return _select(args)
    return 2
```

(e) Add this function after `main` and before `if __name__ == "__main__":`:

```python
def _select(args: argparse.Namespace) -> int:
    if args.action == "show":
        source = next(s for s in sources.BENCHMARK_SOURCES if s.id == args.source)
        for name, path in zip(source.files, source.paths()):
            if not path.exists():
                print(f"{path} is missing", file=sys.stderr)
                return 2
            print(f"# {name}  ({sources.page_count(path)} pages)")
            print(f"{'page':>4}  {'lines':>5} {'words':>5} {'img':>3} {'draw':>4} sym  title")
            for row in pageset.describe(path):
                print(f"{row['page']:>4}  {row['lines']:>5} {row['words']:>5} {row['images']:>3} {row['drawings']:>4} "
                      f"{'yes' if row['symbol_font'] else '   '}  {row['title'][:60]}")
        return 0
    try:
        chosen = json.loads(args.chosen.read_text(encoding="utf-8"))
        data = pageset.draw(chosen, args.seed)
    except (OSError, ValueError, KeyError) as e:
        print(e, file=sys.stderr)
        return 2
    print(pageset.write(data, args.out))
    for page in data["pages"]:
        if page["how"] == "random":
            print(f"drawn: {page['key']}  ({page['file']} page {page['page']}): tag its type in the file")
    return 0
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_pageset.py backend/tests/unit/test_parser_bench_cli.py -q`
Expected: `22 passed` (7 + 15)

- [ ] **Step 6: Commit**

```bash
git add backend/eval/parser_bench/pageset.py backend/eval/parser_bench/__main__.py backend/tests/unit/test_parser_bench_pageset.py backend/tests/unit/test_parser_bench_cli.py
git commit -m "feat(parser-bench): the frozen benchmark page set and select show|draw

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Benchmark integrity, stages, cancel and the one-timed-run slot

**Files:**
- Modify: `backend/eval/parser_bench/tools.py` (full file below)
- Modify: `backend/eval/parser_bench/execute.py` (full file below)
- Modify: `backend/tests/unit/test_parser_bench_tools.py`
- Modify: `backend/tests/unit/test_parser_bench_execute.py`

**Interfaces:**
- Consumes: `pageset.pages_for`, `pageset.load_or_empty`; everything `execute` used before.
- Produces:
  - `tools.ENV_TIMEOUT = 60`. Every subprocess in `environment()` and `_freeze()` is bounded by it.
  - `Tool.ocr: bool`, with `pymupdf4llm` set to `ocr=True`. For an OCR-capable tool, `environment(tool)` ends with `tesseract <version>` or `tesseract: not installed`.
  - `execute.BENCH_TRACKED`.
  - `execute.bench_changes() -> list[str]`, the `git status --porcelain` lines for the tracked paths.
  - `execute.benchmark_pages(sha256) -> list[int]`.
  - `execute.SlotBusy` and `execute.Cancelled`, both `RuntimeError`.
  - `execute.timed_slot(root, *, wait=False, cancel=None, on_wait=None)`, a context manager.
  - `execute.invoke(tool, pdf, *, timeout=..., cancel: threading.Event | None = None)`. When cancelled it raises `RunnerError("<tool> was cancelled")`.
  - `execute.run_tool(..., on_stage: Callable[[str], None] | None = None, cancel: threading.Event | None = None, wait_for_slot: bool = False)`. The stages are `"waiting"`, `"warmup"`, `"timed"` and `"scoring"`.
- A benchmark run is refused in each of these cases:
  - without a protocol commit;
  - with bench changes;
  - with `warmup=False`;
  - for a file outside the page set;
  - with `pages` other than the page set's.

  With `pages=None` it scores the page set's pages of that file.

These are the parked Plan 3 items that bind benchmark runs, which this plan makes. The full files are given because the changes run through both modules.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_parser_bench_tools.py`:

```python
# --- Plan 2: bounded version probes, Tesseract for OCR-capable methods ---------------


def test_every_version_probe_of_an_environment_is_bounded(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    calls = []
    _fake_uv(monkeypatch, calls=calls)
    monkeypatch.setattr(tools.shutil, "which", lambda name: f"/bin/{name}")
    for tool_id in ("pdfjs", "pymupdf4llm", "opendataloader"):
        tools.environment(tools.TOOLS[tool_id])
    assert calls and all(kwargs.get("timeout") == tools.ENV_TIMEOUT == 60 for _, kwargs in calls)


def test_ocr_capable_methods_record_the_tesseract_version(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path))
    _fake_uv(monkeypatch)
    real_run = tools.subprocess.run

    def run(args, **kwargs):
        if args[-1] == "--version" and args[0].endswith("tesseract"):
            return subprocess.CompletedProcess(args, 0, "tesseract 5.5.2\n leptonica-1.85.0\n", "")
        return real_run(args, **kwargs)

    monkeypatch.setattr(tools.subprocess, "run", run)
    monkeypatch.setattr(tools.shutil, "which", lambda name: "/opt/homebrew/bin/tesseract" if name == "tesseract" else None)
    assert tools.TOOLS["pymupdf4llm"].ocr and not tools.TOOLS["markitdown"].ocr
    assert tools.environment(tools.TOOLS["pymupdf4llm"])[-1] == "tesseract 5.5.2"
    monkeypatch.setattr(tools.shutil, "which", lambda name: None)
    assert tools.environment(tools.TOOLS["pymupdf4llm"])[-1] == "tesseract: not installed"
```

In `backend/tests/unit/test_parser_bench_execute.py`, add `import threading` between the first two imports, so the file starts:

```python
import subprocess
import threading
import time
```

Replace the whole test `test_benchmark_runs_need_a_committed_protocol` with:

```python
@pytest.fixture
def bench_ready(monkeypatch):
    """A committed protocol, a clean bench, and pages 2 and 5 of any file in the page set."""
    monkeypatch.setattr(execute, "protocol_commit", lambda: "abc123")
    monkeypatch.setattr(execute, "bench_changes", lambda: [])
    monkeypatch.setattr(execute, "benchmark_pages", lambda sha: [2, 5])


def test_benchmark_runs_need_a_committed_protocol(tmp_path, deck, monkeypatch, bench_ready):
    reg = registry(tmp_path, "fake", FAKE_OK)
    monkeypatch.setattr(execute, "protocol_commit", lambda: None)
    with pytest.raises(RuntimeError, match="PROTOCOL.md"):
        execute.run_tool("fake", deck, purpose="benchmark", root=tmp_path / "data", registry=reg)
    monkeypatch.setattr(execute, "protocol_commit", lambda: "abc123")
    run = execute.run_tool("fake", deck, purpose="benchmark", root=tmp_path / "data", registry=reg)
    assert (run.meta["purpose"], run.meta["protocol_commit"], run.meta["pages_scored"]) == ("benchmark", "abc123", [2, 5])
```

and append to the end of the file:

```python
# --- Plan 2: benchmark integrity, stages, cancel, one timed run at a time --------------


def test_a_benchmark_run_always_warms_up(tmp_path, deck, bench_ready):
    with pytest.raises(ValueError, match="warm up"):
        execute.run_tool("fake", deck, purpose="benchmark", warmup=False, root=tmp_path / "data",
                         registry=registry(tmp_path, "fake", FAKE_OK))


def test_a_benchmark_run_refuses_uncommitted_bench_code(tmp_path, deck, monkeypatch, bench_ready):
    monkeypatch.setattr(execute, "bench_changes", lambda: [" M backend/eval/parser_bench/checks.py"])
    with pytest.raises(RuntimeError, match="committed first: .*checks.py"):
        execute.run_tool("fake", deck, purpose="benchmark", root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))


def test_a_benchmark_run_scores_exactly_the_page_set(tmp_path, deck, monkeypatch, bench_ready):
    reg = registry(tmp_path, "fake", FAKE_OK)
    with pytest.raises(ValueError, match=r"page set's pages of this file: \[2, 5\]"):
        execute.run_tool("fake", deck, pages=[1, 2], purpose="benchmark", root=tmp_path / "data", registry=reg)
    monkeypatch.setattr(execute, "benchmark_pages", lambda sha: [])
    with pytest.raises(ValueError, match="not in the benchmark page set"):
        execute.run_tool("fake", deck, purpose="benchmark", root=tmp_path / "data", registry=reg)


def test_bench_changes_lists_uncommitted_bench_files(protocol_repo):
    repo, _ = protocol_repo
    code = repo / "backend" / "eval" / "parser_bench" / "x.py"
    code.parent.mkdir(parents=True)
    code.write_text("x = 1\n")
    (repo / "elsewhere.txt").write_text("not the bench\n")
    assert execute.bench_changes() == ["?? backend/eval/parser_bench/"]
    git(repo, "add", "backend")
    git(repo, "commit", "-q", "-m", "bench")
    assert execute.bench_changes() == []


def test_the_stages_are_reported_in_order(tmp_path, deck):
    heard = []
    execute.run_tool("fake", deck, root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK), on_stage=heard.append)
    assert heard == ["warmup", "timed", "scoring"]


def test_a_cancelled_run_is_kept_as_failed(tmp_path, deck):
    cancel = threading.Event()
    threading.Timer(0.5, cancel.set).start()
    started = time.monotonic()
    run = execute.run_tool("slow", deck, warmup=False, root=tmp_path / "data", registry=registry(tmp_path, "slow", FAKE_SLOW),
                           cancel=cancel)
    assert time.monotonic() - started < 10
    m = run.meta
    assert (m["status"], m["reason"], m["failed_stage"]) == ("failed", "slow was cancelled", "timed")


def test_only_one_timed_run_at_a_time(tmp_path, deck):
    root, reg = tmp_path / "data", registry(tmp_path, "fake", FAKE_OK)
    with execute.timed_slot(root):
        with pytest.raises(execute.SlotBusy):
            execute.run_tool("fake", deck, warmup=False, root=root, registry=reg)
        cancel, heard = threading.Event(), []
        threading.Timer(0.3, cancel.set).start()
        with pytest.raises(execute.Cancelled):
            execute.run_tool("fake", deck, warmup=False, root=root, registry=reg, wait_for_slot=True,
                             cancel=cancel, on_stage=heard.append)
        assert heard == ["waiting"]
    assert store.list_runs(root) == []
    assert execute.run_tool("fake", deck, warmup=False, root=root, registry=reg).meta["status"] == "finished"


def test_a_waiting_run_starts_when_the_slot_frees(tmp_path, deck):
    root, reg = tmp_path / "data", registry(tmp_path, "fake", FAKE_OK)
    held = threading.Event()
    release = threading.Event()

    def hold():
        with execute.timed_slot(root):
            held.set()
            release.wait(5)

    holder = threading.Thread(target=hold)
    holder.start()
    held.wait(5)
    threading.Timer(0.6, release.set).start()
    run = execute.run_tool("fake", deck, warmup=False, root=root, registry=reg, wait_for_slot=True)
    holder.join(5)
    assert run.meta["status"] == "finished"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_tools.py backend/tests/unit/test_parser_bench_execute.py -q`
Expected: FAIL. You should see `AttributeError: ... has no attribute 'ENV_TIMEOUT'` / `'ocr'` / `'bench_changes'` / `'timed_slot'`, and `TypeError: run_tool() got an unexpected keyword argument 'on_stage'`.

- [ ] **Step 3: Replace `tools.py`**

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
IMPORT_TIMEOUT = 300  # seconds the post-install import may take (a first import compiles bytecode)
INSTALL_TIMEOUT = 1800  # seconds `uv venv` and `uv pip install` may each take
ENV_TIMEOUT = 60  # seconds each version probe in environment() may take
INSTALLED_MARKER = ".ls-installed"  # written last by install(); its presence means the install finished


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
    import_name: str | None = None       # module install() must be able to import before the env counts as installed
    ocr: bool = False                    # may call Tesseract by default; its version is recorded with every run

    @property
    def runner_path(self) -> Path:
        p = Path(self.runner)
        return p if p.is_absolute() else RUNNERS / p


TOOLS: dict[str, Tool] = {t.id: t for t in (
    Tool("current", "Our pipeline (PyMuPDF)", "fast", "current_runner.py",
         "exactly what production stores today"),
    Tool("pymupdf4llm", "pymupdf4llm", "fast", "pymupdf4llm_runner.py",
         "Markdown mode of the same library", requirements=("pymupdf4llm==1.28.2",), size_mb=230, import_name="pymupdf4llm",
         ocr=True),
    Tool("pdfjs", "PDF.js", "fast", "pdfjs_runner.mjs",
         "the browser's text layer", kind="node", needs=("node",)),
    Tool("markitdown", "MarkItDown", "fast", "markitdown_runner.py",
         "Microsoft's converter, page by page", requirements=("markitdown[pdf]==0.1.6", "pypdf"), size_mb=190, import_name="markitdown"),
    Tool("opendataloader", "OpenDataLoader", "fast", "opendataloader_runner.py",
         "layout-aware, uses Java", requirements=("opendataloader-pdf==2.4.1",), needs=("java",), size_mb=30,
         import_name="opendataloader_pdf"),
)}


def envs_root() -> Path:
    root = Path(os.environ.get("PARSER_BENCH_ENVS") or Path.home() / ".cache" / "learnstation-parser-bench" / "envs")
    return root.expanduser().resolve()


def env_python(tool: Tool) -> Path:
    return envs_root() / tool.id / "bin" / "python"


def marker(tool: Tool) -> Path:
    return envs_root() / tool.id / INSTALLED_MARKER


def pdfjs_package() -> Path:
    return REPO / "node_modules" / "pdfjs-dist" / "package.json"


def missing(tool: Tool) -> list[str]:
    gaps = [program for program in tool.needs if shutil.which(program) is None]
    if tool.kind == "node" and not pdfjs_package().exists():
        gaps.append("node_modules/pdfjs-dist (run npm install)")
    if tool.requirements and not (marker(tool).exists() and env_python(tool).exists()):
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


def _existing_ancestor(path: Path) -> Path:
    """The nearest path that exists: the volume can be probed before the environment folder is made."""
    while not path.exists():
        path = path.parent
    return path


def install(tool: Tool, *, free_bytes: int | None = None) -> list[str]:
    """Create the method's own environment, then mark it installed; return its exact package list."""
    if not tool.requirements:
        return environment(tool)
    free = shutil.disk_usage(_existing_ancestor(envs_root())).free if free_bytes is None else free_bytes
    if free - tool.size_mb * 2**20 < FREE_FLOOR:
        raise DiskSpaceError(f"installing {tool.id} (~{tool.size_mb} MB) would leave less than 3 GB free")
    uv = _uv()
    env = envs_root() / tool.id
    marker(tool).unlink(missing_ok=True)  # a failed reinstall must not inherit the earlier "installed" mark
    try:
        if not env_python(tool).exists():
            subprocess.run([uv, "venv", "--python", tool.python, str(env)], check=True, timeout=INSTALL_TIMEOUT)
        subprocess.run([uv, "pip", "install", "--python", str(env_python(tool)), *tool.requirements],
                       check=True, timeout=INSTALL_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise ToolNotReady(f"{tool.id} install timed out") from None
    _check_imports(tool)
    marker(tool).write_text("\n".join(_freeze(tool)) + "\n", encoding="utf-8")
    return environment(tool)


def _check_imports(tool: Tool) -> None:
    """An install that exits 0 can still leave nothing importable (an empty placeholder package): refuse to mark it."""
    if tool.import_name is None:
        return
    try:
        probe = subprocess.run(
            [str(env_python(tool)), "-I", "-c", f"import {tool.import_name}"],
            capture_output=True, text=True, timeout=IMPORT_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        raise ToolNotReady(f"{tool.id} installed but importing it timed out") from None
    if probe.returncode != 0:
        lines = (probe.stderr or "").strip().splitlines()
        raise ToolNotReady(f"{tool.id} installed but does not import: {lines[-1] if lines else 'no error output'}")


def _freeze(tool: Tool) -> list[str]:
    """The sorted package list of a method's own environment."""
    frozen = subprocess.run(
        [_uv(), "pip", "freeze", "--python", str(env_python(tool))], capture_output=True, text=True, check=True,
        timeout=ENV_TIMEOUT,
    ).stdout
    return sorted(line for line in frozen.splitlines() if line.strip())


def _java_version() -> str:
    java = subprocess.run([shutil.which("java") or "java", "-version"], capture_output=True, text=True, timeout=ENV_TIMEOUT)
    text = (java.stderr or java.stdout).strip()  # java prints its version to stderr
    return text.splitlines()[0] if text else "java: no version output"


def _tesseract_version() -> str:
    tesseract = shutil.which("tesseract")
    if tesseract is None:
        return "tesseract: not installed"
    probe = subprocess.run([tesseract, "--version"], capture_output=True, text=True, timeout=ENV_TIMEOUT)
    text = (probe.stdout or probe.stderr).strip()
    return text.splitlines()[0] if text else "tesseract: no version output"


def environment(tool: Tool) -> list[str]:
    """Exact versions of what runs, recorded in every run.json."""
    if tool.kind == "node":
        node = subprocess.run([shutil.which("node") or "node", "--version"], capture_output=True, text=True,
                              timeout=ENV_TIMEOUT).stdout.strip()
        pkg = json.loads(pdfjs_package().read_text()) if pdfjs_package().exists() else {}
        lines = [f"node {node}", f"pdfjs-dist=={pkg.get('version', '?')}"]
    elif tool.requirements:
        python = subprocess.run([str(env_python(tool)), "--version"], capture_output=True, text=True, check=True,
                                timeout=ENV_TIMEOUT)
        lines = [(python.stdout or python.stderr).strip(), *_freeze(tool)]
    else:
        lines = [f"pymupdf=={dist_version('pymupdf')}", f"python {sys.version.split()[0]}"]
    if "java" in tool.needs:
        lines.append(_java_version())
    if tool.ocr:
        lines.append(_tesseract_version())
    return lines
```

- [ ] **Step 4: Replace `execute.py`**

`backend/eval/parser_bench/execute.py`:

```python
"""Run one method on one PDF and keep the result as a permanent run.

Every method first runs once on a two-page sample (warm-up), so a first-time
model download is never timed. The timed run's peak memory is the largest
resident size of the runner's whole process tree, sampled every 0.1 s (and once
at the start); that includes OpenDataLoader's Java child. A run too short to be
sampled has no peak (None), never a made-up 0.

The runner starts in its own session so that, however it ends (finished, timed
out, Ctrl-C), nothing it started is left running.

A failed run records where it failed (failed_stage): "warmup", "timed" (the
timed run exited non-zero or timed out), "output" (its output is malformed or
misses pages) or "after_run" (scoring or writing the record went wrong, Ctrl-C
included). It keeps whatever was measured before that point.
"""
from __future__ import annotations

import contextlib
import json
import os
import signal
import subprocess
import tempfile
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator, Mapping, Sequence

import psutil

from backend.eval.parser_bench import checks, pageset, store
from backend.eval.parser_bench.normalize import normalize_figures
from backend.eval.parser_bench.sources import page_count, sha256_file, two_page_sample
from backend.eval.parser_bench.tools import TOOLS, Tool, ToolNotReady, command, environment, missing

PROTOCOL = store.REPO / "docs" / "thesis" / "experiments" / "parser-benchmark" / "PROTOCOL.md"
# What a benchmark run's result depends on besides the tool: the bench's code, the protocol, the page set.
BENCH_TRACKED = (
    "backend/eval/parser_bench",
    "docs/thesis/experiments/parser-benchmark/PROTOCOL.md",
    "docs/thesis/experiments/parser-benchmark/pages.json",
)
DEFAULT_TIMEOUT = 3600.0
SAMPLE_EVERY = 0.1
SLOT_POLL = 0.5
KILL_SWEEPS = 5

__all__ = [
    "Cancelled", "Invocation", "RunnerError", "SlotBusy", "ToolNotReady",
    "bench_changes", "benchmark_pages", "invoke", "protocol_commit", "run_tool", "timed_slot",
]


class SlotBusy(RuntimeError):
    """Another timed run is in progress; two at once would distort each other's time and memory."""


class Cancelled(RuntimeError):
    """The run was cancelled before it started, while it waited for the timed-run slot."""


class RunnerError(RuntimeError):
    """The runner failed. `output` is True when it ran to its end but left unusable output;
    `seconds` is then how long it ran."""

    def __init__(self, message: str, log: str = "", *, output: bool = False, seconds: float | None = None):
        super().__init__(message)
        self.log = log
        self.output = output
        self.seconds = seconds


@dataclass
class Invocation:
    pages: dict[int, str]
    version: str
    settings: dict
    seconds: float
    peak_mb: float | None  # None: the run ended before any sample saw memory in use
    log: str


def _tree_rss(root: psutil.Process, seen: set[psutil.Process]) -> int:
    """Resident size of the runner and everything under it; every process met is added to `seen`."""
    try:
        procs = [root, *root.children(recursive=True)]
    except psutil.Error:
        procs = [root]
    seen.update(procs)
    total = 0
    for proc in procs:
        try:
            total += proc.memory_info().rss
        except psutil.Error:
            pass
    return total


def _alive(proc: psutil.Process) -> bool:
    try:
        return proc.is_running() and proc.status() != psutil.STATUS_ZOMBIE
    except psutil.Error:
        return False


def _group_exists(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _group_members(pgid: int) -> list[psutil.Process]:
    found = []
    for proc in psutil.process_iter():
        try:
            if os.getpgid(proc.pid) == pgid:
                found.append(proc)
        except (OSError, psutil.Error):
            pass
    return found


def _reap(proc: subprocess.Popen, seen: set[psutil.Process]) -> None:
    """Leave nothing of the runner alive: its process group first, then every process seen under it."""
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(proc.pid, signal.SIGKILL)
    proc.wait()
    for _ in range(KILL_SWEEPS):
        left = set(seen)
        if _group_exists(proc.pid):
            left.update(_group_members(proc.pid))
        left = {p for p in left if _alive(p)}
        if not left:
            return
        for straggler in left:
            with contextlib.suppress(psutil.Error):
                straggler.kill()
        time.sleep(0.05)


def _shape(data: object) -> tuple[dict[int, str], str, dict]:
    """Pages, version and settings from a runner's output, or ValueError saying what is wrong with it."""
    if not isinstance(data, dict):
        raise ValueError("the top level is not an object")
    raw = data.get("pages")
    if not isinstance(raw, dict):
        raise ValueError("'pages' is not an object")
    pages: dict[int, str] = {}
    for key, text in raw.items():
        if not isinstance(text, str):
            raise ValueError(f"page {key!r} is not text")
        try:
            pages[int(key)] = text
        except (TypeError, ValueError):
            raise ValueError(f"page key {key!r} is not a number") from None
    settings = data.get("settings")
    if settings is None:
        settings = {}
    elif not isinstance(settings, dict):
        raise ValueError("'settings' is not an object")
    version = data.get("version")
    return pages, "unknown" if version is None else str(version), dict(settings)


def invoke(tool: Tool, pdf: Path, *, timeout: float = DEFAULT_TIMEOUT, cancel: threading.Event | None = None) -> Invocation:
    with tempfile.TemporaryDirectory() as tmp:
        out, log_file = Path(tmp) / "out.json", Path(tmp) / "log.txt"
        with open(log_file, "w") as log:
            start = time.monotonic()
            proc = subprocess.Popen(
                [*command(tool), str(pdf), str(out)],
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, cwd=tmp,
                start_new_session=True,
            )
            seen: set[psutil.Process] = set()
            try:
                watched = psutil.Process(proc.pid)
            except psutil.Error:
                watched = None
            peak, seconds, timed_out, cancelled = 0, 0.0, False, False
            try:
                while True:
                    if watched:
                        peak = max(peak, _tree_rss(watched, seen))
                    if cancel is not None and cancel.is_set():
                        cancelled = True
                        break
                    remaining = timeout - (time.monotonic() - start)
                    if remaining <= 0:
                        timed_out = True
                        break
                    try:
                        proc.wait(timeout=min(SAMPLE_EVERY, remaining))
                    except subprocess.TimeoutExpired:
                        continue
                    seconds = time.monotonic() - start
                    break
            finally:
                _reap(proc, seen)
        text = log_file.read_text(errors="replace")
        if cancelled:
            raise RunnerError(f"{tool.id} was cancelled", text)
        if timed_out:
            raise RunnerError(f"{tool.id} timed out after {timeout:.0f} s", text)
        if proc.returncode != 0:
            raise RunnerError(f"{tool.id} exited with code {proc.returncode}", text)
        try:
            data = json.loads(out.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            raise RunnerError(f"{tool.id} wrote no readable output: {e}", text, output=True, seconds=seconds) from e
        try:
            pages, version, settings = _shape(data)
        except (ValueError, TypeError, AttributeError, KeyError) as e:
            raise RunnerError(f"{tool.id} wrote malformed output: {e}", text, output=True, seconds=seconds) from e
    return Invocation(pages, version, settings, seconds, round(peak / 2**20, 1) if peak else None, text)


def protocol_commit() -> str | None:
    """The commit that last changed PROTOCOL.md, or None if it is missing, uncommitted or edited since."""
    if not PROTOCOL.exists():
        return None
    rel = str(PROTOCOL.relative_to(store.REPO))
    git = ["git", "-C", str(store.REPO)]
    if subprocess.run([*git, "status", "--porcelain", "--", rel], capture_output=True, text=True).stdout.strip():
        return None
    return subprocess.run([*git, "log", "-1", "--format=%H", "--", rel], capture_output=True, text=True).stdout.strip() or None


def bench_changes() -> list[str]:
    """Uncommitted changes (git status lines) to what a benchmark result depends on (BENCH_TRACKED)."""
    probe = subprocess.run(["git", "-C", str(store.REPO), "status", "--porcelain", "--", *BENCH_TRACKED],
                           capture_output=True, text=True, timeout=60)
    if probe.returncode != 0:
        return [f"git status failed: {probe.stderr.strip() or probe.returncode}"]
    return [line for line in probe.stdout.splitlines() if line.strip()]


def benchmark_pages(sha256: str) -> list[int]:
    """The page set's pages of one PDF; empty when the file is not in the benchmark set."""
    return pageset.pages_for(sha256, pageset.load_or_empty())


@contextmanager
def timed_slot(root: Path, *, wait: bool = False, cancel: threading.Event | None = None,
               on_wait: Callable[[], None] | None = None) -> Iterator[None]:
    """One timed run at a time on this Mac, for the command line and the webpage alike: an exclusive
    lock on <data root>/timed-run.lock, held from the warm-up until the record is sealed."""
    import fcntl

    root.mkdir(parents=True, exist_ok=True)
    with open(root / "timed-run.lock", "a+") as handle:
        told = False
        while True:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if not wait:
                    raise SlotBusy("another timed run is in progress; start this one when it has finished") from None
                if cancel is not None and cancel.is_set():
                    raise Cancelled("cancelled while waiting for the running method to finish") from None
                if on_wait is not None and not told:
                    on_wait()
                    told = True
                time.sleep(SLOT_POLL)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _environment(tool: Tool) -> list[str] | None:
    """The environment for a failed run, best effort: failing to read it must not hide why the run failed."""
    try:
        return environment(tool)
    except Exception:
        return None


def _timing(seconds: float | None, total: int) -> dict:
    if seconds is None:
        return {"seconds_total": None, "seconds_per_page": None}
    return {"seconds_total": round(seconds, 2), "seconds_per_page": round(seconds / total, 3)}


@contextmanager
def _seal_on_error(run: store.ExtractRun, tool: Tool, fields: Mapping):
    """Whatever goes wrong while a run is being written, it ends sealed as failed, never stuck on
    'running'. Ctrl-C (any BaseException) seals it too, and is then passed on."""
    try:
        yield
    except BaseException as e:
        if run.meta["status"] != "running":
            raise
        detail = f": {e}" if str(e) else ""
        run.finish("failed", reason=f"error after run: {type(e).__name__}{detail}", failed_stage="after_run",
                   environment=_environment(tool), **fields)
        if not isinstance(e, Exception):
            raise


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
    on_stage: Callable[[str], None] | None = None,
    cancel: threading.Event | None = None,
    wait_for_slot: bool = False,
) -> store.ExtractRun:
    """Run one method on one PDF and keep the result. `on_stage` hears "waiting", "warmup", "timed"
    and "scoring"; setting `cancel` stops the runner (the run is kept, failed, reason "cancelled").
    Benchmark runs warm up, need the protocol and the bench's code committed, and score exactly the
    page set's pages of the file."""
    if purpose not in store.PURPOSES:
        raise ValueError(f"purpose must be one of {store.PURPOSES}, not {purpose!r}")
    tool = registry[tool_id]
    gaps = missing(tool)
    if gaps:
        raise ToolNotReady(f"{tool_id} is not ready: {'; '.join(gaps)}")
    extra: dict = {}
    if purpose == "benchmark":
        commit = protocol_commit()
        if commit is None:
            raise RuntimeError("benchmark runs need PROTOCOL.md committed and unmodified first (spec: protocol before the first run)")
        changes = bench_changes()
        if changes:
            raise RuntimeError("benchmark runs need the benchmark's code, protocol and page set committed first: "
                               + "; ".join(changes))
        if not warmup:
            raise ValueError("benchmark runs always warm up, so a first-time model download is never timed")
        extra["protocol_commit"] = commit

    root = store.data_root() if root is None else root  # a refused data folder is found now, not after a long run
    pdf = Path(pdf).resolve()
    total = page_count(pdf)
    sha = sha256_file(pdf)
    if purpose == "benchmark":
        chosen = benchmark_pages(sha)
        if not chosen:
            raise ValueError(f"{pdf.name} is not in the benchmark page set; run it as explore")
        if pages and sorted(set(pages)) != chosen:
            raise ValueError(f"benchmark runs score exactly the page set's pages of this file: {chosen}")
        pages = chosen
    wanted = sorted(set(pages)) if pages else list(range(1, total + 1))
    outside = [p for p in wanted if not 1 <= p <= total]
    if outside:
        raise ValueError(f"pages {outside} are outside 1–{total}")
    source = {"path": str(pdf), "name": pdf.name, "sha256": sha, "pages_total": total}
    facts = checks.document_facts(pdf)  # an unreadable file is found now, not after a long run

    def stage(name: str) -> None:
        if on_stage is not None:
            on_stage(name)

    with timed_slot(root, wait=wait_for_slot, cancel=cancel, on_wait=lambda: stage("waiting")):
        return _run_in_slot(tool, tool_id, pdf, wanted, total, source, facts, purpose, extra, root,
                            warmup, timeout, cancel, stage)


def _run_in_slot(tool: Tool, tool_id: str, pdf: Path, wanted: list[int], total: int, source: dict,
                 facts: checks.DocFacts, purpose: str, extra: dict, root: Path, warmup: bool,
                 timeout: float, cancel: threading.Event | None, stage: Callable[[str], None]) -> store.ExtractRun:
    # The record names the code as it was when the run started, not after a long run during which
    # a commit may have landed.
    started, git = store.now_iso(), store.git_state()
    record = dict(source=source, purpose=purpose, started_at=started, extra=extra, root=root, git=git,
                  checks_version=checks.CHECKS_VERSION)
    version, warm_seconds, step = "unknown", None, "warmup"
    try:
        if warmup:
            stage("warmup")
            with tempfile.TemporaryDirectory() as tmp:
                warm = invoke(tool, two_page_sample(pdf, Path(tmp) / "warmup.pdf"), timeout=timeout, cancel=cancel)
            version, warm_seconds = warm.version, round(warm.seconds, 2)
        step = "timed"
        stage("timed")
        result = invoke(tool, pdf, timeout=timeout, cancel=cancel)
    except RunnerError as e:
        if step == "timed" and e.output:
            step = "output"  # the timed run ran to its end, so its time is known
        fields = {"pages_scored": wanted, "timeout_s": timeout, "warmup_seconds": warm_seconds,
                  **_timing(e.seconds if step == "output" else None, total)}
        run = store.ExtractRun.create(tool=tool_id, version=version, **record)
        with _seal_on_error(run, tool, fields):
            run.append_log(e.log)
            run.finish("failed", reason=str(e), failed_stage=step, environment=_environment(tool), **fields)
        return run

    stage("scoring")
    # A tool that leaves out any page of the file has not extracted the file: the run
    # is kept, with the pages it did produce, but it is failed (ruling R1).
    absent = [p for p in range(1, total + 1) if p not in result.pages]
    fields = {"pages_scored": wanted, "missing_pages": absent, "timeout_s": timeout, "warmup_seconds": warm_seconds,
              **_timing(result.seconds, total), "peak_memory_mb": result.peak_mb}
    run = store.ExtractRun.create(tool=tool_id, version=result.version, settings=result.settings, **record)
    with _seal_on_error(run, tool, fields):
        run.append_log(result.log)
        rows = []
        for page in wanted:
            if page not in result.pages:
                continue
            text = normalize_figures(result.pages[page])
            run.write_page(page, text)
            rows.append(checks.check_page(text, facts.pages[page], facts))
        run.write_checks(rows)
        run.finish(
            "failed" if absent else "finished",
            reason=f"missing pages {absent}" if absent else None,
            failed_stage="output" if absent else None,
            # a finished run must name its environment; a failed one records it if it can
            environment=_environment(tool) if absent else environment(tool),
            **fields,
        )
    return run
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_tools.py backend/tests/unit/test_parser_bench_execute.py backend/tests/unit/test_parser_bench_cli.py -q`
Expected: `89 passed` (26 + 48 + 15). The CLI test `test_benchmark_without_a_protocol_is_refused` still passes, because the protocol is checked before the warm-up rule.

- [ ] **Step 6: Commit**

```bash
git add backend/eval/parser_bench/tools.py backend/eval/parser_bench/execute.py backend/tests/unit/test_parser_bench_tools.py backend/tests/unit/test_parser_bench_execute.py
git commit -m "feat(parser-bench): benchmark runs warm up, need committed code and score the page set; one timed run at a time, stages, cancel, Tesseract recorded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The duel schedule (`schedule.py`)

**Files:**
- Create: `backend/eval/parser_bench/schedule.py`
- Create: `backend/tests/unit/test_parser_bench_schedule.py`
- Modify: `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md` (Duels: the repeat rule)

**Interfaces:**
- Consumes: nothing from the bench.
- Produces:
  - `schedule.SchedPage(key: str, type: str)`.
  - `PER_PAIR = 3`, `REPEAT_SHARE = 9`, `MAX_GAP = 20`, `ROUND2_CAP = 75` and `TOP = 4`.
  - `repeat_gap(total: int) -> int`, which is `min(20, total // 3)`.
  - `round1(entrants, pages, seed) -> list[dict]`. Each duel dict holds `duel, round, a, b, page, type, left, right, repeat_of`. `a < b` are the pair, `left`/`right` the shown sides, and `repeat_of` the original's duel number or `None`. Duels are numbered `0..` in judging order.
  - `needs_round2(ranking_rows) -> bool`. The rows are best first, each with `lo` and `hi`.
  - `round2_batch(ranked, pages, existing, seed, batch, room) -> list[dict]`. It is numbered on from `existing`, has at most `room` duels, uses `round == 2`, and has no repeats.

**Rules** (stated in the module docstring and the spec):
- **Repeats.** One duel in ten of the final schedule is a hidden repeat, `round(r1 / 9)` of them. That gives 135 → 15 (150 in all) and 30 → 3 (33), which matches both of the spec's numbers.
- **Repeat gap.** A repeat comes at least `min(20, total // 3)` duels after its original: 20 for 150 duels, 11 for 33. A small comparison can then still hide its repeats.
- **Round 2.** The last round-2 batch is cut to fit the 75-duel cap.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_parser_bench_schedule.py`:

```python
from collections import Counter

import pytest

from backend.eval.parser_bench import schedule

TYPES = ("layout", "lists", "table_formula", "diagram", "dense_text")
PAGES = [schedule.SchedPage(f"p{i}", TYPES[i % 5]) for i in range(24)]
TEN = ["current", "pymupdf4llm", "pdfjs", "markitdown", "opendataloader", "ai_vision", "docling", "marker", "mineru", "paddleocr"]
FIVE = TEN[:5]


def test_ten_entrants_make_135_duels_and_15_hidden_repeats():
    duels = schedule.round1(TEN, PAGES, seed=1)
    assert len(duels) == 150
    assert sum(d["repeat_of"] is None for d in duels) == 135
    assert [d["duel"] for d in duels] == list(range(150))


def test_five_entrants_make_30_duels_and_3_hidden_repeats():
    duels = schedule.round1(FIVE, PAGES, seed=1)
    assert len(duels) == 33 and sum(d["repeat_of"] is not None for d in duels) == 3


@pytest.mark.parametrize("entrants", [TEN, FIVE])
def test_every_pair_meets_three_times_on_three_page_types(entrants):
    first = [d for d in schedule.round1(entrants, PAGES, seed=3) if d["repeat_of"] is None]
    by_pair: dict = {}
    for d in first:
        by_pair.setdefault((d["a"], d["b"]), []).append(d["type"])
    assert len(by_pair) == len(entrants) * (len(entrants) - 1) // 2
    assert all(len(types) == 3 and len(set(types)) == 3 for types in by_pair.values())
    appearances = Counter(t for d in first for t in (d["a"], d["b"]))
    assert set(appearances.values()) == {3 * (len(entrants) - 1)}  # 27 each for ten entrants


def test_pages_of_one_type_are_used_evenly():
    first = [d for d in schedule.round1(TEN, PAGES, seed=5) if d["repeat_of"] is None]
    use = Counter(d["page"] for d in first)
    for t in TYPES:
        counts = [use[p.key] for p in PAGES if p.type == t]
        assert max(counts) - min(counts) <= 1, t


@pytest.mark.parametrize("entrants", [TEN, FIVE])
def test_a_repeat_swaps_sides_and_comes_long_after_its_original(entrants):
    duels = schedule.round1(entrants, PAGES, seed=9)
    gap = schedule.repeat_gap(len(duels))
    for d in duels:
        if d["repeat_of"] is None:
            continue
        original = duels[d["repeat_of"]]
        assert original["repeat_of"] is None
        assert (d["left"], d["right"], d["page"]) == (original["right"], original["left"], original["page"])
        assert d["duel"] - original["duel"] >= gap


def test_the_repeat_gap_is_20_or_a_third_of_a_short_schedule():
    assert (schedule.repeat_gap(150), schedule.repeat_gap(33), schedule.repeat_gap(10)) == (20, 11, 3)


def test_the_same_seed_gives_the_same_schedule_and_another_seed_a_different_one():
    assert schedule.round1(TEN, PAGES, seed=42) == schedule.round1(TEN, PAGES, seed=42)
    assert schedule.round1(TEN, PAGES, seed=42) != schedule.round1(TEN, PAGES, seed=43)


def test_sides_are_mixed():
    first = [d for d in schedule.round1(TEN, PAGES, seed=2) if d["repeat_of"] is None]
    lefts = sum(d["left"] == d["a"] for d in first)
    assert 40 < lefts < 95  # of 135


def test_too_few_page_types_are_refused():
    with pytest.raises(ValueError, match="page types"):
        schedule.round1(FIVE, [schedule.SchedPage("a", "lists"), schedule.SchedPage("b", "layout")], seed=1)


def test_round2_is_needed_only_while_the_top_two_overlap():
    assert schedule.needs_round2([{"lo": 1050, "hi": 1200}, {"lo": 990, "hi": 1060}])
    assert not schedule.needs_round2([{"lo": 1070, "hi": 1200}, {"lo": 990, "hi": 1060}])
    assert not schedule.needs_round2([{"lo": 1070, "hi": 1200}])


def test_a_round2_batch_pairs_neighbours_among_the_top_four():
    existing = schedule.round1(FIVE, PAGES, seed=1)
    ranked = ["opendataloader", "pymupdf4llm", "current", "pdfjs", "markitdown"]
    batch = schedule.round2_batch(ranked, PAGES, existing, seed=1, batch=1, room=75)
    assert len(batch) == 9 and [d["duel"] for d in batch] == list(range(33, 42))
    pairs = Counter(tuple(sorted((d["a"], d["b"]))) for d in batch)
    assert pairs == {("opendataloader", "pymupdf4llm"): 3, ("current", "pymupdf4llm"): 3, ("current", "pdfjs"): 3}
    assert all(d["round"] == 2 and d["repeat_of"] is None for d in batch)
    assert schedule.round2_batch(ranked, PAGES, existing, seed=1, batch=1, room=4)[-1]["duel"] == 36
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_schedule.py -q`
Expected: FAIL with `ImportError: cannot import name 'schedule'`

- [ ] **Step 3: Write `schedule.py`**

`backend/eval/parser_bench/schedule.py`:

```python
"""The duel schedule (spec "Duels"), fixed by a seed before the first vote.

Round 1: every pair of entrants meets 3 times, on 3 pages of 3 different page types. Types and
pages are spread evenly (the least-used first, ties broken by the seeded generator), and each
duel's sides are drawn at random. Every entrant then appears 3·(n−1) times.

Hidden repeats: one in ten duels of the final schedule is a repeat, round(r1 / 9) of them, so 135
round-1 duels get 15 (150 in all) and 30 get 3 (33). A repeat shows a round-1 duel again with the
sides swapped, at least `repeat_gap(total)` duels after it: 20, or a third of the schedule when
that is shorter (33 duels: 11), so a small comparison can still hide its repeats.

Round 2 (the stopping rule): after round 1, while the top entrant's 95% interval overlaps the
second's, the adjacent pairs among the top four get 3 more duels each, until the intervals
separate or 75 extra duels have been scheduled.
"""
from __future__ import annotations

import random
from collections import Counter
from dataclasses import dataclass
from itertools import combinations
from typing import Any, Mapping, Sequence

PER_PAIR = 3
REPEAT_SHARE = 9      # repeats = round(round-1 duels / 9): one in ten of the final schedule
MAX_GAP = 20
ROUND2_CAP = 75
TOP = 4


@dataclass(frozen=True)
class SchedPage:
    key: str
    type: str


def repeat_gap(total: int) -> int:
    """How many duels must lie between a duel and its hidden repeat, for a schedule of `total` duels."""
    return min(MAX_GAP, total // 3)


def _place(a: str, b: str, pages: Sequence[SchedPage], rng: random.Random, page_use: Counter,
           type_use: Counter, tool_type: Counter) -> list[tuple[str, str]]:
    """Three (page key, type) slots for the pair a–b on three different types, least-used first."""
    by_type: dict[str, list[SchedPage]] = {}
    for p in pages:
        by_type.setdefault(p.type, []).append(p)
    if len(by_type) < PER_PAIR:
        raise ValueError(f"the pages cover {len(by_type)} page types; each pair needs {PER_PAIR} different ones")
    order = sorted(by_type, key=lambda t: (tool_type[a, t] + tool_type[b, t], type_use[t], rng.random()))
    slots = []
    for t in order[:PER_PAIR]:
        page = min(by_type[t], key=lambda p: (page_use[p.key], rng.random()))
        page_use[page.key] += 1
        type_use[t] += 1
        tool_type[a, t] += 1
        tool_type[b, t] += 1
        slots.append((page.key, t))
    return slots


def _duel(a: str, b: str, page: str, type_: str, rng: random.Random, round_: int) -> dict[str, Any]:
    left, right = (a, b) if rng.random() < 0.5 else (b, a)
    return {"duel": -1, "round": round_, "a": a, "b": b, "page": page, "type": type_,
            "left": left, "right": right, "repeat_of": None}


def round1(entrants: Sequence[str], pages: Sequence[SchedPage], seed: int) -> list[dict[str, Any]]:
    """Round 1 with its hidden repeats, numbered 0.. in the order they are judged."""
    names = sorted(set(entrants))
    if len(names) < 2:
        raise ValueError("a comparison needs at least two entrants")
    rng = random.Random(seed)
    pairs = list(combinations(names, 2))
    rng.shuffle(pairs)
    page_use: Counter = Counter()
    type_use: Counter = Counter()
    tool_type: Counter = Counter()
    duels = []
    for a, b in pairs:
        for key, t in _place(a, b, pages, rng, page_use, type_use, tool_type):
            duels.append(_duel(a, b, key, t, rng, 1))
    rng.shuffle(duels)

    n_repeats = round(len(duels) / REPEAT_SHARE)
    gap = repeat_gap(len(duels) + n_repeats)
    eligible = duels[: len(duels) - gap]
    if n_repeats > len(eligible):
        raise ValueError(f"{len(duels)} duels are too few to hide {n_repeats} repeats {gap} duels apart")
    originals = rng.sample(eligible, n_repeats)
    final = list(duels)

    def position(duel: dict) -> int:
        return next(i for i, d in enumerate(final) if d is duel)

    for original in sorted(originals, key=position):
        at = position(original)
        repeat = dict(original, left=original["right"], right=original["left"], repeat_of=id(original))
        final.insert(rng.randint(at + gap, len(final)), repeat)
    number = {id(d): i for i, d in enumerate(final)}
    for i, d in enumerate(final):
        d["duel"] = i
        if d["repeat_of"] is not None:
            d["repeat_of"] = number[d["repeat_of"]]
    return final


def needs_round2(ranking: Sequence[Mapping[str, Any]]) -> bool:
    """The stopping rule's question: does the top entrant's interval overlap the second's?
    `ranking` is sorted by points, best first, each row with "lo" and "hi"."""
    if len(ranking) < 2:
        return False
    return ranking[0]["lo"] <= ranking[1]["hi"]


def round2_batch(ranked: Sequence[str], pages: Sequence[SchedPage], existing: Sequence[Mapping[str, Any]],
                 seed: int, batch: int, room: int) -> list[dict[str, Any]]:
    """The next round-2 duels: 3 for each adjacent pair among the top four (`ranked` best first), on
    three page types, numbered after `existing`; at most `room` of them (the 75-duel cap)."""
    rng = random.Random(seed * 1000 + batch)
    page_use: Counter = Counter(d["page"] for d in existing)
    type_use: Counter = Counter(d["type"] for d in existing)
    tool_type: Counter = Counter()
    for d in existing:
        tool_type[d["a"], d["type"]] += 1
        tool_type[d["b"], d["type"]] += 1
    top = list(ranked[:TOP])
    duels = []
    for x, y in zip(top, top[1:]):
        a, b = sorted((x, y))
        for key, t in _place(a, b, pages, rng, page_use, type_use, tool_type):
            duels.append(_duel(a, b, key, t, rng, 2))
    rng.shuffle(duels)
    duels = duels[: max(0, room)]
    for i, d in enumerate(duels, start=len(existing)):
        d["duel"] = i
    return duels
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_schedule.py -q`
Expected: `13 passed`

- [ ] **Step 5: State the repeat rule in the spec**

In the spec's "Duels" section, replace

```markdown
  - **15 hidden repeats** are drawn from round 1 and shown again with sides swapped, at least 20 duels after the original.
```

with

```markdown
  - **15 hidden repeats** are drawn from round 1 and shown again with sides swapped, at least 20 duels after the original. In general, repeats are one duel in ten of the final schedule, round(round-1 duels / 9), and the gap is 20 duels or a third of the schedule when that is shorter (the 33-duel first comparison: 3 repeats, 11 apart).
```

and replace

```markdown
- **Round 2 (stopping rule, fixed in advance).** After round 1, if the top tool's 95% interval overlaps the second's, adjacent pairs among the top four get 3 more duels each, repeated until the intervals separate or 75 extra duels have been done.
```

with

```markdown
- **Round 2 (stopping rule, fixed in advance).** After round 1, if the top tool's 95% interval overlaps the second's, adjacent pairs among the top four get 3 more duels each, repeated until the intervals separate or 75 extra duels have been done. Round-2 duels have no hidden repeats, and the last batch is cut to fit the 75.
```

- [ ] **Step 6: Commit**

```bash
git add backend/eval/parser_bench/schedule.py backend/tests/unit/test_parser_bench_schedule.py docs/superpowers/specs/2026-10-30-parser-benchmark-design.md
git commit -m "feat(parser-bench): seeded duel schedule with hidden repeats and the round-2 stopping rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Bradley–Terry ranking with bootstrap intervals (`ranking.py`)

**Files:**
- Create: `backend/eval/parser_bench/ranking.py`
- Create: `backend/tests/unit/test_parser_bench_ranking.py`
- Modify: `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md` (Analysis: prior, anchor, self-consistency)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RESAMPLES = 1000`, `PRIOR_GAMES = 1.0` and `CHOICES`.
  - `Outcome(a, b, score_a)`.
  - `outcome(left, right, choice) -> Outcome`.
  - `fit(outcomes, entrants) -> dict[str, float]`.
  - `points(strengths, anchor) -> dict[str, float]`.
  - `percentile(values, q) -> float`.
  - `bootstrap(outcomes, entrants, anchor, *, resamples=1000, seed=0) -> dict[str, tuple[float, float]]`.
  - `rate(outcomes, entrants, anchor, *, resamples=1000, seed=0) -> list[{"entrant", "points", "lo", "hi"}]`, best first. It returns `[]` when there are no votes.

**Method:**
- **Fit.** MM (Hunter 2004), in pure Python, so no new dependency.
- **Prior.** Each entrant plays one virtual draw spread over its opponents, which keeps every strength finite in a bootstrap resample where a tool wins nothing. Because of it, the strengths are normalised to geometric mean 1 after each step, and MM converges in about 30 iterations for 4–5 entrants. 1,000 resamples take under a second.
- **Points.** `1000 + 400·log10(p / p_current)`. The anchor's interval is exactly 1000–1000.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_parser_bench_ranking.py`:

```python
import math
import random
import time

import pytest

from backend.eval.parser_bench import ranking

TRUE = {"current": 1.0, "b": 2.0, "c": 4.0, "d": 0.5}


def true_points(anchor="current"):
    return {e: 1000 + 400 * math.log10(s / TRUE[anchor]) for e, s in TRUE.items()}


def synthetic(n, seed, tie_share=0.0):
    """Votes drawn from known strengths: a beats b with probability p_a / (p_a + p_b)."""
    rng = random.Random(seed)
    names = sorted(TRUE)
    out = []
    for _ in range(n):
        a, b = rng.sample(names, 2)
        if rng.random() < tie_share:
            out.append(ranking.outcome(a, b, "same"))
        else:
            out.append(ranking.outcome(a, b, "left" if rng.random() < TRUE[a] / (TRUE[a] + TRUE[b]) else "right"))
    return out


def test_the_fit_recovers_known_strengths():
    est = ranking.points(ranking.fit(synthetic(6000, seed=1), sorted(TRUE)), "current")
    for e, want in true_points().items():
        assert abs(est[e] - want) < 20, (e, est[e], want)


def test_the_bootstrap_intervals_cover_the_true_strengths():
    # One fixed dataset: a 95% interval misses about one time in twenty, so the data are not redrawn.
    rows = ranking.rate(synthetic(600, seed=11), sorted(TRUE), "current", resamples=200, seed=3)
    truth = true_points()
    for row in rows:
        assert row["lo"] <= truth[row["entrant"]] <= row["hi"], row
    anchor = next(r for r in rows if r["entrant"] == "current")
    assert (anchor["points"], anchor["lo"], anchor["hi"]) == (1000.0, 1000.0, 1000.0)
    assert [r["entrant"] for r in rows] == ["c", "b", "current", "d"]


def test_intervals_narrow_as_votes_accumulate():
    def width(n):
        rows = ranking.rate(synthetic(n, seed=12), sorted(TRUE), "current", resamples=100, seed=1)
        return sum(r["hi"] - r["lo"] for r in rows)

    assert width(1200) < width(150)


def test_draws_are_half_a_win_each():
    votes = [ranking.outcome("current", "x", c) for c in ("same", "both_bad", "same", "both_bad")]
    est = ranking.points(ranking.fit(votes, ["current", "x"]), "current")
    assert est["x"] == pytest.approx(1000.0, abs=1e-6)
    one_each = [ranking.outcome("current", "x", "left"), ranking.outcome("current", "x", "right")]
    assert ranking.points(ranking.fit(one_each, ["current", "x"]), "current")["x"] == pytest.approx(1000.0, abs=1e-6)


def test_an_entrant_that_never_wins_keeps_a_finite_rating():
    votes = [ranking.outcome("current", "loser", "left") for _ in range(10)]
    est = ranking.points(ranking.fit(votes, ["current", "loser"]), "current")
    assert math.isfinite(est["loser"]) and est["loser"] < 800


def test_the_same_votes_and_seed_give_the_same_intervals():
    votes = synthetic(150, seed=4)
    assert ranking.rate(votes, sorted(TRUE), "current", resamples=50, seed=9) == ranking.rate(votes, sorted(TRUE), "current", resamples=50, seed=9)


def test_a_thousand_resamples_by_default_and_fast_enough():
    assert ranking.RESAMPLES == 1000
    votes = synthetic(150, seed=5)
    started = time.monotonic()
    ranking.rate(votes, sorted(TRUE), "current")
    assert time.monotonic() - started < 30


def test_unknown_choices_and_anchors_are_refused():
    with pytest.raises(ValueError, match="choice"):
        ranking.outcome("a", "b", "both")
    with pytest.raises(ValueError, match="anchor"):
        ranking.rate([ranking.outcome("a", "b", "left")], ["a", "b"], "current")


def test_no_votes_no_ranking():
    assert ranking.rate([], ["current", "x"], "current") == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_ranking.py -q`
Expected: FAIL with `ImportError: cannot import name 'ranking'`

- [ ] **Step 3: Write `ranking.py`**

`backend/eval/parser_bench/ranking.py`:

```python
"""Bradley–Terry ratings from duel votes (spec "Analysis").

The model: entrant i beats j with probability p_i / (p_i + p_j). It is fitted with the MM
algorithm (Hunter 2004, "MM algorithms for generalized Bradley–Terry models"). "Same" and
"Both unusable" count as half a win for each side.

A weak prior keeps every strength finite: each entrant also plays one virtual drawn game, spread
evenly over its opponents (1/(n−1) of a draw against each). Without it an entrant that wins
nothing (likely in a bootstrap resample of a small comparison) would get strength 0 and minus
infinite points. Against 12–27 real duels per entrant, one virtual draw moves a rating by a few
points; the protocol says so. The prior links every pair, so strengths are normalised to a
geometric mean of 1 after each step, which keeps MM fast.

Ratings are points, 1000 + 400·log10(p / p_anchor), so the anchor (`current`) is 1000. Intervals
come from resampling the votes 1,000 times; the 2.5th and 97.5th percentiles bound each 95%
interval. The anchor's interval is exactly 1000–1000: every other interval is relative to it.
Pure Python: the fits are small (at most a dozen entrants).
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Sequence

RESAMPLES = 1000
PRIOR_GAMES = 1.0
TOLERANCE = 1e-6  # in log-strength; a tenth of a point is about 6e-4
MAX_ITERATIONS = 10_000
CHOICES = ("left", "right", "same", "both_bad")


@dataclass(frozen=True)
class Outcome:
    a: str
    b: str
    score_a: float  # 1.0 a won, 0.0 b won, 0.5 a draw ("same" or "both unusable")


def outcome(left: str, right: str, choice: str) -> Outcome:
    if choice not in CHOICES:
        raise ValueError(f"choice must be one of {CHOICES}, not {choice!r}")
    return Outcome(left, right, {"left": 1.0, "right": 0.0}.get(choice, 0.5))


def fit(outcomes: Sequence[Outcome], entrants: Sequence[str]) -> dict[str, float]:
    """Strengths by MM: p_i = W_i / Σ_j n_ij / (p_i + p_j), with the prior's draws in W and n."""
    index = {e: i for i, e in enumerate(entrants)}
    n = len(entrants)
    if n < 2:
        raise ValueError("a ranking needs at least two entrants")
    share = PRIOR_GAMES / (n - 1)
    wins = [PRIOR_GAMES / 2] * n
    games = [[0.0 if i == j else share for j in range(n)] for i in range(n)]
    for o in outcomes:
        i, j = index[o.a], index[o.b]
        wins[i] += o.score_a
        wins[j] += 1.0 - o.score_a
        games[i][j] += 1.0
        games[j][i] += 1.0
    others = [[j for j in range(n) if j != i] for i in range(n)]
    p = [1.0] * n
    for _ in range(MAX_ITERATIONS):
        new = [wins[i] / sum(games[i][j] / (p[i] + p[j]) for j in others[i]) for i in range(n)]
        mean = math.exp(sum(math.log(x) for x in new) / n)
        new = [x / mean for x in new]
        change = max(abs(math.log(a / b)) for a, b in zip(new, p))
        p = new
        if change < TOLERANCE:
            break
    return dict(zip(entrants, p))


def points(strengths: dict[str, float], anchor: str) -> dict[str, float]:
    base = strengths[anchor]
    return {e: 1000.0 + 400.0 * math.log10(s / base) for e, s in strengths.items()}


def percentile(values: Sequence[float], q: float) -> float:
    """Linear interpolation between the closest ranks (numpy's default)."""
    ordered = sorted(values)
    k = (len(ordered) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def bootstrap(outcomes: Sequence[Outcome], entrants: Sequence[str], anchor: str, *,
              resamples: int = RESAMPLES, seed: int = 0) -> dict[str, tuple[float, float]]:
    """Each entrant's 95% interval of points from `resamples` resamples of the votes (with replacement)."""
    rng = random.Random(seed)
    draws: dict[str, list[float]] = {e: [] for e in entrants}
    n = len(outcomes)
    for _ in range(resamples):
        sample = [outcomes[rng.randrange(n)] for _ in range(n)]
        for e, value in points(fit(sample, entrants), anchor).items():
            draws[e].append(value)
    return {e: (percentile(v, 0.025), percentile(v, 0.975)) for e, v in draws.items()}


def rate(outcomes: Sequence[Outcome], entrants: Sequence[str], anchor: str, *,
         resamples: int = RESAMPLES, seed: int = 0) -> list[dict[str, float | str]]:
    """Points with 95% intervals, best first: [{"entrant", "points", "lo", "hi"}]."""
    if anchor not in entrants:
        raise ValueError(f"the anchor {anchor!r} is not an entrant")
    if not outcomes:
        return []
    estimate = points(fit(outcomes, entrants), anchor)
    bounds = bootstrap(outcomes, entrants, anchor, resamples=resamples, seed=seed)
    rows = [{"entrant": e, "points": round(estimate[e], 1), "lo": round(bounds[e][0], 1), "hi": round(bounds[e][1], 1)}
            for e in entrants]
    return sorted(rows, key=lambda r: (-r["points"], r["entrant"]))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_ranking.py -q`
Expected: `9 passed` in a few seconds.

- [ ] **Step 5: State the prior and the anchor in the spec**

In the spec's "Analysis" section, replace

```markdown
- **H1** holds if some tool's interval lies entirely above `current`'s.
```

with

```markdown
- **Prior.** Each tool also plays one virtual drawn game, spread evenly over its opponents, so a tool that wins nothing in a bootstrap resample keeps a finite rating. It moves a rating by a few points.
- **H1** holds if some tool's interval lies entirely above `current`'s. `current` is the anchor, so its interval is exactly 1000–1000, and H1 holds when some tool's lower bound is above 1000.
```

and replace

```markdown
  - self-consistency, the share of hidden repeats where the same tool won ("Same" against a winner counts as a disagreement);
```

with

```markdown
  - self-consistency, the share of hidden repeats judged alike: the same tool won, or both times "Same", or both times "Both unusable" ("Same" against a winner, or against "Both unusable", counts as a disagreement);
```

- [ ] **Step 6: Commit**

```bash
git add backend/eval/parser_bench/ranking.py backend/tests/unit/test_parser_bench_ranking.py docs/superpowers/specs/2026-10-30-parser-benchmark-design.md
git commit -m "feat(parser-bench): Bradley–Terry by MM with a weak prior, bootstrap 95% intervals, points with current = 1000

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Comparison runs and the vote log (`compare.py`)

**Files:**
- Create: `backend/eval/parser_bench/compare.py`
- Create: `backend/tests/unit/parser_bench_compare_fixtures.py`
- Create: `backend/tests/unit/test_parser_bench_compare.py`

**Interfaces:**
- Consumes:
  - `store.find_run`, `data_root`, `now_iso`, `git_state`, `_write_json`, `list_runs`, `checks_version`, `RunFinishedError` and `PURPOSES`;
  - `pageset.BenchPage`, `load`, `pages_for` and `as_entry`;
  - `schedule.round1` and `SchedPage`;
  - `checks.CHECKS_VERSION`.
- Produces:
  - `compare.CHOICES = ("left", "right", "same", "both_bad")`, `SESSION` (regex `s-<8–32 hex>`) and `NOTE_MAX = 500`.
  - `new_compare_id(*, now=None, token=None) -> "cmp-YYYY-MM-DD_xxxx"`.
  - `CompareRun(path)`:
    - `.open(run_id, root=None)`
    - `.create(*, entrants, pages, seed, duels, protocol_commit, purpose="benchmark", anchor="current", root=None)`
    - `.run_id`, `.meta` and `.votes_path`
    - `.extend(duels)`, `.finish()` and `.unlock_early(reason)`
    - `.events()`, `.active_votes() -> {duel: vote}`, `.progress() -> (done, total)` and `.next_duel()`
    - `.vote(*, duel, choice, seconds, session, note=None) -> line`
    - `.undo(*, session) -> line | None`
    - `.page(key)` and `.output(tool, key, root=None) -> str`
  - `latest_benchmark_runs(tools, pages, commit, root=None) -> {tool: {sha256: run_id}}`.
  - `create_benchmark(tools, *, seed, commit, pages=None, anchor="current", root=None) -> CompareRun`.
  - `list_comparisons(root=None) -> list[CompareRun]`, newest first.
- `compare.json` keys:
  - `run_id, kind="compare", record_version=1, purpose, status (judging|finished), started_at, finished_at`
  - `protocol_commit, git, checks_version, seed, anchor`
  - `entrants {tool: {sha256: run_id}}`, `pages [{key, source, file, sha256, page, type, how}]`, `schedule [duel dicts]`
  - `rounds, round2_duels, unlocked_early`
- A `votes.jsonl` line is one of two kinds:
  - a vote: `{"type": "vote", "vote_id", "duel", "page", "left", "right", "choice", "seconds", "session", "at", "note"}`;
  - a retraction: `{"type": "retract", "vote_id", "duel", "session", "at"}`.

  Undo retracts the most recent vote that still counts, from any session, because there is one judge. The retracted duel then comes back as the next duel.

The "Sheets" source has two PDFs, so an entrant is a tool with one extraction run per PDF.

- [ ] **Step 1: Write the comparison fixture and the failing tests**

`backend/tests/unit/parser_bench_compare_fixtures.py`:

```python
"""A small comparison on disk: three entrants' finished benchmark runs of the synthetic deck, and
a comparison over its six pages. Not a test module (no test_ prefix)."""
from pathlib import Path

import fitz

from backend.eval.parser_bench import checks, compare, schedule, sources, store
from backend.tests.unit.parser_bench_fixtures import make_deck

TYPES = ("layout", "lists", "table_formula", "diagram", "dense_text")
ENTRANTS = ("current", "alphatool", "betatool")
SESSION = "s-0123456789abcdef"


def make_extract_run(root: Path, tool: str, deck: Path, pages=range(1, 7), *, purpose="benchmark", commit="abc123"):
    """A finished run: `current` holds the raw text layer (footer included), the others clean Markdown."""
    facts = checks.document_facts(deck)
    sha = sources.sha256_file(deck)
    run = store.ExtractRun.create(
        tool=tool, version="1.0", purpose=purpose, root=root,
        source={"path": str(deck), "name": deck.name, "sha256": sha, "pages_total": 6},
        extra={"protocol_commit": commit}, checks_version=checks.CHECKS_VERSION, git={"commit": "c0ffee", "dirty": False},
    )
    rows = []
    with fitz.open(deck) as doc:
        for page in pages:
            text = doc[page - 1].get_text("text") if tool == "current" else f"# {tool} heading {page}\n\nbody of page {page}\n"
            run.write_page(page, text)
            rows.append(checks.check_page(text, facts.pages[page], facts))
    run.write_checks(rows)
    run.finish("finished", pages_scored=list(pages), seconds_per_page=0.01, peak_memory_mb=None, environment=["x"])
    return run


def page_entries(deck: Path) -> list[dict]:
    sha = sources.sha256_file(deck)
    return [{"key": f"d-p{n}", "source": "swt", "file": deck.name, "sha256": sha, "page": n,
             "type": TYPES[(n - 1) % len(TYPES)], "how": "chosen"} for n in range(1, 7)]


def make_comparison(root: Path, tmp: Path, *, entrants=ENTRANTS, seed=1) -> compare.CompareRun:
    deck = make_deck(tmp / "deck.pdf")
    sha = sources.sha256_file(deck)
    runs = {tool: {sha: make_extract_run(root, tool, deck).run_id} for tool in entrants}
    pages = page_entries(deck)
    duels = schedule.round1(list(entrants), [schedule.SchedPage(p["key"], p["type"]) for p in pages], seed)
    return compare.CompareRun.create(entrants=runs, pages=pages, seed=seed, duels=duels, protocol_commit="abc123", root=root)


def prefer(tool: str):
    """A judge who always picks `tool` and calls every other duel the same."""
    def choose(duel: dict) -> str:
        return "left" if duel["left"] == tool else "right" if duel["right"] == tool else "same"
    return choose


def vote_all(cmp: compare.CompareRun, choose=prefer("alphatool"), session: str = SESSION) -> None:
    while (duel := cmp.next_duel()) is not None:
        cmp.vote(duel=duel["duel"], choice=choose(duel), seconds=3.0, session=session)
```

`backend/tests/unit/test_parser_bench_compare.py`:

```python
import json
import re

import pytest

from backend.eval.parser_bench import compare, pageset, sources, store
from backend.tests.unit.parser_bench_compare_fixtures import SESSION, make_comparison, make_extract_run, vote_all
from backend.tests.unit.parser_bench_fixtures import make_deck


@pytest.fixture
def cmp(tmp_path):
    return make_comparison(tmp_path / "data", tmp_path)


def test_a_comparison_is_a_judging_record_with_its_schedule(cmp, tmp_path):
    m = cmp.meta
    assert re.fullmatch(r"cmp-\d{4}-\d{2}-\d{2}_[0-9a-f]{4}", cmp.run_id)
    assert (m["kind"], m["purpose"], m["status"], m["anchor"], m["protocol_commit"]) == ("compare", "benchmark", "judging", "current", "abc123")
    assert sorted(m["entrants"]) == ["alphatool", "betatool", "current"] and len(m["pages"]) == 6
    assert len(m["schedule"]) == 10 and m["seed"] == 1 and m["rounds"] == 1
    assert cmp.votes_path.read_text() == ""
    assert cmp.run_id in [r["run_id"] for r in store.list_runs(tmp_path / "data")]


def test_a_vote_is_one_appended_line_with_the_sides_from_the_schedule(cmp):
    first = cmp.next_duel()
    line = cmp.vote(duel=first["duel"], choice="left", seconds=4.26, session=SESSION, note="  footer twice  ")
    [stored] = [json.loads(x) for x in cmp.votes_path.read_text().splitlines()]
    assert stored == line
    assert (line["left"], line["right"], line["page"], line["seconds"], line["note"]) == (
        first["left"], first["right"], first["page"], 4.3, "footer twice")
    assert cmp.next_duel()["duel"] == first["duel"] + 1 and cmp.progress() == (1, 10)


@pytest.mark.parametrize(("change", "message"), [
    ({"duel": 5}, "not the next duel"),
    ({"choice": "both"}, "choice"),
    ({"session": "abc"}, "session"),
    ({"seconds": -1}, "seconds"),
])
def test_a_bad_vote_is_refused_and_writes_nothing(cmp, change, message):
    vote = {"duel": 0, "choice": "left", "seconds": 1.0, "session": SESSION, **change}
    with pytest.raises(ValueError, match=message):
        cmp.vote(**vote)
    assert cmp.votes_path.read_text() == ""


def test_undo_appends_a_retraction_and_the_duel_comes_back(cmp):
    first = cmp.next_duel()
    cmp.vote(duel=first["duel"], choice="right", seconds=2, session=SESSION)
    second = cmp.next_duel()
    cmp.vote(duel=second["duel"], choice="same", seconds=2, session=SESSION)
    retraction = cmp.undo(session=SESSION)
    assert retraction["duel"] == second["duel"] and cmp.next_duel()["duel"] == second["duel"]
    assert [e["type"] for e in cmp.events()] == ["vote", "vote", "retract"]  # nothing deleted
    cmp.vote(duel=second["duel"], choice="left", seconds=2, session=SESSION)
    assert cmp.active_votes()[second["duel"]]["choice"] == "left"
    assert cmp.undo(session=SESSION)["duel"] == second["duel"]
    assert cmp.undo(session=SESSION)["duel"] == first["duel"]
    assert cmp.undo(session=SESSION) is None


def test_an_empty_note_is_stored_as_none(cmp):
    assert cmp.vote(duel=0, choice="same", seconds=1, session=SESSION, note="   ")["note"] is None


def test_a_finished_comparison_refuses_votes_undo_and_round2(cmp):
    vote_all(cmp)
    cmp.finish()
    with pytest.raises(store.RunFinishedError):
        cmp.undo(session=SESSION)
    with pytest.raises(store.RunFinishedError):
        cmp.extend([])
    assert cmp.next_duel() is None and cmp.meta["finished_at"]


def test_the_output_of_an_entrant_for_a_page(cmp, tmp_path):
    assert cmp.output("alphatool", "d-p2", tmp_path / "data").startswith("# alphatool heading 2")
    with pytest.raises(FileNotFoundError):
        cmp.output("alphatool", "nope", tmp_path / "data")


def bench_pages(deck):
    sha = sources.sha256_file(deck)
    return [pageset.BenchPage(f"d-p{n}", "swt", deck.name, sha, n, t, "chosen", "r")
            for n, t in zip(range(1, 7), ("layout", "lists", "table_formula", "diagram", "dense_text", "lists"))]


def test_the_latest_matching_benchmark_run_of_each_tool_is_used(tmp_path):
    root = tmp_path / "data"
    deck = make_deck(tmp_path / "deck.pdf")
    pages = bench_pages(deck)
    make_extract_run(root, "current", deck, purpose="explore")
    make_extract_run(root, "current", deck, commit="old")
    wanted = make_extract_run(root, "current", deck)
    make_extract_run(root, "alphatool", deck, pages=range(1, 4))  # not the page set's pages
    with pytest.raises(ValueError, match="alphatool on deck.pdf"):
        compare.latest_benchmark_runs(["current", "alphatool"], pages, "abc123", root)
    assert compare.latest_benchmark_runs(["current"], pages, "abc123", root) == {"current": {pages[0].sha256: wanted.run_id}}


def test_a_benchmark_comparison_needs_a_committed_protocol(tmp_path):
    with pytest.raises(RuntimeError, match="PROTOCOL.md"):
        compare.create_benchmark(["current"], seed=1, commit=None, pages=[], root=tmp_path)


def test_create_benchmark_schedules_round_one(tmp_path):
    root = tmp_path / "data"
    deck = make_deck(tmp_path / "deck.pdf")
    for tool in ("current", "alphatool", "betatool"):
        make_extract_run(root, tool, deck)
    cmp = compare.create_benchmark(["current", "alphatool", "betatool"], seed=4, commit="abc123", pages=bench_pages(deck), root=root)
    m = cmp.meta
    assert len(m["schedule"]) == 10 and m["seed"] == 4 and "reason" not in m["pages"][0]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_compare.py -q`
Expected: FAIL with `ImportError: cannot import name 'compare'`

- [ ] **Step 3: Write `compare.py`**

`backend/eval/parser_bench/compare.py`:

```python
"""Comparison runs: a frozen duel schedule over extraction runs, and the append-only vote log.

runs/compare/cmp-<YYYY-MM-DD>_<4hex>/
  compare.json  purpose, entrants (tool → its extraction run per PDF), the pages with their types,
                protocol commit, seed and schedule. It changes only while status is "judging"
                (round 2 appends duels, an early unlock is noted); "finished" seals it.
  votes.jsonl   one JSON line per vote or retraction, appended and fsynced, never rewritten.
                Undo appends a retraction; it never deletes a line.
  results.json  recomputed from votes.jsonl by results.py, never edited by hand.
"""
from __future__ import annotations

import json
import os
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

from backend.eval.parser_bench import checks, pageset, schedule, store

CHOICES = ("left", "right", "same", "both_bad")
COMPARE_RECORD_VERSION = 1
SESSION = re.compile(r"s-[0-9a-f]{8,32}")
NOTE_MAX = 500


def new_compare_id(*, now: datetime | None = None, token: str | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    return f"cmp-{now:%Y-%m-%d}_{token or secrets.token_hex(2)}"


@dataclass(frozen=True)
class CompareRun:
    path: Path

    @property
    def run_id(self) -> str:
        return self.path.name

    @property
    def meta(self) -> dict[str, Any]:
        return json.loads((self.path / "compare.json").read_text(encoding="utf-8"))

    @property
    def votes_path(self) -> Path:
        return self.path / "votes.jsonl"

    @classmethod
    def open(cls, run_id: str, root: Path | None = None) -> "CompareRun":
        path = store.find_run(run_id, root)
        if not (path / "compare.json").exists():
            raise FileNotFoundError(f"{run_id} is not a comparison")
        return cls(path)

    @classmethod
    def create(
        cls,
        *,
        entrants: Mapping[str, Mapping[str, str]],
        pages: Sequence[Mapping[str, Any]],
        seed: int,
        duels: Sequence[Mapping[str, Any]],
        protocol_commit: str | None,
        purpose: str = "benchmark",
        anchor: str = "current",
        root: Path | None = None,
    ) -> "CompareRun":
        if purpose not in store.PURPOSES:
            raise ValueError(f"purpose must be one of {store.PURPOSES}, not {purpose!r}")
        if anchor not in entrants:
            raise ValueError(f"the anchor {anchor!r} must be one of the entrants")
        base = (root or store.data_root()) / "runs" / "compare"
        base.mkdir(parents=True, exist_ok=True)
        while True:
            path = base / new_compare_id()
            try:
                path.mkdir()
                break
            except FileExistsError:
                continue
        store._write_json(path / "compare.json", {
            "run_id": path.name,
            "kind": "compare",
            "record_version": COMPARE_RECORD_VERSION,
            "purpose": purpose,
            "status": "judging",
            "started_at": store.now_iso(),
            "finished_at": None,
            "protocol_commit": protocol_commit,
            "git": store.git_state(),
            "checks_version": checks.CHECKS_VERSION,
            "seed": seed,
            "anchor": anchor,
            "entrants": {tool: dict(runs) for tool, runs in sorted(entrants.items())},
            "pages": [dict(p) for p in pages],
            "schedule": [dict(d) for d in duels],
            "rounds": 1,
            "round2_duels": 0,
            "unlocked_early": None,
        })
        (path / "votes.jsonl").touch()
        return cls(path)

    # --- the record -------------------------------------------------------------------

    def _update(self, **fields: Any) -> None:
        meta = self.meta
        if meta["status"] != "judging":
            raise store.RunFinishedError(f"{self.run_id} is {meta['status']}; start a new comparison instead")
        meta.update(fields)
        store._write_json(self.path / "compare.json", meta)

    def extend(self, duels: Sequence[Mapping[str, Any]]) -> None:
        """Round 2: append duels (numbered on from the schedule) while judging."""
        meta = self.meta
        self._update(schedule=meta["schedule"] + [dict(d) for d in duels], rounds=meta["rounds"] + 1,
                     round2_duels=meta["round2_duels"] + len(duels))

    def finish(self) -> None:
        self._update(status="finished", finished_at=store.now_iso())

    def unlock_early(self, reason: str) -> None:
        done, total = self.progress()
        self._update(unlocked_early={"at": store.now_iso(), "reason": reason, "done": done, "total": total})

    # --- the vote log -----------------------------------------------------------------

    def _append(self, line: Mapping[str, Any]) -> None:
        with open(self.votes_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())

    def events(self) -> list[dict[str, Any]]:
        if not self.votes_path.exists():
            return []
        return [json.loads(line) for line in self.votes_path.read_text(encoding="utf-8").splitlines() if line.strip()]

    def active_votes(self) -> dict[int, dict[str, Any]]:
        """Each duel's vote that still counts: the latest one not retracted."""
        events = self.events()
        retracted = {e["vote_id"] for e in events if e["type"] == "retract"}
        active: dict[int, dict[str, Any]] = {}
        for e in events:
            if e["type"] == "vote" and e["vote_id"] not in retracted:
                active[e["duel"]] = e
        return active

    def progress(self) -> tuple[int, int]:
        return len(self.active_votes()), len(self.meta["schedule"])

    def next_duel(self) -> dict[str, Any] | None:
        """The first scheduled duel without a vote; after an undo, the duel that lost its vote."""
        active = self.active_votes()
        return next((d for d in self.meta["schedule"] if d["duel"] not in active), None)

    def vote(self, *, duel: int, choice: str, seconds: float, session: str, note: str | None = None) -> dict[str, Any]:
        if self.meta["status"] != "judging":
            raise store.RunFinishedError(f"{self.run_id} is finished")
        if choice not in CHOICES:
            raise ValueError(f"choice must be one of {CHOICES}")
        if not SESSION.fullmatch(session):
            raise ValueError("session must look like s-<hex>")
        if not 0 <= float(seconds) < 24 * 3600:
            raise ValueError("seconds must be between 0 and a day")
        expected = self.next_duel()
        if expected is None or expected["duel"] != duel:
            raise ValueError(f"duel {duel} is not the next duel to judge")
        line = {
            "type": "vote",
            "vote_id": f"v-{secrets.token_hex(4)}",
            "duel": duel,
            "page": expected["page"],
            "left": expected["left"],
            "right": expected["right"],
            "choice": choice,
            "seconds": round(float(seconds), 1),
            "session": session,
            "at": store.now_iso(),
            "note": (note or "").strip()[:NOTE_MAX] or None,
        }
        self._append(line)
        return line

    def undo(self, *, session: str) -> dict[str, Any] | None:
        """Withdraw the most recent vote that still counts, by appending a retraction."""
        if self.meta["status"] != "judging":
            raise store.RunFinishedError(f"{self.run_id} is finished")
        if not SESSION.fullmatch(session):
            raise ValueError("session must look like s-<hex>")
        active = self.active_votes()
        if not active:
            return None
        last = max(active.values(), key=lambda v: self._order(v["vote_id"]))
        line = {"type": "retract", "vote_id": last["vote_id"], "duel": last["duel"], "session": session, "at": store.now_iso()}
        self._append(line)
        return line

    def _order(self, vote_id: str) -> int:
        return next(i for i, e in enumerate(self.events()) if e.get("vote_id") == vote_id and e["type"] == "vote")

    # --- outputs ----------------------------------------------------------------------

    def page(self, key: str) -> dict[str, Any]:
        for p in self.meta["pages"]:
            if p["key"] == key:
                return p
        raise FileNotFoundError(f"{self.run_id} has no page {key!r}")

    def output(self, tool: str, key: str, root: Path | None = None) -> str:
        """The Markdown an entrant produced for one page of this comparison."""
        page = self.page(key)
        run_id = self.meta["entrants"][tool][page["sha256"]]
        run = store.ExtractRun(store.find_run(run_id, root))
        return run.pages()[int(page["page"])]


def latest_benchmark_runs(tools: Sequence[str], pages: Sequence[pageset.BenchPage], commit: str,
                          root: Path | None = None) -> dict[str, dict[str, str]]:
    """Per tool and PDF, the newest finished benchmark run made under this protocol commit that
    scored exactly the page set's pages of that PDF with the current checks."""
    metas = [m for m in store.list_runs(root) if m.get("kind") == "extract"]  # newest first
    files = {p.sha256: p.file for p in pages}
    entrants: dict[str, dict[str, str]] = {}
    missing = []
    for tool in tools:
        entrants[tool] = {}
        for sha, file in sorted(files.items()):
            want = pageset.pages_for(sha, pages)
            match = next((m for m in metas
                          if m.get("tool") == tool and m.get("status") == "finished" and m.get("purpose") == "benchmark"
                          and m.get("source", {}).get("sha256") == sha and m.get("protocol_commit") == commit
                          and store.checks_version(m) == checks.CHECKS_VERSION and sorted(m.get("pages_scored") or []) == want),
                         None)
            if match is None:
                missing.append(f"{tool} on {file}")
            else:
                entrants[tool][sha] = match["run_id"]
    if missing:
        raise ValueError("no finished benchmark run under this protocol for: " + "; ".join(missing))
    return entrants


def create_benchmark(tools: Sequence[str], *, seed: int, commit: str | None, pages: Sequence[pageset.BenchPage] | None = None,
                     anchor: str = "current", root: Path | None = None) -> CompareRun:
    """A new blind comparison of `tools` on the page set, from their latest benchmark runs."""
    if commit is None:
        raise RuntimeError("a benchmark comparison needs PROTOCOL.md committed and unmodified")
    pages = pageset.load() if pages is None else list(pages)
    entrants = latest_benchmark_runs(tools, pages, commit, root)
    duels = schedule.round1(list(tools), [schedule.SchedPage(p.key, p.type) for p in pages], seed)
    return CompareRun.create(entrants=entrants, pages=[pageset.as_entry(p) for p in pages], seed=seed,
                             duels=duels, protocol_commit=commit, anchor=anchor, root=root)


def list_comparisons(root: Path | None = None) -> list[CompareRun]:
    base = (root or store.data_root()) / "runs" / "compare"
    if not base.is_dir():
        return []
    runs = [CompareRun(p) for p in base.iterdir() if (p / "compare.json").exists()]
    return sorted(runs, key=lambda r: r.meta.get("started_at") or "", reverse=True)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_compare.py backend/tests/unit/test_parser_bench_store.py -q`
Expected: `70 passed` (13 + 57). The store's export tests already cover a comparison's notes being dropped.

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/compare.py backend/tests/unit/parser_bench_compare_fixtures.py backend/tests/unit/test_parser_bench_compare.py
git commit -m "feat(parser-bench): comparison runs with an append-only, fsynced vote log, undo as retraction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Results from the votes and the stopping rule (`results.py`)

**Files:**
- Create: `backend/eval/parser_bench/results.py`
- Create: `backend/tests/unit/test_parser_bench_results.py`

**Interfaces:**
- Consumes:
  - `ranking.rate`, `outcome` and `RESAMPLES`;
  - `schedule.needs_round2`, `round2_batch`, `SchedPage` and `ROUND2_CAP`;
  - `CompareRun`;
  - `store.ExtractRun.typed_checks`.
- Produces:
  - `REFERENCE_BIASED = ("current", "pymupdf4llm")`.
  - `votes_digest(cmp) -> str`.
  - `self_consistency(meta, active) -> {"agree", "total", "share"}`.
  - `win_rate_by_type(meta, votes) -> {tool: {type: {"duels", "score"}}}`.
  - `tallies(entrants, votes) -> {tool: {"duels", "wins", "losses", "same", "both_bad"}}`.
  - `check_table(meta, root=None) -> {tool: {...}}`, which carries `seconds_per_page`, `peak_memory_mb` (nullable) and `reference_biased`.
  - `summarize(cmp, *, resamples=1000, root=None) -> dict`.
  - `write_results(cmp, ...) -> dict`.
  - `current_results(cmp, ...) -> dict`, which reuses `results.json` only when its digest, status and resamples match.
  - `advance(cmp, ...) -> {"added": int, "finished": bool}`.
- `results.json` holds these keys:
  - `run_id, status, votes_digest, votes, retracted, scheduled, rounds, round2_duels, anchor, bootstrap{resamples, seed}`
  - `ranking[{entrant, points, lo, hi, duels, wins, losses, same, both_bad}]`
  - `h1{holds, above_anchor}, self_consistency, win_rate_by_type, median_seconds, checks`

  It carries no time stamp, so recomputing it gives the same bytes. The bootstrap seed is the comparison's seed.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_parser_bench_results.py`:

```python
import json

import pytest

from backend.eval.parser_bench import results, schedule
from backend.tests.unit.parser_bench_compare_fixtures import SESSION, make_comparison, prefer, vote_all

FAST = 60  # bootstrap resamples in tests


@pytest.fixture
def cmp(tmp_path):
    return make_comparison(tmp_path / "data", tmp_path)


def test_the_preferred_tool_ranks_first_and_current_is_1000(cmp, tmp_path):
    vote_all(cmp, prefer("alphatool"))
    data = results.summarize(cmp, resamples=FAST, root=tmp_path / "data")
    top, *_ = data["ranking"]
    assert top["entrant"] == "alphatool" and top["points"] > 1000 and top["wins"] == top["duels"] > 0
    anchor = next(r for r in data["ranking"] if r["entrant"] == "current")
    assert (anchor["points"], anchor["lo"], anchor["hi"]) == (1000.0, 1000.0, 1000.0)
    assert data["votes"] == 10 and data["median_seconds"] == 3.0
    assert data["bootstrap"] == {"resamples": FAST, "seed": 1}


def test_self_consistency_counts_repeats_judged_alike(cmp, tmp_path):
    vote_all(cmp, prefer("alphatool"))  # the same tool wins whichever side it is on
    assert results.summarize(cmp, resamples=FAST, root=tmp_path / "data")["self_consistency"] == {"agree": 1, "total": 1, "share": 1.0}


def test_always_left_disagrees_with_itself_on_a_swapped_repeat(tmp_path):
    cmp = make_comparison(tmp_path / "data", tmp_path)
    vote_all(cmp, lambda duel: "left")
    assert results.summarize(cmp, resamples=FAST, root=tmp_path / "data")["self_consistency"]["agree"] == 0


def test_win_rates_by_page_type_and_both_unusable_on_their_own(cmp, tmp_path):
    vote_all(cmp, lambda duel: "both_bad")
    data = results.summarize(cmp, resamples=FAST, root=tmp_path / "data")
    assert all(cell["score"] == 0.5 for by_type in data["win_rate_by_type"].values() for cell in by_type.values())
    assert sum(r["both_bad"] for r in data["ranking"]) == 20  # 10 duels, two sides each


def test_the_check_table_marks_the_reference_bias(cmp, tmp_path):
    table = results.summarize(cmp, resamples=FAST, root=tmp_path / "data")["checks"]
    assert table["current"]["footer_leaks"] > 0 and table["alphatool"]["footer_leaks"] == 0
    assert table["current"]["reference_biased"] and not table["alphatool"]["reference_biased"]
    assert table["current"]["peak_memory_mb"] is None and table["current"]["pages"] == 6


def test_results_are_a_function_of_the_votes(cmp, tmp_path):
    vote_all(cmp)
    root = tmp_path / "data"
    results.write_results(cmp, resamples=FAST, root=root)
    first = (cmp.path / "results.json").read_bytes()
    results.write_results(cmp, resamples=FAST, root=root)
    assert (cmp.path / "results.json").read_bytes() == first
    assert results.current_results(cmp, resamples=FAST, root=root)["votes_digest"] == results.votes_digest(cmp)


def test_stale_results_are_recomputed(cmp, tmp_path):
    root = tmp_path / "data"
    results.write_results(cmp, resamples=FAST, root=root)
    cmp.vote(duel=0, choice="left", seconds=1, session=SESSION)
    assert results.current_results(cmp, resamples=FAST, root=root)["votes"] == 1
    assert json.loads((cmp.path / "results.json").read_text())["votes"] == 1


def test_a_clear_winner_finishes_after_round_one(cmp, tmp_path):
    vote_all(cmp, prefer("alphatool"))
    assert results.advance(cmp, resamples=FAST, root=tmp_path / "data") == {"added": 0, "finished": True}
    assert cmp.meta["status"] == "finished" and (cmp.path / "results.json").exists()


def test_overlapping_leaders_get_round_two_until_the_cap(cmp, tmp_path):
    root = tmp_path / "data"
    assert results.advance(cmp, resamples=FAST, root=root) == {"added": 0, "finished": False}  # nothing judged yet
    rounds = 0
    while cmp.meta["status"] == "judging":
        vote_all(cmp, lambda duel: "same")
        results.advance(cmp, resamples=FAST, root=root)
        rounds += 1
        assert rounds < 30
    m = cmp.meta
    assert m["round2_duels"] == schedule.ROUND2_CAP == 75
    assert all(d["round"] == 2 for d in m["schedule"][10:]) and len(m["schedule"]) == 85
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_results.py -q`
Expected: FAIL with `ImportError: cannot import name 'results'`

- [ ] **Step 3: Write `results.py`**

`backend/eval/parser_bench/results.py`:

```python
"""results.json: what the scoreboard shows, recomputed from votes.jsonl (spec "Analysis").

A pure function of compare.json, votes.jsonl and the entrants' checks.csv. It carries no time
stamp, so recomputing it gives the same file, and it names the digest of the votes it was
computed from, so a stale copy is never shown.
"""
from __future__ import annotations

import hashlib
import json
import statistics
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from backend.eval.parser_bench import ranking, schedule, store
from backend.eval.parser_bench.compare import CompareRun

REFERENCE_BIASED = ("current", "pymupdf4llm")  # checks 6–7 use PyMuPDF's own text layer as the reference


def votes_digest(cmp: CompareRun) -> str:
    return hashlib.sha256(cmp.votes_path.read_bytes() if cmp.votes_path.exists() else b"").hexdigest()


def _outcome_label(vote: Mapping[str, Any]) -> str:
    """Who won a duel: the winning entrant, or "same" / "both_bad"."""
    return {"left": vote["left"], "right": vote["right"]}.get(vote["choice"], vote["choice"])


def self_consistency(meta: Mapping[str, Any], active: Mapping[int, Mapping[str, Any]]) -> dict[str, Any]:
    """Share of hidden repeats judged like their original; "Same" against a winner disagrees."""
    agree = total = 0
    for d in meta["schedule"]:
        original = d.get("repeat_of")
        if original is None or d["duel"] not in active or original not in active:
            continue
        total += 1
        agree += _outcome_label(active[d["duel"]]) == _outcome_label(active[original])
    return {"agree": agree, "total": total, "share": round(agree / total, 3) if total else None}


def _score(vote: Mapping[str, Any], side: str) -> float:
    other = "right" if side == "left" else "left"
    return {side: 1.0, other: 0.0}.get(vote["choice"], 0.5)


def win_rate_by_type(meta: Mapping[str, Any], votes: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, dict[str, Any]]]:
    """Per entrant and page type: duels and score share (a win 1, a draw ½). Descriptive only."""
    types = {d["duel"]: d["type"] for d in meta["schedule"]}
    tally: dict[str, dict[str, list[float]]] = {}
    for v in votes:
        for side in ("left", "right"):
            cell = tally.setdefault(v[side], {}).setdefault(types[v["duel"]], [0, 0.0])
            cell[0] += 1
            cell[1] += _score(v, side)
    return {tool: {t: {"duels": int(n), "score": round(s / n, 3)} for t, (n, s) in sorted(by_type.items())}
            for tool, by_type in sorted(tally.items())}


def tallies(entrants: Sequence[str], votes: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, int]]:
    out = {e: {"duels": 0, "wins": 0, "losses": 0, "same": 0, "both_bad": 0} for e in entrants}
    for v in votes:
        for side in ("left", "right"):
            row = out[v[side]]
            row["duels"] += 1
            if v["choice"] in ("same", "both_bad"):
                row[v["choice"]] += 1
            elif v["choice"] == side:
                row["wins"] += 1
            else:
                row["losses"] += 1
    return out


def _mean(values: Iterable[Any]) -> float | None:
    kept = [v for v in values if v is not None]
    return round(sum(kept) / len(kept), 3) if kept else None


def _share(values: Iterable[Any]) -> float | None:
    kept = [v for v in values if v is not None]
    return round(sum(bool(v) for v in kept) / len(kept), 3) if kept else None


def check_table(meta: Mapping[str, Any], root: Path | None = None) -> dict[str, dict[str, Any]]:
    """Every automatic check per entrant over the comparison's pages, with its cost."""
    wanted = {(p["sha256"], int(p["page"])) for p in meta["pages"]}
    table = {}
    for tool, runs in sorted(meta["entrants"].items()):
        rows: list[dict[str, Any]] = []
        seconds, peaks = [], []
        for sha, run_id in sorted(runs.items()):
            run = store.ExtractRun(store.find_run(run_id, root))
            rows += [r for r in run.typed_checks() if (sha, r["page"]) in wanted]
            run_meta = run.meta
            if run_meta.get("seconds_per_page") is not None:
                seconds.append(run_meta["seconds_per_page"])
            if run_meta.get("peak_memory_mb") is not None:
                peaks.append(run_meta["peak_memory_mb"])

        def total(field: str) -> int:
            return sum(r.get(field) or 0 for r in rows)

        table[tool] = {
            "pages": len(rows),
            "footer_leaks": total("footer_leaks"),
            "pages_with_footer_leak": sum(bool(r.get("footer_leaked")) for r in rows),
            "footer_token_share": _mean(r.get("footer_token_share") for r in rows),
            "title_first": _share(r.get("title_first") for r in rows),
            "wrong_symbols": total("wrong_symbols"),
            "lonely_bullets": total("lonely_bullets"),
            "broken_line_pct": _mean(r.get("broken_line_pct") for r in rows),
            "dropped_words_pct": _mean(r.get("dropped_words_pct") for r in rows),
            "invented_words_pct": _mean(r.get("invented_words_pct") for r in rows),
            "headings": total("headings"),
            "list_items": total("list_items"),
            "tables": total("tables"),
            "math_spans": total("math_spans"),
            "seconds_per_page": _mean(seconds),
            "peak_memory_mb": max(peaks) if peaks else None,
            "reference_biased": tool in REFERENCE_BIASED,
        }
    return table


def summarize(cmp: CompareRun, *, resamples: int = ranking.RESAMPLES, root: Path | None = None) -> dict[str, Any]:
    meta = cmp.meta
    active = cmp.active_votes()
    votes = [active[k] for k in sorted(active)]
    entrants = sorted(meta["entrants"])
    rows = ranking.rate([ranking.outcome(v["left"], v["right"], v["choice"]) for v in votes], entrants,
                        meta["anchor"], resamples=resamples, seed=meta["seed"])
    counts = tallies(entrants, votes)
    above = [r["entrant"] for r in rows if r["entrant"] != meta["anchor"] and r["lo"] > 1000.0]
    return {
        "run_id": meta["run_id"],
        "status": meta["status"],
        "votes_digest": votes_digest(cmp),
        "votes": len(votes),
        "retracted": sum(e["type"] == "retract" for e in cmp.events()),
        "scheduled": len(meta["schedule"]),
        "rounds": meta["rounds"],
        "round2_duels": meta["round2_duels"],
        "anchor": meta["anchor"],
        "bootstrap": {"resamples": resamples, "seed": meta["seed"]},
        "ranking": [dict(r, **counts[r["entrant"]]) for r in rows],
        "h1": {"holds": bool(above), "above_anchor": above},
        "self_consistency": self_consistency(meta, active),
        "win_rate_by_type": win_rate_by_type(meta, votes),
        "median_seconds": round(statistics.median(v["seconds"] for v in votes), 1) if votes else None,
        "checks": check_table(meta, root),
    }


def write_results(cmp: CompareRun, *, resamples: int = ranking.RESAMPLES, root: Path | None = None) -> dict[str, Any]:
    data = summarize(cmp, resamples=resamples, root=root)
    store._write_json(cmp.path / "results.json", data)
    return data


def current_results(cmp: CompareRun, *, resamples: int = ranking.RESAMPLES, root: Path | None = None) -> dict[str, Any]:
    """results.json if it was computed from the votes as they are now; otherwise recomputed and rewritten."""
    path = cmp.path / "results.json"
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        if (data.get("votes_digest"), data.get("status"), data.get("bootstrap", {}).get("resamples")) == (
                votes_digest(cmp), cmp.meta["status"], resamples):
            return data
    return write_results(cmp, resamples=resamples, root=root)


def advance(cmp: CompareRun, *, resamples: int = ranking.RESAMPLES, root: Path | None = None) -> dict[str, Any]:
    """After a vote. When every scheduled duel has a vote, apply the stopping rule: add the next
    round-2 batch while the top two overlap and the 75-duel cap has room, or else finish."""
    meta = cmp.meta
    if meta["status"] != "judging":
        return {"added": 0, "finished": True}
    done, total = cmp.progress()
    if done < total:
        return {"added": 0, "finished": False}
    data = summarize(cmp, resamples=resamples, root=root)
    room = schedule.ROUND2_CAP - meta["round2_duels"]
    if room > 0 and schedule.needs_round2(data["ranking"]):
        pages = [schedule.SchedPage(p["key"], p["type"]) for p in meta["pages"]]
        batch = schedule.round2_batch([r["entrant"] for r in data["ranking"]], pages, meta["schedule"],
                                      meta["seed"], meta["rounds"], room)
        if batch:
            cmp.extend(batch)
            return {"added": len(batch), "finished": False}
    cmp.finish()
    write_results(cmp, resamples=resamples, root=root)
    return {"added": 0, "finished": True}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_results.py -q`
Expected: `9 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/results.py backend/tests/unit/test_parser_bench_results.py
git commit -m "feat(parser-bench): results.json recomputed from the votes; the stopping rule adds round 2 or finishes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Files and the blinding lock (`files.py`, `blinding.py`)

**Files:**
- Create: `backend/eval/parser_bench/files.py`
- Create: `backend/eval/parser_bench/blinding.py`
- Create: `backend/tests/unit/test_parser_bench_files.py`

**Interfaces:**
- Consumes:
  - `sources.page_count`, `render_png` and `sha256_file`;
  - `pageset.load_or_empty`;
  - `store.list_runs`;
  - `compare.CompareRun` and `list_comparisons`.
- Produces from `files.py`:
  - `MAX_BYTES` (300 MB) and `PNG_ZOOM = 2.0`.
  - `StoredFile(sha256, name, path, pages, size)`, with `.as_dict()`, which leaves out the path.
  - `files_root(root=None)`, `check_sha(sha256)` and `safe_name(name)`.
  - `store_pdf(data, name, *, root=None) -> StoredFile`.
  - `list_files(root=None)` and `find_file(sha256, root=None)`.
  - `resolve_pdf(sha256, root=None) -> Path`, which tries, in order, a stored upload, a page-set file under `DECK_DIR`, and a run's `source.path`, each verified by hash.
  - `page_png(sha256, page, root=None) -> bytes`, cached under `<data>/cache/png/`.
- Produces from `blinding.py`:
  - `LAB_LOG`.
  - `Locked(Exception)`.
  - `locked_pages(root=None, pages=None) -> set[(sha256, page)]`.
  - `check(sha256, page, locked)`, which raises `Locked`.
  - `comparison_locked(meta) -> bool`.
  - `unlock_early(cmp, reason, *, lab_log=None)`.

**The lock** (resolves "until judging is finished" for every view):
- **When a page is locked.** A page-set page is locked from the moment `pages.json` exists until a benchmark comparison covering it is finished or was unlocked early. While any benchmark comparison is still judging, its pages are locked.
- **What it covers.** It applies to every run's output of that page, explore runs of the benchmark PDFs included, and to the page's checks.
- **Second comparison.** A second comparison locks the pages again.
- **Early unlock.** Unlocking early needs a reason. It is appended to `LAB_LOG.md` as a dated deviation, and Abi commits it with the next lab-log change.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_parser_bench_files.py`:

```python
import pytest

from backend.eval.parser_bench import blinding, files, pageset
from backend.tests.unit.parser_bench_compare_fixtures import make_comparison, make_extract_run, vote_all
from backend.tests.unit.parser_bench_fixtures import make_deck


def test_an_upload_is_stored_once_by_its_hash(tmp_path):
    data = make_deck(tmp_path / "deck.pdf").read_bytes()
    first = files.store_pdf(data, "../../Lecture 1.pdf", root=tmp_path / "data")
    again = files.store_pdf(data, "other.pdf", root=tmp_path / "data")
    assert first == again and first.name == "Lecture 1.pdf" and first.pages == 6
    assert first.path == tmp_path / "data" / "files" / first.sha256 / "Lecture 1.pdf"
    assert files.list_files(tmp_path / "data") == [first]
    assert "path" not in first.as_dict()


@pytest.mark.parametrize(("data", "message"), [(b"hello", "not a PDF"), (b"%PDF-1.7 broken", "cannot be read")])
def test_what_is_not_a_readable_pdf_is_refused(tmp_path, data, message):
    with pytest.raises(ValueError, match=message):
        files.store_pdf(data, "x.pdf", root=tmp_path)
    assert files.list_files(tmp_path) == []


@pytest.mark.parametrize(("name", "safe"), [("a/b/c.PDF", "c.PDF"), ("notes", "notes.pdf"), ("", "upload.pdf"), ("x;rm -rf.pdf", "x_rm -rf.pdf")])
def test_safe_names(name, safe):
    assert files.safe_name(name) == safe


def test_a_bad_sha_is_refused(tmp_path):
    with pytest.raises(ValueError, match="SHA-256"):
        files.find_file("../etc", tmp_path)


def test_a_page_image_comes_from_a_run_source_and_is_cached(tmp_path):
    root = tmp_path / "data"
    deck = make_deck(tmp_path / "deck.pdf")
    run = make_extract_run(root, "current", deck, purpose="explore")
    sha = run.meta["source"]["sha256"]
    png = files.page_png(sha, 2, root)
    assert png.startswith(b"\x89PNG") and (root / "cache" / "png" / f"{sha}-2.png").exists()
    with pytest.raises(FileNotFoundError):
        files.resolve_pdf("0" * 64, root)


def test_benchmark_pages_are_locked_until_their_comparison_is_judged(tmp_path):
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path)
    sha = cmp.meta["pages"][0]["sha256"]
    assert (sha, 1) in blinding.locked_pages(root, pages=[])
    with pytest.raises(blinding.Locked):
        blinding.check(sha, 1, blinding.locked_pages(root, pages=[]))
    vote_all(cmp)
    cmp.finish()
    assert blinding.locked_pages(root, pages=[]) == set()


def test_page_set_pages_are_locked_before_any_comparison_exists(tmp_path):
    page = pageset.BenchPage("swt-p3", "swt", "x.pdf", "a" * 64, 3, "lists", "chosen", "r")
    assert blinding.locked_pages(tmp_path, pages=[page]) == {("a" * 64, 3)}


def test_a_second_comparison_locks_the_pages_again(tmp_path):
    root = tmp_path / "data"
    first = make_comparison(root, tmp_path)
    vote_all(first)
    first.finish()
    make_comparison(root, tmp_path)
    assert len(blinding.locked_pages(root, pages=[])) == 6


def test_unlocking_early_opens_the_pages_and_writes_a_deviation(tmp_path):
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path)
    log = tmp_path / "LAB_LOG.md"
    log.write_text("# log\n")
    with pytest.raises(ValueError, match="why"):
        blinding.unlock_early(cmp, "  ", lab_log=log)
    blinding.unlock_early(cmp, "checking the\nrenderer", lab_log=log)
    assert blinding.locked_pages(root, pages=[]) == set()
    text = log.read_text()
    assert "deviation: blinding lock lifted early" in text and "0 of 10 duels" in text and "checking the renderer" in text
    assert cmp.meta["unlocked_early"]["reason"] == "checking the renderer"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_files.py -q`
Expected: FAIL with `ImportError: cannot import name 'blinding'`

- [ ] **Step 3: Write `files.py` and `blinding.py`**

`backend/eval/parser_bench/files.py`:

```python
"""PDFs for the webpage: uploads stored by SHA-256 under the data directory (never in git), and
the PDF behind any SHA-256 for page images."""
from __future__ import annotations

import hashlib
import os
import re
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from backend.eval.decks import DECK_DIR
from backend.eval.parser_bench import pageset, store
from backend.eval.parser_bench.sources import page_count, render_png, sha256_file

MAX_BYTES = 300 * 2**20
PNG_ZOOM = 2.0
_SHA = re.compile(r"[0-9a-f]{64}")
_resolved: dict[str, Path] = {}  # sha256 → a PDF already verified to have that hash


@dataclass(frozen=True)
class StoredFile:
    sha256: str
    name: str
    path: Path
    pages: int
    size: int

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data.pop("path")  # the browser never needs a local path
        return data


def files_root(root: Path | None = None) -> Path:
    return (root or store.data_root()) / "files"


def check_sha(sha256: str) -> str:
    if not _SHA.fullmatch(sha256):
        raise ValueError(f"{sha256!r} is not a SHA-256")
    return sha256


def safe_name(name: str) -> str:
    """The upload's own file name, without folders or odd characters, ending in .pdf."""
    base = Path((name or "").replace("\\", "/")).name
    cleaned = re.sub(r"[^\w .()+-]", "_", base).strip(" .")[:120]
    if not cleaned.lower().endswith(".pdf"):
        cleaned = (cleaned or "upload") + ".pdf"
    return cleaned


def _describe(path: Path) -> StoredFile:
    return StoredFile(path.parent.name, path.name, path, page_count(path), path.stat().st_size)


def store_pdf(data: bytes, name: str, *, root: Path | None = None) -> StoredFile:
    """Keep an uploaded PDF as files/<sha256>/<name>; the same bytes are stored once."""
    if len(data) > MAX_BYTES:
        raise ValueError(f"the file is larger than {MAX_BYTES // 2**20} MB")
    if not data.startswith(b"%PDF-"):
        raise ValueError("that is not a PDF")
    sha = hashlib.sha256(data).hexdigest()
    folder = files_root(root) / sha
    existing = sorted(folder.glob("*.pdf")) if folder.is_dir() else []
    if existing:
        return _describe(existing[0])
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / safe_name(name)
    tmp = folder / ".upload.tmp"
    tmp.write_bytes(data)
    os.replace(tmp, path)
    try:
        return _describe(path)
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise ValueError("the PDF cannot be read") from None


def list_files(root: Path | None = None) -> list[StoredFile]:
    base = files_root(root)
    if not base.is_dir():
        return []
    found = [sorted(folder.glob("*.pdf")) for folder in base.iterdir() if folder.is_dir() and _SHA.fullmatch(folder.name)]
    return sorted((_describe(paths[0]) for paths in found if paths), key=lambda f: f.name.lower())


def find_file(sha256: str, root: Path | None = None) -> StoredFile:
    folder = files_root(root) / check_sha(sha256)
    paths = sorted(folder.glob("*.pdf")) if folder.is_dir() else []
    if not paths:
        raise FileNotFoundError(f"no stored file {sha256[:12]}…")
    return _describe(paths[0])


def resolve_pdf(sha256: str, root: Path | None = None) -> Path:
    """A PDF on this Mac with that SHA-256: a stored upload, a benchmark source, or a run's source."""
    check_sha(sha256)
    known = _resolved.get(sha256)
    if known is not None and known.exists():
        return known
    try:
        path = find_file(sha256, root).path
    except FileNotFoundError:
        candidates = [DECK_DIR / p.file for p in pageset.load_or_empty() if p.sha256 == sha256]
        candidates += [Path(m["source"]["path"]) for m in store.list_runs(root)
                       if m.get("kind") == "extract" and m.get("source", {}).get("sha256") == sha256 and m["source"].get("path")]
        path = next((c for c in candidates if c.exists() and sha256_file(c) == sha256), None)
        if path is None:
            raise FileNotFoundError(f"no PDF with SHA-256 {sha256[:12]}… on this Mac") from None
    _resolved[sha256] = path
    return path


def page_png(sha256: str, page: int, root: Path | None = None) -> bytes:
    """The page as a PNG at 2× (cached under cache/png). Images never show a tool's output."""
    cache = (root or store.data_root()) / "cache" / "png" / f"{check_sha(sha256)}-{int(page)}.png"
    if cache.exists():
        return cache.read_bytes()
    png = render_png(resolve_pdf(sha256, root), int(page), zoom=PNG_ZOOM)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(png)
    return png
```

`backend/eval/parser_bench/blinding.py`:

```python
"""The blinding lock (spec "The webpage").

A benchmark-set page is locked until it has been judged: from the moment the page set exists,
until every benchmark comparison over it is finished. While locked, no output of that page is
shown anywhere, whichever run it comes from (explore runs of a benchmark deck included): not in
Runs, Compare, the Scoreboard or My votes. Only the duels show it, without names. Abi may unlock a
comparison early; that is written to the lab log as a deviation.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Iterable

from backend.eval.parser_bench import pageset, store
from backend.eval.parser_bench.compare import CompareRun, list_comparisons

LAB_LOG = store.REPO / "docs" / "thesis" / "experiments" / "parser-benchmark" / "LAB_LOG.md"
PageRef = tuple[str, int]  # (sha256, page)


class Locked(Exception):
    """An output view of a page that is still being judged blind."""


def _open(meta: dict) -> bool:
    return meta["status"] == "finished" or bool(meta.get("unlocked_early"))


def locked_pages(root: Path | None = None, pages: Iterable[pageset.BenchPage] | None = None) -> set[PageRef]:
    metas = [c.meta for c in list_comparisons(root)]
    metas = [m for m in metas if m.get("purpose") == "benchmark"]
    locked = {(p["sha256"], int(p["page"])) for m in metas if not _open(m) for p in m["pages"]}
    judged = {(p["sha256"], int(p["page"])) for m in metas if _open(m) for p in m["pages"]}
    page_set = pageset.load_or_empty() if pages is None else pages
    return locked | ({(p.sha256, p.page) for p in page_set} - judged)


def check(sha256: str, page: int, locked: set[PageRef]) -> None:
    if (sha256, int(page)) in locked:
        raise Locked("this page is in the benchmark set and still being judged blind; "
                     "its outputs open when judging is finished")


def comparison_locked(meta: dict) -> bool:
    return meta.get("purpose") == "benchmark" and not _open(meta)


def unlock_early(cmp: CompareRun, reason: str, *, lab_log: Path | None = None) -> None:
    """Lift the lock before judging is finished, and log it as a deviation."""
    lab_log = LAB_LOG if lab_log is None else lab_log
    reason = " ".join(reason.split())
    if not reason:
        raise ValueError("say why the lock is lifted early; it goes into the lab log")
    cmp.unlock_early(reason)
    done, total = cmp.progress()
    with open(lab_log, "a", encoding="utf-8") as f:
        f.write(f"\n## {date.today().isoformat()} — deviation: blinding lock lifted early\n\n"
                f"- Comparison `{cmp.run_id}`: {done} of {total} duels judged when the lock was lifted.\n"
                f"- Reason given: {reason}\n")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_files.py -q`
Expected: `13 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/files.py backend/eval/parser_bench/blinding.py backend/tests/unit/test_parser_bench_files.py
git commit -m "feat(parser-bench): uploads by SHA-256, cached page images, and the blinding lock with logged early unlock

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The command line: `compare create` and `compare status`

**Files:**
- Modify: `backend/eval/parser_bench/__main__.py`
- Modify: `backend/tests/unit/test_parser_bench_cli.py`

**Interfaces:**
- Consumes: `compare.create_benchmark`, `list_comparisons` and `CompareRun.open`; `execute.protocol_commit`; `results.current_results`; `blinding.comparison_locked`.
- Produces:
  - `compare create --tools a,b,c --seed N` prints `<cmp_id>  judging  0/<n> duels` and the folder, and exits 0. Exit 2 means no protocol or a missing run, with one line on stderr.
  - `compare status [<cmp_id>]` prints progress. It adds the ranking, self-consistency, median time and H1 only when the comparison is no longer locked.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_parser_bench_cli.py`:

```python


# --- Plan 2: compare -----------------------------------------------------------------

from backend.tests.unit.parser_bench_compare_fixtures import make_comparison, make_extract_run, vote_all  # noqa: E402


def test_compare_create_needs_the_protocol(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(execute, "protocol_commit", lambda: None)
    assert cli.main(["compare", "create", "--tools", "current,pdfjs", "--seed", "1"]) == 2
    assert "PROTOCOL.md" in capsys.readouterr().err


def test_compare_create_from_benchmark_runs(monkeypatch, capsys, tmp_path):
    root = tmp_path / "data"
    monkeypatch.setenv("PARSER_BENCH_DIR", str(root))
    deck = make_deck(tmp_path / "deck.pdf")
    sha = sources.sha256_file(deck)
    pages = [pageset.BenchPage(f"d-p{n}", "swt", "deck.pdf", sha, n, t, "chosen", "r")
             for n, t in zip(range(1, 7), ("layout", "lists", "table_formula", "diagram", "dense_text", "lists"))]
    monkeypatch.setattr(pageset, "load", lambda path=pageset.PAGESET: pages)
    monkeypatch.setattr(execute, "protocol_commit", lambda: "abc123")
    for tool in ("current", "pdfjs"):
        make_extract_run(root, tool, deck)
    assert cli.main(["compare", "create", "--tools", "current,pdfjs", "--seed", "3"]) == 0
    assert "judging  0/3 duels" in capsys.readouterr().out


def test_compare_status_hides_names_until_judging_is_finished(monkeypatch, capsys, tmp_path):
    root = tmp_path / "data"
    monkeypatch.setenv("PARSER_BENCH_DIR", str(root))
    cmp = make_comparison(root, tmp_path)
    assert cli.main(["compare", "status"]) == 0
    out = capsys.readouterr().out
    assert "0/10 duels" in out and "hidden" in out and "alphatool" not in out
    vote_all(cmp)
    cmp.finish()
    assert cli.main(["compare", "status", cmp.run_id]) == 0
    out = capsys.readouterr().out
    assert "alphatool" in out and "self-consistency" in out
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_cli.py -q`
Expected: 3 failures, each `SystemExit: 2` from argparse (`invalid choice: 'compare'`).

- [ ] **Step 3: Add `compare` to the command line**

In `backend/eval/parser_bench/__main__.py`:

(a) In the docstring, change the first line's command list to `<tools|install|run|runs|export|select|compare>`, and add after the `select draw` lines:

```
    compare create --tools a,b,c --seed N
                                  a blind comparison of those methods' benchmark runs
    compare status [<cmp_id>]     judging progress; the ranking once judging is finished
```

(b) Replace the import line with

```python
from backend.eval.parser_bench import blinding, compare, execute, pageset, results, sources, store, tools
```

(c) After the `select draw` arguments (`s.add_argument("--out", type=Path, default=pageset.PAGESET)`), add:

```python
    p = sub.add_parser("compare", help="blind comparisons of benchmark runs")
    cmp_sub = p.add_subparsers(dest="action", required=True)
    s = cmp_sub.add_parser("create", help="a new comparison of these methods' latest benchmark runs")
    s.add_argument("--tools", required=True, help="comma-separated method ids, e.g. current,pdfjs")
    s.add_argument("--seed", type=int, required=True)
    s = cmp_sub.add_parser("status", help="progress, and the ranking once judging is finished")
    s.add_argument("cmp_id", nargs="?")
```

(d) Directly after the `select` dispatch added in Task 3 (`        return _select(args)`), add:

```python
    if args.cmd == "compare":
        return _compare(args)
```

(e) Add after `_select`:

```python
def _compare(args: argparse.Namespace) -> int:
    if args.action == "create":
        try:
            cmp = compare.create_benchmark([t for t in args.tools.split(",") if t], seed=args.seed,
                                           commit=execute.protocol_commit())
        except (RuntimeError, ValueError, FileNotFoundError) as e:
            print(e, file=sys.stderr)
            return 2
        done, total = cmp.progress()
        print(f"{cmp.run_id}  judging  {done}/{total} duels")
        print(cmp.path)
        return 0
    try:
        found = compare.list_comparisons()
        cmp = compare.CompareRun.open(args.cmp_id) if args.cmp_id else (found[0] if found else None)
    except (ValueError, FileNotFoundError) as e:
        print(e, file=sys.stderr)
        return 2
    if cmp is None:
        print("no comparison yet", file=sys.stderr)
        return 2
    meta = cmp.meta
    done, total = cmp.progress()
    print(f"{cmp.run_id}  {meta['status']}  {done}/{total} duels  round {meta['rounds']}")
    if blinding.comparison_locked(meta):
        print("names and ranking stay hidden until judging is finished")
        return 0
    data = results.current_results(cmp)
    for row in data["ranking"]:
        print(f"{row['entrant']:15} {row['points']:7.1f}  ({row['lo']:.1f}–{row['hi']:.1f})  {row['duels']} duels")
    sc = data["self_consistency"]
    print(f"self-consistency {sc['agree']}/{sc['total']}  median decision {data['median_seconds']} s  H1 {'holds' if data['h1']['holds'] else 'does not hold'}")
    return 0
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_cli.py -q`
Expected: `18 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/__main__.py backend/tests/unit/test_parser_bench_cli.py
git commit -m "feat(parser-bench): compare create and compare status (names hidden until judging is finished)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Background jobs with a journal (`jobs.py`)

**Files:**
- Create: `backend/eval/parser_bench/jobs.py`
- Create: `backend/tests/unit/test_parser_bench_jobs.py`

**Interfaces:**
- Consumes:
  - `execute.run_tool` (with `wait_for_slot=True`, `cancel`, `on_stage`), `execute.Cancelled` and `execute.benchmark_pages`;
  - `tools.install` and `TOOLS`;
  - `files.find_file`;
  - `store._write_json` and `now_iso`.
- Produces:
  - `jobs.STATES = ("queued", "running", "finished", "failed", "cancelled", "interrupted")`.
  - `JobQueue(root, *, runner=execute.run_tool, installer=tools.install, benchmark_pages=execute.benchmark_pages, poll=0.2)` with:
    - `.submit_run(*, tool, sha256, purpose)`
    - `.submit_install(tool)`
    - `.cancel(job_id)`
    - `.get(job_id)` and `.list()` (newest first)
    - `.start()` and `.stop(timeout=5.0)`
- A job is a JSON file `<data>/jobs/job-<yyyymmddHHMMSS><6hex>.json` with these keys:
  - `job_id, kind (run|install), tool, sha256, file_name, purpose`
  - `state, stage (starting|waiting|warmup|timed|scoring|cancelling|null)`
  - `run_id, error, created_at, queued_at, started_at, ended_at, server_pid`

**Behaviour** (the ledger's Plan 2 inputs):
- **A running run is visible.** Its run record only appears when it ends, so the journal is what shows it while it runs.
- **Cancel.** A queued job is cancelled at once. A running one is cancelled through `run_tool`'s cancel event, which keeps the run, failed, with the reason "cancelled".
- **One worker thread.** Jobs run one at a time, and the timed-run slot also keeps the command line out.
- **Restarts.** On start-up, jobs left `queued`/`running` by another server process become `interrupted`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_parser_bench_jobs.py`:

```python
import json
import threading
import time
from types import SimpleNamespace

import pytest

from backend.eval.parser_bench import files, jobs
from backend.tests.unit.parser_bench_fixtures import make_deck


def wait_for(predicate, within=10.0):
    end = time.monotonic() + within
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(0.05)
    return False


@pytest.fixture
def stored(tmp_path):
    return files.store_pdf(make_deck(tmp_path / "deck.pdf").read_bytes(), "deck.pdf", root=tmp_path / "data")


def fake_run(status="finished", reason=None):
    return SimpleNamespace(meta={"run_id": "2026-10-30_fake-1_abcd", "status": status, "reason": reason})


def queue(tmp_path, runner, **kw):
    q = jobs.JobQueue(tmp_path / "data", runner=runner, poll=0.05, **kw)
    q.start()
    return q


def test_jobs_run_one_at_a_time_in_order(tmp_path, stored):
    spans = []

    def runner(tool, pdf, **kw):
        start = time.monotonic()
        time.sleep(0.2)
        spans.append((tool, start, time.monotonic()))
        return fake_run()

    q = queue(tmp_path, runner)
    try:
        ids = [q.submit_run(tool=t, sha256=stored.sha256, purpose="explore")["job_id"] for t in ("current", "pdfjs", "markitdown")]
        assert wait_for(lambda: all(q.get(i)["state"] == "finished" for i in ids))
    finally:
        q.stop()
    assert [s[0] for s in spans] == ["current", "pdfjs", "markitdown"]
    assert all(a[2] <= b[1] for a, b in zip(spans, spans[1:]))
    assert q.get(ids[0])["run_id"] == "2026-10-30_fake-1_abcd" and q.get(ids[0])["ended_at"]


def test_the_stage_of_a_running_job_is_visible(tmp_path, stored):
    release = threading.Event()

    def runner(tool, pdf, *, on_stage, **kw):
        on_stage("timed")
        release.wait(5)
        return fake_run()

    q = queue(tmp_path, runner)
    try:
        job = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
        assert wait_for(lambda: q.get(job["job_id"])["stage"] == "timed")
        assert q.get(job["job_id"])["state"] == "running"
        release.set()
        assert wait_for(lambda: q.get(job["job_id"])["state"] == "finished")
        assert q.get(job["job_id"])["stage"] is None
    finally:
        release.set()
        q.stop()


def test_a_queued_job_is_cancelled_at_once_and_a_running_one_through_its_runner(tmp_path, stored):
    def runner(tool, pdf, *, cancel, **kw):
        cancel.wait(5)
        return fake_run("failed", f"{tool} was cancelled")

    q = queue(tmp_path, runner)
    try:
        first = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
        second = q.submit_run(tool="pdfjs", sha256=stored.sha256, purpose="explore")
        assert wait_for(lambda: q.get(first["job_id"])["state"] == "running")
        assert q.cancel(second["job_id"])["state"] == "cancelled"
        q.cancel(first["job_id"])
        assert wait_for(lambda: q.get(first["job_id"])["state"] == "cancelled")
        assert q.get(first["job_id"])["error"] == "current was cancelled"
        with pytest.raises(ValueError, match="only a queued or running job"):
            q.cancel(first["job_id"])
    finally:
        q.stop()


def test_a_failing_job_records_why(tmp_path, stored):
    def runner(tool, pdf, **kw):
        raise RuntimeError("another timed run is in progress")

    q = queue(tmp_path, runner)
    try:
        job = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
        assert wait_for(lambda: q.get(job["job_id"])["state"] == "failed")
        assert q.get(job["job_id"])["error"] == "RuntimeError: another timed run is in progress"
    finally:
        q.stop()


def test_jobs_left_by_a_stopped_server_are_interrupted(tmp_path):
    folder = tmp_path / "data" / "jobs"
    folder.mkdir(parents=True)
    (folder / "job-20261030000000abc123.json").write_text(json.dumps(
        {"job_id": "job-20261030000000abc123", "state": "running", "created_at": "1.0", "server_pid": -1}))
    q = jobs.JobQueue(tmp_path / "data")
    [job] = q.list()
    assert job["state"] == "interrupted" and "stopped" in job["error"]


def test_submissions_are_checked(tmp_path, stored):
    q = jobs.JobQueue(tmp_path / "data", benchmark_pages=lambda sha: [])
    with pytest.raises(ValueError, match="unknown method"):
        q.submit_run(tool="nope", sha256=stored.sha256, purpose="explore")
    with pytest.raises(ValueError, match="not in the benchmark page set"):
        q.submit_run(tool="current", sha256=stored.sha256, purpose="benchmark")
    with pytest.raises(FileNotFoundError):
        q.submit_run(tool="current", sha256="0" * 64, purpose="explore")
    with pytest.raises(ValueError, match="job id"):
        q.get("../x")


def test_an_install_job_calls_the_installer(tmp_path):
    installed = []
    q = queue(tmp_path, runner=None, installer=lambda tool: installed.append(tool.id))
    try:
        job = q.submit_install("markitdown")
        assert wait_for(lambda: q.get(job["job_id"])["state"] == "finished")
    finally:
        q.stop()
    assert installed == ["markitdown"]


def test_a_real_run_of_current_through_the_queue(tmp_path, stored):
    q = jobs.JobQueue(tmp_path / "data", poll=0.05)
    q.start()
    try:
        job = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore")
        assert wait_for(lambda: q.get(job["job_id"])["state"] in ("finished", "failed"), within=60)
    finally:
        q.stop()
    done = q.get(job["job_id"])
    assert done["state"] == "finished" and done["run_id"]
    assert (tmp_path / "data" / "runs" / "extract" / done["run_id"] / "run.json").exists()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_jobs.py -q`
Expected: FAIL with `ImportError: cannot import name 'jobs'`

- [ ] **Step 3: Write `jobs.py`**

`backend/eval/parser_bench/jobs.py`:

```python
"""Background jobs for the webpage: method runs and installs, one at a time, journalled on disk.

Each job is a JSON file under <data root>/jobs/. The journal is what makes a running method
visible (its run record is only written when it ends), lets a page reload see the progress, and
survives the server: a job the server did not finish is marked "interrupted" when it starts again.
Runs go through execute.run_tool, which also holds the one-timed-run slot against the command line.
"""
from __future__ import annotations

import json
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Callable

from backend.eval.parser_bench import execute, files, store, tools

STATES = ("queued", "running", "finished", "failed", "cancelled", "interrupted")
ACTIVE = ("queued", "running")


class JobQueue:
    def __init__(self, root: Path, *, runner: Callable[..., Any] = execute.run_tool,
                 installer: Callable[[tools.Tool], Any] = tools.install,
                 benchmark_pages: Callable[[str], list[int]] = execute.benchmark_pages, poll: float = 0.2):
        self.root = root
        self.dir = root / "jobs"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.runner, self.installer, self.benchmark_pages, self.poll = runner, installer, benchmark_pages, poll
        self._cancel: dict[str, threading.Event] = {}
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._recover()

    # --- the journal ------------------------------------------------------------------

    def _path(self, job_id: str) -> Path:
        if not (job_id.startswith("job-") and job_id[4:].isalnum()):
            raise ValueError(f"{job_id!r} is not a job id")
        return self.dir / f"{job_id}.json"

    def get(self, job_id: str) -> dict[str, Any]:
        path = self._path(job_id)
        if not path.exists():
            raise FileNotFoundError(f"no job {job_id}")
        return json.loads(path.read_text(encoding="utf-8"))

    def _save(self, job: dict[str, Any]) -> dict[str, Any]:
        store._write_json(self._path(job["job_id"]), job)
        return job

    def _update(self, job_id: str, **fields: Any) -> dict[str, Any]:
        with self._lock:
            job = self.get(job_id)
            job.update(fields)
            return self._save(job)

    def list(self) -> list[dict[str, Any]]:
        jobs = [json.loads(p.read_text(encoding="utf-8")) for p in self.dir.glob("job-*.json")]
        return sorted(jobs, key=lambda j: j["created_at"], reverse=True)

    def _recover(self) -> None:
        for job in self.list():
            if job["state"] in ACTIVE and job.get("server_pid") != os.getpid():
                job.update(state="interrupted", ended_at=store.now_iso(),
                           error="the server stopped before this job finished")
                self._save(job)

    def _new(self, **fields: Any) -> dict[str, Any]:
        job = {"job_id": f"job-{time.strftime('%Y%m%d%H%M%S')}{secrets.token_hex(3)}", "state": "queued",
               "created_at": f"{time.time():.6f}", "queued_at": store.now_iso(), "started_at": None, "ended_at": None,
               "stage": None, "run_id": None, "error": None, "server_pid": os.getpid(), **fields}
        self._save(job)
        self._wake.set()
        return job

    # --- what the webpage asks for ----------------------------------------------------

    def submit_run(self, *, tool: str, sha256: str, purpose: str) -> dict[str, Any]:
        if tool not in tools.TOOLS:
            raise ValueError(f"unknown method {tool!r}")
        if purpose not in store.PURPOSES:
            raise ValueError(f"purpose must be one of {store.PURPOSES}")
        stored = files.find_file(sha256, self.root)
        if purpose == "benchmark" and not self.benchmark_pages(sha256):
            raise ValueError(f"{stored.name} is not in the benchmark page set; run it as explore")
        return self._new(kind="run", tool=tool, sha256=sha256, file_name=stored.name, purpose=purpose)

    def submit_install(self, tool: str) -> dict[str, Any]:
        if tool not in tools.TOOLS:
            raise ValueError(f"unknown method {tool!r}")
        return self._new(kind="install", tool=tool, sha256=None, file_name=None, purpose=None)

    def cancel(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            job = self.get(job_id)
            if job["state"] == "queued":
                job.update(state="cancelled", ended_at=store.now_iso())
                return self._save(job)
            if job["state"] == "running" and job_id in self._cancel:
                self._cancel[job_id].set()
                job.update(stage="cancelling")
                return self._save(job)
        raise ValueError(f"{job_id} is {job['state']}; only a queued or running job can be cancelled")

    # --- the worker -------------------------------------------------------------------

    def start(self) -> None:
        if self._thread is None:
            self._stop.clear()
            self._thread = threading.Thread(target=self._loop, name="parser-bench-jobs", daemon=True)
            self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        self._wake.set()
        for event in list(self._cancel.values()):
            event.set()
        if self._thread is not None:
            self._thread.join(timeout)
            self._thread = None

    def _next(self) -> dict[str, Any] | None:
        queued = [j for j in self.list() if j["state"] == "queued"]
        return min(queued, key=lambda j: j["created_at"]) if queued else None

    def _loop(self) -> None:
        while not self._stop.is_set():
            job = self._next()
            if job is None:
                self._wake.wait(self.poll)
                self._wake.clear()
                continue
            self._execute(job["job_id"])

    def _execute(self, job_id: str) -> None:
        cancel = threading.Event()
        with self._lock:
            job = self.get(job_id)
            if job["state"] != "queued":
                return
            self._cancel[job_id] = cancel
            job.update(state="running", started_at=store.now_iso(), stage="starting")
            self._save(job)
        try:
            if job["kind"] == "run":
                stored = files.find_file(job["sha256"], self.root)
                run = self.runner(job["tool"], stored.path, purpose=job["purpose"], root=self.root, wait_for_slot=True,
                                  cancel=cancel, on_stage=lambda stage: self._update(job_id, stage=stage))
                meta = run.meta
                state = "cancelled" if cancel.is_set() else ("finished" if meta["status"] == "finished" else "failed")
                self._update(job_id, state=state, run_id=meta["run_id"], error=meta.get("reason"))
            else:
                self.installer(tools.TOOLS[job["tool"]])
                self._update(job_id, state="finished")
        except execute.Cancelled:
            self._update(job_id, state="cancelled")
        except Exception as e:  # a job's failure is its record, never the server's
            self._update(job_id, state="failed", error=f"{type(e).__name__}: {e}")
        finally:
            self._cancel.pop(job_id, None)
            self._update(job_id, ended_at=store.now_iso(), stage=None)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_jobs.py -q`
Expected: `8 passed`. The last test makes a real `current` run on the synthetic deck.

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/jobs.py backend/tests/unit/test_parser_bench_jobs.py
git commit -m "feat(parser-bench): journalled background jobs — one at a time, visible while running, cancellable

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The local server and `serve`

**Files:**
- Create: `backend/eval/parser_bench/server.py`
- Create: `backend/eval/parser_bench/api_runs.py`
- Create: `backend/eval/parser_bench/api_compare.py`
- Create: `backend/eval/parser_bench/api_newrun.py`
- Create: `backend/tests/unit/test_parser_bench_server.py`
- Modify: `backend/eval/parser_bench/__main__.py`
- Modify: `backend/tests/unit/test_parser_bench_cli.py`
- Modify: `backend/tests/unit/test_parser_bench_store.py` (the runtime isolation probe names the new modules)

**Why FastAPI:** it is already in the backend `.venv` and brings routing, uploads and a test client. The stdlib `http.server` would need hand-written routing and multipart parsing, because the `cgi` module is gone since Python 3.13.

**Interfaces:**
- Consumes: Tasks 1–11.
- Produces from `server.py`:
  - `HOST = "127.0.0.1"`, `DEFAULT_PORT = 8766` and `VIEWER_DIST`.
  - `create_app(*, root=None, jobs=None, dist=VIEWER_DIST, resamples=1000) -> FastAPI`. Its lifespan starts and stops the job queue.
  - `serve(port=8766)`.
- Error mapping: `Locked` → 423, `RunFinishedError` → 409, `FileNotFoundError` → 404, `ValueError` → 400, each `{"detail": str}`. A foreign Host gets 400, and a write without `X-Parser-Bench: 1` gets 403.
- Routes from `api_runs.py`:
  - `GET /api/runs` → `{runs: [summary]}`. Missing measures are `null`, and old records read as `record_version` 0 and `checks_version` 1.
  - `GET /api/runs/{id}` → summary plus `environment, settings, failed_stage, warmup_seconds, seconds_total, protocol_commit, machine, page_list[{page, locked}], checks` (unlocked pages only).
  - `GET /api/runs/{id}/pages/{n}` → `{markdown, footer_lines, checks}`, or 423.
  - `GET /api/diff?a&b&page` → `{a, b, page, ops[{op, text}]}`, for the same tool and file only.
  - `GET /api/files/{sha}/pages/{n}.png`.
  - `GET /api/sources` → `{sources: [{sha256, name, pages_total, pages, locked, runs}]}`.
  - `GET /api/outputs/{sha}/{n}` → `{outputs: [summary + markdown, footer_lines, checks]}`, or 423.
  - Helpers: `api_runs.word_diff(a, b)`, `footer_lines(sha, page, text, root)` and `summary(meta, root)`.
- Routes from `api_compare.py` (prefix `/api/comparisons`):
  - `GET ""` → `{comparisons: [{run_id, purpose, status, started_at, done, total, rounds, unlocked_early, locked, pages[{key, type}]}]}`.
  - `GET /{id}/next` returns `{finished, done, total, duel, round, page{key, type, number, file, png}, left{markdown}, right{markdown}}`. It never holds a tool name or a run id.
  - `POST /{id}/votes {duel, choice, seconds, session, note}` → `{vote_id, done, total, added, finished}`. It calls `results.advance`.
  - `POST /{id}/undo {session}` → `{retracted}`.
  - `GET /{id}/results` and `GET /{id}/votes` (My votes, withdrawn marked) answer 423 while the comparison is locked.
  - `POST /{id}/unlock {reason}`.
- Routes from `api_newrun.py`:
  - `GET /api/methods` → `{groups, methods[{id, label, group, description, ready, missing, size_mb}]}`.
  - `GET /api/files` and `POST /api/files` (multipart `file`) → stored file plus `benchmark_pages`.
  - `GET /api/jobs` and `POST /api/jobs {sha256, tools[], purpose}` → `{jobs}`.
  - `POST /api/jobs/{id}/cancel` and `POST /api/methods/{id}/install`.
- CLI: `serve [--port 8766]`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_parser_bench_server.py`:

```python
import json
import time

import pytest
from fastapi.testclient import TestClient

from backend.eval.parser_bench import files, server, store
from backend.eval.parser_bench.jobs import JobQueue
from backend.tests.unit.parser_bench_compare_fixtures import SESSION, make_comparison, make_extract_run, prefer
from backend.tests.unit.parser_bench_fixtures import make_deck

WRITE = {"X-Parser-Bench": "1"}


def client_for(root, **kw):
    app = server.create_app(root=root, jobs=JobQueue(root, poll=0.05), resamples=40, **kw)
    return TestClient(app, base_url="http://127.0.0.1")


@pytest.fixture
def root(tmp_path):
    return tmp_path / "data"


@pytest.fixture
def client(root, tmp_path):
    return client_for(root, dist=tmp_path / "no-dist")


def test_a_foreign_host_is_refused(root, tmp_path):
    app = server.create_app(root=root, jobs=JobQueue(root), dist=tmp_path / "no-dist")
    assert TestClient(app, base_url="http://evil.example").get("/api/runs").status_code == 400


def test_a_change_without_the_header_is_refused(client):
    assert client.post("/api/jobs", json={"sha256": "0" * 64, "tools": ["current"]}).status_code == 403


def test_the_run_list_keeps_missing_measures_null_and_reads_old_records(client, root, tmp_path):
    run = make_extract_run(root, "current", make_deck(tmp_path / "deck.pdf"), purpose="explore")
    old = root / "runs" / "extract" / "2026-10-29_old-1_0000"
    old.mkdir(parents=True)
    (old / "run.json").write_text(json.dumps({"run_id": old.name, "kind": "extract", "tool": "current", "status": "finished",
                                              "source": {"name": "x.pdf", "sha256": "b" * 64}, "started_at": "2026-10-29T00:00:00+00:00"}))
    rows = {r["run_id"]: r for r in client.get("/api/runs").json()["runs"]}
    assert rows[run.run_id]["peak_memory_mb"] is None and rows[run.run_id]["checks_version"] == 3
    assert (rows[old.name]["record_version"], rows[old.name]["checks_version"]) == (0, 1)


def test_an_explore_page_shows_its_output_checks_and_footer_lines(client, root, tmp_path):
    run = make_extract_run(root, "current", make_deck(tmp_path / "deck.pdf"), purpose="explore")
    body = client.get(f"/api/runs/{run.run_id}/pages/3").json()
    assert body["checks"]["footer_leaks"] == 3 and len(body["footer_lines"]) == 3
    detail = client.get(f"/api/runs/{run.run_id}").json()
    assert [p["locked"] for p in detail["page_list"]] == [False] * 6 and len(detail["checks"]) == 6
    assert client.get(f"/api/runs/{run.run_id}/pages/9").status_code == 404


def test_benchmark_pages_are_locked_everywhere_while_judging(client, root, tmp_path):
    cmp = make_comparison(root, tmp_path)
    run_id = cmp.meta["entrants"]["alphatool"][cmp.meta["pages"][0]["sha256"]]
    sha = cmp.meta["pages"][0]["sha256"]
    assert client.get(f"/api/runs/{run_id}/pages/1").status_code == 423
    assert client.get(f"/api/outputs/{sha}/1").status_code == 423
    assert client.get(f"/api/runs/{run_id}").json()["checks"] == []
    assert client.get(f"/api/comparisons/{cmp.run_id}/results").status_code == 423
    assert client.get(f"/api/comparisons/{cmp.run_id}/votes").status_code == 423
    assert client.get("/api/runs").status_code == 200  # the run list itself stays visible


def test_a_duel_never_names_a_tool_or_a_run(client, root, tmp_path):
    cmp = make_comparison(root, tmp_path)
    body = client.get(f"/api/comparisons/{cmp.run_id}/next").json()
    assert body["duel"] == 0 and body["total"] == 10 and body["page"]["png"].endswith(".png")
    assert set(body["left"]) == set(body["right"]) == {"markdown"}  # the output only (its text is the tool's own)
    rest = json.dumps({k: v for k, v in body.items() if k not in ("left", "right")})
    run_ids = [r for runs in cmp.meta["entrants"].values() for r in runs.values()]
    for secret in ("alphatool", "betatool", "current", "run_id", *run_ids):
        assert secret not in rest


def judge_everything(client, cmp, choose=prefer("alphatool")):
    while True:
        body = client.get(f"/api/comparisons/{cmp.run_id}/next").json()
        if "duel" not in body:
            return body
        duel = cmp.meta["schedule"][body["duel"]]
        r = client.post(f"/api/comparisons/{cmp.run_id}/votes", headers=WRITE,
                        json={"duel": body["duel"], "choice": choose(duel), "seconds": 2.5, "session": SESSION})
        assert r.status_code == 200, r.text


def test_judging_to_the_end_opens_results_and_my_votes(client, root, tmp_path):
    cmp = make_comparison(root, tmp_path)
    r = client.post(f"/api/comparisons/{cmp.run_id}/votes", headers=WRITE,
                    json={"duel": 3, "choice": "left", "seconds": 1, "session": SESSION})
    assert r.status_code == 400 and "next duel" in r.json()["detail"]
    client.post(f"/api/comparisons/{cmp.run_id}/votes", headers=WRITE, json={"duel": 0, "choice": "left", "seconds": 1, "session": SESSION})
    assert client.post(f"/api/comparisons/{cmp.run_id}/undo", headers=WRITE, json={"session": SESSION}).json() == {"retracted": 0}
    assert judge_everything(client, cmp)["finished"] is True
    res = client.get(f"/api/comparisons/{cmp.run_id}/results").json()
    assert res["ranking"][0]["entrant"] == "alphatool" and res["votes"] == 10
    votes = client.get(f"/api/comparisons/{cmp.run_id}/votes").json()["votes"]
    assert len(votes) == 11 and sum(v["withdrawn"] for v in votes) == 1 and votes[0]["type"]
    sha = cmp.meta["pages"][0]["sha256"]
    assert client.get(f"/api/outputs/{sha}/1").status_code == 200


def test_unlocking_early_needs_a_reason_and_opens_results(client, root, tmp_path, monkeypatch):
    log = tmp_path / "LAB_LOG.md"
    log.write_text("# log\n")
    monkeypatch.setattr(server.api_compare.blinding, "LAB_LOG", log)
    cmp = make_comparison(root, tmp_path)
    assert client.post(f"/api/comparisons/{cmp.run_id}/unlock", headers=WRITE, json={"reason": " "}).status_code == 400
    assert client.post(f"/api/comparisons/{cmp.run_id}/unlock", headers=WRITE, json={"reason": "renderer check"}).json()["locked"] is False
    assert client.get(f"/api/comparisons/{cmp.run_id}/results").status_code == 200
    assert "renderer check" in log.read_text()


def test_two_runs_of_the_same_method_can_be_diffed(client, root, tmp_path):
    deck = make_deck(tmp_path / "deck.pdf")
    a = make_extract_run(root, "alphatool", deck, purpose="explore")
    b = make_extract_run(root, "alphatool", deck, purpose="explore")
    c = make_extract_run(root, "betatool", deck, purpose="explore")
    body = client.get("/api/diff", params={"a": a.run_id, "b": b.run_id, "page": 2}).json()
    assert {op["op"] for op in body["ops"]} == {"equal"}
    assert client.get("/api/diff", params={"a": a.run_id, "b": c.run_id, "page": 2}).status_code == 400


def test_word_diff_marks_what_changed():
    ops = server.api_runs.word_diff("Lecturer Software 3\nVersion control", "Version control")
    assert {"op": "delete", "text": "Lecturer Software 3\n"} in ops and ops[-1] == {"op": "equal", "text": "Version control"}


def test_page_images_and_sources(client, root, tmp_path):
    run = make_extract_run(root, "current", make_deck(tmp_path / "deck.pdf"), purpose="explore")
    sha = run.meta["source"]["sha256"]
    r = client.get(f"/api/files/{sha}/pages/2.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    [src] = client.get("/api/sources").json()["sources"]
    assert (src["sha256"], src["pages"], src["locked"], src["runs"]) == (sha, [1, 2, 3, 4, 5, 6], [], 1)
    assert [o["tool"] for o in client.get(f"/api/outputs/{sha}/2").json()["outputs"]] == ["current"]


def test_upload_methods_and_a_job_to_the_end(root, tmp_path):
    with client_for(root, dist=tmp_path / "no-dist") as client:
        pdf = make_deck(tmp_path / "deck.pdf").read_bytes()
        stored = client.post("/api/files", headers=WRITE, files={"file": ("Lecture.pdf", pdf, "application/pdf")}).json()
        assert (stored["name"], stored["pages"], stored["benchmark_pages"]) == ("Lecture.pdf", 6, [])
        assert client.post("/api/files", headers=WRITE, files={"file": ("x.pdf", b"nope", "application/pdf")}).status_code == 400
        methods = {m["id"]: m for m in client.get("/api/methods").json()["methods"]}
        assert methods["current"]["ready"] is True and methods["current"]["group"] == "fast"
        r = client.post("/api/jobs", headers=WRITE, json={"sha256": stored["sha256"], "tools": ["current"], "purpose": "benchmark"})
        assert r.status_code == 400 and "benchmark page set" in r.json()["detail"]
        [job] = client.post("/api/jobs", headers=WRITE, json={"sha256": stored["sha256"], "tools": ["current"]}).json()["jobs"]
        end = time.monotonic() + 60
        while time.monotonic() < end and client.get("/api/jobs").json()["jobs"][0]["state"] in ("queued", "running"):
            time.sleep(0.1)
        done = client.get("/api/jobs").json()["jobs"][0]
        assert done["state"] == "finished", done
        assert any(r["run_id"] == done["run_id"] for r in client.get("/api/runs").json()["runs"])


def test_the_viewer_is_served_when_built(root, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>Parser Bench</title>")
    assert "Parser Bench" in client_for(root, dist=dist).get("/").text
    assert "not built" in client_for(root, dist=tmp_path / "nothing").get("/").text
```

Append to `backend/tests/unit/test_parser_bench_cli.py`:

```python


# --- Plan 2: serve -------------------------------------------------------------------

from backend.eval.parser_bench import server  # noqa: E402


def test_serve_binds_to_localhost_only(monkeypatch, capsys):
    called = {}
    monkeypatch.setattr(server, "serve", lambda port: called.setdefault("port", port))
    assert cli.main(["serve", "--port", "8799"]) == 0
    assert called == {"port": 8799} and "http://127.0.0.1:8799" in capsys.readouterr().out
```

In `backend/tests/unit/test_parser_bench_store.py`, in `test_importing_every_bench_module_loads_nothing_of_the_app`, replace

```python
    assert {f"backend.eval.parser_bench.{m}" for m in ("store", "sources", "normalize", "checks", "tools", "execute", "__main__")} <= imported
```

with

```python
    modules = ("store", "sources", "normalize", "checks", "tools", "execute", "__main__", "pageset", "schedule", "ranking",
               "compare", "results", "files", "blinding", "jobs", "server", "api_runs", "api_compare", "api_newrun")
    assert {f"backend.eval.parser_bench.{m}" for m in modules} <= imported
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_server.py backend/tests/unit/test_parser_bench_cli.py backend/tests/unit/test_parser_bench_store.py -q`
Expected: FAIL with `ImportError: cannot import name 'server'`, and the probe test reporting the missing modules.

- [ ] **Step 3: Write the server and its three routers**

`backend/eval/parser_bench/server.py`:

```python
"""The local webpage's server (spec "The webpage"): run data, blind judging and new runs.

FastAPI, because it is already in the backend .venv and brings routing, uploads
(python-multipart) and a test client; the stdlib http.server would need hand-written routing and
multipart parsing (the cgi module is gone since Python 3.13).

Safety: it listens on 127.0.0.1 only; the Host header must be 127.0.0.1 or localhost (no DNS
rebinding); every request that changes something must carry `X-Parser-Bench: 1`, which a form on
another website cannot send. No login: it is a lab tool on Abi's Mac, not part of the product.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from backend.eval.parser_bench import api_compare, api_newrun, api_runs, ranking, store
from backend.eval.parser_bench.blinding import Locked
from backend.eval.parser_bench.jobs import JobQueue

HOST = "127.0.0.1"
DEFAULT_PORT = 8766
VIEWER_DIST = Path(__file__).resolve().parent / "viewer" / "dist"
WRITE_HEADER = "x-parser-bench"
NOT_BUILT = """<!doctype html><meta charset="utf-8"><title>Parser Bench</title>
<body style="background:#0a0a0b;color:#ececee;font:15px system-ui;padding:40px">
<h1 style="font-size:18px">The viewer is not built yet</h1>
<p>Run <code>npx vite build --config backend/eval/parser_bench/viewer/vite.config.ts</code>, then reload.</p>"""


def create_app(*, root: Path | None = None, jobs: JobQueue | None = None, dist: Path = VIEWER_DIST,
               resamples: int = ranking.RESAMPLES) -> FastAPI:
    root = store.data_root() if root is None else root
    queue = jobs if jobs is not None else JobQueue(root)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        queue.start()
        try:
            yield
        finally:
            queue.stop()

    app = FastAPI(title="Parser Bench", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.root, app.state.jobs, app.state.resamples = root, queue, resamples

    @app.middleware("http")
    async def writes_need_the_header(request: Request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get(WRITE_HEADER) != "1":
            return JSONResponse({"detail": "changes need the X-Parser-Bench: 1 header"}, status_code=403)
        return await call_next(request)

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

    for error, status in ((Locked, 423), (store.RunFinishedError, 409), (FileNotFoundError, 404), (ValueError, 400)):
        app.add_exception_handler(error, _handler(status))

    app.include_router(api_runs.router)
    app.include_router(api_compare.router)
    app.include_router(api_newrun.router)
    if (dist / "index.html").exists():
        app.mount("/", StaticFiles(directory=dist, html=True), name="viewer")
    else:
        @app.get("/", response_class=HTMLResponse)
        def not_built() -> str:
            return NOT_BUILT
    return app


def _handler(status: int):
    async def handle(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=status)
    return handle


def serve(port: int = DEFAULT_PORT) -> None:
    import uvicorn

    uvicorn.run(create_app(), host=HOST, port=port, log_level="warning")
```

`backend/eval/parser_bench/api_runs.py`:

```python
"""Run data for the webpage: the run list, one run's outputs and checks, two runs' differences,
page images, and every output of one page side by side (Compare). Output views respect the
blinding lock."""
from __future__ import annotations

import difflib
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

from fastapi import APIRouter, Request, Response

from backend.eval.parser_bench import blinding, checks, files, store
from backend.eval.parser_bench.compare import CompareRun

router = APIRouter(prefix="/api")


def root_of(request: Request) -> Path:
    return request.app.state.root


@lru_cache(maxsize=32)
def _facts(pdf: str, mtime: float) -> checks.DocFacts:
    return checks.document_facts(Path(pdf))


def footer_lines(sha256: str, page: int, text: str, root: Path) -> list[int]:
    """The output lines the footer rule removes, for marking; none when the PDF is not on this Mac."""
    try:
        pdf = files.resolve_pdf(sha256, root)
    except FileNotFoundError:
        return []
    facts = _facts(str(pdf), pdf.stat().st_mtime)
    return checks.footer_line_numbers(text, facts.pages[page], facts) if page in facts.pages else []


def summary(meta: Mapping[str, Any], root: Path) -> dict[str, Any]:
    """One row of the Runs screen. Missing measures stay null; the viewer shows them as —."""
    if meta.get("kind") == "compare":
        cmp = CompareRun(store.find_run(meta["run_id"], root))
        done, total = cmp.progress()
        return {"run_id": meta["run_id"], "kind": "compare", "tool": None, "version": None, "purpose": meta.get("purpose"),
                "status": meta["status"], "started_at": meta.get("started_at"), "done": done, "total": total,
                "pages": [], "pages_total": len(meta.get("pages", [])), "commit": (meta.get("git") or {}).get("commit"),
                "record_version": store.record_version(meta), "checks_version": store.checks_version(meta)}
    source = meta.get("source") or {}
    return {
        "run_id": meta["run_id"], "kind": "extract", "tool": meta.get("tool"), "version": meta.get("version"),
        "purpose": meta.get("purpose"), "status": meta.get("status"), "reason": meta.get("reason"),
        "started_at": meta.get("started_at"), "finished_at": meta.get("finished_at"),
        "file": source.get("name"), "sha256": source.get("sha256"), "pages_total": source.get("pages_total"),
        "pages": meta.get("pages_scored") or [], "seconds_per_page": meta.get("seconds_per_page"),
        "peak_memory_mb": meta.get("peak_memory_mb"), "commit": (meta.get("git") or {}).get("commit"),
        "dirty": (meta.get("git") or {}).get("dirty"),
        "record_version": store.record_version(meta), "checks_version": store.checks_version(meta),
    }


@router.get("/runs")
def runs(request: Request) -> dict[str, Any]:
    root = root_of(request)
    return {"runs": [summary(m, root) for m in store.list_runs(root)]}


def _extract(run_id: str, root: Path) -> store.ExtractRun:
    path = store.find_run(run_id, root)
    if not (path / "run.json").exists():
        raise FileNotFoundError(f"{run_id} is not an extraction run")
    return store.ExtractRun(path)


@router.get("/runs/{run_id}")
def run_detail(run_id: str, request: Request) -> dict[str, Any]:
    root = root_of(request)
    run = _extract(run_id, root)
    meta = run.meta
    sha = (meta.get("source") or {}).get("sha256")
    locked = blinding.locked_pages(root)
    pages = [{"page": p, "locked": (sha, p) in locked} for p in sorted(run.pages())]
    open_pages = {p["page"] for p in pages if not p["locked"]}
    detail = summary(meta, root)
    detail.update(
        environment=meta.get("environment"), settings=meta.get("settings"), failed_stage=meta.get("failed_stage"),
        warmup_seconds=meta.get("warmup_seconds"), seconds_total=meta.get("seconds_total"),
        protocol_commit=meta.get("protocol_commit"), machine=meta.get("machine"),
        page_list=pages, checks=[r for r in run.typed_checks() if r.get("page") in open_pages],
    )
    return detail


@router.get("/runs/{run_id}/pages/{page}")
def run_page(run_id: str, page: int, request: Request) -> dict[str, Any]:
    root = root_of(request)
    run = _extract(run_id, root)
    sha = run.meta["source"]["sha256"]
    blinding.check(sha, page, blinding.locked_pages(root))
    text = run.pages().get(page)
    if text is None:
        raise FileNotFoundError(f"{run_id} has no page {page}")
    row = next((r for r in run.typed_checks() if r.get("page") == page), None)
    return {"run_id": run_id, "page": page, "markdown": text, "footer_lines": footer_lines(sha, page, text, root), "checks": row}


_TOKEN = re.compile(r"\s+|[^\s]+")


def word_diff(a: str, b: str) -> list[dict[str, str]]:
    """Word-level differences from a to b, whitespace kept: [{"op": equal|delete|insert, "text"}]."""
    left, right = _TOKEN.findall(a), _TOKEN.findall(b)
    ops: list[dict[str, str]] = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, left, right, autojunk=False).get_opcodes():
        if tag in ("equal", "delete", "replace") and i2 > i1:
            ops.append({"op": "equal" if tag == "equal" else "delete", "text": "".join(left[i1:i2])})
        if tag in ("insert", "replace") and j2 > j1:
            ops.append({"op": "insert", "text": "".join(right[j1:j2])})
    return ops


@router.get("/diff")
def diff(a: str, b: str, page: int, request: Request) -> dict[str, Any]:
    root = root_of(request)
    first, second = _extract(a, root), _extract(b, root)
    ma, mb = first.meta, second.meta
    if ma.get("tool") != mb.get("tool"):
        raise ValueError("pick two runs of the same method")
    if ma["source"]["sha256"] != mb["source"]["sha256"]:
        raise ValueError("pick two runs of the same file")
    blinding.check(ma["source"]["sha256"], page, blinding.locked_pages(root))
    ta, tb = first.pages().get(page), second.pages().get(page)
    if ta is None or tb is None:
        raise FileNotFoundError(f"page {page} is not in both runs")
    return {"a": summary(ma, root), "b": summary(mb, root), "page": page, "ops": word_diff(ta, tb)}


@router.get("/files/{sha256}/pages/{page}.png")
def page_image(sha256: str, page: int, request: Request) -> Response:
    return Response(files.page_png(sha256, page, root_of(request)), media_type="image/png",
                    headers={"Cache-Control": "max-age=86400"})


@router.get("/sources")
def sources(request: Request) -> dict[str, Any]:
    """Every PDF with a finished extraction run, with the pages any run scored (Compare's picker)."""
    root = root_of(request)
    locked = blinding.locked_pages(root)
    by_sha: dict[str, dict[str, Any]] = {}
    for meta in store.list_runs(root):
        if meta.get("kind") != "extract" or meta.get("status") != "finished":
            continue
        src = meta["source"]
        entry = by_sha.setdefault(src["sha256"], {"sha256": src["sha256"], "name": src["name"],
                                                  "pages_total": src.get("pages_total"), "pages": set(), "runs": 0})
        entry["pages"].update(meta.get("pages_scored") or [])
        entry["runs"] += 1
    out = []
    for entry in by_sha.values():
        pages = sorted(entry["pages"])
        out.append(dict(entry, pages=pages, locked=[p for p in pages if (entry["sha256"], p) in locked]))
    return {"sources": sorted(out, key=lambda e: e["name"].lower())}


@router.get("/outputs/{sha256}/{page}")
def outputs(sha256: str, page: int, request: Request) -> dict[str, Any]:
    """Every finished run's output of one page, with names and checks (Compare)."""
    root = root_of(request)
    files.check_sha(sha256)
    blinding.check(sha256, page, blinding.locked_pages(root))
    found = []
    for meta in store.list_runs(root):
        if meta.get("kind") != "extract" or meta.get("status") != "finished" or meta["source"]["sha256"] != sha256:
            continue
        run = store.ExtractRun(store.find_run(meta["run_id"], root))
        text = run.pages().get(page)
        if text is None:
            continue
        row = next((r for r in run.typed_checks() if r.get("page") == page), None)
        found.append({**summary(meta, root), "markdown": text, "footer_lines": footer_lines(sha256, page, text, root), "checks": row})
    return {"sha256": sha256, "page": page, "outputs": found}
```

`backend/eval/parser_bench/api_compare.py`:

```python
"""Blind judging for the webpage. While a benchmark comparison is being judged, nothing here names
a tool or a run: a duel is a page image and two outputs called left and right. Names, results and
My votes open when judging is finished (or after an early unlock, which the lab log records)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from backend.eval.parser_bench import blinding, results
from backend.eval.parser_bench.api_runs import root_of
from backend.eval.parser_bench.compare import CompareRun, list_comparisons

router = APIRouter(prefix="/api/comparisons")


class VoteIn(BaseModel):
    duel: int
    choice: str
    seconds: float
    session: str
    note: str | None = None


class SessionIn(BaseModel):
    session: str


class UnlockIn(BaseModel):
    reason: str


def _summary(cmp: CompareRun) -> dict[str, Any]:
    meta = cmp.meta
    done, total = cmp.progress()
    return {"run_id": meta["run_id"], "purpose": meta["purpose"], "status": meta["status"], "started_at": meta["started_at"],
            "done": done, "total": total, "rounds": meta["rounds"], "unlocked_early": meta.get("unlocked_early"),
            "locked": blinding.comparison_locked(meta), "pages": [{"key": p["key"], "type": p["type"]} for p in meta["pages"]]}


def _open(cmp: CompareRun) -> None:
    if blinding.comparison_locked(cmp.meta):
        raise blinding.Locked("names and results open when judging is finished")


@router.get("")
def comparisons(request: Request) -> dict[str, Any]:
    return {"comparisons": [_summary(c) for c in list_comparisons(root_of(request))]}


@router.get("/{run_id}/next")
def next_duel(run_id: str, request: Request) -> dict[str, Any]:
    root = root_of(request)
    cmp = CompareRun.open(run_id, root)
    done, total = cmp.progress()
    duel = cmp.next_duel() if cmp.meta["status"] == "judging" else None
    if duel is None:
        return {"finished": cmp.meta["status"] == "finished", "done": done, "total": total}
    page = cmp.page(duel["page"])
    return {
        "finished": False, "done": done, "total": total, "duel": duel["duel"], "round": duel["round"],
        "page": {"key": page["key"], "type": page["type"], "number": page["page"], "file": page["file"],
                 "png": f"/api/files/{page['sha256']}/pages/{page['page']}.png"},
        "left": {"markdown": cmp.output(duel["left"], duel["page"], root)},
        "right": {"markdown": cmp.output(duel["right"], duel["page"], root)},
    }


@router.post("/{run_id}/votes")
def vote(run_id: str, body: VoteIn, request: Request) -> dict[str, Any]:
    root = root_of(request)
    cmp = CompareRun.open(run_id, root)
    line = cmp.vote(duel=body.duel, choice=body.choice, seconds=body.seconds, session=body.session, note=body.note)
    step = results.advance(cmp, resamples=request.app.state.resamples, root=root)
    done, total = cmp.progress()
    return {"vote_id": line["vote_id"], "done": done, "total": total, **step}


@router.post("/{run_id}/undo")
def undo(run_id: str, body: SessionIn, request: Request) -> dict[str, Any]:
    line = CompareRun.open(run_id, root_of(request)).undo(session=body.session)
    return {"retracted": None if line is None else line["duel"]}


@router.get("/{run_id}/results")
def comparison_results(run_id: str, request: Request) -> dict[str, Any]:
    root = root_of(request)
    cmp = CompareRun.open(run_id, root)
    _open(cmp)
    return results.current_results(cmp, resamples=request.app.state.resamples, root=root)


@router.get("/{run_id}/votes")
def my_votes(run_id: str, request: Request) -> dict[str, Any]:
    """Every vote with both names, the pick, the seconds and the note; withdrawn ones marked."""
    cmp = CompareRun.open(run_id, root_of(request))
    _open(cmp)
    events = cmp.events()
    withdrawn = {e["vote_id"] for e in events if e["type"] == "retract"}
    types = {p["key"]: p["type"] for p in cmp.meta["pages"]}
    votes = [{**{k: e[k] for k in ("vote_id", "duel", "page", "left", "right", "choice", "seconds", "note", "at", "session")},
              "type": types.get(e["page"]), "withdrawn": e["vote_id"] in withdrawn}
             for e in events if e["type"] == "vote"]
    return {"run_id": run_id, "votes": votes}


@router.post("/{run_id}/unlock")
def unlock(run_id: str, body: UnlockIn, request: Request) -> dict[str, Any]:
    cmp = CompareRun.open(run_id, root_of(request))
    blinding.unlock_early(cmp, body.reason)
    return _summary(cmp)
```

`backend/eval/parser_bench/api_newrun.py`:

```python
"""New run for the webpage: the methods and their readiness, PDF uploads, and background jobs."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Request, UploadFile
from pydantic import BaseModel

from backend.eval.parser_bench import execute, files, store, tools
from backend.eval.parser_bench.api_runs import root_of

router = APIRouter(prefix="/api")


class JobsIn(BaseModel):
    sha256: str
    tools: list[str]
    purpose: str = "explore"


def _file(stored: files.StoredFile) -> dict[str, Any]:
    return {**stored.as_dict(), "benchmark_pages": execute.benchmark_pages(stored.sha256)}


@router.get("/methods")
def methods() -> dict[str, Any]:
    return {"groups": list(tools.GROUPS), "methods": [
        {"id": t.id, "label": t.label, "group": t.group, "description": t.description,
         "ready": tools.is_ready(t), "missing": tools.missing(t), "size_mb": t.size_mb}
        for t in tools.TOOLS.values()]}


@router.get("/files")
def stored_files(request: Request) -> dict[str, Any]:
    return {"files": [_file(f) for f in files.list_files(root_of(request))]}


@router.post("/files")
async def upload(request: Request, file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read(files.MAX_BYTES + 1)
    return _file(files.store_pdf(data, file.filename or "upload.pdf", root=root_of(request)))


@router.get("/jobs")
def job_list(request: Request) -> dict[str, Any]:
    return {"jobs": request.app.state.jobs.list()}


@router.post("/jobs")
def start_jobs(body: JobsIn, request: Request) -> dict[str, Any]:
    if not body.tools:
        raise ValueError("tick at least one method")
    if body.purpose not in store.PURPOSES:
        raise ValueError(f"purpose must be one of {store.PURPOSES}")
    unknown = [t for t in body.tools if t not in tools.TOOLS]
    if unknown:
        raise ValueError(f"unknown methods: {', '.join(unknown)}")
    queue = request.app.state.jobs
    return {"jobs": [queue.submit_run(tool=t, sha256=body.sha256, purpose=body.purpose) for t in body.tools]}


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, request: Request) -> dict[str, Any]:
    return request.app.state.jobs.cancel(job_id)


@router.post("/methods/{tool_id}/install")
def install(tool_id: str, request: Request) -> dict[str, Any]:
    return request.app.state.jobs.submit_install(tool_id)
```

- [ ] **Step 4: Add `serve` to the command line**

In `backend/eval/parser_bench/__main__.py`:

(a) In the docstring, change the command list to `<tools|install|run|runs|export|select|compare|serve>`, and add after the `compare status` line:

```
    serve [--port 8766]           the webpage, on 127.0.0.1 only
```

(b) Replace the import line with

```python
from backend.eval.parser_bench import blinding, compare, execute, pageset, results, server, sources, store, tools
```

(c) After the `compare status` arguments (`s.add_argument("cmp_id", nargs="?")`), add:

```python
    p = sub.add_parser("serve", help="the webpage on 127.0.0.1")
    p.add_argument("--port", type=int, default=server.DEFAULT_PORT)
```

(d) After the `compare` dispatch (`        return _compare(args)`), add:

```python
    if args.cmd == "serve":
        print(f"Parser Bench on http://{server.HOST}:{args.port}  (Ctrl-C stops it)")
        server.serve(args.port)
        return 0
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_server.py backend/tests/unit/test_parser_bench_cli.py backend/tests/unit/test_parser_bench_store.py -q`
Expected: `89 passed` (13 + 19 + 57)

- [ ] **Step 6: Run the whole benchmark suite**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_*.py -q`
Expected: every test passes. Tests whose real decks or method environments are missing are skipped.

- [ ] **Step 7: Commit**

```bash
git add backend/eval/parser_bench/server.py backend/eval/parser_bench/api_runs.py backend/eval/parser_bench/api_compare.py backend/eval/parser_bench/api_newrun.py backend/eval/parser_bench/__main__.py backend/tests/unit/test_parser_bench_server.py backend/tests/unit/test_parser_bench_cli.py backend/tests/unit/test_parser_bench_store.py
git commit -m "feat(parser-bench): local server on 127.0.0.1 — runs, blind duels, results, uploads and jobs; serve

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The viewer's foundation: its own Vite build, the API client, helpers, Prose output

**Files:**
- Create: `backend/eval/parser_bench/viewer/vite.config.ts`
- Create: `backend/eval/parser_bench/viewer/tailwind.config.ts`
- Create: `backend/eval/parser_bench/viewer/tsconfig.json`
- Create: `backend/eval/parser_bench/viewer/src/api.ts`
- Create: `backend/eval/parser_bench/viewer/src/lib.ts`
- Create: `backend/eval/parser_bench/viewer/src/lib.test.ts`
- Create: `backend/eval/parser_bench/viewer/src/components/Output.tsx`
- Create: `backend/eval/parser_bench/viewer/src/components/CheckChips.tsx`
- Create: `backend/eval/parser_bench/viewer/src/components/Zoom.tsx`
- Create: `backend/eval/parser_bench/viewer/src/styles.css`

**Interfaces:**
- Consumes: the JSON API of Task 12, and `@/components/markdown` (`Prose`: react-markdown, GFM, maths, KaTeX), resolved to the repo's `src/`.
- Produces:
  - `api.ts`: the types `Choice, Checks, RunRow, RunDetail, PageOutput, NamedOutput, SourceInfo, DiffOp, ComparisonSummary, NextDuel, RankingRow, CheckSummary, Results, MyVote, Method, StoredFile, Job`. It also exports `class Locked extends Error` (HTTP 423), `api.{runs, run, page, diff, sources, outputs, comparisons, next, vote, undo, results, myVotes, unlock, methods, files, upload, jobs, startJobs, cancel, install}` and `pngUrl(sha, page)`. Every request carries `X-Parser-Bench: 1`.
  - `lib.ts`: `KEY_CHOICE`, `CHOICE_LABEL`, `RULE` and `RULE_DETAIL` (the protocol's words). It also has these helpers:
    - `dash(value, digits?)`, which shows `—` for null;
    - `splitFooter(markdown, footerLines) -> Segment[]`, which counts lines like Python's `splitlines`;
    - `checkChips(checks) -> Chip[]`;
    - `newSession() -> "s-<16 hex>"`;
    - `median`, `minutesLeft`, `axis`, `pct`, `shortDate` and `jobLabel`.
  - `Output({markdown, footerLines?})`, which renders through `Prose` and marks footer lines when given any. Duels pass none, so both sides look alike. `CheckChips({checks})` and `Zoom({src, onClose})` round out the components.
- The look is the approved demo's: dark, monochrome, the same class names. The table class is `data`, not `grid`, because Tailwind's `grid` utility would turn tables into CSS grids.

- [ ] **Step 1: Write the build configuration**

`backend/eval/parser_bench/viewer/vite.config.ts`:

```ts
/*
 * The Parser Bench viewer: its own Vite build, separate from the app's, so it ships nothing of the
 * product but the reading face's renderer (`@/components/markdown` → Prose), which it imports so
 * outputs render exactly as learners would see them.
 *
 *   build:  npx vite build --config backend/eval/parser_bench/viewer/vite.config.ts
 *   test:   npx vitest run --config backend/eval/parser_bench/viewer/vite.config.ts
 *
 * The built files (viewer/dist, git-ignored) are served by `python -m backend.eval.parser_bench serve`.
 */
import path from "path";
import react from "@vitejs/plugin-react-swc";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { defineConfig } from "vitest/config";

const here = __dirname;
const repo = path.resolve(here, "../../../..");

export default defineConfig({
  root: here,
  base: "/",
  cacheDir: path.join(repo, "node_modules/.vite-parser-bench"),
  plugins: [react()],
  resolve: {
    alias: { "@": path.join(repo, "src") },
    dedupe: ["react", "react-dom"],
  },
  css: {
    postcss: { plugins: [tailwindcss({ config: path.join(here, "tailwind.config.ts") }), autoprefixer()] },
  },
  build: { outDir: path.join(here, "dist"), emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5207,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8766" } },
  },
  test: {
    root: here,
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "happy-dom",
  },
});
```

`backend/eval/parser_bench/viewer/tailwind.config.ts`:

```ts
/*
 * Only Prose (the reading face's renderer) and this viewer are scanned; the app's own theme is
 * the preset, so Prose's classes compile exactly as they do in the app.
 */
import path from "path";
import type { Config } from "tailwindcss";
import app from "../../../../tailwind.config";

const repo = path.resolve(__dirname, "../../../..");

export default {
  presets: [app],
  content: [
    path.join(__dirname, "index.html"),
    path.join(__dirname, "src/**/*.{ts,tsx}"),
    path.join(repo, "src/components/markdown/**/*.{ts,tsx}"),
  ],
} satisfies Config;
```

`backend/eval/parser_bench/viewer/tsconfig.json`:

```json
{
  "extends": "../../../../tsconfig.app.json",
  "compilerOptions": {
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src", "../../../../src/components/markdown"]
}
```

- [ ] **Step 2: Write the failing helper tests**

`backend/eval/parser_bench/viewer/src/lib.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Checks, Job } from "./api";
import { KEY_CHOICE, axis, checkChips, dash, jobLabel, minutesLeft, newSession, pct, splitFooter } from "./lib";

const CLEAN: Checks = {
  page: 3, footer_leaks: 0, footer_leaked: false, footer_token_share: 0, title_first: true, wrong_symbols: 0,
  lonely_bullets: 0, broken_line_pct: null, line_breaks: 0, broken_lines: 0, headings: 1, list_items: 2,
  max_depth: 1, tables: 0, math_spans: 0, dropped_words_pct: 0, invented_words_pct: 0, chars: 90,
};

describe("keys", () => {
  it("map 1–4 to the four answers", () => {
    expect(KEY_CHOICE).toEqual({ "1": "left", "2": "right", "3": "same", "4": "both_bad" });
  });
});

describe("dash", () => {
  it("shows a dash for what was not measured", () => {
    expect(dash(null)).toBe("—");
    expect(dash(undefined)).toBe("—");
    expect(dash(0)).toBe("0");
    expect(dash(52.66, 1)).toBe("52.7");
  });
});

describe("splitFooter", () => {
  it("cuts the output around the footer lines the server named", () => {
    const md = "# Title\nbody\nLecturer Softwaretechnik 3\n3\nmore";
    expect(splitFooter(md, [2, 3])).toEqual([
      { kind: "md", text: "# Title\nbody" },
      { kind: "footer", text: "Lecturer Softwaretechnik 3\n3" },
      { kind: "md", text: "more" },
    ]);
  });
  it("counts lines like Python's splitlines", () => {
    expect(splitFooter("a\r\nb" + String.fromCharCode(0x2028) + "c", [1])).toEqual([
      { kind: "md", text: "a" },
      { kind: "footer", text: "b" },
      { kind: "md", text: "c" },
    ]);
  });
  it("leaves output without footer lines whole", () => {
    expect(splitFooter("a\n\nb", [])).toEqual([{ kind: "md", text: "a\n\nb" }]);
  });
});

describe("checkChips", () => {
  it("says what is clean and gives no share when there was no break to judge", () => {
    const labels = checkChips(CLEAN).map((c) => c.label);
    expect(labels).toContain("no footer");
    expect(labels).toContain("no line breaks to judge");
    expect(labels).toContain("1 headings · 2 list items");
  });
  it("marks leaks and wrong symbols as bad", () => {
    const chips = checkChips({ ...CLEAN, footer_leaks: 3, footer_leaked: true, wrong_symbols: 2, title_first: false });
    expect(chips.filter((c) => c.tone === "bad").map((c) => c.label)).toEqual([
      "footer leaked ×3",
      "title not first",
      "wrong symbols ×2",
    ]);
  });
  it("skips title first where it does not apply", () => {
    expect(checkChips({ ...CLEAN, title_first: null }).some((c) => c.label.startsWith("title"))).toBe(false);
  });
});

describe("sessions and pace", () => {
  it("makes a session id the server accepts", () => {
    expect(newSession()).toMatch(/^s-[0-9a-f]{16}$/);
  });
  it("estimates the minutes left at the median pace", () => {
    expect(minutesLeft(30, [])).toBe(6);
    expect(minutesLeft(30, [4, 4, 100])).toBe(2);
  });
});

describe("interval chart", () => {
  it("always shows the 1000 line and clamps", () => {
    const scale = axis([{ lo: 1040, hi: 1200 }]);
    expect(scale[0]).toBeLessThan(1000);
    expect(pct(1000, scale)).toBeGreaterThan(0);
    expect(pct(5000, scale)).toBe(100);
  });
});

describe("jobs", () => {
  const job: Job = { job_id: "job-1", kind: "run", tool: "current", sha256: null, file_name: null, purpose: "explore",
    state: "running", stage: "timed", run_id: null, error: null };
  it("names the stage of a running job", () => {
    expect(jobLabel(job)).toBe("running");
    expect(jobLabel({ ...job, stage: "waiting" })).toBe("waiting for the running method");
    expect(jobLabel({ ...job, state: "failed", error: "current was cancelled" })).toBe("failed: current was cancelled");
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `$NODE node_modules/vitest/vitest.mjs run --config backend/eval/parser_bench/viewer/vite.config.ts`
Expected: FAIL: `Failed to resolve import "./lib"` (the file does not exist yet).

- [ ] **Step 4: Write the API client and the helpers**

`backend/eval/parser_bench/viewer/src/api.ts`:

```ts
/* The local server's JSON API (backend/eval/parser_bench/api_*.py), typed. */

export type Choice = "left" | "right" | "same" | "both_bad";

export interface Checks {
  page: number;
  footer_leaks: number | null;
  footer_leaked: boolean | null;
  footer_token_share?: number | null;
  title_first: boolean | null;
  wrong_symbols: number | null;
  lonely_bullets: number | null;
  broken_line_pct: number | null;
  line_breaks?: number | null;
  broken_lines?: number | null;
  headings: number | null;
  list_items: number | null;
  max_depth: number | null;
  tables: number | null;
  math_spans: number | null;
  dropped_words_pct: number | null;
  invented_words_pct: number | null;
  chars: number | null;
}

export interface RunRow {
  run_id: string;
  kind: "extract" | "compare";
  tool: string | null;
  version: string | null;
  purpose: string | null;
  status: string;
  reason?: string | null;
  started_at: string | null;
  file?: string | null;
  sha256?: string | null;
  pages_total?: number | null;
  pages: number[];
  seconds_per_page?: number | null;
  peak_memory_mb?: number | null;
  commit: string | null;
  dirty?: boolean | null;
  done?: number;
  total?: number;
  record_version: number;
  checks_version: number;
}

export interface RunDetail extends RunRow {
  environment: string[] | null;
  failed_stage: string | null;
  warmup_seconds: number | null;
  seconds_total: number | null;
  protocol_commit: string | null;
  page_list: { page: number; locked: boolean }[];
  checks: Checks[];
}

export interface PageOutput {
  run_id: string;
  page: number;
  markdown: string;
  footer_lines: number[];
  checks: Checks | null;
}

export type NamedOutput = RunRow & { markdown: string; footer_lines: number[]; checks: Checks | null };

export interface SourceInfo {
  sha256: string;
  name: string;
  pages_total: number | null;
  pages: number[];
  locked: number[];
  runs: number;
}

export interface DiffOp {
  op: "equal" | "delete" | "insert";
  text: string;
}

export interface ComparisonSummary {
  run_id: string;
  purpose: string;
  status: "judging" | "finished";
  started_at: string;
  done: number;
  total: number;
  rounds: number;
  unlocked_early: { at: string; reason: string } | null;
  locked: boolean;
  pages: { key: string; type: string }[];
}

export interface NextDuel {
  finished: boolean;
  done: number;
  total: number;
  duel?: number;
  round?: number;
  page?: { key: string; type: string; number: number; file: string; png: string };
  left?: { markdown: string };
  right?: { markdown: string };
}

export interface RankingRow {
  entrant: string;
  points: number;
  lo: number;
  hi: number;
  duels: number;
  wins: number;
  losses: number;
  same: number;
  both_bad: number;
}

export interface CheckSummary {
  pages: number;
  footer_leaks: number;
  pages_with_footer_leak: number;
  footer_token_share: number | null;
  title_first: number | null;
  wrong_symbols: number;
  lonely_bullets: number;
  broken_line_pct: number | null;
  dropped_words_pct: number | null;
  invented_words_pct: number | null;
  headings: number;
  list_items: number;
  tables: number;
  math_spans: number;
  seconds_per_page: number | null;
  peak_memory_mb: number | null;
  reference_biased: boolean;
}

export interface Results {
  run_id: string;
  status: string;
  votes: number;
  retracted: number;
  scheduled: number;
  rounds: number;
  round2_duels: number;
  anchor: string;
  bootstrap: { resamples: number; seed: number };
  ranking: RankingRow[];
  h1: { holds: boolean; above_anchor: string[] };
  self_consistency: { agree: number; total: number; share: number | null };
  win_rate_by_type: Record<string, Record<string, { duels: number; score: number }>>;
  median_seconds: number | null;
  checks: Record<string, CheckSummary>;
}

export interface MyVote {
  vote_id: string;
  duel: number;
  page: string;
  type: string | null;
  left: string;
  right: string;
  choice: Choice;
  seconds: number;
  note: string | null;
  withdrawn: boolean;
}

export interface Method {
  id: string;
  label: string;
  group: "fast" | "heavy" | "paid";
  description: string;
  ready: boolean;
  missing: string[];
  size_mb: number;
}

export interface StoredFile {
  sha256: string;
  name: string;
  pages: number;
  size: number;
  benchmark_pages: number[];
}

export interface Job {
  job_id: string;
  kind: "run" | "install";
  tool: string;
  sha256: string | null;
  file_name: string | null;
  purpose: string | null;
  state: "queued" | "running" | "finished" | "failed" | "cancelled" | "interrupted";
  stage: string | null;
  run_id: string | null;
  error: string | null;
}

/** A page whose outputs stay hidden while it is judged blind (HTTP 423). */
export class Locked extends Error {}

const WRITE = { "X-Parser-Bench": "1" };

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...WRITE, ...(init.headers ?? {}) } });
  if (res.ok) return (await res.json()) as T;
  let detail = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") detail = body.detail;
  } catch {
    // not JSON: keep the status line
  }
  if (res.status === 423) throw new Locked(detail);
  throw new Error(detail);
}

function post<T>(url: string, body: unknown): Promise<T> {
  return call<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const q = encodeURIComponent;

export const api = {
  runs: () => call<{ runs: RunRow[] }>("/api/runs"),
  run: (id: string) => call<RunDetail>(`/api/runs/${q(id)}`),
  page: (id: string, page: number) => call<PageOutput>(`/api/runs/${q(id)}/pages/${page}`),
  diff: (a: string, b: string, page: number) =>
    call<{ ops: DiffOp[] }>(`/api/diff?a=${q(a)}&b=${q(b)}&page=${page}`),
  sources: () => call<{ sources: SourceInfo[] }>("/api/sources"),
  outputs: (sha: string, page: number) => call<{ outputs: NamedOutput[] }>(`/api/outputs/${sha}/${page}`),
  comparisons: () => call<{ comparisons: ComparisonSummary[] }>("/api/comparisons"),
  next: (cid: string) => call<NextDuel>(`/api/comparisons/${q(cid)}/next`),
  vote: (cid: string, body: { duel: number; choice: Choice; seconds: number; session: string; note: string | null }) =>
    post<{ vote_id: string; done: number; total: number; added: number; finished: boolean }>(
      `/api/comparisons/${q(cid)}/votes`,
      body,
    ),
  undo: (cid: string, session: string) => post<{ retracted: number | null }>(`/api/comparisons/${q(cid)}/undo`, { session }),
  results: (cid: string) => call<Results>(`/api/comparisons/${q(cid)}/results`),
  myVotes: (cid: string) => call<{ votes: MyVote[] }>(`/api/comparisons/${q(cid)}/votes`),
  unlock: (cid: string, reason: string) => post<ComparisonSummary>(`/api/comparisons/${q(cid)}/unlock`, { reason }),
  methods: () => call<{ methods: Method[] }>("/api/methods"),
  files: () => call<{ files: StoredFile[] }>("/api/files"),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return call<StoredFile>("/api/files", { method: "POST", body: form });
  },
  jobs: () => call<{ jobs: Job[] }>("/api/jobs"),
  startJobs: (body: { sha256: string; tools: string[]; purpose: string }) => post<{ jobs: Job[] }>("/api/jobs", body),
  cancel: (id: string) => post<Job>(`/api/jobs/${q(id)}/cancel`, {}),
  install: (tool: string) => post<Job>(`/api/methods/${q(tool)}/install`, {}),
};

export const pngUrl = (sha: string, page: number) => `/api/files/${sha}/pages/${page}.png`;
```

`backend/eval/parser_bench/viewer/src/lib.ts`. The line-break pattern is built with `String.fromCharCode`, so no invisible U+2028/U+2029 characters end up in the source:

```ts
/* Pure helpers for the screens; tested in lib.test.ts. */
import type { Checks, Choice, Job } from "./api";

export const KEY_CHOICE: Record<string, Choice> = { "1": "left", "2": "right", "3": "same", "4": "both_bad" };
export const CHOICE_LABEL: Record<Choice, string> = {
  left: "Left better",
  right: "Right better",
  same: "Same",
  both_bad: "Both unusable",
};
// Word for word as in the protocol (spec "Duels").
export const RULE = "Which would you rather learn from?";
export const RULE_DETAIL = "Nothing missing, nothing invented, right order, no junk, clear structure.";

/** A measured number, or a dash where none was measured (never "null"). */
export function dash(value: number | null | undefined, digits = -1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return digits >= 0 ? value.toFixed(digits) : String(value);
}

// The line breaks Python's str.splitlines() knows, so line numbers match checks.footer_line_numbers.
const PY_LINES = new RegExp("\\r\\n|[\\n\\r\\v\\f\\x1c\\x1d\\x1e\\x85" + String.fromCharCode(0x2028, 0x2029) + "]");

export interface Segment {
  kind: "md" | "footer";
  text: string;
}

/** The output cut into runs of ordinary lines and footer lines, so footer lines can be marked. */
export function splitFooter(markdown: string, footerLines: number[]): Segment[] {
  const marked = new Set(footerLines);
  const out: Segment[] = [];
  markdown.split(PY_LINES).forEach((line, i) => {
    const kind = marked.has(i) ? "footer" : "md";
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += "\n" + line;
    else out.push({ kind, text: line });
  });
  return out.filter((s) => s.kind === "footer" || s.text.trim() !== "");
}

export interface Chip {
  label: string;
  tone: "good" | "bad" | "";
}

export function checkChips(c: Checks | null): Chip[] {
  if (!c) return [{ label: "no checks", tone: "" }];
  const chips: Chip[] = [];
  const leaks = c.footer_leaks ?? 0;
  chips.push(leaks ? { label: `footer leaked ×${leaks}`, tone: "bad" } : { label: "no footer", tone: "good" });
  if (c.title_first !== null) {
    chips.push(c.title_first ? { label: "title first", tone: "good" } : { label: "title not first", tone: "bad" });
  }
  const symbols = c.wrong_symbols ?? 0;
  chips.push(symbols ? { label: `wrong symbols ×${symbols}`, tone: "bad" } : { label: "symbols ok", tone: "good" });
  if (c.broken_line_pct === null) chips.push({ label: "no line breaks to judge", tone: "" });
  else chips.push({ label: `broken lines ${dash(c.broken_line_pct)}%`, tone: c.broken_line_pct > 20 ? "bad" : "" });
  chips.push({ label: `dropped ${dash(c.dropped_words_pct)}% · invented ${dash(c.invented_words_pct)}%`, tone: "" });
  const parts = [`${c.headings ?? 0} headings`, `${c.list_items ?? 0} list items`];
  if (c.tables) parts.push(`${c.tables} table${c.tables === 1 ? "" : "s"}`);
  if (c.math_spans) parts.push(`${c.math_spans} maths`);
  chips.push({ label: parts.join(" · "), tone: "" });
  return chips;
}

export function newSession(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "s-" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Minutes left at this session's median pace (11 s per duel before the first vote). */
export function minutesLeft(remaining: number, secondsSoFar: number[]): number {
  return Math.max(1, Math.round((remaining * (median(secondsSoFar) ?? 11)) / 60));
}

/** The scale of the interval chart: every interval and the 1000 line, with a margin. */
export function axis(rows: { lo: number; hi: number }[]): [number, number] {
  const lo = Math.min(1000, ...rows.map((r) => r.lo));
  const hi = Math.max(1000, ...rows.map((r) => r.hi));
  const pad = Math.max(20, (hi - lo) * 0.08);
  return [lo - pad, hi + pad];
}

export function pct(value: number, [lo, hi]: [number, number]): number {
  return Math.min(100, Math.max(0, (100 * (value - lo)) / (hi - lo)));
}

export function shortDate(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 16).replace("T", " ") : "—";
}

const STAGE: Record<string, string> = {
  starting: "starting",
  waiting: "waiting for the running method",
  warmup: "warming up",
  timed: "running",
  scoring: "scoring",
  cancelling: "cancelling",
};

export function jobLabel(job: Job): string {
  if (job.state === "queued") return "waiting";
  if (job.state === "running") return STAGE[job.stage ?? ""] ?? "running";
  if (job.state === "failed") return `failed: ${job.error ?? "no reason recorded"}`;
  return job.state;
}
```

- [ ] **Step 5: Run the helper tests to verify they pass**

Run: `$NODE node_modules/vitest/vitest.mjs run --config backend/eval/parser_bench/viewer/vite.config.ts`
Expected: `Tests  12 passed (12)`

- [ ] **Step 6: Write the components and the styles**

`backend/eval/parser_bench/viewer/src/components/Output.tsx`:

```tsx
import { Prose } from "@/components/markdown";
import { splitFooter } from "../lib";

/**
 * One method's output, through the reading face's own renderer. In a duel it is the plain text
 * (no marks, so both sides look alike); in Compare and Runs the footer lines are marked.
 */
export function Output({ markdown, footerLines = [] }: { markdown: string; footerLines?: number[] }) {
  if (!markdown.trim()) return <p className="empty">This method wrote nothing for this page.</p>;
  if (footerLines.length === 0) return <Prose>{markdown}</Prose>;
  return (
    <>
      {splitFooter(markdown, footerLines).map((segment, i) =>
        segment.kind === "footer" ? (
          <div key={i} className="junk-line" title="A footer line: the rule that cleans the page's own text removes it">
            {segment.text}
          </div>
        ) : (
          <Prose key={i}>{segment.text}</Prose>
        ),
      )}
    </>
  );
}
```

`backend/eval/parser_bench/viewer/src/components/CheckChips.tsx`:

```tsx
import type { Checks } from "../api";
import { checkChips } from "../lib";

export function CheckChips({ checks }: { checks: Checks | null }) {
  return (
    <div className="checks">
      {checkChips(checks).map((chip) => (
        <span key={chip.label} className={`ck ${chip.tone}`}>
          {chip.label}
        </span>
      ))}
    </div>
  );
}
```

`backend/eval/parser_bench/viewer/src/components/Zoom.tsx`:

```tsx
/** The page, enlarged; a click anywhere (or Z / Escape in Judge) closes it. */
export function Zoom({ src, onClose }: { src: string | null; onClose: () => void }) {
  if (!src) return null;
  return (
    <div className="zoom" role="dialog" aria-label="The page, enlarged" onClick={onClose}>
      <img src={src} alt="" />
    </div>
  );
}
```

`backend/eval/parser_bench/viewer/src/styles.css`:

```css
/* Parser Bench: the approved demo's look (dark, monochrome). Outputs render through Prose,
   whose Tailwind classes these three lines compile; everything else is plain CSS. */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg: #0a0a0b; --panel: #111113; --raise: #17171a; --line: #26262b; --line2: #34343a;
  --ink: #ececee; --ink2: #a6a6ad; --ink3: #6f6f77; --white: #fff;
  --junk: #5a1f22; --junk-ink: #ffb3b3;
  --ok: #9be3b0; --bad: #ff9d9d; --ins: #163a24; --del: #3d1717;
  --r: 10px;
  --reader-accent: rgba(255, 255, 255, 0.45);
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif; }
button, input, select { font: inherit; color: inherit; }
code { font: 12.5px ui-monospace, Menlo, monospace; background: var(--raise); padding: 1px 5px; border-radius: 4px; }

header { display: flex; align-items: center; gap: 20px; padding: 12px 20px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: rgba(10, 10, 11, 0.92); backdrop-filter: blur(8px); z-index: 5; }
.brand { font-weight: 600; letter-spacing: -0.01em; }
.brand span { color: var(--ink3); font-weight: 400; margin-left: 8px; }
nav { display: flex; gap: 4px; margin-left: 8px; }
nav button { background: none; border: 0; padding: 7px 12px; border-radius: 8px; color: var(--ink2); cursor: pointer; }
nav button:hover { background: var(--raise); color: var(--ink); }
nav button.on { background: var(--raise); color: var(--white); }
nav .lock { font-size: 11px; margin-left: 5px; color: var(--ink3); }
.spacer { flex: 1; }
.runpill { font-size: 12.5px; color: var(--ink2); border: 1px solid var(--line2); border-radius: 999px; padding: 5px 11px; }
main { padding: 20px; }
h2 { font-size: 18px; margin: 0 0 4px; font-weight: 600; letter-spacing: -0.01em; }
h2 .dim, .dim { color: var(--ink2); font-weight: 400; }
.sub { color: var(--ink2); margin: 0 0 18px; }
.small { font-size: 12.5px; color: var(--ink3); }
.mono { font-family: ui-monospace, Menlo, monospace; }
.gap { margin-top: 28px; }
.spaced { margin-top: 12px; }
.error { color: var(--bad); font-size: 13px; }
.empty { color: var(--ink3); font-style: italic; }
.ink { color: var(--ink); }
.linkbtn { background: none; border: 0; color: var(--ink2); text-decoration: underline; cursor: pointer; padding: 0; font-size: 12.5px; }
.linkbtn:disabled { text-decoration: none; cursor: default; }
select.pick { background: var(--panel); border: 1px solid var(--line2); border-radius: 8px; padding: 7px 10px; margin-bottom: 14px; }

/* outputs */
.junk-line { background: var(--junk); color: var(--junk-ink); border-radius: 4px; padding: 2px 6px; margin: 0.4em 0; font-size: 15px; white-space: pre-wrap; }
mark.junk { background: var(--junk); color: var(--junk-ink); border-radius: 3px; padding: 0 4px; }

/* judge */
.progress { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; color: var(--ink2); font-size: 13px; }
.track { flex: 1; height: 4px; background: var(--line); border-radius: 4px; overflow: hidden; }
.track i { display: block; height: 100%; background: var(--white); transition: width 0.3s; }
.judge { display: grid; grid-template-columns: minmax(280px, 34%) 1fr 1fr; gap: 14px; height: calc(100vh - 230px); min-height: 460px; }
.slide { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); padding: 12px; display: flex; flex-direction: column; gap: 10px; overflow: auto; }
.slide img, .page-img { width: 100%; border-radius: 6px; cursor: zoom-in; background: #fff; }
.slide .meta { color: var(--ink2); font-size: 12.5px; display: flex; gap: 8px; flex-wrap: wrap; }
.tag { border: 1px solid var(--line2); border-radius: 999px; padding: 2px 8px; font-size: 12px; color: var(--ink2); }
.out { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
.out .hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--line); color: var(--ink2); font-size: 12.5px; }
.out .hd b { color: var(--white); font-size: 13px; letter-spacing: 0.02em; }
.out .bd { padding: 16px 18px; overflow: auto; flex: 1; }
.out.picked { border-color: var(--white); box-shadow: 0 0 0 1px var(--white) inset; }
.bar { display: flex; align-items: center; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
.rule { color: var(--ink2); flex: 1; min-width: 260px; }
.rule b { color: var(--ink); }
.vote { background: var(--raise); border: 1px solid var(--line2); border-radius: 9px; padding: 10px 14px; cursor: pointer; display: flex; align-items: center; gap: 8px; }
.vote:hover { border-color: var(--ink3); }
.vote:disabled { opacity: 0.5; cursor: default; }
.vote kbd { font: 12px ui-monospace, Menlo, monospace; background: var(--bg); border: 1px solid var(--line2); border-radius: 5px; padding: 1px 6px; color: var(--ink2); }
.vote.primary { background: var(--white); color: #000; border-color: var(--white); }
.note { background: var(--bg); border: 1px solid var(--line2); border-radius: 8px; color: var(--ink); padding: 8px 10px; width: 300px; }
.toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--white); color: #000; padding: 8px 14px; border-radius: 8px; font-size: 13px; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
.toast.on { opacity: 1; }
.myvotes { margin-top: 22px; }

/* tables */
table.data { width: 100%; border-collapse: collapse; }
.data th { text-align: left; color: var(--ink3); font-weight: 500; font-size: 12.5px; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.data td { padding: 10px; border-bottom: 1px solid var(--line); color: var(--ink2); }
.data td.k { color: var(--ink); font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; white-space: nowrap; }
.data td.pick { color: var(--white); font-weight: 650; }
.data tr.withdrawn td { text-decoration: line-through; color: var(--ink3); }
.data tr.open td { background: var(--panel); }
.status { font-size: 12px; border-radius: 6px; padding: 2px 7px; background: var(--raise); }
.status.finished { color: var(--ok); }
.status.failed { color: var(--bad); }
.status.running, .status.judging { color: var(--ink); }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); padding: 16px 18px; }
.panel .out { margin-top: 10px; }

/* compare */
.strip { display: flex; gap: 10px; margin-bottom: 14px; overflow-x: auto; padding-bottom: 4px; }
.thumb { border: 1px solid var(--line); border-radius: 8px; padding: 5px; background: var(--panel); cursor: pointer; flex: 0 0 auto; width: 150px; color: var(--ink2); font-size: 12px; text-align: left; }
.thumb img { width: 100%; border-radius: 4px; display: block; margin-bottom: 4px; background: #fff; }
.thumb.on { border-color: var(--white); color: var(--white); }
.thumb.is-locked img { filter: grayscale(1) brightness(0.5); }
.chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; align-items: center; }
.chip { border: 1px solid var(--line2); background: var(--panel); border-radius: 999px; padding: 5px 12px; cursor: pointer; color: var(--ink2); }
.chip.on { background: var(--white); color: #000; border-color: var(--white); }
.chip.na { opacity: 0.5; }
.legend { margin-left: auto; color: var(--ink2); font-size: 12.5px; }
.cols { display: grid; gap: 14px; grid-auto-flow: column; grid-auto-columns: minmax(330px, 1fr); overflow-x: auto; }
.checks { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.ck { font-size: 12px; border-radius: 6px; padding: 2px 7px; background: var(--raise); color: var(--ink2); }
.ck.good { color: var(--ok); }
.ck.bad { color: var(--bad); }
.diffbox { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); padding: 16px 18px; line-height: 1.75; font-size: 15px; max-width: 90ch; white-space: pre-wrap; }
.diffbox del { background: var(--del); color: #ffb3b3; text-decoration: line-through; border-radius: 3px; padding: 0 2px; }
.diffbox ins { background: var(--ins); color: #b8f0c8; text-decoration: none; border-radius: 3px; padding: 0 2px; }

/* new run */
.two { display: grid; grid-template-columns: minmax(300px, 1fr) minmax(360px, 1.4fr); gap: 18px; }
.drop { border: 1.5px dashed var(--line2); border-radius: var(--r); padding: 28px; text-align: center; color: var(--ink2); background: var(--panel); }
.drop.has { border-style: solid; border-color: var(--ink3); text-align: left; }
.drop.over { border-color: var(--white); }
.drop b { color: var(--ink); }
.file { display: flex; gap: 12px; align-items: center; }
.file .ic { width: 38px; height: 48px; border-radius: 5px; background: #fff; color: #000; display: grid; place-items: center; font-size: 10px; font-weight: 700; }
.purpose { display: flex; gap: 8px; margin-top: 14px; }
.seg { border: 1px solid var(--line2); border-radius: 9px; padding: 10px 12px; cursor: pointer; flex: 1; background: var(--panel); text-align: left; }
.seg.on { border-color: var(--white); }
.seg:disabled { opacity: 0.45; cursor: not-allowed; }
.seg small { display: block; color: var(--ink3); margin-top: 2px; }
.group { margin-bottom: 16px; }
.group h4 { margin: 0 0 8px; font-size: 12px; color: var(--ink3); font-weight: 500; }
.method { display: grid; grid-template-columns: 22px 1fr auto; gap: 10px; align-items: center; padding: 10px 12px; border: 1px solid var(--line); border-radius: 9px; background: var(--panel); margin-bottom: 6px; cursor: pointer; }
.method:hover { border-color: var(--line2); }
.method.notready { cursor: default; }
.method input { accent-color: #fff; width: 16px; height: 16px; }
.method .nm { font-weight: 550; }
.method .ds { color: var(--ink3); font-size: 12.5px; }
.method .st { font-size: 12px; color: var(--ink2); text-align: right; white-space: nowrap; }
.method .st .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; background: var(--ink3); }
.method .st .dot.ready { background: var(--ok); }
.runbar { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.prog { margin-top: 14px; }
.prow { display: grid; grid-template-columns: 140px 1fr 60px; gap: 10px; align-items: center; margin: 6px 0; color: var(--ink2); font-size: 13px; }
.prow .failed { color: var(--bad); }
.prow .finished { color: var(--ok); }

/* scoreboard */
.locked { background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); padding: 28px; max-width: 640px; }
.cicell { width: 34%; }
.ci { position: relative; height: 18px; background: var(--raise); border-radius: 4px; min-width: 260px; }
.ci .r { position: absolute; top: 7px; height: 4px; background: var(--ink3); border-radius: 3px; }
.ci .p { position: absolute; top: 3px; width: 12px; height: 12px; border-radius: 50%; background: var(--white); transform: translateX(-6px); }
.ci .base { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--ink2); opacity: 0.6; }
svg.chart { width: 100%; max-width: 720px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--r); }
svg.chart circle { fill: var(--white); }
svg.chart text { fill: var(--ink2); font-size: 12px; }
svg.chart text.axis { fill: var(--ink3); }
svg.chart line.base { stroke: var(--ink3); stroke-dasharray: 3 4; }

.zoom { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); display: grid; place-items: center; z-index: 20; cursor: zoom-out; }
.zoom img { max-width: 94vw; max-height: 94vh; border-radius: 6px; background: #fff; }
@media (max-width: 900px) {
  .judge { grid-template-columns: 1fr; height: auto; }
  .two { grid-template-columns: 1fr; }
  header { flex-wrap: wrap; }
}
```

- [ ] **Step 7: Type-check and lint**

Run: `$NODE node_modules/typescript/bin/tsc -p backend/eval/parser_bench/viewer/tsconfig.json && $NODE node_modules/eslint/bin/eslint.js backend/eval/parser_bench/viewer/src`
Expected: no output, exit 0. The type check also covers `src/components/markdown`.

- [ ] **Step 8: Commit**

```bash
git add backend/eval/parser_bench/viewer
git commit -m "feat(parser-bench): viewer foundation — own Vite build with the reading face's Prose, API client, helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The viewer's judging screens: Judge, My votes, Scoreboard

**Files:**
- Create: `backend/eval/parser_bench/viewer/src/screens/Judge.tsx`
- Create: `backend/eval/parser_bench/viewer/src/screens/MyVotes.tsx`
- Create: `backend/eval/parser_bench/viewer/src/screens/Scoreboard.tsx`

**Interfaces:**
- Consumes: `api`, `Locked`, `lib` and `Output`/`Zoom` from Task 13.
- Produces:
  - `Judge({comparison, names, notify, onProgress})`.
  - `MyVotes({cid, names})`.
  - `Scoreboard({comparisons, names, onChange})`.

**Behaviour**, as in the demo:
- **Judge.**
  - **Screen.** A progress bar with the time left at the session's median pace. The page (click or Z to enlarge) and LEFT and RIGHT outputs through `Prose`, with no names and no reveal link. The rule, word for word.
  - **Answers.** Keys 1–4 vote. N focuses the note, and Enter or Escape leaves it. U undoes. A vote saves at once and the next duel follows after 260 ms.
  - **Round 2.** When the server adds round-2 duels, a toast says so.
  - **Finished.** Once judging is finished, My votes appears.
- **My votes.** Every vote with both names. The pick is bold, with the seconds and the note. Withdrawn votes are struck through and marked.
- **Scoreboard.**
  - **Locked.** While locked, it says so and offers "Unlock early" with a required reason, which goes into the lab log.
  - **Open.** Afterwards it shows:
    - the ranking with interval bars around the 1000 line;
    - H1;
    - self-consistency;
    - median time;
    - the check table, with † marking the reference-biased methods;
    - quality versus speed (log seconds per page);
    - win rate by page type.

- [ ] **Step 1: Write the three screens**

`backend/eval/parser_bench/viewer/src/screens/Judge.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Choice, type ComparisonSummary, type NextDuel } from "../api";
import { Output } from "../components/Output";
import { Zoom } from "../components/Zoom";
import { CHOICE_LABEL, KEY_CHOICE, RULE, RULE_DETAIL, minutesLeft, newSession } from "../lib";
import { MyVotes } from "./MyVotes";

interface Props {
  comparison: ComparisonSummary | null;
  names: Record<string, string>;
  notify: (message: string) => void;
  onProgress: () => void;
}

/** Blind duels: the page and two unnamed outputs. Keys 1–4 vote, N note, Z enlarge, U undo. */
export function Judge({ comparison, names, notify, onProgress }: Props) {
  const session = useMemo(newSession, []);
  const [duel, setDuel] = useState<NextDuel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Choice | null>(null);
  const [zoom, setZoom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(performance.now());
  const paces = useRef<number[]>([]);
  const noteRef = useRef<HTMLInputElement>(null);
  const cid = comparison?.run_id ?? null;

  const load = useCallback(async () => {
    if (!cid) return;
    try {
      const next = await api.next(cid);
      setDuel(next);
      setPicked(null);
      setNote("");
      setError(null);
      started.current = performance.now();
      setElapsed(0);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [cid]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.round((performance.now() - started.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const vote = useCallback(
    async (choice: Choice) => {
      if (!cid || !duel || duel.duel === undefined || busy) return;
      setBusy(true);
      const seconds = (performance.now() - started.current) / 1000;
      try {
        const saved = await api.vote(cid, { duel: duel.duel, choice, seconds, session, note: note.trim() || null });
        paces.current.push(seconds);
        setPicked(choice);
        notify(saved.added ? `Saved. Round 2 adds ${saved.added} duels` : "Saved");
        onProgress();
        setTimeout(() => {
          setBusy(false);
          load();
        }, 260);
      } catch (e) {
        setBusy(false);
        setError((e as Error).message);
      }
    },
    [cid, duel, busy, session, note, notify, onProgress, load],
  );

  const undo = useCallback(async () => {
    if (!cid || busy) return;
    try {
      const r = await api.undo(cid, session);
      notify(r.retracted === null ? "Nothing to undo" : "Last vote withdrawn (kept in the log as a retraction)");
      onProgress();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [cid, busy, session, notify, onProgress, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        if (e.key === "Escape" || e.key === "Enter") target.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (zoom) {
        if (key === "z" || key === "escape") setZoom(false);
        return;
      }
      if (KEY_CHOICE[e.key]) vote(KEY_CHOICE[e.key]);
      else if (key === "u") undo();
      else if (key === "z") setZoom(true);
      else if (key === "n") {
        e.preventDefault();
        noteRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [vote, undo, zoom]);

  if (!comparison) {
    return (
      <div className="locked">
        <h2>No comparison yet</h2>
        <p className="sub">
          Make benchmark runs, then create one: <code>python -m backend.eval.parser_bench compare create</code>.
        </p>
      </div>
    );
  }
  if (!duel) return <p className="sub">{error ?? "Loading…"}</p>;
  if (duel.duel === undefined || !duel.page || !duel.left || !duel.right) {
    return (
      <section>
        <h2>{duel.finished ? "Judging finished" : "Nothing left to judge"}</h2>
        <p className="sub">{duel.done} votes saved. Names are shown now, never earlier.</p>
        {comparison.locked ? null : <MyVotes cid={comparison.run_id} names={names} />}
      </section>
    );
  }

  const page = duel.page;
  const sides = { left: duel.left.markdown, right: duel.right.markdown };
  return (
    <section>
      <div className="progress">
        <span>
          Duel {duel.done + 1} of {duel.total}
          {duel.round === 2 ? " · round 2" : ""}
        </span>
        <div className="track">
          <i style={{ width: `${(100 * duel.done) / duel.total}%` }} />
        </div>
        <span>about {minutesLeft(duel.total - duel.done, paces.current)} min left</span>
      </div>
      <div className="judge">
        <div className="slide">
          <img src={page.png} alt="The page being judged" onClick={() => setZoom(true)} />
          <div className="meta">
            <span>
              {page.file} · page {page.number}
            </span>
            <span className="tag">{page.type}</span>
          </div>
          <div className="small">
            Click the page or press Z to enlarge it. Method names are hidden, and the sides are shuffled for every duel.
          </div>
        </div>
        {(["left", "right"] as const).map((side) => (
          <div key={side} className={`out ${picked === side ? "picked" : ""}`}>
            <div className="hd">
              <b>{side.toUpperCase()}</b>
            </div>
            <div className="bd">
              <Output markdown={sides[side]} />
            </div>
          </div>
        ))}
      </div>
      <div className="bar">
        <div className="rule">
          <b>{RULE}</b> {RULE_DETAIL}
        </div>
        {Object.entries(KEY_CHOICE).map(([key, choice]) => (
          <button key={key} className="vote" disabled={busy} onClick={() => vote(choice)}>
            <kbd>{key}</kbd> {CHOICE_LABEL[choice]}
          </button>
        ))}
      </div>
      <div className="bar">
        <input
          ref={noteRef}
          className="note"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note (N to focus)"
        />
        <button className="linkbtn" onClick={undo}>
          Undo last vote (U)
        </button>
        <span className="small">{elapsed} s on this duel</span>
        {error ? <span className="error">{error}</span> : null}
      </div>
      <Zoom src={zoom ? page.png : null} onClose={() => setZoom(false)} />
    </section>
  );
}
```

`backend/eval/parser_bench/viewer/src/screens/MyVotes.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type MyVote } from "../api";
import { CHOICE_LABEL } from "../lib";

/** After judging: every duel with both names, the pick in bold, seconds, note, withdrawn votes marked. */
export function MyVotes({ cid, names }: { cid: string; names: Record<string, string> }) {
  const [votes, setVotes] = useState<MyVote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .myVotes(cid)
      .then((r) => setVotes(r.votes))
      .catch((e: Error) => setError(e.message));
  }, [cid]);

  if (error) return <p className="error">{error}</p>;
  if (!votes) return null;
  const name = (id: string) => names[id] ?? id;
  return (
    <div className="myvotes">
      <h2>My votes</h2>
      <p className="sub">
        Every duel, now with both names. Your pick is in bold. Withdrawn votes stay in the log, marked as withdrawn.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>Page</th>
            <th>Left</th>
            <th>Right</th>
            <th>Your vote</th>
            <th>Seconds</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {votes.map((v) => (
            <tr key={v.vote_id} className={v.withdrawn ? "withdrawn" : ""}>
              <td>{v.duel + 1}</td>
              <td>
                {v.page} · {v.type}
              </td>
              <td className={v.choice === "left" ? "pick" : ""}>{name(v.left)}</td>
              <td className={v.choice === "right" ? "pick" : ""}>{name(v.right)}</td>
              <td>
                {CHOICE_LABEL[v.choice]}
                {v.withdrawn ? " · withdrawn" : ""}
              </td>
              <td>{v.seconds}</td>
              <td>{v.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`backend/eval/parser_bench/viewer/src/screens/Scoreboard.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Locked, api, type ComparisonSummary, type Results } from "../api";
import { axis, dash, pct } from "../lib";

interface Props {
  comparisons: ComparisonSummary[];
  names: Record<string, string>;
  onChange: () => void;
}

const TYPES = ["layout", "lists", "table_formula", "diagram", "dense_text"];

/** Ranking with intervals, the check table, quality versus speed, self-consistency. */
export function Scoreboard({ comparisons, names, onChange }: Props) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [data, setData] = useState<Results | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const chosen = comparisons.find((c) => c.run_id === chosenId) ?? comparisons[0] ?? null;
  const id = chosen?.run_id;
  const state = `${chosen?.status}-${chosen?.done}-${chosen?.unlocked_early?.at ?? ""}`;

  useEffect(() => {
    if (!id) return;
    setData(null);
    setLocked(false);
    setError(null);
    api
      .results(id)
      .then(setData)
      .catch((e: Error) => (e instanceof Locked ? setLocked(true) : setError(e.message)));
  }, [id, state]);

  if (!chosen) return <p className="sub">No comparison yet.</p>;
  const name = (entrant: string) => names[entrant] ?? entrant;
  const picker =
    comparisons.length > 1 ? (
      <select className="pick" value={chosen.run_id} onChange={(e) => setChosenId(e.target.value)}>
        {comparisons.map((c) => (
          <option key={c.run_id} value={c.run_id}>
            {c.run_id} · {c.status}
          </option>
        ))}
      </select>
    ) : null;

  if (locked) {
    const unlock = () =>
      api
        .unlock(chosen.run_id, reason)
        .then(onChange)
        .catch((e: Error) => setError(e.message));
    return (
      <div className="locked">
        {picker}
        <h2>The scoreboard opens when judging is finished</h2>
        <p className="sub">
          {chosen.done} of {chosen.total} duels judged. The ranking is recalculated from your raw votes every time, never
          edited by hand.
        </p>
        <p className="sub">Unlocking early is allowed, and it is written to the lab log as a deviation.</p>
        <div className="bar">
          <input
            className="note"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why unlock early? (goes into the lab log)"
          />
          <button className="vote" disabled={!reason.trim()} onClick={unlock}>
            Unlock early
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </div>
    );
  }
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="sub">Computing the ranking…</p>;
  if (!data.ranking.length) return <p className="sub">No votes yet.</p>;

  const scale = axis(data.ranking);
  const sc = data.self_consistency;
  const tools = data.ranking.map((r) => r.entrant);
  return (
    <section>
      {picker}
      <h2>Ranking</h2>
      <p className="sub">
        Bradley–Terry points from {data.votes} blind duels, with our current extraction at 1000. The bar is the 95%
        interval from {data.bootstrap.resamples.toLocaleString("en")} resamples. A method beats today only if its whole
        bar sits right of the line.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>Method</th>
            <th>Points (95% interval)</th>
            <th />
            <th>Duels</th>
            <th>Both unusable</th>
          </tr>
        </thead>
        <tbody>
          {data.ranking.map((r, i) => (
            <tr key={r.entrant}>
              <td>{i + 1}</td>
              <td className="ink">{name(r.entrant)}</td>
              <td>
                {r.points.toFixed(0)}{" "}
                <span className="small">
                  ({r.lo.toFixed(0)}–{r.hi.toFixed(0)})
                </span>
              </td>
              <td className="cicell">
                <div className="ci">
                  <span className="base" style={{ left: `${pct(1000, scale)}%` }} />
                  <span className="r" style={{ left: `${pct(r.lo, scale)}%`, width: `${pct(r.hi, scale) - pct(r.lo, scale)}%` }} />
                  <span className="p" style={{ left: `${pct(r.points, scale)}%` }} />
                </div>
              </td>
              <td>{r.duels}</td>
              <td>{r.both_bad}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">
        H1{" "}
        {data.h1.holds
          ? `holds: ${data.h1.above_anchor.map(name).join(", ")} lie${data.h1.above_anchor.length === 1 ? "s" : ""} entirely above our current extraction.`
          : "does not hold: no method's interval lies entirely above our current extraction."}{" "}
        Self-consistency on {sc.total} hidden repeats: {sc.agree} of {sc.total}
        {sc.share === null ? "" : ` (${Math.round(sc.share * 100)}%)`}. Median decision time: {dash(data.median_seconds)} s.
        {data.round2_duels ? ` Round 2 added ${data.round2_duels} duels.` : ""}
      </p>

      <h2 className="gap">Automatic checks</h2>
      <p className="sub">
        Over the comparison's pages. † Dropped and invented words use PyMuPDF's own text layer as the reference, so these
        methods score near-perfect there by construction.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>Method</th>
            <th>Footer leaks</th>
            <th>Pages leaking</th>
            <th>Footer share</th>
            <th>Title first</th>
            <th>Wrong symbols</th>
            <th>Broken lines</th>
            <th>Dropped</th>
            <th>Invented</th>
            <th>s / page</th>
            <th>Peak MB</th>
          </tr>
        </thead>
        <tbody>
          {tools.map((t) => {
            const c = data.checks[t];
            return (
              <tr key={t}>
                <td className="ink">
                  {name(t)}
                  {c.reference_biased ? " †" : ""}
                </td>
                <td>{c.footer_leaks}</td>
                <td>
                  {c.pages_with_footer_leak} / {c.pages}
                </td>
                <td>{c.footer_token_share === null ? "—" : `${Math.round(c.footer_token_share * 100)}%`}</td>
                <td>{c.title_first === null ? "—" : `${Math.round(c.title_first * 100)}%`}</td>
                <td>{c.wrong_symbols}</td>
                <td>{c.broken_line_pct === null ? "—" : `${dash(c.broken_line_pct, 1)}%`}</td>
                <td>{c.dropped_words_pct === null ? "—" : `${dash(c.dropped_words_pct, 1)}%`}</td>
                <td>{c.invented_words_pct === null ? "—" : `${dash(c.invented_words_pct, 1)}%`}</td>
                <td>{dash(c.seconds_per_page)}</td>
                <td>{dash(c.peak_memory_mb)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 className="gap">Quality versus speed</h2>
      <QualitySpeed
        points={data.ranking.map((r) => ({ label: name(r.entrant), y: r.points, x: data.checks[r.entrant]?.seconds_per_page ?? null }))}
      />

      <h2 className="gap">Win rate by page type</h2>
      <p className="sub">Wins plus half the draws, per duel. Descriptive only.</p>
      <table className="data">
        <thead>
          <tr>
            <th>Method</th>
            {TYPES.map((t) => (
              <th key={t}>{t.replace("_", " / ")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tools.map((t) => (
            <tr key={t}>
              <td className="ink">{name(t)}</td>
              {TYPES.map((type) => {
                const cell = data.win_rate_by_type[t]?.[type];
                return <td key={type}>{cell ? `${Math.round(cell.score * 100)}% (${cell.duels})` : "—"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Points against seconds per page (log scale); methods without a time are left out. */
function QualitySpeed({ points }: { points: { label: string; x: number | null; y: number }[] }) {
  const shown = points.filter((p): p is { label: string; x: number; y: number } => p.x !== null && p.x > 0);
  if (!shown.length) return <p className="sub">No timings yet.</p>;
  const W = 640;
  const H = 280;
  const M = 44;
  const xs = shown.map((p) => Math.log10(p.x));
  const [x0, x1] = [Math.min(...xs) - 0.3, Math.max(...xs) + 0.3];
  const [y0, y1] = axis(shown.map((p) => ({ lo: p.y, hi: p.y })));
  const sx = (v: number) => M + ((Math.log10(v) - x0) / (x1 - x0)) * (W - 2 * M);
  const sy = (v: number) => H - M - ((v - y0) / (y1 - y0)) * (H - 2 * M);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Points against seconds per page">
      <line x1={M} x2={W - M} y1={sy(1000)} y2={sy(1000)} className="base" />
      <text x={M} y={H - 12} className="axis">
        faster ←  seconds per page (log scale)  → slower
      </text>
      <text x={8} y={M - 16} className="axis">
        points
      </text>
      {shown.map((p) => (
        <g key={p.label}>
          <circle cx={sx(p.x)} cy={sy(p.y)} r={5} />
          <text x={sx(p.x) + 8} y={sy(p.y) + 4}>
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `$NODE node_modules/typescript/bin/tsc -p backend/eval/parser_bench/viewer/tsconfig.json && $NODE node_modules/eslint/bin/eslint.js backend/eval/parser_bench/viewer/src`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add backend/eval/parser_bench/viewer/src/screens
git commit -m "feat(parser-bench): viewer Judge (keys 1–4/N/Z/U, blind), My votes and Scoreboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The viewer's other screens, the build, and a check in the browser

**Files:**
- Create: `backend/eval/parser_bench/viewer/src/screens/Compare.tsx`
- Create: `backend/eval/parser_bench/viewer/src/screens/Runs.tsx`
- Create: `backend/eval/parser_bench/viewer/src/screens/NewRun.tsx`
- Create: `backend/eval/parser_bench/viewer/src/App.tsx`
- Create: `backend/eval/parser_bench/viewer/src/main.tsx`
- Create: `backend/eval/parser_bench/viewer/index.html`
- Modify: `eslint.config.js` (ignore the viewer's build output)
- Local only, git-ignored: `.claude/launch.json` (a `parser-bench` entry)

**Interfaces:**
- Consumes: Tasks 12–14.
- Produces:
  - `Compare({names})`: a file picker, a page strip (locked pages greyed), chips per run, and the page next to each named output with its check chips and marked footer lines.
  - `Runs({names, notify})`:
    - every run, newest first, with started date, method and version, file, purpose, status (with judging progress), pages, s/page, peak MB (— when not measured) and commit;
    - running and queued jobs on top, with stage and Cancel;
    - one run's environment, pages and checks;
    - a word diff of two runs of the same method on the same file.
  - `NewRun({notify})`:
    - drop or choose a PDF (stored by SHA-256), or pick one brought in before;
    - Explore or Benchmark set (only for page-set files);
    - methods grouped Fast / Heavy / Costs money with ready or install;
    - "Run N methods" with live progress per method and Cancel.
  - `App`: the header with New run, Judge, Compare, Scoreboard and Runs ("locked" marks while a benchmark comparison is judged) and a pill with the comparison's progress.
  - The built `viewer/dist/` is served by `serve`.

- [ ] **Step 1: Write the remaining screens, the shell and the entry**

`backend/eval/parser_bench/viewer/src/screens/Compare.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Locked, api, pngUrl, type NamedOutput, type SourceInfo } from "../api";
import { CheckChips } from "../components/CheckChips";
import { Output } from "../components/Output";
import { Zoom } from "../components/Zoom";
import { shortDate } from "../lib";

/** Any page of any file, the page image and every finished run's output side by side, with names. */
export function Compare({ names }: { names: Record<string, string> }) {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sha, setSha] = useState<string | null>(null);
  const [page, setPage] = useState<number | null>(null);
  const [outputs, setOutputs] = useState<NamedOutput[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    api
      .sources()
      .then((r) => {
        setSources(r.sources);
        setSha((current) => current ?? r.sources[0]?.sha256 ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const source = sources.find((s) => s.sha256 === sha) ?? null;

  useEffect(() => {
    if (source && (page === null || !source.pages.includes(page))) {
      setPage(source.pages.find((p) => !source.locked.includes(p)) ?? source.pages[0] ?? null);
    }
  }, [source, page]);

  useEffect(() => {
    if (!sha || page === null) return;
    setLocked(false);
    setOutputs([]);
    api
      .outputs(sha, page)
      .then((r) => setOutputs(r.outputs))
      .catch((e: Error) => (e instanceof Locked ? setLocked(true) : setError(e.message)));
  }, [sha, page]);

  const toggle = (runId: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });

  if (error) return <p className="error">{error}</p>;
  if (!sources.length) return <p className="sub">No finished runs yet. Start one on New run.</p>;
  return (
    <section>
      <div className="chips">
        <select
          className="pick"
          value={sha ?? ""}
          onChange={(e) => {
            setSha(e.target.value);
            setPage(null);
          }}
        >
          {sources.map((s) => (
            <option key={s.sha256} value={s.sha256}>
              {s.name} · {s.runs} run{s.runs === 1 ? "" : "s"}
            </option>
          ))}
        </select>
      </div>
      <div className="strip">
        {source?.pages.map((p) => {
          const isLocked = source.locked.includes(p);
          return (
            <button key={p} className={`thumb ${p === page ? "on" : ""} ${isLocked ? "is-locked" : ""}`} onClick={() => setPage(p)}>
              <img src={pngUrl(source.sha256, p)} alt="" loading="lazy" />
              Page {p}
              {isLocked ? " · locked" : ""}
            </button>
          );
        })}
      </div>
      {locked ? (
        <div className="locked">
          <h2>This page is locked while you judge</h2>
          <p className="sub">
            Seeing outputs with their names would teach you each method's style, and the duels would stop being blind. It
            opens when judging is finished.
          </p>
        </div>
      ) : sha && page !== null ? (
        <>
          <div className="chips">
            {outputs.map((o) => (
              <button key={o.run_id} className={`chip ${hidden.has(o.run_id) ? "" : "on"}`} onClick={() => toggle(o.run_id)}>
                {names[o.tool ?? ""] ?? o.tool} {o.version}
              </button>
            ))}
            <span className="legend">
              <mark className="junk">footer</mark> a footer line in the output
            </span>
          </div>
          <div className="cols">
            <div className="out">
              <div className="hd">
                <b>THE PAGE</b>
                <span>page {page}</span>
              </div>
              <div className="bd">
                <img className="page-img" src={pngUrl(sha, page)} alt="" onClick={() => setZoom(pngUrl(sha, page))} />
              </div>
            </div>
            {outputs
              .filter((o) => !hidden.has(o.run_id))
              .map((o) => (
                <div key={o.run_id} className="out">
                  <div className="hd">
                    <b>{(names[o.tool ?? ""] ?? o.tool ?? "").toUpperCase()}</b>
                    <span className="small">
                      {o.version} · {o.purpose} · {shortDate(o.started_at)}
                    </span>
                  </div>
                  <CheckChips checks={o.checks} />
                  <div className="bd">
                    <Output markdown={o.markdown} footerLines={o.footer_lines} />
                  </div>
                </div>
              ))}
          </div>
        </>
      ) : null}
      <Zoom src={zoom} onClose={() => setZoom(null)} />
    </section>
  );
}
```

`backend/eval/parser_bench/viewer/src/screens/Runs.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Locked, api, type DiffOp, type Job, type PageOutput, type RunDetail, type RunRow } from "../api";
import { CheckChips } from "../components/CheckChips";
import { Output } from "../components/Output";
import { dash, jobLabel, shortDate } from "../lib";

interface Props {
  names: Record<string, string>;
  notify: (message: string) => void;
}

/** Every run, the jobs still running, one run's outputs and checks, and two runs' differences. */
export function Runs({ names, notify }: Props) {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [pair, setPair] = useState<string[]>([]);
  const load = useCallback(() => {
    api.runs().then((r) => setRows(r.runs)).catch(() => undefined);
    api.jobs().then((r) => setJobs(r.jobs)).catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  const active = jobs.filter((j) => j.state === "queued" || j.state === "running");
  useEffect(() => {
    if (!active.length) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [active.length, load]);

  const name = (tool: string | null) => (tool ? names[tool] ?? tool : "—");
  const toggle = (id: string) => setPair((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  const [a, b] = pair.map((id) => rows.find((r) => r.run_id === id));
  const cancel = (id: string) =>
    api
      .cancel(id)
      .then(load)
      .catch((e: Error) => notify(e.message));

  return (
    <section>
      <h2>Runs</h2>
      <p className="sub">
        Every extraction and every comparison is a permanent record. Tick two runs of the same method on the same file to
        see what changed.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th />
            <th>Run</th>
            <th>Started</th>
            <th>Method</th>
            <th>File</th>
            <th>Purpose</th>
            <th>Status</th>
            <th>Pages</th>
            <th>s / page</th>
            <th>Peak MB</th>
            <th>Commit</th>
          </tr>
        </thead>
        <tbody>
          {active.map((j) => (
            <tr key={j.job_id}>
              <td />
              <td className="k">{j.job_id}</td>
              <td>now</td>
              <td className="ink">{name(j.tool)}</td>
              <td>{j.file_name ?? "—"}</td>
              <td>{j.purpose ?? "install"}</td>
              <td>
                <span className="status running">{jobLabel(j)}</span>
              </td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td>
                <button className="linkbtn" onClick={() => cancel(j.job_id)}>
                  Cancel
                </button>
              </td>
            </tr>
          ))}
          {rows.map((r) => (
            <tr key={r.run_id} className={open === r.run_id ? "open" : ""}>
              <td>
                {r.kind === "extract" ? (
                  <input type="checkbox" checked={pair.includes(r.run_id)} onChange={() => toggle(r.run_id)} aria-label="Pick to compare" />
                ) : null}
              </td>
              <td className="k">
                {r.kind === "extract" ? (
                  <button className="linkbtn" onClick={() => setOpen(open === r.run_id ? null : r.run_id)}>
                    {r.run_id}
                  </button>
                ) : (
                  r.run_id
                )}
              </td>
              <td>{shortDate(r.started_at)}</td>
              <td className="ink">{r.kind === "compare" ? "Comparison" : `${name(r.tool)} ${r.version ?? ""}`}</td>
              <td>{r.file ?? "—"}</td>
              <td>{r.purpose ?? "—"}</td>
              <td>
                <span className={`status ${r.status}`} title={r.reason ?? undefined}>
                  {r.kind === "compare" ? `${r.status} · ${r.done} / ${r.total}` : r.status}
                </span>
              </td>
              <td>{r.kind === "compare" ? r.pages_total : r.pages.length}</td>
              <td>{dash(r.seconds_per_page)}</td>
              <td>{dash(r.peak_memory_mb)}</td>
              <td className="k">
                {r.commit ? r.commit.slice(0, 8) : "—"}
                {r.dirty ? "*" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open ? <RunView runId={open} name={name} /> : null}
      {a && b ? (
        a.tool === b.tool && a.sha256 === b.sha256 ? (
          <DiffView a={a} b={b} name={name} />
        ) : (
          <p className="sub gap">Pick two runs of the same method on the same file.</p>
        )
      ) : null}
    </section>
  );
}

function RunView({ runId, name }: { runId: string; name: (tool: string | null) => string }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [page, setPage] = useState<number | null>(null);
  const [output, setOutput] = useState<PageOutput | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    setRun(null);
    setOutput(null);
    api.run(runId).then((r) => {
      setRun(r);
      setPage(r.page_list.find((p) => !p.locked)?.page ?? r.page_list[0]?.page ?? null);
    });
  }, [runId]);

  useEffect(() => {
    if (page === null) return;
    setLocked(false);
    setOutput(null);
    api
      .page(runId, page)
      .then(setOutput)
      .catch((e: Error) => setLocked(e instanceof Locked));
  }, [runId, page]);

  if (!run) return null;
  return (
    <div className="panel gap">
      <h2>
        {name(run.tool)} {run.version} <span className="dim">· {run.file} · {shortDate(run.started_at)}</span>
      </h2>
      <p className="small">
        {run.status}
        {run.reason ? `: ${run.reason}` : ""} · {dash(run.seconds_per_page)} s/page · peak {dash(run.peak_memory_mb)} MB ·
        warm-up {dash(run.warmup_seconds)} s · checks v{run.checks_version} · record v{run.record_version}
        {run.protocol_commit ? ` · protocol ${run.protocol_commit.slice(0, 8)}` : ""}
      </p>
      {run.environment ? <p className="small mono">{run.environment.join("  ·  ")}</p> : null}
      <div className="chips">
        {run.page_list.map((p) => (
          <button key={p.page} className={`chip ${p.page === page ? "on" : ""} ${p.locked ? "na" : ""}`} onClick={() => setPage(p.page)}>
            Page {p.page}
            {p.locked ? " · locked" : ""}
          </button>
        ))}
      </div>
      {locked ? (
        <p className="sub">This page is in the benchmark set and still being judged blind; its output opens when judging is finished.</p>
      ) : output ? (
        <div className="out">
          <CheckChips checks={output.checks} />
          <div className="bd">
            <Output markdown={output.markdown} footerLines={output.footer_lines} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DiffView({ a, b, name }: { a: RunRow; b: RunRow; name: (tool: string | null) => string }) {
  const [older, newer] = (a.started_at ?? "") <= (b.started_at ?? "") ? [a, b] : [b, a];
  const pages = older.pages.filter((p) => newer.pages.includes(p));
  const [page, setPage] = useState<number | null>(pages[0] ?? null);
  const [ops, setOps] = useState<DiffOp[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (page === null) return;
    setOps(null);
    setMessage(null);
    api
      .diff(older.run_id, newer.run_id, page)
      .then((r) => setOps(r.ops))
      .catch((e: Error) =>
        setMessage(e instanceof Locked ? "This page is still being judged blind; the difference opens afterwards." : e.message),
      );
  }, [older.run_id, newer.run_id, page]);

  return (
    <div className="panel gap">
      <h2>
        What changed: <span className="dim">{name(older.tool)}, {shortDate(older.started_at)} → {shortDate(newer.started_at)}</span>
      </h2>
      <div className="chips">
        {pages.map((p) => (
          <button key={p} className={`chip ${p === page ? "on" : ""}`} onClick={() => setPage(p)}>
            Page {p}
          </button>
        ))}
      </div>
      {message ? <p className="sub">{message}</p> : null}
      {ops ? (
        <div className="diffbox">
          {ops.map((op, i) =>
            op.op === "equal" ? <span key={i}>{op.text}</span> : op.op === "delete" ? <del key={i}>{op.text}</del> : <ins key={i}>{op.text}</ins>,
          )}
        </div>
      ) : null}
    </div>
  );
}
```

`backend/eval/parser_bench/viewer/src/screens/NewRun.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Job, type Method, type StoredFile } from "../api";
import { jobLabel } from "../lib";

const GROUPS: [Method["group"], string][] = [
  ["fast", "Fast (seconds, nothing to download)"],
  ["heavy", "Heavy (minutes, models download once)"],
  ["paid", "Costs money (sends page images to OpenAI)"],
];

/** Drop a PDF, tick methods, pick Explore or Benchmark set, run them as background jobs. */
export function NewRun({ notify }: { notify: (message: string) => void }) {
  const [methods, setMethods] = useState<Method[]>([]);
  const [stored, setStored] = useState<StoredFile[]>([]);
  const [file, setFile] = useState<StoredFile | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(["current"]));
  const [purpose, setPurpose] = useState<"explore" | "benchmark">("explore");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mine, setMine] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const loadMethods = useCallback(() => {
    api.methods().then((r) => setMethods(r.methods)).catch(() => undefined);
  }, []);
  const loadJobs = useCallback(() => {
    api.jobs().then((r) => setJobs(r.jobs)).catch(() => undefined);
  }, []);
  useEffect(() => {
    loadMethods();
    loadJobs();
    api.files().then((r) => setStored(r.files)).catch(() => undefined);
  }, [loadMethods, loadJobs]);

  const busy = jobs.some((j) => j.state === "queued" || j.state === "running");
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      loadJobs();
      loadMethods();
    }, 1500);
    return () => clearInterval(timer);
  }, [busy, loadJobs, loadMethods]);

  const benchmarkPages = file?.benchmark_pages ?? [];
  useEffect(() => {
    if (!benchmarkPages.length) setPurpose("explore");
  }, [benchmarkPages.length]);

  const upload = async (f: File) => {
    setUploading(true);
    setError(null);
    try {
      const saved = await api.upload(f);
      setFile(saved);
      setStored((prev) => [saved, ...prev.filter((x) => x.sha256 !== saved.sha256)]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const run = async () => {
    if (!file) return;
    setError(null);
    try {
      const tools = methods.filter((m) => m.ready && picked.has(m.id)).map((m) => m.id);
      const r = await api.startJobs({ sha256: file.sha256, tools, purpose });
      setMine(r.jobs.map((j) => j.job_id));
      loadJobs();
      notify(`${r.jobs.length} run${r.jobs.length === 1 ? "" : "s"} queued`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const install = (id: string) =>
    api
      .install(id)
      .then(() => {
        loadJobs();
        notify("Installing in the background");
      })
      .catch((e: Error) => setError(e.message));

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const count = methods.filter((m) => m.ready && picked.has(m.id)).length;
  const shown = jobs.filter((j) => mine.includes(j.job_id) || j.state === "queued" || j.state === "running");
  return (
    <section>
      <h2>New run</h2>
      <p className="sub">Bring in a file, choose the methods, run them. Every run is kept, and nothing is overwritten.</p>
      <div className="two">
        <div>
          <div
            className={`drop ${file ? "has" : ""} ${dragging ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const dropped = e.dataTransfer.files[0];
              if (dropped) upload(dropped);
            }}
          >
            {file ? (
              <div className="file">
                <div className="ic">PDF</div>
                <div>
                  <b>{file.name}</b>
                  <div className="small">
                    {file.pages} pages · {(file.size / 2 ** 20).toFixed(1)} MB · sha256 {file.sha256.slice(0, 4)}…
                    {file.sha256.slice(-4)}
                  </div>
                </div>
              </div>
            ) : (
              <b>Drop a PDF here</b>
            )}
            <div className="small spaced">
              {uploading ? (
                "Storing…"
              ) : (
                <>
                  Drop {file ? "another" : "a"} PDF here, or{" "}
                  <button className="linkbtn" onClick={() => input.current?.click()}>
                    choose a file
                  </button>
                  . It is kept under the data folder by its SHA-256, never in git.
                </>
              )}
            </div>
            <input
              ref={input}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                if (chosen) upload(chosen);
                e.target.value = "";
              }}
            />
          </div>
          {stored.length ? (
            <select className="pick spaced" value={file?.sha256 ?? ""} onChange={(e) => setFile(stored.find((f) => f.sha256 === e.target.value) ?? null)}>
              <option value="">Or pick a file brought in before…</option>
              {stored.map((f) => (
                <option key={f.sha256} value={f.sha256}>
                  {f.name} · {f.pages} pages
                </option>
              ))}
            </select>
          ) : null}
          <div className="purpose">
            <button className={`seg ${purpose === "explore" ? "on" : ""}`} onClick={() => setPurpose("explore")}>
              <b>Explore</b>
              <small>Named outputs, any file. Doesn't count for the thesis.</small>
            </button>
            <button
              className={`seg ${purpose === "benchmark" ? "on" : ""}`}
              disabled={!benchmarkPages.length}
              onClick={() => setPurpose("benchmark")}
            >
              <b>Benchmark set</b>
              <small>
                {benchmarkPages.length
                  ? `This file's ${benchmarkPages.length} protocol pages. Feeds blind judging.`
                  : "Only for the protocol's source files."}
              </small>
            </button>
          </div>
          <div className="runbar">
            <button className="vote primary" disabled={!file || count === 0} onClick={run}>
              Run {count} method{count === 1 ? "" : "s"}
            </button>
            <span className="small">One method at a time, in the background.</span>
          </div>
          {error ? <p className="error">{error}</p> : null}
          <div className="prog">
            {shown.map((j) => (
              <div key={j.job_id} className="prow">
                <span>{methods.find((m) => m.id === j.tool)?.label ?? j.tool}</span>
                <span className={`small ${j.state}`}>{jobLabel(j)}</span>
                {j.state === "queued" || j.state === "running" ? (
                  <button className="linkbtn" onClick={() => api.cancel(j.job_id).then(loadJobs).catch(() => undefined)}>
                    Cancel
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        </div>
        <div>
          {GROUPS.map(([group, title]) => {
            const listed = methods.filter((m) => m.group === group);
            if (!listed.length) return null;
            return (
              <div key={group} className="group">
                <h4>{title}</h4>
                {listed.map((m) => (
                  <label key={m.id} className={`method ${m.ready ? "" : "notready"}`}>
                    <input type="checkbox" disabled={!m.ready} checked={m.ready && picked.has(m.id)} onChange={() => toggle(m.id)} />
                    <div>
                      <div className="nm">{m.label}</div>
                      <div className="ds">{m.description}</div>
                    </div>
                    <div className="st">
                      {m.ready ? (
                        <>
                          <span className="dot ready" />
                          ready
                        </>
                      ) : (
                        <button
                          className="linkbtn"
                          title={m.missing.join("; ")}
                          onClick={(e) => {
                            e.preventDefault();
                            install(m.id);
                          }}
                        >
                          install · {m.size_mb} MB
                        </button>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
```

`backend/eval/parser_bench/viewer/src/App.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, type ComparisonSummary } from "./api";
import { Compare } from "./screens/Compare";
import { Judge } from "./screens/Judge";
import { NewRun } from "./screens/NewRun";
import { Runs } from "./screens/Runs";
import { Scoreboard } from "./screens/Scoreboard";

type Screen = "new" | "judge" | "compare" | "score" | "runs";
const SCREENS: [Screen, string][] = [
  ["new", "New run"],
  ["judge", "Judge"],
  ["compare", "Compare"],
  ["score", "Scoreboard"],
  ["runs", "Runs"],
];

export default function App() {
  const [screen, setScreen] = useState<Screen>("judge");
  const [comparisons, setComparisons] = useState<ComparisonSummary[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.comparisons().then((r) => setComparisons(r.comparisons)).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    api
      .methods()
      .then((r) => setNames(Object.fromEntries(r.methods.map((m) => [m.id, m.label]))))
      .catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(timer);
  }, [toast]);

  const judging = comparisons.find((c) => c.locked) ?? null;
  const active = judging ?? comparisons[0] ?? null;
  const pill = active
    ? `${active.run_id} · ${active.status === "judging" ? `judging ${active.done}/${active.total}` : "finished"}`
    : "no comparison yet";

  return (
    <>
      <header>
        <div className="brand">
          Parser Bench<span>Learnstation</span>
        </div>
        <nav>
          {SCREENS.map(([id, label]) => (
            <button key={id} className={screen === id ? "on" : ""} onClick={() => setScreen(id)}>
              {label}
              {judging && (id === "compare" || id === "score") ? <span className="lock">locked</span> : null}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <div className="runpill">{pill}</div>
      </header>
      <main>
        {screen === "new" && <NewRun notify={setToast} />}
        {screen === "judge" && <Judge comparison={active} names={names} notify={setToast} onProgress={refresh} />}
        {screen === "compare" && <Compare names={names} />}
        {screen === "score" && <Scoreboard comparisons={comparisons} names={names} onChange={refresh} />}
        {screen === "runs" && <Runs names={names} notify={setToast} />}
      </main>
      <div className={`toast ${toast ? "on" : ""}`} role="status">
        {toast}
      </div>
    </>
  );
}
```

`backend/eval/parser_bench/viewer/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`backend/eval/parser_bench/viewer/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Parser Bench</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Keep the build output out of the linter**

In `eslint.config.js`, in the `ignores` list, add a line after `"dist/**",`:

```js
      "backend/eval/parser_bench/viewer/dist/**",
```

- [ ] **Step 3: Type-check, lint, test and build**

```bash
$NODE node_modules/typescript/bin/tsc -p backend/eval/parser_bench/viewer/tsconfig.json
$NODE node_modules/eslint/bin/eslint.js backend/eval/parser_bench/viewer
$NODE node_modules/vitest/vitest.mjs run --config backend/eval/parser_bench/viewer/vite.config.ts
$NODE node_modules/vite/bin/vite.js build --config backend/eval/parser_bench/viewer/vite.config.ts
git status --short backend/eval/parser_bench/viewer
```

Expected:
- `tsc` and `eslint` print nothing.
- Vitest prints `Tests  12 passed (12)`.
- The build prints `✓ built in …`, with KaTeX fonts in `dist/assets`. The warning about a chunk larger than 500 kB is expected: it is React and KaTeX in a local tool.
- `git status` lists nothing under `viewer/dist`, because the root `.gitignore` ignores `dist`.

- [ ] **Step 4: Add the preview entry (local, git-ignored)**

Add this object to the `configurations` array in `.claude/launch.json`. The file is git-ignored, so this stays on this Mac. The entry runs with the worktree as its working directory:

```json
    {
      "name": "parser-bench",
      "runtimeExecutable": "~/Desktop/ascend-academy/.venv/bin/python",
      "runtimeArgs": ["-m", "backend.eval.parser_bench", "serve", "--port", "8766"],
      "port": 8766,
      "autoPort": false
    }
```

- [ ] **Step 5: Check every screen in the browser on throwaway data**

Make a scratch data folder outside the repo. It holds a finished comparison, a comparison still being judged, and an explore run:

```bash
SCRATCH="$(mktemp -d)/bench-data"
$PY - "$SCRATCH" <<'EOF'
import sys
from pathlib import Path
from backend.eval.parser_bench import results
from backend.tests.unit.parser_bench_compare_fixtures import make_comparison, make_extract_run, prefer, vote_all
from backend.tests.unit.parser_bench_fixtures import make_deck

root = Path(sys.argv[1])
decks = root.parent / "decks"
for name in ("judged", "judging", "explore"):
    (decks / name).mkdir(parents=True, exist_ok=True)
done = make_comparison(root, decks / "judged")
vote_all(done, prefer("alphatool"))
print(results.advance(done, root=root))
make_comparison(root, decks / "judging")
deck = make_deck(decks / "explore" / "explore.pdf", n=4)
for tool in ("current", "alphatool"):
    make_extract_run(root, tool, deck, pages=range(1, 5), purpose="explore")
print(root)
EOF
PARSER_BENCH_DIR="$SCRATCH" $PY -m backend.eval.parser_bench serve --port 8767
```

Run the last command in the background. Expected output: `{'added': 0, 'finished': True}`, the scratch path, and `Parser Bench on http://127.0.0.1:8767`.

Open `http://127.0.0.1:8767` in the browser pane and check each point (use `read_page`/screenshots):
1. **Judge** shows "Duel 1 of 10", the page image, LEFT and RIGHT without names, the rule and four buttons.
   - Press `1`: the toast says "Saved" and the next duel shows.
   - Press `U`: the toast names the retraction, and duel 1 is back.
   - Press `Z` and then `Z` again: the page opens and closes.
2. **Scoreboard** opens on the judging comparison and says it is locked.
   - **Do not press "Unlock early":** it writes to the repo's real `LAB_LOG.md`.
   - Pick the finished comparison in the selector. It shows the ranking with `alphatool` first and current at 1000, the check table with † on current, the chart and the win-rate table.
3. **Compare.**
   - Pick `explore.pdf`: two named columns appear, and the `current` column has the footer marked red.
   - The list also holds two `deck.pdf` entries. The judged comparison's pages show their outputs. The judging comparison's pages are marked "locked", and opening one shows the locked notice.
4. **Runs** lists every run with "—" for peak MB.
   - Opening an explore run shows its page and chips.
   - Ticking the two explore runs of different methods says "Pick two runs of the same method".
5. **New run** lists the five fast methods as ready, and Benchmark set is disabled until a page-set file is chosen.

Then stop the server and delete the scratch folder (`rm -rf "$(dirname "$SCRATCH")"`).

- [ ] **Step 6: Commit**

```bash
git add backend/eval/parser_bench/viewer eslint.config.js
git commit -m "feat(parser-bench): viewer New run, Compare, Runs and the shell; built and served by serve

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: The protocol step: choose the 24 pages, write and commit `PROTOCOL.md`

**Files:**
- Create: `docs/thesis/experiments/parser-benchmark/pages.json`
- Create: `docs/thesis/experiments/parser-benchmark/PROTOCOL.md`
- Modify: `docs/thesis/experiments/parser-benchmark/LAB_LOG.md`

**Interfaces:**
- Consumes: `select show`, `select draw`, `pageset.load`, `sources.render_png`, `checks.document_facts`/`footer_parts`, `tools.environment` and `execute.protocol_commit`/`bench_changes`.
- Produces: the frozen page set and protocol in one commit. From that commit on, `execute.protocol_commit()` returns it and benchmark runs are allowed.

**Fixed in this plan, before any page is drawn:** the page-set seed is **20261030** and the first comparison's schedule seed is **20261031**.

**The human step:** Abi (through the controller) confirms the pages. **Step 4 is a STOP.**

Rules for this task:
- Nothing in this task goes into git except `pages.json`, `PROTOCOL.md` and the lab-log entry.
- Those three describe pages by structure only. Never quote slide text in them.
- Page images and titles stay in the scratchpad and in the message to the controller.

- [ ] **Step 1: Look at every page of the four sources (local only)**

```bash
for s in swt dbs sr sheets; do $PY -m backend.eval.parser_bench select show "$s"; done
```

Expected: one table per PDF. The PDFs have 41, 82, 85, 6 and 7 pages. Each row shows page, lines, words, images, drawings, symbol font, and the title. To look at a candidate, render it into the scratchpad and open the PNG with the Read tool:

```bash
$PY -c "import sys; from pathlib import Path; from backend.eval.parser_bench import sources; src = {s.id: s for s in sources.BENCHMARK_SOURCES}[sys.argv[1]]; Path(sys.argv[4]).write_bytes(sources.render_png(src.paths()[int(sys.argv[2])], int(sys.argv[3]), zoom=1.4))" swt 0 12 "<scratchpad>/swt-p12.png"
```

(the arguments are the source id, the file index within the source, the page, and the output path).

- [ ] **Step 2: Measure each source's footer format (numbers only)**

```bash
$PY - <<'EOF'
import statistics
from backend.eval.parser_bench import checks, sources
for s in sources.BENCHMARK_SOURCES:
    for name, path in zip(s.files, s.paths()):
        f = checks.document_facts(path)
        printed = sum(bool(p.edge_numbers) for p in f.pages.values())
        parts = [len(checks.footer_parts(p, f)) for p in f.pages.values()]
        print(f"{s.id:7} pages {len(f.pages):3}  boilerplate lines {len(f.boilerplate):2}  "
              f"pages with a printed number {printed:3}  footer parts per page: median {statistics.median(parts)}, max {max(parts)}")
EOF
```

Keep the five lines for `PROTOCOL.md` §9 and the lab log.

- [ ] **Step 3: Propose the 4 chosen pages per source and draw the 2 random ones**

Write `<scratchpad>/chosen.json` (outside the repo) in the form `{"swt": [{"file": "Course SWT/Slides/2.pdf", "page": 12, "type": "lists", "reason": "…"}, …×4], "dbs": […], "sr": […], "sheets": […]}`. The sheets' `file` is `Course SWT/ueb01.pdf` or `Course SWT/ueb02.pdf`. Choose by these rules:
- Each source's chosen pages cover what the spec's test-set table says it tests:
  - SWT: symbol-font bullets, coloured boxes, diagrams.
  - DBS: tables, functional dependencies, formulas.
  - SR: diagrams, mixed layouts.
  - Sheets: dense text.
- Across the 16 chosen pages, every page type (`layout`, `lists`, `table_formula`, `diagram`, `dense_text`) appears at least twice. Every duel pair needs three different types, and the schedule spreads pages within a type.
- No title or cover slide, no agenda-only slide and no blank page. Those test nothing the learner reads.
- A reason names the structure, for example "three coloured boxes side by side, bullets in symbol font". It never quotes the slide.

Then draw with the fixed seed:

```bash
$PY -m backend.eval.parser_bench select draw "<scratchpad>/chosen.json" --seed 20261030
```

Expected: the path of `pages.json` and eight lines like `drawn: swt-p27  (Course SWT/Slides/2.pdf page 27): tag its type in the file`. Look at each drawn page (render it as in Step 1) and set its `"type"` in `pages.json`, leaving its reason as written. Then validate:

```bash
$PY -c "from collections import Counter; from backend.eval.parser_bench import pageset; p = pageset.load(); print(len(p), Counter(x.type for x in p))"
```

Expected: `24` and a count for each of the five types.

- [ ] **Step 4: STOP: the controller confirms the 24 pages**

Send the controller one table with all 24 pages, one row each: key, file, page, type, chosen/random, the reason, and the slide's title for orientation. Titles go only in this message, never in git. Add the five footer-format lines from Step 2.

**Wait for the controller's confirmation.** If pages change, edit `chosen.json`, run Step 3 again (same seed), and send the table again. Do not write `PROTOCOL.md` before the confirmation.

- [ ] **Step 5: Gather the exact versions and licences**

```bash
$PY -m backend.eval.parser_bench tools
$PY -c "from backend.eval.parser_bench import tools; [print(t, tools.environment(tools.TOOLS[t])) for t in tools.TOOLS]"
$PY -c "import importlib.metadata as m; d = m.metadata('pymupdf'); print('pymupdf', d['Version'], d.get('License-Expression') or d.get('License'))"
for t in pymupdf4llm markitdown opendataloader; do
  ~/.cache/learnstation-parser-bench/envs/$t/bin/python -c "import importlib.metadata as m, sys; dist = {'pymupdf4llm': 'pymupdf4llm', 'markitdown': 'markitdown', 'opendataloader': 'opendataloader-pdf'}[sys.argv[1]]; d = m.metadata(dist); print(dist, d['Version'], d.get('License-Expression') or d.get('License') or [c for c in d.get_all('Classifier') or [] if 'License' in c])" $t
done
$NODE -e "const p = require('./node_modules/pdfjs-dist/package.json'); console.log('pdfjs-dist', p.version, p.license)"
```

Expected: all five ready, each environment line list (with `tesseract …` last for pymupdf4llm), and a version and licence per package. If a licence field is empty, write "not stated in the package metadata". Do not guess.

- [ ] **Step 6: Write `PROTOCOL.md`**

Create `docs/thesis/experiments/parser-benchmark/PROTOCOL.md` with exactly this text. Fill each `⟨…⟩` from Steps 2–5 or from `pages.json`. Everything else is fixed wording.

````markdown
# Parser benchmark: protocol

**Frozen** ⟨YYYY-MM-DD⟩, in the commit that adds this file. Every benchmark run and every comparison records that commit (`protocol_commit`). A later change is added under "Deviations" with its date; the text above it stays as it is.

**Design:** `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md`. **Code:** `backend/eval/parser_bench/` at this commit. Benchmark runs are refused while that code, this file or `pages.json` has uncommitted changes.

## 1. Research question and hypotheses

**RQ.** Which extraction approach turns real lecture PDFs into the text a learner would rather learn from, and at what cost in time and memory on commodity hardware?

- **H1.** At least one layout-aware tool is rated above our current extraction, with its 95% interval entirely above current's. Current is the rating anchor (1000, interval 1000–1000), so H1 holds when some tool's lower bound is above 1000.
- **H2 (descriptive).** Layout-aware tools leak fewer footers and put the title first more often than current. These are reported as counts per tool, with no significance test claimed.
- **Cost** is reported descriptively as seconds per page and peak memory. There is no hypothesis about it.

## 2. Contenders

The first comparison judges the five fast methods (design decision 9). The heavy methods (`docling`, `marker`, `mineru`, `paddleocr`) and `ai_vision` join in a second comparison against the same opponents. Their exact versions, licences and settings are added as a dated deviation before their first benchmark run.

| id | What runs | Exact version | Licence | Settings that differ from the default |
|---|---|---|---|---|
| `current` | standalone copy of production's `page.get_text("text")`, in the backend environment | PyMuPDF ⟨version⟩ | ⟨licence⟩ | none |
| `pymupdf4llm` | `to_markdown(page_chunks=True)` | pymupdf4llm ⟨version⟩ on PyMuPDF ⟨version⟩; ⟨tesseract version⟩ | ⟨licence⟩ | none; its default OCR stays on (§9) |
| `pdfjs` | `getTextContent`, a newline on `hasEOL` | pdfjs-dist ⟨version⟩, Node ⟨version⟩ | ⟨licence⟩ | `isEvalSupported: false`, `verbosity: 0` |
| `markitdown` | one page at a time (pages split with pypdf) | markitdown ⟨version⟩, pypdf ⟨version⟩ | ⟨licence⟩ | page by page by nature |
| `opendataloader` | Markdown output, own page separator | opendataloader-pdf ⟨version⟩, ⟨java version⟩ | ⟨licence⟩ | `quiet`, `markdown_page_separator`, `include_header_footer=False` passed explicitly (its default) |

Each method runs in its own environment (`uv`, Python 3.12, under `~/.cache/learnstation-parser-bench/envs/`). `current` runs in the backend `.venv`, and `pdfjs` runs on Node with this repository's `pdfjs-dist`. Every run records its exact package list in `run.json` (`environment`). No method is tuned.

## 3. Test set

| Source | File | SHA-256 | Pages |
|---|---|---|---|
| SWT | `Course SWT/Slides/2.pdf` (Versionsmanagement) | ⟨sha256⟩ | 41 |
| DBS | `03 DBS Normalization.pdf` | ⟨sha256⟩ | 82 |
| SR | ` 03__SR_Prozesse_v07_27.04.2025.pdf` (leading space) | ⟨sha256⟩ | 85 |
| Sheets | `Course SWT/ueb01.pdf` + `ueb02.pdf` | ⟨sha256⟩ / ⟨sha256⟩ | 6 + 7 |

File names are relative to `~/Downloads`. The PDFs are never committed.

- **Excluded.** *Softwaretechnik 1* is excluded. Abi saw its outputs with tool names in the design demo on 2026-10-30. It stays available for Explore.
- **Selection rule.** Per source, 4 pages are chosen on purpose, each with a page type and a reason. 2 more are drawn at random from the rest with seed **20261030**, which was fixed in the implementation plan before the draw. The drawn pages were then tagged with a type by looking at them.
- **Page types:** `layout` (boxes, columns), `lists`, `table_formula`, `diagram` and `dense_text`.
- **The set** is `pages.json` in this folder. It is machine-readable, and benchmark runs and comparisons read it.

| Key | File | Page | Type | How | Reason |
|---|---|---|---|---|---|
⟨24 rows, one per entry of pages.json, in its order⟩

Page types over the 24 pages: ⟨type: count, for all five⟩.

## 4. Automatic checks (checks version 3)

They are computed per tool per page. The reference is the page's own text layer (PyMuPDF `get_text("words")` and `get_text("dict")`).

**Normalisation.** Text is NFKC-normalised and case-folded. Hyphens at line ends are joined, and only tokens of two or more letters or digits are kept. Images in any output become `[figure]` before checks and display.

1. **Footer leak.**
   - **Boilerplate line.** A *boilerplate line* is a text line, with its digits replaced by `#`, that appears on at least 50% of a document's pages (and on at least 2) and whose vertical centre lies in the top or bottom 15% of the page.
   - **Printed number.** The page's *printed number* is a digits-only line in its own edge band.
   - **Footer parts.** The page's *footer parts* are its edge lines that are boilerplate or the printed number, each taken as a set of words and numbers. The same rule removes them from the reference text.
   - **Footer line.** An output line is a *footer line* when the same rule would remove it.
   - **`footer_leaks`.** This is the number of footer parts whose words and numbers all appear in the output's footer lines taken together.
   - **`footer_leaked`.** This says whether any part leaked.
   - **`footer_token_share`.** This is the share of the page's footer words and numbers found in the output's footer lines. It is null without footer parts.
2. **Title first.** The title is the line with the largest font; if two tie, the topmost wins.
   - **Pass.** The check passes if the output's first non-empty line, with heading marks and emphasis stripped, starts with the title or matches it with similarity ≥ 0.8.
   - **n/a.** The check is n/a when the largest font is under 1.2× the page's median font.
3. **Wrong symbols.** This counts three things:
   - Private Use Area characters and U+FFFD;
   - `§` and `®` on pages where the text layer shows them coming from a symbol font (Symbol, Wingdings, ZapfDingbats);
   - lines holding only a bullet character, which are reported separately as `lonely_bullets`.
4. **Broken lines.** This is the share of line breaks inside running text where the line ends without `.:;!?` and the next line starts lowercase.
   - **Excluded:** breaks next to a heading, a list item or a table row (on either side), a `[figure]` line or a footer line.
   - **Recorded:** `line_breaks`, `broken_lines` and `broken_line_pct`.
   - **No breaks:** `broken_line_pct` is null when no break qualifies.
5. **Structure found.** The check counts headings, list items, maximum nesting depth, GFM tables and math spans. It is descriptive only.
6. **Dropped words.** This is `1 − |ref ∩ out| / |ref|` over word multisets, with boilerplate tokens removed from the reference.
7. **Invented words.** This is `|out − ref| / |out|` over word multisets.
8. **Cost** (§8).

**Known bias, stated in advance:** checks 6 and 7 use PyMuPDF's text layer as the reference. That makes `current` (and largely `pymupdf4llm`) score near-perfect by construction, so their numbers there are reported but marked.

## 5. Duels

- **Screen.** A duel shows the page image and two unnamed outputs side by side, both rendered through the app's own reading-face renderer (`Prose`). Which method is left or right is drawn at random with the schedule's seed. Images appear as `[figure]` for every method.
- **Rule on screen**, word for word: *"Which would you rather learn from?"* Nothing missing, nothing invented, right order, no junk, clear structure.
- **Answers.**
  - **Buttons.** Four buttons, also on keys 1–4: **Left better · Right better · Same · Both unusable**, plus an optional note.
  - **Saving.** Each vote is appended to `votes.jsonl` at once (fsync), with the seconds the decision took and a judging-session id.
  - **Undo.** Undo appends a retraction; it never deletes a line.
- **Round 1.**
  - **Pairs.** Every pair of entrants meets 3 times, on pages of 3 different types. Types and pages are spread evenly (least used first), and the order is shuffled, all with the seed.
  - **Hidden repeats.** They are one duel in ten of the final schedule: round(round-1 duels / 9). Each is a round-1 duel shown again with sides swapped, at least min(20, schedule length / 3, rounded down) duels after its original.
- **First comparison.** The five fast methods make 10 pairs × 3 = 30 duels plus 3 hidden repeats, at least 11 apart, so **33 duels**. The schedule seed is **20261031**. With all ten methods it is 135 + 15 = 150, at least 20 apart.
- **Resuming.** Judging can stop at any time; the next session continues the schedule.
- **Blinding.**
  - **What is locked.** Until a comparison's judging is finished, its pages' outputs are shown nowhere with method names: not the Runs screen, Compare, the Scoreboard or My votes. The Runs list itself, timings included, stays visible.
  - **From when.** Page-set pages are locked from the moment `pages.json` exists.
  - **Exploring.** Abi does not explore the benchmark decks with Explore runs before judging.
  - **Early unlock.** Unlocking early is possible. It needs a reason and is appended to `LAB_LOG.md` as a deviation.

## 6. Stopping rule (round 2), fixed in advance

After round 1 the scoreboard is computed. If the top method's 95% interval overlaps the second's, the adjacent pairs among the top four get 3 more duels each, on three page types and with random sides. This repeats until the intervals separate or 75 extra duels have been scheduled. Round-2 duels have no hidden repeats, and the last batch is cut to fit the 75.

## 7. Analysis

- **Bradley–Terry** fitted with the MM algorithm (Hunter 2004). "Same" and "Both unusable" count as half a win for each side. "Both unusable" is also reported per method.
- **Prior.** Each method also plays one virtual drawn game, spread evenly over its opponents, so that a method that wins nothing in a resample keeps a finite rating. It moves a rating by a few points.
- **Scale.** Points = 1000 + 400·log10(strength / strength of `current`).
- **Uncertainty.** A bootstrap resamples the votes 1,000 times with replacement, seeded with the comparison's seed. The 2.5th and 97.5th percentiles give each 95% interval.
- **H1** as in §1.
- **H2** as counts per method from the checks over the comparison's pages.
- **Also reported:**
  - win rate per page type (wins plus half the draws, descriptive);
  - self-consistency, the share of hidden repeats judged alike (the same method won, or both times "Same", or both times "Both unusable"; any other pair of answers is a disagreement);
  - median decision time;
  - every automatic check per method;
  - quality against speed.
- **Results are a function of the raw data.** `results.json` is recomputed from `votes.jsonl`, carries the digest of the votes it was computed from, and is never edited by hand.

## 8. Run procedure

- **Input.** Each method receives the whole PDF; only the page set's pages of that PDF are scored.
- **Warm-up.** Each method runs once on a two-page sample first, so a first-time model download is never timed. Benchmark runs cannot skip the warm-up.
- **Timing.** The timed run's wall-clock seconds for the whole document are divided by its pages. They include interpreter, JVM and Node start-up. The wait polls in steps of at most 0.1 s, so a time can be up to about 50 ms long.
- **Memory.** Peak memory is the largest summed resident set size of the runner's whole process tree. It is sampled at spawn and every 0.1 s. Shared pages are counted once per process, and peaks shorter than the sampling interval can be missed. It is null when no sample was taken.
- **One timed run at a time** on this Mac: a lock in the data folder is shared by the command line and the webpage.
- **Records.** Every run records:
  - its exact environment (with the Tesseract version for OCR-capable methods);
  - the git commit and dirty flag;
  - the machine (⟨chip, RAM, macOS from run.json `machine`⟩).
- **Failures.** A failed run is kept with its reason and stage. A re-run is a new run, and the comparison uses each method's newest finished run under this protocol.

## 9. Threats to validity

- **One judge, who also built the product.** Countermeasures: hidden names, random sides, hidden repeats for self-consistency, decision times, and automatic checks independent of the judge.
- **Deliberate page choice.** 2 of every 6 pages are random, and the reasons for the others are recorded in §3.
- **Small and narrow sample.** The sample is 24 pages from one university, in two languages, all born-digital, with no scans. PaddleOCR's strength (scans) is not exercised.
- **Check reference.** The PyMuPDF text layer favours `current` and `pymupdf4llm` on checks 6 and 7.
- **Library versions.** `pymupdf4llm` runs on PyMuPDF ⟨version⟩ while `current` runs on production's ⟨version⟩. A difference between the two can partly be a PyMuPDF version effect.
- **OCR inside pymupdf4llm.** Its default calls Tesseract (⟨version⟩) on pages it judges image-like. On *Softwaretechnik 1* this measurably raised its invented-word share on OCR'd pages (lab log, 2026-10-30). Its numbers depend on the local Tesseract, which every run records.
- **Symbol double count.** A `§` alone on a line counts both as a wrong symbol and as a lonely bullet.
- **German compound hyphens.** Normalisation joins a hyphen at a line end. A compound broken at a real hyphen ("Software-" / "Entwicklung") becomes one token where the line breaks there and two where it does not, which shows as dropped plus invented words.
- **Footer formats differ by source.** Per PDF, the footer rule finds: ⟨the five lines from Step 2⟩.
  - A source with no boilerplate can only leak its printed number.
  - Footers written as `3/40` or `– 3 –` are not counted on either side.
  - A cover slide whose title repeats footer words counts that title as a leak.
- **Hardware.** The M1 with 8 GB uses MPS; several tools are tuned for CUDA. Speeds are relative, not production figures. Other load on the Mac is not controlled.
- **Settings and versions.** Default settings and October 2026 versions are used; tuned tools might do better.
- **Rendering.** Every output is shown through `Prose`, which may disadvantage output written in other syntaxes. Outputs are normalised to Markdown first.
- **Page-by-page tools** (`markitdown`, later `ai_vision`) lose cross-page context.
- **Fatigue.** Sessions are short, and decision times are recorded.
- **Second comparison.** Once the first comparison is finished, Abi has seen the fast methods' outputs with names. Duels of the heavy methods against them are then less blind than the first comparison's.
- **The prior** moves ratings by a few points; with few duels per method it matters most.

## Deviations

None yet.
````

- [ ] **Step 7: Add the lab-log entry**

Append to `docs/thesis/experiments/parser-benchmark/LAB_LOG.md` (numbers only, `~` paths):

```markdown

## ⟨YYYY-MM-DD⟩ — protocol frozen

- Checks version 3 (footer parts across split output lines, footer token share, list items end no break) is in force from this commit on; the six explore runs of 2026-10-30 stay on checks v1.
- Page set: 24 pages, seed 20261030 for the random draw (fixed in the plan before drawing); type counts ⟨…⟩.
- Footer formats per PDF: ⟨the five lines from Step 2⟩.
- Method versions as in PROTOCOL.md §2; Tesseract ⟨version⟩ for pymupdf4llm.
```

- [ ] **Step 8: Commit the protocol, the page set and the log together**

```bash
git add docs/thesis/experiments/parser-benchmark/PROTOCOL.md docs/thesis/experiments/parser-benchmark/pages.json docs/thesis/experiments/parser-benchmark/LAB_LOG.md
git commit -m "docs(parser-bench): freeze the protocol and the 24-page benchmark set

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
$PY -c "from backend.eval.parser_bench import execute; print(execute.protocol_commit()); print(execute.bench_changes())"
```

Expected: the new commit's SHA, then `[]`. If `bench_changes()` lists files, commit or remove them. A benchmark run is refused until it is empty.

---

### Task 17: The first comparison: benchmark runs, the comparison, the viewer

**Files:**
- Modify: `docs/thesis/experiments/parser-benchmark/LAB_LOG.md`
- Data (outside git): 25 extraction runs and one comparison under `~/Documents/learnstation-parser-bench/runs/`.

**Interfaces:**
- Consumes: the CLI (`tools`, `run --purpose benchmark`, `runs`, `compare create`, `compare status`), the built viewer and the `parser-bench` preview entry.
- Produces: a comparison `cmp-<date>_<4hex>` with 33 duels waiting for Abi.

Remember the blinding rule: do not vote, do not unlock, and do not report per-method check numbers or output text of benchmark pages.

- [ ] **Step 1: Pre-flight**

```bash
$PY -m backend.eval.parser_bench tools
$PY -c "from backend.eval.parser_bench import execute; print(execute.protocol_commit()); print(execute.bench_changes())"
df -h / | tail -1
```

Expected: the five fast methods `ready`, the protocol commit SHA, `[]`, and the free disk space, which you note for the log.

- [ ] **Step 2: Run the five methods on the five PDFs, whole documents, as benchmark runs**

```bash
for t in current pymupdf4llm pdfjs markitdown opendataloader; do
  for f in "Course SWT/Slides/2.pdf" "03 DBS Normalization.pdf" " 03__SR_Prozesse_v07_27.04.2025.pdf" "Course SWT/ueb01.pdf" "Course SWT/ueb02.pdf"; do
    $PY -m backend.eval.parser_bench run "$t" "$HOME/Downloads/$f" --purpose benchmark
  done
done
$PY -m backend.eval.parser_bench runs | head -30
```

Expected: 25 lines `<run_id>  finished  <s> s/page, peak <MB> MB`, and `runs` listing them as `benchmark`.
- **Long runs.** The 82- and 85-page decks take longest with `pymupdf4llm` (OCR).
- **A failure** prints its reason and exits 1. The failed run is kept. Write the reason down, re-run that one method on that one file once if the reason is about the environment (for example a timeout under load), and log both runs.
- **Do not change code to make a run pass.** That would need a protocol deviation and new runs of every method.

- [ ] **Step 3: Create the comparison**

```bash
$PY -m backend.eval.parser_bench compare create --tools current,pymupdf4llm,pdfjs,markitdown,opendataloader --seed 20261031
$PY -m backend.eval.parser_bench compare status
```

Expected: `cmp-<date>_<4hex>  judging  0/33 duels`, its folder, then the status line `… judging  0/33 duels  round 1` and `names and ranking stay hidden until judging is finished`.

- [ ] **Step 4: Log the runs and the comparison**

Append to `LAB_LOG.md`:

```markdown

## ⟨YYYY-MM-DD⟩ — benchmark runs and the first comparison

- Protocol commit ⟨sha⟩; disk before ⟨GB free⟩, after ⟨GB free⟩.
- 25 benchmark runs (5 fast methods × 5 PDFs, whole documents, the page set's pages scored): ⟨n⟩ finished, ⟨n⟩ failed (⟨method, file, reason⟩ or "none").
- Seconds per page and peak MB per method (range over the five PDFs): ⟨method: s/page min–max, peak MB max⟩ × 5.
- Comparison ⟨cmp id⟩: the five fast methods, schedule seed 20261031, 33 duels (30 + 3 hidden repeats, at least 11 apart). Judging not started.
```

Only cost figures go here. Check results of benchmark pages stay hidden until judging is finished.

```bash
git add docs/thesis/experiments/parser-benchmark/LAB_LOG.md
git commit -m "docs(parser-bench): lab log — benchmark runs of the fast methods and the first comparison

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Open the viewer for Abi**

Build the viewer if `backend/eval/parser_bench/viewer/dist/index.html` is missing (Task 15 Step 3). Then start the `parser-bench` preview (`preview_start` with name `parser-bench`) and confirm in the browser pane that:
- **Judge** shows "Duel 1 of 33";
- the pill reads `cmp-… · judging 0/33`;
- Compare and Scoreboard are marked locked.

Do not press any vote key. Leave the server running and tell the controller the comparison id, and that judging can start at `http://127.0.0.1:8766`.

---

## Spec coverage (Plan 2's share)

| Spec requirement | Task |
|---|---|
| Check 1 footer leak counts parts across split lines; footer token share; check-1 wording | 1 |
| Check 4 excludes list items on either side | 1 |
| Checks version recorded; old records read as v0 / checks v1 | 1, 2 |
| Data never inside the repo, now including the main checkout of a worktree | 2 |
| 24 pages: 4 chosen with reasons and types + 2 random with a recorded seed, per source; SWT 1 excluded | 3, 16 |
| Protocol committed before the first benchmark run; recorded in every run and comparison | 4, 7, 16 |
| Benchmark runs: warm-up, committed code, exactly the page set's pages; Tesseract version recorded | 4 |
| One heavy (timed) method at a time; live progress; cancel | 4, 11, 15 |
| Duels: page image + two unnamed outputs through `Prose`, random sides, rule word for word, four answers on 1–4, note, seconds | 7, 12, 14 |
| Round 1: every pair 3× on 3 page types, balanced, seeded; hidden repeats with swapped sides and a gap | 5 |
| Round 2 stopping rule, 75-duel cap | 5, 8 |
| Votes appended with fsync, session ids, undo as retraction | 7 |
| Bradley–Terry (MM, Hunter 2004), ties and both-unusable as half wins, 1,000-resample bootstrap, points with current = 1000 | 6 |
| H1, win rate per page type, self-consistency, median decision time, every check per tool, quality vs speed | 8, 14 |
| `results.json` always recomputed from `votes.jsonl` | 8 |
| `compare.json`: purpose, extraction runs, pages with types, protocol commit, seed, schedule | 7 |
| Webpage on 127.0.0.1, no login, opened via `.claude/launch.json` | 12, 15 |
| New run: drop/choose a PDF stored by SHA-256 outside git; methods by group with readiness and install (3 GB guard from Plan 1); Explore vs Benchmark set; background jobs | 9, 11, 12, 15 |
| Judge keys 1–4 / N / Z / U; no tool names while judging; My votes after judging | 12, 14 |
| Scoreboard: ranking with intervals, check table, quality-vs-speed chart, self-consistency | 14 |
| Compare: any page, page image, outputs with names, check failures highlighted, leaked footer marked | 1 (footer lines), 12, 15 |
| Runs: every run with date, tool, version, status, time, judging progress; outputs and checks; two runs of one tool diffed | 12, 15 |
| Blinding lock for benchmark pages; run list stays visible; early unlock logged as a deviation | 9, 12, 14, 15 |
| Viewer built with its own Vite config importing `src/components/markdown` | 13 |
| `PROTOCOL.md` with RQ, hypotheses, contenders (versions, licences), pages with reasons, checks, duel rules, stopping rule, analysis, threats; lab log | 16, 17 |
| First comparison: the five fast methods, about 33 duels | 17 |
| CLI `select`, `compare`, `serve` | 3, 10, 12 |
| Heavy methods, `ai_vision` (with its per-run cost OK), second comparison on the same scale | Plan 3 |
| Improvement loop (re-run `current`, judge only its new duels), export of benchmark runs, `RESULTS.md`, figures | Plan 3 |
| Parked engine items: wait4/loadavg timing, raw `out.json`, log cap, Ctrl-C while sealing, `normalize_figures` gaps, `current` docstring and pin check | Plan 3 |
