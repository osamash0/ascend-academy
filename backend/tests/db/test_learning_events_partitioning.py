"""
Real-Postgres tests for the P5-4 learning_events partitioning/retention
mechanism (docs/ROADMAP_10X_FOUNDATION.md §13).

Unlike the rest of backend/tests/db/, these connect to a LOCAL Postgres
server (via PG_TEST_DSN, default a local `p54_scratch` database created by
hand — see the migration's own header for the setup commands) instead of
spinning up a Docker testcontainer, since partitioning is a pure-SQL
mechanism with no RLS/auth surface worth exercising and the sandbox this
was authored in has no Docker daemon. Skips cleanly if psycopg or a
reachable Postgres isn't available, so it never blocks the default
`pytest -m "not db and not e2e"` run.

Covers the 3 mechanism guarantees from the P5-4 acceptance criteria:
  1. A row's created_at routes it into the correct monthly partition.
  2. Dropping an old partition is a partition-drop (DROP TABLE), not a
     row-by-row DELETE, and removes exactly the rows in that partition.
  3. A query spanning multiple partitions still aggregates correctly
     (partition pruning doesn't silently lose data).
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
BOOTSTRAP_SQL = Path(__file__).resolve().parent / "sql" / "00_bootstrap.sql"
PARTITION_MIGRATION = MIGRATIONS_DIR / "20260720120000_partition_learning_events.sql"

PG_TEST_DSN = os.environ.get("PG_TEST_DSN", "dbname=p54_scratch")


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
        "no reachable local Postgres at PG_TEST_DSN (default 'dbname=p54_scratch'); "
        "see this file's docstring to create the scratch DB",
        allow_module_level=True,
    )


@pytest.fixture(scope="module")
def conn() -> Iterator["psycopg.Connection"]:
    """
    A connection to the scratch DB. Assumes the caller already applied
    00_bootstrap.sql + every migration under supabase/migrations/ (in
    lexicographic order, including this branch's partition migration) —
    exactly what this task's validation step did via psql. We don't
    re-apply migrations here to keep this test fast and to avoid a second,
    slightly-different code path from the one that was actually validated
    end-to-end against Postgres.
    """
    with psycopg.connect(PG_TEST_DSN, autocommit=True) as c:
        yield c


@pytest.fixture(scope="module", autouse=True)
def require_partitioned_schema(conn):
    """Sanity check the scratch DB actually has the partitioned schema
    this test suite assumes, with a clear skip (not a confusing failure)
    if someone points PG_TEST_DSN at an unrelated database."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT partstrat FROM pg_partitioned_table pt "
            "JOIN pg_class c ON c.oid = pt.partrelid "
            "WHERE c.relname = 'learning_events'"
        )
        row = cur.fetchone()
    if not row:
        pytest.skip(
            "public.learning_events is not partitioned in this DB — "
            "apply 00_bootstrap.sql + supabase/migrations/*.sql (through "
            "20260720120000_partition_learning_events.sql) to PG_TEST_DSN first"
        )


@pytest.fixture
def test_user(conn) -> uuid.UUID:
    uid = uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO auth.users (id, email) VALUES (%s, %s)",
            (str(uid), f"p54-{uid}@test.local"),
        )
    yield uid
    with conn.cursor() as cur:
        cur.execute("DELETE FROM auth.users WHERE id = %s", (str(uid),))


def _partition_name_for(d: date) -> str:
    return f"learning_events_y{d.year:04d}_m{d.month:02d}"


def _insert_event(conn, user_id: uuid.UUID, created_at: str) -> uuid.UUID:
    eid = uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.learning_events (id, user_id, event_type, event_data, created_at)
            VALUES (%s, %s, 'slide_view', '{}'::jsonb, %s::timestamptz)
            """,
            (str(eid), str(user_id), created_at),
        )
    return eid


# ── 1. Insert routes to the correct partition ───────────────────────────────


def test_insert_routes_to_correct_monthly_partition(conn, test_user):
    # Within the migration's pre-seeded window (24 months back from apply
    # time), so a dedicated partition — not the default — must exist for it.
    eid = _insert_event(conn, test_user, "2025-03-15T10:00:00Z")
    expected_partition = _partition_name_for(date(2025, 3, 1))

    with conn.cursor() as cur:
        # tableoid::regclass resolves to the concrete PARTITION the row
        # physically lives in, not the "learning_events" parent name.
        cur.execute(
            "SELECT tableoid::regclass::text FROM public.learning_events WHERE id = %s",
            (str(eid),),
        )
        (actual_partition,) = cur.fetchone()

    assert actual_partition == expected_partition

    # Cleanup — delete via the parent (routes to the same partition).
    with conn.cursor() as cur:
        cur.execute("DELETE FROM public.learning_events WHERE id = %s", (str(eid),))


def test_insert_in_different_months_routes_to_different_partitions(conn, test_user):
    eid_jan = _insert_event(conn, test_user, "2025-01-10T00:00:00Z")
    eid_feb = _insert_event(conn, test_user, "2025-02-10T00:00:00Z")

    with conn.cursor() as cur:
        cur.execute(
            "SELECT id::text, tableoid::regclass::text FROM public.learning_events "
            "WHERE id = ANY(%s)",
            ([str(eid_jan), str(eid_feb)],),
        )
        rows = dict(cur.fetchall())

    assert rows[str(eid_jan)] == "learning_events_y2025_m01"
    assert rows[str(eid_feb)] == "learning_events_y2025_m02"

    with conn.cursor() as cur:
        cur.execute("DELETE FROM public.learning_events WHERE id = ANY(%s)", ([str(eid_jan), str(eid_feb)],))


# ── 2. Dropping an old partition is a DROP TABLE, removes exactly those rows ─


def test_retention_drop_removes_exactly_the_old_partition_rows(conn, test_user):
    # An event safely inside the pre-seeded retention window (recent)...
    recent_id = _insert_event(conn, test_user, "2026-06-15T00:00:00Z")
    # ...and one in a month old enough to be past a short retention window
    # we control for this test (36 months — well before 2024-07, the
    # earliest partition the migration pre-seeds).
    old_month = date(2024, 7, 1)
    old_partition = _partition_name_for(old_month)
    old_id = _insert_event(conn, test_user, "2024-07-10T00:00:00Z")

    with conn.cursor() as cur:
        # 1000 months retention: nothing old enough, nothing dropped (dry run).
        cur.execute(
            "SELECT partition_name, dropped FROM "
            "public.drop_learning_events_partitions_older_than(1000, true)"
        )
        assert cur.fetchall() == []

        # dry_run defaults to true: reports the partition but must NOT drop it.
        cur.execute(
            "SELECT partition_name, dropped FROM "
            "public.drop_learning_events_partitions_older_than(retention_months := 6)"
        )
        reported = cur.fetchall()
        assert (old_partition, False) in reported

        # The partition must still exist and still contain the row after a dry run.
        cur.execute("SELECT to_regclass(%s) IS NOT NULL", (f"public.{old_partition}",))
        assert cur.fetchone()[0] is True
        cur.execute("SELECT 1 FROM public.learning_events WHERE id = %s", (str(old_id),))
        assert cur.fetchone() is not None

        # Now actually drop it. This must be a partition DROP, not a row-by-row
        # DELETE — assert the mechanism directly: after the call, the child
        # partition's relation is gone (to_regclass -> NULL), which is only
        # possible via DROP TABLE. A DELETE would leave the (now-empty)
        # relation in place.
        cur.execute(
            "SELECT partition_name, dropped FROM "
            "public.drop_learning_events_partitions_older_than(retention_months := 6, dry_run := false)"
        )
        dropped_rows = cur.fetchall()
        assert (old_partition, True) in dropped_rows

        cur.execute("SELECT to_regclass(%s)", (f"public.{old_partition}",))
        (relid,) = cur.fetchone()
        assert relid is None, "partition table must be gone after a real (non-dry-run) drop"

        # The old row is gone...
        cur.execute("SELECT 1 FROM public.learning_events WHERE id = %s", (str(old_id),))
        assert cur.fetchone() is None

        # ...and exactly the old row — the recent row (different partition)
        # must be untouched.
        cur.execute("SELECT 1 FROM public.learning_events WHERE id = %s", (str(recent_id),))
        assert cur.fetchone() is not None

    # Recreate the dropped partition so later tests / re-runs in this
    # module-scoped connection aren't affected by this test's side effect.
    with conn.cursor() as cur:
        cur.execute(
            "SELECT public.create_learning_events_partition_for_month(%s::date)",
            (old_month,),
        )
        cur.execute("DELETE FROM public.learning_events WHERE id = %s", (str(recent_id),))


def test_default_partition_is_never_dropped_by_retention(conn, test_user):
    """The catch-all default partition can hold rows of any age; the
    retention function must exclude it by name pattern regardless of how
    far back retention_months reaches."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT partition_name FROM "
            "public.drop_learning_events_partitions_older_than(retention_months := 0, dry_run := true)"
        )
        reported = {r[0] for r in cur.fetchall()}
    assert "learning_events_default" not in reported


# ── 3. Cross-partition query returns correct aggregate (pruning doesn't lose data) ─


def test_cross_partition_aggregate_query_returns_correct_totals(conn, test_user):
    months = ["2025-03-15", "2025-04-15", "2025-05-15", "2025-06-15"]
    ids = [_insert_event(conn, test_user, f"{m}T12:00:00Z") for m in months]

    with conn.cursor() as cur:
        # Spans 4 distinct monthly partitions.
        cur.execute(
            """
            SELECT count(*) FROM public.learning_events
            WHERE user_id = %s
              AND created_at >= '2025-03-01T00:00:00Z'
              AND created_at < '2025-07-01T00:00:00Z'
            """,
            (str(test_user),),
        )
        (total,) = cur.fetchone()
        assert total == 4

        # Confirm the planner actually prunes to 4 partitions (not a full
        # scan of every partition) — this is the whole reason a range-spanning
        # query on a huge partitioned table stays cheap.
        cur.execute(
            """
            EXPLAIN (FORMAT TEXT)
            SELECT count(*) FROM public.learning_events
            WHERE created_at >= '2025-03-01T00:00:00Z'
              AND created_at < '2025-07-01T00:00:00Z'
            """
        )
        plan = "\n".join(r[0] for r in cur.fetchall())
        for excluded_month in ("y2024_m", "y2025_m01", "y2025_m02", "y2025_m07", "y2025_m08"):
            assert excluded_month not in plan, f"expected {excluded_month} to be pruned:\n{plan}"

    with conn.cursor() as cur:
        cur.execute("DELETE FROM public.learning_events WHERE id = ANY(%s)", ([str(i) for i in ids],))
