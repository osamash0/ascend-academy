# How it's landing — Plan 1: the v4 reader records what the engine needs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the v4 reader write honest, validated `learning_events` (sessions, dwell without overlays, back-navigation, completion, first tries vs. retries, Explain/Ask help, an idea check-in, server-graded checkpoints and teach-back) so the insight engine has v4 data to run on.

**Architecture:** Every v4 telemetry write goes through one asyncpg helper, `record_event()`, that validates against the event registry and inserts in a savepoint, so a rejected event never costs the reader its progress, XP or answer. The browser opens one reading session per reader mount, excludes time the page is covered or hidden, and reports the last page with a `keepalive` request when the tab closes. One new event type, `checkpoint_attempt`, is added to the registry and the database CHECK in lockstep.

**Tech Stack:** FastAPI + asyncpg + Pydantic v2 (backend), Supabase Postgres (partitioned `learning_events`), React 18 + Vite + Vitest + Testing Library (frontend), i18next (en + de).

**Spec:** `docs/superpowers/specs/2026-10-26-how-its-landing-design.md` — §4 Phase A (A1–A11), §0 decisions, §2 the four people. Plans 2 (Space-scoped engine, B), 3 (the door in v4, C) and 4 (questions channel, A12/B10/C8) follow this one.

## Global Constraints

- Luna's tables, notes and `learner_memory` are never read or written by this plan. Luna check results are **never** emitted (decided 2026-10-26).
- Explain/Ask question text is stored in `ai_tutor_query.query`; the model's reply is **never** stored (`AiTutorQuery` has no `response`, audit Q-B-F4).
- Every new `learning_events.event_type` changes `backend/schemas/learning_events.py` (`EVENT_REGISTRY`) **and** the CHECK constraint in one migration. The only new type here is `checkpoint_attempt`.
- Payload keys are camelCase (`lectureId`, `slideId`, `sessionId`); every v4 payload carries `"source": "v4_reader"` (practice: `"v4_practice"`).
- Telemetry must never fail the user's request: `record_event()` swallows and logs, and it runs in a savepoint inside existing transactions.
- New migration file name: `supabase/migrations/20261027000000_v4_reader_telemetry_events.sql` (sorts after `20261026000000`, the newest on main).
- **Deploy order:** the migration is applied to prod (by Abi, via psql) **before** the backend that writes `checkpoint_attempt` ships. Never run `supabase db push` (memory: prod ledger is unreliable).
- v4 UI copy: no "professor / student / teacher / lecture / slide / course / deck / document" in strings under `src/features/spaces` (`node scripts/check-vocabulary.mjs`); every JSX word comes from i18n (`node scripts/check-v4-strings.mjs`); en and de keys match (`node scripts/check-i18n-parity.cjs`). German: du, no exclamation marks.
- Type-check with `npx tsc -p tsconfig.app.json --noEmit` (the bare `tsconfig.json` checks nothing).
- Backend tests: `.venv/bin/python -m pytest …` from the repo root (absolute venv: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python`). DB tests need Docker (`-m db`).
- Node: `export PATH="/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin:$PATH"` before `npx`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

**Backend**
- Modify `backend/schemas/learning_events.py` — v4 fields on existing payloads; new `CheckpointAttempt`; registry entry.
- Create `supabase/migrations/20261027000000_v4_reader_telemetry_events.sql` — CHECK gains `checkpoint_attempt`.
- Modify `backend/repositories/event_repo.py` — `record_event(conn, user_id, event_type, event_data) -> bool`.
- Create `backend/services/v4_telemetry.py` — `now_iso()`, `slide_id_for()`, `record_help()`, `record_check_in()`, `record_checkpoint()`, `session_or_new()`.
- Modify `backend/services/v4_reading_service.py` — session, back-navigation, completion, all through `record_event`.
- Modify `backend/services/v4_practice_service.py` — first try vs. retry, session.
- Modify `backend/services/v4_rehearsal_service.py` — `checkpoint_key()`, `cached_checkpoint()`, `grade_answer()`.
- Modify `backend/api/v1/v4_reader.py` — request bodies carry `session_id`; progress carries `to_page`; new `POST …/check-in` and `POST …/checkpoint/answer`; Explain, Ask and teach-back record.

**Frontend**
- Create `src/features/spaces/data/readingSession.ts` — one session id per open reader.
- Modify `src/features/spaces/data/reading.ts` — session, paused time, `to_page`, `pagehide` beacon.
- Modify `src/lib/apiClient.ts` — `beacon(path, body): boolean` (keepalive POST with the last token seen).
- Modify `src/features/spaces/data/liveRepository.ts` — `V4Transport.beacon?`, session/`to_page` on reader calls, `recordReadingBeacon`, `checkIn`, `answerCheckpoint`.
- Modify `src/features/spaces/data/useReader.ts`, `src/features/spaces/data/practice.ts` — pass the session; `recordCheckIn()`, `recordCheckpointAnswer()`.
- Modify `src/features/spaces/components/reader/CheckpointCard.tsx` — the check-in row; `onAnswer`.
- Modify `src/features/spaces/screens/LessonFacesScreen.tsx` — `covered` into `useReadingProgress`; wire check-in and answers.
- Modify `src/features/spaces/screens/JoinSpaceScreen.tsx`, `src/i18n/locales/{en,de}/v4Spaces.json`, `src/i18n/locales/{en,de}/v4Reader.json`, `src/i18n/locales/{en,de}/legal.json`.

**Tests (new or extended)**
- `backend/tests/unit/test_learning_events_schema.py`, `backend/tests/db/test_learning_events_schema_db.py`
- `backend/tests/unit/test_event_repo_record.py`, `backend/tests/unit/test_v4_telemetry.py`
- `backend/tests/unit/test_v4_reading_telemetry.py`, `backend/tests/unit/test_v4_practice_retry.py`
- `backend/tests/unit/test_v4_checkpoint_grading.py`, `backend/tests/unit/test_v4_reader_telemetry_api.py`
- `src/__tests__/lib/apiClient.beacon.test.ts`, `src/features/spaces/__tests__/reading.test.ts`
- `src/features/spaces/__tests__/telemetry-live.test.ts`, `src/features/spaces/__tests__/checkpoint-checkin.test.tsx`
- `src/features/spaces/__tests__/join-privacy.test.ts`

---

### Task 0: Start from main, keep the demo safe

**Files:** none changed by hand.

- [ ] **Step 1: Commit the spec and the fixture demo as they are** (only with Abi's go-ahead to commit)

```bash
git add docs/superpowers/specs/2026-10-26-how-its-landing-design.md docs/superpowers/plans/2026-10-26-how-its-landing-plan-1-reader-telemetry.md \
  src/features/spaces/landing src/features/spaces/data/landing.ts src/features/spaces/mocks/landing.ts \
  src/features/spaces/__tests__/landing.test.tsx src/features/spaces/index.ts \
  src/i18n/locales/en/v4Landing.json src/i18n/locales/de/v4Landing.json src/i18n/index.ts \
  src/pages/LandingLab.tsx src/pages/landingMockups src/App.tsx
git commit -m "docs+lab: How it's landing spec, plan 1, and the DEV-only fixture door

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Bring the branch up to date with main**

Call the `mcp__ccd_host__sync_with_base_branch` tool (this worktree was made by the app). Resolve conflicts if it reports any, then confirm `ls supabase/migrations | tail -3` shows `20261026000000_*` and nothing newer than `20261027000000`. If something newer exists, rename this plan's migration to sort after it and update the Global Constraints line.

- [ ] **Step 3: Baseline the gates**

Run:
```bash
.venv/bin/python -m pytest backend/tests/unit/test_learning_events_schema.py -q
npx tsc -p tsconfig.app.json --noEmit
npx vitest run src/features/spaces/__tests__/reading.test.ts src/features/spaces/__tests__/landing.test.tsx --no-file-parallelism
```
Expected: all pass. Write down any pre-existing failure before changing code.

---

### Task 1: The event catalog learns v4, and one writer for all of it

**Files:**
- Modify: `backend/schemas/learning_events.py`
- Create: `supabase/migrations/20261027000000_v4_reader_telemetry_events.sql`
- Modify: `backend/repositories/event_repo.py`
- Test: `backend/tests/unit/test_learning_events_schema.py`, `backend/tests/unit/test_event_repo_record.py`, `backend/tests/db/test_learning_events_schema_db.py`

**Interfaces:**
- Produces: `record_event(conn, user_id: str, event_type: str, event_data: dict) -> bool` in `backend.repositories.event_repo`; event type `checkpoint_attempt` with payload `{lectureId: str, slideId: str|None, page: int, idea: str, kind: 'choice'|'order'|'fdHolds'|'closure'|'bcnf'|'teach', correct: bool, sessionId: str, timestamp: str, source: str}`; optional `page`, `source`, `idea`, `kind`, `fromPage`, `toPage` fields as listed in Step 3.

- [ ] **Step 1: Write the failing schema tests**

In `backend/tests/unit/test_learning_events_schema.py`, add to `VALID_PAYLOADS` (after `"onboarding_completed"`):

```python
    # v4 reader (plan 1): a checkpoint or teach-back result, graded on the server.
    "checkpoint_attempt": {
        "lectureId": "L1", "slideId": "sl1", "page": 12, "idea": "BCNF", "kind": "choice",
        "correct": False, "sessionId": "s1", "timestamp": "2026-10-27T00:00:00Z", "source": "v4_reader",
    },
```

Change the count in `test_registry_covers_exactly_the_audited_catalog` from `16` to `17`, and append these tests at the end of the file:

```python
def test_v4_slide_view_carries_page_and_source_and_may_lack_a_slide_row():
    validate_event("slide_view", {
        "lectureId": "L1", "slideId": None, "page": 3, "duration_seconds": 40,
        "sessionId": "s1", "timestamp": "2026-10-27T00:00:00Z", "source": "v4_reader",
    })


def test_v4_help_query_names_explain_or_ask_and_nothing_else():
    base = {"lectureId": "L1", "slideId": "sl1", "page": 12, "sessionId": "s1", "query": "",
            "timestamp": "2026-10-27T00:00:00Z", "source": "v4_reader"}
    validate_event("ai_tutor_query", {**base, "kind": "explain"})
    validate_event("ai_tutor_query", {**base, "kind": "ask", "query": "Why BCNF?"})
    with pytest.raises(ValidationError):
        validate_event("ai_tutor_query", {**base, "kind": "chat"})


def test_v4_check_in_is_a_confidence_rating_on_an_idea():
    validate_event("confidence_rating", {
        "lectureId": "L1", "slideId": None, "page": 9, "idea": "Joins", "rating": "confused",
        "sessionId": "s1", "timestamp": "2026-10-27T00:00:00Z", "source": "v4_reader",
    })


def test_v4_back_navigation_and_completion_validate():
    validate_event("slide_back_navigation", {
        "lectureId": "L1", "fromSlideId": "a", "toSlideId": "b", "fromPage": 8, "toPage": 7,
        "sessionId": "s1", "timestamp": "2026-10-27T00:00:00Z", "source": "v4_reader",
    })
    validate_event("lecture_complete", {
        "lectureId": "L1", "sessionId": "s1", "completed_at": "2026-10-27T00:00:00Z",
        "total_duration_seconds": 900, "source": "v4_reader",
    })


def test_checkpoint_attempt_rejects_an_unknown_kind():
    with pytest.raises(ValidationError):
        validate_event("checkpoint_attempt", {**VALID_PAYLOADS["checkpoint_attempt"], "kind": "essay"})
```

- [ ] **Step 2: Run them to see them fail**

Run: `.venv/bin/python -m pytest backend/tests/unit/test_learning_events_schema.py -q`
Expected: FAIL — `checkpoint_attempt` unknown, count 16 ≠ 17, extra fields forbidden.

- [ ] **Step 3: Extend the payload models**

In `backend/schemas/learning_events.py`, replace the bodies of these classes exactly:

```python
class SlideView(_EventPayload):
    lectureId: str
    # Optional: a v4 page whose lecture has no slides row still counts as reading.
    slideId: str | None = None
    slideTitle: str | None = None
    duration_seconds: int
    sessionId: str
    timestamp: str
    page: int | None = None
    source: str | None = None


class QuizAttempt(_EventPayload):
    lectureId: str
    slideId: str | None = None
    slideTitle: str | None = None
    questionId: str
    correct: bool
    selectedAnswer: int | None = None
    sessionId: str
    timestamp: str
    time_to_answer_seconds: int | None = None
    source: str | None = None


class QuizRetryAttempt(_EventPayload):
    lectureId: str
    slideId: str | None = None
    slideTitle: str | None = None
    questionId: str
    correct: bool
    selectedAnswer: int | None = None
    firstAttemptAnswer: int | None = None
    reviewIndex: int
    sessionId: str
    timestamp: str
    source: str | None = None


class LectureComplete(_EventPayload):
    lectureId: str
    # The old reader sends both; the v4 reader grants XP elsewhere and leaves them out.
    xpEarned: int | None = None
    correctAnswers: int | None = None
    sessionId: str
    completed_at: str
    total_duration_seconds: int | None = None
    source: str | None = None


class AiTutorQuery(_EventPayload):
    lectureId: str
    slideId: str | None = None
    slideTitle: str | None = None
    sessionId: str
    query: str
    # No `response`: the model's reply is derivable from the lesson and was
    # being kept forever next to the question (audit Q-B-F4). extra="forbid"
    # on the base turns any attempt to send it into a validation error.
    timestamp: str
    page: int | None = None
    #: v4: which reader move asked for help. Explain sends an empty query.
    kind: Literal["explain", "ask"] | None = None
    source: str | None = None
```

```python
class SlideBackNavigation(_EventPayload):
    lectureId: str
    fromSlideId: str | None = None
    toSlideId: str | None = None
    sessionId: str
    timestamp: str
    fromPage: int | None = None
    toPage: int | None = None
    source: str | None = None


class ConfidenceRating(_EventPayload):
    lectureId: str
    # Optional: the v4 check-in rates an idea (a page range), anchored on its first page.
    slideId: str | None = None
    slideTitle: str | None = None
    rating: Literal["got_it", "unsure", "confused"]
    sessionId: str
    timestamp: str
    page: int | None = None
    idea: str | None = None
    source: str | None = None
```

Add after `OnboardingCompleted`:

```python
class CheckpointAttempt(_EventPayload):
    """A checkpoint or teach-back result from the v4 reader, graded on the
    server (`v4_rehearsal_service.grade_answer`, the teach-back judge), so an
    owner's view never rests on the browser's word. One row per question."""

    lectureId: str
    slideId: str | None = None
    page: int
    idea: str
    kind: Literal["choice", "order", "fdHolds", "closure", "bcnf", "teach"]
    correct: bool
    sessionId: str
    timestamp: str
    source: str | None = None
```

Add to `EVENT_REGISTRY` after `"onboarding_completed": OnboardingCompleted,`:

```python
    "checkpoint_attempt": CheckpointAttempt,
```

- [ ] **Step 4: Run the schema tests again**

Run: `.venv/bin/python -m pytest backend/tests/unit/test_learning_events_schema.py -q`
Expected: PASS.

- [ ] **Step 5: Write the failing writer tests**

Create `backend/tests/unit/test_event_repo_record.py`:

```python
"""record_event: one validated write path for asyncpg callers (the v4 reader)."""
from __future__ import annotations

import asyncio
import json

from backend.repositories.event_repo import record_event


class _Savepoint:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        self.conn.savepoints += 1

    async def __aexit__(self, *exc):
        return False


class FakeConn:
    def __init__(self, fail: bool = False):
        self.fail = fail
        self.savepoints = 0
        self.rows: list[tuple[str, str, dict]] = []

    def transaction(self):
        return _Savepoint(self)

    async def execute(self, sql, *args):
        if self.fail:
            raise RuntimeError("new row violates check constraint")
        user_id, event_type, data = args
        self.rows.append((user_id, event_type, json.loads(data)))


GOOD = {"lectureId": "L1", "slideId": None, "page": 2, "duration_seconds": 5,
        "sessionId": "s1", "timestamp": "2026-10-27T00:00:00Z", "source": "v4_reader"}


def test_a_valid_event_is_written_in_a_savepoint():
    conn = FakeConn()
    assert asyncio.run(record_event(conn, "u1", "slide_view", GOOD)) is True
    assert conn.savepoints == 1
    assert conn.rows == [("u1", "slide_view", GOOD)]


def test_a_payload_the_registry_refuses_is_dropped_not_raised():
    conn = FakeConn()
    assert asyncio.run(record_event(conn, "u1", "slide_view", {**GOOD, "response": "x"})) is False
    assert asyncio.run(record_event(conn, "u1", "made_up", GOOD)) is False
    assert conn.rows == []


def test_a_write_the_database_refuses_is_dropped_not_raised():
    conn = FakeConn(fail=True)
    assert asyncio.run(record_event(conn, "u1", "slide_view", GOOD)) is False
```

- [ ] **Step 6: Run them to see them fail**

Run: `.venv/bin/python -m pytest backend/tests/unit/test_event_repo_record.py -q`
Expected: FAIL — `ImportError: cannot import name 'record_event'`.

- [ ] **Step 7: Write `record_event`**

In `backend/repositories/event_repo.py`, add `import json` under `import logging`, and add this function after `insert_event`:

```python
async def record_event(conn: Any, user_id: str, event_type: str, event_data: dict[str, Any]) -> bool:
    """Validate and write one ``learning_events`` row on an open asyncpg connection.

    The asyncpg twin of :func:`insert_event`, for writers that already hold a
    connection (the v4 reader). Telemetry never costs the caller its own
    work: the insert runs in a savepoint, so inside a caller's transaction a
    refused row rolls back alone, and a payload the registry rejects or a
    write the database refuses is logged and dropped. Returns whether the
    row was written. The analytics cache is invalidated by the table's own
    trigger, so nothing is enqueued here.
    """
    try:
        validate_event(event_type, event_data)
    except Exception:  # noqa: BLE001 — UnknownEventTypeError or ValidationError
        logger.warning("learning event %s rejected by the registry", event_type, exc_info=True)
        return False
    try:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO learning_events (user_id, event_type, event_data) VALUES ($1::uuid, $2, $3::jsonb)",
                user_id,
                event_type,
                json.dumps(event_data),
            )
    except Exception:  # noqa: BLE001 — telemetry must not fail the request
        logger.warning("learning event %s not written", event_type, exc_info=True)
        return False
    return True
```

- [ ] **Step 8: Run the writer tests**

Run: `.venv/bin/python -m pytest backend/tests/unit/test_event_repo_record.py backend/tests/unit/test_learning_events_schema.py -q`
Expected: PASS.

- [ ] **Step 9: Write the migration**

Create `supabase/migrations/20261027000000_v4_reader_telemetry_events.sql`:

```sql
-- v4 reader telemetry (docs/superpowers/plans/2026-10-26-how-its-landing-plan-1-reader-telemetry.md):
-- one new governed event type, `checkpoint_attempt` — a checkpoint or
-- teach-back result from the v4 reader, graded on the server.
--
-- Lockstep: backend/schemas/learning_events.py (CheckpointAttempt,
-- EVENT_REGISTRY). Must sort after 20260731000000, which last re-declared
-- this constraint on the partitioned parent.
--
-- Apply to prod BEFORE deploying the backend that writes checkpoint_attempt.

ALTER TABLE public.learning_events
    DROP CONSTRAINT IF EXISTS learning_events_event_type_check;

ALTER TABLE public.learning_events
    ADD CONSTRAINT learning_events_event_type_check
    CHECK (event_type IN (
        'lecture_start',
        'slide_view',
        'quiz_attempt',
        'quiz_retry_attempt',
        'lecture_complete',
        'ai_tutor_query',
        'micro_quiz_attempt',
        'login',
        'slide_back_navigation',
        'confidence_rating',
        'search_performed',
        'exam_generated',
        'exam_submitted',
        'review_graded',
        'lecture_uploaded',
        'onboarding_completed',
        'checkpoint_attempt'
    ));

COMMENT ON CONSTRAINT learning_events_event_type_check ON public.learning_events IS
    'P5-1 event schema governance: event_type must be one of the catalog '
    'in backend/schemas/learning_events.py (EVENT_REGISTRY). Extended with '
    'checkpoint_attempt by 20261027000000.';
```

- [ ] **Step 10: Add the DB test**

Append to `backend/tests/db/test_learning_events_schema_db.py`:

```python
def test_checkpoint_attempt_accepted(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        _insert_event(cur, uid, "checkpoint_attempt", '{"lectureId": "L1", "page": 3}')
        cur.execute(
            "SELECT count(*) FROM public.learning_events WHERE user_id = %s AND event_type = 'checkpoint_attempt'",
            (str(uid),),
        )
        assert cur.fetchone()[0] == 1
```

Run (if Docker is up): `.venv/bin/python -m pytest -m db backend/tests/db/test_learning_events_schema_db.py -q`
Expected: PASS. If Docker is unavailable, say so in the task report; do not skip silently.

- [ ] **Step 11: Commit**

```bash
git add backend/schemas/learning_events.py backend/repositories/event_repo.py \
  supabase/migrations/20261027000000_v4_reader_telemetry_events.sql \
  backend/tests/unit/test_learning_events_schema.py backend/tests/unit/test_event_repo_record.py \
  backend/tests/db/test_learning_events_schema_db.py
git commit -m "feat(events): v4 fields, checkpoint_attempt, and one validated asyncpg writer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Small telemetry helpers the routes share

**Files:**
- Create: `backend/services/v4_telemetry.py`
- Test: `backend/tests/unit/test_v4_telemetry.py`

**Interfaces:**
- Consumes: `record_event` (Task 1).
- Produces (all in `backend.services.v4_telemetry`):
  - `SOURCE = "v4_reader"`
  - `now_iso() -> str`
  - `session_or_new(session_id: str) -> str`
  - `async slide_id_for(conn, lecture_id: UUID, page: int) -> str | None`
  - `async record_help(lecture_id: UUID, user_id: str, page: int, kind: Literal['explain','ask'], query: str, session_id: str) -> None`
  - `async record_check_in(lecture_id: UUID, user_id: str, page: int, idea: str, rating: Literal['got_it','confused'], session_id: str) -> None`
  - `async record_checkpoint(lecture_id: UUID, user_id: str, page: int, idea: str, kind: str, correct: bool, session_id: str) -> None`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_v4_telemetry.py`:

```python
"""The v4 reader's small telemetry writers: one connection, one validated row, never a raised error."""
from __future__ import annotations

import asyncio
import uuid

import backend.services.v4_telemetry as tel

LEC = uuid.UUID("11111111-1111-1111-1111-111111111111")
SLIDE = "33333333-3333-3333-3333-333333333333"


def _fake_db(monkeypatch, *, slide=SLIDE, fail_connect=False):
    written: list[tuple[str, str, dict]] = []

    class Conn:
        async def fetchval(self, sql, *args):
            assert "FROM slides" in sql
            return slide

    class Ctx:
        async def __aenter__(self):
            return Conn()

        async def __aexit__(self, *exc):
            return False

    async def connect():
        if fail_connect:
            raise OSError("db down")
        return Ctx()

    async def record(conn, user_id, event_type, data):
        written.append((user_id, event_type, data))
        return True

    monkeypatch.setattr(tel, "get_db_connection", connect)
    monkeypatch.setattr(tel, "record_event", record)
    return written


def test_help_is_an_ai_tutor_query_on_its_page(monkeypatch):
    written = _fake_db(monkeypatch)
    asyncio.run(tel.record_help(LEC, "u1", 12, "ask", "Why BCNF?", "s1"))
    [(uid, kind, data)] = written
    assert (uid, kind) == ("u1", "ai_tutor_query")
    assert data["lectureId"] == str(LEC) and data["slideId"] == SLIDE and data["page"] == 12
    assert data["kind"] == "ask" and data["query"] == "Why BCNF?" and data["sessionId"] == "s1"
    assert data["source"] == "v4_reader" and data["timestamp"]


def test_check_in_and_checkpoint_rows(monkeypatch):
    written = _fake_db(monkeypatch, slide=None)
    asyncio.run(tel.record_check_in(LEC, "u1", 9, "Joins", "confused", "s1"))
    asyncio.run(tel.record_checkpoint(LEC, "u1", 9, "Joins", "choice", False, "s1"))
    (_, k1, d1), (_, k2, d2) = written
    assert k1 == "confidence_rating" and d1["rating"] == "confused" and d1["idea"] == "Joins" and d1["slideId"] is None
    assert k2 == "checkpoint_attempt" and d2["kind"] == "choice" and d2["correct"] is False and d2["page"] == 9


def test_a_database_that_is_down_costs_nothing(monkeypatch):
    _fake_db(monkeypatch, fail_connect=True)
    asyncio.run(tel.record_help(LEC, "u1", 1, "explain", "", "s1"))  # must not raise


def test_a_missing_session_becomes_a_fresh_one():
    assert tel.session_or_new("abc") == "abc"
    fresh = tel.session_or_new("")
    assert fresh and fresh != tel.session_or_new("")
```

- [ ] **Step 2: Run them to see them fail**

Run: `.venv/bin/python -m pytest backend/tests/unit/test_v4_telemetry.py -q`
Expected: FAIL — `ModuleNotFoundError: backend.services.v4_telemetry`.

- [ ] **Step 3: Write the module**

Create `backend/services/v4_telemetry.py`:

```python
"""What the v4 reader tells the insight engine, written one validated row at a time.

The routes call these after their own work is settled. Each opens its own
connection, looks up the page's ``slides.id`` (the key the engine joins on;
null when the lecture has no slides row for that page), and writes through
``record_event`` — so a refused row, or a database that is down, is logged
and costs the reader nothing.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from backend.core.database import get_db_connection
from backend.repositories.event_repo import record_event

logger = logging.getLogger(__name__)

SOURCE = "v4_reader"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def session_or_new(session_id: str) -> str:
    """The reader's session, or a fresh one: an older client sends none, and one row per request beats a shared bucket."""
    return session_id or str(uuid.uuid4())


async def slide_id_for(conn: Any, lecture_id: UUID, page: int) -> str | None:
    sid = await conn.fetchval(
        "SELECT id FROM slides WHERE lecture_id = $1 AND slide_number = $2 LIMIT 1", lecture_id, page
    )
    return str(sid) if sid else None


async def _write(lecture_id: UUID, user_id: str, page: int, event_type: str, data: dict[str, Any]) -> None:
    try:
        async with await get_db_connection() as conn:
            data = {"lectureId": str(lecture_id), "slideId": await slide_id_for(conn, lecture_id, page), **data}
            await record_event(conn, user_id, event_type, data)
    except Exception:  # noqa: BLE001 — telemetry must not fail the request
        logger.warning("v4 telemetry: %s for %s p%s not written", event_type, lecture_id, page, exc_info=True)


async def record_help(
    lecture_id: UUID, user_id: str, page: int, kind: Literal["explain", "ask"], query: str, session_id: str
) -> None:
    """Explain opened or a question asked on a page. The question is kept; the reply never is."""
    await _write(lecture_id, user_id, page, "ai_tutor_query", {
        "page": page, "kind": kind, "query": query[:400], "sessionId": session_id,
        "timestamp": now_iso(), "source": SOURCE,
    })


async def record_check_in(
    lecture_id: UUID, user_id: str, page: int, idea: str, rating: Literal["got_it", "confused"], session_id: str
) -> None:
    """The quiet "Clicked / Still foggy" at an idea's checkpoint, anchored on the idea's first page."""
    await _write(lecture_id, user_id, page, "confidence_rating", {
        "page": page, "idea": idea[:60], "rating": rating, "sessionId": session_id,
        "timestamp": now_iso(), "source": SOURCE,
    })


async def record_checkpoint(
    lecture_id: UUID, user_id: str, page: int, idea: str, kind: str, correct: bool, session_id: str
) -> None:
    """One checkpoint question or teach-back, graded on the server."""
    await _write(lecture_id, user_id, page, "checkpoint_attempt", {
        "page": page, "idea": idea[:60], "kind": kind, "correct": correct, "sessionId": session_id,
        "timestamp": now_iso(), "source": SOURCE,
    })
```

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest backend/tests/unit/test_v4_telemetry.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/v4_telemetry.py backend/tests/unit/test_v4_telemetry.py
git commit -m "feat(v4): telemetry helpers for help, check-ins and checkpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Reading pings carry the session, the way back and the finish

**Files:**
- Modify: `backend/services/v4_reading_service.py`
- Modify: `backend/api/v1/v4_reader.py` (`_Reading`, `reader_progress`)
- Test: `backend/tests/unit/test_v4_reading_telemetry.py`

**Interfaces:**
- Consumes: `record_event` (Task 1); `now_iso`, `session_or_new`, `slide_id_for`, `SOURCE` (Task 2).
- Produces: `record_reading(lecture_id: UUID, user_id: str, page: int, seconds: float, *, session_id: str, to_page: int | None = None) -> dict` (same return shape as today). Request body `{page, seconds, session_id?: str, to_page?: int}`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_v4_reading_telemetry.py`:

```python
"""A v4 progress ping: progress as before, plus a validated slide_view, the way back, and the finish."""
from __future__ import annotations

import asyncio
import uuid

import backend.services.v4_reading_service as svc

LEC = uuid.UUID("11111111-1111-1111-1111-111111111111")


class _Tx:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeConn:
    """Answers the reading service's queries; remembers what it was told to write."""

    def __init__(self, *, total=12, read_after=None, completed_at=None, durations=0):
        self.total = total
        self.read_after = read_after or [1, 2, 3]
        self.completed_at = completed_at
        self.durations = durations
        self.updates: list[str] = []

    def transaction(self):
        return _Tx()

    async def fetchrow(self, sql, *args):
        if "FROM lectures" in sql:
            return {"course_id": uuid.uuid4(), "total": self.total}
        if "INSERT INTO student_progress" in sql:
            return {"completed_slides": self.read_after, "completed_at": self.completed_at}
        raise AssertionError(sql)

    async def fetchval(self, sql, *args):
        if "lecture_visits" in sql:
            return True  # a recent visit: no new row
        if "FROM slides" in sql:
            return f"slide-{args[1]}"
        if "SUM(" in sql:
            return self.durations
        raise AssertionError(sql)

    async def execute(self, sql, *args):
        self.updates.append(sql)


def _run(monkeypatch, conn, **kw):
    events: list[tuple[str, dict]] = []

    class Ctx:
        async def __aenter__(self):
            return conn

        async def __aexit__(self, *exc):
            return False

    async def connect():
        return Ctx()

    async def record(c, user_id, event_type, data):
        events.append((event_type, data))
        return True

    monkeypatch.setattr(svc, "get_db_connection", connect)
    monkeypatch.setattr(svc, "record_event", record)
    out = asyncio.run(svc.record_reading(LEC, "u1", **kw))
    return out, events


def test_a_page_read_writes_a_slide_view_with_its_session(monkeypatch):
    _, events = _run(monkeypatch, FakeConn(), page=3, seconds=40.4, session_id="s1")
    [(kind, data)] = events
    assert kind == "slide_view"
    assert data == {
        "lectureId": str(LEC), "slideId": "slide-3", "page": 3, "duration_seconds": 40,
        "sessionId": "s1", "timestamp": data["timestamp"], "source": "v4_reader",
    }


def test_turning_back_is_recorded_even_after_a_glance(monkeypatch):
    _, events = _run(monkeypatch, FakeConn(), page=8, seconds=1.0, session_id="s1", to_page=7)
    assert [k for k, _ in events] == ["slide_back_navigation"]
    back = events[0][1]
    assert (back["fromSlideId"], back["toSlideId"], back["fromPage"], back["toPage"]) == ("slide-8", "slide-7", 8, 7)


def test_turning_forward_is_not_a_way_back(monkeypatch):
    _, events = _run(monkeypatch, FakeConn(), page=3, seconds=10, session_id="s1", to_page=4)
    assert [k for k, _ in events] == ["slide_view"]


def test_the_last_unread_page_finishes_the_lesson_once(monkeypatch):
    conn = FakeConn(total=3, read_after=[1, 2, 3], completed_at=None, durations=125)
    out, events = _run(monkeypatch, conn, page=3, seconds=20, session_id="s1")
    assert [k for k, _ in events] == ["slide_view", "lecture_complete"]
    done = events[1][1]
    assert done["total_duration_seconds"] == 125 and done["sessionId"] == "s1" and done["source"] == "v4_reader"
    assert any("completed_at = now()" in u for u in conn.updates)
    assert out == {"pagesRead": 3, "percentComplete": 100}


def test_an_already_finished_lesson_does_not_finish_again(monkeypatch):
    import datetime

    conn = FakeConn(total=3, read_after=[1, 2, 3], completed_at=datetime.datetime.now())
    _, events = _run(monkeypatch, conn, page=2, seconds=20, session_id="s1")
    assert [k for k, _ in events] == ["slide_view"]
```

- [ ] **Step 2: Run them to see them fail**

Run: `.venv/bin/python -m pytest backend/tests/unit/test_v4_reading_telemetry.py -q`
Expected: FAIL — `record_reading() got an unexpected keyword argument 'session_id'` / no `record_event` attribute.

- [ ] **Step 3: Rewrite the tail of `record_reading`**

In `backend/services/v4_reading_service.py`:

Replace `import json` with nothing (no longer used) and add under the `get_db_connection` import:

```python
from backend.repositories.event_repo import record_event
from backend.services.v4_telemetry import SOURCE, now_iso, slide_id_for
```

Add after `_STREAK_SQL`:

```python
_SECONDS_READ_SQL = """
SELECT COALESCE(SUM((event_data->>'duration_seconds')::int), 0)
FROM learning_events
WHERE user_id = $1::uuid AND event_type = 'slide_view' AND event_data->>'lectureId' = $2
"""
```

Replace the whole `record_reading` function with:

```python
async def record_reading(
    lecture_id: UUID,
    user_id: str,
    page: int,
    seconds: float,
    *,
    session_id: str,
    to_page: int | None = None,
) -> dict[str, Any]:
    """The page just left. Progress, visit and streak as the old reader writes
    them; then, for the insight engine, a slide_view (read for 2 s or more),
    a way back (the next page is an earlier one), and the finish (the last
    unread page). Events go through ``record_event``: a refused one never
    rolls back the progress around it."""
    async with await get_db_connection() as conn:
        async with conn.transaction():
            lec = await conn.fetchrow(
                "SELECT course_id, COALESCE(total_slides, 0) AS total FROM lectures WHERE id = $1",
                lecture_id,
            )
            if not lec:
                raise HTTPException(status_code=404, detail="Lecture not found.")
            total = lec["total"]
            if total and page > total:
                raise HTTPException(status_code=422, detail="No such page.")

            counted = seconds >= MIN_SECONDS_TO_COUNT
            row = await conn.fetchrow(_PROGRESS_SQL, user_id, lecture_id, page, counted)
            read = len(row["completed_slides"] or [])

            if not await conn.fetchval(_RECENT_VISIT_SQL, user_id, lecture_id):
                await conn.execute(
                    "INSERT INTO lecture_visits (user_id, lecture_id, course_id) VALUES ($1::uuid, $2, $3)",
                    user_id, lecture_id, lec["course_id"],
                )
                if lec["course_id"]:
                    await conn.execute(_COURSE_VISIT_SQL, user_id, lec["course_id"])

            await conn.execute(_STREAK_SQL, user_id)

            stamp = now_iso()
            here = await slide_id_for(conn, lecture_id, page)
            if counted:
                await record_event(conn, user_id, "slide_view", {
                    "lectureId": str(lecture_id), "slideId": here, "page": page,
                    "duration_seconds": round(seconds), "sessionId": session_id,
                    "timestamp": stamp, "source": SOURCE,
                })
            if to_page is not None and to_page < page:
                await record_event(conn, user_id, "slide_back_navigation", {
                    "lectureId": str(lecture_id), "fromSlideId": here,
                    "toSlideId": await slide_id_for(conn, lecture_id, to_page),
                    "fromPage": page, "toPage": to_page, "sessionId": session_id,
                    "timestamp": stamp, "source": SOURCE,
                })

            if total and read >= total and row["completed_at"] is None:
                await conn.execute(
                    "UPDATE student_progress SET completed_at = now() "
                    "WHERE user_id = $1::uuid AND lecture_id = $2",
                    user_id, lecture_id,
                )
                await record_event(conn, user_id, "lecture_complete", {
                    "lectureId": str(lecture_id), "sessionId": session_id, "completed_at": stamp,
                    "total_duration_seconds": int(await conn.fetchval(_SECONDS_READ_SQL, user_id, str(lecture_id))),
                    "source": SOURCE,
                })

    if total and read >= total:
        percent = 100
    else:
        percent = min(100, round(read / total * 100)) if total else 0
    return {"pagesRead": read, "percentComplete": percent}
```

- [ ] **Step 4: Widen the route body**

In `backend/api/v1/v4_reader.py`, replace `_Reading` and `reader_progress` with:

```python
class _Reading(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page: int = Field(ge=1, le=2000)
    #: Time spent on the page being left, net of time it was covered or hidden; under 2 s it is not counted as read.
    seconds: float = Field(ge=0, le=6 * 3600)
    #: One per open reader (the browser's), so one sitting can be told from the next.
    session_id: str = Field(default="", max_length=64)
    #: The page now in view, when the reader moved; an earlier page is a way back.
    to_page: int | None = Field(default=None, ge=1, le=2000)


@router.post("/lectures/{lecture_id}/progress")
@limiter.limit("240/minute")
async def reader_progress(
    request: Request,
    lecture_id: UUID,
    body: _Reading,
    user: Any = Depends(verify_token),
):
    """The page the reader just left. Writes the rows the old reader writes —
    progress, visits, streak, a slide_view — plus the way back and the finish."""
    from backend.services.v4_reading_service import record_reading
    from backend.services.v4_telemetry import session_or_new

    uid = await _lecture_access(lecture_id, user)
    return await record_reading(
        lecture_id, uid, body.page, body.seconds, session_id=session_or_new(body.session_id), to_page=body.to_page
    )
```

- [ ] **Step 5: Run the tests**

Run: `.venv/bin/python -m pytest backend/tests/unit/test_v4_reading_telemetry.py backend/tests/unit/test_v4_reader_service.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/v4_reading_service.py backend/api/v1/v4_reader.py backend/tests/unit/test_v4_reading_telemetry.py
git commit -m "feat(v4-reader): sessions, the way back and the finish in every progress ping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Practice tells a first try from a retry

**Files:**
- Modify: `backend/services/v4_practice_service.py`
- Modify: `backend/api/v1/v4_reader.py` (`_Answer`, `reader_practice_answer`)
- Test: `backend/tests/unit/test_v4_practice_retry.py`

**Interfaces:**
- Consumes: `record_event` (Task 1), `now_iso`, `session_or_new` (Task 2).
- Produces: `answer(lecture_id: UUID, user_id: str, question_id: UUID, chosen: str, *, session_id: str) -> dict` (same return shape). Request body `{question_id, answer, session_id?: str}`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_v4_practice_retry.py`:

```python
"""The first answer to a question is a quiz_attempt; every later one is a quiz_retry_attempt."""
from __future__ import annotations

import asyncio
import json
import uuid

import backend.services.v4_practice_service as svc

LEC = uuid.UUID("11111111-1111-1111-1111-111111111111")
Q = uuid.UUID("44444444-4444-4444-4444-444444444444")
SLIDE = uuid.UUID("33333333-3333-3333-3333-333333333333")


class _Tx:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeConn:
    def __init__(self, prior: int, first_answer=None):
        self.prior = prior
        self.first_answer = first_answer

    def transaction(self):
        return _Tx()

    async def fetchrow(self, sql, *args):
        if "FROM quiz_questions" in sql:
            return {"id": Q, "question_text": "Which?", "options": json.dumps(["a", "b", "c"]),
                    "correct_answer": 1, "metadata": "{}", "slide_number": 4, "slide_id": SLIDE}
        if "FROM learning_events" in sql:
            return {"n": self.prior, "first_answer": self.first_answer}
        raise AssertionError(sql)

    async def fetchval(self, sql, *args):
        return None  # XP already granted once: nothing inserted

    async def execute(self, sql, *args):
        return None


def _run(monkeypatch, conn, chosen):
    events = []

    class Ctx:
        async def __aenter__(self):
            return conn

        async def __aexit__(self, *exc):
            return False

    async def connect():
        return Ctx()

    async def record(c, user_id, event_type, data):
        events.append((event_type, data))
        return True

    monkeypatch.setattr(svc, "get_db_connection", connect)
    monkeypatch.setattr(svc, "record_event", record)
    out = asyncio.run(svc.answer(LEC, "u1", Q, chosen, session_id="s1"))
    return out, events


def test_the_first_answer_is_a_first_try(monkeypatch):
    out, [(kind, data)] = _run(monkeypatch, FakeConn(prior=0), "b")
    assert out["correct"] is True
    assert kind == "quiz_attempt"
    assert data["slideId"] == str(SLIDE) and data["selectedAnswer"] == 1 and data["sessionId"] == "s1"
    assert data["source"] == "v4_practice" and data["timestamp"]


def test_a_later_answer_is_a_retry_that_remembers_the_first(monkeypatch):
    out, [(kind, data)] = _run(monkeypatch, FakeConn(prior=2, first_answer=0), "c")
    assert out["correct"] is False
    assert kind == "quiz_retry_attempt"
    assert data["reviewIndex"] == 2 and data["firstAttemptAnswer"] == 0 and data["selectedAnswer"] == 2
```

- [ ] **Step 2: Run them to see them fail**

Run: `.venv/bin/python -m pytest backend/tests/unit/test_v4_practice_retry.py -q`
Expected: FAIL — `answer() got an unexpected keyword argument 'session_id'`.

- [ ] **Step 3: Change `answer`**

In `backend/services/v4_practice_service.py`, add under the `get_db_connection` import:

```python
from backend.repositories.event_repo import record_event
from backend.services.v4_telemetry import now_iso
```

Add after `_QUESTIONS_SQL`:

```python
# Earlier answers by this person to this question, and what they chose first.
_PRIOR_SQL = """
SELECT count(*) AS n,
       (array_agg((event_data->>'selectedAnswer')::int ORDER BY created_at))[1] AS first_answer
FROM learning_events
WHERE user_id = $1::uuid
  AND event_type IN ('quiz_attempt', 'quiz_retry_attempt')
  AND event_data->>'questionId' = $2
"""
```

Change the signature to `async def answer(lecture_id: UUID, user_id: str, question_id: UUID, chosen: str, *, session_id: str) -> dict[str, Any]:` and replace the block from `await conn.execute(\n                "INSERT INTO learning_events` through its closing `)` with:

```python
            selected = question["choices"].index(chosen) if chosen in question["choices"] else None
            prior = await conn.fetchrow(_PRIOR_SQL, user_id, str(question_id))
            base = {
                "lectureId": str(lecture_id),
                "slideId": str(row["slide_id"]),
                "questionId": str(question_id),
                "correct": correct,
                "selectedAnswer": selected,
                "sessionId": session_id,
                "timestamp": now_iso(),
                "source": "v4_practice",
            }
            if prior and prior["n"]:
                # Second looks, restarts, a reopened bench: not first tries.
                await record_event(conn, user_id, "quiz_retry_attempt", {
                    **base, "firstAttemptAnswer": prior["first_answer"], "reviewIndex": int(prior["n"]),
                })
            else:
                await record_event(conn, user_id, "quiz_attempt", base)
```

Remove `import json` only if nothing else in the file uses it (`_choices` and `_meta` still do — keep it).

- [ ] **Step 4: Widen the route body**

In `backend/api/v1/v4_reader.py`, replace `_Answer` and `reader_practice_answer` with:

```python
class _Answer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question_id: UUID
    answer: str = Field(min_length=1, max_length=2000)
    session_id: str = Field(default="", max_length=64)


@router.post("/lectures/{lecture_id}/practice/answer")
@limiter.limit("120/minute")
async def reader_practice_answer(
    request: Request,
    lecture_id: UUID,
    body: _Answer,
    user: Any = Depends(verify_token),
):
    """Grade on the server, log a first try or a retry, and grant XP once per question."""
    from backend.services.v4_practice_service import answer
    from backend.services.v4_telemetry import session_or_new

    uid = await _lecture_access(lecture_id, user)
    return await answer(lecture_id, uid, body.question_id, body.answer, session_id=session_or_new(body.session_id))
```

- [ ] **Step 5: Run the tests**

Run: `.venv/bin/python -m pytest backend/tests/unit/test_v4_practice_retry.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/v4_practice_service.py backend/api/v1/v4_reader.py backend/tests/unit/test_v4_practice_retry.py
git commit -m "feat(v4-practice): a retry is a retry, so first-try rates stay true

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Checkpoints graded on the server; teach-back and check-in recorded; Explain and Ask counted

**Files:**
- Modify: `backend/services/v4_rehearsal_service.py`
- Modify: `backend/api/v1/v4_reader.py` (explain, ask, teach-back; new check-in and checkpoint-answer routes)
- Test: `backend/tests/unit/test_v4_checkpoint_grading.py`, `backend/tests/unit/test_v4_reader_telemetry_api.py`

**Interfaces:**
- Consumes: `record_help`, `record_check_in`, `record_checkpoint`, `session_or_new` (Task 2).
- Produces:
  - `checkpoint_key(lecture_id: UUID, revision: Any, locale: str, first: int, last: int) -> str`
  - `async cached_checkpoint(lecture_id: UUID, first: int, last: int, locale: str) -> dict | None`
  - `grade_answer(question: dict, answer: dict) -> bool`
  - `POST /api/v1/v4/reader/lectures/{id}/checkpoint/answer` body `{first, last, question_id: int, answer: {kind, …}, session_id?}` → `{correct: bool}`; 409 when the checkpoint is not cached.
  - `POST /api/v1/v4/reader/lectures/{id}/check-in` body `{first, last, idea, rating: 'got_it'|'confused', session_id?}` → 204.
  - Explain accepts an optional body `{session_id?}`; Ask, teach-back accept `session_id?`.

- [ ] **Step 1: Write the failing grading tests**

Create `backend/tests/unit/test_v4_checkpoint_grading.py`:

```python
"""Checkpoint answers are graded on the server, the same way the reader grades them (rehearsal/grade.ts)."""
from backend.services.v4_rehearsal_service import grade_answer

CHOICE = {"kind": "choice", "options": [{"text": "a"}, {"text": "b", "correct": True}, {"text": "c"}]}
ORDER = {"kind": "order", "items": ["x", "y", "z"]}
FD_HOLDS = {
    "kind": "fdHolds", "columns": ["A", "B", "C"],
    "rows": [["1", "x", "p"], ["1", "x", "q"], ["2", "y", "p"]],
    "candidates": [{"lhs": ["A"], "rhs": ["B"]}, {"lhs": ["A"], "rhs": ["C"]}],
}
CLOSURE = {"kind": "closure", "attrs": ["A", "B", "C", "D"], "start": ["A"],
           "fds": [{"lhs": ["A"], "rhs": ["B"]}, {"lhs": ["B"], "rhs": ["C"]}]}
BCNF = {"kind": "bcnf", "attrs": ["A", "B", "C"],
        "fds": [{"lhs": ["A"], "rhs": ["B", "C"]}, {"lhs": ["B"], "rhs": ["C"]}]}


def test_choice():
    assert grade_answer(CHOICE, {"kind": "choice", "index": 1})
    assert not grade_answer(CHOICE, {"kind": "choice", "index": 0})


def test_order_is_right_only_in_the_slides_order():
    assert grade_answer(ORDER, {"kind": "order", "order": [0, 1, 2]})
    assert not grade_answer(ORDER, {"kind": "order", "order": [1, 0, 2]})
    assert not grade_answer(ORDER, {"kind": "order", "order": [0, 1]})


def test_fd_holds_is_computed_from_the_rows():
    assert grade_answer(FD_HOLDS, {"kind": "fdHolds", "holds": [0]})
    assert not grade_answer(FD_HOLDS, {"kind": "fdHolds", "holds": [0, 1]})


def test_closure_is_computed():
    assert grade_answer(CLOSURE, {"kind": "closure", "attrs": ["C", "A", "B"]})
    assert not grade_answer(CLOSURE, {"kind": "closure", "attrs": ["A", "B"]})


def test_bcnf_violations_are_computed():
    assert grade_answer(BCNF, {"kind": "bcnf", "violating": [1]})
    assert not grade_answer(BCNF, {"kind": "bcnf", "violating": [0, 1]})


def test_a_mismatched_or_malformed_answer_is_simply_wrong():
    assert not grade_answer(CHOICE, {"kind": "order", "order": [0]})
    assert not grade_answer(CLOSURE, {"kind": "closure", "attrs": "ABC"})
    assert not grade_answer({"kind": "choice"}, {"kind": "choice", "index": 0})
```

- [ ] **Step 2: Run them to see them fail**

Run: `.venv/bin/python -m pytest backend/tests/unit/test_v4_checkpoint_grading.py -q`
Expected: FAIL — `ImportError: cannot import name 'grade_answer'`.

- [ ] **Step 3: Add the key, the lookup and the grader**

In `backend/services/v4_rehearsal_service.py`, add after `_holds`:

```python
def grade_answer(question: dict[str, Any], answer: dict[str, Any]) -> bool:
    """Grade one checkpoint answer the way the reader does (``rehearsal/grade.ts``):
    tool questions by computing the answer, choice and order against the
    slides. Anything malformed is simply wrong — never an error."""

    def same(got: Any, expected: set) -> bool:
        return isinstance(got, list) and len(got) == len(expected) and set(got) == expected

    try:
        kind = question.get("kind")
        if answer.get("kind") != kind:
            return False
        if kind == "choice":
            right = next((i for i, o in enumerate(question["options"]) if o.get("correct")), None)
            return right is not None and answer.get("index") == right
        if kind == "order":
            order = answer.get("order")
            return isinstance(order, list) and len(order) == len(question["items"]) and all(
                v == i for i, v in enumerate(order)
            )
        if kind == "fdHolds":
            holds = {
                i for i, fd in enumerate(question["candidates"])
                if _holds(question["columns"], question["rows"], fd["lhs"], fd["rhs"])
            }
            return same(answer.get("holds"), holds)
        fds = [(set(fd["lhs"]), set(fd["rhs"])) for fd in question["fds"]]
        if kind == "closure":
            c = _closure(set(question["start"]), fds)
            return same(answer.get("attrs"), {a for a in question["attrs"] if a in c})
        if kind == "bcnf":
            attrs = set(question["attrs"])
            violating = {i for i, (lhs, rhs) in enumerate(fds) if not rhs <= lhs and not attrs <= _closure(lhs, fds)}
            return same(answer.get("violating"), violating)
    except (KeyError, TypeError, ValueError, AttributeError):
        return False
    return False
```

Above `async def checkpoint(`, add:

```python
def checkpoint_key(lecture_id: UUID, revision: Any, locale: str, first: int, last: int) -> str:
    return f"v4reader:{CHECKPOINT_VERSION}:{lecture_id}:{revision}:{locale}:{first}-{last}"


async def cached_checkpoint(lecture_id: UUID, first: int, last: int, locale: str) -> Optional[dict[str, Any]]:
    """The checkpoint as it was served (answers included), or None once it has expired."""
    from backend.services.v4_reader_service import _lecture_row

    meta = await _lecture_row(lecture_id)
    cached = await get_cache(checkpoint_key(lecture_id, meta["content_revision"], locale, first, last))
    return cached if isinstance(cached, dict) and cached.get("questions") else None
```

In `checkpoint(...)`, replace the line building `key = f"v4reader:{CHECKPOINT_VERSION}:…"` with:

```python
    key = checkpoint_key(lecture_id, meta["content_revision"], locale, first, last)
```

- [ ] **Step 4: Run the grading tests**

Run: `.venv/bin/python -m pytest backend/tests/unit/test_v4_checkpoint_grading.py backend/tests/unit/test_v4_rehearsal_service.py -q`
Expected: PASS.

- [ ] **Step 5: Write the failing route tests**

Create `backend/tests/unit/test_v4_reader_telemetry_api.py`:

```python
"""The reader's routes record help, check-ins and server-graded checkpoints."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v1 import v4_reader
from backend.core.auth_middleware import verify_token
from backend.core.rate_limit import limiter
import backend.services.v4_rehearsal_service as rehearsal
import backend.services.v4_teachback_service as teachback
import backend.services.v4_telemetry as tel

U = "22222222-2222-2222-2222-222222222222"
L = "11111111-1111-1111-1111-111111111111"
CP = {"idea": "Joins", "first": 4, "last": 9, "questions": [
    {"id": 1, "kind": "choice", "page": 9, "idea": "Joins",
     "options": [{"text": "natural"}, {"text": "equi", "correct": True}]},
]}


@pytest.fixture
def calls(monkeypatch):
    seen: dict[str, list] = {"help": [], "check_in": [], "checkpoint": []}

    async def can_view(lecture_id, uid):
        return str(lecture_id) == L

    async def lang(uid):
        return "en"

    async def help_(*a, **k):
        seen["help"].append(a)

    async def check_in(*a, **k):
        seen["check_in"].append(a)

    async def checkpoint(*a, **k):
        seen["checkpoint"].append((a, k))

    async def explain(*a, **k):
        return {"title": "t", "blocks": [], "cached": True}

    async def ask(*a, **k):
        return {"title": "t", "blocks": [], "cached": False}

    async def cached(lecture_id, first, last, locale):
        return CP if (first, last) == (4, 9) else None

    async def teach(*a, **k):
        return {"idea": "Joins", "first": 4, "last": 9, "verdict": "partial", "points": [], "wrong": [], "next": ""}

    monkeypatch.setattr(v4_reader.service, "can_view_lecture", can_view)
    monkeypatch.setattr(v4_reader.service, "preferred_language", lang)
    monkeypatch.setattr(v4_reader.service, "explain_page", explain)
    monkeypatch.setattr(v4_reader.service, "ask_page", ask)
    monkeypatch.setattr(tel, "record_help", help_)
    monkeypatch.setattr(tel, "record_check_in", check_in)
    monkeypatch.setattr(tel, "record_checkpoint", checkpoint)
    monkeypatch.setattr(rehearsal, "cached_checkpoint", cached)
    monkeypatch.setattr(teachback, "teach_back", teach)
    return seen


@pytest.fixture
def client(calls):
    app = FastAPI()
    app.state.limiter = limiter
    app.include_router(v4_reader.router, prefix="/api/v1")
    app.dependency_overrides[verify_token] = lambda: {"id": U}
    return TestClient(app)


def test_explain_and_ask_count_as_help_on_their_page(client, calls):
    assert client.post(f"/api/v1/v4/reader/lectures/{L}/pages/12/explain", json={"session_id": "s1"}).status_code == 200
    assert client.post(f"/api/v1/v4/reader/lectures/{L}/pages/12/explain", json={}).status_code == 200
    assert client.post(f"/api/v1/v4/reader/lectures/{L}/pages/12/ask",
                       json={"question": "Why BCNF?", "session_id": "s1"}).status_code == 200
    (_, uid, page, kind, query, session), (_, _, _, kind2, _, fresh), (_, _, _, kind3, q3, _) = calls["help"]
    assert (uid, page, kind, query, session) == (U, 12, "explain", "", "s1")
    assert kind2 == "explain" and fresh and fresh != "s1"
    assert (kind3, q3) == ("ask", "Why BCNF?")


def test_a_checkpoint_answer_is_graded_and_recorded_here(client, calls):
    right = client.post(f"/api/v1/v4/reader/lectures/{L}/checkpoint/answer",
                        json={"first": 4, "last": 9, "question_id": 1, "answer": {"kind": "choice", "index": 1}, "session_id": "s1"})
    wrong = client.post(f"/api/v1/v4/reader/lectures/{L}/checkpoint/answer",
                        json={"first": 4, "last": 9, "question_id": 1, "answer": {"kind": "choice", "index": 0}})
    assert right.json() == {"correct": True} and wrong.json() == {"correct": False}
    (args, kw), _ = calls["checkpoint"]
    assert args[:2][1] == U and kw == {"page": 9, "idea": "Joins", "kind": "choice", "correct": True, "session_id": "s1"}


def test_an_expired_checkpoint_is_a_conflict_not_a_guess(client, calls):
    res = client.post(f"/api/v1/v4/reader/lectures/{L}/checkpoint/answer",
                      json={"first": 1, "last": 3, "question_id": 1, "answer": {"kind": "choice", "index": 1}})
    assert res.status_code == 409 and calls["checkpoint"] == []


def test_the_check_in_is_recorded_on_the_idea(client, calls):
    res = client.post(f"/api/v1/v4/reader/lectures/{L}/check-in",
                      json={"first": 4, "last": 9, "idea": "Joins", "rating": "confused", "session_id": "s1"})
    assert res.status_code == 204
    assert calls["check_in"] == [(rehearsal.UUID(L), U, 4, "Joins", "confused", "s1")]
    assert client.post(f"/api/v1/v4/reader/lectures/{L}/check-in",
                       json={"first": 4, "last": 9, "idea": "Joins", "rating": "meh"}).status_code == 422


def test_teach_back_records_its_verdict(client, calls):
    res = client.post(f"/api/v1/v4/reader/lectures/{L}/teach-back",
                      json={"first": 4, "last": 9, "idea": "Joins", "explanation": "A join pairs rows by a key.", "session_id": "s1"})
    assert res.status_code == 200
    [(args, kw)] = calls["checkpoint"]
    assert kw == {"page": 4, "idea": "Joins", "kind": "teach", "correct": False, "session_id": "s1"}
```

- [ ] **Step 6: Run them to see them fail**

Run: `.venv/bin/python -m pytest backend/tests/unit/test_v4_reader_telemetry_api.py -q`
Expected: FAIL — 404 for `/check-in` and `/checkpoint/answer`; Explain rejects a body; no help recorded.

- [ ] **Step 7: Wire the routes**

In `backend/api/v1/v4_reader.py`:

Change the imports at the top to:

```python
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from backend.core.auth_middleware import _user_id, verify_token
from backend.core.rate_limit import limiter
from backend.services import v4_reader_service as service
from backend.services import v4_telemetry as telemetry
from backend.services.v4_personal import is_personal
```

Replace `reader_explain` with:

```python
class _Session(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str = Field(default="", max_length=64)


@router.post("/lectures/{lecture_id}/pages/{page}/explain")
@limiter.limit("30/minute")
async def reader_explain(
    request: Request,
    lecture_id: UUID,
    page: int = Path(ge=1, le=2000),
    body: Optional[_Session] = None,
    user: Any = Depends(verify_token),
):
    uid = await _lecture_access(lecture_id, user)
    # Opening Explain is asking for help with this page, cached answer or not.
    await telemetry.record_help(
        lecture_id, uid, page, "explain", "", telemetry.session_or_new(body.session_id if body else "")
    )
    return await service.explain_page(lecture_id, page, user_id=uid, locale=await _lang(request, uid))
```

In `AskBody`, add the field `session_id: str = Field(default="", max_length=64)`, and in `reader_ask` insert before `return await service.ask_page(`:

```python
    await telemetry.record_help(lecture_id, uid, page, "ask", body.question, telemetry.session_or_new(body.session_id))
```

In `TeachBody`, add `session_id: str = Field(default="", max_length=64)`, and replace the body of `reader_teach_back` after `uid = await _lecture_access(lecture_id, user)` with:

```python
    result = await teach_back(
        lecture_id,
        body.first,
        body.last,
        body.idea,
        body.explanation,
        user_id=uid,
        locale=await _lang(request, uid),
    )
    # The judge's verdict, not the browser's: solid counts as cleared.
    await telemetry.record_checkpoint(
        lecture_id, uid,
        page=int(result["first"]), idea=str(result["idea"]), kind="teach",
        correct=result.get("verdict") == "solid", session_id=telemetry.session_or_new(body.session_id),
    )
    return result
```

Add after `reader_teach_back`:

```python
class CheckpointAnswerBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    #: The span as the checkpoint was served (its `first`/`last`), which names its cache entry.
    first: int = Field(ge=1, le=2000)
    last: int = Field(ge=1, le=2000)
    question_id: int = Field(ge=1, le=10)
    answer: dict[str, Any]
    session_id: str = Field(default="", max_length=64)


@router.post("/lectures/{lecture_id}/checkpoint/answer")
@limiter.limit("60/minute")
async def reader_checkpoint_answer(
    request: Request, body: CheckpointAnswerBody, lecture_id: UUID, user: Any = Depends(verify_token)
):
    """Grade one checkpoint answer here, against the checkpoint as served, and record it."""
    from backend.services.v4_rehearsal_service import cached_checkpoint, grade_answer

    uid = await _lecture_access(lecture_id, user)
    cp = await cached_checkpoint(lecture_id, body.first, body.last, await _lang(request, uid))
    q = next((q for q in (cp or {}).get("questions", []) if q.get("id") == body.question_id), None)
    if not cp or q is None:
        raise HTTPException(status_code=409, detail="That checkpoint is no longer open.")
    correct = grade_answer(q, body.answer)
    await telemetry.record_checkpoint(
        lecture_id, uid,
        page=int(q["page"]), idea=str(cp.get("idea") or q.get("idea") or ""), kind=str(q["kind"]),
        correct=correct, session_id=telemetry.session_or_new(body.session_id),
    )
    return {"correct": correct}


class CheckInBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    first: int = Field(ge=1, le=2000)
    last: int = Field(ge=1, le=2000)
    idea: str = Field(min_length=1, max_length=120)
    rating: Literal["got_it", "confused"]
    session_id: str = Field(default="", max_length=64)


@router.post("/lectures/{lecture_id}/check-in", status_code=204)
@limiter.limit("30/minute")
async def reader_check_in(request: Request, body: CheckInBody, lecture_id: UUID, user: Any = Depends(verify_token)):
    """The quiet check-in at an idea's checkpoint: clicked, or still foggy."""
    uid = await _lecture_access(lecture_id, user)
    await telemetry.record_check_in(
        lecture_id, uid, body.first, body.idea, body.rating, telemetry.session_or_new(body.session_id)
    )
    return Response(status_code=204)
```

Note for the implementer: `record_check_in` is called positionally `(lecture_id, uid, first, idea, rating, session)` and `record_checkpoint` with keywords after `(lecture_id, uid)` — the route tests assert exactly these shapes.

- [ ] **Step 8: Run the route tests and the neighbours**

Run: `.venv/bin/python -m pytest backend/tests/unit/test_v4_reader_telemetry_api.py backend/tests/unit/test_v4_reader_lang.py backend/tests/unit/test_v4_teachback_service.py backend/tests/unit/test_v4_checkpoint_grading.py -q`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/services/v4_rehearsal_service.py backend/api/v1/v4_reader.py \
  backend/tests/unit/test_v4_checkpoint_grading.py backend/tests/unit/test_v4_reader_telemetry_api.py
git commit -m "feat(v4-reader): server-graded checkpoints, the check-in, and help counted per page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The client can send a request that survives the tab closing

**Files:**
- Modify: `src/lib/apiClient.ts`
- Test: `src/__tests__/lib/apiClient.beacon.test.ts`

**Interfaces:**
- Produces: `apiClient.beacon(path: string, body: unknown): boolean` — a `keepalive` POST with the last access token any request used; `false` before any request.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/apiClient.beacon.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok-1' } } }) } },
}));

const ok = () => Promise.resolve(new Response('{}', { status: 200 }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('apiClient.beacon', () => {
  it('cannot send before any request has seen a token', async () => {
    const fetchMock = vi.fn(ok);
    vi.stubGlobal('fetch', fetchMock);
    const { apiClient } = await import('@/lib/apiClient');
    expect(apiClient.beacon('/api/v1/x', { a: 1 })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a keepalive POST with the last token, synchronously', async () => {
    const fetchMock = vi.fn(ok);
    vi.stubGlobal('fetch', fetchMock);
    const { apiClient } = await import('@/lib/apiClient');
    await apiClient.get('/api/v1/warm');
    fetchMock.mockClear();
    expect(apiClient.beacon('/api/v1/v4/reader/lectures/l1/progress', { page: 3 })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/v4/reader/lectures/l1/progress');
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect(init.body).toBe(JSON.stringify({ page: 3 }));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/__tests__/lib/apiClient.beacon.test.ts`
Expected: FAIL — `apiClient.beacon is not a function`.

- [ ] **Step 3: Add the beacon**

In `src/lib/apiClient.ts`, add under `let sessionPromise: Promise<any> | null = null;`:

```ts
/*
 * The last access token a request used. A page that is being hidden cannot
 * await a session refresh, so the one request that must survive it — the
 * reader's last page — goes out with this.
 */
let lastToken: string | null = null;
```

In `getAuthHeaders`, inside `if (supabaseSession.access_token) {`, add the line `lastToken = supabaseSession.access_token;` before the `headers.Authorization` assignment.

Add to the `apiClient` object, after `delete`:

```ts
  /**
   * Fire-and-forget POST that outlives the page (`keepalive`): for what a
   * closing tab must still report. Synchronous on purpose — no awaits before
   * the request leaves. False when no request has seen a token yet.
   */
  beacon: (path: string, body: unknown): boolean => {
    if (!lastToken) return false;
    try {
      void fetch(buildUrl(path), {
        method: 'POST',
        keepalive: true,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lastToken}` },
        body: JSON.stringify(body),
      }).catch(() => {});
      return true;
    } catch {
      return false;
    }
  },
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/__tests__/lib/apiClient.beacon.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/apiClient.ts src/__tests__/lib/apiClient.beacon.test.ts
git commit -m "feat(api): a keepalive beacon for what a closing tab must still send

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The live repository carries sessions, the way back, check-ins and checkpoint answers

**Files:**
- Modify: `src/features/spaces/data/liveRepository.ts`
- Test: `src/features/spaces/__tests__/telemetry-live.test.ts`

**Interfaces:**
- Consumes: `apiClient.beacon` (Task 6, through `V4Transport.beacon?`).
- Produces (on `LiveRepository`):
  - `recordReading(id: string, page: number, seconds: number, session?: string | null, toPage?: number)`
  - `recordReadingBeacon(id: string, page: number, seconds: number, session?: string | null): boolean`
  - `answerPractice(id, questionId, answer, session?: string | null)`
  - `explainPage(id, page, session?: string | null)`
  - `askPage(id, page, question, thread, session?: string | null)`
  - `teachBack(lectureId, body: { first; last; idea; explanation; session_id?: string })`
  - `checkIn(lectureId: string, body: { first: number; last: number; idea: string; rating: 'got_it' | 'confused'; session_id: string })`
  - `answerCheckpoint(lectureId: string, body: { first: number; last: number; question_id: number; answer: CheckpointAnswer; session_id: string })` → `{ correct: boolean }`
  - exported type `CheckpointAnswer` (same union as `Answer` in `components/rehearsal/grade.ts`).

- [ ] **Step 1: Write the failing test**

Create `src/features/spaces/__tests__/telemetry-live.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createLiveRepository, type V4Transport } from '../data/liveRepository';

function transport(withBeacon = true) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const http: V4Transport = {
    get: vi.fn(async (path: string) => (calls.push({ method: 'GET', path }), {})) as V4Transport['get'],
    post: vi.fn(async (path: string, body: unknown) => (calls.push({ method: 'POST', path, body }), {})) as V4Transport['post'],
    patch: vi.fn() as V4Transport['patch'],
    delete: vi.fn() as V4Transport['delete'],
    ...(withBeacon
      ? { beacon: vi.fn((path: string, body: unknown) => (calls.push({ method: 'BEACON', path, body }), true)) }
      : {}),
  };
  return { http, calls };
}

const R = '/api/v1/v4/reader/lectures';

describe('the reader’s telemetry, live', () => {
  it('a progress ping carries the session and, when the reader moved, the page now in view', async () => {
    const { http, calls } = transport();
    const repo = createLiveRepository(http);
    await repo.recordReading('l1', 8, 12.5, 's1', 7);
    await repo.recordReading('l1', 3, 4, null);
    expect(calls).toEqual([
      { method: 'POST', path: `${R}/l1/progress`, body: { page: 8, seconds: 12.5, session_id: 's1', to_page: 7 } },
      { method: 'POST', path: `${R}/l1/progress`, body: { page: 3, seconds: 4, session_id: '' } },
    ]);
  });

  it('the last page goes out as a beacon, or as a plain post when there is none', () => {
    const a = transport(true);
    expect(createLiveRepository(a.http).recordReadingBeacon('l1', 5, 30, 's1')).toBe(true);
    expect(a.calls[0]).toEqual({ method: 'BEACON', path: `${R}/l1/progress`, body: { page: 5, seconds: 30, session_id: 's1' } });
    const b = transport(false);
    expect(createLiveRepository(b.http).recordReadingBeacon('l1', 5, 30, 's1')).toBe(false);
    expect(b.calls[0]).toMatchObject({ method: 'POST', path: `${R}/l1/progress` });
  });

  it('help, practice, check-ins and checkpoint answers name their session', async () => {
    const { http, calls } = transport();
    const repo = createLiveRepository(http);
    await repo.explainPage('l1', 12, 's1');
    await repo.askPage('l1', 12, 'Why?', [], 's1');
    await repo.answerPractice('l1', 'q1', 'b', 's1');
    await repo.checkIn('l1', { first: 4, last: 9, idea: 'Joins', rating: 'confused', session_id: 's1' });
    await repo.answerCheckpoint('l1', { first: 4, last: 9, question_id: 1, answer: { kind: 'choice', index: 1 }, session_id: 's1' });
    expect(calls.map((c) => [c.path, c.body])).toEqual([
      [`${R}/l1/pages/12/explain`, { session_id: 's1' }],
      [`${R}/l1/pages/12/ask`, { question: 'Why?', thread: [], session_id: 's1' }],
      [`${R}/l1/practice/answer`, { question_id: 'q1', answer: 'b', session_id: 's1' }],
      [`${R}/l1/check-in`, { first: 4, last: 9, idea: 'Joins', rating: 'confused', session_id: 's1' }],
      [`${R}/l1/checkpoint/answer`, { first: 4, last: 9, question_id: 1, answer: { kind: 'choice', index: 1 }, session_id: 's1' }],
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/telemetry-live.test.ts`
Expected: FAIL — wrong bodies; `recordReadingBeacon`, `checkIn`, `answerCheckpoint` are not functions.

- [ ] **Step 3: Change the repository**

In `src/features/spaces/data/liveRepository.ts`:

Add to `V4Transport` after `upload?`:

```ts
  /** A keepalive POST that outlives the page; false when it could not go. Optional: only the reader's last page needs it. */
  beacon?(path: string, body: unknown): boolean;
```

Add above `const root = '/api/v1/v4';`:

```ts
/** A checkpoint answer, as the reader grades it (components/rehearsal/grade.ts `Answer`). */
export type CheckpointAnswer =
  | { kind: 'choice'; index: number }
  | { kind: 'order'; order: number[] }
  | { kind: 'fdHolds'; holds: number[] }
  | { kind: 'closure'; attrs: string[] }
  | { kind: 'bcnf'; violating: number[] };

/** What a progress ping says: the page left, its seconds, the reading session, and the page now in view. */
const readingBody = (page: number, seconds: number, session?: string | null, toPage?: number) => ({
  page,
  seconds,
  session_id: session ?? '',
  ...(toPage ? { to_page: toPage } : {}),
});
```

Replace these members of the object returned by `createLiveRepository`:

```ts
    /** The page just left, how long it was open (net of covered time), and where the reader went. */
    recordReading: (id: string, page: number, seconds: number, session?: string | null, toPage?: number) =>
      http.post<{ pagesRead: number; percentComplete: number }>(
        `${root}/reader/lectures/${idPath(id)}/progress`,
        readingBody(page, seconds, session, toPage),
      ),
    /** The page open as the tab closes: a beacon when the transport has one, else a best-effort post. */
    recordReadingBeacon: (id: string, page: number, seconds: number, session?: string | null): boolean => {
      const path = `${root}/reader/lectures/${idPath(id)}/progress`;
      const body = readingBody(page, seconds, session);
      if (http.beacon?.(path, body)) return true;
      void http.post(path, body).catch(() => {});
      return false;
    },
```

```ts
    /** Graded on the server; logs a first try or a retry and grants XP once per question. */
    answerPractice: (id: string, questionId: string, answer: string, session?: string | null) =>
      http.post<{ correct: boolean; correctAnswer: string; explanation: string; xp: number }>(
        `${root}/reader/lectures/${idPath(id)}/practice/answer`,
        { question_id: questionId, answer, session_id: session ?? '' },
      ),
```

```ts
    explainPage: (id: string, page: number, session?: string | null) =>
      http.post<ExplainAnswer & { cached: boolean }>(`${root}/reader/lectures/${idPath(id)}/pages/${page}/explain`, {
        session_id: session ?? '',
      }),
```

```ts
    teachBack: (lectureId: string, body: { first: number; last: number; idea: string; explanation: string; session_id?: string }) =>
      http.post<TeachBack>(`${root}/reader/lectures/${idPath(lectureId)}/teach-back`, body),
    /** The quiet check-in at an idea's checkpoint. */
    checkIn: (lectureId: string, body: { first: number; last: number; idea: string; rating: 'got_it' | 'confused'; session_id: string }) =>
      http.post<void>(`${root}/reader/lectures/${idPath(lectureId)}/check-in`, body),
    /** One checkpoint answer, graded and recorded on the server. */
    answerCheckpoint: (
      lectureId: string,
      body: { first: number; last: number; question_id: number; answer: CheckpointAnswer; session_id: string },
    ) => http.post<{ correct: boolean }>(`${root}/reader/lectures/${idPath(lectureId)}/checkpoint/answer`, body),
```

```ts
    askPage: (id: string, page: number, question: string, thread: { question: string; title: string }[], session?: string | null) =>
      http.post<ExplainAnswer & { cached: boolean }>(`${root}/reader/lectures/${idPath(id)}/pages/${page}/ask`, {
        question,
        thread,
        session_id: session ?? '',
      }),
```

In `withLanguage`, add after the `upload:` line:

```ts
    beacon: http.beacon ? (path: string, body: unknown) => http.beacon!(tag(path), body) : undefined,
```

- [ ] **Step 4: Run the test and the type-check**

Run: `npx vitest run src/features/spaces/__tests__/telemetry-live.test.ts && npx tsc -p tsconfig.app.json --noEmit`
Expected: PASS; `tsc` exit 0 (the call sites still compile: every new parameter is optional).

- [ ] **Step 5: Commit**

```bash
git add src/features/spaces/data/liveRepository.ts src/features/spaces/__tests__/telemetry-live.test.ts
git commit -m "feat(v4-data): reader calls carry the session; check-in and checkpoint answers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: One reading session per open reader; covered and hidden time not counted; the last page always reported

**Files:**
- Create: `src/features/spaces/data/readingSession.ts`
- Modify: `src/features/spaces/data/reading.ts`
- Modify: `src/features/spaces/data/useReader.ts`, `src/features/spaces/data/practice.ts`
- Modify: `src/features/spaces/screens/LessonFacesScreen.tsx`
- Test: `src/features/spaces/__tests__/reading.test.ts`

**Interfaces:**
- Consumes: `recordReading`, `recordReadingBeacon`, `explainPage`, `askPage`, `answerPractice`, `teachBack` (Task 7).
- Produces: `startSession(lessonId): string`, `endSession(lessonId, id): void`, `currentSession(lessonId?: string): string | null` in `data/readingSession.ts`; `useReadingProgress(lessonId, page, live, covered = false)`.

- [ ] **Step 1: Write the failing tests**

Replace `src/features/spaces/__tests__/reading.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { recordMock, beaconMock } = vi.hoisted(() => ({ recordMock: vi.fn(), beaconMock: vi.fn() }));
vi.mock('../data/liveRepository', async (orig) => ({
  ...(await orig<typeof import('../data/liveRepository')>()),
  loadLiveRepository: async () => ({ recordReading: recordMock, recordReadingBeacon: beaconMock }),
}));

import { useReadingProgress } from '../data/reading';
import { currentSession } from '../data/readingSession';

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
const at = (iso: string) => vi.setSystemTime(new Date(`2026-10-27T${iso}Z`));
let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at('10:00:00');
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  recordMock.mockReset().mockResolvedValue({ pagesRead: 1, percentComplete: 10 });
  beaconMock.mockReset().mockReturnValue(true);
});
afterEach(() => vi.useRealTimers());

describe('useReadingProgress', () => {
  it('reports the page left with its seconds, its session and the page now in view; the open page on close', async () => {
    const { rerender, unmount } = renderHook(({ page }) => useReadingProgress('lec-1', page, true), { initialProps: { page: 1 } });
    await flush();
    const session = currentSession('lec-1');
    expect(session).toBeTruthy();
    at('10:00:40');
    rerender({ page: 2 });
    await flush();
    expect(recordMock).toHaveBeenLastCalledWith('lec-1', 1, 40, session, 2);
    at('10:01:10');
    unmount();
    await flush();
    expect(recordMock).toHaveBeenLastCalledWith('lec-1', 2, 30, session, undefined);
    expect(currentSession('lec-1')).toBeNull();
  });

  it('a new open is a new session', async () => {
    const first = renderHook(() => useReadingProgress('lec-1', 1, true));
    await flush();
    const a = currentSession('lec-1');
    first.unmount();
    const second = renderHook(() => useReadingProgress('lec-1', 1, true));
    await flush();
    expect(currentSession('lec-1')).not.toBe(a);
    second.unmount();
  });

  it('time the page is covered is not counted', async () => {
    const { rerender } = renderHook(({ page, covered }) => useReadingProgress('lec-1', page, true, covered), {
      initialProps: { page: 1, covered: false },
    });
    await flush();
    at('10:00:10');
    rerender({ page: 1, covered: true });
    at('10:00:40');
    rerender({ page: 1, covered: false });
    at('10:00:50');
    rerender({ page: 2, covered: false });
    await flush();
    expect(recordMock).toHaveBeenLastCalledWith('lec-1', 1, 20, expect.any(String), 2);
  });

  it('time the tab is hidden is not counted', async () => {
    const { rerender } = renderHook(({ page }) => useReadingProgress('lec-1', page, true), { initialProps: { page: 1 } });
    await flush();
    at('10:00:05');
    visibility = 'hidden';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    at('10:05:05');
    visibility = 'visible';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    at('10:05:15');
    rerender({ page: 2 });
    await flush();
    expect(recordMock).toHaveBeenLastCalledWith('lec-1', 1, 15, expect.any(String), 2);
  });

  it('closing the tab reports the open page as a beacon, once', async () => {
    const { unmount } = renderHook(() => useReadingProgress('lec-1', 4, true));
    await flush();
    at('10:00:25');
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(beaconMock).toHaveBeenCalledWith('lec-1', 4, 25, expect.any(String));
    unmount();
    await flush();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('demo reading is never sent anywhere', async () => {
    const { rerender, unmount } = renderHook(({ page }) => useReadingProgress('lec-1', page, false), { initialProps: { page: 1 } });
    rerender({ page: 2 });
    unmount();
    await flush();
    expect(recordMock).not.toHaveBeenCalled();
    expect(beaconMock).not.toHaveBeenCalled();
  });

  it('a failed report does not throw into the reader', async () => {
    recordMock.mockRejectedValue(new Error('offline'));
    const { rerender } = renderHook(({ page }) => useReadingProgress('lec-1', page, true), { initialProps: { page: 1 } });
    await flush();
    rerender({ page: 2 });
    await flush();
    expect(recordMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/spaces/__tests__/reading.test.ts`
Expected: FAIL — `Cannot find module '../data/readingSession'`.

- [ ] **Step 3: Write the session store**

Create `src/features/spaces/data/readingSession.ts`:

```ts
/**
 * The reading session: one per open reader.
 *
 * The server needs to tell one sitting from the next (turning back within a
 * sitting, how long a sitting runs), and nothing else in the browser draws
 * that line. The reader opens a session when it mounts and closes it when it
 * goes; Explain, Ask, practice and the checkpoint read it from here, so each
 * request says which sitting it belongs to.
 */
const sessions = new Map<string, string>();

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function startSession(lessonId: string): string {
  const id = newId();
  sessions.set(lessonId, id);
  return id;
}

/** Ends this session only: a reader opened again since keeps its own. */
export function endSession(lessonId: string, id: string): void {
  if (sessions.get(lessonId) === id) sessions.delete(lessonId);
}

export function currentSession(lessonId: string | undefined): string | null {
  return (lessonId && sessions.get(lessonId)) || null;
}
```

- [ ] **Step 4: Rewrite the progress hook**

Replace `src/features/spaces/data/reading.ts` with:

```ts
import { useEffect, useRef } from 'react';
import { loadLiveRepository, type LiveRepository } from './liveRepository';
import { endSession, startSession } from './readingSession';

/**
 * Report reading to the server, page by page.
 *
 * Each time the page in view changes the page being *left* is posted with how
 * long it was really read, the reading session, and the page now in view (an
 * earlier one is a way back). Time the page sat under Explain, Luna, a
 * checkpoint or the break room (`covered`), or in a hidden tab, is not
 * counted. Closing the reader reports the open page; closing the tab reports
 * it too, as a beacon, because nothing after `pagehide` is sure to run.
 *
 * Fire-and-forget: a failed report must never interrupt reading. Live only.
 */
export function useReadingProgress(lessonId: string | undefined, page: number, live: boolean, covered = false): void {
  const clock = useRef<{ page: number; at: number; paused: number; pausedAt: number | null } | null>(null);
  const session = useRef<string | null>(null);
  const repo = useRef<LiveRepository | null>(null);
  const coveredRef = useRef(covered);

  const isPaused = () => coveredRef.current || (typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const seconds = (now: number) => {
    const c = clock.current!;
    const paused = c.paused + (c.pausedAt !== null ? now - c.pausedAt : 0);
    return Math.min(6 * 3600, Math.max(0, (now - c.at - paused) / 1000));
  };
  /* Start or stop the pause clock to match covered/hidden. */
  const syncPause = () => {
    const c = clock.current;
    if (!c) return;
    const now = Date.now();
    if (isPaused() && c.pausedAt === null) c.pausedAt = now;
    if (!isPaused() && c.pausedAt !== null) {
      c.paused += now - c.pausedAt;
      c.pausedAt = null;
    }
  };

  /* One session per open reader; the repository is loaded up front so the tab closing can report synchronously. */
  useEffect(() => {
    if (!live || !lessonId) return;
    const id = startSession(lessonId);
    session.current = id;
    let alive = true;
    loadLiveRepository()
      .then((r) => {
        if (alive) repo.current = r;
      })
      .catch(() => {});

    const onVisibility = () => syncPause();
    const onPageHide = () => {
      const c = clock.current;
      if (!c) return;
      const secs = seconds(Date.now());
      clock.current = null;
      if (repo.current) repo.current.recordReadingBeacon(lessonId, c.page, secs, id);
    };
    const onPageShow = (e: PageTransitionEvent) => {
      /* Back from the page cache: the page is open again, from now. */
      if (e.persisted) clock.current = { page: clock.current?.page ?? page, at: Date.now(), paused: 0, pausedAt: null };
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      /* Closing the reader reports the page that was open. */
      const c = clock.current;
      clock.current = null;
      if (c) send(repo.current, lessonId, c.page, seconds(Date.now()), id, undefined);
      endSession(lessonId, id);
      session.current = null;
    };
    // `page` is read only to seed a page-cache restore; the page effect below owns page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, live]);

  /* The page changed: report the one left, start the next. */
  useEffect(() => {
    if (!live || !lessonId || page < 1) return;
    const now = Date.now();
    const left = clock.current;
    if (left && left.page !== page) send(repo.current, lessonId, left.page, seconds(now), session.current, page);
    if (!left || left.page !== page) clock.current = { page, at: now, paused: 0, pausedAt: isPaused() ? now : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, page, live]);

  /* Covered or uncovered: move the pause clock. */
  useEffect(() => {
    coveredRef.current = covered;
    syncPause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [covered]);
}

function send(
  repo: LiveRepository | null,
  lessonId: string,
  page: number,
  seconds: number,
  session: string | null,
  toPage: number | undefined,
): void {
  const go = (r: LiveRepository) => r.recordReading(lessonId, page, seconds, session, toPage);
  void (repo ? go(repo) : loadLiveRepository().then(go)).catch(() => {
    /* Progress is best-effort; the reader keeps going. */
  });
}
```

- [ ] **Step 5: Run the reading tests**

Run: `npx vitest run src/features/spaces/__tests__/reading.test.ts`
Expected: PASS.

- [ ] **Step 6: Pass the session from the other reader calls**

In `src/features/spaces/data/useReader.ts`, add `import { currentSession } from './readingSession';` with the other imports, then:
- in `useExplain`, change `(await loadLiveRepository()).explainPage(lessonId, page)` to `(await loadLiveRepository()).explainPage(lessonId, page, currentSession(lessonId))`;
- in `useAsker`, change `repo.askPage(lessonId, page, question, thread)` to `repo.askPage(lessonId, page, question, thread, currentSession(lessonId))`;
- in `teachBack(...)`, change `repo.teachBack(lectureId, { first, last, idea, explanation })` to `repo.teachBack(lectureId, { first, last, idea, explanation, session_id: currentSession(lectureId) ?? '' })`.

In `src/features/spaces/data/practice.ts`, add `import { currentSession } from './readingSession';` and change the body of `submitAnswer` to:

```ts
  const repo = await loadLiveRepository();
  return repo.answerPractice(lessonId, questionId, answer, currentSession(lessonId));
```

- [ ] **Step 7: Tell the progress hook when the page is covered**

In `src/features/spaces/screens/LessonFacesScreen.tsx`, the hook runs at line ~186, before `lunaOpen`, `checkpointOpen`, `teaching`, `care` and `bench` exist. Move the call: delete

```ts
  /* Count the reading: progress, visits and the streak, page by page. */
  useReadingProgress(lessonId, pdfPage, liveReader && numPages > 0);
```

and insert, immediately after the line `const [teaching, setTeaching] = useState<…>(null);` (line ~500):

```ts
  /*
   * Count the reading: progress, visits and the streak, page by page. Time
   * the page sits under Luna, a checkpoint, the teach-back, the break room or
   * the practice bench is not reading it, so it is not counted.
   */
  useReadingProgress(
    lessonId,
    pdfPage,
    liveReader && numPages > 0,
    (lunaOn && lunaOpen) || checkpointOpen || Boolean(teaching) || care.resting || Boolean(bench),
  );
```

Check that `lunaOn` and `bench` are declared above that point (`grep -n "const lunaOn\|const \[bench\|const bench" src/features/spaces/screens/LessonFacesScreen.tsx`). If either is declared later, move this call to just after the later of the two declarations, still before the first `return`.

- [ ] **Step 8: Type-check and run the reader's suites**

Run:
```bash
npx tsc -p tsconfig.app.json --noEmit
npx vitest run src/features/spaces/__tests__/reading.test.ts src/features/spaces/__tests__/telemetry-live.test.ts src/features/spaces/screens --no-file-parallelism
```
Expected: `tsc` exit 0; tests PASS. (If a screen suite times out under machine load, rerun that file alone with `--testTimeout=120000` before believing it.)

- [ ] **Step 9: Commit**

```bash
git add src/features/spaces/data/readingSession.ts src/features/spaces/data/reading.ts \
  src/features/spaces/data/useReader.ts src/features/spaces/data/practice.ts \
  src/features/spaces/screens/LessonFacesScreen.tsx src/features/spaces/__tests__/reading.test.ts
git commit -m "feat(v4-reader): reading sessions, honest dwell, and the last page always reported

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The check-in at a checkpoint, and every checkpoint answer graded on the server

**Files:**
- Modify: `src/features/spaces/components/reader/CheckpointCard.tsx`
- Modify: `src/features/spaces/data/useReader.ts`
- Modify: `src/features/spaces/screens/LessonFacesScreen.tsx`
- Modify: `src/i18n/locales/en/v4Reader.json`, `src/i18n/locales/de/v4Reader.json`
- Test: `src/features/spaces/__tests__/checkpoint-checkin.test.tsx`

**Interfaces:**
- Consumes: `checkIn`, `answerCheckpoint`, `CheckpointAnswer` (Task 7); `currentSession` (Task 8).
- Produces: `CheckpointCard` props `onCheckIn?: (rating: 'got_it' | 'confused') => void` and `onAnswer?: (questionId: number, answer: Answer, span: { first: number; last: number }) => void`; `recordCheckIn(lectureId, first, last, idea, rating): void` and `recordCheckpointAnswer(lectureId, first, last, questionId, answer): void` in `data/useReader.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/features/spaces/__tests__/checkpoint-checkin.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@/i18n';
import { CheckpointCard } from '../components/reader/CheckpointCard';
import type { Checkpoint } from '../data/liveRepository';

const CP: Checkpoint = {
  idea: 'Joins',
  first: 4,
  last: 9,
  cached: true,
  questions: [
    {
      id: 1, lecture_id: 'l1', page: 9, idea: 'Joins', prompt: 'Which join keeps every left row?', why: '',
      kind: 'choice', options: [{ text: 'Inner' }, { text: 'Left', correct: true }],
    } as Checkpoint['questions'][number],
  ],
};

const card = (extra: Partial<Parameters<typeof CheckpointCard>[0]> = {}) =>
  render(
    <CheckpointCard
      idea={{ name: 'Joins', first: 4, last: 9 }}
      lectureTitle="Relational Algebra"
      load={() => Promise.resolve(CP)}
      pageHref={(p) => `/p/${p}`}
      onDone={vi.fn()}
      onDismiss={vi.fn()}
      {...extra}
    />,
  );

describe('the checkpoint', () => {
  it('offers a quiet check-in that never stands in the way of the question', () => {
    const onCheckIn = vi.fn();
    card({ onCheckIn });
    const foggy = screen.getByRole('button', { name: 'Still foggy' });
    expect(foggy).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(foggy);
    expect(onCheckIn).toHaveBeenCalledWith('confused');
    expect(foggy).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Clicked' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /One question/ })).toBeEnabled();
  });

  it('hands every answer on, with the span the checkpoint was served for', async () => {
    const onAnswer = vi.fn();
    card({ onAnswer });
    fireEvent.click(screen.getByRole('button', { name: /One question/ }));
    await waitFor(() => screen.getByText('Which join keeps every left row?'));
    fireEvent.click(screen.getByRole('button', { name: 'Left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(onAnswer).toHaveBeenCalledWith(1, { kind: 'choice', index: 1 }, { first: 4, last: 9 });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/checkpoint-checkin.test.tsx`
Expected: FAIL — no "Still foggy" button; `onAnswer` never called.

- [ ] **Step 3: Add the copy**

In `src/i18n/locales/en/v4Reader.json`, inside `"checkpoint"`, add after `"offer": {…},`:

```json
    "checkin": {
      "label": "How did it land?",
      "clicked": "Clicked",
      "foggy": "Still foggy"
    },
```

In `src/i18n/locales/de/v4Reader.json`, at the same place:

```json
    "checkin": {
      "label": "Wie ist es angekommen?",
      "clicked": "Hat klick gemacht",
      "foggy": "Noch nebelig"
    },
```

- [ ] **Step 4: Add the check-in and the answer hand-off to the card**

In `src/features/spaces/components/reader/CheckpointCard.tsx`:

Change the grade import to `import { grade, type Answer, type Grade } from '../rehearsal/grade';`.

Add to `Props`:

```ts
  /** The quiet check-in: how the idea landed, before any question. Optional, never blocking. */
  onCheckIn?: (rating: 'got_it' | 'confused') => void;
  /** Every answer, as given, with the span the checkpoint was served for, so the server can grade it too. */
  onAnswer?: (questionId: number, answer: Answer, span: { first: number; last: number }) => void;
```

Add `onCheckIn, onAnswer` to the destructured props of `CheckpointCard`, and add state under `const [grades, setGrades] = useState<Grade[]>([]);`:

```ts
  const [rating, setRating] = useState<'got_it' | 'confused' | null>(null);
```

In the reset effect for a new idea (the one that calls `setPhase('offer')`), add `setRating(null);`.

In the offer panel, insert this block immediately before `<div className="mt-4 flex flex-wrap gap-2">`:

```tsx
          {onCheckIn && phase !== 'failed' && (
            <div role="group" aria-label={t('checkpoint.checkin.label')} className="mt-3 flex flex-wrap gap-1.5">
              {(['got_it', 'confused'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={rating === r}
                  onClick={() => {
                    setRating(r);
                    onCheckIn(r);
                  }}
                  className={cn(
                    'console-focusable inline-flex h-8 items-center rounded-full px-3.5 text-[12.5px] transition-colors',
                    rating === r ? 'bg-white/[0.16] text-foreground' : 'bg-white/[0.05] text-quiet hover:bg-white/[0.1] hover:text-foreground',
                  )}
                >
                  {t(r === 'got_it' ? 'checkpoint.checkin.clicked' : 'checkpoint.checkin.foggy')}
                </button>
              ))}
            </div>
          )}
```

Replace the `QuestionView`'s `onCheck` prop with:

```tsx
                  onCheck={(a) => {
                    setGrades((g) => [...g.slice(0, at), grade(q, a)]);
                    if (cp) onAnswer?.(q.id, a, { first: cp.first, last: cp.last });
                  }}
```

- [ ] **Step 5: Run the card test**

Run: `npx vitest run src/features/spaces/__tests__/checkpoint-checkin.test.tsx`
Expected: PASS.

- [ ] **Step 6: Send them from the reader**

In `src/features/spaces/data/useReader.ts`, add `import type { CheckpointAnswer } from './liveRepository';` (merge into the existing import from `./liveRepository` if there is one), and add after `teachBack(...)`:

```ts
/** The check-in at an idea's checkpoint. Fire-and-forget: it never holds the reader up. */
export function recordCheckIn(lectureId: string, first: number, last: number, idea: string, rating: 'got_it' | 'confused'): void {
  void loadLiveRepository()
    .then((repo) => repo.checkIn(lectureId, { first, last, idea: idea.slice(0, 120), rating, session_id: currentSession(lectureId) ?? '' }))
    .catch(() => {});
}

/** One checkpoint answer, for the server to grade and record. The reader still grades it at once for the learner. */
export function recordCheckpointAnswer(lectureId: string, first: number, last: number, questionId: number, answer: CheckpointAnswer): void {
  void loadLiveRepository()
    .then((repo) => repo.answerCheckpoint(lectureId, { first, last, question_id: questionId, answer, session_id: currentSession(lectureId) ?? '' }))
    .catch(() => {});
}
```

In `src/features/spaces/screens/LessonFacesScreen.tsx`, add `recordCheckIn, recordCheckpointAnswer` to the import list from `../data/useReader`, and add these props to `<CheckpointCard`:

```tsx
        onCheckIn={
          liveReader && offer ? (rating) => recordCheckIn(lesson.id, offer.first, offer.last, offer.name, rating) : undefined
        }
        onAnswer={liveReader ? (id, answer, span) => recordCheckpointAnswer(lesson.id, span.first, span.last, id, answer) : undefined}
```

- [ ] **Step 7: Run the gates for the namespace**

Run:
```bash
npx tsc -p tsconfig.app.json --noEmit
node scripts/check-v4-strings.mjs && node scripts/check-i18n-parity.cjs && node scripts/check-vocabulary.mjs src/features/spaces/components/reader
npx vitest run src/features/spaces/__tests__/checkpoint-checkin.test.tsx src/features/spaces/__tests__/v4Strings.test.ts src/features/spaces/components/__tests__/reachable.test.tsx src/features/spaces/__tests__/boundary.test.ts --no-file-parallelism
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/features/spaces/components/reader/CheckpointCard.tsx src/features/spaces/data/useReader.ts \
  src/features/spaces/screens/LessonFacesScreen.tsx src/i18n/locales/en/v4Reader.json src/i18n/locales/de/v4Reader.json \
  src/features/spaces/__tests__/checkpoint-checkin.test.tsx
git commit -m "feat(v4-reader): a quiet check-in at each checkpoint; answers graded on the server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Members are told, before any owner sees anything

**Files:**
- Modify: `src/features/spaces/screens/JoinSpaceScreen.tsx`
- Modify: `src/i18n/locales/en/v4Spaces.json`, `src/i18n/locales/de/v4Spaces.json`
- Modify: `src/i18n/locales/en/legal.json`, `src/i18n/locales/de/legal.json`
- Test: `src/features/spaces/__tests__/join-privacy.test.ts`

**Interfaces:**
- Produces: i18n key `v4Spaces:join.privacy`; the privacy page's legitimate-interest bullet says owners see patterns over at least five people, never names.

Note: "never who you are" holds while Strugglers and Journey stay behind `FEATURE_LANDING_PEOPLE` (off, spec §8). If Abi later allows person-level views, this line and the privacy bullet change in the same PR.

- [ ] **Step 1: Write the failing test**

Create `src/features/spaces/__tests__/join-privacy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';

describe('what members are told', () => {
  it('the join screen says what the people who run a Space see, in both languages', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('v4Spaces:join.privacy')).toBe('The people who run this Space see how its pages land for the group, never who you are.');
    await i18n.changeLanguage('de');
    expect(i18n.t('v4Spaces:join.privacy')).toBe('Die Leute, die diesen Space pflegen, sehen, wie seine Seiten bei der Gruppe ankommen, nie, wer du bist.');
    await i18n.changeLanguage('en');
  });

  it('the privacy page names the floor', async () => {
    const items = (lng: string) => i18n.getFixedT(lng, 'legal')('privacy.section3Items', { returnObjects: true }) as string[];
    expect(items('en').join(' ')).toMatch(/at least five people, never by name/);
    expect(items('de').join(' ')).toMatch(/mindestens fünf Personen, nie mit Namen/);
  });
});
```

Before running, confirm the bullet's key: `grep -n "Legitimate interest" src/i18n/locales/en/legal.json` shows which `sectionNItems` array holds it (it is the second item of the "legal basis" list, `section3Items` in the current file). If it is a different section, use that key in this test and in Step 3.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/join-privacy.test.ts`
Expected: FAIL — the key is missing; the bullet has no floor.

- [ ] **Step 3: Write the words and show them**

In `src/i18n/locales/en/v4Spaces.json`, inside the `join` object that holds `"toOpen"`, add:

```json
    "privacy": "The people who run this Space see how its pages land for the group, never who you are."
```

In `src/i18n/locales/de/v4Spaces.json`, at the same place:

```json
    "privacy": "Die Leute, die diesen Space pflegen, sehen, wie seine Seiten bei der Gruppe ankommen, nie, wer du bist."
```

In `src/i18n/locales/en/legal.json`, in the legitimate-interest bullet, replace `to show the people who maintain a Space where learners struggle;` with `to show the people who maintain a Space where learners struggle, only as patterns across at least five people, never by name;`.

In `src/i18n/locales/de/legal.json`, replace `zu zeigen, wo Lernende Schwierigkeiten haben;` with `zu zeigen, wo Lernende Schwierigkeiten haben, nur als Muster über mindestens fünf Personen, nie mit Namen;`.

In `src/features/spaces/screens/JoinSpaceScreen.tsx`, insert after the `{failed && (…)}` block:

```tsx
      <p className="mt-4 max-w-[52ch] text-[13px] leading-relaxed text-quiet">{t('join.privacy')}</p>
```

- [ ] **Step 4: Run the test and the gates**

Run:
```bash
npx vitest run src/features/spaces/__tests__/join-privacy.test.ts
node scripts/check-v4-strings.mjs && node scripts/check-i18n-parity.cjs && node scripts/check-vocabulary.mjs
```
Expected: the test passes; strings and parity pass; the vocabulary gate reports no new violation in `JoinSpaceScreen.tsx` (compare its count with the Task 0 baseline).

- [ ] **Step 5: Commit**

```bash
git add src/features/spaces/screens/JoinSpaceScreen.tsx src/i18n/locales/en/v4Spaces.json src/i18n/locales/de/v4Spaces.json \
  src/i18n/locales/en/legal.json src/i18n/locales/de/legal.json src/features/spaces/__tests__/join-privacy.test.ts
git commit -m "feat(v4): members are told what the people who run a Space see

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Prove it end to end, then hand over the deploy order

**Files:** none changed unless a gate fails.

- [ ] **Step 1: Run every gate**

Run:
```bash
.venv/bin/python -m pytest backend/tests/unit -q
.venv/bin/python -m pytest -m db backend/tests/db/test_learning_events_schema_db.py -q   # needs Docker
npx tsc -p tsconfig.app.json --noEmit
npm run lint
npx vitest run --no-file-parallelism --testTimeout=120000
```
Expected: all green. Report any failure with its output; a failure that also fails on the Task 0 baseline is pre-existing — say so, do not fix it here.

- [ ] **Step 2: Watch one reading session locally (only with Abi signed in)**

Local v4-live needs: `.env` symlinked to main's, `.env.local` with `VITE_FEATURE_V4=1` and `VITE_V4_DATA_MODE=live`, and `backend/.env` with `FEATURE_V4=1` and `FEATURE_V4_READER=1`. The local backend talks to the **prod** database, and the migration from Task 1 must already be applied there (Abi runs it), or every `checkpoint_attempt` is refused (harmlessly, by design).

With the default test account (`abdul@test.com`), open a Lesson in the reader, read three pages, turn back one, open Explain once, answer a checkpoint and tap "Still foggy", then close the tab. Then, read-only:

```sql
SELECT event_type, event_data->>'sessionId' AS session, event_data->>'page' AS page,
       event_data->>'kind' AS kind, event_data->>'correct' AS correct, created_at
FROM learning_events
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'abdul@test.com')
  AND created_at > now() - interval '30 minutes'
ORDER BY created_at;
```

Expected: `slide_view` rows sharing one session (including the last page, from the beacon); one `slide_back_navigation`; one `ai_tutor_query` with `kind = explain`; one `confidence_rating` with `rating = confused`; one `checkpoint_attempt` per answered question.

- [ ] **Step 3: Write the deploy order into the PR description**

```
Deploy order
1. Abi applies supabase/migrations/20261027000000_v4_reader_telemetry_events.sql to prod (psql via the pooler, port 5432), after a pg_dump.
   Verify: SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'learning_events_event_type_check';  -- contains checkpoint_attempt
2. Deploy backend + frontend together (the frontend's new fields are optional for the backend and vice versa).
Rollback: the CHECK accepts the old 16 types too; reverting the code needs no migration.
```

- [ ] **Step 4: Update the project memory**

Edit `/Users/abdullahabobaker/.claude/projects/-Users-abdullahabobaker-Desktop-ascend-academy/memory/project_analytics_v4_integration.md`: Plan 1 status (branch, PR, migration applied or not), and that Plans 2–4 are next.

---

## Self-review notes (done while writing)

- **Spec coverage (§4 Phase A):** A1 → Tasks 3, 7, 8 · A2 → Tasks 6, 7, 8 · A3 → Task 8 · A4 → Tasks 3, 8 · A5 → Task 3 · A6 → Task 4 · A7 → Tasks 2, 5, 7, 8 · A8 → Tasks 2, 5, 9 · A9 → Tasks 1, 5, 9 · A10 → Tasks 1, 3, 4 · A11 → Task 10. A12 (questions) is Plan 4 by design.
- **Names used across tasks:** `record_event`, `record_help`, `record_check_in` (positional), `record_checkpoint` (keywords after `lecture_id, user_id`), `session_or_new`, `cached_checkpoint`, `grade_answer`, `checkpoint_key`, `recordReading(…, session, toPage)`, `recordReadingBeacon`, `checkIn`, `answerCheckpoint`, `CheckpointAnswer`, `startSession`/`endSession`/`currentSession`, `recordCheckIn`, `recordCheckpointAnswer`, `onCheckIn`, `onAnswer(questionId, answer, span)` — consistent in every task that uses them.
- **Out of scope here:** the owner's own reading is excluded on the read side (Plan 2); help-index normalisation, themes and reader floors (Plan 2); the door's route and gate (Plan 3).
