# Start here

*Orientation for a person or an agent who has never opened this repo. `CLAUDE.md` is the one-page version; this is the ten-minute version. Dated 2026-10-30; the "state of the world" block at the end goes stale first.*

## What Learnstation is, in ten lines

1. A learner drops a PDF (lecture slides, a paper, a chapter) into a Space.
2. The reader opens it at once, page by page, before any AI has run (`/v4/space/:id/lesson/:id/read`).
3. Luna, the AI, reads behind the learner and lights the pages up: an explanation, a question to ask, a checkpoint, a practice set (`/faces`, `/practice`).
4. Reading leaves traces (reader telemetry events) that the Space owner sees as "How it's landing".
5. Spaces are the rooms: a Space has people, Lessons and a first page that is its face. Owners add Lessons and publish; members join by link.
6. The Library holds everything one person has dropped, plus Studio drafts.
7. Social, Profile, Rank, Moments and History exist and are translated, but they are secondary.
8. Luna study sessions (a study partner beside the reader) are built and flagged on in prod since 2026-10-29.
9. Everything is English and German from one preference, including AI answers.
10. The older rooms (`/course/*`, `/lecture/*`, `/professor/*`, `/exam/*`) still exist in code for the few accounts that reach them. New work goes into `/v4/*` only.

## Architecture

```
browser  ──  Vite/React app (src/)  ──  nginx /api/  ──  FastAPI (backend/main.py)
                 │                                          │
           Supabase JS client                        Supabase (Postgres + Auth + Storage)
           (RLS does the access control)             Redis cache · Redis queue ── Arq worker (parser, Luna)
                                                     LLM providers called direct (orchestrator.py)
```

- **Auth and roles.** Supabase Auth. `user_roles` has one row per role; `src/lib/auth.tsx` reads it with `.single()`, so two rows mean no role at all. `ProtectedRoute` in `src/App.tsx` sends signed-out users to `/auth?next=…`, wrong-role users to their home. `FirstRunGate` sends a student who has not finished first-run to `/onboarding`. `SpaceMemberGate` wraps the Space routes and offers Join when a shared link lands on a Space the account has not joined.
- **Flags.** Backend: `FEATURE_*` settings in `backend/core/config.py`. Frontend: `src/lib/featureFlags.ts`, from `VITE_FEATURE_*`, which `docker-compose.prod.yml` derives from the backend flag so a screen never ships without its routes.
- **Data.** Only `supabase/migrations/*.sql`. RLS policies are the access control; the backend uses the service role only where a route must. Nightly CI runs the DB and RLS tests against a throwaway database.

## The v4 rooms and their routes

| Room | Route | Screen (`src/features/spaces/screens/`) |
|---|---|---|
| Home | `/v4/home` | `HomeScreen` |
| Spaces hub | `/v4/spaces` | `SpacesHubScreen` |
| A Space | `/v4/space/:spaceId`, `/:tab`, `/manage` | `SpaceScreen`, `SpaceManageScreen` |
| A Lesson | `/v4/space/:spaceId/lesson/:lessonId` | `LessonScreen` |
| Reader | `…/lesson/:lessonId/read` | `ReaderScreen` |
| Faces (Luna's views of a page) | `…/lesson/:lessonId/faces` | `LessonFacesScreen` |
| Practice / rehearsal | `…/lesson/:lessonId/practice` | `PracticeScreen`, `RehearsalScreen` |
| An idea | `…/space/:spaceId/concept/:conceptId` | `ConceptScreen` |
| Shared Lesson link | `/v4/lesson/:lessonId` | `LessonLinkRoute` (resolves the Space, offers Join) |
| Library, drafts, uploads, impact | `/v4/library`, `/drafts`, `/uploads`, `/impact`, `/m/:materialId` | `LibraryScreen` and `library/` |
| Studio | `/v4/library/studio`, `/c/:canvasId` | `StudioCanvasScreen` (real-pages pipeline, flag off) |
| Social, a person | `/v4/social`, `/v4/person/:personId` | `SocialScreen`, `PersonScreen` |
| Profile, history, moments, rank | `/v4/profile`, `/history`, `/moments`, `/rank` | `ProfileScreen` and siblings |
| Settings | `/v4/settings` | `SettingsScreen` (language, privacy, export, delete) |

Outside v4: `/` landing with the honest demo, `/auth`, `/onboarding` (first run on the stage), `/impressum`, `/datenschutz`, `/admin/launch` (Launch Control), and the labs (`/avatar-lab`, `/landing-lab`, `/pixi-lab`, `/ask-luna-lab`).

## The parse pipeline in five lines

1. Upload lands in Storage; `backend/api/v1/upload.py` (or `materials.py` for a student's own file) registers a `parse_runs` row keyed by `(pdf_hash, pipeline_version, user_id)` and enqueues an Arq job.
2. The worker runs `backend/services/parser/unified_orchestrator.py::parse_pdf_unified`: a packed copy of the PDF is stored for the reader (`compact_pdf.py`), pages are extracted, a deck plan is made (`deck_plan.py`), then page blocks and vision blocks are synthesised per page (`page_blocks.py`, `vision_blocks.py`, `synthesis.py`).
3. Results persist page by page (`persist.py`), so the reader shows faces as they arrive; a parse receipt records every LLM call and its cost (`parse_receipts.py`).
4. Per-user parse spend is capped (`_parse_budget_enforced`); students' monthly spend is attributed to the uploader.
5. Studio pages and summaries (`studio_pages.py`, `studio_summary.py`) are a separate, flag-off branch of the same run.

## How a change ships

1. Branch from `origin/main` (local `main` can be stale). Small PRs, one concern each, titled in the repo's plain style ("fix(v4): …", "feat(reader): …").
2. CI on the PR must be green: lint, Vitest, pytest, Playwright, migration governance. See the command list in `CLAUDE.md`.
3. A migration ships in its own PR and is applied by hand before the code that needs it is deployed: `docs/runbooks/apply-a-migration-by-hand.md`.
4. Deploy is manual: `docs/runbooks/deploy-main-to-prod.md`. Tag a rollback image first, build before swapping, verify `/health/ready` and the bundle hash.
5. Open work and verification live on the release punch list (artifact "Learnstation Release Punch List", ids `LS-NNN`).

## Where to read next

- Words and voice: `docs/V4_GLOSSARY.md`, `docs/BRAND_VOICE.md`.
- Design: `docs/design-v4/01-foundations.md` (the foundations and the vocabulary law), `docs/design-v4/HANDOFF.md`.
- Security and data: `docs/GDPR_DATA_PROTECTION.md`, `docs/SECURITY_CI.md`, `docs/RPC_EXPOSURE_AUDIT.md`.
- Specs and plans by date: `docs/superpowers/specs/`, `docs/superpowers/plans/`. The 2026-10-26 Library and Spaces design is the agreed product direction.
- Everything else, with a status: `docs/INVENTORY.md`.

## State of the world, 2026-10-30

- **main** @ 35a30d73 = prod (full deploy 2026-10-30 15:24 UTC). Flags on: v4, v4 reader, Luna sessions.
- **Merged this week (2026-10-24 to 2026-10-30):** PRs #110 to #150: audit weeks 1 and 2, sign-up and first run on the stage, instant reader (#139), Luna lights up (#145), the Space engine and reader telemetry behind "How it's landing" (#133, #142), legal pages with the real operator (#141, #144, #150), privacy of people views (#146), punch-list fixes (#117, #118, #140, #143, #147, #148).
- **Open PR:** #149, the reader address guard scoped to router-driven addresses; it fixes the one deterministic red test on main.
- **Known gaps:** no Sentry DSN on the server; usage is near zero since August; the learnstation.app domain move is in progress (log at `docs/ops/2026-10-30-learnstation-app-move.md` on branch `ops/learnstation-app-move`, when it lands).
- **Agreed direction:** drop anything, read instantly, AI lights up, ghost Spaces. Generic for any learner, never exam- or university-biased. Feature freeze until real students use it.
