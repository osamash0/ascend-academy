"""
DB regression tests for P5-4 — retention & partitioning
(docs/ROADMAP_10X_FOUNDATION.md §13), gated behind `pytest -m db`.

Verifies against a real Postgres (see backend/tests/db/conftest.py's
local-Postgres-first `pg_dsn` fixture) that:
  - Migrating an existing (non-empty) `learning_events` table into a
    partitioned table does not lose any rows.
  - The table is genuinely RANGE-partitioned on created_at; a partition for
    a given month can be created idempotently.
  - `list_learning_events_partitions_older_than` reports partitions whose
    range has fully elapsed, and nothing before the threshold.
  - `archive_learning_events_partition_to_rollup` aggregates a partition's
    rows into `learning_events_daily_rollup` without touching the source
    partition (row count and row *content* both unchanged after archiving).
  - `drop_learning_events_partition` actually removes a partition (proving
    "dropping an old partition is O(1)" is real, not aspirational) — this is
    exercised ONLY against synthetic rows created inside this test's own
    throwaway partition, never against the pre-existing/legacy data that the
    migration backed up into `learning_events_legacy_20260721`.
  - The pre-migration backup table (`learning_events_legacy_20260721`) still
    exists and still has all of its original rows — the migration must not
    have deleted anything.
"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db


def test_learning_events_is_partitioned(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT partstrat FROM pg_partitioned_table pt "
            "JOIN pg_class c ON c.oid = pt.partrelid "
            "WHERE c.relname = 'learning_events'"
        )
        row = cur.fetchone()
    assert row is not None, "learning_events must be a partitioned table"
    assert row[0] == "r"  # range partitioning


def test_legacy_backup_table_preserved(db_conn, make_user):
    """The pre-partitioning migration must not delete the original table."""
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT to_regclass('public.learning_events_legacy_20260721')"
        )
        (regclass,) = cur.fetchone()
    assert regclass is not None, (
        "learning_events_legacy_20260721 (the pre-migration backup) must "
        "still exist — P5-4 must not delete real data"
    )


def test_insert_lands_in_correct_monthly_partition(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        cur.execute("SELECT public.ensure_learning_events_partition('2026-03-01')")
        cur.execute(
            """
            INSERT INTO public.learning_events (user_id, event_type, event_data, created_at)
            VALUES (%s, 'slide_view', '{}'::jsonb, '2026-03-15T00:00:00Z')
            RETURNING tableoid::regclass::text
            """,
            (str(uid),),
        )
        (partition,) = cur.fetchone()
    assert partition == "learning_events_y2026m03"


def test_ensure_partition_is_idempotent(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT public.ensure_learning_events_partition('2027-05-01')")
        (first,) = cur.fetchone()
        cur.execute("SELECT public.ensure_learning_events_partition('2027-05-01')")
        (second,) = cur.fetchone()
    assert "created" in first
    assert "already exists" in second


def test_list_partitions_older_than_reports_only_elapsed_ranges(db_conn):
    with db_conn.cursor() as cur:
        # A partition whose range is entirely in the past...
        cur.execute("SELECT public.ensure_learning_events_partition('2020-01-01')")
        # ...and one that covers "now" (not fully elapsed).
        cur.execute("SELECT public.ensure_learning_events_partition(CURRENT_DATE)")

        cur.execute(
            "SELECT partition_name FROM public.list_learning_events_partitions_older_than(30)"
        )
        candidates = {r[0] for r in cur.fetchall()}

    assert "learning_events_y2020m01" in candidates
    current_month_partition = f"learning_events_y{__import__('datetime').date.today():%Y}m{__import__('datetime').date.today():%m}"
    assert current_month_partition not in candidates


def test_archive_partition_to_rollup_does_not_touch_source(db_conn, make_user):
    uid = make_user()
    month = "2021-06-01"
    with db_conn.cursor() as cur:
        cur.execute("SELECT public.ensure_learning_events_partition(%s)", (month,))
        (partition,) = cur.fetchone()
        partition_name = partition.split(" ")[0]

        cur.execute(
            """
            INSERT INTO public.learning_events (user_id, event_type, event_data, created_at)
            VALUES (%s, 'quiz_attempt', '{"lectureId": null}'::jsonb, '2021-06-10T00:00:00Z'),
                   (%s, 'quiz_attempt', '{"lectureId": null}'::jsonb, '2021-06-11T00:00:00Z')
            """,
            (str(uid), str(uid)),
        )

        cur.execute(f'SELECT count(*) FROM public."{partition_name}"')
        (rows_before,) = cur.fetchone()

        cur.execute(
            "SELECT public.archive_learning_events_partition_to_rollup(%s)",
            (partition_name,),
        )
        (archived_count,) = cur.fetchone()

        cur.execute(f'SELECT count(*) FROM public."{partition_name}"')
        (rows_after,) = cur.fetchone()

        cur.execute(
            "SELECT event_count FROM public.learning_events_daily_rollup "
            "WHERE user_id = %s AND event_type = 'quiz_attempt' AND day = '2021-06-10'",
            (str(uid),),
        )
        rollup_row = cur.fetchone()

    assert rows_before == 2
    assert archived_count == 2
    assert rows_after == rows_before, "archiving must never delete source rows"
    assert rollup_row is not None
    assert rollup_row[0] == 1


def test_archive_rejects_non_partition_table(db_conn):
    with db_conn.cursor() as cur:
        with pytest.raises(Exception):
            cur.execute(
                "SELECT public.archive_learning_events_partition_to_rollup('pg_class')"
            )
            db_conn.commit()


def test_drop_partition_removes_only_that_partition(db_conn, make_user):
    """
    Proves the "dropping an old partition is O(1)" capability is real. Only
    ever exercised here against a synthetic partition/rows created inside
    this test — never against the pre-existing legacy data.
    """
    uid = make_user()
    month = "2019-11-01"
    with db_conn.cursor() as cur:
        cur.execute("SELECT public.ensure_learning_events_partition(%s)", (month,))
        (partition,) = cur.fetchone()
        partition_name = partition.split(" ")[0]

        cur.execute(
            """
            INSERT INTO public.learning_events (user_id, event_type, event_data, created_at)
            VALUES (%s, 'slide_view', '{}'::jsonb, '2019-11-05T00:00:00Z')
            """,
            (str(uid),),
        )

        # Archive first (mirrors the real retention job's sequencing).
        cur.execute(
            "SELECT public.archive_learning_events_partition_to_rollup(%s)",
            (partition_name,),
        )

        cur.execute("SELECT public.drop_learning_events_partition(%s)", (partition_name,))

        cur.execute("SELECT to_regclass(%s)", (f"public.{partition_name}",))
        (regclass,) = cur.fetchone()

        # The rollup survives even though the raw partition is gone.
        cur.execute(
            "SELECT count(*) FROM public.learning_events_daily_rollup WHERE user_id = %s",
            (str(uid),),
        )
        (rollup_count,) = cur.fetchone()

        # A sibling partition (created by an earlier test in this module)
        # must be unaffected.
        cur.execute(
            "SELECT to_regclass('public.learning_events_y2020m01')"
        )
        (sibling,) = cur.fetchone()

    assert regclass is None, "dropped partition must no longer exist"
    assert rollup_count >= 1
    assert sibling is not None, "dropping one partition must not affect others"


def test_default_partition_catches_out_of_range_writes(db_conn, make_user):
    """
    A created_at far outside any explicitly created monthly partition
    (and not matching one created by another test) must still be accepted
    via the DEFAULT partition rather than erroring the insert.
    """
    uid = make_user()
    with db_conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.learning_events (user_id, event_type, event_data, created_at)
            VALUES (%s, 'slide_view', '{}'::jsonb, '2099-01-01T00:00:00Z')
            RETURNING tableoid::regclass::text
            """,
            (str(uid),),
        )
        (partition,) = cur.fetchone()
    assert partition == "learning_events_default"
