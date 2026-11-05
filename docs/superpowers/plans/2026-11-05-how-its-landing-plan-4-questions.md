# How it's landing, Plan 4: the Questions channel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A learner can send a question from the reader to the people who run the Space, with or without their name. The owner answers it either to that person or for everyone. The answer comes back on the page it was asked from, and Luna says so if she is open.

**Architecture:** One new table, `space_questions`, written only by the backend. RLS and column grants act as a second wall that keeps an anonymous asker anonymous even through PostgREST. A new router (`v4_questions.py`) sends, withdraws and answers. It also serves a page's answers to the reader. Answering writes a `question_answered` notification whose `deep_link` is the reader URL, and the world's notification mapper turns that link into a `page` target. The owner's door reads waiting and answered questions fresh on every request, outside the five-minute landing cache. In the reader, the fixture components in `src/features/spaces/landing/` are wired in through one data seam (`data/questions.ts`). Plan 3 owns the door's layout. This plan gives it the payload and the composer.

**Tech Stack:** FastAPI, asyncpg and Pydantic v2 against Supabase Postgres (plain SQL migration, applied by hand); slowapi; React 18, TypeScript, react-i18next, motion; Vitest and Testing Library; pytest (unit, plus `-m db` on a throwaway Postgres).

**Spec:** `docs/superpowers/specs/2026-10-26-how-its-landing-design.md`, section 6 (phases A12, B10 and C8) and section 8 (Abi's 2026-11-05 decisions). Read both. Plan 2 (`docs/superpowers/plans/2026-10-29-how-its-landing-plan-2-space-engine.md`) built `assert_space_owner`, `space_row`, `get_landing` and the `throwaway_db` fixture that this plan reuses. Plan 3 (`docs/superpowers/plans/2026-11-05-how-its-landing-plan-3-door-in-v4.md`, written in parallel) puts the door in v4 and consumes the contract below.

## What already exists (verified on `origin/main` @ 2b8b1f7b, 2026-11-05)

| Piece | Where | State |
|---|---|---|
| Fixture UI for questions | `src/features/spaces/landing/SendToSpace.tsx` (`SendLine`, `SendSheet`, `LunaLine`), `AnsweredHere.tsx`, `QuestionsRow.tsx` | DEV lab only (`/landing-lab`, scenes "In the reader · send a question" and "the answer lands"). Not imported by the reader. The door session is rewriting `QuestionsRow.tsx` (hairline list plus `AnsweredFold`) in the working tree; that work is Plan 3's. |
| Wire type | `src/features/spaces/landing/types.ts`: `LandingQuestion {id, lessonId, page, text, asker: Person \| null, createdAt, answer?}` and `LandingAnswer {text, forEveryone, at}` | `asker` is a full `Person` (id, avatar). The contract below narrows it to a name. |
| Strings | `src/i18n/locales/{en,de}/v4Landing.json`, `reader.*` and `questions.*` | Most of the copy exists already: line, sheet, anonymous switch, `sent`, `answeredLuna`, `read`, `answered.*`, and the composer buttons. |
| Owner guard | `backend/domain/authorization.py:47` `assert_space_owner(space, user_id)`; `backend/services/v4_landing_service.py` `space_row(space_id, user_id)` | Owner passes, member gets 403, anyone else gets 404, and the personal Space returns `None`, so 404. |
| Landing endpoint | `backend/api/v1/v4_landing.py` `GET /v4/spaces/{id}/landing`, `get_landing()` cached 300 s as view `landing` | Returns `"questions": []` (Plan 2 left it for Plan 4). |
| Member guard | `backend/services/v4_reader_service.py:59` `can_view_course`, `:53` `can_view_lecture` | Owner, enrolled member or the personal Space. |
| Rate limiting | `backend/core/rate_limit.py` `limiter` (per bearer token, else IP) | `backend/tests/conftest.py` resets it before every test. |
| Notifications | Table `notifications(id, user_id, title, message, type, read, created_at, priority, deep_link)`. `v4_spaces_service.py:848` `_KINDS`, `:851` `_notification()` (every target is `{kind:'profile'}`). The world selects them at `:300` without `deep_link`. | The panel `src/features/spaces/components/NotificationPanel.tsx` opens `lesson`, `person` or `profile` targets. The old `NudgeBanner` reads only `streak / assignment / review / daily_review / activation`, so a new type does not reach it. |
| Live reader | `src/features/spaces/screens/LessonFacesScreen.tsx` (route `/v4/space/:spaceId/lesson/:lessonId/faces?page=N`) | On a live Lesson, Ask is the ExplainPanel conversation (`components/reader/iui/ExplainPanel.tsx`, `turns`). Luna is `components/reader/luna/SessionColumn.tsx`. The check-in from Plan 1 is in `components/reader/CheckpointCard.tsx` (`onCheckIn`, `rating === 'confused'`). |
| GDPR | `backend/services/account_service.py` `EXPORT_TABLES` and `EXPORT_REDACT`; `backend/tests/db/test_gdpr_coverage.py` fails on any user-linked column the export does not name. | `space_questions` must be added. |
| DB tests | `backend/tests/db/conftest.py`: `pg_dsn` (local Postgres, else Docker), `db_conn`, `make_user / make_course / make_lecture / make_course_enrollment`, `throwaway_db` (Plan 2). RLS pattern: `backend/tests/db/test_luna_sessions_rls.py` `_as_user` / `_reset`. | |
| Latest migration | `supabase/migrations/20261101015412_harden_profile_and_xp_integrity.sql` (137 files). No other branch has a `202611*` file. | This plan uses `20261105120000`. |

Plan 1's `record_event` and `sources/space.py` are not needed: a sent question is not a learning event, and the engine does not read it.

## Decisions this plan makes (read before executing)

Each one is cheap to change later.

1. **Waiting questions are never cached.** `get_landing` keeps its cached aggregates and then adds `questions` and `answered`, read fresh in one query each. Nothing needs to invalidate the `landing` cache (the spec says "invalidates landing"; this has the same effect with no stale window).
2. **The owner sees a name and nothing else.** That means `asker: {name} | null`: no user id, no avatar. If the learner chose "without my name", the name is `NULL` already in SQL and never leaves the database. If a named asker has no display name, it is also `null`, and the door says "Someone".
3. **Column grants as well as RLS.** `authenticated` may `SELECT` every column except `asker_id` and `answered_by`. So even an owner reading `space_questions` directly through PostgREST cannot see who sent an anonymous question. The backend reads and writes with its own connection. RLS (the spec's three read rules) is the second wall.
4. **One answer per question in v1.** A second answer gets 409. Editing an answer is a later switch, as members answering each other is.
5. **Protection for the owner:** at most 10 waiting (unanswered) questions per person per Space (429 beyond that), plus `5/minute` on send.
6. **Withdraw is available until it is answered and after.** If a question was answered for everyone, withdrawing it also removes the card from the page. The learner's words are the learner's.
7. **Luna's delivery uses the page's answers, not the world.** The world, and the notifications in it, loads once per app session, so a notification created after that load is not there. The reader asks `GET …/answers` when it opens a Lesson. One of your own answers that Luna has not yet announced in this browser is "new" (`localStorage`, try/catch, an in-memory fallback). Opening it through the notification, the card or Luna marks it announced. Across two devices the worst case is that Luna says it twice.
8. **Where the "answered here" card sits.** It uses the checkpoint card's lane (fixed, bottom right, full width on a phone), and only on the slide face. On pages that have answers it starts as one quiet pill, "Answered here". It opens by itself only for your own new answer, or when you arrive from the notification (`?question=`). It steps aside while a checkpoint offer or the send sheet is showing. It never covers the page by default.
9. **Who sees the Send line:** a member of a real Space (`viewerRole` is `member` or `editor`). It is never shown in the personal Space, never to the owner, and never to someone who has not joined.
10. **Demo mode works end to end in memory.** `sendQuestion` resolves locally, and `mocks/questions.ts` puts one answered-for-everyone card on Normalization (`l-s-dbs-4`) page 3. The reader can then be tested and browser-checked without a backend. This is honest: after this plan the app really does this.
11. **The sheet's line says what "for everyone" means.** `reader.who` changes to: "The people who run this Space will see it. If they answer it for everyone, it shows on this page without your name." The approved lab shows the question text on everyone's card, so the sheet has to say so. See open question 1.
12. **The composer is its own component.** `landing/AnswerComposer.tsx` holds the textarea, the two sends, the pending and failed states, and the 2000-character limit. Plan 3's hairline row renders it. This plan does not edit `LandingScreen.tsx` or `QuestionsRow.tsx`.

## Contract with Plan 3

Plan 3 renders the door and owns `types.ts`, `mocks/landing.ts`, `QuestionsRow.tsx`, `LandingScreen.tsx` and `data/landing.ts`. This plan owns the payload, the answer endpoint, `answerQuestion()` and `AnswerComposer`.

**`GET /api/v1/v4/spaces/{id}/landing` adds or changes two keys** (everything else as in Plan 2):

```ts
/** A question a learner chose to send. Verbatim, because they chose to. */
interface LandingQuestion {
  id: string;               // uuid
  lessonId: string;         // always one of landing.lessons[].id (same lecture filter as the engine)
  page: number;             // 1-based page of that Lesson
  text: string;             // ≤ 500 chars, as sent
  /** The name they sent it with. null = "without my name", or no name on the profile: say "Someone". Never an id, never a face. */
  asker: { name: string } | null;
  createdAt: string;        // ISO 8601
  answer?: LandingAnswer;   // present on every item of `answered`, absent on every item of `questions`
}
interface LandingAnswer { text: string; forEveryone: boolean; at: string } // forEveryone = visibility 'space'

interface Landing {
  // …Plan 2 keys unchanged…
  /** Waiting for an answer, newest first, at most 50. Present even under the reader floor. */
  questions: LandingQuestion[];
  /** Answered, most recently answered first, at most 20. For the "Answered" fold at the foot. */
  answered: LandingQuestion[];
}
```

- Never cached: both lists are fresh on every request. After a successful answer, the door moves the item itself (below). It does not need to refetch.
- The floor does not apply. A six-person Space has questions with no figures and no map.
- No count in the heading, and no section when `questions` is empty (spec section 8.3).

**Answering.** `POST /api/v1/v4/spaces/{id}/questions/{questionId}/answer`, body `{text: string (1–2000), visibility: 'asker' | 'space'}`:
- 200 `{id, answer: LandingAnswer}`, 403 member, 404 stranger or missing question, 409 already answered, 422 bad body, 429 over `30/minute`.

**Seam.** `src/features/spaces/data/questions.ts` exports `answerQuestion(spaceId, questionId, text, forEveryone): Promise<LandingAnswer>`. In demo mode it resolves locally. Plan 3's live `useLanding().answer` should be `(questionId, text, forEveryone) => Promise<void>`: await `answerQuestion`, then move that item from `questions` to the head of `answered` with the returned `answer`. If it rejects, re-throw so the composer keeps the draft.

**Composer.** `src/features/spaces/landing/AnswerComposer.tsx`:

```ts
export function AnswerComposer(props: {
  /** Store the answer. Resolve when it is stored; reject when it did not go. */
  onAnswer: (text: string, forEveryone: boolean) => Promise<void>;
  /** Close without answering (also Escape). */
  onClose: () => void;
}): JSX.Element
```

It contains: textarea (≤2000, autofocus), **Answer for everyone** (white), **Answer them** (ghost), the hint, Close. Both sends are disabled while the draft is empty or a send is in flight. On rejection it shows one line, `questions.failed`, and keeps the draft. It brings no outer chrome, so the hairline row decides spacing.

If Plan 3 lands first with the fixture's inline textarea, the first task of whichever plan runs second swaps it for `AnswerComposer`. The `asker` narrowing breaks `Avatar person={q.asker}` in the door session's `QuestionsRow`. Plan 3 drops the face (no people) or draws initials from the name.

## Global Constraints

- Strings only from `src/i18n/locales/{en,de}/v4*.json`, with en and de keys matching (`npm run lint` checks parity, the v4 string guard and German register). German uses du, never Sie, and no exclamation marks. Glossary (`docs/V4_GLOSSARY.md`): Space, Lektion, Seite, Idee. Never Folie, Vorlesung or Kurs. "The people who run this Space" is "die Leute, die diesen Space pflegen".
- Voice (`docs/BRAND_VOICE.md`): calm, never salesy. No em or en dashes in new copy.
- `src/features/spaces/**` imports only what `src/features/spaces/__tests__/boundary.test.ts` allows: `react-i18next` (never `i18next` itself), `@/i18n` and relative paths. No `supabase`, no `*service` module, no `@tanstack/react-query`. Screens and components read data through `data/`, never `mocks/` (`seam.test.ts`).
- One fact, once. No eyebrow labels, no decorative dots, no glow, and no middle-dot meta in new chrome.
- Luna stays identifiable: `LunaLine` uses `LunaMark`. Her lines here are templated client-side, never a model call. Luna's tables are never read or written by this plan.
- No member's question text ever appears in `learning_events`, themes or the engine. Passive AI questions stay themes-only (Plan 2). Only explicitly sent questions are verbatim.
- The migration is plain SQL, one transaction, re-runnable. It has no `SECURITY DEFINER` function and no trigger. Revoke from `PUBLIC, anon, authenticated` by name. **Never `supabase db push`.** It is applied to prod by hand (`docs/runbooks/apply-a-migration-by-hand.md`) and verified with `pg_catalog`.
- Backend tests: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest … -q -p no:cacheprovider` from the repo root. DB tests: `-m db` with `throwaway_db` / `db_conn` only, never the `.env` database. Never run backend tests with a `.env` you do not trust (`orchestrator.py` calls `load_dotenv(override=True)`). Any unit test that reaches `get_landing` must stub `v4_questions_service.questions_for_owner`.
- Node: `export PATH="/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin:$PATH"` before `npx`. Type-check with `npx tsc --noEmit -p tsconfig.app.json` (`tsconfig.json` checks nothing).
- Gates every task keeps green: `npm run lint`, `npx vitest run`, `npx tsc --noEmit -p tsconfig.app.json`, `.venv/bin/python -m pytest backend/tests -m "not db" -q`, `ruff check backend/ --select F821,F811,F841`.
- Before every commit and push, re-run `git status` and `git log -1`: several sessions share this tree. Commit messages end with `Co-Authored-By:` of the model that wrote the commit. PR bodies end with the Claude Code line.

## File Structure

**Database**
- Create `supabase/migrations/20261105120000_space_questions.sql`: the table, checks, indexes, RLS, grants.

**Backend, new**
- `backend/services/v4_question_links.py`: `answer_link()` and `page_target()`, the one place the reader URL is written and read (pure, no imports from services).
- `backend/services/v4_questions_service.py`: `send_question()`, `withdraw_question()`, `answer_question()`, `answers_for_reader()`, `questions_for_owner()`.
- `backend/api/v1/v4_questions.py`: the four routes.

**Backend, modified**
- `backend/main.py`: mount `v4_questions` with the v4 routers.
- `backend/services/v4_spaces_service.py`: `_KINDS` gains `question_answered`; `_notification()` maps its target and phrase; the world selects `deep_link`.
- `backend/services/v4_landing_service.py`: `get_landing()` adds fresh `questions` and `answered`; `landing_from()` returns `"answered": []`.
- `backend/services/account_service.py`: export `space_questions` both ways, with the identity columns redacted.

**Frontend, new**
- `src/features/spaces/data/questions.ts`: the seam (`canSendToSpace`, `sendQuestion`, `withdrawQuestion`, `answerQuestion`, `usePageAnswers`, `announced`, `markAnnounced`, type `PageAnswer`).
- `src/features/spaces/mocks/questions.ts`: the demo's one answered card.
- `src/features/spaces/components/reader/SendToSpaceDock.tsx`: the sheet in the reader, then the confirmation and Take it back.
- `src/features/spaces/components/reader/AnsweredOnPage.tsx`: the pill and the opened cards on the page in view.
- `src/features/spaces/landing/AnswerComposer.tsx`: the owner's composer.

**Frontend, modified**
- `src/features/spaces/data/liveRepository.ts`: `sendQuestion`, `withdrawQuestion`, `answerQuestion`, `pageAnswers`.
- `src/features/spaces/landing/SendToSpace.tsx`: `SendSheet` gains `sending` and `failed`.
- `src/features/spaces/components/reader/iui/ExplainPanel.tsx`, `components/reader/CheckpointCard.tsx`, `components/reader/luna/SessionColumn.tsx`: the Send line, plus Luna's `aside`.
- `src/features/spaces/screens/LessonFacesScreen.tsx`: wiring only.
- `src/features/spaces/mocks/notifications.ts`, `components/NotificationPanel.tsx`: kind `question_answered`, target `page`.
- `src/i18n/locales/{en,de}/v4Landing.json`, `src/i18n/locales/{en,de}/v4Spaces.json`.

**Tests**
- `backend/tests/db/test_space_questions_rls.py`, `backend/tests/db/test_space_questions_db.py`
- `backend/tests/unit/test_v4_question_links.py`, `test_v4_questions_api.py`, `test_v4_notifications_world.py`; extend `test_v4_landing_api.py`, `test_account_export.py`
- `src/features/spaces/__tests__/questions-live.test.ts`, `send-to-space.test.tsx`, `send-lines.test.tsx`, `answered-on-page.test.tsx`, `question-notification.test.tsx`, `answer-composer.test.tsx`
- `src/features/spaces/components/__tests__/readerAnswers.test.tsx`

---

### Task 0: A branch of its own, and a baseline

**Files:** none changed by hand.

- [ ] **Step 1: Make the workspace**

Use superpowers:using-git-worktrees to create a worktree on a new branch `claude/landing-plan-4-questions` from `origin/main`. The door session's uncommitted edits to `v4Landing.json`, `QuestionsRow.tsx` and the spec are in the main tree. If its PR has merged by now, `origin/main` has them. Otherwise expect a text conflict in `v4Landing.json` at the end, and resolve it by keeping both sides' keys.

Copy this plan into the worktree at the same path and make it the first commit:

```bash
git status && git log -1
git add docs/superpowers/plans/2026-11-05-how-its-landing-plan-4-questions.md
git commit -m "docs: How it's landing, plan 4 (the questions channel)"
```

The worktree needs `npm ci`. It has no `.env`. Do not copy one in: no step of this plan needs it.

- [ ] **Step 2: Baseline the gates**

```bash
export PATH="/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin:$PATH"
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npx vitest run
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests -m "not db" -q -p no:cacheprovider
ruff check backend/ --select F821,F811,F841
psql postgresql://localhost:5432/postgres -c 'select 1'   # or: docker info
```

Expected: all green. Write down the counts. Note whether a local Postgres or Docker answers: the `-m db` steps need one. If neither does, say so in the report and do not skip those steps silently.

---

### Task 1: The table, walled twice

**Files:**
- Create: `supabase/migrations/20261105120000_space_questions.sql`
- Test: `backend/tests/db/test_space_questions_rls.py`

**Interfaces:**
- Produces: table `public.space_questions(id, course_id, lecture_id, page, idea, asker_id, text, anonymous, answer, answered_by, answered_at, visibility, created_at)`. All later tasks rely on these column names.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/db/test_space_questions_rls.py`:

```python
"""space_questions: the backend writes; the asker, the owner and (once answered for
everyone) the members read; nobody reads who asked. Gated behind the `db` marker."""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import psycopg
import pytest

pytestmark = pytest.mark.db


def _as_user(cur, uid) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",))


def _reset(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


@pytest.fixture
def room(db_conn, make_user, make_course, make_lecture, make_course_enrollment):
    owner, asker, member, outsider = make_user(role="professor"), make_user(), make_user(), make_user()
    course = make_course(owner, title="Database Systems")
    lesson = make_lecture(owner, title="Normalization")
    with db_conn.cursor() as cur:
        cur.execute("UPDATE public.lectures SET course_id = %s, total_slides = 20 WHERE id = %s", (str(course), str(lesson)))
    make_course_enrollment(asker, course)
    make_course_enrollment(member, course)
    qid = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.space_questions (id, course_id, lecture_id, page, asker_id, text, anonymous) "
            "VALUES (%s, %s, %s, 12, %s, 'Why does the split lose a dependency?', true)",
            (str(qid), str(course), str(lesson), str(asker)),
        )
    return SimpleNamespace(owner=owner, asker=asker, member=member, outsider=outsider, course=course, lesson=lesson, qid=qid)


def _visible(cur, uid) -> int:
    _as_user(cur, uid)
    try:
        cur.execute("SELECT count(*) FROM public.space_questions")
        return cur.fetchone()[0]
    finally:
        _reset(cur)


def test_the_asker_and_the_owner_read_it_other_members_and_strangers_do_not(db_conn, room):
    with db_conn.cursor() as cur:
        assert _visible(cur, room.asker) == 1
        assert _visible(cur, room.owner) == 1
        assert _visible(cur, room.member) == 0
        assert _visible(cur, room.outsider) == 0


def test_answered_for_everyone_every_member_reads_it_strangers_still_do_not(db_conn, room):
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE public.space_questions SET answer = 'Because BCNF can split a dependency apart.', "
            "answered_by = %s, answered_at = now(), visibility = 'space' WHERE id = %s",
            (str(room.owner), str(room.qid)),
        )
        assert _visible(cur, room.member) == 1
        assert _visible(cur, room.outsider) == 0


def test_answered_only_for_them_other_members_still_do_not_read_it(db_conn, room):
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE public.space_questions SET answer = 'Yes.', answered_by = %s, answered_at = now() WHERE id = %s",
            (str(room.owner), str(room.qid)),
        )
        assert _visible(cur, room.member) == 0
        assert _visible(cur, room.asker) == 1


def test_nobody_signed_in_can_read_who_asked_not_even_the_owner(db_conn, room):
    with db_conn.cursor() as cur:
        for who in (room.owner, room.asker):
            _as_user(cur, who)
            try:
                cur.execute("SELECT id, text, anonymous FROM public.space_questions")
                assert len(cur.fetchall()) == 1
                for column in ("asker_id", "answered_by"):
                    with pytest.raises(psycopg.errors.InsufficientPrivilege):
                        cur.execute(f"SELECT {column} FROM public.space_questions")
            finally:
                _reset(cur)


def test_no_one_signed_in_or_anonymous_writes_or_reads_directly(db_conn, room):
    with db_conn.cursor() as cur:
        _as_user(cur, room.asker)
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(
                    "INSERT INTO public.space_questions (course_id, lecture_id, page, asker_id, text) VALUES (%s, %s, 1, %s, 'x')",
                    (str(room.course), str(room.lesson), str(room.asker)),
                )
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("DELETE FROM public.space_questions")
        finally:
            _reset(cur)
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT id FROM public.space_questions")
        finally:
            _reset(cur)


def test_the_shape_holds(db_conn, room):
    bad = [
        ("page", "0"), ("page", "2001"), ("text", "''"), ("text", "repeat('x', 501)"),
        ("visibility", "'class'"), ("idea", "repeat('x', 121)"),
    ]
    for column, value in bad:
        with db_conn.cursor() as cur, pytest.raises(psycopg.errors.CheckViolation):
            cur.execute(f"UPDATE public.space_questions SET {column} = {value} WHERE id = %s", (str(room.qid),))
    with db_conn.cursor() as cur, pytest.raises(psycopg.errors.CheckViolation):
        cur.execute("UPDATE public.space_questions SET answer = 'x' WHERE id = %s", (str(room.qid),))  # no answered_at


def test_erasing_the_asker_erases_their_questions(db_conn, room):
    with db_conn.cursor() as cur:
        cur.execute("DELETE FROM auth.users WHERE id = %s", (str(room.asker),))
        cur.execute("SELECT count(*) FROM public.space_questions WHERE id = %s", (str(room.qid),))
        assert cur.fetchone()[0] == 0
```

- [ ] **Step 2: Run it to see it fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest -m db backend/tests/db/test_space_questions_rls.py -q -p no:cacheprovider`
Expected: ERROR in the fixture with `relation "public.space_questions" does not exist`. (It is skipped if no Postgres is reachable: start one first.)

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261105120000_space_questions.sql`:

```sql
-- supabase/migrations/20261105120000_space_questions.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Questions a learner sends to the people who run a Space
-- (spec: docs/superpowers/specs/2026-10-26-how-its-landing-design.md §6).
--
-- Sent on purpose, so kept verbatim. "Without my name" (anonymous) hides the
-- asker from the owner only; the answer still finds its way back.
--
-- The backend reads and writes through its own connection and checks who may
-- do what itself; RLS is the second wall. Signed-in users may read: their own
-- questions, every question in a Space they own, and questions answered for
-- everyone in a Space they are enrolled in. No signed-in user may read who
-- asked or who answered (column grants), so an anonymous question stays
-- anonymous even through the API. Supabase grants new tables to anon and
-- authenticated directly, so both are revoked by name.
--
-- No trigger and no SECURITY DEFINER function: nothing runs during the
-- account-erasure cascade.
-- Apply by hand after probing pg_catalog. Never `supabase db push`.
-- One transaction; safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.space_questions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  lecture_id   UUID NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
  page         INTEGER NOT NULL CHECK (page BETWEEN 1 AND 2000),
  idea         TEXT NOT NULL DEFAULT '' CHECK (length(idea) <= 120),
  asker_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text         TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 500 AND length(btrim(text)) > 0),
  anonymous    BOOLEAN NOT NULL DEFAULT false,
  answer       TEXT CHECK (answer IS NULL OR (length(answer) BETWEEN 1 AND 2000 AND length(btrim(answer)) > 0)),
  answered_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  answered_at  TIMESTAMPTZ,
  visibility   TEXT NOT NULL DEFAULT 'asker' CHECK (visibility IN ('asker', 'space')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT space_questions_answered_together CHECK ((answer IS NULL) = (answered_at IS NULL))
);

CREATE INDEX IF NOT EXISTS space_questions_course_idx
  ON public.space_questions (course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS space_questions_lecture_answered_idx
  ON public.space_questions (lecture_id, page) WHERE answer IS NOT NULL;
CREATE INDEX IF NOT EXISTS space_questions_asker_idx
  ON public.space_questions (asker_id);
CREATE INDEX IF NOT EXISTS space_questions_answered_by_idx
  ON public.space_questions (answered_by) WHERE answered_by IS NOT NULL;

ALTER TABLE public.space_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "space_questions_asker_read" ON public.space_questions;
CREATE POLICY "space_questions_asker_read" ON public.space_questions
  FOR SELECT TO authenticated USING (asker_id = auth.uid());

DROP POLICY IF EXISTS "space_questions_owner_read" ON public.space_questions;
CREATE POLICY "space_questions_owner_read" ON public.space_questions
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.courses c
            WHERE c.id = space_questions.course_id AND c.professor_id = auth.uid())
  );

DROP POLICY IF EXISTS "space_questions_members_read_answered" ON public.space_questions;
CREATE POLICY "space_questions_members_read_answered" ON public.space_questions
  FOR SELECT TO authenticated USING (
    visibility = 'space' AND answer IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.course_enrollments e
      WHERE e.course_id = space_questions.course_id AND e.user_id = auth.uid())
  );

REVOKE ALL ON public.space_questions FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, course_id, lecture_id, page, idea, text, anonymous, answer, answered_at, visibility, created_at)
  ON public.space_questions TO authenticated;
GRANT ALL ON public.space_questions TO service_role;

COMMIT;
```

- [ ] **Step 4: Run the test, and the migration governance check**

```bash
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest -m db backend/tests/db/test_space_questions_rls.py -q -p no:cacheprovider
python3 backend/scripts/check_migration_timestamps.py
python3 backend/scripts/lint_new_definer_functions.py supabase/migrations/20261105120000_space_questions.sql
```

Expected: PASS, and both scripts exit 0.

If `test_nobody_signed_in_can_read_who_asked…` fails because the asker's own policy cannot be checked without `SELECT` on `asker_id`, do not grant the column. Change the grant line to grant **nothing** to `authenticated`: delete the `GRANT SELECT (…)` statement and keep the policies as documentation. Then change the RLS tests to assert that `authenticated` reads nothing directly. Say so in the PR.

- [ ] **Step 5: Commit**

```bash
git status && git log -1
git add supabase/migrations/20261105120000_space_questions.sql backend/tests/db/test_space_questions_rls.py
git commit -m "feat(db): space_questions, readable by asker, owner and (answered for everyone) members; never who asked"
```

---

### Task 2: A person's export carries their questions, never who asked

**Files:**
- Modify: `backend/services/account_service.py` (`EXPORT_TABLES`, `EXPORT_REDACT`)
- Test: `backend/tests/unit/test_account_export.py`; the existing `backend/tests/db/test_gdpr_coverage.py`

**Interfaces:**
- Consumes: Task 1's columns `asker_id` and `answered_by`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_account_export.py`:

```python
@pytest.mark.asyncio
async def test_exports_the_questions_you_sent_and_answered_without_who(admin):
    admin({"space_questions": [
        {"id": "q1", "asker_id": UID, "answered_by": OTHER, "text": "Why?", "answer": "Because."},
        {"id": "q2", "asker_id": OTHER, "answered_by": UID, "text": "How?", "answer": "Like this."},
        {"id": "q3", "asker_id": OTHER, "answered_by": None, "text": "Not mine."},
    ]})
    out = await acc.export_user_data(UID)
    assert [r["id"] for r in out["space_questions"]] == ["q1", "q2"]
    assert all("asker_id" not in r and "answered_by" not in r for r in out["space_questions"])
```

In `test_spec_covers_every_production_user_column`, add `("space_questions", "asker_id"), ("space_questions", "answered_by"),` to the `prod` set (they reach production with this plan).

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_account_export.py -q -p no:cacheprovider`
Expected: FAIL. `KeyError: 'space_questions'`, and `uncovered(prod)` lists the two columns.

- [ ] **Step 3: Add them to the export**

In `backend/services/account_service.py`, append to `EXPORT_TABLES` after `("review_cards", "owner_id"),`:

```python
    # Questions sent to a Space (migration 20261105120000): the ones you asked
    # and the ones you answered as its owner. Who asked or answered is never in
    # the file (EXPORT_REDACT): an anonymous question stays anonymous.
    ("space_questions", "asker_id"),
    ("space_questions", "answered_by"),
```

Change `EXPORT_REDACT` to:

```python
EXPORT_REDACT: dict[str, set[str]] = {"api_tokens": {"token_hash"}, "space_questions": {"asker_id", "answered_by"}}
```

- [ ] **Step 4: Run the tests**

```bash
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_account_export.py -q -p no:cacheprovider
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest -m db backend/tests/db/test_gdpr_coverage.py backend/tests/db/test_account_erasure_cascade.py -q -p no:cacheprovider
```

Expected: PASS. Before this step the coverage test failed on `space_questions.asker_id` and `answered_by`.

- [ ] **Step 5: Commit**

```bash
git status && git log -1
git add backend/services/account_service.py backend/tests/unit/test_account_export.py
git commit -m "feat(gdpr): export space_questions both ways, never who asked or answered"
```

---

### Task 3: Sending and taking back, in the service

**Files:**
- Create: `backend/services/v4_questions_service.py`
- Test: `backend/tests/db/test_space_questions_db.py`

**Interfaces:**
- Consumes: `can_view_course(course_id: UUID, user_id: str) -> bool` (`v4_reader_service`), `is_personal(space_id, user_id) -> bool` (`v4_personal`), `get_db_connection()`.
- Produces:
  - `OPEN_CAP = 10`
  - `async send_question(space_id: UUID, user_id: str, lesson_id: UUID, page: int, idea: str, text: str, anonymous: bool) -> dict` → `{"id": str, "createdAt": str}`. Raises `HTTPException` 404 (no such Space for you, personal Space, Lesson not in it), 403 (you own it), 422 (page past the Lesson's end), 429 (10 waiting).
  - `async withdraw_question(space_id: UUID, question_id: UUID, user_id: str) -> None`. Raises 404 unless it is yours, in that Space.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/db/test_space_questions_db.py`:

```python
"""The questions channel end to end on a real schema (spec §6)."""
from __future__ import annotations

import json
import uuid
from types import SimpleNamespace

import pytest

pytestmark = pytest.mark.db
asyncpg = pytest.importorskip("asyncpg")


@pytest.fixture
def room(db_conn, make_user, make_course, make_lecture, make_course_enrollment):
    owner, mira, jonas, outsider = make_user(role="professor"), make_user(), make_user(), make_user()
    course = make_course(owner, title="Database Systems")
    other_course = make_course(owner, title="Elsewhere")
    lesson = make_lecture(owner, title="Normalization")
    elsewhere = make_lecture(owner, title="Elsewhere")
    with db_conn.cursor() as cur:
        cur.execute("UPDATE public.lectures SET course_id = %s, total_slides = 20 WHERE id = %s", (str(course), str(lesson)))
        cur.execute("UPDATE public.lectures SET course_id = %s WHERE id = %s", (str(other_course), str(elsewhere)))
        cur.execute("UPDATE public.profiles SET display_name = 'Mira' WHERE user_id = %s", (str(mira),))
    make_course_enrollment(mira, course)
    make_course_enrollment(jonas, course)
    return SimpleNamespace(owner=owner, mira=mira, jonas=jonas, outsider=outsider,
                           course=course, lesson=lesson, elsewhere=elsewhere, db=db_conn)


def _code(excinfo) -> int:
    return getattr(excinfo.value, "status_code", 0)


async def test_a_member_sends_and_can_take_it_back(throwaway_db, room):
    from backend.services import v4_questions_service as svc

    sent = await svc.send_question(room.course, str(room.mira), room.lesson, 12, "BCNF", "  Why does the split lose a dependency?  ", False)
    with room.db.cursor() as cur:
        cur.execute("SELECT page, idea, text, anonymous, asker_id FROM public.space_questions WHERE id = %s", (sent["id"],))
        assert cur.fetchone() == (12, "BCNF", "Why does the split lose a dependency?", False, room.mira)

    with pytest.raises(Exception) as other:
        await svc.withdraw_question(room.course, uuid.UUID(sent["id"]), str(room.jonas))
    assert _code(other) == 404
    await svc.withdraw_question(room.course, uuid.UUID(sent["id"]), str(room.mira))
    with room.db.cursor() as cur:
        cur.execute("SELECT count(*) FROM public.space_questions")
        assert cur.fetchone()[0] == 0


async def test_who_may_send_and_where(throwaway_db, room):
    from backend.services import v4_questions_service as svc

    cases = [
        (room.owner, room.course, room.lesson, 3, 403),         # the owner does not ask themselves
        (room.outsider, room.course, room.lesson, 3, 404),      # not in the Space
        (room.mira, room.mira, room.lesson, 3, 404),            # the personal Space has no one to ask
        (room.mira, room.course, room.elsewhere, 3, 404),       # a Lesson of another Space
        (room.mira, room.course, room.lesson, 21, 422),         # past the Lesson's last page
    ]
    for who, space, lesson, page, code in cases:
        with pytest.raises(Exception) as denied:
            await svc.send_question(space, str(who), lesson, page, "", "Is this 3NF?", False)
        assert _code(denied) == code, (who, page)


async def test_ten_waiting_questions_is_enough(throwaway_db, room):
    from backend.services import v4_questions_service as svc

    for i in range(svc.OPEN_CAP):
        await svc.send_question(room.course, str(room.mira), room.lesson, 1 + i, "", f"Question {i}", False)
    with pytest.raises(Exception) as full:
        await svc.send_question(room.course, str(room.mira), room.lesson, 1, "", "One more", False)
    assert _code(full) == 429
    # Someone else still may.
    await svc.send_question(room.course, str(room.jonas), room.lesson, 1, "", "Mine", True)
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest -m db backend/tests/db/test_space_questions_db.py -q -p no:cacheprovider`
Expected: FAIL with `ModuleNotFoundError: backend.services.v4_questions_service`.

- [ ] **Step 3: Write the service**

Create `backend/services/v4_questions_service.py`:

```python
"""Questions a learner sends to the people who run a Space (spec §6).

Sent on purpose, so kept verbatim; "without my name" hides the name from the
owner only. Only the owner answers (v1). The backend reads and writes with
its own connection and decides who may do what here; RLS and the column
grants of migration 20261105120000 are the second wall. Nothing here writes
a learning event or reaches the insight engine.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException

from backend.core.database import get_db_connection
from backend.services.v4_personal import is_personal
from backend.services.v4_reader_service import can_view_course

#: Questions one person may have waiting in one Space at a time.
OPEN_CAP = 10

#: A Lesson of this Space that its members can read (the engine's own filter, sources/space.py).
_LESSON_SQL = """
SELECT COALESCE(l.total_slides, 0) AS pages
FROM lectures l
WHERE l.id = $1 AND l.course_id = $2
  AND NOT COALESCE(l.is_archived, false)
  AND COALESCE(l.visibility, 'course') = 'course'
"""

_WAITING_SQL = """
SELECT count(*) FROM space_questions
WHERE course_id = $1 AND asker_id = $2::uuid AND answer IS NULL
"""

_INSERT_SQL = """
INSERT INTO space_questions (course_id, lecture_id, page, idea, asker_id, text, anonymous)
VALUES ($1, $2, $3, $4, $5::uuid, $6, $7)
RETURNING id, created_at
"""


async def send_question(
    space_id: UUID, user_id: str, lesson_id: UUID, page: int, idea: str, text: str, anonymous: bool
) -> dict[str, Any]:
    """Store a question for the people who run the Space. A member's only; never the owner's."""
    if is_personal(space_id, user_id) or not await can_view_course(space_id, user_id):
        raise HTTPException(status_code=404, detail="Space not found.")
    async with await get_db_connection() as conn:
        owner = await conn.fetchval("SELECT professor_id FROM courses WHERE id = $1", space_id)
        if owner is None:
            raise HTTPException(status_code=404, detail="Space not found.")
        if str(owner) == str(user_id):
            raise HTTPException(status_code=403, detail="This is your Space.")
        pages = await conn.fetchval(_LESSON_SQL, lesson_id, space_id)
        if pages is None:
            raise HTTPException(status_code=404, detail="Lesson not found.")
        if pages and page > pages:
            raise HTTPException(status_code=422, detail="That page is not in this Lesson.")
        if await conn.fetchval(_WAITING_SQL, space_id, user_id) >= OPEN_CAP:
            raise HTTPException(status_code=429, detail="You have questions waiting for an answer already.")
        row = await conn.fetchrow(_INSERT_SQL, space_id, lesson_id, page, idea.strip()[:120], user_id, text.strip(), anonymous)
    return {"id": str(row["id"]), "createdAt": row["created_at"].isoformat()}


async def withdraw_question(space_id: UUID, question_id: UUID, user_id: str) -> None:
    """Take a question back, answered or not. Only the person who sent it."""
    async with await get_db_connection() as conn:
        status = await conn.execute(
            "DELETE FROM space_questions WHERE id = $1 AND course_id = $2 AND asker_id = $3::uuid",
            question_id, space_id, user_id,
        )
    if status == "DELETE 0":
        raise HTTPException(status_code=404, detail="Question not found.")
```

- [ ] **Step 4: Run the tests**

Run the Step 2 command again. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status && git log -1
git add backend/services/v4_questions_service.py backend/tests/db/test_space_questions_db.py
git commit -m "feat(questions): a member sends a question to the Space, and can take it back"
```

---

### Task 4: The send and withdraw routes

**Files:**
- Create: `backend/api/v1/v4_questions.py`
- Modify: `backend/main.py` (inside `if settings.feature_v4:`, after the `v4_landing_router` lines at `:274-275`)
- Test: `backend/tests/unit/test_v4_questions_api.py`

**Interfaces:**
- Consumes: Task 3's `send_question` and `withdraw_question`.
- Produces: `POST /api/v1/v4/spaces/{space_id}/questions` (201, `5/minute`), body `{lesson_id, page, idea?, text, anonymous?}`. `DELETE /api/v1/v4/spaces/{space_id}/questions/{question_id}` (200 `{"withdrawn": true}`, `30/minute`). Module-level `router`, `_uid()`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_v4_questions_api.py`:

```python
"""Questions sent to a Space: what each route accepts, and who it is for."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

import backend.services.v4_questions_service as service
from backend.api.v1 import v4_questions
from backend.core.auth_middleware import verify_token
from backend.core.rate_limit import limiter

LEARNER = "22222222-2222-2222-2222-222222222222"
SPACE = "33333333-3333-3333-3333-333333333333"
LESSON = "55555555-5555-5555-5555-555555555555"
QID = "66666666-6666-6666-6666-666666666666"


@pytest.fixture
def client(monkeypatch):
    calls: list[tuple] = []

    async def send(space_id, user_id, lesson_id, page, idea, text, anonymous):
        calls.append(("send", str(space_id), user_id, str(lesson_id), page, idea, text, anonymous))
        return {"id": QID, "createdAt": "2026-11-05T12:00:00+00:00"}

    async def withdraw(space_id, question_id, user_id):
        calls.append(("withdraw", str(space_id), str(question_id), user_id))

    monkeypatch.setattr(service, "send_question", send)
    monkeypatch.setattr(service, "withdraw_question", withdraw)

    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.include_router(v4_questions.router, prefix="/api/v1")
    app.dependency_overrides[verify_token] = lambda: {"id": LEARNER}
    c = TestClient(app)
    c.calls = calls
    return c


URL = f"/api/v1/v4/spaces/{SPACE}/questions"


def test_a_question_is_sent_trimmed_with_its_page_and_the_name_choice(client):
    r = client.post(URL, json={"lesson_id": LESSON, "page": 12, "idea": "BCNF", "text": "  Why?  ", "anonymous": True})
    assert r.status_code == 201
    assert r.json() == {"id": QID, "createdAt": "2026-11-05T12:00:00+00:00"}
    assert client.calls == [("send", SPACE, LEARNER, LESSON, 12, "BCNF", "Why?", True)]


@pytest.mark.parametrize("body", [
    {"lesson_id": LESSON, "page": 12, "text": "   "},
    {"lesson_id": LESSON, "page": 12, "text": "x" * 501},
    {"lesson_id": LESSON, "page": 0, "text": "Why?"},
    {"lesson_id": "not-a-uuid", "page": 1, "text": "Why?"},
    {"lesson_id": LESSON, "page": 1, "text": "Why?", "asker_id": LEARNER},
])
def test_what_is_not_a_question_is_refused_before_the_service(client, body):
    assert client.post(URL, json=body).status_code == 422
    assert client.calls == []


def test_five_a_minute_is_plenty(client):
    body = {"lesson_id": LESSON, "page": 1, "text": "Why?"}
    assert [client.post(URL, json=body).status_code for _ in range(6)] == [201] * 5 + [429]


def test_taking_one_back(client):
    r = client.delete(f"{URL}/{QID}")
    assert (r.status_code, r.json()) == (200, {"withdrawn": True})
    assert client.calls == [("withdraw", SPACE, QID, LEARNER)]
```

- [ ] **Step 2: Run them to see them fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_questions_api.py -q -p no:cacheprovider`
Expected: FAIL with `ImportError: cannot import name 'v4_questions'`.

- [ ] **Step 3: Write the routes**

Create `backend/api/v1/v4_questions.py`:

```python
"""Questions a learner sends to the people who run a Space (spec §6).

Mounted with the other v4 routers (FEATURE_V4). Who may do what is decided in
`v4_questions_service`; these routes only shape and limit what comes in.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.core.auth_middleware import _user_id, verify_token
from backend.core.rate_limit import limiter
from backend.services import v4_questions_service as service

router = APIRouter(prefix="/v4", tags=["v4"])


def _uid(user: Any) -> str:
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Sign in first.")
    return uid


def _words(value: str, most: int) -> str:
    value = value.strip()
    if not value or len(value) > most:
        raise ValueError(f"Between 1 and {most} characters.")
    return value


class SendBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lesson_id: UUID
    page: int = Field(ge=1, le=2000)
    idea: str = Field(default="", max_length=120)
    text: str = Field(max_length=1000)
    anonymous: bool = False

    @field_validator("text")
    @classmethod
    def _text(cls, v: str) -> str:
        return _words(v, 500)


@router.post("/spaces/{space_id}/questions", status_code=201)
@limiter.limit("5/minute")
async def v4_send_question(request: Request, space_id: UUID, body: SendBody, user: Any = Depends(verify_token)):
    """Send a question, in your own words, from a page of a Lesson."""
    return await service.send_question(
        space_id, _uid(user), body.lesson_id, body.page, body.idea, body.text, body.anonymous
    )


@router.delete("/spaces/{space_id}/questions/{question_id}")
@limiter.limit("30/minute")
async def v4_withdraw_question(request: Request, space_id: UUID, question_id: UUID, user: Any = Depends(verify_token)):
    """Take your question back."""
    await service.withdraw_question(space_id, question_id, _uid(user))
    return {"withdrawn": True}
```

In `backend/main.py`, directly after `v1_router.include_router(v4_landing_router)`:

```python
    from backend.api.v1.v4_questions import router as v4_questions_router
    v1_router.include_router(v4_questions_router)
```

- [ ] **Step 4: Run the tests**

Run the Step 2 command, then `ruff check backend/ --select F821,F811,F841`. Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git status && git log -1
git add backend/api/v1/v4_questions.py backend/main.py backend/tests/unit/test_v4_questions_api.py
git commit -m "feat(questions): POST and DELETE /v4/spaces/{id}/questions"
```

---

### Task 5: The owner answers, and the asker is told

**Files:**
- Create: `backend/services/v4_question_links.py`
- Modify: `backend/services/v4_questions_service.py` (add `answer_question`), `backend/api/v1/v4_questions.py` (add the route)
- Test: `backend/tests/unit/test_v4_question_links.py`, `backend/tests/unit/test_v4_questions_api.py` (extend), `backend/tests/db/test_space_questions_db.py` (extend)

**Interfaces:**
- Consumes: `space_row(space_id: UUID, user_id: str) -> dict | None` (`v4_landing_service`), `assert_space_owner(space, user_id)`.
- Produces:
  - `answer_link(space_id, lesson_id, page: int, question_id) -> str` → `/v4/space/{s}/lesson/{l}/faces?page={n}&question={q}`
  - `page_target(link: str | None) -> dict | None` → `{"kind": "page", "spaceId", "lessonId", "page": int, "questionId"}`
  - `async answer_question(space_id: UUID, question_id: UUID, user_id: str, text: str, visibility: Literal['asker','space']) -> dict` → `{"id": str, "answer": {"text", "forEveryone": bool, "at": str}}`. Raises 403 member, 404 stranger or missing, 409 already answered. Writes one `notifications` row in the same transaction: `type='question_answered'`, `deep_link=answer_link(...)`, title "Your question has an answer", message "About page N."
  - Route `POST /api/v1/v4/spaces/{space_id}/questions/{question_id}/answer`, body `{text (1–2000), visibility}`, `30/minute`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/unit/test_v4_question_links.py`:

```python
"""An answer opens the reader at its page; anything else is not an answer's link."""
from backend.services.v4_question_links import answer_link, page_target

S = "33333333-3333-3333-3333-333333333333"
L = "55555555-5555-5555-5555-555555555555"
Q = "66666666-6666-6666-6666-666666666666"


def test_the_link_reads_back_as_the_page_it_was_asked_on():
    link = answer_link(S, L, 12, Q)
    assert link == f"/v4/space/{S}/lesson/{L}/faces?page=12&question={Q}"
    assert page_target(link) == {"kind": "page", "spaceId": S, "lessonId": L, "page": 12, "questionId": Q}


def test_anything_else_is_no_page():
    for link in (None, "", "/dashboard", "/review", f"/v4/space/{S}/lesson/{L}/faces?page=12",
                 f"/v4/space/{S}/lesson/{L}/faces?page=12&question=x", f"https://evil.test/v4/space/{S}/lesson/{L}/faces?page=1&question={Q}"):
        assert page_target(link) is None
```

Append to `backend/tests/unit/test_v4_questions_api.py`:

```python
def test_answering_takes_the_words_and_who_it_is_for(client, monkeypatch):
    async def answer(space_id, question_id, user_id, text, visibility):
        client.calls.append(("answer", str(space_id), str(question_id), user_id, text, visibility))
        return {"id": str(question_id), "answer": {"text": text, "forEveryone": visibility == "space", "at": "t"}}

    monkeypatch.setattr(service, "answer_question", answer)
    r = client.post(f"{URL}/{QID}/answer", json={"text": " Because. ", "visibility": "space"})
    assert r.status_code == 200
    assert r.json()["answer"] == {"text": "Because.", "forEveryone": True, "at": "t"}
    assert client.calls == [("answer", SPACE, QID, LEARNER, "Because.", "space")]
    for bad in ({"text": "", "visibility": "space"}, {"text": "x" * 2001, "visibility": "asker"},
                {"text": "Yes", "visibility": "class"}):
        assert client.post(f"{URL}/{QID}/answer", json=bad).status_code == 422
```

Append to `backend/tests/db/test_space_questions_db.py`:

```python
async def test_the_owner_answers_once_and_the_asker_is_told_where(throwaway_db, room):
    from backend.services import v4_questions_service as svc
    from backend.services.v4_question_links import answer_link

    sent = await svc.send_question(room.course, str(room.mira), room.lesson, 12, "", "Why?", True)
    qid = uuid.UUID(sent["id"])

    for who, code in ((room.jonas, 403), (room.outsider, 404)):
        with pytest.raises(Exception) as denied:
            await svc.answer_question(room.course, qid, str(who), "Because.", "asker")
        assert _code(denied) == code

    done = await svc.answer_question(room.course, qid, str(room.owner), "Because BCNF splits it.", "space")
    assert done["answer"]["text"] == "Because BCNF splits it." and done["answer"]["forEveryone"] is True

    with room.db.cursor() as cur:
        cur.execute("SELECT type, deep_link, read FROM public.notifications WHERE user_id = %s", (str(room.mira),))
        assert cur.fetchall() == [("question_answered", answer_link(room.course, room.lesson, 12, qid), False)]
        cur.execute("SELECT answered_by, visibility FROM public.space_questions WHERE id = %s", (str(qid),))
        assert cur.fetchone() == (room.owner, "space")

    with pytest.raises(Exception) as again:
        await svc.answer_question(room.course, qid, str(room.owner), "Again.", "asker")
    assert _code(again) == 409
    with pytest.raises(Exception) as missing:
        await svc.answer_question(room.course, uuid.uuid4(), str(room.owner), "Nobody asked.", "asker")
    assert _code(missing) == 404
```

- [ ] **Step 2: Run them to see them fail**

```bash
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_question_links.py backend/tests/unit/test_v4_questions_api.py -q -p no:cacheprovider
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest -m db backend/tests/db/test_space_questions_db.py -q -p no:cacheprovider
```

Expected: FAIL. No module `v4_question_links`, the answer route is 404, and `answer_question` is missing.

- [ ] **Step 3: Write the link module**

Create `backend/services/v4_question_links.py`:

```python
"""Where an answered question opens: the reader, at its page, with the answer beneath (spec §6).

Written once here and read back by the world's notification mapper, so the
two can never drift. No imports from other services: both sides can load it.
"""
from __future__ import annotations

import re
from typing import Any, Optional

_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_LINK = re.compile(rf"^/v4/space/({_UUID})/lesson/({_UUID})/faces\?page=(\d{{1,4}})&question=({_UUID})$")


def answer_link(space_id: Any, lesson_id: Any, page: int, question_id: Any) -> str:
    return f"/v4/space/{space_id}/lesson/{lesson_id}/faces?page={int(page)}&question={question_id}"


def page_target(link: Optional[str]) -> Optional[dict[str, Any]]:
    """The notification target for an answer's link; None for any other link."""
    match = _LINK.match(link or "")
    if not match:
        return None
    space, lesson, page, question = match.groups()
    return {"kind": "page", "spaceId": space, "lessonId": lesson, "page": int(page), "questionId": question}
```

- [ ] **Step 4: Add `answer_question`**

In `backend/services/v4_questions_service.py`, add these imports:

```python
from typing import Any, Literal

from backend.domain.authorization import assert_space_owner
from backend.services.v4_question_links import answer_link
```

Append:

```python
_ANSWER_SQL = """
UPDATE space_questions
SET answer = $3, answered_by = $4::uuid, answered_at = now(), visibility = $5
WHERE id = $1 AND course_id = $2 AND answer IS NULL
RETURNING asker_id, lecture_id, page, answered_at
"""

_NOTIFY_SQL = """
INSERT INTO notifications (user_id, title, message, type, deep_link)
VALUES ($1, $2, $3, 'question_answered', $4)
"""


async def answer_question(
    space_id: UUID, question_id: UUID, user_id: str, text: str, visibility: Literal["asker", "space"]
) -> dict[str, Any]:
    """The owner's answer, once. The asker is told in the same transaction, named or not."""
    from backend.services.v4_landing_service import space_row  # that module imports this one (get_landing)

    assert_space_owner(await space_row(space_id, user_id), user_id)
    async with await get_db_connection() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(_ANSWER_SQL, question_id, space_id, text, user_id, visibility)
            if row is None:
                answered = await conn.fetchval(
                    "SELECT answer IS NOT NULL FROM space_questions WHERE id = $1 AND course_id = $2",
                    question_id, space_id,
                )
                if answered:
                    raise HTTPException(status_code=409, detail="This question has an answer already.")
                raise HTTPException(status_code=404, detail="Question not found.")
            await conn.execute(
                _NOTIFY_SQL,
                row["asker_id"],
                "Your question has an answer",
                f"About page {row['page']}.",
                answer_link(space_id, row["lecture_id"], row["page"], question_id),
            )
    return {
        "id": str(question_id),
        "answer": {"text": text, "forEveryone": visibility == "space", "at": row["answered_at"].isoformat()},
    }
```

(The notification's stored title and message are the English fallback. The v4 panel draws the translated phrase from Task 6.)

- [ ] **Step 5: Add the route**

In `backend/api/v1/v4_questions.py`, add `from typing import Any, Literal` and append:

```python
class AnswerBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(max_length=4000)
    visibility: Literal["asker", "space"]

    @field_validator("text")
    @classmethod
    def _text(cls, v: str) -> str:
        return _words(v, 2000)


@router.post("/spaces/{space_id}/questions/{question_id}/answer")
@limiter.limit("30/minute")
async def v4_answer_question(
    request: Request, space_id: UUID, question_id: UUID, body: AnswerBody, user: Any = Depends(verify_token)
):
    """The owner answers: to the person who asked (`asker`) or on that page for everyone (`space`)."""
    return await service.answer_question(space_id, question_id, _uid(user), body.text, body.visibility)
```

- [ ] **Step 6: Run the tests**

Run both Step 2 commands, then `ruff check backend/ --select F821,F811,F841`. Expected: PASS and clean.

- [ ] **Step 7: Commit**

```bash
git status && git log -1
git add backend/services/v4_question_links.py backend/services/v4_questions_service.py backend/api/v1/v4_questions.py \
  backend/tests/unit/test_v4_question_links.py backend/tests/unit/test_v4_questions_api.py backend/tests/db/test_space_questions_db.py
git commit -m "feat(questions): the owner answers once, for them or for everyone, and the asker is told where"
```

---

### Task 6: The notification opens the page

**Files:**
- Modify: `backend/services/v4_spaces_service.py`. `_KINDS` is at `:848` and `_notification` at `:851`. The world's notification `SELECT` is at `:300-304` and needs `deep_link` added.
- Test: `backend/tests/unit/test_v4_notifications_world.py`

**Interfaces:**
- Consumes: `page_target()` (Task 5).
- Produces: a world notification of type `question_answered` carries `target = {"kind":"page", spaceId, lessonId, page, questionId}` and `phrase = {"title": {"key": "v4Spaces:notifications.items.questionAnswered.title"}, "message": {"key": "v4Spaces:notifications.items.questionAnswered.message", "values": {"page": N}}}`. If its link does not parse, it falls back to `{"kind": "profile"}` with no phrase.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_v4_notifications_world.py`:

```python
"""What the v4 panel is told about a notification."""
from datetime import datetime, timezone

from backend.services.v4_question_links import answer_link
from backend.services.v4_spaces_service import _notification

S = "33333333-3333-3333-3333-333333333333"
L = "55555555-5555-5555-5555-555555555555"
Q = "66666666-6666-6666-6666-666666666666"


def _row(**kw):
    base = {"id": "n1", "title": "Your question has an answer", "message": "About page 12.", "type": "question_answered",
            "read": False, "created_at": datetime(2026, 11, 5, tzinfo=timezone.utc), "deep_link": answer_link(S, L, 12, Q)}
    return {**base, **kw}


def test_an_answer_opens_its_page_and_speaks_the_readers_language():
    n = _notification(_row())
    assert n["type"] == "question_answered"
    assert n["target"] == {"kind": "page", "spaceId": S, "lessonId": L, "page": 12, "questionId": Q}
    assert n["phrase"] == {
        "title": {"key": "v4Spaces:notifications.items.questionAnswered.title"},
        "message": {"key": "v4Spaces:notifications.items.questionAnswered.message", "values": {"page": 12}},
    }


def test_an_answer_without_a_readable_link_still_opens_somewhere():
    n = _notification(_row(deep_link="/dashboard"))
    assert n["target"] == {"kind": "profile"} and "phrase" not in n


def test_other_kinds_are_as_before():
    n = _notification(_row(type="streak", deep_link=None))
    assert (n["type"], n["target"], "phrase" in n) == ("streak", {"kind": "profile"}, False)
    assert _notification(_row(type="level_up"))["type"] == "achievement"
```

- [ ] **Step 2: Run it to see it fail**

Run: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_notifications_world.py -q -p no:cacheprovider`
Expected: FAIL. The type comes back as `achievement`.

- [ ] **Step 3: Map it**

In `backend/services/v4_spaces_service.py`, add `from backend.services.v4_question_links import page_target` with the other imports. Replace `_KINDS` and `_notification`:

```python
# The kinds the v4 panel draws. The engine's level_up is an achievement there.
_KINDS = {"endorsed", "promoted", "liked", "new_lessons", "friend_request", "achievement", "streak", "question_answered"}


def _notification(r: Any) -> Dict[str, Any]:
    kind = r["type"] if r["type"] in _KINDS else "achievement"
    out: Dict[str, Any] = {
        "id": str(r["id"]),
        "title": r["title"] or "",
        "message": r["message"] or "",
        "type": kind,
        "read": bool(r["read"]),
        "created_at": r["created_at"].isoformat(),
        # Achievements, level-ups and streaks are about you: they open Profile.
        "target": {"kind": "profile"},
    }
    # An answer opens the page it was asked on, with the answer beneath (spec §6).
    target = page_target(r.get("deep_link")) if kind == "question_answered" else None
    if target:
        out["target"] = target
        out["phrase"] = {
            "title": {"key": "v4Spaces:notifications.items.questionAnswered.title"},
            "message": {"key": "v4Spaces:notifications.items.questionAnswered.message", "values": {"page": target["page"]}},
        }
    return out
```

In the world query at `:301`, change `"SELECT id, title, message, type, read, created_at FROM notifications "` to `"SELECT id, title, message, type, read, created_at, deep_link FROM notifications "`. (`asyncpg.Record` has `.get`.)

- [ ] **Step 4: Run the test and the world's DB tests**

```bash
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_notifications_world.py -q -p no:cacheprovider
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest -m db backend/tests/db/test_v4_world.py -q -p no:cacheprovider
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git status && git log -1
git add backend/services/v4_spaces_service.py backend/tests/unit/test_v4_notifications_world.py
git commit -m "feat(notifications): question_answered opens the page it was asked on"
```

---

### Task 7: A page's answers, for the reader

**Files:**
- Modify: `backend/services/v4_questions_service.py` (add `answers_for_reader`), `backend/api/v1/v4_questions.py` (add the route)
- Test: `backend/tests/unit/test_v4_questions_api.py`, `backend/tests/db/test_space_questions_db.py` (extend both)

**Interfaces:**
- Consumes: `can_view_lecture(lecture_id: UUID, user_id: str) -> bool` (`v4_reader_service`).
- Produces:
  - `async answers_for_reader(lecture_id: UUID, user_id: str) -> list[dict]`, each item `{"questionId", "page", "question", "answer": {"text", "forEveryone", "at"}, "mine": bool}`. It returns your own answered questions, plus questions answered for everyone in a Space you own or are enrolled in. Ordered by page, then newest answer. At most 100. Never a name.
  - Route `GET /api/v1/v4/reader/lectures/{lecture_id}/answers` → `{"answers": [...]}`. 404 when `can_view_lecture` is false. `60/minute`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_v4_questions_api.py`:

```python
def test_a_pages_answers_are_for_those_who_can_read_the_lesson(client, monkeypatch):
    import backend.services.v4_reader_service as reader

    readable = {"ok": True}

    async def can_view(lecture_id, uid):
        return readable["ok"]

    async def answers(lecture_id, user_id):
        return [{"questionId": QID, "page": 12, "question": "Why?", "answer": {"text": "Because.", "forEveryone": True, "at": "t"}, "mine": False}]

    monkeypatch.setattr(reader, "can_view_lecture", can_view)
    monkeypatch.setattr(service, "answers_for_reader", answers)
    url = f"/api/v1/v4/reader/lectures/{LESSON}/answers"
    body = client.get(url).json()
    assert body["answers"][0]["page"] == 12 and "asker" not in body["answers"][0]
    readable["ok"] = False
    assert client.get(url).status_code == 404
```

Append to `backend/tests/db/test_space_questions_db.py`:

```python
async def test_the_answer_comes_back_to_the_asker_and_to_everyone_only_when_meant(throwaway_db, room):
    from backend.services import v4_questions_service as svc

    private = await svc.send_question(room.course, str(room.mira), room.lesson, 4, "", "Mine only?", False)
    public = await svc.send_question(room.course, str(room.mira), room.lesson, 12, "", "For all?", True)
    waiting = await svc.send_question(room.course, str(room.mira), room.lesson, 2, "", "Still waiting", False)
    await svc.answer_question(room.course, uuid.UUID(private["id"]), str(room.owner), "Just for you.", "asker")
    await svc.answer_question(room.course, uuid.UUID(public["id"]), str(room.owner), "For everyone.", "space")

    mine = await svc.answers_for_reader(room.lesson, str(room.mira))
    assert [(a["page"], a["mine"], a["answer"]["forEveryone"]) for a in mine] == [(4, True, False), (12, True, True)]
    assert waiting["id"] not in json.dumps(mine)

    theirs = await svc.answers_for_reader(room.lesson, str(room.jonas))
    assert [(a["questionId"], a["question"], a["mine"]) for a in theirs] == [(public["id"], "For all?", False)]
    assert str(room.mira) not in json.dumps(theirs)

    assert await svc.answers_for_reader(room.lesson, str(room.outsider)) == []
```

- [ ] **Step 2: Run them to see them fail**

Run the two commands from Task 5 Step 2. Expected: FAIL. The route is 404 and `answers_for_reader` is missing.

- [ ] **Step 3: Write the service function**

Append to `backend/services/v4_questions_service.py`:

```python
_ANSWERS_SQL = """
SELECT q.id, q.page, q.text, q.answer, q.visibility, q.answered_at, (q.asker_id = $2::uuid) AS mine
FROM space_questions q
JOIN courses c ON c.id = q.course_id
JOIN lectures l ON l.id = q.lecture_id AND l.course_id = q.course_id
WHERE q.lecture_id = $1
  AND q.answer IS NOT NULL
  AND (q.asker_id = $2::uuid
       OR (q.visibility = 'space' AND (c.professor_id = $2::uuid OR EXISTS (
             SELECT 1 FROM course_enrollments e WHERE e.course_id = q.course_id AND e.user_id = $2::uuid))))
ORDER BY q.page, q.answered_at DESC
LIMIT 100
"""


def _answer(r: Any) -> dict[str, Any]:
    return {"text": r["answer"], "forEveryone": r["visibility"] == "space", "at": r["answered_at"].isoformat()}


async def answers_for_reader(lecture_id: UUID, user_id: str) -> list[dict[str, Any]]:
    """The answers on a Lesson's pages this reader may see: their own, and those answered for everyone."""
    async with await get_db_connection() as conn:
        rows = await conn.fetch(_ANSWERS_SQL, lecture_id, user_id)
    return [
        {"questionId": str(r["id"]), "page": r["page"], "question": r["text"], "answer": _answer(r), "mine": bool(r["mine"])}
        for r in rows
    ]
```

- [ ] **Step 4: Add the route**

Append to `backend/api/v1/v4_questions.py`:

```python
@router.get("/reader/lectures/{lecture_id}/answers")
@limiter.limit("60/minute")
async def v4_page_answers(request: Request, lecture_id: UUID, user: Any = Depends(verify_token)):
    """Answers on this Lesson's pages: yours, and the ones answered for everyone."""
    from backend.services import v4_reader_service as reader

    uid = _uid(user)
    if not await reader.can_view_lecture(lecture_id, uid):
        raise HTTPException(status_code=404, detail="Lecture not found.")
    return {"answers": await service.answers_for_reader(lecture_id, uid)}
```

- [ ] **Step 5: Run the tests**

Run the Task 5 Step 2 commands again, then ruff. Expected: PASS and clean.

- [ ] **Step 6: Commit**

```bash
git status && git log -1
git add backend/services/v4_questions_service.py backend/api/v1/v4_questions.py backend/tests/unit/test_v4_questions_api.py backend/tests/db/test_space_questions_db.py
git commit -m "feat(questions): GET /v4/reader/lectures/{id}/answers, yours and the ones for everyone"
```

---

### Task 8: The door is told who is waiting

**Files:**
- Modify: `backend/services/v4_questions_service.py` (add `questions_for_owner`), `backend/services/v4_landing_service.py` (`get_landing`, `landing_from`)
- Test: `backend/tests/unit/test_v4_landing_api.py` (fixture plus a test), `backend/tests/db/test_space_questions_db.py` (extend)

**Interfaces:**
- Produces:
  - `OPEN_LIST = 50`, `ANSWERED_LIST = 20`
  - `async questions_for_owner(space_id: UUID) -> {"questions": list[LandingQuestion], "answered": list[LandingQuestion]}`, exactly the "Contract with Plan 3" shape.
  - `get_landing()` returns the cached payload merged with fresh `questions_for_owner()`. `landing_from()` also returns `"answered": []`.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/unit/test_v4_landing_api.py`, inside the `client` fixture, add before `who = {"id": OWNER}`:

```python
    import backend.services.v4_questions_service as questions

    async def waiting(space_id):
        return {"questions": [{"id": "q1", "lessonId": L1, "page": 3, "text": "Why?", "asker": None, "createdAt": "t"}],
                "answered": []}

    monkeypatch.setattr(questions, "questions_for_owner", waiting)
```

Change the assertion `assert body["questions"] == []` in `test_the_owner_sees_the_space_in_aggregate_and_never_a_question` to:

```python
    assert body["questions"] == [{"id": "q1", "lessonId": L1, "page": 3, "text": "Why?", "asker": None, "createdAt": "t"}]
    assert body["answered"] == []
```

Then run `grep -rn "get_landing\|v4_landing" backend/tests/unit | grep -v test_v4_landing_api.py`. Every other unit test that reaches `get_landing` needs the same stub. Without it, it would open the `.env` database.

Append to `backend/tests/db/test_space_questions_db.py`:

```python
async def test_the_owner_sees_who_waits_by_name_only_when_they_chose_so(throwaway_db, room, monkeypatch):
    from backend.services import v4_landing_service as landing
    from backend.services import v4_questions_service as svc

    async def passthrough(key, view, compute, **kw):
        return await compute()

    monkeypatch.setattr(landing.analytics_cache, "get_or_compute_async", passthrough)

    named = await svc.send_question(room.course, str(room.mira), room.lesson, 12, "", "Why does the split lose it?", False)
    quiet = await svc.send_question(room.course, str(room.jonas), room.lesson, 3, "", "Is this 3NF?", True)
    done = await svc.send_question(room.course, str(room.jonas), room.lesson, 5, "", "Answered one", False)
    await svc.answer_question(room.course, uuid.UUID(done["id"]), str(room.owner), "Yes.", "asker")

    body = await landing.get_landing(room.course, str(room.owner), "en")
    assert [q["id"] for q in body["questions"]] == [quiet["id"], named["id"]]
    by_id = {q["id"]: q for q in body["questions"]}
    assert by_id[named["id"]]["asker"] == {"name": "Mira"}
    assert by_id[quiet["id"]]["asker"] is None
    assert all("answer" not in q for q in body["questions"])
    assert [(q["id"], q["answer"]["text"], q["answer"]["forEveryone"]) for q in body["answered"]] == [(done["id"], "Yes.", False)]
    text = json.dumps(body)
    assert str(room.mira) not in text and str(room.jonas) not in text
    # Under the reader floor (nobody has read anything) the questions are there all the same.
    assert body["readers"] == 0 and len(body["questions"]) == 2
```

- [ ] **Step 2: Run them to see them fail**

```bash
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests/unit/test_v4_landing_api.py -q -p no:cacheprovider
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest -m db backend/tests/db/test_space_questions_db.py -q -p no:cacheprovider
```

Expected: FAIL. `questions_for_owner` does not exist (the monkeypatch raises `AttributeError`), and `body["questions"] == []`.

- [ ] **Step 3: Write `questions_for_owner`**

Append to `backend/services/v4_questions_service.py`:

```python
#: What the owner's door lists: the waiting ones, and the most recently answered.
OPEN_LIST = 50
ANSWERED_LIST = 20

#: The name is decided here: "without my name" never leaves the database.
_OWNER_SQL = """
SELECT q.id, q.lecture_id, q.page, q.text, q.created_at, q.answer, q.visibility, q.answered_at,
       CASE WHEN q.anonymous THEN NULL
            ELSE COALESCE(NULLIF(btrim(p.display_name), ''), NULLIF(btrim(p.full_name), '')) END AS asker_name
FROM space_questions q
JOIN lectures l ON l.id = q.lecture_id AND l.course_id = q.course_id
LEFT JOIN profiles p ON p.user_id = q.asker_id
WHERE q.course_id = $1
  AND (q.answer IS NOT NULL) = $2
  AND NOT COALESCE(l.is_archived, false)
  AND COALESCE(l.visibility, 'course') = 'course'
ORDER BY COALESCE(q.answered_at, q.created_at) DESC
LIMIT $3
"""


def _for_owner(r: Any) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": str(r["id"]),
        "lessonId": str(r["lecture_id"]),
        "page": r["page"],
        "text": r["text"],
        "asker": {"name": r["asker_name"]} if r["asker_name"] else None,
        "createdAt": r["created_at"].isoformat(),
    }
    if r["answer"] is not None:
        out["answer"] = _answer(r)
    return out


async def questions_for_owner(space_id: UUID) -> dict[str, list[dict[str, Any]]]:
    """The owner's two lists: waiting (newest first) and answered (latest answer first). Callers guard ownership."""
    async with await get_db_connection() as conn:
        waiting = await conn.fetch(_OWNER_SQL, space_id, False, OPEN_LIST)
        answered = await conn.fetch(_OWNER_SQL, space_id, True, ANSWERED_LIST)
    return {"questions": [_for_owner(r) for r in waiting], "answered": [_for_owner(r) for r in answered]}
```

- [ ] **Step 4: Put them in the landing payload, outside the cache**

In `backend/services/v4_landing_service.py`:

- In the module docstring, replace `` `questions` arrive with the questions channel (Plan 4). `` with ``Questions (`questions` waiting, `answered`) are read fresh on every request, outside the cache: a person is waiting, and an answer must leave the list at once.``
- Replace the `return await analytics_cache.get_or_compute_async(...)` at the end of `get_landing` with:

```python
    cached = await analytics_cache.get_or_compute_async(
        str(space_id), "landing", compute, params={"lang": lang, "v": LANDING_VERSION}, ttl_seconds=LANDING_TTL
    )
    # Imported here: the questions service imports this module (space_row).
    from backend.services import v4_questions_service as questions

    return {**cached, **await questions.questions_for_owner(space_id)}
```

- In `landing_from`'s returned dict, after `"questions": [],` add `"answered": [],`.

- [ ] **Step 5: Run the tests**

Run both Step 2 commands, then the whole unit suite once (`… -m pytest backend/tests -m "not db" -q -p no:cacheprovider`). Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git status && git log -1
git add backend/services/v4_questions_service.py backend/services/v4_landing_service.py \
  backend/tests/unit/test_v4_landing_api.py backend/tests/db/test_space_questions_db.py
git commit -m "feat(landing): the door lists waiting and answered questions, fresh, named only by choice"
```

---

### Task 9: The seam: one place the app asks about questions

**Files:**
- Modify: `src/features/spaces/data/liveRepository.ts` (four methods in `createLiveRepository`, after `askPage`)
- Create: `src/features/spaces/data/questions.ts`, `src/features/spaces/mocks/questions.ts`
- Test: `src/features/spaces/__tests__/questions-live.test.ts`

**Interfaces:**
- Consumes: the routes from Tasks 4, 5 and 7; `isLive` (`data/useReader.ts:45`); `loadLiveRepository`; `LandingAnswer` (`landing/types.ts`); `Space` (`types.ts`).
- Produces, from `data/questions.ts`:
  - `interface PageAnswer { questionId: string; page: number; question: string; answer: LandingAnswer; mine: boolean }`
  - `interface SendBody { lessonId: string; page: number; idea: string; text: string; anonymous: boolean }`
  - `canSendToSpace(space: Pick<Space, 'personal' | 'viewerRole'> | null | undefined): boolean`
  - `sendQuestion(spaceId: string, body: SendBody): Promise<{ id: string }>`
  - `withdrawQuestion(spaceId: string, questionId: string): Promise<void>`
  - `answerQuestion(spaceId: string, questionId: string, text: string, forEveryone: boolean): Promise<LandingAnswer>`
  - `usePageAnswers(spaceId: string | undefined, lessonId: string | undefined): PageAnswer[]`
  - `announced(questionId: string): boolean`, `markAnnounced(questionId: string): void`
- Repository: `sendQuestion(spaceId, {lesson_id, page, idea, text, anonymous})`, `withdrawQuestion(spaceId, qid)`, `answerQuestion(spaceId, qid, {text, visibility})`, `pageAnswers(lectureId)`.

- [ ] **Step 1: Write the failing test**

Create `src/features/spaces/__tests__/questions-live.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveRepository, type V4Transport } from '../data/liveRepository';
import { announced, canSendToSpace, markAnnounced } from '../data/questions';
import { demoAnswers } from '../mocks/questions';

function transport() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const http: V4Transport = {
    get: vi.fn(async (path: string) => (calls.push({ method: 'GET', path }), { answers: [] })) as V4Transport['get'],
    post: vi.fn(async (path: string, body: unknown) => (calls.push({ method: 'POST', path, body }), {})) as V4Transport['post'],
    patch: vi.fn() as V4Transport['patch'],
    delete: vi.fn(async (path: string) => (calls.push({ method: 'DELETE', path }), {})) as V4Transport['delete'],
  };
  return { http, calls };
}

describe('questions, live', () => {
  it('sends, takes back, answers and reads answers on the paths the server serves', async () => {
    const { http, calls } = transport();
    const repo = createLiveRepository(http);
    await repo.sendQuestion('s1', { lesson_id: 'l1', page: 12, idea: 'BCNF', text: 'Why?', anonymous: true });
    await repo.withdrawQuestion('s1', 'q1');
    await repo.answerQuestion('s1', 'q1', { text: 'Because.', visibility: 'space' });
    await repo.pageAnswers('l1');
    expect(calls).toEqual([
      { method: 'POST', path: '/api/v1/v4/spaces/s1/questions', body: { lesson_id: 'l1', page: 12, idea: 'BCNF', text: 'Why?', anonymous: true } },
      { method: 'DELETE', path: '/api/v1/v4/spaces/s1/questions/q1' },
      { method: 'POST', path: '/api/v1/v4/spaces/s1/questions/q1/answer', body: { text: 'Because.', visibility: 'space' } },
      { method: 'GET', path: '/api/v1/v4/reader/lectures/l1/answers' },
    ]);
  });
});

describe('who may send', () => {
  it('a member of a real Space; never its owner, never your own Space, never before joining', () => {
    expect(canSendToSpace({ personal: false, viewerRole: 'member' })).toBe(true);
    expect(canSendToSpace({ personal: false, viewerRole: 'editor' })).toBe(true);
    expect(canSendToSpace({ personal: false, viewerRole: 'owner' })).toBe(false);
    expect(canSendToSpace({ personal: true, viewerRole: 'owner' })).toBe(false);
    expect(canSendToSpace({ personal: false, viewerRole: null })).toBe(false);
    expect(canSendToSpace(null)).toBe(false);
  });
});

describe('what Luna has already said', () => {
  beforeEach(() => localStorage.clear());

  it('remembers an announced answer, and still remembers it when storage refuses', () => {
    expect(announced('q1')).toBe(false);
    markAnnounced('q1');
    expect(announced('q1')).toBe(true);
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(announced('q1')).toBe(true);
    spy.mockRestore();
  });
});

describe('the demo', () => {
  it('has one answer for everyone on Normalization page 3, and none elsewhere', () => {
    expect(demoAnswers('l-s-dbs-4').map((a) => [a.page, a.mine, a.answer.forEveryone])).toEqual([[3, false, true]]);
    expect(demoAnswers('l-s-dbs-5')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/questions-live.test.ts`
Expected: FAIL. It cannot resolve `../data/questions` or `../mocks/questions`.

- [ ] **Step 3: Add the repository methods**

In `src/features/spaces/data/liveRepository.ts`, add `import type { LandingAnswer } from '../landing/types';` with the other imports. In the object returned by `createLiveRepository`, after `askPage: …,` add:

```ts
    /* Questions sent to the people who run a Space (spec §6). */
    sendQuestion: (spaceId: string, body: { lesson_id: string; page: number; idea: string; text: string; anonymous: boolean }) =>
      http.post<{ id: string; createdAt: string }>(`${root}/spaces/${idPath(spaceId)}/questions`, body),
    withdrawQuestion: (spaceId: string, questionId: string) =>
      http.delete<{ withdrawn: true }>(`${root}/spaces/${idPath(spaceId)}/questions/${idPath(questionId)}`),
    /** The owner's answer: to the person who asked (`asker`) or on that page for everyone (`space`). */
    answerQuestion: (spaceId: string, questionId: string, body: { text: string; visibility: 'asker' | 'space' }) =>
      http.post<{ id: string; answer: LandingAnswer }>(`${root}/spaces/${idPath(spaceId)}/questions/${idPath(questionId)}/answer`, body),
    /** The answers on a Lesson's pages this reader may see. */
    pageAnswers: (lectureId: string) =>
      http.get<{ answers: { questionId: string; page: number; question: string; answer: LandingAnswer; mine: boolean }[] }>(
        `${root}/reader/lectures/${idPath(lectureId)}/answers`,
      ),
```

- [ ] **Step 4: Write the seam and the demo answer**

Create `src/features/spaces/data/questions.ts`:

```ts
import { useEffect, useState } from 'react';
import type { LandingAnswer } from '../landing/types';
import type { Space } from '../types';
import { demoAnswers } from '../mocks/questions';
import { loadLiveRepository } from './liveRepository';
import { isLive } from './useReader';

/**
 * Questions a learner sends to the people who run a Space (spec §6).
 *
 * Live, the routes of `v4_questions.py`; in demo, an in-memory send and one
 * fixture answer, so the reader shows what it really does without a backend.
 * The text leaves the reader only when the learner presses Send.
 */

/** An answer on a page of the Lesson in view. Never a name. */
export interface PageAnswer {
  questionId: string;
  page: number;
  question: string;
  answer: LandingAnswer;
  /** The viewer asked it. */
  mine: boolean;
}

export interface SendBody {
  lessonId: string;
  page: number;
  idea: string;
  text: string;
  anonymous: boolean;
}

/** A member of a real Space may send; its owner answers, and your own Space has no one to ask. */
export function canSendToSpace(space: Pick<Space, 'personal' | 'viewerRole'> | null | undefined): boolean {
  return !!space && !space.personal && space.viewerRole !== null && space.viewerRole !== 'owner';
}

let demoSent = 0;

export async function sendQuestion(spaceId: string, body: SendBody): Promise<{ id: string }> {
  if (!isLive(spaceId, body.lessonId)) return { id: `demo-q-${++demoSent}` };
  const repo = await loadLiveRepository();
  const { id } = await repo.sendQuestion(spaceId, {
    lesson_id: body.lessonId,
    page: body.page,
    idea: body.idea,
    text: body.text,
    anonymous: body.anonymous,
  });
  return { id };
}

export async function withdrawQuestion(spaceId: string, questionId: string): Promise<void> {
  if (!isLive(spaceId, questionId)) return;
  const repo = await loadLiveRepository();
  await repo.withdrawQuestion(spaceId, questionId);
}

/** The owner's answer. Resolves with what was stored; rejects when it did not go. */
export async function answerQuestion(spaceId: string, questionId: string, text: string, forEveryone: boolean): Promise<LandingAnswer> {
  if (!isLive(spaceId, questionId)) return { text, forEveryone, at: new Date().toISOString() };
  const repo = await loadLiveRepository();
  const { answer } = await repo.answerQuestion(spaceId, questionId, { text, visibility: forEveryone ? 'space' : 'asker' });
  return answer;
}

/** The answers on this Lesson's pages: yours, and those answered for everyone. Asked once per Lesson. */
export function usePageAnswers(spaceId: string | undefined, lessonId: string | undefined): PageAnswer[] {
  const live = !!lessonId && isLive(spaceId, lessonId);
  const [answers, setAnswers] = useState<PageAnswer[]>(() => (lessonId && !live ? demoAnswers(lessonId) : []));
  useEffect(() => {
    if (!lessonId) return setAnswers([]);
    if (!live) return setAnswers(demoAnswers(lessonId));
    let gone = false;
    loadLiveRepository()
      .then((repo) => repo.pageAnswers(lessonId))
      .then((r) => {
        if (!gone) setAnswers(r.answers);
      })
      .catch(() => {
        /* Answers are an addition to the page; without them it still reads. */
      });
    return () => {
      gone = true;
    };
  }, [lessonId, live]);
  return answers;
}

/*
 * Which of your answers Luna (or the page) has already told you about, in this
 * browser. A per-viewer convenience: storage may be blocked, so an in-memory
 * copy keeps her from saying it twice in one visit.
 */
const KEY = 'ls.questions.announced';
const told = new Set<string>();

function stored(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function announced(questionId: string): boolean {
  return told.has(questionId) || stored().includes(questionId);
}

export function markAnnounced(questionId: string): void {
  told.add(questionId);
  try {
    const all = [...new Set([...stored(), questionId])].slice(-200);
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* A convenience; the in-memory copy holds for this visit. */
  }
}
```

Create `src/features/spaces/mocks/questions.ts`:

```ts
import type { PageAnswer } from '../data/questions';

/**
 * The demo's answered question: one, answered for everyone, on Normalization
 * page 3, so the reader shows the card without a backend.
 */
const ANSWERS: Record<string, PageAnswer[]> = {
  'l-s-dbs-4': [
    {
      questionId: 'q-demo-1',
      page: 3,
      question: 'Is a candidate key always the primary key?',
      answer: {
        text: 'No. A table can have several candidate keys; the primary key is the one you choose to identify rows by. The others stay keys all the same.',
        forEveryone: true,
        at: '2026-08-30T09:00:00Z',
      },
      mine: false,
    },
  ],
};

export const demoAnswers = (lessonId: string): PageAnswer[] => ANSWERS[lessonId] ?? [];
```

- [ ] **Step 5: Run the tests and the seal**

```bash
npx vitest run src/features/spaces/__tests__/questions-live.test.ts src/features/spaces/__tests__/boundary.test.ts src/features/spaces/__tests__/seam.test.ts src/features/spaces/__tests__/telemetry-live.test.ts
npx tsc --noEmit -p tsconfig.app.json
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status && git log -1
git add src/features/spaces/data/liveRepository.ts src/features/spaces/data/questions.ts src/features/spaces/mocks/questions.ts src/features/spaces/__tests__/questions-live.test.ts
git commit -m "feat(spaces): one seam for questions to a Space, live and demo"
```

---

### Task 10: The sheet in the reader

**Files:**
- Modify: `src/features/spaces/landing/SendToSpace.tsx` (`SendSheet` gains `sending`, `failed`)
- Create: `src/features/spaces/components/reader/SendToSpaceDock.tsx`
- Modify: `src/i18n/locales/en/v4Landing.json`, `src/i18n/locales/de/v4Landing.json` (`reader.*`)
- Test: `src/features/spaces/__tests__/send-to-space.test.tsx`

**Interfaces:**
- Consumes: `sendQuestion` and `withdrawQuestion` (Task 9).
- Produces:
  - `interface SendRequest { draft: string; page: number; idea: string }`
  - `SendToSpaceDock({ request, spaceId, lessonId, lessonTitle, lunaOpen, onSent, onClose })`. `request: SendRequest | null` (null renders nothing). `onSent(questionId)` is called once it is stored. When `lunaOpen` is true the dock closes itself after sending (Luna says it). Otherwise it shows the quiet confirmation with **Take it back**.

- [ ] **Step 1: Add the strings**

In `src/i18n/locales/en/v4Landing.json`, under `reader`, change two values and add five keys:

```json
"who": "The people who run this Space will see it. If they answer it for everyone, it shows on this page without your name.",
"page": "{{lesson}}, page {{page}}",
"sending": "Sending",
"failed": "That did not go through. Try again in a moment.",
"sentQuiet": "Sent. The answer will show on this page.",
"withdraw": "Take it back",
"close": "Close",
```

In `src/i18n/locales/de/v4Landing.json`, under `reader`:

```json
"who": "Die Leute, die diesen Space pflegen, sehen es. Beantworten sie es für alle, erscheint es auf dieser Seite, ohne deinen Namen.",
"page": "{{lesson}}, Seite {{page}}",
"sending": "Wird geschickt",
"failed": "Das hat nicht geklappt. Versuch es gleich noch mal.",
"sentQuiet": "Geschickt. Die Antwort erscheint auf dieser Seite.",
"withdraw": "Zurücknehmen",
"close": "Schließen",
```

- [ ] **Step 2: Write the failing test**

Create `src/features/spaces/__tests__/send-to-space.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@/i18n';

const { send, withdraw } = vi.hoisted(() => ({ send: vi.fn(), withdraw: vi.fn() }));
vi.mock('../data/questions', async (orig) => ({
  ...(await orig<typeof import('../data/questions')>()),
  sendQuestion: send,
  withdrawQuestion: withdraw,
}));

import { SendToSpaceDock } from '../components/reader/SendToSpaceDock';

const dock = (extra: Partial<Parameters<typeof SendToSpaceDock>[0]> = {}) => {
  const onSent = vi.fn();
  const onClose = vi.fn();
  render(
    <SendToSpaceDock
      request={{ draft: 'Why does the split lose a dependency?', page: 12, idea: 'BCNF' }}
      spaceId="s1" lessonId="l1" lessonTitle="Normalization" lunaOpen={false}
      onSent={onSent} onClose={onClose} {...extra}
    />,
  );
  return { onSent, onClose };
};

beforeEach(() => {
  send.mockReset();
  withdraw.mockReset();
});

describe('sending a question from the reader', () => {
  it('opens on your own words with the page attached, and sends them with the name choice', async () => {
    send.mockResolvedValue({ id: 'q1' });
    const { onSent } = dock();
    expect(screen.getByText('Normalization, page 12')).not.toBeNull();
    const box = screen.getByRole('textbox', { name: 'Your question' });
    expect((box as HTMLTextAreaElement).value).toBe('Why does the split lose a dependency?');
    fireEvent.click(screen.getByRole('switch', { name: 'Without my name' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('button', { name: 'Sending' })).toBeDisabled();
    await waitFor(() => expect(onSent).toHaveBeenCalledWith('q1'));
    expect(send).toHaveBeenCalledWith('s1', { lessonId: 'l1', page: 12, idea: 'BCNF', text: 'Why does the split lose a dependency?', anonymous: true });
    expect(screen.getByText('Sent. The answer will show on this page.')).not.toBeNull();
  });

  it('can be taken back from the confirmation', async () => {
    send.mockResolvedValue({ id: 'q1' });
    withdraw.mockResolvedValue(undefined);
    const { onClose } = dock();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Take it back' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(withdraw).toHaveBeenCalledWith('s1', 'q1');
  });

  it('with Luna open it closes and lets her say it', async () => {
    send.mockResolvedValue({ id: 'q1' });
    const { onSent, onClose } = dock({ lunaOpen: true });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSent).toHaveBeenCalledWith('q1');
    expect(screen.queryByText('Sent. The answer will show on this page.')).toBeNull();
  });

  it('says so when it did not go, and keeps the words', async () => {
    send.mockRejectedValue(new Error('429'));
    dock();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That did not go through.');
    expect((screen.getByRole('textbox', { name: 'Your question' }) as HTMLTextAreaElement).value).toContain('dependency');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('is nothing until asked for', () => {
    const { container } = render(
      <SendToSpaceDock request={null} spaceId="s1" lessonId="l1" lessonTitle="N" lunaOpen={false} onSent={vi.fn()} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/send-to-space.test.tsx`
Expected: FAIL. It cannot resolve `../components/reader/SendToSpaceDock`.

- [ ] **Step 4: Teach the sheet to wait and to fail**

In `src/features/spaces/landing/SendToSpace.tsx`, `SendSheet`:
- Add to the props type `/** A send is in flight. */ sending?: boolean;` and `/** The last send did not go; the words stay. */ failed?: boolean;`, destructured with defaults `sending = false, failed = false`.
- On the `<textarea>`, add `maxLength={500}`.
- Replace the Send button with:

```tsx
            <button type="button" onClick={() => onSend({ text: text.trim(), anonymous })} disabled={!text.trim() || sending} className={whitePillSm}>
              {sending ? t('reader.sending') : t('reader.sendNow')}
            </button>
```

- Directly after the closing `</div>` of the button row, add:

```tsx
          {failed && (
            <p role="alert" className="mt-3 text-[13px] text-quiet">
              {t('reader.failed')}
            </p>
          )}
```

- [ ] **Step 5: Write the dock**

Create `src/features/spaces/components/reader/SendToSpaceDock.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ghostPillSm } from '../stage';
import { SendSheet, type Sent } from '../../landing/SendToSpace';
import { sendQuestion, withdrawQuestion } from '../../data/questions';

/** What the reader asks the dock to send: the learner's words so far, the page, the idea. */
export interface SendRequest {
  draft: string;
  page: number;
  idea: string;
}

type Phase = 'editing' | 'sending' | 'failed' | 'sent';

/**
 * The Send sheet, in the reader.
 *
 * Sits in the checkpoint card's lane, clear of the pager and the ask bar.
 * After Send: if Luna is open she says "Sent." and this closes; otherwise one
 * quiet line says where the answer will show, with a way to take it back.
 */
export function SendToSpaceDock({
  request,
  spaceId,
  lessonId,
  lessonTitle,
  lunaOpen,
  onSent,
  onClose,
}: {
  request: SendRequest | null;
  spaceId: string;
  lessonId: string;
  lessonTitle: string;
  lunaOpen: boolean;
  onSent: (questionId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('v4Landing');
  const [phase, setPhase] = useState<Phase>('editing');
  const [sentId, setSentId] = useState<string | null>(null);
  const [takeBackFailed, setTakeBackFailed] = useState(false);
  /* A new request starts again from the sheet. */
  const [current, setCurrent] = useState(request);
  if (current !== request) {
    setCurrent(request);
    setPhase('editing');
    setSentId(null);
    setTakeBackFailed(false);
  }
  if (!request) return null;

  const send = ({ text, anonymous }: Sent) => {
    setPhase('sending');
    sendQuestion(spaceId, { lessonId, page: request.page, idea: request.idea, text, anonymous })
      .then(({ id }) => {
        onSent(id);
        if (lunaOpen) {
          onClose();
          return;
        }
        setSentId(id);
        setPhase('sent');
      })
      .catch(() => setPhase('failed'));
  };

  const takeBack = () => {
    if (!sentId) return onClose();
    withdrawQuestion(spaceId, sentId)
      .then(onClose)
      .catch(() => setTakeBackFailed(true));
  };

  return (
    <div className="fixed bottom-[max(112px,calc(env(safe-area-inset-bottom)+104px))] left-5 right-5 z-[46] sm:left-auto sm:w-96">
      {phase === 'sent' ? (
        <div role="status" className="rounded-2xl border border-white/[0.1] bg-popover p-5">
          <p className="text-[15px] leading-relaxed">{t('reader.sentQuiet')}</p>
          {takeBackFailed && (
            <p role="alert" className="mt-2 text-[13px] text-quiet">
              {t('reader.failed')}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={takeBack} className={ghostPillSm}>
              {t('reader.withdraw')}
            </button>
            <button type="button" onClick={onClose} className={ghostPillSm}>
              {t('reader.close')}
            </button>
          </div>
        </div>
      ) : (
        <SendSheet
          open
          page={request.page}
          lesson={lessonTitle}
          draft={request.draft}
          sending={phase === 'sending'}
          failed={phase === 'failed'}
          onSend={send}
          onClose={onClose}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run the tests and lint**

```bash
npx vitest run src/features/spaces/__tests__/send-to-space.test.tsx src/features/spaces/__tests__/landing.test.tsx
npm run lint
npx tsc --noEmit -p tsconfig.app.json
```

Expected: PASS. If `landing.test.tsx` asserts the old `reader.page` text ("Page 12 · Normalization"), update that expectation to "Normalization, page 12".

- [ ] **Step 7: Commit**

```bash
git status && git log -1
git add src/features/spaces/landing/SendToSpace.tsx src/features/spaces/components/reader/SendToSpaceDock.tsx \
  src/i18n/locales/en/v4Landing.json src/i18n/locales/de/v4Landing.json src/features/spaces/__tests__/send-to-space.test.tsx \
  src/features/spaces/__tests__/landing.test.tsx
git commit -m "feat(reader): the Send sheet, with a quiet confirmation and a way to take it back"
```

---

### Task 11: The quiet line, under Ask, under Luna, at "Still foggy"

**Files:**
- Modify: `src/features/spaces/components/reader/iui/ExplainPanel.tsx` (`Props`, the turns map near `:279`)
- Modify: `src/features/spaces/components/reader/CheckpointCard.tsx` (`Props` at `:30-42`, the check-in group at `:129-150`)
- Modify: `src/features/spaces/components/reader/luna/SessionColumn.tsx` (props, the thread map, the `aside` slot)
- Test: `src/features/spaces/__tests__/send-lines.test.tsx`

**Interfaces:**
- Consumes: `SendLine` and `LunaLine` (`landing/SendToSpace.tsx`).
- Produces:
  - `ExplainPanel` prop `onSendToSpace?: (question: string) => void`: one `SendLine` under every ready answer to a question, carrying that question.
  - `CheckpointCard` prop `onSendToSpace?: () => void`: one `SendLine` once "Still foggy" is chosen.
  - `SessionColumn` props `onSendToSpace?: (text: string) => void` (one `SendLine` under Luna's latest reply to something the learner wrote, carrying their words, hidden while she is busy) and `aside?: React.ReactNode` (rendered at the end of the thread).

- [ ] **Step 1: Write the failing test**

Create `src/features/spaces/__tests__/send-lines.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { ExplainPanel } from '../components/reader/iui/ExplainPanel';
import { CheckpointCard } from '../components/reader/CheckpointCard';
import { SessionColumn } from '../components/reader/luna/SessionColumn';
import { initialLuna } from '../data/useLunaSession';

vi.mock('../data/lunaSession', async (orig) => ({
  ...(await orig<typeof import('../data/lunaSession')>()),
  lunaApi: { due: vi.fn().mockResolvedValue({ cards: [] }), grade: vi.fn() },
}));
Element.prototype.scrollIntoView = vi.fn();

const LINE = 'Still foggy? Send it to the Space.';

describe('the Send line', () => {
  it('sits under an Ask answer and carries the question asked', async () => {
    const onSend = vi.fn();
    render(
      <MemoryRouter>
        <ExplainPanel
          answerKey="l1-12" answer={null} page={12} onSpot={vi.fn()} onAsk={vi.fn()}
          ask={async () => ({ title: 'A split can lose a dependency', format: 'In a sentence', blocks: [] })}
          queued={{ question: 'Why does BCNF lose it?', n: 1 }}
          onSendToSpace={onSend}
        />
      </MemoryRouter>,
    );
    await screen.findByText('A split can lose a dependency');
    fireEvent.click(screen.getByRole('button', { name: LINE }));
    expect(onSend).toHaveBeenCalledWith('Why does BCNF lose it?');
  });

  it('is not there when sending is not for this reader', async () => {
    render(
      <MemoryRouter>
        <ExplainPanel answerKey="l1-12" answer={null} page={12} onSpot={vi.fn()} onAsk={vi.fn()}
          ask={async () => ({ title: 'Answered', format: 'x', blocks: [] })} queued={{ question: 'Why?', n: 1 }} />
      </MemoryRouter>,
    );
    await screen.findByText('Answered');
    expect(screen.queryByRole('button', { name: LINE })).toBeNull();
  });

  it('appears at the check-in only once it is still foggy', () => {
    const onSend = vi.fn();
    render(
      <MemoryRouter>
        <CheckpointCard idea={{ name: 'Joins', first: 4, last: 9 }} lectureTitle="Relational Algebra"
          load={() => new Promise(() => {})} pageHref={(p) => `/p/${p}`} onDone={vi.fn()} onDismiss={vi.fn()}
          onCheckIn={vi.fn()} onSendToSpace={onSend} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: LINE })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clicked' }));
    expect(screen.queryByRole('button', { name: LINE })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Still foggy' }));
    fireEvent.click(screen.getByRole('button', { name: LINE }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('sits under Luna’s latest reply and carries the learner’s own words', () => {
    const onSend = vi.fn();
    const luna = {
      state: {
        ...initialLuna, sessionId: 's1',
        thread: [
          { kind: 'learner' as const, id: 'a', text: 'I have an exam soon' },
          { kind: 'luna' as const, id: 'b', md: 'Let us plan.', blocks: [], check: null },
          { kind: 'learner' as const, id: 'c', text: 'Why is 3NF weaker than BCNF?' },
          { kind: 'luna' as const, id: 'd', md: 'Because 3NF allows one exception.', blocks: [], check: null },
        ],
      },
      start: vi.fn(), send: vi.fn(), act: vi.fn(), answerCheck: vi.fn(), wrapUp: vi.fn(), keep: vi.fn(), practise: vi.fn(), close: vi.fn(),
    };
    render(<SessionColumn luna={luna as never} lessonId="l" onOpenPage={vi.fn()} onClose={vi.fn()} onSpot={vi.fn()}
      onSendToSpace={onSend} aside={<p>Sent. I'll tell you when they answer.</p>} />);
    const lines = screen.getAllByRole('button', { name: LINE });
    expect(lines).toHaveLength(1);
    fireEvent.click(lines[0]);
    expect(onSend).toHaveBeenCalledWith('Why is 3NF weaker than BCNF?');
    expect(screen.getByText("Sent. I'll tell you when they answer.")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/send-lines.test.tsx`
Expected: FAIL. No button "Still foggy? Send it to the Space." exists, and TypeScript complains about the unknown props.

- [ ] **Step 3: ExplainPanel**

In `ExplainPanel.tsx`:
- Add `import { SendLine } from '../../../landing/SendToSpace';`.
- In `interface Props`, add `/** Send the learner's question to the people who run the Space (spec §6). Only where they may. */ onSendToSpace?: (question: string) => void;`.
- Add `onSendToSpace` to the destructured props of `ExplainPanel`.
- Directly after the `{turn.status === 'ready' && turn.answer && ( <TurnAnswer … /> )}` block, add:

```tsx
              {turn.status === 'ready' && turn.answer && onSendToSpace && (
                <SendLine onOpen={() => onSendToSpace(turn.question)} className="-ml-2 mt-5" />
              )}
```

- [ ] **Step 4: CheckpointCard**

In `CheckpointCard.tsx`:
- Add `import { SendLine } from '../../landing/SendToSpace';`.
- In `Props`, after `onCheckIn`, add `/** After "Still foggy": send it to the people who run the Space (spec §6). */ onSendToSpace?: () => void;` and add `onSendToSpace` to the destructuring at `:47`.
- Directly after the check-in group's closing `</div>` (the `role="group"` element, closed before `<div className="mt-4 flex flex-wrap gap-2">`), still inside the `{onCheckIn && phase !== 'failed' && (` fragment, wrap the group and add the line:

```tsx
          {onCheckIn && phase !== 'failed' && (
            <>
              <div role="group" aria-label={t('checkpoint.checkin.label')} className="mt-3 flex flex-wrap gap-1.5">
                {/* …the two chips, unchanged… */}
              </div>
              {onSendToSpace && rating === 'confused' && <SendLine onOpen={onSendToSpace} className="-ml-2 mt-2" />}
            </>
          )}
```

- [ ] **Step 5: SessionColumn**

In `SessionColumn.tsx`:
- Change the first import line to `import { useEffect, useRef, useState, type ReactNode } from 'react';` and add `import { SendLine } from '../../../landing/SendToSpace';`.
- Extend the props: add `onSendToSpace, aside,` to the destructuring and to the type:

```ts
  /** Send the learner's own words to the people who run the Space (spec §6). Only where they may. */
  onSendToSpace?: (text: string) => void;
  /** Luna's templated lines from the reader ("Sent.", "They answered…"), at the end of the thread. */
  aside?: ReactNode;
```

- Below `const lastLuna = …`, add:

```ts
  /* Luna's latest reply to something the learner wrote, with those words: where the Send line goes. */
  const reply = (() => {
    for (let i = state.thread.length - 1; i > 0; i--) {
      const item = state.thread[i];
      const before = state.thread[i - 1];
      if (item.kind === 'luna' && before.kind === 'learner') return { id: item.id, text: before.text };
    }
    return null;
  })();
```

- In the thread map's Luna branch, after the `{item.check && <Check … />}` line, add:

```tsx
                {onSendToSpace && reply?.id === item.id && !state.busy && (
                  <SendLine onOpen={() => onSendToSpace(reply.text)} className="-ml-2 mt-1" />
                )}
```

- Directly before `<div ref={end} />`, add `{aside}`.

- [ ] **Step 6: Run the tests**

```bash
npx vitest run src/features/spaces/__tests__/send-lines.test.tsx src/features/spaces/__tests__/checkpoint-checkin.test.tsx src/features/spaces/__tests__/luna-components.test.tsx src/features/spaces/components/__tests__/checkpoint.test.tsx
npx tsc --noEmit -p tsconfig.app.json
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git status && git log -1
git add src/features/spaces/components/reader/iui/ExplainPanel.tsx src/features/spaces/components/reader/CheckpointCard.tsx \
  src/features/spaces/components/reader/luna/SessionColumn.tsx src/features/spaces/__tests__/send-lines.test.tsx
git commit -m "feat(reader): one quiet Send line under Ask, under Luna, and at Still foggy"
```

---

### Task 12: An answer, on the page it was asked on

**Files:**
- Create: `src/features/spaces/components/reader/AnsweredOnPage.tsx`
- Modify: `src/i18n/locales/{en,de}/v4Landing.json` (`reader.answered.line`)
- Test: `src/features/spaces/__tests__/answered-on-page.test.tsx`

**Interfaces:**
- Consumes: `AnsweredHere` (`landing/AnsweredHere.tsx`), `PageAnswer` (Task 9).
- Produces: `AnsweredOnPage({ answers, open, accent, onOpen, onClose })`. `answers` are those on the page in view, yours first. Closed, it is one pill, "Answered here". Open, it shows each answer as an `AnsweredHere` card on an opaque ground, with Close. With no answers it renders nothing.

- [ ] **Step 1: Add the string**

`en` `reader.answered`: add `"line": "Answered here"`. `de` `reader.answered`: add `"line": "Hier beantwortet"`.

- [ ] **Step 2: Write the failing test**

Create `src/features/spaces/__tests__/answered-on-page.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { AnsweredOnPage } from '../components/reader/AnsweredOnPage';
import type { PageAnswer } from '../data/questions';

const MINE: PageAnswer = { questionId: 'q1', page: 12, question: 'Why?', answer: { text: 'Because BCNF splits it.', forEveryone: false, at: 't' }, mine: true };
const ALL: PageAnswer = { questionId: 'q2', page: 12, question: 'Is this 3NF?', answer: { text: 'Not yet.', forEveryone: true, at: 't' }, mine: false };

describe('answers on the page', () => {
  it('closed, one quiet pill; it opens on request', () => {
    const onOpen = vi.fn();
    render(<AnsweredOnPage answers={[ALL]} open={false} accent="#06b6d4" onOpen={onOpen} onClose={vi.fn()} />);
    expect(screen.queryByText('Not yet.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Answered here' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('open, your question marked as yours, the one for everyone marked so, never a name', () => {
    const onClose = vi.fn();
    render(<AnsweredOnPage answers={[MINE, ALL]} open accent="#06b6d4" onOpen={vi.fn()} onClose={onClose} />);
    expect(screen.getByText('Because BCNF splits it.')).not.toBeNull();
    expect(screen.getByText('Your question')).not.toBeNull();
    expect(screen.getByText('Is this 3NF?')).not.toBeNull();
    expect(screen.getByText('Answered for everyone')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('is nothing on a page without answers', () => {
    const { container } = render(<AnsweredOnPage answers={[]} open={false} accent="#fff" onOpen={vi.fn()} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/answered-on-page.test.tsx`
Expected: FAIL. It cannot resolve `../components/reader/AnsweredOnPage`.

- [ ] **Step 4: Write it**

Create `src/features/spaces/components/reader/AnsweredOnPage.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { MessageCircle, X } from 'lucide-react';
import { AnsweredHere } from '../../landing/AnsweredHere';
import type { PageAnswer } from '../../data/questions';

/** The checkpoint card's lane: clear of the pager and the ask bar (LS-053). */
const LANE = 'fixed bottom-[max(112px,calc(env(safe-area-inset-bottom)+104px))] right-5 z-[44]';

/**
 * Answers to questions asked on the page in view.
 *
 * Never over the page by default: one quiet pill, unless the reader opened it
 * or it is your own new answer. Open, each answer is the room's card, on an
 * opaque ground so the page beneath does not show through.
 */
export function AnsweredOnPage({
  answers,
  open,
  accent,
  onOpen,
  onClose,
}: {
  answers: PageAnswer[];
  open: boolean;
  accent: string;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('v4Landing');
  if (answers.length === 0) return null;

  if (!open)
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`${LANE} console-focusable inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.09] bg-[#0b0b0c] px-4 text-[13px] text-quiet transition-colors hover:text-foreground`}
      >
        <MessageCircle aria-hidden className="h-3.5 w-3.5" />
        {t('reader.answered.line')}
      </button>
    );

  return (
    <div className={`${LANE} left-5 max-h-[60vh] space-y-3 overflow-y-auto sm:left-auto sm:w-96`}>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('reader.close')}
          className="console-focusable flex h-8 w-8 items-center justify-center rounded-full bg-[#0b0b0c] text-quiet transition-colors hover:text-foreground"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>
      {answers.map((a) => (
        <div key={a.questionId} className="rounded-2xl bg-[#0b0b0c]">
          <AnsweredHere question={a.question} answer={a.answer} accent={accent} mine={a.mine} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run the test and lint**

```bash
npx vitest run src/features/spaces/__tests__/answered-on-page.test.tsx
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status && git log -1
git add src/features/spaces/components/reader/AnsweredOnPage.tsx src/features/spaces/__tests__/answered-on-page.test.tsx \
  src/i18n/locales/en/v4Landing.json src/i18n/locales/de/v4Landing.json
git commit -m "feat(reader): an answer shows on the page it was asked on, quietly"
```

---

### Task 13: Wire it into the live reader

**Files:**
- Modify: `src/features/spaces/screens/LessonFacesScreen.tsx` (wiring only)
- Test: `src/features/spaces/components/__tests__/readerAnswers.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 9 to 12. Existing in the screen: `params` (`useSearchParams`), `pdfPage`, `view`, `bench`, `offer`, `care`, `accent`, `lunaOn` (`:524`), `lunaOpen`/`setLunaOpen` (`:525`), `goToPage` (`:434`), `ideaName`, `space`, `lesson`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Create `src/features/spaces/components/__tests__/readerAnswers.test.tsx`. It reuses the harness of `readerCovered.test.tsx`, in demo mode, on Normalization, whose page 3 holds the demo answer:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { RefObject } from 'react';

vi.mock('@/components/pdf', () => ({
  PdfPage: ({ page }: { page: number }) => <div data-testid="sheet" data-page={page} />,
  PdfPager: ({ rootRef, page }: { rootRef: RefObject<HTMLDivElement>; page: number }) => (
    <div ref={rootRef} data-testid="document">
      Page {page}
    </div>
  ),
  pdfPageId: (p: number) => `pdf-page-${p}`,
  sampleAccent: () => null,
  warmPdfWorker: () => {},
}));

import LessonFacesScreen from '../../screens/LessonFacesScreen';

const open = async (path: string) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v4/space/:spaceId/lesson/:lessonId/faces" element={<LessonFacesScreen />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTestId('document', {}, { timeout: 4000 });
  await act(async () => {});
};

describe('answers in the reader', () => {
  it('a page with an answer offers it quietly, and opens it on request', async () => {
    await open('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=3');
    expect(screen.queryByText(/several candidate keys/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Answered here' }));
    expect(screen.getByText(/several candidate keys/)).not.toBeNull();
  });

  it('arriving from the notification, it is open at once', async () => {
    await open('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=3&question=q-demo-1');
    expect(screen.getByText(/several candidate keys/)).not.toBeNull();
  });

  it('a page without one shows nothing', async () => {
    await open('/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=2');
    expect(screen.queryByRole('button', { name: 'Answered here' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/features/spaces/components/__tests__/readerAnswers.test.tsx`
Expected: FAIL. There is no "Answered here" button.

- [ ] **Step 3: Wire the screen**

In `LessonFacesScreen.tsx`:

Imports:

```ts
import { announced, canSendToSpace, markAnnounced, usePageAnswers, withdrawQuestion } from '../data/questions';
import { SendToSpaceDock, type SendRequest } from '../components/reader/SendToSpaceDock';
import { AnsweredOnPage } from '../components/reader/AnsweredOnPage';
import { LunaLine } from '../landing/SendToSpace';
```

Next to `const { t: tl } = useTranslation('v4Luna');` (`:168`), add `const { t: tq } = useTranslation('v4Landing');`.

After the `lunaOpen` state (`:525-527`), so before any early return, add the state and effects:

```ts
  /* Questions to the Space (spec §6): the sheet, Luna's templated lines, the answers on this Lesson's pages. */
  const [sendReq, setSendReq] = useState<SendRequest | null>(null);
  const [lunaSays, setLunaSays] = useState<{ kind: 'sent' | 'answered'; questionId: string; page: number } | null>(null);
  const [arrivedFor] = useState(() => params.get('question'));
  const [answersOpenOn, setAnswersOpenOn] = useState<number | null>(null);
  const pageAnswers = usePageAnswers(spaceId, lessonId);
  /* From the notification: that answer, open, on its page. */
  useEffect(() => {
    const a = arrivedFor ? pageAnswers.find((x) => x.questionId === arrivedFor) : undefined;
    if (!a) return;
    setAnswersOpenOn(a.page);
    markAnnounced(a.questionId);
  }, [pageAnswers, arrivedFor]);
  /* Your own new answer on the page in view opens by itself, once. */
  useEffect(() => {
    const mine = pageAnswers.find((a) => a.mine && a.page === pdfPage && !announced(a.questionId));
    if (!mine) return;
    setAnswersOpenOn(pdfPage);
    markAnnounced(mine.questionId);
  }, [pageAnswers, pdfPage]);
  /* Turning the page closes what was open on the last one. */
  useEffect(() => {
    setAnswersOpenOn((p) => (p === pdfPage ? p : null));
  }, [pdfPage]);
  /* Luna, when open, tells you about an answer elsewhere in this Lesson. */
  useEffect(() => {
    if (!lunaOn || !lunaOpen || lunaSays) return;
    const fresh = pageAnswers.find((a) => a.mine && !announced(a.questionId));
    if (fresh) setLunaSays({ kind: 'answered', questionId: fresh.questionId, page: fresh.page });
  }, [lunaOn, lunaOpen, lunaSays, pageAnswers]);
```

In the render body, after `const myNotes = …` (that is, after every early return, where `space` and `lesson` are known), add:

```ts
  /* Who may send, and the three places the line opens the sheet from. */
  const askSpace = canSendToSpace(space)
    ? (draft: string, page: number, idea: string) => setSendReq({ draft: draft.slice(0, 500), page, idea: idea.slice(0, 120) })
    : undefined;
  const answersHere = pageAnswers.filter((a) => a.page === pdfPage).sort((a, b) => Number(b.mine) - Number(a.mine));
  const checkpointShowing = !!offer && !care.due && !care.resting;
  const answersShown = view === 'slide' && !bench && !checkpointShowing && !sendReq;
  const lunaAside =
    lunaSays?.kind === 'sent' ? (
      <LunaLine
        text={tq('reader.sent')}
        action={{
          label: tq('reader.withdraw'),
          onClick: () => {
            withdrawQuestion(space.id, lunaSays.questionId).then(() => setLunaSays(null)).catch(() => {});
          },
        }}
      />
    ) : lunaSays?.kind === 'answered' ? (
      <LunaLine
        text={tq('reader.answeredLuna', { page: lunaSays.page })}
        action={{
          label: tq('reader.read'),
          onClick: () => {
            markAnnounced(lunaSays.questionId);
            setView('slide');
            setAnswersOpenOn(lunaSays.page);
            goToPage(lunaSays.page);
            setLunaSays(null);
          },
        }}
      />
    ) : null;
```

Pass the line to the three places:
- `<ExplainPanel …>` (`:1702`): add `onSendToSpace={askSpace ? (q) => askSpace(q, pdfPage, ideaName) : undefined}`.
- `<CheckpointCard …>` (`:1639`): add `onSendToSpace={askSpace && offer ? () => askSpace('', pdfPage, offer.name) : undefined}`.
- `<SessionColumn …>` (`:1769`): add `onSendToSpace={askSpace ? (text) => askSpace(text, pdfPage, ideaName) : undefined}` and `aside={lunaAside}`.

Directly after the `<CheckpointCard … />` element, render the dock and the answers:

```tsx
      <SendToSpaceDock
        request={sendReq}
        spaceId={space.id}
        lessonId={lesson.id}
        lessonTitle={lesson.title}
        lunaOpen={lunaOn && lunaOpen}
        onSent={(id) => {
          if (lunaOn && lunaOpen) setLunaSays({ kind: 'sent', questionId: id, page: sendReq?.page ?? pdfPage });
        }}
        onClose={() => setSendReq(null)}
      />
      {answersShown && (
        <AnsweredOnPage
          answers={answersHere}
          open={answersOpenOn === pdfPage}
          accent={accent ?? '#ffffff'}
          onOpen={() => {
            setAnswersOpenOn(pdfPage);
            for (const a of answersHere) if (a.mine) markAnnounced(a.questionId);
          }}
          onClose={() => setAnswersOpenOn(null)}
        />
      )}
```

- [ ] **Step 4: Run the reader's tests**

```bash
npx vitest run src/features/spaces/components/__tests__/readerAnswers.test.tsx src/features/spaces/components/__tests__/lessonFaces.test.tsx src/features/spaces/components/__tests__/readerCovered.test.tsx src/features/spaces/components/__tests__/a11y.test.tsx src/features/spaces/components/__tests__/readerGerman.test.tsx
npx tsc --noEmit -p tsconfig.app.json
npm run lint
```

Expected: PASS. If an existing reader test now finds two buttons where it expected one, scope its query to its own element. Do not hide the pill.

- [ ] **Step 5: See it in the browser (demo mode)**

Start `dev` with `preview_start` (`.claude/launch.json`). Open `/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=3`, at desktop width and at the mobile preset, with the theme dark:
- The pill is bottom right, clear of the pager arrows. Opened, the card is readable over the page.
- On page 2 there is nothing. Opening the checkpoint offer hides the pill.

Take a screenshot of each. Reset the viewport to desktop afterwards.

- [ ] **Step 6: Commit**

```bash
git status && git log -1
git add src/features/spaces/screens/LessonFacesScreen.tsx src/features/spaces/components/__tests__/readerAnswers.test.tsx
git commit -m "feat(reader): send from Ask, Luna and Still foggy; answers on their page; Luna says sent and answered"
```

---

### Task 14: The bell knows an answer

**Files:**
- Modify: `src/features/spaces/mocks/notifications.ts` (`NotificationKind`, `NotificationTarget`)
- Modify: `src/features/spaces/components/NotificationPanel.tsx` (`KIND_ICON`, `KIND_TONE`, `openTarget`)
- Modify: `src/i18n/locales/{en,de}/v4Spaces.json` (`notifications.items.questionAnswered`)
- Test: `src/features/spaces/__tests__/question-notification.test.tsx`

**Interfaces:**
- Consumes: Task 6's wire shape.
- Produces: `NotificationKind` includes `'question_answered'`. `NotificationTarget` includes `{ kind: 'page'; spaceId: string; lessonId: string; page: number; questionId: string }`.

- [ ] **Step 1: Add the strings**

`en` `notifications.items`: `"questionAnswered": { "title": "Your question has an answer", "message": "About page {{page}}." }`
`de` `notifications.items`: `"questionAnswered": { "title": "Deine Frage hat eine Antwort", "message": "Zu Seite {{page}}." }`

- [ ] **Step 2: Write the failing test**

Create `src/features/spaces/__tests__/question-notification.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import { NotificationPanel } from '../components/NotificationPanel';
import { setLiveWorld, type World } from '../data/world';

const S = '33333333-3333-3333-3333-333333333333';
const L = '55555555-5555-5555-5555-555555555555';
const Q = '66666666-6666-6666-6666-666666666666';

function Where() {
  const at = useLocation();
  return <p data-testid="where">{at.pathname + at.search}</p>;
}

afterEach(() => setLiveWorld(null));

describe('an answered question in the bell', () => {
  it('reads in the reader’s language and opens the page with the answer', () => {
    setLiveWorld({
      notifications: [{
        id: 'n1', title: 'Your question has an answer', message: 'About page 12.', type: 'question_answered', read: false,
        created_at: new Date().toISOString(),
        target: { kind: 'page', spaceId: S, lessonId: L, page: 12, questionId: Q },
        phrase: {
          title: { key: 'v4Spaces:notifications.items.questionAnswered.title' },
          message: { key: 'v4Spaces:notifications.items.questionAnswered.message', values: { page: 12 } },
        },
      }],
    } as unknown as World);
    render(
      <MemoryRouter initialEntries={['/v4/home']}>
        <Routes>
          <Route path="*" element={<><NotificationPanel /><Where /></>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    fireEvent.click(screen.getByText('Your question has an answer'));
    expect(screen.getByTestId('where').textContent).toBe(`/v4/space/${S}/lesson/${L}/faces?page=12&question=${Q}`);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/question-notification.test.tsx`
Expected: FAIL. TypeScript rejects the kind, or the click lands on `/v4/profile`.

- [ ] **Step 4: Add the kind and the target**

In `mocks/notifications.ts`: add `| 'question_answered'` to the v4 kinds of `NotificationKind`. Add `| { kind: 'page'; spaceId: string; lessonId: string; page: number; questionId: string }` to `NotificationTarget`, with the comment `/** An answer to your question: the page it was asked on, the answer beneath. */`.

In `NotificationPanel.tsx`: add `MessageCircle` to the lucide import. Add `question_answered: MessageCircle,` to `KIND_ICON` and `question_answered: 'bg-primary/15 text-primary',` to `KIND_TONE`. In `openTarget`, before `} else if (n.target.kind === 'person') {`, add:

```ts
    } else if (n.target.kind === 'page') {
      const { spaceId, lessonId, page, questionId } = n.target;
      navigate(`/v4/space/${spaceId}/lesson/${lessonId}/faces?page=${page}&question=${questionId}`);
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/features/spaces/__tests__/question-notification.test.tsx src/features/spaces/mocks/__tests__/notifications.test.ts src/features/spaces/__tests__/phrases.test.ts
npx tsc --noEmit -p tsconfig.app.json
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status && git log -1
git add src/features/spaces/mocks/notifications.ts src/features/spaces/components/NotificationPanel.tsx \
  src/i18n/locales/en/v4Spaces.json src/i18n/locales/de/v4Spaces.json src/features/spaces/__tests__/question-notification.test.tsx
git commit -m "feat(notifications): an answered question opens its page from the bell"
```

---

### Task 15: The owner's composer

**Files:**
- Create: `src/features/spaces/landing/AnswerComposer.tsx`
- Modify: `src/i18n/locales/{en,de}/v4Landing.json` (`questions.sending`, `questions.failed`; de `questions.them`)
- Test: `src/features/spaces/__tests__/answer-composer.test.tsx`

**Interfaces:**
- Produces: `AnswerComposer({ onAnswer, onClose })`, exactly as in "Contract with Plan 3".

- [ ] **Step 1: Add the strings**

`en` `questions`: `"sending": "Sending"`, `"failed": "That did not go through. Your answer is still here."`
`de` `questions`: `"sending": "Wird geschickt"`, `"failed": "Das hat nicht geklappt. Deine Antwort ist noch da."`, and change `"them"` to `"Nur der Person antworten"`.

- [ ] **Step 2: Write the failing test**

Create `src/features/spaces/__tests__/answer-composer.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@/i18n';
import { AnswerComposer } from '../landing/AnswerComposer';

const write = (text: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Write an answer' }), { target: { value: text } });

describe('the owner answers', () => {
  it('nothing to send until there are words; then to them, or for everyone', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<AnswerComposer onAnswer={onAnswer} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Answer them' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Answer for everyone' })).toBeDisabled();
    write('  Because BCNF splits it.  ');
    fireEvent.click(screen.getByRole('button', { name: 'Answer for everyone' }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith('Because BCNF splits it.', true));
  });

  it('waits while it sends, and keeps the words when it did not go', async () => {
    let fail: (e: Error) => void = () => {};
    const onAnswer = vi.fn(() => new Promise<void>((_, reject) => (fail = reject)));
    render(<AnswerComposer onAnswer={onAnswer} onClose={vi.fn()} />);
    write('Yes.');
    fireEvent.click(screen.getByRole('button', { name: 'Answer them' }));
    expect(screen.getByRole('button', { name: 'Sending' })).toBeDisabled();
    fail(new Error('409'));
    expect(await screen.findByRole('alert')).toHaveTextContent('That did not go through.');
    expect((screen.getByRole('textbox', { name: 'Write an answer' }) as HTMLTextAreaElement).value).toBe('Yes.');
  });

  it('Escape and Close leave without answering', () => {
    const onClose = vi.fn();
    render(<AnswerComposer onAnswer={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Write an answer' }), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run src/features/spaces/__tests__/answer-composer.test.tsx`
Expected: FAIL. It cannot resolve `../landing/AnswerComposer`.

- [ ] **Step 4: Write it**

Create `src/features/spaces/landing/AnswerComposer.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ghostPillSm, whitePillSm } from '../components/stage';

/**
 * Answering a question someone sent.
 *
 * Write, then choose: to the person who asked, or on that page for every
 * member. Nothing leaves until a send is pressed; if it does not go, the
 * words stay. The row around it decides the spacing.
 */
export function AnswerComposer({
  onAnswer,
  onClose,
}: {
  onAnswer: (text: string, forEveryone: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation('v4Landing');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const text = draft.trim();

  const send = (forEveryone: boolean) => {
    if (!text || sending !== null) return;
    setSending(forEveryone);
    setFailed(false);
    onAnswer(text, forEveryone)
      .catch(() => setFailed(true))
      .finally(() => setSending(null));
  };

  return (
    <div className="mt-4">
      <textarea
        autoFocus
        value={draft}
        maxLength={2000}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        placeholder={t('questions.placeholder')}
        aria-label={t('questions.placeholder')}
        rows={3}
        className="console-focusable w-full resize-none rounded-xl border border-white/[0.1] bg-black/40 px-4 py-3 text-[15px] leading-relaxed placeholder:text-quiet/70"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => send(true)} disabled={!text || sending !== null} className={whitePillSm}>
          {sending === true ? t('questions.sending') : t('questions.everyone')}
        </button>
        <button type="button" onClick={() => send(false)} disabled={!text || sending !== null} className={ghostPillSm}>
          {sending === false ? t('questions.sending') : t('questions.them')}
        </button>
        <span className="text-[12.5px] text-quiet">{t('questions.everyoneHint')}</span>
        <button type="button" onClick={onClose} className="console-focusable ml-auto rounded-full px-3 py-1.5 text-[13px] text-quiet hover:text-foreground">
          {t('questions.close')}
        </button>
      </div>
      {failed && (
        <p role="alert" className="mt-2 text-[13px] text-quiet">
          {t('questions.failed')}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/features/spaces/__tests__/answer-composer.test.tsx src/features/spaces/__tests__/landing.test.tsx
npm run lint
npx tsc --noEmit -p tsconfig.app.json
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status && git log -1
git add src/features/spaces/landing/AnswerComposer.tsx src/features/spaces/__tests__/answer-composer.test.tsx \
  src/i18n/locales/en/v4Landing.json src/i18n/locales/de/v4Landing.json
git commit -m "feat(landing): the owner's answer composer, to them or for everyone"
```

If Plan 3 has merged by now and its row still has the inline textarea, replace that textarea block in `QuestionsRow.tsx` with `<AnswerComposer onAnswer={(text, everyone) => onAnswer(q.id, text, everyone)} onClose={() => setOpenId(null)} />` (the `onAnswer` prop becomes `=> Promise<void>`). Make it its own commit. Otherwise leave it to Plan 3 (contract).

---

### Task 16: Prove it, open the PR, deploy in order

**Files:** none changed unless a gate fails.

- [ ] **Step 1: Every gate, from a clean tree**

```bash
git status && git log -1
export PATH="/Users/abdullahabobaker/.nvm/versions/node/v22.23.1/bin:$PATH"
npm run lint
npx vitest run
npx tsc --noEmit -p tsconfig.app.json
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest backend/tests -m "not db" -q -p no:cacheprovider
ruff check backend/ --select F821,F811,F841
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python -m pytest -m db backend/tests/db/test_space_questions_rls.py backend/tests/db/test_space_questions_db.py backend/tests/db/test_gdpr_coverage.py backend/tests/db/test_account_erasure_cascade.py backend/tests/db/test_v4_landing_db.py backend/tests/db/test_v4_world.py -q -p no:cacheprovider
python3 backend/scripts/check_migration_timestamps.py
```

Expected: all green. Compare the counts with Task 0.

- [ ] **Step 2: Review**

Use superpowers:requesting-code-review on the branch diff. Ask the reviewer to check in particular:
- that no response, log line or export carries `asker_id`, and that the name is `NULL` in SQL for anonymous questions;
- that `get_landing` unit tests never reach a real database;
- that nothing in `src/features/spaces` imports outside the allow-list.

- [ ] **Step 3: Open the PR**

Push `claude/landing-plan-4-questions` (re-run `git status && git log -1` first) and open a PR against `main`. Title: "How it's landing, plan 4: questions to the Space". The body must state:
- that it carries **one migration**, `20261105120000_space_questions.sql`, to be applied by hand before the backend deploy;
- the deploy order below;
- the frontend constraint (do not deploy the reader's Send line before Plan 3's door is live, or questions reach no one);
- a short summary.

End the body with the Claude Code line. CI runs on the PR.

- [ ] **Step 4: Deploy, only with Abi's go, in this order**

1. **Migration** (after the PR merges, from the file on `origin/main`, per `docs/runbooks/apply-a-migration-by-hand.md`):

```bash
set -a; source .env; set +a
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/20261105120000_space_questions.sql
psql "$DATABASE_URL" -At <<'SQL'
SELECT to_regclass('public.space_questions');                                                          -- space_questions
SELECT relrowsecurity FROM pg_class WHERE oid = 'public.space_questions'::regclass;                    -- t
SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'space_questions' ORDER BY 1;         -- 3 rows, SELECT, {authenticated}
SELECT has_table_privilege('anon', 'public.space_questions', 'SELECT');                               -- f
SELECT has_column_privilege('authenticated', 'public.space_questions', 'asker_id', 'SELECT');         -- f
SELECT has_column_privilege('authenticated', 'public.space_questions', 'answered_by', 'SELECT');      -- f
SELECT has_column_privilege('authenticated', 'public.space_questions', 'text', 'SELECT');             -- t
SELECT has_table_privilege('authenticated', 'public.space_questions', 'INSERT');                      -- f
SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'public.space_questions'::regclass AND contype = 'f' ORDER BY 1;  -- asker c, answered_by n, course c, lecture c
SQL
```

Write the probe output, with the date, into the PR.

2. **Backend** (`api` and `worker` images from `main`, per `docs/runbooks/deploy-main-to-prod.md`). Then smoke it:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://learnstation.app/api/v1/v4/reader/lectures/00000000-0000-0000-0000-000000000000/answers   # 401 or 403, not 404 or 500
```

3. **Frontend** (rebuild the image: `VITE_*` is baked at build). This comes only once Plan 3's door is in the same build or already live.

- [ ] **Step 5: Smoke on prod (with Abi, after step 4.3)**

Abi signs in as a member of a test Space with two readers. He should:
1. Send a question from Explain without his name.
2. As the owner, see it above the map as "Someone", and answer it for everyone.
3. As the member, see the bell entry, open it on the page with the card open, and with Luna open hear "They answered…".
4. As a second member, see "Answered here" on that page.
5. Withdraw it, and see the card go.

Do not enter any password on Abi's behalf: he signs in himself.

---

## Self-review notes (done while writing)

- **Spec coverage, section 6.** Learner line under Ask (Task 11), Luna (11) and "Still foggy" (11). The sheet: own words, ≤500, page attached, without-my-name, Send (10). Luna "Sent." with no model call (13). Owner: list above the map, hairline, no count (Plan 3, via the contract), and "Answer them" / "Answer for everyone" (5 and 15). The answered-here card for every member (7, 12, 13). Notification `question_answered` with a `page` target (5, 6, 14). Reader opens at the page with the answer (13). Luna delivers it (13). Verbatim only by consent, themes untouched (a global constraint; nothing writes `ai_tutor_query`). The table with all spec columns plus checks (1). RLS: asker, owner and members-when-space (1). The four endpoints with `can_view_course`, `5/min`, `assert_space_owner` (3, 4, 5, 7). The landing returns open questions first (8, as two lists). `_KINDS` (6). GDPR cascade and export (1, 2).
- **Placeholder scan.** Every code step has its code. The one conditional instruction (Task 1 Step 4's fallback if column grants cannot coexist with the asker policy) says exactly what to change.
- **Type consistency.** `PageAnswer` (Task 9) has the backend's `answers_for_reader` keys (Task 7). `LandingQuestion.asker` is `{name} | null`, the same in Task 8 and the contract. `SendRequest` (Task 10) is what Task 13 builds. `answerQuestion` returns `LandingAnswer`, as the contract says. `answer_link` and `page_target` (Task 5) are the only writer and reader of the link (Tasks 5, 6).
