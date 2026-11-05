# Figure manifest

Provenance for every thesis figure: which source files it was derived from, and the
claim it supports. Lets you answer "where is this in the code?" without re-reading the
repository, and tells you which figures went stale when code changes.

**Pinned revision: `2b8b1f7b`** (main, 2026-11-02; `\thesisCommit` in `../metadata.tex`).
Every figure was redrawn and every path:line below re-read at that revision on
2026-11-05. Facts true at the earlier pin `0be0081` (2026-08-18) and fixed since appear
only where the change is the figure's point (F16, F17, F15), labelled with their dates.
Production facts (flags, hosts) are as of the 2026-10-30 deploy; prod may run images
older than the pin.

Regenerate with `make figures` (PDF) or `make all` (PDF + SVG); sources in `src/`,
shared style in `src/_style.iuml`. `make check` renders every source and fails on errors.

**Rules every figure follows**

- Grayscale-safe: no distinction relies on hue alone.
- **Print-size budget.** The page is 418 × 596 pt (`\textwidth` × `\textheight`). For labels
  to print at 6.5 pt or more, the render at 80 dpi (`pdftoppm -r 80`) must stay within
  about **715 × 865 px** (`\thesisfigure`) or **715 × 935 px** (`\thesisfigurepage`).
- At most two short notes per figure; arguments go in the caption and the prose.
- No glyphs outside WinAnsi (`→`, `≤`, `≥` vanish in the PDF); write `->`, "at most".
- **Known gap:** PlantUML's PDFs reference Helvetica without embedding it (`pdffonts`),
  so bold and italic only show where the viewer has the font. Embedding needs a
  Ghostscript pass, which is not installed yet.

**Do not cite `README.md` or `docs/` for any architectural claim** — cite code. Runbooks
are cited only for server facts the repository cannot hold (F7).

| # | Figure | Type | Chapter | Source | Derived from (@2b8b1f7b) | Flags |
|---|---|---|---|---|---|---|
| F1 | The transformation | Concept | 1 · Introduction | `f1-transformation.puml` | upload_service.py:13; unified_orchestrator.py:77, :166-176, :672-703, :1033-1037, :1123, :1241; orchestrator.py:158; synthesis.py:50, :154; embeddings.py:29; persist.py:4-5, :299-343; v4_reader.py:80, :129-146, :175, :254; v4_spaces_service.py:865-896 | **hero** |
| F2 | Positioning: structure vs pedagogy | Concept | 2 · Foundations | `f2-positioning.puml` | This system's capabilities and dependency set ({markitdown,llamaparse,mineru,odl}_service.py) — NOT a citation search | _needs your sources_ |
| F3 | Four groundedness regimes | Concept | 2 · Foundations | `f3-grounded-vs-ungrounded.puml` | v4_reader_service.py:605-613, :674-700, :770-810; luna/context.py:13-33; luna/validate.py:85-91, :135-147; luna/session_service.py:115-117; v4_spaces_service.py:865-896; search_service.py:111-141; tutor.py:117-144, :186-189, :295-304, :337-340; retrieval.py:30-32; App.tsx:657-664 |  |
| F4 | Actors and goals | UML use case | 3 · Requirements | `f4-use-case.puml` | auth.tsx:9; auth_middleware.py:260-263; v4_reader.py:80-279; v4_luna.py:94-218; v4_spaces.py:59-180; v4_landing.py:34 + v4_landing_service.py:1-17; launch_control.py:24, :42; admin.py; App.tsx:384-395, :558-630 |  |
| F5 | Conceptual domain model | UML class | 3 · Requirements | `f5-domain-model.puml` | auth.tsx:9; v4_spaces_service.py:47-110; v4_personal.py:1-35; v4_reader_service.py:335-365; luna/store.py:203-227; compare F9 and F9b |  |
| F6 | Component view (as deployed) | UML component | 4 · Design | `f6-components.puml` | docker-compose.prod.yml:15-197; nginx.conf:26-29; main.py:267-279, :379-381, :415-437; database.py:150-190; arq_worker.py:83-103, :329-359; upload_service.py:58, :327; orchestrator.py:92-138, :386-397 |  |
| F7 | Deployment topology | UML deployment | 4 · Design | `f7-deployment.puml` | docker-compose.prod.yml:6-197; Dockerfile.frontend:59; deploy/server/heartbeat/*; deploy/server/offsite-backup/*; server facts: docs/runbooks/{deploy-main-to-prod,domain-dns-and-email,monitoring-and-backups}.md, docs/ops/2026-10-30-learnstation-app-move.md | _prod facts from runbooks_ |
| F8 | Ingestion pipeline | UML activity + partitions | 4 · Design | `f8-pipeline.puml` | upload.py:146-266, :568-760; v4_spaces.py:180-214; materials_service.py:90-146; v4_spaces_service.py:477-536; unified_orchestrator.py:797-1451; synthesis.py:62-79, :146-183, :279 | **hero** |
| F9 | Core schema, part 1 (19 of 79 tables) | ER | 4 · Design | `f9-er-core.puml` | supabase/migrations/ (137 files); v4_spaces_service.py:47-110; v4_personal.py:1-35. Count: distinct `CREATE TABLE` names, partitions excluded |  |
| F9b | Core schema, part 2 (17 of 79 tables) | ER | 4 · Design | `f9b-er-learning.puml` | supabase/migrations/ (137 files); luna/store.py:203-227; review/card_factory.py:61-87; luna/session_service.py:157 | _new; needs a `\thesisfigurepage` in ch. 4_ |
| F10 | Layered idempotency | Concept / layered | 4 · Design | `f10-idempotency.puml` | cache.py:191-231, :554-556; upload.py:195-206, :630-697; file_parse_service.py:827-841, :1148; upload_service.py:105-120; materials_service.py:90-120; repos.py:44-100, :483-512; migration 20260730000000:50; unified_orchestrator.py:68, :672-703, :817-832, :947-951; job_locks.py:33-54; poster.py:116-128; reconcile.py:45-49, :95-131; arq_worker.py:67 | **hero** |
| F11 | LLM provider failover | UML activity | 4 · Design | `f11-provider-chain.puml` | orchestrator.py:239-397, :620-742, :1002-1151, :1465-1599; llm_client.py:34-79; vision.py:117-208 |  |
| F12 | Grounded course tutor (Home ask) | UML sequence | 5 · Implementation | `f12-tutor-sequence.puml` | HomeScreen.tsx:408-418; v4_spaces.py:101-112; v4_spaces_service.py:865-911; search_service.py:111-141; retrieval.py:30-32, :84-87; cache.py:397-440; tutor.py:69-85, :265-290, :295-304, :307-400; prompts.py:542-544 |  |
| F13 | Batch review — corrective, not gating | UML activity | 5 · Implementation | `f13-batch-review.puml` | BatchReviewPage.tsx:21-35; parser/repos.py:156-216; lectureService.ts:650-655; App.tsx:779-786; spaces/data/liveRepository.ts:256-269 |  |
| F14 | Trust boundaries | Concept | 5 · Implementation | `f14-trust-boundaries.puml` | migrations 20260719020000:23-28, 20261011000000:1-10, 20261024000000:25-42, 20261024010000:19, 20261024020000:43-83, 20260713000000:27-58, 20260710040000:72-104, 20261025000000:10-11, :92-123; core/database.py:4-8; analytics_service.py:95-114; v4_reader.py:42-46; tests/db/test_rls_policies.py:50-75 |  |
| F15 | Privilege-escalation hardening | UML state | 5 · Implementation | `f15-security-arc.puml` | migrations 20260122202809:4-30, :134-136 · 20260502000003:1-20 · 20260601000000:21-37 · 20260615000800:9-32 · 20260620000000:3-15, :41-55 · 20260621000000:3-16 · 20260721000001:58-76 · 20261011000000:4-10, :50-60 · 20261024000000:12-20, :46-61 · 20261024010000:3-19 · 20261024020000:3-6, :43-83 · 20261101015412:1-35, :64-73, :166-168 |  |
| F16 | Source attribution | Concept | 6 · Evaluation | `f16-citation-gap.puml` | tutor.py:117-144; v4_spaces_service.py:886-896; HomeScreen.tsx:408-418; luna/validate.py:85-91, :135-147; reader/luna/MoveMark.tsx; v4_reader_service.py:397; LectureView.tsx:43; InlineLecturePlayer.tsx:831-833; LectureChat.tsx (imported only by its test); App.tsx:197-212, :645-664 | _found, then fixed_ |
| F17 | Built versus delivered | Concept | 6 · Evaluation | `f17-flag-reality.puml` | config.py:106-219; docker-compose.prod.yml:142-153; App.tsx:197-212, :384-395; main.py:258; v4_spaces_service.py:865-896; review/mastery.py:28-31; history: 6c95041b, 28c81ca3 | _found, then fixed_ |
| F18 | Evaluation setup | Concept | 6 · Evaluation | `f18-evaluation-setup.puml` | backend/eval/{golden_sets,pipeline,scorer,judge,run_eval,retrieval_grid,verify_anchors,deck_lab,quiz_answer_check}.py; eval/data/golden_set.json; eval/parser_bench/{blinding,schedule,ranking,checks,results}.py; docs/thesis/experiments/parser-benchmark/PROTOCOL.md:3, :11, LAB_LOG.md:263-268 |  |
| F19 | Results — retrieval on the real corpus | Data | 6 · Evaluation | `f19-results.puml` | thesis/results/20260917T214528Z/grid_results.{md,csv} (run at a696be1-dirty); retrieval.py:30-32 | **hero** · _course column predates b66a97c6: re-run at the pin_ |
