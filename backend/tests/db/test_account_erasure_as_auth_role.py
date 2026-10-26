"""LS-112: Supabase Auth's own delete works for an account that owns lessons.

Auth deletes a user as `supabase_auth_admin`, a role with no rights on the
public schema. The FK cascade runs as each table's owner, but AFTER triggers
on the cascaded rows fire as the role that issued the DELETE, so a trigger
function without SECURITY DEFINER that writes to a public table fails the
whole delete ("Database error deleting user"). Deleting as the superuser, as
the other erasure tests do, cannot see this.
"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db

AUTH_ROLE = "supabase_auth_admin"


@pytest.fixture
def as_auth(db_conn):
    """A role shaped like prod's supabase_auth_admin: may delete from auth, nothing in public."""
    with db_conn.cursor() as cur:
        cur.execute(
            f"""
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{AUTH_ROLE}') THEN
                CREATE ROLE {AUTH_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
              END IF;
            END $$;
            GRANT USAGE ON SCHEMA auth TO {AUTH_ROLE};
            GRANT SELECT, DELETE ON auth.users TO {AUTH_ROLE};
            """
        )
    return AUTH_ROLE


def test_auth_deletes_an_account_that_owns_a_lesson_with_slides_and_quiz(
    db_conn, as_auth, make_user, make_course, make_lecture, make_slide, make_quiz
):
    owner = make_user(email=f"maker-{uuid.uuid4().hex[:6]}@gmail.com")
    course = make_course(owner, title="Lerngruppe")
    lecture = make_lecture(owner, title="Intro")
    slide = make_slide(lecture)
    make_quiz(slide)
    with db_conn.cursor() as cur:
        cur.execute("UPDATE public.lectures SET course_id = %s WHERE id = %s", (str(course), str(lecture)))

    with db_conn.transaction(), db_conn.cursor() as cur:
        cur.execute(f"SET LOCAL ROLE {as_auth}")
        cur.execute("SET LOCAL search_path = auth")
        cur.execute("DELETE FROM auth.users WHERE id = %s", (str(owner),))

    with db_conn.cursor() as cur:
        for table, col, val in (
            ("auth.users", "id", owner),
            ("public.courses", "id", course),
            ("public.lectures", "id", lecture),
            ("public.slides", "lecture_id", lecture),
        ):
            cur.execute(f"SELECT count(*) FROM {table} WHERE {col} = %s", (str(val),))
            assert cur.fetchone()[0] == 0, table
