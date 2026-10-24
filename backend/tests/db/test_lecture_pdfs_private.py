"""lecture-pdfs must be private, readable by lesson visibility, writable by
the lesson's owner only.

Prod drifted from the migration history: 20260503000002 (make the bucket
private, scope writes) was never applied there, so prod still had the
2026-02 state — bucket `public = true`, a "Public Access" SELECT policy for
role `public`, and "Professors can upload/update/delete PDFs" for ANY
professor on ANY object. On a fresh database that state is already gone, so
these tests first recreate it, then run the two repair migrations, then
assert the outcome. That is the only way the tests can prove the migrations
repair prod rather than merely re-asserting a fresh database.
"""
from __future__ import annotations

import uuid
from pathlib import Path

import psycopg
import pytest

pytestmark = pytest.mark.db

MIGRATIONS = Path(__file__).resolve().parents[3] / "supabase" / "migrations"
READS = MIGRATIONS / "20261024010000_lecture_pdfs_private_reads.sql"
WRITES = MIGRATIONS / "20261024020000_lecture_pdfs_owner_writes.sql"

# The 2026-02 policies, verbatim in effect, as found on prod on 2026-10-24.
PROD_DRIFT_SQL = """
INSERT INTO storage.buckets (id, name, public) VALUES ('lecture-pdfs', 'lecture-pdfs', true)
  ON CONFLICT (id) DO UPDATE SET public = true;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "Public Access" ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'lecture-pdfs');
DROP POLICY IF EXISTS "Professors can upload PDFs" ON storage.objects;
CREATE POLICY "Professors can upload PDFs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lecture-pdfs' AND (SELECT public.has_role(auth.uid(), 'professor')));
DROP POLICY IF EXISTS "Professors can update PDFs" ON storage.objects;
CREATE POLICY "Professors can update PDFs" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'lecture-pdfs' AND (SELECT public.has_role(auth.uid(), 'professor')));
DROP POLICY IF EXISTS "Professors can delete PDFs" ON storage.objects;
CREATE POLICY "Professors can delete PDFs" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'lecture-pdfs' AND (SELECT public.has_role(auth.uid(), 'professor')));
"""


def _as(cur, uid: uuid.UUID | None) -> None:
    if uid is None:
        cur.execute("SET ROLE anon")
        cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
        cur.execute("SELECT set_config('request.jwt.claim.role', 'anon', false)")
        return
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', 'authenticated', false)")


def _reset(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def _lecture(cur, *, professor=None, student_owner=None) -> uuid.UUID:
    lid = uuid.uuid4()
    visibility = "private_student" if student_owner else "course"
    cur.execute(
        """
        INSERT INTO public.lectures (id, title, professor_id, student_owner_id, visibility, total_slides)
        VALUES (%s, 'L', %s, %s, %s, 1)
        """,
        (str(lid), str(professor) if professor else None,
         str(student_owner) if student_owner else None, visibility),
    )
    return lid


def _object(cur, lid: uuid.UUID, name: str = "deck.pdf") -> str:
    key = f"lectures/{lid}/{name}"
    cur.execute("INSERT INTO storage.objects (bucket_id, name) VALUES ('lecture-pdfs', %s)", (key,))
    return key


def _visible(cur, uid) -> set[str]:
    _as(cur, uid)
    try:
        cur.execute("SELECT name FROM storage.objects WHERE bucket_id = 'lecture-pdfs'")
        return {r[0] for r in cur.fetchall()}
    finally:
        _reset(cur)


@pytest.fixture
def drifted(db_conn):
    """Recreate prod's state, run both repair migrations, hand back a cursor."""
    with db_conn.cursor() as cur:
        # Real Supabase grants anon table privileges on storage.objects and
        # leaves the gate to RLS; the test bootstrap does not, so mirror it
        # here or the anon test would pass on a missing grant, not a policy.
        cur.execute("GRANT SELECT ON storage.objects TO anon")
        cur.execute(PROD_DRIFT_SQL)
        cur.execute(READS.read_text())
        cur.execute(WRITES.read_text())
        yield cur


# ── reads ─────────────────────────────────────────────────────────────────────


def test_bucket_is_private_after_repair(drifted):
    drifted.execute("SELECT public FROM storage.buckets WHERE id = 'lecture-pdfs'")
    assert drifted.fetchone() == (False,)


def test_anonymous_callers_see_no_lecture_pdfs(drifted, make_user):
    prof = make_user("professor")
    _object(drifted, _lecture(drifted, professor=prof))
    assert _visible(drifted, None) == set()


def test_private_upload_is_hidden_from_other_signed_in_users(drifted, make_user):
    owner, stranger = make_user("student"), make_user("student")
    key = _object(drifted, _lecture(drifted, student_owner=owner))
    assert key not in _visible(drifted, stranger)
    assert key in _visible(drifted, owner)


def test_course_lecture_pdf_stays_readable_when_signed_in(drifted, make_user):
    prof, student = make_user("professor"), make_user("student")
    key = _object(drifted, _lecture(drifted, professor=prof))
    assert key in _visible(drifted, student)


# ── writes ────────────────────────────────────────────────────────────────────


def test_professor_cannot_overwrite_another_professors_pdf(drifted, make_user):
    owner, other = make_user("professor"), make_user("professor")
    key = _object(drifted, _lecture(drifted, professor=owner))
    _as(drifted, other)
    drifted.execute("UPDATE storage.objects SET metadata = '{\"x\":1}'::jsonb WHERE name = %s", (key,))
    assert drifted.rowcount == 0
    drifted.execute("DELETE FROM storage.objects WHERE name = %s", (key,))
    assert drifted.rowcount == 0
    _reset(drifted)


def test_professor_cannot_upload_into_another_professors_lecture(drifted, make_user):
    owner, other = make_user("professor"), make_user("professor")
    lid = _lecture(drifted, professor=owner)
    _as(drifted, other)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        drifted.execute(
            "INSERT INTO storage.objects (bucket_id, name) VALUES ('lecture-pdfs', %s)",
            (f"lectures/{lid}/intruder.pdf",),
        )
    _reset(drifted)


def test_professor_cannot_upload_for_a_lecture_that_does_not_exist(drifted, make_user):
    prof = make_user("professor")
    _as(drifted, prof)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        drifted.execute(
            "INSERT INTO storage.objects (bucket_id, name) VALUES ('lecture-pdfs', %s)",
            (f"lectures/{uuid.uuid4()}/squat.pdf",),
        )
    _reset(drifted)


def test_lecture_owner_can_upload_replace_and_delete(drifted, make_user):
    prof = make_user("professor")
    lid = _lecture(drifted, professor=prof)
    _as(drifted, prof)
    key = f"lectures/{lid}/deck.pdf"
    drifted.execute("INSERT INTO storage.objects (bucket_id, name) VALUES ('lecture-pdfs', %s)", (key,))
    drifted.execute("UPDATE storage.objects SET metadata = '{\"v\":2}'::jsonb WHERE name = %s", (key,))
    assert drifted.rowcount == 1
    drifted.execute("DELETE FROM storage.objects WHERE name = %s", (key,))
    assert drifted.rowcount == 1
    _reset(drifted)


def test_student_owner_can_upload_to_own_private_lecture(drifted, make_user):
    student = make_user("student")
    lid = _lecture(drifted, student_owner=student)
    _as(drifted, student)
    drifted.execute(
        "INSERT INTO storage.objects (bucket_id, name) VALUES ('lecture-pdfs', %s)",
        (f"lectures/{lid}/notes.pdf",),
    )
    _reset(drifted)


def test_malformed_key_is_refused_not_an_error(drifted, make_user):
    """A non-uuid second segment must make the policy false, not raise a cast error."""
    prof = make_user("professor")
    _as(drifted, prof)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        drifted.execute(
            "INSERT INTO storage.objects (bucket_id, name) VALUES ('lecture-pdfs', 'lectures/not-a-uuid/x.pdf')"
        )
    _reset(drifted)


def test_repair_migrations_leave_other_buckets_alone(drifted):
    drifted.execute(
        "SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' "
        "AND (coalesce(qual,'') || coalesce(with_check,'')) ILIKE '%avatars%'"
    )
    assert drifted.fetchone()[0] > 0
