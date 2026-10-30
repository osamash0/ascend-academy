# Luna study sessions: design

**Status:** Approved in conversation, 2026-10-24 (Abi). Spec awaiting review.
**Slice:** 1 of 2. This slice covers the session, the plan, the wrap-up into a summary and practice, and thin memory. Slice 2 (community sharing) gets its own spec.

## The principle this serves

The reader is the product. Even if someone uses nothing else, Learnstation is the best way to learn from a PDF. We never say this; the learner feels it. Luna sessions are a **layer on the reader**: the page stays the centre, and Luna sits beside it and can move it. Nothing here may make plain reading worse.

The feel we want: the agentic flow of a Claude Code session (a plan, visible steps, work done for you), the warmth of ChatGPT, and the "gets better at helping *you*" of Hermes Agent. **None of the machinery is ever visible.** No commands, no tool logs, no settings to learn.

## What the learner experiences

1. **Reading alone.** The reader is unchanged. Luna is a small face (the existing `Avatar` treatment) in the reader's corner.
2. **Starting a session.** There are three ways in, all landing in the reader:
   - Tap Luna and say anything ("exam Friday", "I don't get page 12").
   - Luna's gentle offer, at most **once per Lesson per day**, at a chapter end or after a missed checkpoint. One tap dismisses it for the rest of the day.
   - "Pick up with Luna" from the Space, or the "also today" row on Home. This reopens the Lesson at the right page.
3. **During the session:**
   - A **column beside the page**: about 380px on desktop, the page reflowing to the remaining width. On mobile it is a bottom sheet at about 45% height, with the page visible above it.
   - **Plan strip** at the top of the column: 3–5 steps with to-do / current / done / skipped states. Tap it to change the plan.
   - **Luna drives the page.** She turns to a page and lights a phrase. Every move leaves a `→ page 12` mark in the thread, and tapping the mark returns there.
   - **Answers use the existing interactive blocks** (`iui/spec.ts`, drawn by `Blocks.tsx`), with checks drawn by `CheckpointCard`.
   - **The learner can always take over.** They can read ahead, scroll, or ask. Luna follows from wherever they are and never pulls them back.
4. **Ending.** Ending happens on "done", on closing the column, or when the plan finishes. A **wrap card** shows what was covered, what clicked and what is still shaky, each point linking to its page. It has two actions: **Keep summary** and **Make practice from this**.
5. **Next time.**
   - The Space shows "Last time with Luna: … · N things still shaky", and kept summaries are listed under "Your sessions with Luna".
   - Luna already knows how this person likes to learn.

## Data model (one migration)

All new tables have RLS enabled. The owner gets `SELECT` with `auth.uid() = user_id`, and the backend writes with the service role. Learner `INSERT`/`UPDATE`/`DELETE` policies exist only where the API needs them:

- `learner_memory`: the learner can `UPDATE` (edit) and `DELETE`.
- `luna_sessions` and `luna_turns`: no learner write policies.

### `luna_sessions`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid → auth.users, on delete cascade | |
| space_id | text | course id, or the personal Space id (= user id, `v4_personal.py`) |
| lecture_id | uuid → lectures, on delete set null | the Lesson the session opened in |
| goal | text, ≤ 300 chars | in the learner's words, may be empty |
| plan | jsonb | `[{id, kind, title, target:{lecture_id, page?, concept_id?}, status}]`, 3–5 items |
| recap | text | running recap of turns older than the last 8 |
| status | text | `active` · `wrapped` · `abandoned` |
| wrap | jsonb, null | `{covered:[], clicked:[], shaky:[]}`, each item `{text, lecture_id, page}` |
| kept | boolean, default false | |
| turn_count | int, default 0 | capped at 60 |
| created_at, updated_at, ended_at | timestamptz | |

Index: `(user_id, space_id, updated_at desc)`.

### `luna_turns`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| session_id | uuid → luna_sessions, on delete cascade | |
| client_turn_id | uuid | idempotency key, unique per session |
| role | text | `learner` · `luna` · `move` |
| content | jsonb | learner: `{text}` or `{action}`. luna: `{say, blocks?, check?}`. move: `{lecture_id, page, spot?}` |
| created_at | timestamptz | |

Index: `(session_id, created_at)`. Unique: `(session_id, client_turn_id)`.

### `learner_memory`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid → auth.users, on delete cascade | |
| kind | text | `preference` · `shaky` · `strong` · `goal` |
| space_id | text, null | null = global. Preferences are global, shaky/strong are per Space. |
| text | text, ≤ 80 chars | plain words |
| source_session_id | uuid → luna_sessions, on delete set null | |
| active | boolean, default true | |
| retired_at | timestamptz, null | retired lines stay visible as "faded" for 30 days, then are purged |
| created_at, updated_at | timestamptz | |

Cap: **20 active lines per user**. When a new line would exceed the cap, the oldest-updated active line is retired.

### `review_cards` change

- Add `owner_id uuid null → auth.users on delete cascade`.
- Extend the `source_type` check with `'luna_session'`.
- Cards with an `owner_id` are visible only to that owner. The RLS on `review_cards` and any read path in the review engine must filter `owner_id is null or owner_id = auth.uid()`.
- The unique key `(lecture_id, content_hash)` must not collide across owners. Include the owner in the hash input for owned cards.

### GDPR

Add `luna_sessions`, `luna_turns`, `learner_memory`, and owned `review_cards` to:

- account export (`account_service.py`)
- account erasure (`erasure.py`)

Cover both with tests.

### Applying

Applying is by hand, with Abi's approval, after probing `pg_catalog`. **Never `supabase db push`.**

## Backend

New router `backend/api/v1/v4_luna.py`, mounted under `/api/v1/v4/luna`, only when `FEATURE_LUNA_SESSIONS` is true (`backend/core/config.py`). The service lives in `backend/services/v4_luna_service.py`, and prompts in `prompts.py` with a `PROMPT_VERSIONS` entry. Every AI call:

- uses `generate_text(..., json_mode=True, user_id=…, feature="luna_session")`
- is checked by `enforce_llm_budget`
- writes in the learner's language (`_lang`) and Luna's voice (`voice.py`)

### Endpoints

| method | path | does |
|---|---|---|
| POST | `/sessions` | `{space_id, lecture_id, page, opener}` → one AI call drafts the plan → session + plan |
| POST | `/sessions/{id}/turn` | `{client_turn_id, text? \| action?, reading_at?}` → event stream |
| POST | `/sessions/{id}/wrap` | one AI call → wrap card + memory changes |
| POST | `/sessions/{id}/keep` | sets `kept` |
| POST | `/sessions/{id}/practice` | one AI call → 3–6 owned `review_cards`, scheduled for the user |
| GET | `/sessions?space_id=` | the learner's sessions in a Space, newest first |
| GET | `/sessions/{id}` | session + turns (for replay) |
| GET / PATCH / DELETE | `/memory`, `/memory/{id}` | read, edit or delete memory lines. `DELETE /memory` forgets everything. |

**Turn actions:** `accept_plan`, `skip_step`, `edit_plan` (with the new plan), `continue`, `end`.

**Access:** every session endpoint checks that the session belongs to the caller. `POST /sessions` also checks `can_view_lecture`.

### Steps

Each step kind is executed by existing code:

| kind | does | reuses |
|---|---|---|
| `look` | turn to a page, light a phrase | lecture page text via `v4_reader_service` |
| `explain` | interactive answer about a page | `explain_page` + `validate_answer` |
| `ask` | grounded answer to the learner | `ask_page` |
| `connect` | "builds on…", jump to another Lesson | `find_in_course`, ideas' links |
| `check` | one committed-answer question | CheckpointCard shape |
| `teachback` | learner explains, Luna responds | `v4_teachback_service.teach_back` |

### A turn

1. **Build the context:**
   - the current plan step and the text of the pages it targets
   - the last 8 turns plus `recap`
   - active memory lines (global + this Space)
   - `reading_at`, the page the learner is actually on
2. **One AI call.** It returns `{say, move?:{lecture_id, page, spot?}, blocks?, check?, step_done, offer_wrap}`.
3. **Validate.** Anything that fails is dropped, and if nothing usable is left the turn becomes plain `say`. The checks:
   - the move's page exists in that Lesson
   - `spot` is found in that page's text (the same matching as `findText`)
   - the blocks pass `validate_answer`
   - the check has exactly one correct option
4. **Persist** the learner turn, the move and Luna's turn. Advance the plan when `step_done`. Every 8 turns, fold older turns into `recap`, inside the same call's output, with no extra call.
5. **Stream the events** (`text/event-stream` over POST) in this order: `move` → `say` → `blocks` → `plan` → `end`. An `error` event replaces the rest when the provider fails.

**Following the learner.** When `reading_at` differs from the step's target, the prompt is told where the learner is, and the turn starts from there. Luna never moves the page backward unless the learner asked her to.

**Limits:**
- 60 turns per session. Past that, `offer_wrap` is forced.
- One turn in flight per session (server lock).
- A repeated `client_turn_id` returns the stored turn and makes no new AI call.

**Failure:**
- Provider failure → the localized gentle line ("I lost my thread, say that again?"). The session state is unchanged.
- Budget exceeded → a calm message that the monthly allowance is used up. No partial turn is saved.

### Wrap-up and memory

**Input:** the plan with each step's outcome, every check result, the pages visited, and the active memory.

**Output:**
- `wrap`: every item's page is validated as above
- up to 3 new memory lines `{kind, space_scoped, text}`
- up to 3 line ids to retire

**Server rules for memory lines:**
- ≤ 80 chars
- reject lines containing digits that read as scores or grades, percentages, emails, phone numbers, or names of other people
- enforce the 20-line cap with retirement

**Prompts:** the plan, turn and wrap prompts include the active memory lines as a short plain list. A compact summary, not raw logs, matches the reasoning already documented in `ask_luna.py`.

### Practice from a session

3–6 questions built only from the session's pages, prioritising the shaky points and missed checks. They:

- pass the same checks as existing practice
- are stored as owned `review_cards` with `source_type='luna_session'`
- get a `review_schedule` row each, due today

**To verify while planning:** does the v4 Today surface read the review engine (behind `FEATURE_REVIEW_ENGINE`)? If it does not, connecting it is part of this slice.

## Frontend

New folder `src/features/spaces/components/reader/luna/`:

- `SessionColumn.tsx`: column / bottom-sheet chrome, holding the plan strip, the thread and the composer. One question in flight at a time.
- `PlanStrip.tsx`
- `MoveMark.tsx`
- `WrapCard.tsx`
- `useLunaConductor.ts`: the only link to the reader.
  - Maps `move` events to the reader's existing page navigation + `Spotlight`.
  - Reports `reading_at`, debounced, on page change.

Data in `src/features/spaces/data/`:

- `lunaSession.ts`: API client. Streams with `fetch` + `ReadableStream` (EventSource cannot send the auth header).
- `useLunaSession.ts`: state for plan, turns, in-flight, errors.

**`LessonFacesScreen.tsx`** (already about 1,300 lines) gains only a layout slot for the column and one `useLunaConductor` call.

**Other surfaces:**

| surface | change |
|---|---|
| Space screen | "Pick up with Luna" row + "Your sessions with Luna" (kept wraps) |
| Home | one "also today" line, only when a session is `active` and unfinished |
| Profile | "What Luna knows about you": list, edit, delete, "Forget everything", faded lines for 30 days |

**Rules:**
- **Live mode only.** In demo data mode the face, offer, column and Space rows do not render. This is the honesty rule `data/tutor.ts` already follows. The `seam.test.ts` mock ratchet must not grow.
- **i18n:** en + de, following `docs/V4_GLOSSARY.md`, the du-register and `docs/BRAND_VOICE.md`.
- **Accessibility:**
  - moves are announced through an `aria-live` region ("Luna moved to page 12")
  - the column follows the existing `useSummoned` focus contract
  - reduced motion → page jumps without animation

## Flags and rollout

1. `FEATURE_LUNA_SESSIONS` (backend) and `VITE_FEATURE_LUNA_SESSIONS` (frontend), both off by default.
2. Migration file → applied by hand with approval.
3. Local verification → Abi tries it → PR → merge.
4. Deploy only after the prod build passes the v4 flags. `Dockerfile.frontend` currently does not, which is a known blocker tracked separately.

## Testing

| layer | covers |
|---|---|
| backend unit | turn validation (out-of-range page, missing spot, invalid blocks → text fallback), plan validation, memory validation + cap/retirement, idempotent turns, one-in-flight lock, budget-exceeded path |
| db tests | RLS: user B cannot read A's sessions / turns / memory / owned cards. Owned cards invisible to other users through the review engine. GDPR export + erasure include all new data. |
| backend integration (AI stubbed) | start → plan → accept → turns with moves → wrap → keep → practice → cards scheduled |
| frontend vitest | conductor (move → page turn + spotlight; reading ahead sets `reading_at`), PlanStrip states, WrapCard actions, memory card edit/delete/forget, demo mode renders nothing, seam ratchet unchanged |
| gates | `npx tsc -p tsconfig.app.json`, vitest for touched areas, backend pytest |
| real | scenario **S8** in `docs/prompts/V4_SCENARIO_TESTING_PROMPT.md`, in the browser, English (Data Integration) and German (Softwaretechnik), with screenshot proof |

## Out of scope (later specs)

- Sharing a kept summary or practice set to the Space's community. This needs the contributions table and the community section.
- Word-by-word streaming (needs streaming in the orchestrator).
- Real tool calling.
- Sessions that span several Lessons.
- Luna sessions outside the reader.
