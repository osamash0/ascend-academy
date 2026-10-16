# backend/scripts/gdpr_coverage_probe.py
"""Is every column that links a row to a person covered by the GDPR export?

Runs read-only (BEGIN READ ONLY ... ROLLBACK). Exit 1 lists the gaps.
Run against production before every deploy that adds a table:

    python -m backend.scripts.gdpr_coverage_probe "$DATABASE_URL"

Must be run read-only against production before each deploy: tutor_sessions,
api_tokens and course_access exist only there, not in the migrated test DB.
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
  -- partitions are covered by their parent table (learning_events_y2026m10 ...)
  AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid = c.conrelid)
"""

# User-shaped columns with no FK at all: not cascaded, easy to forget.
NO_FK_USER_COLUMNS_SQL = """
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('user_id','student_id','owner_id','created_by','uploaded_by',
                      'author_id','professor_id','student_owner_id','requester_id','addressee_id')
  AND table_name NOT IN (SELECT viewname FROM pg_views WHERE schemaname = 'public')
  AND table_name NOT IN (SELECT matviewname FROM pg_matviews WHERE schemaname = 'public')
  AND table_name NOT IN (
    SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE c.relnamespace = 'public'::regnamespace)
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
    from backend.services.erasure import NO_FK_USER_TABLES

    # autocommit=True so OUR "BEGIN READ ONLY" opens the transaction: without
    # it psycopg has already begun a read-write one and the BEGIN is ignored.
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("BEGIN READ ONLY")
        try:
            cols = user_linked_columns(conn)
            gaps = uncovered(cols)
            with conn.cursor() as cur:
                cur.execute(NO_FK_USER_COLUMNS_SQL)
                unerased = sorted({t for t, c in cur.fetchall() if c == "user_id"} - set(NO_FK_USER_TABLES))
        finally:
            conn.execute("ROLLBACK")
    for t, c in gaps:
        print(f"NOT EXPORTED: {t}.{c}")
    for t in unerased:
        print(f"NOT ERASED: {t}.user_id has no FK and is not in erasure.NO_FK_USER_TABLES")
    bad = len(gaps) + len(unerased)
    print("ok" if not bad else f"{bad} gap(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
