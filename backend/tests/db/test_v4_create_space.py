"""v4 'New Space' against real Postgres (LS-050): a student makes a Space on the stage."""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.db

asyncpg = pytest.importorskip("asyncpg")


@pytest.fixture
def svc(pg_dsn, monkeypatch):
    """Route get_db_connection at the throwaway database."""
    import backend.services.v4_spaces_service as service

    class _Conn:
        async def __aenter__(self):
            self.c = await asyncpg.connect(pg_dsn)
            return self.c

        async def __aexit__(self, *exc):
            await self.c.close()

    async def _get():
        return _Conn()

    monkeypatch.setattr(service, "get_db_connection", _get)
    return service


async def test_a_student_makes_a_space_that_only_they_see_until_it_has_something(svc, db_conn, make_user):
    tag = uuid.uuid4().hex[:6]
    owner = make_user(email=f"maker-{tag}@gmail.com")
    stranger = make_user(email=f"other-{tag}@gmail.com")

    space_id = await svc.create_space(str(owner), f"Lerngruppe {tag}", "Wir lernen zusammen.")

    with db_conn.cursor() as cur:
        cur.execute("SELECT professor_id, title, description, status FROM courses WHERE id = %s", (space_id,))
        row = cur.fetchone()
    assert (str(row[0]), *row[1:]) == (str(owner), f"Lerngruppe {tag}", "Wir lernen zusammen.", "draft")

    mine = {s["id"]: s for s in (await svc.get_world(str(owner)))["spaces"]}
    assert mine[space_id]["viewerRole"] == "owner"
    assert mine[space_id]["name"] == f"Lerngruppe {tag}"

    theirs = {s["id"] for s in (await svc.get_world(str(stranger)))["spaces"]}
    assert space_id not in theirs  # a draft with nothing inside is nobody else's business
    assert await svc.join_space(space_id, str(stranger)) is False


async def test_no_description_is_stored_as_none(svc, db_conn, make_user):
    owner = make_user(email=f"maker-{uuid.uuid4().hex[:6]}@gmail.com")
    space_id = await svc.create_space(str(owner), "Solo", None)
    with db_conn.cursor() as cur:
        cur.execute("SELECT description FROM courses WHERE id = %s", (space_id,))
        assert cur.fetchone() == (None,)


async def test_only_the_owner_publishes_and_others_see_it_once_it_has_a_lesson(svc, db_conn, make_user, make_lecture):
    """LS-072: publish on the stage. Published + a lecture = open to others."""
    tag = uuid.uuid4().hex[:6]
    owner = make_user(email=f"maker-{tag}@gmail.com")
    stranger = make_user(email=f"other-{tag}@gmail.com")
    space_id = await svc.create_space(str(owner), f"Lerngruppe {tag}", None)

    assert await svc.set_space_published(space_id, str(stranger), True) is None  # not theirs
    assert await svc.set_space_published(space_id, str(owner), True) == "published"
    mine = {s["id"]: s for s in (await svc.get_world(str(owner)))["spaces"]}
    assert mine[space_id]["visibility"] == "public"

    # Published but empty: still nobody else's to find.
    assert space_id not in {s["id"] for s in (await svc.get_world(str(stranger)))["spaces"]}

    lecture = make_lecture(owner, title="Einführung")
    with db_conn.cursor() as cur:
        cur.execute("UPDATE lectures SET course_id = %s, total_slides = 3 WHERE id = %s", (space_id, str(lecture)))
    theirs = {s["id"]: s for s in (await svc.get_world(str(stranger)))["spaces"]}
    assert theirs[space_id]["viewerRole"] is None  # open to join

    assert await svc.set_space_published(space_id, str(owner), False) == "draft"
    assert space_id not in {s["id"] for s in (await svc.get_world(str(stranger)))["spaces"]}


def test_a_student_who_owns_a_space_with_a_lesson_can_still_delete_their_account(
    db_conn, make_user, make_course, make_lecture, make_slide
):
    """GDPR: a student who made a Space and added a lesson can delete their
    account, and everything they made goes with it. The schema built from the
    migrations allows it; on 2026-10-26 prod's Auth delete still failed for
    such an account ("Database error deleting user"), so this guards the
    migrations side while the prod-only cause is chased."""
    owner = make_user(email=f"maker-{uuid.uuid4().hex[:6]}@gmail.com")
    course = make_course(owner, title="Lerngruppe")
    lecture = make_lecture(owner, title="Intro")
    make_slide(lecture)
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE public.lectures SET course_id = %s, visibility = 'course' WHERE id = %s",
            (str(course), str(lecture)),
        )
        cur.execute(
            "INSERT INTO public.parse_runs (pdf_hash, pipeline_version, user_id, course_id, lecture_id, status, filename) "
            "VALUES (%s, 'unified-v1', %s, %s, %s, 'completed', 'intro.pdf')",
            (uuid.uuid4().hex, str(owner), str(course), str(lecture)),
        )
        cur.execute(
            "INSERT INTO public.llm_calls (user_id, course_id, feature, provider, model, prompt_tokens, completion_tokens) "
            "VALUES (%s, %s, 'parse', 'openai', 'gpt-4o-mini', 1, 1)",
            (str(owner), str(course)),
        )
        cur.execute("DELETE FROM auth.users WHERE id = %s", (str(owner),))
        cur.execute("SELECT count(*) FROM public.courses WHERE id = %s", (str(course),))
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT count(*) FROM public.lectures WHERE id = %s", (str(lecture),))
        assert cur.fetchone()[0] == 0
