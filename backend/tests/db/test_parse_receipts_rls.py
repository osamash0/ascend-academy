"""RLS boundary for public.parse_receipts (Arc 5).

A parse receipt is a professor-facing QA artifact (deck skeleton, per-slide
route/prompt provenance, deck-quiz grounding summary). Only the lecture's
owner -- the course professor, or the student owner of a private upload --
may read it. Enrolled students get nothing (they already see the slides
themselves), anon gets a hard permission error (Supabase's default
privileges grant anon SELECT on every new public table directly, so the
migration must REVOKE from anon explicitly), and writes are service-role
only (the parse worker).
"""
from __future__ import annotations

import json
import uuid

import psycopg
import pytest

pytestmark = pytest.mark.db


def _as_user(cur, uid: uuid.UUID) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",))


def _reset(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def _make_run(cur, lecture_id: uuid.UUID) -> uuid.UUID:
    run_id = uuid.uuid4()
    cur.execute(
        "INSERT INTO public.parse_runs (run_id, pdf_hash, lecture_id, pipeline_version, status) "
        "VALUES (%s, %s, %s, '5', 'completed')",
        (str(run_id), f"hash-{run_id.hex}", str(lecture_id)),
    )
    return run_id


def _receipt_values(run_id: uuid.UUID, lecture_id: uuid.UUID) -> tuple:
    return (
        str(run_id),
        str(lecture_id),
        json.dumps({"boilerplate": [], "sections": [],
                    "slides": [{"index": 0, "role": "title", "section": 0, "chars": 5}]}),
        json.dumps([{"index": 0, "route": "batch"}]),
        json.dumps({"proposed": 1, "kept": 1, "repaired": 0, "dropped": 0, "drop_reasons": {}}),
    )


_INSERT = (
    "INSERT INTO public.parse_receipts "
    "(run_id, lecture_id, deck_skeleton, slide_provenance, quiz_grounding) "
    "VALUES (%s, %s, %s::jsonb, %s::jsonb, %s::jsonb)"
)


def _make_receipt(db_conn, lecture_id: uuid.UUID) -> uuid.UUID:
    with db_conn.cursor() as cur:
        run_id = _make_run(cur, lecture_id)
        cur.execute(_INSERT, _receipt_values(run_id, lecture_id))
    return run_id


def _visible_runs(cur) -> set[str]:
    cur.execute("SELECT run_id FROM public.parse_receipts")
    return {str(r[0]) for r in cur.fetchall()}


def _make_private_lecture(db_conn, student_id: uuid.UUID) -> uuid.UUID:
    lid = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.lectures (id, title, professor_id, total_slides, visibility, student_owner_id) "
            "VALUES (%s, 'Private', NULL, 1, 'private_student', %s)",
            (str(lid), str(student_id)),
        )
    return lid


def _enroll_via_assignment(db_conn, professor_id, student_id, lecture_id) -> None:
    aid = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.assignments (id, professor_id, title, due_at) "
            "VALUES (%s, %s, 'A', now() + interval '7 days')",
            (str(aid), str(professor_id)),
        )
        cur.execute(
            "INSERT INTO public.assignment_lectures (assignment_id, lecture_id) VALUES (%s, %s)",
            (str(aid), str(lecture_id)),
        )
        cur.execute(
            "INSERT INTO public.assignment_enrollments (assignment_id, user_id) VALUES (%s, %s)",
            (str(aid), str(student_id)),
        )


def test_table_has_rls_enabled(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.parse_receipts'::regclass")
        assert cur.fetchone()[0] is True


def test_owner_professor_reads_own_receipt(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    run_id = _make_receipt(db_conn, make_lecture(prof))
    with db_conn.cursor() as cur:
        _as_user(cur, prof)
        try:
            visible = _visible_runs(cur)
        finally:
            _reset(cur)
    assert str(run_id) in visible


def test_other_professor_cannot_read_receipt(db_conn, make_user, make_lecture):
    owner = make_user(role="professor")
    other = make_user(role="professor")
    run_id = _make_receipt(db_conn, make_lecture(owner))
    with db_conn.cursor() as cur:
        _as_user(cur, other)
        try:
            visible = _visible_runs(cur)
        finally:
            _reset(cur)
    assert str(run_id) not in visible


def test_enrolled_student_sees_lecture_but_not_its_receipt(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    student = make_user(role="student")
    lecture = make_lecture(prof)
    _enroll_via_assignment(db_conn, prof, student, lecture)
    run_id = _make_receipt(db_conn, lecture)
    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            cur.execute("SELECT id FROM public.lectures WHERE id = %s", (str(lecture),))
            assert cur.fetchone() is not None, "fixture broken: enrolled student must see the lecture"
            visible = _visible_runs(cur)
        finally:
            _reset(cur)
    assert str(run_id) not in visible


def test_private_upload_owner_reads_own_receipt(db_conn, make_user):
    student = make_user(role="student")
    run_id = _make_receipt(db_conn, _make_private_lecture(db_conn, student))
    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            visible = _visible_runs(cur)
        finally:
            _reset(cur)
    assert str(run_id) in visible


def test_anon_cannot_select_receipts(db_conn, make_user, make_lecture):
    _make_receipt(db_conn, make_lecture(make_user(role="professor")))
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT run_id FROM public.parse_receipts")
        finally:
            cur.execute("RESET ROLE")


def test_owner_cannot_write_receipts_directly(db_conn, make_user, make_lecture):
    prof = make_user(role="professor")
    lecture = make_lecture(prof)
    with db_conn.cursor() as cur:
        run_id = _make_run(cur, lecture)
        _as_user(cur, prof)
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(_INSERT, _receipt_values(run_id, lecture))
        finally:
            _reset(cur)


def test_service_role_writes_receipts(db_conn, make_user, make_lecture):
    lecture = make_lecture(make_user(role="professor"))
    with db_conn.cursor() as cur:
        run_id = _make_run(cur, lecture)
        cur.execute("SET ROLE service_role")
        try:
            cur.execute(_INSERT, _receipt_values(run_id, lecture))
            cur.execute("SELECT slide_provenance FROM public.parse_receipts WHERE run_id = %s", (str(run_id),))
            assert cur.fetchone()[0] == [{"index": 0, "route": "batch"}]
        finally:
            cur.execute("RESET ROLE")


def test_slide_provenance_defaults_to_empty_array(db_conn, make_user, make_lecture):
    lecture = make_lecture(make_user(role="professor"))
    with db_conn.cursor() as cur:
        run_id = _make_run(cur, lecture)
        cur.execute(
            "INSERT INTO public.parse_receipts (run_id, lecture_id) VALUES (%s, %s) "
            "RETURNING slide_provenance, deck_skeleton, quiz_grounding",
            (str(run_id), str(lecture)),
        )
        assert cur.fetchone() == ([], None, None)


def test_deleting_lecture_cascades_its_receipt(db_conn, make_user, make_lecture):
    lecture = make_lecture(make_user(role="professor"))
    run_id = _make_receipt(db_conn, lecture)
    with db_conn.cursor() as cur:
        cur.execute("DELETE FROM public.lectures WHERE id = %s", (str(lecture),))
        cur.execute("SELECT count(*) FROM public.parse_receipts WHERE run_id = %s", (str(run_id),))
        assert cur.fetchone()[0] == 0
