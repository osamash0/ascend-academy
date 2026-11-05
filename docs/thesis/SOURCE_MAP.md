# Thesis source map

*Compiled 2026-11-05 against `main` @ `2b8b1f7b` (local main fast-forwarded to origin the same day). Every file listed was opened and its content checked; it was not judged from its name. All paths are relative to the repository root. Untracked on purpose: read §6 before committing it.*

Thesis: *From Lecture Materials to Structured Educational Content: Design and Implementation of an AI-Assisted Learning Platform*.

## 0. Read first

1. **The parser benchmark (PR #168) is on `main`** since local `main` was fast-forwarded to `2b8b1f7b` on 2026-11-05. Before that it was only on `origin/main`.
2. **Some of the best thesis evidence is on archived tags, not on `main`.** The `docs/thesis/` files among it were restored into the working tree on 2026-11-05 (untracked; `ARCHITECTURE_PRIMER.md` and `NOTES.md` carry the y2qo52 edits as uncommitted changes). Everything else: `git show <tag>:<path>` (§2).
3. **Docs drift from code.** `thesis/figures/MANIFEST.md` says: do not cite `README.md` or `docs/` for architectural claims. Cite code instead.
4. **Some files contain lecturer slide text, a lecturer's name or personal data.** See §6. Describe them; never quote them.

## 1. The thesis apparatus (`thesis/`)

- `thesis/main.tex`, `preamble.tex`, `metadata.tex`, `references.bib`, `Makefile`
- `thesis/README-thesis.md`: build instructions and the pre-submission checklist
- `thesis/chapters/01-introduction.tex` … `07-conclusion.tex`, `appendix-a-constants.tex`: briefs only, 59 `\TODO`s
- `thesis/frontmatter/{abstract,declaration,titlepage}.tex`
- `thesis/figures/MANIFEST.md`: per-figure provenance (F1–F19); sources in `thesis/figures/src/*.puml`

## 2. Evidence on archive tags, outside git, and the parser benchmark

| Where | Path | What |
|---|---|---|
| tag `archive/thesis/finishing-pass` (restored locally) | `docs/thesis/FINISHING_PLAN.md` | Supersedes THESIS_PLAN: open decisions, writing order |
| same (restored locally) | `docs/thesis/evidence/CLAIMS_LEDGER.md` | 91 claims checked against code; 32 need correction |
| same (restored locally) | `docs/thesis/evidence/CONSTANTS.md` | Appendix A constants re-verified at file:line |
| same (restored locally) | `docs/thesis/evidence/REFERENCES_MAP.md` | Section → source map for 75 verified academic sources |
| same (all restored locally) | The whole `thesis/` tree: `references.bib` (+937 lines, 75 academic entries), the `Makefile` biber fix, all 19 re-rendered figures with corrected sources, `figures/f19-results.{pdf,puml}` (real retrieval numbers), chapters 03–06 and the appendix (corrected captions, `CORRECTION` notes, 53-row constants table), `metadata.tex`, `README-thesis.md`. Uncommitted; the old `f19-results-scaffold.{pdf,puml}` were left in place, unused | Newer than the `main` versions |
| same (restored locally) | `thesis/results/20260917T214528Z/grid_*.{md,csv,json}` | Real retrieval-grid numbers (e.g. course_hybrid k=5: slide found 0.926, MRR 0.852) |
| same | `docs/STATUS_2026_10_10.md` | Project status and test counts on 2026-10-10 |
| tag `archive/claude/project-thesis-context-y2qo52` (restored locally) | `docs/thesis/LEARNING_FEATURES_PRIMER.md`, plus its edits to `ARCHITECTURE_PRIMER.md` (re-verified citations) and `NOTES.md` (Sessions 2 and 5) | Quiz/exam/SRS mechanics, honesty addendum |
| tag `archive/claude/arc8-semantic-grounding` | `docs/superpowers/plans/2026-10-11-arc-8-ledger.md`, `backend/eval/semantic_grounding_eval.py`, `backend/eval/data/grounding_calibration.py` | Pre-registered negative result: semantic grounding failed its gate (threshold 0.774; probe false keep 8/16) |
| `main` (since 2026-11-05) | `docs/thesis/experiments/parser-benchmark/PROTOCOL.md`, `LAB_LOG.md`, `pages.json` | H1, seeds, deviations 1–4, all four judged comparisons |
| `main` (since 2026-11-05) | `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md`, `docs/superpowers/plans/2026-10-3*-parser-bench-*.md` | Benchmark design and plans |
| `main` (since 2026-11-05) | `backend/eval/parser_bench/**` (esp. `ranking.py`, `schedule.py`, `checks.py`, `results.py`, `blinding.py`, `runners/`), `backend/tests/unit/test_parser_bench_*.py` | Bradley-Terry (MM), bootstrap, Bonferroni H1, blinding |
| outside git | `~/Documents/learnstation-parser-bench/runs/compare/cmp-*/{results.json,votes.jsonl,compare.json}`, `runs/extract/` (135 runs) | Raw votes and extractions; contains slide text, never commit |
| tag `archive/wip/keen-cohen` | `docs/lehre-philipp-2026/antrag.md` | Teaching-prize pitch; contains address and matriculation number |

## 3. Docs in the checkout, by chapter

### Ch 1: Introduction and project story
- `docs/timeline/development-timeline.md` and `docs/timeline/00-overview.md` … `10-evaluation-and-polish.md` (untracked, written 2026-11-04 for the thesis): 10 phases, 32 decisions with reasons, per-chapter hints, AI-agent share of commits
- `vision/Thesis Presentation.pdf`: original January 2026 proposal (RQ1–3, competitor table)
- `docs/thesis/THESIS_PLAN.md` (RQ reframing; otherwise overtaken), `docs/thesis/NOTES.md` (with the LiteLLM correction)

### Ch 2: Foundations and positioning
- `docs/READER_TWO_FACES_PHASE_A.md`: comparison with AI PDF readers
- `docs/superpowers/specs/2026-10-10-studio-canvas-design.md`: NotebookLM as reference, "every AI output shows its evidence"
- `project_docs/implementation_plan_slides_filtering_v2`: heuristic → information density → LLM-as-judge filter
- `docs/AVATAR_SYSTEM.md`: gamification principles

### Ch 3: Requirements
- `project_docs/feature_audit/` (`FEATURE_AUDIT.xlsx`, `audit_data*.py`): 258 code-derived user stories with status
- `docs/ROADMAP_10X.md`, `docs/ROADMAP_10X_FOUNDATION.md`: user stories, NFRs, eval-harness requirements, cost model
- `project_docs/parser_v3_architecture.md`: pipeline goals and principles P1–P7
- `docs/design-v4/01-foundations.md`, `docs/design-v4/01-foundations-map.html`: v4 domain model
- `docs/superpowers/specs/2026-10-26-library-and-spaces-design.md`, `docs/superpowers/specs/2026-10-11-one-library-design.md`
- `docs/analytics-redesign/00-brief.md`: professor jobs-to-be-done
- `docs/learnstation-activation-strategy.html`, `project_docs/ACTIVATION_*.md`: personas
- `docs/GDPR_DATA_PROTECTION.md` (⚠ sub-processor list stale)
- `docs/superpowers/plans/2026-10-11-replace-third-party-deck.md`: copyright as a constraint
- `docs/V4_GLOSSARY.md`, `docs/BRAND_VOICE.md`: bilingual EN/DE requirement

### Ch 4: Design
- `docs/thesis/ARCHITECTURE_PRIMER.md`: D1–D19, idempotency layers, honesty ledger (⚠ written at `0be0081`; the provider chain has changed since)
- `docs/START_HERE.md`, `CLAUDE.md`: current architecture and dated prod facts
- `docs/superpowers/plans/2026-10-10-ai-backend-deep-session.md` (deck plan first), `2026-10-10-arc-3-chaos-lab.md` (2 provider-chain bugs found by fault injection), `2026-10-13-arc-9-parse-spend.md`, `2026-10-13-arc-9-ledger.md`
- `docs/superpowers/specs/2026-10-11-real-pages-pipeline-design.md`, `docs/superpowers/specs/2026-10-29-luna-lights-up-design.md` (measured 703 s for an 82-slide deck)
- `docs/runbooks/{deploy-main-to-prod,apply-a-migration-by-hand,monitoring-and-backups,domain-dns-and-email}.md`, `deploy/server/{heartbeat,offsite-backup}/`, `docs/ops/2026-10-30-learnstation-app-move.md`
- `docs/timeline/03-parsing-pipeline-and-feature-burst.md`, `04-pipeline-unification-and-feature-audit.md`: why v2→v5

### Ch 5: Implementation
- `docs/superpowers/specs/2026-10-24-luna-study-sessions-design.md`, `docs/superpowers/plans/2026-10-24-luna-study-sessions.md`
- `docs/superpowers/plans/2026-10-10-arc-4-grounded-quiz.md`, `2026-10-10-arc-5-parse-receipts.md`, `2026-10-11-arc-7-real-receipts.md`
- `docs/COURSE_LIFECYCLE_REBUILD_PROMPT.md` (untracked): no publish state; "Done reviewing" is a localStorage no-op (confirmed at `src/pages/BatchReviewPage.tsx:22-47`); `docs/COURSE_LIFECYCLE_UI_PROMPT.md`
- `project_docs/srs_daily_ascent_plan.md`, `project_docs/exam_mode_plan.md`
- `docs/RPC_EXPOSURE_AUDIT.md` (61 SECURITY DEFINER functions, 198 policies), `docs/STORAGE_UPLOAD_SECURITY_AUDIT.md`, `docs/SECRETS_AUDIT.md`, `docs/SECURITY_CI.md`, `docs/threat_model.md`
- `docs/superpowers/plans/2026-10-11-gdpr-erasure-and-export.md`, `docs/runbooks/gdpr-erasure-rollout.md`
- `docs/superpowers/specs/2026-10-26-how-its-landing-design.md` and its plans `2026-10-26-how-its-landing-plan-1-reader-telemetry.md`, `2026-10-29-how-its-landing-plan-2-space-engine.md`
- `docs/TESTING_STRATEGY.md`

### Ch 6: Evaluation
- `docs/DECK_LAB_2026_10.md`: 25 decks, 1,593 pages; grounding probe false drop 14/16, so the verifier was made advisory
- `docs/superpowers/plans/2026-10-10-session-ledger.md`: grounding calibration, test counts, rulings
- `docs/STUDIO_PAGES_REPORT_2026_10.md`: a 136-page deck exceeded the 900 s timeout (⚠ its table lists personal file names)
- `Milestone-4/APP_AUDIT_REPORT.md` (135 findings), `Milestone-4/PROBLEMS.md`, `LEARNSTATION_FULL_APP_AUDIT.md`, `PROFESSOR_ACCOUNT_AUDIT.md`, `_source_audit.md`; `docs/MILESTONE_4_FIX_PLAN.md`
- `docs/MILESTONE_2026_08.md`, `docs/ROADMAP_PHASE2_RECONCILIATION.md`, `docs/VIEWER_IMPLEMENTATION_AUDIT.md`
- `docs/ops/2026-10-31-browser-review.md`: live grounding failures
- `docs/COPY_AUDIT_2026_10.md`, `docs/INVENTORY.md`: documentation drift
- `docs/timeline/06-consolidation-and-app-audit.md`, `07-v4-redesign-and-thesis-apparatus.md`, `10-evaluation-and-polish.md`

### Ch 7: Conclusion
- `docs/timeline/development-timeline.md` §6 (problems and lessons) and §7 (open questions); `docs/START_HERE.md` (agreed direction); `CLAUDE.md` (near-zero real usage)

## 4. Code to cite (verified 2026-11-05)

**Ingestion pipeline**
- `backend/services/parser/unified_orchestrator.py`: live pipeline, version 5
- `backend/services/parser/deck_plan.py` (no LLM), `synthesis.py` (`ENFORCE_SUPPORT_THRESHOLD=False` :62, `CHECK_MODEL="groq"` :79), `quiz_grounding.py`, `persist.py`, `repos.py`, `reconcile.py`
- `backend/api/v1/upload.py`, `backend/services/upload_service.py`
- Older routing pipeline: `backend/services/file_parse_service.py`, `layout_analyzer.py`, `slide_classifier.py`, `content_filter.py`

**LLM orchestration**
- `backend/services/ai/orchestrator.py:389-393`: `BULK_CHAIN` / `QUALITY_CHAIN` (8 entries each)
- `backend/services/ai/{embeddings,cost,call_context,vision}.py`, `backend/services/llm_client.py`, `backend/core/config.py`
- Prompts: `backend/services/ai/prompts.py` (versioned registry), `backend/services/luna/prompts.py`, `backend/services/v4_reader_service.py`

**Retrieval and tutor**
- `backend/services/ai/retrieval.py:30-32` (k=5, threshold 0.65, course k=6), RRF constant 60
- `backend/services/ai/tutor.py`, `backend/services/cache.py`, `backend/services/search_service.py`
- Luna: `backend/services/luna/{session_service,validate,context,memory,store}.py`, `backend/services/ai/ask_luna.py`

**SRS, exam, gamification**
- `backend/services/review/scheduler.py` (SM-2, ease 1.3/2.5), `backend/services/review/mastery.py` (no-op today), `backend/services/review/card_factory.py`
- `backend/services/exam_service.py` (weighted reservoir sampling), `backend/services/v4_practice_service.py`

**Security, GDPR, jobs**
- `backend/core/auth_middleware.py`, `backend/domain/authorization.py`, `backend/services/erasure.py`, `backend/services/account_service.py`
- `backend/core/idempotency.py`, `backend/core/job_locks.py`, `backend/workers/arq_worker.py`, `backend/workers/dlq.py`

**Eval harness**
- `backend/eval/README.md`, `retrieval_grid.py`, `data/golden_set.json` (50 questions, 27 with a course), `verify_anchors.py`
- `backend/eval/deck_lab.py`, `data/grounding_probe.py`, `quiz_answer_check.py`, `scorer.py`, `judge.py`, `run_eval.py`

**Frontend**
- `src/App.tsx`, `src/lib/{auth.tsx,routes.ts,featureFlags.ts,pseudonymize.ts}`
- `src/features/spaces/types.ts`, `src/features/spaces/data/{liveRepository,lunaSession,assistant}.ts`
- `src/features/spaces/screens/LessonFacesScreen.tsx` (the v4 reader), `src/features/spaces/components/reader/{TutorPanel,SourceView,CheckpointCard,TeachBack}.tsx`
- `src/pages/{BatchReviewPage,LectureUpload,MockExam}.tsx`
- `src/services/{lectureService,reviewService,analyticsService,gamificationService}.ts`

**Schema (`supabase/migrations/`)**
- Base and content: `20260122202809_*` (initial), `20260503000008_parser_v3_schema`, `20261012000000_parse_receipts`, `20261013010000_lecture_pages`
- Retrieval: `20260430120000_*` (pgvector), `20260719000002_*` (HNSW)
- Learning: `20260710010000_review_engine`, `20260710020000_exam_mode`, `20260616000000_gamification_engine`, `20261025000000_luna_sessions`
- Privilege hardening: `20260502000003`, `20260601000000`, `20260620000000`, `20260719000003`, `20260721000001`, `20261011000000`
- Ops and GDPR: `20260719010000_llm_calls_cost_accounting`, `20261013000000_account_erasure_jobs`, `20261027000000_v4_reader_telemetry_events`

**Infra and CI**
- `docker-compose.prod.yml` (5 services, LiteLLM removed), `Dockerfile`, `Dockerfile.frontend`, `nginx.conf`
- `.github/workflows/ci.yml`: the nightly AI eval has never run (dispatch-only, provider secrets never set, :441-449); E2E is dispatch-only
- `playwright.config.ts`, `playwright.true-e2e.config.ts`, `e2e/`: old rooms only, no v4 coverage

**Tests worth citing (`backend/tests/`)**
- Chaos: `unit/test_chaos_*.py`
- Property tests (Hypothesis): `unit/test_deck_plan_*.py`, `unit/test_quiz_grounding.py`
- `unit/test_retrieval_grid.py`, `unit/test_unified_orchestrator.py`, `unit/test_parse_spend_caps.py`
- DB/RLS: `db/test_rls_policies.py`, `db/test_seeded_cross_tenant_leak_canary.py`, `db/test_zero_vector_retrieval_hazard.py`, `db/test_account_erasure_cascade.py`

## 5. Opened and rejected

- **Stale or misleading:** `presentation/` (claims video features that never existed), `project_docs/v3.0_release_notes.md` and the `[3.0.0]` section of `CHANGELOG.md`, `backend/README.md`, `project_docs/reconstructed_history.md` (contradicts git)
- **No thesis value:** classic-room UI specs, Studio plans (flag off), `docs/archive/*` (except as drift examples), setup guides
- **Tooling, mocks or personal data:** `scratch/`, `creation-flow/`, `uiux-designer/`, `3d-web-experience/`, `src/features/spaces/mocks/`, `Milestone-4/learnstation-data-2026-08-17.json`

## 6. Use, never quote publicly

- `backend/eval/data/golden_set.json`, `backend/eval/data/grounding_probe.py`, `backend/tests/unit/test_quiz_grounding_real_decks.py`: verbatim or paraphrased lecturer slide text
- `backend/tests/unit/test_deck_plan_real_decks.py:51`: a lecturer's full name
- `pdf_testset/`, the decks in `~/Downloads`, `~/Documents/learnstation-parser-bench/`: copyrighted lecture material
- `docs/STUDIO_PAGES_REPORT_2026_10.md`: its table lists personal file names
- `GPU-Server/GPU-Server_2024-05-02.pdf`: internal university wiki with a hostname and IP, still tracked in the public repo
- `docs/thesis/FINISHING_PLAN.md`, `docs/thesis/evidence/CLAIMS_LEDGER.md`, `thesis/chapters/05-implementation.tex` CORRECTION notes (restored from `archive/thesis/finishing-pass`): describe two production vulnerabilities by name. Both are fixed: upload course ownership (`722167b0`, deployed with `35a30d73`) and the anon EXECUTE revoke on SECURITY DEFINER functions (`537b9806`, migration `20261011000000`, applied to prod 2026-10-11). Reworded on 2026-11-05 to say found-then-fixed; the old "do not push" section is replaced
