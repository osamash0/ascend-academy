"""A learning event clears only a real Lesson's cache: never a Space's views, whatever lectureId it claims."""
from __future__ import annotations

import json
import uuid

import pytest

pytestmark = pytest.mark.db


def _cached(cur, key, view):
    cur.execute(
        "INSERT INTO public.analytics_cache (lecture_id, view_name, params_hash, payload) VALUES (%s, %s, %s, '{}'::jsonb)",
        (str(key), view, uuid.uuid4().hex[:8]),
    )


def _event(cur, user, lecture_id):
    cur.execute(
        "INSERT INTO public.learning_events (user_id, event_type, event_data) VALUES (%s, 'slide_view', %s::jsonb)",
        (str(user), json.dumps({"lectureId": str(lecture_id), "page": 1, "duration_seconds": 30,
                                "sessionId": str(user), "timestamp": "x"})),
    )


def _rows(cur, key):
    cur.execute("SELECT count(*) FROM public.analytics_cache WHERE lecture_id = %s", (str(key),))
    return cur.fetchone()[0]


def test_an_event_naming_the_space_instead_of_a_lesson_clears_nothing(db_conn, make_user, make_course):
    tag = uuid.uuid4().hex[:6]
    member = make_user(email=f"m-{tag}@gmail.com")
    space = make_course(make_user(email=f"o-{tag}@gmail.com"), title=f"S {tag}")
    with db_conn.cursor() as cur:
        _cached(cur, space, "landing")
        _cached(cur, space, "themes")
        _event(cur, member, space)
        assert _rows(cur, space) == 2
        cur.execute("SELECT count(*) FROM public.analytics_cache_invalidation_debounce WHERE lecture_id = %s", (str(space),))
        assert cur.fetchone()[0] == 0


def test_an_event_on_a_real_lesson_still_clears_that_lessons_cache(db_conn, make_user, make_lecture):
    tag = uuid.uuid4().hex[:6]
    owner = make_user(email=f"o2-{tag}@gmail.com")
    lesson = make_lecture(owner, title="Normalization")
    with db_conn.cursor() as cur:
        _cached(cur, lesson, "insights")
        _event(cur, owner, lesson)
        assert _rows(cur, lesson) == 0


def test_the_trigger_function_stays_out_of_anons_reach(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT has_function_privilege('anon', 'public.invalidate_analytics_cache_on_event()', 'EXECUTE')")
        assert cur.fetchone()[0] is False
