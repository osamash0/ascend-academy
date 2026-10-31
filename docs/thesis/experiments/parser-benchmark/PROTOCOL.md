# Parser benchmark: protocol

**Frozen** 2026-10-30, in the commit that adds this file. Every benchmark run and every comparison records that commit (`protocol_commit`). A later change is added under "Deviations" with its date; the text above it stays as it is.

**Design:** `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md`. **Code:** `backend/eval/parser_bench/` at this commit. Benchmark runs are refused while that code, this file or `pages.json` has uncommitted changes.

## 1. Research question and hypotheses

**RQ.** Which extraction approach turns real lecture PDFs into the text a learner would rather learn from, and at what cost in time and memory on commodity hardware?

- **H1.** At least one layout-aware tool is rated above our current extraction. Current is the rating anchor (1000). Because k challengers are tested against it, the decision uses a Bonferroni-corrected one-sided bound: a challenger supports H1 when the (2.5/k)th percentile of its bootstrap points lies above 1000 (k = the number of challengers in the comparison, 4 in the first; decided on unrounded values). The intervals shown stay the plain 95% intervals, so a whole bar right of 1000 is necessary but not sufficient.
- **H2 (descriptive).** Layout-aware tools leak fewer footers and put the title first more often than current. These are reported as counts per tool, with no significance test claimed.
- **Cost** is reported descriptively as seconds per page and peak memory. There is no hypothesis about it.

## 2. Contenders

The first comparison judges the five fast methods (design decision 9). The heavy methods (`docling`, `marker`, `mineru`, `paddleocr`) and `ai_vision` join in a second comparison against the same opponents. Their exact versions, licences and settings are added as a dated deviation before their first benchmark run.

| id | What runs | Exact version | Licence | Settings that differ from the default |
|---|---|---|---|---|
| `current` | standalone copy of production's `page.get_text("text")`, in the backend environment | PyMuPDF 1.27.1 | Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License (package metadata) | none |
| `pymupdf4llm` | `to_markdown(page_chunks=True)` | pymupdf4llm 1.28.2 on PyMuPDF 1.28.2 (with pymupdf-layout 1.28.2); Tesseract 5.5.2 | Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License (package metadata) | none; its default OCR stays on (§9) |
| `pdfjs` | `getTextContent`, a newline on `hasEOL` | pdfjs-dist 5.4.296, Node v22.23.2 | Apache-2.0 | `isEvalSupported: false`, `verbosity: 0` |
| `markitdown` | one page at a time (pages split with pypdf) | markitdown 0.1.6, pypdf 6.21.4 | MIT | page by page by nature |
| `opendataloader` | Markdown output, own page separator | opendataloader-pdf 2.4.1, openjdk 22.0.1 (2024-04-16) | Apache-2.0 | `quiet`, `markdown_page_separator`, `include_header_footer=False` passed explicitly (its default) |

Each method runs in its own environment (`uv`, Python 3.12, under `~/.cache/learnstation-parser-bench/envs/`). `current` runs in the backend `.venv`, and `pdfjs` runs on Node with this repository's `pdfjs-dist`. Every run records its exact package list in `run.json` (`environment`). No method is tuned.

## 3. Test set

| Source | File | SHA-256 | Pages |
|---|---|---|---|
| SWT | `Course SWT/Slides/2.pdf` (Versionsmanagement) | e03bd4a555d806a6ab25bb4ec8687ffd4edc9b9d6929d9ef2ec4d63bb37e7b17 | 41 |
| DBS | `03 DBS Normalization.pdf` | 87d6c686323cf447fc388768ce904ca11e686e2e6c6ca0802913827771a80131 | 82 |
| SR | ` 03__SR_Prozesse_v07_27.04.2025.pdf` (leading space) | 2f7a3b33186f2352cf6998dc183006dec310434f17f055f5172a28a960afacc5 | 85 |
| Sheets | `Course SWT/ueb01.pdf` + `ueb02.pdf` | 72ee94da0e1e60c13c20226677e85b9cbc3ccb190e5d97e0749c4a47e054f6fa / 4001f24d87015e499f5c30bb77f1cb9863594dcc9773293b7f799d1394749a97 | 6 + 7 |

File names are relative to `~/Downloads`. The PDFs are never committed.

- **Excluded.** *Softwaretechnik 1* is excluded. Abi saw its outputs with tool names in the design demo on 2026-10-30. It stays available for Explore.
- **Selection rule.** Per source, 4 pages are chosen on purpose, each with a page type and a reason. 2 more are drawn at random from the rest with seed **20261030**, which was fixed in the implementation plan before the draw. The drawn pages were then tagged with a type by looking at them.
- **Page types:** `layout` (boxes, columns), `lists`, `table_formula`, `diagram` and `dense_text`.
- **The set** is `pages.json` in this folder. It is machine-readable, and benchmark runs and comparisons read it.

| Key | File | Page | Type | How | Reason |
|---|---|---|---|---|---|
| swt-p3 | `Course SWT/Slides/2.pdf` | 3 | lists | chosen | title plus four top-level symbol-font bullets, each with italic red-square sub-bullets, two levels deep, no figure |
| swt-p21 | `Course SWT/Slides/2.pdf` | 21 | layout | chosen | three coloured header boxes across the top with grey arrows under them, symbol-font bullets with italic sub-bullets on the left |
| swt-p26 | `Course SWT/Slides/2.pdf` | 26 | diagram | chosen | sequence diagram with three lifelines, arrows and small note boxes beside a bullet list with two levels |
| swt-p17 | `Course SWT/Slides/2.pdf` | 17 | diagram | chosen | shaded repository diagram with callout bubbles and a highlighted box, interleaved with bullets and short monospace command lines |
| swt-p16 | `Course SWT/Slides/2.pdf` | 16 | diagram | random | random draw, seed 20261030 |
| swt-p39 | `Course SWT/Slides/2.pdf` | 39 | diagram | random | random draw, seed 20261030 |
| dbs-p7 | `03 DBS Normalization.pdf` | 7 | table_formula | chosen | one wide data table of eleven columns with bracket annotations above and below, almost no running text |
| dbs-p32 | `03 DBS Normalization.pdf` | 32 | table_formula | chosen | definitions with a column of aligned functional-dependency formulas using arrows and set notation, two heading levels |
| dbs-p73 | `03 DBS Normalization.pdf` | 73 | dense_text | chosen | four levels of nested bullets with formulas and subscripts, no figure, text fills the page |
| dbs-p35 | `03 DBS Normalization.pdf` | 35 | lists | chosen | numbered list of four dependencies, then bulleted calculation steps with set notation |
| dbs-p30 | `03 DBS Normalization.pdf` | 30 | lists | random | random draw, seed 20261030 |
| dbs-p74 | `03 DBS Normalization.pdf` | 74 | dense_text | random | random draw, seed 20261030 |
| sr-p22 | ` 03__SR_Prozesse_v07_27.04.2025.pdf` | 22 | diagram | chosen | large flowchart of coloured boxes, a diamond decision and many arrows, no running text |
| sr-p45 | ` 03__SR_Prozesse_v07_27.04.2025.pdf` | 45 | layout | chosen | two framed algorithm boxes side by side with a two-column process header each, bold captions underneath |
| sr-p39 | ` 03__SR_Prozesse_v07_27.04.2025.pdf` | 39 | table_formula | chosen | stepped timeline chart of five bars above a small black-header table of three columns and five rows |
| sr-p18 | ` 03__SR_Prozesse_v07_27.04.2025.pdf` | 18 | layout | chosen | two text columns with bold headings, a framed yellow code box spanning the bottom |
| sr-p31 | ` 03__SR_Prozesse_v07_27.04.2025.pdf` | 31 | lists | random | random draw, seed 20261030 |
| sr-p74 | ` 03__SR_Prozesse_v07_27.04.2025.pdf` | 74 | lists | random | random draw, seed 20261030 |
| sheets1-p1 | `Course SWT/ueb01.pdf` | 1 | dense_text | chosen | letterhead block, long justified paragraphs and a long bullet list, two footnotes |
| sheets1-p3 | `Course SWT/ueb01.pdf` | 3 | lists | chosen | numbered section headings with a bulleted list of questions under each, inline links and footnotes |
| sheets2-p4 | `Course SWT/ueb02.pdf` | 4 | lists | chosen | heading, bulleted list with a numbered sub-list of linked items, bullets with bold hint line, footnotes |
| sheets2-p6 | `Course SWT/ueb02.pdf` | 6 | dense_text | chosen | several monospace code blocks between bold sub-headings, then a numbered list of tasks with bold lead-ins |
| sheets1-p6 | `Course SWT/ueb01.pdf` | 6 | dense_text | random | random draw, seed 20261030 |
| sheets2-p7 | `Course SWT/ueb02.pdf` | 7 | lists | random | random draw, seed 20261030 |

Page types over the 24 pages: lists 8, diagram 5, dense_text 5, layout 3, table_formula 3.

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
- **H1** as in §1 (Bonferroni over k challengers; `results.json` records `h1_k` and each challenger's corrected lower bound `h1_lower`).
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
  - the machine (arm64, 8 CPU cores, 8 GB RAM, macOS 26.6.2, from run.json `machine`).
- **Failures.** A failed run is kept with its reason and stage. A re-run is a new run, and the comparison uses each method's newest finished run under this protocol.

## 9. Threats to validity

- **One judge, who also built the product.** Countermeasures: hidden names, random sides, hidden repeats for self-consistency, decision times, and automatic checks independent of the judge.
- **Deliberate page choice.** 2 of every 6 pages are random, and the reasons for the others are recorded in §3.
- **Small and narrow sample.** The sample is 24 pages from one university, in two languages, all born-digital, with no scans. PaddleOCR's strength (scans) is not exercised.
- **Check reference.** The PyMuPDF text layer favours `current` and `pymupdf4llm` on checks 6 and 7.
- **Library versions.** `pymupdf4llm` runs on PyMuPDF 1.28.2 while `current` runs on production's 1.27.1. A difference between the two can partly be a PyMuPDF version effect.
- **OCR inside pymupdf4llm.** Its default calls Tesseract (5.5.2) on pages it judges image-like. On *Softwaretechnik 1* this measurably raised its invented-word share on OCR'd pages (lab log, 2026-10-30). Its numbers depend on the local Tesseract, which every run records.
- **Symbol double count.** A `§` alone on a line counts both as a wrong symbol and as a lonely bullet.
- **German compound hyphens.** Normalisation joins a hyphen at a line end. A compound broken at a real hyphen ("Software-" / "Entwicklung") becomes one token where the line breaks there and two where it does not, which shows as dropped plus invented words.
- **Footer formats differ by source.** Per PDF, the footer rule finds:
  - `swt`: 41 pages, 3 boilerplate lines, a printed number on 39 pages, footer parts per page median 3, max 3.
  - `dbs`: 82 pages, 2 boilerplate lines, a printed number on 3 pages, footer parts per page median 2, max 6.
  - `sr`: 85 pages, 2 boilerplate lines, a printed number on 85 pages, footer parts per page median 2, max 4.
  - `sheets` `ueb01.pdf`: 6 pages, 7 boilerplate lines, a printed number on 6 pages, footer parts per page median 7, max 7.
  - `sheets` `ueb02.pdf`: 7 pages, 7 boilerplate lines, a printed number on 7 pages, footer parts per page median 7, max 7.
  - DBS prints its number as `Slide N`, which is not a digits-only line, so its printed number counts on only 3 of 82 pages.
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
- **Footer over-count.** A heading or name line made only of boilerplate words (deck title, lecturer) on a page that also has a real footer is read as a footer line, so `footer_leaks` and `footer_token_share` can over-count there.
- **Optional stopping in round 2.** Whether round 2 runs, and how far, depends on round-1 results. The intervals are not adjusted for this; the rule and its cap (75) were fixed in advance (§6).
- **Dependent votes.** The bootstrap resamples votes as if independent, but duels share pages and pairs and come from one judge; the intervals are likely somewhat too narrow.

## Deviations

**1. 2026-10-30, before any vote: every line break is shown.** On the first duel's screen, Abi saw that a method writing plain text line by line was shown as one run-on paragraph: Markdown joins lines that are not separated by a blank line. Nothing normalised plain text to Markdown, contrary to §9 ("Outputs are normalised to Markdown first"). From this commit on, the viewer shows every line break a method wrote, inside paragraphs, for every method alike (CSS `white-space: pre-line` on rendered paragraphs). The outputs themselves are unchanged. §9's "normalised to Markdown first" is replaced by: outputs are rendered as Markdown with their own line breaks kept. Consequences:
- The comparison created under 8f70b7ef (`cmp-2026-10-30_046c`, 0 of 33 votes) was set aside unjudged: moved out of the comparisons folder, kept as a record.
- All 25 benchmark runs were made again under this commit, and the first comparison was created again with the same seed (20261031).
- The 25 runs under 8f70b7ef stay as records; they are not used.

**2. 2026-10-31, before any paid run and before the second comparison: two paid methods, the second comparison, and a stricter run gate.** The text above stays; where this deviation and the text above differ, this deviation applies from this commit on.

*Two paid methods.*
- **`ai_vision`** sends each page image to `gpt-4.1-mini`. The model id is production's vision model: `OPENAI_VISION_MODEL` defaults to `OPENAI_MODEL`, whose launch setting is `gpt-4.1-mini` (`.env.example`). It was taken from there; the production environment itself was not read. The API answered the probe as `gpt-4.1-mini-2025-04-14`.
- **`ai_vision_strong`** sends the same image with the same prompt to `gpt-6.1-sol`, chosen with Abi on 2026-10-31 from the account's live model list because OpenAI describes it as "near-Astra performance for complex work at a lower cost": among the current flagships it gives the most capability per dollar (Abi preferred it to `gpt-6-astra`, about $5.50 for the 24 pages). The API answered the probe as `gpt-6.1-sol`; OpenAI lists no dated snapshot for it, so the recorded id is the model id itself.
- **What runs.** Each in its own `uv` environment, Python 3.12.13, with `pymupdf==1.27.1` (production's version) to render the pages and Python's own `urllib` for the requests. No OpenAI SDK: it reads `OPENAI_*` and proxy variables from the environment and retries on its own; here the endpoint is fixed (`https://api.openai.com/v1/chat/completions`), proxies are ignored, and every attempt is recorded. Licence: OpenAI's API terms (a hosted model; no local weights).
- **Settings, exactly.** Each page the run scores is rendered at zoom 2 as a PNG and sent as a data URL (image `detail` not set, the API default). One request per page, one user message: the prompt, then the image. The prompt, word for word: "Transcribe this page to Markdown. Add nothing: no introduction, no comment, no code fence around the answer." Temperature 0 for `gpt-4.1-mini`. For `gpt-6.1-sol` no temperature is sent, because the model rejects 0 (API error `unsupported_value`: only its default, 1, is supported); it runs at its default, and `run.json` says "model default". `max_completion_tokens` 16384. A request times out after 120 s. HTTP 429 (except `insufficient_quota`), 500, 502, 503, 504, timeouts and lost connections are retried, 4 attempts in all, waiting the `Retry-After` header (at most 30 s) or 2, 4, 8 s; every attempt is recorded per page. A page that still fails, or answers empty, fails the run; the run keeps what was paid for. A truncated answer (`finish_reason` "length") is kept and its usage record says so. The probe outputs were not wrapped in a code fence; the prompt was not changed.
- **The key** is read only from `~/.config/learnstation-parser-bench/openai_key` (mode 0600). It is never printed, logged or stored; the runner gets its path.
- **Cost.** Each run asks for an explicit OK showing its page count and estimated cost (`--cost-ok` on the command line; a confirm step on the webpage; the server refuses without it). Prices (Standard tier, per 1M input / output tokens), read on 2026-10-31 from `https://platform.openai.com/docs/pricing`: `gpt-4.1-mini` $0.40 / $1.60; `gpt-6.1-sol` $2.00 / $10.00. The estimate uses 3,300 input and 1,000 output tokens per page for `gpt-4.1-mini` and 2,500 / 1,000 for `gpt-6.1-sol` (input from each probe, rounded up to the next 100; the probe of `gpt-6.1-sol` used no reasoning tokens); "at most" assumes every page writes 16384 tokens. Each run records the API's usage per page, the model id it answered with (`response.model`), the request time, and the cost at the recorded price (cached input at the full price, so an upper bound; not the invoice). Estimated for the 24 benchmark pages: `gpt-4.1-mini` $0.07 (at most $0.67), `gpt-6.1-sol` $0.36 (at most $4.06).

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
- `gpt-6.1-sol` runs at its default temperature (1), so its output varies more between runs than `gpt-4.1-mini`'s at 0. It runs once.
- A paid run stopped before its runner could write its record (killed after a 5 s grace) records `usage_lost` and no cost; the OpenAI usage page is then the record. A page whose 2xx answer could not be read is counted as billed with unknown usage, and the cost is marked a lower bound.
- **The prior and new methods.** A method with no real duels yet tracks the mean of its opponents through the virtual draws, about 1058 points in the pooled field, so it could pass H1 on the prior alone. It cannot after round 1, where each new method has 18 duels of its own.
- **Which H1 is primary.** The first comparison's verdict (k = 4) stays the primary result for the five fast methods. The pooled verdict (k = 6) re-uses its votes, so it is the combined scale, not an independent confirmation; the old methods' points move with the new votes because the fit is joint. On the first comparison's round-1 duels alone, only `pymupdf4llm` passes (opendataloader's corrected bound 928.5 at k = 4, seed 20261031).
- **Less blind for the fast methods.** Abi has seen the five fast methods' outputs on all 24 pages with names since the first comparison finished, so a duel between a new and an old method may be recognisable from the old side; everything is hidden again while the second comparison is judged, and the first comparison's results stay visible.

**3. 2026-10-31, before any heavy benchmark run and before the third comparison: the heavy methods, their time limit, and a third comparison against chosen opponents.** The text above stays; where this deviation and the text above differ, this deviation applies from this commit on.

*The heavy methods.* Each runs in its own `uv` environment, Python 3.12.13. Its exact pins are resolved with `--exclude-newer 2026-10-31` (as PyPI stood that day). It counts as installed only after its module imports and a probe run on a one-page synthetic PDF (no course content) gives back text. Every run records its exact package list.

| id | What runs | Exact version | Licence of the code | Model weights (size; licence) | Device | Settings that differ from the default |
|---|---|---|---|---|---|---|
| `docling` | `DocumentConverter().convert()`, the default PDF pipeline; Markdown per page with `export_to_markdown(page_no=n)`. Its OCR is docling's own automatic choice: RapidOCR with the torch backend, because ocrmac, onnxruntime and easyocr are not installed | docling 2.145.0 (docling-core 2.105.0, docling-ibm-models 4.0.4, torch 2.15.0, transformers 5.22.1, rapidocr 3.10.0) | MIT (docling, docling-core, docling-ibm-models); Apache-2.0 (rapidocr) | `docling-project/docling-layout-heron` (card: Apache-2.0) and `docling-project/docling-models` (card: CDLA-Permissive-2.0 and Apache-2.0); 506 MB. RapidOCR's own OCR models ship inside the rapidocr package in the method's environment, not in the model folder | MPS | none |
| `marker` | `PdfConverter` on its defaults; LLM enhancement off (`use_llm` false, its default); marker's own mode for the device (`fast` on MPS) | marker-pdf 2.1.0, surya-ocr 0.23.0, torch 2.15.0, transformers 5.22.1; llama.cpp `llama-server` version 0.8.0-dev (build 12017, commit 5047748f1; release b12017, its sha256 checked against GitHub's digest) | Apache-2.0 (marker, surya); MIT (llama.cpp) | `datalab-to/surya_layout2` and `datalab-to/surya-ocr-2.5-gguf` (card: "openrail"; marker's README: a modified AI Pubs Open Rail-M licence, free for research, personal use and startups under $5M), and the OCR-error checkpoint `ocr_error_detection/2025_02_18` from datalab's own storage (the same licence, per the README); 1.7 GB | MPS; its VLM through llama.cpp on Metal | `paginate_output` on, so the output is split by page (the spec's "output split by page") |
| `mineru` | `mineru.parser.parse(tier="basic")`; each page of the middle JSON rendered by MinerU's own Markdown renderer; the page index is `page_idx`, as in the content list | mineru 4.1.3 (torch 2.15.0, transformers 5.22.1, onnxruntime 1.31.1; mineru-llama-cpp 0.2.0, MIT, a required dependency that tier `basic` does not use) | MinerU Open Source License: Apache-2.0 with additional conditions (a separate commercial licence is needed once the user and its affiliates pass 100 million monthly active users or USD 20 million monthly revenue; an online service built on MinerU must say publicly that it uses MinerU; the licence ends by itself if either is broken) | `opendatalab/MinerU-4_models_torch` (card: Apache-2.0); 854 MB | MinerU's automatic choice (MPS; small-model backend torch) | tier `basic` instead of its default `standard`: the spec names the `pipeline` backend, and MinerU 4 replaced its backends with tiers; `basic` is the model pipeline without a VLM, while `standard` adds a VLM, and MinerU's README lists 16 GB as the least memory for it with the PyTorch and llama.cpp engines it recommends on Apple Silicon. Weights load on one thread (`HF_DEACTIVATE_ASYNC_LOAD=1`, transformers' own switch): threaded loading deadlocked on this Mac while loading the layout model. Each run records this as `weight_loading` |
| `paddleocr` | `PPStructureV3().predict()` on its defaults; `markdown_texts` per page. **Did not run here** (below) | paddleocr 3.7.0, paddlex 3.7.2, paddlepaddle 3.3.1 | Apache-2.0 | 13 PaddleX models, fetched from Hugging Face by the stopped install probe (`PaddlePaddle/PP-DocLayout_plus-L`, `PP-DocBlockLayout`, `PP-OCRv5_server_det`, `PP-OCRv5_server_rec`, `PP-LCNet_x1_0_doc_ori`, `PP-LCNet_x1_0_textline_ori`, `PP-LCNet_x1_0_table_cls`, `UVDoc`, `PP-FormulaNet_plus-L`, `SLANet_plus`, `SLANeXt_wired`, `RT-DETR-L_wired_table_cell_det`, `RT-DETR-L_wireless_table_cell_det`); 1.7 GB; Apache-2.0 on every card | CPU (PaddlePaddle has no MPS backend) | none |
| `paddleocr_vl` | `PaddleOCRVL().predict()` on its defaults; `markdown_texts` per page. **Did not run here** (below) | as `paddleocr` | Apache-2.0 | `PaddlePaddle/PaddleOCR-VL-1.6` (paddleocr 3.7.0's default pipeline version; card: Apache-2.0); not downloaded | CPU | none |

- **Where the models live.** Under `~/.cache/learnstation-parser-bench/models/<method>/`: every cache variable the libraries read (`HF_HOME`, `TORCH_HOME`, `XDG_CACHE_HOME`, `MODELSCOPE_CACHE`, `PADDLE_PDX_CACHE_HOME`, `MINERU_HOME`, `MODEL_CACHE_DIR`, `EASYOCR_MODULE_PATH`) points there, and so does `HOME` itself (`<method>/home`). The user's own caches were checked after the installs only, on 2026-10-31; the listing from before them was lost. `~/.cache`, `~/Library/Caches` and `~` hold nothing from these methods. `~/.cache/huggingface` holds docling's two model repositories, dated 2026-10-30, from earlier work before these installs; nothing in it changed on 2026-10-31.
- **Telemetry and network.** `HF_HUB_DISABLE_TELEMETRY`, `DO_NOT_TRACK` and `MINERU_TELEMETRY_DISABLED` are 1 for every heavy runner. Models are downloaded at install: docling's, marker's and MinerU's from Hugging Face, marker's OCR-error checkpoint from datalab's own storage, and PaddleOCR's from Hugging Face through PaddleX. llama.cpp was downloaded once from its GitHub release. No benchmark data leaves the Mac.
- **Model downloads in a run.** Each run records the size of its model folder and whether it grew during the timed run (`models_downloaded_in_timed_run`).
- **marker's helper servers.** surya starts helper servers (layout, OCR-error, and the VLM through `llama-server`). Each marker run starts its own and stops them at its end; a run never attaches to another run's server (surya's server registry points into the run's own temporary folder). Each marker run therefore pays its own server start-up, and its peak memory includes the servers. Reason: in the first live runs, the install probe left two servers alive, and later runs attached to them.
- **Processes.** After every heavy run, its processes are stopped: the runner's process group, every process seen under it, and any process whose working folder is in the run's temporary folder. The install probe goes through the same path.
- **PaddleOCR on this Mac.** The Mac has 8 GB of memory. `paddleocr`'s install probe (one synthetic page) grew to a 13 GB memory footprint, with 13.7 of 14 GB swap in use and about 2 minutes of CPU time in 13 minutes. It was stopped by hand on 2026-10-31 and is not installed; its environment and the 1.7 GB of models it fetched stay on disk, unused. `paddleocr_vl` (the same PaddlePaddle CPU stack plus a 0.9B vision-language model) was not tried, by Abi's choice. Both are recorded as *did not run here: needs more than 8 GB of memory*, and neither is an entrant.
- **PaddleOCR-VL.** The spec says "PaddleOCR-VL is also tried". It is a separate method, `paddleocr_vl`, not a replacement for PP-StructureV3 (`paddleocr`): one 0.9B vision-language model against a pipeline of small models. Outcome: not installed and not run (above); not an entrant.
- **Not run.** `paddleocr_vl` (not tried; above). `paddleocr` did not finish installing (above). `docling`, `marker` and `mineru` are installed and passed their probes.

*The time limit.* The spec: "A variant slower than 120 s/page on the M1 is recorded as *did not run here*".
- **How it is measured.** As §8 measures cost: the timed run's wall-clock seconds over the pages the method is given, interpreter and model start-up included.
- **What happens.** A heavy method's timed run is stopped at 120 s × those pages, because past that point the verdict cannot change. The run is kept, failed, with `did_not_run_here: true`. The method is recorded as *did not run here*, gets no further benchmark runs, and is not an entrant.
- **The warm-up** is not held to the limit, because it may include a one-time download.
- **No separate measurement.** The limit is applied in every benchmark run instead of a separate measurement on SWT beforehand (Abi, 2026-10-31). During installation, one explore run each was made of the whole SWT deck (41 pages; only page 1, which is not in the page set, was stored, and no one looked at it): `docling` 1.808 s/page, peak 1616.7 MB (`2026-10-31_docling-2.145.0_3651`); `marker` 3.1 s/page, peak 2458.2 MB (`2026-10-31_marker-2.1.0_d3d3`). marker's run is invalid: it attached to the servers the install probe had left alive, so its time and memory leave out their start-up and their memory. Neither run is used for a verdict.

*Input.*
- Each heavy method receives only the page set's pages of each PDF and the 1 page on each side of each (60 pages instead of 221), cut from the file with PyMuPDF. The cut file holds only the given pages' objects: PyMuPDF's garbage collection drops the other pages' images, fonts and content (commit 5700c38f). As for every local method, a run fails if a page it was given is missing from its output (it is kept, failed, §8); here that counts the pages given, a neighbour page that is not scored included. Its own header and footer detection therefore sees only those pages. Its seconds per page and its time limit count the pages given (`seconds_per_page_basis`: "pages given"). The checks still read the whole file. Abi chose this on 2026-10-31 because whole documents, with a measurement pass before them, were projected at about 3 hours before any judging. The fast and paid methods keep what they had.

*Display (§5, §9), like deviation 1.* Since commits 2e499f6d and a18d9ae3, the viewer converts HTML in an output to Markdown before rendering, for every method alike: HTML tables become Markdown tables, `<br>` a line break, `<sup>` and `<sub>` `^x` and `_x`, block tags paragraphs, list items list lines, heading, bold, italic and code tags their Markdown marks, and any other tag its text. Plain text, code and maths are never touched. The outputs themselves are unchanged.

*The third comparison (design decision 9).*
- **Entrants.** The seven judged methods, with the runs their comparisons judged (by run id from `cmp-2026-10-31_04de`'s `compare.json`), plus the heavy methods that ran here, with their newest finished benchmark runs under this commit. `compare.json` records `builds_on: ["cmp-2026-10-30_8825", "cmp-2026-10-31_04de"]`, `new_entrants`, `opponents` and `provenance`.
- **Round 1, against chosen opponents** (Abi, 2026-10-31, to reduce the judging load). The new methods meet each other, and each meets `ai_vision_strong`, `ai_vision`, `pymupdf4llm` and `current`: the pooled top three after the second comparison, and the anchor. They do not meet `opendataloader`, `pdfjs` or `markitdown`. Each pair is judged 3 times on three page types, with round(r1 / 9) hidden repeats.
  - With n new methods: n(n−1)/2 + 4n pairs, so 13, 30, **50**, 73 or 100 duels for n = 1…5.
  - With the three heavy methods expected (`docling`, `marker`, `mineru`): 15 pairs × 3 = 45 + 5 = 50 duels, repeats at least 16 apart. If a method exceeds the time limit or its runs fail, the count follows the formula (30 for two, 13 for one).
  - The schedule seed is **20261102**, fixed in the implementation plan before any vote. The schedule's digest is recorded in `compare.json` when the comparison is created.
- **One scale.** Bradley–Terry is fitted over every counted vote of all three comparisons (the first two only read), with `current` = 1000 and the same prior; the bootstrap resamples the pooled votes 1,000 times, seeded with 20261102. The graph of duels is connected, because every new method meets `current` and the three other opponents.
- **H1.** Decided on the pooled fit with Bonferroni over all k = entrants − 1 challengers (k = 9 with the three heavy methods). The first comparison's verdict (k = 4) stays primary for the fast methods, and the second's pooled verdict (k = 6) for the paid methods; this pooled verdict is the one for the heavy methods. The round-1-only sensitivity line is computed as in deviation 2.
- **Round 2 (§6), restricted like round 1.** It runs only while the pooled top two overlap **and** their pair is one this comparison schedules (two new methods, or a new method and an opponent). If the two paid methods hold the top two, no round 2 runs, even when a heavy method overlaps a neighbour further down. Each batch gives 3 more duels to every adjacent top-4 pair that this comparison schedules; no hidden repeats; at most 75 extra duels. A round-2 duel against `opendataloader`, `pdfjs` or `markitdown` would be those pairs' first meeting, chosen after seeing round-1 results; the old pairs were settled under their own comparison's rule and cap.

*Corrections to deviation 2.*
- **Which H1 is primary.** Deviation 2 says in its H1 bullet that "the thesis reports the pooled one", and in its threats that the first comparison's verdict stays primary for the five fast methods. It applies as follows: for the five fast methods, the first comparison (k = 4) is primary; for the two paid methods, the second comparison's pooled verdict (k = 6). Both readings agree for every fast method.
- **The pricing page.** `https://platform.openai.com/docs/pricing` redirects to `https://developers.openai.com/api/docs/pricing`; the run records cite the latter.
- **The probe pages.** `gpt-6.1-sol` received the synthetic probe page twice, not once: the first request was refused for temperature 0 (HTTP 400, not billed).

*Threats (§9), added.*
- **Less blind than before.** Abi has seen all seven earlier methods' outputs on all 24 pages with names, so a duel of a heavy method against one of them may be recognisable from the old side. The heavy methods' own outputs stay hidden until this comparison finishes.
- **Restricted opponents.** The heavy methods' places relative to `opendataloader`, `pdfjs` and `markitdown` rest on the shared Bradley–Terry scale through the four common opponents, not on direct duels; a non-transitive preference there would go unseen. If a heavy method and one of those three were the overlapping top two, round 2 would not run.
- **Footer handling differs by design.** Several heavy methods classify page headers and footers and leave them out on purpose (marker states it removes them; Docling exports only the body by default; MinerU and PP-StructureV3 mark them as page furniture). Footer-leak counts therefore reflect design as well as reading quality. With the page subset, their cross-page header and footer detection sees only the pages given.
- **Hardware, sharper than §9.** PaddleOCR did not run here (memory). marker and MinerU run on MPS, and marker's VLM through llama.cpp on Metal; marker and MinerU choose their own mode or tier per device (marker's `fast` mode on MPS, not the `balanced` mode it uses on a GPU). With 8 GB of memory the Mac may swap; peak memory is recorded. Times are relative to this Mac.
- **Fresh releases.** marker-pdf 2.1.0 and mineru 4.1.3 were 1–2 days old when pinned; an early release can carry bugs that a later one fixes. The versions are recorded and fixed.
- **HTML in outputs, earlier comparisons.** In both earlier comparisons, inline HTML (`<br>`, `<sup>`, `<sub>`) in some `pymupdf4llm`, `opendataloader` and `ai_vision` outputs was shown as literal text. Those votes stand.
- **Checks and HTML.** `normalize.py` and the checks are unchanged (checks version 3), so pooling with the earlier comparisons stays valid. HTML tag names in an output count as invented words, and HTML tables are not counted as tables.
- **Default OCR inside the heavy methods.** As with `pymupdf4llm` (§9), a method may OCR pages it judges image-like; its invented-word share then reflects its OCR, not only the text layer.
- **The time limit includes start-up.** On the 6- and 7-page sheets, model loading weighs more per page than on the decks; with the page subset, the sheets give 6 and 5 pages.
