"""DB tests for 20261010000100_profile_luna_loadout + 20261010010000_luna_avatar_identity.

get_luna_loadouts() lets any signed-in user draw other people's Luna. It is
SECURITY DEFINER, so these pin down exactly what it may reveal:
  - signed-in callers get only the cosmetic columns, for the ids they ask for;
  - anon cannot call it at all;
  - the luna_loadout column refuses non-object junk;
  - the avatars bucket refuses SVG and oversize uploads.

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


def test_signed_in_user_reads_only_cosmetic_columns_of_requested_ids(db_conn, make_user):
    viewer, ada, ben = make_user(), make_user(), make_user()
    with db_conn.cursor() as cur:
        cur.execute(
            "UPDATE profiles SET luna_loadout = %s::jsonb, luna_suit_color = '#E8E4F0' WHERE user_id = %s",
            (json.dumps({"gear": "gear-halo"}), str(ada)),
        )
        cur.execute(
            "UPDATE profiles SET luna_loadout = %s::jsonb WHERE user_id = %s",
            (json.dumps({"gear": "gear-antenna"}), str(ben)),
        )
        _as_user(cur, viewer)
        try:
            cur.execute("SELECT * FROM get_luna_loadouts(%s::uuid[])", ([str(ada)],))
            cols = [d.name for d in cur.description]
            rows = cur.fetchall()
        finally:
            _reset(cur)
    assert cols == ["user_id", "luna_loadout", "luna_suit_color", "luna_visor_tint"]
    assert len(rows) == 1
    assert str(rows[0][0]) == str(ada)
    assert str(ben) not in {str(r[0]) for r in rows}  # not asked for, so not returned
    assert rows[0][1] == {"gear": "gear-halo"}
    assert rows[0][2] == "#E8E4F0"


def test_anon_cannot_call_get_luna_loadouts(db_conn, make_user):
    someone = make_user()
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT * FROM get_luna_loadouts(%s::uuid[])", ([str(someone)],))
        finally:
            cur.execute("RESET ROLE")


def test_loadout_must_be_a_small_object(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute("UPDATE profiles SET luna_loadout = '[1,2,3]'::jsonb WHERE user_id = %s", (str(uid),))


def test_new_profiles_default_to_an_empty_loadout(db_conn, make_user):
    uid = make_user()
    with db_conn.cursor() as cur:
        cur.execute("SELECT luna_loadout FROM profiles WHERE user_id = %s", (str(uid),))
        assert cur.fetchone()[0] == {}


def test_avatars_bucket_is_raster_only_and_capped(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SELECT allowed_mime_types, file_size_limit FROM storage.buckets WHERE id = 'avatars'")
        row = cur.fetchone()
    assert row is not None, "avatars bucket missing"
    mimes, limit = row
    assert "image/svg+xml" not in mimes
    assert set(mimes) == {"image/webp", "image/jpeg", "image/png"}
    assert limit == 2 * 1024 * 1024
