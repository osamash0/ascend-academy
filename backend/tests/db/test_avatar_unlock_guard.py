"""DB tests for 20261012000400_avatar_unlock_guard.sql.

The database must refuse avatar gear a student hasn't earned, whatever the
client sends: unknown items, items in the wrong slot, and locked items are
rejected; free items and genuinely earned items are accepted; trusted roles
may repair anything.

Gated behind the `db` marker (boots a real Postgres via testcontainers).
"""
from __future__ import annotations

import json
import uuid

import psycopg
import pytest

pytestmark = pytest.mark.db


def _as_user(cur, uid: uuid.UUID) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",))


def _reset(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


def _save(cur, uid: uuid.UUID, loadout: dict) -> None:
    """Save a loadout the way the app does: as the signed-in student, own row."""
    _as_user(cur, uid)
    try:
        cur.execute("UPDATE profiles SET luna_loadout = %s::jsonb WHERE user_id = %s", (json.dumps(loadout), str(uid)))
    finally:
        _reset(cur)


def _set_progress(cur, uid: uuid.UUID, **cols) -> None:
    sets = ", ".join(f"{k} = %s" for k in cols)
    cur.execute(f"UPDATE profiles SET {sets} WHERE user_id = %s", (*cols.values(), str(uid)))


def test_free_items_save(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        _save(cur, uid, {"suit": "suit-mint", "gear": "gear-antenna", "outfit": "outfit-cosy"})
        cur.execute("SELECT luna_loadout->>'suit' FROM profiles WHERE user_id = %s", (str(uid),))
        assert cur.fetchone()[0] == "suit-mint"


@pytest.mark.parametrize(
    "loadout",
    [
        {"gear": "gear-halo"},  # Legend rank, brand-new account
        {"outfit": "outfit-gulf"},  # needs the First Steps badge
        {"aura": "aura-ember"},  # needs a 30-day streak
        {"backdrop": "backdrop-observatory"},  # needs level 10
    ],
    ids=["rank", "badge", "streak", "level"],
)
def test_locked_items_are_refused(db_conn, make_user, loadout):
    uid = make_user()
    with db_conn.cursor() as cur:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            _save(cur, uid, loadout)


@pytest.mark.parametrize(
    "loadout",
    [{"gear": "gear-does-not-exist"}, {"gear": "suit-mint"}],
    ids=["unknown-item", "wrong-slot"],
)
def test_unknown_or_misplaced_items_are_refused(db_conn, make_user, loadout):
    uid = make_user()
    with db_conn.cursor() as cur:
        with pytest.raises(psycopg.errors.InvalidParameterValue):
            _save(cur, uid, loadout)


def test_earned_items_save(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        _set_progress(cur, uid, total_xp=13000, current_level=12, best_streak=31)
        cur.execute(
            "INSERT INTO achievements (user_id, badge_name, badge_description) VALUES (%s, 'First Steps', 'x')",
            (str(uid),),
        )
        _save(
            cur,
            uid,
            {"gear": "gear-halo", "outfit": "outfit-gulf", "aura": "aura-ember", "backdrop": "backdrop-observatory"},
        )
        cur.execute("SELECT luna_loadout FROM profiles WHERE user_id = %s", (str(uid),))
        assert cur.fetchone()[0]["gear"] == "gear-halo"


def test_a_lapsed_streak_keeps_streak_gear(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        _set_progress(cur, uid, best_streak=7, current_streak=0)
        _save(cur, uid, {"gear": "gear-flame"})  # 7-day streak gear, earned once = kept


def test_trusted_roles_can_repair_a_profile(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE service_role")
        cur.execute("SELECT set_config('request.jwt.claim.role', 'service_role', false)")
        try:
            cur.execute("UPDATE profiles SET luna_loadout = %s::jsonb WHERE user_id = %s", (json.dumps({"gear": "gear-halo"}), str(uid)))
        finally:
            _reset(cur)


def test_the_guard_is_not_bypassed_by_its_own_owner(db_conn, make_user):
    """Regression: a SECURITY DEFINER trigger sees current_user = its owner, which
    made a 'trusted role' check true for everyone. A student must still be refused."""
    uid = make_user()
    with db_conn.cursor() as cur:
        cur.execute("SELECT prosecdef FROM pg_proc WHERE proname = 'enforce_luna_loadout'")
        assert cur.fetchone()[0] is False
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            _save(cur, uid, {"gear": "gear-halo"})


def test_other_profile_writes_are_unaffected(db_conn, make_user):
    """The trigger only fires on luna_loadout; e.g. a display-name change with a stale locked loadout still saves."""
    uid = make_user()
    with db_conn.cursor() as cur:
        _as_user(cur, uid)
        try:
            cur.execute("UPDATE profiles SET display_name = 'Mira' WHERE user_id = %s", (str(uid),))
        finally:
            _reset(cur)
