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
