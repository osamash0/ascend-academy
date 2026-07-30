#!/usr/bin/env python3
"""Fail if two migration files under supabase/migrations/ share a timestamp prefix.

Supabase applies migrations in filename-sorted order using the leading
`YYYYMMDDHHMMSS` timestamp as the ordering key. Two files with the same
timestamp prefix have an *undefined* relative order (whatever `sort` on
the deploying machine happens to produce), which is exactly how the
existing `20260503000008/19/20` collisions were created.

This check is intentionally forward-looking only: it flags *new*
collisions so the problem cannot grow, without renaming any of the
already-shipped, possibly-already-applied files (renaming a migration
that may already be applied in a live database is its own risky
operation and out of scope here).

Usage:
    python backend/scripts/check_migration_timestamps.py
    python backend/scripts/check_migration_timestamps.py --baseline 3

`--baseline N` allows exactly N pre-existing collision *groups* to pass
(used to grandfather in already-known collisions without silently
permitting new ones). Defaults to the currently known count.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent.parent / "supabase" / "migrations"

# Supabase/postgres migration filenames: <14-digit timestamp>_<description>.sql
TIMESTAMP_RE = re.compile(r"^(\d{14})_.+\.sql$")

# Known, already-shipped collisions as of the P4-4 migration-governance audit
# (2026-07-21). These exact filenames are grandfathered in — they are NOT
# renamed by this change (renaming a migration that may already be applied
# against a live database is a separate, higher-risk task, out of scope here).
# Any OTHER file that collides with an existing timestamp (whether one of
# these or a brand new one) fails the check.
KNOWN_BASELINE_COLLISION_FILENAMES = frozenset(
    {
        "20260503000008_parser_v3_schema.sql",
        "20260503000008_user_feedback.sql",
        "20260503000019_practice_sheets.sql",
        "20260503000019_quiz_questions_metadata.sql",
        "20260503000020_fix_assignments_rls_recursion.sql",
        "20260503000020_invalidate_course_overview_triggers.sql",
        "20260503000020_slides_ai_enhanced.sql",
    }
)


def find_collisions(migrations_dir: Path) -> dict[str, list[str]]:
    by_timestamp: dict[str, list[str]] = defaultdict(list)
    for path in sorted(migrations_dir.glob("*.sql")):
        match = TIMESTAMP_RE.match(path.name)
        if not match:
            # Not a timestamp-prefixed migration file (e.g. README) — ignore.
            continue
        by_timestamp[match.group(1)].append(path.name)

    return {ts: names for ts, names in by_timestamp.items() if len(names) > 1}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--migrations-dir",
        type=Path,
        default=MIGRATIONS_DIR,
        help="Path to supabase/migrations/ (default: %(default)s)",
    )
    args = parser.parse_args()

    if not args.migrations_dir.is_dir():
        print(f"ERROR: migrations dir not found: {args.migrations_dir}", file=sys.stderr)
        return 2

    collisions = find_collisions(args.migrations_dir)

    if not collisions:
        print("OK: no duplicate migration timestamps found.")
        return 0

    new_collisions: dict[str, list[str]] = {}
    grandfathered_only: dict[str, list[str]] = {}
    for ts, names in collisions.items():
        unknown = [n for n in names if n not in KNOWN_BASELINE_COLLISION_FILENAMES]
        if unknown:
            new_collisions[ts] = names
        else:
            grandfathered_only[ts] = names

    if grandfathered_only:
        print(f"Grandfathered (pre-existing, not re-checked) collisions:")
        for ts, names in sorted(grandfathered_only.items()):
            print(f"  {ts}: {', '.join(names)}")

    if not new_collisions:
        print(
            "\nOK: only known, grandfathered collisions present. "
            "No NEW timestamp collisions introduced."
        )
        return 0

    print("\nFAIL: new duplicate-timestamp migration filename(s) found:")
    for ts, names in sorted(new_collisions.items()):
        print(f"  {ts}:")
        for name in names:
            marker = " (grandfathered)" if name in KNOWN_BASELINE_COLLISION_FILENAMES else " (NEW)"
            print(f"    - {name}{marker}")
    print(
        "\nA new migration reuses an existing timestamp prefix, which gives it an "
        "undefined apply order relative to its sibling. Bump its timestamp to a "
        "value that doesn't collide with any existing migration file."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
