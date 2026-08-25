"""One-off remediation script for the credentials found during the
security-audit branch's Gitleaks investigation (see SECURITY_AUDIT.md, A0):

1. Deletes every Supabase Auth account under the @learnstation.test domain
   (the 152 disposable load-test accounts committed in
   backend/loadtest/.students.json, git history only — that tooling was
   already removed from the codebase in commit 343890c).
2. Rotates the password for admin@admin.com and prof@admin.com to a fresh,
   randomly generated value (these are NOT disposable — they're referenced
   by scripts/seed_courses.py and scripts/update_course_ownership.py) and
   prints it once so it can be saved as SEED_DEFAULT_PASSWORD in your local
   .env. Nothing here ever hardcodes or logs the OLD password.

SAFE BY DEFAULT: running this with no arguments only lists what it WOULD
do. Nothing is deleted or changed until you pass --yes.

Usage:
    python scripts/rotate_exposed_credentials.py            # dry run
    python scripts/rotate_exposed_credentials.py --yes       # actually do it
"""
import os
import secrets
import sys
from pathlib import Path

from dotenv import load_dotenv

_root = Path(__file__).parent.parent
load_dotenv(dotenv_path=_root / "backend" / ".env")
load_dotenv(dotenv_path=_root / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (backend/.env or .env).")
    sys.exit(1)

from supabase import create_client

supabase_admin = create_client(SUPABASE_URL, SUPABASE_KEY)

LOADTEST_DOMAIN = "@learnstation.test"
ROTATE_EMAILS = ("admin@admin.com", "prof@admin.com")


def list_all_users():
    users = []
    page = 1
    while True:
        batch = supabase_admin.auth.admin.list_users(page=page, per_page=200)
        if not batch:
            break
        users.extend(batch)
        page += 1
    return users


def main() -> None:
    dry_run = "--yes" not in sys.argv

    users = list_all_users()
    to_delete = [u for u in users if (u.email or "").endswith(LOADTEST_DOMAIN)]
    to_rotate = [u for u in users if (u.email or "") in ROTATE_EMAILS]

    print(f"Found {len(users)} total accounts.")
    print(f"  {len(to_delete)} disposable load-test accounts ({LOADTEST_DOMAIN}) — will be DELETED.")
    print(f"  {len(to_rotate)} accounts to rotate ({', '.join(ROTATE_EMAILS)}) — password will be RESET, not deleted.")
    if not to_delete and not to_rotate:
        print("Nothing to do.")
        return

    if dry_run:
        print("\nDRY RUN — nothing changed. Re-run with --yes to actually perform this.")
        return

    print("\nDeleting load-test accounts...")
    for u in to_delete:
        try:
            supabase_admin.auth.admin.delete_user(u.id)
            print(f"  deleted {u.email}")
        except Exception as e:  # noqa: BLE001 — best-effort cleanup against an external API; log and continue with the next account
            print(f"  FAILED to delete {u.email}: {e}")

    print("\nRotating passwords...")
    new_password = secrets.token_urlsafe(18)
    for u in to_rotate:
        try:
            supabase_admin.auth.admin.update_user_by_id(u.id, {"password": new_password})
            print(f"  rotated {u.email}")
        except Exception as e:  # noqa: BLE001 — best-effort rotation against an external API; log and continue with the next account
            print(f"  FAILED to rotate {u.email}: {e}")

    print("\nDone. New password for admin@admin.com / prof@admin.com (save this now, it is not logged anywhere else):")
    print(f"  {new_password}")
    print("\nSet this as SEED_DEFAULT_PASSWORD in your local .env before next running")
    print("scripts/seed_courses.py or scripts/update_course_ownership.py.")


if __name__ == "__main__":
    main()
