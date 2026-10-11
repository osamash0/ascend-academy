"""The erasure job table holds storage keys of a person being deleted: only
the service role may see it, and it must outlive the account."""
import pytest

pytestmark = pytest.mark.db


def test_table_exists_without_fk(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.account_erasure_jobs')")
        assert cur.fetchone()[0] is not None
        cur.execute(
            "SELECT count(*) FROM pg_constraint "
            "WHERE conrelid = 'public.account_erasure_jobs'::regclass AND contype = 'f'"
        )
        assert cur.fetchone()[0] == 0, "a FK would cascade the job away with the account"


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_no_client_role_can_touch_it(db_conn, role):
    with db_conn.cursor() as cur:
        for priv in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            cur.execute(
                "SELECT has_table_privilege(%s, 'public.account_erasure_jobs', %s)", (role, priv)
            )
            assert cur.fetchone()[0] is False, f"{role} has {priv}"


def test_rls_is_enabled(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.account_erasure_jobs'::regclass"
        )
        assert cur.fetchone()[0] is True
