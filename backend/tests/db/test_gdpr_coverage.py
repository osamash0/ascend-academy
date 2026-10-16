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


def test_every_no_fk_user_table_is_deleted_by_the_erasure_executor(db_conn):
    """The account delete cascades only FK'd tables; a user_id column without a
    FK must be named in erasure.NO_FK_USER_TABLES or it outlives the person.
    (api_tokens/course_access exist only in production: subset check.)"""
    from backend.scripts.gdpr_coverage_probe import NO_FK_USER_COLUMNS_SQL
    from backend.services.erasure import NO_FK_USER_TABLES

    with db_conn.cursor() as cur:
        cur.execute(NO_FK_USER_COLUMNS_SQL)
        rows = cur.fetchall()
    assert "learning_events_daily_rollup" in {t for t, _ in rows}, "query found nothing: wrong schema?"
    missing = sorted({t for t, c in rows if c == "user_id"} - set(NO_FK_USER_TABLES))
    assert missing == []
