# Figure manifest

Provenance for every thesis figure: which source files it was derived from, and the
claim it supports. Lets you answer "where is this in the code?" without re-reading the
repository, and tells you which figures went stale when code changes.

Regenerate all figures with `make figures` (sources in `src/`, shared style in
`src/_style.iuml`). Every figure is grayscale-safe: no distinction relies on hue alone.

**Do not cite `README.md` or `docs/` for any architectural claim** — both describe a
system that partly no longer exists. See `docs/thesis/ARCHITECTURE_PRIMER.md` §6.

| # | Figure | Type | Chapter | Source | Derived from | Flags |
|---|---|---|---|---|---|---|
| F1 | The transformation | Concept | 1 · Introduction | `f1-transformation.puml` | unified_orchestrator.py:96 (extract), :673-800 (synthesise), embeddings.py:13, persist.py:214 | **hero** |
| F2 | Positioning: structure vs pedagogy | Concept | 2 · Foundations | `f2-positioning.puml` | Derived from this system's capabilities and dependency set — NOT a citation search | _needs your sources_ |
| F3 | Two groundedness regimes | Concept | 2 · Foundations | `f3-grounded-vs-ungrounded.puml` | tutor.py:275 (is_grounded), :316-319 (gate), :178 (dead has_scope), retrieval.py:246 (RRF) |  |
| F4 | Actors and goals | UML use case | 3 · Requirements | `f4-use-case.puml` | src/lib/auth.tsx:8, auth_middleware.py:243, App.tsx:126-153, ConsoleTopBar.tsx:21-46 |  |
| F5 | Conceptual domain model | UML class | 3 · Requirements | `f5-domain-model.puml` | Analysis-level; compare F9 for the physical schema |  |
| F6 | Component view (as deployed) | UML component | 4 · Design | `f6-components.puml` | orchestrator.py (live LLM path), main.py:360 (health masks missing asyncpg) |  |
| F7 | Deployment topology | UML deployment | 4 · Design | `f7-deployment.puml` | docker-compose.prod.yml, nginx.conf:24-28, docs/GDPR_DATA_PROTECTION.md:8 |  |
| F8 | Ingestion pipeline | UML activity + swimlanes | 4 · Design | `f8-pipeline.puml` | api/v1/upload.py:84, upload_service.py:258, unified_orchestrator.py:438 | **hero** |
| F9 | Core schema — 26 of ~68 tables | ER | 4 · Design | `f9-er-core.puml` | supabase/migrations/ (116 files); dead tables per ROADMAP_10X_FOUNDATION.md:526-532 |  |
| F10 | Layered idempotency | Concept / layered | 4 · Design | `f10-idempotency.puml` | upload.py:131, repos.py:82, unified_orchestrator.py:531/641, job_locks.py:41, file_parse_service.py:832 | **hero** |
| F11 | LLM provider failover | UML activity | 4 · Design | `f11-provider-chain.puml` | orchestrator.py:150-238 (registry), :171 (gemma is gemini-flash-lite), :849-883, llm_client.py:34-77 |  |
| F12 | Grounded tutor request path | UML sequence | 5 · Implementation | `f12-tutor-sequence.puml` | ai_content.py:200, chat_service.py:25-45, tutor.py:58-74/136-212, retrieval.py:92-181 |  |
| F13 | Batch review — corrective, not gating | UML activity | 5 · Implementation | `f13-batch-review.puml` | BatchReviewPage.tsx:22-30, repos.py:166-215, lectureService.ts:608-690 |  |
| F14 | Trust boundaries and RLS | Concept | 5 · Implementation | `f14-trust-boundaries.puml` | docs/RPC_EXPOSURE_AUDIT.md:20-26, migration 20260719020000:25-29 |  |
| F15 | Privilege-escalation hardening arc | UML state | 5 · Implementation | `f15-security-arc.puml` | migrations 20260122202809 · 20260502000003 · 20260601000000 · 20260621000000 · 20260620000000 |  |
| F16 | The citation gap | Concept | 6 · Evaluation | `f16-citation-gap.puml` | tutor.py:106-133, LectureView.tsx:43/1028, InlineLecturePlayer.tsx:830-832, LectureChat.tsx:413-436 |  |
| F17 | Built versus deployed | Concept | 6 · Evaluation | `f17-flag-reality.puml` | config.py:103/109/115/121/134/139/181, featureFlags.ts:7-11, .dockerignore:28, conftest.py:32-33 |  |
| F18 | Evaluation setup | Concept / dataflow | 6 · Evaluation | `f18-evaluation-setup.puml` | backend/eval/{golden_sets,pipeline,scorer,judge,run_eval}.py |  |
| F19 | Results — SCAFFOLD, no data | Placeholder | 6 · Evaluation | `f19-results-scaffold.puml` | Run `python -m backend.eval.run_eval`, then fill from the Scorecard | **hero** **NEEDS DATA** |
