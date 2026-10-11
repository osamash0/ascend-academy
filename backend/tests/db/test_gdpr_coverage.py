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
