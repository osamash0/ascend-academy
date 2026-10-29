# How it's landing — Plan 2: the engine runs on a Space, for the person who runs it

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /api/v1/v4/spaces/{id}/landing` returns the owner's view of their Space — figures, every Lesson's light and per-page help, ranked findings and themes — computed on the server from members' activity only, above a five-reader floor, with nothing that names or quotes a member.

**Architecture:** One service-role read per Space (`sources/space.py`) loads the Space's Lessons, its members (owner excluded) and their last eight weeks of `learning_events`. Pure functions fold those events into per-page facts (`space_facts.py`), build the bundle the untouched detectors already read (`space_engine.py`), floor and translate the findings into the `Landing` wire shape (`landing_map.py`), and draw the three figures (`figures.py`). Themes come from one metered model call per hot page, cached per asker count (`themes.py`). The route guards ownership first (`assert_space_owner`) and caches the payload for five minutes.

**Tech Stack:** FastAPI + asyncpg + Pydantic v2, Supabase Postgres (`learning_events` partitioned by `created_at`), the existing insight detectors (`backend/services/insights/detectors.py`), the LLM orchestrator through `v4_reader_service._generate_json`, `analytics_cache`; React 18 + Vitest for the two reader follow-ups.

**Spec:** `docs/superpowers/specs/2026-10-26-how-its-landing-design.md` — §0 decisions, §4 Phase B (B1–B9). Plan 1 (`docs/superpowers/plans/2026-10-26-how-its-landing-plan-1-reader-telemetry.md`, PR osamash0/ascend-academy#133) made the reader record what this plan reads. Plan 3 puts the door in v4; Plan 4 is the questions channel.

## Decisions this plan makes (read before executing)

These settle what the spec leaves open or what the code contradicts. Each is cheap to change later.

1. **Backend only, plus three reader follow-ups from Plan 1's final review.** The door's live data seam, route, gate and pill are Plan 3. The endpoint is mounted with the other v4 routers (`FEATURE_V4`) and has no caller until then.
2. **`accent` and `lessons[].color` are not in the payload.** Spec B4 says the colour is "sampled at parse time"; nothing stores it today (only client-side `sampleAccent` / `stageAccentFor`). Plan 3's seam fills both from `stageAccentFor(order)` until a sampled hue is stored at ingest. The payload is therefore `Landing` minus those two fields.
3. **Themes ride in the landing payload** (`themes[]`, at most 5 pages per Space, the most-asked first) instead of a separate `…/landing/evidence?kind=themes` call (B6): the door already reads `landing.themes`. The model runs again only when someone new asks on that page.
4. **The legacy bundle stays where it is.** B2's move of `bundle.py` to `sources/legacy_rls.py` changes nothing for any caller; only the new source is added.
5. **Window: the last 8 weeks** (the figures draw eight weekly bars). Partition pruning keeps the read bounded.
6. **A page's "views" are its distinct readers** (people with a counted `slide_view`). Reach, attrition and the floor are all about people, not page loads.
7. **Who gets what:** the owner gets the view; a member gets 403; a stranger, a missing Space or the personal Space gets 404 (v4 never confirms a hidden thing exists).
8. **Help index:** a page's share of readers who opened Explain, asked, said foggy, or came back to it — normalised over the Space, but a page is fully lit only when at least half its readers needed help (so a calm Space never glows).
9. **Person-level views** (Strugglers, Journey) exist only behind `FEATURE_LANDING_PEOPLE` **and** a non-empty `LANDING_PSEUDONYM_SALT` (both off/empty), named by per-Space pseudonyms. The legacy Journey and the privacy-page wording are untouched here (A11: they change with Plan 3, in the PR that gates the legacy person-level views).
10. **"openai_only tier" (B6)** is per deploy, not per call: themes pass `prefer="openai"`; prod runs `AI_PROVIDER_MODE=openai_only`.

## Global Constraints

- Luna's tables, notes and `learner_memory` are never read by this plan; Luna writes no `learning_events` (her check results are never emitted, decided 2026-10-26).
- The owner's own events are never counted: members are `course_enrollments.user_id <> courses.professor_id`, and the source drops the owner again in Python.
- `MIN_READERS = 5`: a Lesson read by fewer people says nothing; no finding is about a page fewer people read; under the Space's floor only the `reading` figure is real (spec B3).
- No payload ever carries a member's question text, user id, email or name. Question text reaches only the model (themes), never the response.
- The backend emits kinds and numbers, never English copy (spec B5); payload keys are camelCase and match `src/features/spaces/landing/types.ts`.
- The engine's detectors (`backend/services/insights/detectors.py`) are not edited (spec §1.1).
- Telemetry and AI must never fail the owner's request: a failed theme call yields no themes, not an error.
- DB tests run against a throwaway Postgres only: a local one (`DB_TEST_LOCAL_ADMIN_DSN`, default `postgresql://localhost:5432/postgres`) or Docker, with `-m db`. Never the `.env` database (Task 1 makes that impossible).
- Backend tests: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest … -q -p no:cacheprovider` from the repo root.
- Node: `export PATH="/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin:$PATH"` before `npx`; type-check with `npx tsc -p tsconfig.app.json --noEmit`.
- v4 UI copy rules (no new copy in this plan, but if touched): no "professor / student / lecture / slide / course / deck / document" in `src/features/spaces` strings; en and de keys match; German du, no exclamation marks.
- No migration in this plan. The `analytics_cache` table takes a course id in its `lecture_id` slot (no FK), as `professor_overview` already does.
- Commit messages end with the `Co-Authored-By:` line of the model that wrote the commit.

## File Structure

**Backend — new**
- `backend/services/insights/sources/__init__.py` — package marker.
- `backend/services/insights/sources/space.py` — `LessonRow`, `Event`, `SpaceData`, `load_space_data()`: the one service-role read.
- `backend/services/insights/space_facts.py` — `PageFacts`, `LessonFacts`, `Try`, `page_of()`, `first_tries()`, `lesson_facts()`: which events count, once.
- `backend/services/insights/space_engine.py` — `MIN_READERS`, `page_row()`, `lesson_bundle()`, `pages_of()`, `lesson_insights()`: the detectors on a Space, floored.
- `backend/services/insights/landing_map.py` — `help_share()`, `help_index()`, `grid()`, `to_landing()`, `collapse_healthy()`, `lesson_light()`, `rank()`: engine → wire shape.
- `backend/services/insights/figures.py` — `figures()`: the three figures with eight weeks.
- `backend/services/insights/themes.py` — `themes_prompt()`, `clean_themes()`, `themes_for()`.
- `backend/services/insights/people.py` — `strugglers()`, `journey()` (flag-only).
- `backend/services/v4_landing_service.py` — `space_row()`, `get_landing()`, `landing_from()`, `get_people()`, `get_journey()`.
- `backend/api/v1/v4_landing.py` — the routes.

**Backend — modified**
- `backend/domain/authorization.py` — `assert_space_owner()`.
- `backend/schemas/learning_events.py` — `CheckpointAttempt.questionId`.
- `backend/services/v4_telemetry.py`, `backend/api/v1/v4_reader.py` — the checkpoint answer names its question.
- `backend/services/utils/analytics_utils.py` — `space_pseudonym()`.
- `backend/core/config.py` — `feature_landing_people`, `landing_pseudonym_salt`.
- `backend/main.py` — mount `v4_landing` with the v4 routers.
- `backend/tests/db/conftest.py` + `test_v4_create_space.py` + `test_v4_world.py` — one fixture routes every connection to the throwaway DB.

**Frontend — modified (Plan 1 follow-ups)**
- `src/features/spaces/data/reading.ts` — a guided page turn is not a way back; a hidden tab reports its page.
- `src/features/spaces/screens/LessonFacesScreen.tsx` — Luna's page turns are marked as guided.

**Tests (new or extended)**
- `backend/tests/db/test_throwaway_db.py`, `backend/tests/db/test_landing_space_source.py`, `backend/tests/db/test_v4_landing_db.py`
- `backend/tests/unit/test_authorization.py`, `test_learning_events_schema.py`, `test_v4_telemetry.py`, `test_v4_reader_telemetry_api.py`
- `backend/tests/unit/test_landing_space_facts.py`, `test_landing_space_engine.py`, `test_landing_map.py`, `test_landing_figures.py`, `test_landing_themes.py`, `test_v4_landing_api.py`, `test_landing_people.py`
- `src/features/spaces/__tests__/reading.test.ts`

---

### Task 0: A branch of its own, and a baseline

**Files:** none changed by hand.

- [ ] **Step 1: Make the workspace**

Use superpowers:using-git-worktrees to create a worktree on a new branch `claude/landing-plan-2-space-engine`:
- if PR osamash0/ascend-academy#133 has merged, branch from `origin/main`;
- otherwise branch from `claude/professor-analytics-integration-f50860` (Plan 1), and open the PR against that branch.

Do **not** switch the Plan 1 worktree's branch: its PR has Auto-fix on.

This plan file was written in the Plan 1 worktree and is not committed there. Copy it into the new worktree at the same path and make it the branch's first commit:

```bash
git add docs/superpowers/plans/2026-10-29-how-its-landing-plan-2-space-engine.md
git commit -m "docs: How it's landing, plan 2 (the engine on a Space)"
```

The new worktree needs its own `node_modules` (`npm ci`). The Python venv is the absolute path below, so it works from any worktree.

- [ ] **Step 2: Baseline the gates**

```bash
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit -q -p no:cacheprovider
export PATH="/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin:$PATH"
npx tsc -p tsconfig.app.json --noEmit
npx vitest run src/features/spaces/__tests__/reading.test.ts --no-file-parallelism
```
Expected: all pass (Plan 1 ended at 1908 backend unit tests). Write the counts down. Check whether a local Postgres answers (`psql postgresql://localhost:5432/postgres -c 'select 1'`) or Docker runs; note which, for the `-m db` steps.

---

### Task 1: DB tests can never reach the `.env` database

**Files:**
- Modify: `backend/tests/db/conftest.py`
- Modify: `backend/tests/db/test_v4_create_space.py` (the `svc` fixture), `backend/tests/db/test_v4_world.py` (the `pool_from` fixture)
- Test: `backend/tests/db/test_throwaway_db.py`

**Interfaces:**
- Produces: fixture `throwaway_db` (depends on `pg_dsn`): after it runs, `get_db_connection()` in `backend.core.database` **and in every loaded `backend.*` module that imported it** returns an async context manager yielding an `asyncpg` connection to the throwaway database. Later DB tests in this plan use it.

Why: services import `get_db_connection` by name. The existing fixtures patch one module, so anything that module calls still opens the real pool built from `.env` (Plan 1's final review found three such tests).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/db/test_throwaway_db.py`:

```python
"""Every backend connection in a DB test reaches the throwaway database, never the .env one."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.db
asyncpg = pytest.importorskip("asyncpg")


async def test_every_backend_connection_reaches_the_throwaway_database(throwaway_db, pg_dsn):
    import backend.core.database as database
    import backend.services.v4_spaces_service as spaces
    import backend.services.v4_telemetry as telemetry

    expected = pg_dsn.rsplit("/", 1)[1].split("?")[0]
    for module in (database, spaces, telemetry):
        async with await module.get_db_connection() as conn:
            assert await conn.fetchval("SELECT current_database()") == expected
```

- [ ] **Step 2: Run it to see it fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest -m db backend/tests/db/test_throwaway_db.py -q -p no:cacheprovider`
Expected: ERROR — `fixture 'throwaway_db' not found`. (If no Postgres is reachable the test is skipped: start a local one or Docker first; say so in the report.)

- [ ] **Step 3: Add the fixture**

Append to `backend/tests/db/conftest.py`:

```python
@pytest.fixture
def throwaway_db(pg_dsn, monkeypatch):
    """Route every backend ``get_db_connection`` at the throwaway database.

    Services import ``get_db_connection`` by name, so patching one module
    leaves every module it calls on the real pool (built from ``.env``).
    This patches the function in ``backend.core.database`` (so modules
    imported later bind the fake) and in every loaded ``backend.*`` module
    that already holds it, so a DB test can never reach the ``.env`` database.
    """
    import sys

    import asyncpg

    import backend.core.database as database

    original = database.get_db_connection

    class _Conn:
        async def __aenter__(self):
            self.c = await asyncpg.connect(pg_dsn)
            return self.c

        async def __aexit__(self, *exc):
            await self.c.close()

    async def _get():
        return _Conn()

    for name, module in list(sys.modules.items()):
        if (name == "backend" or name.startswith("backend.")) and getattr(module, "get_db_connection", None) is original:
            monkeypatch.setattr(module, "get_db_connection", _get)
    return _get
```

- [ ] **Step 4: Point the three leaking tests at it**

In `backend/tests/db/test_v4_create_space.py`, replace the whole `svc` fixture with:

```python
@pytest.fixture
def svc(throwaway_db):
    """The Spaces service, with every connection on the throwaway database."""
    import backend.services.v4_spaces_service as service

    return service
```

In `backend/tests/db/test_v4_world.py`, replace the whole `pool_from` fixture with:

```python
@pytest.fixture
def pool_from(throwaway_db):
    """The Spaces service, with every connection on the throwaway database."""
    import backend.services.v4_spaces_service as svc

    return svc
```

Remove any import these files no longer use.

- [ ] **Step 5: Run the DB tests that use it**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest -m db backend/tests/db/test_throwaway_db.py backend/tests/db/test_v4_create_space.py backend/tests/db/test_v4_world.py -q -p no:cacheprovider`
Expected: PASS. If no Postgres can be started, report that plainly; do not skip silently.

- [ ] **Step 6: Commit**

```bash
git add backend/tests/db/conftest.py backend/tests/db/test_throwaway_db.py backend/tests/db/test_v4_create_space.py backend/tests/db/test_v4_world.py
git commit -m "test(db): every backend connection in a DB test reaches the throwaway database"
```

---

### Task 2: A checkpoint answer names its question

**Files:**
- Modify: `backend/schemas/learning_events.py` (`CheckpointAttempt`)
- Modify: `backend/services/v4_telemetry.py` (`record_checkpoint`)
- Modify: `backend/api/v1/v4_reader.py` (`reader_checkpoint_answer`)
- Test: `backend/tests/unit/test_learning_events_schema.py`, `backend/tests/unit/test_v4_telemetry.py`, `backend/tests/unit/test_v4_reader_telemetry_api.py`

**Interfaces:**
- Produces: `checkpoint_attempt` payloads from the checkpoint route carry `questionId: int`; teach-back rows carry none. `record_checkpoint(..., session_id, question_id: int | None = None)`.

Why: Task 7 counts only the first try at each question. Without the question's id, two questions on one page of one idea look like one, and a replayed answer looks like a new question.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_learning_events_schema.py`:

```python
def test_checkpoint_attempt_may_name_its_question():
    validate_event("checkpoint_attempt", {**VALID_PAYLOADS["checkpoint_attempt"], "questionId": 2})
    with pytest.raises(ValidationError):
        validate_event("checkpoint_attempt", {**VALID_PAYLOADS["checkpoint_attempt"], "questionId": "two"})
```

Append to `backend/tests/unit/test_v4_telemetry.py`:

```python
def test_a_checkpoint_row_names_its_question_and_a_teach_back_does_not(monkeypatch):
    written = _fake_db(monkeypatch, slide=None)
    asyncio.run(tel.record_checkpoint(LEC, "u1", 9, "Joins", "choice", True, "s1", question_id=2))
    asyncio.run(tel.record_checkpoint(LEC, "u1", 4, "Joins", "teach", False, "s1"))
    (_, _, choice), (_, _, teach) = written
    assert choice["questionId"] == 2
    assert "questionId" not in teach
```

In `backend/tests/unit/test_v4_reader_telemetry_api.py`, in `test_a_checkpoint_answer_is_graded_and_recorded_here`, change the expected keywords to:

```python
    assert args[:2][1] == U and kw == {
        "page": 9, "idea": "Joins", "kind": "choice", "correct": True, "session_id": "s1", "question_id": 1,
    }
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_learning_events_schema.py backend/tests/unit/test_v4_telemetry.py backend/tests/unit/test_v4_reader_telemetry_api.py -q -p no:cacheprovider`
Expected: FAIL — `questionId` is an extra field; `record_checkpoint() got an unexpected keyword argument 'question_id'`; the route sends no `question_id`.

- [ ] **Step 3: Implement**

In `backend/schemas/learning_events.py`, in `class CheckpointAttempt`, add after `correct: bool`:

```python
    #: The checkpoint question answered (its id within the checkpoint), so a
    #: replayed answer can be told from a new question. Absent on teach-back rows.
    questionId: int | None = None
```

In `backend/services/v4_telemetry.py`, replace `record_checkpoint` with:

```python
async def record_checkpoint(
    lecture_id: UUID,
    user_id: str,
    page: int,
    idea: str,
    kind: str,
    correct: bool,
    session_id: str,
    question_id: int | None = None,
) -> None:
    """One checkpoint question or teach-back, graded on the server. The
    question's id lets the engine count only the first try at each question."""
    await _write(lecture_id, user_id, page, "checkpoint_attempt", {
        "page": page, "idea": idea[:60], "kind": kind, "correct": correct,
        **({"questionId": question_id} if question_id is not None else {}),
        "sessionId": session_id, "timestamp": now_iso(), "source": SOURCE,
    })
```

In `backend/api/v1/v4_reader.py`, in `reader_checkpoint_answer`, add `question_id=body.question_id,` to the `telemetry.record_checkpoint(...)` call, after `session_id=…`. Leave `reader_teach_back` unchanged.

- [ ] **Step 4: Run the tests**

Run the Step 2 command again. Expected: PASS. Then the whole unit suite once: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit -q -p no:cacheprovider`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/schemas/learning_events.py backend/services/v4_telemetry.py backend/api/v1/v4_reader.py \
  backend/tests/unit/test_learning_events_schema.py backend/tests/unit/test_v4_telemetry.py backend/tests/unit/test_v4_reader_telemetry_api.py
git commit -m "feat(v4-reader): a checkpoint answer names its question, so replays count once"
```

---

### Task 3: A page Luna turns to is not the reader turning back

**Files:**
- Modify: `src/features/spaces/data/reading.ts`
- Modify: `src/features/spaces/screens/LessonFacesScreen.tsx`
- Test: `src/features/spaces/__tests__/reading.test.ts`

**Interfaces:**
- Produces: `useReadingProgress(lessonId, page, live, covered = false, steered?: { current: number | null })`. When `steered.current === page` at a page change, the page left is reported **without** `toPage` (the server records no way back), and `steered.current` is cleared on every page change.

Why: Luna's conductor moves the reader's page during a study session. Today each move to an earlier page is recorded as `slide_back_navigation`, which feeds Speed Bump and the help index and indirectly reveals Luna's plan.

- [ ] **Step 1: Write the failing test**

Append inside `describe('useReadingProgress', …)` in `src/features/spaces/__tests__/reading.test.ts`:

```ts
  it('a page Luna turns to is not the reader turning back', async () => {
    const steered = { current: null as number | null };
    const { rerender } = renderHook(({ page }) => useReadingProgress('lec-1', page, true, false, steered), {
      initialProps: { page: 5 },
    });
    await flush();
    at('10:00:20');
    steered.current = 2;
    rerender({ page: 2 });
    await flush();
    expect(recordMock).toHaveBeenLastCalledWith('lec-1', 5, 20, expect.any(String), undefined);
    expect(steered.current).toBeNull();
    at('10:00:30');
    rerender({ page: 1 });
    await flush();
    expect(recordMock).toHaveBeenLastCalledWith('lec-1', 2, 10, expect.any(String), 1);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/reading.test.ts`
Expected: FAIL — the first report carries `2` as the page now in view.

- [ ] **Step 3: Implement in the hook**

In `src/features/spaces/data/reading.ts`:

Change the signature to:

```ts
export function useReadingProgress(
  lessonId: string | undefined,
  page: number,
  live: boolean,
  covered = false,
  steered?: { current: number | null },
): void {
```

Add one sentence to the doc comment above it: `A page a guide turned to (\`steered\`: Luna) is reported without the page now in view, so it is never counted as the reader turning back.`

Replace the page-change effect with:

```ts
  /* The page changed: report the one left, start the next. */
  useEffect(() => {
    pageRef.current = page;
    /* A page a guide (Luna) turned to is not the reader turning back. */
    const guided = steered?.current === page;
    if (steered) steered.current = null;
    if (!live || !lessonId || page < 1) return;
    const now = Date.now();
    const left = clock.current;
    if (left && left.page !== page) {
      send(repo.current, lessonId, left.page, seconds(left, now), session.current, guided ? undefined : page);
    }
    if (!left || left.page !== page) clock.current = { page, at: now, paused: 0, pausedAt: isPaused() ? now : null };
  }, [lessonId, page, live, steered]);
```

(`steered` is a ref object with a stable identity; listing it satisfies `react-hooks/exhaustive-deps` without extra runs.)

- [ ] **Step 4: Mark Luna's turns in the screen**

In `src/features/spaces/screens/LessonFacesScreen.tsx`, immediately before the line `const conductor = useLunaConductor({ … goToPage, setSpot, navigate });`, add:

```tsx
  /* The page Luna last turned to, so the reading count never takes her move for the reader turning back. */
  const lunaSteered = useRef<number | null>(null);
  const lunaGoToPage = useCallback(
    (p: number) => {
      lunaSteered.current = p;
      goToPage(p);
    },
    [goToPage],
  );
```

Change that conductor call to pass `goToPage: lunaGoToPage` instead of `goToPage`, and add `lunaSteered` as the fifth argument of the `useReadingProgress(...)` call (after the `covered` expression). Both `useRef` and `useCallback` are already imported in this file; check, and add them to the `react` import if not.

- [ ] **Step 5: Run the tests and the type-check**

Run:
```bash
npx vitest run src/features/spaces/__tests__/reading.test.ts src/features/spaces/components/__tests__/readerCovered.test.tsx --no-file-parallelism
npx tsc -p tsconfig.app.json --noEmit
npx eslint src/features/spaces/data/reading.ts src/features/spaces/screens/LessonFacesScreen.tsx
```
Expected: PASS; tsc exit 0; eslint 0 errors and no new warnings.

- [ ] **Step 6: Commit**

```bash
git add src/features/spaces/data/reading.ts src/features/spaces/screens/LessonFacesScreen.tsx src/features/spaces/__tests__/reading.test.ts
git commit -m "feat(v4-reader): a page Luna turns to is not the reader turning back"
```

---

### Task 4: A phone tab sent to the background reports its page

**Files:**
- Modify: `src/features/spaces/data/reading.ts`
- Test: `src/features/spaces/__tests__/reading.test.ts`

**Interfaces:**
- Produces: when the document becomes hidden, the open page is reported at once as a beacon (`recordReadingBeacon(lessonId, page, seconds, session)`, only if ≥ 1 s) and its clock restarts, paused, from that moment; `pagehide` reports only what was read since (≥ 1 s). Task 7 adds a session's reports for one page together, so a sitting split by a hide stays one sitting.

Why: mobile browsers (iOS Safari especially) often kill a background tab without firing `pagehide`, so the last page was lost.

- [ ] **Step 1: Change the tests**

In `src/features/spaces/__tests__/reading.test.ts`, replace the whole test `it('time the tab is hidden is not counted', …)` with these two:

```ts
  it('a tab sent to the background reports its page at once, and counts on from its return', async () => {
    const { rerender } = renderHook(({ page }) => useReadingProgress('lec-1', page, true), { initialProps: { page: 1 } });
    await flush();
    at('10:00:05');
    visibility = 'hidden';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(beaconMock).toHaveBeenCalledWith('lec-1', 1, 5, expect.any(String));
    at('10:05:05');
    visibility = 'visible';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    at('10:05:15');
    rerender({ page: 2 });
    await flush();
    expect(recordMock).toHaveBeenLastCalledWith('lec-1', 1, 10, expect.any(String), 2);
  });

  it('a tab closed after it was hidden is reported once', async () => {
    renderHook(() => useReadingProgress('lec-1', 3, true));
    await flush();
    at('10:00:30');
    visibility = 'hidden';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    at('10:00:31');
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(beaconMock).toHaveBeenCalledTimes(1);
    expect(beaconMock).toHaveBeenCalledWith('lec-1', 3, 30, expect.any(String));
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/spaces/__tests__/reading.test.ts`
Expected: FAIL — no beacon on hide.

- [ ] **Step 3: Implement**

In `src/features/spaces/data/reading.ts`, inside the session effect, replace `const onVisibility = () => syncPause();` and the `onPageHide` handler with:

```ts
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') {
        syncPause();
        return;
      }
      /*
       * A phone may never fire `pagehide` for a tab it closes in the
       * background: report the page now, and count on from the return.
       */
      const c = clock.current;
      if (!c) return;
      const now = Date.now();
      const secs = seconds(c, now);
      if (secs >= 1 && repo.current) repo.current.recordReadingBeacon(lessonId, c.page, secs, id);
      clock.current = { page: c.page, at: now, paused: 0, pausedAt: now };
    };
    const onPageHide = () => {
      const c = clock.current;
      if (!c) return;
      const secs = seconds(c, Date.now());
      clock.current = null;
      if (secs >= 1 && repo.current) repo.current.recordReadingBeacon(lessonId, c.page, secs, id);
    };
```

Update the hook's doc comment: replace `or in a hidden tab, is not counted.` with `or in a hidden tab, is not counted; a tab being hidden reports its page at once, since a phone may close it without warning.`

- [ ] **Step 4: Run the reader's suites**

Run:
```bash
npx vitest run src/features/spaces/__tests__/reading.test.ts src/features/spaces/__tests__/telemetry-live.test.ts --no-file-parallelism
npx tsc -p tsconfig.app.json --noEmit
```
Expected: PASS (every earlier test in `reading.test.ts`, including "closing the tab reports the open page as a beacon, once", still passes); tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/spaces/data/reading.ts src/features/spaces/__tests__/reading.test.ts
git commit -m "feat(v4-reader): a phone tab sent to the background reports its page"
```

---

### Task 5: Only the person who runs a Space may open its view

**Files:**
- Modify: `backend/domain/authorization.py`
- Create: `backend/services/v4_landing_service.py`
- Test: `backend/tests/unit/test_authorization.py`, `backend/tests/unit/test_v4_landing_api.py` (created here, extended in Task 12)

**Interfaces:**
- Produces:
  - `assert_space_owner(space: dict | None, user_id: str) -> None` in `backend.domain.authorization` — returns for the owner; 403 for a member; 404 otherwise.
  - `async space_row(space_id: UUID, user_id: str) -> dict | None` in `backend.services.v4_landing_service` — `{"id", "title", "professor_id", "is_member"}`, or `None` for the caller's personal Space or a missing Space.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_authorization.py`:

```python
from backend.domain.authorization import assert_space_owner

OWNER = "11111111-1111-1111-1111-111111111111"


def _code(space, uid):
    try:
        assert_space_owner(space, uid)
    except HTTPException as exc:
        return exc.status_code
    return 200


def test_only_the_owner_opens_a_space_view_a_member_is_told_and_others_learn_nothing():
    space = {"id": "s", "title": "DBS", "professor_id": OWNER, "is_member": False}
    assert _code(space, OWNER) == 200
    assert _code({**space, "is_member": True}, "someone-else") == 403
    assert _code(space, "someone-else") == 404
    assert _code(None, OWNER) == 404
```

(If `HTTPException` is not yet imported in this file, add `from fastapi import HTTPException` at the top.)

Create `backend/tests/unit/test_v4_landing_api.py`:

```python
"""The owner's view of a Space: who may open it, and what it says."""
from __future__ import annotations

import asyncio
import uuid

import backend.services.v4_landing_service as service

OWNER = "11111111-1111-1111-1111-111111111111"
SPACE = uuid.UUID("33333333-3333-3333-3333-333333333333")


def test_the_personal_space_has_no_owners_view_and_reads_nothing(monkeypatch):
    async def boom():
        raise AssertionError("no database read for the personal Space")

    monkeypatch.setattr(service, "get_db_connection", boom)
    assert asyncio.run(service.space_row(uuid.UUID(OWNER), OWNER)) is None


def test_a_space_row_says_who_owns_it_and_whether_the_caller_belongs(monkeypatch):
    seen = {}

    class Conn:
        async def fetchrow(self, sql, *args):
            seen["args"] = args
            return {"id": SPACE, "title": "DBS", "professor_id": uuid.UUID(OWNER), "is_member": True}

    class Ctx:
        async def __aenter__(self):
            return Conn()

        async def __aexit__(self, *exc):
            return False

    async def connect():
        return Ctx()

    monkeypatch.setattr(service, "get_db_connection", connect)
    row = asyncio.run(service.space_row(SPACE, "u2"))
    assert row == {"id": SPACE, "title": "DBS", "professor_id": uuid.UUID(OWNER), "is_member": True}
    assert seen["args"] == (SPACE, "u2")
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_authorization.py backend/tests/unit/test_v4_landing_api.py -q -p no:cacheprovider`
Expected: FAIL — `cannot import name 'assert_space_owner'`; no module `v4_landing_service`.

- [ ] **Step 3: Implement the guard**

Append to `backend/domain/authorization.py`:

```python
def assert_space_owner(space: dict | None, user_id: str) -> None:
    """Only the person who runs a Space may open its owner's views (spec §0).

    ``space`` is ``v4_landing_service.space_row`` — ``None`` when the Space
    does not exist or is the caller's personal Space (which has no owner's
    view). A member is told the door is not theirs (403); anyone else learns
    nothing (404), as everywhere in v4.
    """
    if space is not None and str(space.get("professor_id")) == str(user_id):
        return
    if space is not None and space.get("is_member"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the people who run this Space can open this.",
        )
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found.")
```

- [ ] **Step 4: Implement the row loader**

Create `backend/services/v4_landing_service.py`:

```python
"""How it's landing — the owner's view of a Space, computed on the server.

Who may open it is decided first (`assert_space_owner`); then the Space's
activity is read once, folded into facts, run through the insight engine,
floored and translated into the `Landing` shape. Nothing in the payload
names a member or quotes one (spec §0).
"""
from __future__ import annotations

from typing import Any, Optional
from uuid import UUID

from backend.core.database import get_db_connection
from backend.services.v4_personal import is_personal

_SPACE_SQL = """
SELECT c.id, c.title, c.professor_id,
       EXISTS (SELECT 1 FROM course_enrollments e
               WHERE e.course_id = c.id AND e.user_id = $2::uuid) AS is_member
FROM courses c
WHERE c.id = $1
"""


async def space_row(space_id: UUID, user_id: str) -> Optional[dict[str, Any]]:
    """The Space's owner and whether the caller belongs to it; None for the
    caller's personal Space (no owner's view) or a Space that does not exist."""
    if is_personal(space_id, user_id):
        return None
    async with await get_db_connection() as conn:
        row = await conn.fetchrow(_SPACE_SQL, space_id, user_id)
    return dict(row) if row else None
```

- [ ] **Step 5: Run the tests**

Run the Step 2 command again. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/domain/authorization.py backend/services/v4_landing_service.py \
  backend/tests/unit/test_authorization.py backend/tests/unit/test_v4_landing_api.py
git commit -m "feat(landing): only the person who runs a Space may open its view"
```

---

### Task 6: One read of a Space's activity, members only

**Files:**
- Create: `backend/services/insights/sources/__init__.py`, `backend/services/insights/sources/space.py`
- Test: `backend/tests/db/test_landing_space_source.py`

**Interfaces:**
- Consumes: `throwaway_db` (Task 1).
- Produces (in `backend.services.insights.sources.space`):
  - `WINDOW_DAYS = 56`, `EVENT_TYPES` (tuple of 6 event types)
  - `@dataclass(frozen=True) LessonRow(id: str, title: str, order: int, pages: int)`
  - `@dataclass(frozen=True) Event(user_id: str, type: str, data: dict, at: datetime)`
  - `@dataclass(frozen=True) SpaceData(space_id: str, name: str, owner_id: str, members: frozenset[str], lessons: tuple[LessonRow, ...], events: tuple[Event, ...], slide_pages: dict[str, int], question_pages: dict[str, int], now: datetime)`
  - `async load_space_data(space_id: UUID, name: str, owner_id: str, *, now: datetime | None = None) -> SpaceData` — events sorted oldest first.

- [ ] **Step 1: Write the failing DB test**

Create `backend/tests/db/test_landing_space_source.py`:

```python
"""A Space's activity, read once: its Lessons, its members (never the owner), their last eight weeks."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.db
asyncpg = pytest.importorskip("asyncpg")


def _event(db_conn, user_id, event_type, data):
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.learning_events (user_id, event_type, event_data) VALUES (%s, %s, %s::jsonb)",
            (str(user_id), event_type, json.dumps(data)),
        )


async def test_a_space_reads_its_members_on_its_lessons_and_nothing_else(
    throwaway_db, db_conn, make_user, make_course, make_lecture, make_slide, make_course_enrollment,
):
    from backend.services.insights.sources.space import load_space_data

    tag = uuid.uuid4().hex[:6]
    owner = make_user(email=f"owner-{tag}@gmail.com")
    member = make_user(email=f"member-{tag}@gmail.com")
    outsider = make_user(email=f"outsider-{tag}@gmail.com")
    space = make_course(owner, title=f"DBS {tag}")
    other_space = make_course(owner, title=f"Other {tag}")
    first = make_lecture(owner, title="Normalization")
    second = make_lecture(owner, title="Joins")
    archived = make_lecture(owner, title="Old")
    elsewhere = make_lecture(owner, title="Elsewhere")
    with db_conn.cursor() as cur:
        cur.execute("UPDATE lectures SET course_id = %s, total_slides = 12 WHERE id IN (%s, %s, %s)",
                    (str(space), str(first), str(second), str(archived)))
        cur.execute("UPDATE lectures SET is_archived = true WHERE id = %s", (str(archived),))
        cur.execute("UPDATE lectures SET course_id = %s WHERE id = %s", (str(other_space), str(elsewhere)))
    slide = make_slide(first, slide_number=3)
    make_course_enrollment(member, space)
    make_course_enrollment(owner, space)  # an owner who joined their own Space is still not a member
    make_course_enrollment(outsider, other_space)

    view = {"lectureId": str(first), "slideId": str(slide), "duration_seconds": 30, "sessionId": "s",
            "timestamp": "2026-10-29T00:00:00Z"}
    _event(db_conn, member, "slide_view", view)
    _event(db_conn, owner, "slide_view", view)
    _event(db_conn, outsider, "slide_view", view)
    _event(db_conn, member, "slide_view", {**view, "lectureId": str(elsewhere)})
    _event(db_conn, member, "lecture_complete", {"lectureId": str(first), "sessionId": "s", "completed_at": "x"})

    data = await load_space_data(space, "DBS", str(owner))

    assert data.members == frozenset({str(member)})
    assert [(l.title, l.order, l.pages) for l in data.lessons] == [("Normalization", 1, 12), ("Joins", 2, 12)]
    assert [(e.user_id, e.type, e.data["lectureId"]) for e in data.events] == [(str(member), "slide_view", str(first))]
    assert data.slide_pages[str(slide)] == 3

    later = await load_space_data(space, "DBS", str(owner), now=datetime.now(timezone.utc) + timedelta(days=60))
    assert later.events == ()
```

- [ ] **Step 2: Run it to see it fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest -m db backend/tests/db/test_landing_space_source.py -q -p no:cacheprovider`
Expected: FAIL — `ModuleNotFoundError: backend.services.insights.sources`.

- [ ] **Step 3: Implement**

Create `backend/services/insights/sources/__init__.py` containing only:

```python
"""Where the insight engine's numbers come from: the legacy per-lecture RLS bundle (`..bundle`) or a whole Space (`.space`)."""
```

Create `backend/services/insights/sources/space.py`:

```python
"""A Space's activity, read once on the server for the owner's view.

Everything the owner's view says is computed from what this returns: the
Space's Lessons, its members (the owner left out, whatever their rows say)
and those members' learning events on those Lessons over the last eight
weeks. Service-role SQL, never the owner's own session: the owner never
reads a member's rows, only the aggregates built from them (spec §0).
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from backend.core.database import get_db_connection

#: How far back the owner's view looks: its figures draw eight weeks.
WINDOW_DAYS = 56

#: The events the engine reads. Luna writes none of these; her checks stay hers.
EVENT_TYPES = (
    "slide_view",
    "slide_back_navigation",
    "confidence_rating",
    "ai_tutor_query",
    "quiz_attempt",
    "checkpoint_attempt",
)


@dataclass(frozen=True)
class LessonRow:
    id: str
    title: str
    #: 1-based, in the order the Lessons were added (as the Space lists them).
    order: int
    #: Pages in the Lesson's document; 0 when unknown.
    pages: int


@dataclass(frozen=True)
class Event:
    user_id: str
    type: str
    data: dict[str, Any]
    at: datetime


@dataclass(frozen=True)
class SpaceData:
    space_id: str
    name: str
    owner_id: str
    members: frozenset[str]
    lessons: tuple[LessonRow, ...]
    #: Oldest first.
    events: tuple[Event, ...]
    #: slides.id → page, for events that name a slide and no page (the old reader).
    slide_pages: dict[str, int]
    #: quiz_questions.id → the page its slide is on.
    question_pages: dict[str, int]
    now: datetime


_MEMBERS_SQL = """
SELECT e.user_id::text AS user_id
FROM course_enrollments e
JOIN courses c ON c.id = e.course_id
WHERE e.course_id = $1 AND e.user_id <> c.professor_id
"""

_LESSONS_SQL = """
SELECT l.id::text AS id, l.title, COALESCE(l.total_slides, 0) AS pages
FROM lectures l
WHERE l.course_id = $1
  AND NOT COALESCE(l.is_archived, false)
  AND COALESCE(l.visibility, 'course') = 'course'
ORDER BY l.created_at
"""

_SLIDES_SQL = "SELECT id::text AS id, slide_number FROM slides WHERE lecture_id = ANY($1::uuid[])"

_QUESTIONS_SQL = """
SELECT q.id::text AS id, s.slide_number
FROM quiz_questions q
JOIN slides s ON s.id = q.slide_id
WHERE s.lecture_id = ANY($1::uuid[])
"""

_EVENTS_SQL = """
SELECT user_id::text AS user_id, event_type, event_data, created_at
FROM learning_events
WHERE created_at >= $1
  AND created_at <= $2
  AND event_type = ANY($3::text[])
  AND user_id = ANY($4::uuid[])
  AND event_data->>'lectureId' = ANY($5::text[])
ORDER BY created_at
"""


def _json(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    return value if isinstance(value, dict) else {}


async def load_space_data(
    space_id: UUID, name: str, owner_id: str, *, now: Optional[datetime] = None
) -> SpaceData:
    """Read the Space once. ``now`` fixes the window's end (tests move it)."""
    now = now or datetime.now(timezone.utc)
    slide_pages: dict[str, int] = {}
    question_pages: dict[str, int] = {}
    events: tuple[Event, ...] = ()
    async with await get_db_connection() as conn:
        members = frozenset(r["user_id"] for r in await conn.fetch(_MEMBERS_SQL, space_id)) - {owner_id}
        lessons = tuple(
            LessonRow(id=r["id"], title=r["title"] or "", order=i + 1, pages=int(r["pages"] or 0))
            for i, r in enumerate(await conn.fetch(_LESSONS_SQL, space_id))
        )
        ids = [lesson.id for lesson in lessons]
        if ids:
            slide_pages = {
                r["id"]: int(r["slide_number"])
                for r in await conn.fetch(_SLIDES_SQL, ids)
                if r["slide_number"] is not None
            }
            question_pages = {
                r["id"]: int(r["slide_number"])
                for r in await conn.fetch(_QUESTIONS_SQL, ids)
                if r["slide_number"] is not None
            }
        if ids and members:
            rows = await conn.fetch(
                _EVENTS_SQL, now - timedelta(days=WINDOW_DAYS), now, list(EVENT_TYPES), list(members), ids
            )
            events = tuple(
                Event(user_id=r["user_id"], type=r["event_type"], data=_json(r["event_data"]), at=r["created_at"])
                for r in rows
            )
    return SpaceData(
        space_id=str(space_id),
        name=name,
        owner_id=owner_id,
        members=members,
        lessons=lessons,
        events=events,
        slide_pages=slide_pages,
        question_pages=question_pages,
        now=now,
    )
```

- [ ] **Step 4: Run the test**

Run the Step 2 command again. Expected: PASS. (Report plainly if no Postgres could be reached.)

- [ ] **Step 5: Commit**

```bash
git add backend/services/insights/sources backend/tests/db/test_landing_space_source.py
git commit -m "feat(landing): one service-role read of a Space's activity, members only"
```

---

### Task 7: Which events count, decided once

**Files:**
- Create: `backend/services/insights/space_facts.py`
- Test: `backend/tests/unit/test_landing_space_facts.py`

**Interfaces:**
- Consumes: `Event`, `LessonRow`, `SpaceData` (Task 6).
- Produces (in `backend.services.insights.space_facts`):
  - `DWELL_CEIL = 1800.0`, `SHORT_VIEW = 4.0`
  - `@dataclass(frozen=True) Try(user_id: str, lesson_id: str, page: int, idea: str | None, correct: bool, at: datetime, source: str)` — `source` is `"practice"` or `"checkpoint"`
  - `@dataclass PageFacts(readers: set, sittings: list[float], explain: set, ask: set, ask_texts: list[str], ratings: dict[str, str], returners: set, from_next: int, tries: list[Try], pairs: dict[str, tuple[str, bool]])` with property `helped -> set[str]`
  - `@dataclass LessonFacts(lesson: LessonRow, readers: set, pages: dict[int, PageFacts])` with method `page(n) -> PageFacts`
  - `page_of(event, data, page_key="page", slide_key="slideId") -> int | None`
  - `first_tries(data) -> list[Try]`
  - `lesson_facts(data) -> dict[str, LessonFacts]` — one entry per Lesson in `data.lessons`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_landing_space_facts.py`:

```python
"""Which events count, decided once: sittings, the latest check-in, the first try, the old reader's slides."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from backend.services.insights.sources.space import Event, LessonRow, SpaceData
from backend.services.insights.space_facts import first_tries, lesson_facts

T0 = datetime(2026, 10, 20, 10, 0, tzinfo=timezone.utc)
L1 = "lesson-1"


def ev(user, kind, minute=0, **data):
    return Event(user_id=user, type=kind, data={"lectureId": L1, **data}, at=T0 + timedelta(minutes=minute))


def space(*events, slide_pages=None, question_pages=None):
    return SpaceData(
        space_id="space", name="DBS", owner_id="owner", members=frozenset({"a", "b", "c"}),
        lessons=(LessonRow(id=L1, title="Normalization", order=1, pages=12),),
        events=tuple(events), slide_pages=slide_pages or {}, question_pages=question_pages or {},
        now=T0 + timedelta(days=1),
    )


def test_a_sitting_is_one_persons_session_on_one_page_and_a_tab_left_open_is_not_reading():
    facts = lesson_facts(space(
        ev("a", "slide_view", 0, page=3, duration_seconds=20, sessionId="s1"),
        ev("a", "slide_view", 5, page=3, duration_seconds=15, sessionId="s1"),
        ev("a", "slide_view", 9, page=3, duration_seconds=30, sessionId="s2"),
        ev("b", "slide_view", 1, page=3, duration_seconds=2000, sessionId="s3"),
    ))[L1]
    page = facts.pages[3]
    assert sorted(page.sittings) == [30.0, 35.0]
    assert page.readers == {"a", "b"} and facts.readers == {"a", "b"}


def test_the_latest_check_in_counts_and_the_old_reader_is_placed_by_its_slide():
    facts = lesson_facts(space(
        ev("a", "confidence_rating", 0, page=9, idea="Joins", rating="confused"),
        ev("a", "confidence_rating", 4, page=9, idea="Joins", rating="got_it"),
        ev("b", "confidence_rating", 1, slideId="slide-9", rating="unsure"),
        slide_pages={"slide-9": 9},
    ))[L1]
    assert facts.pages[9].ratings == {"a": "got_it", "b": "unsure"}


def test_help_is_explain_or_ask_and_only_asked_questions_are_kept_for_themes():
    facts = lesson_facts(space(
        ev("a", "ai_tutor_query", 0, page=12, kind="explain", query=""),
        ev("b", "ai_tutor_query", 1, page=12, kind="ask", query="Why BCNF?"),
        ev("c", "ai_tutor_query", 2, slideId="slide-12", query="Old reader question"),
        slide_pages={"slide-12": 12},
    ))[L1]
    page = facts.pages[12]
    assert page.explain == {"a"} and page.ask == {"b", "c"}
    assert page.ask_texts == ["Why BCNF?", "Old reader question"]


def test_turning_back_lands_on_the_page_turned_to():
    facts = lesson_facts(space(
        ev("a", "slide_back_navigation", 0, fromPage=8, toPage=7),
        ev("b", "slide_back_navigation", 1, fromPage=12, toPage=7),
    ))[L1]
    assert facts.pages[7].returners == {"a", "b"} and facts.pages[7].from_next == 1


def test_only_the_first_try_at_a_question_counts_and_the_teach_back_is_not_a_try():
    data = space(
        ev("a", "checkpoint_attempt", 0, page=9, idea="Joins", kind="choice", questionId=1, correct=False),
        ev("a", "checkpoint_attempt", 3, page=9, idea="Joins", kind="choice", questionId=1, correct=True),
        ev("a", "checkpoint_attempt", 4, page=9, idea="Joins", kind="choice", questionId=2, correct=True),
        ev("a", "checkpoint_attempt", 5, page=4, idea="Joins", kind="teach", correct=True),
        ev("b", "quiz_attempt", 6, questionId="q1", correct=True),
        ev("b", "quiz_attempt", 7, questionId="q1", correct=False),
        question_pages={"q1": 5},
    )
    tries = sorted((t.user_id, t.page, t.source, t.correct) for t in first_tries(data))
    assert tries == [("a", 9, "checkpoint", False), ("a", 9, "checkpoint", True), ("b", 5, "practice", True)]
    assert len(lesson_facts(data)[L1].pages[9].tries) == 2


def test_a_check_in_is_paired_with_that_ideas_checkpoint_on_the_check_ins_page():
    facts = lesson_facts(space(
        ev("a", "confidence_rating", 0, page=4, idea="Joins", rating="got_it"),
        ev("a", "checkpoint_attempt", 1, page=9, idea="Joins", kind="choice", questionId=1, correct=False),
        ev("b", "confidence_rating", 0, page=4, idea="Joins", rating="confused"),
        ev("b", "checkpoint_attempt", 1, page=9, idea="Joins", kind="choice", questionId=1, correct=True),
        ev("c", "confidence_rating", 0, page=4, idea="Joins", rating="got_it"),
    ))[L1]
    assert facts.pages[4].pairs == {"a": ("got_it", False), "b": ("confused", True)}


def test_helped_is_anyone_who_explained_asked_was_foggy_or_came_back():
    facts = lesson_facts(space(
        ev("a", "ai_tutor_query", 0, page=2, kind="explain", query=""),
        ev("b", "confidence_rating", 0, page=2, rating="confused"),
        ev("c", "slide_back_navigation", 0, fromPage=5, toPage=2),
    ))[L1]
    assert facts.pages[2].helped == {"a", "b", "c"}
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_landing_space_facts.py -q -p no:cacheprovider`
Expected: FAIL — `ModuleNotFoundError: backend.services.insights.space_facts`.

- [ ] **Step 3: Implement**

Create `backend/services/insights/space_facts.py`:

```python
"""What happened on each page of a Space, person by person, folded into facts.

Pure: takes the `SpaceData` the source read and returns, per Lesson and per
page, sets of people and lists of numbers. Every rule about *which* event
counts lives here, once:

- a sitting is one person's time on one page in one reading session, the
  session's reports added up (a phone tab reports when hidden, and again when
  left); a sitting over 30 minutes is a tab left open, not reading;
- a person's latest check-in on a page, or on an idea, is the one that counts;
- only the first try at a question counts — a practice question or one
  checkpoint question; replays and retries do not; the teach-back is not a try;
- the old reader names slides, not pages: its events are placed by slide.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

from backend.services.insights.sources.space import Event, LessonRow, SpaceData

#: A sitting longer than this (30 min) is a tab left open, not reading (as `bundle._DWELL_OUTLIER_CEIL`).
DWELL_CEIL = 1800.0
#: A sitting shorter than this is a glance (the engine's "short view").
SHORT_VIEW = 4.0

_RATINGS = ("got_it", "unsure", "confused")


@dataclass(frozen=True)
class Try:
    user_id: str
    lesson_id: str
    page: int
    #: The checkpoint's idea; None for a practice question.
    idea: Optional[str]
    correct: bool
    at: datetime
    #: "practice" or "checkpoint".
    source: str


@dataclass
class PageFacts:
    readers: set[str] = field(default_factory=set)
    #: Seconds per sitting (one person, one session), each ≤ DWELL_CEIL.
    sittings: list[float] = field(default_factory=list)
    explain: set[str] = field(default_factory=set)
    ask: set[str] = field(default_factory=set)
    #: What was asked here, oldest first: for themes only, never sent to anyone.
    ask_texts: list[str] = field(default_factory=list)
    #: Each person's latest check-in on this page.
    ratings: dict[str, str] = field(default_factory=dict)
    returners: set[str] = field(default_factory=set)
    #: Turns back to this page from the page right after it.
    from_next: int = 0
    tries: list[Try] = field(default_factory=list)
    #: Per person: (latest check-in on an idea anchored here, cleared every first try at its checkpoint).
    pairs: dict[str, tuple[str, bool]] = field(default_factory=dict)

    @property
    def helped(self) -> set[str]:
        """People who needed this page: opened Explain, asked, said foggy, or came back to it."""
        foggy = {u for u, r in self.ratings.items() if r in ("unsure", "confused")}
        return self.explain | self.ask | foggy | self.returners


@dataclass
class LessonFacts:
    lesson: LessonRow
    readers: set[str] = field(default_factory=set)
    pages: dict[int, PageFacts] = field(default_factory=dict)

    def page(self, n: int) -> PageFacts:
        return self.pages.setdefault(n, PageFacts())


def _page(value: Any) -> Optional[int]:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 1 else None


def page_of(event: Event, data: SpaceData, page_key: str = "page", slide_key: str = "slideId") -> Optional[int]:
    """The page an event is about: its own page, else the page of the slide it names."""
    d = event.data
    return _page(d.get(page_key)) or data.slide_pages.get(str(d.get(slide_key) or ""))


def first_tries(data: SpaceData) -> list[Try]:
    """The first try at every question, per person: practice questions and checkpoint questions."""
    seen: dict[tuple, Try] = {}
    for e in sorted(data.events, key=lambda e: e.at):
        d = e.data
        lesson = str(d.get("lectureId") or "")
        if e.type == "quiz_attempt":
            qid = str(d.get("questionId") or "")
            page = data.question_pages.get(qid) or page_of(e, data)
            key: tuple = (e.user_id, lesson, "q", qid)
            idea, source = None, "practice"
        elif e.type == "checkpoint_attempt" and d.get("kind") != "teach":
            page = _page(d.get("page"))
            idea = str(d.get("idea") or "")
            question = d.get("questionId") if d.get("questionId") is not None else f"{page}:{d.get('kind')}"
            key = (e.user_id, lesson, "c", idea, str(question))
            source = "checkpoint"
        else:
            continue
        if page is None or not lesson or key in seen:
            continue
        seen[key] = Try(e.user_id, lesson, page, idea, d.get("correct") is True, e.at, source)
    return list(seen.values())


def lesson_facts(data: SpaceData) -> dict[str, LessonFacts]:
    """Per Lesson, per page: who read it, for how long, who needed it, who tried what."""
    facts = {lesson.id: LessonFacts(lesson) for lesson in data.lessons}
    sittings: dict[tuple[str, str, str, int], float] = defaultdict(float)
    idea_ratings: dict[tuple[str, str, str], tuple[str, int]] = {}

    for e in sorted(data.events, key=lambda e: e.at):
        lf = facts.get(str(e.data.get("lectureId") or ""))
        if lf is None:
            continue
        d = e.data
        if e.type == "slide_view":
            page = page_of(e, data)
            secs = d.get("duration_seconds")
            if page is None or isinstance(secs, bool) or not isinstance(secs, (int, float)) or secs <= 0:
                continue
            lf.readers.add(e.user_id)
            lf.page(page).readers.add(e.user_id)
            sittings[(lf.lesson.id, e.user_id, str(d.get("sessionId") or ""), page)] += float(secs)
        elif e.type == "ai_tutor_query":
            page = page_of(e, data)
            if page is None:
                continue
            pf = lf.page(page)
            if d.get("kind") == "explain":
                pf.explain.add(e.user_id)
            else:
                pf.ask.add(e.user_id)
                text = str(d.get("query") or "").strip()
                if text:
                    pf.ask_texts.append(text)
        elif e.type == "confidence_rating":
            page = page_of(e, data)
            rating = d.get("rating")
            if page is None or rating not in _RATINGS:
                continue
            lf.page(page).ratings[e.user_id] = rating
            if d.get("idea"):
                idea_ratings[(lf.lesson.id, e.user_id, str(d["idea"]))] = (rating, page)
        elif e.type == "slide_back_navigation":
            to = page_of(e, data, "toPage", "toSlideId")
            if to is None:
                continue
            pf = lf.page(to)
            pf.returners.add(e.user_id)
            if page_of(e, data, "fromPage", "fromSlideId") == to + 1:
                pf.from_next += 1

    for (lesson_id, _user, _session, page), secs in sittings.items():
        if secs <= DWELL_CEIL:
            facts[lesson_id].page(page).sittings.append(secs)

    tries = first_tries(data)
    cleared: dict[tuple[str, str, str], list[bool]] = defaultdict(list)
    for t in tries:
        if t.lesson_id in facts:
            facts[t.lesson_id].page(t.page).tries.append(t)
        if t.source == "checkpoint":
            cleared[(t.lesson_id, t.user_id, t.idea or "")].append(t.correct)
    for (lesson_id, user, idea), (rating, page) in idea_ratings.items():
        results = cleared.get((lesson_id, user, idea))
        if results:
            facts[lesson_id].page(page).pairs[user] = (rating, all(results))
    return facts
```

- [ ] **Step 4: Run the tests**

Run the Step 2 command again. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/insights/space_facts.py backend/tests/unit/test_landing_space_facts.py
git commit -m "feat(landing): which events count, decided once, per page of a Space"
```

---

### Task 8: The detectors run on a Space, above the floor

**Files:**
- Create: `backend/services/insights/space_engine.py`
- Test: `backend/tests/unit/test_landing_space_engine.py`

**Interfaces:**
- Consumes: `LessonFacts`, `PageFacts`, `SHORT_VIEW` (Task 7); `detectors.DETECTORS`, `bundle._safe_median/_safe_quartiles/_safe_cv` (existing).
- Produces (in `backend.services.insights.space_engine`):
  - `MIN_READERS = 5`
  - `page_row(lesson_id: str, page: int, f: PageFacts) -> dict` — one bundle row with every key the detectors read
  - `lesson_bundle(lf: LessonFacts) -> dict` — `{lecture_id, total_students, lecture_avg_dwell, lecture_median_dwell, slides, students: []}`
  - `pages_of(insight: dict) -> list[int]` — the pages an engine finding is about
  - `lesson_insights(lf: LessonFacts) -> list[dict]` — engine insight dicts (unchanged shape), floored; never `silent_strugglers`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_landing_space_engine.py`:

```python
"""The engine's detectors, untouched, run on a Space's facts — and say nothing under the floor."""
from __future__ import annotations

from backend.services.insights.sources.space import LessonRow
from backend.services.insights.space_engine import MIN_READERS, lesson_bundle, lesson_insights, page_row, pages_of
from backend.services.insights.space_facts import LessonFacts, PageFacts

LESSON = LessonRow(id="l1", title="Normalization", order=1, pages=6)


def readers(n, prefix="r"):
    return {f"{prefix}{i}" for i in range(n)}


def calm_page(people):
    return PageFacts(readers=set(people), sittings=[40.0] * len(people), ratings={p: "got_it" for p in people})


def lesson(pages):
    lf = LessonFacts(LESSON)
    for n, pf in pages.items():
        lf.pages[n] = pf
        lf.readers |= pf.readers
    return lf


def test_a_page_row_carries_what_the_detectors_read():
    people = readers(10)
    pf = PageFacts(
        readers=set(people), sittings=[3.0, 40.0, 50.0], explain={"r0"}, ask={"r1", "r2"},
        ratings={"r0": "confused", "r1": "got_it"}, returners={"r3"}, from_next=1,
        pairs={"r1": ("got_it", False), "r4": ("got_it", True)},
    )
    row = page_row("l1", 3, pf)
    assert row["slide_number"] == 3 and row["view_count"] == 10 and row["short_views"] == 1
    assert row["confusion_rate"] == 50.0 and row["ratings_total"] == 2
    assert row["ai_query_count"] == 3 and row["back_nav_count"] == 1 and row["back_nav_from_next"] == 1
    assert (row["got_it_quiz_total"], row["overconfident_count"], row["overconfidence_rate"]) == (2, 1, 50.0)
    assert row["quiz_success_rate"] is None and row["quiz_attempts"] == 0


def test_a_page_where_many_ask_and_say_foggy_is_a_hotspot():
    people = readers(10)
    hot = PageFacts(
        readers=set(people), sittings=[40.0] * 10, ask=set(sorted(people)[:7]),
        ratings={p: ("confused" if i < 8 else "got_it") for i, p in enumerate(sorted(people))},
    )
    lf = lesson({1: calm_page(people), 2: calm_page(people), 3: hot, 4: calm_page(people)})
    found = lesson_insights(lf)
    assert any(i["kind"] == "confusion_hotspot" and pages_of(i) == [3] for i in found)
    assert lesson_bundle(lf)["total_students"] == 10


def test_nothing_is_said_about_a_page_fewer_than_five_people_read():
    people = readers(10)
    few = readers(MIN_READERS - 1, prefix="f")
    hot_but_few = PageFacts(readers=set(few), sittings=[40.0] * 4, ask=set(few), ratings={p: "confused" for p in few})
    lf = lesson({1: calm_page(people), 2: calm_page(people), 3: hot_but_few})
    assert not any(3 in pages_of(i) for i in lesson_insights(lf))


def test_a_lesson_fewer_than_five_people_read_says_nothing():
    few = readers(MIN_READERS - 1)
    hot = PageFacts(readers=set(few), sittings=[40.0] * 4, ask=set(few), ratings={p: "confused" for p in few})
    assert lesson_insights(lesson({1: hot})) == []


def test_people_never_enter_the_lesson_bundle():
    assert lesson_bundle(lesson({1: calm_page(readers(10))}))["students"] == []
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_landing_space_engine.py -q -p no:cacheprovider`
Expected: FAIL — `ModuleNotFoundError: backend.services.insights.space_engine`.

- [ ] **Step 3: Implement**

Create `backend/services/insights/space_engine.py`:

```python
"""The insight engine, run on a Space instead of one lecture's RLS view.

The detectors are untouched (spec §1.1): this builds the bundle shape
`bundle.build_metric_bundle` builds, from a Lesson's facts. A page is one
bundle row; its "views" are the people who read it. Then the floor: a
Lesson read by fewer than `MIN_READERS` people says nothing, and no finding
may be about a page fewer than `MIN_READERS` people read (spec B3). People
never enter the bundle: Strugglers is not run here.
"""
from __future__ import annotations

import logging
import statistics
from typing import Any

from backend.services.insights import detectors
from backend.services.insights.bundle import _safe_cv, _safe_median, _safe_quartiles
from backend.services.insights.space_facts import SHORT_VIEW, LessonFacts, PageFacts

logger = logging.getLogger(__name__)

#: People a page, and a Lesson, needs before anything is said about it.
MIN_READERS = 5


def page_row(lesson_id: str, page: int, f: PageFacts) -> dict[str, Any]:
    """One page as the detectors read a slide."""
    dwell = f.sittings
    p25, p75 = _safe_quartiles(dwell)
    counts = {r: sum(1 for v in f.ratings.values() if v == r) for r in ("got_it", "unsure", "confused")}
    rated = sum(counts.values())
    right = sum(1 for t in f.tries if t.correct)
    clicked = [cleared for rating, cleared in f.pairs.values() if rating == "got_it"]
    missed = sum(1 for cleared in clicked if not cleared)
    return {
        "slide_id": f"{lesson_id}:{page}",
        "slide_number": page,
        "title": str(page),
        "view_count": len(f.readers),
        "avg_dwell": round(statistics.fmean(dwell), 1) if dwell else 0.0,
        "median_dwell": round(_safe_median(dwell), 1),
        "dwell_p25": round(p25, 1),
        "dwell_p75": round(p75, 1),
        "dwell_cv": round(_safe_cv(dwell), 2),
        "short_views": sum(1 for d in dwell if d < SHORT_VIEW),
        "confusion_rate": round(counts["confused"] / rated * 100, 1) if rated else 0.0,
        "quiz_success_rate": round(right / len(f.tries) * 100, 1) if f.tries else None,
        "quiz_attempts": len(f.tries),
        "got_it": counts["got_it"],
        "unsure": counts["unsure"],
        "confused": counts["confused"],
        "ratings_total": rated,
        "ai_query_count": len(f.explain | f.ask),
        "back_nav_count": len(f.returners),
        "back_nav_from_next": f.from_next,
        "overconfident_count": missed,
        "got_it_quiz_total": len(clicked),
        "overconfidence_rate": round(missed / len(clicked) * 100, 1) if clicked else 0.0,
    }


def lesson_bundle(lf: LessonFacts) -> dict[str, Any]:
    """The bundle the detectors read, for one Lesson. Every page anyone read is a row."""
    rows = [page_row(lf.lesson.id, n, pf) for n, pf in sorted(lf.pages.items()) if pf.readers]
    avgs = [r["avg_dwell"] for r in rows if r["avg_dwell"] > 0]
    medians = [r["median_dwell"] for r in rows if r["median_dwell"] > 0]
    return {
        "lecture_id": lf.lesson.id,
        "total_students": len(lf.readers),
        "lecture_avg_dwell": round(statistics.fmean(avgs), 1) if avgs else 0.0,
        "lecture_median_dwell": round(_safe_median(medians), 1),
        "slides": rows,
        "students": [],
    }


def pages_of(insight: dict[str, Any]) -> list[int]:
    """The pages an engine finding is about."""
    metrics = insight.get("metrics") or {}
    if insight.get("kind") == "confusion_block":
        first, last = metrics.get("startSlide"), metrics.get("endSlide")
        return list(range(int(first), int(last) + 1)) if first and last else []
    n = (insight.get("targetRef") or {}).get("slideNumber") or metrics.get("slideNumber")
    return [int(n)] if n else []


def lesson_insights(lf: LessonFacts) -> list[dict[str, Any]]:
    """Every finding the detectors make on one Lesson, floored."""
    if len(lf.readers) < MIN_READERS:
        return []
    bundle = lesson_bundle(lf)
    found: list[dict[str, Any]] = []
    for detect in detectors.DETECTORS:
        if detect is detectors.detect_silent_strugglers:
            continue  # person-level: never in the owner's view (spec §0)
        try:
            found.extend(detect(bundle))
        except Exception:
            logger.exception("landing: detector failed: %s", getattr(detect, "__name__", detect))

    def above_floor(insight: dict[str, Any]) -> bool:
        pages = pages_of(insight)
        return bool(pages) and all(len(lf.pages.get(p, PageFacts()).readers) >= MIN_READERS for p in pages)

    return [i for i in found if above_floor(i)]
```

- [ ] **Step 4: Run the tests**

Run the Step 2 command again. Expected: PASS. If the hotspot test fails because a different detector claims page 3 first, print `[(i['kind'], pages_of(i)) for i in found]` and check `detectors.detect_confusion_hotspot` (`backend/services/insights/detectors.py:59`): adjust **only the test's numbers** (more askers, more confused) until the page is a clear hotspot, never the detector.

- [ ] **Step 5: Commit**

```bash
git add backend/services/insights/space_engine.py backend/tests/unit/test_landing_space_engine.py
git commit -m "feat(landing): the detectors run on a Space, and say nothing under the floor"
```

---

### Task 9: What the door is told

**Files:**
- Create: `backend/services/insights/landing_map.py`
- Test: `backend/tests/unit/test_landing_map.py`

**Interfaces:**
- Consumes: `MIN_READERS`, `pages_of` (Task 8); `LessonFacts`, `PageFacts` (Task 7).
- Produces (in `backend.services.insights.landing_map`):
  - `HELP_FULL = 0.5`
  - `help_share(f: PageFacts) -> float`
  - `help_index(facts: dict[str, LessonFacts]) -> dict[str, list[float]]` — per Lesson, one 0–1 value per page (length `max(lesson.pages, highest page seen)`)
  - `grid(f: PageFacts) -> dict | None` — `{clickedCleared, clickedMissed, foggyCleared, foggyMissed}` once `MIN_READERS` pairs exist
  - `to_landing(insight: dict, lf: LessonFacts) -> dict | None` — a `LandingInsight` (without `themes`, which the service sets)
  - `collapse_healthy(found: list[dict], lesson_id: str) -> list[dict]`
  - `lesson_light(found: list[dict], readers: int) -> str`
  - `rank(insights: list[dict], readers_by_lesson: dict[str, int]) -> list[dict]`

The metrics each kind sends are exactly the variables its copy in `src/i18n/locales/en/v4Landing.json` (`kind.*`) interpolates:

| kind | metrics | other fields |
|---|---|---|
| confusion_hotspot | `askers` (people who opened Explain or asked), `foggy` (% foggy) | `page` |
| silent_misleader | `clicked` (% said clicked), `missed` (% of those who then missed) | `page`, `grid` |
| skipped_slide | `seconds` (median) | `page` |
| speed_bump | `backs` | `page` |
| overpacked | `ratio` (page median ÷ Lesson median) | `page` |
| leaky_bucket | `pct` (stopped right after) | `page` |
| confusion_block | — | `first`, `last` |
| quiz_misalignment | `pct` (passed first try) | `page` |
| calibration_gap | `pct` (said clicked, still missed) | `page`, `grid` |
| healthy | — | Lesson only |

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_landing_map.py`:

```python
"""From engine findings to what the door is told: its numbers, its pages, its order, its light."""
from __future__ import annotations

from backend.services.insights.landing_map import (
    collapse_healthy, grid, help_index, help_share, lesson_light, rank, to_landing,
)
from backend.services.insights.sources.space import LessonRow
from backend.services.insights.space_facts import LessonFacts, PageFacts


def people(n, prefix="r"):
    return {f"{prefix}{i}" for i in range(n)}


def facts(pages, lesson_id="l1", count=6):
    lf = LessonFacts(LessonRow(id=lesson_id, title="Normalization", order=1, pages=count))
    for n, pf in pages.items():
        lf.pages[n] = pf
        lf.readers |= pf.readers
    return lf


def engine(kind, page=None, severity=0.8, attention="act", **metrics):
    return {
        "id": f"{kind}:x", "kind": kind, "severity": severity, "attention": attention,
        "targetRef": {"slideNumber": page} if page else {}, "metrics": {**metrics, **({"slideNumber": page} if page else {})},
    }


def test_a_hotspot_tells_how_many_people_asked_and_how_many_said_foggy():
    pf = PageFacts(readers=people(10), explain={"r0", "r1"}, ask={"r1", "r2", "r3"})
    out = to_landing(engine("confusion_hotspot", 3, confusionRate=61.4), facts({3: pf}))
    assert out == {
        "id": "l1:confusion_hotspot:x", "kind": "confusion_hotspot", "attention": "act", "severity": 0.8,
        "lessonId": "l1", "page": 3, "metrics": {"askers": 4, "foggy": 61},
    }


def test_a_trap_tells_clicked_then_missed_and_carries_its_grid():
    pairs = {f"r{i}": ("got_it", i >= 3) for i in range(5)} | {"r5": ("confused", True)}
    pf = PageFacts(readers=people(10), pairs=pairs)
    out = to_landing(engine("silent_misleader", 9, gotItPct=78.0, quizSuccessRate=40.0), facts({9: pf}))
    assert out["metrics"] == {"clicked": 78, "missed": 60}
    assert out["grid"] == {"clickedCleared": 2, "clickedMissed": 3, "foggyCleared": 1, "foggyMissed": 0}


def test_each_kind_sends_the_numbers_its_copy_reads():
    lf = facts({4: PageFacts(readers=people(10))})
    assert to_landing(engine("skipped_slide", 4, medianDwellSeconds=3.4), lf)["metrics"] == {"seconds": 3}
    assert to_landing(engine("speed_bump", 4, backtracksFromNext=7), lf)["metrics"] == {"backs": 7}
    assert to_landing(
        engine("overpacked", 4, medianDwellSeconds=90.0, lectureMedianDwellSeconds=40.0), lf
    )["metrics"] == {"ratio": 2.2}
    assert to_landing(engine("leaky_bucket", 4, attritionPct=31.6), lf)["metrics"] == {"pct": 32}
    assert to_landing(engine("quiz_misalignment", 4, quizSuccessRate=41.2), lf)["metrics"] == {"pct": 41}
    assert to_landing(engine("calibration_gap", 4, overconfidenceRate=55.5), lf)["metrics"] == {"pct": 56}


def test_a_stretch_is_told_by_its_first_and_last_page():
    lf = facts({n: PageFacts(readers=people(10)) for n in (2, 3, 4)})
    block = {"id": "confusion_block:2-4", "kind": "confusion_block", "severity": 0.5, "attention": "watch",
             "targetRef": {}, "metrics": {"startSlide": 2, "endSlide": 4, "avgConfusion": 40.0}}
    out = to_landing(block, lf)
    assert (out["first"], out["last"], "page" in out, out["metrics"]) == (2, 4, False, {})


def test_people_are_never_told():
    assert to_landing({"id": "silent_strugglers", "kind": "silent_strugglers", "severity": 0.9,
                       "attention": "act", "targetRef": {}, "metrics": {}}, facts({})) is None


def test_a_lesson_is_landing_once_and_only_when_nothing_in_it_wants_the_owner():
    calm = [{"id": "l1:healthy:a", "kind": "healthy", "attention": "calm", "severity": 0.12, "lessonId": "l1", "page": 2, "metrics": {}}]
    assert collapse_healthy(calm, "l1") == [
        {"id": "l1:healthy", "kind": "healthy", "attention": "calm", "severity": 0.12, "lessonId": "l1", "metrics": {}}
    ]
    loud = {"id": "l1:x", "kind": "speed_bump", "attention": "watch", "severity": 0.5, "lessonId": "l1", "page": 4, "metrics": {}}
    assert collapse_healthy(calm + [loud], "l1") == [loud]


def test_a_lessons_light_is_its_loudest_finding_or_few_under_the_floor():
    found = [{"attention": "watch"}, {"attention": "act"}]
    assert lesson_light(found, 10) == "act"
    assert lesson_light([], 10) == "calm"
    assert lesson_light(found, 4) == "few"


def test_findings_are_ranked_by_band_then_by_how_many_people_they_touch():
    a = {"lessonId": "small", "attention": "act", "severity": 0.7}
    b = {"lessonId": "big", "attention": "act", "severity": 0.68}
    c = {"lessonId": "big", "attention": "watch", "severity": 0.6}
    assert rank([c, a, b], {"small": 6, "big": 120}) == [b, a, c]


def test_help_is_the_share_of_readers_who_needed_the_page_never_brighter_than_half_of_them():
    quiet = PageFacts(readers=people(10), explain={"r0"})
    loud = PageFacts(readers=people(10), ask=people(4), returners={"r9"})
    few = PageFacts(readers=people(3), ask=people(3))
    lf = facts({1: quiet, 2: loud, 3: few}, count=4)
    assert help_share(quiet) == 0.1 and help_share(few) == 0.0
    assert help_index({"l1": lf}) == {"l1": [0.2, 1.0, 0.0, 0.0]}


def test_a_grid_needs_five_pairs():
    four = PageFacts(pairs={f"r{i}": ("got_it", True) for i in range(4)})
    assert grid(four) is None
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_landing_map.py -q -p no:cacheprovider`
Expected: FAIL — `ModuleNotFoundError: backend.services.insights.landing_map`.

- [ ] **Step 3: Implement**

Create `backend/services/insights/landing_map.py`:

```python
"""From engine findings to what the door is told (the `Landing` wire shape).

The engine speaks in its own metric names and in slides; the door's copy
(`v4Landing.json`) interpolates a few numbers per kind and says "page". This
is the one place that translates, and it adds no words: the backend sends
kinds and numbers only (spec B5). It never passes on a finding about people.
"""
from __future__ import annotations

from typing import Any, Optional

from backend.services.insights.space_engine import MIN_READERS, pages_of
from backend.services.insights.space_facts import LessonFacts, PageFacts

#: A page is fully lit when half its readers needed it (or it is the Space's most-needed page).
HELP_FULL = 0.5

_BAND = {"act": 2, "watch": 1, "calm": 0}

_KINDS = {
    "confusion_hotspot", "silent_misleader", "skipped_slide", "speed_bump", "overpacked",
    "leaky_bucket", "confusion_block", "quiz_misalignment", "calibration_gap", "healthy",
}


def help_share(f: PageFacts) -> float:
    """Of the people who read this page, the share who needed it; 0 under the floor."""
    if len(f.readers) < MIN_READERS:
        return 0.0
    return len(f.helped & f.readers) / len(f.readers)


def help_index(facts: dict[str, LessonFacts]) -> dict[str, list[float]]:
    """Per Lesson, one 0–1 value per page: its help share, normalised over the Space."""
    shares = {lid: {n: help_share(pf) for n, pf in lf.pages.items()} for lid, lf in facts.items()}
    top = max((v for s in shares.values() for v in s.values()), default=0.0)
    scale = max(HELP_FULL, top)
    out: dict[str, list[float]] = {}
    for lid, lf in facts.items():
        length = max([lf.lesson.pages, *lf.pages.keys()], default=0)
        out[lid] = [round(min(1.0, shares[lid].get(n, 0.0) / scale), 2) for n in range(1, length + 1)]
    return out


def grid(f: PageFacts) -> Optional[dict[str, int]]:
    """Check-in against checkpoint, paired per person; only once the floor's worth of pairs exist."""
    if len(f.pairs) < MIN_READERS:
        return None
    g = {"clickedCleared": 0, "clickedMissed": 0, "foggyCleared": 0, "foggyMissed": 0}
    for rating, cleared in f.pairs.values():
        said = "clicked" if rating == "got_it" else "foggy"
        g[f"{said}{'Cleared' if cleared else 'Missed'}"] += 1
    return g


def _pct(value: Any) -> int:
    return int(round(float(value or 0)))


def _metrics(kind: str, m: dict[str, Any], f: PageFacts) -> dict[str, float]:
    if kind == "confusion_hotspot":
        return {"askers": len(f.explain | f.ask), "foggy": _pct(m.get("confusionRate"))}
    if kind == "silent_misleader":
        clicked = [cleared for rating, cleared in f.pairs.values() if rating == "got_it"]
        missed = (
            _pct(100 * sum(1 for c in clicked if not c) / len(clicked))
            if clicked
            else _pct(100 - float(m.get("quizSuccessRate") or 0))
        )
        return {"clicked": _pct(m.get("gotItPct")), "missed": missed}
    if kind == "skipped_slide":
        return {"seconds": _pct(m.get("medianDwellSeconds"))}
    if kind == "speed_bump":
        return {"backs": int(m.get("backtracksFromNext") or 0)}
    if kind == "overpacked":
        base = float(m.get("lectureMedianDwellSeconds") or 0)
        return {"ratio": round(float(m.get("medianDwellSeconds") or 0) / base, 1) if base else 1.0}
    if kind == "leaky_bucket":
        return {"pct": _pct(m.get("attritionPct"))}
    if kind == "quiz_misalignment":
        return {"pct": _pct(m.get("quizSuccessRate"))}
    if kind == "calibration_gap":
        return {"pct": _pct(m.get("overconfidenceRate"))}
    return {}


def to_landing(insight: dict[str, Any], lf: LessonFacts) -> Optional[dict[str, Any]]:
    """One engine finding as a `LandingInsight`; None for anything the door must not say."""
    kind = insight.get("kind")
    pages = pages_of(insight)
    if kind not in _KINDS or not pages:
        return None
    f = lf.pages.get(pages[0]) or PageFacts()
    out: dict[str, Any] = {
        "id": f"{lf.lesson.id}:{insight['id']}",
        "kind": kind,
        "attention": insight["attention"],
        "severity": insight["severity"],
        "lessonId": lf.lesson.id,
    }
    if kind == "confusion_block":
        out["first"], out["last"] = pages[0], pages[-1]
    else:
        out["page"] = pages[0]
    out["metrics"] = _metrics(kind, insight.get("metrics") or {}, f)
    if kind in ("silent_misleader", "calibration_gap"):
        g = grid(f)
        if g:
            out["grid"] = g
    return out


def collapse_healthy(found: list[dict[str, Any]], lesson_id: str) -> list[dict[str, Any]]:
    """The engine finds a calm page at a time; the door says a Lesson is landing
    once, and only when nothing in it wants the owner."""
    healthy = [i for i in found if i["kind"] == "healthy"]
    rest = [i for i in found if i["kind"] != "healthy"]
    if not healthy or any(i["attention"] != "calm" for i in rest):
        return rest
    top = max(healthy, key=lambda i: i["severity"])
    return rest + [{
        "id": f"{lesson_id}:healthy", "kind": "healthy", "attention": "calm",
        "severity": top["severity"], "lessonId": lesson_id, "metrics": {},
    }]


def lesson_light(found: list[dict[str, Any]], readers: int) -> str:
    """A Lesson's light: its loudest finding, or `few` while under the floor."""
    if readers < MIN_READERS:
        return "few"
    return max((i["attention"] for i in found), key=_BAND.__getitem__, default="calm")


def rank(insights: list[dict[str, Any]], readers_by_lesson: dict[str, int]) -> list[dict[str, Any]]:
    """Loudest first: by band, then by severity × the Lesson's readers, then severity.
    The door reads `insights[0]` as the one page to open."""
    return sorted(
        insights,
        key=lambda i: (
            _BAND[i["attention"]],
            i["severity"] * readers_by_lesson.get(i["lessonId"], 0),
            i["severity"],
        ),
        reverse=True,
    )
```

- [ ] **Step 4: Run the tests**

Run the Step 2 command again. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/insights/landing_map.py backend/tests/unit/test_landing_map.py
git commit -m "feat(landing): engine findings told the door's way: its numbers, its pages, its order"
```

---

### Task 10: Three figures, each with its eight weeks

**Files:**
- Create: `backend/services/insights/figures.py`
- Test: `backend/tests/unit/test_landing_figures.py`

**Interfaces:**
- Consumes: `SpaceData`, `Event`, `LessonRow` (Task 6); `page_of`, `first_tries` (Task 7).
- Produces: `figures(data: SpaceData, floor: int) -> dict` — `{"reading": {value, history}, "landing": {value, history}, "cleared": {value, history}}`, histories oldest first, 8 entries; under the Space's floor `landing` and `cleared` are `{"value": 0, "history": []}`. Constants `WEEKS = 8`, `LANDS_BELOW = 0.2`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_landing_figures.py`:

```python
"""The three figures: readers this week, pages landing, checkpoints cleared first try — with eight weeks."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from backend.services.insights.figures import figures
from backend.services.insights.sources.space import Event, LessonRow, SpaceData

NOW = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
L1 = "l1"


def ev(user, kind, days_ago, **data):
    return Event(user_id=user, type=kind, data={"lectureId": L1, **data}, at=NOW - timedelta(days=days_ago))


def space(*events):
    return SpaceData(
        space_id="s", name="DBS", owner_id="o", members=frozenset(f"m{i}" for i in range(20)),
        lessons=(LessonRow(id=L1, title="N", order=1, pages=12),), events=tuple(events),
        slide_pages={}, question_pages={}, now=NOW,
    )


def read(user, days_ago, page=1):
    return ev(user, "slide_view", days_ago, page=page, duration_seconds=30, sessionId=user)


def test_reading_counts_members_who_read_each_week():
    data = space(*[read(f"m{i}", 1) for i in range(6)], *[read(f"m{i}", 9) for i in range(3)], read("m0", 2))
    reading = figures(data, 5)["reading"]
    assert reading == {"value": 6, "history": [0, 0, 0, 0, 0, 0, 3, 6]}


def test_under_the_floor_only_reading_is_real():
    out = figures(space(*[read(f"m{i}", 1) for i in range(4)]), 5)
    assert out["reading"]["value"] == 4
    assert out["landing"] == {"value": 0, "history": []} and out["cleared"] == {"value": 0, "history": []}


def test_a_page_lands_when_fewer_than_one_in_five_of_its_readers_needed_it():
    week = [read(f"m{i}", 1, page=1) for i in range(10)] + [read(f"m{i}", 1, page=2) for i in range(10)]
    help_on_2 = [ev(f"m{i}", "ai_tutor_query", 1, page=2, kind="ask", query="?") for i in range(3)]
    one_on_1 = [ev("m0", "confidence_rating", 1, page=1, rating="confused")]
    out = figures(space(*week, *help_on_2, *one_on_1), 5)
    assert out["landing"]["value"] == 50 and len(out["landing"]["history"]) == 8


def test_cleared_is_first_tries_at_checkpoint_questions_once_enough_people_tried():
    reads = [read(f"m{i}", 1) for i in range(6)]
    tries = [
        ev(f"m{i}", "checkpoint_attempt", 1, page=9, idea="J", kind="choice", questionId=1, correct=i < 4)
        for i in range(5)
    ]
    retry = [ev("m4", "checkpoint_attempt", 0, page=9, idea="J", kind="choice", questionId=1, correct=True)]
    teach = [ev("m5", "checkpoint_attempt", 1, page=4, idea="J", kind="teach", correct=False)]
    assert figures(space(*reads, *tries, *retry, *teach), 5)["cleared"]["value"] == 80
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_landing_figures.py -q -p no:cacheprovider`
Expected: FAIL — `ModuleNotFoundError: backend.services.insights.figures`.

- [ ] **Step 3: Implement**

Create `backend/services/insights/figures.py`:

```python
"""The three figures, each with its last eight weeks (oldest first).

- reading: members who read anything that week (a count);
- landing: of the pages at least `floor` members read that week, the percent
  where fewer than one in five of them needed it (asked, opened Explain,
  said foggy, or came back to it);
- cleared: of the checkpoint questions members tried for the first time that
  week, the percent they got right, once at least `floor` people tried one.

A week is seven days back from now. Under the Space's floor only `reading` is
real; the other two are empty, and the door shows no figures (spec §5).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Optional

from backend.services.insights.sources.space import SpaceData
from backend.services.insights.space_facts import first_tries, page_of

WEEKS = 8
#: A page lands in a week when fewer than this share of its readers needed it.
LANDS_BELOW = 0.2


def _week(at: datetime, now: datetime) -> Optional[int]:
    """0 = the oldest of the eight weeks, 7 = the last seven days; None outside them."""
    age = now - at
    if age.total_seconds() < 0:
        return None
    i = WEEKS - 1 - age.days // 7
    return i if 0 <= i < WEEKS else None


def figures(data: SpaceData, floor: int) -> dict[str, Any]:
    readers: list[set[str]] = [set() for _ in range(WEEKS)]
    page_readers: list[dict[tuple[str, int], set[str]]] = [defaultdict(set) for _ in range(WEEKS)]
    page_helped: list[dict[tuple[str, int], set[str]]] = [defaultdict(set) for _ in range(WEEKS)]

    for e in data.events:
        w = _week(e.at, data.now)
        if w is None:
            continue
        lesson = str(e.data.get("lectureId") or "")
        if e.type == "slide_view":
            p = page_of(e, data)
            if p is not None:
                readers[w].add(e.user_id)
                page_readers[w][(lesson, p)].add(e.user_id)
        elif e.type == "ai_tutor_query" or (
            e.type == "confidence_rating" and e.data.get("rating") in ("unsure", "confused")
        ):
            p = page_of(e, data)
            if p is not None:
                page_helped[w][(lesson, p)].add(e.user_id)
        elif e.type == "slide_back_navigation":
            p = page_of(e, data, "toPage", "toSlideId")
            if p is not None:
                page_helped[w][(lesson, p)].add(e.user_id)

    reading = [len(r) for r in readers]
    out: dict[str, Any] = {"reading": {"value": reading[-1], "history": reading}}
    if len(set().union(*readers)) < floor:
        out["landing"] = {"value": 0, "history": []}
        out["cleared"] = {"value": 0, "history": []}
        return out

    landing: list[int] = []
    for w in range(WEEKS):
        eligible = [k for k, who in page_readers[w].items() if len(who) >= floor]
        lands = sum(
            1 for k in eligible
            if len(page_helped[w][k] & page_readers[w][k]) / len(page_readers[w][k]) < LANDS_BELOW
        )
        landing.append(round(100 * lands / len(eligible)) if eligible else 0)

    tries: list[list] = [[] for _ in range(WEEKS)]
    for t in first_tries(data):
        if t.source != "checkpoint":
            continue
        w = _week(t.at, data.now)
        if w is not None:
            tries[w].append(t)
    cleared = [
        round(100 * sum(1 for t in ts if t.correct) / len(ts)) if len({t.user_id for t in ts}) >= floor else 0
        for ts in tries
    ]

    out["landing"] = {"value": landing[-1], "history": landing}
    out["cleared"] = {"value": cleared[-1], "history": cleared}
    return out
```

- [ ] **Step 4: Run the tests**

Run the Step 2 command again. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/insights/figures.py backend/tests/unit/test_landing_figures.py
git commit -m "feat(landing): three figures, each with its last eight weeks"
```

---

### Task 11: What people asked, as themes, never their words

**Files:**
- Create: `backend/services/insights/themes.py`
- Test: `backend/tests/unit/test_landing_themes.py`

**Interfaces:**
- Consumes: `MIN_READERS` (Task 8); `v4_reader_service._generate_json(prompt, *, user_id, course_id, feature, prefer)` (existing); `analytics_cache.get_or_compute_async(lecture_id, view_name, compute_fn, *, params, ttl_seconds)` (existing).
- Produces (in `backend.services.insights.themes`): `THEMES_VERSION = "themes-v1"`, `MAX_THEMES = 3`, `themes_prompt(texts: list[str], lang: str) -> str`, `clean_themes(data, texts: list[str]) -> list[str]`, `async themes_for(*, space_id: str, owner_id: str, lesson_id: str, page: int, texts: list[str], askers: int, lang: str) -> list[str]`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_landing_themes.py`:

```python
"""Themes: up to three, only where five or more people asked, metered to the owner, never a question verbatim."""
from __future__ import annotations

import asyncio

import pytest

import backend.services.insights.themes as themes
import backend.services.v4_reader_service as reader

ASKED = ["Why does the BCNF split lose a dependency?", "Is losing it the point?", "What is 3NF for?"]


@pytest.fixture
def model(monkeypatch):
    calls: list[dict] = []
    reply = {"value": {"themes": ["Why a split can lose a dependency", "What 3NF is for"]}}

    async def generate(prompt, **kw):
        calls.append({"prompt": prompt, **kw})
        if isinstance(reply["value"], Exception):
            raise reply["value"]
        return reply["value"]

    async def passthrough(key, view, compute, **kw):
        calls.append({"cache": (key, view, kw["params"])})
        return await compute()

    monkeypatch.setattr(reader, "_generate_json", generate)
    monkeypatch.setattr(themes.analytics_cache, "get_or_compute_async", passthrough)
    return calls, reply


def run(**over):
    args = dict(space_id="s1", owner_id="o1", lesson_id="l1", page=12, texts=ASKED, askers=6, lang="de")
    return asyncio.run(themes.themes_for(**{**args, **over}))


def test_themes_are_made_metered_to_the_owner_and_cached_per_number_of_askers(model):
    calls, _ = model
    assert run() == ["Why a split can lose a dependency", "What 3NF is for"]
    cache, call = calls
    assert cache["cache"] == ("s1", "themes", {"lesson": "l1", "page": 12, "askers": 6, "lang": "de", "v": "themes-v1"})
    assert (call["user_id"], call["course_id"], call["feature"], call["prefer"]) == ("o1", "s1", "v4_landing_themes", "openai")
    assert "German" in call["prompt"] and ASKED[0] in call["prompt"]


def test_fewer_than_five_askers_get_no_themes_and_no_model_call(model):
    calls, _ = model
    assert run(askers=4) == []
    assert calls == []


def test_a_failed_call_costs_the_owner_nothing_and_is_not_kept(model):
    calls, reply = model
    reply["value"] = RuntimeError("You have reached this month's AI allowance.")
    assert run() == []
    reply["value"] = {"themes": ["What 3NF is for"]}
    assert run() == ["What 3NF is for"]


def test_a_theme_that_repeats_a_question_is_dropped_and_three_is_the_most():
    out = themes.clean_themes({"themes": [ASKED[1], "  A  ", "B", "C", "D", 7]}, ASKED)
    assert out == ["A", "B", "C"]
    assert themes.clean_themes(["not", "a", "dict"], ASKED) == []
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_landing_themes.py -q -p no:cacheprovider`
Expected: FAIL — `ModuleNotFoundError: backend.services.insights.themes`.

- [ ] **Step 3: Implement**

Create `backend/services/insights/themes.py`:

```python
"""What people asked on a page, as up to three themes. Never their words.

Only for a page where at least `MIN_READERS` different members asked (the
owner excluded): the model sees the questions, the owner sees only the themes
(spec §0). The call is metered to the owner, since their view asks for it,
and cached per page and per number of askers, so it runs again only when
someone new has asked. A failed call yields no themes and is not cached.
"""
from __future__ import annotations

import logging
from typing import Any

from backend.services import analytics_cache
from backend.services.insights.space_engine import MIN_READERS

logger = logging.getLogger(__name__)

THEMES_VERSION = "themes-v1"
#: Themes change only when someone new asks (the key holds the asker count).
THEMES_TTL = 60 * 60 * 24 * 30
MAX_THEMES = 3
#: The most recent questions the model sees for one page.
MAX_TEXTS = 60

_LANGUAGE = {"en": "English", "de": "German (address no one, no exclamation marks)"}


def themes_prompt(texts: list[str], lang: str) -> str:
    questions = "\n".join(f"- {t[:300]}" for t in texts[-MAX_TEXTS:])
    return (
        "You help the person who runs a learning group see what one page of a lesson left open.\n"
        f"Below are questions members asked about that page. Write at most {MAX_THEMES} short themes in "
        f"{_LANGUAGE.get(lang, 'English')}, each a phrase under 12 words naming what was unclear.\n"
        "Never quote a question. Never include a name or anything that could tell who asked.\n"
        'Return JSON only: {"themes": ["..."]}\n\n'
        f"Questions:\n{questions}"
    )


def clean_themes(data: Any, texts: list[str]) -> list[str]:
    """At most three short, distinct themes; anything that repeats a question is dropped."""
    raw = data.get("themes") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return []
    asked = {t.strip().lower() for t in texts}
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        theme = " ".join(item.split())[:120]
        if theme and theme.lower() not in asked and theme not in out:
            out.append(theme)
    return out[:MAX_THEMES]


async def themes_for(
    *, space_id: str, owner_id: str, lesson_id: str, page: int, texts: list[str], askers: int, lang: str
) -> list[str]:
    if askers < MIN_READERS or not texts:
        return []
    from backend.services.v4_reader_service import _generate_json

    async def compute() -> list[str]:
        data = await _generate_json(
            themes_prompt(texts, lang),
            user_id=owner_id, course_id=space_id, feature="v4_landing_themes", prefer="openai",
        )
        return clean_themes(data, texts)

    try:
        return await analytics_cache.get_or_compute_async(
            space_id,
            "themes",
            compute,
            params={"lesson": lesson_id, "page": page, "askers": askers, "lang": lang, "v": THEMES_VERSION},
            ttl_seconds=THEMES_TTL,
        )
    except Exception:  # noqa: BLE001 — a theme never costs the owner their view
        logger.warning("landing: themes for %s p%s not made", lesson_id, page, exc_info=True)
        return []
```

Before moving on, read `backend/services/analytics_cache.py` `get_or_compute_async` (`:117-140`) and confirm that an exception raised by `compute_fn` propagates **without** a cache write. If it caches a failed result instead, wrap the call so a failure is not stored, and say so in the report.

- [ ] **Step 4: Run the tests**

Run the Step 2 command again. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/insights/themes.py backend/tests/unit/test_landing_themes.py
git commit -m "feat(landing): what people asked, as up to three themes, never their words"
```

---

### Task 12: `GET /v4/spaces/{id}/landing`

**Files:**
- Modify: `backend/services/v4_landing_service.py` (add `get_landing`, `landing_from`, `_themes`)
- Create: `backend/api/v1/v4_landing.py`
- Modify: `backend/main.py` (mount with the v4 routers)
- Test: `backend/tests/unit/test_v4_landing_api.py` (extend), `backend/tests/db/test_v4_landing_db.py`

**Interfaces:**
- Consumes: everything from Tasks 5–11.
- Produces:
  - `async get_landing(space_id: UUID, user_id: str, lang: str) -> dict` — guarded, cached (`analytics_cache` view `landing`, key = Space id, params `{lang, v}`, 300 s)
  - `async landing_from(data: SpaceData, lang: str) -> dict` — the payload: `{spaceId, spaceName, members, readers, floor, figures, lessons[{id,title,order,pages,readers,light,help?}], insights[], questions: [], themes[{lessonId,page,askers,themes}]}`; hotspot insights carry `themes: bool`
  - Route `GET /api/v1/v4/spaces/{space_id}/landing?lang=en|de` → 200 payload / 403 member / 404 otherwise; rate limit 30/minute

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_v4_landing_api.py`:

```python
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v1 import v4_landing
from backend.core.auth_middleware import verify_token
from backend.core.rate_limit import limiter
from backend.services.insights.sources.space import Event, LessonRow, SpaceData

MEMBER = "22222222-2222-2222-2222-222222222222"
STRANGER = "44444444-4444-4444-4444-444444444444"
NOW = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
L1, L2 = "l-normalization", "l-joins"
ASKED = "Why does the BCNF split lose a dependency?"


def _events():
    out = []
    for i in range(10):
        u = f"m{i}"
        for page in (1, 2, 3, 4):
            out.append(Event(u, "slide_view", {"lectureId": L1, "page": page, "duration_seconds": 40, "sessionId": u},
                             NOW - timedelta(days=1)))
        rating = "confused" if i < 8 else "got_it"
        out.append(Event(u, "confidence_rating", {"lectureId": L1, "page": 3, "rating": rating}, NOW - timedelta(days=1)))
        if i < 7:
            out.append(Event(u, "ai_tutor_query", {"lectureId": L1, "page": 3, "kind": "ask", "query": f"{ASKED} {i}"},
                             NOW - timedelta(days=1)))
    for i in range(3):  # Joins: three readers, under the floor
        out.append(Event(f"m{i}", "slide_view", {"lectureId": L2, "page": 1, "duration_seconds": 40, "sessionId": "x"},
                         NOW - timedelta(days=1)))
    return tuple(out)


def _data(events=None):
    return SpaceData(
        space_id=str(SPACE), name="Database Systems", owner_id=OWNER,
        members=frozenset(f"m{i}" for i in range(12)),
        lessons=(LessonRow(L1, "Normalization", 1, 4), LessonRow(L2, "Joins", 2, 6)),
        events=_events() if events is None else events, slide_pages={}, question_pages={}, now=NOW,
    )


@pytest.fixture
def client(monkeypatch):
    async def row(space_id, uid):
        if uid == STRANGER:
            return {"id": space_id, "title": "Database Systems", "professor_id": uuid.UUID(OWNER), "is_member": False}
        return {"id": space_id, "title": "Database Systems", "professor_id": uuid.UUID(OWNER), "is_member": uid == MEMBER}

    async def load(space_id, name, owner_id, **kw):
        return _data()

    async def passthrough(key, view, compute, **kw):
        return await compute()

    async def model(prompt, **kw):
        return {"themes": ["Why a split can lose a dependency"]}

    import backend.services.v4_reader_service as reader

    monkeypatch.setattr(service, "space_row", row)
    monkeypatch.setattr(service, "load_space_data", load)
    monkeypatch.setattr(service.analytics_cache, "get_or_compute_async", passthrough)
    monkeypatch.setattr(reader, "_generate_json", model)

    who = {"id": OWNER}
    app = FastAPI()
    app.state.limiter = limiter
    app.include_router(v4_landing.router, prefix="/api/v1")
    app.dependency_overrides[verify_token] = lambda: who
    c = TestClient(app)
    c.who = who
    return c


def test_only_the_owner_opens_it_a_member_is_told_a_stranger_learns_nothing(client):
    url = f"/api/v1/v4/spaces/{SPACE}/landing"
    assert client.get(url).status_code == 200
    client.who["id"] = MEMBER
    assert client.get(url).status_code == 403
    client.who["id"] = STRANGER
    assert client.get(url).status_code == 404


def test_the_owner_sees_the_space_in_aggregate_and_never_a_question(client):
    body = client.get(f"/api/v1/v4/spaces/{SPACE}/landing?lang=en").json()
    assert (body["spaceName"], body["members"], body["readers"], body["floor"]) == ("Database Systems", 12, 10, 5)
    assert body["questions"] == []
    normalization, joins = body["lessons"]
    assert (normalization["order"], normalization["readers"], len(normalization["help"])) == (1, 10, 4)
    assert normalization["help"][2] == 1.0
    assert (joins["light"], "help" in joins) == ("few", False)
    top = body["insights"][0]
    assert (top["kind"], top["lessonId"], top["page"], top["themes"]) == ("confusion_hotspot", L1, 3, True)
    assert top["metrics"] == {"askers": 7, "foggy": 80}
    assert body["themes"] == [{"lessonId": L1, "page": 3, "askers": 7, "themes": ["Why a split can lose a dependency"]}]
    assert ASKED not in json.dumps(body)
    assert all(i["lessonId"] != L2 for i in body["insights"])


def test_under_the_spaces_floor_it_says_so_with_no_findings_and_no_light(monkeypatch):
    few = tuple(e for e in _events() if e.user_id in {"m0", "m1", "m2", "m3"})
    body = asyncio.run(service.landing_from(_data(few), "en"))
    assert body["readers"] == 4 and body["insights"] == [] and body["themes"] == []
    assert {l["light"] for l in body["lessons"]} == {"few"}
    assert all("help" not in l for l in body["lessons"])
    assert body["figures"]["landing"] == {"value": 0, "history": []}
```

Create `backend/tests/db/test_v4_landing_db.py`:

```python
"""End to end on a real schema: the owner's own reading and other Spaces never count."""
from __future__ import annotations

import json
import uuid

import pytest

pytestmark = pytest.mark.db
asyncpg = pytest.importorskip("asyncpg")


async def test_the_owners_view_counts_its_members_and_no_one_else(
    throwaway_db, monkeypatch, db_conn, make_user, make_course, make_lecture, make_course_enrollment,
):
    import backend.services.v4_landing_service as service

    async def passthrough(key, view, compute, **kw):
        return await compute()

    monkeypatch.setattr(service.analytics_cache, "get_or_compute_async", passthrough)

    tag = uuid.uuid4().hex[:6]
    owner = make_user(email=f"owner-{tag}@gmail.com")
    members = [make_user(email=f"m{i}-{tag}@gmail.com") for i in range(6)]
    outsider = make_user(email=f"out-{tag}@gmail.com")
    space = make_course(owner, title=f"DBS {tag}")
    lesson = make_lecture(owner, title="Normalization")
    with db_conn.cursor() as cur:
        cur.execute("UPDATE lectures SET course_id = %s, total_slides = 4 WHERE id = %s", (str(space), str(lesson)))
    for m in members:
        make_course_enrollment(m, space)
    make_course_enrollment(owner, space)

    def read(user):
        with db_conn.cursor() as cur:
            cur.execute(
                "INSERT INTO public.learning_events (user_id, event_type, event_data) VALUES (%s, 'slide_view', %s::jsonb)",
                (str(user), json.dumps({"lectureId": str(lesson), "page": 1, "duration_seconds": 30,
                                        "sessionId": str(user), "timestamp": "x"})),
            )

    for user in [*members, owner, outsider]:
        read(user)

    body = await service.get_landing(space, str(owner), "en")
    assert (body["members"], body["readers"]) == (6, 6)
    assert body["lessons"][0]["readers"] == 6

    with pytest.raises(Exception) as denied:
        await service.get_landing(space, str(members[0]), "en")
    assert getattr(denied.value, "status_code", None) == 403
```

- [ ] **Step 2: Run them to see them fail**

Run:
```bash
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_landing_api.py -q -p no:cacheprovider
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest -m db backend/tests/db/test_v4_landing_db.py -q -p no:cacheprovider
```
Expected: FAIL — `cannot import name 'v4_landing'`; `service` has no `get_landing` / `landing_from`.

- [ ] **Step 3: Complete the service**

In `backend/services/v4_landing_service.py`, extend the module docstring with: `Cached per Space for five minutes. \`accent\` and each Lesson's \`color\` are left to the app (Plan 3 draws them from the Lesson's order until a sampled hue is stored at ingest); \`questions\` arrive with the questions channel (Plan 4).`

Add these imports below the existing ones:

```python
from backend.domain.authorization import assert_space_owner
from backend.services import analytics_cache
from backend.services.insights.figures import figures
from backend.services.insights.landing_map import collapse_healthy, help_index, lesson_light, rank, to_landing
from backend.services.insights.sources.space import SpaceData, load_space_data
from backend.services.insights.space_engine import MIN_READERS, lesson_insights
from backend.services.insights.space_facts import LessonFacts, lesson_facts
from backend.services.insights.themes import themes_for
```

Add below `space_row`:

```python
LANDING_VERSION = "landing-v1"
LANDING_TTL = 300
#: Themes are made for at most this many pages per Space at a time, the most-asked first.
THEMES_PAGES = 5


async def get_landing(space_id: UUID, user_id: str, lang: str) -> dict[str, Any]:
    """The owner's view of their Space; 403 for a member, 404 for anyone else."""
    row = await space_row(space_id, user_id)
    assert_space_owner(row, user_id)

    async def compute() -> dict[str, Any]:
        data = await load_space_data(space_id, row["title"] or "", str(row["professor_id"]))
        return await landing_from(data, lang)

    return await analytics_cache.get_or_compute_async(
        str(space_id), "landing", compute, params={"lang": lang, "v": LANDING_VERSION}, ttl_seconds=LANDING_TTL
    )


async def landing_from(data: SpaceData, lang: str) -> dict[str, Any]:
    """The `Landing` payload (without `accent` and `lessons[].color`) from a Space's activity."""
    facts = lesson_facts(data)
    readers = len(set().union(*(lf.readers for lf in facts.values())))
    above = readers >= MIN_READERS
    helps = help_index(facts)

    lessons: list[dict[str, Any]] = []
    found_all: list[dict[str, Any]] = []
    for lesson in data.lessons:
        lf = facts[lesson.id]
        found: list[dict[str, Any]] = []
        if above:
            mapped = [x for x in (to_landing(i, lf) for i in lesson_insights(lf)) if x]
            found = collapse_healthy(mapped, lesson.id)
        found_all += found
        entry: dict[str, Any] = {
            "id": lesson.id,
            "title": lesson.title,
            "order": lesson.order,
            "pages": lesson.pages,
            "readers": len(lf.readers),
            "light": lesson_light(found, len(lf.readers)) if above else "few",
        }
        if above and len(lf.readers) >= MIN_READERS:
            entry["help"] = helps[lesson.id]
        lessons.append(entry)

    ranked = rank(found_all, {lesson.id: len(facts[lesson.id].readers) for lesson in data.lessons})
    themes = await _themes(data, facts, lang) if above else []
    lit = {(t["lessonId"], t["page"]) for t in themes}
    for insight in ranked:
        if insight["kind"] == "confusion_hotspot":
            insight["themes"] = (insight["lessonId"], insight.get("page")) in lit

    return {
        "spaceId": data.space_id,
        "spaceName": data.name,
        "members": len(data.members),
        "readers": readers,
        "floor": MIN_READERS,
        "figures": figures(data, MIN_READERS),
        "lessons": lessons,
        "insights": ranked,
        "questions": [],
        "themes": themes,
    }


async def _themes(data: SpaceData, facts: dict[str, LessonFacts], lang: str) -> list[dict[str, Any]]:
    """Themes for the most-asked-about pages (at least the floor's worth of askers)."""
    hot = sorted(
        (
            (len(pf.ask), lf.lesson.id, page, pf)
            for lf in facts.values()
            for page, pf in lf.pages.items()
            if len(pf.ask) >= MIN_READERS
        ),
        key=lambda x: x[0],
        reverse=True,
    )[:THEMES_PAGES]
    out: list[dict[str, Any]] = []
    for askers, lesson_id, page, pf in hot:
        found = await themes_for(
            space_id=data.space_id, owner_id=data.owner_id, lesson_id=lesson_id,
            page=page, texts=pf.ask_texts, askers=askers, lang=lang,
        )
        if found:
            out.append({"lessonId": lesson_id, "page": page, "askers": askers, "themes": found})
    return out
```

- [ ] **Step 4: Add the route**

Create `backend/api/v1/v4_landing.py`:

```python
"""How it's landing: the owner's view of a Space (spec §4 B4).

Mounted with the other v4 routers (FEATURE_V4). Only the person who runs a
Space may open it: a member gets 403, everyone else 404. The payload is
aggregates over members only, with no member's words in it.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.core.auth_middleware import _user_id, verify_token
from backend.core.rate_limit import limiter
from backend.services import v4_landing_service as service

router = APIRouter(prefix="/v4", tags=["v4"])


def _uid(user: Any) -> str:
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Sign in first.")
    return uid


def _lang(request: Request) -> str:
    """The app's language, as every v4 request tags it (`?lang=`)."""
    return "de" if (request.query_params.get("lang") or "").lower().startswith("de") else "en"


@router.get("/spaces/{space_id}/landing")
@limiter.limit("30/minute")
async def v4_landing(request: Request, space_id: UUID, user: Any = Depends(verify_token)):
    """Figures, every Lesson's light and help, ranked findings and themes."""
    return await service.get_landing(space_id, _uid(user), _lang(request))
```

In `backend/main.py`, inside the existing `if settings.feature_v4:` block, after `v1_router.include_router(v4_spaces_router)`, add:

```python
    from backend.api.v1.v4_landing import router as v4_landing_router
    v1_router.include_router(v4_landing_router)
```

- [ ] **Step 5: Run the tests**

Run the two Step 2 commands again, then the whole unit suite once (`/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit -q -p no:cacheprovider`). Expected: all pass. If the unit test's top insight is not the hotspot on page 3, print `[(i['kind'], i.get('page'), i['attention'], i['severity']) for i in body['insights']]` and fix the **fixture numbers**, not the ranking.

- [ ] **Step 6: Commit**

```bash
git add backend/services/v4_landing_service.py backend/api/v1/v4_landing.py backend/main.py \
  backend/tests/unit/test_v4_landing_api.py backend/tests/db/test_v4_landing_db.py
git commit -m "feat(landing): GET /v4/spaces/{id}/landing, the owner's view of their Space"
```

---

### Task 13: People, only behind a flag, only by per-Space names

**Files:**
- Modify: `backend/core/config.py`, `backend/services/utils/analytics_utils.py`
- Create: `backend/services/insights/people.py`
- Modify: `backend/services/v4_landing_service.py`, `backend/api/v1/v4_landing.py`
- Test: `backend/tests/unit/test_landing_people.py`

**Interfaces:**
- Consumes: `SpaceData` (Task 6); `lesson_facts`, `page_of`, `first_tries`, `DWELL_CEIL` (Task 7); `MIN_READERS` (Task 8); `detectors.detect_silent_strugglers` (existing); `space_row`, `assert_space_owner`, `load_space_data` (Tasks 5–6).
- Produces:
  - `settings.feature_landing_people: bool` (`FEATURE_LANDING_PEOPLE`, default False), `settings.landing_pseudonym_salt: str` (`LANDING_PSEUDONYM_SALT`, default "")
  - `space_pseudonym(user_id: str, space_id: str, salt: str) -> tuple[str, str]` → `("p_<16 hex>", "<Theme>-<4 HEX>")`
  - `strugglers(data: SpaceData, salt: str) -> list[dict]` — `[{id, name, progress, firstTry, help}]`, empty under the floor
  - `journey(data: SpaceData, salt: str, person: str, lesson_id: str) -> list[dict] | None` — `[{page, seconds, foggy, firstTry, help}]`, `None` when the pseudonym is no member here
  - Routes `GET /api/v1/v4/spaces/{id}/landing/people` → `{"strugglers": […]}` and `GET /api/v1/v4/spaces/{id}/landing/people/{person}/journey?lesson=<uuid>` → `{"steps": […]}`; both 404 unless the flag is on **and** the salt is set; both owner-guarded.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_landing_people.py`:

```python
"""Person-level views: off by default, and when on, a person is someone else in every Space."""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.services.v4_landing_service as service
from backend.api.v1 import v4_landing
from backend.core.auth_middleware import verify_token
from backend.core.config import settings
from backend.core.rate_limit import limiter
from backend.services.insights.people import journey, strugglers
from backend.services.insights.sources.space import Event, LessonRow, SpaceData
from backend.services.utils.analytics_utils import space_pseudonym

OWNER = "11111111-1111-1111-1111-111111111111"
SPACE = uuid.UUID("33333333-3333-3333-3333-333333333333")
LESSON = "55555555-5555-5555-5555-555555555555"
NOW = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)
UIDS = [f"00000000-0000-0000-0000-00000000000{i}" for i in range(6)]
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def _data():
    events = []
    for i, u in enumerate(UIDS):
        pages = 1 if i == 0 else 6  # one reader barely started
        for page in range(1, pages + 1):
            events.append(Event(u, "slide_view", {"lectureId": LESSON, "page": page, "duration_seconds": 30,
                                                   "sessionId": u}, NOW - timedelta(days=1)))
        events.append(Event(u, "checkpoint_attempt", {"lectureId": LESSON, "page": 1, "idea": "J", "kind": "choice",
                                                      "questionId": 1, "correct": i != 0}, NOW - timedelta(days=1)))
    return SpaceData(str(SPACE), "DBS", OWNER, frozenset(UIDS), (LessonRow(LESSON, "N", 1, 6),), tuple(events),
                     {}, {}, NOW)


def test_a_person_is_someone_else_in_every_space_and_never_their_account():
    a = space_pseudonym(UIDS[0], "space-a", "salt")
    assert a == space_pseudonym(UIDS[0], "space-a", "salt")
    assert a != space_pseudonym(UIDS[0], "space-b", "salt")
    assert a != space_pseudonym(UIDS[0], "space-a", "other-salt")
    assert re.fullmatch(r"p_[0-9a-f]{16}", a[0]) and UIDS[0] not in a[0] + a[1]


def test_strugglers_and_a_journey_carry_pseudonyms_only():
    data = _data()
    found = strugglers(data, "salt")
    assert found and not UUID_RE.search(json.dumps(found))
    person = space_pseudonym(UIDS[0], str(SPACE), "salt")[0]
    steps = journey(data, "salt", person, LESSON)
    assert steps[0] == {"page": 1, "seconds": 30, "foggy": None, "firstTry": False, "help": False}
    assert len(steps) == 6 and journey(data, "salt", "p_0000000000000000", LESSON) is None


@pytest.fixture
def client(monkeypatch):
    async def row(space_id, uid):
        return {"id": space_id, "title": "DBS", "professor_id": uuid.UUID(OWNER), "is_member": False}

    async def load(space_id, name, owner_id, **kw):
        return _data()

    monkeypatch.setattr(service, "space_row", row)
    monkeypatch.setattr(service, "load_space_data", load)
    app = FastAPI()
    app.state.limiter = limiter
    app.include_router(v4_landing.router, prefix="/api/v1")
    app.dependency_overrides[verify_token] = lambda: {"id": OWNER}
    return TestClient(app)


def test_off_by_default_even_for_the_owner(client, monkeypatch):
    monkeypatch.setattr(settings, "feature_landing_people", False)
    assert client.get(f"/api/v1/v4/spaces/{SPACE}/landing/people").status_code == 404
    monkeypatch.setattr(settings, "feature_landing_people", True)
    monkeypatch.setattr(settings, "landing_pseudonym_salt", "")
    assert client.get(f"/api/v1/v4/spaces/{SPACE}/landing/people").status_code == 404


def test_when_on_the_owner_sees_pseudonyms_and_can_follow_one(client, monkeypatch):
    monkeypatch.setattr(settings, "feature_landing_people", True)
    monkeypatch.setattr(settings, "landing_pseudonym_salt", "salt")
    body = client.get(f"/api/v1/v4/spaces/{SPACE}/landing/people").json()
    assert body["strugglers"] and not UUID_RE.search(json.dumps(body))
    person = body["strugglers"][0]["id"]
    steps = client.get(f"/api/v1/v4/spaces/{SPACE}/landing/people/{person}/journey?lesson={LESSON}")
    assert steps.status_code == 200 and steps.json()["steps"][0]["page"] == 1
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_landing_people.py -q -p no:cacheprovider`
Expected: FAIL — `cannot import name 'space_pseudonym'`; no module `people`.

- [ ] **Step 3: Flags and pseudonyms**

In `backend/core/config.py`, after the `feature_luna_sessions` field, add:

```python
    # Person-level pieces of the owner's view (Strugglers, Journey). Off until
    # Abi's privacy call (spec 2026-10-26-how-its-landing-design.md §8); also
    # needs LANDING_PSEUDONYM_SALT, which makes a person someone else in every Space.
    feature_landing_people: bool = Field(alias="FEATURE_LANDING_PEOPLE", default=False)
    landing_pseudonym_salt: str = Field(alias="LANDING_PSEUDONYM_SALT", default="")
```

In `backend/services/utils/analytics_utils.py`, add `import hmac` next to `import hashlib`, and append:

```python
def space_pseudonym(user_id: str, space_id: str, salt: str) -> tuple[str, str]:
    """A person's id and name inside one Space only.

    The same person is someone else in every Space, and without the salt the
    id never turns back into an account (unlike `generate_anon_name`, which
    is the same everywhere). Returns ``("p_<16 hex>", "<Theme>-<4 HEX>")``.
    """
    h = hmac.new(salt.encode(), f"{space_id}:{user_id}".encode(), hashlib.sha256).hexdigest()
    themes = ["Nexus", "Quantum", "Neural", "Prism", "Cortex", "Vector", "Logic", "Pulse"]
    return f"p_{h[:16]}", f"{themes[int(h[:2], 16) % len(themes)]}-{h[-4:].upper()}"
```

- [ ] **Step 4: The person-level views**

Create `backend/services/insights/people.py`:

```python
"""Person-level views of a Space, behind FEATURE_LANDING_PEOPLE (off).

Built only from the Space's own facts and named only by per-Space pseudonyms:
no user id, email or account name ever leaves here. Real members see none of
this until Abi's privacy call (spec §0, §8).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Optional

from backend.services.insights import detectors
from backend.services.insights.sources.space import SpaceData
from backend.services.insights.space_engine import MIN_READERS
from backend.services.insights.space_facts import DWELL_CEIL, first_tries, lesson_facts, page_of
from backend.services.utils.analytics_utils import space_pseudonym


def strugglers(data: SpaceData, salt: str) -> list[dict[str, Any]]:
    """People who are behind and have not asked for help, by pseudonym; empty under the floor."""
    facts = lesson_facts(data)
    total_pages = sum(max([lf.lesson.pages, *lf.pages.keys()], default=0) for lf in facts.values()) or 1
    readers = set().union(*(lf.readers for lf in facts.values()))
    if len(readers) < MIN_READERS:
        return []
    tries: dict[str, list[bool]] = defaultdict(list)
    for t in first_tries(data):
        tries[t.user_id].append(t.correct)
    students = []
    for user in readers:
        pid, name = space_pseudonym(user, data.space_id, salt)
        read = sum(1 for lf in facts.values() for pf in lf.pages.values() if user in pf.readers)
        helped = sum(1 for lf in facts.values() for pf in lf.pages.values() if user in (pf.explain | pf.ask))
        mine = tries[user]
        students.append({
            "student_id": pid,
            "student_name": name,
            "progress_percentage": round(100 * read / total_pages),
            "quiz_score": round(100 * sum(mine) / len(mine)) if mine else 0,
            "ai_interactions": helped,
        })
    found = detectors.detect_silent_strugglers({"total_students": len(students), "students": students})
    people = (found[0].get("detail") or {}).get("students", []) if found else []
    return [
        {"id": p["studentId"], "name": p["name"], "progress": p["progress"], "firstTry": p["quizScore"],
         "help": p["aiInteractions"]}
        for p in people
    ]


def journey(data: SpaceData, salt: str, person: str, lesson_id: str) -> Optional[list[dict[str, Any]]]:
    """One person's way through one Lesson, page by page; None if the pseudonym is no member here."""
    user = next((u for u in data.members if space_pseudonym(u, data.space_id, salt)[0] == person), None)
    lesson = next((lesson for lesson in data.lessons if lesson.id == lesson_id), None)
    if user is None or lesson is None:
        return None
    lf = lesson_facts(data)[lesson_id]
    seconds: dict[tuple[str, int], float] = defaultdict(float)
    for e in data.events:
        if e.user_id == user and e.type == "slide_view" and e.data.get("lectureId") == lesson_id:
            page = page_of(e, data)
            if page is not None:
                seconds[(str(e.data.get("sessionId") or ""), page)] += float(e.data.get("duration_seconds") or 0)
    per_page: dict[int, float] = defaultdict(float)
    for (_session, page), secs in seconds.items():
        if secs <= DWELL_CEIL:
            per_page[page] += secs
    first: dict[int, list[bool]] = defaultdict(list)
    for t in first_tries(data):
        if t.user_id == user and t.lesson_id == lesson_id:
            first[t.page].append(t.correct)
    length = max([lesson.pages, *lf.pages.keys()], default=0)
    steps = []
    for page in range(1, length + 1):
        pf = lf.pages.get(page)
        rating = pf.ratings.get(user) if pf else None
        steps.append({
            "page": page,
            "seconds": round(per_page.get(page, 0.0)),
            "foggy": None if rating is None else rating in ("unsure", "confused"),
            "firstTry": all(first[page]) if first.get(page) else None,
            "help": bool(pf and user in (pf.explain | pf.ask)),
        })
    return steps
```

Note for the implementer: `detect_silent_strugglers` (`detectors.py:138`) emits `detail.students[].studentId/name/progress/quizScore/aiInteractions`; check those key names before running the tests and adjust the final mapping above to the real keys if they differ.

- [ ] **Step 5: Service and routes**

In `backend/services/v4_landing_service.py`, add `from backend.services.insights.people import journey, strugglers` to the imports, and append:

```python
async def get_people(space_id: UUID, user_id: str, salt: str) -> dict[str, Any]:
    """Strugglers by per-Space pseudonym (flag-only; not cached)."""
    row = await space_row(space_id, user_id)
    assert_space_owner(row, user_id)
    data = await load_space_data(space_id, row["title"] or "", str(row["professor_id"]))
    return {"strugglers": strugglers(data, salt)}


async def get_journey(space_id: UUID, user_id: str, salt: str, person: str, lesson_id: str) -> Optional[list]:
    """One pseudonym's way through one Lesson (flag-only); None when not found."""
    row = await space_row(space_id, user_id)
    assert_space_owner(row, user_id)
    data = await load_space_data(space_id, row["title"] or "", str(row["professor_id"]))
    return journey(data, salt, person, lesson_id)
```

In `backend/api/v1/v4_landing.py`, change the fastapi import to `from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request`, add `from backend.core.config import settings`, and append:

```python
def _people_salt() -> str:
    """Person-level views exist only with the flag on and a salt set; otherwise they are not here."""
    if not settings.feature_landing_people or not settings.landing_pseudonym_salt:
        raise HTTPException(status_code=404, detail="Not found.")
    return settings.landing_pseudonym_salt


@router.get("/spaces/{space_id}/landing/people")
@limiter.limit("30/minute")
async def v4_landing_people(request: Request, space_id: UUID, user: Any = Depends(verify_token)):
    salt = _people_salt()
    return await service.get_people(space_id, _uid(user), salt)


@router.get("/spaces/{space_id}/landing/people/{person}/journey")
@limiter.limit("30/minute")
async def v4_landing_journey(
    request: Request,
    space_id: UUID,
    person: str = Path(pattern=r"^p_[0-9a-f]{16}$"),
    lesson: UUID = Query(...),
    user: Any = Depends(verify_token),
):
    salt = _people_salt()
    steps = await service.get_journey(space_id, _uid(user), salt, person, str(lesson))
    if steps is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return {"steps": steps}
```

- [ ] **Step 6: Run the tests**

Run the Step 2 command again, then `backend/tests/unit/test_v4_landing_api.py` and the whole unit suite once. Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/core/config.py backend/services/utils/analytics_utils.py backend/services/insights/people.py \
  backend/services/v4_landing_service.py backend/api/v1/v4_landing.py backend/tests/unit/test_landing_people.py
git commit -m "feat(landing): person-level views only behind a flag, only by per-Space names"
```

---

### Task 14: Prove it, then hand over

**Files:** none changed unless a gate fails.

- [ ] **Step 1: Run every gate**

```bash
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit -q -p no:cacheprovider
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest -m db backend/tests/db/test_throwaway_db.py backend/tests/db/test_landing_space_source.py backend/tests/db/test_v4_landing_db.py backend/tests/db/test_v4_create_space.py backend/tests/db/test_v4_world.py backend/tests/db/test_learning_events_schema_db.py -q -p no:cacheprovider
export PATH="/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin:$PATH"
npx tsc -p tsconfig.app.json --noEmit
npm run lint
npx vitest run --no-file-parallelism --testTimeout=120000
```
Expected: all green; a failure that also fails on the Task 0 baseline is pre-existing — say so, do not fix it here. DB tests: report which Postgres ran them.

- [ ] **Step 2: Look at a real payload locally (only with Abi signed in)**

With the local backend on `FEATURE_V4=1` (it talks to the **prod** database), as the owner of a Space with readers, call `GET /api/v1/v4/spaces/<id>/landing?lang=en` with the browser's token, read-only. Check by eye: `readers` ≤ `members`; no member name, email, id or question text anywhere in the JSON; `insights` loudest first. Skip if Abi is not available, and say so.

- [ ] **Step 3: Write the PR description's hand-over**

```
What ships
- GET /api/v1/v4/spaces/{id}/landing (mounted under FEATURE_V4). No caller until Plan 3.
- Person-level routes exist but 404 unless FEATURE_LANDING_PEOPLE=1 and LANDING_PSEUDONYM_SALT is set (both off/empty; do not set them before Abi's privacy call).
- Reader: Luna's page turns are no longer counted as turning back; a hidden phone tab reports its page.
- Checkpoint answers carry questionId (schema field is optional; no migration).

Deploy
- No migration. Backend and frontend can deploy in either order (the new questionId field is optional on both sides; the reader changes need no backend change).
- Themes call OpenAI metered to the owner (feature "v4_landing_themes"), only for pages with ≥5 askers, at most 5 pages per Space, cached per asker count.
```

- [ ] **Step 4: Update the project memory**

Edit `/Users/abdullahabobaker/.claude/projects/-Users-abdullahabobaker-Desktop-ascend-academy/memory/project_analytics_v4_integration.md`: Plan 2 status (branch, PR, what is live behind which flag) and that Plan 3 (door in v4: live seam with `color`/`accent` filled client-side, route + gate + pill, the legacy person-level gating + privacy wording per A11) and Plan 4 (questions) are next.

---

## Self-review notes (done while writing)

- **Spec coverage (§4 Phase B):** B1 → Task 5 · B2 → Tasks 6–8 (legacy bundle not moved: Decision 4) · B3 → Tasks 8, 9, 10, 12 · B4 → Tasks 9, 10, 12 (`accent`/`color` left to Plan 3: Decision 2) · B5 → Task 9 · B6 → Tasks 11, 12 (in the payload: Decision 3) · B7 → Task 13 · B8 → Task 13 (legacy Journey untouched: Decision 9) · B9 → tests in every task; detector tests reused untouched.
- **Plan 1 follow-ups the final review assigned here:** Luna's page turns → Task 3 · mobile no-`pagehide` → Task 4 · idle cap → Task 7 (`DWELL_CEIL` per sitting) · latest check-in per idea → Task 7 · replayed checkpoint answers → Tasks 2, 7 · `.env` DSN in DB tests → Task 1 · professor RLS → done in Plan 1's migration; this plan reads with service-role SQL and never through an owner's session.
- **Names used across tasks:** `throwaway_db`; `LessonRow`, `Event`, `SpaceData`, `load_space_data`, `WINDOW_DAYS`, `EVENT_TYPES`; `PageFacts`, `LessonFacts`, `Try`, `page_of`, `first_tries`, `lesson_facts`, `DWELL_CEIL`, `SHORT_VIEW`; `MIN_READERS`, `page_row`, `lesson_bundle`, `pages_of`, `lesson_insights`; `HELP_FULL`, `help_share`, `help_index`, `grid`, `to_landing`, `collapse_healthy`, `lesson_light`, `rank`; `figures`, `WEEKS`, `LANDS_BELOW`; `themes_prompt`, `clean_themes`, `themes_for`, `THEMES_VERSION`; `assert_space_owner`, `space_row`, `get_landing`, `landing_from`, `get_people`, `get_journey`; `space_pseudonym`, `strugglers`, `journey`; `feature_landing_people`, `landing_pseudonym_salt` — consistent in every task that uses them.
- **Out of scope here:** the door's live data seam, route, owner gate and pill (Plan 3); gating the legacy person-level views and the privacy-page floor wording (Plan 3, A11); the questions channel (Plan 4).
