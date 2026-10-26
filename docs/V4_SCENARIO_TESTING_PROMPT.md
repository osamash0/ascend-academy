# Session prompt — v4 scenario testing: "a stranger signs up, brings their files, and learns"

*Written 2026-10-24. Paste everything below the line into a fresh Claude Code session (desktop app, Code tab) opened on this repo.*

---

You are testing and improving **Learnstation v4** with Abi, who will watch every step in the browser pane next to you. We work **one scenario at a time**. In each one we act as a real person arriving with their real files. We watch what happens, fix what breaks, re-test, and move on. A fix counts only after you have seen it work in the browser.

## The end goal

A new person can open the site, **sign up, upload their files, understand what they're looking at, and use the platform**, with nobody explaining it to them. Judge everything against that. Also ask whether the learning feels *alive* rather than like a file manager.

## The product idea we are testing (hold every screen up to this)

1. **A Space is where you put anything you want to learn.** You create one for each thing you study. The Space then *organises the information for you*: Lessons in order, the Concepts inside them, practice, and what's fading. It should never feel like a folder of PDFs. The source of truth is `docs/design-v4/01-foundations.md` (locked v1.15). The words to use are in `docs/V4_GLOSSARY.md`. Banned UI words: course, lecture, professor, student, folder, module.
2. **Studio / Library** is where your Materials live and where you make things from them (`/v4/library`, `/v4/library/m/:materialId`).
3. **Community is part of learning, not an add-on.** Spaces can be shared (Private / Invite / Public). Members contribute summaries, practice, mnemonics and explanations. Official and Community content are always clearly separated, and every item shows its author.
4. **Agentic learning with Luna.** A study session with Luna should be able to *turn into something*. Luna offers to summarise what you worked through. You and Luna build a material from it together (summary, cheat sheet, practice set). You can keep it in your Space or share it with others as a Contribution.
5. **Interactive LLM responses.** Answers aren't walls of text. They are structured, interactive blocks (the gen-UI spec in `src/features/spaces/components/reader/iui/spec.ts`, drawn by `Blocks.tsx` / `ExplainPanel.tsx` / `Sandbox.tsx`).

## What is real today vs. demo (verify this, don't trust it)

From a code map taken on 2026-10-24. Re-check before you rely on any of it.
- **Live:**
  - Uploads: `POST/GET/DELETE /api/v1/v4/uploads` → `materials_service.create_upload`, using the arq worker. The file becomes a private lecture inside a personal "My materials" Space whose id = the user's id (`backend/services/v4_personal.py`).
  - Spaces come from `GET /api/v1/v4/world`.
  - Reader: explain, ask, practise, checkpoint, teach-back, rehearsal.
  - Notes, joining a Space, friends, account export and delete.
- **Demo-only or missing:**
  - Contributions: there is no table, so in live mode they show nothing.
  - Share / publish (`library/ShareSheet.tsx`, `data/useShelf.ts:150`).
  - Tutor panel (`data/tutor.ts`), Studio summaries (`mocks/studio-*.ts`), social leaderboard (`data/social.ts`).
  - **Nothing turns a Luna session into a summary or material yet.**
- **Ratchet of files still on mocks:** `STILL_ON_MOCKS` in `src/features/spaces/__tests__/seam.test.ts`. It may only shrink.
- **Honesty rule:** never let live mode *show* a feature that does nothing. Either it works for real, or it is hidden or plainly marked "coming soon".

## Setup (do this first, show Abi each step)

1. **Test the latest version.** `git fetch origin` first, then bring your branch up to `origin/main`. In a desktop-app worktree, use the `sync_with_base_branch` tool. Tell Abi the exact commit you're testing (`git log --oneline -1`), and write it at the top of the findings log. Re-sync before each new scenario if main has moved: other sessions merge PRs while we test. As of 2026-10-24, main is at `b8183e9` (#120, German-mode fixes, which matter for S4). Work in your own worktree on a branch off that commit. Other Claude sessions share this machine, so re-check `git status` and the branch before every commit. Never use bare `git stash`. After syncing, run `npm install`, since dependencies may have changed.
2. **Find out which database the local backend talks to *before* any upload.** `orchestrator.py` calls `load_dotenv(override=True)`, which has overwritten a blanked env with the **PROD** DSN in the past. Check whether PR #99 has landed. If the local stack points at production Supabase, **stop and ask Abi** before writing any test data there.
3. Turn on v4 live mode locally. Put these in `.env` (the worktree has none, so copy the main checkout's): `VITE_V4_DATA_MODE=live`, `VITE_FEATURE_V4=true`, `FEATURE_V4=true`, `FEATURE_V4_READER=true`, `FEATURE_STUDENT_UPLOADS=true`, and `VITE_FEATURE_ASK_LUNA=true` if we test Ask Luna. Then start these from `.claude/launch.json`: `dev`, `backend-api`, `backend-worker`. Use `preview_start`, never Bash. Confirm `/health/ready` is ok.
4. Make **fresh test users**, one for each scenario (for example `v4-scn1@test.com`). Record their credentials in the project's seed or example file, not in chat. Default existing user: `abdul@test.com`.
5. Create `docs/V4_SCENARIO_FINDINGS.md`. It is the running log: one row per finding with scenario, step, what happened, severity (blocker / confusing / polish / idea), status, and fix commit.

## The test files — `/Users/abdullahabobaker/Desktop/Dev/pdf_testset`

Each scenario is a kind of person, with the files they would really bring. The facts below come from `pdfinfo` and `pdftotext`.

| # | Persona | Files | What it stresses |
|---|---|---|---|
| **S1** | **"Just trying it"**: brand new, one small file | `database_management_slides.pdf` (5 p, 4 KB, English, bullet slides) | The whole first-run path, end to end, as fast as possible: landing → sign up → first run with Luna → first upload → first Space → read → first practice. Every second of confusion counts. |
| **S2** | **"The whole semester at once"** | `Lecture/00…06 DI *.pdf`: 7 decks, 63–225 p each, up to 21 MB (`03 DI Data Profiling.pdf`); Data Integration, Marburg | Batch upload, big files, long processing. Does the user know what's happening while they wait? Does the Space put the Lessons in **00→06 order**? Are Concepts extracted across lessons? Reader speed on a 225-page deck. |
| **S3** | **"Oops, uploaded it twice"** | `01 DI Data Matching.pdf` and `Lecture/01 DI Data Matching-2.pdf`, **byte-identical** (same md5), different names | Duplicate detection (`status: duplicate`), and what the user is *told* about it. |
| **S4** | **German course: slides + exercise sheets** | `Course SWT/Slides/1–6.pdf` (27–58 p, **filenames are just "1.pdf"…"6.pdf"**) + `Course SWT/ueb00–06.pdf` (5–12 p, dense German text, exercise sheets) | German content and UI (du-register, glossary). Lesson titles have to come from the *content*, not the filename. Slides and exercise sheets are different kinds of material. Should exercise sheets become practice instead of reading Lessons? One Space for "Softwaretechnik". |
| **S5** | **"Messy learner, several subjects"** | `ML_VL_04_Unsupervised_Learning.pdf` (143 p), `Slides I_ Background.pdf` (NLP, 53 p), plus **four database files from different sources**: `databases_2223_1to4-B.pdf` (84 p), `database lecture.pdf` (10 p), `DB Intro.pdf` (10 p, Boston Univ.), `database_management_slides.pdf` | Does the product help sort a mixed pile into **separate Spaces** (ML, NLP, Databases)? Should Luna suggest which Space a file belongs to? Can one "Databases" Space hold sources from different universities and still read as one subject? |
| **S6** | **"The tiny file"** | `Data Matching.pdf` (1 page, a single "String Similarity" slide) | Edge case: is a 1-page Material a Lesson? What do Concepts and practice look like with almost no content? Is the empty or thin state honest? |
| **S7** | **"Learn together"**: two test users | S2's Space, shared from user A to user B | Invite/Public visibility, joining, what a Member sees, contributions, Official vs Community. Expect a lot to be demo-only here. Write down exactly what's missing. |
| **S8** | **"Study with Luna, leave with something"** | Any Lesson from S2 or S4 | A real study session. Ask, Explain, Practise, teach-back. Then: can the session become a summary or material, can you keep it in the Space, can you share it? Judge the interactive answer blocks: do they help understanding or just decorate it? |

Order: S1 → S3 → S6 (fast and cheap) → S2 → S4 → S5 → S8 → S7. Watch LLM/parse spend. The S2 decks are large, so tell Abi before you start them.

## How each scenario runs (the loop)

1. **Say the persona and their goal in one sentence.** Then act it out in the browser pane while Abi watches. Click like a newcomer would. Don't jump to URLs a real user couldn't find.
2. At each step, check: console errors (`read_console_messages`), failed network calls, backend and worker logs (`preview_logs`), and what the screen *says* to the user.
3. Every time a user hesitates, a step dead-ends, the copy is wrong, or the screen isn't honest, write a row in the findings log right away.
4. **Pause at the end of each scenario.** Show Abi a short list: what worked, what broke, what felt wrong, and your top 3 fixes with your recommendation. Wait for Abi's go-ahead before larger changes. Small, obvious bugs (crash, wrong copy, broken link) you can fix right away.
5. For each fix: find the root cause first (systematic debugging, no guess-patches). Make the smallest correct change and add or adjust a test. Re-run the **same scenario step** in the browser, take a screenshot as proof, and mark the log row fixed.
6. Commit per fix, with a clear message, in your own worktree. **Don't push, open PRs, run migrations, or deploy without asking.**

## Lenses — at the end of every scenario, answer these in 2–3 lines each

- **Space:** did this feel like *my place to learn this thing*, organising itself, or like an upload bin?
- **First minutes:** could a stranger say what Learnstation is for, after one screen?
- **Alive:** did anything respond to *me* (what's fading, what's next, Luna knowing where I am)?
- **Studio:** is it clear what Studio is for and how it differs from the Space?
- **Community:** where would another person enter this experience, and is that door visible?
- **Luna, agentic:** at which moment should Luna have offered to summarise or create something with me?
- **Interactive answers:** did the structured blocks make the idea clearer than plain text would?
- **One fact, once:** is any label or number repeated on the same screen?

## Bigger ideas: design, don't build blind

Some things need a design decision before any code: Luna session → summary → material → share, real Contributions (a table + RLS), and auto-sorting files into Spaces. For these, write a short proposal in the findings doc covering the user flow, the data model touch-points, what is reusable from the existing code, and the smallest real slice. Bring it to Abi. Nothing gets built only as a demo for live mode.

## Gates and traps (from past sessions)

- Type-check with `npx tsc -p tsconfig.app.json`. Plain `tsc -p tsconfig.json` checks nothing.
- Run `vitest` for touched areas, plus `seam.test.ts`. The mock ratchet must not grow.
- **Never `supabase db push`.** The prod migration ledger is unreliable. Migrations are written as files and applied by hand only with Abi's approval.
- A second `user_roles` row silently locks an account out of every guarded route. Don't create one.
- Visual changes reuse the existing v4 stage language: monochrome, the black stage, Luna stays recognisable. Copy is calm and assured, never salesy.
- End each report to Abi with a short, simple summary.

Start with Setup, then S1.
