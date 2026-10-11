"""v4 world against real Postgres: courses read as Spaces, lectures as Lessons."""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db

asyncpg = pytest.importorskip("asyncpg")


@pytest.fixture
def pool_from(pg_dsn, monkeypatch):
    """Route get_db_connection at the throwaway database."""
    import backend.services.v4_spaces_service as svc

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


async def test_world_reads_courses_as_spaces_and_lectures_as_lessons(
    pool_from, db_conn, make_user, make_course, make_lecture, make_slide, make_quiz, make_course_enrollment,
):
    svc = pool_from
    tag = uuid.uuid4().hex[:6]
    prof = make_user(role="professor", email=f"prof-{tag}@uni-marburg.de")
    student = make_user(email=f"stud-{tag}@gmail.com")
    stranger = make_user(email=f"other-{tag}@gmail.com")

    joined = make_course(prof, title=f"Datenbanksysteme {tag}")
    open_course = make_course(prof, title=f"Kryptologie {tag}")
    hidden = make_course(prof, title=f"Draft {tag}")
    l1 = make_lecture(prof, title="Introduction")
    l2 = make_lecture(prof, title="SQL")
    l3 = make_lecture(prof, title="Ciphers")
    with db_conn.cursor() as cur:
        cur.execute("UPDATE courses SET status = 'published' WHERE id = ANY(%s)",
                    ([str(joined), str(open_course)],))
        cur.execute("UPDATE courses SET status = 'draft' WHERE id = %s", (str(hidden),))
        cur.execute("UPDATE lectures SET course_id = %s, total_slides = 4, pdf_url = %s WHERE id = %s",
                    (str(joined), "lecture-pdfs/x/00 DBS Introduction.pdf", str(l1)))
        cur.execute("UPDATE lectures SET course_id = %s, total_slides = 4, pdf_url = %s, "
                    "created_at = now() + interval '1 minute' WHERE id = %s",
                    (str(joined), "lecture-pdfs/x/01 DBS SQL.pdf", str(l2)))
        cur.execute("UPDATE lectures SET course_id = %s WHERE id = %s", (str(open_course), str(l3)))
        cur.execute(
            "INSERT INTO student_progress (user_id, lecture_id, completed_slides) VALUES (%s, %s, %s)",
            (str(student), str(l1), [1, 2]),
        )
    make_course_enrollment(student, joined)
    make_quiz(make_slide(l2))

    world = await svc.get_world(str(student))
    spaces = {s["id"]: s for s in world["spaces"]}

    assert str(hidden) not in spaces  # a draft course nobody joined is invisible
    dbs = spaces[str(joined)]
    assert dbs["viewerRole"] == "member"
    assert dbs["shortCode"] == "DBS"  # from the file names, not the title
    assert (dbs["lessonCount"], dbs["memberCount"], dbs["viewerProgress"]) == (2, 1, 25)
    assert spaces[str(open_course)]["viewerRole"] is None  # open to join

    lessons = [l for l in world["lessons"] if l["spaceId"] == str(joined)]
    assert [(l["title"], l["order"]) for l in lessons] == [("Introduction", 1), ("SQL", 2)]
    intro, sql = lessons
    assert (intro["progress"], intro["percentComplete"]) == ("in-progress", 50)
    assert (sql["progress"], sql["practiceCount"]) == ("not-started", 1)
    assert intro["material"]["filename"] == "00 DBS Introduction.pdf"

    assert world["viewer"]["id"] == str(student)
    # A stranger sees the open courses but holds no role in them.
    other = await svc.get_world(str(stranger))
    assert all(s["viewerRole"] is None for s in other["spaces"])
