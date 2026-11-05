# How it's landing, Plan 3: the owner's door, live in v4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The person who runs a Space opens "How it's landing" from the Space's masthead and reads real, server-made patterns across at least five readers. No member is ever shown one by one, in the door or in any legacy view. The privacy page and the join screen say exactly that.

**Architecture:** Two pull requests. **PR A, "the floor holds"** (Tasks 1 to 8) is backend-heavy and depends on nothing in flight. It removes Plan 2's people routes, gates every legacy per-person view, makes four engine numbers honest, adds one migration, and changes the members' wording in the same PR as the gate. **PR B, "the door in v4"** (Tasks 9 to 16) starts once the parallel UI session's door PR has merged. It adds the live seam (`data/landing.ts` calls `GET /api/v1/v4/spaces/{id}/landing` and fills the colours client-side), the route `/v4/space/:spaceId/landing` behind `SpaceOwnerGate`, the door's loading, error and floor states, the masthead pill, a copy pass, and the Questions wiring that Plan 4's backend fills.

**Tech Stack:** FastAPI + asyncpg + Pydantic v2, Supabase Postgres (plpgsql trigger), pytest; React 18 + TypeScript + Vite, react-router-dom, motion/react, react-i18next (en+de), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-26-how-its-landing-design.md` (§0, §4 Phase C rows C1 to C7, A11, §6, §7 direction E, §8). Plan 1: `docs/superpowers/plans/2026-10-26-how-its-landing-plan-1-reader-telemetry.md` (PR #133, merged). Plan 2: `docs/superpowers/plans/2026-10-29-how-its-landing-plan-2-space-engine.md` (PR #142, merged). Plan 4 (the Questions backend) is being written in parallel by another agent.

## The design this plan builds against (Abi, 2026-11-05)

These supersede the spec where they differ. Each one is quoted in the task that implements it.

1. **No people, ever.** The door shows only patterns across at least five readers. The only names an owner ever sees are on Questions a learner chose to send.
2. **Questions for you sit above the map.** They are a hairline list with no cards and no middle-dot meta. Only unanswered questions are listed, and the heading carries no count. Answered questions fold into one "Answered" line at the bottom. When nothing is waiting, the section is absent.
3. **No per-Lesson reader count on the map**, because it repeated the top figure. Lessons under the five-reader floor are not drawn as rows; they collapse into one line below the map that names them.
4. **Luna names the Lesson, never the page:** the page is on her button ("Open page N") and on the map cell's label. Finding sentences name their page (one Lesson can hold two findings, so a sentence without it is ambiguous) but never their Lesson, which heads the strip. When more than one page needs the owner, Luna counts them: "2 pages are asking for you. Start with Normalization." (`door.lede.actPages`); with one: "Normalization has one page asking for you. The rest is landing."
5. **A big Space folds only what needs nothing:** 3 longest-waiting questions, Show more adds 10; runs of 3+ quiet Lessons fold in place; 2 loudest findings per Lesson; strips wrap at 40 pages; 4 under-floor names, then Show all (spec §8; `landing/ShowMore.tsx`, `landing/stepped.ts`).
6. **Traps first:** within a band, a page people said had clicked and then missed leads the ranking, so the door opens on it (Task 4b).

Decisions 2 to 5 are rendered by the **UI session** that is finalizing `src/features/spaces/landing/` right now. This plan does not re-implement them. It wires data under them and tests the parts that depend on live data.

## What the code says today (verified on `main` @ `ae1a6eaa`, 2026-11-05)

| Spec row | State | Evidence |
|---|---|---|
| C1 route + `SpaceOwnerGate` | **Not built.** `/v4/space/:spaceId/landing` falls into `:tab` and renders `CourseScreen`. | `src/App.tsx:466-470`; `src/features/spaces/screens/SpaceRoute.tsx:18-28` |
| C2 masthead pill | **Not built.** The copy exists already as `v4Landing:door.pill` ("How it's landing" / "Wie es ankommt"). | `src/features/spaces/screens/CourseScreen.tsx:172-180`; `src/i18n/locales/en/v4Landing.json` `door.pill` |
| C3/C4 the door screen | **Built on fixtures**, being finalized by the UI session. Its i18n already has `questions.fold` and `lessons.few`. | `src/features/spaces/landing/*` |
| C5 live seam | **Demo only.** `useLanding` returns fixtures; there is no live branch, no loading state and no error state. | `src/features/spaces/data/landing.ts:18-33` |
| C6 en+de, vocabulary, motion, phone | Partly. The door's components respect `useReducedMotion`. The seam ratchet does **not** cover `landing/`: it walks only `screens`, `components` and `studio`. | `src/features/spaces/__tests__/seam.test.ts:26` |
| C7 tests | Fixture tests only (`__tests__/landing.test.tsx`, 211 lines). Nothing covers the pill, the gate or live mapping. | |
| Plan 2 endpoint | Exists. It returns `Landing` without `accent` or `lessons[].color`, with `questions: []`, and with `lessons[].readers`. | `backend/services/v4_landing_service.py:75-121` |
| Plan 2 people routes | Exist behind `FEATURE_LANDING_PEOPLE` plus a salt of at least 32 characters. Neither is set in any env file or compose file. | `backend/api/v1/v4_landing.py:41-73`; `backend/core/config.py:133-138` |
| `/v4/space/:id/manage` | Live: redirects to the classic manager `/professor/courses/:id` (personal Space: `/v4/library`). | `src/features/spaces/screens/SpaceManageScreen.tsx:127` |

## Decisions this plan makes (read before executing)

1. **Plan 2's people routes are removed, not just left flagged off.** The decision is "no people, ever." Code that turns on with one env var and a salt is one keystroke from a breach. Nothing calls it, and its tests go with it. `detect_silent_strugglers` stays in `detectors.py`, because the spec keeps the detectors untouched (§1.1). Both engines skip it instead: the v4 engine already does (`space_engine.py:116`), and the legacy engine stops in Task 5.
2. **The legacy per-person gate is global.** Nothing in the schema tells a v4 Space from a legacy course: `create_space` inserts the same `courses` row (`backend/services/v4_spaces_service.py:47-61`), joining writes the same `course_enrollments`, and prod routes every learner to `/v4`. So "v4 Space members are never shown per person" means no course's members are shown per person. The gated surfaces are those named in spec A11:
   - Silent Strugglers rows;
   - the Journey;
   - `/api/analytics/lecture/{id}/students`;
   - `/api/analytics/lecture/{id}/dashboard` `studentsMatrix` (it carries raw user ids, `analytics_service.py:826`);
   - both Ask "struggling_students" intents;
   - the assignments roster.
3. **The assignments roster keeps working, but only for people who chose to be seen.** That means `profiles.show_in_spaces = true`, the same switch the privacy page already describes for names in Spaces. Removing assignments is Abi's call (see Open questions).
4. **Two residuals stay, and both are written down.**
   - The professor RLS policies on `learning_events` and `student_progress` (`20260621000000_scope_professor_read_policies.sql:27-56`) still let a professor-role owner read per-person rows straight from Supabase. The legacy garden's bundle reads through exactly that policy (`insights/bundle.py`, through the owner's JWT), so closing it is the console's retirement (spec Phase D), not this plan.
   - `course_enrollments` is readable by the course owner (`20260611000000_fix_courses_rls_recursion.sql:25-31`).
   - Neither path carries a name: `profiles` RLS restricts SELECT to the row owner (`backend/api/v1/assignments.py:407-408`). The new wording therefore says "never by name", which stays true.
5. **Colour.** The live seam sets `accent = stageAccentFor(spaceName.length)`, as `SpaceScreen.tsx:204` and `PracticeScreen.tsx:81` do. It sets `lessons[].color = stageAccentFor(order)`, as the fixtures do (`mocks/landing.ts:56`).
   - Spec C3 and §7 say "live: `sampleAccent` of its first page". This plan does not do that. `sampleAccent` (`src/components/pdf/sampleAccent.ts:18`) needs each Lesson's first page drawn into a canvas, which means one PDF render per Lesson on every door load. Posters are not CORS-readable for canvas either (memory: hub moods, 2026-11-02).
   - A sampled hue belongs on the Lesson at ingest, as Plan 2 Decision 2 says. That is a follow-up, not Plan 3.
6. **`/v4/space/:id/manage` stays as it is.** It covers rename, reorder, remove and the classic upload flow, which v4 has no room for yet. The analytics now live in the door, so the OwnerBar's comment stops promising analytics there. Task 5 gates the classic manager's per-person analytics with everything else.
7. **No new frontend flag for the door.** It is reachable only by a Space's owner, only from its masthead. The endpoint is already mounted under `FEATURE_V4` (on in prod). Most real Spaces will show the floor state (real usage is near zero, measured 2026-10-30), and that state is the one this plan makes good.
8. **The wire drops `lessons[].readers`** (Task 14) once the UI session has stopped drawing it (decision 3). Under the floor, a Lesson is `light: "few"`, which is all the collapse line needs. The less the payload says about small groups, the less there is to leak.
9. **Questions are Plan 4's.** The seam reads `questions` when the payload has it and passes `[]` otherwise. The UI then renders nothing (decision 2: no waiting questions, no section).
   - Answering posts to the endpoint the spec names (§6): `POST /api/v1/v4/spaces/{id}/questions/{qid}/answer`.
   - Task 15 is marked **depends on Plan 4**. The names below are the contract Plan 4 is asked to keep.
10. **Under the Space's floor** the door shows Luna's one line (spec C3), and Questions if any are waiting. It shows no figures, no light and no map rows.
    - Luna's line already says patterns come at five, so no "too few" line is drawn under her (one fact, once).
    - This is the UI session's rendering. Task 11 only tests it on live-shaped data.

## Questions payload expected from Plan 4

Plan 3 consumes this shape and nothing else. It is the `LandingQuestion` type already in `src/features/spaces/landing/types.ts:87-104`. **Provided by Plan 4.**

```ts
// GET /api/v1/v4/spaces/{id}/landing  →  Landing.questions (optional on the wire; absent or [] until Plan 4 ships)
interface LandingQuestion {
  id: string;
  lessonId: string;
  page: number;
  text: string;                 // verbatim: the learner chose to send it
  asker: { id: string; name: string; avatarUrl: string | null } | null;   // null = sent without a name
  createdAt: string;            // ISO 8601
  answer?: { text: string; forEveryone: boolean; at: string };
}
// Ordered: unanswered first (newest first), then answered (newest answer first).

// POST /api/v1/v4/spaces/{id}/questions/{qid}/answer   body { text: string; visibility: 'asker' | 'space' }
// → 200 { text: string; forEveryone: boolean; at: string }   (403 member, 404 anyone else, 409 already answered)
```

If Plan 4 lands a different name or shape, Task 15 adapts the seam; the screen never changes.

## Dependencies, marked on each task

- **[UI session]** The task edits or tests files the UI session is finalizing (`src/features/spaces/landing/*`, `src/i18n/locales/*/v4Landing.json`, `mocks/landing.ts`, `__tests__/landing.test.tsx`). Start it only after that PR has merged to `main`. Then re-read the file before editing; line numbers in this plan for those files are as of `ae1a6eaa` and will have moved.
- **[Plan 4]** The task needs Plan 4's endpoint names. It can be written against the contract above and merged without Plan 4; it does nothing visible until Plan 4's backend ships.
- Everything else (all of PR A, and Tasks 9, 10, 12) depends on nothing in flight.

## Global Constraints

- No member is ever shown one by one. The only names an owner sees are on Questions a learner chose to send (decision 1).
- `MIN_READERS = 5` (`backend/services/insights/space_engine.py:23`) is the floor for every share the door prints. A new share added by this plan has its own five-people gate.
- The backend emits kinds and numbers, never English copy (spec B5). Payload keys are camelCase.
- `src/features/spaces` may import only what `src/features/spaces/__tests__/boundary.test.ts:55-125` allows: `react-i18next` and `@/i18n` yes, `i18next` no, no `fetch`. Live calls go through `data/liveRepository.ts`.
- v4 copy: en and de keys match. German is du, with no exclamation marks. No em or en dashes in new copy. Words follow `docs/V4_GLOSSARY.md`: Space, Lesson/Lektion, page/Seite, idea/Idee. Never Folie, Vorlesung, Kurs, professor, student, lecture, slide, course.
- Migrations are applied **by hand** with psql (`docs/runbooks/apply-a-migration-by-hand.md`). **Never `supabase db push`.** A new or replaced `SECURITY DEFINER` function needs its `REVOKE`/`GRANT` in the same file (`backend/scripts/lint_new_definer_functions.py`).
- Backend tests never run with a `.env` you do not trust: `backend/services/ai/orchestrator.py` calls `load_dotenv(override=True)`. DB tests (`-m db`) run only against a throwaway Postgres (`DB_TEST_LOCAL_ADMIN_DSN`, for example a Homebrew Postgres on port 54329 initialised in a scratch dir), never the `.env` database.
- Commands, from the repo root:
  - Node: `export PATH="/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin:$PATH"` before `npx`.
  - Python: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest … -q -p no:cacheprovider`.
- Gates every task keeps green:
  - `npm run lint`
  - `npx vitest run`
  - `npx tsc --noEmit -p tsconfig.app.json` (not `tsconfig.json`, which checks nothing)
  - `.venv/bin/python -m pytest backend/tests -m "not db" -q`
  - `ruff check backend/ --select F821,F811,F841`
- Abi runs several Claude sessions on one working tree. Re-run `git status` and `git log -1` before every commit and every push.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR descriptions end with the Claude Code line.

## File Structure

**PR A: backend**
- Delete: `backend/services/insights/people.py`, `backend/tests/unit/test_landing_people.py`.
- Modify: `backend/api/v1/v4_landing.py` (people routes out), `backend/services/v4_landing_service.py` (people out, themes askers + parallel), `backend/core/config.py` (two settings out), `backend/services/utils/analytics_utils.py` (`space_pseudonym` out).
- Create: `supabase/migrations/20261105000000_analytics_cache_invalidation_real_lessons.sql`; test `backend/tests/db/test_analytics_cache_invalidation.py`.
- Modify: `backend/services/insights/space_facts.py` (`person_share`), `space_engine.py` (per-person quiz share, quiz_misalignment needs five raters), `figures.py` (cleared per person), `themes.py` (empty themes kept an hour), `backend/services/analytics_cache.py` (`ttl_for`).
- Modify (legacy gate): `backend/services/insights/engine.py`, `backend/services/insights/evidence.py`, `backend/api/v1/analytics.py`, `backend/services/analytics_service.py`, `backend/services/ai/ask_data.py`, `backend/services/ai/ask_professor.py`, `backend/api/v1/assignments.py`.
- Tests: `backend/tests/unit/test_v4_landing_api.py`, `test_landing_space_engine.py`, `test_landing_figures.py`, `test_landing_themes.py`, `test_analytics_cache.py`, new `test_legacy_people_gate.py`; edits to `test_insight_engine*`/`test_ask_data.py`/`test_ask_professor.py`/`test_analytics_service.py`, `backend/tests/integration/test_ask_data_endpoint.py`, `test_assignments_endpoints.py`, `backend/tests/contract/test_response_schemas.py`.

**PR A: frontend (legacy gate + wording)**
- Delete: `src/features/analytics/garden/viz/AtRiskStudentList.tsx`, `src/features/analytics/garden/evidence/StudentJourneyStoryboard.tsx`.
- Modify: `src/features/analytics/garden/Layer2Viz.tsx`, `src/features/analytics/garden/EvidenceDrawer.tsx`, `src/features/analytics/types/index.ts`, `src/services/analyticsService.ts`, `src/pages/AdvancedAnalytics.tsx`, `src/test/handlers/index.ts`, `src/__tests__/pages/AdvancedAnalytics.test.tsx`.
- Modify: `src/i18n/locales/{en,de}/v4Spaces.json` (`join.privacy`), `src/i18n/locales/{en,de}/legal.json` (`privacy.section3Items[1]`, last-updated line), `src/features/spaces/__tests__/join-privacy.test.ts`.

**PR B: the door**
- Modify: `src/features/spaces/data/liveRepository.ts` (`landing`, `answerQuestion`), `src/features/spaces/data/landing.ts` (live seam).
- Create: `src/features/spaces/screens/SpaceOwnerGate.tsx`, `src/features/spaces/screens/LandingRoute.tsx`.
- Modify: `src/App.tsx` (route), `src/features/spaces/screens/CourseScreen.tsx` (pill), `src/features/spaces/components/course/OwnerBar.tsx` (comment only), `src/features/spaces/landing/LandingScreen.tsx` (states) **[UI session]**, `src/i18n/locales/{en,de}/v4Landing.json` (copy pass) **[UI session]**, `src/features/spaces/__tests__/seam.test.ts` (cover `landing/`).
- Modify (wire): `backend/services/v4_landing_service.py` (drop `lessons[].readers`) **[UI session]**.
- Tests: new `src/features/spaces/__tests__/landing-live.test.tsx`, `src/features/spaces/__tests__/landing-door.test.tsx`; `src/features/spaces/components/__tests__/oneApp.test.tsx` (pill).

---

### Task 0: A branch, and a baseline

**Files:** none changed by hand.

- [ ] **Step 1: Check the tree and make the branch**

```bash
cd /Users/abdullahabobaker/Desktop/ascend-academy
git status && git log -1 --oneline
git fetch origin && git switch -c claude/landing-plan-3-floor origin/main
```

If you work in a worktree instead, it branches from `main` and has no `node_modules` or `.env`. Run `npm ci` there; the venv path above is absolute and works anywhere.

Copy this plan file into the branch and make it the first commit:

```bash
git add docs/superpowers/plans/2026-11-05-how-its-landing-plan-3-door-in-v4.md
git commit -m "docs: How it's landing, plan 3 (the door in v4, the floor holds)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Baseline every gate**

```bash
export PATH="/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin:$PATH"
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npx vitest run
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests -m "not db" -q -p no:cacheprovider
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/ruff check backend/ --select F821,F811,F841
node scripts/check-vocabulary.mjs src/features/spaces | tail -3
```

Write down the counts: tests passed, and the vocabulary total. A failure that is already red here is pre-existing: note it and do not fix it in this plan.

Check for a throwaway Postgres for Task 2:

```bash
psql "${DB_TEST_LOCAL_ADMIN_DSN:-postgresql://localhost:5432/postgres}" -c 'select version()'
```

If none answers, start one in the scratchpad (`initdb -D <scratch>/pg && pg_ctl -D <scratch>/pg -o "-p 54329 -c unix_socket_directories=''" start`). Then export `DB_TEST_LOCAL_ADMIN_DSN=postgresql://postgres@127.0.0.1:54329/postgres` (use `initdb -U postgres`).

---

## PR A: the floor holds

### Task 1: No people, ever: Plan 2's person-level routes go

**Files:**
- Delete: `backend/services/insights/people.py`, `backend/tests/unit/test_landing_people.py`
- Modify:
  - `backend/api/v1/v4_landing.py:9-16` (imports) and `:41-73` (people routes)
  - `backend/services/v4_landing_service.py:1-10` (docstring), `:21` (import), `:151-164` (`get_people`, `get_journey`)
  - `backend/core/config.py:133-138`
  - `backend/services/utils/analytics_utils.py:5` (`import hmac`) and `:26-35` (`space_pseudonym`)
  - `docs/superpowers/specs/2026-10-26-how-its-landing-design.md` §0 row "Person-level pieces" and §8 item 1
- Test: `backend/tests/unit/test_v4_landing_api.py`

**Interfaces:**
- Produces: `GET /api/v1/v4/spaces/{id}/landing/people` and `…/people/{person}/journey` answer 404 whatever the env holds. `backend.services.insights.people` no longer exists. `settings` has no `feature_landing_people` and no `landing_pseudonym_salt`. Pydantic's `extra="ignore"` (`backend/core/config.py:24`) keeps a stray env var harmless.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/unit/test_v4_landing_api.py`:

```python
def test_there_is_no_view_of_people_whatever_the_settings(client, monkeypatch):
    """Decided 2026-11-05: no people, ever. No flag or salt brings a person-level view back."""
    import importlib.util

    from backend.core.config import settings

    monkeypatch.setattr(settings, "feature_landing_people", True, raising=False)
    monkeypatch.setattr(settings, "landing_pseudonym_salt", "s" * 64, raising=False)
    assert client.get(f"/api/v1/v4/spaces/{SPACE}/landing/people").status_code == 404
    url = f"/api/v1/v4/spaces/{SPACE}/landing/people/p_0123456789abcdef/journey?lesson={SPACE}"
    assert client.get(url).status_code == 404
    assert importlib.util.find_spec("backend.services.insights.people") is None
```

- [ ] **Step 2: Run it to see it fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_landing_api.py -k no_view_of_people -q -p no:cacheprovider`
Expected: FAIL. With the flag and salt set, `/landing/people` answers 200.

- [ ] **Step 3: Remove the people code**

```bash
git rm backend/services/insights/people.py backend/tests/unit/test_landing_people.py
```

In `backend/api/v1/v4_landing.py`:
- change line 12 to `from fastapi import APIRouter, Depends, HTTPException, Request`;
- delete line 15 (`from backend.core.config import settings`);
- delete lines 41 to 73 (from `#: A salt shorter than this` to the end of the file).

The file ends after `v4_landing` (line 38).

In `backend/services/v4_landing_service.py`:
- delete line 21 (`from backend.services.insights.people import journey, strugglers`);
- delete lines 151 to 164 (`get_people`, `get_journey`);
- in the module docstring, after "Nothing in the payload names a member or quotes one (spec §0).", add: "There is no person-level view of a Space at all (decided 2026-11-05)."

In `backend/core/config.py`, delete lines 133 to 138: the comment "Person-level pieces of the owner's view…" and the two fields `feature_landing_people`, `landing_pseudonym_salt`.

In `backend/services/utils/analytics_utils.py`, delete `space_pseudonym` (lines 26 to 35) and `import hmac` (line 5). `generate_anon_name` stays; the legacy code still uses it.

In the spec, change the §0 row "Person-level pieces (Strugglers list, Journey)" to:

`| Person-level pieces (Strugglers list, Journey) | **None, ever** (Abi, 2026-11-05). The door shows patterns across at least five readers; the only names an owner sees are on Questions a learner chose to send. Plan 2's flagged routes were removed in Plan 3. |`

Change §8 item 1 to:

`1. ~~Privacy call on Strugglers + Journey.~~ Decided 2026-11-05: no people, ever.`

- [ ] **Step 4: Run the tests**

```bash
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_landing_api.py -q -p no:cacheprovider
grep -rn "landing_people\|pseudonym_salt\|space_pseudonym\|insights.people" backend src docs/runbooks .env.example docker-compose*.yml
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/ruff check backend/ --select F821,F811,F841
```

Expected: all pass. The grep prints nothing; the historical plan docs are not in the searched paths.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add -A backend/api/v1/v4_landing.py backend/services/v4_landing_service.py backend/core/config.py \
  backend/services/utils/analytics_utils.py backend/tests/unit/test_v4_landing_api.py \
  docs/superpowers/specs/2026-10-26-how-its-landing-design.md
git commit -m "feat(landing)!: no person-level view of a Space, ever

Removes the people and journey routes Plan 2 left behind FEATURE_LANDING_PEOPLE.
Abi, 2026-11-05: the door shows patterns across at least five readers only.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A forged event can no longer wipe a Space's cached view

Why: `trg_invalidate_analytics_cache` deletes every `analytics_cache` row whose `lecture_id` equals the event's `event_data.lectureId` (`supabase/migrations/20260719000001_debounce_analytics_cache_invalidation.sql:79-106`). The door's `landing` view and its `themes` (one metered model call per page, cached 30 days, `themes.py:25`) are keyed by the **Space's** id in that same slot (`v4_landing_service.py:62`, `themes.py:128-133`).

A member who inserts a `learning_events` row with `lectureId` set to the Space id therefore wipes both every 15 seconds. That re-runs the owner's metered theme calls on the owner's allowance.

**Files:**
- Create: `supabase/migrations/20261105000000_analytics_cache_invalidation_real_lessons.sql`
- Test: `backend/tests/db/test_analytics_cache_invalidation.py`

**Interfaces:**
- Produces: `public.invalidate_analytics_cache_on_event()` returns early unless `lectureId` names a row in `public.lectures`. The signature, the trigger binding and the debounce stay as they are.

Coordination: Plan 4 also adds a migration. It must not use the timestamp `20261105000000`; CI fails on duplicates (`backend/scripts/check_migration_timestamps.py`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/db/test_analytics_cache_invalidation.py`:

```python
"""A learning event clears only a real Lesson's cache: never a Space's views, whatever lectureId it claims."""
from __future__ import annotations

import json
import uuid

import pytest

pytestmark = pytest.mark.db


def _cached(cur, key, view):
    cur.execute(
        "INSERT INTO public.analytics_cache (lecture_id, view_name, params_hash, payload) VALUES (%s, %s, %s, '{}'::jsonb)",
        (str(key), view, uuid.uuid4().hex[:8]),
    )


def _event(cur, user, lecture_id):
    cur.execute(
        "INSERT INTO public.learning_events (user_id, event_type, event_data) VALUES (%s, 'slide_view', %s::jsonb)",
        (str(user), json.dumps({"lectureId": str(lecture_id), "page": 1, "duration_seconds": 30,
                                "sessionId": str(user), "timestamp": "x"})),
    )


def _rows(cur, key):
    cur.execute("SELECT count(*) FROM public.analytics_cache WHERE lecture_id = %s", (str(key),))
    return cur.fetchone()[0]


def test_an_event_naming_the_space_instead_of_a_lesson_clears_nothing(db_conn, make_user, make_course):
    tag = uuid.uuid4().hex[:6]
    member = make_user(email=f"m-{tag}@gmail.com")
    space = make_course(make_user(email=f"o-{tag}@gmail.com"), title=f"S {tag}")
    with db_conn.cursor() as cur:
        _cached(cur, space, "landing")
        _cached(cur, space, "themes")
        _event(cur, member, space)
        assert _rows(cur, space) == 2
        cur.execute("SELECT count(*) FROM public.analytics_cache_invalidation_debounce WHERE lecture_id = %s", (str(space),))
        assert cur.fetchone()[0] == 0


def test_an_event_on_a_real_lesson_still_clears_that_lessons_cache(db_conn, make_user, make_lecture):
    tag = uuid.uuid4().hex[:6]
    owner = make_user(email=f"o2-{tag}@gmail.com")
    lesson = make_lecture(owner, title="Normalization")
    with db_conn.cursor() as cur:
        _cached(cur, lesson, "insights")
        _event(cur, owner, lesson)
        assert _rows(cur, lesson) == 0


def test_the_trigger_function_stays_out_of_anons_reach(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT has_function_privilege('anon', 'public.invalidate_analytics_cache_on_event()', 'EXECUTE')")
        assert cur.fetchone()[0] is False
```

- [ ] **Step 2: Run it to see it fail**

Run: `DB_TEST_LOCAL_ADMIN_DSN=$DB_TEST_LOCAL_ADMIN_DSN /Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest -m db backend/tests/db/test_analytics_cache_invalidation.py -q -p no:cacheprovider`
Expected: the first test FAILS, `assert 0 == 2`: the forged event wiped the Space's rows. The other two pass.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261105000000_analytics_cache_invalidation_real_lessons.sql`:

```sql
-- How it's landing, Plan 3: a learning event clears only a real Lesson's cache.
--
-- trg_invalidate_analytics_cache (20260719000001) deletes every analytics_cache
-- row whose lecture_id equals the event's event_data->>'lectureId'. A member
-- writes their own events, so they choose that value. Since Plan 2 the owner's
-- view of a Space ('landing') and its themes ('themes', one metered model call
-- per page) are cached under the SPACE's id in that same slot, so an event that
-- names the Space id wiped both every 15 seconds and re-ran the owner's theme
-- calls on the owner's allowance. professor_overview shares the slot too.
--
-- Fix: invalidate only when lectureId is an existing lecture. A Space's views
-- expire by their own TTL (300 s for landing; themes are keyed by asker count).
-- Same signature, so the trigger binding and the existing ACL stay; the REVOKE
-- below repeats 20261011000000 for this file's own lint.

CREATE OR REPLACE FUNCTION public.invalidate_analytics_cache_on_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    lid              uuid;
    did_invalidate   boolean;
BEGIN
    BEGIN
        lid := NULLIF(NEW.event_data->>'lectureId', '')::uuid;
    EXCEPTION WHEN others THEN
        lid := NULL;
    END;

    IF lid IS NULL THEN
        RETURN NEW;
    END IF;

    -- Only a real Lesson's cache. Anything else (a Space's id, a made-up id)
    -- names no lecture: nothing to clear, and no debounce row to write.
    IF NOT EXISTS (SELECT 1 FROM public.lectures WHERE id = lid) THEN
        RETURN NEW;
    END IF;

    did_invalidate := NULL;
    INSERT INTO public.analytics_cache_invalidation_debounce (lecture_id, last_invalidated_at)
    VALUES (lid, now())
    ON CONFLICT (lecture_id) DO UPDATE
        SET last_invalidated_at = now()
        WHERE public.analytics_cache_invalidation_debounce.last_invalidated_at
              <= now() - interval '15 seconds'
    RETURNING true INTO did_invalidate;

    IF did_invalidate THEN
        DELETE FROM public.analytics_cache WHERE lecture_id = lid;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.invalidate_analytics_cache_on_event() FROM PUBLIC, anon;
```

- [ ] **Step 4: Run the tests and the migration lints**

```bash
DB_TEST_LOCAL_ADMIN_DSN=$DB_TEST_LOCAL_ADMIN_DSN /Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest -m db backend/tests/db/test_analytics_cache_invalidation.py backend/tests/db/test_v4_landing_db.py backend/tests/db/test_anon_security_definer_exposure.py -q -p no:cacheprovider
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python backend/scripts/lint_new_definer_functions.py supabase/migrations/20261105000000_analytics_cache_invalidation_real_lessons.sql
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python backend/scripts/check_migration_timestamps.py
```

Expected: all pass. Both lints exit 0. Report which Postgres ran the DB tests.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add supabase/migrations/20261105000000_analytics_cache_invalidation_real_lessons.sql backend/tests/db/test_analytics_cache_invalidation.py
git commit -m "fix(db): a learning event clears only a real Lesson's cache

A member-written lectureId equal to a Space id wiped that Space's landing view
and its metered themes every 15 s.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A quiz share counts each person once, and "read easily" needs people who said so

Two of Plan 2's final-review leftovers. Both are in the engine's input, so the detectors stay untouched.

- **Per-person quiz share.** `page_row` takes `quiz_success_rate` over tries (`space_engine.py:47,61`), and the `cleared` figure does the same per week (`figures.py:71-74`). One member who answers ten questions outweighs four who answer one each. Each person now counts once: their own share right, averaged over the people who tried.
- **quiz_misalignment only with five reader raters.** The detector's premise is "the page read easily" (low confusion, `detectors.py:302-310`). With fewer than five raters, `page_row` empties the ratings (`space_engine.py:36-38`), so confusion is 0 by absence and the finding fires on a guess. The door's copy then says "read easily".

**Files:**
- Modify: `backend/services/insights/space_facts.py` (add `person_share` after `first_tries`, line 119)
- Modify: `backend/services/insights/space_engine.py:39-47,61-62` (`page_row`), `:127-130` (`kept`)
- Modify: `backend/services/insights/figures.py:72-74`
- Test: `backend/tests/unit/test_landing_space_engine.py`, `backend/tests/unit/test_landing_figures.py`

**Interfaces:**
- Produces: `space_facts.person_share(tries: Iterable[Try]) -> Optional[float]`, the mean over people of each one's share right (0 to 1), or `None` when no one tried. `page_row(...)["quiz_attempts"]` is now the number of **people** who tried (already gated at five), not tries.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_landing_space_engine.py`:

```python
def test_a_quiz_share_counts_each_person_once():
    # r0 gets ten questions right; four others miss their one. By tries that is 10 of 14 (71%); by people, 1 of 5 (20%).
    pf = PageFacts(readers=readers(10), sittings=[40.0] * 10)
    pf.tries = [Try("r0", "l1", 3, None, True, AT, "practice") for _ in range(10)] + tries({"r1", "r2", "r3", "r4"}, lambda p: False)
    row = page_row("l1", 3, pf)
    assert (row["quiz_success_rate"], row["quiz_attempts"]) == (20.0, 5)


def _misaligned(ratings):
    """Page 3: six readers tried its question and one got it right; `ratings` is who said how it read."""
    pf = PageFacts(ratings=ratings)
    pf.tries = tries(readers(6), lambda p: p == "r0")
    return _with_page_three(pf)


def test_a_question_that_tests_something_else_needs_five_who_said_how_the_page_read():
    # No one said how page 3 read: "it read easily" would be a guess from silence.
    assert not any(i["kind"] == "quiz_misalignment" for i in lesson_insights(_misaligned({})))


def test_five_who_found_the_page_fine_and_then_missed_its_question_are_a_finding():
    said = {"r0": "got_it", "r1": "got_it", "r2": "unsure", "r3": "unsure", "r4": "unsure"}
    found = [i for i in lesson_insights(_misaligned(said)) if i["kind"] == "quiz_misalignment"]
    assert [pages_of(i) for i in found] == [[3]]
```

Append to `backend/tests/unit/test_landing_figures.py`:

```python
def test_cleared_counts_each_person_once_however_many_questions_they_answered():
    reads = [read(f"m{i}", 1) for i in range(6)]
    busy = [ev("m0", "checkpoint_attempt", 1, page=9, idea="J", kind="choice", questionId=q, correct=True) for q in range(1, 11)]
    once = [ev(f"m{i}", "checkpoint_attempt", 1, page=9, idea="J", kind="choice", questionId=1, correct=False) for i in range(1, 5)]
    # By tries 10 of 14 (71%); by people 1 + 0 + 0 + 0 + 0 over 5 = 20%.
    assert figures(space(*reads, *busy, *once), 5)["cleared"]["value"] == 20
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_landing_space_engine.py backend/tests/unit/test_landing_figures.py -q -p no:cacheprovider`
Expected: three FAIL.
- The quiz share is 71.4 with 14 attempts.
- quiz_misalignment fires with no raters.
- `cleared` is 71.

`test_five_who_found_…` passes already; it pins the case that must keep working.

- [ ] **Step 3: Implement**

In `backend/services/insights/space_facts.py`, add `import statistics` to the imports, `Iterable` to the `typing` import, and after `first_tries` (ends line 119):

```python
def person_share(tries: Iterable[Try]) -> Optional[float]:
    """Of the people who tried, the mean of each one's share right (0 to 1); None when no one tried.

    Each person counts once, however many questions they answered: one member
    answering ten never outweighs four answering one.
    """
    by_person: dict[str, list[bool]] = defaultdict(list)
    for t in tries:
        by_person[t.user_id].append(t.correct)
    if not by_person:
        return None
    return statistics.fmean(sum(v) / len(v) for v in by_person.values())
```

In `backend/services/insights/space_engine.py`:
- change the `space_facts` import (line 18) to `from backend.services.insights.space_facts import SHORT_VIEW, LessonFacts, PageFacts, person_share`;
- in `page_row`, replace `right = sum(1 for t in tries if t.correct)` (line 47) with `share = person_share(tries)`;
- replace lines 61 and 62 with:

```python
        "quiz_success_rate": round(share * 100, 1) if share is not None else None,
        # People who tried (each counted once), already at least MIN_READERS or none.
        "quiz_attempts": len({t.user_id for t in tries}),
```

and replace `kept` (lines 127 to 130) with:

```python
    def kept(insight: dict[str, Any]) -> bool:
        if insight.get("kind") == "leaky_bucket":
            return _drop_persists(lf, pages_of(insight)[0])
        if insight.get("kind") == "quiz_misalignment":
            # "It read easily" is said only when five of the page's readers said how it read.
            pf = lf.pages.get(pages_of(insight)[0], PageFacts())
            return sum(1 for u in pf.ratings if u in pf.readers) >= MIN_READERS
        return True
```

In `backend/services/insights/figures.py`:
- change the import (line 25) to `from backend.services.insights.space_facts import first_tries, lesson_facts, person_share`;
- replace lines 72 to 75 with:

```python
    cleared: list[Optional[int]] = [
        round(100 * person_share(ts)) if ts and len({t.user_id for t in ts}) >= floor else None
        for ts in tries
    ]
```

and in the module docstring change "the percent they got right" to "the percent they got right, each person counted once".

- [ ] **Step 4: Run the tests**

```bash
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_landing_space_engine.py backend/tests/unit/test_landing_figures.py backend/tests/unit/test_landing_map.py backend/tests/unit/test_v4_landing_api.py backend/tests/unit/test_insight_detectors.py -q -p no:cacheprovider
```

Expected: all pass. `test_a_page_row_carries_what_the_detectors_read` keeps 80.0 and 5: five people, one try each, four right.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add backend/services/insights/space_facts.py backend/services/insights/space_engine.py backend/services/insights/figures.py \
  backend/tests/unit/test_landing_space_engine.py backend/tests/unit/test_landing_figures.py
git commit -m "fix(landing): a quiz share counts people once; 'read easily' needs five who said so

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Themes: only people who wrote something, empty results kept briefly, pages asked for at once

Three leftovers, all in the same code path:

- **Askers with text.** `_themes` counts `pf.ask & pf.readers` (`v4_landing_service.py:135`). An Ask opened with no text counts toward the five, so themes could be made from four people's words.
- **Short TTL when nothing usable came back.** A result of `[]` is cached for 30 days (`themes.py:25,133`), so that page never gets themes until someone new asks.
- **In parallel.** The up-to-five pages are awaited one after another (`v4_landing_service.py:141-147`).

**Files:**
- Modify: `backend/services/v4_landing_service.py:124-148` (`_themes`), plus `import asyncio`
- Modify: `backend/services/insights/themes.py:23-26` (constant), `:127-134` (`ttl_for`)
- Modify: `backend/services/analytics_cache.py:117-142` (`get_or_compute_async` gains `ttl_for`)
- Test: `backend/tests/unit/test_v4_landing_api.py`, `backend/tests/unit/test_landing_themes.py`, `backend/tests/unit/test_analytics_cache.py`

**Interfaces:**
- Produces:
  - `analytics_cache.get_or_compute_async(..., ttl_for: Optional[Callable[[Any], int]] = None)`: when given, the TTL written is `ttl_for(result)`.
  - `themes.EMPTY_THEMES_TTL = 3600`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_v4_landing_api.py`:

```python
def _foggy(page):
    return [Event(f"m{i}", "confidence_rating", {"lectureId": L1, "page": page, "rating": "confused" if i < 8 else "got_it"},
                  NOW - timedelta(days=1)) for i in range(10)]


def test_only_askers_who_wrote_something_count_toward_themes(prompts):
    worded = [_ask(f"m{i}", 3, f"Why {i}", i) for i in range(4)]
    blank = [_ask("m5", 3, "   ", 9)]
    body = asyncio.run(service.landing_from(_data(tuple(_reads() + _foggy(3) + worded + blank)), "en"))
    assert any(i["kind"] == "confusion_hotspot" for i in body["insights"])
    assert body["themes"] == [] and prompts == []


def test_themes_for_several_pages_are_asked_for_at_once(monkeypatch):
    started: list[int] = []
    both = asyncio.Event()

    async def slow(**kw):
        started.append(kw["page"])
        if len(started) == 2:
            both.set()
        await asyncio.wait_for(both.wait(), timeout=1)
        return ["A theme"]

    monkeypatch.setattr(service, "themes_for", slow)
    asks = [_ask(f"m{i}", p, f"Why {p} {i}", 10 * p + i) for p in (3, 4) for i in range(6)]
    body = asyncio.run(service.landing_from(_data(tuple(_reads() + _foggy(3) + _foggy(4) + asks)), "en"))
    hot = sorted(i["page"] for i in body["insights"] if i["kind"] == "confusion_hotspot")
    assert hot == [3, 4]
    assert sorted(t["page"] for t in body["themes"]) == [3, 4]
```

Append to `backend/tests/unit/test_landing_themes.py`:

```python
def test_no_usable_theme_is_kept_an_hour_not_a_month(monkeypatch):
    seen: dict = {}

    async def generate(prompt, **kw):
        return {"themes": []}

    async def cache(key, view, compute, **kw):
        result = await compute()
        seen["empty"] = kw["ttl_for"](result)
        seen["found"] = kw["ttl_for"](["What 3NF is for"])
        return result

    monkeypatch.setattr(reader, "_generate_json", generate)
    monkeypatch.setattr(themes.analytics_cache, "get_or_compute_async", cache)
    assert run() == []
    assert (seen["empty"], seen["found"]) == (themes.EMPTY_THEMES_TTL, themes.THEMES_TTL)
    assert themes.EMPTY_THEMES_TTL == 3600
```

Append to `backend/tests/unit/test_analytics_cache.py`, using the same async decorator as `test_async_get_or_compute_caches` (line 100):

```python
async def test_async_ttl_can_follow_the_result(patch_supabase):
    async def nothing():
        return []

    await analytics_cache.get_or_compute_async("L9", "themes", nothing, ttl_seconds=999, ttl_for=lambda r: 60 if not r else 999)
    rows = [r for r in patch_supabase.tables.get("analytics_cache", []) if r["lecture_id"] == "L9"]
    assert rows[0]["ttl_seconds"] == 60
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_landing_api.py backend/tests/unit/test_landing_themes.py backend/tests/unit/test_analytics_cache.py -q -p no:cacheprovider`
Expected: four FAIL.
- The blank Ask makes five askers, so a prompt is sent.
- The sequential awaits time out: `TimeoutError`.
- `KeyError: 'ttl_for'`.
- `TypeError: unexpected keyword argument 'ttl_for'`.

- [ ] **Step 3: Implement**

In `backend/services/analytics_cache.py`, add `ttl_for: Optional[Callable[[Any], int]] = None,` after `force_refresh: bool = False,` in `get_or_compute_async`. Replace its last two lines (141, 142) with:

```python
    result = await compute_fn()
    await run_sync(_write, lecture_id, view_name, ph, result, ttl_for(result) if ttl_for else ttl_seconds)
    return result
```

and add to its docstring: "``ttl_for``, when given, picks the TTL from the result (a short one for an empty answer)."

In `backend/services/insights/themes.py`, after `THEMES_TTL` (line 25) add:

```python
#: No usable theme came back (the model said nothing, or only echoes): try again within the hour, not next month.
EMPTY_THEMES_TTL = 60 * 60
```

and in `themes_for`, add `ttl_for=lambda found: THEMES_TTL if found else EMPTY_THEMES_TTL,` after `ttl_seconds=THEMES_TTL,` (line 133).

In `backend/services/v4_landing_service.py`, add `import asyncio` at the top. In `_themes`, replace lines 135 to 138 with:

```python
        # An asker is a reader of the page who wrote something: an Ask opened and left empty is help, not words.
        askers = (set(pf.ask_texts) & pf.readers) if pf else set()
        if len(askers) >= MIN_READERS:
            by_person = {user: pf.ask_texts[user] for user in askers}
            hot.append((len(askers), insight["lessonId"], insight["page"], by_person))
```

and replace lines 139 to 148 with:

```python
    hot.sort(key=lambda x: x[0], reverse=True)
    picked = hot[:THEMES_PAGES]
    # At once, not one after another; each call already turns its own failure into no themes.
    made = await asyncio.gather(*(
        themes_for(
            space_id=data.space_id, owner_id=data.owner_id, lesson_id=lesson_id,
            page=page, texts=balanced_questions(by_person), askers=askers, lang=lang,
        )
        for askers, lesson_id, page, by_person in picked
    ))
    return [
        {"lessonId": lesson_id, "page": page, "askers": askers, "themes": found}
        for (askers, lesson_id, page, _), found in zip(picked, made)
        if found
    ]
```

- [ ] **Step 4: Run the tests**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_landing_api.py backend/tests/unit/test_landing_themes.py backend/tests/unit/test_analytics_cache.py -q -p no:cacheprovider`
Expected: all pass. The existing `test_one_member_asking_sixty_times…` still finds 5 askers, because every asker there wrote text.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add backend/services/v4_landing_service.py backend/services/insights/themes.py backend/services/analytics_cache.py \
  backend/tests/unit/test_v4_landing_api.py backend/tests/unit/test_landing_themes.py backend/tests/unit/test_analytics_cache.py
git commit -m "fix(landing): themes count only askers who wrote, retry empty results within the hour, run at once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4b: Traps first: among the findings that need the owner, a page people wrongly think they understood leads

Abi, 2026-11-05: "traps first". `rank()` (`backend/services/insights/landing_map.py:135`) orders by band, then `severity × the Lesson's readers`, then severity, and the door reads `insights[0]` as the one page to open (Luna's line and **Open page N**). Severities come from different formulas per detector, so a hotspot's 0.88 and a trap's 0.74 are not on one scale. And they are not equally loud in the room: on a hotspot people *know* they are stuck and are already asking; on a trap they *think* they understood, miss the checkpoint, and nobody asks. The owner is the only one who can catch it, so within a band a trap now comes first.

A trap is a finding where people said the page had clicked and then missed its checkpoint: `calibration_gap` (the only form the door is told, `_KINDS`, `landing_map.py:23`; it is paired per person and gated at five) and `silent_misleader` (never told live, `landing_map.py:20-22`, but the lab fixtures and the `InsightKind` type still carry it, so the rule names it too). `quiz_misalignment` ("read easily, yet only N% passed") is **not** a trap here: nobody said it clicked, and its likelier cause is a question that tests something else.

Bands still lead: a trap that is `watch` never jumps an `act`. Within the trap group and within the rest, the existing `severity × readers`, then `severity`, order holds.

**Files:**
- Modify: `backend/services/insights/landing_map.py` (add `TRAPS` after `_BAND`, line 18; `rank`, lines 135-146)
- Test: `backend/tests/unit/test_landing_map.py` (beside `test_findings_are_ranked_by_band_then_by_how_many_people_they_touch`, line 130)
- Modify **[UI session]**: `src/features/spaces/mocks/landing.ts`: put each Space's trap first among its `act` findings (`DBS_INSIGHTS`: `i-dbs-trap-9` before `i-dbs-hotspot-12`; `BIG_INSIGHTS`: `i-big-9-trap` before `i-big-9-hot`), because the demo seam reads `insights[0]` as given and has no `rank()`. Then the lab's Luna says "Start with Relational Algebra" with **Open page 9**, and the big Space "Start with Concurrency" with **Open page 21**.
- Test **[UI session]**: `src/features/spaces/__tests__/landing.test.tsx`: the opening test expects `Start with Relational Algebra.` and `Open page 9` (`/v4/space/s-dbs/lesson/l-s-dbs-5/faces?page=9`); the German test expects `Fang mit Relational Algebra an.`; the one-page test (which drops `i-dbs-trap-9`) still expects Normalization and page 12.

**Interfaces:**
- Produces: `landing_map.TRAPS: frozenset[str] = frozenset({"calibration_gap", "silent_misleader"})`; `rank()` keeps its signature and its contract ("the door reads `insights[0]` as the one page to open").

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_landing_map.py`:

```python
def test_a_trap_leads_its_band_even_against_a_louder_score_on_more_readers():
    # People said page 21 clicked and then missed it; on page 14 they knew they were stuck and asked.
    hotspot = {"kind": "confusion_hotspot", "lessonId": "big", "attention": "act", "severity": 0.88}
    trap = {"kind": "calibration_gap", "lessonId": "small", "attention": "act", "severity": 0.74}
    assert rank([hotspot, trap], {"big": 120, "small": 30}) == [trap, hotspot]


def test_a_trap_never_jumps_a_band():
    act = {"kind": "confusion_hotspot", "lessonId": "l1", "attention": "act", "severity": 0.5}
    watch_trap = {"kind": "calibration_gap", "lessonId": "l1", "attention": "watch", "severity": 0.9}
    assert rank([watch_trap, act], {"l1": 50}) == [act, watch_trap]


def test_traps_among_themselves_keep_the_people_order():
    small = {"kind": "calibration_gap", "lessonId": "small", "attention": "act", "severity": 0.8}
    big = {"kind": "calibration_gap", "lessonId": "big", "attention": "act", "severity": 0.7}
    assert rank([small, big], {"small": 6, "big": 120}) == [big, small]


def test_a_question_that_tests_something_else_is_not_a_trap():
    hotspot = {"kind": "confusion_hotspot", "lessonId": "l1", "attention": "watch", "severity": 0.6}
    misaligned = {"kind": "quiz_misalignment", "lessonId": "l1", "attention": "watch", "severity": 0.5}
    assert rank([misaligned, hotspot], {"l1": 50}) == [hotspot, misaligned]
```

The existing `test_findings_are_ranked_by_band_then_by_how_many_people_they_touch` has no `kind` on its dicts; it must still pass (a finding without a kind is not a trap).

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_landing_map.py -q -p no:cacheprovider`
Expected: `test_a_trap_leads_its_band…` fails (`[hotspot, trap]`); the other three pass already (they pin what must not change).

- [ ] **Step 3: Implement**

In `backend/services/insights/landing_map.py`, after `_BAND` (line 18) add:

```python
#: People said the page had clicked, then missed its checkpoint. Nobody asks about a page they
#: think they understood, so within a band these lead: the owner is the only one who can catch them.
TRAPS = frozenset({"calibration_gap", "silent_misleader"})
```

and replace `rank` (lines 135-146) with:

```python
def rank(insights: list[dict[str, Any]], readers_by_lesson: dict[str, int]) -> list[dict[str, Any]]:
    """Loudest first: by band, then traps before the rest, then by severity × the Lesson's
    readers, then severity. The door reads `insights[0]` as the one page to open."""
    return sorted(
        insights,
        key=lambda i: (
            _BAND[i["attention"]],
            i.get("kind") in TRAPS,
            i["severity"] * readers_by_lesson.get(i["lessonId"], 0),
            i["severity"],
        ),
        reverse=True,
    )
```

- [ ] **Step 4: Run the tests**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_landing_map.py backend/tests/unit/test_v4_landing_api.py -q -p no:cacheprovider`
Expected: all pass.

- [ ] **Step 5 [UI session]: the lab follows**

Reorder the two fixture arrays and update the three frontend expectations as listed under **Files**. Run: `npx vitest run src/features/spaces/__tests__/landing.test.tsx`. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git status && git log -1 --oneline
git add backend/services/insights/landing_map.py backend/tests/unit/test_landing_map.py
git commit -m "feat(landing): traps lead their band, so the door opens on the page people wrongly think they understood

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4c: One member cannot crowd everyone else out of the read, or move their events in time

From the backend review (2026-11-05, verified). `_EVENTS_SQL` (`backend/services/insights/sources/space.py:118-131`) takes the newest `EVENT_CAP` (200 000, line 25) events **across all members**, and the only guard is a warning (lines 170-171). The policy `"Users can insert their own events"` (`supabase/migrations/20260721010000_learning_events_partitioning_retention.sql:212-214`) lets any signed-in user insert unlimited rows of their own, with any `created_at`. One account writing 200 000 valid `slide_view` rows pushes every other member's older events out of the read: readers, figures and help shrink, pages fall under the floor, and the owner is shown a wrong door with no sign of it. The same policy lets a member back-date events into any week.

Direct inserts cannot simply be revoked: the legacy rooms still write through Supabase (`src/services/studentService.ts:137`, no `created_at` sent). So:

- **The read caps per member, not per Space.** Each member contributes at most `PER_MEMBER_CAP` (5 000) newest events in the window; `EVENT_CAP` stays as the outer bound.
- **A row's time is when it was written.** A `BEFORE INSERT` trigger sets `created_at = now()` for every role but `service_role` (the backend's own writes keep theirs). No caller sends `created_at` today, so nothing breaks.

**Files:**
- Modify: `backend/services/insights/sources/space.py:23-25` (add `PER_MEMBER_CAP`), `:118-131` (`_EVENTS_SQL`), `:166-171` (pass the cap; warn per member who hit it)
- Create: `supabase/migrations/20261105010000_learning_events_created_at_is_now.sql` (unique timestamp: check `ls supabase/migrations` and Plan 4's `20261105120000`)
- Test: `backend/tests/unit/test_landing_space_source.py` (the SQL carries a per-user window), `backend/tests/db/test_learning_events_created_at.py` (`@pytest.mark.db`, on the throwaway Postgres)

**Interfaces:**
- Produces: `sources.space.PER_MEMBER_CAP = 5_000`. `_EVENTS_SQL` ranks with `row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC)` in a CTE and keeps `rn <= $7`, then `ORDER BY created_at DESC LIMIT $6`.
- Produces: trigger `learning_events_created_at_now` on `public.learning_events`, function `public.learning_events_stamp_created_at()` (`SECURITY INVOKER`, `SET search_path = ''`).

- [ ] **Step 1: Write the failing tests**
  - Unit: build a fake pool that records the SQL and args; assert the SQL contains `PARTITION BY user_id` and the last arg is `PER_MEMBER_CAP`.
  - DB: as an `authenticated` user, insert an event with `created_at = now() - interval '40 days'`; read it back; assert `created_at` is within a minute of `now()`. As `service_role`, the given `created_at` is kept.
- [ ] **Step 2: Run them to see them fail** (`.venv/bin/python -m pytest backend/tests/unit/test_landing_space_source.py -q -p no:cacheprovider`; the DB test with `-m db` against the throwaway Postgres, as in Plan 2).
- [ ] **Step 3: Implement**
  - The SQL:

```sql
WITH ranked AS (
  SELECT user_id, event_type, created_at, event_data,
         row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
  FROM learning_events
  WHERE created_at >= $1 AND created_at <= $2
    AND event_type = ANY($3::text[])
    AND user_id = ANY($4::uuid[])
    AND event_data->>'lectureId' = ANY($5::text[])
)
SELECT user_id::text AS user_id, event_type, created_at,
  jsonb_strip_nulls(jsonb_build_object({_EVENT_DATA})) AS event_data
FROM ranked
WHERE rn <= $7
ORDER BY created_at DESC
LIMIT $6
```

  - The migration:

```sql
CREATE OR REPLACE FUNCTION public.learning_events_stamp_created_at()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF coalesce(current_setting('request.jwt.claim.role', true), current_user) <> 'service_role' THEN
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS learning_events_created_at_now ON public.learning_events;
CREATE TRIGGER learning_events_created_at_now
  BEFORE INSERT ON public.learning_events
  FOR EACH ROW EXECUTE FUNCTION public.learning_events_stamp_created_at();
```

  `learning_events` is partitioned (same migration file as the policy): verify on the throwaway database that a trigger on the parent fires for rows routed to a partition (Postgres 13+ does), and that the role check sees the backend's asyncpg connection as not `authenticated`. If the backend connects as `postgres` rather than `service_role`, compare against the roles that must keep their time, and say so in the migration comment.
- [ ] **Step 4: Run the tests**, then `ruff check backend/ --select F821,F811,F841`.
- [ ] **Step 5: Commit** (`git status && git log -1 --oneline` first). Deploy: this migration is applied by hand with psql (`docs/runbooks/apply-a-migration-by-hand.md`), probed with `pg_catalog` (`select tgname from pg_trigger where tgrelid = 'public.learning_events'::regclass`), never `supabase db push`.

---

### Task 4d: A Lesson people stop reading is a finding, not "landing"

From the backend review (verified). `lesson_bundle` (`backend/services/insights/space_engine.py:78-80`) makes a row only for pages someone read, and `detect_leaky_bucket` (`detectors.py:196-207`) compares neighbouring rows. A fall to zero readers is never a pair: six readers who all stop after page 3 of a 30-page Lesson leave rows 1 to 3, no leak, and `lesson_light` returns `calm`. The owner sees the Lesson as landing. Second, the detector keeps only the **worst** drop, and `kept()` (`space_engine.py:127-130`) then discards it if a later page wins readers back (`_drop_persists`, line 103). A skipped page (10, 10, 3, 9, 9, 6) is chosen, discarded, and the real 33% drop after it is never looked at.

The detectors stay untouched (spec §1.1). The engine gives the leak check what it needs:

- **The leak check sees every page of the Lesson.** For the leak only, the bundle carries a row per page `1..lesson.pages`, zero readers where nobody read. Every other detector keeps today's rows.
- **Only drops that persist are candidates.** Counting the people still in the Lesson at each page (they read it or anything after it) makes a skipped page invisible to the leak check, so the detector's worst-drop pick is over real stops only, and `_drop_persists` is no longer needed.

**Files:**
- Modify: `backend/services/insights/space_engine.py:78-90` (`lesson_bundle`, add `leak_rows`), `:109-132` (`lesson_insights`: run `detect_leaky_bucket` on `leak_rows`, drop the `kept()` special case)
- Test: `backend/tests/unit/test_landing_space_engine.py`

**Interfaces:**
- Produces: `space_engine.leak_rows(lf: LessonFacts) -> list[dict]`, one `{"slide_number": n, "view_count": still}` per page `1..lf.lesson.pages`, where `still` is the number of people who read page `n` **or any later page**: the people still in the Lesson at `n`. A page skipped and returned to never reads as a stop; a page after which nobody reads on drops to what is left. Worked example: readers 10, 10, 10, 10, 3, 9, 9, 9, 6 give `still` 10, 10, 10, 10, 9, 9, 9, 9, 6, so the one leak is after page 8 (33%); six readers who stop after page 3 of 30 give 6, 6, 6, 0, …, a leak after page 3.

- [ ] **Step 1: Write the failing tests**
  - Six readers on pages 1 to 3 of a 30-page Lesson, none after: one `leaky_bucket` on page 3, and the Lesson's light is not `calm`.
  - Readers 10, 10, 10, 10, 3, 9, 9, 9, 6 on pages 1 to 9: the one leak is after page 8, not page 4.
  - A Lesson everyone finishes: no leak (pins today's behaviour).
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement** `leak_rows` (walk `n` from `lf.lesson.pages` down to 1, keeping a running **union** of `lf.pages.get(n, PageFacts()).readers`, so `still[n] = len(union)`; sets, not counts, so one person on two pages counts once); in `lesson_insights`, call the leak detector with `{**bundle, "slides": leak_rows(lf)}` and the others with `bundle`; keep `above_floor` (the page before the drop needs 5 readers).
- [ ] **Step 4: Run** `test_landing_space_engine.py` and `test_landing_map.py`; then the full `-m "not db"` suite for the engine.
- [ ] **Step 5: Commit.**

---

### Task 4e: A week with fewer than five readers says nothing, in every figure

From the backend review (verified). `figures()` (`backend/services/insights/figures.py:49-51`) returns `reading` as raw counts per week, value and history, at any size; only `landing` and `cleared` are floored. In a Space of two, "1, 0, 1, 1, 0, 1, 1, 1" is one person's reading habit, week by week. The Figure contract already says a week with fewer than `floor` people is `null`, never 0 (`src/features/spaces/landing/types.ts`, `Figure`). Per-Lesson `readers` leaves the wire in Task 14.

- **`reading`: a week under the floor is `null`**, value and history alike; the door draws a dash and no bar, as it already does for `landing`.
- The top-level `readers` stays: it is what Luna's floor line counts ("4 people have been reading"), a count the owner of a small group would know anyway. Flagged for Abi in **Open questions**.

**Files:**
- Modify: `backend/services/insights/figures.py:49-51`
- Test: `backend/tests/unit/test_landing_figures.py`

- [ ] **Step 1: Failing test:** three members reading in weeks 6 and 7 → `reading == {"value": None, "history": [None] * 8}`; six readers in week 7 only → `history[-1] == 6`, earlier weeks `None`.
- [ ] **Step 2: Run to fail. Step 3: Implement:** `reading = [len(r) if len(r) >= floor else None for r in readers]`. **Step 4: Run** the figures tests and `npx vitest run src/features/spaces/__tests__/landing.test.tsx` (the door already renders a null figure). **Step 5: Commit.**

---

### Task 4f (lower priority): the smaller review findings

From the backend review (2026-11-05). Reported, not yet verified line by line; verify each before writing its test, and drop any that does not hold.

1. **Themes cache keyed on the asker count, not the askers** (`backend/services/insights/themes.py:24,132`). Five askers make themes; one ages out of the window, another asks; the count is five again and month-old themes about other people's questions return. Fix: add a short hash of the sorted asker ids to `params`.
2. **Short themes pass the echo guard** (`themes.py:60-109`): a theme of three words or fewer is never compared, so a planted name ("Anna struggled with joins" is four, but "Anna's joins" is two) can reach the owner. Fix: drop any theme containing a token that appears in exactly one asker's text and nowhere in the Lesson's page text; add a test with a planted name.
3. **A page held under two seconds is not read** (`backend/services/v4_reading_service.py:21`, `MIN_SECONDS_TO_COUNT`). A page most people flip past has too few "readers" to say anything, so `skipped_slide` never fires on it. Fix: record the visit with its real dwell (a `slide_view` with `duration_seconds < 2` flagged `brief`), count it as a reader for the floor, exclude it from dwell medians.
4. **First try mislabelled at the window edge** (`backend/services/insights/space_facts.py:95-119`): a question first answered before the 56-day window and again inside it counts as a first try. Fix: read each member's earliest try per question without the window bound (one extra `min(created_at)` query), or drop tries whose question has an earlier attempt.

---

### Task 5: The legacy garden lists no one: no Strugglers, no Journey, no `/students`

**Files:**
- Modify: `backend/services/insights/engine.py:23-28`
- Modify: `backend/services/insights/evidence.py`: delete `STUDENT_JOURNEY` (line 16), `get_student_journey_evidence` (lines 111-199) and its branch in `get_evidence` (lines 219-222); drop the `student_id` parameter
- Modify: `backend/api/v1/analytics.py`:
  - delete the `/lecture/{lecture_id}/students` route (lines 247-258);
  - in `get_insight_evidence` (lines 289-318), drop `student_id`;
  - change the `kind` description to `ai_queries | confidence_breakdown`
- Delete: `src/features/analytics/garden/viz/AtRiskStudentList.tsx`, `src/features/analytics/garden/evidence/StudentJourneyStoryboard.tsx`
- Modify:
  - `src/features/analytics/garden/Layer2Viz.tsx:4,26-27`
  - `src/features/analytics/garden/EvidenceDrawer.tsx:38` (and its import)
  - `src/features/analytics/types/index.ts:113-127` (journey types; the evidence-kind union)
  - `src/features/analytics/hooks/useEvidence.ts` and `src/features/analytics/garden/useGardenState.ts` (the `studentId` field)
  - `src/services/analyticsService.ts:66-71` (`getStudentPerformance`, no caller)
- Modify (from the backend review, 2026-11-05): `GET /lecture/{lecture_id}/confidence-by-slide` (`backend/api/v1/analytics.py:355`, service `backend/services/analytics_service.py:556-600`) and the `confidence_breakdown` evidence (`backend/services/insights/evidence.py:57-108`, route `analytics.py:289-316`) return raw per-slide counts with no floor and count the owner's own events: with one rater, `got_it: 1, total: 1` is that person. Both now count **people**, exclude the lecture's owner, and return a slide's numbers only when at least 5 people stand behind them (else the slide's entry is absent). Check `/lecture/{lecture_id}/slides` (`analytics.py:219`) for the same and floor it the same way if it holds.
- Test: create `backend/tests/unit/test_legacy_people_gate.py`; modify `backend/tests/contract/test_response_schemas.py:72-87`

**Interfaces:**
- Produces:
  - `engine.build_insights` never returns `kind == "silent_strugglers"`.
  - `confidence-by-slide` and `confidence_breakdown` say nothing about a slide with fewer than 5 people, and never count the owner.
  - `evidence.get_evidence("student_journey", …)` raises `ValueError("Unknown evidence kind: student_journey")`, which the route turns into 400.
  - `GET /api/analytics/lecture/{id}/students` is 404.
  - `analytics_service.get_student_performance` stays: `bundle.py:232` still reads it internally.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_legacy_people_gate.py`:

```python
"""The legacy professor analytics never show a learner one by one (Abi, 2026-11-05: no people, ever).

Nothing in the schema tells a v4 Space from a legacy course, so this holds for every course.
"""
from __future__ import annotations

import pytest

from backend.services.insights import engine, evidence


def _student(sid, progress, score, asked=0):
    return {"student_id": sid, "student_name": sid.upper(), "progress_percentage": progress,
            "quiz_score": score, "typology": "x", "ai_interactions": asked, "revisions": 0}


def test_the_legacy_feed_lists_no_strugglers(monkeypatch):
    # Three quiet, stalled learners: exactly what detect_silent_strugglers would name.
    bundle = {"lecture_id": "L1", "total_students": 3, "lecture_avg_dwell": 0.0, "lecture_median_dwell": 0.0,
              "slides": [], "students": [_student("a", 10, 20), _student("b", 20, 30), _student("c", 30, 10)]}
    monkeypatch.setattr(engine, "build_metric_bundle", lambda lecture_id, token=None: bundle)
    assert all(i["kind"] != "silent_strugglers" for i in engine.build_insights("L1", "t"))


def test_there_is_no_journey_of_one_person():
    with pytest.raises(ValueError, match="Unknown evidence kind"):
        evidence.get_evidence("student_journey", "L1", token="t")
```

In `backend/tests/contract/test_response_schemas.py`, replace `test_students_envelope` (lines 72 to 87) with:

```python
    def test_there_is_no_per_learner_list(self, auth_client):
        r = auth_client.get(
            "/api/analytics/lecture/L1/students",
            headers={"Authorization": "Bearer x"},
        )
        assert r.status_code == 404
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_legacy_people_gate.py backend/tests/contract/test_response_schemas.py -q -p no:cacheprovider`
Expected: three FAIL.
- A `silent_strugglers` finding is present.
- `get_evidence` raises "student_journey evidence requires studentId", not "Unknown".
- `/students` answers 200.

- [ ] **Step 3: Backend**

In `backend/services/insights/engine.py`, inside the loop at line 23:

```python
    for detect in detectors.DETECTORS:
        if detect is detectors.detect_silent_strugglers:
            continue  # no learner is ever listed one by one (decided 2026-11-05); the detector stays, unused here
        try:
```

In `backend/services/insights/evidence.py`:
- delete the `STUDENT_JOURNEY = "student_journey"` constant;
- delete the whole `get_student_journey_evidence` function;
- delete the `if kind == STUDENT_JOURNEY:` branch;
- remove the `student_id: Optional[str] = None,` keyword from `get_evidence`.

In `backend/api/v1/analytics.py`:
- delete the `@router.get("/lecture/{lecture_id}/students", …)` handler (lines 247 to 258);
- in `get_insight_evidence`, delete the `student_id: Optional[str] = Query(None),` parameter and the `student_id=student_id,` argument;
- change the `kind` description to `"Evidence kind: ai_queries | confidence_breakdown"`.

Then run:

```bash
grep -rn "student_journey\|get_student_journey_evidence\|lecture/{lecture_id}/students\|/students\"" backend --include='*.py'
```

and delete or update every test it shows that pins the removed behaviour. Detector unit tests in `test_insight_detectors.py` stay: the detector is untouched.

After deploy, the garden's cached feeds still hold Strugglers for up to their TTL. The deploy notes clear them.

- [ ] **Step 4: Frontend**

```bash
git rm src/features/analytics/garden/viz/AtRiskStudentList.tsx src/features/analytics/garden/evidence/StudentJourneyStoryboard.tsx
```

In `src/features/analytics/garden/Layer2Viz.tsx`, delete line 4 (`import { AtRiskStudentList } …`) and the `case 'silent_strugglers':` branch (lines 26 and 27). A stray `silent_strugglers` insight then falls through to the default branch, which renders nothing kind-specific.

In `src/features/analytics/garden/EvidenceDrawer.tsx`, delete the `student_journey` line (38) and the `StudentJourneyStoryboard` import.

In `src/features/analytics/types/index.ts`, delete `StudentJourneyStep` and `StudentJourneyEvidence` (lines 113 to 127) and remove `StudentJourneyEvidence` from the evidence union that names them.

Remove `studentId` from `EvidenceRequest` (`src/features/analytics/garden/useGardenState.ts`) and from `useEvidence` (`src/features/analytics/hooks/useEvidence.ts`), including the `student_id` query parameter.

In `src/services/analyticsService.ts`, delete `getStudentPerformance` (lines 66 to 71).

Then run:

```bash
grep -rn "student_journey\|StudentJourney\|AtRiskStudentList\|getStudentPerformance\|studentId" src/features/analytics src/services src/pages src/test
```

It must print nothing that still refers to the removed pieces.

- [ ] **Step 5: Run the gates**

```bash
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests -m "not db" -q -p no:cacheprovider
export PATH="/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin:$PATH"
npx tsc --noEmit -p tsconfig.app.json && npx vitest run src/features/analytics src/__tests__ && npm run lint
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git status && git log -1 --oneline
git add -A backend/services/insights/engine.py backend/services/insights/evidence.py backend/api/v1/analytics.py \
  backend/tests src/features/analytics src/services/analyticsService.ts
git commit -m "feat(analytics)!: the legacy garden lists no learner: no Strugglers, no Journey, no /students

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The legacy dashboard and both Ask panels say how many, never who

`/api/analytics/lecture/{id}/dashboard` returns `studentsMatrix`, one row per learner with the **raw user id** (`analytics_service.py:822-832,857`), from a cohort of one. It reads through asyncpg and so bypasses RLS. The route needs only `verify_token` and lecture ownership (`analytics.py:261-272`), so a student who owns a v4 Space gets it straight from the API.

The page uses the matrix for two things:
- a score-distribution chart that only counts (`AdvancedAnalytics.tsx:1292-1296`);
- the hidden Intervention Hub (`:1315-1384`, `SHOW_PREDICTIVE_INTERVENTION_HUB = false` at `:542`).

Its toggle also sends the whole matrix to an LLM (`:1286`, `ai_content.py:190-194`).

Both Ask intents named `struggling_students` list learners by anonymous name with no floor (`ask_data.py:41-48,219-232,306`; `ask_professor.py:55-62,409-438,510`).

**Files:**
- Modify: `backend/services/analytics_service.py`: add `score_bands`; at `:822-832`, replace `processed_students`; at `:857`, `"studentsMatrix"` becomes `"scoreBands"`; delete `_calculate_students_matrix` (`:945-963`)
- Modify: `backend/services/ai/ask_data.py:41-48,219-232,306`, `backend/services/ai/ask_professor.py:55-62,187-215,409-438,510`
- Modify: `src/pages/AdvancedAnalytics.tsx:70-78,1286-1297,1313-1385` (Hub block deleted), `:542` (flag deleted)
- Modify: `src/test/handlers/index.ts:117`, `src/__tests__/pages/AdvancedAnalytics.test.tsx:98`
- Test:
  - `backend/tests/unit/test_legacy_people_gate.py`;
  - delete `test_struggling_students_threshold` (`backend/tests/unit/test_ask_data.py:75`), `test_struggling_students_aggregates_across_lectures` (`test_ask_professor.py:62`), `test_struggling_students_against_seeded_data` (`backend/tests/integration/test_ask_data_endpoint.py:196`), and the `_calculate_students_matrix` test (`backend/tests/unit/test_analytics_service.py:175`).

**Interfaces:**
- Produces:
  - `analytics_service.score_bands(scores: list) -> list[int]`: people per quiz-score band `[0-20, 21-40, 41-60, 61-80, 81-100]`, or `[]` under five people.
  - The dashboard payload carries `scoreBands: number[]` and no `studentsMatrix`.
  - `"struggling_students"` is in neither `INTENTS` nor `_EXECUTORS`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_legacy_people_gate.py`:

```python
def test_the_dashboard_counts_people_per_score_band_and_only_from_five():
    from backend.services.analytics_service import score_bands

    assert score_bands([10, 90, 55, 61, 20]) == [2, 0, 1, 1, 1]
    assert score_bands([None, 100, 40, 41, 80, 81]) == [1, 1, 1, 1, 2]
    assert score_bands([10, 20, 30, 40]) == []


def test_no_ask_answers_with_a_list_of_learners():
    from backend.services.ai import ask_data, ask_professor

    for module in (ask_data, ask_professor):
        assert "struggling_students" not in module.INTENTS
        assert "struggling_students" not in module._EXECUTORS
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_legacy_people_gate.py -q -p no:cacheprovider`
Expected: two FAIL.
- `ImportError: cannot import name 'score_bands'`.
- `struggling_students` is still in `INTENTS`.

- [ ] **Step 3: Backend**

In `backend/services/analytics_service.py`, add near the top, after the imports:

```python
#: People a score distribution needs before it is drawn (the v4 floor).
SCORE_FLOOR = 5
_SCORE_EDGES = (20, 40, 60, 80)


def score_bands(scores: list) -> list[int]:
    """People per quiz-score band (0-20, 21-40, 41-60, 61-80, 81-100); empty under five people.

    Counts only: the dashboard never lists a learner (decided 2026-11-05).
    """
    if len(scores) < SCORE_FLOOR:
        return []
    bands = [0] * (len(_SCORE_EDGES) + 1)
    for s in scores:
        value = float(s or 0)
        bands[sum(1 for edge in _SCORE_EDGES if value > edge)] += 1
    return bands
```

In `get_dashboard_data`, replace the `processed_students` loop (lines 822 to 832) with:

```python
    score_band_counts = score_bands([r["quiz_score"] for r in student_rows])
```

and in `result` (line 857) replace `"studentsMatrix": processed_students,` with `"scoreBands": score_band_counts,`.

Delete `_calculate_students_matrix` (lines 945 to 963). If `ruff check backend/ --select F401` then shows `calculate_student_typology` unused in this module, leave the import: it is used by `get_student_performance` (around line 360). Confirm with `grep -n calculate_student_typology backend/services/analytics_service.py`.

In `backend/services/ai/ask_data.py`:
- delete the `"struggling_students": {…}` entry in `INTENTS` (lines 41 to 48);
- delete `_exec_struggling_students` (from line 219 to the line before the next `def`);
- delete `"struggling_students": _exec_struggling_students,` in `_EXECUTORS` (line 306).

In `backend/services/ai/ask_professor.py`:
- delete the `"struggling_students"` entry in `INTENTS` (lines 55 to 62);
- delete `_exec_struggling_students` (line 409 to the line before the next `def`);
- delete the `_EXECUTORS` entry (line 510);
- delete `_bulk_fetch_student_scores` (lines 184 to 215) **only if** `grep -n _bulk_fetch_student_scores backend/services/ai/ask_professor.py` shows no other caller.

Delete the four tests listed under **Files**. Then run `grep -rn "struggling_students\|studentsMatrix\|_calculate_students_matrix" backend`: it must print nothing.

- [ ] **Step 4: Frontend**

In `src/pages/AdvancedAnalytics.tsx`:
- replace the `studentsMatrix: {…}[];` field of the dashboard type (lines 70 to 78) with:

```tsx
  /** People per quiz-score band, 0-20 … 81-100; empty under five people. Never a list of learners. */
  scoreBands: number[];
```

- delete `const SHOW_PREDICTIVE_INTERVENTION_HUB = false;` (line 542) and the whole `{SHOW_PREDICTIVE_INTERVENTION_HUB && ( … )}` block (from `{/* Predictive Intervention Hub */}` at about line 1313 to its closing `)}` at about line 1385);
- in the Score Distribution `Section`, change the toggle to `onToggle={() => handleMetricClick('distribution', 'Score Distribution', dashboardData.scoreBands)}`. Then replace the `<div className="h-64">…</div>` chart body so it draws the bands, or says it waits for five people:

```tsx
                {dashboardData.scoreBands?.length ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={['0–20%', '21–40%', '41–60%', '61–80%', '81–100%'].map((range, i) => ({ range, count: dashboardData.scoreBands[i] }))}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                      >
```

  Keep the existing `CartesianGrid`, axes, `Bar` and closing tags of the chart unchanged inside this branch. Close it with:

```tsx
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Shows once five people have taken the quiz.</p>
                )}
```

  The legacy page is English-only and outside the v4 namespaces, as the rest of its copy is.

In `src/test/handlers/index.ts:117` and `src/__tests__/pages/AdvancedAnalytics.test.tsx:98`, replace `studentsMatrix: [],` with `scoreBands: [],`. Then run `grep -rn "studentsMatrix\|student_name\|UserAvatar userId={student" src/pages/AdvancedAnalytics.tsx src/test src/__tests__`: it must print nothing.

- [ ] **Step 5: Run the gates**

```bash
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests -m "not db" -q -p no:cacheprovider
export PATH="/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin:$PATH"
npx tsc --noEmit -p tsconfig.app.json && npx vitest run src/__tests__/pages/AdvancedAnalytics.test.tsx && npm run lint
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git status && git log -1 --oneline
git add -A backend/services/analytics_service.py backend/services/ai/ask_data.py backend/services/ai/ask_professor.py backend/tests \
  src/pages/AdvancedAnalytics.tsx src/test/handlers/index.ts src/__tests__/pages/AdvancedAnalytics.test.tsx
git commit -m "feat(analytics)!: the dashboard and Ask say how many, never who; no raw learner ids

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The assignments roster names only people who chose to be seen

`GET /api/assignments/_meta/students` (`backend/api/v1/assignments.py:393-461`, `require_professor`) returns `{id, full_name}` for everyone with a `student_progress` row on any lecture the professor owns. That includes every v4 member who read one of their Lessons. It now lists only people with `profiles.show_in_spaces = true` (migration `20261030000000_show_in_spaces.sql:13-14`). That is the switch the privacy page already describes: "Whether the people in your Spaces see you (name, picture …) is your choice in Settings".

**Files:**
- Modify: `backend/api/v1/assignments.py:439-456` (step 3 of `_load`), plus the docstring at `:399-409`
- Test: `backend/tests/integration/test_assignments_endpoints.py` (the `_meta/students` class at about line 351)

**Interfaces:**
- Produces: the roster holds only learners whose `profiles.show_in_spaces` is true; everyone else is left out, not shown nameless.

- [ ] **Step 1: Write the failing test**

In `backend/tests/integration/test_assignments_endpoints.py`, read `test_professor_only_sees_their_own_engaged_students` (about line 394) and how it seeds `profiles` through `patch_supabase`. Give its expected students `"show_in_spaces": True` in their seeded profile rows. Then add beside it, reusing the same seeding helpers:

```python
    def test_a_learner_who_did_not_choose_to_be_seen_is_not_on_the_roster(
        self, app, patch_supabase, professor_user
    ):
        # Same seeding as test_professor_only_sees_their_own_engaged_students: one lecture this
        # professor owns, two learners with progress on it. Only one switched "show me in Spaces" on.
        seen, hidden = "stu-seen", "stu-hidden"
        patch_supabase.tables["lectures"] = [{"id": "lec-1", "professor_id": professor_user.id}]
        patch_supabase.tables["student_progress"] = [
            {"user_id": seen, "lecture_id": "lec-1"},
            {"user_id": hidden, "lecture_id": "lec-1"},
        ]
        patch_supabase.tables["profiles"] = [
            {"user_id": seen, "full_name": "Mira", "show_in_spaces": True},
            {"user_id": hidden, "full_name": "Jonas", "show_in_spaces": False},
        ]
        r = TestClient(app).get("/api/assignments/_meta/students", headers={"Authorization": "Bearer x"})
        assert r.status_code == 200
        assert [p["full_name"] for p in r.json()] == ["Mira"]
```

Adapt the fixture names (`professor_user`, the auth header, how `TestClient` is built, how the response is wrapped) to exactly what the neighbouring test in that class uses. The assertion is the requirement: only "Mira".

- [ ] **Step 2: Run it to see it fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/integration/test_assignments_endpoints.py -k "roster or engaged" -q -p no:cacheprovider`
Expected: the new test FAILS. Both names come back.

- [ ] **Step 3: Implement**

In `backend/api/v1/assignments.py`, replace step 3 (lines 439 to 456) with:

```python
        # 3. Only people who chose to be seen by the people in their Spaces
        # (Settings, profiles.show_in_spaces). Nobody else is listed, named or not.
        profiles = (
            supabase_admin.table("profiles")
            .select("user_id, full_name")
            .in_("user_id", student_ids)
            .eq("show_in_spaces", True)
            .execute()
            .data
            or []
        )
        out = [
            {"id": p["user_id"], "full_name": p.get("full_name")}
            for p in profiles
            if p.get("user_id")
        ]
        out.sort(key=lambda p: ((p["full_name"] or "").lower(), p["id"]))
        return out
```

In the docstring, add: "Only learners who switched on 'show me in Spaces' are listed (decided 2026-11-05: no one is shown one by one without choosing it)."

- [ ] **Step 4: Run the tests**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/integration/test_assignments_endpoints.py -q -p no:cacheprovider`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add backend/api/v1/assignments.py backend/tests/integration/test_assignments_endpoints.py
git commit -m "feat(assignments): the roster names only people who chose to be seen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Members are told the floor, now that it holds

Spec A11 (amended 2026-10-29): the floor wording returns "in the same PR that gates the legacy person-level views". That PR is this one: Tasks 5 to 7 are the gate.

Today:
- The join line (`src/i18n/locales/en/v4Spaces.json:491`) is "The people who run this Space can see how its pages are read." It does **not** say "never your name", although memory says it does.
- The privacy page's legitimate-interest bullet (`src/i18n/locales/en/legal.json:35`, `privacy.section3Items[1]`) names no floor.

**Files:**
- Modify: `src/i18n/locales/en/v4Spaces.json:491`, `src/i18n/locales/de/v4Spaces.json:491`
- Modify: `src/i18n/locales/en/legal.json:35` and its last-updated line, `src/i18n/locales/de/legal.json` (same keys)
- Test: `src/features/spaces/__tests__/join-privacy.test.ts`

**Interfaces:**
- Produces: `v4Spaces:join.privacy` and `legal:privacy.section3Items[1]` name the five-person floor and "never by name", in en and de.

- [ ] **Step 1: Write the failing test**

Replace the body of `src/features/spaces/__tests__/join-privacy.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';

describe('what members are told', () => {
  it('the join screen names the floor, in both languages', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('v4Spaces:join.privacy')).toBe(
      'The people who run this Space see how its pages land, as patterns across at least five people, never by name.',
    );
    await i18n.changeLanguage('de');
    expect(i18n.t('v4Spaces:join.privacy')).toBe(
      'Die Leute, die diesen Space pflegen, sehen, wie seine Seiten ankommen: als Muster über mindestens fünf Personen, nie mit Namen.',
    );
    await i18n.changeLanguage('en');
  });

  it('the privacy page names the floor', () => {
    const items = (lng: string) => i18n.getFixedT(lng, 'legal')('privacy.section3Items', { returnObjects: true }) as string[];
    expect(items('en')[1]).toMatch(/only as patterns across at least five people, never by name;/);
    expect(items('de')[1]).toMatch(/nur als Muster über mindestens fünf Personen, nie mit Namen;/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/join-privacy.test.ts`
Expected: both FAIL, because the old wording has no floor.

- [ ] **Step 3: Write the words**

- `src/i18n/locales/en/v4Spaces.json:491`: `"privacy": "The people who run this Space see how its pages land, as patterns across at least five people, never by name."`
- `src/i18n/locales/de/v4Spaces.json:491`: `"privacy": "Die Leute, die diesen Space pflegen, sehen, wie seine Seiten ankommen: als Muster über mindestens fünf Personen, nie mit Namen."`
- `src/i18n/locales/en/legal.json`, `privacy.section3Items[1]`: replace `to show the people who maintain a Space where learners struggle;` with `to show the people who maintain a Space where learners struggle, only as patterns across at least five people, never by name;`.
- `src/i18n/locales/de/legal.json`, same item: replace `zu zeigen, wo Lernende Schwierigkeiten haben;` with `zu zeigen, wo Lernende Schwierigkeiten haben, nur als Muster über mindestens fünf Personen, nie mit Namen;`.
- In both `legal.json` files, set the privacy page's last-updated line (`grep -n "Last updated\|Stand:" src/i18n/locales/*/legal.json`) to the day this PR is opened: "Last updated: <d> <Month> 2026" / "Stand: <d>. <Monat> 2026".

The legal page keeps its formal Sie register. It is a legal text and is unchanged in tone; only the v4 namespaces use du.

- [ ] **Step 4: Run the test and the gates**

```bash
npx vitest run src/features/spaces/__tests__/join-privacy.test.ts src/features/spaces/__tests__/join-screen-privacy.test.tsx src/features/spaces/__tests__/v4Strings.test.ts
npm run lint
node scripts/check-vocabulary.mjs src/features/spaces | tail -3
```

Expected: pass. The vocabulary total equals the Task 0 baseline. If `join-screen-privacy.test.tsx` pins the old sentence, update it to the new one.

- [ ] **Step 5: Commit, then open PR A**

```bash
git status && git log -1 --oneline
git add src/i18n/locales/en/v4Spaces.json src/i18n/locales/de/v4Spaces.json src/i18n/locales/en/legal.json src/i18n/locales/de/legal.json \
  src/features/spaces/__tests__/join-privacy.test.ts src/features/spaces/__tests__/join-screen-privacy.test.tsx
git commit -m "feat(privacy): members are told the floor: patterns across at least five people, never by name

Same PR as the legacy per-person gate (spec A11, amended 2026-10-29).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Run every gate from Task 0 Step 2, plus the `-m db` file from Task 2. Then push and open **PR A**: "How it's landing, Plan 3A: the floor holds". Its description lists:
- Tasks 1 to 8;
- the migration and its apply step (see **Deploy**);
- the residuals in Decision 4;
- that `FEATURE_LANDING_PEOPLE` / `LANDING_PSEUDONYM_SALT` no longer exist.

End it with the Claude Code line. Do not merge; Abi merges.

---

## PR B: the door in v4

Start PR B from `origin/main` **after PR A and the UI session's door PR have both merged**. Tasks 9, 10 and 12 touch no UI-session file and may be written earlier on a branch stacked on PR A.

```bash
git status && git log -1 --oneline
git fetch origin && git switch -c claude/landing-plan-3-door origin/main
```

### Task 9: The live seam

**Files:**
- Modify: `src/features/spaces/data/liveRepository.ts`: add `landing` after `rehearsalHistory` (line 334)
- Modify: `src/features/spaces/data/landing.ts` (the whole hook)
- Modify: `src/features/spaces/__tests__/seam.test.ts:26` (cover `landing/`)
- Test: create `src/features/spaces/__tests__/landing-live.test.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/v4/spaces/{id}/landing` (Plan 2), language-tagged by `withLanguage` (`liveRepository.ts:375`).
- Produces:
  - `LiveRepository.landing(spaceId: string): Promise<WireLanding>`.
  - `data/landing.ts` exports `type WireLanding`, `fromWire(w: WireLanding): Landing`, and `useLanding(spaceId)` returning `{ state: LoadState; landing: Landing | null; answer: (questionId: string, text: string, forEveryone: boolean) => void; retry: () => void }`.
  - Demo ids keep reading `mocks/landing.ts`. A live id reads the backend. 403 and 404 become `'empty'`; anything else is `'error'`.

- [ ] **Step 1: Write the failing test**

Create `src/features/spaces/__tests__/landing-live.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createLiveRepository, type V4Transport } from '../data/liveRepository';
import { stageAccentFor } from '../components/stage';

const { landingApi } = vi.hoisted(() => ({ landingApi: vi.fn() }));
vi.mock('../data/liveRepository', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/liveRepository')>();
  return { ...real, loadLiveRepository: async () => ({ landing: landingApi }) };
});

import { fromWire, useLanding, type WireLanding } from '../data/landing';

const SPACE = '0b7a308e-25cd-4a62-a47d-3e8930dde167';
const wire: WireLanding = {
  spaceId: SPACE,
  spaceName: 'Lerngruppe',
  members: 6,
  readers: 4,
  floor: 5,
  figures: { reading: { value: 4, history: [0, 0, 0, 0, 1, 2, 3, 4] }, landing: { value: null, history: [] }, cleared: { value: null, history: [] } },
  lessons: [
    { id: 'l1', title: 'Vectors', order: 1, pages: 14, readers: 4, light: 'few' },
    { id: 'l2', title: 'Matrices', order: 2, pages: 19, readers: 3, light: 'few' },
  ],
  insights: [],
  themes: [],
};

afterEach(() => {
  landingApi.mockReset();
  vi.unstubAllEnvs();
});

describe('the door’s data, live', () => {
  it('asks the Space’s own endpoint', async () => {
    const calls: string[] = [];
    const http = { get: vi.fn(async (p: string) => (calls.push(p), wire)), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } as unknown as V4Transport;
    await createLiveRepository(http).landing(SPACE);
    expect(calls).toEqual([`/api/v1/v4/spaces/${SPACE}/landing`]);
  });

  it('draws the colours the server leaves out, and reads no questions until there are some', () => {
    const l = fromWire(wire);
    expect(l.accent).toBe(stageAccentFor('Lerngruppe'.length));
    expect(l.lessons.map((x) => x.color)).toEqual([stageAccentFor(1), stageAccentFor(2)]);
    expect(l.questions).toEqual([]);
    const asked = fromWire({
      ...wire,
      questions: [{ id: 'q1', lessonId: 'l1', page: 6, text: 'Only 2×2?', asker: null, createdAt: '2026-11-05T10:00:00Z' }],
    });
    expect(asked.questions).toHaveLength(1);
  });

  it('a live Space loads, and its owner can try again after a failure', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    landingApi.mockRejectedValueOnce(Object.assign(new Error('500'), { status: 500 })).mockResolvedValueOnce(wire);
    const { result } = renderHook(() => useLanding(SPACE));
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.landing?.spaceName).toBe('Lerngruppe');
  });

  it('a Space that is not yours is simply not there', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    landingApi.mockRejectedValue(Object.assign(new Error('403'), { status: 403 }));
    const { result } = renderHook(() => useLanding(SPACE));
    await waitFor(() => expect(result.current.state).toBe('empty'));
  });

  it('a demo Space still reads its fixture, with no request', () => {
    const { result } = renderHook(() => useLanding('s-dbs'));
    expect(result.current.state).toBe('ready');
    expect(landingApi).not.toHaveBeenCalled();
  });
});
```

Check how `apiClient` errors carry the HTTP status: `useReader.ts:90` reads `e.status`. If `apiClient` names it differently, mirror `statusOf` exactly.

In `src/features/spaces/__tests__/seam.test.ts`, change line 26 to `const DIRS = ['screens', 'components', 'studio', 'landing'];`, so the door's components can never read mocks directly.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/landing-live.test.tsx src/features/spaces/__tests__/seam.test.ts`
Expected: FAIL. `landing` is not a repository method, and `fromWire`/`WireLanding` do not exist. The seam test passes; `landing/` imports no mocks today, which is the point.

- [ ] **Step 3: Implement**

In `src/features/spaces/data/liveRepository.ts`, add `import type { Landing, LandingLesson, LandingQuestion } from '../landing/types';` at the top. After `rehearsalHistory` (line 334), add:

```ts
    /* The owner's view of their Space (How it's landing). 403 for a member, 404 for anyone else. */
    landing: (spaceId: string) => http.get<WireLanding>(`${root}/spaces/${idPath(spaceId)}/landing`),
```

Add, near the other exported wire types:

```ts
/**
 * What `GET /v4/spaces/{id}/landing` sends: `Landing` without the colours the app draws
 * (Plan 2, Decision 2), and with `questions` optional until the Questions channel (Plan 4) ships.
 */
export type WireLanding = Omit<Landing, 'accent' | 'lessons' | 'questions'> & {
  lessons: Omit<LandingLesson, 'color'>[];
  questions?: LandingQuestion[];
};
```

Replace `src/features/spaces/data/landing.ts` with:

```ts
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Landing, LandingAnswer } from '../landing/types';
import { landingFor } from '../mocks/landing';
import { stageAccentFor } from '../components/stage';
import type { LoadState } from '../types';
import { loadLiveRepository, type WireLanding } from './liveRepository';
import { isLive } from './useReader';

export type { WireLanding } from './liveRepository';

/**
 * The data seam for the owner's door.
 *
 * Demo ids read `mocks/landing.ts`, as the lab does. A live Space reads
 * `GET /api/v1/v4/spaces/{id}/landing` (Plan 2), in the language the app is
 * showing, and the app draws the two colours the server leaves out: the Space's
 * light from its name and each Lesson's from its order, the way every other
 * room of the Space is lit (`SpaceScreen`, `PracticeScreen`). A hue sampled
 * from a Lesson's first page belongs on the Lesson at ingest; until it is
 * stored there, order is the honest choice.
 *
 * Questions arrive with the Questions channel (Plan 4); until then there are
 * none, and the door draws no section for them.
 */
export function fromWire(w: WireLanding): Landing {
  return {
    ...w,
    accent: stageAccentFor(w.spaceName.length),
    lessons: w.lessons.map((l) => ({ ...l, color: stageAccentFor(l.order) })),
    questions: Array.isArray(w.questions) ? w.questions : [],
    themes: Array.isArray(w.themes) ? w.themes : [],
  };
}

const statusOf = (e: unknown) => (typeof e === 'object' && e && 'status' in e ? Number((e as { status: unknown }).status) : 0);

type Loaded = { state: LoadState; landing: Landing | null };

const demo = (spaceId: string): Loaded => {
  const landing = landingFor(spaceId);
  return { state: landing ? 'ready' : 'empty', landing };
};

export function useLanding(spaceId: string): Loaded & {
  answer: (questionId: string, text: string, forEveryone: boolean) => void;
  retry: () => void;
} {
  const live = isLive(spaceId);
  const { i18n } = useTranslation();
  const [loaded, setLoaded] = useState<Loaded>(() => (live ? { state: 'loading', landing: null } : demo(spaceId)));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!live) {
      setLoaded(demo(spaceId));
      return;
    }
    let alive = true;
    setLoaded({ state: 'loading', landing: null });
    loadLiveRepository()
      .then((repo) => repo.landing(spaceId))
      .then((w) => alive && setLoaded({ state: 'ready', landing: fromWire(w) }))
      .catch((e) => {
        if (!alive) return;
        const s = statusOf(e);
        setLoaded({ state: s === 403 || s === 404 ? 'empty' : 'error', landing: null });
      });
    return () => {
      alive = false;
    };
  }, [spaceId, live, tick, i18n.language]);

  // Demo: the answer stays in the screen's state, so the lab's answer flow works end to end.
  // Live answering is Task 15 (Plan 4's endpoint).
  const answer = useCallback((questionId: string, text: string, forEveryone: boolean) => {
    const reply: LandingAnswer = { text, forEveryone, at: new Date().toISOString() };
    setLoaded((l) =>
      l.landing ? { ...l, landing: { ...l.landing, questions: l.landing.questions.map((q) => (q.id === questionId ? { ...q, answer: reply } : q)) } } : l,
    );
  }, []);

  return { ...loaded, answer, retry: useCallback(() => setTick((t) => t + 1), []) };
}
```

**[UI session]** If the UI session changed `useLanding`'s return shape (for example, it now returns `open`/`answered` lists), keep that shape and add `retry` and the live branch to it. The test above pins only `state`, `landing`, `retry` and the colours.

- [ ] **Step 4: Run the tests and the seal**

```bash
npx vitest run src/features/spaces/__tests__/landing-live.test.tsx src/features/spaces/__tests__/landing.test.tsx src/features/spaces/__tests__/seam.test.ts src/features/spaces/__tests__/boundary.test.ts
npx tsc --noEmit -p tsconfig.app.json
```

Expected: all pass. Boundary holds: `react-i18next`, relative imports only, no `fetch`.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add src/features/spaces/data/liveRepository.ts src/features/spaces/data/landing.ts \
  src/features/spaces/__tests__/landing-live.test.tsx src/features/spaces/__tests__/seam.test.ts
git commit -m "feat(v4-landing): the door reads the Space's real view; colours drawn by the app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: `/v4/space/:spaceId/landing`, for the person who runs it

**Files:**
- Create: `src/features/spaces/screens/SpaceOwnerGate.tsx`, `src/features/spaces/screens/LandingRoute.tsx`
- Modify: `src/App.tsx:114` (lazy imports), `:468-470` (route before `:tab`)
- Modify: `src/features/spaces/components/course/OwnerBar.tsx:15-20` (comment only, Decision 6)
- Test: create `src/features/spaces/__tests__/landing-door.test.tsx`

**Interfaces:**
- Consumes: `spaceById(id)` (`data/world.ts:94`; the world is loaded before any v4 screen renders, `data/viewer.tsx:47-90`) and `isLive` (`data/useReader.ts:45`).
- Produces:
  - `<SpaceOwnerGate>{children}</SpaceOwnerGate>`. On a live id it renders its children only when `viewerRole === 'owner' && !personal`; otherwise it does `<Navigate replace to="/v4/space/:spaceId" />`. On a demo id it renders its children; the fixtures are a design study, as `SpaceMemberGate` treats them.
  - `LandingRoute` renders `<LandingScreen spaceId>`.

- [ ] **Step 1: Write the failing test**

Create `src/features/spaces/__tests__/landing-door.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { setLiveWorld } from '../data/world';
import type { Space } from '../types';
import { emptyWorld } from './emptyWorld';
import SpaceOwnerGate from '../screens/SpaceOwnerGate';

const SPACE = '0b7a308e-25cd-4a62-a47d-3e8930dde167';
const space = (viewerRole: Space['viewerRole'], personal = false) =>
  ({ id: SPACE, name: 'Lerngruppe', owner: { id: 'u', name: 'Lea', avatarUrl: null }, viewerRole, personal, state: 'active', visibility: 'private', memberCount: 6 }) as unknown as Space;

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}</div>;
}

const visit = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/v4/space/${id}/landing`]}>
      <Where />
      <Routes>
        <Route path="/v4/space/:spaceId/landing" element={<SpaceOwnerGate><p>the door</p></SpaceOwnerGate>} />
        <Route path="/v4/space/:spaceId" element={<p>the space</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => vi.stubEnv('VITE_V4_DATA_MODE', 'live'));
afterEach(() => {
  setLiveWorld(null);
  vi.unstubAllEnvs();
});

describe('the door is the owner’s', () => {
  it('the person who runs the Space walks in', () => {
    setLiveWorld(emptyWorld({ spaces: [space('owner')] }));
    visit(SPACE);
    expect(screen.getByText('the door')).toBeInTheDocument();
  });

  it.each([
    ['a member', [space('member')]],
    ['someone who has not joined', [space(null)]],
    ['someone the Space is hidden from', []],
    ['the owner of their own personal Space', [space('owner', true)]],
  ])('%s is taken back to the Space', (_who, spaces) => {
    setLiveWorld(emptyWorld({ spaces }));
    visit(SPACE);
    expect(screen.getByText('the space')).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe(`/v4/space/${SPACE}`);
  });

  it('a demo Space opens on its fixture', () => {
    vi.unstubAllEnvs();
    visit('s-dbs');
    expect(screen.getByText('the door')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/landing-door.test.tsx`
Expected: FAIL. Cannot resolve `../screens/SpaceOwnerGate`.

- [ ] **Step 3: Implement**

Create `src/features/spaces/screens/SpaceOwnerGate.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { isLive } from '../data/useReader';
import { spaceById } from '../data/world';

/**
 * The way into a room only the person who runs a Space may see.
 *
 * How it's landing is the owner's: a member, someone who has not joined, or
 * someone the Space is hidden from is taken back to the Space itself, never
 * told the room exists. Your personal Space has no owner's view: it is only
 * you. The world is loaded before any v4 screen renders (`LiveGate`), so the
 * answer is synchronous. Demo ids pass: their fixtures are a design study.
 */
export default function SpaceOwnerGate({ children }: { children: ReactNode }) {
  const { spaceId } = useParams<{ spaceId: string }>();
  if (!spaceId) return <Navigate replace to="/v4/spaces" />;
  if (!isLive(spaceId)) return <>{children}</>;
  const space = spaceById(spaceId);
  if (space?.viewerRole === 'owner' && !space.personal) return <>{children}</>;
  return <Navigate replace to={`/v4/space/${spaceId}`} />;
}
```

Create `src/features/spaces/screens/LandingRoute.tsx`:

```tsx
import { Navigate, useParams } from 'react-router-dom';
import LandingScreen from '../landing/LandingScreen';

/** Adapts the route to the door, which stays route-agnostic (as `SpaceRoute` does for the Space). */
export default function LandingRoute() {
  const { spaceId } = useParams<{ spaceId: string }>();
  return spaceId ? <LandingScreen spaceId={spaceId} /> : <Navigate replace to="/v4/spaces" />;
}
```

In `src/App.tsx`, after line 114 (`const SpaceMemberGate = …`), add:

```tsx
const SpaceOwnerGate = lazy(() => import("./features/spaces/screens/SpaceOwnerGate"));
const V4Landing = lazy(() => import("./features/spaces/screens/LandingRoute"));
```

After the `/manage` route (line 468) and before the `:tab` route (line 470), add:

```tsx
            {/* How it's landing: the owner's door. Declared before :tab so it is not swallowed as one. */}
            <Route path="/v4/space/:spaceId/landing" element={<SpaceOwnerGate><V4Landing /></SpaceOwnerGate>} />
```

In `src/features/spaces/components/course/OwnerBar.tsx`, change the doc comment's "a way to the course manager for everything rarer (rename, reorder, remove, analytics)" to "a way to the course manager for everything rarer (rename, reorder, remove). How the Space is landing has its own room, from the masthead." No behaviour changes. `/v4/space/:id/manage` keeps redirecting to the classic manager (Decision 6).

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/spaces/__tests__/landing-door.test.tsx src/features/spaces/__tests__/boundary.test.ts src/features/spaces/__tests__/seam.test.ts
npx tsc --noEmit -p tsconfig.app.json
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add src/features/spaces/screens/SpaceOwnerGate.tsx src/features/spaces/screens/LandingRoute.tsx src/App.tsx \
  src/features/spaces/components/course/OwnerBar.tsx src/features/spaces/__tests__/landing-door.test.tsx
git commit -m "feat(v4-landing): /v4/space/:id/landing, behind the owner's gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The door waits, fails and sits under the floor well **[UI session]**

The door today renders `NotFound` for every state that is not `ready` (`landing/LandingScreen.tsx:37-45` at `ae1a6eaa`). Live, it needs four states:
- loading: the stage's skeleton;
- error: the stage's error with retry;
- empty (not yours, or gone): `NotFound`;
- ready, including the floor.

Most real Spaces sit under the floor. That state is Luna's one line, Questions if any are waiting, and nothing else.

**Files:**
- Modify: `src/features/spaces/landing/LandingScreen.tsx` (its non-ready branch; re-read the file first, its lines will have moved)
- Test: `src/features/spaces/__tests__/landing-live.test.tsx` (append)

**Interfaces:**
- Consumes: `useLanding` from Task 9 (`state`, `landing`, `retry`); `DetailSkeleton`, `SpacesError`, `NotFound` from `src/features/spaces/components/states.tsx:90,222,260`.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/spaces/__tests__/landing-live.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import LandingScreen from '../landing/LandingScreen';

const door = () =>
  render(
    <MemoryRouter>
      <LandingScreen spaceId={SPACE} />
    </MemoryRouter>,
  );

describe('the door, live', () => {
  it('waits on the stage, then says so when it could not load, with a way to try again', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    landingApi.mockRejectedValue(Object.assign(new Error('500'), { status: 500 }));
    door();
    expect(screen.getByLabelText(i18n.t('v4Spaces:states.loading.any'))).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('under the floor: Luna says it once, and there are no figures and no light', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    landingApi.mockResolvedValue(wire);
    door();
    const line = await screen.findByText(
      '4 people have been reading. Patterns show once five people have been through a page.',
    );
    expect(line).toBeInTheDocument();
    expect(screen.queryByText(/of 6 members read this week/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link', { name: /^Page \d+ of / })).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Questions for you' })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Patterns show once five/)).toHaveLength(1);
  });

  it('reads in German', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    landingApi.mockResolvedValue(wire);
    await i18n.changeLanguage('de');
    door();
    expect(await screen.findByRole('heading', { level: 1, name: 'Wie es ankommt' })).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});
```

If the UI session's final copy for `door.lede.floor_other`, `figures.reading` or the error button differs, use its exact strings. The requirements are:
- the line is said once;
- there are no figures, no labelled cells and no Questions heading when none are waiting;
- the heading is in German.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/spaces/__tests__/landing-live.test.tsx`
Expected: the first FAILS. There is no skeleton and no retry; `NotFound` shows instead. The floor and German tests may already pass on the UI session's screen. If so, they pin it.

- [ ] **Step 3: Implement**

In `LandingScreen.tsx`, take `retry` from `useLanding` as well, and import `DetailSkeleton, SpacesError` beside `NotFound` from `../components/states`. Replace the single non-ready branch with:

```tsx
  if (state !== 'ready' || !landing) {
    return (
      <Scene surface={SURFACES.course} status="progress" motionKey={`landing-${spaceId}`}>
        <SpacesTopBar active="spaces" viewer={viewer} />
        {state === 'loading' ? (
          <DetailSkeleton />
        ) : state === 'error' ? (
          <SpacesError what="space" onRetry={retry} />
        ) : (
          <NotFound what="space" back={{ to: `/v4/space/${spaceId}`, place: 'space' }} />
        )}
      </Scene>
    );
  }
```

Check that `place: 'space'` is a valid `Back['place']` (`components/states.tsx`). If it is not, use the value `CourseScreen.tsx:102` uses (`'spaces'`, with `to: '/v4/spaces'`).

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/spaces/__tests__/landing-live.test.tsx src/features/spaces/__tests__/landing.test.tsx
npx tsc --noEmit -p tsconfig.app.json
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add src/features/spaces/landing/LandingScreen.tsx src/features/spaces/__tests__/landing-live.test.tsx
git commit -m "feat(v4-landing): the door waits, fails and sits under the floor on the stage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: One ghost pill on the masthead, for the owner only

Spec C2: owners get one ghost pill beside **Rehearse** on the Space masthead, "How it's landing", with no number on it.

**Files:**
- Modify: `src/features/spaces/screens/CourseScreen.tsx:5-24` (import `ghostPill`), `:172-179` (masthead)
- Test: `src/features/spaces/components/__tests__/oneApp.test.tsx` (new `describe`, reusing its harness at lines 17-71 and 137-145)

**Interfaces:**
- Consumes: `v4Landing:door.pill` (exists, en "How it’s landing", de "Wie es ankommt"); `ghostPill` (`components/stage.tsx:146`).
- Produces: a `Link` to `/v4/space/:id/landing`, shown when `space.viewerRole === 'owner' && !space.personal` and the Space has Lessons. An empty Space returns earlier (`CourseScreen.tsx:122-133`): nothing has landed yet, so there is no pill there.

- [ ] **Step 1: Write the failing test**

Append to `src/features/spaces/components/__tests__/oneApp.test.tsx`:

```tsx
describe('the door, from the masthead', () => {
  const withLessons = { state: 'ready', course: { id: SPACE, title: 'Lerngruppe', author: null, lectures: [{ id: 'l1', title: 'Intro', total_slides: 3, ideas: [] }] } };
  beforeEach(() => useCourseMock.mockReturnValue(withLessons));

  it('the person who runs the Space sees one quiet way in, with no number on it', async () => {
    setLiveWorld(emptyWorld({ spaces: [space('owner', 'public')] }));
    mountCourse();
    const pill = await screen.findByRole('link', { name: 'How it’s landing' });
    expect(pill).toHaveAttribute('href', `/v4/space/${SPACE}/landing`);
    expect(pill.textContent).not.toMatch(/\d/);
    expect(screen.getByRole('link', { name: /Rehearse for the exam/ })).toBeInTheDocument();
  });

  it('a member does not', async () => {
    setLiveWorld(emptyWorld({ spaces: [space('member')] }));
    mountCourse();
    expect(await screen.findByRole('heading', { name: 'Lerngruppe' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'How it’s landing' })).not.toBeInTheDocument();
  });

  it('nor does the owner of a personal Space', async () => {
    setLiveWorld(emptyWorld({ spaces: [{ ...space('owner'), personal: true } as Space] }));
    mountCourse();
    expect(await screen.findByRole('heading', { name: 'Lerngruppe' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'How it’s landing' })).not.toBeInTheDocument();
  });

  it('reads in German', async () => {
    await i18n.changeLanguage('de');
    setLiveWorld(emptyWorld({ spaces: [space('owner', 'public')] }));
    mountCourse();
    expect(await screen.findByRole('link', { name: 'Wie es ankommt' })).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });
});
```

If the UI session renamed `door.pill`, use its string.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/components/__tests__/oneApp.test.tsx -t "the door, from the masthead"`
Expected: FAIL. No such link.

- [ ] **Step 3: Implement**

In `CourseScreen.tsx`, add `import { ghostPill } from '../components/stage';` with the other imports. Replace the Rehearse `Link` (lines 173 to 179) with:

```tsx
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to={`/v4/space/${course.id}/rehearse`}
              className="console-focusable inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-background"
            >
              <Target aria-hidden className="h-4 w-4" />
              {t('course.rehearse')}
            </Link>
            {/* The owner's door (spec C2): one quiet pill, no number on it. */}
            {owner && !space?.personal && (
              <Link to={`/v4/space/${course.id}/landing`} className={ghostPill}>
                {t('v4Landing:door.pill')}
              </Link>
            )}
          </div>
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/spaces/components/__tests__/oneApp.test.tsx src/features/spaces/components/__tests__/modes.test.tsx src/features/spaces/components/__tests__/spaceGerman.plan.test.tsx
npx tsc --noEmit -p tsconfig.app.json
node scripts/check-v4-strings.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add src/features/spaces/screens/CourseScreen.tsx src/features/spaces/components/__tests__/oneApp.test.tsx
git commit -m "feat(v4-landing): the owner's pill beside Rehearse, no number on it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Each finding says only what its numbers back **[UI session]**

Plan 2's final review asked for a copy pass per kind. Decision 4: finding sentences keep their page but never repeat their Lesson. The UI session already dropped the Lesson from every summary (2026-11-05); verify it and do only what is left. Two summaries claim what nothing measured:

- `kind.confusion_block.summary` says "for **most** who read them". The detector's bar is 25% foggy per page (`detectors.py:236,247-250`), and `_metrics` sends no number for it (`landing_map.py:68-85`).
- `kind.healthy.*` says "Few asked for help, and most cleared its checkpoints first try". The `healthy` kind is `detect_positive_resolution`: a page that drew confusion (≥25%) **and** that ≥75% then passed (`detectors.py:337-374`). It is a struggle that resolved, not an easy page. `collapse_healthy` sends it with no metrics (`landing_map.py:114-125`).

`quiz_misalignment`'s "read easily" is true again after Task 3 (five raters).

**Files:**
- Modify: `src/i18n/locales/en/v4Landing.json`, `src/i18n/locales/de/v4Landing.json` (`kind.confusion_block.summary`, `kind.healthy.summary`, `kind.healthy.why`; plus any summary still naming its Lesson)
- Test: `src/features/spaces/__tests__/landing-live.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

Append:

```tsx
describe('what each finding says', () => {
  const kinds = ['confusion_hotspot', 'skipped_slide', 'speed_bump', 'overpacked', 'leaky_bucket', 'confusion_block', 'quiz_misalignment', 'calibration_gap', 'healthy'];

  it.each(['en', 'de'])('no finding sentence repeats its Lesson (%s)', (lng) => {
    const t = i18n.getFixedT(lng, 'v4Landing');
    for (const k of kinds) {
      const s = t(`kind.${k}.summary`, { page: 12, first: 3, last: 5, lesson: 'Normalization', askers: 7, foggy: 40, seconds: 3, backs: 6, ratio: '2.1', pct: 30 });
      expect(s, `${lng} ${k}`).not.toMatch(/Normalization/);
    }
  });

  it('a foggy stretch claims no majority, and a resolved struggle is named as one', () => {
    const en = i18n.getFixedT('en', 'v4Landing');
    const de = i18n.getFixedT('de', 'v4Landing');
    expect(en('kind.confusion_block.summary')).not.toMatch(/\bmost\b/);
    expect(de('kind.confusion_block.summary')).not.toMatch(/meisten/);
    expect(en('kind.healthy.summary')).toBe('It asked something of people, and most then got its questions right first try.');
    expect(de('kind.healthy.summary')).toBe('Sie hat den Leuten etwas abverlangt, und die meisten haben ihre Fragen danach beim ersten Versuch gelöst.');
  });
});
```

`confusion_block` takes `first`/`last` and draws its stretch on the map. Its sentence names no page numbers, so the `\b12\b` check is about `page` only. The test also never interpolates 3 or 5 into a pattern.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/landing-live.test.tsx -t "what each finding says"`
Expected: FAIL on every kind whose summary still says "page {{page}}", on "most", and on the healthy wording.

- [ ] **Step 3: Write the copy**

`src/i18n/locales/en/v4Landing.json`. Keep the UI session's sentence for any kind it already rewrote without page or Lesson; otherwise use these:

```json
"confusion_hotspot": { "summary": "{{askers}} people opened Explain or asked here, and {{foggy}}% said it was still foggy." },
"skipped_slide": { "summary": "People stay a median of {{seconds}} s here before moving on." },
"speed_bump": { "summary": "{{backs}} people turned back to it from the page right after." },
"overpacked": { "summary": "It holds people {{ratio}}× longer than the pages around it, and many ask for help." },
"leaky_bucket": { "summary": "{{pct}}% of readers stopped right after it." },
"confusion_block": { "summary": "Several pages in a row ran foggy for at least one in four who read them." },
"quiz_misalignment": { "summary": "It read easily, yet only {{pct}}% passed its practice first try." },
"calibration_gap": { "summary": "{{pct}}% who said it had clicked still missed the checkpoint." },
"healthy": {
  "summary": "It asked something of people, and most then got its questions right first try.",
  "why": "Struggle that resolves is learning. Nothing to change here."
}
```

`src/i18n/locales/de/v4Landing.json` (du, no exclamation marks):

```json
"confusion_hotspot": { "summary": "{{askers}} Leute haben hier Erklären geöffnet oder gefragt, und {{foggy}}% fanden es noch nebelig." },
"skipped_slide": { "summary": "Die Leute bleiben hier im Median {{seconds}} s, bevor sie weitergehen." },
"speed_bump": { "summary": "{{backs}} Leute sind von der Seite danach hierher zurückgegangen." },
"overpacked": { "summary": "Sie hält die Leute {{ratio}}× länger als die Seiten um sie herum, und viele suchen Hilfe." },
"leaky_bucket": { "summary": "{{pct}}% der Lesenden haben direkt danach aufgehört." },
"confusion_block": { "summary": "Mehrere Seiten hintereinander waren für mindestens eine von vier Personen nebelig." },
"quiz_misalignment": { "summary": "Sie las sich leicht, doch nur {{pct}}% haben ihre Übung beim ersten Versuch geschafft." },
"calibration_gap": { "summary": "{{pct}}% von denen, für die es klick gemacht hat, haben den Checkpoint trotzdem verfehlt." },
"healthy": {
  "summary": "Sie hat den Leuten etwas abverlangt, und die meisten haben ihre Fragen danach beim ersten Versuch gelöst.",
  "why": "Mühe, die sich löst, ist Lernen. Hier gibt es nichts zu ändern."
}
```

Merge each object into the existing `kind.<k>` entry; `headline` and the other `why` keys stay unless they name the page. Then:
- re-read `landing.test.tsx`. Its `HOTSPOT` and `TRAP` regexes (lines 34-35 at `ae1a6eaa`) pin the old summaries, so update them to the new ones;
- check that `cardCopy` (`landing/copy.ts:19-27`) still passes `page`, `first`, `last` and `lesson` (harmless when unused).

- [ ] **Step 4: Run the tests and the gates**

```bash
npx vitest run src/features/spaces/__tests__/landing-live.test.tsx src/features/spaces/__tests__/landing.test.tsx src/features/spaces/__tests__/v4Strings.test.ts
npm run lint
node scripts/check-vocabulary.mjs src/features/spaces | tail -3
```

Expected: pass. i18n parity holds. The vocabulary total is unchanged.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add src/i18n/locales/en/v4Landing.json src/i18n/locales/de/v4Landing.json \
  src/features/spaces/__tests__/landing-live.test.tsx src/features/spaces/__tests__/landing.test.tsx
git commit -m "fix(v4-landing): each finding says only what its numbers back; no page or Lesson twice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The wire stops counting readers per Lesson **[UI session]**

Decision 3: there is no per-Lesson reader count on the map. Once the UI session's `LessonMap` no longer reads `l.readers`, the payload stops carrying it. Under the floor, a Lesson is `light: "few"`.

**Files:**
- Modify: `backend/services/v4_landing_service.py:91-98` (the `entry` dict)
- Modify: `src/features/spaces/landing/types.ts` (`LandingLesson.readers`, if the UI session kept it), `src/features/spaces/mocks/landing.ts` (fixtures), `src/features/spaces/__tests__/landing-live.test.tsx` (`wire`)
- Test: `backend/tests/unit/test_v4_landing_api.py:129-143`

- [ ] **Step 1: Confirm nothing reads it**

Run: `grep -rn "\.readers" src/features/spaces/landing src/pages/LandingLab.tsx`
Expected: only `landing.readers` (the Space's figure and floor), no `l.readers` / `lesson.readers`. If a Lesson's readers are still read, stop: this task waits until the UI session's map stops reading them.

- [ ] **Step 2: Write the failing test**

In `test_the_owner_sees_the_space_in_aggregate_and_never_a_question`, change the `normalization` assertion to:

```python
    assert (normalization["order"], len(normalization["help"])) == (1, 4)
    assert all("readers" not in lesson for lesson in body["lessons"])
```

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_landing_api.py -q -p no:cacheprovider`
Expected: FAIL. `readers` is present.

- [ ] **Step 3: Implement**

In `backend/services/v4_landing_service.py`, delete `"readers": len(lf.readers),` from `entry`; `light` and `help` still use `len(lf.readers)`. In the module docstring add: "A Lesson carries no reader count: the door says the Space's once (decided 2026-11-05)."

In `src/features/spaces/landing/types.ts`, delete `readers` from `LandingLesson` if it is still there. Delete it from each Lesson seed in `mocks/landing.ts` and from `wire.lessons` in `landing-live.test.tsx`.

- [ ] **Step 4: Run the tests**

```bash
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_landing_api.py -q -p no:cacheprovider
npx tsc --noEmit -p tsconfig.app.json && npx vitest run src/features/spaces/__tests__/landing-live.test.tsx src/features/spaces/__tests__/landing.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add backend/services/v4_landing_service.py backend/tests/unit/test_v4_landing_api.py src/features/spaces/landing/types.ts \
  src/features/spaces/mocks/landing.ts src/features/spaces/__tests__/landing-live.test.tsx
git commit -m "feat(landing): a Lesson carries no reader count on the wire

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Answering a question, live **[Plan 4] [UI session]**

The door renders whatever `questions` the payload carries: unanswered above the map, answered folded at the bottom (decision 2, the UI session's rendering). Live answering posts to Plan 4's endpoint. Before writing this task, read Plan 4 (`docs/superpowers/plans/` dated 2026-11-05, "questions") and use **its** route, body and response if they differ from the contract at the top of this plan.

**Files:**
- Modify: `src/features/spaces/data/liveRepository.ts` (`answerQuestion`), `src/features/spaces/data/landing.ts` (`answer`, live branch)
- Test: `src/features/spaces/__tests__/landing-live.test.tsx` (append)

**Interfaces:**
- Consumes: `POST /api/v1/v4/spaces/{id}/questions/{qid}/answer` with `{ text, visibility: 'asker' | 'space' }` → `{ text, forEveryone, at }` (provided by Plan 4).
- Produces: `LiveRepository.answerQuestion(spaceId, questionId, text, forEveryone): Promise<LandingAnswer>`. Live `answer` shows the answer at once and, if the post fails, takes it back and re-reads the door.

- [ ] **Step 1: Write the failing test**

Append:

```tsx
describe('answering, live', () => {
  const asked: WireLanding = {
    ...wire,
    questions: [{ id: 'q1', lessonId: 'l1', page: 6, text: 'Only 2×2?', asker: null, createdAt: '2026-11-05T10:00:00Z' }],
  };

  it('posts the answer with who it is for, and keeps it', async () => {
    vi.stubEnv('VITE_V4_DATA_MODE', 'live');
    const answerQuestion = vi.fn().mockResolvedValue({ text: 'Any size.', forEveryone: true, at: '2026-11-05T11:00:00Z' });
    landingApi.mockResolvedValue(asked);
    const repo = await import('../data/liveRepository');
    vi.spyOn(repo, 'loadLiveRepository').mockResolvedValue({ landing: landingApi, answerQuestion } as never);
    const { result } = renderHook(() => useLanding(SPACE));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    act(() => result.current.answer('q1', 'Any size.', true));
    await waitFor(() => expect(answerQuestion).toHaveBeenCalledWith(SPACE, 'q1', 'Any size.', true));
    expect(result.current.landing?.questions[0].answer?.forEveryone).toBe(true);
  });

  it('the repository says it the way the server expects', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const http = { get: vi.fn(), post: vi.fn(async (path: string, body: unknown) => (calls.push({ path, body }), {})), patch: vi.fn(), delete: vi.fn() } as unknown as V4Transport;
    await createLiveRepository(http).answerQuestion(SPACE, 'q1', 'Any size.', false);
    expect(calls).toEqual([{ path: `/api/v1/v4/spaces/${SPACE}/questions/q1/answer`, body: { text: 'Any size.', visibility: 'asker' } }]);
  });
});
```

If the module mock at the top of the file (Task 9) makes `vi.spyOn` impossible, extend the hoisted mock instead: `loadLiveRepository: async () => ({ landing: landingApi, answerQuestion: answerApi })`, with `answerApi` hoisted beside `landingApi`.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/landing-live.test.tsx -t "answering, live"`
Expected: FAIL. There is no `answerQuestion`, and the live answer is never posted.

- [ ] **Step 3: Implement**

In `liveRepository.ts`, after `landing`:

```ts
    /* Answer a question someone sent (Plan 4): only them, or everyone on that page. */
    answerQuestion: (spaceId: string, questionId: string, text: string, forEveryone: boolean) =>
      http.post<LandingAnswer>(`${root}/spaces/${idPath(spaceId)}/questions/${idPath(questionId)}/answer`, {
        text,
        visibility: forEveryone ? 'space' : 'asker',
      }),
```

(add `LandingAnswer` to the type import from `../landing/types`).

In `data/landing.ts`, replace `answer` with:

```ts
  const answer = useCallback(
    (questionId: string, text: string, forEveryone: boolean) => {
      const reply: LandingAnswer = { text, forEveryone, at: new Date().toISOString() };
      const put = (a: LandingAnswer | undefined) =>
        setLoaded((l) =>
          l.landing ? { ...l, landing: { ...l.landing, questions: l.landing.questions.map((q) => (q.id === questionId ? { ...q, answer: a } : q)) } } : l,
        );
      put(reply);
      if (!live) return;
      loadLiveRepository()
        .then((repo) => repo.answerQuestion(spaceId, questionId, text, forEveryone))
        .then((saved) => put(saved))
        .catch(() => {
          // Not saved: take it back and read the door again, so the screen never shows an answer that is not there.
          put(undefined);
          setTick((t) => t + 1);
        });
    },
    [live, spaceId],
  );
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/features/spaces/__tests__/landing-live.test.tsx src/features/spaces/__tests__/landing.test.tsx src/features/spaces/__tests__/boundary.test.ts
npx tsc --noEmit -p tsconfig.app.json
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git status && git log -1 --oneline
git add src/features/spaces/data/liveRepository.ts src/features/spaces/data/landing.ts src/features/spaces/__tests__/landing-live.test.tsx
git commit -m "feat(v4-landing): answering a question in the door, live (Plan 4's endpoint)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: See it on a phone, in German, without motion; then hand over

**Files:** none changed unless a check fails.

- [ ] **Step 1: Every gate**

```bash
export PATH="/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin:$PATH"
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npx vitest run
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests -m "not db" -q -p no:cacheprovider
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/ruff check backend/ --select F821,F811,F841
node scripts/check-vocabulary.mjs src/features/spaces | tail -3
```

Expected: all green. Vocabulary is at or below the Task 0 count. A failure that also failed at Task 0 is pre-existing: say so; do not fix it here.

- [ ] **Step 2: In the browser (demo data, no prod)**

Start `dev` from `.claude/launch.json` with `preview_start`.
- Open `/v4/space/s-dbs/landing` and `/v4/space/s-friends/landing` (demo ids pass the gate).
- Use `resize_window` with preset `mobile` (375×812):
  - no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth` via `javascript_tool`);
  - the map's cells stay at least 3px wide on the longest Lesson;
  - Luna's button is reachable.
- Switch the app to Deutsch and read every line of the door for du, Lektion/Seite/Idee, and no Folie/Vorlesung/Kurs.
- Emulate reduced motion. Run `matchMedia('(prefers-reduced-motion: reduce)').matches` in `javascript_tool` after enabling it in DevTools, or check that every `motion.*` in `landing/` keys off `useReducedMotion()` (`grep -n "initial=" src/features/spaces/landing/*.tsx`). Cells and bars must not animate.
- `read_console_messages` with `onlyErrors`: none.
- Reset with preset `desktop`.

Live data needs Abi signed in, and the local backend reads **prod**. Do it only if Abi is there, read-only. As the owner of a real Space, open the pill and check:
- the floor state reads well;
- `GET …/landing` carries no name, id, email or question text;
- the colours draw.

Otherwise skip it and say so.

- [ ] **Step 3: Open PR B**

Re-run `git status` and `git log -1`, push `claude/landing-plan-3-door`, and open **PR B**: "How it's landing, Plan 3B: the door in v4". The description lists:
- Tasks 9 to 15;
- which tasks waited on the UI session and on Plan 4;
- the colour decision (Decision 5);
- the deploy order below.

End with the Claude Code line. Abi merges.

- [ ] **Step 4: Record it**

Update `/Users/abdullahabobaker/.claude/projects/-Users-abdullahabobaker-Desktop-ascend-academy/memory/project_analytics_v4_integration.md` with:
- PR A and PR B numbers, and what each changed;
- the migration's applied state;
- the residuals (Decision 4);
- that Plan 4 is next.

In the release punch list artifact (db collection `issues`), add or close the matching `LS-NNN` rows: the door, the privacy floor, the cache trigger.

---

## Deploy (manual, `docs/runbooks/deploy-main-to-prod.md`)

Order: **migration → backend (PR A) → frontend (PR A) → frontend (PR B)**. PR B's backend change (Task 14) is additive-safe: the frontend ignores a missing `readers`.

1. **Before anything, check what prod runs.** The api and worker were last built 2026-10-31 18:27 UTC; frontend only on 2026-11-02 (memory). Confirm the running api has Plan 2's route. An unauthenticated `curl -s -o /dev/null -w '%{http_code}' https://learnstation.app/api/v1/v4/spaces/00000000-0000-0000-0000-000000000000/landing` answers 401 or 403, not 404. Compare image build dates in UTC (`docker images`) against the merge commits (+0200). Plans 1 and 2 need migration `20261027000000` (applied 2026-10-30, policy half).
2. **Migration `20261105000000`, by hand.** Never `supabase db push`.
   - **First probe prod:**
     - `SELECT pg_get_functiondef('public.invalidate_analytics_cache_on_event()'::regprocedure);`
     - `SELECT to_regclass('public.analytics_cache_invalidation_debounce');`
     - `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.learning_events'::regclass AND NOT tgisinternal;`
   - **If the debounce table is missing, stop and ask Abi.** The new function writes to it, and a failing trigger would drop every learning event. (Prod has diverged from the migration files before: no `event_type` CHECK, and no partitions.)
   - Then apply from `origin/main`: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/20261105000000_analytics_cache_invalidation_real_lessons.sql`.
   - Verify:
     - `SELECT prosecdef FROM pg_proc WHERE proname = 'invalidate_analytics_cache_on_event';` → `t`;
     - `SELECT has_function_privilege('anon','public.invalidate_analytics_cache_on_event()','EXECUTE');` → `f`;
     - the function definition contains `FROM public.lectures WHERE id = lid`.
   - Write the result and date into PR A.
3. **Backend (PR A).**
   - No new settings: two are **removed** (`FEATURE_LANDING_PEOPLE`, `LANDING_PSEUDONYM_SALT`; neither is set on the server; check both `.env` files anyway and delete them if present).
   - Rollback tag first.
   - After the swap, clear the legacy garden's cached Strugglers: `DELETE FROM public.analytics_cache WHERE view_name IN ('insights', 'dashboard');`. They would otherwise live out their TTL.
4. **Frontend.** `VITE_*` values are baked at build, so a rebuild is needed, not a restart. No new `VITE_*` flag. Rebuild after PR A (legacy pages, wording) and again after PR B (the door).
5. **After deploy:**
   - As an owner, the pill shows on the Space masthead; as a member it does not.
   - `/v4/space/<id>/landing` as a member lands on the Space.
   - The privacy page and the join screen show the floor wording in en and de.
   - Better Stack stays green.

## Open questions for Abi

- **Floor-line count (Task 4e):** Luna's floor line still says how many people read ("4 people have been reading"). In a Space of two that is one person. Keep it (the owner of a small group knows anyway), or say only "A few people have been reading"?

1. **Assignments.** The roster now lists only learners who switched on "show me in Spaces" (Task 7). Is that right? Or should assignments, a legacy professor feature with no v4 room, be switched off for good?
2. **The direct-read residual (Decision 4).** A professor-role owner can still read members' raw event and progress rows, with user ids but no names, through Supabase RLS, because the legacy garden reads that way. Is "never by name" enough until the console's retirement? Or should closing it (moving the garden to service-role aggregates) come before the wording ships?

## Self-review notes (done while writing)

- **Spec coverage, Phase C:**
  - C1 → Task 10 (route before `:tab`; gate; `/manage` unchanged, Decision 6);
  - C2 → Task 12;
  - C3 and C4 → the UI session, plus Task 11 (live states) and Task 13 (copy);
  - C5 → Task 9 (+ Task 15 for answers);
  - C6 → Tasks 8, 11, 12, 13, 16 (en+de, vocabulary, reduced motion, phone width);
  - C7 → Tasks 9 to 15. Owner pill / member: Task 12. Gate redirects: Task 10. Floor: Task 11. Expand in place and open-page link: kept in `landing.test.tsx` (the UI session's), plus the cell-link check in Task 11. German: Tasks 11 and 12. Live mapping: Task 9.
- **A11:** gate → Tasks 5, 6, 7; wording in the same PR → Task 8 (PR A).
- **Plan 2's final-review leftovers:**
  - cache trigger → Task 2;
  - quiz_misalignment needs five raters → Task 3;
  - per-person quiz share → Task 3 (engine and `cleared` figure);
  - askers with text → Task 4;
  - copy pass, healthy and confusion_block "most" → Task 13;
  - short TTL for empty themes → Task 4;
  - themes in parallel → Task 4.
  - traps first in `rank()` (Abi, 2026-11-05) → Task 4b.
  - backend review (2026-11-05): per-member event cap + `created_at` stamped on insert → Task 4c; abandoned Lessons and the hidden leak → Task 4d; `reading` floored per week → Task 4e; legacy confidence routes floored → Task 5; themes key, short themes, sub-2 s views, first try at the window edge → Task 4f.
  - None is a "won't".
- **Abi's 2026-11-05 decisions:**
  - 1 → Tasks 1, 5, 6, 7, 8;
  - 2 → the UI session; Task 9 passes `questions` through; Task 11 checks the absent section; Task 15 answers;
  - 3 → the UI session; Task 14 drops the wire count;
  - 4 → Task 13.
- **Names used across tasks:**
  - backend: `person_share`; `EMPTY_THEMES_TTL`; `ttl_for`; `score_bands` and `SCORE_FLOOR`;
  - wire: `scoreBands`;
  - frontend: `WireLanding`; `fromWire`; `useLanding` → `{state, landing, answer, retry}`; `LiveRepository.landing`; `LiveRepository.answerQuestion`; `SpaceOwnerGate`; `LandingRoute`; `V4Landing`; `SpaceOwnerGate` (lazy).
  - These are consistent in every task that uses them.
