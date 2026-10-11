> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Parent plan: docs/superpowers/plans/2026-10-10-ai-backend-deep-session.md (its Global Constraints bind every task here).

# Arc 5: Parse receipts (DB + API), TDD implementation plan

Worktree: `/Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd`. Every command below runs from that directory. `PY=/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python`.

## What the code already provides (checked)

- **Deck skeleton.** `backend/services/parser/deck_plan.py::build_deck_skeleton(pages) -> DeckSkeleton(boilerplate: frozenset[str], slides: tuple[SlidePlan(index, role: SlideRole(str Enum), text, section)], sections: tuple[Section(index, title, start, end)])`. The orchestrator builds it once at `unified_orchestrator.py:569-574`. If building fails it sets `skeleton = None` and the parse continues.
- **Quiz grounding.** `synthesis.ground_deck_quiz` (lines 180-241) only logs `deck_quiz_grounding {json}`. `generate_quiz_questions` (113-143) returns `List[Dict]`. Its callers are the orchestrator (line 861), 20+ tests in `test_synthesis.py`, the fake `quiz` in `test_unified_orchestrator.py::_patch_common` (line 377, fixed signature with no `**kw`), and `_areturn` in `db/test_unified_pipeline_e2e.py` (accepts `**k`).
- **Provider, model and cost per slide: not available anywhere.**
  - `generate_text_bulk` returns only text.
  - `public.llm_calls` (migration 20260719010000) has `user_id, course_id, feature, provider, model, tokens, est_cost_usd`, but no `run_id` or `lecture_id`. Parser calls pass no `user_id`.
  - `prompt_name` is only logged (orchestrator.py ~960 says so).
  - `prompt_log.py` is a Redis store with a TTL, behind a flag.
  - What the orchestrator does know per slide: the route (batch / per-slide fallback / vision / heuristic), the requested model (`ai_model`, or `settings.vision_model` for vision), prompt name and version via `prompts.get_prompt_version()`, `synthesis_failed`, and `needs_review` / `review_reason`. Arc 5 records exactly these. Serving provider and cost are a follow-up (it needs `run_id` threaded into `llm_calls`), and the plan says so explicitly rather than storing fake values.
- **parse_runs** (20260503000008): `run_id UUID PK`, `pdf_hash TEXT NOT NULL`, `lecture_id UUID → lectures ON DELETE CASCADE`, `pipeline_version TEXT NOT NULL`, `status TEXT NOT NULL`, plus `user_id`, `batch_id`, `course_id`, `filename` and `parsing_mode` added later (all nullable).
- **lectures**: `id`, `title NOT NULL`, `professor_id` (nullable since 20260710040000), `student_owner_id`, `visibility ('course'|'private_student')`, `course_id`. The CHECK constraint `lectures_owner_consistency` applies. Owner SELECT policies are `professor_id = auth.uid()` (20260713000000) and `student_owner_id = auth.uid()` (20260710040000).
- **The anon trap.** `backend/tests/db/sql/00_bootstrap.sql:93-96` does `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated`. Every new table therefore gets direct anon grants, so `REVOKE ... FROM PUBLIC` alone is not enough. The migration revokes from `PUBLIC, anon, authenticated` and then grants only `SELECT` to `authenticated`. `service_role` is `BYPASSRLS` in the bootstrap, the same as Supabase.
- **Migration rules.** `backend/scripts/check_migration_timestamps.py` checks for timestamp collisions, and `lint_new_definer_functions.py` checks that any SECURITY DEFINER function has a REVOKE/GRANT (this migration adds none). `test_rls_policies.py` requires RLS on every public table. The latest local migration is 20260818000000; main's latest is 20261011000100, so `20261012000000` sorts after both.
- **Repo layer.** `repos.py` is asyncpg (`_pool()`), not Supabase. Its unit tests (`test_parser_repos.py`) use a fake asyncpg pool. The unit-test outbound guard (`conftest.py:129-190`) raises on any real asyncpg call, so `_patch_common` must stub the new repo function. Persistence unit tests therefore use a fake pool, not `fake_supabase`. `fake_supabase` is used for the endpoint, as specified.
- **Endpoint conventions** (`backend/api/v1/worksheets.py`): `Depends(verify_token)`, `_user_id`, `@limiter.limit` with a `request: Request` parameter, the `supabase_admin` service client, `run_in_threadpool`, and `{"success": True, "data": ...}`.
  - Non-owner reads return **404 "Lecture not found."** so the endpoint does not reveal which lecture ids exist. I follow that.
  - `conftest.patch_supabase` patches only `backend.core.database.supabase_admin` plus a list of modules that bind it by name. The new module reads `database.supabase_admin` at call time, so `conftest.py` does not need editing.
  - `verify_token` returns 401 when there are no credentials (`HTTPBearer(auto_error=False)`).

## Design decisions

1. **Quiz summary transport: an optional `stats: Dict | None = None` out-parameter** on `generate_quiz_questions` and `ground_deck_quiz`. When it is given, the summary is merged into it right after the log line. This is the least invasive option:
   - The `List[Dict]` return type stays, so all existing callers and tests run unchanged.
   - Returning a tuple would break every caller.
   - A sibling function would duplicate slide selection and prompt building, or need a wrapper refactor.
   - A contextvar would be hidden coupling.
   - The log line stays, so log-based dashboards keep working.
2. **Enrolled students get no access**, and there is no skeleton view. A receipt is a QA and diagnostics artifact (prompt versions, models, drop reasons). Students already see the slides through existing tables, so a view would add attack surface for no value. Owners can read: the course professor (`professor_id`) and, for private uploads, the student owner (`student_owner_id`), matching the lecture owner SELECT policies. Admin access is left out; service role covers admin tooling.
3. **Write path.** `repos.save_parse_receipt` does an asyncpg upsert keyed on `run_id`. A forced re-parse reuses the same `run_id`, so the newer receipt replaces the old one and `created_at` is reset to `now()`. The orchestrator calls it through `_write_parse_receipt`, which catches and logs any `Exception`. The call sits right after `persist.finalize_lecture` and before `set_status(COMPLETED)`.
4. **Receipt contents.**
   - The skeleton receipt stores roles, sections, boilerplate and per-slide `chars`, but **not slide text** (the text already lives in `slides` and would bloat the row).
   - `slide_provenance` is a JSON array; nothing is persisted per slide for provider or cost.
   - `quiz_grounding` is NULL for on-demand parses or when no grounding ran.

## Task 1: Return the deck-quiz grounding summary through a `stats` out-parameter

**Files**
- `backend/services/parser/synthesis.py`
- `backend/tests/unit/test_synthesis.py` (append)

**Interfaces**
- Produces:
  - `async def generate_quiz_questions(slides: List[str], lecture_title: str, ai_model: str, source_language: str = "en", skeleton: DeckSkeleton | None = None, stats: Dict[str, Any] | None = None) -> List[Dict[str, Any]]`
  - `async def ground_deck_quiz(questions: List[Any], skeleton: DeckSkeleton, lecture_title: str, ai_model: str, source_language: str = "en", stats: Dict[str, Any] | None = None) -> List[Dict[str, Any]]`
  - The summary shape is `{"proposed": int, "kept": int, "repaired": int, "dropped": int, "drop_reasons": {str: int}}`.
- Consumes: nothing new.

**Step 1: failing tests.** Append to the end of `backend/tests/unit/test_synthesis.py`:
```python


# ── Arc 5: grounding summary returned, not only logged ───────────────────────

async def test_grounding_summary_is_returned_through_stats(llm):
    fixed = _mcq("Which algorithm requires non-negative edge weights?",
                 ["Dijkstra", "Kruskal", "Prim", "Floyd"], "Dijkstra", 3)
    llm["reply"] = _router(json.dumps([GOOD, OTHER_SLIDE, BAD_NUMBER, NO_SOURCE, OUT_OF_RANGE]),
                           {3: json.dumps(fixed)})
    stats: dict = {}
    out = await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq", stats=stats)
    assert isinstance(out, list) and len(out) == 2
    assert stats == {
        "proposed": 5, "kept": 2, "repaired": 1, "dropped": 3,
        "drop_reasons": {"no_source": 1, "source_out_of_range": 1, "repair_failed": 1},
    }


async def test_stats_equals_the_logged_summary_line(llm, caplog):
    import logging
    llm["reply"] = _router(json.dumps([OTHER_SLIDE] * 30))
    stats: dict = {}
    with caplog.at_level(logging.INFO, logger=synthesis.logger.name):
        await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq", stats=stats)
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("deck_quiz_grounding "))
    assert json.loads(line.split(" ", 1)[1]) == stats
    assert stats["drop_reasons"]["over_cap"] == 18


async def test_stats_untouched_when_no_quiz_is_attempted(llm):
    stats: dict = {}
    out = await synthesis.generate_quiz_questions(["short", "also short"], "T", "cerebras", stats=stats)
    assert out == [] and stats == {}
```

**Step 2: run and confirm red.**
`$PY -m pytest backend/tests/unit/test_synthesis.py -m "not db" -q -k "stats"`
Expected: 3 failures, `TypeError: generate_quiz_questions() got an unexpected keyword argument 'stats'`.

**Step 3: minimal implementation** in `synthesis.py`.

Replace the `generate_quiz_questions` signature and docstring tail, and its final `return`:
```python
async def generate_quiz_questions(
    slides: List[str],
    lecture_title: str,
    ai_model: str,
    source_language: str = "en",
    skeleton: DeckSkeleton | None = None,
    stats: Dict[str, Any] | None = None,
) -> List[Dict[str, Any]]:
    """Generate 5–8 deck-level MCQs from content-rich slides spread across
    every section of the deck, labelled with their real slide numbers.

    Every question must cite the slide its answer is stated on
    (`source_slide`); `ground_deck_quiz` keeps only questions that slide
    supports, after at most one repair each.

    ``stats`` (Arc 5 parse receipts), when given, receives the grounding
    summary; it stays empty when no quiz was attempted."""
```
and change the last line of that function from
`    return await ground_deck_quiz(res, skeleton, lecture_title, ai_model, source_language)`
to
`    return await ground_deck_quiz(res, skeleton, lecture_title, ai_model, source_language, stats=stats)`

Change `ground_deck_quiz`'s signature to add `stats: Dict[str, Any] | None = None,` after `source_language: str = "en",`. Change the docstring sentence to: ``Logs one ``deck_quiz_grounding {json}`` line (proposed/kept/repaired/dropped + drop reasons) and, when ``stats`` is given, merges the same summary into it for the parse receipt.``

Replace the logging tail (current lines 234-241):
```python
    summary = {
        "proposed": proposed,
        "kept": len(kept),
        "repaired": sum(1 for _, was_repaired, _ in results if was_repaired),
        "dropped": proposed - len(kept),
        "drop_reasons": reasons,
    }
    logger.info("deck_quiz_grounding %s", json.dumps(summary, sort_keys=True))
    if stats is not None:
        stats.update(summary)
    return kept
```

**Step 4: green.** `$PY -m pytest backend/tests/unit/test_synthesis.py -m "not db" -q`. The whole file passes, including the existing `test_one_structured_summary_line_per_generation`.

**Step 5: mutation check.**
- Delete `        stats.update(summary)` (and its `if`). Both stats tests should fail. Restore it.
- Change `source_language, stats=stats)` back to `source_language)`. The tests should fail again. Restore it.

**Step 6: commit.**
```
feat(parser): return the deck-quiz grounding summary via a stats out-param

generate_quiz_questions/ground_deck_quiz accept an optional `stats` dict that
receives the same summary they log; the list return type is unchanged so
every existing caller keeps working. Arc 5 parse receipts persist it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## Task 2: Migration (`parse_receipts` table, RLS, anon lockdown) and DB tests

**Files**
- `supabase/migrations/20261012000000_parse_receipts.sql` (new; file only, never `supabase db push`)
- `backend/tests/db/test_parse_receipts_rls.py` (new)

**Interfaces**
- Produces the table `public.parse_receipts(run_id uuid PK → parse_runs(run_id) ON DELETE CASCADE, lecture_id uuid NOT NULL → lectures(id) ON DELETE CASCADE, deck_skeleton jsonb NULL, slide_provenance jsonb NOT NULL DEFAULT '[]', quiz_grounding jsonb NULL, created_at timestamptz NOT NULL DEFAULT now())`.
- Grants: SELECT for `authenticated`, gated by RLS to lecture owners. Nothing for anon or PUBLIC. ALL for `service_role`.

**Step 1: failing test.** `backend/tests/db/test_parse_receipts_rls.py`:
```python
"""RLS boundary for public.parse_receipts (Arc 5).

A parse receipt is a professor-facing QA artifact (deck skeleton, per-slide
route/prompt provenance, deck-quiz grounding summary). Only the lecture's
owner -- the course professor, or the student owner of a private upload --
may read it. Enrolled students get nothing (they already see the slides
themselves), anon gets a hard permission error (Supabase's default
privileges grant anon SELECT on every new public table directly, so the
migration must REVOKE from anon explicitly), and writes are service-role
only (the parse worker).
"""
from __future__ import annotations

import json
import uuid

import psycopg
import pytest

pytestmark = pytest.mark.db


def _as_user(cur, uid: uuid.UUID) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",))


def _reset(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def _make_run(cur, lecture_id: uuid.UUID) -> uuid.UUID:
    run_id = uuid.uuid4()
    cur.execute(
        "INSERT INTO public.parse_runs (run_id, pdf_hash, lecture_id, pipeline_version, status) "
        "VALUES (%s, %s, %s, '5', 'completed')",
        (str(run_id), f"hash-{run_id.hex}", str(lecture_id)),
    )
    return run_id


def _receipt_values(run_id: uuid.UUID, lecture_id: uuid.UUID) -> tuple:
    return (
        str(run_id),
        str(lecture_id),
        json.dumps({"boilerplate": [], "sections": [],
                    "slides": [{"index": 0, "role": "title", "section": 0, "chars": 5}]}),
        json.dumps([{"index": 0, "route": "batch"}]),
        json.dumps({"proposed": 1, "kept": 1, "repaired": 0, "dropped": 0, "drop_reasons": {}}),
    )


_INSERT = (
    "INSERT INTO public.parse_receipts "
    "(run_id, lecture_id, deck_skeleton, slide_provenance, quiz_grounding) "
    "VALUES (%s, %s, %s::jsonb, %s::jsonb, %s::jsonb)"
)


def _make_receipt(db_conn, lecture_id: uuid.UUID) -> uuid.UUID:
    with db_conn.cursor() as cur:
        run_id = _make_run(cur, lecture_id)
        cur.execute(_INSERT, _receipt_values(run_id, lecture_id))
    return run_id


def _visible_runs(cur) -> set[str]:
    cur.execute("SELECT run_id FROM public.parse_receipts")
    return {str(r[0]) for r in cur.fetchall()}


def _make_private_lecture(db_conn, student_id: uuid.UUID) -> uuid.UUID:
    lid = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.lectures (id, title, professor_id, total_slides, visibility, student_owner_id) "
            "VALUES (%s, 'Private', NULL, 1, 'private_student', %s)",
            (str(lid), str(student_id)),
        )
    return lid


def _enroll_via_assignment(db_conn, professor_id, student_id, lecture_id) -> None:
    aid = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.assignments (id, professor_id, title, due_at) "
            "VALUES (%s, %s, 'A', now() + interval '7 days')",
            (str(aid), str(professor_id)),
        )
        cur.execute(
            "INSERT INTO public.assignment_lectures (assignment_id, lecture_id) VALUES (%s, %s)",
            (str(aid), str(lecture_id)),
        )
        cur.execute(
            "INSERT INTO public.assignment_enrollments (assignment_id, user_id) VALUES (%s, %s)",
            (str(aid), str(student_id)),
        )


def test_table_has_rls_enabled(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.parse_receipts'::regclass")
        assert cur.fetchone()[0] is True


def test_owner_professor_reads_own_receipt(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    run_id = _make_receipt(db_conn, make_lecture(prof))
    with db_conn.cursor() as cur:
        _as_user(cur, prof)
        try:
            visible = _visible_runs(cur)
        finally:
            _reset(cur)
    assert str(run_id) in visible


def test_other_professor_cannot_read_receipt(db_conn, make_user, make_lecture):
    owner = make_user(role="professor")
    other = make_user(role="professor")
    run_id = _make_receipt(db_conn, make_lecture(owner))
    with db_conn.cursor() as cur:
        _as_user(cur, other)
        try:
            visible = _visible_runs(cur)
        finally:
            _reset(cur)
    assert str(run_id) not in visible


def test_enrolled_student_sees_lecture_but_not_its_receipt(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    student = make_user(role="student")
    lecture = make_lecture(prof)
    _enroll_via_assignment(db_conn, prof, student, lecture)
    run_id = _make_receipt(db_conn, lecture)
    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            cur.execute("SELECT id FROM public.lectures WHERE id = %s", (str(lecture),))
            assert cur.fetchone() is not None, "fixture broken: enrolled student must see the lecture"
            visible = _visible_runs(cur)
        finally:
            _reset(cur)
    assert str(run_id) not in visible


def test_private_upload_owner_reads_own_receipt(db_conn, make_user):
    student = make_user(role="student")
    run_id = _make_receipt(db_conn, _make_private_lecture(db_conn, student))
    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            visible = _visible_runs(cur)
        finally:
            _reset(cur)
    assert str(run_id) in visible


def test_anon_cannot_select_receipts(db_conn, make_user, make_lecture):
    _make_receipt(db_conn, make_lecture(make_user(role="professor")))
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT run_id FROM public.parse_receipts")
        finally:
            cur.execute("RESET ROLE")


def test_owner_cannot_write_receipts_directly(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    lecture = make_lecture(prof)
    with db_conn.cursor() as cur:
        run_id = _make_run(cur, lecture)
        _as_user(cur, prof)
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(_INSERT, _receipt_values(run_id, lecture))
        finally:
            _reset(cur)


def test_service_role_writes_receipts(db_conn, make_user, make_lecture):
    lecture = make_lecture(make_user(role="professor"))
    with db_conn.cursor() as cur:
        run_id = _make_run(cur, lecture)
        cur.execute("SET ROLE service_role")
        try:
            cur.execute(_INSERT, _receipt_values(run_id, lecture))
            cur.execute("SELECT slide_provenance FROM public.parse_receipts WHERE run_id = %s", (str(run_id),))
            assert cur.fetchone()[0] == [{"index": 0, "route": "batch"}]
        finally:
            cur.execute("RESET ROLE")


def test_slide_provenance_defaults_to_empty_array(db_conn, make_user, make_lecture):
    lecture = make_lecture(make_user(role="professor"))
    with db_conn.cursor() as cur:
        run_id = _make_run(cur, lecture)
        cur.execute(
            "INSERT INTO public.parse_receipts (run_id, lecture_id) VALUES (%s, %s) "
            "RETURNING slide_provenance, deck_skeleton, quiz_grounding",
            (str(run_id), str(lecture)),
        )
        assert cur.fetchone() == ([], None, None)


def test_deleting_lecture_cascades_its_receipt(db_conn, make_user, make_lecture):
    lecture = make_lecture(make_user(role="professor"))
    run_id = _make_receipt(db_conn, lecture)
    with db_conn.cursor() as cur:
        cur.execute("DELETE FROM public.lectures WHERE id = %s", (str(lecture),))
        cur.execute("SELECT count(*) FROM public.parse_receipts WHERE run_id = %s", (str(run_id),))
        assert cur.fetchone()[0] == 0
```

**Step 2: run and confirm red.**
`$PY -m pytest backend/tests/db/test_parse_receipts_rls.py -m db -q`
Expected: every test errors with `psycopg.errors.UndefinedTable: relation "public.parse_receipts" does not exist`. The first test's `::regclass` gives the same error.

**Step 3: minimal implementation.** `supabase/migrations/20261012000000_parse_receipts.sql`:
```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Arc 5 — parse receipts.
--
-- Every unified (v5) PDF parse leaves one receipt a professor can inspect:
--   deck_skeleton    — deck_plan.skeleton_receipt(): boilerplate lines, a role
--                      and section per slide, and the section list (no slide
--                      text; that already lives in public.slides).
--   slide_provenance — one entry per slide: synthesis route (batch /
--                      per_slide / vision / heuristic), prompt name+version,
--                      requested model, synthesis_failed, needs_review.
--                      Serving provider and cost are NOT attributable per
--                      slide yet (llm_calls has no run_id); not stored.
--   quiz_grounding   — synthesis.ground_deck_quiz's summary
--                      (proposed/kept/repaired/dropped/drop_reasons).
--
-- Keyed by run_id: a forced re-parse reuses its parse_runs row, so the
-- worker upserts and the newest receipt replaces the old one.
--
-- Access: only the lecture's owner (course professor, or the student owner
-- of a private upload) may read. Enrolled students get nothing — this is a
-- QA artifact, not study content. Writes are service-role only (the parse
-- worker; asyncpg/service role bypass RLS).
--
-- Supabase's default privileges grant SELECT/INSERT/UPDATE/DELETE on every
-- new public table DIRECTLY to anon and authenticated, so REVOKE ... FROM
-- PUBLIC alone would leave both grants in place (the trap behind
-- 20261011000000_revoke_anon_security_definer_execute). Revoke from the
-- named roles explicitly, then grant back only what is needed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.parse_receipts (
    run_id           UUID        PRIMARY KEY
                                 REFERENCES public.parse_runs(run_id) ON DELETE CASCADE,
    lecture_id       UUID        NOT NULL
                                 REFERENCES public.lectures(id) ON DELETE CASCADE,
    deck_skeleton    JSONB,
    slide_provenance JSONB       NOT NULL DEFAULT '[]'::jsonb,
    quiz_grounding   JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parse_receipts_lecture_created
    ON public.parse_receipts (lecture_id, created_at DESC);

ALTER TABLE public.parse_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.parse_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.parse_receipts TO authenticated;
GRANT ALL ON TABLE public.parse_receipts TO service_role;

DROP POLICY IF EXISTS "Lecture owners read parse receipts" ON public.parse_receipts;
CREATE POLICY "Lecture owners read parse receipts"
    ON public.parse_receipts FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.lectures l
            WHERE l.id = parse_receipts.lecture_id
              AND (l.professor_id = auth.uid() OR l.student_owner_id = auth.uid())
        )
    );
```

**Step 4: green.**
- `$PY -m pytest backend/tests/db/test_parse_receipts_rls.py backend/tests/db/test_rls_policies.py -m db -q`
- `$PY -m pytest backend/tests/unit/test_check_migration_timestamps.py -m "not db" -q`
- `$PY backend/scripts/check_migration_timestamps.py`
- `$PY backend/scripts/lint_new_definer_functions.py supabase/migrations/20261012000000_parse_receipts.sql`

All should pass, and both scripts should print OK.

**Step 5: mutation check.**
- Change `REVOKE ALL ON TABLE public.parse_receipts FROM PUBLIC, anon, authenticated;` to `REVOKE ALL ON TABLE public.parse_receipts FROM PUBLIC;`. `test_anon_cannot_select_receipts` should fail: the default grant lets anon SELECT and RLS just returns 0 rows with no error. This is the trap, demonstrated. Restore it.
- Change `(l.professor_id = auth.uid() OR l.student_owner_id = auth.uid())` to `true`. The other-professor and enrolled-student tests should fail. Restore it.

**Step 6: commit.**
```
feat(db): parse_receipts table, owner-only RLS, explicit anon revoke

Migration file only — not pushed. Owner professor / private-upload owner
read; other professors, enrolled students and anon cannot; writes are
service-role only. REVOKE names anon/authenticated explicitly because
Supabase default privileges grant them directly.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## Task 3: Repo writer and skeleton serializer

**Files**
- `backend/services/parser/deck_plan.py`
- `backend/services/parser/repos.py`
- `backend/tests/unit/test_deck_plan_receipt.py` (new)
- `backend/tests/unit/test_parse_receipt_repo.py` (new)

**Interfaces**
- Produces:
  - `def skeleton_receipt(skeleton: DeckSkeleton) -> dict`, returning `{"boilerplate": list[str] (sorted), "slides": [{"index", "role", "section", "chars"}], "sections": [{"index", "title", "start", "end"}]}`.
  - `async def save_parse_receipt(run_id: UUID, lecture_id: UUID, *, deck_skeleton: Optional[dict], slide_provenance: list[dict], quiz_grounding: Optional[dict]) -> None`. It raises on DB error; non-fatality is the caller's job.
- Consumes: `build_deck_skeleton`, `repos._pool()`.

**Step 1: failing tests.**

`backend/tests/unit/test_deck_plan_receipt.py`:
```python
"""deck_plan.skeleton_receipt — the JSON-safe deck skeleton stored in a parse receipt (Arc 5)."""
import json

from backend.services.parser.deck_plan import build_deck_skeleton, skeleton_receipt

LONG = "Relational algebra defines selection, projection and join over sets of tuples in detail."


def test_receipt_lists_roles_sections_and_lengths_but_not_text():
    pages = ["Datenbanksysteme\nWS 2026", "2. Relationale Algebra", "Selection\n" + LONG, "3. SQL", "Joins\n" + LONG]
    skeleton = build_deck_skeleton(pages)
    r = skeleton_receipt(skeleton)
    assert [s["role"] for s in r["slides"]] == ["title", "section", "content", "section", "content"]
    assert [s["section"] for s in r["slides"]] == [0, 1, 1, 2, 2]
    assert [s["index"] for s in r["slides"]] == [0, 1, 2, 3, 4]
    assert [s["chars"] for s in r["slides"]] == [len(p.text) for p in skeleton.slides]
    assert all(set(s) == {"index", "role", "section", "chars"} for s in r["slides"])
    assert r["sections"] == [
        {"index": 0, "title": "Datenbanksysteme", "start": 0, "end": 0},
        {"index": 1, "title": "2. Relationale Algebra", "start": 1, "end": 2},
        {"index": 2, "title": "3. SQL", "start": 3, "end": 4},
    ]


def test_receipt_boilerplate_is_a_sorted_json_safe_list():
    pages = [f"{w} content here\nFooter Seite {n}" for n, w in enumerate(["Alpha", "Beta", "Gamma", "Delta"], 1)]
    r = skeleton_receipt(build_deck_skeleton(pages))
    assert r["boilerplate"] == ["footer seite #"]
    assert json.loads(json.dumps(r)) == r


def test_receipt_of_an_empty_deck():
    assert skeleton_receipt(build_deck_skeleton([])) == {"boilerplate": [], "slides": [], "sections": []}
```

`backend/tests/unit/test_parse_receipt_repo.py`:
```python
"""Unit tests for repos.save_parse_receipt (Arc 5). The asyncpg pool is faked
(same approach as test_parser_repos.py) so no Postgres is needed; the real
schema round-trip is covered by db/test_unified_pipeline_e2e.py."""
from __future__ import annotations

import json
from uuid import uuid4

import pytest

import backend.core.database as _db
from backend.services.parser import repos


class _FakeConn:
    def __init__(self):
        self.executed: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def execute(self, query, *args):
        self.executed.append((query, args))
        return "INSERT 0 1"


class _FakePool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        return self._conn


@pytest.fixture
def conn(monkeypatch):
    c = _FakeConn()
    monkeypatch.setattr(_db, "db_pool", _FakePool(c), raising=False)
    return c


async def test_save_parse_receipt_upserts_by_run_id_with_jsonb_payloads(conn):
    run_id, lecture_id = uuid4(), uuid4()
    skeleton = {"boilerplate": ["footer seite #"],
                "slides": [{"index": 0, "role": "title", "section": 0, "chars": 9}],
                "sections": [{"index": 0, "title": "Graphs", "start": 0, "end": 0}]}
    provenance = [{"index": 0, "route": "batch", "prompt": "BATCH_SLIDE_PROMPT"}]
    grounding = {"proposed": 3, "kept": 2, "repaired": 1, "dropped": 1, "drop_reasons": {"no_source": 1}}

    await repos.save_parse_receipt(
        run_id, lecture_id,
        deck_skeleton=skeleton, slide_provenance=provenance, quiz_grounding=grounding,
    )

    ((query, args),) = conn.executed
    assert "INSERT INTO parse_receipts" in query
    assert "ON CONFLICT (run_id) DO UPDATE" in query
    assert args[0] == run_id and args[1] == lecture_id
    assert json.loads(args[2]) == skeleton
    assert json.loads(args[3]) == provenance
    assert json.loads(args[4]) == grounding


async def test_save_parse_receipt_stores_sql_null_for_missing_parts(conn):
    await repos.save_parse_receipt(
        uuid4(), uuid4(), deck_skeleton=None, slide_provenance=[], quiz_grounding=None,
    )
    ((_query, args),) = conn.executed
    assert args[2] is None and args[4] is None
    assert json.loads(args[3]) == []
```

**Step 2: run and confirm red.**
`$PY -m pytest backend/tests/unit/test_deck_plan_receipt.py backend/tests/unit/test_parse_receipt_repo.py -m "not db" -q`
Expected:
- A collection error: `ImportError: cannot import name 'skeleton_receipt' from 'backend.services.parser.deck_plan'`.
- Two failures: `AttributeError: module 'backend.services.parser.repos' has no attribute 'save_parse_receipt'`.

**Step 3: minimal implementation.**

`deck_plan.py`: insert after `build_deck_skeleton` (before `QUIZ_ROLES = ...`):
```python
def skeleton_receipt(skeleton: DeckSkeleton) -> dict:
    """JSON-safe view of a skeleton for the Arc 5 parse receipt. Slide text is
    left out on purpose (it already lives in public.slides); ``chars`` is the
    boilerplate-stripped length a professor can use to spot empty slides."""
    return {
        "boilerplate": sorted(skeleton.boilerplate),
        "slides": [
            {"index": s.index, "role": s.role.value, "section": s.section, "chars": len(s.text)}
            for s in skeleton.slides
        ],
        "sections": [
            {"index": s.index, "title": s.title, "start": s.start, "end": s.end}
            for s in skeleton.sections
        ],
    }
```

`repos.py`: append before `def _run_from_row(row) -> ParseRun:` (`json`, `Optional` and `UUID` are already imported):
```python
# ── Parse receipts (Arc 5) ───────────────────────────────────────────────────


async def save_parse_receipt(
    run_id: UUID,
    lecture_id: UUID,
    *,
    deck_skeleton: Optional[dict],
    slide_provenance: list[dict],
    quiz_grounding: Optional[dict],
) -> None:
    """Upsert one run's receipt. A forced re-parse reuses its parse_runs row
    (get_or_create_run upserts), so the newer receipt replaces the older one.
    Missing parts are stored as SQL NULL, not JSON null."""
    pool = await _pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO parse_receipts
                (run_id, lecture_id, deck_skeleton, slide_provenance, quiz_grounding)
            VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
            ON CONFLICT (run_id) DO UPDATE
                SET lecture_id = EXCLUDED.lecture_id,
                    deck_skeleton = EXCLUDED.deck_skeleton,
                    slide_provenance = EXCLUDED.slide_provenance,
                    quiz_grounding = EXCLUDED.quiz_grounding,
                    created_at = now()
            """,
            run_id,
            lecture_id,
            None if deck_skeleton is None else json.dumps(deck_skeleton),
            json.dumps(slide_provenance),
            None if quiz_grounding is None else json.dumps(quiz_grounding),
        )
```

**Step 4: green.** Rerun the Step 2 command, plus `backend/tests/unit/test_parser_repos.py backend/tests/unit/test_deck_plan_skeleton.py`.

**Step 5: mutation check.**
- Change `"boilerplate": sorted(skeleton.boilerplate),` to `"boilerplate": skeleton.boilerplate,`. The boilerplate test should fail (a frozenset is not equal to a list and does not JSON-dump). Restore it.
- Change `None if deck_skeleton is None else json.dumps(deck_skeleton),` to `json.dumps(deck_skeleton),`. The SQL-NULL test should fail (`"null"` is not `None`). Restore it.

**Step 6: commit.**
```
feat(parser): skeleton_receipt serializer and repos.save_parse_receipt upsert

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## Task 4: Orchestrator writes the receipt in finalize (never fatal)

**Files**
- `backend/services/parser/unified_orchestrator.py`
- `backend/tests/unit/test_unified_orchestrator.py` (edit `_patch_common`, append tests)
- `backend/tests/db/test_unified_pipeline_e2e.py` (append one test)

**Interfaces**
- Consumes:
  - `repos.save_parse_receipt(...)` and `deck_plan.skeleton_receipt(...)` (Task 3)
  - `generate_quiz_questions(..., stats=)` (Task 1)
  - `backend.services.ai.prompts.get_prompt_version(prompt_name: str) -> str`
- Produces:
  - `def _slide_route(*, ai_mode: bool, is_vision: bool, res: Any) -> str`
  - `def _provenance_entry(index: int, route: str, *, ai_model: str, synthesis_failed: bool, needs_review: bool, review_reason: Optional[str]) -> Dict[str, Any]`
  - `async def _write_parse_receipt(run_id: UUID, lecture_id: UUID, *, skeleton: Any, slide_provenance: List[Dict[str, Any]], quiz_grounding: Optional[Dict[str, Any]]) -> None`
  - `_synthesize_text_slide_batch` results now carry `"route": "batch"`.

**Step 1: failing tests.**

In `backend/tests/unit/test_unified_orchestrator.py`, add a module constant under `OWNER = ...`:
```python
QUIZ_STATS = {"proposed": 2, "kept": 1, "repaired": 0, "dropped": 1, "drop_reasons": {"no_source": 1}}
LONG_A = "Breadth-first search visits every vertex level by level from the source."
LONG_B = "Depth-first search follows one branch to its end before it backtracks."
```

In `_patch_common`, replace the `quiz` fake with:
```python
    async def quiz(slides, title, model, source_language="en", skeleton=None, stats=None):
        if stats is not None:
            stats.update(QUIZ_STATS)
        return [{"question": "dq", "options": ["a", "b", "c", "d"], "correctAnswer": "a", "slideId": 1}]
```

Still in `_patch_common`, add next to `finalize_lecture`:
```python
    async def save_parse_receipt(run_id, lecture_id, *, deck_skeleton, slide_provenance, quiz_grounding):
        rec.setdefault("receipts", []).append({
            "run_id": run_id, "lecture_id": lecture_id, "deck_skeleton": deck_skeleton,
            "slide_provenance": slide_provenance, "quiz_grounding": quiz_grounding,
        })
```
and register it next to the other repos patches: `monkeypatch.setattr(uo.repos, "save_parse_receipt", save_parse_receipt)`. The stub is required anyway: without it the outbound guard raises a BaseException on the real asyncpg pool.

Append the tests:
```python
# ── Arc 5: parse receipt ─────────────────────────────────────────────────────

async def test_parse_pdf_unified_writes_a_parse_receipt(monkeypatch):
    rec, run = _patch_common(monkeypatch)
    await _run("h", OWNER, filename="My Deck.pdf")
    (receipt,) = rec["receipts"]
    assert receipt["run_id"] == run.run_id
    assert receipt["lecture_id"] == rec["lectures"][0][2]
    assert [s["index"] for s in receipt["deck_skeleton"]["slides"]] == [0, 1, 2]
    assert receipt["deck_skeleton"]["slides"][0]["role"] == "title"
    assert [p["index"] for p in receipt["slide_provenance"]] == [0, 1, 2]
    assert receipt["quiz_grounding"] == QUIZ_STATS


async def test_receipt_provenance_records_batch_and_vision_routes(monkeypatch):
    from backend.services.ai.prompts import PROMPT_VERSIONS
    rec, run = _patch_common(monkeypatch, pages=[LONG_A, LONG_B, ""])
    await _run("h", OWNER, filename="Deck.pdf", ai_model="groq")
    prov = rec["receipts"][0]["slide_provenance"]
    assert prov[0] == {
        "index": 0, "route": "batch", "prompt": "BATCH_SLIDE_PROMPT",
        "prompt_version": PROMPT_VERSIONS["BATCH_SLIDE_PROMPT"], "requested_model": "groq",
        "synthesis_failed": False, "needs_review": False, "review_reason": None,
    }
    assert prov[1]["route"] == "batch"
    assert prov[2]["route"] == "vision"
    assert prov[2]["prompt"] == "SLIDE_VISION_PROMPT"
    assert prov[2]["requested_model"] == uo.settings.vision_model


async def test_receipt_marks_per_slide_fallback_when_batch_fails(monkeypatch):
    import backend.services.ai.orchestrator as ai_orchestrator
    rec, run = _patch_common(monkeypatch, pages=[LONG_A, LONG_B])

    async def failing_batch(*_a, **_k):
        raise RuntimeError("batch provider down")

    monkeypatch.setattr(ai_orchestrator, "batch_analyze_text_slides", failing_batch)
    await _run("h", OWNER, filename="Deck.pdf")
    prov = rec["receipts"][0]["slide_provenance"]
    assert [p["route"] for p in prov] == ["per_slide", "per_slide"]
    assert prov[0]["prompt"] == "SLIDE_ANALYSIS_PROMPT"


async def test_receipt_flags_a_failed_slide(monkeypatch):
    rec, run = _patch_common(monkeypatch)

    async def synth(idx, text, ctx, model, pdf, source_language="en"):
        if idx == 1:
            raise RuntimeError("provider exploded")
        return {"title": f"S{idx}", "content": text, "summary": f"sum{idx}", "slide_type": "text"}

    monkeypatch.setattr(uo, "_synthesize_slide", synth)
    await _run("h", OWNER, filename="Deck.pdf")
    prov = rec["receipts"][0]["slide_provenance"]
    assert prov[1]["synthesis_failed"] is True and prov[1]["needs_review"] is True
    assert prov[0]["synthesis_failed"] is False


async def test_on_demand_receipt_is_heuristic_with_no_quiz_grounding(monkeypatch):
    rec, run = _patch_common(monkeypatch, pages=["raw text 0", "raw text 1"])
    await _run("h", OWNER, filename="Deck.pdf", parsing_mode="on_demand")
    (receipt,) = rec["receipts"]
    assert [p["route"] for p in receipt["slide_provenance"]] == ["heuristic", "heuristic"]
    assert receipt["slide_provenance"][0]["prompt"] is None
    assert receipt["slide_provenance"][0]["prompt_version"] is None
    assert receipt["slide_provenance"][0]["requested_model"] is None
    assert receipt["quiz_grounding"] is None


async def test_receipt_written_without_skeleton_when_skeleton_fails(monkeypatch):
    rec, run = _patch_common(monkeypatch)

    def boom(pages):
        raise RuntimeError("skeleton exploded")

    monkeypatch.setattr("backend.services.parser.deck_plan.build_deck_skeleton", boom)
    await _run("h", OWNER, filename="Deck.pdf")
    (receipt,) = rec["receipts"]
    assert receipt["deck_skeleton"] is None
    assert len(receipt["slide_provenance"]) == 3


async def test_receipt_write_failure_never_fails_the_parse(monkeypatch, caplog):
    import logging
    rec, run = _patch_common(monkeypatch)

    async def boom(*_a, **_k):
        raise RuntimeError("parse_receipts table missing")

    monkeypatch.setattr(uo.repos, "save_parse_receipt", boom)
    caplog.set_level(logging.WARNING, logger=uo.logger.name)
    events = await _run("h", OWNER, filename="Deck.pdf")
    assert events[-1][0] == "complete"
    assert RunStatus.COMPLETED in rec["status"]
    assert rec["errors"] == []
    assert "parse receipt write failed" in caplog.text
```

Append to `backend/tests/db/test_unified_pipeline_e2e.py`:
```python
async def test_unified_writes_parse_receipt(wired_pool, db_conn, make_user, monkeypatch):
    prof = make_user(role="professor")
    _patch_synthesis(monkeypatch, pages=["t0", "t1", "t2"], deck_quiz=[])
    events = await _run("hash_receipt", prof)
    assert [t for t, _ in events][-1] == "complete"

    cur = db_conn.cursor()
    cur.execute(
        "SELECT r.run_id = p.run_id, jsonb_array_length(r.deck_skeleton->'slides'), "
        "jsonb_array_length(r.slide_provenance), r.quiz_grounding IS NULL "
        "FROM parse_receipts r JOIN parse_runs p ON p.lecture_id = r.lecture_id "
        "WHERE p.pdf_hash = %s",
        ("hash_receipt",),
    )
    assert cur.fetchone() == (True, 3, 3, True)
```

**Step 2: run and confirm red.**
- `$PY -m pytest backend/tests/unit/test_unified_orchestrator.py -m "not db" -q -k "receipt"`
  Expected: 7 failures, mostly `KeyError: 'receipts'` because the orchestrator never calls `save_parse_receipt`. The never-fails test fails on the missing caplog text.
- `$PY -m pytest backend/tests/db/test_unified_pipeline_e2e.py -m db -q -k receipt`
  Expected: `assert None == (True, 3, 3, True)`.

**Step 3: minimal implementation** in `unified_orchestrator.py`.

(a) In `_synthesize_text_slide_batch`, the `out[idx] = {...}` dict gets one more key after `"vision_routed": False,`:
```python
            "route": "batch",
```

(b) Insert these helpers immediately before `async def _attach_completed_blueprint_material(`:
```python
# Arc 5 parse receipts: which prompt each synthesis route renders.
_ROUTE_PROMPTS: Dict[str, str] = {
    "batch": "BATCH_SLIDE_PROMPT",
    "per_slide": "SLIDE_ANALYSIS_PROMPT",
    "vision": "SLIDE_VISION_PROMPT",
}


def _slide_route(*, ai_mode: bool, is_vision: bool, res: Any) -> str:
    """How one slide was synthesized. Only the batch helper tags its results;
    a text slide without that tag went through the per-slide fallback."""
    if not ai_mode:
        return "heuristic"
    if is_vision:
        return "vision"
    if isinstance(res, dict) and res.get("route") == "batch":
        return "batch"
    return "per_slide"


def _provenance_entry(
    index: int,
    route: str,
    *,
    ai_model: str,
    synthesis_failed: bool,
    needs_review: bool,
    review_reason: Optional[str],
) -> Dict[str, Any]:
    """One slide's receipt line. ``requested_model`` is the model the parse
    asked for (head of the provider chain); the provider that actually served
    the call is not threaded back per slide yet, so it is not recorded."""
    from backend.services.ai.prompts import get_prompt_version

    prompt = _ROUTE_PROMPTS.get(route)
    if route == "heuristic":
        model = None
    elif route == "vision":
        model = settings.vision_model
    else:
        model = ai_model
    return {
        "index": index,
        "route": route,
        "prompt": prompt,
        "prompt_version": get_prompt_version(prompt) if prompt else None,
        "requested_model": model,
        "synthesis_failed": synthesis_failed,
        "needs_review": needs_review,
        "review_reason": review_reason,
    }


async def _write_parse_receipt(
    run_id: UUID,
    lecture_id: UUID,
    *,
    skeleton: Any,
    slide_provenance: List[Dict[str, Any]],
    quiz_grounding: Optional[Dict[str, Any]],
) -> None:
    """Arc 5: persist what this parse saw and decided, for the professor.
    A receipt is diagnostics, so failing to write one is logged and never
    fails a parse that otherwise succeeded."""
    try:
        from backend.services.parser.deck_plan import skeleton_receipt

        await repos.save_parse_receipt(
            run_id,
            lecture_id,
            deck_skeleton=skeleton_receipt(skeleton) if skeleton is not None else None,
            slide_provenance=slide_provenance,
            quiz_grounding=quiz_grounding,
        )
    except Exception as exc:
        logger.warning("parse receipt write failed (non-fatal) run=%s: %s", run_id, exc, exc_info=True)
```

(c) Change `        previous_narrative = ""` (step 4 setup, line ~698) to:
```python
        previous_narrative = ""
        slide_provenance: List[Dict[str, Any]] = []
```

(d) In the chunk loop, change `            if ai_mode:\n                def _ctx_with_instruction(i: int) -> str:` so that `vision_idx_set: set = set()` sits on the line before `if ai_mode:` at the same indentation. Directly after `vision_idxs = [i for i in chunk_idxs if i not in text_idxs]`, add:
```python
                vision_idx_set = set(vision_idxs)
```

(e) In the per-slide loop, replace
```python
            for rel, res in enumerate(results):
                i = chunk_start + rel
                synthesis_failed = isinstance(res, Exception) or not isinstance(res, dict)
```
with
```python
            for rel, res in enumerate(results):
                i = chunk_start + rel
                route = _slide_route(ai_mode=ai_mode, is_vision=i in vision_idx_set, res=res)
                synthesis_failed = isinstance(res, Exception) or not isinstance(res, dict)
```
and immediately after the `needs_review, review_reason = ( ... )` statement (ending with `else (False, None)\n                )`), add:
```python
                slide_provenance.append(_provenance_entry(
                    i, route, ai_model=ai_model, synthesis_failed=synthesis_failed,
                    needs_review=needs_review, review_reason=review_reason,
                ))
```

(f) In step 5, change `        deck_quiz = []` to:
```python
        deck_quiz = []
        quiz_stats: Dict[str, Any] = {}
```
and change the call to:
```python
                    await generate_quiz_questions(
                        raw_slides, lecture_title, ai_model, source_language, skeleton=skeleton,
                        stats=quiz_stats,
                    )
```

(g) In step 6, directly after
```python
            except Exception as exc:
                logger.error("deck/finalize persist failed: %s", exc)
                raise
```
add (same indentation as the `try:` above it):
```python
            await _write_parse_receipt(
                run_uuid, created_lecture_id,
                skeleton=skeleton,
                slide_provenance=slide_provenance,
                quiz_grounding=quiz_stats or None,
            )
```

**Step 4: green.**
- `$PY -m pytest backend/tests/unit/test_unified_orchestrator.py backend/tests/unit/test_synthesis.py -m "not db" -q` (the full file passes, including the pre-existing tests)
- `$PY -m pytest backend/tests/db/test_unified_pipeline_e2e.py -m db -q`

**Step 5: mutation check.**
- Remove `                        stats=quiz_stats,`. `test_parse_pdf_unified_writes_a_parse_receipt` should fail (`None != QUIZ_STATS`). Restore it.
- In `_write_parse_receipt`, replace the `try/except` with the bare `await repos.save_parse_receipt(...)`. `test_receipt_write_failure_never_fails_the_parse` should fail. Restore it.
- Remove `            "route": "batch",` from the batch helper. The batch-route test should fail, reporting `"per_slide"`. Restore it.

**Step 6: commit.**
```
feat(parser): unified orchestrator writes a parse receipt at finalize

Deck skeleton, per-slide route/prompt-version/requested-model provenance and
the deck-quiz grounding summary are upserted per run. Receipt write failures
are logged and never fail the parse. Serving provider/cost per slide is not
attributable yet (llm_calls has no run_id) and is deliberately not recorded.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## Task 5: `GET /api/v1/lectures/{lecture_id}/parse-receipt`

**Files**
- `backend/api/v1/parse_receipts.py` (new)
- `backend/main.py`
- `backend/tests/integration/test_parse_receipt_endpoint.py` (new)

**Interfaces**
- Consumes: `verify_token`, `_user_id` (`backend/core/auth_middleware.py`), `limiter` (`backend/core/rate_limit.py`), and `backend.core.database.supabase_admin` read at call time.
- Produces: `GET /api/v1/lectures/{lecture_id: UUID}/parse-receipt` with these responses:
  - 200 `{"success": true, "data": {run_id, lecture_id, deck_skeleton, slide_provenance, quiz_grounding, created_at}}` (latest by `created_at`)
  - 404 "Lecture not found." for a missing **or non-owned** lecture
  - 404 "No parse receipt for this lecture."
  - 401 when unauthenticated
  - 422 for a non-UUID id

**Step 1: failing test.** `backend/tests/integration/test_parse_receipt_endpoint.py`:
```python
"""GET /api/v1/lectures/{lecture_id}/parse-receipt — ownership (Arc 5).

Driven through the FastAPI app against fake_supabase, which applies NO RLS:
the only thing keeping professor B out of professor A's receipt is the
endpoint's own ownership check (the RLS policy is covered separately in
backend/tests/db/test_parse_receipts_rls.py). A non-owner gets the same 404
as a missing lecture, so lecture ids are not enumerable.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.core.auth_middleware import verify_token

LECTURE_A = "aaaaaaaa-0000-4000-8000-00000000000a"
PRIVATE_LECTURE = "aaaaaaaa-0000-4000-8000-00000000000b"
RUN_NEW = "bbbbbbbb-0000-4000-8000-00000000000a"
RUN_OLD = "bbbbbbbb-0000-4000-8000-0000000000a0"


@pytest.fixture
def client(app):
    return TestClient(app)


def _auth_as(app, user) -> None:
    app.dependency_overrides[verify_token] = lambda: user


def _url(lecture_id: str) -> str:
    return f"/api/v1/lectures/{lecture_id}/parse-receipt"


def _seed_lecture(fake, *, lecture_id, professor_id=None, student_owner_id=None) -> None:
    fake.table("lectures").insert({
        "id": lecture_id, "title": "Graphs", "course_id": None,
        "professor_id": professor_id, "student_owner_id": student_owner_id,
        "visibility": "private_student" if student_owner_id else "course",
    }).execute()


def _seed_receipt(fake, *, run_id, lecture_id, created_at, kept=3) -> None:
    fake.table("parse_receipts").insert({
        "run_id": run_id,
        "lecture_id": lecture_id,
        "deck_skeleton": {
            "boilerplate": ["footer seite #"],
            "slides": [{"index": 0, "role": "title", "section": 0, "chars": 12}],
            "sections": [{"index": 0, "title": "Graphs", "start": 0, "end": 0}],
        },
        "slide_provenance": [{
            "index": 0, "route": "batch", "prompt": "BATCH_SLIDE_PROMPT", "prompt_version": "v3",
            "requested_model": "cerebras", "synthesis_failed": False,
            "needs_review": False, "review_reason": None,
        }],
        "quiz_grounding": {"proposed": 4, "kept": kept, "repaired": 1,
                           "dropped": 4 - kept, "drop_reasons": {"no_source": 4 - kept}},
        "created_at": created_at,
    }).execute()


def test_owner_gets_the_latest_receipt(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    _seed_lecture(fake_supabase, lecture_id=LECTURE_A, professor_id=professor_user.id)
    _seed_receipt(fake_supabase, run_id=RUN_OLD, lecture_id=LECTURE_A,
                  created_at="2026-10-01T10:00:00+00:00", kept=1)
    _seed_receipt(fake_supabase, run_id=RUN_NEW, lecture_id=LECTURE_A,
                  created_at="2026-10-12T10:00:00+00:00", kept=3)

    r = client.get(_url(LECTURE_A))

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    assert set(data) == {"run_id", "lecture_id", "deck_skeleton", "slide_provenance",
                         "quiz_grounding", "created_at"}
    assert data["run_id"] == RUN_NEW
    assert data["quiz_grounding"]["kept"] == 3
    assert data["deck_skeleton"]["boilerplate"] == ["footer seite #"]
    assert data["slide_provenance"][0]["route"] == "batch"


def test_other_professor_gets_404_and_no_receipt(client, app, fake_supabase,
                                                 professor_user, other_professor_user):
    _auth_as(app, other_professor_user)
    _seed_lecture(fake_supabase, lecture_id=LECTURE_A, professor_id=professor_user.id)
    _seed_receipt(fake_supabase, run_id=RUN_NEW, lecture_id=LECTURE_A,
                  created_at="2026-10-12T10:00:00+00:00")

    r = client.get(_url(LECTURE_A))

    assert r.status_code == 404
    assert r.json()["detail"] == "Lecture not found."
    assert "deck_skeleton" not in r.text


def test_404_when_owned_lecture_has_no_receipt(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    _seed_lecture(fake_supabase, lecture_id=LECTURE_A, professor_id=professor_user.id)

    r = client.get(_url(LECTURE_A))

    assert r.status_code == 404
    assert r.json()["detail"] == "No parse receipt for this lecture."


def test_404_for_unknown_lecture(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    r = client.get(_url(LECTURE_A))
    assert r.status_code == 404
    assert r.json()["detail"] == "Lecture not found."


def test_private_upload_owner_reads_own_receipt(client, app, fake_supabase, student_user):
    _auth_as(app, student_user)
    _seed_lecture(fake_supabase, lecture_id=PRIVATE_LECTURE, student_owner_id=student_user.id)
    _seed_receipt(fake_supabase, run_id=RUN_NEW, lecture_id=PRIVATE_LECTURE,
                  created_at="2026-10-12T10:00:00+00:00")

    r = client.get(_url(PRIVATE_LECTURE))

    assert r.status_code == 200, r.text
    assert r.json()["data"]["run_id"] == RUN_NEW


def test_non_uuid_lecture_id_is_rejected(client, app, fake_supabase, professor_user):
    _auth_as(app, professor_user)
    assert client.get(_url("not-a-uuid")).status_code == 422


def test_unauthenticated_request_is_401(client, fake_supabase):
    assert client.get(_url(LECTURE_A)).status_code == 401
```

**Step 2: run and confirm red.**
`$PY -m pytest backend/tests/integration/test_parse_receipt_endpoint.py -m "not db" -q`
Expected: every test fails with 404 `{"detail": "Not Found"}` (no route). The detail-string assertions fail and the 200/401/422 assertions fail.

**Step 3: minimal implementation.**

`backend/api/v1/parse_receipts.py`:
```python
"""Parse receipts API (Arc 5).

    GET /api/v1/lectures/{lecture_id}/parse-receipt
        The latest receipt for a lecture the caller owns: deck skeleton,
        per-slide synthesis provenance, and the deck-quiz grounding summary.

The read goes through the service-role client (RLS bypassed, mirroring
worksheets.py), so ownership is enforced here: the course professor or the
student owner of a private upload. A lecture the caller does not own gets
the same 404 as a missing one, so lecture ids are not enumerable. The
`parse_receipts` RLS policy is the matching defense-in-depth layer for
direct client access.

`supabase_admin` is read from `backend.core.database` at call time (not
imported by name) so the test suite's client patch applies without a
per-module patch in conftest.
"""
import logging
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from backend.core import database as _database
from backend.core.auth_middleware import _user_id, verify_token
from backend.core.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter(tags=["parse-receipts"])

_RECEIPT_COLUMNS = (
    "run_id", "lecture_id", "deck_skeleton", "slide_provenance", "quiz_grounding", "created_at",
)


def _owns_lecture(user_id: str, lecture_id: str) -> bool:
    rows = (
        _database.supabase_admin.table("lectures")
        .select("id, professor_id, student_owner_id")
        .eq("id", lecture_id)
        .execute()
        .data
        or []
    )
    if not rows:
        return False
    lecture = rows[0]
    return user_id in (lecture.get("professor_id"), lecture.get("student_owner_id"))


def _latest_receipt(lecture_id: str) -> Optional[dict]:
    rows = (
        _database.supabase_admin.table("parse_receipts")
        .select(", ".join(_RECEIPT_COLUMNS))
        .eq("lecture_id", lecture_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    return {col: rows[0].get(col) for col in _RECEIPT_COLUMNS} if rows else None


@router.get("/lectures/{lecture_id}/parse-receipt")
@limiter.limit("60/minute")
async def get_parse_receipt(
    request: Request,
    lecture_id: UUID,
    user: Any = Depends(verify_token),
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")
    lid = str(lecture_id)

    def _load() -> dict:
        if not _owns_lecture(uid, lid):
            raise HTTPException(status_code=404, detail="Lecture not found.")
        receipt = _latest_receipt(lid)
        if receipt is None:
            raise HTTPException(status_code=404, detail="No parse receipt for this lecture.")
        return receipt

    try:
        data = await run_in_threadpool(_load)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("parse receipt load failed for lecture %s: %s", lid, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to load parse receipt.")
    return {"success": True, "data": data}
```

`backend/main.py`:
- After line 51 (`from backend.api.v1.localized_content import router as localized_content_router`), add:
  `from backend.api.v1.parse_receipts import router as parse_receipts_router`
- After `v1_router.include_router(localized_content_router)`, add:
  `v1_router.include_router(parse_receipts_router)`

**Step 4: green.**
- `$PY -m pytest backend/tests/integration/test_parse_receipt_endpoint.py -m "not db" -q`
- Then the regression sweep: `$PY -m pytest backend/tests -m "not db" -q -x`
- Then `$PY -m pytest backend/tests/db -m db -q`

**Step 5: mutation check.**
- In `_owns_lecture`, replace `return user_id in (lecture.get("professor_id"), lecture.get("student_owner_id"))` with `return True`. `test_other_professor_gets_404_and_no_receipt` should fail with 200. Restore it.
- Change `.order("created_at", desc=True)` to `.order("created_at")`. `test_owner_gets_the_latest_receipt` should fail, returning `RUN_OLD`. Restore it.

**Step 6: commit.**
```
feat(api): GET /api/v1/lectures/{id}/parse-receipt for lecture owners

Returns the latest parse receipt (deck skeleton, slide provenance, quiz
grounding). Non-owners get the same 404 as a missing lecture.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## Sequencing and risks

- **Order:** Task 1 and Task 2 are independent. Task 3 must land before Task 4, because `_patch_common` uses `monkeypatch.setattr(uo.repos, "save_parse_receipt", ...)` with `raising=True` and the attribute must exist. Task 4's DB e2e test needs Task 2's migration. Task 5 is independent of 3 and 4, but only makes sense after them.
- **`_patch_common` coupling:** the quiz fake and the `save_parse_receipt` stub must change in the same commit as the orchestrator change. Otherwise the existing happy-path test breaks (the `stats` TypeError is swallowed, so `deck_quiz` becomes `[]`), or the outbound guard trips.
- **Merge with main:** main already carries 20261011000000 and 20261011000100. `20261012000000` sorts after both, so no collision. Rebase before opening the PR and rerun `check_migration_timestamps.py` and `pytest -m db`. Main's bootstrap is 10 lines ahead (`git diff HEAD origin/main -- backend/tests/db/sql/00_bootstrap.sql`), which may tighten the anon defaults further. The explicit REVOKE holds either way.
- **Replay path:** `_replay_from_db` writes nothing; the existing receipt for that run_id stays valid.
- **Follow-up, out of scope:** per-slide provider and cost attribution. This needs `run_id` and `prompt_version` columns threaded into `llm_calls` via `orchestrator._account_for_call` and `cost.log_llm_call`. Once that exists, the receipt can join `llm_calls` on `run_id` instead of storing cost.

### Critical files for implementation
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/services/parser/unified_orchestrator.py
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/services/parser/synthesis.py
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/services/parser/repos.py
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/supabase/migrations/20261012000000_parse_receipts.sql (new)
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/tests/unit/test_unified_orchestrator.py
