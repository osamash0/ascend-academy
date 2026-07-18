"""DB regression tests for 20260719000000_lock_down_destructive_rpcs.sql.

Verified, pre-fix vulnerability: `reset_all_analytics()` / `restore_analytics()`
(20260614000000) and `increment_upload_quota()` (20260710040000) shipped with
NO revoke, so the Postgres-implicit EXECUTE-to-PUBLIC grant left them callable
by anon/authenticated over PostgREST with the public anon key — an
unauthenticated `POST /rest/v1/rpc/reset_all_analytics` could wipe every
analytics table and zero every profile's XP. `grant_xp()` was correctly
authenticated-only but had no cap on `p_xp`, letting a user self-inflate XP.

These tests assert, at the Postgres layer:
  - anon cannot execute any of the three RPCs at all (permission denied,
    never even reaches the function body).
  - an authenticated non-admin likewise cannot execute reset_all_analytics /
    restore_analytics (previously they *did* hit a body-level admin check and
    got a clean error, but the grant itself must be locked down too — the
    real fix is at the ACL layer, not just the internal guard).
  - the legitimate service-role path (mirroring `supabase_admin.rpc(...)` in
    backend/api/v1/admin.py) still works post-fix.
  - grant_xp rejects p_xp outside (0, 500] and still grants correctly inside
    that range.

Gated behind the `db` marker (boots a real Postgres via testcontainers).
"""
from __future__ import annotations

import uuid

import psycopg
import pytest

pytestmark = pytest.mark.db


# ── role / claim helpers (mirror test_exam_mode_rls.py / test_rls_policies.py) ─

def _as_user(cur, uid: uuid.UUID) -> None:
    cur.execute("SET ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, false)", (str(uid),))
    cur.execute("SELECT set_config('request.jwt.claim.role', %s, false)", ("authenticated",))


def _as_service_role(cur) -> None:
    """Mirrors the trusted backend's supabase_admin (SUPABASE_SERVICE_ROLE_KEY)
    call shape: service_role, with no user JWT claims (auth.uid() IS NULL)."""
    cur.execute("SET ROLE service_role")


def _reset_user(cur) -> None:
    cur.execute("RESET ROLE")
    cur.execute("SELECT set_config('request.jwt.claim.sub', '', false)")
    cur.execute("SELECT set_config('request.jwt.claim.role', '', false)")


# ── reset_all_analytics / restore_analytics: no anon/authenticated access ────

def test_anon_cannot_call_reset_all_analytics(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT reset_all_analytics()")
        finally:
            cur.execute("RESET ROLE")


def test_anon_cannot_call_restore_analytics(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT restore_analytics(%s)", (str(uuid.uuid4()),))
        finally:
            cur.execute("RESET ROLE")


def test_authenticated_non_admin_cannot_call_reset_all_analytics(db_conn, make_user):
    student = make_user(role="student")
    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT reset_all_analytics()")
        finally:
            _reset_user(cur)


def test_authenticated_non_admin_cannot_call_restore_analytics(db_conn, make_user):
    student = make_user(role="student")
    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute("SELECT restore_analytics(%s)", (str(uuid.uuid4()),))
        finally:
            _reset_user(cur)


def test_service_role_can_still_call_reset_all_analytics(db_conn, make_user):
    """The legitimate path: backend/api/v1/admin.py's `require_admin`-gated
    route calls `supabase_admin.rpc("reset_all_analytics")` — service_role,
    no user JWT. Must keep working after the lockdown."""
    make_user(role="student")  # give it something to snapshot/clear
    with db_conn.cursor() as cur:
        _as_service_role(cur)
        try:
            cur.execute("SELECT reset_all_analytics()")
            backup_id = cur.fetchone()[0]
            assert backup_id is not None
        finally:
            cur.execute("RESET ROLE")


def test_service_role_can_still_call_restore_analytics(db_conn):
    with db_conn.cursor() as cur:
        _as_service_role(cur)
        try:
            cur.execute("SELECT reset_all_analytics()")
            backup_id = cur.fetchone()[0]
            cur.execute("SELECT restore_analytics(%s)", (str(backup_id),))
            assert cur.fetchone()[0] is True
        finally:
            cur.execute("RESET ROLE")


# ── increment_upload_quota: no anon/authenticated access ─────────────────────

def test_anon_cannot_call_increment_upload_quota(db_conn):
    with db_conn.cursor() as cur:
        cur.execute("SET ROLE anon")
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(
                    "SELECT * FROM increment_upload_quota(%s, '2026-08', 999)",
                    (str(uuid.uuid4()),),
                )
        finally:
            cur.execute("RESET ROLE")


def test_authenticated_cannot_call_increment_upload_quota_directly(db_conn, make_user):
    """A client forging their own quota bump (or another user's, via
    p_user_id) must be rejected at the grant level, not just trusted to pass
    their own uid."""
    student = make_user(role="student")
    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cur.execute(
                    "SELECT * FROM increment_upload_quota(%s, '2026-08', 999)",
                    (str(student),),
                )
        finally:
            _reset_user(cur)


def test_service_role_can_still_call_increment_upload_quota(db_conn, make_user):
    student = make_user(role="student")
    with db_conn.cursor() as cur:
        _as_service_role(cur)
        try:
            cur.execute(
                "SELECT allowed, uploads_used, quota_limit FROM increment_upload_quota(%s, '2026-09', 5)",
                (str(student),),
            )
            allowed, used, limit = cur.fetchone()
            assert allowed is True
            assert used == 1
            assert limit == 5
        finally:
            cur.execute("RESET ROLE")


# ── grant_xp: hard cap on p_xp ────────────────────────────────────────────────

def test_grant_xp_rejects_amount_above_cap(db_conn, make_user):
    student = make_user(role="student")
    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            with pytest.raises(psycopg.errors.RaiseException):
                cur.execute("SELECT grant_xp(1000000, 'exploit')")
        finally:
            _reset_user(cur)


def test_grant_xp_rejects_zero_and_negative(db_conn, make_user):
    student = make_user(role="student")
    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            with pytest.raises(psycopg.errors.RaiseException):
                cur.execute("SELECT grant_xp(0, 'noop')")
        finally:
            _reset_user(cur)
        _as_user(cur, student)
        try:
            with pytest.raises(psycopg.errors.RaiseException):
                cur.execute("SELECT grant_xp(-10, 'penalty')")
        finally:
            _reset_user(cur)


def test_grant_xp_allows_max_legitimate_badge_reward(db_conn, make_user):
    """500 is the largest seeded badge_definitions.xp_reward (Polymath) —
    the cap must not clip a real, legitimate grant."""
    student = make_user(role="student")
    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            cur.execute("SELECT grant_xp(500, 'badge:Polymath', 'badge:Polymath')")
            cur.execute("SELECT total_xp FROM profiles WHERE user_id = %s", (str(student),))
            assert cur.fetchone()[0] == 500
        finally:
            _reset_user(cur)


def test_grant_xp_normal_grant_still_works(db_conn, make_user):
    student = make_user(role="student")
    with db_conn.cursor() as cur:
        _as_user(cur, student)
        try:
            cur.execute("SELECT grant_xp(10, 'quiz_correct')")
            cur.execute("SELECT total_xp FROM profiles WHERE user_id = %s", (str(student),))
            assert cur.fetchone()[0] == 10
        finally:
            _reset_user(cur)
