"""A client cannot move its own events in time; the backend and seeds still can."""
from __future__ import annotations

import json
import uuid
from contextlib import contextmanager

import psycopg
import pytest

pytestmark = pytest.mark.db


@contextmanager
def as_user(cur, uid):
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', 'authenticated', false)")
    try:
        yield
    finally:
        cur.execute("RESET ROLE")
        cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
        cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def test_a_signed_in_member_cannot_back_date_an_event(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        with as_user(cur, uid):
            with pytest.raises(psycopg.errors.CheckViolation, match="created_at"):
                cur.execute(
                    "INSERT INTO public.learning_events (user_id, event_type, event_data, created_at) "
                    "VALUES (%s, 'slide_view', '{}'::jsonb, now() - interval '40 days')",
                    (str(uid),),
                )
            with pytest.raises(psycopg.errors.CheckViolation):
                cur.execute(
                    "INSERT INTO public.learning_events (user_id, event_type, event_data, created_at) "
                    "VALUES (%s, 'slide_view', '{}'::jsonb, now() + interval '40 days')",
                    (str(uid),),
                )
        cur.execute("SELECT count(*) FROM public.learning_events WHERE user_id = %s", (str(uid),))
        assert cur.fetchone()[0] == 0


def test_a_signed_in_member_who_sends_no_time_gets_now(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        with as_user(cur, uid):
            cur.execute(
                "INSERT INTO public.learning_events (user_id, event_type, event_data) "
                "VALUES (%s, 'slide_view', %s::jsonb)",
                (str(uid), json.dumps({"lectureId": str(uuid.uuid4())})),
            )
            # a time within the tolerance is also fine (client clock a little off)
            cur.execute(
                "INSERT INTO public.learning_events (user_id, event_type, event_data, created_at) "
                "VALUES (%s, 'slide_view', '{}'::jsonb, now() - interval '30 seconds')",
                (str(uid),),
            )
        cur.execute(
            "SELECT count(*) FROM public.learning_events "
            "WHERE user_id = %s AND abs(extract(epoch FROM created_at - now())) < 60", (str(uid),),
        )
        assert cur.fetchone()[0] == 2


def test_the_owner_role_keeps_the_time_it_gives(db_conn, make_user):
    # Seeds, retention tests and the backend's own connection are not `authenticated`.
    uid = make_user()
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.learning_events (user_id, event_type, event_data, created_at) "
            "VALUES (%s, 'slide_view', '{}'::jsonb, now() - interval '40 days')",
            (str(uid),),
        )
        cur.execute(
            "SELECT created_at < now() - interval '39 days' FROM public.learning_events WHERE user_id = %s",
            (str(uid),),
        )
        assert cur.fetchone()[0] is True


def test_the_trigger_is_on_the_parent_and_is_a_plain_invoker_function(db_conn):
    with db_conn.cursor() as cur:
        cur.execute(
            "SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.learning_events'::regclass AND NOT tgisinternal"
        )
        assert "learning_events_created_at_is_now" in {r[0] for r in cur.fetchall()}
        cur.execute(
            "SELECT prosecdef FROM pg_proc WHERE oid = 'public.learning_events_reject_moved_time()'::regprocedure"
        )
        assert cur.fetchone()[0] is False
