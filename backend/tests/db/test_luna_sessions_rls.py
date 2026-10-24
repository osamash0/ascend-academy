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


def _enrol(cur, prof, lecture, student) -> None:
    aid = uuid.uuid4()
    cur.execute("INSERT INTO public.assignments (id, title, professor_id, due_at) VALUES (%s, 'A', %s, now())", (str(aid), str(prof)))
    cur.execute("INSERT INTO public.assignment_lectures (assignment_id, lecture_id) VALUES (%s, %s)", (str(aid), str(lecture)))
    cur.execute("INSERT INTO public.assignment_enrollments (assignment_id, user_id) VALUES (%s, %s)", (str(aid), str(student)))


def test_lectures_professor_cannot_read_or_touch_an_owned_card(db_conn, make_user, make_lecture):
    a, prof = make_user(), make_user(role="professor")
    lecture = make_lecture(prof)
    with db_conn.cursor() as cur:
        _, card = _seed(cur, a, lecture)
        _as_user(cur, prof)
        cur.execute("SELECT count(*) FROM public.review_cards WHERE id = %s", (str(card),))
        assert cur.fetchone()[0] == 0
        cur.execute("UPDATE public.review_cards SET hidden_at = now() WHERE id = %s", (str(card),))
        assert cur.rowcount == 0
        cur.execute("DELETE FROM public.review_cards WHERE id = %s", (str(card),))
        assert cur.rowcount == 0
        _reset(cur)


def test_lectures_student_owner_cannot_read_someone_elses_owned_card(db_conn, make_user):
    a, b = make_user(), make_user()
    lecture = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.lectures (id, title, professor_id, student_owner_id, visibility, total_slides) "
            "VALUES (%s, 'Private', NULL, %s, 'private_student', 1)",
            (str(lecture), str(b)),
        )
        _, card = _seed(cur, a, lecture)
        _as_user(cur, b)
        cur.execute("SELECT count(*) FROM public.review_cards WHERE id = %s", (str(card),))
        assert cur.fetchone()[0] == 0
        _reset(cur)


def test_hidden_shared_card_stays_hidden_from_enrolled_students(db_conn, make_user, make_lecture):
    b, prof = make_user(), make_user(role="professor")
    lecture = make_lecture(prof)
    card = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute(
            """INSERT INTO public.review_cards (id, lecture_id, source_type, front, back, content_hash)
               VALUES (%s, %s, 'quiz_question', '{"question":"q"}'::jsonb, '{"correct":0}'::jsonb, %s)""",
            (str(card), str(lecture), uuid.uuid4().hex),
        )
        _enrol(cur, prof, lecture, b)
        _as_user(cur, b)
        cur.execute("SELECT count(*) FROM public.review_cards WHERE id = %s", (str(card),))
        assert cur.fetchone()[0] == 1
        _reset(cur)
        cur.execute("UPDATE public.review_cards SET hidden_at = now() WHERE id = %s", (str(card),))
        _as_user(cur, b)
        cur.execute("SELECT count(*) FROM public.review_cards WHERE id = %s", (str(card),))
        assert cur.fetchone()[0] == 0
        _reset(cur)


def test_learner_cannot_insert_turns_or_memory_or_touch_anothers_memory(db_conn, make_user, make_lecture):
    a, b, prof = make_user(), make_user(), make_user(role="professor")
    lecture = make_lecture(prof)
    with db_conn.cursor() as cur:
        sid, _ = _seed(cur, a, lecture)
        _as_user(cur, b)
        cur.execute("UPDATE public.learner_memory SET text = 'x'")
        assert cur.rowcount == 0
        cur.execute("DELETE FROM public.learner_memory")
        assert cur.rowcount == 0
        _reset(cur)
    for sql, params in (
        ("INSERT INTO public.luna_turns (session_id, user_id, client_turn_id, role, content) VALUES (%s, %s, %s, 'learner', '{}'::jsonb)",
         (str(sid), str(b), str(uuid.uuid4()))),
        ("INSERT INTO public.learner_memory (user_id, kind, text) VALUES (%s, 'goal', 'x')", (str(b),)),
    ):
        with db_conn.cursor() as cur:
            _as_user(cur, b)
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(sql, params)
        db_conn.rollback()
        with db_conn.cursor() as cur:
            _reset(cur)


def test_learner_may_edit_only_the_text_of_their_memory(db_conn, make_user):
    a = make_user()
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.learner_memory (user_id, kind, text) VALUES (%s, 'goal', 'pass the exam')",
            (str(a),),
        )
        _as_user(cur, a)
        cur.execute("UPDATE public.learner_memory SET text = 'pass with a 2', updated_at = now()")
        assert cur.rowcount == 1
        _reset(cur)
    for col_sql in ("active = false", "kind = 'shaky'", "user_id = gen_random_uuid()"):
        with db_conn.cursor() as cur:
            _as_user(cur, a)
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(f"UPDATE public.learner_memory SET {col_sql}")
        db_conn.rollback()
        with db_conn.cursor() as cur:
            _reset(cur)


def test_migration_adds_lookup_indexes_and_a_validated_source_type_check(db_conn):
    with db_conn.cursor() as cur:
        for idx in ("luna_turns_user_idx", "learner_memory_source_session_idx"):
            cur.execute("SELECT to_regclass(%s)", (f"public.{idx}",))
            assert cur.fetchone()[0] is not None, idx
        cur.execute(
            "SELECT convalidated FROM pg_constraint WHERE conname = 'review_cards_source_type_check'"
        )
        assert cur.fetchone()[0] is True


def test_migration_is_one_transaction_and_safe_to_rerun(db_conn):
    from pathlib import Path

    path = Path(__file__).resolve().parents[3] / "supabase/migrations/20261025000000_luna_sessions.sql"
    sql = path.read_text()
    body = [ln for ln in sql.splitlines() if ln.strip() and not ln.lstrip().startswith("--")]
    assert body[0] == "BEGIN;" and body[-1] == "COMMIT;"
    with db_conn.cursor() as cur:
        cur.execute(sql)  # second application over the harness's first
        cur.execute("SELECT count(*) FROM pg_constraint WHERE conname = 'review_cards_source_type_check'")
        assert cur.fetchone()[0] == 1
