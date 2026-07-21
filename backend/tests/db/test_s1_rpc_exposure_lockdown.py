"""DB regression tests for 20260721000001_s1_rpc_exposure_lockdown.sql.

S-1 (docs/ROADMAP_10X_FOUNDATION.md §14) is the systematic PostgREST/RPC
exposure audit. P0-1 (fix/p0-security-rpc-lockdown, its own branch) already
fixed the three worst-known cases (reset_all_analytics/restore_analytics/
increment_upload_quota + a grant_xp cap). This file covers the NEW findings
this audit surfaced beyond those three — see docs/RPC_EXPOSURE_AUDIT.md for
the full inventory.

Finding A (real PII leak, verified against a real local Postgres before this
fix): friend_ids_of/relationship_status/mutual_friends_count/
mutual_courses_count/shared_catalog_courses_count are SECURITY DEFINER
helpers that take an arbitrary caller-supplied uuid and return raw
social-graph data for THAT user, with no ownership check and (pre-fix) no
REVOKE — anon could call `friend_ids_of('<any-uuid>')` directly over
PostgREST and read that user's real friend list. Manually verified against a
real local Postgres 18 (seeded two users + an accepted friend_requests row;
`SET ROLE anon; SELECT * FROM friend_ids_of(victim)` returned the real friend
uuid pre-fix, InsufficientPrivilege post-fix).

Finding B (unnecessary anon reachability of RLS helpers): has_role/
assignment_owner_id/course_professor_id/lecture_visible_to_caller are used
inside RLS policy USING clauses (all such policies are `TO authenticated`,
never `TO anon`), so `authenticated` must retain EXECUTE, but `anon`/PUBLIC
have no legitimate reason to call them directly.

Gated behind the `db` marker (boots a real Postgres via testcontainers, or
runs against a real local Postgres if one is already configured — same
harness as test_lock_down_destructive_rpcs.py).
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


def _make_friendship(db_conn, make_user):
    """Two users with an accepted friend_requests row, mirroring the manual
    real-Postgres repro used to confirm the pre-fix vulnerability."""
    victim = make_user(role="student")
    friend = make_user(role="student")
    with db_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO public.friend_requests (requester_id, addressee_id, status)"
            " VALUES (%s, %s, 'accepted')",
            (str(victim), str(friend)),
        )
    return victim, friend


# ── Finding A: friend_ids_of / relationship_status / mutual_*_count ─────────


def test_anon_cannot_read_friend_ids_of_arbitrary_user(db_conn, make_user):
    victim, _friend = _make_friendship(db_conn, make_user)
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT * FROM friend_ids_of(%s)", (str(victim),))
        finally:
            cur.execute("RESET ROLE")


def test_anon_cannot_read_relationship_status_of_arbitrary_users(db_conn, make_user):
    victim, friend = _make_friendship(db_conn, make_user)
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT relationship_status(%s, %s)", (str(victim), str(friend)))
        finally:
            cur.execute("RESET ROLE")


def test_authenticated_cannot_call_friend_ids_of_directly(db_conn, make_user):
    """Even a logged-in but unrelated user must not be able to bypass
    get_friends()'s auth.uid()-scoping by calling the helper directly."""
    victim, _friend = _make_friendship(db_conn, make_user)
    attacker = make_user(role="student")
    with db_conn.cursor() as cur:
        _as_user(cur, attacker)
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT * FROM friend_ids_of(%s)", (str(victim),))
        finally:
            _reset_user(cur)


def test_anon_cannot_call_mutual_friends_count(db_conn, make_user):
    victim, friend = _make_friendship(db_conn, make_user)
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT mutual_friends_count(%s, %s)", (str(victim), str(friend)))
        finally:
            cur.execute("RESET ROLE")


def test_anon_cannot_call_mutual_courses_count(db_conn, make_user):
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(
                    "SELECT mutual_courses_count(%s, %s)",
                    (str(uuid.uuid4()), str(uuid.uuid4())),
                )
        finally:
            cur.execute("RESET ROLE")


def test_anon_cannot_call_shared_catalog_courses_count(db_conn, make_user):
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(
                    "SELECT shared_catalog_courses_count(%s, %s)",
                    (str(uuid.uuid4()), str(uuid.uuid4())),
                )
        finally:
            cur.execute("RESET ROLE")


# ── Legitimate path unaffected: get_friends() still works end-to-end ────────
# get_friends() is owned by the migration-applying role (superuser in this
# harness) and is itself SECURITY DEFINER, so its internal call to the now
# locked-down friend_ids_of() executes as its owner, not the caller — the
# REVOKE above must not break it.


def test_get_friends_still_works_after_lockdown(db_conn, make_user):
    victim, friend = _make_friendship(db_conn, make_user)
    with db_conn.cursor() as cur:
        _as_user(cur, victim)
        try:
            cur.execute("SELECT * FROM get_friends()")
            rows = cur.fetchall()
            assert len(rows) == 1
            assert str(rows[0][0]) == str(friend)
        finally:
            _reset_user(cur)


# ── Finding B: has_role / assignment_owner_id / course_professor_id /
#    lecture_visible_to_caller — anon locked out, authenticated unaffected ──


def test_anon_cannot_call_has_role(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT has_role(%s, 'admin')", (str(uuid.uuid4()),))
        finally:
            cur.execute("RESET ROLE")


def test_authenticated_can_still_call_has_role(db_conn, make_user):
    """RLS policies invoke has_role() from a plain USING clause, evaluated as
    the querying role — authenticated must keep EXECUTE or every policy that
    references it breaks."""
    student = make_user(role="student")
    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            cur.execute("SELECT has_role(%s, 'admin')", (str(student),))
            assert cur.fetchone()[0] is False
        finally:
            _reset_user(cur)


def test_anon_cannot_call_assignment_owner_id(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT assignment_owner_id(%s)", (str(uuid.uuid4()),))
        finally:
            cur.execute("RESET ROLE")


def test_anon_cannot_call_course_professor_id(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT course_professor_id(%s)", (str(uuid.uuid4()),))
        finally:
            cur.execute("RESET ROLE")


def test_anon_cannot_call_lecture_visible_to_caller(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT lecture_visible_to_caller(%s)", (str(uuid.uuid4()),))
        finally:
            cur.execute("RESET ROLE")


def test_authenticated_can_still_call_course_professor_id(db_conn, make_user, make_course):
    prof = make_user(role="professor")
    course = make_course(prof, title="Intro to Testing")
    with db_conn.cursor() as cur:
        _as_user(cur, prof)
        try:
            cur.execute("SELECT course_professor_id(%s)", (str(course),))
            assert str(cur.fetchone()[0]) == str(prof)
        finally:
            _reset_user(cur)
