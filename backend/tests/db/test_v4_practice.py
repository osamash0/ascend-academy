"""v4 practice on real quiz questions: graded on the server, XP once per question."""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db

asyncpg = pytest.importorskip("asyncpg")


@pytest.fixture
def practice(pg_dsn, monkeypatch):
    import backend.services.v4_practice_service as svc

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


async def test_questions_grading_events_and_xp(practice, db_conn, make_user, make_lecture, make_slide, make_quiz):
    prof = make_user(role="professor")
    student = make_user(email=f"s-{uuid.uuid4().hex[:6]}@gmail.com")
    lecture = make_lecture(prof)
    qid = make_quiz(make_slide(lecture, slide_number=4))  # options 1..4, correct index 3 → "4"
    with db_conn.cursor() as cur:
        cur.execute("UPDATE profiles SET total_xp = 95, current_level = 1 WHERE user_id = %s", (str(student),))

    [q] = await practice.questions_for(lecture)
    assert q["choices"] == ["1", "2", "3", "4"] and q["correctAnswer"] == "4"
    assert "page 4" in q["explanation"]  # none stored: say where the answer lives

    uid = str(student)
    wrong = await practice.answer(lecture, uid, uuid.UUID(q["id"]), "2")
    assert (wrong["correct"], wrong["xp"]) == (False, 0)
    right = await practice.answer(lecture, uid, uuid.UUID(q["id"]), "4")
    assert (right["correct"], right["xp"]) == (True, 10)
    again = await practice.answer(lecture, uid, uuid.UUID(q["id"]), "4")
    assert (again["correct"], again["xp"]) == (True, 0)  # still right, no second XP

    with db_conn.cursor() as cur:
        cur.execute("SELECT total_xp, current_level FROM profiles WHERE user_id = %s", (uid,))
        assert cur.fetchone() == (105, 2)  # crossed 100 → level 2, as grant_xp computes it
        cur.execute("SELECT count(*), count(*) FILTER (WHERE (event_data->>'correct')::boolean) "
                    "FROM learning_events WHERE user_id = %s AND event_type = 'quiz_attempt'", (uid,))
        assert cur.fetchone() == (3, 2)
        cur.execute("SELECT count(*) FROM xp_events WHERE user_id = %s AND dedupe_key = %s",
                    (uid, f"v4quiz:{qid}"))
        assert cur.fetchone() == (1,)


async def test_a_question_from_another_lecture_is_not_found(practice, make_user, make_lecture, make_slide, make_quiz):
    prof = make_user(role="professor")
    mine, other = make_lecture(prof), make_lecture(prof)
    qid = make_quiz(make_slide(other))
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as err:
        await practice.answer(mine, str(prof), qid, "4")
    assert err.value.status_code == 404
