"""No SECURITY DEFINER function in `public` may be executable by `anon`.

Supabase's default privileges grant EXECUTE on every new public function
directly to `anon`, so `REVOKE ... FROM PUBLIC` alone does not lock a function
down. On 2026-10-11 prod had 42 SECURITY DEFINER functions anon could call,
two of which (add_xp_to_user(uuid, int), update_user_streak(uuid, bool)) let
anyone rewrite any user's XP and streak. 00_bootstrap.sql now mirrors that
default, so this test sees what prod sees.

Nothing in the app calls a SECURITY DEFINER RPC before sign-in (the catalog
lookups only run behind ProtectedRoute), so the allow-list starts empty. Add a
function here only with a comment saying which signed-out page needs it.
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.db

ANON_ALLOWED: set[str] = set()


def _anon_executable_definers(cur) -> set[str]:
    cur.execute(
        """
        SELECT p.oid::regprocedure::text
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef
          AND has_function_privilege('anon', p.oid, 'EXECUTE')
        """
    )
    return {row[0] for row in cur.fetchall()}


def test_bootstrap_mirrors_supabase_function_default_privileges(db_conn):
    """Guard the guard: if the bootstrap stops granting anon EXECUTE by
    default, the test below passes vacuously again."""
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) FROM pg_default_acl a
            JOIN pg_namespace n ON n.oid = a.defaclnamespace
            WHERE n.nspname = 'public' AND a.defaclobjtype = 'f'
              AND a.defaclacl::text LIKE '%anon=X%'
            """
        )
        assert cur.fetchone()[0] >= 1


def test_no_security_definer_function_is_anon_executable(db_conn):
    with db_conn.cursor() as cur:
        exposed = _anon_executable_definers(cur) - ANON_ALLOWED
    assert not exposed, (
        "SECURITY DEFINER functions executable by anon (REVOKE ... FROM anon, "
        "not just FROM PUBLIC):\n  " + "\n  ".join(sorted(exposed))
    )


@pytest.mark.parametrize(
    "signature",
    [
        # take a caller-supplied user id with no auth check
        "public.add_xp_to_user(uuid, integer)",
        "public.update_user_streak(uuid, boolean)",
        "public._grant_badge(uuid, text)",
        # retention maintenance, service_role only
        "public.ensure_learning_events_partition(date)",
        "public.list_learning_events_partitions_older_than(integer)",
        "public.archive_learning_events_partition_to_rollup(text)",
        "public.drop_learning_events_partition(text)",
    ],
)
def test_internal_functions_are_not_client_callable(db_conn, signature):
    """Signed-in users must not reach these either."""
    with db_conn.cursor() as cur:
        cur.execute("SELECT to_regprocedure(%s)", (signature,))
        if cur.fetchone()[0] is None:
            pytest.skip(f"{signature} not present in this migration set")
        for role in ("anon", "authenticated"):
            cur.execute("SELECT has_function_privilege(%s, %s, 'EXECUTE')", (role, signature))
            assert not cur.fetchone()[0], f"{role} can still execute {signature}"
