# Figure manifest

Provenance for every thesis figure: which source files it was derived from, and the
claim it supports. Lets you answer "where is this in the code?" without re-reading the
repository, and tells you which figures went stale when code changes.

**Pinned revision: `dfc20df6`** (main, 2026-11-06; `\thesisCommit` in `../metadata.tex`).
Every figure was redrawn and every path:line below re-read at the earlier pin `2b8b1f7b` on
2026-11-05, then re-verified at `dfc20df6` on 2026-11-06 (F1, F3, F8, F11, F12, F16, F17
redrawn; moved line numbers updated everywhere). Facts true at the earlier pin `0be0081` (2026-08-18) and fixed since appear
only where the change is the figure's point (F16, F17, F15), labelled with their dates.
Production facts (flags, hosts) are as of the 2026-10-30 deploy; prod may run images
older than the pin.

Diagrams are PlantUML (`src/*.puml`). Data charts are standalone pgfplots documents
(`src/*.tex`) that read `data/<name>.csv`; they are drawn at print width (at most 418 pt)
so their type sizes are the printed sizes.

Regenerate with `make figures` (PDF) or `make all` (PDF + SVG); sources in `src/`,
shared style in `src/_style.iuml`. `make check` renders every source and fails on errors;
`make fonts` checks that every PDF embeds its fonts.

**Rules every figure follows**

- Grayscale-safe: no distinction relies on hue alone.
- **Print-size budget.** The page is 418 × 596 pt (`\textwidth` × `\textheight`). For labels
  to print at 6.5 pt or more, the render at 80 dpi (`pdftoppm -r 80`) must stay within
  about **715 × 865 px** (`\thesisfigure`) or **715 × 935 px** (`\thesisfigurepage`).
- At most two short notes per figure; arguments go in the caption and the prose.
- No glyphs outside WinAnsi (`→`, `≤`, `≥` vanish in the PDF); write `->`, "at most".
- Fonts are embedded: PlantUML's PDF only references Helvetica, so the build rewrites
  every PDF once with Ghostscript (`brew install ghostscript`). `make fonts` fails if any
  figure PDF has a font that is not embedded.

**Do not cite `README.md` or `docs/` for any architectural claim** — cite code. Runbooks
are cited only for server facts the repository cannot hold (F7).

| # | Figure | Type | Chapter | Source | Derived from (@dfc20df6) | Flags |
|---|---|---|---|---|---|---|
| F1 | The transformation (route: text / figure / no-text pages) | Concept | 1 · Introduction | `f1-transformation.puml` | upload_service.py:13; unified_orchestrator.py:167-177, :717-748, :919, :1171, :1289; page_blocks.py:201-219; orchestrator.py:158; synthesis.py:51, :163; embeddings.py:29; persist.py:4-5, :299-343; v4_reader.py:80, :129-146, :175, :254; v4_rehearsal_service.py:410; v4_spaces_service.py:865-899 | **hero** |
| F2 | Positioning: structure vs pedagogy | Concept | not wired since the chapter 2 rewrite (2026-11-10); the comparison table carries the positioning | `f2-positioning.puml` | This system's capabilities and dependency set ({markitdown,llamaparse,mineru,odl}_service.py) — NOT a citation search | _needs your sources_ |
| F3 | Four groundedness regimes | Concept | 2 · Background | `f3-grounded-vs-ungrounded.puml` | v4_reader_service.py:611-622 (data, not instructions :619-621), :683-684 (fence defused), :705-728, :820-860; luna/context.py:13-33; luna/prompts.py:28; luna/validate.py:85-91, :135-147; luna/session_service.py:115-117; v4_spaces_service.py:865-899; search_service.py:111-141; tutor.py:124-151, :193-196, :302-311, :314-349, :344-347; retrieval.py:30-32; App.tsx:657-664 |  |
| F4 | Actors and goals | UML use case | Appendix B | `f4-use-case.puml` | auth.tsx:9; auth_middleware.py:260-263; v4_reader.py:80-279; v4_luna.py:94-218; v4_spaces.py:59-180; v4_landing.py:33 + v4_landing_service.py:1-19; launch_control.py:24, :42; admin.py; App.tsx:384-395, :558-630 |  |
| F5 | Conceptual domain model | UML class | Appendix B | `f5-domain-model.puml` | auth.tsx:9; v4_spaces_service.py:47-110; v4_personal.py:1-35; v4_reader_service.py:341-371; luna/store.py:203-227; compare F9 and F9b |  |
| F6 | Component view (as deployed) | UML component | 3 · Learnstation at a Glance | `f6-components.puml` | docker-compose.prod.yml:16-198; nginx.conf:26-29; main.py:267-279, :382-384, :418-440; database.py:150-190; arq_worker.py:83-103, :329-359; upload_service.py:58, :327; orchestrator.py:92-138, :386-397 |  |
| F7 | Deployment topology | UML deployment | Appendix C | `f7-deployment.puml` | docker-compose.prod.yml:7-198; Dockerfile.frontend:59; deploy/server/heartbeat/*; deploy/server/offsite-backup/*; server facts: docs/runbooks/{deploy-main-to-prod,domain-dns-and-email,monitoring-and-backups}.md, docs/ops/2026-10-30-learnstation-app-move.md | _prod facts from runbooks_ |
| F8 | Ingestion pipeline (each page routed once: no_text < 25 chars or figure < 150 chars with figures >= 5% -> vision; else text, 8 per call) | UML activity + partitions | 4 · Content | `f8-pipeline.puml` | upload.py:146-266, :571-763; v4_spaces.py:180-214; materials_service.py:90-146; v4_spaces_service.py:477-536; unified_orchestrator.py:842-1499 (routes :919, applied :1080); page_blocks.py:201-219; synthesis.py:63-80, :155-192, :288 | **hero** |
| F9 | Core schema, part 1 (19 of 79 tables) | ER | Appendix B | `f9-er-core.puml` | supabase/migrations/ (139 files); v4_spaces_service.py:47-110; v4_personal.py:1-35. Count: distinct `CREATE TABLE` names (79), one of them `learning_events_default`, the default partition of the event table; 78 without it |  |
| F9b | Core schema, part 2 (17 of 79 tables) | ER | Appendix B | `f9b-er-learning.puml` | supabase/migrations/ (139 files); luna/store.py:203-227; review/card_factory.py:61-87; luna/session_service.py:157 | _new; `fig:er-learning`_ |
| F10 | Layered idempotency | Concept / layered | Appendix C | `f10-idempotency.puml` | cache.py:191-231, :554-556; upload.py:195-206, :633-700; file_parse_service.py:827-841, :1148; upload_service.py:105-120; materials_service.py:90-120; repos.py:44-100, :483-512; migration 20260730000000:50; unified_orchestrator.py:68, :717-748, :862-877, :994-998; job_locks.py:33-54; poster.py:116-128; reconcile.py:45-49, :95-131; arq_worker.py:67 | **hero** |
| F11 | LLM provider failover (402 billing, 401 key, 404 model disable until restart; 429 backs off; other, incl. 403, no penalty) | UML activity | Appendix C | `f11-provider-chain.puml` | orchestrator.py:239-397, :620-742, :1002-1169 (401 :1126-1135, :1148-1155), :1483-1617; llm_client.py:34-79; vision.py:117-209 (401/402/404 permanent :177-195) |  |
| F12 | Grounded course tutor (Home ask) | UML sequence | Appendix B | `f12-tutor-sequence.puml` | HomeScreen.tsx:408-418; v4_spaces.py:101-112; v4_spaces_service.py:865-914; search_service.py:111-141; retrieval.py:30-32, :84-87; cache.py:397-440; tutor.py:71-90 (markers defused :83; untrusted.py), :272-297, :302-311, :314-407; prompts.py:548-550 |  |
| F13 | Batch review — corrective, not gating | UML activity | not wired since the chapter 6 re-cut (2026-11-10); the text of the "No Human Gate" section carries the claim | `f13-batch-review.puml` | BatchReviewPage.tsx:21-35; parser/repos.py:156-216; lectureService.ts:650-655; App.tsx:779-786; spaces/data/liveRepository.ts:256-269 |  |
| F14 | Trust boundaries | Concept | Appendix B | `f14-trust-boundaries.puml` | migrations 20260719020000:23-28, 20261011000000:1-10, 20261024000000:25-42, 20261024010000:19, 20261024020000:43-83, 20260713000000:27-58, 20260710040000:72-104, 20261025000000:10-11, :92-123; core/database.py:4-8; analytics_service.py:95-114; v4_reader.py:42-46; tests/db/test_rls_policies.py:50-75 |  |
| F15 | Privilege-escalation hardening | UML state | Appendix B | `f15-security-arc.puml` | migrations 20260122202809:4-30, :134-136 · 20260502000003:1-20 · 20260601000000:21-37 · 20260615000800:9-32 · 20260620000000:3-15, :41-55 · 20260621000000:3-16 · 20260721000001:58-76 · 20261011000000:4-10, :50-60 · 20261024000000:12-20, :46-61 · 20261024010000:3-19 · 20261024020000:3-6, :43-83 · 20261101015412:1-35, :64-73, :166-168 |  |
| F16 | Source attribution | Concept | Appendix B | `f16-citation-gap.puml` | tutor.py:124-151; v4_spaces_service.py:886-899; HomeScreen.tsx:408-418; luna/validate.py:85-91, :135-147; reader/luna/MoveMark.tsx; v4_reader_service.py:403; LectureView.tsx:43; InlineLecturePlayer.tsx:831-833; LectureChat.tsx (imported only by its test); App.tsx:197-212, :645-664 | _found, then fixed_ |
| F17 | Built versus delivered (12 flags, 4 on in prod, 8 with a UI side) | Concept | Appendix B (from 3 · Learnstation at a Glance, November 2026) | `f17-flag-reality.puml` | config.py:106-213 (12 flags; FEATURE_LANDING_PEOPLE removed by PR #175); docker-compose.prod.yml:143-154; App.tsx:197-212, :384-395; main.py:258; v4_spaces_service.py:865-899; review/mastery.py:28-31; history: 6c95041b, 28c81ca3 | _found, then fixed_ |
| F18 | Evaluation setup | Concept | not wired since the restructuring (2026-11-10) | `f18-evaluation-setup.puml` | backend/eval/{golden_sets,pipeline,scorer,judge,run_eval,retrieval_grid,verify_anchors,deck_lab,quiz_answer_check}.py; eval/data/golden_set.json; eval/parser_bench/{blinding,schedule,ranking,checks,results}.py; docs/thesis/experiments/parser-benchmark/PROTOCOL.md:3, :11, LAB_LOG.md:263-268 |  |
| F19 | Results — retrieval on the real corpus | Data | not wired since the restructuring (2026-11-10); measured at an old revision, see chapter 6 threats | `f19-results.puml` | thesis/results/20260917T214528Z/grid_results.{md,csv} (run at a696be1-dirty); retrieval.py:30-32 | **hero** · _course column predates b66a97c6: re-run at the pin_ |
| F20 | Text extraction benchmark | Data (dot + interval) | 4 · Content | `f20-parser-benchmark.tex` + `data/f20-parser-benchmark.csv` | comparison cmp-2026-11-01_0010 `results.json` (pooled fit, 283 votes, outside git); docs/thesis/experiments/parser-benchmark/PROTOCOL.md:11, :133, :199-200; LAB_LOG.md:263-268; backend/eval/parser_bench/ranking.py | **hero** |
| F21 | Owner's view above the floor (persona arm I, 27 members in one week) | Screenshot | 5 · Closing the Loop | `f21-door-above-floor.png` (no source file; real `LandingScreen` fed the study payload, navigation bar cropped) | docs/thesis/experiments/persona-study/ (arm I payload, run at 2e146f51, commit a342dea9); src/features/spaces/landing/LandingScreen.tsx; backend/eval/persona_study.py | _screen is after the pin (PR #181)_ |
| F22 | Owner's view below the floor (persona arm G, four members) | Screenshot | 5 · Closing the Loop | `f22-door-below-floor.png` (as F21) | docs/thesis/experiments/persona-study/ (arm G payload); backend/services/insights/space_engine.py:25 (`MIN_READERS = 5`) | _screen is after the pin (PR #181)_ |
| F23 | The feedback loop in five stages | Concept | 5 · Closing the Loop | `f23-loop.tex` | schemas/learning_events.py (`EVENT_REGISTRY`, 17 types); repositories/event_repo.py:64-96; insights/sources/space.py:35-42; insights/space_engine.py:25; insights/detectors.py; insights/landing_map.py |  |
| F24 | Life of one quiz question during a parse | Concept | 6 · Trusting the Machine | `f24-question-lifecycle.tex` | parser/synthesis.py:52, :63, :75-80, `_map_deck_quiz`; parser/quiz_grounding.py:25, :44; parser/quiz_validator.py (`_normalize_answer_index`); PR #166 (5ea0aeff); f25dd41c |  |
| F25 | Routing: which of 1,593 pages go to vision (old rule 12, rule at the pin 87; six numbered cases) | Data (scatter) | 4 · Content | `f25-routing.tex` + `data/f25-routing.csv` | page_blocks.py:201-219 (`route_page`, `figure_share`) at dfc20df6, run on the 25 Deck Lab decks 2026-11-10; raw_chars from the 2026-11-05 routing study (signals outside git, quote no text); backend/eval/routing_check.py; docs/thesis/experiments/routing-labels-2026-11-05.csv | **hero** |
| F27 | The reading view on page 3 of a sample deck: (a) Page, (b) Explain, seven numbered labels | Screenshot | 3 · Learnstation at a Glance | `f27-reading-view.tex` over `f27-reading-view-page.png` and `f27-reading-view-explain.png` | production, 15 November 2026, deck from `src/sample-deck.tex` (our own text, no course material) uploaded to the author's Library; cropped only (pane address bar, screenshot toolbar); LessonFacesScreen.tsx; v4_reader_service.py (Explain, Ask) | _screen is after the pin_ |
