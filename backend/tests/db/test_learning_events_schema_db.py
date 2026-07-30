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
