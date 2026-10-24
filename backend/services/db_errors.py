# backend/services/db_errors.py
"""Classify PostgREST errors by their structured code, never by message text.

postgrest.exceptions.APIError carries the server's ``code`` as ``e.code``.
"""
from __future__ import annotations

# PGRST205: PostgREST cannot find the table in its schema cache.
# 42P01:    Postgres "undefined_table" (older PostgREST passes it through).
MISSING_TABLE_CODES = frozenset({"PGRST205", "42P01"})
# 42703: Postgres "undefined_column" (an unknown column in a filter).
MISSING_COLUMN_CODES = frozenset({"42703"})

# Tables whose user_id column depends on the environment. Only for these is a
# missing user_id column tolerated; everywhere else it is a real error.
#   tutor_messages: the migrations (20260503000008) give it user_id + lecture_id
#   and no session_id; production has session_id NOT NULL and NO user_id
#   (it cascades via tutor_sessions' FK instead). Verified read-only 2026-10-11.
USER_ID_OPTIONAL_TABLES = frozenset({"tutor_messages"})

# (table, column) pairs that arrive with a migration applied by hand, so an
# environment may not have them yet. Only these may be missing (42703).
#   review_cards.owner_id: added by 20261025000000_luna_sessions.sql.
OPTIONAL_COLUMNS = frozenset({("review_cards", "owner_id")})


def _code(e: BaseException) -> str | None:
    code = getattr(e, "code", None)
    return str(code) if code is not None else None


def is_missing_table(e: BaseException) -> bool:
    return _code(e) in MISSING_TABLE_CODES


def is_missing_column(e: BaseException) -> bool:
    return _code(e) in MISSING_COLUMN_CODES


def is_tolerable_absence(e: BaseException, table: str, column: str) -> bool:
    """A table absent in this environment, tutor_messages without user_id,
    or a column from OPTIONAL_COLUMNS not migrated here yet."""
    if is_missing_table(e):
        return True
    if not is_missing_column(e):
        return False
    return ((column == "user_id" and table in USER_ID_OPTIONAL_TABLES)
            or (table, column) in OPTIONAL_COLUMNS)
