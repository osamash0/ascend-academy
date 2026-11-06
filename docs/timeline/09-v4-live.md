# Phase 09 — v4 live for real people (2026-10-20 to 2026-10-30)

*Written 2026-11-04 from merged PRs (#96, #98, #106 to #163), their descriptions and comments, the first-parent history of `origin/main`, and the specs, plans and runbooks named below. Diffs were read only where a PR left a point open. "Abi" in the repo's docs is Abdullah.*

## Summary

At the start of the phase, v4 (the Spaces / reader app) existed on `main`, but most of it ran on fixture data and it was not what production served. Learners still used the classic rooms (`/dashboard`, `/course/*`, `/lecture/*`). Over eleven days, v4 was wired to real data (#96), sign-up and first run were moved onto the v4 stage (#115), the classic student rooms were retired for students (#126), and the frontend build was fixed so that v4 flags could reach production at all (#136). The reader became an "instant reader": a dropped PDF opens at once and Luna's features switch on page by page while the parse runs (#139, #145). Around the product, the phase also closed audit findings (#110, #112, #114), set up legal pages, monitoring, encrypted off-site backups and a move to the `learnstation.app` domain (#141 to #162), and rebuilt the documentation (#151, #152, #154). At the end of the phase, prod served v4 to learners, while real usage was near zero (CLAUDE.md, START_HERE.md).

## Where the time went

| Area | Commits touching | Lines changed (share) |
|---|---|---|
| docs | 56 | 35,854 (29%) |
| frontend-v4 | 107 | 25,672 (21%) |
| backend-parser | 83 | 25,179 (20%) |
| tests-backend | 145 | 16,112 (13%) |
| frontend-classic | 45 | 5,595 (4%) |
| backend-other | 69 | 5,584 (4%) |
| i18n | 47 | 3,392 (3%) |
| tests-frontend/e2e | 24 | 2,580 (2%) |
| backend-ai/luna | 21 | 2,134 (2%) |
| database, infra/ci, thesis, other | 40 | 2,281 (2%) |

337 non-merge commits on all refs, all under Abdullah's git name. Commits per day: 62 on 10-24, 5 on 10-25, 48 on 10-26, 73 on 10-29 and 149 on 10-30. There are no commits from 10-20 to 10-23. Merges to `main` happened in four batches: 10-24, 10-26, 10-29 and 10-30. Osama does not appear as a commit author in this phase. The PRs are on his GitHub repository (`osamash0/ascend-academy`).

- **Docs are the largest share by lines.** [Inferred] This comes from three sources: the documentation reset (#151, #152, #154; CHANGELOG, INVENTORY, runbooks), the domain-move log (`docs/ops/2026-10-30-learnstation-app-move.md`, 19 commits, the second most-touched file) and the parser benchmark design spec (16 commits). A lot of the work in this phase was recording what prod really is, not building features.
- **The reader was the churn hotspot.** `LessonFacesScreen.tsx` was touched in 31 commits and is the most-fixed file (18). Its test file `lessonFaces.test.tsx` comes next (17 touches, 10 fixes). [Inferred] This fits the PRs. The instant reader (#139), Luna lights up (#145), the rehearsal papercuts (#140) and the punch-list reader fixes (#143, #147, #153) all changed the same screen within two days, and two fixes for one race condition collided (#143 vs #145, fixed in #149).
- **`src/App.tsx` was fixed 10 times.** [Inferred] Routing was reworked several times: role redirects (#111), first-run and `?next=` (#113, #124), retiring the classic rooms (#126) and classic-tool gates (#155).
- **Backend-parser lines are partly benchmark tooling.** `test_parser_bench_store.py` and `backend/eval/parser_bench/store.py` are among the most-fixed files. [Inferred] Much of the "backend-parser" line count in this phase is the start of the parser benchmark (Phase 10), not the production parser. That work sat on the local branch `claude/file-upload-workflow-e9126d`, which was later squashed into #168.
- **"fix" is the most common message keyword (150 of 337).** [Inferred] The phase was mostly about release blockers from the punch list and audits, not new features. The "revert" matches in the stats are false positives ("undo as retract" in benchmark commits).
- **Most PRs say they were written with Claude Code.** Nearly every PR in this phase ends with "Generated with Claude Code". #160 and the domain-move log were written by Codex (another AI coding agent) [Confirmed: #160 and #162 bodies].

## Entries

### 2026-10-24 — v4 runs on real data (#96)
- **What happened:** v4 stopped being a design study on fixtures. A new endpoint, `GET /api/v1/v4/world`, loads the viewer's Spaces, Lessons, activity, XP, social graph and notes. Reading now writes `student_progress`, the streak and `slide_view` events. Practice uses real quiz questions graded on the server, and the ask bar uses the grounded course tutor. Everything stays off until `FEATURE_V4=1` and `VITE_V4_DATA_MODE=live` are set. A "seam" test acts as a ratchet: the number of screens that still import mocks can only go down (32 → 13).
- **Decision:** Fixtures and live data share one interface (`data/world.ts`). In a production build, v4 can only exist with live data.
- **Why:** "so the fixture world can never reach real users" [Confirmed: #96 body]. Two migrations were applied to prod by hand before the merge (2026-10-13, after a pg_dump). One fixed the tutor and search joining embeddings on `lecture_id`, while embeddings are stored by `pdf_hash`, so "most slides were invisible (in the old app too)" [Confirmed: #96].
- **Sources:** PR #96 (merge 042d932e); `src/features/spaces/data/world.ts`; migrations `20261014000000_match_slides_scoped_by_pdf_hash`, `20261014010000_v4_notes`.

### 2026-10-24 — Dependency advisories turn CI red; fixed (#106, #108)
- **What happened:** The nightly dependency scan had been red since 2026-10-21 with no code change, because new advisories hit Pillow, pypdf and zod. Two PRs fixed it on the same day: Pillow 13, pypdf 6.21.2, zod 3 → 4, and `fastembed` removed because it pinned `pillow<13`.
- **Decision:** Upgrade instead of ignoring. #108 removed the dev-only dependency that blocked the upgrade. #106 had proposed dev-only ignores for it.
- **Why:** The advisories hit "what parses user uploads (Pillow, pypdf) and what ships to the browser (zod)", and prod ran affected versions [Confirmed: #108 body]. The red scan also made every open PR red [Confirmed: #106].
- **Sources:** PRs #106, #108; `backend/requirements*.txt`, `.github/workflows/ci.yml`, `src/pages/Auth.tsx`.

### 2026-10-24 — Students' parse spend is attributed and capped (#98)
- **What happened:** Every parse-time LLM call is now recorded against the uploader and the course in `llm_calls`. A new setting, `LLM_PARSE_BUDGET_ENFORCE` (default `students`), refuses or stops a student's parse once their monthly budget is used. Professors' parses are attributed but never refused.
- **Decision:** Cap students by default. Do not count professor parses toward the per-user total that interactive features check.
- **Why:** Before this, parse calls ran with `user_id=None`: "Nobody was billed for that spend, and no cap applied to it." Counting professor parses "would have let one large course upload lock a professor out of those features for the month" [Confirmed: #98 body]. The PR lists its own gaps, for example bounded overshoot and refusals counted as successful jobs.
- **Sources:** PR #98 (bec1b948); `docs/superpowers/plans/2026-10-13-arc-9-ledger.md`.

### 2026-10-24 — Codebase audit, weeks 1 and 2 (#110, #112)
- **What happened:** Fixes from the 2026-10 codebase audit. Week 1 (#110): the AI tutor endpoints now follow the same lecture-visibility rule as RLS. Two title endpoints that always failed were fixed. Error messages no longer leak exceptions. Two fail-open controls now fail closed. Sentry Session Replay was removed and PII scrubbed. The privacy page now lists the real processors (it had claimed AI runs on local Ollama). An RLS migration scoped several policies. Week 2 (#112): erasure gaps closed, an upload-quota bypass closed, failed AI returns errors instead of canned output, rate limits shared across workers, and the stored tutor events no longer keep the model's reply.
- **Decision:** Every change was written test-first. The migration had to be applied to prod by hand.
- **Why:** These were the week-1 and week-2 items of the audit summary [Confirmed: #110, #112 bodies]. The audit documents are on a local-only branch and are not described here.
- **Sources:** PRs #110 (560ba7cf), #112 (8228f32c); `supabase/migrations/20261024000000_audit_week1_rls.sql`; `backend/core/sentry.py`; `src/lib/tutorEvents.ts`.

### 2026-10-24 — Release punch list and routing blockers (#111, #113, #116 to #118, #120)
- **What happened:** A routing/UX audit of `milestone/2026-10-release` and a release punch list with `LS-NNN` ids became the tracker. #111 fixed a redirect loop (admins, or anyone whose role lookup failed, bounced between `/dashboard` and `/onboarding` until the tab ran out of memory) and wired sign-out, export and delete in v4. #113 made "Start learning" open sign-up and kept shared links through sign-in, with an open-redirect guard (`safeNextPath`). #116 to #118 and #120 closed punch-list items LS-003 to LS-020 (8-character passwords, Settings showing only real controls, German strings, phone layout).
- **Decision:** v4 Settings in live mode shows only controls that are stored. Switches without a backend were removed (LS-003). The password minimum became 8 (LS-020, "decided 2026-10-24").
- **Why:** The switches "had no storage behind them and snapped back", and two of them were privacy settings [Confirmed: #117]. The redirect loop is described in #111.
- **Sources:** PRs #111, #113, #116, #117, #118, #120; `src/lib/routes.ts`; the shared artifact "Learnstation Release Punch List".

### 2026-10-24 — The public lecture-pdfs bucket is closed on prod (#114)
- **What happened:** While applying #110's migration, a read-only `pg_catalog` probe showed that an older migration (`20260503000002`) had never been applied to prod. The storage bucket for lecture PDFs was still public, including private student uploads, and write rights were too broad. Two migrations fixed this in a safe order: reads were made private at once (applied by hand the same day and verified), and owner-only writes followed after a frontend change.
- **Decision:** Split the fix so prod could take the read fix immediately and the write fix after the frontend deploy.
- **Why:** The broad write policy "could not simply be dropped", because the legacy client uploaded the PDF before the lecture row existed [Confirmed: #114 body]. This is the clearest case in the phase of prod drifting from what the migration files say.
- **Sources:** PR #114 (70890fd9); migrations `20261024010000_lecture_pdfs_private_reads.sql`, `20261024020000_lecture_pdfs_owner_writes.sql`; `backend/tests/db/test_lecture_pdfs_private.py`.

### 2026-10-24 — Sign-up and first run move onto the v4 stage (#115)
- **What happened:** Sign-in, sign-up and onboarding were redrawn on the black v4 stage with a live Luna. The 1,306-line cinematic onboarding was replaced by a first run of about 20 seconds: a name, then a choice of Luna's light. The role picker was removed, and university and programme questions are no longer asked at first run.
- **Decision:** Everyone signs up as a learner. "Teaching is owning a Space."
- **Why:** [Confirmed: #115 body for the role rule.] [Inferred] The shorter first run fits the later "no questions at the door" principle in `2026-10-26-library-and-spaces-design.md`. #115 itself gives no reason for dropping the university steps.
- **Sources:** PR #115 (6451018e); `src/lib/firstRun.ts`; removed `src/pages/Onboarding.tsx`.

### 2026-10-24 — The reader opens without a blank wait (#119)
- **What happened:** The Lesson Faces reader showed a black screen for several seconds. The cause was that pdf.js only requests the file once its 1 MB worker is running, and the worker started late. Fix: one shared, pre-warmed `PDFWorker`, a placeholder outside `<Document>`, and neighbouring pages drawn only after the current one.
- **Decision:** Measure first. The PR rules out the backend call and range loading as causes.
- **Why:** [Confirmed: #119 body, "What was slow"].
- **Sources:** PR #119 (32f866c7); `src/components/pdf/worker.ts`.

### 2026-10-26 — Shared links survive join, sign-up and email confirmation (#122, #124)
- **What happened:** A link to a Lesson in a Space the viewer had not joined now offers Join and then opens the same URL (#122, LS-045). A shared link now survives sign-up, the confirmation email and first run, because it is carried in the URL as `?next=` (#124, LS-047). Both were browser-verified with throwaway accounts that were deleted afterwards.
- **Decision:** Keep `next` in the URL, not in storage.
- **Why:** So that it "also survives the confirmation email opening in a new tab". "Someone invited by a shared link is the likeliest new person" [Confirmed: #124 body].
- **Sources:** PRs #122, #124; `SpaceMemberGate`, `confirmReturnUrl`.

### 2026-10-26 — Luna study sessions, behind a flag (#125, #135)
- **What happened:** A study partner beside the reader. Luna proposes a 3–5 step plan, turns pages and highlights phrases, ends with a wrap-up card that can become review cards, and keeps a small editable memory ("What Luna knows about you"). It uses one migration (`20261025000000_luna_sessions.sql`, three new tables with owner-only RLS), applied by hand. The PR also fixed an older issue in the review endpoints that could have exposed other people's owned cards once owned cards existed. #135 (10-29) added a provider fallback chain with 15 s per attempt, so a hung provider does not stall a session.
- **Decision:** Luna is "a layer on the reader: the page stays the centre". The memory rejects grades, scores, emails and phone numbers. Flag off by default (`FEATURE_LUNA_SESSIONS`).
- **Why:** [Confirmed: spec `docs/superpowers/specs/2026-10-24-luna-study-sessions-design.md`, "The principle this serves"; #135 body for the fallback.]
- **Sources:** PRs #125 (222225af), #135 (a812e803); spec and plan `2026-10-24-luna-study-sessions*`.

### 2026-10-26 — Classic rooms retired for students; owners run their Space on the stage (#126, #128/#130)
- **What happened:** v4 students could fall into the classic app, for example through "New Space", wrong-role redirects or old links, and find "a second Luna tour, a badge popup, a different settings page, and progress numbers that disagreed with v4". #126 redirects every classic student room to its v4 room and adds `POST /api/v1/v4/spaces`, which creates a private draft. #128 added an owner bar (add a Lesson, make it visible). Because it was stacked on #126 and merged into #126's branch 13 seconds after #126 had merged, its commits never reached `main`. It was re-landed unchanged as #130.
- **Decision:** "Retire the classic student app for v4 students, and fix New Space from the root." Professors and admins keep the console. Owner uploads stay outside the monthly quota.
- **Why:** [Confirmed: #126 body, "Decision (Abi)"; #128 body, "Abi's call, 2026-10-26", for the quota.] No reason is recorded for leaving owner uploads outside the quota.
- **Sources:** PRs #126 (8c2c0de4), #128, #130 (25c28c29); `StudentV4Redirect`, `LessonLinkRoute`, `OwnerBar`.

### 2026-10-26 — An account that owns lessons can be deleted again (#129)
- **What happened:** Deleting an account that owned slides failed on prod. The cause was one trigger function without `SECURITY DEFINER`, which ran as Supabase's auth role and had no right to update `lectures`. Tests had passed because they deleted as the superuser.
- **Decision:** Make the function `SECURITY DEFINER` like its siblings. Add a test that deletes as a role shaped like the auth role.
- **Why:** [Confirmed: #129 body.] A GDPR erasure path was broken in prod.
- **Sources:** PR #129; migration `20261026000000_content_revision_trigger_definer.sql`; `backend/tests/db/test_account_erasure_as_auth_role.py`.

### 2026-10-26 — Product direction agreed: "drop anything, read it now" (spec)
- **What happened:** A design spec set the direction for the Library and Spaces. Three decisions: read instantly (a dropped PDF opens from the device before the upload finishes), ghost Spaces (Luna suggests a Space and one tap makes it real), and private by default. It also decided to upgrade the one existing reader (`LessonFacesScreen`) rather than build a second one. The same day, a spec for "How it's landing" (the owner's analytics view) was written.
- **Decision:** "Drop anything. Read it now. Luna makes it smarter while you read." No sorting, forms or questions at the door.
- **Why:** "Most people are lazy about files." Exam dates and teaching are options inside a Space, not questions at the door [Confirmed: `docs/superpowers/specs/2026-10-26-library-and-spaces-design.md`].
- **Sources:** specs `2026-10-26-library-and-spaces-design.md`, `2026-10-26-how-its-landing-design.md`; plan `2026-10-26-instant-reader.md`; spec commits 521a8fcb, 0d963303 on local branch `claude/main-review-5682b7`.

### 2026-10-29 — Reader performance: 16 KB range chunks and packed PDFs (#131, #132)
- **What happened:** On an 82-page deck, pdf.js fetched about 1.9 MB before page 1, although page 1 uses about 0.25 MB. #131 set `rangeChunkSize` to 16 KB: in a bandwidth-capped benchmark at 10 Mbit, page 1 then needed 0.95 MB and 0.9 s instead of 1.9 MB and 1.8 s. #132 rewrites the reader's copy of each uploaded PDF with qpdf (pikepdf) so its objects are packed into object streams. On four real decks, the bytes before page 1 fell, for example from 1,450 KB to 67 KB on a PowerPoint export, with zero pixel or text changes. The original is kept for parsing.
- **Decision:** 16 KB rather than 8 KB. Fall back to the original file on any error, encryption, a changed page count or growth over 10%. Kill switch `PDF_COMPACT_ON_UPLOAD=0`.
- **Why:** Smaller chunks mean more requests once real latency is added. The latency effect was not measured ("my latency simulation was faulty and I dropped it") [Confirmed: #131 body]. Re-encoding images had made files bigger, so images were not the cause [Confirmed: #131].
- **Sources:** PRs #131 (22c77e76), #132 (90790029); `src/components/pdf/worker.ts`, `backend/services/parser/compact_pdf.py`.

### 2026-10-29 — Flags reach the prod frontend build (#136, LS-037)
- **What happened:** `.dockerignore` drops `.env`, and `VITE_*` values only reach the bundle when the Dockerfile declares them as build args and compose passes them. The v4 switches were never passed, so "setting them on the server did nothing and prod could not ship v4". Each `VITE_FEATURE_*` is now derived from its backend flag in `docker-compose.prod.yml`. A unit test fails if the app reads a flag the build does not pass.
- **Decision:** Derive each UI flag from its backend flag, "so a screen never ships without its routes".
- **Why:** [Confirmed: #136 body.]
- **Sources:** PR #136 (76f0bdaf); `Dockerfile.frontend`, `docker-compose.prod.yml`, `backend/tests/unit/test_frontend_build_flags.py`.

### 2026-10-29 — Rehearsal on real data; v4 goes live (#140, #137, #134)
- **What happened:** v4 was rehearsed on real data "before it went live", and six papercuts were fixed (#140), for example a streak of 2 on Home but 1 on Profile, and the owner counted as 0 members. The Spaces hub was redrawn so that each Space is a round window onto its own first page, with a gold progress ring and faces instead of counts (#137). #134 removed committed default passwords from seed scripts (the accounts had already been rotated). CLAUDE.md records that the v4 UI is what prod serves "since 2026-10-29".
- **Decision:** In #137, show, don't count: "No numbers on screen; the accessible names keep the counts." Faces are shown only for Spaces the viewer is in.
- **Why:** [Confirmed: #137, #140 bodies; #134: "The repo is public, so no credential belongs in it."] [Inferred] The "one fact, once" and "show, don't count" rules in CLAUDE.md are where #137's design comes from.
- **Sources:** PRs #134, #137 (c05cb88c), #140 (41f63859); CLAUDE.md "What this is".

### 2026-10-30 — Instant reader and "Luna lights up" (#139, #145)
- **What happened:** #139 turned the reader into a cinema view for slides and a scroll view for documents, with video-player controls and a timeline (white = where you are, grey = how far Luna has read). A dropped file opens from the device at once, and a new endpoint `GET /api/v1/v4/uploads/{run_id}/reading` reports progress. #145 made Explain, Text and Ask appear per page as Luna writes them, and moved the handover to the full reader from "run complete" to "first pages written" (about 50 s into a 120-slide deck). Practise waits for the end.
- **Decision:** Three decisions from the 2026-10-29 spec: full reader early, practise at the end with no parser change, and pages Luna has not reached show only the page.
- **Why:** In a live test on an 82-slide deck, the full reader arrived after 703 s, "and the last ~3.5 min of it came after Luna had already written every page" [Confirmed: `docs/superpowers/specs/2026-10-29-luna-lights-up-design.md`].
- **Sources:** PRs #139 (058b83a1), #145 (f3245a88); plan `2026-10-26-instant-reader.md`; spec and plan `2026-10-29-luna-lights-up*`.

### 2026-10-30 — "How it's landing": reader telemetry and the Space engine (#133, #142)
- **What happened:** Plan 1 (#133): the v4 reader writes validated `learning_events` through one safe writer. These include reading sessions that do not count covered or hidden time, navigation, Explain/Ask counts, and a "Clicked / Still foggy" check-in at checkpoints. The join screen says that owners can see how pages are read. Plan 2 (#142): an owner-only endpoint computes a Space view on the server, reusing the 11 existing insight detectors. Nothing calls it yet; "the door" is Plan 3.
- **Decision:** A floor of five distinct readers behind every printed share. Members' questions are shown only as AI themes, and themes that echo a question are dropped in code. Nothing from Luna is recorded. Per-person views stay off.
- **Why:** Spec decisions (Abi, 2026-10-26): owners never get row-level reads of members' activity [Confirmed: `docs/superpowers/specs/2026-10-26-how-its-landing-design.md` §0].
- **Sources:** PRs #133 (43e4a97c), #142 (a8a6aa16); `backend/services/insights/`; plans `2026-10-26-how-its-landing-plan-1-*`.

### 2026-10-30 — People in your Spaces see you only if you opt in (#146, LS-036)
- **What happened:** A new column, `profiles.show_in_spaces` (default off), controls whether classmates see a person's name, picture and XP in rankings and on Space cards. Friends always see each other. People without a name show as "Learner" instead of the part of their email before the @.
- **Decision:** Off by default, with a switch in Settings and a one-click offer in Social.
- **Why:** "Privacy by default (Art. 25(2) GDPR)". Public Spaces can be joined by anyone, and 56 of 208 profiles had no name [Confirmed: #146 body].
- **Sources:** PR #146 (d40947eb); migration `20261030000000_show_in_spaces.sql`.

### 2026-10-30 — Punch-list reader fixes and red CI on main (#143, #147, #149, #153)
- **What happened:** #143 fixed progress being wiped by a look back (LS-055) by adding a high-water mark `furthest` to the reading trail. #147 fixed six reader confusions (LS-053 to LS-061). A race where a late `?page=` write bounced the reader back to the previous Lesson was fixed twice at once: in the app (#143) and in a test (#145). The two fixes together made `main`'s CI red on every run, until #149 limited the guard to the browser router. #153 fixed Back with Explain open after checking it on the live site.
- **Decision:** none recorded beyond the fixes.
- **Why:** [Confirmed: #143 ("has failed main's CI since c1ff7338") and #149 bodies.]
- **Sources:** PRs #143, #147, #149 (9fb81a09), #153; `src/features/spaces/data/trail.ts`.

### 2026-10-30 — Legal pages and processors (#141, #144, #150, #159, #165 later)
- **What happened:** The Impressum and privacy policy got the real operator and only services in use (LS-001, LS-002). Resend was named once it sent the account emails (#150). Contact moved to addresses on the project's own domain, and Cloudflare was named as a processor (#159).
- **Decision:** The privacy page must name every processor actually in use. A test checks this.
- **Why:** [Confirmed: #150 ("Resend receives the address and the content of that email, so the privacy policy has to name it"), #159.]
- **Sources:** PRs #141, #144, #150, #159; `LegalPages.test.tsx`. (Personal contact data in these PRs is not repeated here.)

### 2026-10-30 — Documentation reset (#151, #152, #154)
- **What happened:** Three PRs. #151 added the first `CLAUDE.md`, `docs/START_HERE.md` and `docs/prompts/`. #152 added `docs/INVENTORY.md` (93 markdown files, each marked current, historical or reference), banners on 29 historical docs, a README rewritten for v4, four runbooks (`deploy-main-to-prod`, `apply-a-migration-by-hand`, `rotate-a-secret`, `local-dev`) and a CHANGELOG of every merged PR. #154 was a text pass over all 26 i18n namespaces: 77 strings fixed for glossary, Luna's name and honesty, and 120 dead keys deleted.
- **Decision:** The repo, not per-machine memory, has to carry the facts. Copy may not promise features that do not exist.
- **Why:** "The repo had no `CLAUDE.md`. Every Claude session started cold from per-machine memory files, which the repo cannot depend on and no other person can see. README still describes v3.0." [Confirmed: #151 body]. The migration runbook records that the prod ledger "holds 2 rows for 136 files" and forbids `supabase db push` [Confirmed: `docs/runbooks/apply-a-migration-by-hand.md`].
- **Sources:** PRs #151 (be43c317), #152 (d25ef5fe), #154 (899a83c3); `docs/prompts/2026-10-30-documentation-reset.md`; `docs/COPY_AUDIT_2026_10.md`.

### 2026-10-30 — Move to learnstation.app (#160, #162)
- **What happened:** The app moved to `learnstation.app` (DNS on Cloudflare, DNS only; TLS; CORS; Supabase Auth URLs; old hosts redirect to the apex). The move was carried out step by step by Codex, with Abdullah doing the dashboard steps and user tests. Each step has evidence and a rollback in the move log. Codex could not open its PRs because its GitHub connector got HTTP 403, so Claude opened #160 (token-hash recovery links on the reset page) and merged the log in #162, together with a new runbook for domain, DNS and email.
- **Decision:** Keep Cloudflare on "DNS only". The runbook's "Do not" list explains why (proxy limits, rate limits, the status page).
- **Why:** [Confirmed: #160, #162 bodies; `docs/ops/2026-10-30-learnstation-app-move.md`.] [Inferred] The reason for leaving the old hosts is not stated in these PRs; the move log's checkpoints suggest a planned switch to a stable own domain for auth emails.
- **Sources:** PRs #160 (64374dc0), #162 (2a367069); `docs/runbooks/domain-dns-and-email.md`.

### 2026-10-30 — Monitoring, encrypted backups and a heartbeat that paged wrongly (#158, #161)
- **What happened:** #158 added a 5-minute server heartbeat (API health, containers, HTTPS, disk, memory, TLS certificate) to Better Stack, and nightly database dumps encrypted with `age` and copied to Cloudflare R2. The restore was tested on prod. The decryption key never touches the server. The same evening, the worker heartbeat lapsed while four parses filled every Arq job slot, so `/health/ready` returned 503 and a healthy, busy worker would have paged as dead. #161 moved the heartbeat to a background task beside the job pool.
- **Decision:** Free tiers only. Crons that share the job pool stay as they are for now.
- **Why:** "On 2026-10-30 the prod box had no alert that reached anyone, and its only database copies lived on the box itself" [Confirmed: #158]. Arq crons "wait for a free `max_jobs` slot like any parse" [Confirmed: #161, with log times]. A reserved slot for crons is "worth doing only when real load shows it matters" [Confirmed: #161].
- **Sources:** PRs #158 (97766b28), #161 (f2d801e8); `deploy/server/heartbeat/`, `deploy/server/offsite-backup/`, `docs/runbooks/monitoring-and-backups.md`, `backend/core/worker_heartbeat.py`.

### 2026-10-30 — Batch replies no longer leave slides empty (#163)
- **What happened:** A student's upload on prod stored slides with empty summaries. Replaying the prompt showed the model's replies were well-formed. The bug was in mapping replies back to slides: items were matched by list position, without checking page numbers or summaries, and the fallback row for a missing slide looked like real content.
- **Decision:** Match by `page_number` or echoed `index`, and count an item only if it has a summary.
- **Why:** [Confirmed: #163 body, "Root cause".] Prod keeps no raw replies, so the cause had to be found by replay.
- **Sources:** PR #163 (bec2acd4); `batch_analyze_text_slides`, `unified_orchestrator._synthesize_text_slide_batch`.

### 2026-10-30 — Parser benchmark designed
- **What happened:** A design spec for a thesis-grade benchmark of PDF text extraction. It names the five problems the current raw PyMuPDF text shows on a real deck: wrong symbols, footer junk, wrong order, broken lines and no structure. It also fixes 10 contenders, 24 pages, and blind pairwise duels judged by Abdullah. The protocol was frozen and the first comparison created the same day (see Phase 10).
- **Decision:** Run on the developer's Mac, never on the prod server. Judging by one human judge, blind. Automatic checks never decide the ranking alone.
- **Why:** "The reading face shows each page's parsed text, and every learning feature starts from it" [Confirmed: `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md`, "Why"].
- **Sources:** `docs/superpowers/specs/2026-10-30-parser-benchmark-design.md`; `backend/eval/parser_bench/` (landed in #168).

## Challenges

**[Confirmed]**
- **Prod drifted from the code.** A storage migration from May had never been applied to prod, so a bucket stayed public (#114). The prod migration ledger has 2 rows for 136 files, so every migration is applied by hand and checked with `pg_catalog` probes (`docs/runbooks/apply-a-migration-by-hand.md`; #110, #114, #125, #129 all say "apply by hand").
- **Flags did not reach the build.** v4 could not ship on prod until #136, because `VITE_*` values were never passed as build args. Sentry's browser DSN had the same problem until #165 (Phase 10).
- **Red CI on main, twice.** New advisories made the SCA job red from 2026-10-21 (#106, #108). Two colliding fixes for one reader race made a test fail on every `main` run (#143 → #149).
- **A stacked PR merged into a dead branch.** #128 never reached `main` and had to be re-landed as #130.
- **Tests that passed for the wrong reason.** Account deletion worked as the superuser but failed as the auth role (#129). A title endpoint failed on every request because tests patched the very symbol that was broken (#110).
- **The heartbeat paged a busy worker as dead** (#161).
- **Near-zero usage.** START_HERE.md lists "usage is near zero since August" among the known gaps. The phase was spent getting v4 live and safe for real people, before any real people were using it.
- **Agent tooling limits.** Codex's GitHub connector returned 403, so its move log and #160 were opened later by another session (#160, #162).

**[Inferred]**
- **Deploy lag.** CLAUDE.md says #159 to #161 were merged but not deployed at the end of the phase, and #144 mentions a separate `deploy/legal-20261030` branch on the server because other merged PRs were "still waiting". Several states (main, server checkout, running images) existed at once.
- **Concurrent sessions on one tree.** CLAUDE.md asks to re-run `git status` before every commit because several sessions share one working tree. Together with the stacked PRs (#112 on #110, #113 on #111, #128 on #126, #152 on #151), this probably explains part of the re-work.

## Open questions

- Why were university and programme questions dropped from first run in #115? The PR states it but gives no reason.
- Why are an owner's Lesson uploads outside the monthly quota (#128, "Abi's call")? No reason is recorded.
- When exactly was v4 switched on in prod: the 2026-10-29 rehearsal (#140), or after #136 was deployed? CLAUDE.md says "since 2026-10-29", and the last full deploy was main @ 35a30d73 on 10-30.
- No commits exist from 10-20 to 10-23. Was this time spent on something outside the repo (for example, thesis writing)?
- Why the move to learnstation.app on 2026-10-30, and why then? The move log records how, not why.
- Was the "privacy call" on per-person views (Strugglers, Journey) ever made? #142 leaves them off pending it.
- Is Osama involved in this phase in any way other than owning the repository (reviews, decisions)? Nothing in the PRs shows it.

## Thesis hints

- **Requirements:** The library-and-spaces spec (four situations, "no questions at the door", private by default) and the punch list (LS ids) are real requirement sources. Privacy requirements: #146 (Art. 25(2) GDPR, opt-in visibility), #129 (erasure must work), the floor of five readers in "How it's landing" (#142). The parse-spend cap (#98) is a cost requirement.
- **Design:** "Upgrade, don't replace" for the one reader. Luna as a layer beside the page (study-sessions spec). The handover at "first pages written" (Luna lights up spec, with the 703 s / 3.5 min measurement as motivation). The fixture/live seam with a ratchet test (#96). Deriving UI flags from backend flags (#136).
- **Implementation:** The reading endpoint and per-page readiness (#139, #145). Range chunks and object-stream packing with measured byte counts (#131, #132), a good small quantitative example. The batch-reply mapping fix (#163) shows why LLM output must be matched by id, not by position.
- **Evaluation:** #131/#132 benchmark tables (bytes and time to page 1). #140 as a pre-launch rehearsal on real data. The parser benchmark design (spec of 10-30) starts here; results are in Phase 10.
- **Methodology / process:** Almost all work was done by AI coding agents (Claude Code; Codex for the domain move and #160) under one developer's direction, with test-first PRs and browser checks. The documentation reset (#151, #152) is a direct response to agents losing context between sessions. Prod/code drift and the hand-applied migration ledger are good material for a "lessons learned" section.

## In short

Phase 09 took v4 from fixtures to the app prod serves. It covered real data, a v4 sign-up and first run, retired classic rooms, an instant reader whose features switch on page by page, owner telemetry with privacy floors, and opt-in visibility. In parallel it fixed audit findings and a public storage bucket, added legal pages, monitoring, encrypted backups and a domain move, and rebuilt the docs. The hard parts were prod drifting from the code, flags missing from the build, and red CI on `main`. Real usage stayed near zero.
