"""v4 reading progress against real Postgres: the rows the old reader writes."""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db

asyncpg = pytest.importorskip("asyncpg")


@pytest.fixture
def reading(pg_dsn, monkeypatch):
    import backend.services.v4_reading_service as svc

    class _Conn:
        async def __aenter__(self):
            self.c = await asyncpg.connect(pg_dsn)
            return self.c

        async def __aexit__(self, *exc):
            await self.c.close()

    async def _get():
        return _Conn()

    monkeypatch.setattr(svc, "get_db_connection", _get)
    return svc


async def test_reading_writes_progress_visits_streak_and_events(
    reading, db_conn, make_user, make_course, make_lecture, make_slide,
):
    tag = uuid.uuid4().hex[:6]
    prof = make_user(role="professor", email=f"p-{tag}@uni-marburg.de")
    student = make_user(email=f"s-{tag}@gmail.com")
    course = make_course(prof, title=f"DBS {tag}")
    lecture = make_lecture(prof, title="SQL")
    for n in (1, 2, 3):
        make_slide(lecture, slide_number=n)
    with db_conn.cursor() as cur:
        cur.execute("UPDATE lectures SET course_id = %s, total_slides = 3 WHERE id = %s", (str(course), str(lecture)))
        cur.execute("UPDATE profiles SET last_active_date = CURRENT_DATE - 1, current_streak = 4, best_streak = 4 "
                    "WHERE user_id = %s", (str(student),))

    uid = str(student)
    # A glance does not count as reading, but it is still a visit.
    assert await reading.record_reading(lecture, uid, 1, 0.5) == {"pagesRead": 0, "percentComplete": 0}
    assert await reading.record_reading(lecture, uid, 1, 12) == {"pagesRead": 1, "percentComplete": 33}
    assert (await reading.record_reading(lecture, uid, 1, 30))["pagesRead"] == 1  # counted once
    await reading.record_reading(lecture, uid, 2, 9)
    assert await reading.record_reading(lecture, uid, 3, 9) == {"pagesRead": 3, "percentComplete": 100}

    with db_conn.cursor() as cur:
        cur.execute("SELECT completed_slides, last_slide_viewed, completed_at IS NOT NULL "
                    "FROM student_progress WHERE user_id = %s AND lecture_id = %s", (uid, str(lecture)))
        assert cur.fetchone() == ([1, 2, 3], 3, True)
        cur.execute("SELECT count(*) FROM lecture_visits WHERE user_id = %s", (uid,))
        assert cur.fetchone() == (1,)  # throttled: one visit for the whole read
        cur.execute("SELECT visit_count FROM course_visits WHERE user_id = %s AND course_id = %s", (uid, str(course)))
        assert cur.fetchone() == (1,)
        cur.execute("SELECT current_streak, best_streak, last_active_date = CURRENT_DATE "
                    "FROM profiles WHERE user_id = %s", (uid,))
        assert cur.fetchone() == (5, 5, True)  # yesterday's 4-day run continues, once
        cur.execute("SELECT count(*), min(event_data->>'source') FROM learning_events "
                    "WHERE user_id = %s AND event_type = 'slide_view'", (uid,))
        assert cur.fetchone() == (4, "v4_reader")  # every counted page-leave; the glance is not one


async def test_a_page_past_the_end_is_refused(reading, make_user, make_lecture, db_conn):
    prof = make_user(role="professor")
    lecture = make_lecture(prof)
    with db_conn.cursor() as cur:
        cur.execute("UPDATE lectures SET total_slides = 2 WHERE id = %s", (str(lecture),))
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as err:
        await reading.record_reading(lecture, str(prof), 9, 10)
    assert err.value.status_code == 422
