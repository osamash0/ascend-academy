# backend/tests/db/test_luna_sessions_rls.py
"""Luna sessions are their learner's alone: sessions, turns, memory, and the
practice cards made from them. Gated behind the `db` marker."""
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


def _seed(cur, owner: uuid.UUID, lecture_id: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    sid, card = uuid.uuid4(), uuid.uuid4()
    cur.execute(
        "INSERT INTO public.luna_sessions (id, user_id, space_id, lecture_id, plan) VALUES (%s, %s, %s, %s, %s::jsonb)",
        (str(sid), str(owner), str(owner), str(lecture_id), json.dumps([])),
    )
    cur.execute(
        "INSERT INTO public.luna_turns (session_id, user_id, client_turn_id, role, content) VALUES (%s, %s, %s, 'luna', %s::jsonb)",
        (str(sid), str(owner), str(uuid.uuid4()), json.dumps({"say": "hi"})),
    )
    cur.execute(
        "INSERT INTO public.learner_memory (user_id, kind, text) VALUES (%s, 'preference', 'examples before definitions')",
        (str(owner),),
    )
    cur.execute(
        """INSERT INTO public.review_cards (id, lecture_id, source_type, front, back, content_hash, owner_id)
           VALUES (%s, %s, 'luna_session', '{"question":"q"}'::jsonb, '{"correct":0}'::jsonb, %s, %s)""",
        (str(card), str(lecture_id), uuid.uuid4().hex, str(owner)),
    )
    return sid, card


def test_owner_reads_everything_and_nobody_else_reads_anything(db_conn, make_user, make_lecture):
    a, b, prof = make_user(), make_user(), make_user(role="professor")
    lecture = make_lecture(prof)
    with db_conn.cursor() as cur:
        sid, card = _seed(cur, a, lecture)

        _as_user(cur, a)
        cur.execute("SELECT count(*) FROM public.luna_sessions")
        assert cur.fetchone()[0] == 1
        cur.execute("SELECT count(*) FROM public.luna_turns")
        assert cur.fetchone()[0] == 1
        cur.execute("SELECT count(*) FROM public.learner_memory")
        assert cur.fetchone()[0] == 1
        cur.execute("SELECT count(*) FROM public.review_cards WHERE id = %s", (str(card),))
        assert cur.fetchone()[0] == 1
        _reset(cur)

        _as_user(cur, b)
        for table in ("luna_sessions", "luna_turns", "learner_memory"):
            cur.execute(f"SELECT count(*) FROM public.{table}")
            assert cur.fetchone()[0] == 0, table
        cur.execute("SELECT count(*) FROM public.review_cards WHERE id = %s", (str(card),))
        assert cur.fetchone()[0] == 0
        _reset(cur)


def test_owned_card_stays_hidden_from_students_enrolled_on_the_lecture(db_conn, make_user, make_lecture):
    a, b, prof = make_user(), make_user(), make_user(role="professor")
    lecture = make_lecture(prof)
    with db_conn.cursor() as cur:
        _, card = _seed(cur, a, lecture)
        aid = uuid.uuid4()
        cur.execute("INSERT INTO public.assignments (id, title, professor_id, due_at) VALUES (%s, 'A', %s, now())", (str(aid), str(prof)))
        cur.execute("INSERT INTO public.assignment_lectures (assignment_id, lecture_id) VALUES (%s, %s)", (str(aid), str(lecture)))
        cur.execute("INSERT INTO public.assignment_enrollments (assignment_id, user_id) VALUES (%s, %s)", (str(aid), str(b)))
        _as_user(cur, b)
        cur.execute("SELECT count(*) FROM public.review_cards WHERE id = %s", (str(card),))
        assert cur.fetchone()[0] == 0
        _reset(cur)


def test_learner_cannot_write_sessions_or_turns_directly(db_conn, make_user):
    a = make_user()
    with db_conn.cursor() as cur:
        _as_user(cur, a)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            cur.execute(
                "INSERT INTO public.luna_sessions (user_id, space_id, plan) VALUES (%s, %s, '[]'::jsonb)",
                (str(a), str(a)),
            )
    db_conn.rollback()


def test_anon_has_no_grant(db_conn):
    with db_conn.cursor() as cur:
        for table in ("luna_sessions", "luna_turns", "learner_memory"):
            cur.execute("SELECT has_table_privilege('anon', %s, 'SELECT')", (f"public.{table}",))
            assert cur.fetchone()[0] is False, table
