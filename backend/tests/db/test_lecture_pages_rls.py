"""RLS for lecture_pages (real-pages spec §4.1).

A page is readable exactly when its lecture is: the policy defers to the
lectures table's own RLS through an EXISTS subquery. Writes are service-role
only (the parse worker). anon gets nothing.
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


def _reset_user(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def _private_lecture(cur, owner: uuid.UUID) -> uuid.UUID:
    lid = uuid.uuid4()
    cur.execute(
        """
        INSERT INTO public.lectures (id, title, professor_id, student_owner_id, visibility, total_slides)
        VALUES (%s, 'Mine', NULL, %s, 'private_student', 1)
        """,
        (str(lid), str(owner)),
    )
    return lid


def _page(cur, lecture_id: uuid.UUID, page: int = 1) -> None:
    cur.execute(
        """
        INSERT INTO public.lecture_pages (lecture_id, page, width, height, image_path, geometry, blocks, summary)
        VALUES (%s, %s, 720, 405, %s, 'block', %s::jsonb, %s::jsonb)
        """,
        (
            str(lecture_id), page, f"lectures/{lecture_id}/p{page}.webp",
            json.dumps([{"id": f"p{page}-b0", "page": page, "bbox": [0.1, 0.1, 0.9, 0.2],
                         "kind": "heading", "text": "Title", "readingOrder": 0}]),
            json.dumps([{"markdown": "A **term**.", "covers": [f"p{page}-b0"]}]),
        ),
    )


def test_owner_reads_own_pages(db_conn, make_user):
    me = make_user(role="student")
    with db_conn.cursor() as cur:
        lid = _private_lecture(cur, me)
        _page(cur, lid)
        _as_user(cur, me)
        cur.execute("SELECT page, geometry, summary FROM lecture_pages WHERE lecture_id = %s", (str(lid),))
        rows = cur.fetchall()
        _reset_user(cur)
    assert rows == [(1, "block", [{"markdown": "A **term**.", "covers": ["p1-b0"]}])]


def test_another_learner_reads_nothing(db_conn, make_user):
    me = make_user(role="student")
    other = make_user(role="student")
    with db_conn.cursor() as cur:
        lid = _private_lecture(cur, me)
        _page(cur, lid)
        _as_user(cur, other)
        cur.execute("SELECT count(*) FROM lecture_pages WHERE lecture_id = %s", (str(lid),))
        (n,) = cur.fetchone()
        _reset_user(cur)
    assert n == 0


def test_authenticated_cannot_write(db_conn, make_user):
    me = make_user(role="student")
    with db_conn.cursor() as cur:
        lid = _private_lecture(cur, me)
        _as_user(cur, me)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            _page(cur, lid)
        _reset_user(cur)


def test_anon_is_denied(db_conn, make_user):
    me = make_user(role="student")
    with db_conn.cursor() as cur:
        lid = _private_lecture(cur, me)
        _page(cur, lid)
        cur.execute("SET ROLE anon")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute("SELECT count(*) FROM lecture_pages")
        cur.execute("RESET ROLE")


def test_pages_go_with_their_lecture(db_conn, make_user):
    me = make_user(role="student")
    with db_conn.cursor() as cur:
        lid = _private_lecture(cur, me)
        _page(cur, lid, 1)
        _page(cur, lid, 2)
        cur.execute("DELETE FROM lectures WHERE id = %s", (str(lid),))
        cur.execute("SELECT count(*) FROM lecture_pages WHERE lecture_id = %s", (str(lid),))
        (n,) = cur.fetchone()
    assert n == 0


def test_bucket_is_private(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT public FROM storage.buckets WHERE id = 'lecture-pages'")
        assert cur.fetchone() == (False,)
