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
        # LS-036: classmates race only when they switched it on.
        for uid in (classmate, seeded):
            cur.execute("UPDATE profiles SET show_in_spaces = true WHERE user_id = %s", (str(uid),))
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


async def test_ls036_the_people_in_your_spaces_see_you_only_if_you_say_so(
    svc, db_conn, make_user, make_course, make_course_enrollment
):
    """Privacy by default (Art. 25(2) GDPR): joining a Space does not put you in
    its members' ranking or on its card. Switching it on does. Friends see each
    other either way."""
    tag = uuid.uuid4().hex[:6]
    prof = make_user(role="professor", email=f"p-{tag}@uni-marburg.de")
    me = make_user(email=f"me-{tag}@gmail.com")
    quiet = make_user(email=f"max.mustermann-{tag}@gmail.com")  # never switched it on
    open_ = make_user(email=f"open-{tag}@gmail.com")
    friend = make_user(email=f"friend-{tag}@gmail.com")
    course = make_course(prof, title=f"Public {tag}")
    for u in (me, quiet, open_, friend):
        make_course_enrollment(u, course)
    with db_conn.cursor() as cur:
        cur.execute("UPDATE profiles SET display_name = NULL, full_name = NULL WHERE user_id = %s", (str(quiet),))
        cur.execute("UPDATE profiles SET show_in_spaces = true WHERE user_id = %s", (str(open_),))
        cur.execute("INSERT INTO friend_requests (requester_id, addressee_id, status) VALUES (%s, %s, 'accepted')",
                    (str(friend), str(me)))
        cur.execute("SELECT show_in_spaces FROM profiles WHERE user_id = %s", (str(me),))
        assert cur.fetchone()[0] is False  # off by default

    world = await svc.get_world(str(me))
    raced = {r["person"]["id"] for r in world["social"]["leaderboard"]}
    assert str(open_) in raced and str(friend) in raced and str(me) in raced
    assert str(quiet) not in raced
    faces = {p["id"] for s in world["spaces"] for p in s["faces"]}
    assert str(quiet) not in faces
    assert world["showInSpaces"] is False

    # The email's local part never stands in for a missing name.
    named = svc._person({"user_id": quiet, "display_name": None, "full_name": None,
                         "email": "max.mustermann@gmail.com", "avatar_url": None})
    assert named["name"] == "Learner"

    assert await svc.set_show_in_spaces(str(quiet), True) is True
    world = await svc.get_world(str(me))
    assert str(quiet) in {r["person"]["id"] for r in world["social"]["leaderboard"]}
    assert (await svc.get_world(str(quiet)))["showInSpaces"] is True
    assert await svc.set_show_in_spaces(str(quiet), False) is False


def test_ls036_the_classic_global_list_shows_only_people_who_switched_it_on(db_conn, make_user):
    tag = uuid.uuid4().hex[:6]
    hidden = make_user(email=f"hidden-{tag}@gmail.com")
    shown = make_user(email=f"shown-{tag}@gmail.com")
    with db_conn.cursor() as cur:
        cur.execute("UPDATE profiles SET show_in_spaces = true WHERE user_id = %s", (str(shown),))
        cur.execute("SELECT user_id FROM public.get_global_leaderboard(100)")
        ids = {str(r[0]) for r in cur.fetchall()}
    assert str(shown) in ids
    assert str(hidden) not in ids
