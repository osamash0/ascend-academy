# Phase 10 — Evaluation and polish (2026-10-31 to 2026-11-04)

*Written 2026-11-04 from PRs #164 to #171, their descriptions, `docs/thesis/experiments/parser-benchmark/` (PROTOCOL.md, LAB_LOG.md, pages.json) as merged in #168, `docs/ops/2026-10-31-browser-review.md`, and branch listings. "Abi" in the repo's docs is Abdullah.*

## Summary

At the start of the phase, v4 was live on `learnstation.app`, monitored and backed up, but with near-zero real usage. The phase had two strands. The first was a controlled evaluation for the thesis: a blind, pre-registered benchmark of PDF text extraction with ten methods, four judged comparisons and 283 votes (#168). The second was polish and hardening before inviting real students: one continuous reader from drop to Lesson (#164), Sentry limited to the EU (#165), an independent answer check for generated quiz questions (#166), and two fixes by the Codex agent (#167, #169). At the end of the phase, the benchmark showed that AI vision transcription and several layout-aware tools beat the current raw extraction. The production parser had not been changed on that basis yet. One PR (#170, Home turning into Luna's thread) was still open.

## Where the time went

| Area | Commits touching | Lines changed (share) |
|---|---|---|
| backend-parser | 51 | 35,798 (67%) |
| tests-backend | 47 | 11,372 (21%) |
| frontend-v4 | 11 | 2,787 (5%) |
| frontend-classic | 6 | 1,610 (3%) |
| thesis | 17 | 1,069 (2%) |
| docs, i18n, backend-other, database, e2e, luna, other | 21 | 843 (2%) |

84 non-merge commits on all refs, all under Abdullah's git name, on three active days: 65 on 10-31, 16 on 11-01 and 3 on 11-02. There are no commits on 11-03 or 11-04 before this file was written. Osama does not appear as a commit author.

- **Two thirds of the lines are the parser benchmark, not the production parser.** The most-touched files are all benchmark files: `backend/eval/parser_bench/tools.py`, `runners/`, `execute.py`, the viewer's `lib.ts`, and `LAB_LOG.md` (13 commits). [Inferred] "backend-parser" is the stats script's label for this path. #168 says it "changes no production code path".
- **The commit counts include history that was squashed.** #168 landed as "One squashed commit", and LAB_LOG commit ids "refer to the local development history that was squashed for this PR" [Confirmed: #168 body]. That history is on the local branch `claude/file-upload-workflow-e9126d`, which is not described here. [Inferred] Most of the 51 parser commits are on it.
- **Runner and tool files were fixed most** (`test_parser_bench_runners.py` 6, `tools.py` 5, `marker_runner.py` 4, `ai_vision_runner.py` 4). [Inferred] Installing and running heavy third-party extractors on an 8 GB Mac caused most of the friction. LAB_LOG records an empty-package install, a 13 GB footprint that was stopped, telemetry left on, and disk pressure down to 3 GB free.
- **Product work was small and targeted** (frontend-v4: 11 commits). [Inferred] After the large launch push of Phase 09, the remaining product work was bug fixes found on prod and design reviews.
- **Two PRs came from the Codex agent** (`codex/*` branches, #167 and #169). Their commits are recorded under Abdullah's git name, and their descriptions have no Claude Code footer. The other PRs say they were generated with Claude Code.

## Entries

### 2026-10-30 to 11-01 — Parser benchmark: protocol, runs and four blind comparisons (#168)
- **What happened:** A local benchmark package `backend/eval/parser_bench/` with a browser viewer (React/Vite, served on 127.0.0.1) for running extractors, judging blind duels and showing results. The protocol was frozen on 10-30 before any vote. Then four comparisons were judged by Abdullah (see "Thesis hints" for the method and results). It was merged as one squashed commit on 11-01.
- **Decision:** One human judge, blind, with hidden repeats and automatic checks as countermeasures. Every change to the method was recorded as a dated protocol deviation (four in total) before it took effect. Benchmark runs are refused if the bench code has drifted from the protocol commit. Run data with slide text is kept outside git.
- **Why:** The reading face and every learning feature start from the parsed text, and the current extraction shows wrong symbols, footer junk, wrong order, broken lines and no structure [Confirmed: spec `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md`, "Why"]. The spec says the results feed thesis chapter `06-evaluation.tex` [Confirmed].
- **Sources:** PR #168 (merge 73f114a9); `docs/thesis/experiments/parser-benchmark/PROTOCOL.md`, `LAB_LOG.md`, `pages.json`; `backend/eval/parser_bench/`.

### 2026-10-31 — Dropping a file and reading it is one reader (#164)
- **What happened:** On prod, Abdullah saw the reader flash black and jump back to page 1 after dropping a file. Three causes were found in a browser: `React.lazy` suspending once even when loaded, a route fade that remounted the screen when the temporary id became the run id, and the Lesson mounting twice at the handover. The fix uses preloadable screens, an in-place navigation, and a "curtain" (a still of the painted pages) that the Lesson lifts once it has painted the same page.
- **Decision:** One `handOver()` for both paths into the Lesson. The page is always in the URL.
- **Why:** "it flashed black then jumped back to page 1" [Confirmed: #164 body, quoting Abdullah].
- **Sources:** PR #164 (ee818433); `src/features/spaces/preloadable.tsx`, `components/reader/curtain.ts`, `earlyHandover.test.tsx`.

### 2026-10-31 — Sentry for browser, API and worker, EU only (#165)
- **What happened:** Sentry had been wired but could never report from prod: the browser DSN was not a build arg, and the Arq worker, where every parse runs, never started Sentry. Now `init_sentry` starts only when the DSN is in Sentry's EU region, both the API and the worker call it, and the privacy policy names Sentry with what a report does and does not contain.
- **Decision:** Enforce "stored in the EU" in code: any non-EU DSN leaves Sentry off.
- **Why:** "We are about to invite real students, and we need to see what breaks for them." The EU check "keeps the policy's 'stored in the EU' true by construction" [Confirmed: #165 body].
- **Sources:** PR #165 (8d773e70); `backend/core/sentry.py`, `Dockerfile.frontend`, `docker-compose.prod.yml`.

### 2026-10-31 — An independent answer check for generated quiz questions (#166, LS-115)
- **What happened:** A question on prod had two defensible answers, but it passed grounding because the existing check is lexical ("lexical support, not entailment"). Now, for each question, a second model answers from the cited slide alone, without seeing the key. A disagreement leads to one repair, and if the dispute remains, the question is dropped. Measured on a probe of 16 hand-written pairs plus the LS-115 case: 0 of 16 good paraphrased keys dropped (lexical enforcement dropped 14 of 16), 0 of 16 hallucinated keys kept, and LS-115 disputed 5 of 5 times.
- **Decision:** The checker is not the author: it runs on a different provider (Groq's reasoning model). If the check fails or errors, the question keeps today's behaviour, "so an outage never empties a quiz".
- **Why:** When `gpt-4o-mini` did the checking, "it shared the author's misreading and passed LS-115 twice". "A key that marks a careful reader wrong does more harm than a missing question" [Confirmed: #166 body].
- **Sources:** PR #166 (5ea0aeff); `ground_deck_quiz`, `SYNTHESIS_QUIZ_VERIFY_PROMPT`, `backend/eval/quiz_answer_check.py`.

### 2026-10-31 — LlamaParse tried on one deck, not adopted
- **What happened:** In answer to a question about LlamaIndex, LlamaParse was tried on one deck that is excluded from the benchmark. The existing adapter mis-numbered pages, because LlamaParse's default page separator also appears as a rule above slide footers (35 documents for 27 pages). The package is deprecated, and the output kept footers on most pages and invented a table for an image. The branch `claude/llama-index-exploration-c8bc30` holds no commits of its own; it points at `main` after #167.
- **Decision:** Do not adopt the LlamaIndex framework. Do not add LlamaParse to the benchmark (that would need a protocol deviation).
- **Why:** Luna's retrieval is already hand-tailored, and extra dependencies hurt the dependency scan [Confirmed only in a per-machine Claude memory note, not in the repo]. [Inferred] Using an excluded deck kept the blind benchmark uncontaminated.
- **Sources:** branch name only; no repo record. The adapter `backend/services/llamaparse_service.py` exists and was not changed.

### 2026-10-31 — Browser review and fixes by the Codex agent (#167)
- **What happened:** Codex reviewed the live site in a browser and recorded the findings in `docs/ops/2026-10-31-browser-review.md`. Sign-in was hidden on phones. Demo tabs had no keyboard navigation. Ask showed a schema label ("key block"). Practice ignored the chosen language. Rehearsals failed because the model cited pages as `p1`. A personal Space's virtual id was written into `llm_calls.course_id`. The PR fixed these and bumped pypdf to 6.21.4 to clear the dependency scan.
- **Decision:** Normalise only exact single-page citations and still reject ranges and out-of-range pages. Label original-language practice fallbacks.
- **Why:** [Confirmed: #167 body and the browser-review doc.]
- **Sources:** PR #167 (ae1a6eaa; commits f1de5341, 597a1eba, 4504c40b); `docs/ops/2026-10-31-browser-review.md`.

### 2026-10-31 — First-run tour without a separate tour (LS-038), local only
- **What happened:** Demo work on a new account's first minute: `/v4/tour-lab-home`, example cards that open into their pages, and Home showing what a Space is. A design doc for LS-038 was committed on `feat/ls-038-first-run`.
- **Decision:** none recorded as final. A commit notes that Abdullah "likes the cards opening into their pages" (6e610b6e).
- **Why:** [Inferred] It follows the library-and-spaces spec, which replaced a separate tour.
- **Sources:** local branches `claude/onboarding-tour-demo` (01cf16dd, 6194220b), `feat/ls-038-first-run` (9d4e3623). Not merged.

### 2026-11-01 — Profile trust fields and XP rewards checked on the server (#169)
- **What happened:** A Codex PR. Server-owned profile values are now protected on insert as well as update. Quiz XP is granted only for a server-checked answer, once per question. Completion, review and badge claims need a known activity and a fixed reward. Some client-writable paths became read-only or backend-only. The PR includes a migration and 42 database regression tests.
- **Decision:** Completion stays self-reported, but bounded to 20 XP per visible Lesson.
- **Why:** [Confirmed: #169 body.] [Inferred] The client could previously set values the server should own. The PR describes the fix only at this level, and so does this entry.
- **Sources:** PR #169 (56b16998; commit da1ac297).

### 2026-11-01 — Home turns into Luna's thread (#170, open)
- **What happened:** Behind `FEATURE_LUNA_SESSIONS`, a question on Home turns Home into the reader's Luna session in place, using shared-element motion, with no backend change. It includes a dev-only design lab and a research note on generative UI.
- **Decision:** Build on Luna's existing session blocks "rather than json-render, A2UI or an app bridge".
- **Why:** [Confirmed: #170 body and `docs/research/2026-10-31-generative-ui-for-luna.md` (on the PR branch).] Not merged at the time of writing.
- **Sources:** PR #170 (open), branch `claude/home-chat-transition-animation-46f782`.

### 2026-11-02 — A calmer Spaces hub (#171)
- **What happened:** After a review on 10-31 ("it feels very dark"; the spacing between Enter, New Space and Your Spaces "is not good"), light pages on the hub are shown as dimmed grey paper instead of inverted. Enter became the one solid white pill, sort and New Space moved onto the "Your Spaces" line, and the hero is anchored from the bottom. This reversed the inversion from #137.
- **Decision:** One white pill per view. The larger "moods" work (Dark, Dynamic, Light) waits on design decisions. It exists only as a local snapshot commit with large demo images on `claude/spaces-ui-ux-review-325a81` (258af064), marked "do not push".
- **Why:** "Inversion turned a learner's own white slides black, so nothing on the hub gave off light" [Confirmed: #171 body].
- **Sources:** PR #171 (2b8b1f7b).

## Challenges

**[Confirmed]**
- **The judging load.** The first two comparisons ran to the 75-duel cap of round 2 because the top two intervals kept overlapping (108 and 112 duels). Deviation 3 limited the heavy methods to chosen opponents "to reduce the judging load" (PROTOCOL.md).
- **Most outputs were unusable.** "Both unusable" was the most common answer in the first comparison (for example `current` in 31 of 39 duels; LAB_LOG 2026-10-30).
- **Hardware limits.** On the 8 GB Mac, PaddleOCR PP-StructureV3 needed a 13 GB footprint and was stopped. `paddleocr_vl_hf` hit its 600 s limit for five pages. Free disk fell to 3 GB (LAB_LOG 2026-10-31, 11-01).
- **Tooling surprises.** `pymupdf4llm` installed an empty placeholder package and exited 0. It also ran Tesseract OCR on its own, which raised its invented-word share. ONNX Runtime telemetry was not switched off for mineru, which is recorded as a correction (LAB_LOG).
- **Viewer rendering bias found before any vote.** Plain-text output showed as one paragraph, so the first comparison was set aside unjudged and all runs were redone (deviation 1).
- **Prod bugs found only on prod.** The reader flash (#164), the ambiguous quiz question (#166), and the cost attribution for personal Spaces (#167).
- **Sentry could never have reported from prod** before #165, which means no prod errors were visible during Phase 09.

**[Inferred]**
- **One judge who built the product.** PROTOCOL.md §9 names this threat. The fast methods were also "less blind" in later comparisons, because their outputs had been seen with names (deviation 2).
- **Deployment state is unclear.** CLAUDE.md lists #159 to #161 as merged but not deployed. Whether #164 to #169 reached prod is not recorded in the repo. #169 describes a careful rollout order.

## Open questions

- Will the benchmark result change the production parser, for example to `pymupdf4llm` or AI vision, given the cost per page? Nothing in the repo decides this yet.
- How was `ai_vision_strong`'s model (recorded as `gpt-6.1-sol`) chosen beyond "capability per dollar" and the quote in LAB_LOG? Does the thesis need the selection rule written out?
- Were #164 to #169 deployed, and when?
- Should the LlamaParse trial be recorded in the repo (for example in LAB_LOG as an excluded, non-benchmark note) so the thesis can cite it?
- What problem did #169 address in practice? Was it found by an audit, by Codex's review, or by the Phase 09 audit (local-only)?
- Is #170 meant to merge before the thesis is submitted?

## Thesis hints

- **Evaluation (main material): the parser benchmark.**
  - *Question and hypotheses* (PROTOCOL.md §1): which extraction gives the text a learner would rather learn from, and at what cost? H1: at least one layout-aware tool is rated above `current`, with its 95% interval entirely above (Bonferroni over k challengers). H2 is descriptive (footer leaks, title first). Cost is reported, not tested.
  - *Test set* (§3, `pages.json`): 24 pages from five PDFs of one university, in two languages, all born-digital. Seed 20261030. Types: lists 8, diagram 5, dense text 5, layout 3, table/formula 3. The deck seen with names during design was excluded.
  - *Method* (§5–§7): blind pairwise duels on the page image with two unnamed outputs, both rendered by the app's own renderer. The question on screen: "Which would you rather learn from?" Answers: Left, Right, Same, Both unusable. Votes are appended with fsync, and undo is a retraction. Round 1: every pair 3 times on 3 page types, plus about 10% hidden repeats with swapped sides. Round 2 (stopping rule fixed in advance) adds duels while the top two intervals overlap, up to 75. Bradley–Terry (MM algorithm) with a small prior. Points = 1000 + 400·log10(strength/strength of `current`). 1,000-sample bootstrap for intervals. `results.json` is always recomputed from the raw votes.
  - *Comparisons* (LAB_LOG): (1) five fast methods, 108 duels, self-consistency 3/3. (2) two AI vision methods added, 112 duels, 4/4. (3) docling, marker, mineru against chosen opponents, 50 duels, 4/5. (4) PaddleOCR-VL through MLX, 13 duels, 1/1. All are pooled on one scale: 283 votes.
  - *Final pooled points* (k = 10): ai_vision_strong 1452 (95% interval 1368–1563), ai_vision 1376, pymupdf4llm 1263, mineru 1216, marker 1141, docling 1128, opendataloader 1112, paddleocr_vl_mlx 1037, pdfjs 1007, current 1000, markitdown 952. H1 holds for ai_vision_strong, ai_vision, pymupdf4llm, mineru and opendataloader, but not for marker, docling, paddleocr_vl_mlx, pdfjs or markitdown. A round-1-only sensitivity line is reported for each comparison (opendataloader's pass rests on round-2 duels).
  - *Checks (H2)*: opendataloader leaked a footer on 4 of 24 pages, compared with 23 for `current`. The AI vision methods had no wrong symbols but still transcribed footers ("add nothing" does not say "leave out").
  - *Cost*: `current` takes about 0.004–0.06 s/page. The heavy local methods take about 1.2–5.8 s/page with more than 1 GB resident memory, which is a lower bound because GPU memory is not counted. PaddleOCR-VL takes 14–27 s/page. AI vision costs $0.21 for both paid methods on the 24 pages (an upper bound at recorded prices), and is network-bound at 1.8–5.7 s/page.
  - *Threats* (§9 and the deviations): one judge who also built the product, a small and narrow sample with no scans, dependent votes (intervals likely too narrow), the checks' reference favouring PyMuPDF-based methods, OCR inside some tools, different PyMuPDF versions for `current` and `pymupdf4llm`, and uncontrolled machine load (timings varied by up to 2x within an hour).
  - *Process quality*: the protocol was committed before any tool ran, there are four dated deviations, byte-identical recomputation of every `results.json`, and an independent Bradley–Terry fit matching to 0.1 point (LAB_LOG 2026-10-31 notes).
- **Evaluation (smaller):** #166's probe table (lexical enforcement vs answer check) is a compact before/after measurement of quiz quality.
- **Design:** "The checker is not the author" (#166). Fail-open to today's behaviour on an outage. The EU-only Sentry check that keeps a privacy claim true in code (#165).
- **Implementation:** The curtain/handover technique for a seamless reader (#164). Server-side validation of XP rewards (#169).
- **Methodology / process:** Work split between AI agents: Claude Code for the benchmark and most PRs, and Codex for a live browser review (#167) and an integrity fix (#169). The human role was judging, design decisions and approvals (recorded as "Abi confirmed the text in chat before the commit" in LAB_LOG).

## In short

Phase 10 is mostly evaluation. A pre-registered, blind, single-judge benchmark of ten PDF extraction methods (283 votes over four comparisons) found that AI vision transcription, `pymupdf4llm`, `mineru` and `opendataloader` beat the current raw PyMuPDF text, with costs and threats recorded in `docs/thesis/experiments/parser-benchmark/`. Product work was polish before inviting students: one seamless reader, EU-only Sentry, an independent quiz answer check, Codex's browser-review and XP-integrity fixes, and a calmer hub. Whether the benchmark changes the production parser is still open.
