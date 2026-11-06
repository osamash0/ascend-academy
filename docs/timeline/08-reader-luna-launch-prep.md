# Phase 08 — Reader intelligence, Luna, launch prep (2026-10-01 to 2026-10-19)

*Written 2026-11-04. Sources: `git log --all` for the date range, `gh pr view` for PRs #72 to #105 (and #121), the plan and ledger files under `docs/superpowers/`, `docs/DECK_LAB_2026_10.md` and `CHANGELOG.md`. Diffs were read only for a few commits. Commit counts measure activity, not hours.*

## Summary

At the start of the phase, the v4 app was a design study on fixture data. The lesson reader existed only as an uncommitted prototype, the brand was purple, the parser read "the first N slides" of a deck, and the AI layer still called a chain of free-tier providers. No real work was committed between 2026-09-19 and 2026-10-09; all 377 commits fall on six days from 2026-10-10 to 2026-10-18. By the end, the reader had Explain, checkpoints, "fading light", exam rehearsal, Teach it back and an exam date plan, wired to a real course behind a flag. Luna had become one avatar used across the app. The parser planned the deck before calling a model, and the quiz was checked against its source slides. The AI layer could run on one OpenAI account with spend caps. v4 had German text, GDPR export and erasure were complete, and production got its first full rebuild since 2026-08-17. Almost all of this work was done in Claude Code sessions: 375 of the 378 commits in the range carry a `Co-Authored-By: Claude …` trailer, and all 35 PR bodies in #72–#105 end with "Generated with Claude Code".

## Where the time went

| Area | Commits touching | Lines changed (share) |
|---|---:|---:|
| tests-backend | 172 | 13,618 (8%) |
| frontend-v4 | 165 | 80,912 (49%) |
| backend-other | 103 | 10,449 (6%) |
| backend-parser | 61 | 5,259 (3%) |
| docs | 60 | 29,206 (18%) |
| frontend-classic | 42 | 13,977 (8%) |
| backend-ai/luna | 30 | 1,296 (1%) |
| i18n | 26 | 7,348 (4%) |
| tests-frontend/e2e | 20 | 866 (1%) |
| database | 20 | 1,171 (1%) |
| infra/ci/scripts | 12 | 461 (0%) |
| thesis | 6 | 1,946 (1%) |

Commits per day (all refs): 10-10: 85, 10-11: 219, 10-13: 47, 10-14: 2, 10-16: 14, 10-18: 7. Commit types: 175 feat, 117 fix, 44 docs, 28 test, 19 i18n.

Most-touched files: `LessonFacesScreen.tsx` (43), `liveRepository.ts` (38), `StudioCanvasScreen.tsx` (35), `CourseScreen.tsx` (29), `LessonScreen.tsx` (29), `backend/api/v1/v4_reader.py` (25). Most-fixed: `StudioCanvasScreen.tsx` (17), `backend/services/ai/orchestrator.py` (11), `unified_orchestrator.py` (8).

- Half the changed lines are v4 frontend. The reader (`LessonFacesScreen`, `CourseScreen`, `LessonScreen`, `useReader`) and the live-data seam (`liveRepository.ts`) were the centre of the work. **[Inferred: file counts]**
- Backend tests (172 commits) far outnumber backend parser commits (61). The AI-backend session ran "TDD is literal" and "mutation-verify every guard" as rules, so most parser and AI work came with tests first. **[Confirmed: `docs/superpowers/plans/2026-10-10-ai-backend-deep-session.md`, Global Constraints]**
- `StudioCanvasScreen.tsx` is the top "fixed" file. Studio was built as a mock (#91) and then fixed many times in one day. This churn was on a surface that stayed behind a flag. **[Inferred: 17 fix commits on one file; #91 says "mock-only"]**
- `orchestrator.py` had 11 fix commits. These were the cost bugs, the provider pins, OpenAI-only mode and the env-override trap: the AI layer had many silent failures that were found in this phase. **[Inferred: commits listed under entries below]**
- About one fifth of the lines are docs: plans, ledgers, specs and scorecards. Each AI session wrote its decision record into the repo. **[Inferred: docs share plus the ledger files]**
- 219 commits on 10-11 alone means several AI sessions ran in parallel on one day (reader, Luna, brand, AI backend, GDPR, launch prep, Studio). This explains the stacked and re-opened PRs (#80/#81, #85/#83). **[Inferred: branch names and PR bodies]**

Note on the "revert" list in the stats: only `7d4d79c4` (and its doc `99050368`) is a real revert. `bed3266b` and `0229a5a4` match the keyword because their messages mention "Undo".

## Entries

### 2026-10-10 — Stranded parse runs and a course-ownership gap
- **What happened:** The stalled-run sweep only looked at runs stuck in `extracting`. Runs that died in `queued` were never timed out; production had 16 such rows, the oldest from July. A second pass now fails `queued`/`pending` rows after 6 hours, without recovery, and `/retry` restarts the clock (#72). Separately, the single-file upload route accepted a `course_id` without checking that the caller owns that course; it now uses the same ownership check as the batch route (#73). Both were AI-written PRs.
- **Decision:** A queued run is failed, never "recovered". Missing and foreign courses return the same 403.
- **Why:** A queued row may point at a previous attempt's slides, so recovering it "would report another attempt's work as this one's". The upload job writes over asyncpg, which bypasses RLS, so the endpoint check was the only gate. **[Confirmed: PR #72 and #73 bodies]**
- **Sources:** #72, #73; `backend/tests/integration/test_upload_course_ownership.py`.

### 2026-10-10 — The dependency scan goes green after ten red nights
- **What happened:** The SCA job had failed every night since 2026-09-30. pypdf was raised, Docling and LiteLLM were removed from `requirements.txt`, and `npm audit fix` cleared production advisories. The npm gate now fails only on production dependencies.
- **Decision:** "Gate on what ships": dev-tool advisories are printed but do not fail CI.
- **Why:** Docling and LiteLLM were imported only by `backend/_legacy/`, and the production image had dropped them long ago. The remaining dev advisory (braces) "covers every published version (no fix exists)". **[Confirmed: commit `58114939`, PR #73]** What replaced Docling: the production image already used PyMuPDF (`PyMuPDF==1.24.0` in `requirements-docker.txt`); its comment says Docling was only a lazy import for parser v3/v4. The AI-backend plan lists PyMuPDF (`fitz`) as the PDF library. **[Confirmed: `requirements-docker.txt` at `58114939`; deep-session plan, Tech Stack]** When Docling left the production path is outside this phase.
- **Sources:** `58114939`, #73.

### 2026-10-10 — Silent failures made loud; Cerebras removed from the chains
- **What happened:** #74 added a parity test between the CI and production requirement files, a minimum-passed floor for the nightly DB job (200 tests), blocking ruff rules F821/F811/F841, and a 45-day freshness test for every provider model pin. A live probe found Cerebras returning 402 (payment required); it was removed from both chains, so every call now started at Groq.
- **Decision:** Checks that can pass while nothing runs must fail instead. Pins must be re-verified every 45 days.
- **Why:** Missing packages in the production image hid behind `try/except` imports that only logged; a nightly run where every DB test skipped still went green. **[Confirmed: PR #74 body]**
- **Sources:** #74; `backend/tests/execution_floor.py`, `test_requirements_parity.py`, `test_provider_pin_freshness.py`.

### 2026-10-10 — The reader becomes intelligent (#75)
- **What happened:** The two-faces reader prototype from 09-17/18 was committed and wired to one real course (10 lectures, 756 slides) behind `FEATURE_V4_READER`. It added a one-page deck view, Explain (answers as validated "blocks" and tools such as an FD closure calculator), Ask with sandboxed model-written mini-apps, full-text search, cross-lecture links, exam rehearsal with tool questions graded by computation, rehearsal history (new table `v4_rehearsal_attempts`), checkpoints after each idea, "fading light" after a week, ideas sized to the deck (about one per nine slides), and a liquid-glass page pill.
- **Decision:** Tool questions are graded by computing the answer, "never from the model's answer key". Cross-lecture links use strict matching: "no link is shown rather than a wrong one". Explain and checkpoints are cached per page, revision and language.
- **Why:** Stated as design rules in the PR, not argued further. The sandbox rules (opaque origin, CSP `default-src 'none'`, server drops apps that reach for network or storage) are there because the model writes code that runs in the browser. **[Confirmed: PR #75 body]** The wider reason, "reader first", is a rule in `CLAUDE.md`.
- **Sources:** #75; `docs/READER_TWO_FACES_PHASE_A2.md`, `docs/VIEWER_IMPLEMENTATION_AUDIT.md`; migration `20261010000000_v4_rehearsal_attempts.sql` (applied by hand on 10-10).

### 2026-10-10 — Luna avatar system and the Ask Luna tutor (#76)
- **What happened:** One avatar rule everywhere (photo, then Luna, then initials), the Suit Locker with 56 items earned and never bought, on-device photo crop that strips EXIF, and Ask Luna, a hint-first tutor that answers with widgets (flag off). New students had been saved with a third-party robot image as `avatar_url`; onboarding stopped writing it.
- **Decision:** Items are earned, never bought. In Ask Luna, the model only picks a scenario; the widget computes the right answer.
- **Why:** "no currency, per Doc 1 rule 7". The robot URL hid every student's Luna and made each page view call a third-party image host, which the PR calls GDPR-relevant. **[Confirmed: PR #76 body]**
- **Sources:** #76; `6c0dcf6` (prompt-injection pattern fix); `docs/AVATAR_SYSTEM.md`.

### 2026-10-10 — AI backend Arcs 1–2: plan the deck first
- **What happened:** A new pure module, the Deck Cartographer (`backend/services/parser/deck_plan.py`), turns page texts into a skeleton: boilerplate lines, a role per slide, and sections. Quiz and meta selection now use a section-balanced sampler instead of `slides[:10]` and `slides[:15]`. A survey of 20 real decks found no genuine numbered chapter slides, so recurring agenda ("Inhalt") slides were made to start sections.
- **Decision:** "Move the parser from 'read the first N slides' to 'understand the deck first'", with no LLM call in the planning layer so it can be tested fully.
- **Why:** The old selection only saw the start of a deck, and it renumbered slides after filtering, "which anchored every question to slide 0". **[Confirmed: deep-session plan, Goal; PR #84]** The agenda rule came from data: without it real decks "collapse to 1 section, which makes Arc 2's section-balancing a no-op". **[Confirmed: `docs/superpowers/plans/2026-10-10-session-ledger.md`, Task 3b ruling]**
- **Sources:** #84; `deck_plan.py`; `docs/superpowers/plans/2026-10-10-ai-backend-deep-session.md`, `2026-10-10-session-ledger.md`.

### 2026-10-11 — Arc 3: Provider Chaos Lab finds two live cost bugs
- **What happened:** Fault-injection tests drove the orchestrator through 402/429/503/timeout/garbage-JSON storms. Two production bugs came out: (1) the Google SDK puts the HTTP status on `.code`, so retired Gemini legs were never disabled (about 50 doomed calls per deck in vision); (2) the Arq worker never called `init_redis`, so the OpenAI daily cost ceiling was never enforced where all parsing happens.
- **Decision:** Wire `init_redis()` into worker start-up (added as task A3.6, not in the plan). The fixes were cherry-picked into the launch PR #92.
- **Why:** "without it the fleet-wide openai cost cap and provider daily counts never work in the process that does all parsing". **[Confirmed: session ledger, A3.6 ruling; PR #84 "Prod bugs fixed"]**
- **Sources:** `ec597037`, `5cf00992`, `381d7160`, `b6f10fcc`; `docs/superpowers/plans/2026-10-10-arc-3-chaos-lab.md`.

### 2026-10-11 — Arcs 4–6: grounded quiz, a probe, and the verifier goes advisory
- **What happened:** Each quiz question now cites its source slide and gets a lexical support score (Arc 4). Arc 5 added a `parse_receipts` table and endpoint. Arc 6 built the Deck Lab (`python -m backend.eval.deck_lab`, no LLM calls). Its probe on paraphrased-correct questions measured a 14/16 (87.5%) false-drop rate; all 8 German paraphrases were dropped. Over 25 real decks, quiz input span rose from 0.17 to 0.84, sections covered from 26 to 31 of 31, and the meta pass's last page from 15 to about 61.
- **Decision:** `ENFORCE_SUPPORT_THRESHOLD=False`. Structurally broken questions (no source, slide out of range, no answer) are still dropped; low-overlap questions are kept and flagged. Enforce mode stays behind the constant.
- **Why:** "measured 87.5% false-drop makes hard gating destroy most real (paraphrasing) LLM questions and spend a repair call on each". The ledger had already ruled in Arc 4 that the verifier must not be trusted as a gate before a paraphrase probe was run. **[Confirmed: session ledger, A4.2 and A6.6 rulings; PR #84]**
- **Sources:** #84; `quiz_grounding.py`; `docs/DECK_LAB_2026_10.md`; plans `arc-4-grounded-quiz.md`, `arc-5-parse-receipts.md`, `arc-6-deck-lab.md`.

### 2026-10-11 — Arc 7: real receipts and measured savings
- **What happened:** Per-slide synthesis now sends boilerplate-stripped text (stored content stays raw). A `ContextVar` (`services/ai/call_context.py`) tags every `llm_calls` row with `run_id`, slide indices, prompt name and version. Receipts record provider, model, tokens and cost. Two prompts moved to v3.
- **Decision:** Report real numbers and state the gaps (vision, embeddings and one classifier unmetered) "rather than faked".
- **Why:** The realised saving was measured, not estimated: 14,875 tokens over 25 decks, about 9.4 per synthesised slide. **[Confirmed: PR #84; `docs/superpowers/plans/2026-10-11-arc-7-ledger.md`]** The saving is small; why it was still shipped is not stated. **[Inferred: the main value is the per-call provenance, not the tokens]**
- **Sources:** `42313118`, `04af1642`; migration `20261012010000_llm_calls_run_context.sql`.

### 2026-10-11 — Arc 8: semantic grounding fails a pre-registered gate (#94, revert `7d4d79c4`)
- **What happened:** Arc 8 tested whether an embedding-cosine scorer could make the verifier trustworthy. The threshold was fitted on calibration pairs only, then scored once on 16+16 probe pairs from other decks; both sets were sha256-pinned and the gate was fixed before any embedding was fetched. Result: semantic false-drop 4/16 (gate ≤ 2), false-keep 8/16 (gate ≤ 1). Lexical was 14/16 and 0/16.
- **Decision:** The gate failed and was recorded, not tuned. Production stays advisory. The production wiring was removed (`7d4d79c4`); a new variant would need a new pre-registered arc with a new probe. #94 was closed unmerged and archived as a tag.
- **Why:** Cosines bunch into 0.70–0.91 because the question stem dominates the embedding, so on-topic hallucinations look grounded (7 of 8 German ones were kept). The wiring was "dead hot-path code tied to a model that #92 replaces". **[Confirmed: PR #94 body and closing comment; `99050368`; `docs/superpowers/plans/2026-10-11-arc-8-ledger.md`]**
- **Sources:** #94 (closed), `7d4d79c4`, `99050368`, tag `archive/claude/arc8-semantic-grounding`; `docs/DECK_LAB_2026_10.md` (Semantic grounding).

### 2026-10-11 — Anon could call SECURITY DEFINER functions (#77, #79)
- **What happened:** A production probe found 42 `SECURITY DEFINER` functions callable by `anon`. A few let a caller change other users' XP, streak or badges. The migration revokes them in four groups and was applied to production in one transaction before the PR went public. The DB test bootstrap now mirrors Supabase's default grants, and a test asserts that no such function is anon-executable. #79 renamed a Luna migration that had the same timestamp.
- **Decision:** Revoke from `anon` and `PUBLIC` explicitly; grant `authenticated` only where the function is guarded.
- **Why:** Supabase grants EXECUTE directly to `anon` and `authenticated`, so `REVOKE … FROM PUBLIC` left the grants in place, and CI missed it because its bootstrap lacked those defaults. Duplicate timestamps had silently skipped a migration in production before. **[Confirmed: PR #77 and #79 bodies]** This issue is fixed.
- **Sources:** #77, #79; `20261011000000_revoke_anon_security_definer_execute.sql`; `backend/tests/db/test_anon_security_definer_exposure.py`.

### 2026-10-11 — Monochrome brand and the stage everywhere (#78, #86, #93)
- **What happened:** The purple brand was removed; the black "stage" of the reader became the ground of every v4 room. The landing page became a live demo page. Visible copy changed from course/lecture/slide to Space/Lesson/page. Practice moved onto the stage with "the light is the progress" and a second look at misses (#86). The console top bar was fixed for phones (#93).
- **Decision:** Four review calls by Abdullah: no purple brand; one fact, once per screen; the landing page should be the product; never "course", "lecture" or "slide" in UI copy.
- **Why:** The new lecture overview "looked like a different product from the rest of the app". **[Confirmed: PR #78 body]**
- **Sources:** #78, #86, #93; `52e416d`, `f33a9ce`, `21b7d29`; `docs/BRAND_VOICE.md`.

### 2026-10-11 — Luna alive, 17 looks, one Luna everywhere, unlock guard (#80–#82, #87, #88)
- **What happened:** On Home, Luna became a large head that follows the pointer, blinks and reacts to typing (#80, re-opened as #81 because #80 landed on a stacked branch). Luna got a new suit, 17 "home looks" and an ID card (#82). Old mascots and loaders were replaced by the student's own Luna, and a database trigger now refuses gear a student has not earned (#87). A loading flash on the ID card was fixed (#88).
- **Decision:** No culture outranks another (all home looks share one unlock); looks are always chosen, never inferred from a name or language. The unlock trigger is `SECURITY INVOKER`.
- **Why:** As `SECURITY DEFINER`, `current_user` would be the owner, "which would have made the trusted-role check true for everyone and silently disabled the guard"; a test caught this. A direct PATCH could equip unearned gear. Home Luna was asked for by Abdullah. **[Confirmed: PR #80, #82, #87 bodies]**
- **Sources:** #80, #81, #82, #87, #88 (and the later #121 face crop, 10-24); `src/features/avatar/LunaHero.tsx`; `20261012000400_avatar_unlock_guard.sql`; `docs/AVATAR_SYSTEM.md`.

### 2026-10-11 — Teach it back, exam date plan, course map (#83, #85 closed)
- **What happened:** Four commits pushed to #75's branch after it merged were carried to `main` in #83: Teach it back (a learner's explanation is judged against 3–6 cached key points per idea), an exam date plan, and a map of which ideas build on which. Reader prompts now answer in the reader's language. #85 was a duplicate draft and was closed.
- **Decision:** Key points are written once and cached (`keypoints-v1`), so "everyone is measured against the same list". Model output is kept only where it can be checked (indices exist, quotes occur in the text; prerequisite links strictly earlier, at most three).
- **Why:** Fairness and consistency of judging. German readers on an English deck were getting English answers cached under the German key. **[Confirmed: PR #83 body]**
- **Sources:** #83, #85 (closed).

### 2026-10-11 — Internal wiki export removed (#89)
- **What happened:** A PDF export of an internal university group wiki, with infrastructure details but no passwords, was removed from the tree.
- **Decision:** Git history was left untouched.
- **Why:** "it does not belong in a public repository"; the history decision was made on 2026-10-11. Why history was not rewritten is not stated. **[Confirmed: PR #89]**
- **Sources:** #89.

### 2026-10-11 to 10-13 — GDPR export and ordered, retried erasure (#90)
- **What happened:** Export now covers every table linked to a person, is paged, and fails loudly. Erasure follows a fixed order: file manifest, a durable `account_erasure_jobs` row, delete the auth user, remove files; failures are retried every 10 minutes. A read-only production probe checks coverage.
- **Decision:** Return 502 before anything irreversible; after the auth delete, always 200. Shared content-addressed PDFs are kept while another lecture uses them.
- **Why:** Closes gaps F2 and F3 from `docs/MILESTONE_2026_08.md`. The probe exists because three tables exist only in production. **[Confirmed: PR #90]**
- **Sources:** #90; `docs/superpowers/plans/2026-10-11-gdpr-erasure-and-export.md`; `docs/runbooks/gdpr-erasure-rollout.md`.

### 2026-10-11 to 10-16 — Launch prep: OpenAI-only AI, real users, Launch Control (#92)
- **What happened:** `AI_PROVIDER_MODE=openai_only` collapses both failover chains to OpenAI with a quality tier (gpt-4.1-mini) and a bulk tier (gpt-4.1-nano). Vision and embeddings move to OpenAI and are cost-logged for the first time. API and worker refuse to boot if any other provider key is set. The per-student monthly cap dropped from $5 to $2, and tutors pass `user_id` so it applies. A service-role-only view classifies real versus test accounts (73 real of 201). A Launch Control admin screen and a catalog-enrichment script were added. `c52e709f` made the daily ceiling bind vision and embeddings too.
- **Decision:** One provider account for launch, opt-in by env; default stays `multi`. The real-user flag does not live on `profiles`.
- **Why:** Vision and embeddings were invisible in cost logs, "which is why the admin 'AI Cost' tile read $0.00". On an all-OpenAI launch, the one hard cap "had two open doors". `profiles` is readable by every signed-in user. **[Confirmed: PR #92; `5b178452`; `c52e709f`; `939dae38`]** Why OpenAI-only was chosen over the multi-provider chain is not written down. **[Inferred: free-tier legs kept failing (402, retired models, slow Gemini in #75), and one account gives one bill and one cap]**
- **Sources:** #92; `5b178452`, `939dae38`, `96fe8cc9`, `c40e61df`, `c52e709f`.

### 2026-10-13 — Arc 9: parse-time spend attributed and capped (#98)
- **What happened:** Every parse-time LLM call is now recorded against the uploader and course. A new setting `LLM_PARSE_BUDGET_ENFORCE` (default `students`) checks the budget before the parse and at checkpoints during it; a refused parse ends FAILED with a calm message. Retry now keeps the original visibility and owner. Built 10-13, merged 10-24.
- **Decision:** Students are capped; professors' parse spend is logged but does not count toward their interactive cap. A failed role lookup enforces the cap.
- **Why:** Student parses ran with `user_id=None`, so "nobody was billed for that spend, and no cap applied". Counting professor uploads "would have let one large course upload lock a professor out of those features for the month". Retrying a refused student upload re-queued it as an uncapped course parse. **[Confirmed: PR #98]**
- **Sources:** #98; `524cca73`, `8a3d0c3c`, `5396a889`; `docs/superpowers/plans/2026-10-13-arc-9-parse-spend.md`, `2026-10-13-arc-9-ledger.md`.

### 2026-10-10 to 10-13 — Studio and the real pages pipeline (#91 closed, #95)
- **What happened:** Studio was built as a mock: Living Learn, Recall, a Depth dial, One Library (#91, closed as superseded; its content reached `main` through #96). `e595b245` added the Streamdown Markdown renderer. #95 built the real pipeline behind `FEATURE_STUDIO_PAGES` (off): PyMuPDF block extraction, WebP page images, summaries, vision blocks for scans, and photo intake (JPG, PNG, HEIC; `5d8c0225` turns photos of notes into one-page PDFs). A geometry report over 188 PDFs (3,993 pages) found only 3% of pages need vision.
- **Decision:** Ship the pipeline dark; serve pages only when the parse run is complete.
- **Why:** The PR lists five conditions before the flag goes on (staging pass, timing the 136-page deck, egress plan). **[Confirmed: PR #95]** Why Studio was built as a mock first is not stated. **[Inferred: the specs under `docs/superpowers/specs/2026-10-1*` show a design-first approach]**
- **Sources:** #91, #95; `e595b245`, `5d8c0225`; `docs/STUDIO_PAGES_REPORT_2026_10.md`; specs studio-canvas, real-pages-pipeline, living-learn, learn-deeper, one-library.

### 2026-10-13 — v4 on real data (#96, merged 10-24)
- **What happened:** `GET /api/v1/v4/world` loads the viewer's Spaces, Lessons, activity, streak, XP and social graph. Reading now writes progress; Practice uses real questions graded on the server; the ask bar uses the grounded tutor. A "seam" test forces screens off mock imports (32 → 13 files). A migration fixed tutor and search joins that used `lecture_id` while embeddings were stored by `pdf_hash`.
- **Decision:** v4 exists in production only with both the flag and live data, so fixtures can never reach real users.
- **Why:** Because of the join bug "most slides were invisible (in the old app too)". **[Confirmed: PR #96]**
- **Sources:** #96; migrations `20261014000000_match_slides_scoped_by_pdf_hash`, `20261014010000_v4_notes`.

### 2026-10-13 to 10-16 — The env-override trap (#99)
- **What happened:** A local Studio test harness blanked `DATABASE_URL`, but importing the orchestrator ran `load_dotenv(override=True)` and put the production value back. Four cost-log rows ($0.0024) were written to production `llm_calls`. #99 switched to `override=False`.
- **Decision:** Process variables always win; the rows were kept as accurate records.
- **Why:** The loader overwrote the test guard and any blanked variable. Production containers were not affected because images carry no `.env`. **[Confirmed: PR #95 "Incident", PR #99]**
- **Sources:** #95, #99; `df46a298`; `backend/tests/unit/test_orchestrator_env.py`.

### 2026-10-16 — Real-path test finds two parser bugs (#103)
- **What happened:** A test on production found that code fences inside JSON answers made the parser discard every batch of an SQL deck (the 136-page deck took 905 s, over the 900 s job timeout). Text-less photo uploads got an invented title. Both were fixed.
- **Decision:** Only strip a fence that wraps the whole reply. With no text, skip the meta call and use the file name.
- **Why:** Stated as bug analysis in the PR. **[Confirmed: PR #103]**
- **Sources:** #103; `7cbda26d`, `cb1bb786`.

### 2026-10-16 — First full production rebuild since August
- **What happened:** The three new migrations were applied by hand, then the API, worker and frontend were rebuilt from `main`. The production frontend had not been rebuilt since 2026-08-17. AI mode stayed `multi` after this deploy.
- **Decision:** Switching to `openai_only` was left as a separate decision (it needs other keys removed and a full re-embed).
- **Why:** Not recorded in the repo. **[Confirmed only by a session memory note outside the repo, `project_launch_land_2026_10_16`]**
- **Sources:** merges of #92, #99, #100 on 10-16; `f2b8e075` (a migration timestamp collision fixed before deploy).

### 2026-10-16 to 10-19 — v4 in German (#97, #102, #105)
- **What happened:** One language setting for UI and AI answers; the glossary fixes the German words (Space, Lektion, Seite, Idee). Planners return phrases instead of English sentences. A lint script (`scripts/check-v4-strings.mjs`, run in `npm run lint`) fails on literal UI text in v4 and on banned German words or the formal "Sie".
- **Decision:** German uses "du", never "Sie"; never Folie, Vorlesung or Kurs. A guard in CI keeps it that way.
- **Why:** German readers had German AI content "in English chrome" (#83). Sentence frames around a noun cannot work in German because the surrounding words change with gender. **[Confirmed: PR #83, #102, #105; `docs/V4_TRANSLATION_PLAN.md`, `docs/V4_GLOSSARY.md`]**
- **Sources:** #97, #102, #105.

### 2026-10-16 to 10-19 — Landing demo shows only what the reader does (#100, #104)
- **What happened:** The landing demo was rebuilt around the reader's real faces (Page, Explain, Ask, Practise) on a neutral topic, with Luna guiding.
- **Decision:** No invented views in the demo.
- **Why:** Abdullah, 2026-10-16: "make sure that we demo stuff that we really provide". The old demo had a "Learn" view that does not exist. **[Confirmed: PR #104]**
- **Sources:** #100, #104; `202e64c0`, `ac0c3ac4`.

## Challenges

**[Confirmed]**
- **The failed gate.** Semantic grounding failed its pre-registered gate (false-keep 8/16 against ≤ 1/16). The production wiring was reverted and the PR closed (#94, `7d4d79c4`).
- **The lexical verifier was not good enough to enforce.** 87.5% false-drop on paraphrased-correct questions, all German ones (Deck Lab probe, #84). The quiz verifier has stayed advisory.
- **Live cost bugs.** The OpenAI daily ceiling was never enforced in the worker; retired Gemini legs were never disabled; vision and embeddings were not cost-logged; student parses had no owner and no cap (#84, #92, #98, `c52e709f`).
- **Red CI.** The SCA scan was red every night from 09-30 to 10-10 (`58114939`). The nightly gitleaks job was red from 10-14 because its baseline used per-commit fingerprints and the same line existed on other branches (#101).
- **The env-override trap** wrote four rows to production during a local test (#95, #99).
- **Merge mechanics with parallel sessions.** Stacked PRs landed on the wrong base and had to be re-opened (#80 → #81); post-merge commits needed a second PR (#75 → #83); a duplicate draft (#85); a migration timestamp collision (#79, `f2b8e075`); #96 needed 16 conflict resolutions against the German slices.
- **Migrations by hand.** Every schema change in the phase had to be applied with psql because the migration ledger is unreliable; until they were applied, each parse logged `relation "parse_receipts" does not exist` (#103).
- **A batch-JSON bug pushed a 136-page deck past the 900 s worker timeout** (#103).

**[Inferred]**
- **Studio churn.** `StudioCanvasScreen.tsx` had 17 fix commits in this phase for a surface that stayed a mock or flag-off. Effort was spent on design iteration before the data path existed.
- **Flaky tests under load.** Several PRs note tests that time out only when the machine is very loaded (`lessonFaces`, `StudentDashboard`) and a clock-skew DB flake. This is likely a side effect of many sessions running on one machine.

## Open questions

- Why was OpenAI-only chosen for launch, and why gpt-4.1-mini/nano? No commit or doc gives the reason. When was `openai_only` actually switched on in production?
- Why was no work committed between 2026-09-19 and 2026-10-09?
- When exactly did Docling leave the production parse path, and was PyMuPDF a deliberate replacement or already the main path?
- Arc 7 saved only about 9 tokens per slide. Was the per-call provenance the real goal?
- Why was git history not rewritten after the wiki export was removed (#89)?
- Why was Studio built as a full mock (#91) before the pipeline (#95)? Was the design meant to drive the pipeline spec?
- Was Osama involved in this phase (reviews, merges, decisions)? No commit in the range is his.
- The German Luna looks and German copy were flagged for a "native read" (#82, #97). Did that happen?

## Thesis hints

- **Requirements:** "reader first", "one fact, once", "demo only what is real", du-register German, earned-not-bought rewards (#75, #78, #82, #104; `docs/BRAND_VOICE.md`). Cost and privacy as hard requirements: per-student caps, GDPR export and erasure (#90, #92, #98).
- **Design:** deck-plan-first pipeline (`deck_plan.py`, skeleton of roles and sections); grading by computation instead of the model's key; "keep model output only where checkable" (#75, #83); sandboxed model-written mini-apps; one avatar rule; parse receipts as provenance (#84).
- **Implementation:** Chaos Lab fault injection; call-context `ContextVar` for cost attribution; budget latch with checkpoints (#98); real pages pipeline with PyMuPDF and vision fallback (#95); i18n guard in lint (#105).
- **Evaluation:** Deck Lab scorecard on 25 real decks (span 0.17 → 0.84, coverage 26 → 31/31, meta last page 15 → about 61); lexical probe (87.5% false-drop); semantic grounding against a pre-registered gate (failed); Studio geometry report (188 PDFs, 3% vision). All in `docs/DECK_LAB_2026_10.md` and `docs/STUDIO_PAGES_REPORT_2026_10.md`.
- **Methodology / process:** pre-registered gates with sha256-pinned data and a "no re-tuning" rule (#94); TDD plus mutation verification as session rules; decision ledgers with written rulings and "cost if wrong" (`docs/superpowers/plans/*-ledger.md`); AI-agent development at scale (375 of 378 commits co-authored by Claude models, several sessions in parallel); negative results kept in the record.
