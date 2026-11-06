# Phase 06 — Consolidation and the whole-app audit (2026-08-01 to 2026-08-28)

*Written 2026-11-04 from the git history of all refs, PR descriptions and comments, and the docs in the repo. Commit hashes are short SHAs. Most PR bodies in this phase end with "Generated with Claude Code", so an AI coding agent wrote or co-wrote that work.*

## Summary

At the start of August the code was spread over 83 branches in 40 worktrees, the branch called `main` was not the newest code, a security fix was stranded off `main`, and production ran an older build. Nothing was committed from 08-01 to 08-14. On 08-17 Abdullah, working with Claude Code, consolidated everything into one trunk (PRs #9 to #13, tag `milestone/2026-08-consolidation`), archived the rest as `archive/*` tags, reconciled the production database with the migrations, and fixed a Supabase egress overage. The same day a whole-app audit ("Milestone 4") merged five separate audits into one report with 135 findings, and an overnight agent run on 08-18 fixed most of them in PRs #27 to #50. Production was not updated, because the gap to `main` turned out to be 355 files plus many unapplied migrations. In the last week Abdullah started thesis groundwork (architecture primer, 19 code-derived figures, a thesis plan), which surfaced three more pipeline defects (PR #51); Osama ran a security audit on his own branch, and one of its fixes reached `main` as PR #53. At the end of the phase `main` was a single, mostly green trunk, but production still ran July code.

## Where the time went

| Measure | Value |
|---|---|
| Non-merge commits (all refs) | 117 |
| Active days | 6 (08-15, 08-17, 08-18, 08-25, 08-26, 08-28) |
| Authors | Abdullah 90 (64 under his short git name, 26 under his full name, the latter mostly GitHub squash merges), Osama 27 (under two git names) |
| Commits with a "Co-Authored-By: Claude" trailer | 86 of 117 |
| Commit types (from messages) | fix 61, docs 41, security 15, test 10, feat 2 |

| Area | Commits touching | Lines changed (share) |
|---|---|---|
| frontend (classic app) | 43 | 9,506 (20%) |
| thesis | 4 | 8,742 (19%) |
| docs | 37 | 7,405 (16%) |
| frontend tests / e2e | 34 | 6,913 (15%) |
| backend tests | 30 | 5,585 (12%) |
| backend (other) | 26 | 3,467 (7%) |
| other | 18 | 2,089 (4%) |
| backend AI / Luna | 9 | 1,259 (3%) |
| backend parser | 9 | 971 (2%) |
| infra / CI / scripts | 9 | 582 (1%) |
| database (migrations) | 7 | 403 (1%) |
| i18n | 14 | 188 (0%) |

Most-touched files: `docs/MILESTONE_4_FIX_PLAN.md` (14 commits), `SECURITY_AUDIT.md` (8, only on Osama's unmerged branch), `src/pages/LectureView.tsx` (8), `unified_orchestrator.py` (7), `Onboarding.tsx` (6), `StudentCourseLibrary.tsx` (6), `lectureService.ts` (5), `useLectureSubmit.ts` (5). Most-fixed: `MILESTONE_4_FIX_PLAN.md` (8), `LectureView.tsx` (8), `unified_orchestrator.py` (6), `lectureService.ts` (5), `Onboarding.tsx` (5), `StudentCourseLibrary.tsx` (5).

- Almost all work happened in two days (08-17 and 08-18). This was a consolidation-and-repair burst, not steady feature work. Only 2 commits are `feat`. [Confirmed: stats and commit dates]
- About a third of the lines are docs and thesis text. The audit, the milestone record and the fix log were written as part of the work, not after it. [Inferred: from the area table and the doc-update commits between PRs]
- `MILESTONE_4_FIX_PLAN.md` is the top file because the overnight run updated it after every merge. It worked as a live tracking log. [Confirmed: commits like `b4c8b55f`, `fdae5650`, `c12ff1b0`]
- The frontend fix hotspots (`LectureView.tsx`, `lectureService.ts`, `StudentCourseLibrary.tsx`) were about error handling and state: failures shown as empty or success states, Back navigation, PDF loading. [Inferred: from the PR titles #36, #39, #50 and the audit's "error-as-emptiness" findings]
- Frontend tests rose to 15% of lines. Most fix PRs added a regression test. [Confirmed: PR bodies, e.g. #30, #50]

## Entries

### 2026-08-01 to 2026-08-14 — No commits
- **What happened:** No commits on any ref.
- **Decision:** none recorded.
- **Why:** not stated. A production outage on the server started around 08-15 (see the 08-17 server entry); whether the pause is related is unknown.
- **Sources:** `git log --all`

### 2026-08-15 — Student-owned courses, secrets out of the image, GDPR erasure
- **What happened:** Three commits that later reached `main` through PR #9: student-owned course creation, upload and editing made to work end to end (`0a1f09b8`), onboarding split into an identity step and a study step; `backend/.env` no longer copied into the Docker image (`785bcb36`); account deletion made to fail loudly and data export made complete (`0bd7a44c`).
- **Decision:** A failed erasure must report failure, not fall back to a partial delete.
- **Why:** [Confirmed: `0bd7a44c`] the old client-side fallback deleted five tables, left `auth.users` and storage intact, and still said "Account deleted". [Confirmed: `785bcb36`] `.dockerignore` patterns are root-relative, so `.env` matched only `./.env` and the backend env file with provider keys went into every image.
- **Sources:** `0a1f09b8`, `785bcb36`, `0bd7a44c`

### 2026-08-17 — Server recovery after a disk-full outage
- **What happened:** The production server had been down. Uncapped Docker and journald logs had filled the disk, Redis could not write its AOF file, and after a reboot on 08-15 the containers did not restart. Abdullah regained access through the hosting console, capped logs, added a disk alert, hardened SSH and rebooted to prove the stack comes back by itself.
- **Decision:** Cap container and system logs, and add a disk watchdog.
- **Why:** [Confirmed: `docs/runbooks/deploy-main-to-prod.md` notes "the box had a disk-full outage once"]. The cause and steps above come from the author's own session notes, which are not in the repo. Server changes are not in git.
- **Sources:** `docs/runbooks/deploy-main-to-prod.md`; author's session notes (outside the repo)

### 2026-08-17 — Milestone consolidation: 83 branches to one trunk (PR #9)
- **What happened:** PR #9 landed `fix/s6-continuous-security-ci` (27 commits, a superset of `main`) as the new baseline. It contained the July P0–P5 and S1–S6 fleets, six features "previously believed uncommitted" (review engine, exam mode, student uploads, AI voice, async hardening, brand voice), 15 new migrations, and five renamed migrations to fix a timestamp collision. It also brought the stranded `list_courses` leak fix (`7c3af431`) and a new fix that gates study-guide regeneration on course ownership.
- **Decision:** Make `main` the single trunk again; archive every other branch as an annotated `archive/*` tag with a recovery command.
- **Why:** [Confirmed: `docs/MILESTONE_2026_08.md`] "The repo had drifted to 83 branches across 40 worktrees, and the branch named `main` was not the newest code." The leak fix "was absent from `main` for roughly two weeks." The study-guide gate was found because a client-side professor check read a field that does not exist, so nobody saw the server hole behind it.
- **Sources:** PR #9 (`1b0a7c30`), `2bde2c74`, `b9e583d7`, `3fb52038`; `docs/MILESTONE_2026_08.md`; tag `milestone/2026-08-consolidation`

### 2026-08-17 — Stranded commits recovered (PRs #10, #11)
- **What happened:** PR #10 recovered CI and test-hardening commits from abandoned worktree branches (network guard for unit tests, `-m "not db"` in CI) and fixed a freezegun interaction that froze the clock for the rest of the test session. PR #11 recovered two commits (upload-abuse tests and the S-4 posture doc; a fix for swallowed Supabase mutation errors in `lectureService.ts`).
- **Decision:** Re-derive before deleting any branch.
- **Why:** [Confirmed: PR #11 body] an earlier check had claimed the branches were duplicates; it was wrong because a shell comparison under zsh did not word-split, so `git diff` got one malformed argument and "no output" was read as "no difference."
- **Sources:** PRs #10, #11; `e05bb4a9`, `4963c6d9`, `83d94797`, `e17d0026`

### 2026-08-17 — Supabase egress overage (PR #12)
- **What happened:** The free-tier egress cap had been exceeded in the previous billing cycle, with a grace period before requests would be blocked. PR #12 stopped the console hero from loading whole PDFs as background art: the parser now renders a small WebP poster of page 1 at ingest, and signed URLs are cached so the CDN can serve repeat views. Measured: one course 36 MB to 1,087 kB, full corpus 171 MB to 4,223 kB (about 97.6% less).
- **Decision:** Never fall back to the PDF for decoration; a lecture without a poster shows a gradient.
- **Why:** [Confirmed: PR #12 body] pdf.js fetched the whole document to draw a background, and a fresh signed URL per mount meant every view was a cache miss ("2.96 GB uncached vs 0.06 GB cached, at only 15 MAU"). The next day the audit named a second suspect: an auth loop that made 60 requests per second (see below) [Confirmed: `Milestone-4/APP_AUDIT_REPORT.md` §0.1, "M6 is a prime suspect for the documented Supabase egress overage"].
- **Sources:** PR #12 (`9ab42660`), `bde85136`/`f313a6c1`/`72e2020f` (same fix, three branches); migration `20260817010000`; `backend/services/parser/poster.py`

### 2026-08-17 — Production database reconciled with the migrations
- **What happened:** The prod migration ledger held 2 rows against 115 files, so `pg_catalog` was used as ground truth. Five migrations were applied by hand (RPC exposure lockdown, a revoke on a cache-invalidation function, global search RPCs, single-lecture tutor retrieval, the dead-letter table). Out-of-band objects (a search RPC and an index not in any migration) were removed. Five migrations were deliberately left unapplied, including `eval_runs` and the `learning_events` partitioning.
- **Decision:** Never run `supabase db push`; probe the catalog and apply by hand.
- **Why:** [Confirmed: `docs/MILESTONE_2026_08.md`] `db push` "would attempt to replay 113 migrations against a live database." Without the DLQ table "every permanently-failed job was silently lost." The out-of-band index name collided with the repo's, and `IF NOT EXISTS` would have made the repo migration silently do nothing.
- **Sources:** `docs/MILESTONE_2026_08.md`; `9682db03` (SECURITY DEFINER lint repaired, then what it found fixed); `91ada555`

### 2026-08-17 — Osama's `Refactoring` branch rejected
- **What happened:** The 11-commit `origin/Refactoring` branch (SQLModel, Alembic, RBAC, ApiToken, hybrid search; see Phase 05) was investigated in full and archived.
- **Decision:** Do not merge; do not revive without a redesign. Two ideas were kept for fresh work: field weighting for keyword search and a `course_access` table for co-professor delegation.
- **Why:** [Confirmed: `docs/MILESTONE_2026_08.md`] "redundant where it works and regressive where it does not" (unseeded permissions, broken enrolment and course creation, five tables without RLS).
- **Sources:** tag `archive/Refactoring`; `docs/MILESTONE_2026_08.md`

### 2026-08-17/18 — Five audits merged into one report (Milestone-4)
- **What happened:** Five audits had run separately: one against localhost with repo, DB and browser access, and four browser-only audits against prod (full app, student, professor, an addendum). They were reconciled into `Milestone-4/APP_AUDIT_REPORT.md`: 135 findings (81 reconciled as M1–M81, 54 new source-level ones as R1–R54), plus a ranked `PROBLEMS.md`. Three fixes landed before the report: an auth loop making 60 Supabase requests per second on an idle dashboard (M6), an onboarding dead end (M10), and a silent upload button failure (M11). A batch-synthesis bug where the JSON-mode envelope was read as one slide was also fixed (PR #16).
- **Decision:** One report to act from; separate prod findings from repo findings, because "Prod is not necessarily main."
- **Why:** [Confirmed: `Milestone-4/APP_AUDIT_REPORT.md` header and source table]. The top blockers were F8 (a new student cannot enrol), leaked keys in git history, professor saves resurrecting stale data (M4), and a privacy policy that said no data goes to external AI services while it did [Confirmed: PR #17 body].
- **Sources:** PRs #14–#26; `24dc9a28`, `f682bded`, `cd426cfc`, `0fa464ab`; `Milestone-4/` folder

### 2026-08-18 — F8: student enrolment broken by a permissive policy
- **What happened:** The student library read every published course through a direct table select with no enrolment filter. An RLS "browse published courses" policy was OR-ed with the scoped ones, so every course looked "Enrolled" and the enrol button was disabled. A query over `pg_policies` showed only one table had this shape. PR #28 moved student course reads to the enrolment-scoped API.
- **Decision:** Add a real enrolled-course accessor instead of tweaking a filter; keep the policy-shape query as a standing check.
- **Why:** [Confirmed: `docs/MILESTONE_2026_08.md` F8] "This is the `list_courses` leak's twin" and a false code comment ("Pre-seed courseMeta with explicitly enrolled courses") hid it.
- **Sources:** PR #28 (`e875bfbc`), PRs #19, #20; `docs/MILESTONE_2026_08.md`

### 2026-08-18 — Overnight fix run: PRs #27 to #50
- **What happened:** An autonomous overnight agent session worked through the audit in priority order, one squash-merged PR per fix set, logging each in `docs/MILESTONE_4_FIX_PLAN.md`. Examples: all 18 TypeScript errors cleared so `tsconfig.app.json` can gate CI (#27); `ProtectedRoute` fails closed on unknown roles (#29); admin panel no longer shows fabricated Sentry errors, a hardcoded error chart, fake uptime or a wrong version (#30); editor saves no longer overwrite saved edits with stale AI output, and one edit no longer causes 20 writes (#32); failed fetches no longer render as empty or success states (#33, #36); upload jobs no longer stay "extracting" forever (#37); professor analytics no longer fabricate AI insights on failure (#48); PDF signed-URL retry (#50).
- **Decision:** Defer anything that needs the owner: key rotation, legal texts, live destructive data cleanup, env/config consolidation that could flip a prod flag, and the ship-or-delete call on global search.
- **Why:** [Confirmed: `docs/MILESTONE_4_FIX_PLAN.md`, "Needs your input"] for example the data cleanup was skipped because the free tier had "no backup/PITR" and "a bad WHERE clause here isn't a revertable PR, it's a data-loss incident." [Confirmed: PR #37] the stuck-job root cause was that Arq's timeout raises `asyncio.CancelledError`, which `except Exception` does not catch.
- **Sources:** PRs #27–#50; `docs/MILESTONE_4_FIX_PLAN.md`

### 2026-08-18 — Production deploy deferred
- **What happened:** When asked to update the deployed version, the agent found prod checked out on a `deploy/egress-hotfix` branch, 355 files behind `main`, needing dozens of migrations on a database without backups. Nothing on the server was changed.
- **Decision:** Abdullah chose to stop and do the catch-up deploy later in a supervised session.
- **Why:** [Confirmed: `0be00814`, `docs/MILESTONE_4_FIX_PLAN.md` "Production deploy status"] the catch-up was "a much bigger, riskier operation than 'restart the containers with new code.'"
- **Sources:** `0be00814`

### 2026-08-18 — Course facts with AI and the provider-chain repair (not merged)
- **What happened:** On branch `claude/stoic-antonelli-413a1b` an agent added professor-initiated "generate course facts with AI" (`3cb0a0df`) and repaired the provider registry (`bc588a83`): "Only 2 of the 9 legs in PROVIDER_REGISTRY actually worked", because of retired model ids, a misread HTTP 402 and a dead vision leg.
- **Decision:** none recorded. The branch was never merged and was archived on 2026-10-24.
- **Why:** not stated (see Open questions).
- **Sources:** `3cb0a0df`, `bc588a83`, `d5a8fe2a`; tag `archive/claude/stoic-antonelli-413a1b`

### 2026-08-25/26 — Osama's security audit branch (mostly not merged)
- **What happened:** On branch `security-audit` Osama added about 25 commits: a regression test that admin search is parameterised, console stripping in prod builds, frontend coverage thresholds, ruff blocking in PRs, a pre-commit config, an OpenAPI export, a gitleaks investigation and credential rotation script, a `.gitleaksignore`, a prompt-injection golden set and judge as a fifth eval dimension, and a "measured fix" hardening the course tutor against instruction extraction. Findings were written in `SECURITY_AUDIT.md`.
- **Decision:** Only one fix reached `main`: the Ask-across-course model bug, as PR #53. The branch was archived on 2026-10-24, "25 ahead / 555 behind main; not merged."
- **Why:** [Confirmed: PR #53 body] the ⌘K "Ask across course" path never sent a model, the default `llama3` meant a local Ollama call, which failed on every real deployment and was hidden behind a generic "having trouble connecting" reply, so the feature "was completely non-functional for every user." Why the rest was not merged is not stated.
- **Sources:** `56030b87` to `6fcc9ac0`; PR #53 (`a46b7966`); tag `archive/security-audit`

### 2026-08-25 to 2026-08-28 — Thesis groundwork and three pipeline fixes (PR #51)
- **What happened:** Abdullah added `docs/thesis/ARCHITECTURE_PRIMER.md`, 19 code-derived figures that rebuild from committed sources, `docs/thesis/THESIS_PLAN.md` (learning sessions so that Abdullah can explain every diagram without notes) and `docs/thesis/NOTES.md`. Four parallel readers checked the docs against the code and found 12 documented claims that did not hold, including the README's "Parser v3.0" headline. Three were live defects: zero-vector embeddings that pass the similarity filter (cosine distance to a zero vector is NaN, which Postgres sorts above every float) and then block re-embedding; PPTX failing late in containers without LibreOffice; and a dead LiteLLM gateway still in the compose files. A LaTeX skeleton followed on a separate branch (PR #52, merged in September).
- **Decision:** Remove the LiteLLM gateway (providers are called directly from `orchestrator.py`); make PPTX explicitly unsupported in containers; refuse zero vectors.
- **Why:** [Confirmed: `68a091e0`] the gateway had no live callers, cost 1 GB / 0.75 vCPU of a 4 GB box, and its health check could block the whole stack from starting; a GDPR doc named a processor path through it that did not exist. [Confirmed: PR #51] shipping LibreOffice "would take the image from ~200 MB to >1 GB on a single 4 GB box."
- **Sources:** PR #51 (`2f6d566c`; source commits `474ebb63`, `ce1c7f1a`, `0d7f4a68`, `68a091e0`, `cb7ff1a4`); PR #52; `docs/thesis/`

## Challenges

- **Branch sprawl and stranded work.** [Confirmed] 83 branches in 40 worktrees; a security fix off `main` for about two weeks; features "previously believed uncommitted" that were in fact on a branch; test-hardening commits on abandoned worktrees (`docs/MILESTONE_2026_08.md`, PRs #9–#11). Two later branches from this phase were again left unmerged (`security-audit`, `claude/stoic-antonelli-413a1b`).
- **A faulty verification nearly deleted real work.** [Confirmed: PR #11] a zsh word-splitting bug made two different branches look identical.
- **Fabricated data shown as real.** [Confirmed: PRs #30, #48] the admin panel showed invented errors, a hardcoded chart and a fixed "99.99%" uptime; professor analytics showed fake AI insights when the backend failed.
- **Silent failures.** [Confirmed] failed fetches rendered as empty or success states (PRs #33, #36); upload jobs stuck in "extracting" with no error (PR #37); every permanently failed job was lost without the DLQ table in prod (`docs/MILESTONE_2026_08.md`); the course-wide Ask feature always failed behind a generic reply (PR #53); the SCA job's `npm audit` step had never run because `pip-audit` failed first (`docs/MILESTONE_2026_08.md`, "outbound guard has a blind spot").
- **Egress overage.** [Confirmed: PR #12] decorative PDF loading and uncacheable signed URLs. [Confirmed: audit M6] an idle dashboard made 60 requests per second. Which cause dominated is stated only in the author's notes outside the repo (see Open questions).
- **Production drift.** [Confirmed: `0be00814`, `docs/MILESTONE_2026_08.md`] prod ran a hotfix branch 355 files behind `main`; the migration ledger held 2 of 115 rows; out-of-band DDL existed in prod.
- **Secrets in history.** [Confirmed: PR #9 body, `docs/MILESTONE_2026_08.md` F1] service keys had been committed in early history; the nightly secret scan failed for this reason. Rotation needed the owner and was handled in a later phase (`071310a3`, 2026-09-16).
- **The tracking log and GitHub disagree once.** [Confirmed] `docs/MILESTONE_4_FIX_PLAN.md` marks session 25 (M42, M45, M48–M50, M74) as done with PR #43, but GitHub shows #43 as closed without merge.
- **Docs that did not match code.** [Confirmed: PR #51] 12 documented claims did not hold, including the privacy policy and a GDPR processor statement.

## Open questions

- Why was nothing committed from 08-01 to 08-14? Was it the server outage, holidays, or work outside git?
- Which cause dominated the egress overage, the PDF backdrops or the 60 requests per second auth loop? PR #12 names the first; the audit calls the second "a prime suspect". A per-source measurement is not in the repo.
- Why were `claude/stoic-antonelli-413a1b` (course facts, provider repair) and Osama's `security-audit` branch never merged? Was the provider repair redone later (October brought `AI_PROVIDER_MODE=openai_only`, `5b178452`)?
- Did the fixes in PR #43 (closed, not merged) ever reach `main` in another form?
- When was the catch-up deploy done, and which of the five deliberately unapplied migrations were applied later?
- How were the five audits run (which agents, which accounts, which builds)? The report lists access levels but not the tooling.
- Was the decision to make PPTX unsupported in containers final, given the PPTX work in July?

## Thesis hints

- **Requirements:** the audit's blocker list (enrolment, data integrity on save, legal and privacy truthfulness) shows which requirements a learning platform must meet before launch. The privacy-policy finding is a concrete GDPR transparency requirement.
- **Design:** RLS policy design and the risk of permissive policies being OR-ed (`list_courses` leak and F8, with the `pg_policies` check query); ownership checks instead of role checks (study-guide regenerate); WebP posters at ingest instead of loading PDFs for display; direct provider calls instead of a gateway (`68a091e0`); a job-state model that always reaches a terminal state (PR #37).
- **Implementation:** reconciliation of stalled parse runs with an Arq cron; signed-URL caching; zero-vector guard for pgvector retrieval; enrolment-scoped API for student reads.
- **Evaluation:** the 135-finding audit as an evaluation of the system against its own claims; measured egress reduction (97.6%); test counts in PR bodies (for example 1,409 backend tests passing in #10, 1,483 in #51); the prompt-injection golden set as a security evaluation dimension (on Osama's branch, not merged).
- **Methodology / process:** the move from branch sprawl to one trunk with archive tags; an autonomous overnight agent run with a live tracking log and explicit "needs you" limits; lessons recorded in `docs/MILESTONE_2026_08.md` ("re-derive before deleting", "a green guard means not reached, not not present", "a comment asserting a data guarantee is a claim to verify"); code-derived thesis figures that rebuild from source.
