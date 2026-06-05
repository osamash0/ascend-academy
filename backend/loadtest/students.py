"""
Load-test user pool — create / teardown
========================================

The backend verifies every request against ``supabase_admin.auth.get_user()``
(see ``backend/core/auth_middleware.py``), and ``learning_events`` /
``student_progress`` have a NOT NULL FK to ``auth.users``. So to simulate many
*distinct* users we need real Supabase auth users and real access tokens.

This script creates a pool of clearly-marked test users (one professor + N
students, all under the ``@learnstation.test`` domain), signs them in to
capture access tokens, and writes everything to ``.students.json`` next to this
file. ``--teardown`` deletes the users again; ``ON DELETE CASCADE`` on the FKs
means all their seeded events/progress vanish with them.

Usage::

    cd /Users/abdullahabobaker/Desktop/ascend-academy
    python -m backend.loadtest.students --create 30
    python -m backend.loadtest.students --teardown

Requires ``SUPABASE_URL`` + ``SUPABASE_SERVICE_ROLE_KEY`` in ``.env`` (the admin
API needs the service-role key). The anon key is used only to sign users in.
"""

import sys
import json
import argparse
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(project_root))

from supabase import create_client

from backend.core.database import (
    supabase_admin,
    SUPABASE_URL,
    ANON_KEY,
    SERVICE_ROLE_KEY,
)

REGISTRY_PATH = Path(__file__).resolve().parent / ".students.json"

# All test users share this domain + password so they are trivially
# identifiable and re-creatable. NEVER use this domain for real accounts.
TEST_DOMAIN = "learnstation.test"
TEST_PASSWORD = "LoadTest!2026"


# ---------------------------------------------------------------------------
# Registry helpers
# ---------------------------------------------------------------------------

def load_registry() -> dict:
    if REGISTRY_PATH.exists():
        return json.loads(REGISTRY_PATH.read_text())
    return {}


def save_registry(data: dict) -> None:
    REGISTRY_PATH.write_text(json.dumps(data, indent=2))
    print(f"💾  Registry written to {REGISTRY_PATH}")


# ---------------------------------------------------------------------------
# User creation
# ---------------------------------------------------------------------------

def _anon_client():
    if not ANON_KEY:
        raise SystemExit(
            "SUPABASE_ANON_KEY / VITE_SUPABASE_PUBLISHABLE_KEY is not set — "
            "needed to sign test users in and capture tokens."
        )
    return create_client(SUPABASE_URL, ANON_KEY)


def _create_user(email: str, role: str, full_name: str) -> str | None:
    """Create (or find) an auth user with the given role. Returns the user id."""
    try:
        resp = supabase_admin.auth.admin.create_user({
            "email": email,
            "password": TEST_PASSWORD,
            "email_confirm": True,
            # app_metadata is server-controlled and is what the backend reads
            # for authorization (see auth_middleware._app_metadata).
            "app_metadata": {"role": role},
            "user_metadata": {"full_name": full_name},
        })
        user = resp.user
        if not user:
            print(f"  ⚠️  No user returned for {email}")
            return None
        return user.id
    except Exception as e:
        # Most likely already exists from a previous run — look it up instead.
        msg = str(e).lower()
        if "already" in msg or "registered" in msg or "exists" in msg:
            uid = _find_user_id(email)
            if uid:
                print(f"  ↺  Reusing existing {email}")
                return uid
        print(f"  ⚠️  Failed to create {email}: {e}")
        return None


def _find_user_id(email: str) -> str | None:
    """Page through auth users to find one by email (no get-by-email API)."""
    page = 1
    while page <= 50:  # safety bound: 50 * 200 = 10k users
        resp = supabase_admin.auth.admin.list_users(page=page, per_page=200)
        users = resp if isinstance(resp, list) else getattr(resp, "users", resp)
        if not users:
            break
        for u in users:
            if getattr(u, "email", None) == email:
                return u.id
        page += 1
    return None


def _ensure_profile_and_role(user_id: str, email: str, full_name: str, role: str) -> None:
    """Backfill profiles + user_roles in case no DB trigger does it.

    Both are idempotent (profiles.user_id is UNIQUE, user_roles is UNIQUE on
    (user_id, role)); ignore conflicts so re-runs are safe.
    """
    try:
        supabase_admin.table("profiles").upsert(
            {"user_id": user_id, "email": email, "full_name": full_name},
            on_conflict="user_id",
        ).execute()
    except Exception as e:
        print(f"  ⚠️  profile upsert failed for {email}: {e}")
    try:
        supabase_admin.table("user_roles").upsert(
            {"user_id": user_id, "role": role},
            on_conflict="user_id,role",
        ).execute()
    except Exception as e:
        print(f"  ⚠️  user_roles upsert failed for {email}: {e}")


def _sign_in(anon, email: str) -> str | None:
    try:
        resp = anon.auth.sign_in_with_password({"email": email, "password": TEST_PASSWORD})
        if resp and resp.session:
            return resp.session.access_token
    except Exception as e:
        print(f"  ⚠️  sign-in failed for {email}: {e}")
    return None


def create(n_students: int) -> None:
    print("🌱  Load-test user pool — create")
    print("━" * 44)
    if not SERVICE_ROLE_KEY:
        raise SystemExit(
            "SUPABASE_SERVICE_ROLE_KEY is required to create auth users via the "
            "admin API. Set it in .env and retry."
        )
    anon = _anon_client()

    registry: dict = {"professor": None, "students": [], "lectures": []}

    # ── Professor (owns the seeded lectures so analytics ownership checks pass)
    prof_email = f"loadtest-prof@{TEST_DOMAIN}"
    prof_id = _create_user(prof_email, "professor", "Load Test Professor")
    if not prof_id:
        raise SystemExit("Could not create the test professor — aborting.")
    _ensure_profile_and_role(prof_id, prof_email, "Load Test Professor", "professor")
    prof_token = _sign_in(anon, prof_email)
    registry["professor"] = {
        "id": prof_id, "email": prof_email,
        "password": TEST_PASSWORD, "access_token": prof_token, "role": "professor",
    }
    print(f"👤  Professor: {prof_email}  ({'token ok' if prof_token else 'NO TOKEN'})")

    # ── Students
    print(f"👥  Creating {n_students} students…")
    for i in range(1, n_students + 1):
        email = f"loadtest+{i:03d}@{TEST_DOMAIN}"
        uid = _create_user(email, "student", f"Load Test Student {i:03d}")
        if not uid:
            continue
        _ensure_profile_and_role(uid, email, f"Load Test Student {i:03d}", "student")
        token = _sign_in(anon, email)
        registry["students"].append({
            "id": uid, "email": email,
            "password": TEST_PASSWORD, "access_token": token, "role": "student",
        })
        if i % 10 == 0:
            print(f"    …{i}/{n_students}")

    n_ok = sum(1 for s in registry["students"] if s["access_token"])
    print(f"✅  Created {len(registry['students'])} students ({n_ok} with tokens)")
    save_registry(registry)
    print("\nNext: python -m backend.loadtest.simulate_classroom")


# ---------------------------------------------------------------------------
# Teardown
# ---------------------------------------------------------------------------

def teardown() -> None:
    print("🧹  Load-test user pool — teardown")
    print("━" * 44)
    registry = load_registry()
    if not registry:
        print("No registry found — nothing to tear down.")
        return

    users = list(registry.get("students", []))
    if registry.get("professor"):
        users.append(registry["professor"])

    deleted = 0
    for u in users:
        uid = u.get("id")
        if not uid:
            continue
        try:
            # Cascade deletes all learning_events / student_progress / roles /
            # profiles owned by this user.
            supabase_admin.auth.admin.delete_user(uid)
            deleted += 1
        except Exception as e:
            print(f"  ⚠️  delete failed for {u.get('email')}: {e}")

    print(f"✅  Deleted {deleted} test user(s) (cascade removed their rows).")

    # Seeded sample lectures normally cascade-delete with the test professor.
    # But if they were reassigned to a real professor (so the data could be
    # viewed under a normal login), they no longer cascade — delete them by id
    # here so teardown leaves no orphaned sample lectures behind.
    if registry.get("reassigned_to"):
        from backend.core.database import supabase_admin as _admin
        # assignments first (no cascade from courses), then courses, then lectures.
        for a in registry.get("assignments", []):
            try:
                _admin.table("assignments").delete().eq("id", a["id"]).execute()
            except Exception as e:
                print(f"  ⚠️  assignment delete failed for {a.get('id')}: {e}")
        for c in registry.get("courses", []):
            try:
                _admin.table("courses").delete().eq("id", c["id"]).execute()
            except Exception as e:
                print(f"  ⚠️  course delete failed for {c.get('id')}: {e}")
        removed = 0
        for l in registry.get("lectures", []):
            try:
                # Cascades to slides / quiz_questions / any remaining events.
                _admin.table("lectures").delete().eq("id", l["id"]).execute()
                removed += 1
            except Exception as e:
                print(f"  ⚠️  lecture delete failed for {l.get('id')}: {e}")
        print(f"🗑️   Removed {removed} lecture(s), {len(registry.get('courses', []))} "
              f"course(s), {len(registry.get('assignments', []))} assignment(s) "
              f"from {registry['reassigned_to'].get('email')}.")

    try:
        REGISTRY_PATH.unlink()
        print(f"🗑️   Removed {REGISTRY_PATH}")
    except FileNotFoundError:
        pass


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Manage the load-test user pool")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--create", type=int, metavar="N", help="Create N student users (+ 1 professor)")
    group.add_argument("--teardown", action="store_true", help="Delete all users in the registry")
    args = parser.parse_args()

    if args.teardown:
        teardown()
    else:
        create(args.create)
