"""
Real-Postgres tests for the P5-2 `mv_course_daily_activity` materialized
view (docs/ROADMAP_10X_FOUNDATION.md §13, OLTP/OLAP split, staged lift (a)).

Follows the same local-Postgres pattern as
backend/tests/db/test_learning_events_partitioning.py rather than the
Docker-testcontainer fixtures in backend/tests/db/conftest.py: connects to
a scratch DB via PG_TEST_DSN (default a local `p52_scratch` database) since
the sandbox this was authored in has no Docker daemon. Skips cleanly if
psycopg or a reachable Postgres isn't available, so it never blocks the
default `pytest -m "not db and not e2e"` run.

Setup (once):
    createdb p52_scratch
    psql -d p52_scratch -c "CREATE EXTENSION IF NOT EXISTS vector;"
    psql -d p52_scratch -f backend/tests/db/sql/00_bootstrap.sql
    for f in supabase/migrations/*.sql; do
      # apply every migration through 20260720000001_professor_overview_daily_activity_mv.sql
      psql -d p52_scratch -v ON_ERROR_STOP=1 -f "$f" || break
    done

Covers the P5-2 acceptance criteria for this migration's slice:
  1. The view correctly rolls up per-(course_id, day) tracked_event_count,
     active_user_ids and lecture_complete durations from learning_events —
     the numbers `_compute_professor_overview`'s use_mv branch reads must
     reconcile with the source events (bounded staleness, not wrong data).
  2. `REFRESH MATERIALIZED VIEW CONCURRENTLY` works (requires the unique
     index the migration creates) and picks up newly inserted events.
  3. The view is locked down from PostgREST roles (anon/authenticated) —
     it's an internal aggregate read only via the backend's asyncpg pool.
"""
from __future__ import annotations

import os
import uuid
from datetime import date
from pathlib import Path
from typing import Iterator

import pytest

try:
    import psycopg

    HAS_PSYCOPG = True
except ImportError:
    HAS_PSYCOPG = False

pytestmark = pytest.mark.db

REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
MV_MIGRATION = MIGRATIONS_DIR / "20260720000001_professor_overview_daily_activity_mv.sql"

PG_TEST_DSN = os.environ.get("PG_TEST_DSN", "dbname=p52_scratch")


def _pg_reachable() -> bool:
    if not HAS_PSYCOPG:
        return False
    try:
        with psycopg.connect(PG_TEST_DSN, connect_timeout=2) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return True
    except Exception:
        return False


HAS_LOCAL_PG = _pg_reachable()

if not HAS_LOCAL_PG:
    pytest.skip(
        "no reachable local Postgres at PG_TEST_DSN (default 'dbname=p52_scratch'); "
        "see this file's docstring to create the scratch DB",
        allow_module_level=True,
    )


@pytest.fixture(scope="module")
def conn() -> Iterator["psycopg.Connection"]:
    with psycopg.connect(PG_TEST_DSN, autocommit=True) as c:
        yield c


@pytest.fixture(scope="module", autouse=True)
def require_mv_schema(conn):
    """Clear skip (not a confusing failure) if PG_TEST_DSN points at a DB
    that doesn't have this migration applied yet."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM pg_matviews WHERE matviewname = 'mv_course_daily_activity'"
        )
        row = cur.fetchone()
    if not row:
        pytest.skip(
            "public.mv_course_daily_activity does not exist in this DB — "
            f"apply 00_bootstrap.sql + migrations through {MV_MIGRATION.name} to PG_TEST_DSN first"
        )


@pytest.fixture
def professor(conn) -> Iterator[uuid.UUID]:
    uid = uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO auth.users (id, email, raw_user_meta_data) "
            "VALUES (%s, %s, %s::jsonb)",
            (str(uid), f"p52-prof-{uid}@test.local", '{"role": "professor"}'),
        )
    yield uid
    with conn.cursor() as cur:
        cur.execute("DELETE FROM auth.users WHERE id = %s", (str(uid),))


@pytest.fixture
def student(conn) -> Iterator[uuid.UUID]:
    uid = uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO auth.users (id, email, raw_user_meta_data) "
            "VALUES (%s, %s, %s::jsonb)",
            (str(uid), f"p52-student-{uid}@test.local", '{"role": "student"}'),
        )
    yield uid
    with conn.cursor() as cur:
        cur.execute("DELETE FROM auth.users WHERE id = %s", (str(uid),))


@pytest.fixture
def course_and_lecture(conn, professor) -> Iterator[tuple[uuid.UUID, uuid.UUID]]:
    course_id = uuid.uuid4()
    lecture_id = uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.courses (id, title, professor_id) VALUES (%s, %s, %s)",
            (str(course_id), "P5-2 test course", str(professor)),
        )
        cur.execute(
            "INSERT INTO public.lectures (id, title, professor_id, course_id, total_slides) "
            "VALUES (%s, %s, %s, %s, %s)",
            (str(lecture_id), "P5-2 test lecture", str(professor), str(course_id), 10),
        )
    yield course_id, lecture_id
    with conn.cursor() as cur:
        cur.execute("DELETE FROM public.lectures WHERE id = %s", (str(lecture_id),))
        cur.execute("DELETE FROM public.courses WHERE id = %s", (str(course_id),))


def _insert_event(conn, user_id, lecture_id, event_type, event_data, created_at):
    eid = uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.learning_events (id, user_id, event_type, event_data, created_at)
            VALUES (%s, %s, %s, %s::jsonb, %s::timestamptz)
            """,
            (str(eid), str(user_id), event_type, event_data, created_at),
        )
    return eid


def _refresh(conn):
    with conn.cursor() as cur:
        cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_course_daily_activity")


# ── 1. Rollup correctness ────────────────────────────────────────────────────


def test_rollup_counts_tracked_events_and_distinct_users_per_day(
    conn, course_and_lecture, student
):
    course_id, lecture_id = course_and_lecture
    student2 = uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (%s, %s, %s::jsonb)",
            (str(student2), f"p52-student2-{student2}@test.local", '{"role": "student"}'),
        )

    day = "2026-07-15"
    lid_json = '{"lectureId": "%s"}' % str(lecture_id)
    ids = [
        _insert_event(conn, student, lecture_id, "slide_view", lid_json, f"{day}T09:00:00Z"),
        _insert_event(conn, student2, lecture_id, "quiz_attempt", lid_json, f"{day}T10:00:00Z"),
        # Untracked event type — must not count toward tracked_event_count.
        _insert_event(conn, student, lecture_id, "some_other_event", lid_json, f"{day}T11:00:00Z"),
    ]

    _refresh(conn)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT tracked_event_count, distinct_active_users, active_user_ids "
                "FROM public.mv_course_daily_activity "
                "WHERE course_id = %s AND activity_day = %s",
                (str(course_id), day),
            )
            row = cur.fetchone()

        assert row is not None
        tracked_event_count, distinct_active_users, active_user_ids = row
        assert tracked_event_count == 2  # slide_view + quiz_attempt, not the untracked one
        assert distinct_active_users == 2
        assert {str(u) for u in active_user_ids} == {str(student), str(student2)}
    finally:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM public.learning_events WHERE id = ANY(%s)",
                ([str(i) for i in ids],),
            )
            cur.execute("DELETE FROM auth.users WHERE id = %s", (str(student2),))
        _refresh(conn)


def test_rollup_captures_lecture_complete_durations(conn, course_and_lecture, student):
    course_id, lecture_id = course_and_lecture
    day = "2026-07-16"
    lid_json_120 = '{"lectureId": "%s", "total_duration_seconds": 120}' % str(lecture_id)
    lid_json_300 = '{"lectureId": "%s", "total_duration_seconds": 300}' % str(lecture_id)
    ids = [
        _insert_event(conn, student, lecture_id, "lecture_complete", lid_json_120, f"{day}T09:00:00Z"),
        _insert_event(conn, student, lecture_id, "lecture_complete", lid_json_300, f"{day}T10:00:00Z"),
    ]

    _refresh(conn)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT lecture_complete_durations_seconds "
                "FROM public.mv_course_daily_activity "
                "WHERE course_id = %s AND activity_day = %s",
                (str(course_id), day),
            )
            (durations,) = cur.fetchone()
        assert sorted(float(d) for d in durations) == [120.0, 300.0]
    finally:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM public.learning_events WHERE id = ANY(%s)",
                ([str(i) for i in ids],),
            )
        _refresh(conn)


# ── 2. REFRESH CONCURRENTLY mechanics ───────────────────────────────────────


def test_refresh_concurrently_picks_up_new_events(conn, course_and_lecture, student):
    """REFRESH MATERIALIZED VIEW CONCURRENTLY requires a unique index —
    the migration creates uq_mv_course_daily_activity_course_day for
    exactly this. If that index were missing, this REFRESH statement
    itself would raise, so this test doubles as a check that the index
    exists and is usable."""
    course_id, lecture_id = course_and_lecture
    day = "2026-07-17"
    lid_json = '{"lectureId": "%s"}' % str(lecture_id)

    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) FROM public.mv_course_daily_activity "
            "WHERE course_id = %s AND activity_day = %s",
            (str(course_id), day),
        )
        (before,) = cur.fetchone()
    assert before == 0

    eid = _insert_event(conn, student, lecture_id, "slide_view", lid_json, f"{day}T09:00:00Z")
    _refresh(conn)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT tracked_event_count FROM public.mv_course_daily_activity "
                "WHERE course_id = %s AND activity_day = %s",
                (str(course_id), day),
            )
            (after,) = cur.fetchone()
        assert after == 1
    finally:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM public.learning_events WHERE id = %s", (str(eid),))
        _refresh(conn)


def test_unique_index_required_for_concurrent_refresh_exists(conn):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT indexdef FROM pg_indexes "
            "WHERE tablename = 'mv_course_daily_activity' "
            "AND indexname = 'uq_mv_course_daily_activity_course_day'"
        )
        row = cur.fetchone()
    assert row is not None
    assert "UNIQUE" in row[0].upper()


# ── 3. Access control ────────────────────────────────────────────────────────


def test_mv_is_revoked_from_anon_and_authenticated(conn):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT grantee, privilege_type FROM information_schema.role_table_grants "
            "WHERE table_name = 'mv_course_daily_activity' "
            "AND grantee IN ('anon', 'authenticated', 'PUBLIC')"
        )
        rows = cur.fetchall()
    assert rows == [], f"expected no PostgREST-role grants on the MV, found: {rows}"
