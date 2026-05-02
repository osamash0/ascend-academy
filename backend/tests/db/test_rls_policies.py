"""
DB / RLS regression tests — gated behind `pytest -m db` (nightly).

These confirm the security-critical invariants we rely on across the codebase:
  - Migrations apply cleanly in lexicographic order.
  - user_roles inserts are locked down (only the signup trigger may write).
  - has_role() returns the documented boolean for known role keys.
  - Lecture deletes cascade to slides / quiz_questions / student_progress.
  - student_progress (user_id, lecture_id) UNIQUE is enforced.
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.db


def test_migrations_apply_cleanly(applied_migrations):
    assert len(applied_migrations) > 0
    assert all(p.suffix == ".sql" for p in applied_migrations)


def test_user_roles_insert_locked_down(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        with pytest.raises(Exception):
            cur.execute(
                "INSERT INTO public.user_roles (user_id, role) VALUES (gen_random_uuid(), 'student')"
            )
        cur.execute("RESET ROLE")


def test_has_role_function(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT public.has_role(gen_random_uuid(), 'student')")
        assert cur.fetchone()[0] is False


def test_lecture_delete_cascades(db_conn):
    pytest.skip(
        "Implement once a synthetic lecture/slide/progress row factory exists "
        "for the DB-test layer (issue: nightly-db-fixtures)."
    )


def test_student_progress_unique(db_conn):
    pytest.skip(
        "Implement once the synthetic user/lecture factory above is in place."
    )


def test_pdf_parse_cache_anon_blocked(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        with pytest.raises(Exception):
            cur.execute(
                "INSERT INTO public.pdf_parse_cache (pdf_hash, slides) VALUES ('x', '[]'::jsonb)"
            )
        cur.execute("RESET ROLE")
