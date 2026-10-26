"""A forged card id must not activate someone else's Luna card (which /review/queue would then reveal)."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

import pytest

from backend.api.v1.review import ACTIVATE_IF_VISIBLE_SQL

pytestmark = pytest.mark.db


def _pg(sql: str) -> str:
    """asyncpg $N -> psycopg named %(pN)s (the SQL reuses $1, so positional %s would misorder)."""
    return re.sub(r"\$(\d+)", r"%(p\1)s", sql)


def test_grade_activation_only_for_shared_or_own_cards(db_conn, make_user, make_lecture):
    a, b, prof = make_user(), make_user(), make_user(role="professor")
    lecture = make_lecture(prof)
    card = uuid.uuid4()
    with db_conn.cursor() as cur:
        cur.execute(
            """INSERT INTO public.review_cards (id, lecture_id, source_type, front, back, content_hash, owner_id)
               VALUES (%s, %s, 'luna_session', '{}'::jsonb, '{}'::jsonb, %s, %s)""",
            (str(card), str(lecture), uuid.uuid4().hex, str(a)),
        )
        now = datetime.now(timezone.utc)
        cur.execute(_pg(ACTIVATE_IF_VISIBLE_SQL), {"p1": str(b), "p2": str(card), "p3": now})
        cur.execute("SELECT count(*) FROM public.review_schedule WHERE user_id = %s", (str(b),))
        assert cur.fetchone()[0] == 0
        cur.execute(_pg(ACTIVATE_IF_VISIBLE_SQL), {"p1": str(a), "p2": str(card), "p3": now})
        cur.execute("SELECT count(*) FROM public.review_schedule WHERE user_id = %s", (str(a),))
        assert cur.fetchone()[0] == 1


def _owned_card(cur, lecture, owner):
    card = uuid.uuid4()
    cur.execute(
        """INSERT INTO public.review_cards (id, lecture_id, source_type, front, back, content_hash, owner_id)
           VALUES (%s, %s, %s, '{}'::jsonb, '{}'::jsonb, %s, %s)""",
        (str(card), str(lecture), "luna_session" if owner else "quiz_question", uuid.uuid4().hex, str(owner) if owner else None),
    )
    return card


def test_suspend_only_for_shared_or_own_cards(db_conn, make_user, make_lecture):
    from backend.api.v1.review import SUSPEND_IF_VISIBLE_SQL

    a, b, prof = make_user(), make_user(), make_user(role="professor")
    lecture = make_lecture(prof)
    with db_conn.cursor() as cur:
        card = _owned_card(cur, lecture, a)
        cur.execute(_pg(SUSPEND_IF_VISIBLE_SQL), {"p1": str(b), "p2": str(card)})
        assert cur.rowcount == 0
        cur.execute(_pg(SUSPEND_IF_VISIBLE_SQL), {"p1": str(a), "p2": str(card)})
        assert cur.rowcount == 1
        cur.execute("SELECT suspended FROM public.review_schedule WHERE user_id = %s AND card_id = %s", (str(a), str(card)))
        assert cur.fetchone()[0] is True


def test_shared_card_still_activates_for_anyone(db_conn, make_user, make_lecture):
    b, prof = make_user(), make_user(role="professor")
    lecture = make_lecture(prof)
    with db_conn.cursor() as cur:
        card = _owned_card(cur, lecture, None)
        cur.execute(_pg(ACTIVATE_IF_VISIBLE_SQL), {"p1": str(b), "p2": str(card), "p3": datetime.now(timezone.utc)})
        assert cur.rowcount == 1


def test_hide_lookup_skips_owned_cards(db_conn, make_user, make_lecture):
    a, prof = make_user(), make_user(role="professor")
    lecture = make_lecture(prof)
    with db_conn.cursor() as cur:
        card = _owned_card(cur, lecture, a)
        cur.execute(
            "SELECT lecture_id FROM review_cards WHERE id = %s AND owner_id IS NULL", (str(card),)
        )
        assert cur.fetchone() is None
