# Parser Bench, Plan 3b: the heavy local methods and the third comparison — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four heavy local methods of the spec (`docling`, `marker`, `mineru`, `paddleocr`, and PaddleOCR-VL as a tried fifth), run them under the spec's 120 s/page limit on Abi's M1, and create the third blind comparison: pooled with both earlier comparisons on one scale, but judging only new×new pairs and new×{`ai_vision_strong`, `ai_vision`, `pymupdf4llm`, `current`}.

**Architecture:** Four layers on Plan 3a's code in `backend/eval/parser_bench/`:
- **The opponent-restricted comparison (Tasks 1–3).** `schedule.pair_allowed()` decides which pairs an added comparison schedules; `round1`, `needs_round2` and `round2_batch` take `opponents=`; `compare.create_pooled(opponents=)` records them in `compare.json`; `results.advance` passes them to the stopping rule. Without `opponents` every earlier schedule and result is unchanged (pinned by digests).
- **Heavy-method plumbing (Tasks 4–5).** A heavy `Tool` keeps its models in its own folder under `~/.cache/learnstation-parser-bench/models/<id>/` (every known cache variable pointed there, telemetry off), installs with `uv --exclude-newer 2026-10-31`, and only counts as installed after an import check **and** a probe run on a synthetic page that also fetches its models. `execute` runs it with that environment, holds its timed run to the spec's 120 s/page (a run past it is kept, failed, `did_not_run_here: true`) and records the model folder's size and whether it grew during the timed run.
- **Four runners (Tasks 6–9)** that follow the existing contract (`{"version", "settings", "pages": {"1": …}}`, every page of the file or exit non-zero), each with pure, unit-tested splitting code and the library imported only inside `main()`.
- **Measure, decide, run (Tasks 10–14).** A `clear-models` command; installs and a timed measurement on the SWT deck per method, then a **STOP** for Abi (whole documents or page-set pages + N neighbours; the conditional Task 12 builds the latter); Protocol Deviation 3 with a **STOP**; the heavy benchmark runs, the third comparison (seed **20261102**), the lab log and the viewer, then a **STOP** for Abi to judge.

**Tech Stack:** Python 3.13 (backend `.venv`), FastAPI, PyMuPDF 1.27.1, psutil, pytest. Each heavy runner in its own `uv` environment on Python 3.12: `docling==2.145.0`; `marker-pdf==2.1.0` (+ llama.cpp's `llama-server`, a program uv cannot install); `mineru==4.1.3`; `paddleocr[doc-parser]==3.7.0` with `paddlex==3.7.2` and `paddlepaddle==3.3.1` (PP-StructureV3, and PaddleOCR-VL in a second environment). No viewer code changes.

**Spec:** `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md`. The parts this plan builds: the contenders rows of `docling`, `marker`, `mineru`, `paddleocr` ("A variant slower than 120 s/page on the M1 is recorded as *did not run here*"), **Settings** ("Every tool runs on its default settings, and each exception is listed in the protocol. Tools are not tuned."), **Input** ("Each tool receives **whole documents**, because footer detection needs the other pages"), New run (the Heavy group; "The server first refuses if less than 3 GB would remain free"), "Order of runs", Threats, and decision 9 (one scale, `current` = 1000).

**Builds on:** Plan 3a as built (branch `claude/file-upload-workflow-e9126d` at `363ae44b`; protocol commit `902a0e86`, Deviation 2). Two comparisons are finished and **read-only**: `cmp-2026-10-30_8825` (five fast methods, 108 votes) and `cmp-2026-10-31_04de` (pooled with it, + `ai_vision` and `ai_vision_strong`, 112 votes). The code is authoritative where it differs from Plan 3a's text.

**Versions checked on PyPI (2026-10-31, JSON API `https://pypi.org/pypi/<name>/<version>/json`, each answered):** `docling` 2.145.0 (uploaded 2026-10-29, newest), `marker-pdf` 2.1.0 (2026-10-29, newest; pulls `surya-ocr` 0.23.0), `mineru` 4.1.3 (2026-10-30, newest), `paddleocr` 3.7.0 (2026-06-11, newest), `paddlex` 3.7.2 (2026-06-25, newest), `paddlepaddle` 3.3.1 (2026-03-26, newest; macOS arm64 cp312 wheel 99.7 MB), `torch` 2.15.0 (2026-10-28, newest; macOS arm64 cp312 wheel 132.1 MB, resolved by docling, marker and mineru). Fallback if a pinned release fails its install, import or probe: the previous release (`docling` 2.144.0, `marker-pdf` 2.0.0, `mineru` 4.1.2, `paddleocr` 3.6.0), **only with Abi's OK at Task 11's STOP**, recorded in Deviation 3.

**Decisions already made by Abi (2026-10-31), implemented here:**
- Round 3 = `docling`, `marker`, `mineru`, `paddleocr` (PP-StructureV3); PaddleOCR-VL as a separate entrant only if it installs and fits the time limit. Each in its own uv environment, Python 3.12, exact pins, import check; licences of code and of model weights recorded. Settings per the spec rows, defaults otherwise, no tuning, Apple M1 8 GB (MPS where the tool uses it).
- The third comparison is pooled (builds on both earlier ones). Round 1 schedules only new×new and new×{`ai_vision_strong`, `ai_vision`, `pymupdf4llm`, `current`}: with four new methods 6 + 16 = 22 pairs × 3 = 66 duels + round(66 / 9) = 7 hidden repeats = **73**. One Bradley–Terry scale over all three comparisons, `current` = 1000, H1 Bonferroni over all non-anchor entrants.
- A measurement on the SWT deck (41 pages) per heavy method first, then a STOP with the projected run time per method for the five PDFs and the option (a deviation if chosen) of giving a heavy method only the page-set pages plus N neighbours. **Not decided here.**
- The 3 GB install guard stays; models never in the repo or the data folder.
- Protocol Deviation 3 is committed before the first heavy benchmark run, with a STOP for Abi.

**Decisions this plan makes (each recorded in Deviation 3, Task 13):**
- **PaddleOCR-VL is a separate entrant `paddleocr_vl`**, not a replacement for PP-StructureV3. The spec's row names PP-StructureV3 as `paddleocr` and says "PaddleOCR-VL is also tried"; the two are different methods (a pipeline of small models against one 0.9B vision-language model), so replacing one with the other would drop the spec's named method. It gets its own environment (same pins) and goes through the same install, probe and SWT measurement. It enters the comparison only if all of that passes **and** its SWT measurement stays within 120 s/page **and** each of its five benchmark runs does. Its weights (PaddleOCR-VL-1.6, 1.84 GB on Hugging Face) run on the CPU here, because PaddlePaddle has no MPS backend, so "did not run here" is a likely outcome. That is measured, not assumed. With five new methods the third comparison has 10 + 20 = 30 pairs × 3 = 90 + 10 = **100** duels.
- **The 120 s/page rule.** It is measured as §8 measures cost: the timed run's wall-clock seconds over the pages the method is given (start-up included). The timed run of a heavy method is **stopped at 120 s × those pages**, because past that point the verdict cannot change. Such a run is **kept**, failed, `failed_stage: "timed"`, `did_not_run_here: true`, reason "did not run here: slower than 120 s/page on this Mac …". The method is then recorded as *did not run here*: it gets no further benchmark runs and is **not an entrant** (a comparison needs a finished run per PDF). The warm-up is not held to the limit, because it may include a one-time download. The rule applies to the SWT measurement runs too, so a method that passes the limit there gets no benchmark runs at all, whatever input Abi chooses at the STOP: the limit is per page, and the input mode only changes how many pages there are.
- **Round 2 is restricted the same way as round 1.** It runs only while the pooled top two overlap **and** their pair is one this comparison schedules (two new methods, or a new method and a chosen opponent). Each batch gives 3 more duels to every adjacent top-4 pair that this comparison schedules; no hidden repeats; cap 75. Reasons:
  - A round-2 duel against `opendataloader`, `pdfjs` or `markitdown` would be those pairs' first and only direct meeting, scheduled because of round-1 results. That is an adaptive design the protocol never described.
  - Abi has seen those three methods' outputs with names, and their questions were settled by the first comparison's own stopping rule and cap.
  - Abi chose the restriction to reduce the judging load.
  - The consequence is stated as a threat: if a heavy method and one of those three were the overlapping top two, round 2 would not run. On today's pooled ranking those three are 4th, 5th and 7th.
- **Schedule seed 20261102**, fixed here, before any vote. Round 1 with four new methods has digest `05e4a3b4c1dd0f980f495401892280ce36a58b55d65d445c83fa98d8d73aed35` (73 duels, 7 repeats, at least 20 apart); with `paddleocr_vl` as a fifth, `fca9e8916172d42b0019a1b1392de0b5892d4185d1ad05b6adbed0f9d895dee6` (100 duels). Both were computed before this plan was committed, on the real `pages.json`, with exactly the filter in Task 1. With 1, 2 or 3 new methods the counts are 13, 30 and 50; Task 14 pins that digest before the comparison is created, if needed.
- **MinerU's `pipeline` backend is MinerU 4's tier `basic`.** MinerU 4 replaced its backends with tiers (`flash`, `basic`, `standard`, `advanced`). Its documentation describes `basic` as small models for OCR, formulas and tables with no VLM, which is the old `pipeline` backend. Its default for PDFs is `standard`, which adds a VLM that MinerU's own table says needs 16 GB of memory on Apple Silicon. `tier="basic"` is recorded as this method's one settings exception (spec: "`pipeline` backend").
- **Marker's page split is its own `paginate_output`** (spec: "output split by page"). It is recorded as an output-format exception. LLM enhancement stays off: `use_llm` is false by default and is never set. On Apple Silicon, marker 2 runs its surya VLM through a local **llama.cpp `llama-server`** that it starts and stops itself, in its default `fast` mode on MPS. uv cannot install that program. Task 11 stops for Abi to install it (or to decline, in which case `marker` is recorded as not run).
- **Models in one place per method.** `HF_HOME`, `TORCH_HOME`, `XDG_CACHE_HOME`, `MODELSCOPE_CACHE`, `PADDLE_PDX_CACHE_HOME`, `MINERU_HOME`, `MODEL_CACHE_DIR` (surya) and `EASYOCR_MODULE_PATH` all point into `~/.cache/learnstation-parser-bench/models/<method>/`. `HF_HUB_DISABLE_TELEMETRY`, `DO_NOT_TRACK` and `MINERU_TELEMETRY_DISABLED` are set to 1. Task 11 checks the usual user caches before and after, so a library that ignores these variables is found and reported.
- **Models are fetched at install, not in a run.** Install runs the method's own download command (MinerU: `mineru-kit models download --tier basic`), then the runner on a one-page synthetic PDF, which must give back text for page 1. This is also the API check of each runner against the installed library: a mismatch fails the install with the runner's own message.
- **Reproducible installs.** uv resolves each heavy environment with `--exclude-newer 2026-10-31`. The exact package list is in every `run.json` anyway.
- **`clear-models <method>`** deletes one method's model folder and nothing else (spec: "its model files are deleted if needed"). The next warm-up downloads them again, untimed.
- **HTML in outputs stays as it is.** Prose (react-markdown 10, no `rehype-raw`) shows raw HTML as literal text, as the reading face would. Methods that write tables as `<table>` (MinerU, PaddleOCR) or wrap images in `<div>` (PaddleOCR) are disadvantaged on those pages. This is stated as a threat, not changed: changing the normalisation would change it for every method and would be a deviation of its own (Abi may ask for one at the STOP in Task 13).

**Parked items folded in (from the SDD ledgers):**
- Plan 3a Task 12:
  - the schedule's docstring head still says "every pair";
  - `only_with=set()` returns `[]` while `new=set()` raises;
  - a `str` passed as `only_with` would substring-match.
  - All three are fixed in Task 1.
- Plan 3a Task 13: the CLI `--against` error path is untested, and the legacy-provenance error does not name the earlier comparison. Both are fixed in Task 2.
- Plan 3a Task 14: no unit test that an earlier comparison's round-2 votes are left out of the pooled round-1 line. Task 3 adds it.
- Plan 1 Task 5: the `DiskSpaceError` message does not show the free space. Fixed in Task 4.

**Parked items left for later:**
- Export, `RESULTS.md`, the figures and the improvement loop come after judging (Plan 4). This includes Plan 3a Task 3's "export not gated per method", which must be fixed before benchmark runs are exported.
- The lecturer's surname in docs needs scrubbing before any push.
- Plan 3a Task 8: `paid_args` sends the model id unstripped. This plan does not touch the paid path.

## Global Constraints

- **Python:** `PY=~/Desktop/ascend-academy/.venv/bin/python`. **Node:** `NODE=~/.nvm/versions/node/v22.23.1/bin/node`. Run every command from the worktree root `~/Desktop/ascend-academy/.claude/worktrees/file-upload-workflow-e9126d`. `SCRATCH` = this session's scratchpad directory.
- **Test commands:** `$PY -m pytest backend/tests/unit/<file> -q`. The whole bench suite is `$PY -m pytest backend/tests/unit/test_parser_bench_*.py -q`. From Task 11 on, add `-m "not slow"` for routine runs: the live tests then run the installed heavy methods, which takes minutes.
- **No app imports.** No module under `backend/eval/parser_bench/` may import `backend.core`, `backend.services`, `backend.api`, `backend.repositories` or `backend.workers`. Runners import nothing from the bench either; they run with `python -I`.
- **No slide text, PDFs or home paths in git.** Data lives in `PARSER_BENCH_DIR` (default `~/Documents/learnstation-parser-bench/`). The lab log and the protocol use `~`, never `/Users/<name>`. Reports never quote output text of benchmark pages.
- **Models and environments live only under `~/.cache/learnstation-parser-bench/`:** `envs/<method>`, `models/<method>`, `bin/`. Never in the repository, never in the data folder.
  - The spec, verbatim: "The server first refuses if less than 3 GB would remain free." The guard (`FREE_FLOOR`) stays and counts the models too (`size_mb`).
  - Free disk was 15 GiB on 2026-10-31 (`df -h /`). The five heavy methods' estimates add up to about 13 GB, so Task 11 installs one method at a time and clears the model folders of methods already measured when the guard needs the room.
- **Earlier comparisons are read-only.** Nothing in this plan writes into `cmp-2026-10-30_8825` or `cmp-2026-10-31_04de`. Both `results.json` files must still recompute to the same bytes: Tasks 1 and 3 pin the logic, and Task 14 checks the real files and their sha256.
- **Records.** A finished extraction run is never changed. A comparison changes only while it is `judging`. `votes.jsonl` is append-only. `results.json` is always recomputed.
- **The benchmark gate.** A benchmark run or comparison needs all of these:
  - `PROTOCOL.md` committed and unmodified;
  - no uncommitted change under `backend/eval/parser_bench/`, `PROTOCOL.md` or `pages.json`;
  - none of those three changed since the protocol commit;
  - the warm-up on.
  - Tasks 1–12 change bench code, so no benchmark run is possible until Deviation 3 is committed (Task 13).
- **The spec on heavy methods, verbatim:**
  - "A variant slower than 120 s/page on the M1 is recorded as *did not run here*".
  - "Every tool runs on its default settings, and each exception is listed in the protocol. Tools are not tuned."
  - "Each tool receives **whole documents**, because footer detection needs the other pages."
  - "Cheap tools go first, then `docling`, `marker`, `mineru`, `paddleocr`. Free disk is checked after each heavy tool (8.8 GB free on 2026-10-30), and its model files are deleted if needed. Outputs are kept."
- **Spec decision 9, verbatim:** "All ratings stay on one scale, with `current` = 1000." The third comparison's round-1 rule is restricted to chosen opponents by Abi's decision of 2026-10-31 (Deviation 3).
- **Paid methods are not touched.** No OpenAI calls, and no paid run. `~/.config/learnstation-parser-bench/openai_key` is never opened, printed, copied, moved or changed. The existing `tools` listing only checks that the file exists (a stat, as in Plan 3a); that is the only contact.
- **Tests never download models** and never open a socket: heavy methods are tested through fake runner scripts and pure functions. The slow live test runs a heavy method only when it is installed **and** its model folder is not empty.
- **Network.** Production is never touched. Network use is limited to:
  - `uv` installing from PyPI (Task 11);
  - a heavy method's own model download during its install probe or a warm-up (Hugging Face, ModelScope or Baidu, per the library);
  - PyPI and Hugging Face metadata pages read for licences (Task 13).
  - llama.cpp is downloaded only by Abi or with Abi's explicit yes.
- **Blinding.**
  - **Votes.** Never vote, never unlock.
  - **What a report may say.** Never put per-method check numbers or output text of benchmark pages into a report or message. Timings, peak memory, disk sizes and run status are fine.
  - **The measurement runs.** They score only page 1 of the SWT deck, which is not in the page set.
- **One timed run at a time** (`<data>/timed-run.lock`). Long run batches go in a detached script in `SCRATCH`, as in Plans 2 and 3a.
- **Concurrent sessions.** Abi runs several Claude sessions on this machine. Run `git status --short` and check the branch before every commit.
- **Commit messages end with:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## File Structure

```
backend/eval/parser_bench/
  schedule.py      MODIFY  pair_allowed(), _names(), _opponents(); round1/needs_round2/round2_batch(opponents=)
  compare.py       MODIFY  CompareRun.create(opponents=), create_pooled(opponents=), provenance error names the comparison
  results.py       MODIFY  advance() passes the opponents; the pooled block reports them
  tools.py         MODIFY  Tool.downloads_models/prefetch/limit_per_page/exclude_newer; models_root/models_dir/bin_dir/
                           which/runner_env/dir_bytes/cache_mb/clear_models/probe_pdf/_prefetch/_llama_version;
                           TIME_LIMIT_PER_PAGE, EXCLUDE_NEWER, CACHE_VARS, QUIET_VARS; the five heavy methods (Tasks 6–9)
  execute.py       MODIFY  invoke(env=), RunnerError.timed_out, the time limit, model-folder fields
                           (Task 12, only if chosen: input_pages(), cut_pdf(), Tool.neighbours)
  __main__.py      MODIFY  compare create --opponents; clear-models; tools shows a heavy method's model folder
  runners/docling_runner.py       CREATE
  runners/marker_runner.py        CREATE
  runners/mineru_runner.py        CREATE
  runners/paddleocr_runner.py     CREATE
  runners/paddleocr_vl_runner.py  CREATE
backend/tests/unit/
  parser_bench_compare_fixtures.py   MODIFY  make_pooled(opponents=)
  test_parser_bench_{schedule,compare,cli,results,tools,execute,runners,runners_live}.py   MODIFY
docs/thesis/experiments/parser-benchmark/PROTOCOL.md   MODIFY (Task 13)  Deviation 3
docs/thesis/experiments/parser-benchmark/LAB_LOG.md    MODIFY (Tasks 11, 13, 14)
docs/superpowers/specs/2026-10-30-parser-benchmark-design.md   MODIFY (Task 13)  mineru row, decision 9 pointer
```

---

### Task 1: The schedule of a comparison with chosen opponents

**Files:**
- Modify: `backend/eval/parser_bench/schedule.py` (module docstring, new helpers after `_pages`, `round1`, `needs_round2`, `round2_batch`)
- Modify: `backend/tests/unit/test_parser_bench_schedule.py`
- Modify: `backend/tests/unit/test_parser_bench_results.py` (the pooled-results pin)

**Interfaces:**
- Consumes: Plan 3a's `round1(new=)`, `needs_round2(new=)`, `round2_batch(only_with=)`, `_place`, `_balance_sides`, `repeat_gap`; the fixtures `make_comparison`, `make_pooled`, `SESSION`.
- Produces:
  - `schedule.pair_allowed(a: str, b: str, new: Collection[str] | None, opponents: Collection[str] | None) -> bool`. With `new=None`, every pair is allowed. Otherwise a pair needs a new entrant, and with `opponents` given its other member must be new or an opponent.
  - `schedule.round1(entrants, pages, seed, *, new=None, opponents=None)`, `schedule.needs_round2(ranking, *, new=None, opponents=None)` and `schedule.round2_batch(ranked, pages, existing, seed, batch, room, *, only_with=None, opponents=None)`. `opponents` without `new` / `only_with` is refused.
  - `PLAN3A_POOLED_GOLDEN` and `plan3a_pooled_digest(tmp_path, monkeypatch) -> str` in `test_parser_bench_results.py`. Every later task must leave it green: it shows that a Plan 3a pooled comparison (such as `cmp-2026-10-31_04de`) summarizes exactly as before.

The two schedule digests and the pooled-results digest below were computed before this plan was committed. The schedule digests used exactly the filter in Step 3, applied to the code at `363ae44b`; the earlier pins `ba9b16d9…` and `b9808242…` came out unchanged under it. The results digest used the code at `363ae44b`, with exactly the recipe in Step 1.

- [ ] **Step 1: Pin Plan 3a's pooled results**

At the end of `backend/tests/unit/test_parser_bench_results.py` add:

```python
# summarize() of a pooled comparison (the recipe below), computed with Plan 3a's code at 363ae44b, before Plan 3b.
# Plan 3b must not change it: cmp-2026-10-31_04de on disk must recompute to the same results.json.
PLAN3A_POOLED_GOLDEN = "fa22cf97b2bd79f58e158f6f40cef1ed9ed983e3a749d413f20964cc0439142c"


def plan3a_pooled_digest(tmp_path, monkeypatch) -> str:
    counter = itertools.count()
    monkeypatch.setattr(compare.secrets, "token_hex", lambda n=2: f"{next(counter):0{2 * n}x}")
    ids = itertools.count()
    monkeypatch.setattr(compare, "new_compare_id", lambda **k: f"cmp-2026-10-31_{next(ids):04x}")
    monkeypatch.setattr(store, "now_iso", lambda: "2026-10-31T12:00:00+00:00")
    root = tmp_path / "data"
    choices = ("left", "right", "same", "both_bad")
    base = make_comparison(root, tmp_path, seed=7)
    while (duel := base.next_duel()) is not None:
        base.vote(duel=duel["duel"], choice=choices[duel["duel"] % 4], seconds=1.0 + duel["duel"], session=SESSION)
    base.finish()
    pooled = make_pooled(root, tmp_path, base, seed=5)
    while (duel := pooled.next_duel()) is not None:
        pooled.vote(duel=duel["duel"], choice=choices[(duel["duel"] + 1) % 4], seconds=2.0 + duel["duel"],
                    session=SESSION)
    pooled.finish()
    data = results.summarize(pooled, resamples=60, root=root)
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode("utf-8")).hexdigest()


def test_a_plan3a_pooled_comparison_summarizes_exactly_as_before(tmp_path, monkeypatch):
    assert plan3a_pooled_digest(tmp_path, monkeypatch) == PLAN3A_POOLED_GOLDEN
```

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_results.py::test_a_plan3a_pooled_comparison_summarizes_exactly_as_before -q`
Expected: PASS. It pins today's behaviour and must stay green through Task 14.

- [ ] **Step 2: Write the failing schedule tests**

At the end of `backend/tests/unit/test_parser_bench_schedule.py` add:

```python
ELEVEN = [*SEVEN, "docling", "marker", "mineru", "paddleocr"]
HEAVY = {"docling", "marker", "mineru", "paddleocr"}
OPPONENTS = {"ai_vision_strong", "ai_vision", "pymupdf4llm", "current"}
OTHERS = ["mineru", "paddleocr", "pymupdf4llm", "ai_vision_strong", "current", "pdfjs", "markitdown"]


def test_the_third_comparison_schedule_is_fixed_before_any_vote():
    duels = schedule.round1(ELEVEN, _page_set(), 20261102, new=HEAVY, opponents=OPPONENTS)
    assert len(duels) == 73 and sum(d["repeat_of"] is not None for d in duels) == 7
    assert _digest(duels) == "05e4a3b4c1dd0f980f495401892280ce36a58b55d65d445c83fa98d8d73aed35"
    five = schedule.round1([*ELEVEN, "paddleocr_vl"], _page_set(), 20261102, new=HEAVY | {"paddleocr_vl"},
                           opponents=OPPONENTS)
    assert len(five) == 100
    assert _digest(five) == "fca9e8916172d42b0019a1b1392de0b5892d4185d1ad05b6adbed0f9d895dee6"


def test_new_methods_meet_each_other_and_only_the_chosen_opponents():
    duels = schedule.round1(ELEVEN, PAGES, seed=5, new=HEAVY, opponents=OPPONENTS)
    first = [d for d in duels if d["repeat_of"] is None]
    pairs = Counter(tuple(sorted((d["a"], d["b"]))) for d in first)
    assert len(first) == 66 and len(pairs) == 22 and set(pairs.values()) == {3}  # 6 new pairs + 4 × 4
    for pair in pairs:
        assert set(pair) <= HEAVY or (len(set(pair) & HEAVY) == 1 and set(pair) - HEAVY <= OPPONENTS), pair
    seen = Counter(x for d in first for x in (d["a"], d["b"]))
    assert all(seen[t] == 21 for t in HEAVY) and all(seen[t] == 12 for t in OPPONENTS)
    assert not {"pdfjs", "markitdown", "opendataloader"} & set(seen)
    left = Counter(d["left"] for d in first)
    assert all(abs(left[t] - seen[t] / 2) <= 1 for t in seen)
    gap = schedule.repeat_gap(len(duels))
    assert len(duels) == 73 and all(d["duel"] - d["repeat_of"] >= gap for d in duels if d["repeat_of"] is not None)


@pytest.mark.parametrize("n, total", [(1, 13), (2, 30), (3, 50), (4, 73), (5, 100)])
def test_the_duel_count_follows_from_the_number_of_new_methods(n, total):
    new = ["docling", "marker", "mineru", "paddleocr", "paddleocr_vl"][:n]
    assert len(schedule.round1([*SEVEN, *new], PAGES, seed=5, new=set(new), opponents=OPPONENTS)) == total


def test_opponents_are_checked():
    with pytest.raises(ValueError, match="not among the entrants"):
        schedule.round1(ELEVEN, PAGES, seed=1, new=HEAVY, opponents={"tesseract"})
    with pytest.raises(ValueError, match="are new entrants"):
        schedule.round1(ELEVEN, PAGES, seed=1, new=HEAVY, opponents={"docling", "current"})
    with pytest.raises(ValueError, match="at least one earlier entrant"):
        schedule.round1(ELEVEN, PAGES, seed=1, new=HEAVY, opponents=set())
    with pytest.raises(ValueError, match="name its new entrants"):
        schedule.round1(ELEVEN, PAGES, seed=1, opponents=OPPONENTS)
    with pytest.raises(ValueError, match="not one string"):
        schedule.round1(ELEVEN, PAGES, seed=1, new="docling")
    with pytest.raises(ValueError, match="not one string"):
        schedule.round1(ELEVEN, PAGES, seed=1, new=HEAVY, opponents="current")


def test_round2_batch_refuses_what_round1_refuses():
    with pytest.raises(ValueError, match="at least one new"):
        schedule.round2_batch(SEVEN, PAGES, [], seed=5, batch=1, room=75, only_with=set())
    with pytest.raises(ValueError, match="not one string"):
        schedule.round2_batch(SEVEN, PAGES, [], seed=5, batch=1, room=75, only_with="ai_vision")
    with pytest.raises(ValueError, match="name its new entrants"):
        schedule.round2_batch(SEVEN, PAGES, [], seed=5, batch=1, room=75, opponents={"current"})


def _top(a, b):
    return [{"entrant": a, "lo": 1050, "hi": 1200}, {"entrant": b, "lo": 990, "hi": 1060}]


def test_round2_with_opponents_needs_the_top_two_to_be_a_scheduled_pair():
    assert schedule.needs_round2(_top("docling", "ai_vision"), new=HEAVY, opponents=OPPONENTS)
    assert schedule.needs_round2(_top("docling", "marker"), new=HEAVY, opponents=OPPONENTS)
    assert not schedule.needs_round2(_top("docling", "opendataloader"), new=HEAVY, opponents=OPPONENTS)
    assert not schedule.needs_round2(_top("ai_vision", "pymupdf4llm"), new=HEAVY, opponents=OPPONENTS)
    assert schedule.needs_round2(_top("docling", "opendataloader"), new=HEAVY)  # without opponents: Plan 3a's rule


def test_a_round2_batch_with_opponents_keeps_only_scheduled_pairs():
    existing = schedule.round1(ELEVEN, PAGES, seed=5, new=HEAVY, opponents=OPPONENTS)
    ranked = ["docling", "opendataloader", "ai_vision", "marker", *OTHERS]
    batch = schedule.round2_batch(ranked, PAGES, existing, seed=5, batch=1, room=75, only_with=HEAVY,
                                  opponents=OPPONENTS)
    pairs = Counter(tuple(sorted((d["a"], d["b"]))) for d in batch)
    assert pairs == {("ai_vision", "marker"): 3}  # docling–opendataloader and opendataloader–ai_vision are not scheduled
    assert [d["duel"] for d in batch] == list(range(73, 76))
    plan3a = schedule.round2_batch(ranked, PAGES, existing, seed=5, batch=1, room=75, only_with=HEAVY)
    assert len(plan3a) == 6  # without opponents: every adjacent pair with a new method


def test_pair_allowed_is_the_one_rule():
    assert schedule.pair_allowed("pdfjs", "current", None, None)
    assert schedule.pair_allowed("docling", "pdfjs", HEAVY, None)
    assert not schedule.pair_allowed("pdfjs", "current", HEAVY, None)
    assert not schedule.pair_allowed("docling", "pdfjs", HEAVY, OPPONENTS)
    assert schedule.pair_allowed("pdfjs", "docling", HEAVY, {"pdfjs"})
    assert schedule.pair_allowed("docling", "marker", HEAVY, set())
```

- [ ] **Step 3: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_schedule.py -q`
Expected: the Plan 2/3a tests pass; the new ones FAIL (`unexpected keyword argument 'opponents'`, `no attribute 'pair_allowed'`).

- [ ] **Step 4: Implement**

In `backend/eval/parser_bench/schedule.py`:

(a) In the module docstring, replace `Round 1: every pair of entrants meets 3 times,` with `Round 1: every pair of entrants (in an added comparison: every pair it schedules, see below) meets 3 times,` and replace the paragraph that starts `An added comparison` with:

```
An added comparison (one that builds on finished ones, compare.create_pooled) schedules only the pairs with
at least one new entrant, under the same round-1 rule (the spec's "every pair 3× on 3 page types", for the
pairs with a new entrant only: Deviation 2). It may also name its opponents (Deviation 3): then a new entrant
meets the other new entrants and those earlier entrants only. pair_allowed() is that one rule. Its round 2
runs only while the overlapping top two are a pair it schedules, and then only for the adjacent top-4 pairs
it schedules: the other pairs were settled under their own comparison's stopping rule and cap.
```

(b) After `_pages`, add:

```python
def _names(value: Collection[str], what: str) -> set[str]:
    """Method ids as a set; one string is refused (it would be read letter by letter)."""
    if isinstance(value, str):
        raise ValueError(f"{what} must be a collection of method ids, not one string")
    return set(value)


def pair_allowed(a: str, b: str, new: Collection[str] | None, opponents: Collection[str] | None) -> bool:
    """Whether an added comparison schedules the pair a–b. Without `new` every pair is scheduled. With it, a pair
    needs a new entrant; with `opponents` as well, the other member must be new too or one of the opponents."""
    if new is None:
        return True
    if a in new and b in new:
        return True
    if a not in new and b not in new:
        return False
    return opponents is None or (b if a in new else a) in opponents


def _opponents(opponents: Collection[str], fresh: set[str], names: Sequence[str]) -> set[str]:
    rivals = _names(opponents, "opponents")
    if not rivals:
        raise ValueError("opponents, when given, name at least one earlier entrant")
    unknown = sorted(rivals - set(names))
    if unknown:
        raise ValueError(f"opponents {unknown} are not among the entrants")
    both = sorted(rivals & fresh)
    if both:
        raise ValueError(f"opponents {both} are new entrants; opponents are earlier entrants")
    return rivals
```

(c) Replace the signature, docstring and pair block of `round1`, from `def round1(` through `rng.shuffle(pairs)` (the rest of the function stays exactly as it is), with:

```python
def round1(entrants: Sequence[str], pages: Sequence[SchedPage], seed: int, *,
           new: Collection[str] | None = None, opponents: Collection[str] | None = None) -> list[dict[str, Any]]:
    """Round 1 with its hidden repeats, numbered 0.. in the order they are judged. With `new`, only the pairs
    that involve at least one of those entrants (an added comparison); with `opponents` too, only the pairs
    pair_allowed() accepts. Without either, every pair."""
    names = sorted(set(entrants))
    if len(names) < 2:
        raise ValueError("a comparison needs at least two entrants")
    pages = _pages(pages)
    rng = random.Random(seed)
    pairs = list(combinations(names, 2))
    if new is not None:
        fresh = _names(new, "new entrants")
        if not fresh:
            raise ValueError("an added comparison needs at least one new entrant")
        unknown = sorted(fresh - set(names))
        if unknown:
            raise ValueError(f"new entrants {unknown} are not among the entrants")
        rivals = None if opponents is None else _opponents(opponents, fresh, names)
        pairs = [(a, b) for a, b in pairs if pair_allowed(a, b, fresh, rivals)]
    elif opponents is not None:
        raise ValueError("opponents restrict an added comparison; name its new entrants too")
    rng.shuffle(pairs)
```

(d) Replace `needs_round2` with:

```python
def needs_round2(ranking: Sequence[Mapping[str, Any]], *, new: Collection[str] | None = None,
                 opponents: Collection[str] | None = None) -> bool:
    """The stopping rule's question: does the top entrant's interval overlap the second's? `ranking` is
    sorted by points, best first, each row with "lo" and "hi" (unrounded: results._decision_rows). In an
    added comparison (`new` given) round 2 also needs the top two to be a pair it schedules (pair_allowed)."""
    if len(ranking) < 2 or ranking[0]["lo"] > ranking[1]["hi"]:
        return False
    if new is None:
        return True
    rivals = None if opponents is None else _names(opponents, "opponents")
    return pair_allowed(ranking[0]["entrant"], ranking[1]["entrant"], _names(new, "new entrants"), rivals)
```

(e) In `round2_batch`, change the signature and docstring to:

```python
def round2_batch(ranked: Sequence[str], pages: Sequence[SchedPage], existing: Sequence[Mapping[str, Any]],
                 seed: int, batch: int, room: int, *, only_with: Collection[str] | None = None,
                 opponents: Collection[str] | None = None) -> list[dict[str, Any]]:
    """The next round-2 duels: 3 for each adjacent pair among the top four (`ranked` best first), on
    three page types, numbered after `existing`; at most `room` of them (the 75-duel cap). With only_with
    (an added comparison's new entrants) and opponents, only the pairs pair_allowed() accepts."""
    fresh = rivals = None
    if only_with is not None:
        fresh = _names(only_with, "new entrants")
        if not fresh:
            raise ValueError("an added comparison needs at least one new entrant")
        rivals = None if opponents is None else _names(opponents, "opponents")
    elif opponents is not None:
        raise ValueError("opponents restrict an added comparison; name its new entrants too")
```

Then replace

```python
    pairs = list(zip(top, top[1:]))
    if only_with is not None:
        pairs = [(x, y) for x, y in pairs if x in only_with or y in only_with]
    for x, y in pairs:
```

with

```python
    pairs = [(x, y) for x, y in zip(top, top[1:]) if pair_allowed(x, y, fresh, rivals)]
    for x, y in pairs:
```

The rest of `round2_batch` (from `pages = _pages(pages)` on) stays as it is. The validation runs first and draws no random number, so every existing digest is unchanged.

- [ ] **Step 5: Run the schedule and results tests**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_schedule.py backend/tests/unit/test_parser_bench_results.py -q`
Expected: all pass. That includes the first and second comparisons' digests (`ba9b16d9…`, `b9808242…`), the third's (`05e4a3b4…`, `fca9e891…`), `PLAN2_GOLDEN` and `PLAN3A_POOLED_GOLDEN`.

- [ ] **Step 6: Commit**

```bash
git status --short
git add backend/eval/parser_bench/schedule.py backend/tests/unit/test_parser_bench_schedule.py backend/tests/unit/test_parser_bench_results.py
git commit -m "feat(parser-bench): schedule a comparison against chosen opponents; seed 20261102 pinned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pooled comparisons with chosen opponents (`compare.create_pooled(opponents=)`, `--opponents`)

**Files:**
- Modify: `backend/eval/parser_bench/compare.py` (module docstring, `CompareRun.create`, `create_pooled`)
- Modify: `backend/eval/parser_bench/__main__.py` (docstring, `compare create --opponents`, `_compare`)
- Modify: `backend/tests/unit/parser_bench_compare_fixtures.py` (`make_pooled(opponents=)`)
- Modify: `backend/tests/unit/test_parser_bench_compare.py`, `backend/tests/unit/test_parser_bench_cli.py`

**Interfaces:**
- Consumes: `schedule.round1(new=, opponents=)` (Task 1); Plan 3a's `create_pooled`, `_provenance`, `require_one_bench_tree`.
- Produces:
  - `CompareRun.create(..., opponents: Sequence[str] | None = None)`. It writes `"opponents"` (a sorted list) into `compare.json` only when given, so other comparisons keep their exact shape.
  - `compare.create_pooled(new_tools, *, against, seed, commit, tree=None, pages=None, opponents=None, root=None) -> CompareRun`.
  - The CLI: `compare create --tools a,b --against cmp-…,cmp-… --opponents x,y --seed N`.
  - The fixture: `make_pooled(root, tmp, base, new=("gammatool", "deltatool"), *, seed=5, commit="abc123", opponents=None)`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/parser_bench_compare_fixtures.py` replace `make_pooled` with:

```python
def make_pooled(root: Path, tmp: Path, base: compare.CompareRun, new=("gammatool", "deltatool"), *, seed=5,
                commit="abc123", opponents=None) -> compare.CompareRun:
    """A comparison that adds `new` to the finished `base`, on its deck and pages; `opponents` restricts whom the
    new methods meet."""
    for tool in new:
        make_extract_run(root, tool, tmp / "deck.pdf", commit=commit)
    return compare.create_pooled(list(new), against=[base.run_id], seed=seed, commit=commit, tree=None,
                                 pages=bench_pages_of(base), opponents=opponents, root=root)
```

At the end of `backend/tests/unit/test_parser_bench_compare.py` add:

```python
def finished_second(root, tmp_path):
    base = finished_base(root, tmp_path)
    second = make_pooled(root, tmp_path, base)
    vote_all(second)
    second.finish()
    return base, second


def test_a_third_comparison_meets_only_the_chosen_opponents(tmp_path):
    root = tmp_path / "data"
    base, second = finished_second(root, tmp_path)
    before = {c.run_id: {n: (c.path / n).read_bytes() for n in ("compare.json", "votes.jsonl")} for c in (base, second)}
    third = make_pooled(root, tmp_path, second, new=("epsilontool", "zetatool"), opponents=("gammatool", "current"))
    m = third.meta
    assert m["builds_on"] == [base.run_id, second.run_id] and m["opponents"] == ["current", "gammatool"]
    assert m["new_entrants"] == ["epsilontool", "zetatool"] and len(m["entrants"]) == 7
    first = [d for d in m["schedule"] if d["repeat_of"] is None]
    assert len(first) == 15 and len(m["schedule"]) == 17  # (1 + 2 × 2) pairs × 3, plus round(15 / 9) = 2 repeats
    assert {x for d in m["schedule"] for x in (d["a"], d["b"])} == {"epsilontool", "zetatool", "gammatool", "current"}
    assert {c.run_id: {n: (c.path / n).read_bytes() for n in ("compare.json", "votes.jsonl")} for c in (base, second)} == before
    assert "opponents" not in second.meta  # a comparison without opponents keeps Plan 3a's shape


def test_opponents_must_be_methods_already_rated(tmp_path):
    root = tmp_path / "data"
    _, second = finished_second(root, tmp_path)
    make_extract_run(root, "epsilontool", tmp_path / "deck.pdf")

    def third(opponents):
        return compare.create_pooled(["epsilontool"], against=[second.run_id], seed=5, commit="abc123",
                                     pages=bench_pages_of(second), opponents=opponents, root=root)

    with pytest.raises(ValueError, match="opponents must be methods rated in"):
        third(["thetatool"])
    with pytest.raises(ValueError, match="opponents must be methods rated in"):
        third([])
    assert third(["current"]).meta["opponents"] == ["current"]


def test_the_earlier_comparison_is_named_when_its_runs_disagree(tmp_path, monkeypatch):
    root = tmp_path / "data"
    base = finished_base(root, tmp_path)  # recorded no provenance, so create_pooled works it out from the runs
    make_extract_run(root, "gammatool", tmp_path / "deck.pdf")

    def disagree(entrants, root=None):
        raise ValueError(f"{next(iter(entrants))}'s runs were made under different protocol commits or bench trees")

    monkeypatch.setattr(compare, "_provenance", disagree)
    with pytest.raises(ValueError, match=f"^{base.run_id}: "):
        compare.create_pooled(["gammatool"], against=[base.run_id], seed=5, commit="abc123",
                              pages=bench_pages_of(base), root=root)
```

In `backend/tests/unit/test_parser_bench_cli.py`, change the `# --- Plan 2: compare` import to

```python
from backend.tests.unit.parser_bench_compare_fixtures import (  # noqa: E402
    bench_pages_of, make_comparison, make_extract_run, make_pooled, vote_all)
```

and add at the end:

```python
def test_compare_create_against_two_comparisons_with_opponents(monkeypatch, capsys, tmp_path):
    root = tmp_path / "data"
    monkeypatch.setenv("PARSER_BENCH_DIR", str(root))
    base = make_comparison(root, tmp_path)
    vote_all(base)
    base.finish()
    second = make_pooled(root, tmp_path, base)
    vote_all(second)
    second.finish()
    for tool in ("epsilontool", "zetatool"):
        make_extract_run(root, tool, tmp_path / "deck.pdf")
    monkeypatch.setattr(pageset, "load", lambda path=pageset.PAGESET: bench_pages_of(base))
    monkeypatch.setattr(execute, "benchmark_gate", lambda: {"protocol_commit": "abc123", "bench_tree": None})
    argv = ["compare", "create", "--tools", "epsilontool,zetatool", "--against", f"{base.run_id},{second.run_id}",
            "--opponents", "gammatool,current", "--seed", "5"]
    assert cli.main(argv) == 0
    assert "judging  0/17 duels" in capsys.readouterr().out


def test_compare_create_against_an_unknown_comparison_says_which(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(execute, "benchmark_gate", lambda: {"protocol_commit": "abc123", "bench_tree": None})
    assert cli.main(["compare", "create", "--tools", "gammatool", "--against", "cmp-2026-01-01_dead", "--seed", "5"]) == 2
    assert "cmp-2026-01-01_dead" in capsys.readouterr().err


def test_opponents_need_against(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PARSER_BENCH_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(execute, "benchmark_gate", lambda: {"protocol_commit": "abc123", "bench_tree": None})
    assert cli.main(["compare", "create", "--tools", "gammatool", "--opponents", "current", "--seed", "5"]) == 2
    assert "--opponents needs --against" in capsys.readouterr().err
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_compare.py backend/tests/unit/test_parser_bench_cli.py -q`
Expected: FAIL (`unexpected keyword argument 'opponents'`, `unrecognized arguments: --opponents`, the provenance message has no comparison id).

- [ ] **Step 3: Implement**

In `backend/eval/parser_bench/compare.py`:

(a) In the module docstring, after the sentence `A comparison that adds methods to finished ones also names them ("builds_on") and its "new_entrants"; its ratings pool their votes (results.py), which are only read.` add the line `It may also name its "opponents": the earlier entrants its new ones meet (Deviation 3).`

(b) In `CompareRun.create`, add the keyword parameter `opponents: Sequence[str] | None = None` after `new_entrants`. After `if any(t not in entrants for t in new_entrants): …` add:

```python
        if opponents is not None:
            if not new_entrants:
                raise ValueError("opponents restrict a comparison that adds new entrants")
            if not opponents or any(t not in entrants or t in new_entrants for t in opponents):
                raise ValueError("every opponent must be an earlier entrant")
```

In the dict written to `compare.json`, right after `"new_entrants": sorted(new_entrants),` add:

```python
            **({"opponents": sorted(opponents)} if opponents is not None else {}),
```

(c) In `create_pooled`, add the keyword parameter `opponents: Sequence[str] | None = None` before `root`. Append to its docstring: `With opponents, the new tools meet each other and only those earlier entrants (schedule.pair_allowed).` Replace

```python
            if tool not in earlier_provenance:
                recorded = (meta.get("provenance") or {}).get(tool)
                earlier_provenance[tool] = dict(recorded) if recorded else _provenance({tool: runs}, root)[tool]
```

with

```python
            if tool not in earlier_provenance:
                recorded = (meta.get("provenance") or {}).get(tool)
                try:
                    earlier_provenance[tool] = dict(recorded) if recorded else _provenance({tool: runs}, root)[tool]
                except ValueError as e:
                    raise ValueError(f"{cid}: {e}") from None
```

Right after the `clash` check (`if clash: raise …`) add:

```python
    rivals = None
    if opponents is not None:
        rivals = sorted(set(opponents))
        unknown = [t for t in rivals if t not in earlier]
        if not rivals or unknown:
            raise ValueError(f"opponents must be methods rated in {', '.join(against)}: "
                             f"{', '.join(unknown) or 'none named'}")
```

and replace the last two statements (the `duels = …` line and the `return CompareRun.create(…)`) with:

```python
    duels = schedule.round1(sorted(entrants), [schedule.SchedPage(p.key, p.type) for p in pages], seed,
                            new=fresh_tools, opponents=rivals)
    return CompareRun.create(entrants=entrants, pages=entries, seed=seed, duels=duels, protocol_commit=commit,
                             anchor=anchors.pop(), bench_tree=tree,
                             provenance={**earlier_provenance, **fresh_provenance},
                             builds_on=chain, new_entrants=fresh_tools, opponents=rivals, root=root)
```

In `backend/eval/parser_bench/__main__.py`:

(a) In the docstring, replace the `compare create` lines with:

```
    compare create --tools a,b,c --seed N [--against cmp-…[,cmp-…] [--opponents x,y]]
                                  a blind comparison of those methods' benchmark runs; with --against, the
                                  methods are added to finished comparisons (only their pairs, one scale);
                                  with --opponents, they meet each other and only those earlier methods
```

(b) Add to the `create` sub-parser, after `--against`:

```python
    s.add_argument("--opponents", help="comma-separated earlier methods the new ones meet (with --against)")
```

(c) In `_compare`, replace the `try:` body from `gate = execute.benchmark_gate()` through the `create_benchmark` call with:

```python
            gate = execute.benchmark_gate()
            chosen = [t for t in args.tools.split(",") if t]
            rivals = [t for t in args.opponents.split(",") if t] if args.opponents is not None else None
            if args.against:
                cmp = compare.create_pooled(chosen, against=[c for c in args.against.split(",") if c], seed=args.seed,
                                            commit=gate["protocol_commit"], tree=gate["bench_tree"], opponents=rivals)
            elif rivals is not None:
                raise ValueError("--opponents needs --against: only an added comparison has opponents")
            else:
                cmp = compare.create_benchmark(chosen, seed=args.seed, commit=gate["protocol_commit"], tree=gate["bench_tree"])
```

- [ ] **Step 4: Run the compare, CLI, schedule and results tests**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_compare.py backend/tests/unit/test_parser_bench_cli.py backend/tests/unit/test_parser_bench_schedule.py backend/tests/unit/test_parser_bench_results.py -q`
Expected: all pass, both golden pins included.

- [ ] **Step 5: Commit**

```bash
git status --short
git add backend/eval/parser_bench/compare.py backend/eval/parser_bench/__main__.py \
  backend/tests/unit/parser_bench_compare_fixtures.py backend/tests/unit/test_parser_bench_compare.py backend/tests/unit/test_parser_bench_cli.py
git commit -m "feat(parser-bench): a pooled comparison can name its opponents; compare create --opponents

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Results of a comparison with opponents: round 2 and the pooled block

**Files:**
- Modify: `backend/eval/parser_bench/results.py` (module docstring, `_summarize`, `advance`)
- Modify: `backend/tests/unit/test_parser_bench_results.py`

**Interfaces:**
- Consumes: `schedule.needs_round2(opponents=)`, `schedule.round2_batch(opponents=)` (Task 1); `compare.json` `"opponents"` (Task 2); `make_pooled(opponents=)`.
- Produces:
  - `results.advance` passes `meta.get("opponents")` to the stopping rule. A comparison without opponents decides exactly as before.
  - `results.json` `pooled.opponents` (a list) only when the comparison has opponents, so `PLAN2_GOLDEN` and `PLAN3A_POOLED_GOLDEN` stay unchanged.

- [ ] **Step 1: Write the failing tests**

At the end of `backend/tests/unit/test_parser_bench_results.py` add:

```python
def _judged_third(root, tmp_path):
    base = make_comparison(root, tmp_path)
    vote_all(base)
    base.finish()
    second = make_pooled(root, tmp_path, base)
    vote_all(second)
    second.finish()
    third = make_pooled(root, tmp_path, second, new=("epsilontool", "zetatool"), opponents=("gammatool", "current"))
    vote_all(third)
    return base, second, third


def test_a_third_comparison_rates_all_three_on_one_scale(tmp_path):
    root = tmp_path / "data"
    base, second, third = _judged_third(root, tmp_path)
    data = results.summarize(third, resamples=FAST, root=root)
    assert data["pooled"]["builds_on"] == [base.run_id, second.run_id]
    assert data["pooled"]["opponents"] == ["current", "gammatool"]
    assert (data["votes"], data["pooled"]["votes"]) == (17, 10 + 23 + 17)
    assert len(data["ranking"]) == 7 and data["h1_k"] == 6
    assert next(r for r in data["ranking"] if r["entrant"] == "current")["points"] == 1000.0
    assert data["sensitivity"]["round1_only"]["votes"] == 50


def test_a_third_comparison_without_a_scheduled_top_pair_gets_no_round2(tmp_path, monkeypatch):
    root = tmp_path / "data"
    _, _, third = _judged_third(root, tmp_path)
    fake = fake_verdict({"epsilontool": (1100.0, 1040.0, 1160.0), "alphatool": (1090.0, 1030.0, 1150.0),
                         "gammatool": (1050.0, 1000.0, 1100.0), "zetatool": (1000.2, 950.0, 1050.0),
                         "betatool": (990.0, 940.0, 1040.0), "deltatool": (980.0, 930.0, 1030.0),
                         "current": (1000.0, 1000.0, 1000.0)})
    monkeypatch.setattr(results.ranking, "analyse", lambda *a, **k: fake)
    assert results.advance(third, resamples=FAST, root=root) == {"added": 0, "finished": True}


def test_round2_of_a_third_comparison_adds_only_scheduled_pairs(tmp_path, monkeypatch):
    root = tmp_path / "data"
    _, _, third = _judged_third(root, tmp_path)
    fake = fake_verdict({"epsilontool": (1100.0, 1040.0, 1160.0), "gammatool": (1090.0, 1030.0, 1150.0),
                         "zetatool": (1050.0, 1000.0, 1100.0), "alphatool": (1000.2, 950.0, 1050.0),
                         "betatool": (990.0, 940.0, 1040.0), "deltatool": (980.0, 930.0, 1030.0),
                         "current": (1000.0, 1000.0, 1000.0)})
    monkeypatch.setattr(results.ranking, "analyse", lambda *a, **k: fake)
    assert results.advance(third, resamples=FAST, root=root) == {"added": 6, "finished": False}
    pairs = Counter(tuple(sorted((d["a"], d["b"]))) for d in third.meta["schedule"][17:])
    assert pairs == {("epsilontool", "gammatool"): 3, ("gammatool", "zetatool"): 3}  # not zetatool–alphatool


def test_the_pooled_round1_line_leaves_out_an_earlier_comparisons_round2_votes(tmp_path):
    root = tmp_path / "data"
    base = make_comparison(root, tmp_path)
    vote_all(base)
    pages = [schedule.SchedPage(p["key"], p["type"]) for p in base.meta["pages"]]
    base.extend(schedule.round2_batch(["alphatool", "betatool", "current"], pages, base.meta["schedule"], 1, 1, 75))
    vote_all(base)
    base.finish()
    pooled = make_pooled(root, tmp_path, base)
    vote_all(pooled)
    data = results.summarize(pooled, resamples=FAST, root=root)
    assert data["pooled"]["votes"] == 10 + 6 + 23
    assert data["sensitivity"]["round1_only"]["votes"] == 10 + 23
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_results.py -q`
Expected: the new tests FAIL. The first one fails with `KeyError: 'opponents'`. The round-2 tests fail because round 2 still uses Plan 3a's rule (6 duels including zetatool–alphatool, or a round 2 where none is due). The last test may already pass: it is the parked regression test.

- [ ] **Step 3: Implement**

In `backend/eval/parser_bench/results.py`:

(a) Append to the module docstring: `A comparison that names its opponents (Deviation 3) asks the stopping rule only about the pairs it schedules (schedule.pair_allowed); its pooled block lists them.`

(b) In `_summarize`, in the `data["pooled"] = {…}` dict, right after `"new_entrants": list(meta.get("new_entrants") or []),` add:

```python
            **({"opponents": list(meta["opponents"])} if meta.get("opponents") is not None else {}),
```

(c) In `advance`, replace

```python
    new = meta.get("new_entrants") or None  # an added comparison: round 2 only for its new methods' pairs
    if room > 0 and schedule.needs_round2(decision, new=new):
        pages = [schedule.SchedPage(p["key"], p["type"]) for p in meta["pages"]]
        batch = schedule.round2_batch([r["entrant"] for r in decision], pages, meta["schedule"],
                                      meta["seed"], meta["rounds"], room, only_with=new)
```

with

```python
    new = meta.get("new_entrants") or None  # an added comparison: round 2 only for its new methods' pairs
    rivals = meta.get("opponents")  # and only against its chosen opponents, when it names them (deviation 3)
    if room > 0 and schedule.needs_round2(decision, new=new, opponents=rivals):
        pages = [schedule.SchedPage(p["key"], p["type"]) for p in meta["pages"]]
        batch = schedule.round2_batch([r["entrant"] for r in decision], pages, meta["schedule"],
                                      meta["seed"], meta["rounds"], room, only_with=new, opponents=rivals)
```

- [ ] **Step 4: Run the results, schedule and compare tests**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_results.py backend/tests/unit/test_parser_bench_schedule.py backend/tests/unit/test_parser_bench_compare.py -q`
Expected: all pass, `PLAN2_GOLDEN` and `PLAN3A_POOLED_GOLDEN` included.

- [ ] **Step 5: Commit**

```bash
git status --short
git add backend/eval/parser_bench/results.py backend/tests/unit/test_parser_bench_results.py
git commit -m "feat(parser-bench): round 2 of a comparison with opponents asks only about its own pairs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Heavy-method plumbing in `tools.py`: model folders, reproducible installs, models fetched at install

**Files:**
- Modify: `backend/eval/parser_bench/tools.py`
- Modify: `backend/tests/unit/test_parser_bench_tools.py`

**Interfaces:**
- Consumes: Plan 3a's `Tool`, `install`, `_check_imports`, `command`, `env_python`, `marker`, `environment`, `missing`.
- Produces:
  - Constants: `TIME_LIMIT_PER_PAGE = 120.0`, `EXCLUDE_NEWER = "2026-10-31"`, `CACHE_VARS: dict[str, str]`, `QUIET_VARS: dict[str, str]`.
  - New `Tool` fields:
    - `downloads_models: bool = False`
    - `prefetch: tuple[tuple[str, ...], ...] = ()`
    - `limit_per_page: float | None = None`
    - `exclude_newer: str | None = None`
  - Functions:
    - `models_root() -> Path` (env `PARSER_BENCH_MODELS`)
    - `models_dir(tool) -> Path`
    - `bin_dir() -> Path` (env `PARSER_BENCH_BIN`)
    - `which(program) -> str | None`
    - `runner_env(tool) -> dict[str, str] | None`
    - `dir_bytes(path) -> int`
    - `cache_mb(tool) -> float | None`
    - `clear_models(tool) -> int`
    - `probe_pdf(path) -> Path`
    - `_prefetch(tool) -> None`
    - `_llama_version() -> str`
  - `install()` now passes `--exclude-newer` when the tool has it, and calls `_prefetch` after the import check and before the marker. `DiskSpaceError` names the free space.

No heavy method is registered yet (their runners come in Tasks 6–9). Tests use `Tool(...)` test doubles.

- [ ] **Step 1: Write the failing tests**

At the end of `backend/tests/unit/test_parser_bench_tools.py` add:

```python
PREFETCH_RUNNER = r'''
import json, os, sys
os.makedirs(os.environ["HF_HOME"], exist_ok=True)
open(os.path.join(os.environ["HF_HOME"], "model.bin"), "wb").write(b"m" * 1000)
json.dump({"version": "1", "settings": {}, "pages": {"1": "Probe page"}}, open(sys.argv[2], "w"))
'''


def heavy_tool(tmp_path, body, **kw):
    script = tmp_path / "heavy_runner.py"
    script.write_text(body)
    return tools.Tool("heavyfake", "Heavy fake", "heavy", str(script), "test double", downloads_models=True, **kw)


@pytest.fixture
def heavy_dirs(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_MODELS", str(tmp_path / "models"))
    monkeypatch.setenv("PARSER_BENCH_ENVS", str(tmp_path / "envs"))
    monkeypatch.setenv("PARSER_BENCH_BIN", str(tmp_path / "bin"))
    return tmp_path


def test_a_heavy_method_gets_its_own_model_folders_and_no_telemetry(heavy_dirs):
    tool = heavy_tool(heavy_dirs, "")
    env = tools.runner_env(tool)
    for var, sub in tools.CACHE_VARS.items():
        assert env[var] == str(tools.models_dir(tool) / sub), var
    assert tools.models_dir(tool) == (heavy_dirs / "models" / "heavyfake").resolve()
    assert all(env[var] == "1" for var in ("HF_HUB_DISABLE_TELEMETRY", "DO_NOT_TRACK", "MINERU_TELEMETRY_DISABLED"))
    assert env["PATH"].split(":")[0] == str(tools.bin_dir())
    assert tools.runner_env(tools.TOOLS["markitdown"]) is None  # every other method inherits the environment as is


def test_which_finds_a_program_in_the_bench_bin_folder_first(heavy_dirs):
    program = heavy_dirs / "bin" / "ls-bench-fake-program"
    tool = tools.Tool("needsit", "Needs it", "heavy", "x.py", "test double", needs=("ls-bench-fake-program",))
    assert tools.which("ls-bench-fake-program") is None and any("ls-bench-fake-program" in g for g in tools.missing(tool))
    program.parent.mkdir(parents=True)
    program.write_text("#!/bin/sh\n")
    program.chmod(0o755)
    assert tools.which("ls-bench-fake-program") == str(program) and tools.missing(tool) == []


def test_the_llama_server_version_is_read_from_the_bench_bin_folder(heavy_dirs):
    script = heavy_dirs / "bin" / "llama-server"
    script.parent.mkdir(parents=True)
    script.write_text("#!/bin/sh\necho 'load_backend: loaded Metal' >&2\necho 'version: 6543 (abcdef0)' >&2\n")
    script.chmod(0o755)
    assert tools._llama_version() == "llama-server version: 6543 (abcdef0)"


def test_prefetch_runs_the_download_steps_then_the_runner_on_a_probe_page(heavy_dirs):
    fetch = heavy_dirs / "envs" / "heavyfake" / "bin" / "fetch"
    fetch.parent.mkdir(parents=True)
    fetch.write_text('#!/bin/sh\nmkdir -p "$MINERU_HOME" && echo "$@" > "$MINERU_HOME/args.txt"\n')
    fetch.chmod(0o755)
    tool = heavy_tool(heavy_dirs, PREFETCH_RUNNER, prefetch=(("fetch", "--tier", "basic"),))
    tools._prefetch(tool)
    assert (tools.models_dir(tool) / "mineru" / "args.txt").read_text().strip() == "--tier basic"
    assert (tools.models_dir(tool) / "huggingface" / "model.bin").stat().st_size == 1000
    assert tools.cache_mb(tool) == 0.0  # about 1 KB rounds to 0.0 MB


@pytest.mark.parametrize("body, message", [
    ('import sys\nprint("no model here", file=sys.stderr)\nsys.exit(4)\n', "probe run failed: no model here"),
    ('import json, sys\njson.dump({"pages": {"1": "  "}}, open(sys.argv[2], "w"))\n', "no text for page 1"),
])
def test_a_probe_run_that_gives_nothing_is_refused(heavy_dirs, body, message):
    with pytest.raises(tools.ToolNotReady, match=message):
        tools._prefetch(heavy_tool(heavy_dirs, body))


def test_a_heavy_install_resolves_as_pypi_stood_on_the_plan_date_and_fetches_before_the_marker(heavy_dirs, monkeypatch):
    calls = []
    _fake_uv(monkeypatch, calls=calls)
    monkeypatch.setattr(tools, "_prefetch", lambda tool: calls.append((["prefetch", tools.marker(tool).exists()], {})))
    tool = heavy_tool(heavy_dirs, "", requirements=("heavyfake==1.0",), import_name="heavyfake",
                      exclude_newer=tools.EXCLUDE_NEWER)
    tools.install(tool, free_bytes=100 * 2**30)
    pip = next(args for args, _ in calls if args[1:3] == ["pip", "install"])
    assert pip[-3:] == ["--exclude-newer", "2026-10-31", "heavyfake==1.0"]
    assert ["prefetch", False] in [args for args, _ in calls]  # models fetched before the marker is written
    assert tools.marker(tool).exists()


def test_a_heavy_install_whose_probe_gives_nothing_writes_no_marker(heavy_dirs, monkeypatch):
    _fake_uv(monkeypatch)  # stands in for every subprocess: the probe then writes no output at all
    tool = heavy_tool(heavy_dirs, "", requirements=("heavyfake==1.0",), import_name="heavyfake")
    with pytest.raises(tools.ToolNotReady, match="no text for page 1"):
        tools.install(tool, free_bytes=100 * 2**30)
    assert not tools.marker(tool).exists()


def test_the_disk_guard_says_how_much_is_free(monkeypatch):
    monkeypatch.setattr(tools.subprocess, "run", lambda *a, **k: pytest.fail("must not install"))
    with pytest.raises(tools.DiskSpaceError, match=r"less than 3 GB free \(3\.0 GB free now\)"):
        tools.install(tools.TOOLS["opendataloader"], free_bytes=3 * 2**30)


def test_clear_models_deletes_only_that_methods_model_folder(heavy_dirs):
    tool = heavy_tool(heavy_dirs, "")
    blob = tools.models_dir(tool) / "huggingface" / "hub" / "blob"
    blob.parent.mkdir(parents=True)
    blob.write_bytes(b"x" * 3000)
    (blob.parent / "link").symlink_to(blob)  # a Hugging Face snapshot link: not counted twice
    other = tools.models_root() / "othertool" / "keep.bin"
    other.parent.mkdir(parents=True)
    other.write_bytes(b"y")
    assert tools.dir_bytes(tools.models_dir(tool)) == 3000
    assert tools.clear_models(tool) == 3000
    assert not tools.models_dir(tool).exists() and other.exists()
    assert tools.clear_models(tool) == 0
    with pytest.raises(ValueError, match="keeps no downloaded models"):
        tools.clear_models(tools.TOOLS["markitdown"])
    assert tools.cache_mb(tools.TOOLS["markitdown"]) is None
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_tools.py -q`
Expected: the new tests FAIL (`unexpected keyword argument 'downloads_models'`, `no attribute 'runner_env'`, the disk message has no free-space figure).

- [ ] **Step 3: Implement**

In `backend/eval/parser_bench/tools.py`:

(a) Extend the module docstring with:

```
Heavy methods (docling, marker, mineru, paddleocr, paddleocr_vl) download models. Each keeps them in its own
folder under models_root() (every cache variable its libraries read points there, CACHE_VARS), with usage
reporting off (QUIET_VARS). Its install resolves as PyPI stood on EXCLUDE_NEWER, imports the module, and then
fetches the models (its own download command, then one run of its runner on a synthetic page) before it counts
as installed. Its timed runs are held to the spec's time limit (TIME_LIMIT_PER_PAGE; execute.py).
```

(b) Add `import stat` and `import tempfile` to the imports.

(c) After `INSTALLED_MARKER = …` add:

```python
TIME_LIMIT_PER_PAGE = 120.0  # spec: "A variant slower than 120 s/page on the M1 is recorded as did not run here"
EXCLUDE_NEWER = "2026-10-31"  # heavy installs resolve as PyPI stood on this day (Plan 3b): a reinstall is the same
# Every place a heavy method's libraries keep downloaded models, each pointed into that method's own folder under
# models_root(): never the repository, never the data folder, never a cache shared with Abi's other tools.
CACHE_VARS = {
    "HF_HOME": "huggingface",            # Hugging Face hub: docling, surya (marker), mineru, paddlex
    "TORCH_HOME": "torch",
    "XDG_CACHE_HOME": "xdg",
    "MODELSCOPE_CACHE": "modelscope",    # mineru and paddlex can download from ModelScope
    "PADDLE_PDX_CACHE_HOME": "paddlex",  # PaddleX official models (paddleocr, paddleocr_vl)
    "MINERU_HOME": "mineru",             # MinerU's config.yaml and models
    "MODEL_CACHE_DIR": "datalab",        # surya's model cache (marker)
    "EASYOCR_MODULE_PATH": "easyocr",
}
# Usage reporting off: nothing of the benchmark leaves the Mac except through the paid methods (spec, Safety).
QUIET_VARS = {"HF_HUB_DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1", "MINERU_TELEMETRY_DISABLED": "1"}
```

(d) Add these fields at the end of `Tool` (after `temperature`):

```python
    downloads_models: bool = False       # heavy methods: models in models_dir(), fetched at install (_prefetch)
    prefetch: tuple[tuple[str, ...], ...] = ()  # download commands from the environment's bin/, run at install
    limit_per_page: float | None = None  # the spec's time limit (s/page) for its timed runs; None: no limit
    exclude_newer: str | None = None     # uv resolves the install as PyPI stood on this date
```

(e) After `marker(tool)` add:

```python
def models_root() -> Path:
    root = Path(os.environ.get("PARSER_BENCH_MODELS") or Path.home() / ".cache" / "learnstation-parser-bench" / "models")
    return root.expanduser().resolve()


def models_dir(tool: Tool) -> Path:
    return models_root() / tool.id


def bin_dir() -> Path:
    """Programs the bench needs that uv cannot install (llama.cpp's llama-server, for marker) may live here."""
    root = Path(os.environ.get("PARSER_BENCH_BIN") or Path.home() / ".cache" / "learnstation-parser-bench" / "bin")
    return root.expanduser().resolve()


def which(program: str) -> str | None:
    """A program in bin_dir() first, else on PATH."""
    local = bin_dir() / program
    if local.is_file() and os.access(local, os.X_OK):
        return str(local)
    return shutil.which(program)


def runner_env(tool: Tool) -> dict[str, str] | None:
    """The environment a heavy method's runner starts with: its own model folders, usage reporting off, and
    bin_dir() first on PATH. None for every other method, which inherits the environment unchanged."""
    if not tool.downloads_models:
        return None
    env = dict(os.environ)
    env.update({var: str(models_dir(tool) / sub) for var, sub in CACHE_VARS.items()})
    env.update(QUIET_VARS)
    env["PATH"] = os.pathsep.join([str(bin_dir()), os.environ.get("PATH", "")])
    return env


def dir_bytes(path: Path) -> int:
    """Bytes in the regular files under `path`. Symbolic links (the Hugging Face cache's snapshots) are neither
    followed nor counted, so each downloaded file counts once."""
    total = 0
    for folder, _dirs, names in os.walk(path):
        for name in names:
            try:
                info = os.lstat(os.path.join(folder, name))
            except OSError:
                continue
            if stat.S_ISREG(info.st_mode):
                total += info.st_size
    return total


def cache_mb(tool: Tool) -> float | None:
    """The size of a heavy method's model folder in MB (0.0 when it has none yet); None for other methods."""
    if not tool.downloads_models:
        return None
    target = models_dir(tool)
    return round(dir_bytes(target) / 2**20, 1) if target.exists() else 0.0


def clear_models(tool: Tool) -> int:
    """Delete a heavy method's downloaded models (spec: "its model files are deleted if needed"); its environment
    and its runs stay. Returns the bytes freed. The next warm-up downloads them again, untimed."""
    if not tool.downloads_models:
        raise ValueError(f"{tool.id} keeps no downloaded models")
    target = models_dir(tool)
    if target.parent != models_root():
        raise ValueError(f"{target} is not a model folder of the bench")
    if not target.exists():
        return 0
    freed = dir_bytes(target)
    shutil.rmtree(target)
    return freed


def probe_pdf(path: Path) -> Path:
    """A one-page synthetic PDF with no course content: what install runs a heavy method on to fetch its models."""
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=842, height=595)
    page.insert_text((60, 110), "Probe page", fontsize=28)
    page.insert_text((60, 170), "- a first point", fontsize=16)
    page.insert_text((60, 200), "- a second point", fontsize=16)
    doc.save(path)
    doc.close()
    return path
```

(f) In `missing()`, replace `gaps = [program for program in tool.needs if shutil.which(program) is None]` with `gaps = [program for program in tool.needs if which(program) is None]`.

(g) In `install()`, replace the disk check and the `try` block with:

```python
    if free - tool.size_mb * 2**20 < FREE_FLOOR:
        with_models = " with its models" if tool.downloads_models else ""
        raise DiskSpaceError(f"installing {tool.id} (~{tool.size_mb} MB{with_models}) would leave less than 3 GB free "
                             f"({free / 2**30:.1f} GB free now)")
    uv = _uv()
    env = envs_root() / tool.id
    marker(tool).unlink(missing_ok=True)  # a failed reinstall must not inherit the earlier "installed" mark
    try:
        if not env_python(tool).exists():
            subprocess.run([uv, "venv", "--python", tool.python, str(env)], check=True, timeout=INSTALL_TIMEOUT)
        pip = [uv, "pip", "install", "--python", str(env_python(tool))]
        if tool.exclude_newer:
            pip += ["--exclude-newer", tool.exclude_newer]
        subprocess.run([*pip, *tool.requirements], check=True, timeout=INSTALL_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise ToolNotReady(f"{tool.id} install timed out") from None
    _check_imports(tool)
    _prefetch(tool)
    marker(tool).write_text("\n".join(_freeze(tool)) + "\n", encoding="utf-8")
    return environment(tool)
```

(h) After `_check_imports`, add:

```python
def _prefetch(tool: Tool) -> None:
    """A heavy method downloads its models now, not in a run: its own download commands (from its environment's
    bin/), then one run of its runner on a synthetic page, which must give back text for page 1. The probe also
    checks the runner against the library actually installed. Any failure leaves the method uninstalled."""
    if not tool.downloads_models:
        return
    env = runner_env(tool)
    models_dir(tool).mkdir(parents=True, exist_ok=True)
    try:
        for step in tool.prefetch:
            subprocess.run([str(env_python(tool).parent / step[0]), *step[1:]], check=True,
                           timeout=INSTALL_TIMEOUT, env=env)
        with tempfile.TemporaryDirectory() as tmp:
            pdf, out = probe_pdf(Path(tmp) / "probe.pdf"), Path(tmp) / "out.json"
            probe = subprocess.run([*command(tool), str(pdf), str(out)], capture_output=True, text=True,
                                   timeout=INSTALL_TIMEOUT, env=env, cwd=tmp, stdin=subprocess.DEVNULL)
            if probe.returncode != 0:
                lines = (probe.stderr or probe.stdout or "").strip().splitlines()
                detail = lines[-1] if lines else f"exit code {probe.returncode}"
                raise ToolNotReady(f"{tool.id} installed but its probe run failed: {detail}")
            try:
                pages = json.loads(out.read_text(encoding="utf-8")).get("pages")
            except (OSError, ValueError, AttributeError):
                pages = None
            if not isinstance(pages, dict) or not str(pages.get("1", "")).strip():
                raise ToolNotReady(f"{tool.id} installed but its probe run gave no text for page 1")
    except subprocess.TimeoutExpired:
        raise ToolNotReady(f"{tool.id}: downloading its models or its probe run timed out") from None
```

(i) After `_tesseract_version`, add:

```python
def _llama_version() -> str:
    """llama.cpp's version line, for a method that needs llama-server (marker runs its VLM through it here)."""
    program = which("llama-server")
    if program is None:
        return "llama-server: not installed"
    probe = subprocess.run([program, "--version"], capture_output=True, text=True, timeout=ENV_TIMEOUT)
    text = "\n".join(part for part in (probe.stdout, probe.stderr) if part).strip()
    found = [line for line in text.splitlines() if "version" in line.lower()]
    line = found[0] if found else (text.splitlines()[0] if text else "no version output")
    return f"llama-server {line.strip()}"
```

and in `environment()`, before `if tool.ocr:`, add:

```python
    if "llama-server" in tool.needs:
        lines.append(_llama_version())
```

- [ ] **Step 4: Run the tools tests and the rest of the bench**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_tools.py -q && $PY -m pytest backend/tests/unit/test_parser_bench_*.py -q`
Expected: all pass. No existing method has `downloads_models`, so `_prefetch` and `runner_env` change nothing for them.

- [ ] **Step 5: Commit**

```bash
git status --short
git add backend/eval/parser_bench/tools.py backend/tests/unit/test_parser_bench_tools.py
git commit -m "feat(parser-bench): heavy methods keep their models apart, install reproducibly and fetch models at install

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Heavy runs in `execute.py`: their environment, the 120 s/page limit, the model folder

**Files:**
- Modify: `backend/eval/parser_bench/execute.py` (module docstring, imports, `RunnerError`, `invoke`, new helpers, `_run_in_slot`)
- Modify: `backend/tests/unit/test_parser_bench_execute.py`

**Interfaces:**
- Consumes: `tools.runner_env`, `tools.cache_mb`, `Tool.limit_per_page`, `Tool.downloads_models` (Task 4).
- Produces:
  - `RunnerError(..., timed_out: bool = False)`, with `.timed_out`. `invoke()` starts the runner with `env=runner_env(tool)`.
  - New `run.json` fields:
    - for a method with a time limit: `time_limit_per_page`, `time_limit_s` and `did_not_run_here` (bool);
    - for a method that downloads models: `model_cache_mb` and `models_downloaded_in_timed_run` (bool, or None when the warm-up failed).
  - A timed run past `limit_per_page × pages` is stopped at that limit and kept as failed, `failed_stage: "timed"`, reason `did not run here: slower than … s/page on this Mac (…)`.
  - The warm-up keeps the plain `timeout`.
  - `_time_limit(tool, pages) -> float | None`, `_limit_fields`, `_too_slow`, `_cache_fields`.
  - Records of fast and paid methods are unchanged.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_parser_bench_execute.py` add `from backend.eval.parser_bench import tools` to the imports, and add at the end:

```python
FAKE_ENV = r'''
import json, os, sys
import fitz
with fitz.open(sys.argv[1]) as d:
    pages = {str(n): "" for n in range(1, len(d) + 1)}
seen = {k: os.environ.get(k) for k in ("HF_HOME", "MINERU_TELEMETRY_DISABLED")}
seen["PATH0"] = os.environ["PATH"].split(os.pathsep)[0]
json.dump({"version": "1", "settings": seen, "pages": pages}, open(sys.argv[2], "w"))
'''
FAKE_WARM_SLOW = '''
import json, sys, time
import fitz
with fitz.open(sys.argv[1]) as d:
    n = len(d)
if n <= 2:
    time.sleep(4)
json.dump({"version": "1", "settings": {}, "pages": {str(p): "" for p in range(1, n + 1)}}, open(sys.argv[2], "w"))
'''
FAKE_DOWNLOADS = r'''
import json, os, sys
import fitz
with fitz.open(sys.argv[1]) as d:
    n = len(d)
if n > 2:  # the timed run, not the warm-up, fetches a model
    os.makedirs(os.environ["HF_HOME"], exist_ok=True)
    open(os.path.join(os.environ["HF_HOME"], "late.bin"), "wb").write(b"m" * (3 * 2**20))
json.dump({"version": "1", "settings": {}, "pages": {str(p): "" for p in range(1, n + 1)}}, open(sys.argv[2], "w"))
'''


def heavy_registry(tmp_path, name, body, **kw):
    script = tmp_path / f"{name}.py"
    script.write_text(body)
    return {name: Tool(name, name, "heavy", str(script), "test double", downloads_models=True, **kw)}


@pytest.fixture
def heavy_dirs(tmp_path, monkeypatch):
    monkeypatch.setenv("PARSER_BENCH_MODELS", str(tmp_path / "models"))
    monkeypatch.setenv("PARSER_BENCH_BIN", str(tmp_path / "bin"))
    monkeypatch.delenv("HF_HOME", raising=False)
    return tmp_path


def test_a_heavy_method_runs_with_its_own_model_folders(tmp_path, deck, heavy_dirs):
    reg = heavy_registry(tmp_path, "hv", FAKE_ENV)
    run = execute.run_tool("hv", deck, warmup=False, root=tmp_path / "data", registry=reg)
    s = run.meta["settings"]
    assert s["HF_HOME"] == str(tools.models_dir(reg["hv"]) / "huggingface")
    assert s["MINERU_TELEMETRY_DISABLED"] == "1" and s["PATH0"] == str(tools.bin_dir())
    assert run.meta["model_cache_mb"] == 0.0 and run.meta["models_downloaded_in_timed_run"] is False
    assert "time_limit_s" not in run.meta  # this double has no time limit


def test_a_fast_method_inherits_the_environment_and_its_record_is_unchanged(tmp_path, deck, monkeypatch):
    monkeypatch.delenv("HF_HOME", raising=False)
    run = execute.run_tool("fe", deck, warmup=False, root=tmp_path / "data", registry=registry(tmp_path, "fe", FAKE_ENV))
    assert run.meta["settings"]["HF_HOME"] is None
    assert not {"model_cache_mb", "time_limit_s", "did_not_run_here"} & set(run.meta)


def test_a_heavy_run_past_the_time_limit_did_not_run_here(tmp_path, deck, heavy_dirs):
    reg = heavy_registry(tmp_path, "hs", FAKE_SLOW, limit_per_page=0.2)  # 6 pages: stopped at 1.2 s
    started = time.monotonic()
    run = execute.run_tool("hs", deck, warmup=False, timeout=60, root=tmp_path / "data", registry=reg)
    assert time.monotonic() - started < 20  # stopped at the limit, not at the 60 s timeout
    m = run.meta
    assert (m["status"], m["failed_stage"], m["did_not_run_here"]) == ("failed", "timed", True)
    assert (m["time_limit_s"], m["time_limit_per_page"], m["seconds_per_page"]) == (1.2, 0.2, None)
    assert m["reason"].startswith("did not run here: slower than 0.2 s/page on this Mac")
    assert m["model_cache_mb"] == 0.0


def test_the_warmup_is_not_held_to_the_time_limit(tmp_path, deck, heavy_dirs):
    reg = heavy_registry(tmp_path, "hw", FAKE_WARM_SLOW, limit_per_page=0.5)  # timed run 3 s; the warm-up sleeps 4 s
    run = execute.run_tool("hw", deck, timeout=30, root=tmp_path / "data", registry=reg)
    m = run.meta
    assert m["status"] == "finished" and m["did_not_run_here"] is False and m["warmup_seconds"] >= 4
    assert m["time_limit_s"] == 3.0


def test_a_model_download_during_the_timed_run_is_recorded(tmp_path, deck, heavy_dirs):
    reg = heavy_registry(tmp_path, "hd", FAKE_DOWNLOADS)
    run = execute.run_tool("hd", deck, root=tmp_path / "data", registry=reg)
    assert run.meta["models_downloaded_in_timed_run"] is True and run.meta["model_cache_mb"] == 3.0


def test_a_failed_heavy_warmup_does_not_claim_a_download_either_way(tmp_path, deck, heavy_dirs):
    run = execute.run_tool("hf", deck, root=tmp_path / "data", registry=heavy_registry(tmp_path, "hf", FAKE_FAIL))
    assert run.meta["failed_stage"] == "warmup" and run.meta["models_downloaded_in_timed_run"] is None
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_execute.py -q`
Expected: the new tests FAIL. The runner does not get `HF_HOME`; `model_cache_mb` and `did_not_run_here` are missing; the slow run waits for the 60 s timeout.

- [ ] **Step 3: Implement**

In `backend/eval/parser_bench/execute.py`:

(a) Append to the module docstring:

```
A heavy method (tools.Tool.downloads_models) runs with its own model folders (tools.runner_env). Its timed run is
held to the spec's time limit, limit_per_page × the pages it is given: past it the run is stopped, kept as failed
with did_not_run_here, and the method "did not run here" (spec, contenders). Its warm-up keeps the plain timeout,
because it may include a one-time model download. Its record says how large its model folder is and whether the
folder grew during the timed run (a download the warm-up should have made).
```

(b) Change the tools import to:

```python
from backend.eval.parser_bench.tools import (TOOLS, Tool, ToolNotReady, cache_mb, command, environment, missing,
                                             paid_args, runner_env)
```

(c) Replace `RunnerError.__init__` with:

```python
    def __init__(self, message: str, log: str = "", *, output: bool = False, seconds: float | None = None,
                 api: dict | None = None, timed_out: bool = False):
        super().__init__(message)
        self.log = log
        self.output = output
        self.seconds = seconds
        self.api = api
        self.timed_out = timed_out
```

and add to its docstring: `timed_out is True when the runner was stopped at its timeout.`

(d) In `invoke`, add `env=runner_env(tool),` to the `subprocess.Popen(...)` arguments (after `cwd=tmp,`), and replace the timeout raise with:

```python
        if timed_out:
            raise RunnerError(f"{tool.id} timed out after {timeout:.0f} s", text,
                              api=_partial(out).get("api") if tool.paid else None, timed_out=True)
```

(e) After `_timing` add:

```python
def _time_limit(tool: Tool, pages: int) -> float | None:
    """The spec's time limit for a timed run over `pages` pages, in seconds; None for a method without one."""
    return None if tool.limit_per_page is None else round(tool.limit_per_page * pages, 1)


def _limit_fields(tool: Tool, limit: float | None, exceeded: bool) -> dict:
    if limit is None:
        return {}
    return {"time_limit_per_page": tool.limit_per_page, "time_limit_s": limit, "did_not_run_here": exceeded}


def _too_slow(tool: Tool, limit: float, pages: int) -> str:
    return (f"did not run here: slower than {tool.limit_per_page:g} s/page on this Mac "
            f"(the timed run passed its time limit of {limit:g} s for {pages} pages)")


def _cache_fields(tool: Tool, before: float | None) -> dict:
    """A heavy method's model folder after the run, and whether it grew during the timed run. `before` is its size
    just before the timed run (None when the run failed earlier: then nothing is claimed either way)."""
    if not tool.downloads_models:
        return {}
    after = cache_mb(tool)
    grew = None if before is None or after is None else after - before > 1.0
    return {"model_cache_mb": after, "models_downloaded_in_timed_run": grew}
```

(f) Replace `_run_in_slot` with:

```python
def _run_in_slot(tool: Tool, tool_id: str, pdf: Path, wanted: list[int], total: int, source: dict,
                 facts: checks.DocFacts, purpose: str, extra: dict, root: Path, warmup: bool,
                 timeout: float, cancel: threading.Event | None, stage: Callable[[str], None],
                 args: list[str]) -> store.ExtractRun:
    # The record names the code as it was when the run started, not after a long run during which
    # a commit may have landed.
    started, git = store.now_iso(), store.git_state()
    record = dict(source=source, purpose=purpose, started_at=started, extra=extra, root=root, git=git,
                  checks_version=checks.CHECKS_VERSION)
    version, warm_seconds, step = "unknown", None, "warmup"
    per_page = len(wanted) if tool.paid else total  # a paid method's time is over the pages it was sent
    limit = _time_limit(tool, per_page)  # a heavy method's timed run stops here; its warm-up keeps `timeout`
    cache_before = None
    try:
        if warmup:
            stage("warmup")
            with tempfile.TemporaryDirectory() as tmp:
                warm = invoke(tool, two_page_sample(pdf, Path(tmp) / "warmup.pdf"), timeout=timeout, cancel=cancel)
            version, warm_seconds = warm.version, round(warm.seconds, 2)
        step = "timed"
        stage("timed")
        cache_before = cache_mb(tool)
        result = invoke(tool, pdf, args=args, timeout=timeout if limit is None else limit, cancel=cancel)
    except RunnerError as e:
        if step == "timed" and e.output:
            step = "output"  # the timed run ran to its end, so its time is known
        too_slow = step == "timed" and e.timed_out and limit is not None
        fields = {"pages_scored": wanted, "timeout_s": timeout, "warmup_seconds": warm_seconds,
                  **_timing(e.seconds if step == "output" else None, per_page),
                  **_paid_fields(tool, e.api, wanted, finished=False),
                  **_limit_fields(tool, limit, too_slow), **_cache_fields(tool, cache_before)}
        run = store.ExtractRun.create(tool=tool_id, version=version, **record)
        with _seal_on_error(run, tool, fields):
            run.append_log(paid.redact(e.log) if tool.paid else e.log)
            run.finish("failed", reason=_too_slow(tool, limit, per_page) if too_slow else str(e), failed_stage=step,
                       environment=_environment(tool), **fields)
        return run
    except KeyboardInterrupt as e:
        if not (tool.paid and step == "timed"):
            raise
        # Ctrl-C while a paid method ran: it may have been charged, so the record is kept (sealed failed) first.
        partial = getattr(e, "paid_partial", None) or {}
        fields = {"pages_scored": wanted, "timeout_s": timeout, "warmup_seconds": warm_seconds,
                  **_timing(None, per_page), **_paid_fields(tool, partial.get("api"), wanted, finished=False)}
        run = store.ExtractRun.create(tool=tool_id, version=version, **record)
        with _seal_on_error(run, tool, fields):
            run.append_log(partial.get("log", ""))
            run.finish("failed", reason="interrupted", failed_stage="timed", environment=_environment(tool), **fields)
        raise

    if limit is not None and result.seconds > limit:  # it ended within the last poll step past the limit
        fields = {"pages_scored": wanted, "timeout_s": timeout, "warmup_seconds": warm_seconds,
                  **_timing(result.seconds, per_page), "peak_memory_mb": result.peak_mb,
                  **_limit_fields(tool, limit, True), **_cache_fields(tool, cache_before)}
        run = store.ExtractRun.create(tool=tool_id, version=result.version, settings=result.settings, **record)
        with _seal_on_error(run, tool, fields):
            run.append_log(result.log)
            run.finish("failed", reason=_too_slow(tool, limit, per_page), failed_stage="timed",
                       environment=_environment(tool), **fields)
        return run

    stage("scoring")
    # A tool that leaves out any page of the file has not extracted the file: the run
    # is kept, with the pages it did produce, but it is failed (ruling R1). A paid method is given only
    # the pages it scores, so those are the pages it must produce.
    expected = wanted if tool.paid else list(range(1, total + 1))
    absent = [p for p in expected if p not in result.pages]
    fields = {"pages_scored": wanted, "missing_pages": absent, "timeout_s": timeout, "warmup_seconds": warm_seconds,
              **_timing(result.seconds, per_page), "peak_memory_mb": result.peak_mb,
              **_paid_fields(tool, result.api, wanted, finished=not absent),
              **_limit_fields(tool, limit, False), **_cache_fields(tool, cache_before)}
    run = store.ExtractRun.create(tool=tool_id, version=result.version, settings=result.settings, **record)
    with _seal_on_error(run, tool, fields):
        run.append_log(paid.redact(result.log) if tool.paid else result.log)
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

- [ ] **Step 4: Run the execute tests and the rest of the bench**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_execute.py -q && $PY -m pytest backend/tests/unit/test_parser_bench_*.py -q`
Expected: all pass, the paid-run tests and both golden pins included.

- [ ] **Step 5: Commit**

```bash
git status --short
git add backend/eval/parser_bench/execute.py backend/tests/unit/test_parser_bench_execute.py
git commit -m "feat(parser-bench): heavy runs get their model folders and the 120 s/page limit (did not run here)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The `docling` runner and the first heavy method

**Files:**
- Create: `backend/eval/parser_bench/runners/docling_runner.py`
- Modify: `backend/eval/parser_bench/tools.py` (register `docling`)
- Modify: `backend/tests/unit/test_parser_bench_runners.py`, `backend/tests/unit/test_parser_bench_tools.py`, `backend/tests/unit/test_parser_bench_runners_live.py`

**Interfaces:**
- Consumes: the runner contract (`execute._shape`: `{"version", "settings", "pages": {"1": text, …}}`, every page of the file); `TIME_LIMIT_PER_PAGE`, `EXCLUDE_NEWER` (Task 4).
- Produces:
  - `docling_runner.pages_from_document(doc, page_count) -> dict[str, str]` and `docling_runner.device() -> str`.
  - `tools.TOOLS["docling"]`, the first entry of the Heavy group.
  - `test_every_runner_has_usage_in_its_docstring` now compares the runner files with the registered runners.
  - The live test skips a heavy method without models and gives it 1800 s.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_parser_bench_runners.py`, replace `test_every_runner_has_usage_in_its_docstring` with:

```python
def test_every_runner_has_usage_in_its_docstring_and_is_registered():
    from backend.eval.parser_bench import tools

    runners = [f for f in RUNNERS.iterdir() if f.is_file() and f.suffix in (".py", ".mjs")]
    assert {f.name for f in runners} == {t.runner_path.name for t in tools.TOOLS.values()}
    for f in runners:
        assert "Usage:" in f.read_text(encoding="utf-8"), f.name
```

and add at the end:

```python
class FakeDoclingDoc:
    """What DoclingDocument offers the runner: pages by number and a Markdown export per page."""

    def __init__(self, numbers):
        self.pages = {n: object() for n in numbers}

    def export_to_markdown(self, page_no=None):
        return f"# page {page_no}"


def test_docling_reads_one_markdown_text_per_page():
    docling = _load("docling_runner")  # imports without docling: that import lives in main()
    assert docling.pages_from_document(FakeDoclingDoc([2, 1, 3]), 3) == {"1": "# page 1", "2": "# page 2", "3": "# page 3"}
    with pytest.raises(ValueError, match=r"pages \[1, 3\] for a PDF of 3 pages"):
        docling.pages_from_document(FakeDoclingDoc([1, 3]), 3)
    # docling 2.92.0 is in the backend .venv from the design demo, so the device may resolve here or be "unknown"
    assert isinstance(docling.device(), str) and docling.device()
```

In `backend/tests/unit/test_parser_bench_tools.py`, replace `test_the_methods_are_registered` with:

```python
HEAVY = ["docling"]


def test_the_methods_are_registered():
    fast = ["current", "pymupdf4llm", "pdfjs", "markitdown", "opendataloader"]
    assert list(tools.TOOLS) == [*fast, "ai_vision", "ai_vision_strong", *HEAVY]
    assert [t.id for t in tools.TOOLS.values() if t.group == "fast"] == fast
    assert [t.id for t in tools.TOOLS.values() if t.paid] == ["ai_vision", "ai_vision_strong"]
    assert [t.id for t in tools.TOOLS.values() if t.group == "heavy"] == HEAVY


def test_the_heavy_methods_are_pinned_limited_and_keep_their_models_apart():
    for tool in (tools.TOOLS[t] for t in HEAVY):
        assert tool.downloads_models and tool.limit_per_page == 120.0 and tool.exclude_newer == "2026-10-31", tool.id
        assert tool.requirements and all("==" in r for r in tool.requirements), tool.id
        assert tool.python == "3.12" and tool.import_name and not tool.paid, tool.id


def test_docling_is_pinned():
    assert tools.TOOLS["docling"].requirements == ("docling==2.145.0",)
    assert tools.TOOLS["docling"].import_name == "docling"
```

In `backend/tests/unit/test_parser_bench_runners_live.py`, replace the body after the readiness skip with:

```python
    if tool.downloads_models and not tools.cache_mb(tool):
        pytest.skip(f"{tool_id}: its models are not downloaded (tests never download models)")
    timeout = 1800 if tool.group == "heavy" else 600
    result = execute.invoke(tool, make_deck(tmp_path / "deck.pdf"), timeout=timeout)
    assert sorted(result.pages) == [1, 2, 3, 4, 5, 6]
    for page, title in zip(range(1, 7), TITLES):
        assert title.split()[0].lower() in result.pages[page].lower(), (tool_id, page)
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_runners.py backend/tests/unit/test_parser_bench_tools.py -q`
Expected: FAIL (no `docling_runner.py`, no `docling` in `TOOLS`).

- [ ] **Step 3: Write the runner**

Create `backend/eval/parser_bench/runners/docling_runner.py`:

```python
"""`docling`: Docling's default PDF pipeline (its layout model, TableFormer for tables, OCR where Docling
decides a page needs it), one Markdown text per page from export_to_markdown(page_no=n). Nothing is passed to
the converter: every setting is Docling's default, the device included (its "auto" picks MPS on Apple Silicon).
Images keep Docling's default placeholder, which the bench turns into [figure] like every other image.

Exits non-zero, writing nothing, unless the conversion succeeded and the document holds exactly pages 1..N of
the PDF: a partial result must never be scored as Docling's result.

Usage: python -I docling_runner.py <in.pdf> <out.json>
"""
import json
import sys
from importlib.metadata import version


def pages_from_document(doc, page_count: int) -> dict:
    """{"1": markdown, ..., "N": markdown} from a DoclingDocument; ValueError unless its pages are exactly 1..N."""
    numbers = sorted(int(n) for n in doc.pages)
    if numbers != list(range(1, page_count + 1)):
        raise ValueError(f"the document has pages {numbers} for a PDF of {page_count} pages")
    return {str(n): doc.export_to_markdown(page_no=n) for n in numbers}


def device() -> str:
    """The device Docling's default accelerator setting resolves to here, or "unknown" when it cannot be read."""
    try:
        try:
            from docling.datamodel.accelerator_options import AcceleratorOptions
        except ImportError:
            from docling.datamodel.pipeline_options import AcceleratorOptions
        from docling.utils.accelerator_utils import decide_device

        return str(decide_device(AcceleratorOptions().device))
    except Exception:
        return "unknown"


def count_pages(path: str) -> int:
    import pypdfium2

    pdf = pypdfium2.PdfDocument(path)
    try:
        return len(pdf)
    finally:
        pdf.close()


def main(argv: list) -> None:
    from docling.document_converter import DocumentConverter

    src, out = argv[1], argv[2]
    page_count = count_pages(src)
    result = DocumentConverter().convert(src)
    status = getattr(result.status, "name", str(result.status))
    if status != "SUCCESS":
        raise SystemExit(f"docling_runner: the conversion ended as {status}")
    try:
        pages = pages_from_document(result.document, page_count)
    except ValueError as err:
        raise SystemExit(f"docling_runner: {err}")
    data = {
        "version": version("docling"),
        "settings": {"pipeline": "default", "export": "export_to_markdown(page_no=n)", "device": device()},
        "pages": pages,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
```

- [ ] **Step 4: Register it**

In `backend/eval/parser_bench/tools.py`, add to the `TOOLS` tuple after the `ai_vision_strong` entry:

```python
    Tool("docling", "Docling", "heavy", "docling_runner.py",
         "IBM's layout model and TableFormer, default pipeline", requirements=("docling==2.145.0",),
         size_mb=1800, import_name="docling", downloads_models=True, limit_per_page=TIME_LIMIT_PER_PAGE,
         exclude_newer=EXCLUDE_NEWER),
```

(`size_mb` is the guard's estimate of environment plus models: torch and Docling's packages about 1.3 GB, its layout and table models about 0.5 GB. Task 11 records the real size.)

- [ ] **Step 5: Run the tests**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_runners.py backend/tests/unit/test_parser_bench_tools.py backend/tests/unit/test_parser_bench_runners_live.py backend/tests/unit/test_parser_bench_server.py backend/tests/unit/test_parser_bench_cli.py -q`
Expected: all pass. The live test skips `docling` ("not installed"). The server's `/api/methods` and the CLI's `tools` now list it as needing its environment.

- [ ] **Step 6: Commit**

```bash
git status --short
git add backend/eval/parser_bench/runners/docling_runner.py backend/eval/parser_bench/tools.py \
  backend/tests/unit/test_parser_bench_runners.py backend/tests/unit/test_parser_bench_tools.py backend/tests/unit/test_parser_bench_runners_live.py
git commit -m "feat(parser-bench): docling runner — default pipeline, Markdown per page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The `marker` runner

**Files:**
- Create: `backend/eval/parser_bench/runners/marker_runner.py`
- Modify: `backend/eval/parser_bench/tools.py` (register `marker`)
- Modify: `backend/tests/unit/test_parser_bench_runners.py`, `backend/tests/unit/test_parser_bench_tools.py`

**Interfaces:**
- Consumes: the runner contract; `Tool.needs`, `tools.which`, `_llama_version` (Task 4).
- Produces:
  - `marker_runner.split_pages(markdown, page_count) -> dict[str, str]`, `marker_runner.MARK`, `marker_runner.device() -> str`.
  - `tools.TOOLS["marker"]` with `needs=("llama-server",)`.

marker 2 marks each page of its paginated Markdown with a line holding the page's zero-based id in braces followed by 48 dashes (`{0}------…`). The runner refuses anything else. If the installed version writes the mark differently, the install's probe run fails with the runner's own message, and Task 11 stops; the runner is never guessed into shape.

- [ ] **Step 1: Write the failing tests**

At the end of `backend/tests/unit/test_parser_bench_runners.py` add:

```python
def _paginated(pages):
    return "".join(f"\n\n{{{n}}}" + "-" * 48 + f"\n\n{text}" for n, text in pages)


def test_marker_splits_its_paginated_markdown_at_its_page_marks():
    marker = _load("marker_runner")  # imports without marker: that import lives in main()
    assert marker.split_pages(_paginated([(0, "# A\n\nline"), (1, ""), (2, "C  ")]), 3) == {"1": "# A\n\nline", "2": "", "3": "C"}
    with pytest.raises(ValueError, match="page marks"):
        marker.split_pages(_paginated([(0, "A"), (2, "C")]), 3)
    with pytest.raises(ValueError, match="page marks"):
        marker.split_pages("no marks at all", 1)
    with pytest.raises(ValueError, match="before the first page mark"):
        marker.split_pages("stray" + _paginated([(0, "A")]), 1)
    assert marker.split_pages(_paginated([(0, "a line of ------------------------------------------------ dashes")]), 1)["1"].startswith("a line")
    assert marker.device() == "unknown"
```

In `backend/tests/unit/test_parser_bench_tools.py`, change `HEAVY = ["docling"]` to `HEAVY = ["docling", "marker"]` and add:

```python
def test_marker_is_pinned_and_needs_llama_server():
    marker = tools.TOOLS["marker"]
    assert marker.requirements == ("marker-pdf==2.1.0",) and marker.import_name == "marker"
    assert marker.needs == ("llama-server",)
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_runners.py backend/tests/unit/test_parser_bench_tools.py -q`
Expected: FAIL (no `marker_runner.py`, no `marker` in `TOOLS`).

- [ ] **Step 3: Write the runner**

Create `backend/eval/parser_bench/runners/marker_runner.py`:

```python
"""`marker`: marker-pdf's PdfConverter on its defaults, with paginate_output on, so that the Markdown marks
where each page starts (spec: "output split by page"). LLM enhancement stays off: use_llm is marker's default
False and is never set. Marker picks its own mode and device (on Apple Silicon: its "fast" mode, torch on MPS,
and its surya VLM through a local llama.cpp llama-server that it starts and stops itself, for equations and for
blocks whose text layer is bad).

Exits non-zero, writing nothing, unless the page marks give back exactly the pages of the PDF in order with no
text before the first mark: a partial result must never be scored as marker's result.

Usage: python -I marker_runner.py <in.pdf> <out.json>
"""
import json
import re
import sys
from importlib.metadata import version

# marker's paginated Markdown: a line "{N}" followed by 48 dashes before each page, N the zero-based page id.
MARK = re.compile(r"^\{(\d+)\}-{48}$", re.M)


def split_pages(markdown: str, page_count: int) -> dict:
    """{"1": text, ..., "N": text} from marker's paginated Markdown; ValueError unless the marks are 0..N-1 in
    order and nothing but white space precedes the first."""
    marks = list(MARK.finditer(markdown))
    ids = [int(m.group(1)) for m in marks]
    if not marks or ids != list(range(page_count)):
        raise ValueError(f"page marks {ids[:12]} for a PDF of {page_count} pages (expected 0..{page_count - 1})")
    before = markdown[: marks[0].start()].strip()
    if before:
        raise ValueError(f"{len(before)} characters of text before the first page mark")
    pages = {}
    for i, mark in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(markdown)
        pages[str(ids[i] + 1)] = markdown[mark.end():end].strip()
    return pages


def device() -> str:
    """The torch device marker's settings resolve to here, or "unknown" when it cannot be read."""
    try:
        from marker.settings import settings

        return str(settings.TORCH_DEVICE_MODEL)
    except Exception:
        return "unknown"


def count_pages(path: str) -> int:
    import pypdfium2

    pdf = pypdfium2.PdfDocument(path)
    try:
        return len(pdf)
    finally:
        pdf.close()


def main(argv: list) -> None:
    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict
    from marker.output import text_from_rendered

    src, out = argv[1], argv[2]
    page_count = count_pages(src)
    converter = PdfConverter(artifact_dict=create_model_dict(), config={"paginate_output": True})
    markdown, _, _ = text_from_rendered(converter(src))
    try:
        pages = split_pages(markdown, page_count)
    except ValueError as err:
        raise SystemExit(f"marker_runner: {err}")
    data = {
        "version": version("marker-pdf"),
        "settings": {"converter": "PdfConverter", "paginate_output": True, "use_llm": False,
                     "mode": "marker's default for the device", "device": device()},
        "pages": pages,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
```

- [ ] **Step 4: Register it**

In `backend/eval/parser_bench/tools.py`, add after the `docling` entry:

```python
    Tool("marker", "Marker", "heavy", "marker_runner.py",
         "surya layout and OCR models, LLM enhancement off; its VLM runs through llama.cpp",
         requirements=("marker-pdf==2.1.0",), needs=("llama-server",), size_mb=4000, import_name="marker",
         downloads_models=True, limit_per_page=TIME_LIMIT_PER_PAGE, exclude_newer=EXCLUDE_NEWER),
```

(The estimate: torch, transformers, surya and the API clients marker depends on, about 1.5 GB; the surya VLM and the small models about 2–2.5 GB.)

- [ ] **Step 5: Run the tests**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_runners.py backend/tests/unit/test_parser_bench_tools.py backend/tests/unit/test_parser_bench_runners_live.py -q`
Expected: all pass; the live test skips `marker`.

- [ ] **Step 6: Commit**

```bash
git status --short
git add backend/eval/parser_bench/runners/marker_runner.py backend/eval/parser_bench/tools.py \
  backend/tests/unit/test_parser_bench_runners.py backend/tests/unit/test_parser_bench_tools.py
git commit -m "feat(parser-bench): marker runner — defaults, LLM off, its own page marks split the output

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The `mineru` runner

**Files:**
- Create: `backend/eval/parser_bench/runners/mineru_runner.py`
- Modify: `backend/eval/parser_bench/tools.py` (register `mineru`)
- Modify: `backend/tests/unit/test_parser_bench_runners.py`, `backend/tests/unit/test_parser_bench_tools.py`

**Interfaces:**
- Consumes: the runner contract; `Tool.prefetch` (Task 4).
- Produces:
  - `mineru_runner.TIER = "basic"`;
  - `mineru_runner.pages_from_middle(middle, to_markdown, page_count) -> dict[str, str]`;
  - `mineru_runner.check_content_list(items, page_count) -> None`;
  - `tools.TOOLS["mineru"]` with `prefetch=(("mineru-kit", "models", "download", "--tier", "basic"),)`.

MinerU 4 (docs, 2026-10-31): `mineru.parser.parse(path, tier=…)` parses one document in-process; `mineru.render.render(result.middle_json, RenderFormat.MARKDOWN | CONTENT_LIST)` renders it. Its middle JSON has a `pdf_info` list, one entry per page with a zero-based `page_idx`, the same index the content list carries. The runner renders each page on its own with MinerU's own Markdown renderer, and checks that every content-list item lies on a page of the PDF. The install probe (Task 4) checks these assumptions against the installed library before any run.

- [ ] **Step 1: Write the failing tests**

At the end of `backend/tests/unit/test_parser_bench_runners.py` add:

```python
def test_mineru_renders_each_page_of_its_middle_json():
    mineru = _load("mineru_runner")  # imports without mineru: that import lives in main()
    middle = {"pdf_info": [{"page_idx": 1, "blocks": ["b"]}, {"page_idx": 0, "blocks": ["a"]}], "_backend": "x"}
    seen = []

    def to_markdown(one_page):
        seen.append(one_page)
        return "# " + "".join(one_page["pdf_info"][0].get("blocks", []))

    assert mineru.pages_from_middle(middle, to_markdown, 2) == {"1": "# a", "2": "# b"}
    assert all(m["_backend"] == "x" and len(m["pdf_info"]) == 1 for m in seen)  # each page keeps the document's keys
    with pytest.raises(ValueError, match=r"pages \[1\] for a PDF of 2 pages"):
        mineru.pages_from_middle({"pdf_info": [{"page_idx": 0}]}, to_markdown, 2)
    with pytest.raises(ValueError, match="no pdf_info list"):
        mineru.pages_from_middle({"pages": []}, to_markdown, 1)
    with pytest.raises(ValueError, match="page_idx 0 twice"):
        mineru.pages_from_middle({"pdf_info": [{"page_idx": 0}, {"page_idx": 0}]}, to_markdown, 1)
    assert mineru.TIER == "basic"


def test_mineru_content_list_items_must_lie_on_the_pdfs_pages():
    mineru = _load("mineru_runner")
    mineru.check_content_list([{"type": "text", "page_idx": 0}, {"type": "table", "page_idx": 1}], 2)
    with pytest.raises(ValueError, match=r"page_idx \[2\]"):
        mineru.check_content_list([{"type": "text", "page_idx": 2}], 2)
    with pytest.raises(ValueError, match="not a list"):
        mineru.check_content_list({"type": "text"}, 2)
```

In `backend/tests/unit/test_parser_bench_tools.py`, change `HEAVY` to `["docling", "marker", "mineru"]` and add:

```python
def test_mineru_is_pinned_and_downloads_its_basic_tier_models_at_install():
    mineru = tools.TOOLS["mineru"]
    assert mineru.requirements == ("mineru==4.1.3",) and mineru.import_name == "mineru"
    assert mineru.prefetch == (("mineru-kit", "models", "download", "--tier", "basic"),)
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_runners.py backend/tests/unit/test_parser_bench_tools.py -q`
Expected: FAIL (no `mineru_runner.py`, no `mineru` in `TOOLS`).

- [ ] **Step 3: Write the runner**

Create `backend/eval/parser_bench/runners/mineru_runner.py`:

```python
"""`mineru`: MinerU's local model pipeline at tier "basic" (small layout, OCR, formula and table models; no VLM).
MinerU 4 has no backend named "pipeline" any more: its tiers replaced the backends, and "basic" is the one that
runs the model pipeline without a VLM (the spec's `pipeline` backend; PROTOCOL.md deviation 3). Its default for
PDFs, "standard", adds a VLM. Everything else is MinerU's default, its device choice included.

One Markdown text per page: the middle JSON is cut into its pages (each carries the zero-based page_idx that the
content list carries too), and each page is rendered with MinerU's own Markdown renderer. The PDF is read from a
plain copy, because some deck names start with a space.

Exits non-zero, writing nothing, unless the pages are exactly 1..N of the PDF and every content-list item lies on
one of them: a partial result must never be scored as MinerU's result.

Usage: python -I mineru_runner.py <in.pdf> <out.json>
"""
import json
import os
import shutil
import sys
import tempfile
from importlib.metadata import version

TIER = "basic"


def pages_from_middle(middle, to_markdown, page_count: int) -> dict:
    """{"1": markdown, ...}: each pdf_info entry rendered on its own (with the document's other keys); ValueError
    unless the page_idx values are exactly 0..N-1, each once."""
    info = middle.get("pdf_info") if isinstance(middle, dict) else None
    if not isinstance(info, list):
        raise ValueError("the middle JSON has no pdf_info list")
    pages = {}
    for entry in info:
        idx = entry.get("page_idx") if isinstance(entry, dict) else None
        if not isinstance(idx, int) or isinstance(idx, bool):
            raise ValueError("a page of the middle JSON has no page_idx")
        if str(idx + 1) in pages:
            raise ValueError(f"page_idx {idx} twice")
        pages[str(idx + 1)] = to_markdown({**middle, "pdf_info": [entry]})
    numbers = sorted(int(k) for k in pages)
    if numbers != list(range(1, page_count + 1)):
        raise ValueError(f"the middle JSON has pages {numbers} for a PDF of {page_count} pages")
    return pages


def check_content_list(items, page_count: int) -> None:
    """Every item of the content list (V1: a flat list of dicts) names a page_idx of the PDF."""
    if not isinstance(items, list):
        raise ValueError("the content list is not a list")
    bad = [item.get("page_idx") if isinstance(item, dict) else None for item in items
           if not (isinstance(item, dict) and isinstance(item.get("page_idx"), int)
                   and 0 <= item["page_idx"] < page_count)]
    if bad:
        raise ValueError(f"content-list items with page_idx {bad[:10]} for a PDF of {page_count} pages")


def count_pages(path: str) -> int:
    import pypdfium2

    pdf = pypdfium2.PdfDocument(path)
    try:
        return len(pdf)
    finally:
        pdf.close()


def main(argv: list) -> None:
    from mineru.parser import parse
    from mineru.render import RenderFormat, render

    src, out = argv[1], argv[2]
    with tempfile.TemporaryDirectory() as tmp:
        source = os.path.join(tmp, "input.pdf")
        shutil.copyfile(src, source)
        page_count = count_pages(source)
        result = parse(source, tier=TIER)
        middle = result.middle_json
        try:
            check_content_list(render(middle, RenderFormat.CONTENT_LIST), page_count)
            pages = pages_from_middle(middle, lambda one: render(one, RenderFormat.MARKDOWN), page_count)
        except ValueError as err:
            raise SystemExit(f"mineru_runner: {err}")
    data = {
        "version": version("mineru"),
        "settings": {"tier": TIER, "render": "MinerU's Markdown renderer, one page of the middle JSON at a time",
                     "page_index": "page_idx (zero-based), as in the content list", "device": "MinerU default (auto)"},
        "pages": pages,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
```

- [ ] **Step 4: Register it**

In `backend/eval/parser_bench/tools.py`, add after the `marker` entry:

```python
    Tool("mineru", "MinerU", "heavy", "mineru_runner.py",
         "OpenDataLab's model pipeline (tier basic, no VLM)", requirements=("mineru==4.1.3",), size_mb=2600,
         import_name="mineru", downloads_models=True, prefetch=(("mineru-kit", "models", "download", "--tier", "basic"),),
         limit_per_page=TIME_LIMIT_PER_PAGE, exclude_newer=EXCLUDE_NEWER),
```

(The estimate: torch, onnxruntime, gradio and MinerU's other dependencies about 1.8 GB; MinerU states about 0.8 GB of models for `basic`.)

- [ ] **Step 5: Run the tests**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_runners.py backend/tests/unit/test_parser_bench_tools.py backend/tests/unit/test_parser_bench_runners_live.py -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git status --short
git add backend/eval/parser_bench/runners/mineru_runner.py backend/eval/parser_bench/tools.py \
  backend/tests/unit/test_parser_bench_runners.py backend/tests/unit/test_parser_bench_tools.py
git commit -m "feat(parser-bench): mineru runner — tier basic (the pipeline backend), Markdown per page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The `paddleocr` (PP-StructureV3) and `paddleocr_vl` runners

**Files:**
- Create: `backend/eval/parser_bench/runners/paddleocr_runner.py`, `backend/eval/parser_bench/runners/paddleocr_vl_runner.py`
- Modify: `backend/eval/parser_bench/tools.py` (register both)
- Modify: `backend/tests/unit/test_parser_bench_runners.py`, `backend/tests/unit/test_parser_bench_tools.py`

**Interfaces:**
- Consumes: the runner contract.
- Produces:
  - `paddleocr_runner.pages_from_results(results, page_count) -> dict[str, str]` and `paddleocr_runner.page_index(res) -> int | None`. The same two functions exist in `paddleocr_vl_runner`: runners run with `python -I` and cannot import each other.
  - `tools.TOOLS["paddleocr"]`, `tools.TOOLS["paddleocr_vl"]`.

PaddleOCR 3 (docs, 2026-10-31): `PPStructureV3().predict(input=pdf)` and `PaddleOCRVL().predict(input=pdf)` each return one result per page. A result's `markdown` is a dict with `markdown_texts`, and for a PDF it carries a zero-based `page_index`. PaddlePaddle has no MPS backend, so both run on the CPU here.

- [ ] **Step 1: Write the failing tests**

At the end of `backend/tests/unit/test_parser_bench_runners.py` add:

```python
class FakePaddlePage(dict):
    """A PaddleX result: dict-like, with its page_index when the input was a PDF, and a markdown dict."""

    def __init__(self, text, index=None):
        super().__init__({} if index is None else {"page_index": index})
        self.markdown = {"markdown_texts": text, "markdown_images": {}}


@pytest.mark.parametrize("name", ["paddleocr_runner", "paddleocr_vl_runner"])
def test_paddle_runners_read_one_markdown_text_per_page(name):
    paddle = _load(name)  # imports without paddleocr: that import lives in main()
    assert paddle.pages_from_results([FakePaddlePage("a"), FakePaddlePage("b")], 2) == {"1": "a", "2": "b"}
    assert paddle.pages_from_results([FakePaddlePage("b", 1), FakePaddlePage("a", 0)], 2) == {"1": "a", "2": "b"}
    with pytest.raises(ValueError, match=r"pages \[1\] for a PDF of 2 pages"):
        paddle.pages_from_results([FakePaddlePage("a")], 2)
    with pytest.raises(ValueError, match="page 1 came twice"):
        paddle.pages_from_results([FakePaddlePage("a", 0), FakePaddlePage("b", 0)], 2)
    broken = FakePaddlePage("a")
    broken.markdown = {}
    with pytest.raises(ValueError, match="page 1 has no Markdown text"):
        paddle.pages_from_results([broken], 1)
    assert paddle.page_index({"page_index": True}) is None and paddle.page_index([]) is None
```

In `backend/tests/unit/test_parser_bench_tools.py`, change `HEAVY` to `["docling", "marker", "mineru", "paddleocr", "paddleocr_vl"]` and add:

```python
def test_both_paddle_methods_are_pinned_alike():
    pins = ("paddleocr[doc-parser]==3.7.0", "paddlex==3.7.2", "paddlepaddle==3.3.1")
    for tool_id in ("paddleocr", "paddleocr_vl"):
        assert tools.TOOLS[tool_id].requirements == pins and tools.TOOLS[tool_id].import_name == "paddleocr"
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_runners.py backend/tests/unit/test_parser_bench_tools.py -q`
Expected: FAIL (no paddle runners, no paddle methods in `TOOLS`).

- [ ] **Step 3: Write the two runners**

Create `backend/eval/parser_bench/runners/paddleocr_runner.py`:

```python
"""`paddleocr`: PaddleOCR 3's PP-StructureV3 document pipeline on its defaults, one Markdown text per page
(res.markdown["markdown_texts"]). PaddlePaddle has no MPS backend: it runs on the CPU here. The PDF is read
from a plain copy, because some deck names start with a space.

Exits non-zero, writing nothing, unless the results are exactly pages 1..N of the PDF, each with its Markdown:
a partial result must never be scored as PaddleOCR's result.

Usage: python -I paddleocr_runner.py <in.pdf> <out.json>
"""
import json
import os
import shutil
import sys
import tempfile
from importlib.metadata import version

PIPELINE = "PP-StructureV3"


def page_index(res):
    """A result's own zero-based page_index, or None when it has none."""
    try:
        index = res["page_index"]
    except (KeyError, TypeError, IndexError):
        return None
    return index if isinstance(index, int) and not isinstance(index, bool) else None


def pages_from_results(results, page_count: int) -> dict:
    """{"1": markdown, ...} from the per-page results, in order; a result's own page_index wins when it has one.
    ValueError unless the pages are exactly 1..N, each with its Markdown text."""
    pages = {}
    for n, res in enumerate(results, start=1):
        index = page_index(res)
        number = n if index is None else index + 1
        markdown = getattr(res, "markdown", None)
        text = markdown.get("markdown_texts") if isinstance(markdown, dict) else None
        if not isinstance(text, str):
            raise ValueError(f"page {number} has no Markdown text")
        if str(number) in pages:
            raise ValueError(f"page {number} came twice")
        pages[str(number)] = text
    numbers = sorted(int(k) for k in pages)
    if numbers != list(range(1, page_count + 1)):
        raise ValueError(f"the results have pages {numbers} for a PDF of {page_count} pages")
    return pages


def device() -> str:
    try:
        import paddle

        return str(paddle.device.get_device())
    except Exception:
        return "unknown"


def count_pages(path: str) -> int:
    import pypdfium2

    pdf = pypdfium2.PdfDocument(path)
    try:
        return len(pdf)
    finally:
        pdf.close()


def main(argv: list) -> None:
    from paddleocr import PPStructureV3

    src, out = argv[1], argv[2]
    with tempfile.TemporaryDirectory() as tmp:
        source = os.path.join(tmp, "input.pdf")
        shutil.copyfile(src, source)
        page_count = count_pages(source)
        results = list(PPStructureV3().predict(input=source))
    try:
        pages = pages_from_results(results, page_count)
    except ValueError as err:
        raise SystemExit(f"paddleocr_runner: {err}")
    data = {
        "version": version("paddleocr"),
        "settings": {"pipeline": PIPELINE, "defaults": True, "markdown": "res.markdown['markdown_texts'] per page",
                     "device": device()},
        "pages": pages,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
```

Create `backend/eval/parser_bench/runners/paddleocr_vl_runner.py`:

```python
"""`paddleocr_vl`: PaddleOCR 3's PaddleOCR-VL pipeline (a 0.9B document vision-language model) on its defaults,
one Markdown text per page (res.markdown["markdown_texts"]). Tried as a separate method: the spec's "PaddleOCR-VL
is also tried", entered only when it installs and stays within the time limit (deviation 3). PaddlePaddle has no
MPS backend: it runs on the CPU here. The PDF is read from a plain copy, because some deck names start with a space.

Exits non-zero, writing nothing, unless the results are exactly pages 1..N of the PDF, each with its Markdown:
a partial result must never be scored as PaddleOCR-VL's result.

Usage: python -I paddleocr_vl_runner.py <in.pdf> <out.json>
"""
import json
import os
import shutil
import sys
import tempfile
from importlib.metadata import version

PIPELINE = "PaddleOCR-VL"


def page_index(res):
    """A result's own zero-based page_index, or None when it has none."""
    try:
        index = res["page_index"]
    except (KeyError, TypeError, IndexError):
        return None
    return index if isinstance(index, int) and not isinstance(index, bool) else None


def pages_from_results(results, page_count: int) -> dict:
    """{"1": markdown, ...} from the per-page results, in order; a result's own page_index wins when it has one.
    ValueError unless the pages are exactly 1..N, each with its Markdown text."""
    pages = {}
    for n, res in enumerate(results, start=1):
        index = page_index(res)
        number = n if index is None else index + 1
        markdown = getattr(res, "markdown", None)
        text = markdown.get("markdown_texts") if isinstance(markdown, dict) else None
        if not isinstance(text, str):
            raise ValueError(f"page {number} has no Markdown text")
        if str(number) in pages:
            raise ValueError(f"page {number} came twice")
        pages[str(number)] = text
    numbers = sorted(int(k) for k in pages)
    if numbers != list(range(1, page_count + 1)):
        raise ValueError(f"the results have pages {numbers} for a PDF of {page_count} pages")
    return pages


def device() -> str:
    try:
        import paddle

        return str(paddle.device.get_device())
    except Exception:
        return "unknown"


def count_pages(path: str) -> int:
    import pypdfium2

    pdf = pypdfium2.PdfDocument(path)
    try:
        return len(pdf)
    finally:
        pdf.close()


def main(argv: list) -> None:
    from paddleocr import PaddleOCRVL

    src, out = argv[1], argv[2]
    with tempfile.TemporaryDirectory() as tmp:
        source = os.path.join(tmp, "input.pdf")
        shutil.copyfile(src, source)
        page_count = count_pages(source)
        results = list(PaddleOCRVL().predict(input=source))
    try:
        pages = pages_from_results(results, page_count)
    except ValueError as err:
        raise SystemExit(f"paddleocr_vl_runner: {err}")
    data = {
        "version": version("paddleocr"),
        "settings": {"pipeline": PIPELINE, "defaults": True, "markdown": "res.markdown['markdown_texts'] per page",
                     "device": device()},
        "pages": pages,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


if __name__ == "__main__":
    main(sys.argv)
```

- [ ] **Step 4: Register both**

In `backend/eval/parser_bench/tools.py`, add before the `TOOLS` dict:

```python
PADDLE_PINS = ("paddleocr[doc-parser]==3.7.0", "paddlex==3.7.2", "paddlepaddle==3.3.1")
```

and add after the `mineru` entry:

```python
    Tool("paddleocr", "PaddleOCR PP-StructureV3", "heavy", "paddleocr_runner.py",
         "Baidu's document pipeline, Markdown; CPU (PaddlePaddle has no MPS)", requirements=PADDLE_PINS,
         size_mb=1800, import_name="paddleocr", downloads_models=True, limit_per_page=TIME_LIMIT_PER_PAGE,
         exclude_newer=EXCLUDE_NEWER),
    Tool("paddleocr_vl", "PaddleOCR-VL", "heavy", "paddleocr_vl_runner.py",
         "Baidu's 0.9B document VLM, tried as well; CPU", requirements=PADDLE_PINS,
         size_mb=3000, import_name="paddleocr", downloads_models=True, limit_per_page=TIME_LIMIT_PER_PAGE,
         exclude_newer=EXCLUDE_NEWER),
```

(The estimates: PaddlePaddle, PaddleX and OpenCV about 0.9 GB per environment, which uv clones rather than copies; PP-StructureV3's models about 0.9 GB; PaddleOCR-VL-1.6's weights 1.84 GB plus its layout model.)

- [ ] **Step 5: Run the whole bench suite**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_*.py -q`
Expected: all pass; the live test skips the five heavy methods ("not installed").

- [ ] **Step 6: Commit**

```bash
git status --short
git add backend/eval/parser_bench/runners/paddleocr_runner.py backend/eval/parser_bench/runners/paddleocr_vl_runner.py \
  backend/eval/parser_bench/tools.py backend/tests/unit/test_parser_bench_runners.py backend/tests/unit/test_parser_bench_tools.py
git commit -m "feat(parser-bench): PaddleOCR runners — PP-StructureV3, and PaddleOCR-VL tried as its own method

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The command line: `clear-models`, and the model folder in `tools`

**Files:**
- Modify: `backend/eval/parser_bench/__main__.py`
- Modify: `backend/tests/unit/test_parser_bench_cli.py`

**Interfaces:**
- Consumes: `tools.clear_models`, `tools.cache_mb` (Task 4); the registered heavy methods (Tasks 6–9).
- Produces:
  - `python -m backend.eval.parser_bench clear-models <tool>`: exit 0 with the MB freed, or exit 2 with the reason.
  - `tools` prints `models <MB> MB` after each heavy method.

- [ ] **Step 1: Write the failing tests**

At the end of `backend/tests/unit/test_parser_bench_cli.py` add:

```python
def test_clear_models_deletes_a_heavy_methods_models_only(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PARSER_BENCH_MODELS", str(tmp_path / "models"))
    blob = tmp_path / "models" / "docling" / "huggingface" / "blob"
    blob.parent.mkdir(parents=True)
    blob.write_bytes(b"x" * 2**20)
    assert cli.main(["clear-models", "docling"]) == 0
    assert "docling: 1 MB of models deleted" in capsys.readouterr().out
    assert not (tmp_path / "models" / "docling").exists()
    assert cli.main(["clear-models", "current"]) == 2
    assert "keeps no downloaded models" in capsys.readouterr().err


def test_tools_shows_each_heavy_methods_model_folder(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("PARSER_BENCH_MODELS", str(tmp_path / "models"))
    assert cli.main(["tools"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert "models 0.0 MB" in next(line for line in lines if line.startswith("docling"))
    assert "models" not in next(line for line in lines if line.startswith("current"))
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_cli.py -q`
Expected: FAIL (`invalid choice: 'clear-models'`, no models figure).

- [ ] **Step 3: Implement**

In `backend/eval/parser_bench/__main__.py`:

(a) Change the first docstring line to `python -m backend.eval.parser_bench <tools|install|clear-models|run|models|runs|export|select|compare|serve>`. After the `install <tool>` line add:

```
    clear-models <tool>           delete a heavy method's downloaded models (its environment and runs stay)
```

(b) After the `install` sub-parser, add:

```python
    p = sub.add_parser("clear-models", help="delete a heavy method's downloaded models (environment and runs stay)")
    p.add_argument("tool", choices=sorted(tools.TOOLS))
```

(c) Replace the `tools` branch with:

```python
    if args.cmd == "tools":
        for tool in tools.TOOLS.values():
            gaps = tools.missing(tool)
            state = "ready" if not gaps else "needs " + "; ".join(gaps)
            models = f"  models {_shown(tools.cache_mb(tool))} MB" if tool.downloads_models else ""
            print(f"{tool.id:15} {tool.group:6} {state}{models}")
        return 0

    if args.cmd == "clear-models":
        try:
            freed = tools.clear_models(tools.TOOLS[args.tool])
        except ValueError as e:
            print(e, file=sys.stderr)
            return 2
        print(f"{args.tool}: {freed / 2**20:.0f} MB of models deleted; its next warm-up downloads them again")
        return 0
```

- [ ] **Step 4: Run the CLI tests and the whole bench suite**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_*.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git status --short
git add backend/eval/parser_bench/__main__.py backend/tests/unit/test_parser_bench_cli.py
git commit -m "feat(parser-bench): clear-models, and each heavy method's model folder in tools

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Installs and the SWT measurement — STOP for Abi

**Files:**
- Modify: `docs/thesis/experiments/parser-benchmark/LAB_LOG.md`
- Data (outside git): five environments under `~/.cache/learnstation-parser-bench/envs/`, their models under `…/models/`, `llama-server` under `…/bin/` (if Abi installs it), and up to five explore runs.

**Interfaces:**
- Consumes: Tasks 1–10; `python -m backend.eval.parser_bench tools|install|run|clear-models`.
- Produces:
  - per heavy method: installed or not (with its reason);
  - its environment and model sizes;
  - one measurement run on the SWT deck with seconds per page, peak MB and warm-up seconds;
  - a verdict against the 120 s/page limit;
  - the projected run time for the five PDFs;
  - **Abi's decision** on the input: whole documents, or page-set pages + N neighbours.

The measurement runs are **explore** runs of the whole SWT deck (41 pages) that **score only page 1**. Page 1 is not in the page set (the SWT keys are pages 3, 16, 17, 21, 26, 39), so nothing of a benchmark page is stored, and nobody opens the output. Their seconds per page are the whole timed run over 41 pages, exactly as a benchmark run measures them.

- [ ] **Step 1: Pre-flight**

```bash
git status --short && git branch --show-current
$PY -m pytest backend/tests/unit/test_parser_bench_*.py -q
df -h / | tail -1
$PY -m backend.eval.parser_bench tools
$PY - <<'PY' | tee "$SCRATCH/stray-before.txt"
from pathlib import Path
from backend.eval.parser_bench import tools
home = Path.home()
for rel in (".cache/huggingface", ".cache/torch", ".cache/modelscope", ".cache/docling", ".cache/rapidocr", ".paddlex",
            ".paddleocr", ".mineru", "mineru.json", "Library/Caches/datalab", ".EasyOCR"):
    p = home / rel
    size = "absent" if not p.exists() else (f"{tools.dir_bytes(p) / 2**20:.1f} MB" if p.is_dir() else f"file {p.stat().st_size} B")
    print(f"~/{rel:26} {size}")
PY
```

Expected: a clean tree on `claude/file-upload-workflow-e9126d`, every test green, the free disk noted (15 GiB on 2026-10-31), the five heavy methods "needs its environment", and the user caches as they were before this plan. `~/.cache/huggingface` and `~/.EasyOCR` already exist, from the design demo.

- [ ] **Step 2: llama.cpp for marker — STOP if missing**

```bash
$PY -c "from backend.eval.parser_bench import tools; print(tools.which('llama-server'))"
```

If it prints `None`, stop and ask Abi. Do not download anything yourself. The question, in these words:

> marker 2.1.0 runs its OCR model through llama.cpp's `llama-server` on Apple Silicon. uv cannot install that program, and Homebrew is broken on this Mac. Options:
> (a) you download the macOS arm64 build from https://github.com/ggml-org/llama.cpp/releases (the asset name and size are shown there) and unpack the contents of its `bin` folder (`llama-server` and the `.dylib` files beside it) into `~/.cache/learnstation-parser-bench/bin/`;
> (b) I do (a) after your explicit yes to that file, its source and size;
> (c) marker is not run, and it is recorded as "not run: needs llama.cpp".

After (a) or (b), check: `$PY -c "from backend.eval.parser_bench import tools; print(tools.which('llama-server')); print(tools._llama_version())"`. If macOS blocks the unsigned binary, Abi allows it in System Settings; the agent never changes security settings. Note the version line, and llama.cpp's licence (MIT), for Deviation 3.

- [ ] **Step 3: For each heavy method in the spec's order (docling, marker, mineru, paddleocr, then paddleocr_vl): install, live test, measure**

For `T` in that order (skip `marker` if Abi chose (c)):

```bash
T=docling   # then marker, mineru, paddleocr, paddleocr_vl
df -h / | tail -1
$PY -m backend.eval.parser_bench install $T 2>&1 | tail -5
du -sh ~/.cache/learnstation-parser-bench/envs/$T ~/.cache/learnstation-parser-bench/models/$T
$PY -m pytest backend/tests/unit/test_parser_bench_runners_live.py -k "$T" -q
$PY -m backend.eval.parser_bench run $T "$HOME/Downloads/Course SWT/Slides/2.pdf" --pages 1
df -h / | tail -1
```

Expected per method:
- **install** prints the package list (the Python line first). A refusal prints one line: the disk guard, an import failure, or a probe failure with the runner's own message. A probe failure means the runner's assumptions about the library do not hold: **stop and tell the controller**, with the message. Do not edit the runner to make it pass; a fix is a code change with its own review, and possibly the fallback release with Abi's OK.
- **the live test** passes: six titles back from the synthetic deck.
- **the run** prints `<run_id>  finished  <s> s/page, peak <MB> MB`, or `failed  did not run here: slower than 120 s/page …` (stopped at 4,920 s). Any other failure: stop and tell the controller.
- **If the disk guard refuses**: run `$PY -m backend.eval.parser_bench clear-models <the measured method with the largest models folder>` (outputs and environments stay), note it, and install again. If it still refuses: stop and tell the controller.

Afterwards, check the user caches again:

```bash
$PY - <<'PY' | tee "$SCRATCH/stray-after.txt"
from pathlib import Path
from backend.eval.parser_bench import tools
home = Path.home()
for rel in (".cache/huggingface", ".cache/torch", ".cache/modelscope", ".cache/docling", ".cache/rapidocr", ".paddlex",
            ".paddleocr", ".mineru", "mineru.json", "Library/Caches/datalab", ".EasyOCR"):
    p = home / rel
    size = "absent" if not p.exists() else (f"{tools.dir_bytes(p) / 2**20:.1f} MB" if p.is_dir() else f"file {p.stat().st_size} B")
    print(f"~/{rel:26} {size}")
PY
diff "$SCRATCH/stray-before.txt" "$SCRATCH/stray-after.txt" && echo "no stray model files"
```

Expected: `no stray model files`. If a line changed, a library ignored the cache variables. Do not delete anything in Abi's own caches. Note which folder grew and by how much, and tell the controller: the fix is one more entry in `CACHE_VARS` (a code change before Deviation 3), and the models it put there are reported to Abi.

- [ ] **Step 4: Project the run time of the five PDFs**

```bash
$PY - <<'PY'
from backend.eval.parser_bench import pageset, sources, store
HEAVY = ["docling", "marker", "mineru", "paddleocr", "paddleocr_vl"]
pages = pageset.load()
scored, total = {}, {}
for p in pages:
    scored.setdefault(p.file, []).append(p.page)
    total[p.file] = sources.page_count(sources.DECK_DIR / p.file)
swt = next(p.sha256 for p in pages if p.file == "Course SWT/Slides/2.pdf")

def given(n):
    return sum(len({q for p in ps for q in range(max(1, p - n), min(total[f], p + n) + 1)}) for f, ps in scored.items())

whole = sum(total.values())
print(f"pages: whole {whole}; page set + 1 neighbour {given(1)}; + 2 {given(2)}; + 3 {given(3)}")
runs = [m for m in store.list_runs() if m.get("kind") == "extract" and m.get("purpose") == "explore"]
for tool in HEAVY:
    m = next((m for m in runs if m.get("tool") == tool and m["source"]["sha256"] == swt and m.get("pages_scored") == [1]), None)
    if m is None:
        print(f"{tool:13} no measurement")
        continue
    spp, warm = m.get("seconds_per_page"), m.get("warmup_seconds") or 0
    if spp is None:
        print(f"{tool:13} {m['status']}: {m.get('reason')}")
        continue
    hours = lambda n_pages: (5 * warm + spp * n_pages) / 3600
    print(f"{tool:13} {spp:7.2f} s/page  peak {m.get('peak_memory_mb')} MB  warm-up {warm:.0f} s  model folder "
          f"{m.get('model_cache_mb')} MB  -> whole {hours(whole):.1f} h | +1 {hours(given(1)):.1f} h | "
          f"+2 {hours(given(2)):.1f} h | +3 {hours(given(3)):.1f} h  ({m['run_id']})")
PY
```

Expected: `pages: whole 221; page set + 1 neighbour 60; + 2 87; + 3 107`, then one line per method. The projection is approximate: start-up is amortised over 41 pages on SWT but over 6–7 pages on the sheets, and other load on the Mac is not controlled (§9).

- [ ] **Step 5: Log what happened**

Append to `LAB_LOG.md` (fill every `⟨…⟩` from Steps 1–4; nothing about outputs):

```markdown

## ⟨YYYY-MM-DD⟩ — heavy methods: installs and the SWT measurement

- Before: ⟨GB⟩ free (`df -h /`). uv ⟨version⟩. Installs resolved with `--exclude-newer 2026-10-31`, Python ⟨3.12.x⟩, one environment per method, models under `~/.cache/learnstation-parser-bench/models/<method>/`.
- llama.cpp for marker: ⟨how installed by Abi / not installed⟩, `⟨llama-server version line⟩`.
- Per method (environment folder / model folder after install, `du -sh`; install result):
  - docling 2.145.0: ⟨MB⟩ / ⟨MB⟩; ⟨installed / refused: reason⟩
  - marker 2.1.0: ⟨…⟩
  - mineru 4.1.3: ⟨…⟩
  - paddleocr 3.7.0 (PP-StructureV3): ⟨…⟩
  - paddleocr_vl 3.7.0 (PaddleOCR-VL): ⟨…⟩
- Model folders cleared for disk: ⟨none / which, freed MB⟩. User caches unchanged: ⟨yes / which grew⟩.
- Measurement: explore runs of the whole SWT deck (41 pages, page 1 scored, not in the page set), warm-up first. Seconds per page / peak MB / warm-up s:
  - ⟨method⟩: ⟨s/page⟩ / ⟨MB⟩ / ⟨s⟩ (⟨run id⟩) ⟨or: did not run here, stopped at 4,920 s⟩
- Projected for the five PDFs (221 pages; with the page set and N neighbours: 60, 87, 107 pages): ⟨method: h whole / h +1 / h +2⟩.
- After: ⟨GB⟩ free.
```

```bash
git add docs/thesis/experiments/parser-benchmark/LAB_LOG.md
git commit -m "docs(parser-bench): lab log — heavy installs and the SWT measurement

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(The lab log is not part of the bench, so this leaves the gate as it was.)

- [ ] **Step 6: STOP — Abi decides the input**

Show Abi:
- the per-method table from Step 4;
- which methods did not install (and why) and which did not run here;
- the disk left.

Then ask, without recommending against the spec:

> The spec gives each tool the **whole PDF**, because footer detection may use the other pages. With the measured speeds the five PDFs would take ⟨h⟩ hours in all (⟨per method⟩). The alternative, a protocol deviation, is to give each heavy method only the page set's pages of each PDF plus N pages on each side: 60 pages for N = 1, 87 for N = 2, 107 for N = 3, instead of 221, so about ⟨h⟩ / ⟨h⟩ / ⟨h⟩ hours. Its footer detection then sees only those pages. Which do you choose: whole documents, or N = ⟨1/2/3⟩? (Only for the heavy methods; the fast and paid methods keep what they had.)

Also confirm with Abi:
- that a method marked *did not run here* on SWT gets no benchmark runs;
- that `paddleocr_vl`, if it is within the limit, joins (the comparison then has 100 duels instead of 73).

Record the answer and its date for Deviation 3. If Abi chooses N, do **Task 12** next; otherwise skip Task 12.

---

### Task 12 (only if Abi chose page-set pages + N neighbours at Task 11's STOP): giving a heavy method a page subset

**Files:**
- Modify: `backend/eval/parser_bench/tools.py` (`HEAVY_NEIGHBOURS`, `Tool.neighbours`, the five heavy entries)
- Modify: `backend/eval/parser_bench/execute.py` (`input_pages`, `cut_pdf`, `_input_fields`, `_run_in_slot`)
- Modify: `backend/tests/unit/test_parser_bench_execute.py`, `backend/tests/unit/test_parser_bench_tools.py`

**Interfaces:**
- Consumes: Task 5's `_run_in_slot`, `heavy_registry`, `heavy_dirs`.
- Produces:
  - `tools.HEAVY_NEIGHBOURS: int` (Abi's N) and `Tool.neighbours: int | None = None`;
  - `execute.input_pages(wanted, total, neighbours) -> list[int]` and `execute.cut_pdf(pdf, pages, dest) -> Path`;
  - `run.json` `input_pages`, `neighbours`, `seconds_per_page_basis: "pages given"`.
  - The time limit, seconds per page and "every page present" all count the pages given.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_parser_bench_execute.py`, change the fixtures import to `from backend.tests.unit.parser_bench_fixtures import TITLES, make_deck` and add at the end:

```python
def test_input_pages_are_the_scored_pages_and_their_neighbours():
    assert execute.input_pages([3], 41, 1) == [2, 3, 4]
    assert execute.input_pages([1, 6], 6, 2) == [1, 2, 3, 4, 5, 6]
    assert execute.input_pages([16, 17], 41, 1) == [15, 16, 17, 18]
    assert execute.input_pages([3], 41, 0) == [3]


def test_a_method_given_neighbours_reads_only_those_pages(tmp_path, deck, heavy_dirs):
    reg = heavy_registry(tmp_path, "nb", FAKE_OK, neighbours=1, limit_per_page=30.0)
    run = execute.run_tool("nb", deck, pages=[3], warmup=False, root=tmp_path / "data", registry=reg)
    m = run.meta
    assert (m["status"], m["input_pages"], m["neighbours"], m["seconds_per_page_basis"]) == ("finished", [2, 3, 4], 1, "pages given")
    assert m["time_limit_s"] == 90.0 and m["missing_pages"] == []
    assert TITLES[2] in run.pages()[3]  # page 3 of the cut is page 3 of the deck
```

In `backend/tests/unit/test_parser_bench_tools.py` add:

```python
def test_the_heavy_methods_get_the_page_set_and_n_neighbours():
    assert isinstance(tools.HEAVY_NEIGHBOURS, int) and tools.HEAVY_NEIGHBOURS >= 0
    assert all(tools.TOOLS[t].neighbours == tools.HEAVY_NEIGHBOURS for t in HEAVY)
    assert all(t.neighbours is None for t in tools.TOOLS.values() if t.group != "heavy")
```

- [ ] **Step 2: Run them to see them fail**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_execute.py backend/tests/unit/test_parser_bench_tools.py -q`
Expected: FAIL (`no attribute 'input_pages'`, `unexpected keyword argument 'neighbours'`).

- [ ] **Step 3: Implement**

In `backend/eval/parser_bench/tools.py`:
- add the field `neighbours: int | None = None  # heavy methods (deviation 3): given only the scored pages and this many on each side` at the end of `Tool`;
- add after `EXCLUDE_NEWER`: `HEAVY_NEIGHBOURS = ⟨N, Abi's choice of ⟨date⟩⟩  # deviation 3: a heavy method is given the page set's pages and N neighbours`. Write the number, for example `HEAVY_NEIGHBOURS = 2`.
- add `neighbours=HEAVY_NEIGHBOURS,` to each of the five heavy entries.

In `backend/eval/parser_bench/execute.py`:

(a) Add after `_cache_fields`:

```python
def input_pages(wanted: Sequence[int], total: int, neighbours: int) -> list[int]:
    """The pages a method is given when it gets the scored pages and `neighbours` pages on each side of each."""
    keep: set[int] = set()
    for page in wanted:
        keep.update(range(max(1, page - neighbours), min(total, page + neighbours) + 1))
    return sorted(keep)


def cut_pdf(pdf: Path, pages: Sequence[int], dest: Path) -> Path:
    """A copy of `pdf` holding only `pages` (1-based, in order), for a method given a page subset."""
    import fitz

    with fitz.open(pdf) as doc:
        doc.select([p - 1 for p in pages])
        doc.save(dest)
    return dest


def _input_fields(given: list[int] | None, tool: Tool) -> dict:
    if given is None:
        return {}
    return {"input_pages": given, "neighbours": tool.neighbours, "seconds_per_page_basis": "pages given"}
```

(b) In `_run_in_slot`, replace

```python
    per_page = len(wanted) if tool.paid else total  # a paid method's time is over the pages it was sent
```

with

```python
    given = None if tool.paid or tool.neighbours is None else input_pages(wanted, total, tool.neighbours)
    # a paid method's time is over the pages it was sent; a method given a page subset, over the pages given
    per_page = len(wanted) if tool.paid else (len(given) if given is not None else total)
```

(c) Replace the timed invoke line

```python
        result = invoke(tool, pdf, args=args, timeout=timeout if limit is None else limit, cancel=cancel)
```

with

```python
        with tempfile.TemporaryDirectory() as tmp:
            source_pdf = pdf if given is None else cut_pdf(pdf, given, Path(tmp) / "input.pdf")
            result = invoke(tool, source_pdf, args=args, timeout=timeout if limit is None else limit, cancel=cancel)
        if given is not None:  # page k of the cut is page given[k - 1] of the file
            result.pages = {given[k - 1]: text for k, text in result.pages.items() if 1 <= k <= len(given)}
```

(d) Add `**_input_fields(given, tool),` to each of the three `fields = {…}` dicts that already hold `**_limit_fields(…)`: the `RunnerError` branch, the past-the-limit branch, and the finished branch.

(e) Replace

```python
    expected = wanted if tool.paid else list(range(1, total + 1))
```

with

```python
    expected = wanted if tool.paid else (given if given is not None else list(range(1, total + 1)))
```

(f) Append to the module docstring: `A heavy method may be given only the scored pages and N neighbours of each (tools.HEAVY_NEIGHBOURS, deviation 3): they are cut from the PDF, its output is mapped back to the file's page numbers, and its time limit and seconds per page count the pages given. The checks still read the whole file.`

- [ ] **Step 4: Run the whole bench suite**

Run: `$PY -m pytest backend/tests/unit/test_parser_bench_*.py -m "not slow" -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git status --short
git add backend/eval/parser_bench/tools.py backend/eval/parser_bench/execute.py \
  backend/tests/unit/test_parser_bench_execute.py backend/tests/unit/test_parser_bench_tools.py
git commit -m "feat(parser-bench): heavy methods get the page-set pages and N neighbours (Abi's choice)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: The protocol step: versions, licences, the time limit, the third comparison — Deviation 3 — STOP for Abi

**Files:**
- Modify: `docs/thesis/experiments/parser-benchmark/PROTOCOL.md` (Deviation 3)
- Modify: `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md` (the mineru row; decision 9)
- Modify: `backend/tests/unit/test_parser_bench_tools.py` (the pin of the heavy methods to the protocol)
- Modify: `docs/thesis/experiments/parser-benchmark/LAB_LOG.md`

**Interfaces:**
- Consumes: Tasks 1–12 and Task 11's measurements and decision.
- Produces: one commit holding Deviation 3. It becomes the protocol commit (`execute.protocol_commit()`), and `execute.benchmark_gate()` passes at it.

- [ ] **Step 1: Pre-flight**

```bash
git status --short && git branch --show-current
$PY -m pytest backend/tests/unit/test_parser_bench_*.py -m "not slow" -q
$PY -c "from backend.eval.parser_bench import execute; c = execute.protocol_commit(); print(c); print(execute.bench_drift(c))"
$PY -m backend.eval.parser_bench tools
```

Expected:
- a clean tree, every test green;
- the protocol commit `902a0e86…`, and a drift list naming the bench files that Tasks 1–12 changed. That drift is what this deviation records.

- [ ] **Step 2: Collect the exact versions and the licences of the code**

For each installed heavy method `T`:

```bash
for T in docling marker mineru paddleocr paddleocr_vl; do
  E=~/.cache/learnstation-parser-bench/envs/$T/bin/python
  [ -x "$E" ] || { echo "== $T not installed"; continue; }
  echo "== $T"; "$E" --version
  "$E" -I - <<'PY'
from importlib.metadata import PackageNotFoundError, metadata
for name in ("docling", "docling-core", "docling-ibm-models", "marker-pdf", "surya-ocr", "mineru", "paddleocr", "paddlex",
             "paddlepaddle", "torch", "transformers", "onnxruntime", "rapidocr"):
    try:
        m = metadata(name)
    except PackageNotFoundError:
        continue
    print(f"{name}=={m['Version']}  licence: {m.get('License-Expression') or (m.get('License') or '').splitlines()[0][:80] or '(none in metadata)'}")
PY
done
```

Note every line for the deviation's table. For `mineru`, the metadata says `LicenseRef-MinerU-Open-Source-License`. Read the licence file shipped in its `dist-info` (`ls "$($E -c 'import mineru, os; print(os.path.dirname(mineru.__file__))')/../mineru-4.1.3.dist-info"`). Summarise its additional conditions in one sentence of your own words; no quotation longer than a few words.

- [ ] **Step 3: Collect the model weights and their licences**

```bash
for T in docling marker mineru paddleocr paddleocr_vl; do
  M=~/.cache/learnstation-parser-bench/models/$T
  [ -d "$M" ] || continue
  echo "== $T $(du -sh "$M" | cut -f1)"
  find "$M" -maxdepth 4 -type d \( -name 'models--*' -o -path '*official_models/*' \) -prune -print | sed "s|$HOME|~|"
  find "$M" -maxdepth 3 -type d | sed "s|$HOME|~|" | head -40
done
```

For each Hugging Face repo (`models--<org>--<name>` → `<org>/<name>`) and each PaddleX model (`official_models/<Name>` → `PaddlePaddle/<Name>` on Hugging Face), read the licence from its model card:

```bash
curl -s "https://huggingface.co/api/models/<org>/<name>" | $PY -c "import json,sys; d=json.load(sys.stdin); print((d.get('cardData') or {}).get('license'), [t for t in d.get('tags', []) if t.startswith('license')])"
```

For MinerU's models, take the repo names from its model folder. Where a card names no licence, write "no licence in the model card" and add the licence MinerU's documentation states for that model, if it states one. For marker, surya's weights use a modified AI Pubs Open Rail-M licence (marker's README: free for research, personal use and startups under $5M). Record whatever the cards in the folder say. Note per method: model, size (`du -sh`), licence.

- [ ] **Step 4: Pin the heavy methods to the protocol**

In `backend/tests/unit/test_parser_bench_tools.py` add:

```python
def test_the_heavy_methods_are_named_in_the_protocol():
    from backend.eval.parser_bench import store

    protocol = (store.REPO / "docs/thesis/experiments/parser-benchmark/PROTOCOL.md").read_text(encoding="utf-8")
    for tool_id in HEAVY:
        assert f"`{tool_id}`" in protocol, tool_id
        for requirement in tools.TOOLS[tool_id].requirements:
            name, _, pinned = requirement.partition("==")
            assert f"{name.split('[')[0]} {pinned}" in protocol, requirement
    assert "2026-10-31" in protocol and "20261102" in protocol and "120 s/page" in protocol
```

- [ ] **Step 5: Write Deviation 3**

Append to `docs/thesis/experiments/parser-benchmark/PROTOCOL.md`, filling every `⟨…⟩` from Task 11 and Steps 2–3 (and nothing else). Keep exactly one of the two *Input* paragraphs: the one Abi chose.

```markdown

**3. ⟨YYYY-MM-DD⟩, before any heavy benchmark run and before the third comparison: the heavy methods, their time limit, and a third comparison against chosen opponents.** The text above stays; where this deviation and the text above differ, this deviation applies from this commit on.

*The heavy methods.* Each runs in its own `uv` environment, Python ⟨3.12.x⟩. Its exact pins are resolved with `--exclude-newer 2026-10-31` (as PyPI stood that day). It counts as installed only after its module imports and a probe run on a one-page synthetic PDF (no course content) gives back text. Every run records its exact package list.

| id | What runs | Exact version | Licence of the code | Model weights (size; licence) | Device | Settings that differ from the default |
|---|---|---|---|---|---|---|
| `docling` | `DocumentConverter().convert()`, the default PDF pipeline; Markdown per page with `export_to_markdown(page_no=n)` | docling 2.145.0 (⟨docling-core, docling-ibm-models, torch versions⟩) | MIT | ⟨models; size; licences⟩ | ⟨device⟩ | none |
| `marker` | `PdfConverter` on its defaults; LLM enhancement off (`use_llm` false, its default); marker's own mode for the device (⟨mode⟩) | marker-pdf 2.1.0, surya-ocr ⟨v⟩, torch ⟨v⟩; llama.cpp ⟨version line⟩ | Apache-2.0 (marker, surya); MIT (llama.cpp) | ⟨surya weights; size; modified AI Pubs Open Rail-M⟩ | ⟨device⟩; its VLM through llama.cpp | `paginate_output` on, so the output is split by page (the spec's "output split by page") |
| `mineru` | `mineru.parser.parse(tier="basic")`; each page of the middle JSON rendered by MinerU's own Markdown renderer; the page index is `page_idx`, as in the content list | mineru 4.1.3 (⟨torch, onnxruntime versions⟩) | MinerU Open Source License: Apache-2.0 with additional conditions (⟨one sentence⟩) | ⟨models; size; licences⟩ | MinerU's automatic choice (⟨…⟩) | tier `basic` instead of its default `standard`: the spec names the `pipeline` backend, and MinerU 4 replaced its backends with tiers; `basic` is the model pipeline without a VLM, while `standard` adds a VLM that MinerU documents as needing 16 GB of memory on Apple Silicon |
| `paddleocr` | `PPStructureV3().predict()` on its defaults; `markdown_texts` per page | paddleocr 3.7.0, paddlex 3.7.2, paddlepaddle 3.3.1 | Apache-2.0 | ⟨models; size; Apache-2.0⟩ | CPU (PaddlePaddle has no MPS backend) | none |
| `paddleocr_vl` | `PaddleOCRVL().predict()` on its defaults; `markdown_texts` per page | as `paddleocr` | Apache-2.0 | ⟨PaddleOCR-VL-1.6 …; size; Apache-2.0⟩ | CPU | none |

- **Where the models live.** Under `~/.cache/learnstation-parser-bench/models/<method>/`: every cache variable the libraries read (`HF_HOME`, `TORCH_HOME`, `XDG_CACHE_HOME`, `MODELSCOPE_CACHE`, `PADDLE_PDX_CACHE_HOME`, `MINERU_HOME`, `MODEL_CACHE_DIR`, `EASYOCR_MODULE_PATH`) points there, and the user's own caches were unchanged after the installs (⟨checked ⟨date⟩ / exceptions⟩).
- **Telemetry and network.** `HF_HUB_DISABLE_TELEMETRY`, `DO_NOT_TRACK` and `MINERU_TELEMETRY_DISABLED` are 1 for every heavy runner. Models are downloaded at install, from ⟨Hugging Face / ModelScope / Baidu, per method⟩; no benchmark data leaves the Mac.
- **Model downloads in a run.** Each run records the size of its model folder and whether it grew during the timed run (`models_downloaded_in_timed_run`).
- **PaddleOCR-VL.** The spec says "PaddleOCR-VL is also tried". It is a separate method, `paddleocr_vl`, not a replacement for PP-StructureV3 (`paddleocr`): one 0.9B vision-language model against a pipeline of small models. It is an entrant only if it installs, passes the probe and stays within the time limit on SWT and on all five PDFs. Outcome: ⟨installed / not, why; measured ⟨s/page⟩; entrant / did not run here⟩.
- **Not run.** ⟨method: reason (e.g. marker: llama.cpp not installed), or "none"⟩.

*The time limit.* The spec: "A variant slower than 120 s/page on the M1 is recorded as *did not run here*".
- **How it is measured.** As §8 measures cost: the timed run's wall-clock seconds over the pages the method is given, interpreter and model start-up included.
- **What happens.** A heavy method's timed run is stopped at 120 s × those pages, because past that point the verdict cannot change. The run is kept, failed, with `did_not_run_here: true`. The method is recorded as *did not run here*, gets no further benchmark runs, and is not an entrant.
- **The warm-up** is not held to the limit, because it may include a one-time download.
- **The SWT measurement.** On ⟨date⟩ each heavy method ran once as an explore run of the whole SWT deck (41 pages; only page 1, which is not in the page set, was stored, and no one looked at it). Results:
  - ⟨method: s/page, peak MB, run id — within the limit / did not run here⟩

*Input.*
- [Whole documents] Each heavy method receives the whole PDF, as the spec says (§8). The projected run time was ⟨h⟩ hours in all (⟨per method⟩); Abi chose whole documents on ⟨date⟩.
- [Page set + N neighbours] Each heavy method receives only the page set's pages of each PDF and the ⟨N⟩ pages on each side of each (⟨60/87/107⟩ pages instead of 221), cut from the file with PyMuPDF. Its own header and footer detection therefore sees only those pages. Its seconds per page and its time limit count the pages given (`seconds_per_page_basis`: "pages given"). The checks still read the whole file. Abi chose this on ⟨date⟩ because whole documents were projected at ⟨h⟩ hours. The fast and paid methods keep what they had.

*The third comparison (design decision 9).*
- **Entrants.** The seven judged methods, with the runs their comparisons judged (by run id from `cmp-2026-10-31_04de`'s `compare.json`), plus the heavy methods that ran here, with their newest finished benchmark runs under this commit. `compare.json` records `builds_on: ["cmp-2026-10-30_8825", "cmp-2026-10-31_04de"]`, `new_entrants`, `opponents` and `provenance`.
- **Round 1, against chosen opponents** (Abi, 2026-10-31, to reduce the judging load). The new methods meet each other, and each meets `ai_vision_strong`, `ai_vision`, `pymupdf4llm` and `current`: the pooled top three after the second comparison, and the anchor. They do not meet `opendataloader`, `pdfjs` or `markitdown`. Each pair is judged 3 times on three page types, with round(r1 / 9) hidden repeats.
  - With n new methods: n(n−1)/2 + 4n pairs, so 13, 30, 50, **73** or 100 duels for n = 1…5.
  - With the four heavy methods: 22 pairs × 3 = 66 + 7 = 73 duels, repeats at least 20 apart.
  - The schedule seed is **20261102**, fixed in the implementation plan before any vote; the four-method round 1 has digest `05e4a3b4c1dd0f980f495401892280ce36a58b55d65d445c83fa98d8d73aed35`.
- **One scale.** Bradley–Terry is fitted over every counted vote of all three comparisons (the first two only read), with `current` = 1000 and the same prior; the bootstrap resamples the pooled votes 1,000 times, seeded with 20261102. The graph of duels is connected, because every new method meets `current` and the three other opponents.
- **H1.** Decided on the pooled fit with Bonferroni over all k = entrants − 1 challengers (10 with four heavy methods, 11 with five). The first comparison's verdict (k = 4) stays primary for the fast methods, and the second's pooled verdict (k = 6) for the paid methods; this pooled verdict is the one for the heavy methods. The round-1-only sensitivity line is computed as in deviation 2.
- **Round 2 (§6), restricted like round 1.** It runs only while the pooled top two overlap **and** their pair is one this comparison schedules (two new methods, or a new method and an opponent). Each batch gives 3 more duels to every adjacent top-4 pair that this comparison schedules; no hidden repeats; at most 75 extra duels. A round-2 duel against `opendataloader`, `pdfjs` or `markitdown` would be those pairs' first meeting, chosen after seeing round-1 results; the old pairs were settled under their own comparison's rule and cap.

*Threats (§9), added.*
- **Less blind than before.** Abi has seen all seven earlier methods' outputs on all 24 pages with names, so a duel of a heavy method against one of them may be recognisable from the old side. The heavy methods' own outputs stay hidden until this comparison finishes.
- **Restricted opponents.** The heavy methods' places relative to `opendataloader`, `pdfjs` and `markitdown` rest on the shared Bradley–Terry scale through the four common opponents, not on direct duels; a non-transitive preference there would go unseen. If a heavy method and one of those three were the overlapping top two, round 2 would not run.
- **Footer handling differs by design.** Several heavy methods classify page headers and footers and leave them out on purpose (marker states it removes them; Docling exports only the body by default; MinerU and PP-StructureV3 mark them as page furniture). Footer-leak counts therefore reflect design as well as reading quality. ⟨With a page subset: their cross-page footer detection sees only the pages given.⟩
- **Hardware, sharper than §9.** PaddlePaddle runs on the CPU only. Marker's VLM runs through llama.cpp on Metal; marker and MinerU choose their own mode or tier per device (marker's `fast` mode on MPS, not the `balanced` mode it uses on a GPU). With 8 GB of memory the Mac may swap (peak memory is recorded). Times are relative to this Mac.
- **Fresh releases.** marker-pdf 2.1.0 and mineru 4.1.3 were 1–2 days old when pinned; an early release can carry bugs that a later one fixes. The versions are recorded and fixed.
- **HTML in outputs.** The viewer renders through `Prose` (react-markdown, no raw HTML), which shows raw HTML as literal text, as the reading face would. Methods that write tables as `<table>` or wrap images in `<div>` are disadvantaged on those pages.
- **Default OCR inside the heavy methods.** As with `pymupdf4llm` (§9), a method may OCR pages it judges image-like; its invented-word share then reflects its OCR, not only the text layer.
- **The time limit includes start-up.** On the 6- and 7-page sheets, model loading weighs more per page than on the decks.
```

- [ ] **Step 6: Record the heavy methods in the spec**

In `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md`:
- In the Contenders table, replace the `mineru` row's notes cell `Licence terms recorded` with `Licence terms recorded. MinerU 4 has no backend called pipeline: tier basic is the same model pipeline without a VLM (PROTOCOL.md deviation 3)`.
- In decision 9, after the bullet that starts `- **Second comparison:**`, add: `   - **Third comparison:** the heavy methods, pooled with both earlier comparisons on the same scale; their new pairs meet only ai_vision_strong, ai_vision, pymupdf4llm and current (Abi, 2026-10-31; PROTOCOL.md deviation 3).`

- [ ] **Step 7: STOP — Abi confirms**

Show Abi, and wait for a clear yes:
- the versions and licences table, the model folders and their sizes;
- the time-limit outcomes and which methods are entrants;
- the input decision as written;
- the third comparison's count for the actual number of new methods (13 / 30 / 50 / 73 / 100);
- the round-2 rule and the threats;
- the whole Deviation 3 text.

If Abi changes anything, change it and show it again. **Do not commit before the yes.**

- [ ] **Step 8: Commit and check the gate**

```bash
git status --short && git branch --show-current
$PY -m pytest backend/tests/unit/test_parser_bench_*.py -m "not slow" -q
git add docs/thesis/experiments/parser-benchmark/PROTOCOL.md docs/superpowers/specs/2026-10-30-parser-benchmark-design.md \
  backend/tests/unit/test_parser_bench_tools.py
git commit -m "docs(parser-bench): protocol deviation 3 — heavy methods, the time limit, the third comparison

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
$PY -c "from backend.eval.parser_bench import execute; print(execute.benchmark_gate())"
git rev-parse HEAD
```

Expected: tests green; `benchmark_gate()` prints `{'protocol_commit': '<HEAD sha>', 'bench_tree': '<64 hex>'}`, with the protocol commit equal to `HEAD`.

- [ ] **Step 9: Log it**

Append to `LAB_LOG.md`:

```markdown

## ⟨YYYY-MM-DD⟩ — protocol deviation 3: heavy methods and the third comparison

- Protocol commit ⟨sha⟩ (deviation 3); bench tree ⟨first 12 hex⟩.
- Entrants-to-be: ⟨heavy methods within the limit⟩; did not run here: ⟨list or none⟩; not run: ⟨list or none⟩.
- Input: ⟨whole documents / page set + N neighbours, chosen by Abi on ⟨date⟩⟩.
- Third comparison planned: builds on cmp-2026-10-30_8825 and cmp-2026-10-31_04de; opponents ai_vision_strong, ai_vision, pymupdf4llm, current; seed 20261102; ⟨n⟩ duels if all ⟨n⟩ heavy methods finish their five runs.
```

```bash
git add docs/thesis/experiments/parser-benchmark/LAB_LOG.md
git commit -m "docs(parser-bench): lab log — deviation 3

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The heavy benchmark runs, the third comparison, the viewer — STOP for Abi

**Files:**
- Modify: `docs/thesis/experiments/parser-benchmark/LAB_LOG.md`
- Modify (only if the entrant set is not the pinned four or five): `backend/tests/unit/test_parser_bench_schedule.py`
- Data (outside git): the heavy benchmark runs and one comparison under `~/Documents/learnstation-parser-bench/runs/`.

**Interfaces:**
- Consumes: the CLI (`run --purpose benchmark`, `compare create --against --opponents`, `compare status`, `clear-models`), `results.summarize`, the built viewer and the `parser-bench` preview entry.
- Produces: a comparison `cmp-<date>_<4hex>` waiting for Abi (73 duels with four heavy methods); `cmp-2026-10-30_8825` and `cmp-2026-10-31_04de` unchanged.

Remember: do not vote, do not unlock, and do not report per-method check numbers or output text of benchmark pages. Timings, memory, disk and status are fine.

- [ ] **Step 1: Pre-flight**

```bash
git status --short && git branch --show-current
$PY -m backend.eval.parser_bench tools
$PY -c "from backend.eval.parser_bench import execute; print(execute.benchmark_gate())"
df -h / | tail -1
shasum -a 256 ~/Documents/learnstation-parser-bench/runs/compare/cmp-2026-10-30_8825/{compare.json,votes.jsonl,results.json} \
  ~/Documents/learnstation-parser-bench/runs/compare/cmp-2026-10-31_04de/{compare.json,votes.jsonl,results.json} | tee "$SCRATCH/earlier-before.txt"
```

Expected:
- the heavy methods that are entrants-to-be are `ready`;
- the gate passes with Task 13's protocol commit;
- the free disk and the six hashes are noted.

- [ ] **Step 2: Start the runs (detached), in the spec's order**

```bash
cat > "$SCRATCH/bench3b.sh" <<'SH'
#!/bin/zsh
set -u
cd ~/Desktop/ascend-academy/.claude/worktrees/file-upload-workflow-e9126d
PY=~/Desktop/ascend-academy/.venv/bin/python
FILES=("Course SWT/Slides/2.pdf" "03 DBS Normalization.pdf" " 03__SR_Prozesse_v07_27.04.2025.pdf" "Course SWT/ueb01.pdf" "Course SWT/ueb02.pdf")
for t in "$@"; do
  echo "== $t $(date -u +%FT%TZ) free $(df -g / | tail -1 | awk '{print $4}') GB"
  if ! $PY -c "import shutil, sys
from backend.eval.parser_bench import tools
t = tools.TOOLS[sys.argv[1]]
need = (0 if tools.cache_mb(t) else t.size_mb * 2**20) + tools.FREE_FLOOR
sys.exit(0 if shutil.disk_usage('/').free >= need else 3)" "$t"; then
    echo "== $t: too little disk to download its models again; skipped"; continue
  fi
  for f in "${FILES[@]}"; do
    out=$($PY -m backend.eval.parser_bench run "$t" "$HOME/Downloads/$f" --purpose benchmark 2>&1)
    echo "$out"
    if print -r -- "$out" | grep -q "did not run here"; then echo "== $t did not run here; its other files are skipped"; break; fi
  done
done
echo "== done $(date -u +%FT%TZ) free $(df -g / | tail -1 | awk '{print $4}') GB"
SH
nohup zsh "$SCRATCH/bench3b.sh" ⟨the entrants-to-be in order: docling marker mineru paddleocr [paddleocr_vl]⟩ > "$SCRATCH/bench3b.log" 2>&1 &
```

Watch `$SCRATCH/bench3b.log` (Monitor, or `tail` from time to time).

Expected per run: `<run_id>  finished  <s> s/page, peak <MB> MB`, or `failed  did not run here: …`.
- **Any other failure**: let the script go on. Then look at the reason (`run.json` `reason` and `failed_stage`, the last lines of `log.txt`; never the pages).
- **If it looks transient** (killed by memory pressure, a lost download): re-run that one method on that one file once and log both runs.
- **Otherwise**: stop and tell the controller. Do not change code to make a run pass: that would need another deviation.
- **Disk**: between methods, if free space drops below the next method's model folder plus 3 GB, `clear-models` a method whose five runs are finished, and log it.

- [ ] **Step 3: What ran (from the records, never the outputs)**

```bash
$PY - <<'PY'
from backend.eval.parser_bench import store
HEAVY = ("docling", "marker", "mineru", "paddleocr", "paddleocr_vl")
rows = [m for m in store.list_runs() if m.get("kind") == "extract" and m.get("tool") in HEAVY and m.get("purpose") == "benchmark"]
for m in sorted(rows, key=lambda m: m["started_at"]):
    print(m["run_id"], m["status"], m.get("source", {}).get("pages_total"), m.get("seconds_per_page"), m.get("peak_memory_mb"),
          m.get("warmup_seconds"), m.get("did_not_run_here"), m.get("model_cache_mb"), m.get("models_downloaded_in_timed_run"),
          m.get("input_pages") and len(m["input_pages"]), (m.get("reason") or "")[:100])
for tool in HEAVY:
    done = {m["source"]["sha256"] for m in rows if m["tool"] == tool and m["status"] == "finished"}
    print(tool, f"{len(done)} of 5 files finished")
PY
```

Expected: one line per run. The entrants are the methods with **5 of 5 files finished** and no `did_not_run_here`. If any run says `models_downloaded_in_timed_run: True`, note it for the log (a deviation from "no download is timed", but the run stands as recorded).

- [ ] **Step 4: Pin the schedule if the entrant set is not one already pinned**

The digests pinned in Task 1 cover exactly the four methods `docling`, `marker`, `mineru`, `paddleocr`, and those four plus `paddleocr_vl`. If the entrants are a different set, compute and pin its schedule before creating the comparison (still before any vote):

```bash
$PY - <<'PY'
import hashlib, json
from backend.eval.parser_bench import pageset, schedule
NEW = {⟨the entrants, e.g. "docling", "mineru", "paddleocr"⟩}
SEVEN = ["current", "pymupdf4llm", "pdfjs", "markitdown", "opendataloader", "ai_vision", "ai_vision_strong"]
pages = [schedule.SchedPage(p.key, p.type) for p in pageset.load()]
duels = schedule.round1([*SEVEN, *NEW], pages, 20261102, new=NEW, opponents={"ai_vision_strong", "ai_vision", "pymupdf4llm", "current"})
print(len(duels), hashlib.sha256(json.dumps(duels, sort_keys=True).encode()).hexdigest())
PY
```

Add a test with that set, its length and that digest to `test_parser_bench_schedule.py`, next to `test_the_third_comparison_schedule_is_fixed_before_any_vote`. The test file is not part of the bench, so the gate stays open. Then commit:

```bash
git add backend/tests/unit/test_parser_bench_schedule.py
git commit -m "test(parser-bench): pin the third comparison's schedule for the methods that ran

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Create the comparison**

```bash
$PY -m backend.eval.parser_bench compare create --tools ⟨entrants, comma-separated⟩ \
  --against cmp-2026-10-30_8825,cmp-2026-10-31_04de --opponents ai_vision_strong,ai_vision,pymupdf4llm,current --seed 20261102
$PY -m backend.eval.parser_bench compare status
```

Expected: `cmp-<date>_<4hex>  judging  0/73 duels` (or 13 / 30 / 50 / 100 for 1 / 2 / 3 / 5 entrants), its folder, then `… judging  0/73 duels` and `names and ranking stay hidden until judging is finished`.

Check the record without reading any output:

```bash
$PY - <<'PY'
from backend.eval.parser_bench import compare, schedule
cmp = compare.list_comparisons()[0]
m = cmp.meta
print(m["run_id"], m["builds_on"], m["new_entrants"], m["opponents"], m["seed"], len(m["schedule"]))
first = [d for d in m["schedule"] if d["repeat_of"] is None]
assert all(schedule.pair_allowed(d["a"], d["b"], set(m["new_entrants"]), set(m["opponents"])) for d in m["schedule"])
print("round-1 pairs", len({tuple(sorted((d["a"], d["b"]))) for d in first}), "repeats", len(m["schedule"]) - len(first))
PY
```

- [ ] **Step 6: The earlier comparisons are unchanged and still reproducible**

```bash
shasum -a 256 ~/Documents/learnstation-parser-bench/runs/compare/cmp-2026-10-30_8825/{compare.json,votes.jsonl,results.json} \
  ~/Documents/learnstation-parser-bench/runs/compare/cmp-2026-10-31_04de/{compare.json,votes.jsonl,results.json} > "$SCRATCH/earlier-after.txt"
diff "$SCRATCH/earlier-before.txt" "$SCRATCH/earlier-after.txt" && echo "earlier comparisons unchanged"
$PY - <<'PY'
import json
from backend.eval.parser_bench import compare, results
for cid in ("cmp-2026-10-30_8825", "cmp-2026-10-31_04de"):
    c = compare.CompareRun.open(cid)
    stored = (c.path / "results.json").read_text(encoding="utf-8")
    print(cid, "results recompute byte-identically:", json.dumps(results.summarize(c), ensure_ascii=False, indent=2) == stored)
PY
```

Expected: `earlier comparisons unchanged`, and `True` for both. If either is False, stop and tell the controller before anything else.

- [ ] **Step 7: Log the runs and the comparison**

Append to `LAB_LOG.md`:

```markdown

## ⟨YYYY-MM-DD⟩ — heavy benchmark runs and the third comparison

- Protocol commit ⟨sha⟩ (deviation 3), bench tree ⟨first 12 hex⟩; disk before ⟨GB⟩, after ⟨GB⟩. Input: ⟨whole documents / page set + N neighbours⟩.
- Benchmark runs (⟨n⟩ methods × 5 PDFs, warm-up first): ⟨n⟩ finished, ⟨n⟩ failed (⟨method, file, reason⟩ or "none"); did not run here: ⟨method, file, s at the limit⟩ or "none". Re-runs: ⟨none / which and why⟩.
- Seconds per page and peak MB (range over the five PDFs; start-up included; ⟨over whole files / over the pages given⟩):
  - ⟨method⟩: ⟨min–max⟩ s/page, peak ⟨MB⟩ MB, warm-up ⟨min–max⟩ s, model folder ⟨MB⟩ MB⟨, a download during a timed run: run ids⟩
- Model folders cleared for disk: ⟨none / which⟩.
- Comparison ⟨cmp id⟩: builds on cmp-2026-10-30_8825 and cmp-2026-10-31_04de (unchanged: all six file hashes as before; both results.json recompute byte-identically). New entrants ⟨list⟩; opponents ai_vision_strong, ai_vision, pymupdf4llm, current. ⟨r1⟩ round-1 duels (⟨pairs⟩ pairs × 3) + ⟨r⟩ hidden repeats = ⟨n⟩, schedule seed 20261102 ⟨, digest pinned in ⟨commit⟩⟩. Judging not started.
```

Only timings, memory, disk, status and counts go here. Nothing about the heavy methods' outputs or checks on benchmark pages.

```bash
git add docs/thesis/experiments/parser-benchmark/LAB_LOG.md
git commit -m "docs(parser-bench): lab log — heavy benchmark runs and the third comparison

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Open the viewer for Abi — STOP**

This plan changes no viewer code, so `viewer/dist` stays as built. The server must still restart, because a running server holds the old Python code. Stop any running `parser-bench` preview (`preview_list`, then `preview_stop`), start it again (`preview_start` with name `parser-bench`), and confirm in the browser pane:
- **Judge** shows "Duel 1 of 73" (or the actual count), with no round text;
- the pill reads `cmp-… · judging 0/73`;
- Compare and Scoreboard are marked locked for the new comparison;
- in **Runs**, a heavy benchmark run lists its pages as locked and no page output opens;
- **New run** lists the heavy methods in the Heavy group as ready, with their sizes;
- the console shows no errors.

Do not press any vote key. Leave the server running and tell the controller:
- the comparison id and its duel count;
- which heavy methods are entrants, which did not run here, and which were not run;
- the time the runs took;
- that judging can start at `http://127.0.0.1:8766`.

Abi judges; this plan ends here.

---

## Spec coverage (Plan 3b's share)

| Requirement | Task |
|---|---|
| `docling`: default pipeline, Markdown export per page; MIT code, model licences recorded | 6, 11, 13 |
| `marker`: LLM enhancement off, output split by page; model-weight terms recorded | 7, 11, 13 |
| `mineru`: `pipeline` backend (MinerU 4: tier `basic`), page index from the content list; licence terms recorded | 8, 11, 13 |
| `paddleocr`: PP-StructureV3 Markdown; PaddleOCR-VL also tried | 9, 11, 13 |
| "A variant slower than 120 s/page on the M1 is recorded as *did not run here*" | 5, 11, 13, 14 |
| Settings: defaults, every exception in the protocol, no tuning | 6–9, 13 |
| Input: whole documents (or Abi's documented deviation) | 11 (STOP), 12, 13 |
| Tool environments: own uv env, Python 3.12, exact versions recorded | 4, 6–9, 11, 13 |
| New run: Heavy group, ready or install with download size; the 3 GB guard | 4, 6–9 (existing viewer) |
| Order of runs; free disk checked after each heavy tool; model files deleted if needed, outputs kept | 4 (`clear_models`), 10, 11, 14 |
| Warm-up so no model download is timed; cost as s/page and peak memory | 4 (models at install), 5, 14 |
| Decision 9: heavy methods join on one scale, `current` = 1000; same round-1 and stopping rules per comparison (restricted to chosen opponents by Abi) | 1, 2, 3, 13, 14 |
| Earlier comparisons read-only; their results reproducible | 1, 3, 14 |
| Protocol deviation before the first heavy benchmark run, with a STOP for Abi | 13 |
| Threats: M1/MPS vs CUDA, footer handling, less blind judging | 13 |
| Tests never download models; live tests only where installed | 4–9 |
| Export, `RESULTS.md`, figures, the improvement loop | Plan 4 (after judging) |
