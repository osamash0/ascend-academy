"""v4 Social against real Postgres: friends, requests, and a race of real people."""
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


async def test_race_friends_requests_and_answering(svc, db_conn, make_user, make_course, make_course_enrollment):
    tag = uuid.uuid4().hex[:6]
    prof = make_user(role="professor", email=f"p-{tag}@uni-marburg.de")
    me = make_user(email=f"me-{tag}@gmail.com")
    classmate = make_user(email=f"mate-{tag}@gmail.com")
    seeded = make_user(email=f"seed-{tag}@example.com")  # internal: never races
    friend_elsewhere = make_user(email=f"friend-{tag}@gmail.com")
    asker = make_user(email=f"asker-{tag}@gmail.com")
    course = make_course(prof, title=f"DBS {tag}")
    for u in (me, classmate, seeded):
        make_course_enrollment(u, course)
    with db_conn.cursor() as cur:
        for uid, xp in ((me, 40), (classmate, 90), (seeded, 5000), (friend_elsewhere, 10), (prof, 0)):
            cur.execute("UPDATE profiles SET total_xp = %s WHERE user_id = %s", (xp, str(uid)))
        cur.execute("INSERT INTO friend_requests (requester_id, addressee_id, status) VALUES (%s, %s, 'accepted')",
                    (str(friend_elsewhere), str(me)))
        cur.execute("INSERT INTO friend_requests (requester_id, addressee_id) VALUES (%s, %s)",
                    (str(asker), str(me)))

    async with await svc.get_db_connection() as conn:
        social = await svc._social(conn, str(me))

    race = [(r["person"]["id"], r["xp"], r["isViewer"]) for r in social["leaderboard"]]
    ids = [r[0] for r in race]
    with db_conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.account_classification') IS NOT NULL")
        classified = cur.fetchone()[0]
    if classified:  # migration 20261013000000 (PR #92)
        assert str(seeded) not in ids  # a seed account never outranks a student
    ids = [i for i in ids if i != str(seeded)]
    assert ids.index(str(classmate)) < ids.index(str(me)) < ids.index(str(friend_elsewhere))
    assert [r for r in social["leaderboard"] if r["isViewer"]][0]["sharedSpaces"] == 1
    assert [f["id"] for f in social["friends"]] == [str(friend_elsewhere)]
    assert [r["person"]["id"] for r in social["requests"]] == [str(asker)]

    assert await svc.answer_friend_request(str(me), str(asker), accept=True) is True
    assert await svc.answer_friend_request(str(me), str(asker), accept=True) is False  # nothing pending now
    async with await svc.get_db_connection() as conn:
        after = await svc._social(conn, str(me))
    assert sorted(f["id"] for f in after["friends"]) == sorted([str(friend_elsewhere), str(asker)])
    assert after["requests"] == []
