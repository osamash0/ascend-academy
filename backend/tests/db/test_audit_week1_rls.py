"""RLS regressions from the 2026-10 codebase audit (docs/audit/04-quality.md,
Part C F-2 / F-7 / F-8 and Part A §3).

Before migration 20261024000000_audit_week1_rls.sql:

  - storage.objects SELECT on ``lecture-pdfs`` was bucket-wide: any signed-in
    user could list and download every lecture PDF, including another
    student's private upload.
  - ``lecture_mind_maps`` SELECT was ``auth.uid() IS NOT NULL``: every
    signed-in user could read every map.
  - ``achievements`` still had a client INSERT policy, so a user could mint
    any badge for themselves.
  - ``add_xp_to_user(integer)`` (no callers) was still executable by
    ``authenticated``: a free self-award of XP.

Gated behind the ``db`` marker (real Postgres, migrations replayed).
"""
from __future__ import annotations

import uuid

import psycopg
import pytest

pytestmark = pytest.mark.db


def _as_user(cur, uid: uuid.UUID) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",))


def _reset_user(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def _private_lecture(cur, owner: uuid.UUID) -> uuid.UUID:
    lid = uuid.uuid4()
    cur.execute(
        """
        INSERT INTO public.lectures (id, title, professor_id, student_owner_id, visibility, total_slides)
        VALUES (%s, 'Private notes', NULL, %s, 'private_student', 1)
        """,
        (str(lid), str(owner)),
    )
    return lid


def _pdf_object(cur, lecture_id: uuid.UUID) -> uuid.UUID:
    cur.execute(
        "INSERT INTO storage.buckets (id, name, public) VALUES ('lecture-pdfs', 'lecture-pdfs', false) ON CONFLICT (id) DO NOTHING"
    )
    oid = uuid.uuid4()
    cur.execute(
        "INSERT INTO storage.objects (id, bucket_id, name) VALUES (%s, 'lecture-pdfs', %s)",
        (str(oid), f"lectures/{lecture_id}/deck.pdf"),
    )
    return oid


def _visible_pdf_names(cur, uid: uuid.UUID) -> set[str]:
    _as_user(cur, uid)
    try:
        cur.execute("SELECT name FROM storage.objects WHERE bucket_id = 'lecture-pdfs'")
        return {r[0] for r in cur.fetchall()}
    finally:
        _reset_user(cur)


# ── lecture-pdfs: SELECT follows lecture visibility ──────────────────────────


def test_other_student_cannot_see_a_private_uploads_pdf(db_conn, make_user):
    owner, other = make_user("student"), make_user("student")
    with db_conn.cursor() as cur:
        lid = _private_lecture(cur, owner)
        _pdf_object(cur, lid)
        assert f"lectures/{lid}/deck.pdf" not in _visible_pdf_names(cur, other)


def test_owner_still_sees_their_private_uploads_pdf(db_conn, make_user):
    owner = make_user("student")
    with db_conn.cursor() as cur:
        lid = _private_lecture(cur, owner)
        _pdf_object(cur, lid)
        assert f"lectures/{lid}/deck.pdf" in _visible_pdf_names(cur, owner)


def test_course_lecture_pdf_stays_visible_to_any_signed_in_user(db_conn, make_user, make_lecture):
    prof, student = make_user("professor"), make_user("student")
    lid = make_lecture(prof)
    with db_conn.cursor() as cur:
        _pdf_object(cur, lid)
        assert f"lectures/{lid}/deck.pdf" in _visible_pdf_names(cur, student)


# ── lecture_mind_maps: SELECT follows lecture visibility ─────────────────────


def test_other_student_cannot_read_mind_map_of_private_upload(db_conn, make_user):
    owner, other = make_user("student"), make_user("student")
    with db_conn.cursor() as cur:
        lid = _private_lecture(cur, owner)
        cur.execute(
            "INSERT INTO public.lecture_mind_maps (lecture_id, tree_data) VALUES (%s, '{}'::jsonb)",
            (str(lid),),
        )
        _as_user(cur, other)
        cur.execute("SELECT count(*) FROM public.lecture_mind_maps WHERE lecture_id = %s", (str(lid),))
        n = cur.fetchone()[0]
        _reset_user(cur)
        assert n == 0


def test_owner_reads_mind_map_of_own_private_upload(db_conn, make_user):
    owner = make_user("student")
    with db_conn.cursor() as cur:
        lid = _private_lecture(cur, owner)
        cur.execute(
            "INSERT INTO public.lecture_mind_maps (lecture_id, tree_data) VALUES (%s, '{}'::jsonb)",
            (str(lid),),
        )
        _as_user(cur, owner)
        cur.execute("SELECT count(*) FROM public.lecture_mind_maps WHERE lecture_id = %s", (str(lid),))
        n = cur.fetchone()[0]
        _reset_user(cur)
        assert n == 1


# ── achievements: no client-side minting ─────────────────────────────────────


def test_client_cannot_insert_its_own_achievement(db_conn, make_user):
    uid = make_user("student")
    with db_conn.cursor() as cur:
        _as_user(cur, uid)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(
                "INSERT INTO public.achievements (user_id, badge_name) VALUES (%s, 'Forged badge')",
                (str(uid),),
            )
        _reset_user(cur)


# ── add_xp_to_user(integer): no longer a free self-award ─────────────────────


def test_add_xp_to_user_is_not_callable_by_signed_in_users(db_conn, make_user):
    uid = make_user("student")
    with db_conn.cursor() as cur:
        _as_user(cur, uid)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute("SELECT public.add_xp_to_user(500)")
        _reset_user(cur)


def test_grant_xp_still_works_for_signed_in_users(db_conn, make_user):
    uid = make_user("student")
    with db_conn.cursor() as cur:
        _as_user(cur, uid)
        cur.execute("SELECT public.grant_xp(10, 'audit_test')")
        _reset_user(cur)
        cur.execute("SELECT total_xp FROM public.profiles WHERE user_id = %s", (str(uid),))
        assert cur.fetchone()[0] >= 10
