# Documentation inventory

*Generated 2026-10-30 by `docs/prompts/2026-10-30-documentation-reset.md`. Status was decided by reading each file against the code, not by its date. Regenerate the dates with `git log -1 --format=%cs -- <path>`; change a status by editing this table and, for a historical file, its banner.*

Statuses: **current** = describes the code on `main` today; **historical** = a dated record, kept, with a banner at the top; **reference** = thesis material, not product documentation.

| Path | Last commit | What it is | Status | See instead |
|---|---|---|---|---|
| `CHANGELOG.md` | 2026-06-09 | Merged pull requests by date | current |  |
| `CLAUDE.md` | 2026-10-30 | The one page a Claude session reads first: layout, gates, prod facts, rules, traps | current |  |
| `README.md` | 2026-08-28 | What Learnstation is, how to run it, where the docs are | current |  |
| `docs/AVATAR_SYSTEM.md` | 2026-10-11 | Luna avatar: rules, where it lives, the unlock guard | current |  |
| `docs/BRAND_VOICE.md` | 2026-10-13 | Calm Competence: tone, do/don't vocabulary, German register, voice checklist | current |  |
| `docs/GDPR_DATA_PROTECTION.md` | 2026-10-16 | Data-protection posture: sub-processors, erasure, export | current |  |
| `docs/SECURITY_CI.md` | 2026-07-21 | What the CI security jobs do and why | current |  |
| `docs/SETUP_GUIDE.md` | 2026-10-30 | Local setup: prerequisites, env, install, run (refreshed 2026-07-11, migration line corrected 2026-10-30) | current |  |
| `docs/START_HERE.md` | 2026-10-30 | Ten-minute orientation: rooms and routes, pipeline, how a change ships, state of the world | current |  |
| `docs/STORAGE_TAKEDOWN.md` | 2026-08-17 | Upload validation and storage posture after S-4 | current |  |
| `docs/TESTING_STRATEGY.md` | 2026-10-30 | Test pyramid, mocking rules, coverage targets, flake policy (written 2026-05-02; the policy still holds, the counts do not) | current |  |
| `docs/V4_GLOSSARY.md` | 2026-10-16 | English/German words for every v4 string; the lint enforces it | current |  |
| `docs/design-v4/01-foundations.md` | 2026-08-30 | Locked v4 foundations and the vocabulary law | current |  |
| `docs/design-v4/README.md` | 2026-08-30 | Index of the design-v4 set | current |  |
| `docs/prompts/2026-10-30-documentation-reset.md` | 2026-10-30 | The prompt this documentation reset executes | current |  |
| `docs/prompts/README.md` | 2026-10-30 | Index of reusable session prompts | current |  |
| `docs/prompts/V4_SCENARIO_TESTING_PROMPT.md` | 2026-10-30 | Scenario walk of the v4 rooms before a deploy | current |  |
| `docs/runbooks/gdpr-erasure-rollout.md` | 2026-10-11 | How the erasure migration and backend were rolled out | current |  |
| `docs/threat_model.md` | 2026-10-30 | STRIDE threat model: assets, trust boundaries, scan anchors | current |  |
| `docs/DECK_LAB_2026_10.md` | 2026-10-11 | Generated scorecard: old vs new slide selection, 2026-10-11 | historical |  |
| `docs/MILESTONE_2026_08.md` | 2026-10-11 | The 2026-08 consolidation: 83 branches to one trunk | historical | `docs/START_HERE.md` |
| `docs/MILESTONE_4_FIX_PLAN.md` | 2026-08-18 | Overnight fix log of 2026-08-18 against the Milestone-4 audit | historical |  |
| `docs/READER_TWO_FACES_PHASE_A.md` | 2026-10-10 | Reader design, first pass (2026-09-17) | historical | `docs/READER_TWO_FACES_PHASE_A2.md` |
| `docs/READER_TWO_FACES_PHASE_A2.md` | 2026-10-10 | Reader design, second pass; became PR #68 and #75 | historical | `src/features/spaces/screens/LessonFacesScreen.tsx` |
| `docs/READER_TWO_FACES_PHASE_B.md` | 2026-10-10 | Reader prototype notes (2026-09-18) | historical |  |
| `docs/ROADMAP_10X.md` | 2026-09-17 | Proposed 3-phase roadmap (2026-07-06, §5 revised 2026-09-17) | historical | `docs/superpowers/specs/2026-10-26-library-and-spaces-design.md` |
| `docs/ROADMAP_10X_FOUNDATION.md` | 2026-07-30 | Proposed platform roadmap (2026-07-18); S-1..S-6 are done | historical | `docs/SECURITY_CI.md` |
| `docs/ROADMAP_PHASE2_RECONCILIATION.md` | 2026-10-30 | Verification record of 2026-09-17 | historical |  |
| `docs/RPC_EXPOSURE_AUDIT.md` | 2026-07-21 | S-1 audit record (2026-07-21) | historical | `docs/SECURITY_CI.md` |
| `docs/SECRETS_AUDIT.md` | 2026-09-17 | S-5 audit record (2026-09-17) | historical | `docs/SECURITY_CI.md` |
| `docs/STORAGE_UPLOAD_SECURITY_AUDIT.md` | 2026-07-30 | S-4 audit record (2026-07-30) | historical | `docs/STORAGE_TAKEDOWN.md` |
| `docs/STUDIO_PAGES_REPORT_2026_10.md` | 2026-10-16 | Geometry report for Studio pages, 2026-10-16 | historical |  |
| `docs/V4_TRANSLATION_PLAN.md` | 2026-10-18 | How v4 was translated; all slices done | historical | `docs/V4_GLOSSARY.md` |
| `docs/VIEWER_IMPLEMENTATION_AUDIT.md` | 2026-10-10 | Read-only audit of the viewer at a696be1 | historical |  |
| `docs/analytics-redesign/00-brief.md` | 2026-06-05 | Professor analytics redesign brief (2026-06) | historical | `docs/superpowers/specs/2026-10-26-how-its-landing-design.md` |
| `docs/analytics-redesign/01-design.md` | 2026-06-05 | Professor analytics redesign spec (2026-06) | historical | `docs/superpowers/specs/2026-10-26-how-its-landing-design.md` |
| `docs/analytics-redesign/02-plan.md` | 2026-06-05 | Professor analytics redesign plan (2026-06) | historical | `docs/superpowers/specs/2026-10-26-how-its-landing-design.md` |
| `docs/archive/ANALYTICS_IMPROVEMENTS_2026_04.md` | 2026-10-30 | Analytics bug fixes of 2026-04 | historical |  |
| `docs/archive/CLEANUP_NOTES_2026_07.md` | 2026-10-30 | Cleanup sprint log of 2026-07-11 | historical |  |
| `docs/archive/DEPLOYMENT_READINESS_2026_05.md` | 2026-10-30 | Readiness sweep of 2026-05-03 | historical | `CLAUDE.md (commands that gate)` |
| `docs/archive/DICTIONARY.md` | 2026-10-30 | Pre-v4 directory guide (2026-06) | historical | `docs/START_HERE.md` |
| `docs/archive/PRODUCTION_INFRA_GUIDE.md` | 2026-10-30 | Generic infra best practices; describes a platform we do not run (load balancer, CDN, migrations in CI) | historical | `docs/runbooks/deploy-main-to-prod.md` |
| `docs/archive/WORKLOG_backend_coverage_2026_07.md` | 2026-10-30 | Backend coverage worklog of 2026-07 | historical |  |
| `docs/archive/dead-code-audit.md` | 2026-10-30 | Pointer to a goal file that no longer exists | historical |  |
| `docs/archive/replit.md` | 2026-10-30 | Replit-era project memory (Vite on :5000, 117 backend tests) | historical | `CLAUDE.md` |
| `docs/design-v4/HANDOFF.md` | 2026-08-30 | Design-session handoff brief (2026-08) | historical | `docs/design-v4/01-foundations.md` |
| `docs/design-v4/UI-SESSION-BRIEF.md` | 2026-08-30 | Brief for the first v4 UI build session (2026-08) | historical | `docs/START_HERE.md` |
| `docs/design-v4/notes-spaces-screen.md` | 2026-08-30 | Known gaps of the Spaces screen (2026-08-29) | historical |  |
| `docs/prompts/AUDIT_SESSION_PROMPT.md` | 2026-10-30 | Whole-app browser audit prompt (pre-v4 routes) | historical | `docs/prompts/V4_SCENARIO_TESTING_PROMPT.md` |
| `docs/prompts/OVERNIGHT-PROMPT-ROADMAP-PHASE2.md` | 2026-10-30 | Overnight run that reconciled roadmap phase 2 | historical | `docs/ROADMAP_PHASE2_RECONCILIATION.md` |
| `docs/schema/curriculum_progress.md` | 2026-07-13 | Schema sketch for the older FullJourneyPath map | historical |  |
| `docs/superpowers/plans/2026-07-10-chatbot-layout-customizer.md` | 2026-07-11 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-07-10-chatbot-ui-redesign.md` | 2026-07-11 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-07-12-full-journeys-path.md` | 2026-07-12 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-08-31-v4-ui-backlog.md` | 2026-08-31 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-10-ai-backend-deep-session.md` | 2026-10-10 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-10-arc-3-chaos-lab.md` | 2026-10-11 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-10-arc-4-grounded-quiz.md` | 2026-10-11 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-10-arc-5-parse-receipts.md` | 2026-10-11 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-10-arc-6-deck-lab.md` | 2026-10-11 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-10-living-learn-plan.md` | 2026-10-10 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-10-session-ledger.md` | 2026-10-11 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-10-studio-canvas-plan-1.md` | 2026-10-10 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-11-arc-7-ledger.md` | 2026-10-11 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-11-arc-7-real-receipts.md` | 2026-10-11 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-11-gdpr-erasure-and-export.md` | 2026-10-11 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-11-learn-deeper-plan.md` | 2026-10-11 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-11-one-library-plan.md` | 2026-10-11 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-11-real-pages-pipeline-plan.md` | 2026-10-11 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-11-replace-third-party-deck.md` | 2026-10-11 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-13-arc-9-ledger.md` | 2026-10-13 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-13-arc-9-parse-spend.md` | 2026-10-13 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-16-one-library-german-plan.md` | 2026-10-18 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-24-luna-study-sessions.md` | 2026-10-24 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-26-how-its-landing-plan-1-reader-telemetry.md` | 2026-10-29 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-26-instant-reader.md` | 2026-10-26 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-29-how-its-landing-plan-2-space-engine.md` | 2026-10-29 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/plans/2026-10-29-luna-lights-up.md` | 2026-10-29 | Implementation plan, executed; the PR it produced is in CHANGELOG | historical |  |
| `docs/superpowers/specs/2026-07-10-chatbot-layout-customizer-design.md` | 2026-07-11 | Design spec; superseded by later specs unless named in START_HERE | historical |  |
| `docs/superpowers/specs/2026-07-10-chatbot-ui-redesign-design.md` | 2026-07-11 | Design spec; superseded by later specs unless named in START_HERE | historical |  |
| `docs/superpowers/specs/2026-07-15-lectureview-unification-design.md` | 2026-07-15 | Design spec; superseded by later specs unless named in START_HERE | historical |  |
| `docs/superpowers/specs/2026-10-10-living-learn-design.md` | 2026-10-11 | Design spec; superseded by later specs unless named in START_HERE | historical |  |
| `docs/superpowers/specs/2026-10-10-studio-canvas-design.md` | 2026-10-10 | Design spec; superseded by later specs unless named in START_HERE | historical |  |
| `docs/superpowers/specs/2026-10-11-learn-deeper-design.md` | 2026-10-11 | Design spec; superseded by later specs unless named in START_HERE | historical |  |
| `docs/superpowers/specs/2026-10-11-one-library-design.md` | 2026-10-11 | Design spec; superseded by later specs unless named in START_HERE | historical |  |
| `docs/superpowers/specs/2026-10-11-real-pages-pipeline-design.md` | 2026-10-11 | Design spec; superseded by later specs unless named in START_HERE | historical |  |
| `docs/superpowers/specs/2026-10-24-luna-study-sessions-design.md` | 2026-10-30 | Design spec; superseded by later specs unless named in START_HERE | historical |  |
| `docs/superpowers/specs/2026-10-26-how-its-landing-design.md` | 2026-10-29 | Design spec; superseded by later specs unless named in START_HERE | historical |  |
| `docs/superpowers/specs/2026-10-26-library-and-spaces-design.md` | 2026-10-26 | Design spec; superseded by later specs unless named in START_HERE | historical |  |
| `docs/superpowers/specs/2026-10-29-luna-lights-up-design.md` | 2026-10-29 | Design spec; superseded by later specs unless named in START_HERE | historical |  |
| `docs/thesis/ARCHITECTURE_PRIMER.md` | 2026-08-28 | Thesis learning document, derived from main @ 0be0081 | reference |  |
| `docs/thesis/NOTES.md` | 2026-09-17 | Thesis session notes | reference |  |
| `docs/thesis/THESIS_PLAN.md` | 2026-08-28 | Thesis preparation plan | reference |  |

## Other folders in the root

These are not product documentation and were not moved. Each is one line so nobody has to open it to find out.

| Folder | Last commit | What it is |
|---|---|---|
| `Milestone-4/` | 2026-08-18 | The 2026-08-17 whole-app audit set (APP_AUDIT_REPORT.md is the consolidated one) and its fix log |
| `project_docs/` | 2026-10-11 | Replit-era architecture notes (2026-05 to 2026-10); superseded by docs/START_HERE.md where they overlap |
| `thesis/` | 2026-09-17 | Bachelor thesis LaTeX, figures and the evaluation apparatus |
| `learnstation-luna/` | 2026-09-01 | Luna avatar source assets (SVG looks, suit locker) |
| `uiux-designer/` | 2026-04-26 | Early UI/UX exploration (2026-04) |
| `presentation/` | 2026-06-05 | Slides for a 2026-06 presentation |
| `creation-flow/` | 2026-07-13 | Design exploration for the creation flow (2026-07) |
| `stop-slop-main/` | 2026-06-02 | Vendored copy of the stop-slop lint used by the design review |
| `3d-web-experience/` | 2026-04-26 | One file from a 2026-04 experiment |
| `GPU-Server/` | 2026-06-02 | One note on a GPU parsing server (2026-06) |
| `vision/` | 2026-03-02 | One vision note from 2026-03 |
| `attached_assets/` | 2026-05-02 | Three files attached in 2026-05 |
| `load-testing/` | 2026-06-02 | k6 smoke script |
| `e2e/` | 2026-10-24 | Playwright specs and the true-e2e suite |
