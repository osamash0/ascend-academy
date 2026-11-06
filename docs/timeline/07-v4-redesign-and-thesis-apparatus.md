# Phase 07 — The v4 redesign and the thesis apparatus (2026-08-29 to 2026-09-30)

*Written 2026-11-04 from `git log --all`, `gh pr view` for #52 to #71, commit messages, and the docs named below. Dates are author dates. "On main" means reachable from `origin/main`.*

## Summary

At the start of the phase the product was the classic Learnstation app: courses, lectures and separate professor and student rooms. English readers could open only 16% of the lecture library (#54). In two days (08-30 and 08-31) a new design set was moved into the repo, and a full new interface ("v4") was built beside the old one, in `src/features/spaces/`, on mock data only, behind dev-only `/v4/*` routes. Over the next two and a half weeks the v4 app gained Rank, study history, Moments, Discover and the Lesson Reader. In parallel the thesis apparatus took shape: a LaTeX skeleton with 19 figures that now compiles (#52), an evaluation harness that measures the real retrieval system (#69), and a series of corrections to docs that had gone stale (#67, #70, #71). At the end of the phase production still served the classic app. v4 existed only in development builds and was not connected to the backend.

## Where the time went

| Measure | Value |
|---|---|
| Non-merge commits (all refs) | 159 (156 by author date inside the window, plus the 09-18 failover commit pair) |
| Active days | 10. Two days carry most of it: 08-31 (74 commits) and 09-05 (34). Nothing from 09-19 to 10-04. |
| Authors in git | Abdullah (under his two git names) 145, "Claude" 14. Osama: none in the window (his #53 is dated 08-28). |
| AI involvement | 14 commits are authored "Claude" (thesis notes and the eval harness). 97 more, authored under Abdullah's git name, carry a `Co-Authored-By: Claude …` trailer (Claude, Claude Opus 5, Claude Fable 5, Claude Sonnet 5). Nearly all work ran on `claude/*` worktree branches, and the PR bodies of #52 and #55 to #71 are marked "Generated with Claude Code" (all of those read in full carry the line). |
| frontend-v4 | 98 commits, about 36,400 lines (55%) |
| thesis | 8 commits, about 10,900 lines (16%) |
| backend-other | 20 commits, about 7,300 lines (11%) |
| docs | 15 commits, about 3,800 lines (6%) |
| tests-backend | 12 commits, about 2,800 lines (4%) |
| infra/ci/scripts | 13 commits, about 500 lines (1%) |
| frontend-classic | 19 commits, about 900 lines (1%) |

Line counts are rough. Commit counts measure activity, not hours.

- **Most of the effort went into the new interface.** Over half of all changed lines are in `src/features/spaces/`. The merge of #55 alone added about 20,600 lines in that folder. [Inferred: area table and `git diff --shortstat` of the #55 merge]
- **The churn hotspots are mock files.** `mocks/library.ts` (16 touches, 7 fixes), `mocks/lessons.ts` (14) and `mocks/contributions.ts` (7 fixes) are touched about as often as the screens. v4 was built against fixtures first, so fixture defects (wrong dates, a contribution liked before it was created, two "Pick up where you left off" labels) had to be fixed in the mocks. [Inferred: "Most-touched files" list and the fix messages in #57, #61]
- **The classic app got almost no new work.** About 1% of lines. The only real classic fix was #54. [Inferred: area table]
- **Much effort went into guards and tests, not features.** Many commit titles are about tests that "could not fail" or gates that were "turned off" (e.g. `1aee6380`, `1d8d7ed3`, `fb64d19b`, `987b00ae`). [Inferred: commit titles]
- **CI took 7 fixes to `ci.yml`.** This is the work of making red jobs honest (#63 to #66), not new pipelines. [Inferred: "fixed" list in the stats]
- **The thesis share is large in lines but small in commits.** Most of it is generated output (figure files, a 4,895-line per-question JSON). [Inferred: `git show --stat dccdf2c5`]

## Entries

### 2026-08-30 — Lectures readable again (#54)
- **What happened:** Four defects were fixed together. A `409` "snapshot missing" response was shown as a fatal error. The locale lookup never fell back to the original text. Student-uploaded lectures returned `403` on concepts for their own owner. The German language detector flagged long English text as German. Readable lectures went from 26 of 162 (16%) to 160 of 161 (99%) for English readers. Two one-off data operations ran separately (47 rows re-detected, 87 English snapshots published), with no LLM calls.
- **Decision:** Serve the canonical text in its original language when no translation exists, and label it "Original · DE", instead of withholding it. Treat `409` as a calm "still being prepared" state.
- **Why:** "withholding it stranded students on their own course material". The old rule guarded against mixed-language decks, and a fully German deck is not mixed. [Confirmed: PR #54 body]
- **Sources:** `b37890fe`, PR #54 (merge `5e020ebe`)

### 2026-08-30 — The v4 design doc set enters the repo
- **What happened:** Design docs that had lived "loose in ~/Downloads" were committed as `docs/v4/`, then renamed to `docs/design-v4/`. Foundations reached v1.15 after a review found six problems (for example, Open mode was "unbuildable"). Navigation (`02-navigation`) went from v0.5 to v0.7 on the same day. A brief for a parallel UI session was written (`UI-SESSION-BRIEF.md`).
- **Decision:** Rebuild the product's vocabulary and structure around the **Space**. There are no global professor or student accounts; roles (Owner/Editor/Member) exist only inside a Space. Ten old words (professor, student, course, lecture, …) are banned from UI copy. The new UI is built in a new namespace, on mock data first, while the old product is "not touched, not renamed, not imported from".
- **Why (this is why v4 was a new build rather than a continuation of the classic UI):** The brief says "The v4 design set is a rebuild of the product's vocabulary and structure", and the positioning is "the shared, gamified study space for a course — reference model Skool, not Coursera". Foundations states "There is no global 'professor' or 'student' account type". The old code is "full of banned words (`features/courses/`, `features/student/`, …). That is the old product." [Confirmed: `docs/design-v4/UI-SESSION-BRIEF.md`, `docs/design-v4/HANDOFF.md`, `docs/design-v4/01-foundations.md` "Roles"] Because the new model removed the professor/student split that the classic rooms were built on, renaming the old screens was not enough. A clean namespace let the new model be built without carrying the old one. [Inferred: from the brief's "old and new coexist" rule; the docs do not say why a refactor was rejected] What triggered the new model in late August is not recorded (see Open questions).
- **Sources:** `c2e28876`, `e2b889b5`, `8c641d43`, `09ffe796`, `9ba9fe5c`, `13aa5bf4`; `docs/design-v4/README.md`, `HANDOFF.md`, `UI-SESSION-BRIEF.md`, `notes-spaces-screen.md` (nine known gaps, recorded 08-29)

### 2026-08-30 — Side fixes that never reached main
- **What happened:** On the same day a branch added an admin content inventory endpoint, a role lookup that picks by precedence when a user holds several `user_roles` rows, and a fix for a Settings loader that refetched on every render. An AI session (author "Claude") also re-checked the thesis architecture primer and fixed 4 stale line citations.
- **Decision:** none recorded. These commits exist only on archive tags (`archive/claude/jovial-torvalds-abcb79`, `archive/claude/project-thesis-context-y2qo52`). The Settings flake was fixed again on main by #59.
- **Why:** The role bug "presented as a bad password" for an account with two role rows. [Confirmed: `6865e802` message] Why the branch was not merged is not recorded. `CLAUDE.md` still lists the two-row trap on 2026-10-30, which suggests this fix did not land. [Inferred: `CLAUDE.md` "Traps"]
- **Sources:** `c41c00c6`, `6865e802`, `f0413a96`, `e6e893dd`

### 2026-08-31 — Token layer, self-hosted font, vocabulary gate
- **What happened:** Inter was self-hosted as a variable woff2. The old config declared three fonts and shipped none. v4 semantic tokens were added (Origin, Grounding, Space modes, Like vs Star) with a quiet-text scale that passes WCAG AA. `scripts/check-vocabulary.mjs` was added to fail on banned words in string literals and JSX text.
- **Decision:** No Google Fonts CDN. Enforce the vocabulary law by script, not by memory.
- **Why:** Loading from the CDN sends visitor IPs to Google, which a Munich court held to breach the GDPR; "DSGVO is a hard constraint here". The vocabulary rule "relies on everyone remembering, and the codebase is already full of the old vocabulary". [Confirmed: `7da29f5b`, `ddb2fac9` messages]
- **Sources:** `7da29f5b`, `ddb2fac9`

### 2026-08-31 — Nine screens on mock data, then an overnight backlog
- **What happened:** One commit created `src/features/spaces/` with nine screens (Home, Spaces, Space, Lesson, Library and its Studio screens, Social, Profile), 36 files and about 6,800 lines, all behind `import.meta.env.DEV` routes. A brief for an "Opus session" then planned backlog A–H (Space routing, Concepts, Space lifecycle, notifications, avatar/Ascent, Home port, writable Notes, Studio sweep). The same day saw Practice, ⌘K search, Settings, the Ascent map, 375px layouts, an accessibility audit, "all four states" for every screen, the first reader and a moderation surface. A written review loop (`CYCLE.md`: Discover → Build → Test → Review) ran in two passes.
- **Decision:** Mock data only, with `data/useSpaces.ts` as the single seam to swap later. New capabilities get a `NEEDS-BACKEND` marker instead of server work. Fixtures copy real data, including awkward cases (a 78-character title, umlauts).
- **Why:** "Wiring later should mean swapping the data source, not rewriting components." [Confirmed: `UI-SESSION-BRIEF.md` "Constraints", `src/features/spaces/BUILD-PROMPT.md`] Backlog items were limited "to shapes the existing backend already serves". [Confirmed: `0987d49f`]
- **Sources:** `f9aad62c`, `0987d49f`, `70f760b1`, `9f921b42`, `14166e60`, `85612561`, `e2827e8c`, `f946a578`, `aa87973e`, `13d59038`; `src/features/spaces/BUILD-PROMPT.md`, `OVERNIGHT-PROMPT.md`, `OVERNIGHT-REPORT.md`, `CYCLE.md`

### 2026-08-31 — "Motion owns animation, CSS stops"
- **What happened:** The `motion` package was installed and v4 moved to `motion/react`. One `MotionRoot` with `reducedMotion: "user"` replaced two configs. A `Pressable` component replaced nineteen `hover:scale-*` classes. CSS transitions of transform and opacity were banned by a guard. Right after, every `/v4/*` route crashed: `motion@13` pulled a second copy of `framer-motion` and React. A `resolve.dedupe` in the Vite config fixed it.
- **Decision:** One animation mechanism in v4. The 99 old-product files on `framer-motion` stay untouched, and a boundary guard blocks that import in v4. `transition-colors` stays allowed and became a rule (`82b58847`).
- **Why:** Two mechanisms drifted: Studio ignored reduced motion while Settings claimed motion followed the system setting. Dedupe was chosen because it is "cheaper and far more reversible than migrating the 99 old-product files". [Confirmed: `0dbc641d`, `2b6d17b3` messages]
- **Sources:** `0dbc641d`, `2b6d17b3`, `f89b28ea`, `82b58847`, `dc57a62e`

### 2026-08-31 — The rebuild goes through CI for the first time (#55)
- **What happened:** "Fifty-four commits of v4 UI work, none of which has ever been through CI" were cut as a snapshot branch and merged. The suite grew from 634 to 950 tests and from about 91 s to about 326 s, so the test timeout was raised to 20 s. One Settings test failed about 4 runs in 5 on main as well.
- **Decision:** Open a PR mainly to get CI. Leave two design questions open on purpose: the Spaces/Library boundary, and two Lessons both labelled "Pick up where you left off".
- **Why:** CI runs only on PRs and pushes to main, so branch work was "gated by hand or not at all". [Confirmed: PR #55 body]
- **Sources:** PR #55 (merge `23181a8d`), `b65358e3`

### 2026-08-31 — Rank, study history, one label per altitude, stable mocks (#56 to #59)
- **What happened:** #56 added a Rank screen and opened Profile cells that count something real. #58 added `/v4/profile/history`. #57 split the label map so the hero gives the one instruction and list rows name a state ("In progress"). #59 fixed a mock pattern (`useToast: () => ({ toast: vi.fn() })`) in twelve files and added a repo-wide guard. That pattern was the cause of the Settings flake.
- **Decision:** Study history is "a record of days, not a streak system": it grants no XP and has no mechanic. A mock must keep the identity stability of the hook it replaces.
- **Why:** The history screen says "Nothing here counts toward XP or your Rank". [Confirmed: PR #58] "Streak" was not in any design doc, so it was built as a fact with no mechanic. [Confirmed: PR #61 "Deliberate departures"] The unstable mock re-ran an effect on every render, so a click landed on a disabled switch. [Confirmed: PR #59]
- **Sources:** PRs #56, #57, #58, #59; `3cb31a18`, `aaa96d71`, `c9aa3c10`, `0b7abbab`

### 2026-08-31 to 09-16 — Moments replace the badge wall; Discover discovers (#61, #62)
- **What happened:** Two parallel AI sessions worked on two branches (`claude/peaceful-rosalind-9d0e67`, the "trunk", and `claude/vigilant-gauss-a1119a`, the "fork"). The fork replaced badges with Moments, made archived Spaces visible again, and fixed fixture dates. The trunk made the Discover chip change the rails, added re-anchoring of orphaned contributions for author and Owner, and fixed a Person page that showed healthy work as lost. The two sides collided on orphan labelling and needed several merges. Both PRs merged on 09-16.
- **Decision:** "A moment is a fact with a date. Grants nothing, cannot be lost, no total." Discover is a scope for the whole page, not a section.
- **Why:** In the design docs "badge" already means a label on content, and rule 7 is "one word, one meaning". Two badges also rewarded likes and publishing against the engagement rules. [Confirmed: PR #61] The Discover rails "went on showing 'Jump back in'". [Confirmed: PR #62]
- **Sources:** PRs #61, #62; `85248ebd`, `690af22f`, `d8b0147d`, `a8ff6c81`, `6b0b16d8`, `f80880c3`, `78492073`; merges `5eba4252`, `a6e162a6`, `e4c8aae2`

### 2026-09-01 to 09-05 — "Luna asks first on Home" (#60)
- **What happened:** Home was redesigned from a supplied mock. It uses the existing `LunaAstronaut` component and the v2 brand kit as SVGs only. An ask bar was ported in shape but not in copy, and it does not answer: it says it is "Not wired up yet". The Home rank numbers were made to read from the same source as the top bar.
- **Decision:** No fabricated assistant replies. Leave out the 1.2 MB of PNGs.
- **Why:** "a fabricated reply from something billed as grounded on your own material is indistinguishable from a wrong one". The PNGs were left out because of the earlier Supabase egress incident from large images. [Confirmed: PR #60]
- **Sources:** PR #60 (merge `ce121d01`), `ca124e7c`

### 2026-08-31 to 09-17 — The Lesson Reader (#68)
- **What happened:** A first reader was built on 08-31 (`aa87973e`: one passage per Concept, a 52ch measure). The same evening a reader vision and a plan in seven slices were written. On 09-05 about 30 commits built the slices: a Material view page by page, Tutor and Notes "summoned rather than docked", questions that start from a selected sentence, and answers that cite back into the Lesson. Each slice was "implemented by a fresh agent and reviewed by a different one". Reviews found real bugs, including content pushed off-screen at some widths, arrow keys stealing focus from tablists, a vocabulary gate blind to half the JSX copy, and a WCAG 2.4.11 failure below 640 px. Merged 09-17.
- **Decision:** Read is the default view and the Material is one toggle away. Reading changes no progress. Rejected ideas (model picker, inline rewriting, header stepper, XP HUD) are written down with reasons.
- **Why:** "every other screen in v4 is a way of choosing what to read". Marking a Concept read on scroll "would invent a progression rule". [Confirmed: `aa87973e`, `effd8577`, PR #68]
- **Sources:** PR #68 (merge `a696be15`); `aa87973e`, `effd8577`, `3194c406`, `29fee526`, `0edc17f5`, `82c13438`, `33156137`, `3ab6bcab`, `1321cb69`; `src/features/spaces/READER-PROMPT.md`, `READER-REPORT.md`

### 2026-09-05 to 09-16 — The SCA job was auditing a file that never ships (#63, #64, #65)
- **What happened:** The dependency scan had been red on main for six or more runs. Two AI sessions found the same root cause on their own: CI audited `backend/requirements.txt`, but the Docker image installs `requirements-docker.txt`, which pinned pypdf and Pillow below their own security fixes. #63 bumped them, audited both files, and added `if: always()` so the npm audit could run at all. #64 was closed in favour of #63. Once npm audit finally ran, it found a new high advisory on js-yaml (dev-only), fixed in #65.
- **Decision:** Audit what ships. Suppress one nltk advisory (no fix exists, only reached transitively) by explicit ID with an exit condition, and never by blanket ignore.
- **Why:** "A permanently red check does negative work. It cannot distinguish a new vulnerability from the standing one." [Confirmed: PR #63] #63 won because it reports both files in one run and adds a local script. [Confirmed: closing comment on #64]
- **Sources:** PRs #63, #64 (closed), #65; `aea07b29`, `2c377db5`, `cb126e65`, `cb66464f`, `5c95b5cd`, `be58748a`, `30688330`

### 2026-09-08 to 09-10 — The evaluation harness (#69)
- **What happened:** Eleven commits authored "Claude" built `backend/eval/retrieval_grid.py`, a 50-question golden set over six Database Systems lectures, a corpus survey tool and tests. Seven of the eleven are `fix(eval)` commits that stop the harness from reporting wrong numbers. The branch sat with no PR from 09-10 until it was merged on 09-17. The PR body says "I did not write them" (the PR was opened by a later session).
- **Decision:** Keep two harnesses apart. `run_eval.py` uses synthetic fixtures and is only a regression detector. Only `retrieval_grid.py` produces thesis numbers. The grid refuses to write results when more than 20% of lookups fail or when its own numbers break monotonicity.
- **Why:** "a zero meaning 'misconfigured' is indistinguishable from a zero meaning 'retrieval failed'". Two broken runs had already produced clean-looking tables, one of them with a best MRR of 0.806 from an exhausted quota. [Confirmed: `backend/eval/README.md`, PR #69]
- **Sources:** PR #69 (merge `a7357717`); `85e612e4`, `59926cf8`, `5318ae69`, `f92c6636`, `0338778a`, `a0703c17`, `17d3d973`, `70c1a69a`, `39496457`, `e43662a3`, `b898a919`

### 2026-09-16 to 09-17 — The nightly made honest; the secrets audit corrected (#66, #67)
- **What happened:** gitleaks was green on every PR and red every night. The action scans only new commits on PRs but the full history on the schedule. The full scan had 68 findings. One was real: a load-test fixture from June with credentials for throwaway test accounts. It was checked to be inert (tokens expired, accounts gone) before it was baselined. The rest were the public anon key or false positives. The nightly AI-eval job "has never been able to run": its provider keys were never configured and it crashed on import. `docs/SECRETS_AUDIT.md` (07-30) had said "no leaks found in git history" from a scan of the last 30 commits.
- **Decision:** Verify before you baseline. Make the AI-eval job dispatch-only, gated on a variable, instead of deleting it. Correct the audit in place, with the old claim struck through and a dated note.
- **Why:** "a baseline written first hides a working credential behind a green check". Re-enabling the schedule "means spending real money on live model calls nightly". The correction keeps the old text visible because "the reasoning error is the instructive part". [Confirmed: PRs #66, #67]
- **Sources:** PRs #66, #67; `071310a3`, `71e5f0b6`, `3db84490`, `bb244db4`; `.gitleaksignore`, `docs/SECRETS_AUDIT.md`

### 2026-09-17 — The LaTeX skeleton compiles (#52)
- **What happened:** The skeleton (`thesis/`, written 08-28, after the 19 figures of #51) had never been compiled because no LaTeX toolchain was installed. Once MacTeX was installed it failed at once: `\frontmatter` does not exist in the `scrreprt` class. After the fix it builds 47 A4 pages, reproducibly, with 19 of 19 figures wired. Merged 09-17.
- **Decision:** Keep formatting in `main.tex` and `preamble.tex` so a university template is a cheap swap. Put no invented academic citations in `references.bib`. `\TODO` markers say what each section must argue.
- **Why:** "a fabricated citation is worse than a missing one". The PR also flags that research questions RQ2 and RQ3 "have no study behind them" and that the statutory declaration must be replaced. [Confirmed: PR #52 body and comment]
- **Sources:** PR #52 (merge `c82590e4`), `5a09a9c2`; `thesis/README-thesis.md`, `thesis/figures/MANIFEST.md`

### 2026-09-17 — "The LLM gateway it describes no longer exists" (#70)
- **What happened:** `docs/thesis/NOTES.md` (Session 1, 08-25) described a LiteLLM gateway container and six production containers. The gateway was removed on 08-25. Production has five services, and `orchestrator.py` calls providers directly over two ordered chains. Figure F6 had the same error and was fixed in #69 (`b898a919`). The Session 1 diagrams named in the notes were never committed.
- **Decision:** Strike through and date the stale lines instead of deleting them.
- **Why:** `NOTES.md` is "raw material for later writing", so a stale claim there ends up in the thesis. The design to defend "changes shape": two chains ordered by different priorities (bulk vs planning) instead of one gateway. [Confirmed: PR #70]
- **Sources:** PR #70 (merge `5ac68e9c`), `ac1c51f2`, `b898a919`

### 2026-09-05 to 09-17 — "Phase 2 of the roadmap described a product that had moved on" (#71)
- **What happened:** A brief (09-05) set up a documentation-only session. On 09-17 `docs/ROADMAP_10X.md` §5 was rewritten (89 to 315 lines) with a `path:line` behind every claim, plus 30 numbered corrections in §11 and a verification record in `docs/ROADMAP_PHASE2_RECONCILIATION.md`. Item 2.2 had been built in full; item 2.1 was live under another name.
- **Decision:** Treat an earlier agent sweep as "leads, not facts" and re-check each claim against the tree. Change no behaviour. Leave the production global-search flag to a human decision.
- **Why:** Following the old text "would have destroyed working code in four places", for example by overwriting a working retrieval function with a duplicate migration. [Confirmed: PR #71, `cc861818`]
- **Sources:** PR #71 (merge `6b4333a0`), `cc861818`, `30168f83`; `docs/ROADMAP_PHASE2_RECONCILIATION.md`

### 2026-09-17 — Backend fixes written in the last session days
- **What happened:** Three backend fixes were written on 09-17. (1) The stalled-parse sweep only looked at runs stuck in `extracting`. Runs stuck in `queued` were invisible to it (16 such rows in prod, the oldest from July). (2) A real-Postgres test for the sweep, plus a CI path filter that was missing `backend/services/parser/**`. (3) A database fix that revoked anonymous access to a set of `SECURITY DEFINER` functions found during a prod audit.
- **Decision:** `queued` and `extracting` need different recovery rules: only `extracting` proves a worker started this attempt. [Confirmed: `31be9b09`]
- **Why:** See the commit messages. None of the three reached main in this phase. The sweep fix landed via #72 on 2026-10-10. The access fix stayed on an archive tag; a revoke of anonymous execute rights landed separately in #77 on 2026-10-11. [Confirmed: git ancestry]
- **Sources:** `31be9b09`, `26f87c3c`, `fcb3f1e7`

### 2026-09-17 to 09-18 — Reader "Two Faces" design, and real numbers for F19
- **What happened:** `docs/READER_TWO_FACES_PHASE_A.md` (dated 09-17), `…_PHASE_A2.md` and `…_PHASE_B.md` (dated 09-18) designed a second reader: the slide face and the reading face of one Lesson. Phase A2 says the first prototype's depth-of-field idea "died in the browser". Phase B says its branch was "uncommitted". All three files were first committed on 2026-10-10. Also on 09-17, figure F19 was filled with a real retrieval run (`dccdf2c5`), but that commit exists only on an archive tag. On main, F19 is still the scaffold.
- **Decision:** "Nothing live is blurred or scaled." "The way to turn must be visible." [Confirmed: `READER_TWO_FACES_PHASE_A2.md` §0]
- **Why:** The first pass failed in the browser in four steps (the black surface read as a void, the blur smeared the other face, …). [Confirmed: same doc]
- **Sources:** `docs/READER_TWO_FACES_PHASE_A.md`, `_A2.md`, `_B.md` (added `c35242be`, 2026-10-10); `dccdf2c5` (tag `archive/claude/project-next-steps-3faf34`)

### 2026-09-18 — Revive the provider failover chains and sweep the dead gateway
- **What happened:** A live probe of all 9 providers found 8 dead (retired model names returning 404, one provider returning 402 for billing). Every AI call walked eight failures before it reached the one paid provider, which sat last in both chains. The fix changed five model names (1 of 9 to 6 of 9 working), made each name overridable by env, and derived the old constants from `PROVIDER_REGISTRY`. It also fixed a daily cost ceiling that did not hold, a 402 misread as a rate limit, and a vision path with no permanent-disable branch. It deleted gateway leftovers (`backend/_legacy/`, `litellm/config.yaml`, a re-export shim). `BULK_CHAIN` (capacity-first, slide analysis) and `QUALITY_CHAIN` (quality-first, planning) kept their roles.
- **Decision:** A model retirement should be "a config change rather than a code change". Hard gates (disabled, no key, over the cost ceiling) are never relaxed.
- **Why:** The duplicated constants "is how they drifted". [Confirmed: `a33c0296` message] The commit is dated 2026-09-18 00:10 but was committed on 2026-10-10. It is a cherry-pick from branch `claude/ai-calls-cleanup-testing-8a4bac`, landed on main as `7830d49a` with model pins re-probed live that day. So the fix was written in this phase but reached main in the next one. [Confirmed: `7830d49a` message, author vs committer date]
- **Sources:** `a33c0296`, `7830d49a`; `backend/services/ai/orchestrator.py`

## Challenges

**[Confirmed]**
- **Docs and notes went stale and were cited as fact.** `SECRETS_AUDIT.md` claimed a clean history from a 30-commit scan (#67). `docs/thesis/NOTES.md` and figure F6 described a gateway removed on 08-25 (#69, #70). Roadmap Phase 2 described unbuilt work that was already live (#71). The figure manifest warns: "Do not cite `README.md` or `docs/` for any architectural claim". (`thesis/figures/MANIFEST.md`)
- **CI jobs that were red, or could never be green.** SCA was red on main for six or more runs and audited the wrong file (#63). The npm audit step had never run because the step before it failed (#65). The gitleaks nightly was red for months for a real reason (#66). The AI-eval nightly could never pass: no keys and a crash on import (#66). CI does not run on branch pushes, so 54 v4 commits had no CI before #55.
- **Mocks vs real data.** All v4 screens ran on fixtures. A white screen on every `/v4/*` route passed `tsc` and 262 of 263 tests, because "not one of them boots the app" (`2b6d17b3`). Fixture errors produced screens that "look right and are wrong" (`f9aad62c`, #61). Home has an ask bar that refuses to answer, next to a reader that answers with citations, flagged as "a product question for a human" (#68).
- **Tests unstable under load.** The suite went from about 91 s to 326 s and needed a 20 s timeout (#55). A flaky Settings test failed about 80% of runs and sent a `git bisect` to an impossible commit (#55, #59). Runs on a busy machine showed 1 to 16 false failures (#60).
- **Parallel AI sessions on one tree.** Trunk and fork collided on orphan labelling and needed reconcile merges (#61, #62). Two sessions fixed the SCA job twice (#63 and #64).
- **Work stranded off main.** The eval branch sat with no PR for a week (#69). The admin inventory and role-precedence fix, the thesis primer updates, the definer-access fix and the F19 numbers stayed on branches or archive tags. The Two Faces docs and the failover fix were committed only on 10-10.
- **Thesis tooling.** The LaTeX skeleton was written with no toolchain and failed on its first real compile (#52).
- **Guards that did not guard.** Many fixes target tests that "could not fail" or gates disabled by piping into `tail` (`1aee6380`, `1d8d7ed3`, `09b733b2`, `987b00ae`). The vocabulary gate could not see half the JSX copy (#68).

**[Inferred]**
- Building at speed with AI agents on mocks produced many small fixture and guard fixes. A large share of the phase's commits correct earlier commits from the same day. Basis: the fix/feat ratio (70 fix, 43 feat) and the "Most-touched files" list.
- The classic app and v4 were kept apart, so prod users saw none of this work in the phase. Basis: dev-only routes in `App.tsx` at `a696be15`, and about 1% of lines in frontend-classic.

## Open questions

- What triggered the new product model (Spaces, per-Space roles, "Skool, not Coursera") at the end of August? Was it user feedback, low usage, or the thesis scope? When did the design work in `~/Downloads` begin?
- Why build v4 as a separate namespace, rather than refactor the classic rooms step by step? The brief says only that old and new coexist.
- Why are there no commits from 09-19 to 10-04?
- Why did the 08-30 branch with the role-precedence fix and the admin inventory (`6865e802`, `c41c00c6`) never reach main?
- Will the thesis cite the F19 retrieval numbers that exist only on `archive/claude/project-next-steps-3faf34`? Should they be re-run on main?
- Were RQ2 and RQ3 (perception questions with no study) scoped out with the supervisor (#52)?
- What was Osama's role in this phase? He has no commits in the window, and all PRs were merged from Abdullah's account.
- Were the open design questions settled: the Spaces/Library boundary, a ruling on the word "Streak", and the Home ask bar that refuses vs the reader that answers?
- Was the nightly AI-eval schedule ever turned back on? It is a cost decision (#66).

## Thesis hints

- **Requirements:** The Foundations object model (Universe, Space, Material, Lesson, Concept, Practice set, Contribution, Note), per-Space roles and the visibility levels (`docs/design-v4/01-foundations.md`). GDPR as a hard constraint, with self-hosted fonts as a concrete case (`7da29f5b`). The vocabulary law as a requirement turned into a check. Figures F4 and F5. #52 notes that RQ2 and RQ3 need participants.
- **Design:** Why v4 was a rebuild (see the 08-30 entry). Learn vs Studio modes and focus surfaces (`Scene`). The mock-first seam (`data/useSpaces.ts`). One animation system (`0dbc641d`). Reader principles: read first, companions summoned, questions start from the text, answers cite back (#68), and the Two Faces design notes. LLM access as two ordered chains instead of a gateway (#70, `orchestrator.py` `PROVIDER_REGISTRY`, `BULK_CHAIN`, `QUALITY_CHAIN`; figures F6, F11).
- **Implementation:** Namespace boundary, accessibility, motion and vocabulary guards, verified by mutation (#57, #59, #68). The locale fallback and language-detector calibration (#54). Stalled-run recovery rules in the parser (`31be9b09`). Failover hardening (`a33c0296`/`7830d49a`).
- **Evaluation:** The harness in #69 (`backend/eval/retrieval_grid.py`) measures retrieval only. It does not measure generation. It sweeps k × similarity threshold × regime (`lecture_dense`, one lecture; `course_hybrid`, dense + full-text fusion over a course) over 50 hand-checked questions on six Database Systems lectures. Metrics: slide found in top-k, anchor phrase found, MRR, precision@k (ceiling 1/k), search latency (embedding excluded), refusal rate, and **false refusal**: questions the tutor's similarity gate would reject although the right slide was retrieved. A paired table compares regimes on the same questions. Threats to validity it records: deliberate deck selection, the regime asymmetry, and 23 of 50 questions without a `course_id`. The 09-17 run (archive tag only) at production defaults (threshold 0.65): `lecture_dense` k=5, slide found 0.92, MRR 0.786; `course_hybrid` k=6, slide found 0.963, MRR 0.858 (n=27); false refusal 0 in both. Quiz key accuracy, tutor faithfulness and synthesis quality are marked NOT MEASURED (`dccdf2c5`). Figure F17 ("built versus deployed") also fits here, since v4 was built but not deployed.
- **Methodology / process:** Development with AI coding agents under written briefs (`BUILD-PROMPT.md`, `OVERNIGHT-PROMPT.md`, `READER-PROMPT.md`), with separate implementer and reviewer agents per slice and a fixed review cycle (`CYCLE.md`). The habit of correcting stale claims in place, struck through and dated (#67, #70, #71). The lesson that a green check is only as broad as what it scans (#63, #66, `2b6d17b3`).
