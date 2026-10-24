"""v4 notes against real Postgres (migration 20261014010000): private,
anchored, and outliving their anchor."""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db

asyncpg = pytest.importorskip("asyncpg")


@pytest.fixture
def svc(pg_dsn, monkeypatch):
    import backend.services.v4_spaces_service as s

    class _Conn:
        async def __aenter__(self):
            self.c = await asyncpg.connect(pg_dsn)
            return self.c

        async def __aexit__(self, *exc):
            await self.c.close()

    async def _get():
        return _Conn()

    monkeypatch.setattr(s, "get_db_connection", _get)
    return s


async def test_notes_are_private_anchored_and_survive_their_lesson(
    svc, db_conn, make_user, make_course, make_lecture, make_course_enrollment,
):
    prof = make_user(role="professor")
    me = make_user(email=f"me-{uuid.uuid4().hex[:6]}@gmail.com")
    other = make_user(email=f"o-{uuid.uuid4().hex[:6]}@gmail.com")
    course = make_course(prof, title="Datenbanksysteme")
    lecture = make_lecture(prof, title="Normalization")
    closed = make_lecture(prof, title="Not yours")
    with db_conn.cursor() as cur:
        cur.execute("UPDATE lectures SET course_id = %s WHERE id = %s", (str(course), str(lecture)))
    make_course_enrollment(me, course)

    note = await svc.add_note(str(me), "  3NF: no transitive dependencies  ", str(lecture))
    assert (note["body"], note["lessonTitle"], note["spaceName"]) == (
        "3NF: no transitive dependencies", "Normalization", "Datenbanksysteme",
    )
    loose = await svc.add_note(str(me), "Exam on the 14th", None)
    assert (loose["lessonId"], loose["lessonTitle"], loose["spaceId"]) == ("", "", "")

    with pytest.raises(LookupError):  # a Lesson you cannot open takes no note
        await svc.add_note(str(me), "sneaky", str(closed))

    # Someone else can neither edit nor delete it.
    assert await svc.update_note(str(other), note["id"], "mine now") is None
    assert await svc.delete_note(str(other), note["id"]) is False
    edited = await svc.update_note(str(me), note["id"], "3NF and BCNF")
    assert edited["body"] == "3NF and BCNF"

    # The Lesson is deleted; the note keeps its writing and its names.
    with db_conn.cursor() as cur:
        cur.execute("DELETE FROM lectures WHERE id = %s", (str(lecture),))
    async with await svc.get_db_connection() as conn:
        mine = await svc.notes_for(conn, str(me))
        theirs = await svc.notes_for(conn, str(other))
    kept = next(n for n in mine if n["id"] == note["id"])
    assert (kept["body"], kept["lessonId"], kept["lessonTitle"]) == ("3NF and BCNF", "", "Normalization")
    assert theirs == []

    assert await svc.delete_note(str(me), loose["id"]) is True


@pytest.mark.parametrize("role", ["anon"])
def test_anon_cannot_read_notes(db_conn, role):
    with db_conn.cursor() as cur:
        cur.execute("SELECT has_table_privilege(%s, 'public.notes', 'SELECT')", (role,))
        assert cur.fetchone() == (False,)
