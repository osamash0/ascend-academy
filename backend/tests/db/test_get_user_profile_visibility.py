"""get_user_profile follows the person's "show me in Spaces" choice.

20261113000100_get_user_profile_honours_visibility.sql: a row comes back only
for yourself, a friend, someone who sent you an open request, or a person who
switched show_in_spaces on (the rule of backend/services/v4_spaces_service.py).
"""
from __future__ import annotations

import uuid

import psycopg
import pytest

pytestmark = pytest.mark.db


def _as_user(cur, uid: uuid.UUID) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",))


def _reset_user(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def _profile_ids(db_conn, viewer: uuid.UUID, targets: list[uuid.UUID]) -> set[str]:
    seen: set[str] = set()
    with db_conn.cursor() as cur:
        _as_user(cur, viewer)
        try:
            for t in targets:
                cur.execute("SELECT user_id, display_name FROM public.get_user_profile(%s)", (str(t),))
                seen.update(str(r[0]) for r in cur.fetchall())
        finally:
            _reset_user(cur)
    return seen


def test_get_user_profile_follows_the_persons_choice(db_conn, make_user):
    me = make_user(role="student")
    quiet = make_user(role="student")
    open_ = make_user(role="student")
    friend = make_user(role="student")
    asker = make_user(role="student")
    asked = make_user(role="student")
    with db_conn.cursor() as cur:
        cur.execute("UPDATE public.profiles SET show_in_spaces = true WHERE user_id = %s", (str(open_),))
        cur.execute("INSERT INTO public.friend_requests (requester_id, addressee_id, status) VALUES (%s, %s, 'accepted')",
                    (str(friend), str(me)))
        cur.execute("INSERT INTO public.friend_requests (requester_id, addressee_id) VALUES (%s, %s)",
                    (str(asker), str(me)))
        cur.execute("INSERT INTO public.friend_requests (requester_id, addressee_id) VALUES (%s, %s)",
                    (str(me), str(asked)))

    seen = _profile_ids(db_conn, me, [me, quiet, open_, friend, asker, asked])
    assert seen == {str(me), str(open_), str(friend), str(asker)}

    # From the other side: my friend sees me, the person I asked sees me (I chose
    # to contact them), a stranger does not.
    assert _profile_ids(db_conn, friend, [me]) == {str(me)}
    assert _profile_ids(db_conn, asked, [me]) == {str(me)}
    assert _profile_ids(db_conn, quiet, [me]) == set()


def test_anon_cannot_call_get_user_profile(db_conn, make_user):
    target = make_user(role="student")
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT * FROM public.get_user_profile(%s)", (str(target),))
        finally:
            cur.execute("RESET ROLE")
