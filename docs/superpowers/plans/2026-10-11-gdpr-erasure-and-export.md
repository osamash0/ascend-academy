# GDPR Erasure Ordering & Export Completeness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deleting an account removes *everything* the person owns — rows, storage files in every bucket, public avatar — without ever leaving a half-deleted live account or an unrecoverable orphan; and the data export contains every table that holds the person's data, guarded so it cannot drift again.

**Architecture:** Erasure becomes *manifest → durable job → auth delete → execute*. Before anything is deleted, a read-only pass builds an exact list of storage keys and rows to remove and stores it in a service-role-only table that has no FK to `auth.users` (so it outlives the account). Only then is the `auth.users` row deleted (Postgres cascades the rows). The job's files are removed afterwards, inline and, on failure, by an Arq cron retry. The export becomes a declared spec covering every user-linked table, and a coverage test (migrated DB) plus a read-only production probe fail when a new user-linked table appears without being exported or explicitly excluded.

**Tech Stack:** FastAPI, supabase-py (service-role client `supabase_admin`), Arq worker crons, Postgres 15 migrations, pytest (`unit`, `integration`, `db` markers), psycopg.

**Spec:** `docs/MILESTONE_2026_08.md` §F2 and §F3, plus the production catalog facts recorded below (read 2026-10-11, read-only transaction).

## Global Constraints

- **Never run `supabase db push`.** Production's migration ledger is unreliable (2 rows vs 115+ files). New migrations are applied **by hand with psql, in one transaction, via the pooler `DATABASE_URL` on port 5432**, and only with Abi's explicit go-ahead.
- Production is read **only** inside `BEGIN READ ONLY; … ROLLBACK;`.
- Type-check gate is `npx tsc -p tsconfig.app.json --noEmit` (`tsconfig.json` checks nothing).
- Backend tests: `pytest backend/tests/unit -q`, `pytest backend/tests/integration -q`, `pytest -m db backend/tests/db -q` (needs Docker or the local Postgres the db conftest finds).
- Every new public table or function in a migration: `REVOKE … FROM anon, authenticated` explicitly — `REVOKE … FROM PUBLIC` does not remove Supabase's direct grants.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Facts this plan is built on (production, 2026-10-11)

**Foreign keys into `auth.users` (37):** `achievements.user_id`, `assignment_enrollments.user_id`, `assignments.professor_id`, `concept_mastery.user_id`, `course_blueprints.owner_id`, `course_enrollments.user_id`, `course_visits.user_id`, `courses.professor_id`, `exam_attempts.user_id`, `friend_requests.addressee_id`, `friend_requests.requester_id`, `learning_events.user_id`, `lecture_visits.user_id`, `lectures.professor_id`, `lectures.student_owner_id`, `llm_calls.user_id` (**ON DELETE SET NULL**), `material_sources.owner_id`, `notification_preferences.user_id`, `notifications.user_id`, `nudge_dismissals.user_id`, `onboarding_progress.user_id`, `parse_runs.user_id`, `practice_attempts.student_id`, `practice_sheets.created_by`, `profiles.user_id`, `review_log.user_id`, `review_schedule.user_id`, `schedule_item_completions.user_id`, `student_catalog_courses.user_id`, `student_progress.user_id`, `tutor_sessions.user_id`, `upload_quotas.user_id`, `user_feedback.user_id`, `user_roles.user_id`, `v4_rehearsal_attempts.user_id`, `worksheets.uploaded_by` (**SET NULL**), `xp_events.user_id`. All others CASCADE.

**User columns with no FK at all (never cascaded):** `api_tokens.user_id`, `course_access.user_id` (both 0 rows today).

**Indirect:** `tutor_messages.session_id → tutor_sessions(id) ON DELETE CASCADE` (AI chat transcripts).

**Production-only tables (no migration creates them):** `tutor_sessions`, `api_tokens`, `course_access`. A migrated test DB will not contain them — hence the production probe in Task 2.

**`llm_calls` columns:** feature, provider, model, token counts, cost, course_id. No prompt or response text. SET NULL on erasure is deliberate (anonymous cost metering) and stays.

**Storage buckets and key schemes:**

| Bucket | Public | Key | Owner link |
|---|---|---|---|
| `avatars` | **yes** | `{user_id}/avatar-{ts}.{ext}` | folder = user |
| `lecture-pdfs` | **yes** | `lectures/{lecture_id}/{filename}` (legacy rows hold a full public URL in `lectures.pdf_url`) | lecture |
| `lecture-posters` | no | `lectures/{lecture_id}/poster.webp` | lecture |
| `pdf-uploads` | no | `{pdf_hash}.pdf`, **content-addressed and shared across users** | lectures.pdf_hash |
| `worksheets` | no | `worksheets.file_url` | lecture |
| `slides` | yes | 0 objects, unused | n/a |

**Today's erasure** (`backend/api/v1/auth.py::delete_account_endpoint`) cleans only `pdf-uploads` and `worksheets`, swallows every failure, counts failed deletes as deleted, then deletes the auth user anyway. `avatars`, `lecture-pdfs` and `lecture-posters` are never touched. That means public avatar photos and public lecture PDFs stay fetchable after erasure.

## File structure

| File | Responsibility |
|---|---|
| `backend/services/account_service.py` (modify) | Export only: the declared export spec, the redaction rules and the coverage helper. The erasure code moves out. |
| `backend/services/erasure.py` (create) | Erasure: manifest builder, durable job store, executor, drain. One responsibility, testable through an injectable client. |
| `backend/api/v1/auth.py` (modify) | The endpoint orchestrates manifest → job → auth delete → execute. |
| `backend/workers/arq_worker.py` (modify) | Registers the `drain_erasure_jobs` cron. |
| `supabase/migrations/20261013000000_account_erasure_jobs.sql` (create) | The durable job table (service-role only). |
| `backend/scripts/gdpr_coverage_probe.py` (create) | Read-only production probe: are all user-linked columns covered? |
| `backend/tests/unit/test_account_export.py` (create) | Export spec unit tests. |
| `backend/tests/unit/test_erasure.py` (create) | Manifest, job and executor unit tests (in-memory fake client). |
| `backend/tests/unit/test_erasure_cron.py` (create) | The cron is registered and delegates. |
| `backend/tests/integration/test_auth_account_deletion.py` (modify) | Endpoint ordering tests. |
| `backend/tests/db/test_gdpr_coverage.py` (create) | Every user-linked column in the migrated DB is exported or excluded. |
| `backend/tests/db/test_account_erasure_jobs_privileges.py` (create) | The job table is invisible to anon and authenticated. |
| `backend/tests/unit/test_account_service.py` (modify) | Drop the erasure tests that moved to `test_erasure.py`; keep the export tests. |
| `docs/MILESTONE_2026_08.md` (modify) | Mark F2/F3 resolved, link this plan. |
| `docs/runbooks/gdpr-erasure-rollout.md` (create) | Manual migration apply, probe run, deploy order, verification. |

---

### Task 1: Export spec covers every user-linked table

**Files:**
- Modify: `backend/services/account_service.py` (replace `EXPORT_TABLES` and `export_user_data`; delete the erasure functions, which move to Tasks 4–5)
- Create: `backend/tests/unit/test_account_export.py`
- Modify: `backend/tests/unit/test_account_service.py`

**Interfaces:**
- Produces: `EXPORT_TABLES: list[tuple[str, str]]`, `EXPORT_REDACT: dict[str, set[str]]`, `EXPORT_EXCLUSIONS: dict[tuple[str, str], str]`, `ALWAYS_COVERED: set[tuple[str, str]]`, `covered_columns() -> set[tuple[str, str]]`, `uncovered(fk_columns: Iterable[tuple[str, str]]) -> list[tuple[str, str]]`, and `async export_user_data(uid: str) -> dict[str, Any]` (signature unchanged).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/unit/test_account_export.py
"""The export spec: every user-linked table, both sides of friendships,
AI chat transcripts, and no secret material."""
import pytest

from backend.services import account_service as acc

UID = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"


class _Res:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, rows):
        self._rows, self._f = rows, []

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._f.append(lambda r: r.get(col) == val)
        return self

    def in_(self, col, vals):
        self._f.append(lambda r: r.get(col) in vals)
        return self

    def execute(self):
        return _Res([r for r in self._rows if all(f(r) for f in self._f)])


class FakeAdmin:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        if name not in self.tables:
            raise RuntimeError(f'relation "{name}" does not exist')
        return _Q(self.tables[name])


@pytest.fixture
def admin(monkeypatch):
    def _make(tables):
        fake = FakeAdmin(tables)
        monkeypatch.setattr(acc, "supabase_admin", fake)
        return fake
    return _make


@pytest.mark.asyncio
async def test_exports_both_sides_of_friend_requests(admin):
    admin({"friend_requests": [
        {"id": "a", "requester_id": UID, "addressee_id": OTHER},
        {"id": "b", "requester_id": OTHER, "addressee_id": UID},
        {"id": "c", "requester_id": OTHER, "addressee_id": "x"},
    ]})
    out = await acc.export_user_data(UID)
    assert sorted(r["id"] for r in out["friend_requests"]) == ["a", "b"]


@pytest.mark.asyncio
async def test_exports_tutor_transcripts_through_sessions(admin):
    admin({
        "tutor_sessions": [{"id": "s1", "user_id": UID}, {"id": "s2", "user_id": OTHER}],
        "tutor_messages": [
            {"id": "m1", "session_id": "s1", "content": "mine"},
            {"id": "m2", "session_id": "s2", "content": "theirs"},
        ],
    })
    out = await acc.export_user_data(UID)
    assert [m["id"] for m in out["tutor_messages"]] == ["m1"]


@pytest.mark.asyncio
async def test_redacts_token_hashes(admin):
    admin({"api_tokens": [{"id": "t", "user_id": UID, "token_hash": "secret", "name": "ci"}]})
    out = await acc.export_user_data(UID)
    assert out["api_tokens"] == [{"id": "t", "user_id": UID, "name": "ci"}]


@pytest.mark.asyncio
async def test_missing_table_is_skipped_not_fatal(admin):
    admin({})
    out = await acc.export_user_data(UID)
    assert out["profiles"] == [] and out["user_id"] == UID


def test_spec_covers_every_production_user_column():
    """The 2026-10-11 production catalog (see plan) — none may be uncovered."""
    prod = {
        ("achievements", "user_id"), ("assignment_enrollments", "user_id"),
        ("assignments", "professor_id"), ("concept_mastery", "user_id"),
        ("course_blueprints", "owner_id"), ("course_enrollments", "user_id"),
        ("course_visits", "user_id"), ("courses", "professor_id"),
        ("exam_attempts", "user_id"), ("friend_requests", "addressee_id"),
        ("friend_requests", "requester_id"), ("learning_events", "user_id"),
        ("lecture_visits", "user_id"), ("lectures", "professor_id"),
        ("lectures", "student_owner_id"), ("llm_calls", "user_id"),
        ("material_sources", "owner_id"), ("notification_preferences", "user_id"),
        ("notifications", "user_id"), ("nudge_dismissals", "user_id"),
        ("onboarding_progress", "user_id"), ("parse_runs", "user_id"),
        ("practice_attempts", "student_id"), ("practice_sheets", "created_by"),
        ("profiles", "user_id"), ("review_log", "user_id"), ("review_schedule", "user_id"),
        ("schedule_item_completions", "user_id"), ("student_catalog_courses", "user_id"),
        ("student_progress", "user_id"), ("tutor_sessions", "user_id"),
        ("upload_quotas", "user_id"), ("user_feedback", "user_id"), ("user_roles", "user_id"),
        ("v4_rehearsal_attempts", "user_id"), ("worksheets", "uploaded_by"),
        ("xp_events", "user_id"), ("api_tokens", "user_id"), ("course_access", "user_id"),
    }
    assert acc.uncovered(prod) == []
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pytest backend/tests/unit/test_account_export.py -q`
Expected: FAIL. `friend_requests` only returns `a`; there is no `tutor_messages` key; `uncovered` is not defined.

- [ ] **Step 3: Implement the export spec**

In `backend/services/account_service.py`, replace everything from `EXPORT_TABLES` through the end of `export_user_data` with the block below. Delete `_lecture_ids_and_hashes`, `_pdf_hash_used_by_other_users` and `erase_user_storage_and_derived_data`; they move to `backend/services/erasure.py` in Tasks 4–5. Replace the module docstring with: `"""Account data export (GDPR Art. 20). Erasure lives in backend/services/erasure.py."""`. Change the typing import to `from typing import Any, Iterable`.

```python
# Every user-linked column, by the table it lives in. Rows from several
# columns of one table (friend_requests) are merged and de-duplicated by id.
# Production-only tables (tutor_sessions, api_tokens, course_access) are
# listed too: a missing table is skipped, never fatal.
EXPORT_TABLES: list[tuple[str, str]] = [
    ("profiles", "user_id"),
    ("user_roles", "user_id"),
    ("onboarding_progress", "user_id"),
    ("notification_preferences", "user_id"),
    ("notifications", "user_id"),
    ("user_feedback", "user_id"),
    ("achievements", "user_id"),
    ("xp_events", "user_id"),
    ("learning_events", "user_id"),
    ("student_progress", "user_id"),
    ("concept_mastery", "user_id"),
    ("course_enrollments", "user_id"),
    ("course_visits", "user_id"),
    ("lecture_visits", "user_id"),
    ("student_catalog_courses", "user_id"),
    ("nudge_dismissals", "user_id"),
    ("schedule_item_completions", "user_id"),
    ("review_schedule", "user_id"),
    ("review_log", "user_id"),
    ("exam_attempts", "user_id"),
    ("practice_attempts", "student_id"),
    ("practice_sheets", "created_by"),
    ("v4_rehearsal_attempts", "user_id"),
    ("assignment_enrollments", "user_id"),
    ("assignments", "professor_id"),
    ("courses", "professor_id"),
    ("course_blueprints", "owner_id"),
    ("material_sources", "owner_id"),
    ("parse_runs", "user_id"),
    ("upload_quotas", "user_id"),
    ("llm_calls", "user_id"),
    ("friend_requests", "requester_id"),
    ("friend_requests", "addressee_id"),
    ("tutor_sessions", "user_id"),
    ("api_tokens", "user_id"),
    ("course_access", "user_id"),
]

# Columns never exported even though the row is: secrets, not personal data.
EXPORT_REDACT: dict[str, set[str]] = {"api_tokens": {"token_hash"}}

# User-linked columns deliberately NOT exported, each with its reason.
EXPORT_EXCLUSIONS: dict[tuple[str, str], str] = {
    ("account_erasure_jobs", "subject_id"): (
        "erasure bookkeeping; exists only while an account is being deleted"
    ),
}

# Exported by dedicated code below rather than through EXPORT_TABLES.
ALWAYS_COVERED: set[tuple[str, str]] = {
    ("lectures", "professor_id"),
    ("lectures", "student_owner_id"),
    ("worksheets", "uploaded_by"),
}

LECTURE_OWNER_COLUMNS = ["professor_id", "student_owner_id"]


def covered_columns() -> set[tuple[str, str]]:
    return set(EXPORT_TABLES) | ALWAYS_COVERED | set(EXPORT_EXCLUSIONS)


def uncovered(fk_columns: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    """User-linked (table, column) pairs the export neither covers nor excludes."""
    known = covered_columns()
    return sorted(c for c in fk_columns if c not in known)


async def _select_all(table: str, column: str, uid: str) -> list[dict[str, Any]]:
    def _run() -> list[dict[str, Any]]:
        try:
            resp = supabase_admin.table(table).select("*").eq(column, uid).execute()
            return resp.data or []
        except Exception as e:  # production-only tables may be missing elsewhere
            logger.warning("gdpr: skipping %s.%s (%s)", table, column, e)
            return []

    return await run_in_threadpool(_run)


async def _select_in(table: str, column: str, values: list[str]) -> list[dict[str, Any]]:
    if not values:
        return []

    def _run() -> list[dict[str, Any]]:
        try:
            resp = supabase_admin.table(table).select("*").in_(column, values).execute()
            return resp.data or []
        except Exception as e:
            logger.warning("gdpr: skipping %s (%s)", table, e)
            return []

    return await run_in_threadpool(_run)


def _merge(existing: list[dict[str, Any]], new: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen = {r.get("id") for r in existing if r.get("id") is not None}
    return existing + [r for r in new if r.get("id") is None or r.get("id") not in seen]


async def export_user_data(uid: str) -> dict[str, Any]:
    """Every row holding the caller's data (GDPR Art. 20), one key per table."""
    result: dict[str, Any] = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user_id": uid,
    }
    for table, column in EXPORT_TABLES:
        rows = await _select_all(table, column, uid)
        redact = EXPORT_REDACT.get(table, set())
        if redact:
            rows = [{k: v for k, v in r.items() if k not in redact} for r in rows]
        result[table] = _merge(result.get(table, []), rows)

    # AI chat transcripts hang off tutor_sessions, not the user.
    session_ids = [s["id"] for s in result.get("tutor_sessions", []) if s.get("id")]
    result["tutor_messages"] = await _select_in("tutor_messages", "session_id", session_ids)

    owned_lectures: list[dict[str, Any]] = []
    for column in LECTURE_OWNER_COLUMNS:
        owned_lectures = _merge(owned_lectures, await _select_all("lectures", column, uid))
    result["lectures"] = owned_lectures
    result["worksheets_uploaded"] = await _select_all("worksheets", "uploaded_by", uid)
    return result
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest backend/tests/unit/test_account_export.py -q`
Expected: 5 passed.

- [ ] **Step 5: Trim the old unit file and run everything export-related**

In `backend/tests/unit/test_account_service.py`, delete the five `test_erase_user_storage_*` tests; Task 5 replaces them. Keep the two `test_export_*` tests.
Run: `pytest backend/tests/unit/test_account_service.py backend/tests/unit/test_account_export.py -q && pytest backend/tests/integration/test_auth_account_deletion.py -k export -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/services/account_service.py backend/tests/unit/test_account_export.py backend/tests/unit/test_account_service.py
git commit -m "fix(gdpr): export every user-linked table, both sides of friendships, chat transcripts"
```

---

### Task 2: Coverage guard: migrated-DB test and production probe

**Files:**
- Create: `backend/scripts/gdpr_coverage_probe.py`
- Create: `backend/tests/db/test_gdpr_coverage.py`

**Interfaces:**
- Consumes: `account_service.uncovered` (Task 1).
- Produces: `USER_FK_SQL: str`, `NO_FK_USER_COLUMNS_SQL: str`, `user_linked_columns(conn) -> set[tuple[str, str]]`, `main(dsn: str) -> int`. The db test calls `user_linked_columns`, so the test and the production probe ask the same question.

- [ ] **Step 1: Write the probe module**

```python
# backend/scripts/gdpr_coverage_probe.py
"""Is every column that links a row to a person covered by the GDPR export?

Runs read-only (BEGIN READ ONLY ... ROLLBACK). Exit 1 lists the gaps.
Run against production before every deploy that adds a table:

    python -m backend.scripts.gdpr_coverage_probe "$DATABASE_URL"
"""
from __future__ import annotations

import sys

USER_FK_SQL = """
SELECT c.conrelid::regclass::text, a.attname
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE c.contype = 'f'
  AND c.confrelid = 'auth.users'::regclass
  AND c.connamespace = 'public'::regnamespace
"""

# User-shaped columns with no FK at all: not cascaded, easy to forget.
NO_FK_USER_COLUMNS_SQL = """
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('user_id','student_id','owner_id','created_by','uploaded_by',
                      'author_id','professor_id','student_owner_id','requester_id','addressee_id')
  AND table_name NOT IN (SELECT viewname FROM pg_views WHERE schemaname = 'public')
  AND table_name NOT IN (SELECT matviewname FROM pg_matviews WHERE schemaname = 'public')
  AND (table_name, column_name) NOT IN (
    SELECT c.conrelid::regclass::text, a.attname FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f')
"""


def user_linked_columns(conn) -> set[tuple[str, str]]:
    with conn.cursor() as cur:
        cur.execute(USER_FK_SQL)
        cols = {(t, c) for t, c in cur.fetchall()}
        cur.execute(NO_FK_USER_COLUMNS_SQL)
        cols |= {(t, c) for t, c in cur.fetchall()}
    return cols


def main(dsn: str) -> int:
    import psycopg

    from backend.services.account_service import uncovered

    with psycopg.connect(dsn) as conn:
        conn.execute("BEGIN READ ONLY")
        try:
            gaps = uncovered(user_linked_columns(conn))
        finally:
            conn.execute("ROLLBACK")
    for t, c in gaps:
        print(f"NOT EXPORTED: {t}.{c}")
    print("ok" if not gaps else f"{len(gaps)} gap(s)")
    return 1 if gaps else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
```

- [ ] **Step 2: Write the db test**

```python
# backend/tests/db/test_gdpr_coverage.py
"""Every column that links a row to a person in the migrated schema is
exported or explicitly excluded. A new table that references auth.users
fails here until the export spec names it (MILESTONE_2026_08 F3: 're-drifts')."""
import pytest

from backend.scripts.gdpr_coverage_probe import user_linked_columns
from backend.services.account_service import uncovered

pytestmark = pytest.mark.db


def test_every_user_linked_column_is_exported_or_excluded(db_conn):
    cols = user_linked_columns(db_conn)
    assert ("profiles", "user_id") in cols, "probe found nothing: wrong schema?"
    assert uncovered(cols) == []
```

- [ ] **Step 3: Prove the guard bites, then make it pass**

Temporarily delete `("courses", "professor_id")` from `EXPORT_TABLES`.
Run: `pytest -m db backend/tests/db/test_gdpr_coverage.py -q`
Expected: FAIL listing `('courses', 'professor_id')`.
Restore the line and run again. Expected: 1 passed. If the migrated DB holds user-linked columns that production does not (or the reverse), add them to `EXPORT_TABLES` or, with a reason, to `EXPORT_EXCLUSIONS`, and add them to the Task 1 production test set.

- [ ] **Step 4: Run the probe against production (read-only)**

Run: `set -a; . ./.env; set +a; python -m backend.scripts.gdpr_coverage_probe "$DATABASE_URL"`
Expected: `ok`, exit 0. Any `NOT EXPORTED:` line is a real gap: add it to `EXPORT_TABLES` (or to `EXPORT_EXCLUSIONS` with a reason) before continuing.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/gdpr_coverage_probe.py backend/tests/db/test_gdpr_coverage.py
git commit -m "test(gdpr): fail when a user-linked table is not exported; read-only prod probe"
```

---

### Task 3: Durable erasure job table

**Files:**
- Create: `supabase/migrations/20261013000000_account_erasure_jobs.sql`
- Create: `backend/tests/db/test_account_erasure_jobs_privileges.py`

**Interfaces:**
- Produces: table `public.account_erasure_jobs(id uuid pk, subject_id uuid not null, manifest jsonb not null, status text check in ('awaiting_auth_delete','pending'), attempts int, last_error text, created_at timestamptz, updated_at timestamptz)`. Service role only, no FK.

- [ ] **Step 1: Write the failing privilege test**

```python
# backend/tests/db/test_account_erasure_jobs_privileges.py
"""The erasure job table holds storage keys of a person being deleted: only
the service role may see it, and it must outlive the account."""
import pytest

pytestmark = pytest.mark.db


def test_table_exists_without_fk(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.account_erasure_jobs')")
        assert cur.fetchone()[0] is not None
        cur.execute(
            "SELECT count(*) FROM pg_constraint "
            "WHERE conrelid = 'public.account_erasure_jobs'::regclass AND contype = 'f'"
        )
        assert cur.fetchone()[0] == 0, "a FK would cascade the job away with the account"


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_no_client_role_can_touch_it(db_conn, role):
    with db_conn.cursor() as cur:
        for priv in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            cur.execute(
                "SELECT has_table_privilege(%s, 'public.account_erasure_jobs', %s)", (role, priv)
            )
            assert cur.fetchone()[0] is False, f"{role} has {priv}"


def test_rls_is_enabled(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.account_erasure_jobs'::regclass"
        )
        assert cur.fetchone()[0] is True
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pytest -m db backend/tests/db/test_account_erasure_jobs_privileges.py -q`
Expected: FAIL (`to_regclass` returns NULL).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20261013000000_account_erasure_jobs.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Durable record of what an account erasure still has to delete.
--
-- GDPR erasure (backend/services/erasure.py) builds a manifest of storage keys
-- BEFORE deleting auth.users, because the cascade removes the lectures rows
-- that were the only map from a person to their files. The manifest is kept
-- here so a failed file delete is retried by the worker instead of becoming an
-- unrecoverable orphan (MILESTONE_2026_08 F2).
--
-- No FK to auth.users on purpose: the row must outlive the account it erases.
-- The row is deleted once its files are gone. Service role only.
-- APPLY BY HAND (psql, one transaction). Never `supabase db push`.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account_erasure_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id  uuid NOT NULL,
  manifest    jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'awaiting_auth_delete'
              CHECK (status IN ('awaiting_auth_delete', 'pending')),
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_erasure_jobs_status_created_idx
  ON public.account_erasure_jobs (status, created_at);

ALTER TABLE public.account_erasure_jobs ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (which bypasses RLS) reads or writes.
REVOKE ALL ON public.account_erasure_jobs FROM PUBLIC;
REVOKE ALL ON public.account_erasure_jobs FROM anon, authenticated;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pytest -m db backend/tests/db/test_account_erasure_jobs_privileges.py backend/tests/db/test_gdpr_coverage.py -q`
Expected: all pass. `subject_id` has no FK and its name is not on the no-FK list, so the coverage guard ignores it; the exclusion entry from Task 1 documents it anyway.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261013000000_account_erasure_jobs.sql backend/tests/db/test_account_erasure_jobs_privileges.py
git commit -m "feat(db): account_erasure_jobs — durable, service-role-only erasure manifest"
```

---

### Task 4: Erasure manifest (read-only, all-or-nothing)

**Files:**
- Create: `backend/services/erasure.py` (manifest part)
- Create: `backend/tests/unit/test_erasure.py` (fake client + manifest tests)

**Interfaces:**
- Produces: `class ErasureError(Exception)`, `@dataclass ErasureManifest(subject_id: str, lecture_ids: list[str], pdf_upload_hashes: list[str], keys: dict[str, list[str]])` with `to_json() -> dict` and `ErasureManifest.from_json(d) -> ErasureManifest`, `BUCKETS = ("avatars", "lecture-pdfs", "lecture-posters", "worksheets")`, `_client(client)`, and `async build_erasure_manifest(uid: str, client=None) -> ErasureManifest`.

- [ ] **Step 1: Write the fake client and the failing tests**

```python
# backend/tests/unit/test_erasure.py
"""Erasure: an exact manifest first, a durable job, then deletion that is
retried rather than swallowed."""
import pytest

from backend.services import erasure as er

UID = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"


class _Res:
    def __init__(self, data):
        self.data = data


class FakeTable:
    def __init__(self, store, name):
        self.store, self.name, self.f, self.op, self.payload = store, name, [], "select", None

    def select(self, *_a, **_k):
        return self

    def eq(self, c, v):
        self.f.append(lambda r: r.get(c) == v)
        return self

    def in_(self, c, vs):
        self.f.append(lambda r: r.get(c) in vs)
        return self

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def update(self, patch):
        self.op, self.payload = "update", patch
        return self

    def delete(self):
        self.op = "delete"
        return self

    def execute(self):
        if self.name in self.store.fail_tables:
            raise RuntimeError(f"{self.name} unavailable")
        rows = self.store.tables.setdefault(self.name, [])
        hit = [r for r in rows if all(f(r) for f in self.f)]
        if self.op == "insert":
            row = {"id": f"job-{len(rows) + 1}", "attempts": 0, **self.payload}
            rows.append(row)
            return _Res([row])
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
            return _Res(hit)
        if self.op == "delete":
            self.store.tables[self.name] = [r for r in rows if r not in hit]
            return _Res(hit)
        return _Res([dict(r) for r in hit])


class FakeBucket:
    def __init__(self, store, name):
        self.store, self.name = store, name

    def list(self, path):
        if self.name in self.store.fail_list:
            raise RuntimeError("list failed")
        prefix = path.rstrip("/") + "/"
        return [{"name": k[len(prefix):]} for k in self.store.objects.get(self.name, [])
                if k.startswith(prefix) and "/" not in k[len(prefix):]]

    def remove(self, keys):
        if self.name in self.store.fail_remove:
            raise RuntimeError("remove failed")
        objs = self.store.objects.setdefault(self.name, [])
        self.store.objects[self.name] = [k for k in objs if k not in keys]
        self.store.removed.setdefault(self.name, []).extend(keys)
        return [{"name": k} for k in keys]


class FakeStorage:
    def __init__(self, store):
        self.store = store

    def from_(self, name):
        return FakeBucket(self.store, name)


class FakeAuthAdmin:
    def __init__(self, store):
        self.store = store

    def delete_user(self, uid):
        if self.store.fail_auth_delete:
            raise RuntimeError("auth down")
        self.store.auth_users.discard(uid)

    def get_user_by_id(self, uid):
        if uid not in self.store.auth_users:
            raise RuntimeError("User not found (404)")
        return {"id": uid}


class FakeClient:
    def __init__(self, tables=None, objects=None):
        self.tables = tables or {}
        self.objects = objects or {}
        self.removed: dict[str, list[str]] = {}
        self.fail_tables: set[str] = set()
        self.fail_list: set[str] = set()
        self.fail_remove: set[str] = set()
        self.fail_auth_delete = False
        self.auth_users = {UID, OTHER}
        self.storage = FakeStorage(self)
        self.auth = type("A", (), {"admin": FakeAuthAdmin(self)})()

    def table(self, name):
        return FakeTable(self, name)


def owner_world():
    return FakeClient(
        tables={
            "lectures": [
                {"id": "L1", "professor_id": UID, "pdf_hash": "h-own", "pdf_url": "lectures/L1/a.pdf"},
                {"id": "L2", "student_owner_id": UID, "pdf_hash": "h-shared",
                 "pdf_url": "https://x/storage/v1/object/public/lecture-pdfs/lectures/L2/b.pdf"},
                {"id": "L9", "professor_id": OTHER, "pdf_hash": "h-shared"},
            ],
            "worksheets": [{"lecture_id": "L1", "file_url": "w/ws1.pdf"}],
        },
        objects={
            "avatars": [f"{UID}/avatar-1.png", f"{OTHER}/avatar-2.png"],
            "lecture-pdfs": ["lectures/L1/a.pdf", "lectures/L2/b.pdf", "lectures/L9/c.pdf"],
            "lecture-posters": ["lectures/L1/poster.webp"],
            "pdf-uploads": ["h-own.pdf", "h-shared.pdf"],
            "worksheets": ["w/ws1.pdf"],
        },
    )


@pytest.mark.asyncio
async def test_manifest_lists_every_bucket_for_the_user_only():
    c = owner_world()
    m = await er.build_erasure_manifest(UID, client=c)
    assert sorted(m.lecture_ids) == ["L1", "L2"]
    assert m.keys["avatars"] == [f"{UID}/avatar-1.png"]
    assert sorted(m.keys["lecture-pdfs"]) == ["lectures/L1/a.pdf", "lectures/L2/b.pdf"]
    assert sorted(m.keys["lecture-posters"]) == ["lectures/L1/poster.webp", "lectures/L2/poster.webp"]
    assert m.keys["worksheets"] == ["w/ws1.pdf"]
    assert sorted(m.pdf_upload_hashes) == ["h-own", "h-shared"]


@pytest.mark.asyncio
async def test_manifest_is_all_or_nothing():
    c = owner_world()
    c.fail_list.add("avatars")
    with pytest.raises(er.ErasureError):
        await er.build_erasure_manifest(UID, client=c)


@pytest.mark.asyncio
async def test_manifest_round_trips_through_json():
    m = await er.build_erasure_manifest(UID, client=owner_world())
    assert er.ErasureManifest.from_json(m.to_json()) == m
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pytest backend/tests/unit/test_erasure.py -q`
Expected: FAIL (`backend.services.erasure` does not exist).

- [ ] **Step 3: Implement the manifest**

```python
# backend/services/erasure.py
"""Account erasure (GDPR Art. 17): manifest -> durable job -> auth delete -> execute.

Why this order (MILESTONE_2026_08 F2): deleting auth.users cascades the
`lectures` rows, the only map from a person to their storage files. So the
exact list of files is built FIRST (read-only, all-or-nothing) and stored in
`account_erasure_jobs` (no FK; it outlives the account). Only then is the
account deleted; the files are removed afterwards and, if that fails,
retried by the worker. Nothing is deleted while the account still exists,
so a failure cannot leave a half-deleted live account.

pdf-uploads is content-addressed and shared across users (`{pdf_hash}.pdf`);
a blob is removed only if no remaining lecture references its hash,
checked at execution time, after the person's own lectures have cascaded away.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi.concurrency import run_in_threadpool

from backend.core.database import supabase_admin

logger = logging.getLogger(__name__)

BUCKETS = ("avatars", "lecture-pdfs", "lecture-posters", "worksheets")
LECTURE_OWNER_COLUMNS = ("professor_id", "student_owner_id")
_PUBLIC_URL = re.compile(r"lecture-pdfs/(.+)$")


class ErasureError(Exception):
    """A step could not be completed; nothing irreversible happened in it."""


@dataclass
class ErasureManifest:
    subject_id: str
    lecture_ids: list[str] = field(default_factory=list)
    pdf_upload_hashes: list[str] = field(default_factory=list)
    keys: dict[str, list[str]] = field(default_factory=lambda: {b: [] for b in BUCKETS})

    def to_json(self) -> dict[str, Any]:
        return {
            "subject_id": self.subject_id,
            "lecture_ids": self.lecture_ids,
            "pdf_upload_hashes": self.pdf_upload_hashes,
            "keys": self.keys,
        }

    @classmethod
    def from_json(cls, d: dict[str, Any]) -> "ErasureManifest":
        return cls(
            subject_id=d["subject_id"],
            lecture_ids=list(d.get("lecture_ids", [])),
            pdf_upload_hashes=list(d.get("pdf_upload_hashes", [])),
            keys={b: list(d.get("keys", {}).get(b, [])) for b in BUCKETS},
        )


def _client(client):
    return client if client is not None else supabase_admin


def _rows(c, table: str, column: str, value, *, many: bool = False) -> list[dict[str, Any]]:
    q = c.table(table).select("*")
    q = q.in_(column, value) if many else q.eq(column, value)
    return q.execute().data or []


def _list_folder(c, bucket: str, folder: str) -> list[str]:
    entries = c.storage.from_(bucket).list(folder) or []
    return [f"{folder}/{e['name']}" for e in entries if e.get("name")]


async def build_erasure_manifest(uid: str, client=None) -> ErasureManifest:
    """Every file and derived row to remove for ``uid``. Read-only.

    Raises ErasureError if any listing fails: a partial manifest would
    silently orphan whatever it missed.
    """
    c = _client(client)

    def _build() -> ErasureManifest:
        m = ErasureManifest(subject_id=uid)
        lectures: dict[str, dict[str, Any]] = {}
        for col in LECTURE_OWNER_COLUMNS:
            for row in _rows(c, "lectures", col, uid):
                lectures[row["id"]] = row
        m.lecture_ids = sorted(lectures)
        m.pdf_upload_hashes = sorted({r["pdf_hash"] for r in lectures.values() if r.get("pdf_hash")})

        pdf_keys: set[str] = set()
        for lid, row in lectures.items():
            pdf_keys.update(_list_folder(c, "lecture-pdfs", f"lectures/{lid}"))
            raw = row.get("pdf_url") or ""
            match = _PUBLIC_URL.search(raw)
            if match or raw.startswith("lectures/"):
                pdf_keys.add(match.group(1) if match else raw)
        m.keys["lecture-pdfs"] = sorted(pdf_keys)
        m.keys["lecture-posters"] = [f"lectures/{lid}/poster.webp" for lid in m.lecture_ids]
        if m.lecture_ids:
            m.keys["worksheets"] = sorted(
                {r["file_url"] for r in _rows(c, "worksheets", "lecture_id", m.lecture_ids, many=True)
                 if r.get("file_url")}
            )
        m.keys["avatars"] = sorted(_list_folder(c, "avatars", uid))
        return m

    try:
        return await run_in_threadpool(_build)
    except Exception as e:
        raise ErasureError(f"could not build erasure manifest: {e}") from e
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pytest backend/tests/unit/test_erasure.py -q`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/erasure.py backend/tests/unit/test_erasure.py
git commit -m "feat(gdpr): erasure manifest — every bucket, built read-only and all-or-nothing"
```

---

### Task 5: Job store and executor (retry, never swallow)

**Files:**
- Modify: `backend/services/erasure.py` (append)
- Modify: `backend/tests/unit/test_erasure.py` (append)

**Interfaces:**
- Consumes: `ErasureManifest`, `ErasureError`, `_client`, `BUCKETS` (Task 4).
- Produces: `JOBS = "account_erasure_jobs"`, `MAX_ATTEMPTS = 12`, `async create_job(m: ErasureManifest, client=None) -> str`, `async mark_ready(job_id: str, client=None) -> None`, `async run_job(job_id: str, client=None) -> bool` (True = finished and row deleted; False = left pending with `last_error`), `async drain(client=None, limit: int = 20) -> dict[str, int]` with keys `finished`, `retrying`, `cancelled`.

- [ ] **Step 1: Append the failing tests**

```python
# append to backend/tests/unit/test_erasure.py

@pytest.mark.asyncio
async def test_job_runs_after_auth_delete_and_spares_shared_blobs():
    c = owner_world()
    m = await er.build_erasure_manifest(UID, client=c)
    job = await er.create_job(m, client=c)
    # Simulate the auth cascade: the person's lectures are gone, OTHER's stays.
    c.tables["lectures"] = [r for r in c.tables["lectures"] if r["id"] == "L9"]
    c.auth_users.discard(UID)
    await er.mark_ready(job, client=c)
    assert await er.run_job(job, client=c) is True
    assert c.objects["pdf-uploads"] == ["h-shared.pdf"]          # shared: kept
    assert c.objects["lecture-pdfs"] == ["lectures/L9/c.pdf"]    # other's: kept
    assert c.objects["avatars"] == [f"{OTHER}/avatar-2.png"]
    assert c.tables[er.JOBS] == []                                # done: row gone


@pytest.mark.asyncio
async def test_failed_delete_leaves_job_pending_with_error():
    c = owner_world()
    job = await er.create_job(await er.build_erasure_manifest(UID, client=c), client=c)
    c.auth_users.discard(UID)
    await er.mark_ready(job, client=c)
    c.fail_remove.add("avatars")
    assert await er.run_job(job, client=c) is False
    row = c.tables[er.JOBS][0]
    assert row["status"] == "pending" and row["attempts"] == 1
    assert "avatars" in row["last_error"]
    c.fail_remove.clear()
    assert await er.run_job(job, client=c) is True                # a retry finishes it


@pytest.mark.asyncio
async def test_run_job_refuses_while_account_still_exists():
    c = owner_world()
    job = await er.create_job(await er.build_erasure_manifest(UID, client=c), client=c)
    await er.mark_ready(job, client=c)                            # wrongly marked
    assert await er.run_job(job, client=c) is False
    assert "still exists" in c.tables[er.JOBS][0]["last_error"]
    assert c.removed == {}                                        # nothing deleted


@pytest.mark.asyncio
async def test_drain_resolves_awaiting_jobs_by_auth_state():
    c = owner_world()
    await er.create_job(await er.build_erasure_manifest(UID, client=c), client=c)
    await er.create_job(er.ErasureManifest(subject_id=OTHER), client=c)
    c.tables[er.JOBS][1]["created_at"] = "2000-01-01T00:00:00+00:00"   # auth delete never landed
    c.auth_users.discard(UID)
    c.tables["lectures"] = [r for r in c.tables["lectures"] if r["id"] == "L9"]
    out = await er.drain(client=c)
    assert out == {"finished": 1, "retrying": 0, "cancelled": 1}
    assert c.tables[er.JOBS] == []
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pytest backend/tests/unit/test_erasure.py -q`
Expected: 4 new failures (`create_job` is not defined).

- [ ] **Step 3: Implement the job store, the executor and the drain**

```python
# append to backend/services/erasure.py

JOBS = "account_erasure_jobs"
MAX_ATTEMPTS = 12
STALE_AWAITING = timedelta(hours=1)
_CHUNK = 100


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def create_job(m: ErasureManifest, client=None) -> str:
    c = _client(client)

    def _ins() -> str:
        row = {"subject_id": m.subject_id, "manifest": m.to_json(),
               "status": "awaiting_auth_delete", "created_at": _now(), "updated_at": _now()}
        return c.table(JOBS).insert(row).execute().data[0]["id"]

    try:
        return await run_in_threadpool(_ins)
    except Exception as e:
        raise ErasureError(f"could not record erasure job: {e}") from e


async def mark_ready(job_id: str, client=None) -> None:
    c = _client(client)
    await run_in_threadpool(
        lambda: c.table(JOBS).update({"status": "pending", "updated_at": _now()}).eq("id", job_id).execute()
    )


def _auth_user_exists(c, uid: str) -> bool | None:
    """True / False, or None when auth cannot answer."""
    try:
        c.auth.admin.get_user_by_id(uid)
        return True
    except Exception as e:
        return False if ("404" in str(e) or "not found" in str(e).lower()) else None


def _hash_still_referenced(c, pdf_hash: str) -> bool:
    return bool(c.table("lectures").select("id").eq("pdf_hash", pdf_hash).execute().data)


def _remove(c, bucket: str, keys: list[str]) -> None:
    for i in range(0, len(keys), _CHUNK):
        try:
            c.storage.from_(bucket).remove(keys[i:i + _CHUNK])
        except Exception as e:
            raise ErasureError(f"{bucket}: {e}") from e


def _execute(c, m: ErasureManifest) -> None:
    """Delete everything in the manifest. Raises on the first failure."""
    if _auth_user_exists(c, m.subject_id) is not False:
        raise ErasureError("account still exists (or auth unreachable); refusing to delete files")
    for bucket in BUCKETS:
        _remove(c, bucket, m.keys.get(bucket, []))
    _remove(c, "pdf-uploads",
            [f"{h}.pdf" for h in m.pdf_upload_hashes if not _hash_still_referenced(c, h)])
    if m.lecture_ids:
        c.table("slide_embeddings").delete().in_("lecture_id", m.lecture_ids).execute()
    for table in ("api_tokens", "course_access"):  # no FK: never cascaded
        try:
            c.table(table).delete().eq("user_id", m.subject_id).execute()
        except Exception as e:
            if "does not exist" not in str(e):     # absent outside production
                raise ErasureError(f"{table}: {e}") from e


async def run_job(job_id: str, client=None) -> bool:
    c = _client(client)

    def _run() -> bool:
        rows = c.table(JOBS).select("*").eq("id", job_id).execute().data
        if not rows:
            return True
        job = rows[0]
        try:
            _execute(c, ErasureManifest.from_json(job["manifest"]))
        except Exception as e:
            c.table(JOBS).update({
                "attempts": int(job.get("attempts") or 0) + 1,
                "last_error": str(e)[:500], "updated_at": _now(),
            }).eq("id", job_id).execute()
            logger.error("erasure job %s not finished: %s", job_id, e)
            return False
        c.table(JOBS).delete().eq("id", job_id).execute()
        return True

    return await run_in_threadpool(_run)


async def drain(client=None, limit: int = 20) -> dict[str, int]:
    """Finish what an endpoint call could not. Called by the worker cron."""
    c = _client(client)
    out = {"finished": 0, "retrying": 0, "cancelled": 0}
    rows = await run_in_threadpool(lambda: c.table(JOBS).select("*").execute().data or [])
    cutoff = (datetime.now(timezone.utc) - STALE_AWAITING).isoformat()
    for job in rows[:limit]:
        if job["status"] == "awaiting_auth_delete":
            exists = await run_in_threadpool(_auth_user_exists, c, job["subject_id"])
            if exists is True and job["created_at"] < cutoff:
                # The auth delete never happened: the person still has an account.
                await run_in_threadpool(lambda j=job: c.table(JOBS).delete().eq("id", j["id"]).execute())
                out["cancelled"] += 1
                continue
            if exists is not False:
                continue                              # too fresh, or auth unreachable
            await mark_ready(job["id"], client=c)
        if int(job.get("attempts") or 0) >= MAX_ATTEMPTS:
            logger.error("erasure job %s exceeded %s attempts; needs a person", job["id"], MAX_ATTEMPTS)
            continue
        out["finished" if await run_job(job["id"], client=c) else "retrying"] += 1
    return out
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pytest backend/tests/unit/test_erasure.py -q`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/erasure.py backend/tests/unit/test_erasure.py
git commit -m "feat(gdpr): erasure jobs — executed after the account is gone, retried, never swallowed"
```

---

### Task 6: The endpoint keeps the order

**Files:**
- Modify: `backend/api/v1/auth.py` (`delete_account_endpoint` and its imports; currently lines 100–150)
- Modify: `backend/tests/integration/test_auth_account_deletion.py` (replace `test_delete_account_proceeds_and_reports_when_storage_cleanup_errors` and `test_delete_account_invokes_admin_delete_with_caller_id`; keep the other tests)

**Interfaces:**
- Consumes: `build_erasure_manifest`, `create_job`, `mark_ready`, `run_job`, `ErasureError` (Tasks 4–5).
- Produces: the response `{"message": "Account deleted.", "files": "removed" | "finishing"}`. A `502` happens before anything irreversible when the manifest or the job cannot be written.

- [ ] **Step 1: Write the failing integration tests**

Read the file's existing fixtures first (`app`, `professor_user`) and copy how the existing tests build their test client and auth header; use exactly that in place of `client` and `headers` below.

```python
def _wire(monkeypatch, calls, *, manifest_fails=False, job_fails=False, auth_fails=False, run_ok=True):
    from backend.api.v1 import auth as auth_api
    from backend.services import erasure as er

    async def manifest(uid, client=None):
        calls.append("manifest")
        if manifest_fails:
            raise er.ErasureError("listing failed")
        return er.ErasureManifest(subject_id=uid)

    async def create(m, client=None):
        calls.append("job")
        if job_fails:
            raise er.ErasureError("insert failed")
        return "job-1"

    async def ready(job_id, client=None):
        calls.append("ready")

    async def run(job_id, client=None):
        calls.append("run")
        return run_ok

    def delete_user(uid):
        calls.append("auth_delete")
        if auth_fails:
            raise RuntimeError("auth down")

    monkeypatch.setattr(auth_api, "build_erasure_manifest", manifest)
    monkeypatch.setattr(auth_api, "create_erasure_job", create)
    monkeypatch.setattr(auth_api, "mark_erasure_job_ready", ready)
    monkeypatch.setattr(auth_api, "run_erasure_job", run)
    monkeypatch.setattr(auth_api.supabase_admin.auth.admin, "delete_user", delete_user)


def test_records_the_job_before_deleting_and_removes_files_after(client, headers, monkeypatch):
    calls = []
    _wire(monkeypatch, calls)
    resp = client.post("/api/v1/auth/delete-account", headers=headers)
    assert resp.status_code == 200
    assert calls == ["manifest", "job", "auth_delete", "ready", "run"]
    assert resp.json() == {"message": "Account deleted.", "files": "removed"}


def test_aborts_before_anything_when_the_manifest_fails(client, headers, monkeypatch):
    calls = []
    _wire(monkeypatch, calls, manifest_fails=True)
    resp = client.post("/api/v1/auth/delete-account", headers=headers)
    assert resp.status_code == 502
    assert calls == ["manifest"]           # the account and its files are untouched


def test_aborts_when_the_job_cannot_be_recorded(client, headers, monkeypatch):
    calls = []
    _wire(monkeypatch, calls, job_fails=True)
    resp = client.post("/api/v1/auth/delete-account", headers=headers)
    assert resp.status_code == 502
    assert "auth_delete" not in calls


def test_says_files_are_finishing_when_the_run_is_deferred(client, headers, monkeypatch):
    calls = []
    _wire(monkeypatch, calls, run_ok=False)
    resp = client.post("/api/v1/auth/delete-account", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["files"] == "finishing"


def test_502_when_auth_delete_fails_leaves_the_job_to_the_drain(client, headers, monkeypatch):
    calls = []
    _wire(monkeypatch, calls, auth_fails=True)
    resp = client.post("/api/v1/auth/delete-account", headers=headers)
    assert resp.status_code == 502
    assert "run" not in calls and "ready" not in calls
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pytest backend/tests/integration/test_auth_account_deletion.py -q`
Expected: FAIL (`auth` has no attribute `build_erasure_manifest`).

- [ ] **Step 3: Rewire the endpoint**

In `backend/api/v1/auth.py`, replace the `erase_user_storage_and_derived_data` import with:

```python
from backend.services.erasure import (
    ErasureError,
    build_erasure_manifest,
    create_job as create_erasure_job,
    mark_ready as mark_erasure_job_ready,
    run_job as run_erasure_job,
)
```

Replace the body of `delete_account_endpoint`, from `await invalidate_cached_token(...)` through the `return`, with:

```python
    await invalidate_cached_token(credentials.credentials)

    # 1–2. Know every file first, and write that down durably. Until the auth
    # row is gone nothing is deleted, so any failure here leaves the account
    # exactly as it was (MILESTONE_2026_08 F2).
    try:
        manifest = await build_erasure_manifest(uid)
        job_id = await create_erasure_job(manifest)
    except ErasureError as e:
        logger.error("Erasure could not be prepared for %s: %s", uid, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not delete the account right now. Nothing was changed; please try again.",
        )

    # 3. The account itself: Postgres cascades every row.
    try:
        await run_in_threadpool(supabase_admin.auth.admin.delete_user, uid)
    except Exception as e:
        # The job stays 'awaiting_auth_delete'. The worker drain cancels it if
        # the account really survived, or finishes it if the delete did land.
        logger.error("Account deletion failed for %s: %s", uid, e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not delete the account. Please contact support.",
        )

    # 4. The files. A failure is retried by the worker, never swallowed.
    await mark_erasure_job_ready(job_id)
    finished = await run_erasure_job(job_id)
    return {"message": "Account deleted.", "files": "removed" if finished else "finishing"}
```

Rewrite the endpoint docstring's second paragraph so it describes manifest → job → auth delete → files and names all five buckets (`avatars`, `lecture-pdfs`, `lecture-posters`, `pdf-uploads`, `worksheets`).

- [ ] **Step 4: Run them to verify they pass**

Run: `pytest backend/tests/integration/test_auth_account_deletion.py -q`
Expected: all pass (the 5 new tests plus the existing auth and export tests).

- [ ] **Step 5: Check the Settings page against the new response**

Run: `grep -n "storage_cleanup\|delete-account" src/pages/Settings*.tsx src/components/settings/*.tsx 2>/dev/null; npx vitest run src/__tests__/pages/SettingsGdpr.test.tsx`
Expected: 3 passed, and no code reads `storage_cleanup`. If something does, switch it to `files`. When `files === "finishing"`, show the toast "Your account is deleted. Your files are being removed." before signing out, and add a vitest case for that toast.

- [ ] **Step 6: Commit**

```bash
git add backend/api/v1/auth.py backend/tests/integration/test_auth_account_deletion.py
git commit -m "fix(gdpr): delete the account only once its files are written down; never 200 over a lost file"
```

---

### Task 7: Worker drain cron

**Files:**
- Modify: `backend/workers/arq_worker.py` (add the cron next to `run_nudge_engine_cron` in `_cron_jobs`)
- Create: `backend/tests/unit/test_erasure_cron.py`

**Interfaces:**
- Consumes: `erasure.drain` (Task 5).
- Produces: `async drain_erasure_jobs_cron(ctx) -> dict[str, int]`, registered every 10 minutes.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/unit/test_erasure_cron.py
import pytest

from backend.workers import arq_worker


def test_drain_cron_is_registered():
    names = {getattr(j.coroutine, "__name__", "") for j in arq_worker.WorkerSettings.cron_jobs}
    assert "drain_erasure_jobs_cron" in names


@pytest.mark.asyncio
async def test_drain_cron_delegates(monkeypatch):
    seen = {}

    async def fake_drain(client=None, limit=20):
        seen["called"] = True
        return {"finished": 0, "retrying": 0, "cancelled": 0}

    monkeypatch.setattr(arq_worker.erasure, "drain", fake_drain)
    assert await arq_worker.drain_erasure_jobs_cron({}) == {"finished": 0, "retrying": 0, "cancelled": 0}
    assert seen["called"]
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pytest backend/tests/unit/test_erasure_cron.py -q`
Expected: FAIL (`drain_erasure_jobs_cron` is not defined).

- [ ] **Step 3: Implement and register**

In `backend/workers/arq_worker.py`, add `from backend.services import erasure` next to the other service imports, then add:

```python
async def drain_erasure_jobs_cron(ctx) -> dict[str, int]:
    """Finish account erasures whose file deletes failed inline (GDPR F2)."""
    result = await erasure.drain()
    if any(result.values()):
        logger.info("erasure drain: %s", result)
    return result
```

Extend `_cron_jobs` with this entry, keeping the existing nudge entry:

```python
    cron(drain_erasure_jobs_cron, minute={0, 10, 20, 30, 40, 50}, unique=True),
```

- [ ] **Step 4: Run them to verify they pass, then the worker suite**

Run: `pytest backend/tests/unit/test_erasure_cron.py -q && pytest backend/tests/unit -k "arq or worker or erasure" -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/workers/arq_worker.py backend/tests/unit/test_erasure_cron.py
git commit -m "feat(worker): retry unfinished account erasures every ten minutes"
```

---

### Task 8: Docs, full gate and rollout runbook

**Files:**
- Modify: `docs/MILESTONE_2026_08.md` (F2 and F3 headings get "— resolved by this plan (2026-10-11 GDPR plan); see `docs/superpowers/plans/2026-10-11-gdpr-erasure-and-export.md`")
- Create: `docs/runbooks/gdpr-erasure-rollout.md`

- [ ] **Step 1: Write the runbook**

```markdown
# GDPR erasure rollout

1. Read-only coverage probe (expect "ok"):
   python -m backend.scripts.gdpr_coverage_probe "$DATABASE_URL"
2. Apply the migration BY HAND, one transaction, only after Abi's go-ahead:
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/20261013000000_account_erasure_jobs.sql
   Never `supabase db push`.
3. Verify: SELECT has_table_privilege('anon','public.account_erasure_jobs','SELECT');  -- f
4. Deploy the backend and the worker together (the worker must see the new cron).
5. End to end on production, with a throwaway account Abi creates (one avatar,
   one uploaded PDF): delete it in Settings, then confirm
   - the avatar's public URL no longer serves the image,
   - its lectures/{id}/ objects are gone from lecture-pdfs and lecture-posters,
   - SELECT count(*) FROM account_erasure_jobs;  -- 0 within 10 minutes.
6. Watch worker logs for "erasure job ... not finished" for 24 hours.
```

- [ ] **Step 2: Run the full gates**

Run: `pytest backend/tests/unit backend/tests/integration -q && pytest -m db backend/tests/db -q && npx tsc -p tsconfig.app.json --noEmit`
Expected: all green, except possibly the known clock-skew flake `test_parse_runs_stalled_sweep`, which passes when re-run alone.

- [ ] **Step 3: Commit**

```bash
git add docs/MILESTONE_2026_08.md docs/runbooks/gdpr-erasure-rollout.md
git commit -m "docs(gdpr): F2/F3 resolved; manual rollout runbook"
```

## Self-review

- **Spec coverage:**
  - F2's "swallows storage failures" → Tasks 5 and 6.
  - F2's "200 while files orphan" → Task 6 (`files: "finishing"`) and Task 7 (the retry).
  - F2's "live account with no PDFs" → Task 6 (nothing is deleted before the auth delete).
  - F2's untouched `avatars` and `lecture-pdfs` buckets → Task 4, which also covers `lecture-posters`, a bucket F2 missed.
  - F3's 14 missing tables → Task 1. Production shows 17: F3's list, plus `v4_rehearsal_attempts`, `tutor_sessions`/`tutor_messages`, `api_tokens` and `course_access`.
  - F3's `friend_requests` half → Task 1.
  - F3's "needs a test" → Task 2, with two layers because three tables exist only in production.
- **Types:**
  - `ErasureManifest`, `create_job` / `mark_ready` / `run_job` / `drain`, and the auth.py aliases (`create_erasure_job`, `mark_erasure_job_ready`, `run_erasure_job`) match across Tasks 4–7.
  - `uncovered` / `covered_columns` match across Tasks 1–2.
- **Out of scope, recorded:**
  - F4 (no test composes the real endpoint with real RLS).
  - The empty `slides` bucket.
  - `parse_receipts` from #84: once it lands, Task 2's guard names it if it links to a user.
  - `lecture-pdfs` is a **public** bucket, so any lecture PDF is fetchable by URL. That's a separate privacy and copyright decision, tracked in the deck plan.
