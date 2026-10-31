# Parser Bench, Plan 3a: `ai_vision` and the second comparison — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps the Plan 2 final review found, add two paid entrants (`ai_vision` = the OpenAI vision model production uses, `ai_vision_strong` = one stronger current OpenAI model) with a per-run cost OK, and create the second blind comparison, which judges only the pairs that involve a new entrant and rates all seven methods on one scale with the first comparison's votes.

**Architecture:** Three layers on Plan 2's code in `backend/eval/parser_bench/`:
- **Review fixes first (Tasks 1–5).** A regression pin on `results.summarize`, a neutral fixture name, an export that keeps `votes.jsonl` byte for byte, blinding keyed by page *and method*, a run gate that also refuses bench code changed since the protocol commit (and records a bench tree hash), and a judge who is not told about rounds.
- **Paid methods (Tasks 6–11, 15).** `paid.py` holds the key-file rule, the price table, the estimate and the actual cost. `runners/ai_vision_runner.py` renders only the requested pages at 2×, sends one request per page to `api.openai.com` with plain `urllib`, retries 429/5xx a bounded number of times, and records usage per page. `execute.py` passes the pages, skips the warm-up for paid methods and keeps the cost on the run record. The command line and the webpage refuse a paid run without an explicit cost OK.
- **The pooled comparison (Tasks 12–14).** `compare.json` gets `builds_on` and `new_entrants`. The schedule pairs only new×old and new×new. `results.summarize` fits Bradley–Terry over the earlier comparison's votes (read-only) plus its own, anchor `current` = 1000, and adds a round-1-only H1 sensitivity line. Round 2 runs only while a new entrant is among the overlapping top two.
- **Protocol and runs (Tasks 16–17).** Deviation 2 is committed before the first paid benchmark run, with a STOP for Abi on the stronger model id and the cost. Then 10 paid benchmark runs, the comparison (seed **20261101**), the lab log, the viewer, and a STOP for Abi to judge.

**Tech Stack:** Python 3.13 (backend `.venv`), FastAPI, pydantic, PyMuPDF 1.27.1, psutil, pytest, `http.server` (test double only). The paid runner runs in its own `uv` environment on Python 3.12 with `pymupdf==1.27.1` and the standard library's `urllib` (no OpenAI SDK, see Task 7). Node 22 with this repo's React 18, Vite 6, Vitest 3, TypeScript 5.

**Spec:** `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md`. The `ai_vision` contender row, New run ("`ai_vision` asks for an explicit OK each run"), Safety, Threats ("`ai_vision` is not fully deterministic"), and decision 9 (second comparison on one scale, same rules per comparison) are the parts this plan builds.

**Builds on:** Plan 2 as built (branch `claude/file-upload-workflow-e9126d` at `b417d218`). The first comparison `cmp-2026-10-30_8825` is finished (108 votes, round 2 to its cap) under protocol commit `e07f5c9f`. Its 25 fast benchmark runs are referenced **by run id** from its `compare.json`; they are never re-run and never edited. The code is authoritative where it differs from Plan 2's text.

**Decisions already made by Abi (2026-10-30), implemented here:**
- `ai_vision` = `gpt-4.1-mini`, taken from the launch setting in `.env.example` (`OPENAI_MODEL=gpt-4.1-mini`; `OPENAI_VISION_MODEL` defaults to it in `backend/services/ai/orchestrator.py`). The production environment itself is not read.
- `ai_vision_strong` = one current stronger OpenAI vision model. Its id is chosen in Task 16 from the account's live model list, with Abi.
- Key only from `~/.config/learnstation-parser-bench/openai_key`, mode 0600.
- A cost OK per run, on the command line (`--cost-ok`) and on the webpage (a confirm step; the server refuses without `cost_ok: true`).
- Second comparison: the 5 judged fast methods + the 2 paid ones; only pairs with a new entrant (11 pairs × 3 = 33 duels + 4 hidden repeats = 37); one Bradley–Terry scale pooled with `cmp-2026-10-30_8825`; H1 Bonferroni over all 6 challengers.

**Decisions this plan makes (each recorded in Deviation 2, Task 16):**
- **No warm-up for paid methods.** The warm-up exists so a first-time model download is never timed. A hosted API downloads nothing locally, and a warm-up would send two more page images (pages 1–2 of a benchmark deck, which are not all in the page set) and pay for them. Cost consequence: none extra. The first timed request includes connection setup.
- **Timing for paid methods** is wall-clock seconds over the pages *sent*, not the pages in the file. It is network-bound and includes OpenAI's queueing, so it is reported but not comparable with the local methods.
- **`urllib`, not the OpenAI SDK.** The SDK reads `OPENAI_BASE_URL`, `OPENAI_API_KEY` and proxy variables from the environment, so a stray variable could send the images or the key elsewhere. It also retries on its own (2 retries by default), which would hide attempts we must record. Plain `urllib` with a fixed URL and an empty `ProxyHandler` guarantees `api.openai.com`, and every attempt is ours to record. The request is one JSON body. PyMuPDF (pinned to production's 1.27.1) renders the pages in the runner's own environment.
- **Round 2 of an added comparison** asks the spec's question on the pooled, unrounded intervals, but only while a new entrant is one of the overlapping top two. It then schedules the adjacent top-4 pairs **that involve a new entrant**. Old×old pairs were settled under the first comparison's own stopping rule and cap; re-judging them now would be less blind (Abi has seen their names) and would re-open a capped question. The spec's improvement loop says the same ("Judge only the duels involving the new run").
- **Second schedule seed: 20261101**, fixed here, before any vote. Its round-1 schedule is pinned by digest in Task 12.
- **Price table:** `gpt-4.1-mini` $0.40 / $1.60 per 1M input / output tokens, read from OpenAI's GPT-4.1 launch post (2025-04-14) and re-checked on the pricing page in Task 16. Estimates: 2,600 input and 1,000 output tokens per page for `gpt-4.1-mini` (its image rule caps a page image at 1,536 patches × 1.62 ≈ 2,490 tokens).
- **A request cap of 16,384 output tokens per page** (`max_completion_tokens`), so a runaway answer has a bound; the cost OK shows that worst case as "at most".
- **A truncated answer is kept and marked** (`finish_reason: "length"` in the usage record). An empty answer, a refusal, or a request that still fails after its retries fails the run, and the run keeps what was paid for.

## Global Constraints

- **Python:** `PY=~/Desktop/ascend-academy/.venv/bin/python`. **Node:** `NODE=~/.nvm/versions/node/v22.23.1/bin/node`. Run every command from the worktree root `~/Desktop/ascend-academy/.claude/worktrees/file-upload-workflow-e9126d`.
- **Test commands:** `$PY -m pytest backend/tests/unit/<file> -q` and `$NODE node_modules/vitest/vitest.mjs run --config backend/eval/parser_bench/viewer/vite.config.ts`. Viewer types and lint: `$NODE node_modules/typescript/bin/tsc -p backend/eval/parser_bench/viewer/tsconfig.json && $NODE node_modules/eslint/bin/eslint.js backend/eval/parser_bench/viewer/src`.
- **No app imports.** No module under `backend/eval/parser_bench/` may import `backend.core`, `backend.services`, `backend.api`, `backend.repositories` or `backend.workers`. Importing them loads the main checkout's `.env` with production credentials. FastAPI, uvicorn and pydantic are libraries, not the app, and are allowed.
- **No slide text, PDFs or home paths in git.** Data lives in `PARSER_BENCH_DIR` (default `~/Documents/learnstation-parser-bench/`), never inside this worktree or the main checkout. The lab log uses `~`, never `/Users/<name>`. `PROTOCOL.md` describes structure, never slide text.
- **Records.** A finished extraction run is never changed. A comparison changes only while its status is `judging`. `votes.jsonl` is append-only and fsynced, and undo appends a retraction. `results.json` is always recomputed from the votes.
- **`cmp-2026-10-30_8825` is read-only.** Nothing in this plan writes into its folder. Its `results.json` must still recompute to the same bytes (Task 1 pins the logic; Task 17 checks the real file).
- **`purpose` is `explore` or `benchmark`.** From Task 4 on, a benchmark run or comparison must meet all of these:
  - `PROTOCOL.md` is committed and unmodified.
  - No uncommitted change touches `backend/eval/parser_bench/`, `PROTOCOL.md` or `pages.json`.
  - **None of those three changed between the protocol commit and HEAD** (a bench change needs a dated deviation in `PROTOCOL.md`, committed with or after it).
  - The warm-up is on, **except for a paid method**, which never warms up (Deviation 2).
  - The run scores exactly the page set's pages of that PDF.
- **Paid methods.**
  - Spec, verbatim: "Only `ai_vision` sends data off the Mac: 24 page images to OpenAI." With two paid entrants this becomes 24 page images per paid method (Deviation 2).
  - Spec, verbatim: "`ai_vision` asks for an explicit OK each run, showing the page count and estimated cost."
  - Spec, verbatim: "`ai_vision` is not fully deterministic at temperature 0. It runs once, and the model id and date are recorded."
  - The API key is read **only** from `~/.config/learnstation-parser-bench/openai_key`: a regular file of this user with mode exactly 0600, else refused. Never from the environment or a `.env` file.
  - **The key is never printed, logged, stored, or put in `run.json`, a job, `compare.json` or an error.** The runner gets the key file's *path* on its command line, never the key.
  - **Only Abi creates the key file.** An agent may check it with `tools` (which stats it); an agent never opens, prints, copies or pastes it.
  - Only the requested pages are rendered and sent.
  - **Tests never call the real API** and need no key: they inject a fake opener (no socket at all: the unit-test network guard in `backend/tests/conftest.py` refuses every socket, 127.0.0.1 included) or a fake runner script.
- **Network.** Production is never touched. No network calls, except `uv` during an install, and `api.openai.com` from the paid runner and the `models` command, in Tasks 16–17 only.
- **One timed run at a time** on this Mac. The lock is `<data>/timed-run.lock`, shared by the command line and the webpage.
- **The server** listens on `127.0.0.1` only. It accepts the Host `127.0.0.1` or `localhost`. Any request that changes something needs the header `X-Parser-Bench: 1`.
- **Blinding.** While a benchmark comparison is being judged, nothing shows a method's name, or a model id (which names the method too), next to an output of its pages. From Task 3 on, a page-set output opens per method, only after a finished comparison had that method among its entrants. This applies to implementers too:
  - **never vote and never unlock.** The votes are Abi's.
  - Never put per-method check numbers or output text of benchmark pages into a report or message.
- **Spec decision 9, verbatim:** "All ratings stay on one scale, with `current` = 1000." "Same rules: the round-1 rule ("every pair 3× on 3 page types, 10% hidden repeats") and the stopping rule apply per comparison."
- **Commit messages end with:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## File Structure

```
backend/eval/parser_bench/
  paid.py          CREATE  key-file rule, price table, estimate, actual cost, live model list
  runners/ai_vision_runner.py
                   CREATE  one request per requested page to api.openai.com (urllib), retries, usage
  tools.py         MODIFY  Tool.paid/model/temperature, ai_vision + ai_vision_strong, needs_install(),
                           paid_args(), AI_VISION_MODEL / AI_VISION_STRONG_MODEL
  execute.py       MODIFY  benchmark_gate() (+ bench_tree, bench_drift), invoke(args=), paid runs
                           (cost OK, pages, no warm-up, usage + cost on the record), planned_pages()
  blinding.py      MODIFY  Lock / lock_state(): locked by (sha, page, method)
  api_runs.py      MODIFY  per-method lock on run detail, page, diff, sources, outputs; paid usage
  api_compare.py   MODIFY  no round information while locked
  api_newrun.py    MODIFY  cost_ok on jobs, /api/estimate, paid fields on /api/methods
  jobs.py          MODIFY  pages_for(), submit_run(cost_ok=), the estimate in the journal
  store.py         MODIFY  export keeps votes.jsonl byte for byte (notes blanked), export.json
  compare.py       MODIFY  bench_tree + provenance; create_pooled() (builds_on, new_entrants)
  schedule.py      MODIFY  round1(new=), needs_round2(new=), round2_batch(only_with=)
  ranking.py       MODIFY  analyse() also returns the unrounded figures ("raw")
  results.py       MODIFY  _summarize(): pooled votes, round-1-only sensitivity, unrounded stopping rule
  __main__.py      MODIFY  run --cost-ok, models, compare create --against; status hides the round
  viewer/src/api.ts  lib.ts  lib.test.ts  screens/NewRun.tsx  Runs.tsx  Scoreboard.tsx  Judge.tsx   MODIFY
backend/tests/unit/
  parser_bench_fixtures.py            MODIFY  neutral footer name
  parser_bench_compare_fixtures.py    MODIFY  make_extract_run(tree=, finish_extra=), bench_pages_of(), make_pooled()
  test_parser_bench_paid.py           CREATE
  test_parser_bench_ai_vision.py      CREATE  the runner against a fake opener (no socket)
  test_parser_bench_{checks,server,store,files,execute,tools,cli,jobs,compare,schedule,ranking,results,runners}.py  MODIFY
docs/thesis/experiments/parser-benchmark/PROTOCOL.md   MODIFY (Task 16)  Deviation 2
docs/thesis/experiments/parser-benchmark/LAB_LOG.md    MODIFY (Tasks 16–17)
docs/superpowers/specs/2026-10-30-parser-benchmark-design.md   MODIFY (Task 16)  ai_vision_strong, Safety
```

---

### Task 1: Pin today's results and use a neutral footer name in fixtures

**Files:**
- Modify: `backend/tests/unit/test_parser_bench_results.py`
- Modify: `backend/tests/unit/parser_bench_fixtures.py:21`, `backend/tests/unit/test_parser_bench_checks.py`, `backend/tests/unit/test_parser_bench_server.py:131-132`, `backend/eval/parser_bench/viewer/src/lib.test.ts:28,31`

**Interfaces:**
- Consumes: `make_comparison(root, tmp, *, entrants=ENTRANTS, seed=1)`, `results.summarize(cmp, *, resamples, root)` (Plan 2).
- Produces: `PLAN2_GOLDEN` and `plan2_digest(tmp_path, monkeypatch) -> str` in `test_parser_bench_results.py`. Every later task must leave this test green: it is the proof that a Plan 2 comparison (such as `cmp-2026-10-30_8825`) still summarizes to the same results.

The digest below was computed with the code at `b417d218` from exactly this recipe (and again with the renamed fixture, which gives the same digest: "Lecturer" and the old name are both one 8-letter word, so no check count moves).

- [ ] **Step 1: Write the regression pin**

At the top of `backend/tests/unit/test_parser_bench_results.py`, add the imports:

```python
import hashlib
import itertools

from backend.eval.parser_bench import compare, store
```

and at the end of the file add:

```python
# summarize() of the recipe below, computed with Plan 2's code at b417d218, before Plan 3a. Plan 3a must not change
# it: a finished Plan 2 comparison (cmp-2026-10-30_8825 on disk) must recompute to the same results.json.
PLAN2_GOLDEN = "c45ca0747ca631b58eb177029992f126499a505b88f4935e81256b1562463656"


def plan2_digest(tmp_path, monkeypatch) -> str:
    counter = itertools.count()
    monkeypatch.setattr(compare.secrets, "token_hex", lambda n=2: f"{next(counter):0{2 * n}x}")
    monkeypatch.setattr(store, "now_iso", lambda: "2026-10-30T12:00:00+00:00")
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path, seed=7)
    while (duel := cmp.next_duel()) is not None:
        cmp.vote(duel=duel["duel"], choice=("left", "right", "same", "both_bad")[duel["duel"] % 4],
                 seconds=1.0 + duel["duel"], session="s-0123456789abcdef")
    cmp.finish()
    data = results.summarize(cmp, resamples=60, root=root)
    data.pop("run_id")  # the comparison id holds today's date
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode("utf-8")).hexdigest()


def test_a_plan2_comparison_summarizes_exactly_as_before(tmp_path, monkeypatch):
    assert plan2_digest(tmp_path, monkeypatch) == PLAN2_GOLDEN
```

- [ ] **Step 2: Run it**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_results.py::test_a_plan2_comparison_summarizes_exactly_as_before -q`
Expected: PASS. This pins today's behaviour; it must stay green through Task 17.

- [ ] **Step 3: Replace the real lecturer's surname in test fixtures**

```bash
sed -i '' -e 's/<Surname>/Lecturer/g' -e 's/<surname>/lecturer/g' \
  backend/tests/unit/parser_bench_fixtures.py \
  backend/tests/unit/test_parser_bench_checks.py \
  backend/tests/unit/test_parser_bench_server.py \
  backend/eval/parser_bench/viewer/src/lib.test.ts
grep -rn "<Surname>\|<surname>" backend/tests backend/eval/parser_bench || echo "none left"
```

Expected: `none left`. (The spec and the lab log keep their wording; they describe the design demo, and this task changes only test fixtures.)

- [ ] **Step 4: Run every parser-bench test and the viewer tests**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_*.py -q && $NODE node_modules/vitest/vitest.mjs run --config backend/eval/parser_bench/viewer/vite.config.ts`
Expected: all pass, the pin included.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/unit/test_parser_bench_results.py backend/tests/unit/parser_bench_fixtures.py \
  backend/tests/unit/test_parser_bench_checks.py backend/tests/unit/test_parser_bench_server.py \
  backend/eval/parser_bench/viewer/src/lib.test.ts
git commit -m "test(parser-bench): pin Plan 2's results; a neutral footer name in fixtures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The export keeps `votes.jsonl` byte for byte

**Files:**
- Modify: `backend/eval/parser_bench/store.py` (`export_run`, new `_export_votes`, `_write_bytes`)
- Modify: `backend/tests/unit/test_parser_bench_store.py` (`test_export_drops_the_notes_of_votes` replaced)
- Modify: `backend/tests/unit/test_parser_bench_results.py`

**Interfaces:**
- Consumes: `store.export_run(run_id, *, root, dest)`, `_home_as_tilde`, `_write_json` (Plan 2).
- Produces:
  - `store._export_votes(raw: bytes, home: str) -> tuple[bytes, dict]`.
  - An exported comparison folder holds `export.json`: `{"votes_digest", "exported_digest", "identical", "notes_blanked", "lines_rewritten", "torn_lines_blanked"}`.
  - The exported `votes.jsonl` equals the source byte for byte when no line has a note or the home folder.

Plan 2's export rewrote every vote line without its `note` key, so the exported file no longer matched `results.json`'s `votes_digest`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_parser_bench_store.py`, replace the whole function `test_export_drops_the_notes_of_votes` with:

```python
def test_export_blanks_notes_and_keeps_every_other_line_byte_for_byte(tmp_path):
    folder = make_compare_folder(tmp_path)
    plain = '{"pair": 2,   "winner": "b"}'  # odd spacing: any rewrite would show
    torn = '{"type": "vote", "note": "the slide sa'
    (folder / "votes.jsonl").write_text(
        '{"pair": 1, "winner": "a", "note": "the slide says so"}\n' + plain + "\n" + torn + "\n", encoding="utf-8")
    out = store.export_run(folder.name, root=tmp_path, dest=tmp_path / "export")
    text = (out / "votes.jsonl").read_text(encoding="utf-8")
    lines = text.split("\n")
    assert json.loads(lines[0]) == {"pair": 1, "winner": "a", "note": None}
    assert lines[1] == plain and lines[2] == "" and lines[3] == ""
    assert "slide" not in text
    report = json.loads((out / "export.json").read_text(encoding="utf-8"))
    assert (report["identical"], report["notes_blanked"], report["lines_rewritten"], report["torn_lines_blanked"]) == (False, 1, 1, 1)
```

Two existing store tests list the exported files exactly; a comparison export now also writes `export.json`. In `test_export_of_a_compare_run_drops_the_local_pdf_path` change `["compare.json", "votes.jsonl"]` to `["compare.json", "export.json", "votes.jsonl"]`, and in `test_export_copies_only_the_allowlisted_files_of_a_compare_run` change `["compare.json", "results.json", "votes.jsonl"]` to `["compare.json", "export.json", "results.json", "votes.jsonl"]`.

At the end of `backend/tests/unit/test_parser_bench_results.py` add:

```python
def test_an_export_of_votes_without_notes_keeps_the_results_digest(tmp_path):
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path)
    vote_all(cmp)
    cmp.finish()
    data = results.write_results(cmp, resamples=20, root=root)
    out = store.export_run(cmp.run_id, root=root, dest=tmp_path / "export")
    assert hashlib.sha256((out / "votes.jsonl").read_bytes()).hexdigest() == data["votes_digest"]
    report = json.loads((out / "export.json").read_text(encoding="utf-8"))
    assert report == {"votes_digest": data["votes_digest"], "exported_digest": data["votes_digest"], "identical": True,
                      "notes_blanked": 0, "lines_rewritten": 0, "torn_lines_blanked": 0}
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_store.py backend/tests/unit/test_parser_bench_results.py -q -k "export"`
Expected: FAIL (`KeyError`/`FileNotFoundError` for `export.json`; the note line has no `note` key).

- [ ] **Step 3: Implement**

In `backend/eval/parser_bench/store.py`, add `import hashlib` to the imports. Add after `_write_json`:

```python
def _write_bytes(path: Path, data: bytes) -> None:
    """Like _write_text, for bytes that must land exactly as given."""
    tmp = path.with_suffix(".tmp")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _export_votes(raw: bytes, home: str) -> tuple[bytes, dict[str, Any]]:
    """votes.jsonl for the thesis: every line byte for byte, so its digest still matches results.json, except
    that a vote's note (it may quote a slide) becomes null, a line holding the home folder gets ~, and a line
    that does not parse (a torn write, which could hold half a note) is blanked. The report says what changed."""
    lines: list[bytes] = []
    blanked = rewritten = torn = 0
    for line in raw.split(b"\n"):
        if not line.strip():
            lines.append(line)
            continue
        try:
            row = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            lines.append(b"")
            torn += 1
            continue
        changed = False
        if isinstance(row, dict) and row.get("note") is not None:
            row["note"] = None
            blanked += 1
            changed = True
        if home in line.decode("utf-8"):
            row = _home_as_tilde(row, home)
            changed = True
        if changed:
            rewritten += 1
            line = json.dumps(row, ensure_ascii=False).encode("utf-8")
        lines.append(line)
    out = b"\n".join(lines)
    return out, {
        "votes_digest": hashlib.sha256(raw).hexdigest(),
        "exported_digest": hashlib.sha256(out).hexdigest(),
        "identical": out == raw,
        "notes_blanked": blanked,
        "lines_rewritten": rewritten,
        "torn_lines_blanked": torn,
    }
```

Replace the whole function `export_run` with:

```python
def export_run(run_id: str, *, root: Path | None = None, dest: Path = EXPORT_DIR) -> Path:
    """Copy a benchmark run's number-only files into the repo for the thesis.

    Only the files EXPORTED lists for the run's kind are copied; absent ones are skipped. JSON files are
    sanitised in memory before anything is written: the record loses the local PDF path and the home folder
    becomes ~. votes.jsonl is copied line by line, byte for byte (see _export_votes), and export.json records
    its digests and what was blanked. The record is written last.
    """
    src = find_run(run_id, root)
    rec = _record(src)
    if rec is None:
        raise FileNotFoundError(f"{run_id} has no run.json or compare.json")
    meta = json.loads(rec.read_text(encoding="utf-8"))
    if meta.get("status") in ("running", "judging"):
        raise ValueError(f"{run_id} is still {meta['status']}")
    if meta.get("purpose") != "benchmark":
        raise ValueError(f"{run_id} has purpose {meta.get('purpose')!r}; only benchmark runs count for the thesis")
    if isinstance(meta.get("source"), dict):
        meta["source"].pop("path", None)
    home = str(Path.home())

    json_files: dict[str, Any] = {}
    byte_files: dict[str, bytes] = {}
    copied: list[str] = []
    report: dict[str, Any] | None = None
    for name in EXPORTED[src.parent.name]:
        f = src / name
        if name == rec.name or not f.is_file():
            continue
        if name == "votes.jsonl":
            byte_files[name], report = _export_votes(f.read_bytes(), home)
        elif name.endswith(".json"):
            json_files[name] = _home_as_tilde(json.loads(f.read_text(encoding="utf-8")), home)
        else:
            copied.append(name)  # checks.csv: numbers only
    meta = _home_as_tilde(meta, home)

    out = dest / run_id
    out.mkdir(parents=True, exist_ok=True)
    for name in copied:
        shutil.copyfile(src / name, out / name)
    for name, data in byte_files.items():
        _write_bytes(out / name, data)
    for name, data in json_files.items():
        _write_json(out / name, data)
    if report is not None:
        _write_json(out / "export.json", report)
    _write_json(out / rec.name, meta)
    return out
```

- [ ] **Step 4: Run the store and results tests**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_store.py backend/tests/unit/test_parser_bench_results.py -q`
Expected: all pass (the home-folder export test included: its vote line holds the home folder, so it is rewritten with `~`).

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/store.py backend/tests/unit/test_parser_bench_store.py backend/tests/unit/test_parser_bench_results.py
git commit -m "fix(parser-bench): export keeps votes.jsonl byte for byte, notes blanked, digests recorded

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Blinding by page and method

**Files:**
- Modify: `backend/eval/parser_bench/blinding.py`
- Modify: `backend/eval/parser_bench/api_runs.py` (`run_detail`, `run_page`, `diff`, `sources`, `outputs`)
- Modify: `backend/tests/unit/parser_bench_compare_fixtures.py` (add `bench_pages_of`)
- Modify: `backend/tests/unit/test_parser_bench_files.py`, `backend/tests/unit/test_parser_bench_server.py`

**Interfaces:**
- Consumes: `list_comparisons(root)`, `pageset.load_or_empty()`, `pageset.BenchPage` (Plan 2).
- Produces:
  - `blinding.Lock(judging: frozenset[(sha, page)], page_set: frozenset[(sha, page)], judged: frozenset[(sha, page, tool)])` with `Lock.hides(sha256, page, tool) -> bool`.
  - `blinding.lock_state(root=None, pages=None) -> Lock` (replaces `locked_pages`, which is removed).
  - `blinding.check(sha256, page, tool, state: Lock) -> None` raises `Locked`.
  - `blinding.LOCKED_MESSAGE: str`.
  - `/api/outputs/{sha}/{page}` returns `{"sha256", "page", "outputs", "hidden"}`; a hidden method's output is left out and only counted; 423 when the page is being judged or every output is hidden.
  - Fixture `bench_pages_of(cmp) -> list[pageset.BenchPage]`.

Plan 2 locked by page only. Once `cmp-2026-10-30_8825` finished, all 24 page-set pages counted as judged for every method, so `ai_vision`'s benchmark outputs would show with names in Runs, Compare and diff before the second comparison even existed. A page-set output now opens only for the methods a finished (or early-unlocked) comparison judged on that page.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/parser_bench_compare_fixtures.py`, add `pageset` to the import from `backend.eval.parser_bench` and add at the end:

```python
def bench_pages_of(cmp: compare.CompareRun) -> list[pageset.BenchPage]:
    """A comparison's pages as page-set entries, so a test can make them the page set."""
    return [pageset.BenchPage(p["key"], p["source"], p["file"], p["sha256"], int(p["page"]), p["type"], p["how"], "r")
            for p in cmp.meta["pages"]]
```

In `backend/tests/unit/test_parser_bench_files.py`, replace the bodies of these five tests (names unchanged) and add one test:

```python
def test_benchmark_pages_are_locked_until_their_comparison_is_judged(tmp_path):
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path)
    sha = cmp.meta["pages"][0]["sha256"]
    assert blinding.lock_state(root, pages=[]).hides(sha, 1, "alphatool")
    with pytest.raises(blinding.Locked):
        blinding.check(sha, 1, "alphatool", blinding.lock_state(root, pages=[]))
    vote_all(cmp)
    cmp.finish()
    assert not blinding.lock_state(root, pages=[]).hides(sha, 1, "alphatool")


def test_page_set_pages_are_locked_before_any_comparison_exists(tmp_path):
    page = pageset.BenchPage("swt-p3", "swt", "x.pdf", "a" * 64, 3, "lists", "chosen", "r")
    state = blinding.lock_state(tmp_path, pages=[page])
    assert state.hides("a" * 64, 3, "current") and not state.hides("a" * 64, 4, "current")


def test_a_second_comparison_locks_the_pages_again(tmp_path):
    root = tmp_path / "data"
    first = make_comparison(root, tmp_path)
    vote_all(first)
    first.finish()
    second = make_comparison(root, tmp_path)
    sha = second.meta["pages"][0]["sha256"]
    assert all(blinding.lock_state(root, pages=[]).hides(sha, n, "alphatool") for n in range(1, 7))


def test_unlocking_early_opens_the_pages_and_writes_a_deviation(tmp_path):
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path)
    log = tmp_path / "LAB_LOG.md"
    log.write_text("# log\n")
    with pytest.raises(ValueError, match="why"):
        blinding.unlock_early(cmp, "  ", lab_log=log)
    blinding.unlock_early(cmp, "checking the\nrenderer", lab_log=log)
    assert not blinding.lock_state(root, pages=[]).hides(cmp.meta["pages"][0]["sha256"], 1, "alphatool")
    text = log.read_text()
    assert "deviation: blinding lock lifted early" in text and "0 of 10 duels" in text and "checking the renderer" in text
    assert cmp.meta["unlocked_early"]["reason"] == "checking the renderer"


def test_a_failed_lab_log_write_leaves_the_comparison_locked(tmp_path):
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path)
    blocked = tmp_path / "LAB_LOG.md"
    blocked.mkdir()  # a folder cannot be appended to, so the log write fails
    with pytest.raises(OSError):
        blinding.unlock_early(cmp, "checking the renderer", lab_log=blocked)
    assert cmp.meta.get("unlocked_early") is None
    sha = cmp.meta["pages"][0]["sha256"]
    assert blinding.lock_state(root, pages=[]).hides(sha, 1, "alphatool")


def test_a_judged_page_opens_only_for_the_methods_judged_on_it(tmp_path):
    root = tmp_path / "data"
    cmp = make_comparison(root, tmp_path)
    vote_all(cmp)
    cmp.finish()
    sha = cmp.meta["pages"][0]["sha256"]
    state = blinding.lock_state(root, pages=bench_pages_of(cmp)[:1])  # page 1 is a page-set page
    assert not state.hides(sha, 1, "alphatool") and state.hides(sha, 1, "gammatool") and state.hides(sha, 1, None)
    assert not state.hides(sha, 2, "gammatool")  # not a page-set page, and no comparison is judging it
```

Add `bench_pages_of` to that file's import from `parser_bench_compare_fixtures`.

In `backend/tests/unit/test_parser_bench_server.py`, add `from backend.eval.parser_bench import blinding, pageset` and `bench_pages_of`, `vote_all` to the fixture import, then add:

```python
def page_set_is(monkeypatch, pages):
    monkeypatch.setattr(blinding.pageset, "load_or_empty", lambda path=pageset.PAGESET: list(pages))


def test_a_method_that_joins_later_stays_hidden_on_judged_pages(client, root, tmp_path, monkeypatch):
    cmp = make_comparison(root, tmp_path)  # current, alphatool, betatool on the deck's six pages
    vote_all(cmp)
    cmp.finish()
    page_set_is(monkeypatch, bench_pages_of(cmp))
    sha = cmp.meta["pages"][0]["sha256"]
    late = make_extract_run(root, "gammatool", tmp_path / "deck.pdf")  # a benchmark run of a method not judged here
    again = make_extract_run(root, "gammatool", tmp_path / "deck.pdf")
    judged = cmp.meta["entrants"]["alphatool"][sha]
    assert client.get(f"/api/runs/{late.run_id}/pages/1").status_code == 423
    assert client.get(f"/api/runs/{judged}/pages/1").status_code == 200
    detail = client.get(f"/api/runs/{late.run_id}").json()
    assert detail["checks"] == [] and all(p["locked"] for p in detail["page_list"])
    assert client.get("/api/diff", params={"a": late.run_id, "b": again.run_id, "page": 1}).status_code == 423
    body = client.get(f"/api/outputs/{sha}/1").json()
    assert "gammatool" not in json.dumps(body) and body["hidden"] == 2
    assert {o["tool"] for o in body["outputs"]} == {"current", "alphatool", "betatool"}
    [src] = [s for s in client.get("/api/sources").json()["sources"] if s["sha256"] == sha]
    assert src["locked"] == []  # every page still has an output that may be named


def test_a_page_whose_every_output_is_hidden_is_locked_in_compare(client, root, tmp_path, monkeypatch):
    deck = make_deck(tmp_path / "deck.pdf")
    run = make_extract_run(root, "gammatool", deck)
    sha = run.meta["source"]["sha256"]
    page_set_is(monkeypatch, [pageset.BenchPage("d-p1", "swt", "deck.pdf", sha, 1, "layout", "chosen", "r")])
    assert client.get(f"/api/outputs/{sha}/1").status_code == 423
    assert client.get(f"/api/outputs/{sha}/2").status_code == 200
    [src] = client.get("/api/sources").json()["sources"]
    assert src["locked"] == [1]
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_files.py backend/tests/unit/test_parser_bench_server.py -q`
Expected: FAIL with `AttributeError: module ... has no attribute 'lock_state'` and 200s where 423 is expected.

- [ ] **Step 3: Implement the lock**

In `backend/eval/parser_bench/blinding.py`, replace everything from the top of the file down to and including `check` (the module docstring, the imports, `LAB_LOG`, `PageRef`, `Locked`, `_open`, `locked_pages`, `check`) with the block below. `comparison_locked` and `unlock_early` stay as they are.

```python
"""The blinding lock (spec "The webpage").

A page of a benchmark comparison that is still being judged is locked for every method. A page of the page
set is locked for a method until a finished (or early-unlocked) benchmark comparison had that method among
its entrants and included that page: a method that joins later (ai_vision, the heavy methods) stays hidden
on the page set until its own comparison is judged, even though the fast methods' outputs there are open.
While locked, no output of that page by that method is shown anywhere, whichever run it comes from (explore
runs of a benchmark deck included): not in Runs, Compare, the Scoreboard or My votes. Only the duels show it,
without names. Abi may unlock a comparison early; that is written to the lab log as a deviation.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable

from backend.eval.parser_bench import pageset, store
from backend.eval.parser_bench.compare import CompareRun, list_comparisons

LAB_LOG = store.REPO / "docs" / "thesis" / "experiments" / "parser-benchmark" / "LAB_LOG.md"
LOCKED_MESSAGE = ("this page is in the benchmark set and still being judged blind; "
                  "its outputs open when judging is finished")
PageRef = tuple[str, int]  # (sha256, page)


class Locked(Exception):
    """An output view of a page that is still being judged blind."""


@dataclass(frozen=True)
class Lock:
    judging: frozenset[PageRef]                 # pages of comparisons still judging: hidden for every method
    page_set: frozenset[PageRef]
    judged: frozenset[tuple[str, int, str]]     # (sha256, page, method) opened by a finished comparison

    def hides(self, sha256: str | None, page: int, tool: str | None) -> bool:
        ref = (sha256, int(page))
        if ref in self.judging:
            return True
        return ref in self.page_set and (sha256, int(page), tool) not in self.judged


def _open(meta: dict) -> bool:
    return meta["status"] == "finished" or bool(meta.get("unlocked_early"))


def lock_state(root: Path | None = None, pages: Iterable[pageset.BenchPage] | None = None) -> Lock:
    metas = [c.meta for c in list_comparisons(root)]
    metas = [m for m in metas if m.get("purpose") == "benchmark"]
    judging = {(p["sha256"], int(p["page"])) for m in metas if not _open(m) for p in m["pages"]}
    judged = {(p["sha256"], int(p["page"]), tool)
              for m in metas if _open(m) for p in m["pages"] for tool in m["entrants"]}
    page_set = pageset.load_or_empty() if pages is None else pages
    return Lock(frozenset(judging), frozenset((p.sha256, p.page) for p in page_set), frozenset(judged))


def check(sha256: str, page: int, tool: str | None, state: Lock) -> None:
    if state.hides(sha256, page, tool):
        raise Locked(LOCKED_MESSAGE)
```

- [ ] **Step 4: Use it in the routes**

In `backend/eval/parser_bench/api_runs.py`:

In `run_detail`, replace

```python
    locked = blinding.locked_pages(root)
    pages = [{"page": p, "locked": (sha, p) in locked} for p in sorted(run.pages())]
```

with

```python
    state = blinding.lock_state(root)
    pages = [{"page": p, "locked": state.hides(sha, p, meta.get("tool"))} for p in sorted(run.pages())]
```

In `run_page`, replace `blinding.check(sha, page, blinding.locked_pages(root))` with

```python
    blinding.check(sha, page, run.meta.get("tool"), blinding.lock_state(root))
```

In `diff`, replace `blinding.check(sha_a, page, blinding.locked_pages(root))` with

```python
    blinding.check(sha_a, page, ma.get("tool"), blinding.lock_state(root))  # both runs are of this method
```

Replace the whole `sources` function with:

```python
@router.get("/sources")
def sources(request: Request) -> dict[str, Any]:
    """Every PDF with a finished extraction run, with the pages any run scored (Compare's picker). A page is
    listed as locked when no output of it may be named now."""
    root = root_of(request)
    state = blinding.lock_state(root)
    by_sha: dict[str, dict[str, Any]] = {}
    for meta in store.list_runs(root):
        if meta.get("kind") != "extract" or meta.get("status") != "finished":
            continue
        src = meta.get("source") or {}
        if not src.get("sha256"):  # an old or damaged record without a source never takes the whole list down
            continue
        entry = by_sha.setdefault(src["sha256"], {"sha256": src["sha256"], "name": src.get("name") or src["sha256"][:12],
                                                  "pages_total": src.get("pages_total"), "tools": {}, "runs": 0})
        for page in meta.get("pages_scored") or []:
            entry["tools"].setdefault(page, set()).add(meta.get("tool"))
        entry["runs"] += 1
    out = []
    for entry in by_sha.values():
        pages = sorted(entry["tools"])
        locked = [p for p in pages if all(state.hides(entry["sha256"], p, t) for t in entry["tools"][p])]
        out.append({"sha256": entry["sha256"], "name": entry["name"], "pages_total": entry["pages_total"],
                    "pages": pages, "locked": locked, "runs": entry["runs"]})
    return {"sources": sorted(out, key=lambda e: e["name"].lower())}
```

Replace the whole `outputs` function with:

```python
@router.get("/outputs/{sha256}/{page}")
def outputs(sha256: str, page: int, request: Request) -> dict[str, Any]:
    """Every finished run's output of one page whose method may be named now, with names and checks (Compare).
    A method still hidden on this page is left out and only counted; the page is locked (423) while a
    comparison judges it, or when every output of it is hidden."""
    root = root_of(request)
    files.check_sha(sha256)
    state = blinding.lock_state(root)
    if (sha256, int(page)) in state.judging:
        raise blinding.Locked(blinding.LOCKED_MESSAGE)
    found, hidden = [], 0
    for meta in store.list_runs(root):
        if meta.get("kind") != "extract" or meta.get("status") != "finished" or (meta.get("source") or {}).get("sha256") != sha256:
            continue
        run = store.ExtractRun(store.find_run(meta["run_id"], root))
        text = run.pages().get(page)
        if text is None:
            continue
        if state.hides(sha256, page, meta.get("tool")):
            hidden += 1
            continue
        row = next((r for r in run.typed_checks() if r.get("page") == page), None)
        found.append({**summary(meta, root), "markdown": text, "footer_lines": footer_lines(sha256, page, text, root), "checks": row})
    if hidden and not found:
        raise blinding.Locked(blinding.LOCKED_MESSAGE)
    return {"sha256": sha256, "page": page, "outputs": found, "hidden": hidden}
```

Then check nothing else uses the old name:

```bash
grep -rn "locked_pages" backend/eval/parser_bench backend/tests || echo "gone"
```

Expected: `gone`.

- [ ] **Step 5: Run the files, server and CLI tests**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_files.py backend/tests/unit/test_parser_bench_server.py backend/tests/unit/test_parser_bench_cli.py backend/tests/unit/test_parser_bench_results.py -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/eval/parser_bench/blinding.py backend/eval/parser_bench/api_runs.py \
  backend/tests/unit/parser_bench_compare_fixtures.py backend/tests/unit/test_parser_bench_files.py backend/tests/unit/test_parser_bench_server.py
git commit -m "fix(parser-bench): blinding by page and method — a method that joins later stays hidden

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The run gate refuses bench code changed since the protocol commit

**Files:**
- Modify: `backend/eval/parser_bench/execute.py` (`bench_tree`, `bench_drift`, `benchmark_gate` replacing `_benchmark_gate`, `run_tool`)
- Modify: `backend/eval/parser_bench/compare.py` (`_provenance`, `create_benchmark(tree=)`, `CompareRun.create(bench_tree=, provenance=)`)
- Modify: `backend/eval/parser_bench/__main__.py` (`compare create` uses the full gate)
- Modify: `backend/tests/unit/parser_bench_compare_fixtures.py` (`make_extract_run(tree=, finish_extra=)`)
- Modify: `backend/tests/unit/test_parser_bench_execute.py`, `test_parser_bench_compare.py`, `test_parser_bench_cli.py`

**Interfaces:**
- Consumes: `execute.protocol_commit()`, `execute.bench_changes()`, `execute.BENCH_TRACKED` (Plan 2).
- Produces:
  - `execute.bench_tree(rev: str = "HEAD") -> str | None`: SHA-256 over the git object ids of `BENCH_TRACKED` at `rev`.
  - `execute.bench_drift(commit: str) -> list[str]`: files under `BENCH_TRACKED` that differ between `commit` and HEAD (fails closed with one message line).
  - `execute.benchmark_gate() -> dict` with `{"protocol_commit": str, "bench_tree": str}`, or `RuntimeError`.
  - Benchmark `run.json` records `bench_tree`.
  - `compare._provenance(entrants, root) -> dict[tool, {"protocol_commit", "bench_tree"}]`.
  - `compare.create_benchmark(tools, *, seed, commit, tree=None, pages=None, anchor="current", root=None)` refuses entrants whose runs have different bench trees.
  - `CompareRun.create(..., bench_tree=None, provenance=None)` writes both keys.
  - Fixture `make_extract_run(root, tool, deck, pages=range(1, 7), *, purpose="benchmark", commit="abc123", tree=None, finish_extra=None)`.

`PROTOCOL.md` says a later change is a dated deviation, but Plan 2's gate only checked that the bench was *committed*: a run could be recorded "under" the protocol commit while running newer code. From this task on, every bench change (including Tasks 5–15 of this plan) blocks benchmark runs until Deviation 2 is committed in Task 16.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/parser_bench_compare_fixtures.py`, replace `make_extract_run` with:

```python
def make_extract_run(root: Path, tool: str, deck: Path, pages=range(1, 7), *, purpose="benchmark", commit="abc123",
                     tree=None, finish_extra=None):
    """A finished run: `current` holds the raw text layer (footer included), the others clean Markdown.
    `tree` is recorded as the run's bench_tree when given; `finish_extra` adds fields to the sealed record."""
    facts = checks.document_facts(deck)
    sha = sources.sha256_file(deck)
    extra = {"protocol_commit": commit, **({"bench_tree": tree} if tree else {})}
    run = store.ExtractRun.create(
        tool=tool, version="1.0", purpose=purpose, root=root,
        source={"path": str(deck), "name": deck.name, "sha256": sha, "pages_total": 6},
        extra=extra, checks_version=checks.CHECKS_VERSION, git={"commit": "c0ffee", "dirty": False},
    )
    rows = []
    with fitz.open(deck) as doc:
        for page in pages:
            text = doc[page - 1].get_text("text") if tool == "current" else f"# {tool} heading {page}\n\nbody of page {page}\n"
            run.write_page(page, text)
            rows.append(checks.check_page(text, facts.pages[page], facts))
    run.write_checks(rows)
    run.finish("finished", pages_scored=list(pages), seconds_per_page=0.01, peak_memory_mb=None, environment=["x"],
               **(finish_extra or {}))
    return run
```

In `backend/tests/unit/test_parser_bench_execute.py`, replace the `bench_ready` fixture with:

```python
@pytest.fixture
def bench_ready(monkeypatch):
    """A committed protocol, a clean bench unchanged since it, and pages 2 and 5 of any file in the page set."""
    monkeypatch.setattr(execute, "protocol_commit", lambda: "abc123")
    monkeypatch.setattr(execute, "bench_changes", lambda: [])
    monkeypatch.setattr(execute, "bench_drift", lambda commit: [])
    monkeypatch.setattr(execute, "bench_tree", lambda rev="HEAD": "tree0")
    monkeypatch.setattr(execute, "benchmark_pages", lambda sha: [2, 5])
```

and add at the end:

```python
def test_a_benchmark_run_refuses_bench_code_committed_after_the_protocol(tmp_path, deck, monkeypatch, bench_ready):
    monkeypatch.setattr(execute, "bench_drift", lambda commit: ["backend/eval/parser_bench/checks.py"])
    with pytest.raises(RuntimeError, match="changed since the protocol commit abc123.*checks.py.*deviation"):
        execute.run_tool("fake", deck, purpose="benchmark", root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))
    assert store.list_runs(tmp_path / "data") == []


def test_a_benchmark_run_records_the_bench_tree(tmp_path, deck, bench_ready):
    run = execute.run_tool("fake", deck, purpose="benchmark", root=tmp_path / "data", registry=registry(tmp_path, "fake", FAKE_OK))
    assert (run.meta["protocol_commit"], run.meta["bench_tree"]) == ("abc123", "tree0")


def _bench_files(repo):
    for rel in execute.BENCH_TRACKED:
        path = repo / rel
        if rel.endswith((".md", ".json")):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("v1\n")
        else:
            path.mkdir(parents=True, exist_ok=True)
            (path / "x.py").write_text("x = 1\n")


def test_bench_drift_and_tree_follow_the_bench_files(protocol_repo):
    repo, _ = protocol_repo
    _bench_files(repo)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "protocol")
    first = git(repo, "rev-parse", "HEAD")
    tree = execute.bench_tree()
    assert tree is not None and len(tree) == 64 and execute.bench_drift(first) == []
    (repo / "LAB_LOG.md").write_text("a note\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "log")
    assert execute.bench_drift(first) == [] and execute.bench_tree() == tree  # a lab-log commit changes nothing
    (repo / execute.BENCH_TRACKED[0] / "x.py").write_text("x = 2\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "code")
    assert execute.bench_drift(first) == ["backend/eval/parser_bench/x.py"]
    assert execute.bench_tree() != tree and execute.bench_tree(first) == tree
    assert execute.bench_drift("0" * 40)[0].startswith("git diff failed")
```

In `backend/tests/unit/test_parser_bench_compare.py`, add:

```python
def test_create_benchmark_refuses_runs_made_with_different_bench_trees(tmp_path):
    root = tmp_path / "data"
    deck = make_deck(tmp_path / "deck.pdf")
    make_extract_run(root, "current", deck)
    make_extract_run(root, "alphatool", deck, tree="t2")
    with pytest.raises(ValueError, match="different bench trees"):
        compare.create_benchmark(["current", "alphatool"], seed=1, commit="abc123", tree="t2", pages=bench_pages(deck), root=root)
    make_extract_run(root, "current", deck, tree="t2")
    cmp = compare.create_benchmark(["current", "alphatool"], seed=1, commit="abc123", tree="t2", pages=bench_pages(deck), root=root)
    assert cmp.meta["bench_tree"] == "t2"
    assert cmp.meta["provenance"]["alphatool"] == {"protocol_commit": "abc123", "bench_tree": "t2"}
```

In `backend/tests/unit/test_parser_bench_cli.py`, in `test_compare_create_from_benchmark_runs` replace

```python
    monkeypatch.setattr(execute, "protocol_commit", lambda: "abc123")
```

with

```python
    monkeypatch.setattr(execute, "benchmark_gate", lambda: {"protocol_commit": "abc123", "bench_tree": "t"})
```

and add:

```python
def test_compare_create_refuses_a_bench_changed_since_the_protocol(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(execute, "protocol_commit", lambda: "abc123")
    monkeypatch.setattr(execute, "bench_changes", lambda: [])
    monkeypatch.setattr(execute, "bench_drift", lambda commit: ["backend/eval/parser_bench/results.py"])
    assert cli.main(["compare", "create", "--tools", "current,pdfjs", "--seed", "1"]) == 2
    assert "deviation" in capsys.readouterr().err
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_execute.py backend/tests/unit/test_parser_bench_compare.py backend/tests/unit/test_parser_bench_cli.py -q`
Expected: FAIL (`execute` has no `bench_drift` / `bench_tree` / `benchmark_gate`; `create_benchmark` takes no `tree`).

- [ ] **Step 3: Implement the gate**

In `backend/eval/parser_bench/execute.py`, add `import hashlib` to the imports, add `"benchmark_gate", "bench_drift", "bench_tree"` to `__all__`, and replace the function `_benchmark_gate` with:

```python
def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(store.REPO), *args], capture_output=True, text=True, timeout=60)


def bench_tree(rev: str = "HEAD") -> str | None:
    """One hash for what a benchmark result depends on at `rev`: the git object ids of BENCH_TRACKED (the
    bench's code tree, PROTOCOL.md, pages.json), hashed together. None when git cannot name one of them."""
    ids = []
    try:
        for path in BENCH_TRACKED:
            probe = _git("rev-parse", f"{rev}:{path}")
            if probe.returncode != 0:
                return None
            ids.append(f"{path} {probe.stdout.strip()}")
    except subprocess.TimeoutExpired:
        return None
    return hashlib.sha256("\n".join(ids).encode("utf-8")).hexdigest()


def bench_drift(commit: str) -> list[str]:
    """The files under BENCH_TRACKED that differ between the protocol commit and HEAD. Fails closed: a git
    error or timeout is one line saying so."""
    try:
        probe = _git("diff", "--name-only", commit, "HEAD", "--", *BENCH_TRACKED)
    except subprocess.TimeoutExpired:
        return ["git diff timed out"]
    if probe.returncode != 0:
        return [f"git diff failed: {probe.stderr.strip() or probe.returncode}"]
    return [line for line in probe.stdout.splitlines() if line.strip()]


def benchmark_gate() -> dict[str, str]:
    """What a benchmark run or comparison records ({"protocol_commit", "bench_tree"}), or RuntimeError saying
    why none may start now: PROTOCOL.md committed and unmodified, the bench committed, and the bench unchanged
    since the protocol commit (PROTOCOL.md's own rule: a change is a dated deviation, committed with it)."""
    commit = protocol_commit()
    if commit is None:
        raise RuntimeError("benchmark runs need PROTOCOL.md committed and unmodified first (spec: protocol before the first run)")
    changes = bench_changes()
    if changes:
        raise RuntimeError("benchmark runs need the benchmark's code, protocol and page set committed first: "
                           + "; ".join(changes))
    drift = bench_drift(commit)
    if drift:
        raise RuntimeError(f"the benchmark changed since the protocol commit {commit[:8]}: {'; '.join(drift)}. "
                           "Record the change as a dated deviation in PROTOCOL.md and commit it first")
    tree = bench_tree()
    if tree is None:
        raise RuntimeError("git could not name the benchmark's tree at HEAD")
    return {"protocol_commit": commit, "bench_tree": tree}
```

In `run_tool`, replace

```python
        extra["protocol_commit"] = _benchmark_gate()  # fast refusal; checked again once the slot is held
```

with

```python
        extra.update(benchmark_gate())  # fast refusal; checked again once the slot is held
```

and replace

```python
            extra["protocol_commit"] = _benchmark_gate()
```

with

```python
            extra.update(benchmark_gate())
```

- [ ] **Step 4: Record and check provenance in comparisons**

In `backend/eval/parser_bench/compare.py`, in `CompareRun.create` add the keyword parameters `bench_tree: str | None = None` and `provenance: Mapping[str, Mapping[str, Any]] | None = None` (after `anchor`), and in the dict written to `compare.json` add, right after `"protocol_commit": protocol_commit,`:

```python
            "bench_tree": bench_tree,
            "provenance": {tool: dict(p) for tool, p in sorted((provenance or {}).items())} or None,
```

Add above `create_benchmark`:

```python
def _provenance(entrants: Mapping[str, Mapping[str, str]], root: Path | None = None) -> dict[str, dict[str, Any]]:
    """Per entrant: the protocol commit and bench tree its runs were made under (runs from before bench trees
    were recorded have None). One entrant's runs must agree."""
    out: dict[str, dict[str, Any]] = {}
    for tool, runs in sorted(entrants.items()):
        seen = set()
        for run_id in runs.values():
            meta = store.ExtractRun(store.find_run(run_id, root)).meta
            seen.add((meta.get("protocol_commit"), meta.get("bench_tree")))
        if len(seen) != 1:
            raise ValueError(f"{tool}'s runs were made under different protocol commits or bench trees: {sorted(seen, key=str)}")
        commit, tree = seen.pop()
        out[tool] = {"protocol_commit": commit, "bench_tree": tree}
    return out
```

Replace `create_benchmark` with:

```python
def create_benchmark(tools: Sequence[str], *, seed: int, commit: str | None, tree: str | None = None,
                     pages: Sequence[pageset.BenchPage] | None = None, anchor: str = "current",
                     root: Path | None = None) -> CompareRun:
    """A new blind comparison of `tools` on the page set, from their latest benchmark runs. `commit` and `tree`
    come from execute.benchmark_gate(); the entrants' runs must share one bench tree."""
    if commit is None:
        raise RuntimeError("a benchmark comparison needs PROTOCOL.md committed and unmodified")
    pages = pageset.load() if pages is None else list(pages)
    entrants = latest_benchmark_runs(tools, pages, commit, root)
    provenance = _provenance(entrants, root)
    trees = {p["bench_tree"] for p in provenance.values()}
    if len(trees) > 1:
        raise ValueError(f"the entrants' runs were made with different bench trees ({', '.join(sorted(map(str, trees)))}); "
                         "make them again under one protocol commit")
    duels = schedule.round1(list(tools), [schedule.SchedPage(p.key, p.type) for p in pages], seed)
    return CompareRun.create(entrants=entrants, pages=[pageset.as_entry(p) for p in pages], seed=seed, duels=duels,
                             protocol_commit=commit, anchor=anchor, bench_tree=tree, provenance=provenance, root=root)
```

In `backend/eval/parser_bench/__main__.py`, in `_compare`, replace

```python
            cmp = compare.create_benchmark([t for t in args.tools.split(",") if t], seed=args.seed,
                                           commit=execute.protocol_commit())
```

with

```python
            gate = execute.benchmark_gate()
            cmp = compare.create_benchmark([t for t in args.tools.split(",") if t], seed=args.seed,
                                           commit=gate["protocol_commit"], tree=gate["bench_tree"])
```

- [ ] **Step 5: Run every parser-bench test**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_*.py -q`
Expected: all pass, `test_a_plan2_comparison_summarizes_exactly_as_before` included.

- [ ] **Step 6: Commit**

```bash
git add backend/eval/parser_bench/execute.py backend/eval/parser_bench/compare.py backend/eval/parser_bench/__main__.py \
  backend/tests/unit/parser_bench_compare_fixtures.py backend/tests/unit/test_parser_bench_execute.py \
  backend/tests/unit/test_parser_bench_compare.py backend/tests/unit/test_parser_bench_cli.py
git commit -m "fix(parser-bench): benchmark gate refuses bench changes since the protocol commit; record the bench tree

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The judge is not told about rounds; the stopping rule reads unrounded intervals

**Files:**
- Modify: `backend/eval/parser_bench/api_compare.py` (`_summary`, `next_duel`, `vote`)
- Modify: `backend/eval/parser_bench/__main__.py` (`_compare` status line)
- Modify: `backend/eval/parser_bench/ranking.py` (`analyse` returns `"raw"`)
- Modify: `backend/eval/parser_bench/results.py` (`_summarize`, `summarize`, `_decision_rows`, `advance`)
- Modify: `backend/eval/parser_bench/viewer/src/api.ts`, `viewer/src/screens/Judge.tsx:178`
- Modify: `backend/tests/unit/test_parser_bench_server.py`, `test_parser_bench_cli.py`, `test_parser_bench_ranking.py`, `test_parser_bench_results.py`

**Interfaces:**
- Consumes: `blinding.comparison_locked(meta)`, `schedule.needs_round2(ranking)` (Plan 2).
- Produces:
  - While a comparison is locked: `/next` has no `"round"`, the vote response is exactly `{"vote_id", "done", "total", "finished"}` (no `"added"`), and the comparison list shows `"rounds": null`. `compare status` prints no round while locked.
  - `ranking.analyse(...)["raw"] == {entrant: {"points": float, "lo": float, "hi": float}}`, unrounded (`{}` without votes).
  - `results._summarize(cmp, *, resamples, root) -> tuple[dict, dict]` (results.json content, `raw`); `results.summarize` returns `_summarize(...)[0]`.
  - `results._decision_rows(raw) -> list[dict]`: `[{"entrant", "points", "lo", "hi"}]`, best first by unrounded points.
  - Fixture-style helper `fake_verdict(figures)` in `test_parser_bench_results.py`, reused in Task 14.

Plan 2 showed "· round 2" on the duel screen and returned `added` after a vote, which tells the judge that the top intervals overlap. Its stopping rule also compared intervals rounded to 0.1 point.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_parser_bench_server.py` add:

```python
def test_the_judge_is_not_told_about_rounds_while_judging(client, root, tmp_path):
    cmp = make_comparison(root, tmp_path)
    body = client.get(f"/api/comparisons/{cmp.run_id}/next").json()
    assert "round" not in body
    r = client.post(f"/api/comparisons/{cmp.run_id}/votes", headers=WRITE,
                    json={"duel": body["duel"], "choice": "same", "seconds": 1, "session": SESSION}).json()
    assert set(r) == {"vote_id", "done", "total", "finished"}
    [summary] = client.get("/api/comparisons").json()["comparisons"]
    assert summary["rounds"] is None
```

In `backend/tests/unit/test_parser_bench_cli.py`, in `test_compare_status_hides_names_until_judging_is_finished`, after the line `assert "0/10 duels" in out and "hidden" in out and "alphatool" not in out` add:

```python
    assert "round" not in out
```

and after the last assertion of that test add:

```python
    assert "round 1" in out
```

In `backend/tests/unit/test_parser_bench_ranking.py` add:

```python
def test_analyse_also_returns_the_unrounded_figures():
    outcomes = ([ranking.outcome("a", "b", "left")] * 6 + [ranking.outcome("b", "a", "left")] * 2
                + [ranking.outcome("a", "current", "same")] * 4)
    v = ranking.analyse(outcomes, ["a", "b", "current"], "current", resamples=50, seed=3)
    for row in v["rows"]:
        raw = v["raw"][row["entrant"]]
        assert (round(raw["points"], 1), round(raw["lo"], 1), round(raw["hi"], 1)) == (row["points"], row["lo"], row["hi"])
    assert ranking.analyse([], ["a", "current"], "current")["raw"] == {}
```

In `backend/tests/unit/test_parser_bench_results.py` add:

```python
def fake_verdict(figures):
    """What ranking.analyse returns, built from {entrant: (points, lo, hi)} given unrounded."""
    rows = sorted(({"entrant": e, "points": round(p, 1), "lo": round(lo, 1), "hi": round(hi, 1),
                    "h1_lower": None if e == "current" else round(lo, 1)} for e, (p, lo, hi) in figures.items()),
                  key=lambda r: (-r["points"], r["entrant"]))
    return {"rows": rows, "h1": False, "h1_above": [], "h1_k": len(figures) - 1,
            "raw": {e: {"points": p, "lo": lo, "hi": hi} for e, (p, lo, hi) in figures.items()}}


def test_the_stopping_rule_reads_unrounded_intervals(cmp, tmp_path, monkeypatch):
    vote_all(cmp, prefer("alphatool"))
    fake = fake_verdict({"alphatool": (1100.0, 1050.04, 1150.0), "betatool": (1000.1, 950.0, 1049.96),
                         "current": (1000.0, 1000.0, 1000.0)})
    assert schedule.needs_round2(fake["rows"])  # rounded to 0.1 point, the two would seem to overlap
    monkeypatch.setattr(results.ranking, "analyse", lambda *a, **k: fake)
    assert results.advance(cmp, resamples=FAST, root=tmp_path / "data") == {"added": 0, "finished": True}
```

`advance` will call `_summarize` (not `summarize`), so two Plan 2 tests in the same file must intercept `_summarize`. In `test_an_undo_between_summary_and_finish_leaves_the_comparison_judging` replace `real_summarize = results.summarize` with `real_summarize = results._summarize` and `monkeypatch.setattr(results, "summarize", summarize_then_undo)` with `monkeypatch.setattr(results, "_summarize", summarize_then_undo)` (the wrapper passes the tuple through unchanged). In `test_advance_on_an_incomplete_comparison_does_not_summarize` replace `monkeypatch.setattr(results, "summarize", lambda` with `monkeypatch.setattr(results, "_summarize", lambda`. (Without this, the first test fails with `RunFinishedError` and the second guards nothing.)

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_server.py backend/tests/unit/test_parser_bench_cli.py backend/tests/unit/test_parser_bench_ranking.py backend/tests/unit/test_parser_bench_results.py -q`
Expected: FAIL ("round" in body, `"added"` in the vote response, `KeyError: 'raw'`, and advance adding a round-2 batch).

- [ ] **Step 3: Hide rounds while locked**

In `backend/eval/parser_bench/api_compare.py`, in `_summary` replace `"rounds": meta["rounds"],` with

```python
            "rounds": None if blinding.comparison_locked(meta) else meta["rounds"],
```

In `next_duel` replace the final `return {...}` with:

```python
    body = {
        "finished": False, "done": done, "total": total, "duel": duel["duel"],
        "page": {"key": page["key"], "type": page["type"], "number": page["page"], "file": page["file"],
                 "png": f"/api/files/{page['sha256']}/pages/{page['page']}.png"},
        "left": {"markdown": left},
        "right": {"markdown": right},
    }
    if not blinding.comparison_locked(cmp.meta):  # a round number tells the judge whether the top two overlap
        body["round"] = duel["round"]
    return body
```

In `vote` replace the last two lines with:

```python
    done, total = cmp.progress()
    body = {"vote_id": line["vote_id"], "done": done, "total": total, "finished": step["finished"]}
    if not blinding.comparison_locked(cmp.meta):  # "added" would say that round 2 started, so only after judging
        body["added"] = step["added"]
    return body
```

In `backend/eval/parser_bench/__main__.py`, in `_compare`, replace

```python
    print(f"{cmp.run_id}  {meta['status']}  {done}/{total} duels  round {meta['rounds']}")
    if blinding.comparison_locked(meta):
```

with

```python
    locked = blinding.comparison_locked(meta)
    print(f"{cmp.run_id}  {meta['status']}  {done}/{total} duels" + ("" if locked else f"  round {meta['rounds']}"))
    if locked:
```

In `backend/eval/parser_bench/viewer/src/api.ts`, change `rounds: number;` inside `ComparisonSummary` to `rounds: number | null;`, and in `api.vote` change the response type to `{ vote_id: string; done: number; total: number; added?: number; finished: boolean }`.

In `backend/eval/parser_bench/viewer/src/screens/Judge.tsx`, delete the line

```tsx
          {duel.round === 2 ? " · round 2" : ""}
```

- [ ] **Step 4: Unrounded figures for the stopping rule**

In `backend/eval/parser_bench/ranking.py`, in `analyse`, replace

```python
    if not outcomes:
        return {"rows": [], "h1": False, "h1_above": [], "h1_k": k}
```

with

```python
    if not outcomes:
        return {"rows": [], "h1": False, "h1_above": [], "h1_k": k, "raw": {}}
```

replace the row loop and return with:

```python
    raw = {e: {"points": estimate[e], "lo": percentile(draws[e], 0.025), "hi": percentile(draws[e], 0.975)}
           for e in entrants}
    rows = []
    for e in entrants:
        rows.append({
            "entrant": e,
            "points": round(estimate[e], 1),
            "lo": round(raw[e]["lo"], 1),
            "hi": round(raw[e]["hi"], 1),
            "h1_lower": None if e == anchor else round(h1_lower[e], 1),
        })
    h1_above = sorted(e for e, v in h1_lower.items() if v > 1000.0)
    rows.sort(key=lambda r: (-r["points"], r["entrant"]))
    return {"rows": rows, "h1": bool(h1_above), "h1_above": h1_above, "h1_k": k, "raw": raw}
```

and add to its docstring: `"raw" holds each entrant's unrounded points and interval; the stopping rule reads it, results.json does not.`

In `backend/eval/parser_bench/results.py`, rename `def summarize(` to `def _summarize(` with the signature

```python
def _summarize(cmp: CompareRun, *, resamples: int = ranking.RESAMPLES,
               root: Path | None = None) -> tuple[dict[str, Any], dict[str, dict[str, float]]]:
    """results.json's content, and each entrant's unrounded points and interval for the stopping rule."""
```

change its final `return {...}` to `data = {...}` (same dict, unchanged keys and order) followed by `return data, verdict["raw"]`, and add after it:

```python
def summarize(cmp: CompareRun, *, resamples: int = ranking.RESAMPLES, root: Path | None = None) -> dict[str, Any]:
    return _summarize(cmp, resamples=resamples, root=root)[0]


def _decision_rows(raw: Mapping[str, Mapping[str, float]]) -> list[dict[str, Any]]:
    """The stopping rule's ranking: unrounded points and intervals, best first (ties by name)."""
    return sorted(({"entrant": e, **v} for e, v in raw.items()), key=lambda r: (-r["points"], r["entrant"]))
```

In `advance`, replace `data = summarize(cmp, resamples=resamples, root=root)` with

```python
    data, raw = _summarize(cmp, resamples=resamples, root=root)
    decision = _decision_rows(raw)
```

and replace

```python
    if room > 0 and schedule.needs_round2(data["ranking"]):
        pages = [schedule.SchedPage(p["key"], p["type"]) for p in meta["pages"]]
        batch = schedule.round2_batch([r["entrant"] for r in data["ranking"]], pages, meta["schedule"],
                                      meta["seed"], meta["rounds"], room)
```

with

```python
    if room > 0 and schedule.needs_round2(decision):
        pages = [schedule.SchedPage(p["key"], p["type"]) for p in meta["pages"]]
        batch = schedule.round2_batch([r["entrant"] for r in decision], pages, meta["schedule"],
                                      meta["seed"], meta["rounds"], room)
```

- [ ] **Step 5: Run the tests, the viewer checks and the pin**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_*.py -q && $NODE node_modules/typescript/bin/tsc -p backend/eval/parser_bench/viewer/tsconfig.json && $NODE node_modules/eslint/bin/eslint.js backend/eval/parser_bench/viewer/src`
Expected: all pass; `test_a_plan2_comparison_summarizes_exactly_as_before` still green.

- [ ] **Step 6: Commit**

```bash
git add backend/eval/parser_bench/api_compare.py backend/eval/parser_bench/__main__.py backend/eval/parser_bench/ranking.py \
  backend/eval/parser_bench/results.py backend/eval/parser_bench/viewer/src/api.ts backend/eval/parser_bench/viewer/src/screens/Judge.tsx \
  backend/tests/unit/test_parser_bench_server.py backend/tests/unit/test_parser_bench_cli.py \
  backend/tests/unit/test_parser_bench_ranking.py backend/tests/unit/test_parser_bench_results.py
git commit -m "fix(parser-bench): no round information for the judge; stopping rule on unrounded intervals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: `paid.py`: the key file, the price table, the estimate and the cost

**Files:**
- Create: `backend/eval/parser_bench/paid.py`
- Test: `backend/tests/unit/test_parser_bench_paid.py`

**Interfaces:**
- Consumes: nothing from the bench (standard library only).
- Produces:
  - `paid.KEY_FILE: Path` (`~/.config/learnstation-parser-bench/openai_key`), `paid.API_HOST = "api.openai.com"`, `paid.MODELS_URL`, `paid.MAX_OUTPUT_TOKENS = 16384`.
  - `paid.KeyFileError(RuntimeError)`; `paid.key_problem(path: Path | None = None) -> str | None` (reads `KEY_FILE` at call time, so tests can monkeypatch it); `paid.read_key(path=None) -> str`.
  - `paid.redact(text: str, key: str | None = None) -> str`.
  - `paid.Price(input_per_m, output_per_m, est_input_tokens, est_output_tokens, checked_on, source)`; `paid.PRICES: dict[str, Price]`; `paid.price_of(model) -> Price` (ValueError without a price or an id).
  - `paid.Estimate(model, pages, usd, max_usd)` with `.as_dict()` and `.line(tool_id) -> str`; `paid.estimate(model, pages) -> Estimate`; `paid.usd(value) -> str`.
  - `paid.cost(model, api: Mapping | None) -> dict | None`: `{"requests", "prompt_tokens", "completion_tokens", "cached_tokens", "reasoning_tokens", "usd", "price", "basis"}`.
  - `paid.list_models(*, key_file=None, opener=None) -> list[str]` (GET `https://api.openai.com/v1/models`).

The `gpt-4.1-mini` row is OpenAI's launch price (2025-04-14). Task 16 re-reads it on the pricing page and updates `checked_on`/`source` (and the numbers, if they changed) before any paid run.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_parser_bench_paid.py`:

```python
import io
import json
import os
import re
import urllib.error
import urllib.request

import pytest

from backend.eval.parser_bench import paid

KEY = "sk-test-SECRET-0123456789"


def key_file(folder, text=KEY, mode=0o600):
    path = folder / "openai_key"
    path.write_text(text + "\n")
    path.chmod(mode)
    return path


def test_a_private_key_file_is_read_and_stripped(tmp_path):
    path = key_file(tmp_path)
    assert paid.key_problem(path) is None and paid.read_key(path) == KEY


def test_a_missing_key_file_is_named(tmp_path):
    assert paid.key_problem(tmp_path / "absent").startswith("key file missing")


@pytest.mark.parametrize("mode", [0o644, 0o640, 0o604, 0o700])
def test_a_key_file_others_can_read_or_with_another_mode_is_refused(tmp_path, mode):
    problem = paid.key_problem(key_file(tmp_path, mode=mode))
    assert f"0600, not {mode:04o}" in problem and "SECRET" not in problem
    with pytest.raises(paid.KeyFileError):
        paid.read_key(key_file(tmp_path, mode=mode))


def test_an_empty_key_file_is_refused(tmp_path):
    assert "empty" in paid.key_problem(key_file(tmp_path, text="   "))


def test_a_link_or_a_folder_is_not_a_key_file(tmp_path):
    real = key_file(tmp_path)
    link = tmp_path / "link"
    os.symlink(real, link)
    assert "not a regular file" in paid.key_problem(link)
    assert "not a regular file" in paid.key_problem(tmp_path)


def test_the_default_key_file_is_the_one_in_the_config_folder():
    assert paid.KEY_FILE.parts[-3:] == (".config", "learnstation-parser-bench", "openai_key")


def test_redact_removes_the_key_and_anything_shaped_like_one():
    text = f"Incorrect API key provided: {KEY}. Also sk-proj-****abcd."
    out = paid.redact(text, KEY)
    assert "SECRET" not in out and "abcd" not in out and out.count("sk-…(redacted)") == 2


def test_every_recorded_price_names_when_and_where_it_was_read():
    assert "gpt-4.1-mini" in paid.PRICES
    for price in paid.PRICES.values():
        assert price.input_per_m > 0 and price.output_per_m > 0
        assert price.est_input_tokens > 0 and price.est_output_tokens > 0
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", price.checked_on) and price.source.startswith("http")


def test_a_model_without_a_price_or_an_id_is_refused():
    with pytest.raises(ValueError, match="no price recorded"):
        paid.price_of("gpt-unknown")
    with pytest.raises(ValueError, match="no model id"):
        paid.price_of("")


def test_the_estimate_and_its_worst_case(monkeypatch):
    monkeypatch.setattr(paid, "PRICES", {"gpt-test": paid.Price(1.0, 2.0, 1000, 500, "2026-10-31", "https://example.org")})
    e = paid.estimate("gpt-test", 10)
    assert (e.usd, e.max_usd) == (0.02, 0.3377)  # 10 × (1000·1 + 500·2)/1e6; 10 × (1000·1 + 16384·2)/1e6
    assert e.line("x") == "x: 10 page images to OpenAI (gpt-test), estimated $0.02, at most $0.34"
    assert paid.estimate("gpt-test", 1).line("x").startswith("x: 1 page image to")
    assert e.as_dict() == {"model": "gpt-test", "pages": 10, "usd": 0.02, "max_usd": 0.3377}


def test_the_benchmark_estimate_for_the_production_model():
    e = paid.estimate("gpt-4.1-mini", 24)
    assert (e.usd, e.max_usd) == (0.0634, 0.6541)


def test_dollars_are_shown_to_the_cent():
    assert (paid.usd(0.0634), paid.usd(0.004), paid.usd(0), paid.usd(1.005)) == ("$0.06", "<$0.01", "$0.00", "$1.00")


def test_the_cost_of_a_run_comes_from_the_usage_the_api_reported(monkeypatch):
    monkeypatch.setattr(paid, "PRICES", {"gpt-test": paid.Price(1.0, 2.0, 1000, 500, "2026-10-31", "https://example.org")})
    api = {"pages": {"1": {"prompt_tokens": 1000, "completion_tokens": 100, "cached_tokens": 0, "reasoning_tokens": 0},
                     "2": {"prompt_tokens": 2000, "completion_tokens": 300},
                     "3": {"attempts": [{"attempt": 1, "status": 500}]}}}  # a page that never got an answer is not billed
    c = paid.cost("gpt-test", api)
    assert (c["requests"], c["prompt_tokens"], c["completion_tokens"], c["usd"]) == (2, 3000, 400, 0.0038)
    assert c["price"]["checked_on"] == "2026-10-31" and "upper bound" in c["basis"]
    assert paid.cost("gpt-test", None) is None


def test_list_models_asks_openai_with_the_key_and_returns_sorted_ids(tmp_path):
    seen = []

    def opener(request, timeout):
        seen.append((request.full_url, request.get_header("Authorization"), timeout))
        return io.BytesIO(json.dumps({"data": [{"id": "gpt-b"}, {"id": "gpt-a"}, {"x": 1}]}).encode())

    assert paid.list_models(key_file=key_file(tmp_path), opener=opener) == ["gpt-a", "gpt-b"]
    assert seen == [("https://api.openai.com/v1/models", f"Bearer {KEY}", 30)]


def test_an_error_from_openai_never_shows_the_key(tmp_path):
    def opener(request, timeout):
        body = json.dumps({"error": {"message": f"Incorrect API key provided: {KEY}"}}).encode()
        raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, io.BytesIO(body))

    with pytest.raises(RuntimeError) as raised:
        paid.list_models(key_file=key_file(tmp_path), opener=opener)
    assert "401" in str(raised.value) and "SECRET" not in str(raised.value)
    assert raised.value.__cause__ is None and raised.value.__context__ is None  # the request (with its header) is not chained


def test_requests_go_straight_to_openai_whatever_the_proxy_settings(monkeypatch):
    built = []
    monkeypatch.setattr(urllib.request, "build_opener", lambda *handlers: built.append(handlers) or pytest.fail("stop"))
    with pytest.raises(BaseException):
        paid._direct_open(urllib.request.Request(paid.MODELS_URL), 1)
    [handlers] = built
    assert len(handlers) == 1 and isinstance(handlers[0], urllib.request.ProxyHandler) and handlers[0].proxies == {}
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_paid.py -q`
Expected: FAIL with `ImportError: cannot import name 'paid'`.

- [ ] **Step 3: Write `paid.py`**

Create `backend/eval/parser_bench/paid.py`:

```python
"""Paid methods (ai_vision, ai_vision_strong): the API key file, the price table, the cost estimate shown
before a run, the cost of a run from the API's own usage fields, and the account's live model list.

The key is read only from KEY_FILE, never from the environment or a .env file, and only when that file is a
regular file of this user with mode 0600. The key never leaves this module or the runner: it is never
printed, logged, stored in a run record or a job, or put in an error message (redact() takes it out, and
anything shaped like an OpenAI key with it).

Standard library only: the bench must not import the app, and the OpenAI SDK would read OPENAI_* variables
and proxies from the environment.
"""
from __future__ import annotations

import json
import os
import re
import stat
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

KEY_FILE = Path.home() / ".config" / "learnstation-parser-bench" / "openai_key"
API_HOST = "api.openai.com"
MODELS_URL = f"https://{API_HOST}/v1/models"
MODELS_TIMEOUT = 30
MAX_OUTPUT_TOKENS = 16384  # the runner's max_completion_tokens per page: the estimate's worst case
REDACTED = "sk-…(redacted)"
_SECRET = re.compile(r"sk-[A-Za-z0-9*_\-]{4,}")


class KeyFileError(RuntimeError):
    """The key file is missing, empty, not a regular file, someone else's, or readable by others."""


def _shown(path: Path) -> str:
    return str(path).replace(str(Path.home()), "~")


def key_problem(path: Path | None = None) -> str | None:
    """Why the key file cannot be used, or None when it can. The message names the path, never the key."""
    path = KEY_FILE if path is None else path
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return f"key file missing ({_shown(path)})"
    except OSError as e:
        return f"key file unreadable ({_shown(path)}: {type(e).__name__})"
    if not stat.S_ISREG(info.st_mode):
        return f"key file is not a regular file ({_shown(path)})"
    if info.st_uid != os.getuid():
        return f"key file belongs to another user ({_shown(path)})"
    mode = stat.S_IMODE(info.st_mode)
    if mode != 0o600:
        return f"key file must have mode 0600, not {mode:04o} ({_shown(path)})"
    try:
        empty = not path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError) as e:
        return f"key file unreadable ({_shown(path)}: {type(e).__name__})"
    return f"key file is empty ({_shown(path)})" if empty else None


def read_key(path: Path | None = None) -> str:
    path = KEY_FILE if path is None else path
    problem = key_problem(path)
    if problem:
        raise KeyFileError(problem)
    return path.read_text(encoding="utf-8").strip()


def redact(text: str, key: str | None = None) -> str:
    if key:
        text = text.replace(key, REDACTED)
    return _SECRET.sub(REDACTED, text)


@dataclass(frozen=True)
class Price:
    input_per_m: float       # USD per 1M input tokens (the page image and the prompt)
    output_per_m: float      # USD per 1M output tokens (a reasoning model's reasoning tokens bill as output)
    est_input_tokens: int    # estimate per page: the 2× page image plus the prompt
    est_output_tokens: int   # estimate per page: a transcription (plus reasoning, for a reasoning model)
    checked_on: str          # when the price was read from `source`
    source: str


# Standard tier, per 1M tokens. Set or re-checked in Plan 3a Task 16, with Abi, before any paid run.
PRICES: dict[str, Price] = {
    # gpt-4.1-mini reads a page image as at most 1,536 patches × 1.62 ≈ 2,490 tokens; the prompt adds ~40.
    "gpt-4.1-mini": Price(0.40, 1.60, 2_600, 1_000, "2025-04-14", "https://openai.com/index/gpt-4-1/"),
}


def price_of(model: str) -> Price:
    if not model:
        raise ValueError("no model id is set for this method (tools.py, set in the protocol step)")
    try:
        return PRICES[model]
    except KeyError:
        raise ValueError(f"no price recorded for {model!r}: add it to paid.PRICES with the date and source "
                         "it was read from") from None


def usd(value: float) -> str:
    """Dollars as the cost OK shows them: to the cent, and "<$0.01" for less than half a cent."""
    return "<$0.01" if 0 < value < 0.005 else f"${value:.2f}"


@dataclass(frozen=True)
class Estimate:
    model: str
    pages: int
    usd: float       # expected, from the price table's per-page token estimate
    max_usd: float   # if every page wrote MAX_OUTPUT_TOKENS

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    def line(self, tool_id: str) -> str:
        return (f"{tool_id}: {self.pages} page image{'' if self.pages == 1 else 's'} to OpenAI ({self.model}), "
                f"estimated {usd(self.usd)}, at most {usd(self.max_usd)}")


def estimate(model: str, pages: int) -> Estimate:
    price = price_of(model)
    fixed = price.est_input_tokens * price.input_per_m
    per_page = (fixed + price.est_output_tokens * price.output_per_m) / 1e6
    worst = (fixed + MAX_OUTPUT_TOKENS * price.output_per_m) / 1e6
    return Estimate(model, pages, round(pages * per_page, 4), round(pages * worst, 4))


def cost(model: str, api: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """What a run spent, from the usage the API reported for each answered page, at the recorded price."""
    if not api:
        return None
    price = price_of(model)
    answered = [p for p in (api.get("pages") or {}).values() if isinstance(p, dict) and p.get("prompt_tokens") is not None]

    def total(field: str) -> int:
        return sum(int(p.get(field) or 0) for p in answered)

    prompt, completion = total("prompt_tokens"), total("completion_tokens")
    return {
        "requests": len(answered),
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "cached_tokens": total("cached_tokens"),
        "reasoning_tokens": total("reasoning_tokens"),
        "usd": round((prompt * price.input_per_m + completion * price.output_per_m) / 1e6, 6),
        "price": {"model": model, **asdict(price)},
        "basis": ("the API's usage fields at the recorded price; cached input is counted at the full price, so this "
                  "is an upper bound; failed attempts are not billed; this is not the invoice"),
    }


def _direct_open(request: urllib.request.Request, timeout: float):
    """urllib without proxies: an empty ProxyHandler ignores HTTP(S)_PROXY and the system proxy settings."""
    return urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=timeout)


def list_models(*, key_file: Path | None = None,
                opener: Callable[[urllib.request.Request, float], Any] | None = None) -> list[str]:
    """The model ids this account can use right now (GET /v1/models; free). For choosing ai_vision_strong."""
    key = read_key(key_file)
    request = urllib.request.Request(MODELS_URL, headers={"Authorization": f"Bearer {key}"})
    open_ = opener or _direct_open
    try:
        with open_(request, MODELS_TIMEOUT) as answer:
            data = json.loads(answer.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", errors="replace")[:300]
        except OSError:
            body = ""
        message = f"listing models failed: HTTP {e.code} {redact(body, key)}"
    except (urllib.error.URLError, OSError, ValueError) as e:
        message = f"listing models failed: {type(e).__name__}: {redact(str(e), key)}"
    else:
        return sorted(m["id"] for m in data.get("data", []) if isinstance(m, dict) and isinstance(m.get("id"), str))
    raise RuntimeError(message)  # outside the except block: the HTTP error (and its request) is not chained
```

- [ ] **Step 4: Run the tests**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_paid.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/paid.py backend/tests/unit/test_parser_bench_paid.py
git commit -m "feat(parser-bench): paid.py — key file rule, price table, estimate, cost, live model list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The `ai_vision` runner

**Files:**
- Create: `backend/eval/parser_bench/runners/ai_vision_runner.py`
- Test: `backend/tests/unit/test_parser_bench_ai_vision.py`
- Modify: `backend/tests/unit/test_parser_bench_runners.py` (six runners now)

**Interfaces:**
- Consumes: the runner contract `out.json = {"version", "settings", "pages"}` (Plan 1), `paid.MAX_OUTPUT_TOKENS`, `paid.API_HOST` (pinned equal by a test).
- Produces:
  - Command line: `python -I ai_vision_runner.py <in.pdf> <out.json> --pages 2,5 --model <id> --temperature <number|default> --key-file <path>`.
  - `out.json` adds `"api": {"endpoint", "model_requested", "pages": {"<n>": {"model", "response_id", "system_fingerprint", "finish_reason", "prompt_tokens", "completion_tokens", "cached_tokens", "reasoning_tokens", "attempts": [...], "requested_at", "seconds"}}}` and, when a page failed, `"failed": "<redacted reason>"` with exit code 3.
  - `version` is the model id(s) the API answered with (`response.model`), joined with `+` if they differ.
  - Module names used by tests: `ENDPOINT`, `PROMPT`, `ZOOM`, `MAX_OUTPUT_TOKENS`, `BACKOFF`, `MAX_WAIT`, `MAX_ATTEMPTS`, `main(argv)`, `_open`, `redact`.

The runner runs in its own environment (`uv`, Python 3.12, `pymupdf==1.27.1`) and imports nothing from the bench, so it repeats the small key-file rule of `paid.py` (a test runs both on the same files).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_parser_bench_ai_vision.py`:

```python
"""The paid runner against a stand-in for urllib's opener: no socket, no network, no key. (The unit tests'
network guard in backend/tests/conftest.py refuses every socket, 127.0.0.1 included.)"""
import base64
import importlib.util
import io
import json
import urllib.error
import urllib.request
from pathlib import Path

import pytest

import backend.eval.parser_bench as bench_pkg
from backend.eval.parser_bench import paid
from backend.tests.unit.parser_bench_fixtures import make_deck

RUNNER = Path(bench_pkg.__file__).parent / "runners" / "ai_vision_runner.py"
KEY = "sk-test-SECRET-0123456789"


def _load():
    spec = importlib.util.spec_from_file_location("ai_vision_runner", RUNNER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeOpenAI:
    """Stands in for the runner's opener (`_open`): answers from a script of (status, body, headers), or
    "timeout" for a lost connection, and records every request. Nothing leaves the process."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.requests = []

    def __call__(self, request, timeout):
        self.requests.append({"url": request.full_url, "auth": request.get_header("Authorization"),
                              "timeout": timeout, "body": json.loads(request.data)})
        answer = self.answers.pop(0) if self.answers else (500, {"error": {"message": "no answer left"}}, {})
        if answer == "timeout":
            raise urllib.error.URLError(TimeoutError("timed out"))
        status, body, headers = answer
        data = io.BytesIO(json.dumps(body).encode())
        if status != 200:
            raise urllib.error.HTTPError(request.full_url, status, "error", headers, data)
        return data


def ok(text="# Heading\n\n- a point", model="gpt-test-2026-01-01", prompt=1200, completion=80, finish="stop"):
    return (200, {"id": "chatcmpl-1", "model": model, "system_fingerprint": "fp_1",
                  "choices": [{"message": {"role": "assistant", "content": text}, "finish_reason": finish}],
                  "usage": {"prompt_tokens": prompt, "completion_tokens": completion,
                            "prompt_tokens_details": {"cached_tokens": 0}, "completion_tokens_details": {"reasoning_tokens": 0}}}, {})


def error(status, code=None, param=None, message="boom", headers=None):
    return (status, {"error": {"message": message, "code": code, "param": param, "type": "x"}}, headers or {})


@pytest.fixture
def runner(monkeypatch):
    module = _load()
    monkeypatch.setattr(module, "BACKOFF", (0, 0, 0))
    monkeypatch.setattr(module, "MAX_WAIT", 0)
    return module


@pytest.fixture
def serve(runner, monkeypatch):
    def start(*answers):
        fake = FakeOpenAI(answers)
        monkeypatch.setattr(runner, "_open", fake)
        return fake

    return start


@pytest.fixture
def files(tmp_path):
    key = tmp_path / "openai_key"
    key.write_text(KEY + "\n")
    key.chmod(0o600)
    return make_deck(tmp_path / "deck.pdf"), tmp_path / "out.json", key


def argv(files, pages="2,5", temperature="0.0", model="gpt-test"):
    deck, out, key = files
    return ["runner", str(deck), str(out), "--pages", pages, "--model", model, "--temperature", temperature, "--key-file", str(key)]


def test_only_the_requested_pages_are_sent_one_request_each(runner, serve, files):
    fake = serve(ok("# Two"), ok("# Five"))
    runner.main(argv(files))
    data = json.loads(files[1].read_text(encoding="utf-8"))
    assert data["pages"] == {"2": "# Two", "5": "# Five"} and data["version"] == "gpt-test-2026-01-01"
    assert len(fake.requests) == 2 and all(r["auth"] == f"Bearer {KEY}" for r in fake.requests)
    assert {(r["url"], r["timeout"]) for r in fake.requests} == {("https://api.openai.com/v1/chat/completions", 120)}
    body = fake.requests[0]["body"]
    assert (body["model"], body["temperature"], body["max_completion_tokens"]) == ("gpt-test", 0.0, 16384)
    [text, image] = body["messages"][0]["content"]
    assert text == {"type": "text", "text": runner.PROMPT}
    png = base64.b64decode(image["image_url"]["url"].removeprefix("data:image/png;base64,"))
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and int.from_bytes(png[16:20], "big") == 842 * 2  # the page at 2×
    usage = data["api"]["pages"]["5"]
    assert (usage["prompt_tokens"], usage["completion_tokens"], usage["finish_reason"], usage["model"]) == (1200, 80, "stop", "gpt-test-2026-01-01")
    assert [a["status"] for a in usage["attempts"]] == [200] and usage["requested_at"].endswith("+00:00")
    assert data["settings"]["pages_sent"] == [2, 5] and data["settings"]["prompt"] == runner.PROMPT
    assert "failed" not in data


def test_transient_errors_are_retried_and_every_attempt_is_recorded(runner, serve, files):
    fake = serve(error(429, headers={"Retry-After": "0"}), error(503), ok())
    runner.main(argv(files, pages="3"))
    data = json.loads(files[1].read_text(encoding="utf-8"))
    attempts = data["api"]["pages"]["3"]["attempts"]
    assert [a["status"] for a in attempts] == [429, 503, 200] and len(fake.requests) == 3
    assert attempts[0]["wait_s"] == 0 and "HTTP 429" in attempts[0]["error"]


def test_a_lost_connection_is_retried(runner, serve, files):
    fake = serve("timeout", ok())
    runner.main(argv(files, pages="1"))
    attempts = json.loads(files[1].read_text(encoding="utf-8"))["api"]["pages"]["1"]["attempts"]
    assert [a["status"] for a in attempts] == [None, 200] and "URLError" in attempts[0]["error"] and len(fake.requests) == 2


def test_a_page_that_keeps_failing_fails_the_run_and_keeps_what_was_paid_for(runner, serve, files, capsys):
    serve(ok("# Two"), error(500), error(500), error(500), error(500))
    with pytest.raises(SystemExit) as raised:
        runner.main(argv(files))
    assert raised.value.code == 3
    data = json.loads(files[1].read_text(encoding="utf-8"))
    assert data["pages"] == {"2": "# Two"} and data["failed"].startswith("page 5: no answer after 4 attempts")
    assert data["api"]["pages"]["2"]["prompt_tokens"] == 1200
    assert [a["status"] for a in data["api"]["pages"]["5"]["attempts"]] == [500, 500, 500, 500]
    assert "page 5" in capsys.readouterr().err


def test_insufficient_quota_is_not_retried(runner, serve, files):
    fake = serve(error(429, code="insufficient_quota", message="You exceeded your current quota"))
    with pytest.raises(SystemExit):
        runner.main(argv(files, pages="1"))
    assert len(fake.requests) == 1


def test_a_rejected_temperature_is_reported_never_dropped(runner, serve, files):
    fake = serve(error(400, code="unsupported_value", param="temperature",
                       message="Unsupported value: 'temperature' does not support 0 with this model."))
    with pytest.raises(SystemExit):
        runner.main(argv(files, pages="1"))
    data = json.loads(files[1].read_text(encoding="utf-8"))
    assert "rejects temperature=0.0" in data["failed"] and len(fake.requests) == 1


def test_temperature_default_sends_none(runner, serve, files):
    fake = serve(ok())
    runner.main(argv(files, pages="1", temperature="default"))
    assert "temperature" not in fake.requests[0]["body"]
    assert json.loads(files[1].read_text(encoding="utf-8"))["settings"]["temperature"] == "model default"


def test_an_empty_answer_fails_the_run_with_its_usage(runner, serve, files):
    serve(ok(text="", finish="length", completion=16384))
    with pytest.raises(SystemExit):
        runner.main(argv(files, pages="1"))
    data = json.loads(files[1].read_text(encoding="utf-8"))
    assert data["pages"] == {} and "empty answer" in data["failed"] and data["api"]["pages"]["1"]["completion_tokens"] == 16384


def test_a_truncated_answer_is_kept_and_marked(runner, serve, files):
    serve(ok(text="# Long", finish="length"))
    runner.main(argv(files, pages="1"))
    data = json.loads(files[1].read_text(encoding="utf-8"))
    assert data["pages"] == {"1": "# Long"} and data["api"]["pages"]["1"]["finish_reason"] == "length"


def test_the_key_never_appears_in_output_log_or_errors(runner, serve, files, capsys):
    serve(error(401, code="invalid_api_key", message=f"Incorrect API key provided: {KEY}."))
    with pytest.raises(SystemExit):
        runner.main(argv(files, pages="1"))
    captured = capsys.readouterr()
    for text in (captured.out, captured.err, files[1].read_text(encoding="utf-8")):
        assert "SECRET" not in text


@pytest.mark.parametrize("mode, text, says", [(0o644, KEY, "0600"), (0o600, "  ", "empty")])
def test_the_key_file_must_be_private_and_not_empty(runner, files, mode, text, says):
    files[2].write_text(text)
    files[2].chmod(mode)
    with pytest.raises(SystemExit) as raised:
        runner.main(argv(files))
    assert says in str(raised.value.code) and "SECRET" not in str(raised.value.code)
    assert paid.key_problem(files[2]) is not None  # paid.py refuses the same file


def test_a_missing_key_file_or_a_page_outside_the_file_stops_before_any_request(runner, serve, files):
    fake = serve(ok())
    files[2].unlink()
    with pytest.raises(SystemExit, match="missing"):
        runner.main(argv(files))
    files[2].write_text(KEY)
    files[2].chmod(0o600)
    with pytest.raises(SystemExit, match="outside"):
        runner.main(argv(files, pages="9"))
    assert fake.requests == []


def test_the_endpoint_is_openai_and_proxies_are_ignored(monkeypatch):
    module = _load()
    assert module.ENDPOINT == f"https://{paid.API_HOST}/v1/chat/completions"
    assert module.MAX_OUTPUT_TOKENS == paid.MAX_OUTPUT_TOKENS and module.ZOOM == 2.0
    built = []
    monkeypatch.setattr(urllib.request, "build_opener", lambda *handlers: built.append(handlers) or pytest.fail("stop"))
    with pytest.raises(BaseException):
        module._open(urllib.request.Request(module.ENDPOINT), 1)
    [handlers] = built
    assert isinstance(handlers[0], urllib.request.ProxyHandler) and handlers[0].proxies == {}


def test_the_prompt_is_fixed():
    assert _load().PROMPT == ("Transcribe this page to Markdown. Add nothing: no introduction, no comment, "
                              "no code fence around the answer.")
```

In `backend/tests/unit/test_parser_bench_runners.py`, in `test_every_runner_has_usage_in_its_docstring` change `assert len(runners) == 5` to `assert len(runners) == 6`.

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_ai_vision.py backend/tests/unit/test_parser_bench_runners.py -q`
Expected: FAIL (`FileNotFoundError` for the runner; 5 runners instead of 6).

- [ ] **Step 3: Write the runner**

Create `backend/eval/parser_bench/runners/ai_vision_runner.py`:

```python
"""`ai_vision`, `ai_vision_strong`: each requested page rendered at 2× (PNG) and sent to the OpenAI chat
completions endpoint with one fixed prompt, one request per page.

Only the pages named by --pages are rendered and sent. The key is read from --key-file, which must be a
regular file of this user with mode 0600; it is never printed, and every message this runner writes has the
key, and anything shaped like an OpenAI key, taken out. The network goes to api.openai.com only: the endpoint
is fixed here, and proxies from the environment are ignored.

Transient failures (HTTP 429 except insufficient_quota, 500, 502, 503, 504, a timeout or a lost connection)
are retried, MAX_ATTEMPTS in all, waiting Retry-After (at most MAX_WAIT) or BACKOFF; every attempt is
recorded. A page that still fails, or comes back empty, fails the run: the runner writes what it has (the
pages done, the usage of every page, and "failed") and exits 3, so the cost stays on record. A truncated
answer (finish_reason "length") is kept; its usage record says so.

Usage: python -I ai_vision_runner.py <in.pdf> <out.json> --pages 2,5 --model <id> --temperature <number|default> --key-file <path>
"""
import argparse
import base64
import http.client
import json
import os
import re
import stat
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from importlib.metadata import version

ENDPOINT = "https://api.openai.com/v1/chat/completions"
PROMPT = ("Transcribe this page to Markdown. Add nothing: no introduction, no comment, "
          "no code fence around the answer.")
ZOOM = 2.0
MAX_OUTPUT_TOKENS = 16384
TIMEOUT = 120          # seconds per request
MAX_ATTEMPTS = 4       # per page: the first try and three retries
BACKOFF = (2, 4, 8)    # seconds before retry 1, 2, 3 when the answer names no Retry-After
MAX_WAIT = 30          # a longer Retry-After is cut to this
RETRY_STATUS = frozenset({429, 500, 502, 503, 504})
REDACTED = "sk-…(redacted)"
_SECRET = re.compile(r"sk-[A-Za-z0-9*_\-]{4,}")


class PageFailed(Exception):
    """A page that got no usable answer. The message is already redacted; `attempts` says what was tried."""

    def __init__(self, message, attempts):
        super().__init__(message)
        self.attempts = attempts


def redact(text, key):
    if key:
        text = text.replace(key, REDACTED)
    return _SECRET.sub(REDACTED, text)


def read_key(path):
    """The key from a regular file of this user with mode 0600; SystemExit, without the key, otherwise."""
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        raise SystemExit("ai_vision_runner: the key file is missing") from None
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
        raise SystemExit("ai_vision_runner: the key file must be a regular file of this user with mode 0600")
    with open(path, encoding="utf-8") as f:
        key = f.read().strip()
    if not key:
        raise SystemExit("ai_vision_runner: the key file is empty")
    return key


def render(pdf, pages):
    """Each requested page as a PNG at ZOOM; no other page is rendered."""
    import pymupdf

    images = {}
    with pymupdf.open(pdf) as doc:
        for n in pages:
            if not 1 <= n <= doc.page_count:
                raise SystemExit(f"ai_vision_runner: page {n} is outside 1–{doc.page_count}")
            images[n] = doc[n - 1].get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM)).tobytes("png")
    return images


def request_body(model, temperature, png):
    body = {
        "model": model,
        "max_completion_tokens": MAX_OUTPUT_TOKENS,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode("ascii")}},
        ]}],
    }
    if temperature is not None:
        body["temperature"] = temperature
    return body


def _open(request, timeout):
    """Straight to the endpoint: an empty ProxyHandler ignores HTTP(S)_PROXY and the system proxy settings."""
    return urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=timeout)


def _error(e):
    """(OpenAI's error code, the parameter it names, one line of text) from an HTTP error."""
    try:
        raw = e.read().decode("utf-8", errors="replace")
    except OSError:
        raw = ""
    try:
        err = json.loads(raw).get("error") or {}
    except (ValueError, AttributeError):
        err = {}
    if not isinstance(err, dict):
        err = {}
    code = err.get("code")
    message = err.get("message") or raw[:200] or str(e.reason)
    return code, err.get("param"), f"HTTP {e.code}" + (f" {code}" if code else "") + f": {message}"


def _backoff(attempt):
    return min(BACKOFF[min(attempt - 1, len(BACKOFF) - 1)], MAX_WAIT)


def _wait(e, attempt):
    after = e.headers.get("Retry-After") if e.headers is not None else None
    try:
        return min(float(after), MAX_WAIT)
    except (TypeError, ValueError):
        return _backoff(attempt)


def post(body, key, *, opener=None, sleep=time.sleep):
    """One page's request with bounded retries: (the answer, every attempt). PageFailed when none succeeds."""
    opener = opener or _open
    data = json.dumps(body).encode("utf-8")
    attempts = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        record = {"attempt": attempt, "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        request = urllib.request.Request(ENDPOINT, data=data, method="POST",
                                         headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        start = time.monotonic()
        try:
            with opener(request, TIMEOUT) as answer:
                payload = json.loads(answer.read().decode("utf-8"))
            record.update(status=200, seconds=round(time.monotonic() - start, 2))
            attempts.append(record)
            return payload, attempts
        except urllib.error.HTTPError as e:
            code, param, text = _error(e)
            record.update(status=e.code, error=redact(text, key), seconds=round(time.monotonic() - start, 2))
            attempts.append(record)
            if e.code == 400 and param == "temperature":
                raise PageFailed(f"the model rejects temperature={body.get('temperature')!r} ({record['error']})", attempts) from None
            retry, wait = e.code in RETRY_STATUS and code != "insufficient_quota", _wait(e, attempt)
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException) as e:
            reason = getattr(e, "reason", e)
            record.update(status=None, error=redact(f"{type(e).__name__}: {reason}", key),
                          seconds=round(time.monotonic() - start, 2))
            attempts.append(record)
            retry, wait = True, _backoff(attempt)
        except ValueError as e:  # a 200 whose body is not JSON
            record.update(status=200, error=f"unreadable answer ({type(e).__name__})", seconds=round(time.monotonic() - start, 2))
            attempts.append(record)
            raise PageFailed("the answer was not JSON", attempts) from None
        if not retry:
            raise PageFailed(attempts[-1]["error"], attempts)
        if attempt < MAX_ATTEMPTS:
            record["wait_s"] = wait
            sleep(wait)
    raise PageFailed(f"no answer after {MAX_ATTEMPTS} attempts (last: {attempts[-1]['error']})", attempts)


def usage_of(answer):
    usage = answer.get("usage") or {}
    choice = (answer.get("choices") or [{}])[0] or {}
    return {
        "model": answer.get("model"),
        "response_id": answer.get("id"),
        "system_fingerprint": answer.get("system_fingerprint"),
        "finish_reason": choice.get("finish_reason"),
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "cached_tokens": (usage.get("prompt_tokens_details") or {}).get("cached_tokens"),
        "reasoning_tokens": (usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
    }


def content_of(answer):
    """The answer's text, or None when it is empty (a refusal, or every token spent before any text)."""
    choice = (answer.get("choices") or [{}])[0] or {}
    content = (choice.get("message") or {}).get("content")
    return content if isinstance(content, str) and content.strip() else None


def parse(argv):
    parser = argparse.ArgumentParser(prog="ai_vision_runner")
    parser.add_argument("pdf")
    parser.add_argument("out")
    parser.add_argument("--pages", required=True, type=lambda s: sorted({int(x) for x in s.split(",") if x.strip()}))
    parser.add_argument("--model", required=True)
    parser.add_argument("--temperature", required=True, help='a number, or "default" to leave it to the model')
    parser.add_argument("--key-file", required=True)
    args = parser.parse_args(argv)
    if not args.model.strip():
        parser.error("--model is empty")
    if not args.pages:
        parser.error("--pages names no page")
    args.temperature = None if args.temperature == "default" else float(args.temperature)
    return args


def settings(args):
    return {
        "model": args.model,
        "prompt": PROMPT,
        "zoom": ZOOM,
        "image": "PNG as a data URL; detail not set (the API default)",
        "temperature": "model default" if args.temperature is None else args.temperature,
        "max_completion_tokens": MAX_OUTPUT_TOKENS,
        "one_request_per_page": True,
        "pages_sent": args.pages,
        "timeout_s": TIMEOUT,
        "max_attempts": MAX_ATTEMPTS,
        "retry_on": sorted(RETRY_STATUS),
        "endpoint": ENDPOINT,
        "renderer": f"pymupdf {version('pymupdf')}",
        "http": "urllib (Python standard library), proxies ignored",
    }


def main(argv):
    args = parse(argv[1:])
    key = read_key(args.key_file)
    images = render(args.pdf, args.pages)
    pages, usage, failure = {}, {}, None
    for n in args.pages:
        start = time.monotonic()
        try:
            answer, attempts = post(request_body(args.model, args.temperature, images[n]), key)
        except PageFailed as e:
            usage[str(n)] = {"attempts": e.attempts, "seconds": round(time.monotonic() - start, 2)}
            failure = f"page {n}: {e}"
            break
        record = dict(usage_of(answer), attempts=attempts, requested_at=attempts[0]["at"],
                      seconds=round(time.monotonic() - start, 2))
        usage[str(n)] = record
        print(f"page {n}: {record['prompt_tokens']} in / {record['completion_tokens']} out tokens, {record['model']}, "
              f"finish {record['finish_reason']}, {len(attempts)} attempt(s), {record['seconds']} s", flush=True)
        text = content_of(answer)
        if text is None:
            failure = f"page {n}: empty answer (finish_reason {record['finish_reason']!r})"
            break
        pages[str(n)] = text
    models = sorted({r["model"] for r in usage.values() if r.get("model")})
    result = {"version": "+".join(models) or "unknown", "settings": settings(args), "pages": pages,
              "api": {"endpoint": ENDPOINT, "model_requested": args.model, "pages": usage}}
    if failure:
        result["failed"] = redact(failure, key)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    if failure:
        print(f"ai_vision_runner: {result['failed']}", file=sys.stderr, flush=True)
        raise SystemExit(3)


if __name__ == "__main__":
    main(sys.argv)
```

- [ ] **Step 4: Run the tests**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_ai_vision.py backend/tests/unit/test_parser_bench_runners.py -q`
Expected: all pass. No socket is opened: the fake replaces the runner's opener, and the conftest network guard would fail any test that tried.

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/runners/ai_vision_runner.py backend/tests/unit/test_parser_bench_ai_vision.py \
  backend/tests/unit/test_parser_bench_runners.py
git commit -m "feat(parser-bench): ai_vision runner — requested pages at 2x, one request each, bounded retries, usage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Register the paid methods (`tools.py`)

**Files:**
- Modify: `backend/eval/parser_bench/tools.py`
- Modify: `backend/tests/unit/test_parser_bench_tools.py`

**Interfaces:**
- Consumes: `paid.key_problem()`, `paid.KEY_FILE` (Task 6); the runner's command line (Task 7).
- Produces:
  - `Tool.paid: bool = False`, `Tool.model: str = ""`, `Tool.temperature: float | None = 0.0`.
  - `tools.AI_VISION_MODEL = "gpt-4.1-mini"`, `tools.AI_VISION_STRONG_MODEL = ""` (set by Task 16).
  - `TOOLS["ai_vision"]`, `TOOLS["ai_vision_strong"]` (group `"paid"`, runner `ai_vision_runner.py`, requirements `("pymupdf==1.27.1",)`, `import_name="pymupdf"`).
  - `tools.needs_install(tool) -> bool`.
  - `tools.missing(tool)` adds, for a paid method, "its model id (…)" when the id is empty and the key file's problem when there is one.
  - `tools.paid_args(tool, pages) -> list[str]`: `["--pages", "2,5", "--model", m, "--temperature", "0.0" | "default", "--key-file", str(paid.KEY_FILE)]`, `[]` for a free method; `ToolNotReady` for an empty model id.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_parser_bench_tools.py`, add `from backend.eval.parser_bench import paid` to the imports, replace `test_the_five_fast_methods_are_registered` with:

```python
def test_the_methods_are_registered():
    fast = ["current", "pymupdf4llm", "pdfjs", "markitdown", "opendataloader"]
    assert list(tools.TOOLS) == [*fast, "ai_vision", "ai_vision_strong"]
    assert [t.id for t in tools.TOOLS.values() if t.group == "fast"] == fast
    assert [t.id for t in tools.TOOLS.values() if t.paid] == ["ai_vision", "ai_vision_strong"]
```

and add:

```python
def test_ai_vision_is_the_production_vision_model():
    tool = tools.TOOLS["ai_vision"]
    assert (tool.group, tool.model, tool.temperature) == ("paid", "gpt-4.1-mini", 0.0)
    assert tool.runner_path.name == "ai_vision_runner.py" and tool.requirements == ("pymupdf==1.27.1",)
    assert tools.TOOLS["ai_vision_strong"].model == tools.AI_VISION_STRONG_MODEL


def _paid_tool(model="gpt-test", temperature=0.0):
    return tools.Tool("p", "p", "paid", "ai_vision_runner.py", "test", paid=True, model=model, temperature=temperature)


def _private_key(folder):
    key = folder / "openai_key"
    key.write_text("sk-test-0123\n")
    key.chmod(0o600)
    return key


def test_a_paid_method_without_a_model_id_is_not_ready_and_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(paid, "KEY_FILE", _private_key(tmp_path))
    tool = _paid_tool(model="")
    assert any("model id" in gap for gap in tools.missing(tool))
    with pytest.raises(tools.ToolNotReady, match="model id"):
        tools.paid_args(tool, [1])
    assert tools.is_ready(_paid_tool())


def test_a_paid_method_without_the_key_file_is_not_ready(tmp_path, monkeypatch):
    monkeypatch.setattr(paid, "KEY_FILE", tmp_path / "absent")
    assert any(gap.startswith("key file missing") for gap in tools.missing(_paid_tool()))
    assert not tools.needs_install(_paid_tool())


def test_paid_args_name_the_pages_model_temperature_and_the_key_path(tmp_path, monkeypatch):
    monkeypatch.setattr(paid, "KEY_FILE", tmp_path / "openai_key")
    assert tools.paid_args(_paid_tool(), [5, 2, 5]) == [
        "--pages", "2,5", "--model", "gpt-test", "--temperature", "0.0", "--key-file", str(tmp_path / "openai_key")]
    assert tools.paid_args(_paid_tool(temperature=None), [1])[5] == "default"
    assert tools.paid_args(tools.TOOLS["current"], [1]) == []
    with pytest.raises(ValueError, match="pages"):
        tools.paid_args(_paid_tool(), [])
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_tools.py -q`
Expected: FAIL (`Tool` has no `paid`; two methods missing).

- [ ] **Step 3: Implement**

In `backend/eval/parser_bench/tools.py`:

Add `from typing import Sequence` to the imports and `from backend.eval.parser_bench import paid` after the `store` import. Extend the module docstring with: `The paid methods (ai_vision, ai_vision_strong) run in their own environment too; they need the key file (paid.py) and a model id.`

Add these fields at the end of `Tool` (after `ocr`):

```python
    paid: bool = False                   # sends page images to a paid API: key file, model id, a cost OK per run
    model: str = ""                      # paid methods: the API model id (PROTOCOL.md deviation 2)
    temperature: float | None = 0.0      # paid methods: None = the model's default, only when it rejects 0 (recorded)
```

Above `TOOLS`, add:

```python
# Production's vision model: OPENAI_VISION_MODEL defaults to OPENAI_MODEL, whose launch setting is gpt-4.1-mini
# (.env.example; backend/services/ai/orchestrator.py). Taken from there, not from the production environment.
AI_VISION_MODEL = "gpt-4.1-mini"
# One current stronger OpenAI vision model, chosen with Abi from the account's live model list (Plan 3a Task 16).
# Empty until then: the method is not ready and paid_args() refuses it.
AI_VISION_STRONG_MODEL = ""
```

Add two entries at the end of the `TOOLS` tuple:

```python
    Tool("ai_vision", "AI vision", "paid", "ai_vision_runner.py",
         "the OpenAI model our pipeline uses, reading each page as a 2× image", requirements=("pymupdf==1.27.1",),
         size_mb=60, import_name="pymupdf", paid=True, model=AI_VISION_MODEL),
    Tool("ai_vision_strong", "AI vision, stronger model", "paid", "ai_vision_runner.py",
         "a current stronger OpenAI model, same prompt and image", requirements=("pymupdf==1.27.1",),
         size_mb=60, import_name="pymupdf", paid=True, model=AI_VISION_STRONG_MODEL),
```

Replace `missing` with:

```python
def needs_install(tool: Tool) -> bool:
    """The method has requirements and its environment is not (completely) installed."""
    return bool(tool.requirements) and not (marker(tool).exists() and env_python(tool).exists())


def missing(tool: Tool) -> list[str]:
    gaps = [program for program in tool.needs if shutil.which(program) is None]
    if tool.kind == "node" and not pdfjs_package().exists():
        gaps.append("node_modules/pdfjs-dist (run npm install)")
    if needs_install(tool):
        gaps.append(f"its environment (python -m backend.eval.parser_bench install {tool.id})")
    if tool.paid:
        if not tool.model.strip():
            gaps.append("its model id (tools.py, set in the protocol step)")
        problem = paid.key_problem()
        if problem:
            gaps.append(problem)
    return gaps
```

Add after `command`:

```python
def paid_args(tool: Tool, pages: Sequence[int]) -> list[str]:
    """The paid runner's arguments after <in.pdf> <out.json>: the pages to send, the model, the temperature and
    the key file's path (the path, never the key). Empty for a method that costs nothing."""
    if not tool.paid:
        return []
    if not tool.model.strip():
        raise ToolNotReady(f"{tool.id} has no model id; set it in tools.py (protocol step)")
    if not pages:
        raise ValueError("a paid method needs the pages to send")
    temperature = "default" if tool.temperature is None else repr(float(tool.temperature))
    return ["--pages", ",".join(str(p) for p in sorted(set(pages))), "--model", tool.model,
            "--temperature", temperature, "--key-file", str(paid.KEY_FILE)]
```

- [ ] **Step 4: Run the tools, CLI and server tests**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_tools.py backend/tests/unit/test_parser_bench_cli.py backend/tests/unit/test_parser_bench_server.py -q`
Expected: all pass (`tools` now lists seven methods; the paid ones say what they need).

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/tools.py backend/tests/unit/test_parser_bench_tools.py
git commit -m "feat(parser-bench): register ai_vision and ai_vision_strong; model id as one constant

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Paid runs in `execute.py`

**Files:**
- Modify: `backend/eval/parser_bench/execute.py` (`RunnerError`, `Invocation`, `invoke`, `planned_pages`, `run_tool`, `_run_in_slot`)
- Modify: `backend/tests/unit/test_parser_bench_execute.py`

**Interfaces:**
- Consumes: `tools.paid_args`, `Tool.paid/model` (Task 8); `paid.price_of`, `paid.cost` (Task 6); `benchmark_gate()` (Task 4).
- Produces:
  - `invoke(tool, pdf, *, args: Sequence[str] = (), timeout=..., cancel=None) -> Invocation`; `Invocation.api: dict | None = None`; `RunnerError(..., api: dict | None = None)`; a failed runner's `out.json` (`"failed"`, `"api"`) is read into the error.
  - `execute.planned_pages(pdf, pages, purpose) -> list[int]`.
  - `execute.WARMUP_SKIPPED: str`.
  - `run_tool(..., cost_ok: bool = False)`: a paid method without `cost_ok=True` raises `ValueError` before anything else; a paid method without a recorded price raises `ValueError`; a paid method never warms up (also as a benchmark run); it is sent exactly the scored pages; its run fails when one of *those* pages is missing.
  - A paid run's `run.json` adds `warmup_skipped`, `pages_sent`, `api_usage`, `cost` and `seconds_per_page_basis: "pages sent"`; `seconds_per_page` = seconds over pages sent. A failed paid run keeps `api_usage` and `cost` too.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_parser_bench_execute.py`, add `from backend.eval.parser_bench import paid` to the imports, and add:

```python
FAKE_PAID = r'''
import json, sys
args = sys.argv[3:]
pages = [int(p) for p in args[args.index("--pages") + 1].split(",")]
print("argv", " ".join(args))
usage = {str(p): {"model": "gpt-test-2026", "prompt_tokens": 1000, "completion_tokens": 100,
                  "attempts": [{"attempt": 1, "status": 200}]} for p in pages}
json.dump({"version": "gpt-test-2026", "settings": {"model": args[args.index("--model") + 1]},
           "pages": {str(p): "# page %d" % p for p in pages}, "api": {"pages": usage}}, open(sys.argv[2], "w"))
'''
FAKE_PAID_FAIL = r'''
import json, sys
args = sys.argv[3:]
first = int(args[args.index("--pages") + 1].split(",")[0])
usage = {str(first): {"model": "gpt-test-2026", "prompt_tokens": 1000, "completion_tokens": 100,
                      "attempts": [{"attempt": 1, "status": 200}]}}
json.dump({"version": "gpt-test-2026", "settings": {}, "pages": {str(first): "# one"}, "api": {"pages": usage},
           "failed": "page 5: no answer after 4 attempts"}, open(sys.argv[2], "w"))
sys.exit(3)
'''


def paid_registry(tmp_path, body, model="gpt-test"):
    script = tmp_path / "paidfake.py"
    script.write_text(body)
    return {"paidfake": Tool("paidfake", "paidfake", "paid", str(script), "test double", paid=True, model=model)}


@pytest.fixture
def paid_ready(tmp_path, monkeypatch):
    key = tmp_path / "openai_key"
    key.write_text("sk-test-SECRET-0123456789\n")
    key.chmod(0o600)
    monkeypatch.setattr(paid, "KEY_FILE", key)
    monkeypatch.setattr(paid, "PRICES", {"gpt-test": paid.Price(1.0, 2.0, 1000, 500, "2026-10-31", "https://example.org")})
    return key


def test_a_paid_method_needs_a_cost_ok(tmp_path, deck):
    with pytest.raises(ValueError, match="cost OK"):
        execute.run_tool("paidfake", deck, root=tmp_path / "data", registry=paid_registry(tmp_path, FAKE_PAID))
    assert not (tmp_path / "data").exists()


def test_a_paid_method_without_a_recorded_price_is_refused_before_it_runs(tmp_path, deck, paid_ready):
    with pytest.raises(ValueError, match="no price recorded"):
        execute.run_tool("paidfake", deck, cost_ok=True, root=tmp_path / "data",
                         registry=paid_registry(tmp_path, FAKE_PAID, model="gpt-other"))


def test_a_paid_run_sends_only_the_scored_pages_and_records_usage_and_cost(tmp_path, deck, paid_ready):
    run = execute.run_tool("paidfake", deck, pages=[5, 2], cost_ok=True, root=tmp_path / "data",
                           registry=paid_registry(tmp_path, FAKE_PAID))
    m = run.meta
    assert (m["status"], m["version"], m["pages_scored"], m["pages_sent"], m["missing_pages"]) == ("finished", "gpt-test-2026", [2, 5], [2, 5], [])
    assert m["warmup_seconds"] is None and "paid API" in m["warmup_skipped"]
    assert m["seconds_per_page_basis"] == "pages sent" and abs(m["seconds_per_page"] * 2 - m["seconds_total"]) < 0.02
    assert set(m["api_usage"]["pages"]) == {"2", "5"}
    assert (m["cost"]["requests"], m["cost"]["usd"]) == (2, 0.0024)  # 2 × (1000·1 + 100·2)/1e6
    log = (run.path / "log.txt").read_text()
    assert f"--key-file {paid_ready}" in log and "SECRET" not in log and "SECRET" not in (run.path / "run.json").read_text()


def test_a_paid_benchmark_run_skips_the_warm_up(tmp_path, deck, paid_ready, bench_ready, monkeypatch):
    calls = []
    real = execute.invoke
    monkeypatch.setattr(execute, "invoke", lambda *a, **k: calls.append(a[1]) or real(*a, **k))
    run = execute.run_tool("paidfake", deck, purpose="benchmark", cost_ok=True, root=tmp_path / "data",
                           registry=paid_registry(tmp_path, FAKE_PAID))
    assert run.meta["status"] == "finished" and run.meta["pages_sent"] == [2, 5] and len(calls) == 1
    assert run.meta["bench_tree"] == "tree0"


def test_a_failed_paid_run_keeps_its_usage_and_cost(tmp_path, deck, paid_ready):
    run = execute.run_tool("paidfake", deck, pages=[1, 5], cost_ok=True, root=tmp_path / "data",
                           registry=paid_registry(tmp_path, FAKE_PAID_FAIL))
    m = run.meta
    assert m["status"] == "failed" and m["failed_stage"] == "timed"
    assert m["reason"] == "paidfake exited with code 3: page 5: no answer after 4 attempts"
    assert m["cost"]["usd"] == 0.0012 and set(m["api_usage"]["pages"]) == {"1"}


def test_planned_pages_are_the_pages_a_run_would_score(tmp_path, deck, monkeypatch):
    assert execute.planned_pages(deck, None, "explore") == [1, 2, 3, 4, 5, 6]
    assert execute.planned_pages(deck, [4, 2, 4], "explore") == [2, 4]
    monkeypatch.setattr(execute, "benchmark_pages", lambda sha: [2, 5])
    assert execute.planned_pages(deck, None, "benchmark") == [2, 5]
    monkeypatch.setattr(execute, "benchmark_pages", lambda sha: [])
    with pytest.raises(ValueError, match="not in the benchmark page set"):
        execute.planned_pages(deck, None, "benchmark")
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_execute.py -q -k "paid or planned"`
Expected: FAIL (`run_tool() got an unexpected keyword argument 'cost_ok'`; no `planned_pages`).

- [ ] **Step 3: Implement**

In `backend/eval/parser_bench/execute.py`:

Change the imports to

```python
from backend.eval.parser_bench import checks, pageset, paid, store
from backend.eval.parser_bench.normalize import normalize_figures
from backend.eval.parser_bench.sources import page_count, sha256_file, two_page_sample
from backend.eval.parser_bench.tools import TOOLS, Tool, ToolNotReady, command, environment, missing, paid_args
```

add `"planned_pages"` to `__all__`, and add below `KILL_SWEEPS`:

```python
WARMUP_SKIPPED = ("skipped: a paid API downloads no local model, and a warm-up would send two more page images "
                  "and pay for them (PROTOCOL.md deviation 2)")
```

Extend the module docstring with a paragraph:

```
A paid method (ai_vision) needs an explicit cost OK for every run, is sent only the pages the run scores,
never warms up, and its seconds per page are over the pages sent. Its run records the API's usage per page
and the cost at the recorded price, also when it fails.
```

Replace `RunnerError` and `Invocation` with:

```python
class RunnerError(RuntimeError):
    """The runner failed. `output` is True when it ran to its end but left unusable output; `seconds` is then
    how long it ran. `api` is what a paid runner reported it was charged for before it failed."""

    def __init__(self, message: str, log: str = "", *, output: bool = False, seconds: float | None = None,
                 api: dict | None = None):
        super().__init__(message)
        self.log = log
        self.output = output
        self.seconds = seconds
        self.api = api


@dataclass
class Invocation:
    pages: dict[int, str]
    version: str
    settings: dict
    seconds: float
    peak_mb: float | None  # None: the run ended before any sample saw memory in use
    log: str
    api: dict | None = None  # a paid runner's usage per page
```

Add above `invoke`:

```python
def _api_of(data: object) -> dict | None:
    api = data.get("api") if isinstance(data, dict) else None
    return api if isinstance(api, dict) else None


def _partial(out: Path) -> dict:
    """What a runner that exited non-zero left behind: a paid runner writes the pages it was charged for
    ("api") and why it stopped ("failed") before it exits 3."""
    try:
        data = json.loads(out.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {"failed": data["failed"] if isinstance(data.get("failed"), str) else None, "api": _api_of(data)}
```

In `invoke`, change the signature to

```python
def invoke(tool: Tool, pdf: Path, *, args: Sequence[str] = (), timeout: float = DEFAULT_TIMEOUT,
           cancel: threading.Event | None = None) -> Invocation:
```

change the spawned command to `[*command(tool), str(pdf), str(out), *args]`, replace

```python
        if proc.returncode != 0:
            raise RunnerError(f"{tool.id} exited with code {proc.returncode}", text)
```

with

```python
        if proc.returncode != 0:
            partial = _partial(out)
            detail = f": {partial['failed']}" if partial.get("failed") else ""
            raise RunnerError(f"{tool.id} exited with code {proc.returncode}{detail}", text, api=partial.get("api"))
```

and the final return with

```python
    return Invocation(pages, version, settings, seconds, round(peak / 2**20, 1) if peak else None, text, api=_api_of(data))
```

Add after `benchmark_pages`:

```python
def planned_pages(pdf: Path, pages: Sequence[int] | None, purpose: str) -> list[int]:
    """The pages a run of this file would score, which are the pages a paid method sends: the page set's
    pages of the file for a benchmark run, else the pages asked for, else every page."""
    pdf = Path(pdf).resolve()
    if purpose == "benchmark":
        chosen = benchmark_pages(sha256_file(pdf))
        if not chosen:
            raise ValueError(f"{pdf.name} is not in the benchmark page set; run it as explore")
        return chosen
    return sorted(set(pages)) if pages else list(range(1, page_count(pdf) + 1))


def _paid_fields(tool: Tool, api: dict | None, wanted: list[int]) -> dict:
    """What a paid run adds to its record: the pages sent, the usage per page and the cost."""
    if not tool.paid:
        return {}
    return {"pages_sent": wanted, "api_usage": api, "cost": paid.cost(tool.model, api),
            "seconds_per_page_basis": "pages sent"}
```

In `run_tool`, add `cost_ok: bool = False,` as the last keyword parameter, add to its docstring `A paid method needs cost_ok=True for every run (spec: an explicit OK each run).`, and replace

```python
    tool = registry[tool_id]
    gaps = missing(tool)
    if gaps:
        raise ToolNotReady(f"{tool_id} is not ready: {'; '.join(gaps)}")
    extra: dict = {}
    if purpose == "benchmark":
        extra.update(benchmark_gate())  # fast refusal; checked again once the slot is held
        if not warmup:
            raise ValueError("benchmark runs always warm up, so a first-time model download is never timed")
```

with

```python
    tool = registry[tool_id]
    if tool.paid and not cost_ok:
        raise ValueError(f"{tool_id} sends page images to OpenAI and costs money; it needs an explicit cost OK for this run")
    gaps = missing(tool)
    if gaps:
        raise ToolNotReady(f"{tool_id} is not ready: {'; '.join(gaps)}")
    extra: dict = {}
    if tool.paid:
        paid.price_of(tool.model)  # a model without a recorded price is refused before anything is sent
        warmup = False             # deviation 2: nothing to download, and a warm-up would send and pay for two more pages
        extra["warmup_skipped"] = WARMUP_SKIPPED
    if purpose == "benchmark":
        extra.update(benchmark_gate())  # fast refusal; checked again once the slot is held
        if not warmup and not tool.paid:
            raise ValueError("benchmark runs always warm up, so a first-time model download is never timed")
```

After `source = {...}` add

```python
    args = paid_args(tool, wanted)  # the pages a paid method is sent; empty for every other method
```

and pass it on: `return _run_in_slot(tool, tool_id, pdf, wanted, total, source, facts, purpose, extra, root, warmup, timeout, cancel, stage, args)`.

In `_run_in_slot`, add the parameter `args: list[str]` after `stage`, and replace the body from `version, warm_seconds, step = "unknown", None, "warmup"` to the end with:

```python
    version, warm_seconds, step = "unknown", None, "warmup"
    per_page = len(wanted) if tool.paid else total  # a paid method's time is over the pages it was sent
    try:
        if warmup:
            stage("warmup")
            with tempfile.TemporaryDirectory() as tmp:
                warm = invoke(tool, two_page_sample(pdf, Path(tmp) / "warmup.pdf"), timeout=timeout, cancel=cancel)
            version, warm_seconds = warm.version, round(warm.seconds, 2)
        step = "timed"
        stage("timed")
        result = invoke(tool, pdf, args=args, timeout=timeout, cancel=cancel)
    except RunnerError as e:
        if step == "timed" and e.output:
            step = "output"  # the timed run ran to its end, so its time is known
        fields = {"pages_scored": wanted, "timeout_s": timeout, "warmup_seconds": warm_seconds,
                  **_timing(e.seconds if step == "output" else None, per_page), **_paid_fields(tool, e.api, wanted)}
        run = store.ExtractRun.create(tool=tool_id, version=version, **record)
        with _seal_on_error(run, tool, fields):
            run.append_log(e.log)
            run.finish("failed", reason=str(e), failed_stage=step, environment=_environment(tool), **fields)
        return run

    stage("scoring")
    # A tool that leaves out any page it was given has not extracted the file: the run is kept, with the pages
    # it did produce, but it is failed (ruling R1). A paid method is given only the pages it scores.
    expected = wanted if tool.paid else list(range(1, total + 1))
    absent = [p for p in expected if p not in result.pages]
    fields = {"pages_scored": wanted, "missing_pages": absent, "timeout_s": timeout, "warmup_seconds": warm_seconds,
              **_timing(result.seconds, per_page), "peak_memory_mb": result.peak_mb,
              **_paid_fields(tool, result.api, wanted)}
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

- [ ] **Step 4: Run every execute test**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_execute.py backend/tests/unit/test_parser_bench_jobs.py -q`
Expected: all pass (the free methods' tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/execute.py backend/tests/unit/test_parser_bench_execute.py
git commit -m "feat(parser-bench): paid runs — cost OK, only the scored pages, no warm-up, usage and cost on the record

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The command line: `run --cost-ok` and `models`

**Files:**
- Modify: `backend/eval/parser_bench/__main__.py`
- Modify: `backend/tests/unit/test_parser_bench_cli.py`

**Interfaces:**
- Consumes: `execute.planned_pages`, `run_tool(cost_ok=)` (Task 9); `paid.estimate`, `paid.list_models`, `paid.KeyFileError` (Task 6).
- Produces:
  - `run <paid tool> <pdf> [...]` prints `paid.estimate(...).line(tool)` and, without `--cost-ok`, writes "nothing sent; add --cost-ok …" to stderr and exits 2 without running.
  - `models` prints the account's live model ids, one per line (exit 2 with one line on a key or network problem).

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_parser_bench_cli.py`, add `from types import SimpleNamespace` and `from backend.eval.parser_bench import paid` to the imports, and add:

```python
def test_a_paid_run_prints_its_cost_and_needs_cost_ok(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    deck = make_deck(tmp_path / "deck.pdf")
    called = []
    fake = SimpleNamespace(meta={"run_id": "r1", "status": "finished", "reason": None, "seconds_per_page": 1.0,
                                 "peak_memory_mb": None}, path=tmp_path)
    monkeypatch.setattr(execute, "run_tool", lambda *a, **k: called.append(k) or fake)
    assert cli.main(["run", "ai_vision", str(deck)]) == 2
    out, err = capsys.readouterr()
    assert "ai_vision: 6 page images to OpenAI (gpt-4.1-mini), estimated $0.02" in out and "--cost-ok" in err
    assert called == []
    assert cli.main(["run", "ai_vision", str(deck), "--pages", "2", "--cost-ok"]) == 0
    assert "1 page image to OpenAI" in capsys.readouterr().out and called[0]["cost_ok"] is True


def test_a_free_run_passes_no_cost_ok(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    deck = make_deck(tmp_path / "deck.pdf")
    assert cli.main(["run", "current", str(deck), "--no-warmup"]) == 0
    assert "OpenAI" not in capsys.readouterr().out


def test_models_lists_the_live_ids_or_says_what_is_wrong(monkeypatch, capsys):
    monkeypatch.setattr(paid, "list_models", lambda: ["gpt-a", "gpt-b"])
    assert cli.main(["models"]) == 0
    assert capsys.readouterr().out.split() == ["gpt-a", "gpt-b"]

    def no_key():
        raise paid.KeyFileError("key file missing (~/.config/learnstation-parser-bench/openai_key)")

    monkeypatch.setattr(paid, "list_models", no_key)
    assert cli.main(["models"]) == 2
    assert "key file missing" in capsys.readouterr().err
```

(6 pages × $0.00264 = $0.0158, shown as `$0.02`.)

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_cli.py -q -k "paid or free or models"`
Expected: FAIL (`unrecognized arguments: --cost-ok`, `invalid choice: 'models'`).

- [ ] **Step 3: Implement**

In `backend/eval/parser_bench/__main__.py`:

Change the import to `from backend.eval.parser_bench import blinding, compare, execute, pageset, paid, results, server, sources, store, tools`.

In the module docstring, replace the `run` line with

```
    run <tool> <pdf> [--pages 1,4-6] [--purpose explore|benchmark] [--no-warmup] [--cost-ok]
                                  a paid method prints its page count and cost and needs --cost-ok
    models                        the OpenAI model ids this account can use (for choosing ai_vision_strong)
```

In `main`, after `p.add_argument("--no-warmup", ...)` add

```python
    p.add_argument("--cost-ok", action="store_true", help="a paid method: send the pages and pay for them")
```

and after the `runs` sub-parser add

```python
    sub.add_parser("models", help="the OpenAI model ids this account can use")
```

Replace the `if args.cmd == "run":` block's first `try:` with:

```python
    if args.cmd == "run":
        tool = tools.TOOLS[args.tool]
        if tool.paid:
            try:
                est = paid.estimate(tool.model, len(execute.planned_pages(args.pdf, args.pages, args.purpose)))
            except (ValueError, OSError, RuntimeError) as e:
                print(e, file=sys.stderr)
                return 2
            print(est.line(tool.id))
            if not args.cost_ok:
                print("nothing sent; add --cost-ok to send these page images to OpenAI and pay for them", file=sys.stderr)
                return 2
        try:
            run = execute.run_tool(args.tool, args.pdf, pages=args.pages, purpose=args.purpose,
                                   warmup=not args.no_warmup, cost_ok=args.cost_ok)
        except (RuntimeError, ValueError) as e:
            print(e, file=sys.stderr)
            return 2
```

(the rest of the block is unchanged). Before `if args.cmd == "export":` add:

```python
    if args.cmd == "models":
        try:
            print("\n".join(paid.list_models()))
        except RuntimeError as e:  # KeyFileError is a RuntimeError too
            print(e, file=sys.stderr)
            return 2
        return 0
```

- [ ] **Step 4: Run the CLI tests**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_cli.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/__main__.py backend/tests/unit/test_parser_bench_cli.py
git commit -m "feat(parser-bench): run --cost-ok shows the page count and cost first; models lists live ids

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The webpage's server: cost OK on jobs, the estimate, paid usage behind the lock

**Files:**
- Modify: `backend/eval/parser_bench/jobs.py` (`pages_for`, `submit_run`, `_execute`)
- Modify: `backend/eval/parser_bench/api_newrun.py` (`JobsIn`, `methods`, `start_jobs`, new `estimate`)
- Modify: `backend/eval/parser_bench/api_runs.py` (`summary`, `run_detail`)
- Modify: `backend/tests/unit/test_parser_bench_jobs.py`, `backend/tests/unit/test_parser_bench_server.py`

**Interfaces:**
- Consumes: `paid.estimate`, `paid.key_problem` (Task 6); `tools.needs_install`, `Tool.paid/model` (Task 8); `run_tool(cost_ok=)` (Task 9); `blinding.lock_state` (Task 3).
- Produces:
  - `JobQueue.pages_for(stored, purpose) -> list[int]`; `JobQueue.submit_run(*, tool, sha256, purpose, cost_ok=False)` refuses a paid method unless `cost_ok is True`; a run job records `cost_ok` and `estimate` (`Estimate.as_dict()` or `None`); the worker passes `cost_ok` to the runner.
  - `POST /api/jobs` body `{"sha256", "tools", "purpose", "cost_ok": true}` (`StrictBool`: only a JSON `true`); without it, a request naming a paid method queues **nothing** (400).
  - `GET /api/estimate?sha256=&tools=a,b&purpose=` → `{"file", "purpose", "estimates": [{"tool", "label", "model", "pages", "usd", "max_usd"}]}` (paid methods only).
  - `GET /api/methods` rows add `"paid"`, `"model"`, `"needs_install"`, `"key_missing"` (`null` for a free method).
  - Run rows add `"cost_usd"`; run detail adds `"cost"`, `"pages_sent"`, and `"api_pages"` holding only the open pages' usage.

Per-page token counts are hidden for locked pages for the same reason per-page checks are: they show the output's length per method.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_parser_bench_jobs.py` add:

```python
def test_a_paid_run_needs_cost_ok_and_records_its_estimate(tmp_path, stored):
    seen = []

    def runner(tool, pdf, **kw):
        seen.append((tool, kw.get("cost_ok")))
        return fake_run()

    q = queue(tmp_path, runner)
    try:
        with pytest.raises(ValueError, match="costs money"):
            q.submit_run(tool="ai_vision", sha256=stored.sha256, purpose="explore")
        job = q.submit_run(tool="ai_vision", sha256=stored.sha256, purpose="explore", cost_ok=True)
        assert job["cost_ok"] is True
        assert (job["estimate"]["model"], job["estimate"]["pages"]) == ("gpt-4.1-mini", 6) and job["estimate"]["usd"] > 0
        plain = q.submit_run(tool="current", sha256=stored.sha256, purpose="explore", cost_ok=True)
        assert (plain["cost_ok"], plain["estimate"]) == (False, None)
        assert wait_for(lambda: q.get(plain["job_id"])["state"] == "finished")
    finally:
        q.stop()
    assert seen == [("ai_vision", True), ("current", False)]
    assert "sk-" not in json.dumps(q.list())
```

In `backend/tests/unit/test_parser_bench_server.py` add `from backend.eval.parser_bench import paid` and:

```python
def test_a_paid_method_shows_its_estimate_and_needs_a_cost_ok(root, tmp_path, monkeypatch):
    monkeypatch.setattr(paid, "KEY_FILE", tmp_path / "no-key")
    with client_for(root, dist=tmp_path / "no-dist") as client:
        pdf = make_deck(tmp_path / "deck.pdf").read_bytes()
        stored = client.post("/api/files", headers=WRITE, files={"file": ("Lecture.pdf", pdf, "application/pdf")}).json()
        methods = {m["id"]: m for m in client.get("/api/methods").json()["methods"]}
        vision = methods["ai_vision"]
        assert (vision["group"], vision["paid"], vision["model"], vision["key_missing"]) == ("paid", True, "gpt-4.1-mini", True)
        assert methods["current"]["key_missing"] is None and methods["current"]["paid"] is False
        est = client.get("/api/estimate", params={"sha256": stored["sha256"], "tools": "current,ai_vision"}).json()
        assert [(e["tool"], e["pages"], e["model"]) for e in est["estimates"]] == [("ai_vision", 6, "gpt-4.1-mini")]
        assert est["estimates"][0]["usd"] > 0 and est["estimates"][0]["max_usd"] >= est["estimates"][0]["usd"]
        r = client.post("/api/jobs", headers=WRITE, json={"sha256": stored["sha256"], "tools": ["current", "ai_vision"]})
        assert r.status_code == 400 and "cost" in r.json()["detail"]
        assert client.get("/api/jobs").json()["jobs"] == []  # nothing queued, not even current
        r = client.post("/api/jobs", headers=WRITE, json={"sha256": stored["sha256"], "tools": ["ai_vision"], "cost_ok": "yes"})
        assert r.status_code == 422  # only a JSON true is an OK


def test_run_detail_hides_the_api_usage_of_pages_still_judged_blind(client, root, tmp_path):
    make_comparison(root, tmp_path)  # judging the deck's six pages
    usage = {"pages": {str(n): {"prompt_tokens": 100, "completion_tokens": 10 * n} for n in range(1, 7)}}
    cost = {"requests": 6, "prompt_tokens": 600, "completion_tokens": 210, "usd": 0.001}
    hidden = make_extract_run(root, "ai_vision", tmp_path / "deck.pdf",
                              finish_extra={"api_usage": usage, "cost": cost, "pages_sent": [1, 2, 3, 4, 5, 6]})
    detail = client.get(f"/api/runs/{hidden.run_id}").json()
    assert detail["api_pages"] == {} and detail["cost"]["usd"] == 0.001 and detail["pages_sent"] == [1, 2, 3, 4, 5, 6]
    other = make_deck(tmp_path / "other.pdf", n=7)  # another file: not judged, not in the page set
    shown = make_extract_run(root, "ai_vision", other, purpose="explore", finish_extra={"api_usage": usage, "cost": cost})
    assert set(client.get(f"/api/runs/{shown.run_id}").json()["api_pages"]) == {"1", "2", "3", "4", "5", "6"}
    rows = {r["run_id"]: r for r in client.get("/api/runs").json()["runs"]}
    assert rows[shown.run_id]["cost_usd"] == 0.001
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_jobs.py backend/tests/unit/test_parser_bench_server.py -q`
Expected: FAIL (`submit_run() got an unexpected keyword argument 'cost_ok'`, 404 for `/api/estimate`, `KeyError: 'paid'`).

- [ ] **Step 3: Implement the queue**

In `backend/eval/parser_bench/jobs.py`, change the import to `from backend.eval.parser_bench import execute, files, paid, store, tools` and replace `submit_run` with:

```python
    def pages_for(self, stored: files.StoredFile, purpose: str) -> list[int]:
        """The pages a run of this file would score, which are the pages a paid method sends."""
        if purpose == "benchmark":
            chosen = self.benchmark_pages(stored.sha256)
            if not chosen:
                raise ValueError(f"{stored.name} is not in the benchmark page set; run it as explore")
            return chosen
        return list(range(1, stored.pages + 1))

    def submit_run(self, *, tool: str, sha256: str, purpose: str, cost_ok: bool = False) -> dict[str, Any]:
        """Queue one method on one stored file. A paid method needs cost_ok, given after the page count and the
        estimate were shown (spec: an explicit OK each run); the job keeps that estimate, never the key."""
        if tool not in tools.TOOLS:
            raise ValueError(f"unknown method {tool!r}")
        if purpose not in store.PURPOSES:
            raise ValueError(f"purpose must be one of {store.PURPOSES}")
        stored = files.find_file(sha256, self.root)
        pages = self.pages_for(stored, purpose)
        method = tools.TOOLS[tool]
        estimate = None
        if method.paid:
            if cost_ok is not True:
                raise ValueError(f"{tool} sends page images to OpenAI and costs money; confirm the cost first")
            estimate = paid.estimate(method.model, len(pages)).as_dict()
        return self._new(kind="run", tool=tool, sha256=sha256, file_name=stored.name, purpose=purpose,
                         cost_ok=bool(method.paid and cost_ok), estimate=estimate)
```

In `_execute`, change the runner call to

```python
                run = self.runner(job["tool"], pdf, purpose=job["purpose"], cost_ok=bool(job.get("cost_ok")),
                                  root=self.root, wait_for_slot=True, cancel=cancel,
                                  on_stage=lambda stage: self._set_stage(job_id, stage))
```

- [ ] **Step 4: Implement the routes**

In `backend/eval/parser_bench/api_newrun.py`:

```python
from fastapi import APIRouter, File, Query, Request, UploadFile
from pydantic import BaseModel, StrictBool

from backend.eval.parser_bench import execute, files, paid, store, tools
from backend.eval.parser_bench.api_runs import root_of
```

Replace `JobsIn`, `methods` and `start_jobs` with:

```python
class JobsIn(BaseModel):
    sha256: str
    tools: list[str]
    purpose: str = "explore"
    cost_ok: StrictBool = False  # only a JSON true: the OK given after the estimate was shown


@router.get("/methods")
def methods() -> dict[str, Any]:
    return {"groups": list(tools.GROUPS), "methods": [
        {"id": t.id, "label": t.label, "group": t.group, "description": t.description,
         "ready": tools.is_ready(t), "missing": tools.missing(t), "size_mb": t.size_mb,
         "needs_install": tools.needs_install(t), "paid": t.paid, "model": t.model or None,
         "key_missing": (paid.key_problem() is not None) if t.paid else None}
        for t in tools.TOOLS.values()]}


@router.get("/estimate")
def estimate(request: Request, sha256: str, methods_: str = Query(..., alias="tools"),
             purpose: str = "explore") -> dict[str, Any]:
    """What a run of the paid methods among `tools` would send and cost; the New run screen shows it before
    the cost OK."""
    if purpose not in store.PURPOSES:
        raise ValueError(f"purpose must be one of {store.PURPOSES}")
    stored = files.find_file(files.check_sha(sha256), root_of(request))
    pages = request.app.state.jobs.pages_for(stored, purpose)
    out = []
    for tool_id in [m for m in methods_.split(",") if m]:
        tool = tools.TOOLS.get(tool_id)
        if tool is None:
            raise ValueError(f"unknown method {tool_id!r}")
        if tool.paid:
            out.append({"tool": tool.id, "label": tool.label, **paid.estimate(tool.model, len(pages)).as_dict()})
    return {"file": stored.name, "purpose": purpose, "estimates": out}


@router.post("/jobs")
def start_jobs(body: JobsIn, request: Request) -> dict[str, Any]:
    if not body.tools:
        raise ValueError("tick at least one method")
    if body.purpose not in store.PURPOSES:
        raise ValueError(f"purpose must be one of {store.PURPOSES}")
    unknown = [t for t in body.tools if t not in tools.TOOLS]
    if unknown:
        raise ValueError(f"unknown methods: {', '.join(unknown)}")
    unconfirmed = [t for t in body.tools if tools.TOOLS[t].paid and not body.cost_ok]
    if unconfirmed:  # checked before anything is queued, so a refusal queues nothing
        raise ValueError(f"{', '.join(unconfirmed)} send page images to OpenAI and cost money; confirm the cost first")
    queue = request.app.state.jobs
    return {"jobs": [queue.submit_run(tool=t, sha256=body.sha256, purpose=body.purpose, cost_ok=body.cost_ok)
                     for t in body.tools]}
```

In `backend/eval/parser_bench/api_runs.py`, in `summary`'s extract row add after `"peak_memory_mb": meta.get("peak_memory_mb"),`:

```python
        "cost_usd": (meta.get("cost") or {}).get("usd"),
```

and in `run_detail`, after `open_pages = {...}`, add

```python
    api = meta.get("api_usage") if isinstance(meta.get("api_usage"), dict) else None
    api_pages = None if api is None else {k: v for k, v in (api.get("pages") or {}).items()
                                          if str(k).isdigit() and int(k) in open_pages}
```

and add to `detail.update(...)`: `cost=meta.get("cost"), pages_sent=meta.get("pages_sent"), api_pages=api_pages,`.

- [ ] **Step 5: Run the jobs and server tests**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_jobs.py backend/tests/unit/test_parser_bench_server.py -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/eval/parser_bench/jobs.py backend/eval/parser_bench/api_newrun.py backend/eval/parser_bench/api_runs.py \
  backend/tests/unit/test_parser_bench_jobs.py backend/tests/unit/test_parser_bench_server.py
git commit -m "feat(parser-bench): the server refuses a paid job without a cost OK; estimate route; usage behind the lock

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: The schedule of an added comparison

**Files:**
- Modify: `backend/eval/parser_bench/schedule.py` (`round1`, `needs_round2`, `round2_batch`, docstring)
- Modify: `backend/tests/unit/test_parser_bench_schedule.py`

**Interfaces:**
- Consumes: Plan 2's `round1`, `_place`, `_balance_sides`, `repeat_gap`.
- Produces:
  - `schedule.round1(entrants, pages, seed, *, new: Collection[str] | None = None)`: with `new`, only pairs with at least one new entrant; `None` gives exactly Plan 2's schedule (pinned by digest).
  - `schedule.needs_round2(ranking, *, new=None) -> bool`: with `new`, also needs a new entrant among the top two (rows then need `"entrant"`).
  - `schedule.round2_batch(ranked, pages, existing, seed, batch, room, *, only_with: Collection[str] | None = None)`: with `only_with`, only adjacent top-4 pairs that involve one of them.
  - The second comparison's round 1 (seven entrants, two new, seed 20261101, the 24 pages of `pages.json`) has 37 duels and the digest pinned below.

Both digests were computed before this plan was written: the first from Plan 2's code (it equals `cmp-2026-10-30_8825`'s round 1 on disk), the second from Plan 2's code with exactly the pair filter below.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_parser_bench_schedule.py`, add `import hashlib`, `import json` and `from backend.eval.parser_bench import pageset` to the imports, and add:

```python
SEVEN = ["current", "pymupdf4llm", "pdfjs", "markitdown", "opendataloader", "ai_vision", "ai_vision_strong"]
NEW = {"ai_vision", "ai_vision_strong"}


def _digest(duels) -> str:
    return hashlib.sha256(json.dumps(duels, sort_keys=True).encode()).hexdigest()


def _page_set():
    return [schedule.SchedPage(p.key, p.type) for p in pageset.load()]


def test_the_first_comparison_is_scheduled_exactly_as_before():
    duels = schedule.round1(FIVE, _page_set(), 20261031)
    assert _digest(duels) == "ba9b16d9db19374d35430723770381090bf46b209c8886a0cc26bcb5c78687ca"
    assert schedule.round1(FIVE, _page_set(), 20261031, new=None) == duels


def test_the_second_comparison_schedule_is_fixed_before_any_vote():
    duels = schedule.round1(SEVEN, _page_set(), 20261101, new=NEW)
    assert len(duels) == 37 and sum(d["repeat_of"] is not None for d in duels) == 4
    assert _digest(duels) == "b9808242c21fe8cd02869770116561873f66c1b89ddabd5bb97c377bde9a1997"


def test_an_added_comparison_pairs_only_new_methods():
    duels = schedule.round1(SEVEN, PAGES, seed=5, new=NEW)
    first = [d for d in duels if d["repeat_of"] is None]
    assert len(first) == 33 and all({d["a"], d["b"]} & NEW for d in duels)
    pairs = Counter(tuple(sorted((d["a"], d["b"]))) for d in first)
    assert len(pairs) == 11 and set(pairs.values()) == {3}  # 2 new × 5 old + the new pair, 3 each
    seen = Counter(x for d in first for x in (d["a"], d["b"]))
    assert all(seen[t] == 18 for t in NEW) and all(seen[t] == 6 for t in FIVE)
    left = Counter(d["left"] for d in first)
    assert all(abs(left[t] - seen[t] / 2) <= 1 for t in SEVEN)
    gap = schedule.repeat_gap(len(duels))
    assert all(d["duel"] - d["repeat_of"] >= gap for d in duels if d["repeat_of"] is not None)


def test_new_entrants_must_be_entrants():
    with pytest.raises(ValueError, match="not among the entrants"):
        schedule.round1(FIVE, PAGES, seed=1, new={"docling"})
    with pytest.raises(ValueError, match="at least one new"):
        schedule.round1(FIVE, PAGES, seed=1, new=set())


def test_round2_of_an_added_comparison_needs_a_new_method_in_the_top_two():
    old_top = [{"entrant": "pymupdf4llm", "lo": 1050, "hi": 1200}, {"entrant": "opendataloader", "lo": 990, "hi": 1060}]
    assert schedule.needs_round2(old_top) and not schedule.needs_round2(old_top, new=NEW)
    new_top = [{"entrant": "ai_vision", "lo": 1050, "hi": 1200}, {"entrant": "pymupdf4llm", "lo": 990, "hi": 1060}]
    assert schedule.needs_round2(new_top, new=NEW)
    apart = [{"entrant": "ai_vision", "lo": 1070, "hi": 1200}, {"entrant": "pymupdf4llm", "lo": 990, "hi": 1060}]
    assert not schedule.needs_round2(apart, new=NEW)


def test_a_round2_batch_of_an_added_comparison_keeps_only_pairs_with_a_new_method():
    existing = schedule.round1(SEVEN, PAGES, seed=5, new=NEW)
    ranked = ["pymupdf4llm", "ai_vision", "opendataloader", "pdfjs", "current", "markitdown", "ai_vision_strong"]
    batch = schedule.round2_batch(ranked, PAGES, existing, seed=5, batch=1, room=75, only_with=NEW)
    pairs = Counter(tuple(sorted((d["a"], d["b"]))) for d in batch)
    assert pairs == {("ai_vision", "pymupdf4llm"): 3, ("ai_vision", "opendataloader"): 3}
    assert [d["duel"] for d in batch] == list(range(37, 43))
    same = schedule.round2_batch(ranked, PAGES, existing, seed=5, batch=1, room=75)
    assert len(same) == 9  # without only_with: Plan 2's rule, all three neighbour pairs
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_schedule.py -q`
Expected: the first pin passes; the rest FAIL (`unexpected keyword argument 'new'` / `'only_with'`).

- [ ] **Step 3: Implement**

In `backend/eval/parser_bench/schedule.py`, change `from typing import Any, Mapping, Sequence` to `from typing import Any, Collection, Mapping, Sequence`, and append to the module docstring:

```
An added comparison (one that builds on finished ones, compare.create_pooled) schedules only the pairs with
at least one new entrant, under the same round-1 rule. Its round 2 runs only while a new entrant is among
the overlapping top two, and then only for the adjacent top-4 pairs that involve a new entrant: the old
pairs were settled under their own comparison's stopping rule and cap.
```

In `round1`, change the signature to

```python
def round1(entrants: Sequence[str], pages: Sequence[SchedPage], seed: int, *,
           new: Collection[str] | None = None) -> list[dict[str, Any]]:
    """Round 1 with its hidden repeats, numbered 0.. in the order they are judged. With `new`, only the pairs
    that involve at least one of those entrants (an added comparison); without, every pair."""
```

and replace

```python
    pairs = list(combinations(names, 2))
    rng.shuffle(pairs)
```

with

```python
    pairs = list(combinations(names, 2))
    if new is not None:
        fresh = set(new)
        if not fresh:
            raise ValueError("an added comparison needs at least one new entrant")
        unknown = sorted(fresh - set(names))
        if unknown:
            raise ValueError(f"new entrants {unknown} are not among the entrants")
        pairs = [(a, b) for a, b in pairs if a in fresh or b in fresh]
    rng.shuffle(pairs)
```

Replace `needs_round2` with:

```python
def needs_round2(ranking: Sequence[Mapping[str, Any]], *, new: Collection[str] | None = None) -> bool:
    """The stopping rule's question: does the top entrant's interval overlap the second's? `ranking` is sorted
    by points, best first, each row with "lo" and "hi" (unrounded: results._decision_rows). In an added
    comparison (`new` given) round 2 also needs a new entrant among the top two."""
    if len(ranking) < 2 or ranking[0]["lo"] > ranking[1]["hi"]:
        return False
    return new is None or bool({ranking[0]["entrant"], ranking[1]["entrant"]} & set(new))
```

In `round2_batch`, change the signature to

```python
def round2_batch(ranked: Sequence[str], pages: Sequence[SchedPage], existing: Sequence[Mapping[str, Any]],
                 seed: int, batch: int, room: int, *, only_with: Collection[str] | None = None) -> list[dict[str, Any]]:
```

add to its docstring `With only_with, only the pairs that involve one of those entrants.`, and replace

```python
    for x, y in zip(top, top[1:]):
```

with

```python
    pairs = list(zip(top, top[1:]))
    if only_with is not None:
        pairs = [(x, y) for x, y in pairs if x in only_with or y in only_with]
    for x, y in pairs:
```

- [ ] **Step 4: Run the schedule tests and the pin**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_schedule.py backend/tests/unit/test_parser_bench_results.py -q`
Expected: all pass, both schedule digests included.

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/schedule.py backend/tests/unit/test_parser_bench_schedule.py
git commit -m "feat(parser-bench): schedule an added comparison — only pairs with a new method; seed 20261101 pinned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Pooled comparisons (`compare.create_pooled`) and `compare create --against`

**Files:**
- Modify: `backend/eval/parser_bench/compare.py` (`CompareRun.create`, `_page_ids`, `create_pooled`, module docstring)
- Modify: `backend/eval/parser_bench/__main__.py` (`compare create --against`)
- Modify: `backend/tests/unit/parser_bench_compare_fixtures.py` (`make_pooled`)
- Modify: `backend/tests/unit/test_parser_bench_compare.py`, `backend/tests/unit/test_parser_bench_cli.py`

**Interfaces:**
- Consumes: `latest_benchmark_runs`, `_provenance`, `CompareRun.create(bench_tree=, provenance=)` (Task 4); `schedule.round1(new=)` (Task 12); `bench_pages_of` (Task 3).
- Produces:
  - `CompareRun.create(..., builds_on: Sequence[str] = (), new_entrants: Sequence[str] = ())` writes `"builds_on"` (list) and `"new_entrants"` (sorted list) into `compare.json`.
  - `compare.create_pooled(new_tools, *, against, seed, commit, tree=None, pages=None, root=None) -> CompareRun`.
  - CLI: `compare create --tools ai_vision,ai_vision_strong --against cmp-2026-10-30_8825 --seed 20261101`.
  - Fixture `make_pooled(root, tmp, base, new=("gammatool", "deltatool"), *, seed=5, commit="abc123") -> CompareRun`.

The earlier entrants keep the runs their comparison judged, named **by run id** from its `compare.json`, whatever protocol commit they were made under (the fast methods' runs are under `e07f5c9f`). Only the new methods' runs come from "latest under this protocol commit". `provenance` records each entrant's protocol commit and bench tree, so the pooled analysis states both.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/parser_bench_compare_fixtures.py` add at the end:

```python
def make_pooled(root: Path, tmp: Path, base: compare.CompareRun, new=("gammatool", "deltatool"), *, seed=5,
                commit="abc123") -> compare.CompareRun:
    """A comparison that adds `new` to the finished `base`, on its deck and pages."""
    for tool in new:
        make_extract_run(root, tool, tmp / "deck.pdf", commit=commit)
    return compare.create_pooled(list(new), against=[base.run_id], seed=seed, commit=commit, tree=None,
                                 pages=bench_pages_of(base), root=root)
```

In `backend/tests/unit/test_parser_bench_compare.py`, add `bench_pages_of, make_pooled` to the fixture import and add:

```python
def finished_base(root, tmp_path):
    base = make_comparison(root, tmp_path)
    vote_all(base)
    base.finish()
    return base


def test_a_pooled_comparison_adds_new_methods_against_a_finished_one(tmp_path):
    root = tmp_path / "data"
    base = finished_base(root, tmp_path)
    before = {name: (base.path / name).read_bytes() for name in ("compare.json", "votes.jsonl")}
    pooled = make_pooled(root, tmp_path, base)
    m = pooled.meta
    assert (m["builds_on"], m["new_entrants"], m["anchor"], m["status"]) == ([base.run_id], ["deltatool", "gammatool"], "current", "judging")
    assert all(m["entrants"][t] == base.meta["entrants"][t] for t in ("current", "alphatool", "betatool"))
    first = [d for d in m["schedule"] if d["repeat_of"] is None]
    assert len(first) == 21 and len(m["schedule"]) == 23  # (2 × 3 + 1) pairs × 3, plus round(21 / 9) = 2 repeats
    assert all({d["a"], d["b"]} & {"gammatool", "deltatool"} for d in m["schedule"])
    assert {name: (base.path / name).read_bytes() for name in before} == before


def test_the_earlier_runs_are_kept_by_id_under_their_own_protocol_commit(tmp_path):
    root = tmp_path / "data"
    base = finished_base(root, tmp_path)  # its runs were made under "abc123"
    pooled = make_pooled(root, tmp_path, base, commit="def456")  # the new runs under a later protocol commit
    prov = pooled.meta["provenance"]
    assert prov["alphatool"]["protocol_commit"] == "abc123" and prov["gammatool"]["protocol_commit"] == "def456"
    assert pooled.meta["protocol_commit"] == "def456"


def test_a_pooled_comparison_is_refused_when_it_cannot_share_the_scale(tmp_path):
    root = tmp_path / "data"
    base = make_comparison(root, tmp_path)
    for tool in ("gammatool", "alphatool"):
        make_extract_run(root, tool, tmp_path / "deck.pdf")
    pages = bench_pages_of(base)

    def pooled(tools, *, commit="abc123", using=pages):
        return compare.create_pooled(tools, against=[base.run_id], seed=5, commit=commit, pages=using, root=root)

    with pytest.raises(ValueError, match="not a finished"):
        pooled(["gammatool"])
    vote_all(base)
    base.finish()
    with pytest.raises(ValueError, match="already rated"):
        pooled(["gammatool", "alphatool"])
    with pytest.raises(ValueError, match="other pages"):
        pooled(["gammatool"], using=pages[:5])
    with pytest.raises(ValueError, match="deltatool on deck.pdf"):
        pooled(["deltatool"])
    with pytest.raises(RuntimeError, match="PROTOCOL.md"):
        pooled(["gammatool"], commit=None)
```

In `backend/tests/unit/test_parser_bench_cli.py`, add `bench_pages_of` to the fixture import at the `# --- Plan 2: compare` block and add:

```python
def test_compare_create_against_a_finished_comparison(monkeypatch, capsys, tmp_path):
    root = tmp_path / "data"
    monkeypatch.setenv("PARSER_BENCH_DIR", str(root))
    base = make_comparison(root, tmp_path)
    vote_all(base)
    base.finish()
    for tool in ("gammatool", "deltatool"):
        make_extract_run(root, tool, tmp_path / "deck.pdf")
    monkeypatch.setattr(pageset, "load", lambda path=pageset.PAGESET: bench_pages_of(base))
    monkeypatch.setattr(execute, "benchmark_gate", lambda: {"protocol_commit": "abc123", "bench_tree": "t"})
    assert cli.main(["compare", "create", "--tools", "gammatool,deltatool", "--against", base.run_id, "--seed", "5"]) == 0
    assert "judging  0/23 duels" in capsys.readouterr().out
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_compare.py backend/tests/unit/test_parser_bench_cli.py -q`
Expected: FAIL (`module 'compare' has no attribute 'create_pooled'`, `unrecognized arguments: --against`).

- [ ] **Step 3: Implement**

In `backend/eval/parser_bench/compare.py`, extend the module docstring's `compare.json` paragraph with: `A comparison that adds methods to finished ones also names them ("builds_on") and its "new_entrants"; its ratings pool their votes (results.py), which are only read.`

In `CompareRun.create`, add the keyword parameters `builds_on: Sequence[str] = ()` and `new_entrants: Sequence[str] = ()` (after `provenance`). Right after the anchor check add:

```python
        if builds_on and not new_entrants:
            raise ValueError("a comparison that builds on others names its new entrants")
        if any(t not in entrants for t in new_entrants):
            raise ValueError("every new entrant must be an entrant")
```

and in the dict written to `compare.json`, right after `"anchor": anchor,` add:

```python
            "builds_on": list(builds_on),
            "new_entrants": sorted(new_entrants),
```

Add after `create_benchmark`:

```python
def _page_ids(entries: Sequence[Mapping[str, Any]]) -> list[tuple]:
    return sorted((p["key"], p["sha256"], int(p["page"]), p["type"]) for p in entries)


def create_pooled(new_tools: Sequence[str], *, against: Sequence[str], seed: int, commit: str | None,
                  tree: str | None = None, pages: Sequence[pageset.BenchPage] | None = None,
                  root: Path | None = None) -> CompareRun:
    """A comparison that adds `new_tools` to finished comparisons (`against`) on one rating scale (spec decision 9).

    The earlier entrants keep the runs their comparison judged, named by run id, whatever protocol commit they
    were made under; the new tools' runs are their latest benchmark runs under `commit`. Only pairs with a new
    tool are scheduled. The earlier comparisons are only read: results.summarize pools their votes with this
    one's, with the same anchor and pages."""
    if commit is None:
        raise RuntimeError("a benchmark comparison needs PROTOCOL.md committed and unmodified")
    fresh_tools = sorted(set(new_tools))
    if not fresh_tools:
        raise ValueError("name the new methods (--tools)")
    if not against:
        raise ValueError("name the finished comparison to build on (--against)")
    pages = pageset.load() if pages is None else list(pages)
    entries = [pageset.as_entry(p) for p in pages]
    chain: list[str] = []
    earlier: dict[str, dict[str, str]] = {}
    anchors: set[str] = set()
    for cid in against:
        meta = CompareRun.open(cid, root).meta
        if meta.get("purpose") != "benchmark" or meta.get("status") != "finished":
            raise ValueError(f"{cid} is not a finished benchmark comparison")
        if _page_ids(meta["pages"]) != _page_ids(entries):
            raise ValueError(f"{cid} judged other pages than the page set; a pooled comparison needs the same pages")
        if store.checks_version(meta) != checks.CHECKS_VERSION:
            raise ValueError(f"{cid} was scored with checks version {store.checks_version(meta)}, not {checks.CHECKS_VERSION}")
        for earlier_id in [*(meta.get("builds_on") or []), cid]:
            if earlier_id not in chain:
                chain.append(earlier_id)
        for tool, runs in meta["entrants"].items():
            if tool in earlier and earlier[tool] != runs:
                raise ValueError(f"{tool} was judged with different runs in {', '.join(against)}")
            earlier[tool] = dict(runs)
        anchors.add(meta["anchor"])
    if len(anchors) != 1:
        raise ValueError(f"the comparisons built on use different anchors: {sorted(anchors)}")
    clash = [t for t in fresh_tools if t in earlier]
    if clash:
        raise ValueError(f"{', '.join(clash)} already rated in {', '.join(against)}; a pooled comparison adds new methods only")
    for runs in earlier.values():
        for run_id in runs.values():
            if store.ExtractRun(store.find_run(run_id, root)).meta.get("status") != "finished":
                raise ValueError(f"{run_id} is not a finished run")
    fresh = latest_benchmark_runs(fresh_tools, pages, commit, root)
    trees = {p["bench_tree"] for p in _provenance(fresh, root).values()}
    if len(trees) > 1:
        raise ValueError(f"the new methods' runs were made with different bench trees ({', '.join(sorted(map(str, trees)))})")
    entrants = {**earlier, **fresh}
    duels = schedule.round1(sorted(entrants), [schedule.SchedPage(p.key, p.type) for p in pages], seed, new=fresh_tools)
    return CompareRun.create(entrants=entrants, pages=entries, seed=seed, duels=duels, protocol_commit=commit,
                             anchor=anchors.pop(), bench_tree=tree, provenance=_provenance(entrants, root),
                             builds_on=chain, new_entrants=fresh_tools, root=root)
```

In `backend/eval/parser_bench/__main__.py`: in the docstring replace the `compare create` lines with

```
    compare create --tools a,b,c --seed N [--against cmp-…]
                                  a blind comparison of those methods' benchmark runs; with --against, the
                                  methods are added to finished comparisons (only their pairs, one scale)
```

add to the `create` sub-parser

```python
    s.add_argument("--against", help="comma-separated finished comparisons to add the methods to")
```

and in `_compare` replace the `create_benchmark` call (Task 4's version) with:

```python
            gate = execute.benchmark_gate()
            chosen = [t for t in args.tools.split(",") if t]
            if args.against:
                cmp = compare.create_pooled(chosen, against=[c for c in args.against.split(",") if c], seed=args.seed,
                                            commit=gate["protocol_commit"], tree=gate["bench_tree"])
            else:
                cmp = compare.create_benchmark(chosen, seed=args.seed, commit=gate["protocol_commit"], tree=gate["bench_tree"])
```

- [ ] **Step 4: Run the compare, CLI and results tests**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_compare.py backend/tests/unit/test_parser_bench_cli.py backend/tests/unit/test_parser_bench_results.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/compare.py backend/eval/parser_bench/__main__.py \
  backend/tests/unit/parser_bench_compare_fixtures.py backend/tests/unit/test_parser_bench_compare.py backend/tests/unit/test_parser_bench_cli.py
git commit -m "feat(parser-bench): pooled comparisons — new methods added to a finished one, earlier runs by id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Results on one scale: pooled votes, the round-1-only line, round 2 for new methods

**Files:**
- Modify: `backend/eval/parser_bench/results.py` (`_tag_all`, `_pooled`, `_round1_h1`, `_summarize`, `win_rate_by_type`, `_key`/`_stored_key`/`_current_key`, `current_results`, `advance`)
- Modify: `backend/tests/unit/test_parser_bench_results.py`

**Interfaces:**
- Consumes: `compare.create_pooled` and `make_pooled` (Task 13), `schedule.needs_round2(new=)`, `round2_batch(only_with=)` (Task 12), `_summarize`/`_decision_rows`/`fake_verdict` (Task 5).
- Produces, only for a comparison with `builds_on`:
  - The ranking (with its counts), H1 (`h1_k` = all challengers) and win rates by page type use the pooled votes; `votes`, `self_consistency` and `median_seconds` stay this comparison's own.
  - `results.json` adds `"pooled": {"builds_on", "new_entrants", "votes", "sources": {cmp_id: {"status", "votes", "votes_digest"}}, "note"}` and `"sensitivity": {"round1_only": {"votes", "h1_above", "h1_k", "h1_lower"}}`.
  - The freshness key includes the sources; a comparison without `builds_on` produces exactly Plan 2's keys in Plan 2's order (the pin of Task 1 holds).
  - `advance` applies round 2 with `new=` and `only_with=` the comparison's `new_entrants`.
  - `results._round1_h1(votes, entrants, anchor, resamples, seed) -> dict` (Task 17 also uses it on the first comparison).

Pooled votes are tagged `page_type`, `round` and `comparison` (a vote line's own `"type"` is `"vote"`, so the page type cannot use that key).

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_parser_bench_results.py`, add `make_pooled` to the fixture import and add:

```python
PLAN2_KEYS = ["run_id", "status", "votes_digest", "votes", "retracted", "scheduled", "rounds", "round2_duels", "anchor",
              "bootstrap", "ranking", "h1", "h1_k", "self_consistency", "win_rate_by_type", "median_seconds", "checks"]


def test_a_comparison_that_builds_on_none_has_exactly_plan2s_keys(cmp, tmp_path):
    vote_all(cmp)
    assert list(results.summarize(cmp, resamples=FAST, root=tmp_path / "data")) == PLAN2_KEYS


def test_pooled_ratings_use_both_comparisons_votes_and_leave_the_first_alone(tmp_path):
    root = tmp_path / "data"
    base = make_comparison(root, tmp_path)
    vote_all(base, prefer("alphatool"))
    base.finish()
    stored = results.write_results(base, resamples=FAST, root=root)
    before = {n: (base.path / n).read_bytes() for n in ("compare.json", "votes.jsonl", "results.json")}
    pooled = make_pooled(root, tmp_path, base)
    vote_all(pooled, prefer("gammatool"))
    data = results.summarize(pooled, resamples=FAST, root=root)
    assert (data["votes"], data["pooled"]["votes"], data["pooled"]["sources"][base.run_id]["votes"]) == (23, 33, 10)
    assert data["pooled"]["sources"][base.run_id]["votes_digest"] == stored["votes_digest"]
    ranked = [r["entrant"] for r in data["ranking"]]
    assert ranked[0] == "gammatool" and ranked.index("alphatool") < ranked.index("betatool")
    assert next(r for r in data["ranking"] if r["entrant"] == "current")["points"] == 1000.0
    assert data["h1_k"] == 4 and data["sensitivity"]["round1_only"]["votes"] == 33
    alpha = next(r for r in data["ranking"] if r["entrant"] == "alphatool")
    assert sum(c["duels"] for c in data["win_rate_by_type"]["alphatool"].values()) == alpha["duels"]
    assert "vote" not in data["win_rate_by_type"]["alphatool"]
    assert {n: (base.path / n).read_bytes() for n in before} == before
    assert results.current_results(base, resamples=FAST, root=root) == stored


def test_the_round1_only_line_leaves_out_round2_votes():
    votes = [{"left": "a", "right": "current", "choice": "left", "round": 1},
             {"left": "a", "right": "current", "choice": "left", "round": 2}]
    line = results._round1_h1(votes, ["a", "current"], "current", 20, 1)
    assert line["votes"] == 1 and line["h1_k"] == 1 and set(line["h1_lower"]) == {"a"}


def _judged_pooled(root, tmp_path):
    base = make_comparison(root, tmp_path)
    vote_all(base)
    base.finish()
    pooled = make_pooled(root, tmp_path, base)
    vote_all(pooled)
    return pooled


def test_an_added_comparison_ends_when_only_old_methods_overlap_at_the_top(tmp_path, monkeypatch):
    root = tmp_path / "data"
    pooled = _judged_pooled(root, tmp_path)
    fake = fake_verdict({"alphatool": (1100.0, 1040.0, 1160.0), "betatool": (1090.0, 1030.0, 1150.0),
                         "gammatool": (1000.5, 950.0, 1050.0), "deltatool": (990.0, 940.0, 1040.0),
                         "current": (1000.0, 1000.0, 1000.0)})
    monkeypatch.setattr(results.ranking, "analyse", lambda *a, **k: fake)
    assert results.advance(pooled, resamples=FAST, root=root) == {"added": 0, "finished": True}


def test_an_added_comparison_gets_round2_pairs_with_a_new_method_only(tmp_path, monkeypatch):
    root = tmp_path / "data"
    pooled = _judged_pooled(root, tmp_path)
    fake = fake_verdict({"gammatool": (1100.0, 1040.0, 1160.0), "alphatool": (1090.0, 1030.0, 1150.0),
                         "betatool": (1050.0, 1000.0, 1100.0), "deltatool": (1000.2, 950.0, 1050.0),
                         "current": (1000.0, 1000.0, 1000.0)})
    monkeypatch.setattr(results.ranking, "analyse", lambda *a, **k: fake)
    assert results.advance(pooled, resamples=FAST, root=root) == {"added": 6, "finished": False}
    added = pooled.meta["schedule"][23:]
    pairs = Counter(tuple(sorted((d["a"], d["b"]))) for d in added)
    assert pairs == {("alphatool", "gammatool"): 3, ("betatool", "deltatool"): 3}  # not alphatool–betatool
```

Add `from collections import Counter` to the imports.

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_results.py -q`
Expected: FAIL (`KeyError: 'pooled'`, no `_round1_h1`, round 2 added for the old pair).

- [ ] **Step 3: Implement**

In `backend/eval/parser_bench/results.py`, extend the module docstring with:

```
A comparison that builds on finished ones (compare.create_pooled) is rated on one scale with them: the ranking,
its counts, H1 (over every challenger) and the win rates use their votes and its own, which are only read.
Its own vote count, self-consistency and decision time stay its own. It also reports H1 on round-1 votes alone,
as a sensitivity line beside the pooled verdict (round 2 depends on round 1: PROTOCOL.md §9).
```

Replace `win_rate_by_type` with:

```python
def win_rate_by_type(meta: Mapping[str, Any], votes: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, dict[str, Any]]]:
    """Per entrant and page type: duels and score share (a win 1, a draw ½). Descriptive only. A pooled vote
    carries its own page type ("page_type"); the others take it from this comparison's schedule."""
    types = {d["duel"]: d["type"] for d in meta["schedule"]}
    tally: dict[str, dict[str, list[float]]] = {}
    for v in votes:
        page_type = v["page_type"] if "page_type" in v else types[v["duel"]]
        for side in ("left", "right"):
            cell = tally.setdefault(v[side], {}).setdefault(page_type, [0, 0.0])
            cell[0] += 1
            cell[1] += _score(v, side)
    return {tool: {t: {"duels": int(n), "score": round(s / n, 3)} for t, (n, s) in sorted(by_type.items())}
            for tool, by_type in sorted(tally.items())}
```

Add above `_summarize`:

```python
def _tag_all(votes: Sequence[Mapping[str, Any]], meta: Mapping[str, Any], cid: str) -> list[dict[str, Any]]:
    """Votes with their page type, round and comparison, so votes of several comparisons can be pooled."""
    by_duel = {d["duel"]: d for d in meta["schedule"]}
    return [dict(v, page_type=by_duel[v["duel"]]["type"], round=by_duel[v["duel"]]["round"], comparison=cid)
            for v in votes]


def _pooled(meta: Mapping[str, Any], root: Path | None) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """The counted votes of the comparisons this one builds on (each log read once, never written), and what
    was read from each: {cmp_id: {"status", "votes", "votes_digest"}}."""
    votes: list[dict[str, Any]] = []
    sources: dict[str, dict[str, Any]] = {}
    for cid in meta.get("builds_on") or []:
        base = CompareRun.open(cid, root)
        base_meta = base.meta
        events, digest = base.read_log()
        active = active_from_events(events)
        votes += _tag_all([active[k] for k in sorted(active)], base_meta, cid)
        sources[cid] = {"status": base_meta["status"], "votes": len(active), "votes_digest": digest}
    return votes, sources


def _round1_h1(votes: Sequence[Mapping[str, Any]], entrants: Sequence[str], anchor: str, resamples: int,
               seed: int) -> dict[str, Any]:
    """H1 on round-1 votes alone (hidden repeats included): a sensitivity line beside the verdict on every vote."""
    first = [v for v in votes if v.get("round") == 1]
    verdict = ranking.analyse([ranking.outcome(v["left"], v["right"], v["choice"]) for v in first], entrants, anchor,
                              resamples=resamples, seed=seed)
    return {"votes": len(first), "h1_above": verdict["h1_above"], "h1_k": verdict["h1_k"],
            "h1_lower": {r["entrant"]: r["h1_lower"] for r in verdict["rows"] if r["h1_lower"] is not None}}
```

Replace the body of `_summarize` (Task 5's version) with:

```python
    meta = cmp.meta
    events, digest = cmp.read_log()  # one read: the votes, the retractions and the digest come from the same bytes
    active = active_from_events(events)
    votes = [active[k] for k in sorted(active)]
    entrants = sorted(meta["entrants"])
    anchor = meta["anchor"]
    pooled = bool(meta.get("builds_on"))
    if pooled:
        earlier, sources = _pooled(meta, root)
        rated = earlier + _tag_all(votes, meta, cmp.run_id)
    else:
        rated = votes
    verdict = ranking.analyse([ranking.outcome(v["left"], v["right"], v["choice"]) for v in rated], entrants,
                              anchor, resamples=resamples, seed=meta["seed"])
    rows = verdict["rows"]
    counts = tallies(entrants, rated)
    # The H1 verdict and the challengers above the anchor both come from analyse(), decided on the
    # unrounded bootstrap points; h1 is bool(h1_above).
    above = verdict["h1_above"]
    data = {
        "run_id": meta["run_id"],
        "status": meta["status"],
        "votes_digest": digest,
        "votes": len(votes),
        "retracted": sum(e["type"] == "retract" for e in events),
        "scheduled": len(meta["schedule"]),
        "rounds": meta["rounds"],
        "round2_duels": meta["round2_duels"],
        "anchor": anchor,
        "bootstrap": {"resamples": resamples, "seed": meta["seed"]},
        "ranking": [dict(r, **counts[r["entrant"]]) for r in rows],
        "h1": {"holds": verdict["h1"], "above_anchor": above},
        "h1_k": verdict["h1_k"],
        "self_consistency": self_consistency(meta, active),
        "win_rate_by_type": win_rate_by_type(meta, rated),
        "median_seconds": round(statistics.median(v["seconds"] for v in votes), 1) if votes else None,
        "checks": check_table(meta, root),
    }
    if pooled:
        data["pooled"] = {
            "builds_on": list(meta["builds_on"]),
            "new_entrants": list(meta.get("new_entrants") or []),
            "votes": len(rated),
            "sources": sources,
            "note": ("ranking, its counts, H1 and win rates use the pooled votes; votes, self-consistency and "
                     "median_seconds are this comparison's own"),
        }
        data["sensitivity"] = {"round1_only": _round1_h1(rated, entrants, anchor, resamples, meta["seed"])}
    return data, verdict["raw"]
```

Replace the freshness-key helpers and `current_results` with:

```python
def _key(digest: Any, status: Any, resamples: Any, seed: Any, scheduled: Any, rounds: Any, round2_duels: Any,
         sources: Any) -> tuple:
    return (digest, status, resamples, seed, scheduled, rounds, round2_duels, sources)


def _stored_key(data: Mapping[str, Any]) -> tuple:
    bootstrap = data.get("bootstrap") or {}
    return _key(data.get("votes_digest"), data.get("status"), bootstrap.get("resamples"), bootstrap.get("seed"),
                data.get("scheduled"), data.get("rounds"), data.get("round2_duels"), (data.get("pooled") or {}).get("sources"))


def _current_key(cmp: CompareRun, resamples: int, root: Path | None) -> tuple:
    """What results.json must match to be reused: the votes (digest), the status, the bootstrap, the schedule's
    length, rounds and round-2 count, and, for a pooled comparison, what was read from the earlier ones. A
    comparison that builds on none has None there, as its stored results.json does."""
    meta = cmp.meta
    sources = _pooled(meta, root)[1] if meta.get("builds_on") else None
    return _key(cmp.read_log()[1], meta["status"], resamples, meta["seed"], len(meta["schedule"]),
                meta["rounds"], meta["round2_duels"], sources)


def current_results(cmp: CompareRun, *, resamples: int = ranking.RESAMPLES, root: Path | None = None) -> dict[str, Any]:
    """results.json if its freshness key matches the comparison as it is now; otherwise recomputed and rewritten."""
    path = cmp.path / "results.json"
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        if _stored_key(data) == _current_key(cmp, resamples, root):
            return data
    return write_results(cmp, resamples=resamples, root=root)
```

In `advance`, replace (Task 5's lines)

```python
    if room > 0 and schedule.needs_round2(decision):
        pages = [schedule.SchedPage(p["key"], p["type"]) for p in meta["pages"]]
        batch = schedule.round2_batch([r["entrant"] for r in decision], pages, meta["schedule"],
                                      meta["seed"], meta["rounds"], room)
```

with

```python
    new = meta.get("new_entrants") or None  # an added comparison: round 2 only for its new methods' pairs
    if room > 0 and schedule.needs_round2(decision, new=new):
        pages = [schedule.SchedPage(p["key"], p["type"]) for p in meta["pages"]]
        batch = schedule.round2_batch([r["entrant"] for r in decision], pages, meta["schedule"],
                                      meta["seed"], meta["rounds"], room, only_with=new)
```

- [ ] **Step 4: Run every parser-bench test**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_*.py -q`
Expected: all pass, `test_a_plan2_comparison_summarizes_exactly_as_before` included.

- [ ] **Step 5: Commit**

```bash
git add backend/eval/parser_bench/results.py backend/tests/unit/test_parser_bench_results.py
git commit -m "feat(parser-bench): one rating scale — pooled votes, round-1-only H1 line, round 2 for new methods

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The viewer: the cost OK, "key file missing", a run's cost, the pooled scoreboard

**Files:**
- Modify: `backend/eval/parser_bench/viewer/src/api.ts`, `lib.ts`, `lib.test.ts`
- Modify: `backend/eval/parser_bench/viewer/src/screens/NewRun.tsx`, `Runs.tsx`, `Scoreboard.tsx`

**Interfaces:**
- Consumes: `/api/methods` paid fields, `/api/estimate`, `POST /api/jobs` with `cost_ok` (Task 11); run detail `cost` (Task 11); results `pooled` and `sensitivity` (Task 14).
- Produces:
  - Types `Estimate`, `Cost`; `Method` gains `paid`, `model`, `key_missing`, `needs_install`; `RunRow.cost_usd`; `RunDetail.cost/pages_sent/api_pages`; `Results.pooled/sensitivity`; `Job.cost_ok/estimate`.
  - `api.estimate(sha, tools, purpose)`; `api.startJobs({..., cost_ok})`.
  - `lib.usd(value)`, `lib.estimateLine(e)`, `lib.costLine(c)`, `lib.methodState(m) -> "ready" | "install" | "key" | "missing"`.
  - New run: ticking a paid method and pressing Run shows a confirm panel (page count, model, estimate, at most) with **Send and run** and **Cancel**; nothing is queued before **Send and run**. A paid method whose only gap is the key shows "key file missing".

- [ ] **Step 1: Write the failing tests**

In `backend/eval/parser_bench/viewer/src/lib.test.ts`, extend the imports to

```ts
import type { Checks, Cost, Estimate, Job, Method } from "./api";
import { KEY_CHOICE, axis, checkChips, costLine, dash, estimateLine, jobLabel, methodState, minutesLeft, newSession, pct, splitFooter, usd } from "./lib";
```

and add at the end:

```ts
describe("paid methods", () => {
  it("show dollars to the cent", () => {
    expect([usd(0.0634), usd(0.004), usd(0), usd(1.005)]).toEqual(["$0.06", "<$0.01", "$0.00", "$1.00"]);
  });

  it("say what is sent where before the cost OK", () => {
    const e: Estimate = { tool: "ai_vision", label: "AI vision", model: "gpt-4.1-mini", pages: 24, usd: 0.0634, max_usd: 0.6541 };
    expect(estimateLine(e)).toBe("AI vision: 24 page images to OpenAI (gpt-4.1-mini), about $0.06, at most $0.65");
    expect(estimateLine({ ...e, pages: 1 })).toContain("1 page image to");
  });

  it("say what a run spent", () => {
    const c: Cost = {
      requests: 6, prompt_tokens: 15600, completion_tokens: 2100, cached_tokens: 0, reasoning_tokens: 0, usd: 0.0096,
      price: { model: "gpt-4.1-mini", input_per_m: 0.4, output_per_m: 1.6, checked_on: "2026-10-31", source: "https://x" },
    };
    expect(costLine(c)).toBe("6 requests · 15,600 input + 2,100 output tokens · $0.01 at the price of 2026-10-31");
  });

  it("name what a method still needs", () => {
    const m: Method = {
      id: "ai_vision", label: "AI vision", group: "paid", description: "", ready: false, missing: ["key file missing (~/x)"],
      size_mb: 60, needs_install: false, paid: true, model: "gpt-4.1-mini", key_missing: true,
    };
    expect(methodState(m)).toBe("key");
    expect(methodState({ ...m, needs_install: true })).toBe("install");
    expect(methodState({ ...m, ready: true })).toBe("ready");
    expect(methodState({ ...m, key_missing: false })).toBe("missing");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `$NODE node_modules/vitest/vitest.mjs run --config backend/eval/parser_bench/viewer/vite.config.ts`
Expected: FAIL (`costLine` is not exported, types missing).

- [ ] **Step 3: Types and the API client**

In `backend/eval/parser_bench/viewer/src/api.ts`:

Add to `RunRow`: `cost_usd?: number | null;`

Add to `RunDetail`: `cost?: Cost | null; pages_sent?: number[] | null; api_pages?: Record<string, unknown> | null;`

Add to `Results`:

```ts
  /** Only for a comparison that builds on finished ones: the ratings pool their votes with its own. */
  pooled?: {
    builds_on: string[];
    new_entrants: string[];
    votes: number;
    sources: Record<string, { status: string; votes: number; votes_digest: string }>;
    note: string;
  };
  sensitivity?: { round1_only: { votes: number; h1_above: string[]; h1_k: number; h1_lower: Record<string, number> } };
```

Replace `Method` with:

```ts
export interface Method {
  id: string;
  label: string;
  group: "fast" | "heavy" | "paid";
  description: string;
  ready: boolean;
  missing: string[];
  size_mb: number;
  needs_install: boolean;
  paid: boolean;
  model: string | null;
  /** Paid methods: the key file is missing or not private; null for the others. */
  key_missing: boolean | null;
}

export interface Estimate {
  tool: string;
  label: string;
  model: string;
  pages: number;
  usd: number;
  max_usd: number;
}

export interface Cost {
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  usd: number;
  price: { model: string; input_per_m: number; output_per_m: number; checked_on: string; source: string };
}
```

Add to `Job`: `cost_ok?: boolean; estimate?: Omit<Estimate, "tool" | "label"> | null;`

In `api`, replace `startJobs` and add `estimate`:

```ts
  startJobs: (body: { sha256: string; tools: string[]; purpose: string; cost_ok?: boolean }) => post<{ jobs: Job[] }>("/api/jobs", body),
  estimate: (sha: string, tools: string[], purpose: string) =>
    call<{ file: string; purpose: string; estimates: Estimate[] }>(
      `/api/estimate?sha256=${q(sha)}&tools=${q(tools.join(","))}&purpose=${q(purpose)}`,
    ),
```

- [ ] **Step 4: The helpers**

In `backend/eval/parser_bench/viewer/src/lib.ts`, change the type import to `import type { Checks, Choice, Cost, Estimate, Job, Method } from "./api";` and add at the end:

```ts
/** Dollars as the cost OK shows them: to the cent, and "<$0.01" for less than half a cent (as paid.usd). */
export function usd(value: number): string {
  if (value > 0 && value < 0.005) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/** One line per paid method for the cost OK: what is sent where, and what it should cost. */
export function estimateLine(e: Estimate): string {
  const images = `${e.pages} page image${e.pages === 1 ? "" : "s"}`;
  return `${e.label}: ${images} to OpenAI (${e.model}), about ${usd(e.usd)}, at most ${usd(e.max_usd)}`;
}

/** What a paid run spent, from the API's own usage, at the recorded price. */
export function costLine(c: Cost): string {
  const n = (v: number) => v.toLocaleString("en");
  return `${c.requests} request${c.requests === 1 ? "" : "s"} · ${n(c.prompt_tokens)} input + ${n(c.completion_tokens)} output tokens · ${usd(c.usd)} at the price of ${c.price.checked_on}`;
}

/** The status cell of a method on New run. */
export function methodState(m: Method): "ready" | "install" | "key" | "missing" {
  if (m.ready) return "ready";
  if (m.needs_install) return "install";
  if (m.paid && m.key_missing) return "key";
  return "missing";
}
```

(`(1.005).toFixed(2)` is `"1.00"` in JavaScript too, so both sides agree.)

- [ ] **Step 5: New run with the cost OK**

Replace `backend/eval/parser_bench/viewer/src/screens/NewRun.tsx` with:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Estimate, type Job, type Method, type StoredFile } from "../api";
import { estimateLine, jobLabel, methodState } from "../lib";

const GROUPS: [Method["group"], string][] = [
  ["fast", "Fast (seconds, nothing to download)"],
  ["heavy", "Heavy (minutes, models download once)"],
  ["paid", "Costs money (sends page images to OpenAI)"],
];

function MethodStatus({ m, onInstall }: { m: Method; onInstall: (id: string) => void }) {
  const state = methodState(m);
  if (state === "ready")
    return (
      <>
        <span className="dot ready" />
        ready
      </>
    );
  if (state === "install")
    return (
      <button
        className="linkbtn"
        title={m.missing.join("; ")}
        onClick={(e) => {
          e.preventDefault();
          onInstall(m.id);
        }}
      >
        install · {m.size_mb} MB
      </button>
    );
  return (
    <span className="small" title={m.missing.join("; ")}>
      {state === "key" ? "key file missing" : "not ready"}
    </span>
  );
}

/** Drop a PDF, tick methods, pick Explore or Benchmark set, run them as background jobs. A paid method is
 * never started by one click: its page count and estimated cost are shown first (spec "New run"). */
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
  const starting = useRef(false); // a double click must not queue the runs twice
  const [startingRuns, setStartingRuns] = useState(false);
  const [confirm, setConfirm] = useState<Estimate[] | null>(null);
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
  // an OK is for exactly what it showed: another file, mode or choice of methods needs a new one
  useEffect(() => {
    setConfirm(null);
  }, [file, purpose, picked]);

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

  const chosen = () => methods.filter((m) => m.ready && picked.has(m.id)).map((m) => m.id);

  const start = async (costOk: boolean) => {
    if (!file || starting.current) return;
    starting.current = true;
    setStartingRuns(true);
    setError(null);
    try {
      const r = await api.startJobs({ sha256: file.sha256, tools: chosen(), purpose, cost_ok: costOk });
      setMine(r.jobs.map((j) => j.job_id));
      setConfirm(null);
      loadJobs();
      notify(`${r.jobs.length} run${r.jobs.length === 1 ? "" : "s"} queued`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      starting.current = false;
      setStartingRuns(false);
    }
  };

  const run = async () => {
    if (!file || starting.current) return;
    if (!methods.some((m) => m.ready && m.paid && picked.has(m.id))) return start(false);
    setError(null);
    try {
      setConfirm((await api.estimate(file.sha256, chosen(), purpose)).estimates);
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
                const selected = e.target.files?.[0];
                if (selected) upload(selected);
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
            <button className="vote primary" disabled={!file || count === 0 || startingRuns || confirm !== null} onClick={run}>
              Run {count} method{count === 1 ? "" : "s"}
            </button>
            <span className="small">One method at a time, in the background.</span>
          </div>
          {confirm ? (
            <div className="panel spaced">
              <b>This sends page images to OpenAI and costs money.</b>
              {confirm.map((e) => (
                <div key={e.tool} className="small">
                  {estimateLine(e)}
                </div>
              ))}
              <div className="runbar">
                <button className="vote primary" disabled={startingRuns} onClick={() => start(true)}>
                  Send and run
                </button>
                <button className="linkbtn" onClick={() => setConfirm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
          <div className="prog">
            {shown.map((j) => (
              <div key={j.job_id} className="prow">
                <span>{methods.find((m) => m.id === j.tool)?.label ?? j.tool}</span>
                <span className={`small ${j.state}`}>{jobLabel(j)}</span>
                {j.state === "queued" || j.state === "running" ? (
                  <button className="linkbtn" onClick={() => api.cancel(j.job_id).then(loadJobs).catch((e: Error) => notify(e.message))}>
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
                      <div className="ds">
                        {m.description}
                        {m.model ? ` · ${m.model}` : ""}
                      </div>
                    </div>
                    <div className="st">
                      <MethodStatus m={m} onInstall={install} />
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

- [ ] **Step 6: A run's cost and the pooled scoreboard**

In `backend/eval/parser_bench/viewer/src/screens/Runs.tsx`, change the lib import to `import { costLine, dash, jobLabel, shortDate } from "../lib";` and after the line

```tsx
      {run.environment ? <p className="small mono">{run.environment.join("  ·  ")}</p> : null}
```

add

```tsx
      {run.cost ? <p className="small">OpenAI: {costLine(run.cost)}</p> : null}
```

In `backend/eval/parser_bench/viewer/src/screens/Scoreboard.tsx`, right after the paragraph that ends with `{data.round2_duels ? \` Round 2 added ${data.round2_duels} duels.\` : ""}` and its closing `</p>`, add:

```tsx
      {data.pooled ? (
        <p className="small">
          One scale: these ratings pool this comparison's votes with {data.pooled.builds_on.join(", ")} ({data.pooled.votes} votes
          in all), with our current extraction at 1000. Self-consistency and decision time are this comparison's own.
          {data.sensitivity
            ? ` On round-1 duels alone (${data.sensitivity.round1_only.votes} votes), H1 holds for: ${
                data.sensitivity.round1_only.h1_above.map(name).join(", ") || "none"
              }.`
            : ""}
        </p>
      ) : null}
```

- [ ] **Step 7: Run the viewer checks and build**

Run:

```bash
$NODE node_modules/vitest/vitest.mjs run --config backend/eval/parser_bench/viewer/vite.config.ts
$NODE node_modules/typescript/bin/tsc -p backend/eval/parser_bench/viewer/tsconfig.json
$NODE node_modules/eslint/bin/eslint.js backend/eval/parser_bench/viewer/src
$NODE node_modules/vite/bin/vite.js build --config backend/eval/parser_bench/viewer/vite.config.ts
```

Expected: tests pass, no type or lint errors, the build writes `viewer/dist/` (git-ignored).

- [ ] **Step 8: Look at it in the browser**

Start the `parser-bench` preview (`preview_start` with name `parser-bench`; restart it if it is running, so the new server code loads). On **New run**, check that:
- the group "Costs money (sends page images to OpenAI)" lists "AI vision" and "AI vision, stronger model";
- each shows "install · 60 MB" (no environment yet) or "key file missing" (environment, no key), never a tick box you can tick;
- the console shows no errors.

Do not install anything here and do not create a key file. Stop the preview afterwards.

- [ ] **Step 9: Commit**

```bash
git add backend/eval/parser_bench/viewer/src/api.ts backend/eval/parser_bench/viewer/src/lib.ts \
  backend/eval/parser_bench/viewer/src/lib.test.ts backend/eval/parser_bench/viewer/src/screens/NewRun.tsx \
  backend/eval/parser_bench/viewer/src/screens/Runs.tsx backend/eval/parser_bench/viewer/src/screens/Scoreboard.tsx
git commit -m "feat(parser-bench): viewer — cost OK before a paid run, key file missing, run cost, pooled scoreboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 16: The protocol step: the key, the stronger model, the prices, Deviation 2 — STOP for Abi

**Files:**
- Modify: `backend/eval/parser_bench/tools.py` (`AI_VISION_STRONG_MODEL`; `temperature=None` for a method that rejects 0, only if the probe shows it)
- Modify: `backend/eval/parser_bench/paid.py` (`PRICES`: re-checked `gpt-4.1-mini` row, the stronger model's row)
- Modify: `backend/tests/unit/test_parser_bench_tools.py` (the pin of the paid models to the protocol)
- Modify: `docs/thesis/experiments/parser-benchmark/PROTOCOL.md` (Deviation 2)
- Modify: `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md` (contenders, Safety)
- Modify: `docs/thesis/experiments/parser-benchmark/LAB_LOG.md`
- Data (outside git): the paid methods' environments; two explore probe runs on a synthetic page.

**Interfaces:**
- Consumes: Tasks 1–15; `python -m backend.eval.parser_bench tools|install|models|run`.
- Produces: one commit holding the model ids, the prices and Deviation 2. It becomes the protocol commit (`execute.protocol_commit()`), and `execute.benchmark_gate()` passes at it.

Everything before this task changed bench code, so benchmark runs are refused until this commit lands (Task 4). Remember the key rules: **only Abi creates the key file**; an agent never opens, prints, copies or pastes it.

- [ ] **Step 1: Pre-flight**

```bash
git status --short
$PY -m pytest backend/tests/unit/test_parser_bench_*.py -q
$PY -c "from backend.eval.parser_bench import execute; print(execute.protocol_commit()); print(execute.bench_drift(execute.protocol_commit()))"
```

Expected: a clean tree, every test green, the protocol commit `e07f5c9f…`, and a non-empty drift list (Tasks 1–15). That drift is what this task's deviation records.

- [ ] **Step 2: Abi creates the key file (Abi, not the agent)**

Ask Abi to run this in his own terminal, with the OpenAI key on the clipboard:

```bash
mkdir -p ~/.config/learnstation-parser-bench && chmod 700 ~/.config/learnstation-parser-bench
( umask 077 && pbpaste > ~/.config/learnstation-parser-bench/openai_key )
chmod 600 ~/.config/learnstation-parser-bench/openai_key
```

Then check without reading it:

```bash
$PY -m backend.eval.parser_bench tools
```

Expected: `ai_vision` and `ai_vision_strong` no longer say "key file …"; they still need their environment, and `ai_vision_strong` needs its model id.

- [ ] **Step 3: Install the two environments**

```bash
$PY -m backend.eval.parser_bench install ai_vision
$PY -m backend.eval.parser_bench install ai_vision_strong
```

Expected: each prints its package list with `pymupdf==1.27.1` (the import check of `pymupdf` passed). Note the Python version line for the deviation.

- [ ] **Step 4: List the live models (free) and choose the stronger one with Abi**

```bash
$PY -m backend.eval.parser_bench models
```

Show Abi the list. Recommend one id by these rules, and let Abi decide:
- a current, generally available, non-mini, non-nano model that takes image input on chat completions;
- stronger than `gpt-4.1-mini` by OpenAI's own positioning;
- a stable id, not a moving alias such as `*-chat-latest`;
- if several fit, the newest flagship.

Write down the chosen id and the reason in one sentence.

- [ ] **Step 5: Set the id and the prices**

Open OpenAI's pricing page (`https://platform.openai.com/docs/pricing`, Standard tier) and read the input and output price per 1M tokens of `gpt-4.1-mini` and of the chosen model. Note today's date.

In `backend/eval/parser_bench/tools.py` set `AI_VISION_STRONG_MODEL = "<chosen id>"`.

In `backend/eval/parser_bench/paid.py`, replace `PRICES` with (numbers from the page; `checked_on` = today):

```python
PRICES: dict[str, Price] = {
    # gpt-4.1-mini reads a page image as at most 1,536 patches × 1.62 ≈ 2,490 tokens; the prompt adds ~40.
    "gpt-4.1-mini": Price(<input>, <output>, 2_600, 1_000, "<YYYY-MM-DD>", "https://platform.openai.com/docs/pricing"),
    # <chosen id>: input estimate from the probe (Step 6), output 1,000 per page, or 4,000 for a reasoning model.
    "<chosen id>": Price(<input>, <output>, <est input>, <est output>, "<YYYY-MM-DD>", "https://platform.openai.com/docs/pricing"),
}
```

Before the probe, use 3,000 as the stronger model's input estimate; Step 6 replaces it.

- [ ] **Step 6: Probe each paid method once on a synthetic page (no lecture content)**

```bash
$PY - <<'PY'
import os
import fitz
out = os.path.expanduser("~/Documents/learnstation-parser-bench/probe/probe.pdf")
os.makedirs(os.path.dirname(out), exist_ok=True)
doc = fitz.open()
page = doc.new_page(width=842, height=595)  # the size of a landscape slide; the probe page holds no course content
page.insert_text((60, 110), "Probe page", fontsize=28)
page.insert_text((60, 170), "- a first point", fontsize=16)
page.insert_text((60, 200), "- a second point", fontsize=16)
page.insert_text((60, 250), "Plain text that is not from a lecture.", fontsize=16)
doc.save(out)
PY
$PY -m backend.eval.parser_bench run ai_vision ~/Documents/learnstation-parser-bench/probe/probe.pdf --cost-ok
$PY -m backend.eval.parser_bench run ai_vision_strong ~/Documents/learnstation-parser-bench/probe/probe.pdf --cost-ok
```

Expected: each prints its estimate line, then `<run_id>  finished …`. For each probe run, read its `run.json` (not the key) and note: `version` (the snapshot the API answered with), `settings.temperature`, `api_usage.pages["1"].prompt_tokens`, `completion_tokens`, `reasoning_tokens`, `finish_reason`, and `cost.usd`. Look at the probe's own output page (synthetic, not a benchmark page): note whether it is wrapped in a code fence. The prompt is not changed either way (that would be tuning); the observation goes into the deviation.

If a probe fails with `the model rejects temperature=0.0`, set `temperature=None` on that method's `Tool(...)` entry in `tools.py` (it then sends no temperature, and the record says "model default"), run that probe again, and note the API's error code for the deviation. Any other failure: stop and tell the controller.

Then set the stronger model's `est_input_tokens` to its probe `prompt_tokens` rounded up to the next 100, and if `gpt-4.1-mini`'s probe `prompt_tokens` is above 2,600, raise its estimate the same way. Set the stronger model's `est_output_tokens` to 4,000 if its probe reported `reasoning_tokens` > 0, else 1,000.

- [ ] **Step 7: Pin the models to the protocol**

In `backend/tests/unit/test_parser_bench_tools.py` add (with `from backend.eval.parser_bench import store` and `import importlib.util` in the imports):

```python
def test_the_paid_methods_are_set_priced_and_named_in_the_protocol():
    protocol = (store.REPO / "docs/thesis/experiments/parser-benchmark/PROTOCOL.md").read_text(encoding="utf-8")
    for tool_id in ("ai_vision", "ai_vision_strong"):
        model = tools.TOOLS[tool_id].model
        assert model and f"`{model}`" in protocol and model in paid.PRICES
    spec = importlib.util.spec_from_file_location("ai_vision_runner", tools.TOOLS["ai_vision"].runner_path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    assert runner.PROMPT in protocol
```

- [ ] **Step 8: Write Deviation 2**

Append to `docs/thesis/experiments/parser-benchmark/PROTOCOL.md`, filling every `⟨…⟩` from Steps 3–6 (and nothing else):

```markdown

**2. ⟨YYYY-MM-DD⟩, before any paid run and before the second comparison: two paid methods, the second comparison, and a stricter run gate.** The text above stays; where this deviation and the text above differ, this deviation applies from this commit on.

*Two paid methods.*
- **`ai_vision`** sends each page image to `gpt-4.1-mini`. The model id is production's vision model: `OPENAI_VISION_MODEL` defaults to `OPENAI_MODEL`, whose launch setting is `gpt-4.1-mini` (`.env.example`). It was taken from there; the production environment itself was not read. The API answered the probe as `⟨snapshot⟩`.
- **`ai_vision_strong`** sends the same image with the same prompt to `⟨chosen id⟩`, chosen with Abi on ⟨date⟩ from the account's live model list because ⟨one-sentence reason⟩. The API answered the probe as `⟨snapshot⟩`.
- **What runs.** Each in its own `uv` environment, ⟨Python version line⟩, with `pymupdf==1.27.1` (production's version) to render the pages and Python's own `urllib` for the requests. No OpenAI SDK: it reads `OPENAI_*` and proxy variables from the environment and retries on its own; here the endpoint is fixed (`https://api.openai.com/v1/chat/completions`), proxies are ignored, and every attempt is recorded. Licence: OpenAI's API terms (a hosted model; no local weights).
- **Settings, exactly.** Each page the run scores is rendered at zoom 2 as a PNG and sent as a data URL (image `detail` not set, the API default). One request per page, one user message: the prompt, then the image. The prompt, word for word: "Transcribe this page to Markdown. Add nothing: no introduction, no comment, no code fence around the answer." Temperature 0 ⟨or, for `⟨id⟩`: not sent, because the model rejects 0 (API error `⟨code⟩`); it runs at its default⟩. `max_completion_tokens` 16384. A request times out after 120 s. HTTP 429 (except `insufficient_quota`), 500, 502, 503, 504, timeouts and lost connections are retried, 4 attempts in all, waiting the `Retry-After` header (at most 30 s) or 2, 4, 8 s; every attempt is recorded per page. A page that still fails, or answers empty, fails the run; the run keeps what was paid for. A truncated answer (`finish_reason` "length") is kept and its usage record says so. The probe outputs ⟨were / were not⟩ wrapped in a code fence; the prompt was not changed.
- **The key** is read only from `~/.config/learnstation-parser-bench/openai_key` (mode 0600). It is never printed, logged or stored; the runner gets its path.
- **Cost.** Each run asks for an explicit OK showing its page count and estimated cost (`--cost-ok` on the command line; a confirm step on the webpage; the server refuses without it). Prices (Standard tier, per 1M input / output tokens), read on ⟨date⟩ from `https://platform.openai.com/docs/pricing`: `gpt-4.1-mini` $⟨in⟩ / $⟨out⟩; `⟨chosen id⟩` $⟨in⟩ / $⟨out⟩. The estimate uses ⟨n⟩ input and ⟨n⟩ output tokens per page for `gpt-4.1-mini` and ⟨n⟩ / ⟨n⟩ for `⟨chosen id⟩`; "at most" assumes every page writes 16384 tokens. Each run records the API's usage per page, the model id it answered with (`response.model`), the request time, and the cost at the recorded price (cached input at the full price, so an upper bound; not the invoice). Estimated for the 24 benchmark pages: `gpt-4.1-mini` ⟨$⟩ (at most ⟨$⟩), `⟨chosen id⟩` ⟨$⟩ (at most ⟨$⟩).

*Run procedure (§8) for paid methods.*
- **Input.** A paid method is sent only the page set's pages of each PDF, rendered on this Mac; it never receives the whole PDF. Explore runs send the pages asked for, every page by default, and also need the cost OK.
- **No warm-up.** The warm-up exists so a first-time model download is never timed. A hosted API downloads nothing here, and a warm-up would send two more page images (pages 1–2 of a deck, not all in the page set) and pay for them. Paid methods skip it, also as benchmark runs; `run.json` says so (`warmup_skipped`). Cost consequence: none extra; the first timed request includes setting up the connection.
- **Timing.** Seconds per page for a paid method are the wall-clock time over the pages *sent*, not the pages in the file (`seconds_per_page_basis`). They are network-bound and include OpenAI's queueing, so they are reported, not compared with the local methods. Peak memory is the runner's own, not the model's.
- **Data leaving the Mac.** The spec allows "24 page images to OpenAI"; with two paid methods the same 24 page images go out once per method (48 requests), plus one synthetic probe page per method that holds no course content.

*Run gate (header, §8).* From this commit, a benchmark run or comparison is also refused when `backend/eval/parser_bench/`, this file or `pages.json` changed between the protocol commit and HEAD, and every benchmark run and comparison records `bench_tree` (one hash of those three at HEAD). The 25 fast runs made under `e07f5c9f` predate this and record no tree; the second comparison uses them by run id.

*Blinding (§5).*
- **By method.** An output of a page-set page now opens per method: only after a finished (or early-unlocked) comparison had that method among its entrants. Before, the first comparison's end opened the 24 pages for every method, `ai_vision` included.
- **No round shown.** From this commit the judging screen shows no round number and no "round 2 adds" message. The duel count still grows when round 2 adds duels, so the judge can still tell that round 2 started.
- **Sides (wording).** §5 and §6 say the sides are "drawn at random". Since 8f70b7ef the schedule sets them by a seeded balancing walk, so each method is on the left within one duel of half its appearances, and the order of duels is shuffled with the seed. The first comparison was scheduled this way; only the wording is corrected here.

*Export.* An exported `votes.jsonl` keeps every line byte for byte, except that a note becomes null (a note may quote a slide). `export.json` records the original digest, the exported digest and how many notes were blanked, so the export can be checked against `results.json`.

*The second comparison (design decision 9).*
- **Entrants.** The five fast methods, with the runs `cmp-2026-10-30_8825` judged (named by run id from its `compare.json`, made under `e07f5c9f`), and `ai_vision` and `ai_vision_strong`, with their newest finished benchmark runs under this commit. `compare.json` records `builds_on: ["cmp-2026-10-30_8825"]`, `new_entrants` and each entrant's protocol commit and bench tree (`provenance`).
- **Round 1.** Only the pairs with a new method: 2 × 5 + 1 = 11 pairs × 3 duels on three page types = 33, plus round(33 / 9) = 4 hidden repeats at least 12 apart: 37 duels. The schedule seed is **20261101**, fixed in the implementation plan before any vote.
- **One scale.** Bradley–Terry is fitted over every counted vote of `cmp-2026-10-30_8825` (read, never changed) and of the second comparison, with `current` = 1000 and the same prior; the bootstrap resamples the pooled votes 1,000 times, seeded with 20261101. The five fast methods' points therefore move a little from the first comparison's; its `results.json` stays as it was.
- **H1** is decided on the pooled fit with Bonferroni over all k = 6 challengers. The first comparison's verdict (k = 4) stays recorded as an interim result; the thesis reports the pooled one. As a sensitivity line, H1 is also computed on round-1 duels alone (hidden repeats included), because round 2 runs only when round 1 left the top two overlapping (§9, optional stopping).
- **Round 2 (§6, per comparison).** It asks §6's question on the pooled ratings, comparing unrounded intervals: it runs only while the top two overlap **and** one of them is a new method. Each batch gives 3 more duels to every adjacent pair among the top four that involves a new method; old pairs were settled under the first comparison's own rule and cap, and judging them again now would be less blind. No hidden repeats; at most 75 extra duels.
- **Rounding.** The first comparison's stopping rule compared intervals rounded to 0.1 point; from this commit it compares unrounded values.

*Threats (§9), added.*
- `ai_vision` is not fully deterministic at temperature 0. Each paid method runs once; the snapshot id and the request time of every page are recorded.
- The model behind an id can change on OpenAI's side; the recorded snapshot id is what was run.
- Paid outputs may be recognisable by their style (consistent Markdown headings), so the second comparison is less blind for them, besides Abi having seen the fast methods' outputs with names (§9).
- Page-by-page methods (`markitdown`, both paid methods) lose cross-page context.
- A paid method's timing is network-bound and is not a cost on this hardware.
- The 24 page images leave the Mac under OpenAI's API terms; no other benchmark data does.
```

- [ ] **Step 9: Record the new methods in the spec**

In `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md`:
- In the Contenders table, after the `ai_vision` row, add the row ``| `ai_vision_strong` | The same page image and prompt sent to one current stronger OpenAI model, chosen from the account's live models | Added 2026-10-30 by Abi; model id, prices and settings in PROTOCOL.md deviation 2. Only the 24 pages are sent. |``.
- In Safety, replace "Only `ai_vision` sends data off the Mac: 24 page images to OpenAI." with "Only the paid methods (`ai_vision`, `ai_vision_strong`) send data off the Mac: the 24 page images, once per paid method, to OpenAI."

- [ ] **Step 10: STOP — Abi confirms the model and the cost**

Show Abi, and wait for a clear yes:
- the stronger model id and the reason;
- the prices with their date and source;
- `$PY -c "from backend.eval.parser_bench import paid; print(paid.estimate('gpt-4.1-mini', 24).line('ai_vision')); print(paid.estimate('<chosen id>', 24).line('ai_vision_strong'))"`;
- the probes' snapshot ids, temperature handling and cost;
- the Deviation 2 text.

If Abi changes anything, change it and show it again. Do not commit before the yes.

- [ ] **Step 11: Commit and check the gate**

```bash
$PY -m pytest backend/tests/unit/test_parser_bench_*.py -q
git add backend/eval/parser_bench/tools.py backend/eval/parser_bench/paid.py backend/tests/unit/test_parser_bench_tools.py \
  docs/thesis/experiments/parser-benchmark/PROTOCOL.md docs/superpowers/specs/2026-10-30-parser-benchmark-design.md
git commit -m "docs(parser-bench): protocol deviation 2 — paid methods, the second comparison, a stricter run gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
$PY -c "from backend.eval.parser_bench import execute; print(execute.benchmark_gate())"
git rev-parse HEAD
```

Expected: tests green; `benchmark_gate()` prints `{'protocol_commit': '<HEAD sha>', 'bench_tree': '<64 hex>'}` with the protocol commit equal to `HEAD`.

- [ ] **Step 12: Log it**

Append to `LAB_LOG.md`:

```markdown

## ⟨YYYY-MM-DD⟩ — protocol deviation 2: paid methods, the second comparison

- Protocol commit ⟨sha⟩ (deviation 2). From it on, benchmark runs need the bench unchanged since the protocol commit, and record `bench_tree` ⟨first 12 hex⟩.
- Key file created by Abi (mode 0600). Environments: ai_vision and ai_vision_strong, ⟨Python line⟩, pymupdf 1.27.1.
- Models: ai_vision `gpt-4.1-mini` (answered as `⟨snapshot⟩`); ai_vision_strong `⟨id⟩` (answered as `⟨snapshot⟩`), chosen with Abi because ⟨reason⟩. Temperature: ⟨0 for both / not sent for ⟨id⟩, which rejects 0⟩.
- Prices read ⟨date⟩ from the OpenAI pricing page: ⟨rows⟩.
- Probes (one synthetic page each, no course content): ⟨tokens in/out⟩ and ⟨$⟩ per method; code fence ⟨yes/no⟩.
- Estimated cost of the 24 benchmark pages: ai_vision ⟨$⟩ (at most ⟨$⟩), ai_vision_strong ⟨$⟩ (at most ⟨$⟩). Confirmed by Abi.
```

```bash
git add docs/thesis/experiments/parser-benchmark/LAB_LOG.md
git commit -m "docs(parser-bench): lab log — deviation 2, the paid methods' setup and probes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(The lab log is not part of the bench, so this commit leaves the gate open.)

---

### Task 17: The second comparison: paid benchmark runs, the comparison, the viewer — STOP for Abi

**Files:**
- Modify: `docs/thesis/experiments/parser-benchmark/LAB_LOG.md`
- Data (outside git): 10 paid benchmark runs and one comparison under `~/Documents/learnstation-parser-bench/runs/`.

**Interfaces:**
- Consumes: the CLI (`run --purpose benchmark --cost-ok`, `compare create --against`, `compare status`), `results._round1_h1`, the built viewer and the `parser-bench` preview entry.
- Produces: a comparison `cmp-<date>_<4hex>` with 37 duels waiting for Abi; `cmp-2026-10-30_8825` unchanged.

Remember the blinding rule: do not vote, do not unlock, and do not report per-method check numbers or output text of benchmark pages. Cost figures and token counts are fine.

- [ ] **Step 1: Pre-flight**

```bash
$PY -m backend.eval.parser_bench tools
$PY -c "from backend.eval.parser_bench import execute; print(execute.benchmark_gate())"
df -h / | tail -1
shasum -a 256 ~/Documents/learnstation-parser-bench/runs/compare/cmp-2026-10-30_8825/{compare.json,votes.jsonl,results.json}
```

Expected: all seven methods `ready`; the gate passes with Task 16's protocol commit; note the free disk and the three hashes.

- [ ] **Step 2: Run the two paid methods on the five PDFs as benchmark runs**

```bash
for t in ai_vision ai_vision_strong; do
  for f in "Course SWT/Slides/2.pdf" "03 DBS Normalization.pdf" " 03__SR_Prozesse_v07_27.04.2025.pdf" "Course SWT/ueb01.pdf" "Course SWT/ueb02.pdf"; do
    $PY -m backend.eval.parser_bench run "$t" "$HOME/Downloads/$f" --purpose benchmark --cost-ok
  done
done
$PY -m backend.eval.parser_bench runs | head -15
```

Expected: per run, the estimate line (6, 6, 6, 3 and 3 page images) and `<run_id>  finished  <s> s/page, peak <MB> MB`; 24 page images per method in all.
- **A failure** prints its reason and exits 1; the run is kept with its usage and cost. If the reason is transient (`no answer after 4 attempts` on 429/5xx, a timeout), re-run that one method on that one file once and log both. If it is anything else (`rejects temperature`, `insufficient_quota`, an empty answer), stop and tell the controller: a change would need a protocol deviation.
- **Do not change code to make a run pass.**

- [ ] **Step 3: Add up what was spent (from the records, never the outputs)**

```bash
$PY - <<'PY'
from backend.eval.parser_bench import store
rows = [m for m in store.list_runs() if m.get("kind") == "extract" and m.get("tool", "").startswith("ai_vision")
        and m.get("purpose") == "benchmark"]
for m in sorted(rows, key=lambda m: m["started_at"]):
    c = m.get("cost") or {}
    print(m["run_id"], m["status"], m.get("version"), c.get("requests"), c.get("prompt_tokens"), c.get("completion_tokens"),
          c.get("reasoning_tokens"), c.get("usd"), m.get("seconds_per_page"))
for tool in ("ai_vision", "ai_vision_strong"):
    mine = [m.get("cost") or {} for m in rows if m["tool"] == tool]
    print(tool, "total $", round(sum(c.get("usd") or 0 for c in mine), 4),
          "tokens", sum(c.get("prompt_tokens") or 0 for c in mine), "/", sum(c.get("completion_tokens") or 0 for c in mine))
PY
```

Expected: 10 benchmark runs (plus any logged re-run), each with a snapshot `version`, 6 or 3 requests, and a cost; totals per method near the Task 16 estimate.

- [ ] **Step 4: Create the comparison**

```bash
$PY -m backend.eval.parser_bench compare create --tools ai_vision,ai_vision_strong --against cmp-2026-10-30_8825 --seed 20261101
$PY -m backend.eval.parser_bench compare status
```

Expected: `cmp-<date>_<4hex>  judging  0/37 duels`, its folder, then `… judging  0/37 duels` (no round shown) and `names and ranking stay hidden until judging is finished`.

- [ ] **Step 5: The first comparison is unchanged and still reproducible**

```bash
shasum -a 256 ~/Documents/learnstation-parser-bench/runs/compare/cmp-2026-10-30_8825/{compare.json,votes.jsonl,results.json}
$PY - <<'PY'
import json
from backend.eval.parser_bench import compare, results
base = compare.CompareRun.open("cmp-2026-10-30_8825")
stored = (base.path / "results.json").read_text(encoding="utf-8")
print("results recompute byte-identically:", json.dumps(results.summarize(base), ensure_ascii=False, indent=2) == stored)
meta = base.meta
active = base.active_votes()
votes = [dict(v, round=next(d["round"] for d in meta["schedule"] if d["duel"] == v["duel"])) for v in active.values()]
print("first comparison, round-1 duels only:", results._round1_h1(votes, sorted(meta["entrants"]), meta["anchor"], 1000, meta["seed"]))
PY
```

Expected: the same three hashes as in Step 1, `True`, and the round-1-only line for the first comparison. The Plan 2 final review measured that on round-1 duels alone only `pymupdf4llm` passes H1 (opendataloader's corrected bound about 928.5); if the numbers differ, report both to the controller.

- [ ] **Step 6: Log the runs and the comparison**

Append to `LAB_LOG.md`:

```markdown

## ⟨YYYY-MM-DD⟩ — paid benchmark runs and the second comparison

- Protocol commit ⟨sha⟩ (deviation 2), bench tree ⟨first 12 hex⟩; disk before ⟨GB free⟩, after ⟨GB free⟩.
- 10 paid benchmark runs (2 methods × 5 PDFs; only the page set's 24 pages sent per method): ⟨n⟩ finished, ⟨n⟩ failed (⟨method, file, reason⟩ or "none"). Re-runs: ⟨none / which and why⟩.
- Snapshots answered: ai_vision `⟨snapshot⟩`, ai_vision_strong `⟨snapshot⟩`.
- Spent (API usage at the recorded price; cached input at full price, an upper bound): ai_vision ⟨$⟩ (⟨prompt⟩ input, ⟨completion⟩ output tokens over ⟨n⟩ requests); ai_vision_strong ⟨$⟩ (⟨prompt⟩ / ⟨completion⟩ tokens, ⟨reasoning⟩ reasoning, ⟨n⟩ requests). Estimated beforehand: ⟨$⟩ and ⟨$⟩. Retries: ⟨n attempts beyond the first, by status⟩.
- Seconds per page sent (network-bound, not comparable with the local methods): ai_vision ⟨min–max⟩, ai_vision_strong ⟨min–max⟩.
- Comparison ⟨cmp id⟩: builds on cmp-2026-10-30_8825 (unchanged: compare.json, votes.jsonl and results.json hashes as before; results recompute byte-identically). Entrants: the five fast methods with the runs the first comparison judged (protocol e07f5c9f) and the two paid methods (protocol ⟨sha⟩). 33 round-1 duels (11 pairs × 3) + 4 hidden repeats = 37, schedule seed 20261101. Judging not started.
- Thesis note on the first comparison (sensitivity, deviation 2): on its round-1 duels alone (⟨n⟩ votes), H1 holds for ⟨list⟩ (Bonferroni lower bounds ⟨method: bound⟩); the verdict for opendataloader rests on round-2 votes, which ran only because round 1 left the top two overlapping (§9, optional stopping).
```

Only cost figures, token totals and the first comparison's already-open results go here. Nothing about the paid methods' outputs or checks on benchmark pages.

```bash
git add docs/thesis/experiments/parser-benchmark/LAB_LOG.md
git commit -m "docs(parser-bench): lab log — paid benchmark runs, cost, and the second comparison

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Open the viewer for Abi — STOP**

Build the viewer if `backend/eval/parser_bench/viewer/dist/index.html` is older than Task 15 (Task 15 Step 7). Start the `parser-bench` preview (`preview_start` with name `parser-bench`) and confirm in the browser pane that:
- **Judge** shows "Duel 1 of 37" with no round text;
- the pill reads `cmp-… · judging 0/37`;
- Compare and Scoreboard are marked locked for the new comparison;
- in **Runs**, an `ai_vision` benchmark run lists its pages as locked and shows its cost line, and no page output opens;
- the console shows no errors.

Do not press any vote key. Leave the server running and tell the controller the comparison id, the money spent per method, and that judging can start at `http://127.0.0.1:8766`. Abi judges; this plan ends here.

---

## Spec coverage (Plan 3a's share)

| Requirement | Task |
|---|---|
| `ai_vision`: page image at 2×, the pipeline's OpenAI vision model, "transcribe to Markdown, add nothing", temperature 0; model id verified live and recorded | 7, 8, 16 |
| `ai_vision_strong`: one stronger current model, chosen from the live list with Abi, one constant | 8, 16 |
| Only the requested pages are sent (benchmark: the page set's pages) | 7, 9 |
| Key only from the 0600 file; never printed, logged, stored or in errors; runner gets the path | 6, 7, 8, 9, 11 |
| Explicit cost OK per run with page count and estimated cost (CLI and webpage; server refuses without) | 6, 10, 11, 15 |
| Price table with date and source; actual usage, response model and request time per page; cost on the record | 6, 7, 9, 16 |
| Own `uv` environment, `pymupdf` pinned, import check; `urllib` with a fixed endpoint, no proxies | 7, 8, 16 |
| Timeouts and bounded retries recorded per page; a failing page fails the run without losing the cost | 7, 9 |
| Warm-up decision for paid methods; timing basis; network-bound timing as a threat | 9, 16 |
| New run: "Costs money" group, "key file missing", a confirm step | 11, 15 |
| Second comparison: 5 fast + 2 paid, only new-involving pairs, 37 duels, seed 20261101 | 12, 13, 17 |
| One scale (`current` = 1000), pooled Bradley–Terry and bootstrap, H1 over all challengers, round-1-only line | 14 |
| Stopping rule per comparison on pooled, unrounded intervals; new-involving adjacent top-4 pairs; cap 75 | 5, 12, 14 |
| First comparison read-only; its `results.json` reproducible; earlier runs by run id | 1, 13, 14, 17 |
| Protocol deviation before the first paid benchmark run, with a STOP for Abi | 16 |
| Plan 2 review: blinding by method; gate vs protocol commit with bench tree; export digest; round hidden; unrounded stopping rule; neutral fixture name; sides wording | 1, 2, 3, 4, 5, 16 |
| Tests never call the real API | 6, 7, 9, 10, 11 |
| Heavy methods (`docling`, `marker`, `mineru`, `paddleocr`), export of benchmark runs, `RESULTS.md`, figures, improvement loop | Plan 3b |
