# Parser benchmark: which extraction gives learners clean text — design

**Date:** 2026-10-30 · **Status:** design agreed with Abi (decisions below), awaiting spec review · **Builds on:** `backend/eval/decks.py`, `backend/eval/deck_lab.py` · **Feeds:** thesis `06-evaluation.tex` (Automated Quality Evaluation, Results)

## Why

The reading face shows each page's parsed text, and every learning feature starts from it. Today that text is the raw PyMuPDF dump: `_extract_pages` calls `page.get_text("text")`, and `unified_orchestrator.py` deliberately pins the stored content to that raw text. On *Softwaretechnik 1* (Lecturer, 27 pages) it shows five problems:

1. **Wrong symbols.** Symbol-font bullets come out as `§`, and the arrow `→` comes out as `®`.
2. **Footer junk.** "Lecturer / Softwaretechnik / 15" sits in every page's text, sometimes before the title.
3. **Wrong order.** Page 21 reads footer, green box, yellow box, and the title last.
4. **Broken lines.** Breaks fall where the slide wrapped ("Software ↵ Engineering"), and bullets sit on their own line.
5. **No structure.** No headings, no nesting, no emphasis.

What learners finally see also passes through translation (`localization_service._translation_prompt`). That step flattens line breaks into one paragraph, adds Markdown at random, and translates the junk ("Lecturer Software Engineering 2"). **This benchmark measures extraction only.** The translation prompt is a separate fix (see Out of scope).

## Decisions (2026-10-30)

1. **Runs on Abi's Mac** (M1, 8 GB, macOS 26.6.2), one tool at a time. Never on the production server.
2. **10 contenders**: our current extraction, the six tools from Abi's list, and three cheap extras.
3. **24 pages** from four sources. No phone photos.
4. **Pairwise blind duels judged by Abi alone.** An AI judge may be added later as a dated protocol amendment, validated against Abi's votes. No second human judge.
5. **Automatic checks** run alongside the duels and never decide the ranking alone.
6. **Thesis-grade documentation**: the protocol is committed before any tool runs; there is a lab log, a manifest per run, raw data, results and figures.
7. **Every run is kept as a permanent record** and can be viewed and compared in the browser. Re-running our pipeline after a fix is a first-class use.
8. **Upload, choose methods, run, compare, all from the browser.** Abi can bring in any PDF, tick the methods, and run them from the webpage.
   - Such runs are in **Explore** mode: names are visible, and they never count for the thesis.
   - Only the frozen 24-page **Benchmark set** feeds blind judging and the thesis results.
9. **Judge the five fast methods first (2026-10-30).** The protocol is frozen right after the webpage is built.
   - **First comparison:** the five fast methods (`current`, `pymupdf4llm`, `pdfjs`, `markitdown`, `opendataloader`) on the 24 pages, so Abi can start judging early. That is 10 pairs × 3 plus about 10% hidden repeats, roughly 33 duels.
   - **Second comparison:** the heavy methods and `ai_vision` join later, judged against the same opponents. All ratings stay on one scale, with `current` = 1000.
   - **Third comparison:** the heavy methods, pooled with both earlier comparisons on the same scale; their new pairs meet only ai_vision_strong, ai_vision, pymupdf4llm and current (Abi, 2026-10-31; PROTOCOL.md deviation 3).
   - **Same rules:** the round-1 rule ("every pair 3× on 3 page types, 10% hidden repeats") and the stopping rule apply per comparison.

## Research question and hypotheses

**RQ.** Which extraction approach turns real lecture PDFs into the text a learner would rather learn from, and at what cost in time and memory on commodity hardware?

- **H1.** At least one layout-aware tool is rated above our current extraction, with its 95% interval entirely above current's.
- **H2 (descriptive).** Layout-aware tools leak fewer footers and put the title first more often than current. These are reported as counts per tool, with no significance test claimed.
- **Cost** is reported descriptively as seconds per page and peak memory. There is no hypothesis about it.

## Contenders

| id | What runs | Notes |
|---|---|---|
| `current` | A standalone copy of our `_extract_pages` (`page.get_text("text")`), pinned to the production function by a test | PyMuPDF, AGPL-3.0. It is not imported, because importing the orchestrator loads the main checkout's `.env` with production credentials. |
| `pymupdf4llm` | `pymupdf4llm.to_markdown(page_chunks=True)` | Shows whether a small change to today's library is enough |
| `pdfjs` | `pdfjs-dist` 5.4.296 (the version in this repo), `getTextContent`, a newline on `hasEOL` | What a browser-side text layer would give |
| `markitdown` | `markitdown` 0.1.6 (the backend's pin), one page at a time | It has no page boundaries otherwise |
| `opendataloader` | `opendataloader-pdf` Markdown output (Java 22 is present) | Already wired as optional `odl_service.py` |
| `ai_vision` | Page image at 2× sent to the OpenAI vision model our pipeline uses, which says "transcribe to Markdown, add nothing", at temperature 0 | Exact model id verified live and recorded. Only the 24 pages are sent. |
| `ai_vision_strong` | The same page image and prompt sent to one current stronger OpenAI model, chosen from the account's live models | Added 2026-10-30 by Abi; model id, prices and settings in PROTOCOL.md deviation 2. Only the 24 pages are sent. |
| `docling` | Default pipeline, Markdown export per page | MIT code; model licences checked and recorded |
| `marker` | `marker-pdf`, LLM enhancement **off**, output split by page | Model-weight terms recorded |
| `mineru` | `pipeline` backend; the page index is the middle JSON's `page_idx` (the content list is only validated against it) | Licence terms recorded. MinerU 4 has no backend called pipeline: tier basic is the same model pipeline without a VLM (PROTOCOL.md deviation 3) |
| `paddleocr` | PP-StructureV3 Markdown. PaddleOCR-VL is also tried. | A variant slower than 120 s/page on the M1 is recorded as *did not run here* |

**Settings.** Every tool runs on its default settings, and each exception is listed in the protocol. Tools are not tuned.

**Input.** Each tool receives **whole documents**, because footer detection needs the other pages. Only the 24 selected pages are scored. `ai_vision` and `markitdown` work page by page by nature, and the lab log notes this.

## Test set

| Source | File | Pages in file | Selected | Tests |
|---|---|---|---|---|
| SWT | `~/Downloads/Course SWT/Slides/2.pdf` (Versionsmanagement) | 41 | 6 | symbol-font bullets, coloured boxes, diagrams |
| DBS | `~/Downloads/03 DBS Normalization.pdf` | 82 | 6 | tables, functional dependencies, formulas |
| SR | `~/Downloads/ 03__SR_Prozesse_v07_27.04.2025.pdf` (the leading space is part of the name) | 85 | 6 | diagrams, mixed layouts |
| Sheets | `~/Downloads/Course SWT/ueb01.pdf` + `ueb02.pdf`, treated as one source | 6 + 7 | 6 | dense text documents |

- **Selection rule.** In each source, **4 pages are chosen on purpose** (each with a written reason and a page-type tag) and **2 are drawn at random** from the rest with a recorded seed. All chosen pages are fixed in the protocol step, before any tool runs.
- **SWT deck 1 is excluded.** *Softwaretechnik 1* was used for the design demo on 2026-10-30, and Abi saw its outputs with tool names. So it is out of the benchmark set (it stays available for Explore), and the protocol records this.
- **Page types**: `layout` (boxes, columns), `lists`, `table_formula`, `diagram`, `dense_text`.
- **Fingerprints.** Every source PDF is recorded by SHA-256. The PDFs themselves are never committed.

## Automatic checks

These are computed per tool per page. The **reference** is the page's own text layer, taken from `page.get_text("words")` and `get_text("dict")`.

**Normalisation.** Before comparing, text is NFKC-normalised and case-folded. Hyphens at line ends are joined, and only tokens of two or more letters or digits are kept.

1. **Footer leak.** A *boilerplate line* is a text line, with its digits replaced by `#`, that appears on at least 50% of a document's pages and whose **vertical centre** lies in the top or bottom 15% of the page. The demo showed why: the SWT footer sits at 87–90% of page height, so a 12% band measured by edges missed it. The page's **printed** number is a digits-only line in the page's own edge band; it often differs from the PDF index, since SWT 2 page 3 prints "30".
   - **Footer parts.** The page's *footer parts* are its edge lines that are boilerplate or the printed number, each taken as a set of words and numbers. The same rule removes those lines from the reference text, so `current` stays perfect by construction on checks 6 and 7.
   - **Footer lines in the output.** An output line is a *footer line* when the same footer rule would remove it from the reference: it is the printed number, a boilerplate line, or made only of boilerplate words and the printed number.
   - **`footer_leaks`.** This is how many of the page's footer parts are covered by the output's footer lines taken together: a part leaks when every one of its words and numbers appears in some footer line. The score is the same whether a tool prints the footer on three lines, joins it into one, or splits one part across two lines (checks version 3; version 2 needed a part whole in one line and missed split parts; version 1 counted output lines, which rewarded joining).
   - **`footer_token_share`.** This is the share of the page's footer words and numbers found in the output's footer lines, so a footer cut short still shows. It is null on a page without footer parts.
   - **`footer_leaked`.** This says whether any part leaked.
2. **Title first.** The title is the line with the largest font on the page; if two tie, the topmost wins. The check passes if the output's first non-empty line, with heading marks stripped, matches the title with similarity ≥ 0.8. It is *n/a* when the largest font is less than 1.2× the page's median font.
3. **Wrong symbols.** This counts three things:
   - characters in the Private Use Area (U+E000–U+F8FF) or U+FFFD;
   - `§` and `®` on pages whose text layer shows those characters coming from a symbol font (Symbol, Wingdings, ZapfDingbats);
   - output lines that hold only a bullet character.
4. **Broken lines.** This is the share of line breaks inside running text where the line ends without `.:;!?` and the next line starts with a lowercase letter.
   - **Excluded:** breaks next to a heading, a list item or a table row (on either side), a `[figure]` line or a footer line.
   - **Recorded:** the counts `line_breaks` and `broken_lines`, and the percentage `broken_line_pct`.
   - **No breaks:** the percentage is null when a page has no qualifying break, so "nothing to judge" never reads as "nothing broken".
5. **Structure found.** The check counts headings, list items, maximum nesting depth, GFM tables and math spans. It is descriptive only: more is not automatically better.
6. **Dropped words.** This is `1 − |ref ∩ out| / |ref|`, computed over word multisets, with boilerplate tokens removed from the reference.
7. **Invented words.** This is `|out − ref| / |out|`, computed over word multisets of letters and digits, so a corrected arrow is not counted.
8. **Cost.** Each tool first runs once on a 2-page file, so model downloads don't count. Then the timed run records wall-clock seconds for the whole document divided by its pages, and peak memory: the largest summed resident set size of the runner's whole process tree, sampled at spawn and every 0.1 s; shared pages are counted once per process, and peaks shorter than the sampling interval can be missed; recorded as null when no sample was taken.

**Known bias, stated in advance.** Checks 6 and 7 use PyMuPDF's text layer as the reference. That makes `current` (and largely `pymupdf4llm`) score perfectly by construction, so results for those two are reported but marked.

## Duels

- **Screen.** A duel shows the slide image and two unnamed outputs side by side. Which tool goes left or right is random (seeded). Both outputs render through the app's own `Prose` component at reading-face measure. Images become a plain `[figure]` marker for every tool.
- **Rule on screen**, word for word as in the protocol: *"Which would you rather learn from?"* Nothing missing, nothing invented, right order, no junk, clear structure.
- **Answers.** There are four buttons, also on keys 1–4: **Left better · Right better · Same · Both unusable**, plus an optional note. Each vote is written immediately, with the seconds the decision took.
- **Round 1:** all 45 pairs × 3 duels each, every pair on three pages of three different types, for 135 duels.
  - The page assignment is seeded and balanced, so each tool appears 27 times.
  - **Sides are balanced per tool.** In round 1 (repeats not counted) each tool is on the left within one duel of half its appearances; round 2 is balanced the same way within its own duels.
  - **15 hidden repeats** are drawn from round 1 and shown again with sides swapped, at least 20 duels after the original and within the next third of the schedule. In general, repeats are one duel in ten of the final schedule, round(round-1 duels / 9), and the gap is 20 duels or a third of the schedule when that is shorter (the 33-duel first comparison: 3 repeats, 11 apart).
  - The order is shuffled with the seed. The total is about **150 duels**.
- **Round 2 (stopping rule, fixed in advance).** After round 1, if the top tool's 95% interval overlaps the second's, adjacent pairs among the top four get 3 more duels each, repeated until the intervals separate or 75 extra duels have been done. Round-2 duels have no hidden repeats, and the last batch is cut to fit the 75.
- **Resuming.** Abi can stop at any time; the next session continues the schedule.

## Analysis

- **Ranking.** A Bradley–Terry model is fitted with the MM algorithm (Hunter, 2004). "Same" and "Both unusable" count as half a win for each side. "Both unusable" is also reported on its own, per tool.
- **Scale.** Ratings are shown as points, `400·log10(strength)`, with **`current` = 1000**.
- **Uncertainty.** A bootstrap resamples the votes 1,000 times; the 2.5th and 97.5th percentiles give each tool's 95% interval.
- **Prior.** Each tool also plays one virtual drawn game, spread evenly over its opponents, so a tool that wins nothing in a bootstrap resample keeps a finite rating. It moves a rating by a few to about ten points, more where a tool almost never wins.
- **H1** uses a Bonferroni correction over the `k` challengers (the tools other than `current`, so `k` = number of tools − 1). A tool counts as above `current` when the (2.5/k)th percentile of its unrounded bootstrap points is above 1000. H1 holds if any tool does. The displayed 95% intervals are unchanged, and `current`'s interval is exactly 1000–1000. Between equal tools, H1 is declared in a few percent of comparisons (measured 2.5–4% in simulation), against about 7% without the correction.
- **Also reported:**
  - win rate per page type (descriptive);
  - self-consistency, the share of hidden repeats judged alike: the same tool won, or both times "Same", or both times "Both unusable" ("Same" against a winner, or against "Both unusable", counts as a disagreement);
  - median decision time;
  - every automatic check per tool, with the quality-versus-speed trade-off.
- **Results are a function of the raw data.** `results.json` is always recomputed from `votes.jsonl` and is never edited by hand.

## Storing runs

The data directory is `~/Documents/learnstation-parser-bench/` (override it with `PARSER_BENCH_DIR`). It is outside git, because tool outputs contain slide text.

```
runs/extract/<YYYY-MM-DD>_<tool>-<version>_<4hex>/
  run.json     tool, exact version, settings, model files, git commit + dirty flag,
               machine, start/end, status (running | finished | failed + reason), PDF hashes
  pages/*.md   output per selected page (local only)
  checks.csv   automatic checks per page
  log.txt      full console log
runs/compare/cmp-<YYYY-MM-DD>_<4hex>/
  compare.json extraction runs used, page set, protocol version + commit, seed, schedule
  votes.jsonl  one vote per line, append-only, with judging-session id
  results.json computed from votes.jsonl
```

**Rules:**
1. A finished run is never changed. Re-running creates a new run.
2. Failed runs are kept, with their reason.
3. `export` copies the number-only files (everything except `pages/*.md` and `log.txt`) into `docs/thesis/experiments/parser-benchmark/data/<run-id>/`.

**The improvement loop:**
1. Change the pipeline.
2. Make a new `current` extraction run.
3. Start a new comparison run that reuses the other nine tools' runs.
4. Judge only the duels involving the new run: 9 opponents × 3, about 27 duels.

The new rating sits on the same scale because the opponents are the same.

## The webpage

The webpage runs locally, bound to `127.0.0.1`, and opens in the desktop app's browser pane via `.claude/launch.json`. It has no login and is not part of the product.

0. **New run.** Abi drops a PDF or chooses one; it is stored by SHA-256 under the data directory and never in git. Then:
   - **Methods.** Abi ticks methods from three groups: Fast, Heavy (models download once) and Costs money.
     - Each method shows whether it is *ready* or still needs installing, with its download size.
     - A method that isn't installed can be installed from here. The server first refuses if less than 3 GB would remain free.
   - **Mode.** Abi picks **Explore** or **Benchmark set**.
   - **Run.** The server runs the chosen methods as background jobs in their own environments, one heavy method at a time, with live progress per method.
     - `ai_vision` asks for an explicit OK each run, showing the page count and estimated cost.
   - **Result.** Every job becomes an extraction run, with `purpose: explore | benchmark` in `run.json`.
1. **Duel:** as described above, with a progress bar. Keys: 1–4 vote, N note, Z enlarge the slide, U undo. Undo appends a retraction line to `votes.jsonl`; it never deletes one.
   - **Tool names never appear while judging.** The real tool has no reveal link; the demo's link is a demo-only aid.
   - When the comparison run's judging is finished, Judge shows **My votes**: every duel with both tool names, Abi's pick in bold, the seconds taken, the note, and withdrawn votes marked as withdrawn.
2. **Scoreboard:** ranking with intervals, the automatic-check table, a quality-versus-speed chart, and self-consistency.
3. **Compare:** pick any page, then the slide image and any tools side by side **with names**, with check failures highlighted (a leaked footer is marked).
4. **Runs:** every run with date, tool, version, status, time and judging progress. Open one to see its outputs and checks. Pick two runs of the same tool to compare them page by page with the differences highlighted.

**Blinding lock.** Until a comparison run's judging is finished (round 1 and any round 2), the Scoreboard, Compare and the output views in Runs stay locked for **benchmark-set pages**; the run list itself stays visible. Explore runs on other files stay open. But Abi should not explore the benchmark decks themselves before judging, and the protocol says so. Abi may unlock early, and that is written to the lab log as a deviation.

**Built from:**
- a small Python server that serves run data and appends votes with fsync;
- a React page built with its own Vite config that imports `src/components/markdown` (`Prose`: react-markdown, GFM, math, KaTeX), so rendering matches the reading face.

## Thesis documentation

Everything lives in `docs/thesis/experiments/parser-benchmark/`:

- **`PROTOCOL.md`** is written and committed **before the first tool run**. Its commit is recorded in every `compare.json`. It holds the research question, hypotheses, contenders with exact versions and licences, the pages with reasons, check definitions, the duel rules, the stopping rule, the analysis method and the threats to validity. Any later change is added as a dated *Deviation*, and the original text stays.
- **`LAB_LOG.md`** is a dated diary of installs, versions, failures, run times, disk use and deviations.
- **`data/<run-id>/`** holds the exported number-only records.
- **`RESULTS.md`** holds:
  - the ranking table with intervals;
  - the check table;
  - the H1/H2 outcomes;
  - self-consistency;
  - 3–4 short side-by-side excerpts, quoted with attribution.
- **Figures.** There are two: the ranking with intervals and quality versus speed. Each is made as PDF + SVG in `thesis/figures/`, with a `MANIFEST.md` entry giving its provenance and the claim it supports.
- **Writing boundary.** Claude produces the protocol, log, data, tables and figures. The prose in `06-evaluation.tex` stays Abi's; Claude asks before drafting any of it.

## Where the code lives

This block describes the end-of-Plan-2 layout; some modules listed here do not exist yet at this commit.

```
backend/eval/parser_bench/
  sources.py    source decks, hashes, page images, seeded selection
  pageset.py    the frozen page set (pages.json)
  runners/      one module per tool, run inside that tool's own environment
  checks.py     automatic checks
  normalize.py  images become one plain [figure] marker for every method
  execute.py    runs one method on one PDF: warm-up, timed run, peak memory, failure stage
  tools.py      which methods exist, where each runs, and how each is installed
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
docs/thesis/experiments/parser-benchmark/
  PROTOCOL.md  LAB_LOG.md  RESULTS.md  data/
```

- **Tool environments.** Each tool gets its own environment, created with `uv` on Python 3.12 under `~/.cache/learnstation-parser-bench/envs/<tool>`. `uv` clones shared wheels such as torch, so they aren't stored three times.
- **Runners** import nothing from the app. `current` runs in the backend `.venv`, so it uses production's own PyMuPDF version, and a unit test asserts that its output equals `unified_orchestrator._extract_pages`. A second test asserts that no benchmark module imports `backend.core`, `backend.services`, `backend.api`, `backend.repositories` or `backend.workers`.
- **`pdfjs`** runs as a Node script using this repo's `pdfjs-dist`.
- **Images** in any output (Markdown image syntax or HTML `<img>`) become `[figure]` before display and checks.
- **Order of runs.** Cheap tools go first, then `docling`, `marker`, `mineru`, `paddleocr`. Free disk is checked after each heavy tool (8.8 GB free on 2026-10-30), and its model files are deleted if needed. Outputs are kept.
- **Tests** in `backend/tests/unit/test_parser_bench_*.py` cover:
  - each check against small hand-made pages;
  - the schedule (balance, repeat spacing, seed reproducibility);
  - ranking (Bradley–Terry recovers known strengths from synthetic votes; the bootstrap intervals cover them);
  - the store (finished runs refuse writes; export leaves out slide text).
- **Viewer check.** The viewer is checked in the browser pane.

## Safety

- The production server and database are never touched.
- Nothing in the app's code paths changes.
- Only the paid methods (`ai_vision`, `ai_vision_strong`) send data off the Mac: the 24 page images, once per paid method, to OpenAI.
- No slide text and no PDFs go into git. The repo is public.

## Out of scope

- Changing the production pipeline. Adopting a winner is a separate design.
- **The translation prompt fix**: keep line breaks and structure, and drop footers. It should be its own small change.
- An AI judge (possible later amendment), a second human judge, scans and phone photos, licence clearance for production use, and GPU hardware.

## Threats to validity (seed list for the protocol)

- **One judge, who also built the product.** Countermeasures: hidden names, random sides, hidden repeats for self-consistency, and automatic checks independent of the judge.
- **Deliberate page choice.** 2 of every 6 pages are random, and the reasons for the others are recorded.
- **Small and narrow sample.** The sample is 24 pages from one university, in two languages, all born-digital, with no scans. PaddleOCR's strength (scans) is not exercised.
- **The check reference is PyMuPDF's text layer**, which favours `current` and `pymupdf4llm` on checks 6 and 7.
- **Hardware.** The M1 with 8 GB uses Apple's GPU framework (MPS), and several tools are tuned for NVIDIA GPUs (CUDA). Speeds are relative, not production figures.
- **Settings and versions.** Default settings and October 2026 versions; tuned tools might do better.
- **Cost measures.** Peak memory is summed across processes (the runner and every child, such as OpenDataLoader's Java), and timing includes interpreter, JVM and Node startup.
- **`ai_vision` is not fully deterministic** at temperature 0. It runs once, and the model id and date are recorded.
- **Rendering.** Showing every output through our `Prose` may disadvantage output in other syntaxes. Outputs are normalised to Markdown first.
- **Page-by-page tools** lose cross-page context.
- **Fatigue.** Sessions are short, and decision times are recorded.

## Done means

- `PROTOCOL.md` is committed before the first tool run.
- All 10 contenders have a finished run or a documented failed run.
- At least 150 votes are recorded. `results.json`, `RESULTS.md` and both figures are produced from them.
- The export is committed.
- The Runs screen shows every run.
- Re-running `current` and judging only its new duels has been shown to work once.
