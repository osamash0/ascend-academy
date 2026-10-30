"""DB-layer regression test for P5-1 event schema governance
(20260720000000_learning_events_schema_governance.sql).

Confirms the `event_type` CHECK constraint on `public.learning_events` is
actually present and enforced by Postgres — the backstop for writers that
don't go through backend/schemas/learning_events.py (e.g. the frontend's
direct-to-Supabase `logLearningEvent()`).

Gated behind the `db` marker (boots a real Postgres via testcontainers).
This same assertion was manually verified against a real local Homebrew
Postgres 18 scratch database during development (see PR description) since
Docker/testcontainers isn't available in every sandbox.
"""
from __future__ import annotations

import uuid

import psycopg
import pytest

pytestmark = pytest.mark.db


def _insert_event(cur, user_id, event_type, event_data="{}"):
    cur.execute(
        """
        INSERT INTO public.learning_events (user_id, event_type, event_data)
        VALUES (%s, %s, %s::jsonb)
        """,
        (str(user_id), event_type, event_data),
    )


def test_event_type_check_constraint_exists(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM pg_constraint WHERE conname = 'learning_events_event_type_check'"
        )
        assert cur.fetchone() is not None


def test_known_event_type_accepted(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        _insert_event(cur, uid, "slide_view", '{"lectureId": "L1"}')
        cur.execute(
            "SELECT event_type FROM public.learning_events WHERE user_id = %s", (str(uid),)
        )
        assert cur.fetchone()[0] == "slide_view"


def test_unknown_event_type_rejected_by_db(db_conn, make_user):
    uid = make_user()
    with pytest.raises(psycopg.errors.CheckViolation):
        with db_conn.cursor() as cur:
            _insert_event(cur, uid, "totally_made_up_event")


def test_checkpoint_attempt_accepted(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        _insert_event(cur, uid, "checkpoint_attempt", '{"lectureId": "L1", "page": 3}')
        cur.execute(
            "SELECT count(*) FROM public.learning_events WHERE user_id = %s AND event_type = 'checkpoint_attempt'",
            (str(uid),),
        )
        assert cur.fetchone()[0] == 1


# ── Professors do not read v4 reader questions verbatim ──────────────────────
# 20261027000000 re-declares "Professors view events for their enrolled
# students" with one extra condition: an `ai_tutor_query` whose
# event_data.source is 'v4_reader' is not returned. Spec §0: owners see v4
# questions only as themes over >= 5 askers, never verbatim.


def _as_user(cur, uid: uuid.UUID) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",))


def _reset_user(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def test_professor_jwt_cannot_read_v4_reader_questions_of_an_enrolled_member(
    db_conn, make_user, make_course, make_course_enrollment
):
    prof = make_user(role="professor")
    member = make_user()
    course = make_course(prof)
    make_course_enrollment(member, course)

    with db_conn.cursor() as cur:
        # Written as the superuser, the way the backend's asyncpg writer does.
        _insert_event(cur, member, "slide_view", '{"lectureId": "L1", "page": 2}')
        _insert_event(
            cur,
            member,
            "ai_tutor_query",
            '{"lectureId": "L1", "source": "v4_reader", "kind": "ask", '
            '"query": "why is the second derivative negative here"}',
        )
        # The legacy Ask has no `source` key: NULL must not hide it.
        _insert_event(cur, member, "ai_tutor_query", '{"lectureId": "L1", "query": "legacy"}')

        _as_user(cur, prof)
        try:
            cur.execute(
                "SELECT event_type, event_data->>'source' FROM public.learning_events "
                "WHERE user_id = %s",
                (str(member),),
            )
            seen = sorted(cur.fetchall(), key=lambda r: (r[0], r[1] or ""))
        finally:
            _reset_user(cur)

    assert ("slide_view", None) in seen, "the member's slide_view must stay readable"
    assert ("ai_tutor_query", None) in seen, "a legacy ai_tutor_query (no source) stays readable"
    assert ("ai_tutor_query", "v4_reader") not in seen, (
        "a professor JWT must not read a v4 reader question: " + repr(seen)
    )
