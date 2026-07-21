"""
learning_events retention job (Roadmap P5-4 — docs/ROADMAP_10X_FOUNDATION.md §13).

`learning_events` is time-partitioned monthly (see migration
20260721000000_learning_events_partitioning_retention.sql). This script is
the operational retention policy on top of that partitioning:

  1. List partitions whose entire date range ends more than
     LEARNING_EVENTS_RETENTION_DAYS days ago (via the
     `list_learning_events_partitions_older_than` SQL function).
  2. For each candidate, archive its rows into `learning_events_daily_rollup`
     (day/user/event_type/lecture counts — no raw event_data payload) via
     `archive_learning_events_partition_to_rollup`. This step is purely
     additive: it reads the partition and upserts rollup rows, never
     touching the source.
  3. Only if BOTH gates below are satisfied does it drop the now-archived
     partition. Otherwise it stops after archiving and reports what a real
     run would drop.

Two independent config gates, both required to delete anything:
  - LEARNING_EVENTS_RETENTION_DAYS (int, default 0): 0 disables the whole
    job — it exits immediately doing nothing. A positive value is the
    retention window in days.
  - LEARNING_EVENTS_RETENTION_EXECUTE (bool, default false): even with a
    window configured, dropping partitions requires this to be explicitly
    "1"/"true". Default is dry-run: partitions get archived into rollups but
    are NOT dropped, and the script prints exactly what it would have
    dropped.

This mirrors this repo's convention that even confirmed-safe-to-delete data
gets surfaced to a human for an explicit decision rather than executed
unilaterally — the "would drop" list is the thing a human reviews before
ever flipping LEARNING_EVENTS_RETENTION_EXECUTE on.

Usage:
    # Report only — safe to run any time, changes nothing:
    python -m backend.scripts.learning_events_retention --dry-run

    # Archive candidates into rollups (still does not drop anything),
    # honoring LEARNING_EVENTS_RETENTION_DAYS from the environment:
    python -m backend.scripts.learning_events_retention

    # Full run (archive + drop) — only does anything if
    # LEARNING_EVENTS_RETENTION_EXECUTE=1 is ALSO set in the environment:
    python -m backend.scripts.learning_events_retention --execute
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.core.config import settings
from backend.core.database import supabase_admin


def list_candidates(retention_days: int) -> list[dict]:
    res = supabase_admin.rpc(
        "list_learning_events_partitions_older_than", {"p_days": retention_days}
    ).execute()
    return res.data or []


def archive_partition(partition_name: str) -> int:
    """Aggregate a partition's rows into the rollup table. Never deletes anything."""
    res = supabase_admin.rpc(
        "archive_learning_events_partition_to_rollup", {"p_partition": partition_name}
    ).execute()
    return int(res.data or 0)


def drop_partition(partition_name: str) -> None:
    """DESTRUCTIVE. Only called when --execute AND settings.learning_events_retention_execute."""
    supabase_admin.rpc(
        "drop_learning_events_partition", {"p_partition": partition_name}
    ).execute()


def run(*, dry_run: bool, force_execute: bool) -> int:
    retention_days = settings.learning_events_retention_days
    if retention_days <= 0:
        print(
            "learning_events retention is disabled "
            "(LEARNING_EVENTS_RETENTION_DAYS is 0). Nothing to do."
        )
        return 0

    candidates = list_candidates(retention_days)
    if not candidates:
        print(f"No learning_events partitions older than {retention_days} days. Nothing to do.")
        return 0

    execute = force_execute and settings.learning_events_retention_execute and not dry_run

    print(
        f"Retention window: {retention_days} days | "
        f"mode: {'EXECUTE (archive + drop)' if execute else 'dry-run/archive-only'}"
    )
    print(f"Candidates ({len(candidates)}):")
    for row in candidates:
        print(
            f"  {row['partition_name']}: "
            f"{row['range_start']}..{row['range_end']} "
            f"(~{row['approx_row_estimate']} rows)"
        )

    if dry_run:
        print("\n--dry-run: no rollups written, nothing archived or dropped.")
        return 0

    for row in candidates:
        name = row["partition_name"]
        archived = archive_partition(name)
        print(f"Archived {archived} rows from {name} into learning_events_daily_rollup.")

        if execute:
            drop_partition(name)
            print(f"Dropped partition {name}.")
        else:
            print(
                f"Would drop {name} here — not dropping "
                f"(set LEARNING_EVENTS_RETENTION_EXECUTE=1 and pass --execute to actually drop)."
            )

    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List candidates only; write nothing (no rollup archiving, no drops).",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help=(
            "Actually drop archived partitions. Still requires "
            "LEARNING_EVENTS_RETENTION_EXECUTE=1 in the environment as a second gate."
        ),
    )
    args = parser.parse_args()
    sys.exit(run(dry_run=args.dry_run, force_execute=args.execute))


if __name__ == "__main__":
    main()
