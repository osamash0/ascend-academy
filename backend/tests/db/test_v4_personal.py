"""The personal Space against real Postgres: your private uploads, read as a Space only you can open."""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db

asyncpg = pytest.importorskip("asyncpg")


@pytest.fixture
def services(pg_dsn, monkeypatch):
    """Route both services' connections at the throwaway database."""
    import backend.services.v4_reader_service as reader
    import backend.services.v4_spaces_service as spaces

    class _Conn:
        async def __aenter__(self):
            self.c = await asyncpg.connect(pg_dsn)
            return self.c

        async def __aexit__(self, *exc):
            await self.c.close()

    async def _get():
        return _Conn()

    for mod in (reader, spaces):
        monkeypatch.setattr(mod, "get_db_connection", _get)
    return spaces, reader


def _make_private(db_conn, lecture_id, owner):
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE lectures SET visibility = 'private_student', student_owner_id = %s, course_id = NULL, "
            "professor_id = NULL WHERE id = %s",
            (str(owner), str(lecture_id)),
        )


async def test_private_uploads_are_a_space_only_their_owner_sees(
    services, db_conn, make_user, make_lecture, make_slide, monkeypatch,
):
    spaces, reader = services
    tag = uuid.uuid4().hex[:6]
    student = make_user(email=f"stud-{tag}@gmail.com")
    other = make_user(email=f"other-{tag}@gmail.com")
    notes = make_lecture(student, title="Graph theory notes")
    _make_private(db_conn, notes, student)
    s = make_slide(notes)
    with db_conn.cursor() as cur:
        cur.execute("UPDATE slides SET content_text = 'Dijkstra shortest path' WHERE id = %s", (str(s),))

    # One run still developing, one done — as materials_service reports them.
    async def runs(uid):
        assert uid == str(student)
        return [
            {"run_id": "r2", "lecture_id": None, "status": "running", "filename": "week2.pdf",
             "title": "week2.pdf", "total_slides": 0, "created_at": "2026-10-13T20:00:00+00:00"},
            {"run_id": "r1", "lecture_id": str(notes), "status": "completed", "filename": "graphs.pdf",
             "title": "Graph theory notes", "total_slides": 1, "created_at": "2026-10-12T20:00:00+00:00"},
        ]

    monkeypatch.setattr(spaces.materials_service, "list_my_materials", runs)
    monkeypatch.setattr(spaces.settings, "feature_student_uploads", True)

    world = await spaces.get_world(str(student))
    mine = next(sp for sp in world["spaces"] if sp["id"] == str(student))
    assert (mine["name"], mine["viewerRole"], mine["visibility"], mine["lessonCount"]) == (
        "My materials", "owner", "private", 1,
    )
    lesson = next(l for l in world["lessons"] if l["id"] == str(notes))
    assert (lesson["spaceId"], lesson["order"], lesson["author"]["id"]) == (str(student), 1, str(student))
    assert [(u["id"], u["stage"], u["lessonId"]) for u in world["uploads"]] == [
        ("r2", "developing", None), ("r1", "ready", str(notes)),
    ]
    assert world["canUpload"] is True

    # Nobody else's world carries it, and nobody else can open it.
    monkeypatch.setattr(spaces.materials_service, "list_my_materials", lambda uid: _none())
    theirs = await spaces.get_world(str(other))
    assert str(student) not in {sp["id"] for sp in theirs["spaces"]}
    assert str(notes) not in {l["id"] for l in theirs["lessons"]}
    assert await reader.can_view_course(student, str(student))
    assert not await reader.can_view_course(student, str(other))

    # The reader reads it as a course: its lectures, and search across them.
    course = await reader.get_course(student, str(student))
    assert (course["title"], [l["title"] for l in course["lectures"]]) == ("My materials", ["Graph theory notes"])
    hits = await reader.find_in_course(student, "dijkstra")
    assert [h["lecture_id"] for h in hits] == [str(notes)]


async def _none():
    return []


async def test_no_uploads_no_personal_space(services, make_user, monkeypatch):
    spaces, _ = services
    viewer = make_user(email=f"new-{uuid.uuid4().hex[:6]}@gmail.com")
    monkeypatch.setattr(spaces.settings, "feature_student_uploads", False)
    world = await spaces.get_world(str(viewer))
    assert str(viewer) not in {sp["id"] for sp in world["spaces"]}
    assert (world["uploads"], world["canUpload"]) == ([], False)
