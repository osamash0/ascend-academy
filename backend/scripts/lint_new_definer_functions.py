#!/usr/bin/env python3
"""S-1 CI lint (docs/ROADMAP_10X_FOUNDATION.md §14 / P0-1): fail a PR that adds
a new `SECURITY DEFINER` function to `supabase/migrations/` without an
explicit `REVOKE`/`GRANT ... ON FUNCTION` statement for that same function
signature somewhere in the diff's new migration files.

Rationale: Postgres grants `EXECUTE` to `PUBLIC` by default on function
creation. Every `SECURITY DEFINER` function is therefore reachable over
PostgREST with the public anon key unless a migration explicitly says
otherwise. `reset_all_analytics`/`restore_analytics`/`increment_upload_quota`
(P0-1) and `friend_ids_of`/`relationship_status`/`mutual_friends_count`/
`mutual_courses_count`/`shared_catalog_courses_count`/`has_role`/
`assignment_owner_id`/`course_professor_id`/`lecture_visible_to_caller`
(S-1, this migration's siblings) all shipped this way. This script makes the
same mistake fail CI instead of shipping silently.

Usage:
    python backend/scripts/lint_new_definer_functions.py [migration_file ...]

With no arguments, lints every file under supabase/migrations/ (useful for a
full-repo audit) — but CI should invoke it with only the files new/changed
in the current PR (see .github/workflows/ci.yml's `migration-lint` job),
since a DEFINER function is allowed to get its REVOKE/GRANT in an EARLIER
migration (e.g. grant_xp gets it in 20260616000000 and is later
`CREATE OR REPLACE`d elsewhere without repeating the grant — Postgres
preserves the existing ACL across a same-signature `CREATE OR REPLACE`).
For a brand-new function, though, the grant decision must live in the same
file that introduces it — that's what this script actually enforces when
given a single new migration file, which is the CI use case.

Exits non-zero (and prints one line per offending function) if any new
`SECURITY DEFINER` function in the given file(s) has no
`REVOKE`/`GRANT ... ON FUNCTION` for the same name anywhere in the same
file.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

FUNC_DEF_RE = re.compile(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:public\.)?[a-zA-Z0-9_]+)\s*\(",
    re.IGNORECASE,
)
GRANT_RE = re.compile(
    r"(?:REVOKE|GRANT)\s+.*?\s+ON\s+FUNCTION\s+((?:public\.)?[a-zA-Z0-9_]+)\s*\(",
    re.IGNORECASE,
)
# Dynamic SQL guards (`EXECUTE 'REVOKE ALL ON FUNCTION ...'`, used when a
# migration conditionally revokes an overload that may not exist yet) also
# count — the literal REVOKE/GRANT text still appears in the file.


def _function_name(raw: str) -> str:
    return raw.split(".")[-1].lower()


def find_unguarded_definers(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")

    defined: set[str] = set()
    for m in FUNC_DEF_RE.finditer(text):
        # Only count it if the body (next ~3000 chars, generous for a
        # multi-line signature + declare block) actually says SECURITY
        # DEFINER, and that phrase isn't just appearing inside a comment
        # ahead of an INVOKER function (best-effort heuristic; a false
        # negative here just means a human still reviews it manually).
        window = text[m.start() : m.start() + 3000]
        body_only = re.sub(r"--[^\n]*", "", window)  # strip line comments
        if re.search(r"SECURITY\s+DEFINER", body_only[:2000]):
            defined.add(_function_name(m.group(1)))

    granted: set[str] = {_function_name(m.group(1)) for m in GRANT_RE.finditer(text)}

    return sorted(defined - granted)


def main(argv: list[str]) -> int:
    if argv:
        files = [Path(p) for p in argv]
    else:
        repo_root = Path(__file__).resolve().parents[2]
        files = sorted((repo_root / "supabase" / "migrations").glob("*.sql"))

    failed = False
    for f in files:
        if not f.exists() or f.suffix != ".sql":
            continue
        offenders = find_unguarded_definers(f)
        if offenders:
            failed = True
            for name in offenders:
                print(
                    f"{f}: SECURITY DEFINER function `{name}` has no "
                    "REVOKE/GRANT ON FUNCTION in this file. Postgres grants "
                    "EXECUTE to PUBLIC by default — add an explicit "
                    "REVOKE ALL ... FROM PUBIC, anon[, authenticated] and a "
                    "GRANT EXECUTE ... TO <intended role> (see "
                    "docs/RPC_EXPOSURE_AUDIT.md for the pattern), or "
                    "document in this file why PUBLIC-execute is intentional."
                )
    if failed:
        return 1
    print(f"OK — {len(files)} migration file(s) checked, no unguarded SECURITY DEFINER functions found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
