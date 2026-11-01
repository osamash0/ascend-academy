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
- Disk before installing: 9.8 GB free (`df -h /`). Freed ~4.4 GB on 2026-10-30 by
  removing `node_modules` from six idle worktrees.

## 2026-10-30 — engine (Plan 1) installs and smoke runs

Installed with `python -m backend.eval.parser_bench install <method>`, each into
its own `uv` environment on Python 3.12.13. Free disk after the three installs:
9.7 GB (`df -h /`). By `du` the three environment folders were 249 MB together
(pymupdf4llm 51 MB, markitdown 175 MB, opendataloader 23 MB) and 428 MB after the
pymupdf4llm reinstall below (222 MB, 183 MB, 23 MB).
Smoke runs: explore purpose, *Softwaretechnik 1* (27 pages), pages 5, 15, 17 and
21 scored, one warm-up run first. Seconds per page is the
timed run over all 27 pages divided by 27 (every method reads the whole deck).
Machine: macOS 26.6.2, arm64, 8 CPU cores, 8 GB RAM. Every `run.json` records
`dirty: true` (files of this task were uncommitted at the time). The `current`,
`pdfjs`, `markitdown` and `opendataloader` runs and the failed first `pymupdf4llm`
run record commit 0d2f9610; the second `pymupdf4llm` run records commit 9565e36e.

| Method | Environment (key versions) | Disk after install (env folder, `du`) | s/page on SWT 1 | Peak MB |
|---|---|---|---|---|
| current | pymupdf==1.27.1, Python 3.13.1 (backend .venv) | — | 0.006 | 52.6 |
| pymupdf4llm † | pymupdf4llm==1.28.2, pymupdf==1.28.2, pymupdf-layout==1.28.2, onnxruntime==1.31.1 (see the pin entry below) | 222 MB | 0.173 † | 412.2 † |
| pdfjs | node v22.23.2, pdfjs-dist==5.4.296 | — | 0.015 | 122.9 |
| markitdown | markitdown==0.1.6, pypdf==6.21.4 | 175 MB | 0.058 | 102.3 |
| opendataloader | opendataloader-pdf==2.4.1, openjdk 22.0.1 | 23 MB | 0.029 | 157.1 |

† includes Tesseract OCR on 3 of 4 scored pages (pages 5, 15, 17); see the
observations in the pin-decision entry below. These two numbers are not those of
a text-layer extraction.

Run folders (under `~/Documents/learnstation-parser-bench/runs/extract/`, not in git):
`2026-10-30_current-1.27.1_462f`, `2026-10-30_pymupdf4llm-1.28.2_21ab` (after the
pin change below; the first attempt `2026-10-30_pymupdf4llm-unknown_910f` failed and
is kept), `2026-10-30_pdfjs-5.4.296_ce90`, `2026-10-30_markitdown-0.1.6_2916`,
`2026-10-30_opendataloader-2.4.1_333b`.

Sanity check of the checks against the hand-read finding: `current`, page 21 shows
`footer_leaks` 3 and `title_first` False, as the spec records. (The table's
pymupdf4llm row was filled from the second attempt; its page 21 shows
`footer_leaks` 3, `title_first` True.)

Live end-to-end test (`test_parser_bench_runners_live.py`, synthetic 6-page deck):
first run 4 of 5 methods pass and `pymupdf4llm` fails (below); after the pin change
below, 5 of 5 pass.

Failures and surprises:

- **pymupdf4llm installed an empty package.** `install pymupdf4llm` exited 0 and
  wrote its marker, but `uv` resolved `pymupdf4llm==2.0` to satisfy the
  `pymupdf==1.27.1` pin. Version 2.0 is a placeholder with no code (its metadata
  says the 4llm code moved into pymupdf 2.x). The runner then fails with
  `ModuleNotFoundError: No module named 'pymupdf4llm'`; the explore run is kept as
  failed ("pymupdf4llm exited with code 1"), version recorded as `unknown`. No
  pymupdf4llm 1.x release resolves with `pymupdf==1.27.1`: `uv` reports that
  `pymupdf4llm>=1,<2` depends on pymupdf 1.27.2 up to 1.28.2. Settled in the
  entry below.
- **markitdown logged 20 `Ignoring wrong pointing object` warnings** (the PDF
  reader reporting objects it could not follow). The run finished; the lines are
  in that run's `log.txt`.
- Peak memory was measured for every finished run; none was `—`.

## 2026-10-30 — pymupdf4llm pin decision

- The first pin was `pymupdf4llm` with `pymupdf==1.27.1`, production's PyMuPDF.
  It resolved to the empty placeholder `pymupdf4llm==2.0`, because every
  pymupdf4llm 1.x release needs pymupdf 1.27.2 or newer. The install exited 0 and
  the runner then failed on import (first attempt, run kept as failed).
- Decision (controller): pin `pymupdf4llm==1.28.2` exactly, which resolves pymupdf
  1.28.2. **Stated threat to validity:** `pymupdf4llm` (PyMuPDF 1.28.2) and
  `current` (PyMuPDF 1.27.1) run on different PyMuPDF minor versions, so a
  difference between them can come from the library version as well as from
  pymupdf4llm's Markdown mode. Other candidates tried in throwaway environments,
  not benchmarked: `pymupdf4llm==0.3.4` with `pymupdf==1.27.1`, and
  `pymupdf4llm==1.27.2.1` with `pymupdf==1.27.2`.
- Guard added: `install` now imports each method's module in its own environment
  before it writes the "installed" marker, and refuses with a one-line message if
  that fails.
- Reinstalled, then the live test passed 5 of 5 and the smoke run on *Softwaretechnik 1*
  (explore, pages 5, 15, 17, 21) finished: 0.173 s/page, peak 412.2 MB, warm-up
  0.85 s (run `2026-10-30_pymupdf4llm-1.28.2_21ab`, repository dirty at commit
  9565e36e). Environment folder 222 MB; free disk 9.4 GB afterwards.

Observations:

- markitdown's run log holds 20 `Ignoring wrong pointing object` lines (and no
  other line). The run finished.
- **pymupdf4llm 1.28.2 ran Tesseract OCR on 3 of the 4 scored pages, and its text
  on two of them differs from the PDF text layer.** The run log
  (`2026-10-30_pymupdf4llm-1.28.2_21ab`, 8 non-blank lines) holds `Using Tesseract
  for OCR processing.` and 6 `OCR on page.number=N/M.` lines (4/5, 11/12, 14/15,
  16/17, 24/25, 25/26). Read as zero-based index / page number, pages 5, 12, 15,
  17, 25 and 26 were OCR'd; of these, 5, 15 and 17 are scored. Tesseract is installed
  on this machine (`/opt/homebrew/bin/tesseract`); pymupdf4llm decided on its own to
  OCR pages of a deck that has a text layer. Not tested: whether the OCR stops when
  Tesseract is absent. `checks.csv` of that run against the `current` run
  `2026-10-30_current-1.27.1_462f` (which reads the text layer):

  | Page | OCR'd | invented_words_pct, pymupdf4llm / current | chars, pymupdf4llm / current |
  |---|---|---|---|
  | 5 | yes | 57.1 / 0.0 | 618 / 312 |
  | 15 | yes | 0.0 / 0.0 | 823 / 730 |
  | 17 | yes | 50.9 / 0.0 | 367 / 254 |
  | 21 | no | 0.0 / 0.0 | 739 / 698 |

  On pages 5 and 17, 57.1% and 50.9% of pymupdf4llm's words are not in the PDF text
  layer; `current` has 0.0% invented on all four pages. `wrong_symbols` is identical
  for both methods on all four pages (4, 13, 0, 0), so it does not show the OCR
  effect; `title_first` is False for both on page 17. The time (0.173 s/page) and
  peak memory (412.2 MB, the highest of the five) in the table include the OCR.
  Open, to be decided before the protocol: whether pymupdf4llm is benchmarked with
  OCR on or off, and how that is recorded in `settings`.

## 2026-10-30 — how cost is measured; tool versions on this machine

- **s/page** is the wall-clock time of the timed run divided by the file's page
  count. Each method first runs once on a two-page sample of the file (the
  warm-up); that time is recorded as `warmup_seconds` and is not part of s/page.
- **Peak MB** is the largest summed resident set size of the runner's whole
  process tree, sampled at spawn and every 0.1 s. Shared pages are counted once
  per process, and peaks shorter than the sampling interval can be missed. It is
  recorded as null (shown as —) when no sample was taken.
- Tesseract on this machine (`tesseract --version`, first line): `tesseract 5.5.2`.
- uv (`uv --version`): `uv 0.11.7 (9d177269e 2026-04-15 aarch64-apple-darwin)`.

## 2026-10-30 — protocol frozen

- Checks version 3 (footer parts across split output lines, footer token share, list items end no break) is in force from this commit on; the six explore runs of 2026-10-30 stay on checks v1.
- Page set: 24 pages, seed 20261030 for the random draw (fixed in the plan before drawing); type counts lists 8, diagram 5, dense_text 5, layout 3, table_formula 3.
- Footer formats per PDF:
  - swt: 41 pages, boilerplate lines 3, pages with a printed number 39, footer parts per page median 3, max 3.
  - dbs: 82 pages, boilerplate lines 2, pages with a printed number 3, footer parts per page median 2, max 6.
  - sr: 85 pages, boilerplate lines 2, pages with a printed number 85, footer parts per page median 2, max 4.
  - ueb01: 6 pages, boilerplate lines 7, pages with a printed number 6, footer parts per page median 7, max 7.
  - ueb02: 7 pages, boilerplate lines 7, pages with a printed number 7, footer parts per page median 7, max 7.
- Method versions as in PROTOCOL.md §2; Tesseract 5.5.2 for pymupdf4llm.

## 2026-10-30 — benchmark runs and the first comparison

- Protocol commit 8f70b7ef; disk before 20 GB free, after 18 GB free.
- 25 benchmark runs (5 fast methods × 5 PDFs, whole documents, the page set's pages scored): 25 finished, 0 failed. The session driving the first 6 runs (`current` × 5, `pymupdf4llm` on SWT) ended after they finished; the other 19 were started afterwards under the same protocol commit. No run was repeated.
- Seconds per page and peak MB per method (range over the five PDFs; times include interpreter, JVM and Node start-up, so the 6- and 7-page sheets read slowest per page):
  - current: 0.009–0.413 s/page, peak 55.0 MB
  - pymupdf4llm: 0.249–0.576 s/page, peak 404.0 MB
  - pdfjs: 0.008–0.086 s/page, peak 136.9 MB
  - markitdown: 0.08–0.26 s/page, peak 108.6 MB
  - opendataloader: 0.03–0.345 s/page, peak 248.1 MB
- Comparison cmp-2026-10-30_046c: the five fast methods, schedule seed 20261031, 33 duels (30 + 3 hidden repeats, at least 11 apart). Judging not started.

## 2026-10-30 — deviation 1 and the first comparison, again

- Before any vote, the first duel showed a plain-text method's output as one run-on paragraph (Markdown joins single line breaks). Fixed in the viewer for every method alike; PROTOCOL.md deviation 1, commit e07f5c9f.
- cmp-2026-10-30_046c (0 of 33 votes) set aside unjudged in `~/Documents/learnstation-parser-bench/set-aside/`.
- 25 benchmark runs again under e07f5c9f: 25 finished, 0 failed. Seconds per page and peak MB (range over the five PDFs):
  - current: 0.004–0.058 s/page, peak 61.9 MB
  - pymupdf4llm: 0.562–0.934 s/page, peak 388.5 MB
  - pdfjs: 0.007–0.096 s/page, peak 148.6 MB
  - markitdown: 0.074–0.213 s/page, peak 123.4 MB
  - opendataloader: 0.032–0.162 s/page, peak 314.8 MB
- The same methods on the same files took up to about twice as long or half as long as an hour earlier (pymupdf4llm 0.249–0.576 then); other load on the Mac is not controlled (§9). Costs are reported from these runs, the ones the comparison uses.
- Comparison cmp-2026-10-30_8825: the five fast methods, schedule seed 20261031, 33 duels. Judging not started.

## 2026-10-30 — first comparison judged (cmp-2026-10-30_8825)

- Judged by Abi in one sitting: 108 of 108 duels (33 in round 1, 75 in round 2, which ran to its cap because the top two intervals kept overlapping); 0 retracted; median decision 6.5 s; self-consistency 3 of 3 hidden repeats.
- After the first duels Abi noted that most outputs were unusable; "Both unusable" was the most common answer (per method: current 31 of 39 duels, pdfjs 48 of 64, opendataloader 33 of 63, pymupdf4llm 13 of 37, markitdown 9 of 13).
- Points (95% interval; Bonferroni lower bound, k = 4): pymupdf4llm 1231.2 (1142.8–1326.5; 1121.1), opendataloader 1100.6 (1046.0–1171.2; 1029.4), pdfjs 1002.5 (972.6–1040.2; 963.3), current 1000 (anchor), markitdown 967.5 (858.5–1077.0; 823.3).
- H1 holds for pymupdf4llm and opendataloader.
- Checks over the 24 pages (pages with a footer leak / title first / wrong symbols / broken-line % / invented-words %): current 23 / 0.33 / 132 / 20.8 / 0.0; pdfjs 23 / 0.33 / 132 / 19.9 / 0.04; markitdown 23 / 0.67 / 132 / 21.8 / 4.0; opendataloader 4 / 0.78 / 132 / n/a / 1.0; pymupdf4llm 20 / 0.72 / 97 / 1.3 / 18.6 (its OCR, §9).

## 2026-10-31 — protocol deviation 2: paid methods, the second comparison

- Protocol commit 902a0e86 (deviation 2). From it on, benchmark runs need the bench unchanged since the protocol commit, and record `bench_tree` 4c2c20e148f0.
- Key file created by Abi (mode 0600). Environments: ai_vision and ai_vision_strong, Python 3.12.13, pymupdf 1.27.1.
- Models: ai_vision `gpt-4.1-mini` (answered as `gpt-4.1-mini-2025-04-14`); ai_vision_strong `gpt-6.1-sol` (answered as `gpt-6.1-sol`; no dated snapshot listed), chosen with Abi for its capability per dollar ("near-Astra performance for complex work at a lower cost"). Temperature: 0 for gpt-4.1-mini; not sent for gpt-6.1-sol, which rejects 0 (`unsupported_value`) — its first probe failed on that and is kept.
- Prices read 2026-10-31 from the OpenAI pricing page (Standard, per 1M input / output tokens): gpt-4.1-mini $0.40 / $1.60; gpt-6.1-sol $2.00 / $10.00.
- Probes (one synthetic page each, no course content): gpt-4.1-mini 3,292 in / 23 out, $0.0014; gpt-6.1-sol 2,445 in / 26 out, no reasoning tokens, $0.0052; no code fence in either.
- Estimated cost of the 24 benchmark pages: ai_vision $0.07 (at most $0.67), ai_vision_strong $0.36 (at most $4.06). Confirmed by Abi.

## 2026-10-31 — paid benchmark runs and the second comparison

- Protocol commit 902a0e86; disk 18 GB free. All seven methods ready.
- 10 paid benchmark runs (ai_vision, ai_vision_strong × 5 PDFs; only the page set's 24 pages sent per method; no warm-up): 10 finished, 0 failed, no retries needed.
- Actual cost at the recorded prices (an upper bound, not the invoice): ai_vision $0.0373 (71,058 input / 5,575 output tokens, all answered as `gpt-4.1-mini-2025-04-14`); ai_vision_strong $0.1727 (52,800 / 6,707, of which 522 reasoning, answered as `gpt-6.1-sol`). Together $0.21, below the $0.43 estimate. Probes on 2026-10-31 added $0.0066.
- Seconds per page over the pages sent (network-bound, not comparable with the local methods): ai_vision 1.8–4.3, ai_vision_strong 2.8–5.7. Peak memory of the runner 80–98 MB.
- Comparison cmp-2026-10-31_04de: builds on cmp-2026-10-30_8825; new entrants ai_vision and ai_vision_strong; schedule seed 20261101, 37 duels (11 pairs × 3 + 4 hidden repeats). Judging not started.
- cmp-2026-10-30_8825 unchanged: compare.json, votes.jsonl and results.json have the same sha256 as before the runs, and its results.json recomputes byte-identically. Its round-1-only line (k = 4): pymupdf4llm 1007.6, opendataloader 928.5, pdfjs 922.6, markitdown 798.8 — only pymupdf4llm passes.

## 2026-10-31 — second comparison judged (cmp-2026-10-31_04de)

- Judged by Abi: 112 of 112 duels (37 in round 1, 75 in round 2, which ran to its cap because the pooled top two — both paid methods — kept overlapping); 0 retracted; median decision 10.6 s (12.5 / 12.3 / 8.8 s over the three thirds; 2 decisions under 3 s, both in the last third); self-consistency 4 of 4 hidden repeats.
- One scale, pooled with cmp-2026-10-30_8825 (220 votes; its files unchanged, same sha256). Points (95% interval; Bonferroni lower bound, k = 6): ai_vision_strong 1421.6 (1321.8–1539.3; 1289.8), ai_vision 1350.1 (1264.3–1454.0; 1234.8), pymupdf4llm 1262.2 (1180.4–1362.5; 1156.3), opendataloader 1108.7 (1046.0–1176.1; 1033.5), pdfjs 1004.2 (970.0–1040.7; 961.0), current 1000 (anchor), markitdown 947.4 (827.0–1040.7; 776.9).
- H1 holds (pooled, k = 6) for ai_vision_strong, ai_vision, pymupdf4llm and opendataloader. The two paid methods' intervals overlap each other, so their order is not settled.
- Round-1-only sensitivity (70 votes over both comparisons, k = 6): ai_vision 1273.5, ai_vision_strong 1179.2 and pymupdf4llm 1007.6 above 1000; opendataloader 892.5 not.
- "Both unusable" per paid method: ai_vision_strong 17 of 67 duels, ai_vision 16 of 85 (current 32 of 46).
- Checks over the 24 pages (pages with a footer leak / title first / wrong symbols / broken-line % / invented-words %): ai_vision 8 / 0.67 / 0 / 12.0 / 5.7; ai_vision_strong 18 / 0.67 / 0 / 17.5 / 13.2. Both transcribe what is printed, footers included, since the prompt says "add nothing" and does not say "leave out"; no wrong symbols at all.

## 2026-10-31 — notes after the Plan 3a final review

- All numbers of both comparisons reproduce exactly from the raw votes at HEAD (both results.json byte-identical; schedules and round-2 batches replayed; an independent Bradley–Terry fit matches every point to 0.1).
- **Which H1 verdict the thesis reads.** Deviation 2 says both "the thesis reports the pooled one" (H1 bullet) and "the first comparison's verdict stays primary for the five fast methods" (threats). Reading used: for the five fast methods, the first comparison (k = 4) is primary; for the paid methods, the pooled comparison (k = 6). Both readings agree for every fast method (pymupdf4llm and opendataloader pass, pdfjs and markitdown fail under k = 4 and k = 6). opendataloader fails the round-1-only line under both (928.5 at k = 4, 892.5 at k = 6); its pass rests on round-2 duels. The protocol wording is corrected in the next deviation.
- Corrections to the entry above: the probes cost $0.0065 together ($0.001354 + $0.00515), not $0.0066. The pricing page was opened at `https://platform.openai.com/docs/pricing`, which redirects to `https://developers.openai.com/api/docs/pricing`; the run records cite the latter. `gpt-6.1-sol` received the synthetic probe page twice (the first request was refused for temperature 0, HTTP 400, unbilled).

## 2026-10-31 — protocol deviation 3: heavy methods and the third comparison

- Protocol commit dca001d4 (deviation 3); bench tree 1be211d90c67. Abi confirmed the text in chat before the commit.
- Entrants-to-be: docling, marker, mineru (if each stays within 120 s/page over the pages given); did not run here: paddleocr (its install probe needed a 13 GB footprint on the 8 GB Mac and was stopped), paddleocr_vl (not tried, same stack; Abi's choice); not run: none other.
- Input: page set + 1 neighbour each side (60 pages instead of 221), chosen by Abi on 2026-10-31; the cut PDF holds only the given pages' objects (5700c38f).
- Third comparison planned: builds on cmp-2026-10-30_8825 and cmp-2026-10-31_04de; opponents ai_vision_strong, ai_vision, pymupdf4llm, current; seed 20261102; 50 duels if all 3 heavy methods finish their five runs (45 + 5 hidden repeats, at least 16 apart).
- Corrections to deviation 2 recorded in deviation 3 (which H1 is primary; pricing URL redirect; gpt-6.1-sol probe page sent twice). Correction to the 2026-10-31 paid-runs entry: the probes cost $0.0065 together, as already noted there.

## 2026-10-31 — heavy benchmark runs and the third comparison

- Protocol commit dca001d4 (deviation 3), bench tree 1be211d90c67; disk before 12 GB free, after 11 GB. Input: page set + 1 neighbour each side (60 pages given per method: 16, 15, 18, 6 and 5 across the five PDFs).
- Benchmark runs (3 methods × 5 PDFs, warm-up first), 18:58–19:11 UTC: 15 finished, 0 failed; did not run here: none of the three (paddleocr and paddleocr_vl were not run, deviation 3). Re-runs: none.
- Seconds per page and peak MB (range over the five PDFs; start-up included; over the pages given):
  - docling: 1.50–2.94 s/page, peak 1226–1909 MB, warm-up 12.0–15.6 s, model folder 505.5 MB
  - marker: 1.43–5.79 s/page, peak 905–2975 MB (its helper servers included), warm-up 22.2–38.6 s, model folder 1721.0 MB
  - mineru: 1.17–3.73 s/page, peak 1173–1871 MB, warm-up 10.3–12.6 s, model folder 853.8 → 853.9 MB after its first run (no download in any timed run)
  - no run reported `models_downloaded_in_timed_run`.
- Model folders cleared for disk: none.
- Comparison cmp-2026-10-31_0f86: builds on cmp-2026-10-30_8825 and cmp-2026-10-31_04de (unchanged: all six file hashes as before; both results.json recompute byte-identically). New entrants docling, marker, mineru; opponents ai_vision_strong, ai_vision, pymupdf4llm, current. 45 round-1 duels (15 pairs × 3) + 5 hidden repeats = 50, schedule seed 20261102. Correction to deviation 3: compare.json holds the full schedule, not a separate digest field; the sha256 of its schedule is dee5c66225f8f4b7fa2f50adf0e7b6cc500b370bc2fe523224608f279d0b5fac, the digest pinned in b0fbb66d. Judging not started.

## 2026-10-31 — third comparison judged (cmp-2026-10-31_0f86)

- Judged by Abi: 50 of 50 duels, all in round 1 (45 + 5 hidden repeats); 0 retracted; median decision 9.9 s; self-consistency 4 of 5 hidden repeats. Votes digest 0f8edf4fee5c….
- Round 2 did not run: the pooled top two (ai_vision_strong, ai_vision) are not a pair this comparison schedules (deviation 3's rule).
- One scale, pooled with cmp-2026-10-30_8825 and cmp-2026-10-31_04de (270 votes; both earlier comparisons' six files unchanged, same sha256). Points (95% interval; Bonferroni lower bound, k = 9): ai_vision_strong 1440.1 (1359.4–1543.5; 1325.6), ai_vision 1365.9 (1282.3–1456.6; 1259.9), pymupdf4llm 1251.4 (1178.9–1334.0; 1152.2), mineru 1208.9 (1106.2–1311.2; 1070.1), marker 1134.7 (1018.4–1249.4; 967.0), docling 1121.3 (1015.6–1234.3; 964.3), opendataloader 1104.9 (1048.4–1164.5; 1029.6), pdfjs 1003.1 (969.5–1037.1; 960.5), current 1000 (anchor), markitdown 947.6 (839.9–1032.9; 793.3).
- H1 holds (pooled, k = 9) for ai_vision_strong, ai_vision, pymupdf4llm, mineru and opendataloader; not for marker or docling (their lower bounds are under 1000). Among the heavy methods, the verdict for the thesis is this pooled one (deviation 3).
- Round-1-only sensitivity (120 votes over all three comparisons, k = 9): ai_vision 1307.1, ai_vision_strong 1266.6, mineru 1058.8 and pymupdf4llm 1026.9 above 1000; marker 956.1, docling 947.5, opendataloader 919.5 not.
- Each heavy method met 19–22 duels; its interval is therefore wider than the earlier methods'. Outcomes per heavy method (wins / losses / same / both unusable): mineru 5 / 5 / 2 / 7, marker 1 / 6 / 2 / 10, docling 3 / 9 / 0 / 10. "Both unusable" in this comparison: 22 of 50 votes.
- Checks over the 24 pages (pages with a footer leak / title first / wrong symbols / broken-line % / invented-words %): docling 14 / 0.67 / 139 / 4.2 / 7.1; marker 1 / 0.78 / 62 / n/a (no line pairs to measure) / 7.6; mineru 0 / 0.78 / 56 / 21.4 / 18.2. Invented words include HTML tag names (deviation 3, threats).

## 2026-10-31 — notes after the Plan 3b final review

- Nothing found changes the third comparison: its votes, schedule, pooling and H1 numbers match the records.
- **ONNX Runtime telemetry (correction to deviation 3, "Telemetry and network").** mineru's environment includes onnxruntime 1.31.1, whose built-in usage telemetry to Microsoft was not switched off (`ORT_DISABLE_TELEMETRY` was not set). During mineru's install probe and its five benchmark runs it wrote a device id and a local event queue into mineru's model folder (`home/Library/Application Support/Microsoft/DeveloperTools/.onnxruntime/`). The two events still queued hold device and environment metadata only (macOS, arm64, Mac model, memory size, processor count, session ids, the device id); no document content and no file names. Whether earlier events were sent is not known. "No benchmark data leaves the Mac" still holds; "usage reporting off" did not hold for mineru. The switch is set for every heavy method from commit 212ac5a7 on (bench code changed after the protocol commit, so any further benchmark run needs a new deviation first).
- **Peak memory of the heavy methods is a lower bound.** Peak MB is the resident memory (RSS) of the runner and its processes. On Apple Silicon, memory that docling, marker and mineru allocate for the GPU (MPS/Metal) is very likely not counted in RSS, so their peak MB understate their real footprint and are not directly comparable with the CPU-only methods.
- **marker's time includes stopping its servers** at the end of each run (SIGTERM, a grace of up to 5 s per server, then SIGKILL); usually a fraction of a second.
- **Model-folder size.** marker's server logs and ONNX Runtime's files (above) are written into the model folders, so they count in `model_cache_mb` and in the check for a download during a timed run. No run reported such a download; mineru's folder grew 0.1 MB after its first run.
- **Display wording.** Deviation 3 says the HTML conversion never touches "plain text, code and maths". More exactly: an output that holds no HTML tags, comments or entities is never changed; in one that does, entities are decoded (`&amp;` shows as `&`) and comments removed; fenced code, inline code and $-maths are protected, indented code blocks are not. For the stored outputs of current, pdfjs and markitdown the conversion changed 0 pages (checked when the conversion was built).

## 2026-11-01 — PaddleOCR-VL: explore, deviation 4, benchmark runs and the fourth comparison

- Explore (before deviation 4, 2026-10-31/11-01): `paddleocr_vl_hf` (transformers on MPS) was stopped at its 600 s limit for five pages; `paddleocr_vl_mlx` (4-bit, MLX) read the nine non-benchmark pages (SWT 10–12, DBS 50–52, SR 55–57) at 9–16 s/page. Every method was run on those nine pages for Abi to look at in Compare, names shown; AI vision on them cost $0.068 (both models). The PaddleOCR PP-StructureV3 and `paddleocr_vl_hf` environments and models were deleted for disk space with Abi's OK.
- Protocol commit 65f8dc4c (deviation 4), bench tree 337724191d25. Abi confirmed the text in chat before the commit.
- Benchmark runs (`paddleocr_vl_mlx` × 5 PDFs, warm-up first, page set + 1 neighbour), 11:46–12:06 UTC: 5 finished, 0 failed, none past the limit. 14.1–26.8 s/page (start-up included, over the pages given), peak 388–1132 MB resident (a lower bound; GPU memory not counted), model folder 682 MB. Free disk after: 3 GB.
- Comparison cmp-2026-11-01_0010: builds on cmp-2026-10-30_8825, cmp-2026-10-31_04de and cmp-2026-10-31_0f86 (all nine files unchanged; all three results.json recompute byte-identically). New entrant paddleocr_vl_mlx; opponents ai_vision_strong, ai_vision, pymupdf4llm, current. 12 round-1 duels + 1 hidden repeat = 13, seed 20261103, schedule sha256 be326763… as pinned. Judging not started.

## 2026-11-01 — fourth comparison judged (cmp-2026-11-01_0010)

- Judged by Abi: 13 of 13 duels, all in round 1 (12 + 1 hidden repeat); 0 retracted; median decision 10.8 s; self-consistency 1 of 1. Votes digest 4397d0caab57…. Round 2 did not run (the pooled top two are not a scheduled pair).
- One scale, pooled over all four comparisons (283 votes; the three earlier comparisons' nine files unchanged). Points (95% interval; Bonferroni lower bound, k = 10): ai_vision_strong 1452.2 (1367.5–1562.7; 1331.4), ai_vision 1375.5 (1292.0–1473.3; 1251.3), pymupdf4llm 1262.7 (1187.1–1352.2; 1164.1), mineru 1216.0, marker 1141.4, docling 1127.9, opendataloader 1111.6, **paddleocr_vl_mlx 1037.4 (866.5–1172.0; 770.1)**, pdfjs 1006.7, current 1000 (anchor), markitdown 952.1. The earlier methods' points move slightly because the fit is joint; their verdicts stay as recorded (deviations 2, 3).
- H1 does not hold for paddleocr_vl_mlx (its lower bound is far under 1000); the H1 set is unchanged: ai_vision_strong, ai_vision, pymupdf4llm, mineru, opendataloader. Round-1-only sensitivity: paddleocr_vl_mlx 728.3, not above 1000.
- paddleocr_vl_mlx against each opponent (win / loss / same / both unusable): ai_vision_strong 0/3/0/0, ai_vision 0/2/0/1, pymupdf4llm 0/3/0/1, current 1/0/0/2.
- Checks over the 24 pages (pages with a footer leak / title first / wrong symbols / broken-line % / invented-words %): paddleocr_vl_mlx 21 / 0.67 / 0 / 17.6 / 16.5; 0 headings and 0 tables (plain text, as deviation 4 says), 97 list items. Seconds per page over the judged runs 18.0, peak 1132 MB (lower bound).
