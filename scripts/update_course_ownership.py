import os
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.append(str(Path(__file__).parent.parent))

# Load .env
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")

from supabase import Client, create_client

supabase_admin: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

PROF_EMAIL = "prof@admin.com"
ADMIN_EMAIL = "admin@admin.com"
DEFAULT_PASSWORD = os.environ["SEED_DEFAULT_PASSWORD"]

def get_or_create_user(email, role="professor", full_name="User"):
    user = None
    try:
        res = supabase_admin.auth.admin.create_user({
            "email": email,
            "password": DEFAULT_PASSWORD,
            "email_confirm": True,
            "app_metadata": {"role": role}
        })
        user = res.user
        print(f"Created user {email}")
    except Exception as e:
        if "already been registered" in str(e):
            print(f"User {email} already exists. Finding by iterating...")
            while True:
                try:
                    profile_res = supabase_admin.table("profiles").select("user_id").eq("email", email).execute()
                    if profile_res.data:
                        user_id = profile_res.data[0]['user_id']
                        print(f"Found via profiles: {user_id}")
                        class DummyUser:
                            id = user_id
                        user = DummyUser()
                        break
                except Exception as lookup_err:  # noqa: BLE001 — profiles lookup is a best-effort fallback; any failure just falls through to the list_users scan below
                    print(f"profiles lookup failed for {email}: {lookup_err}")

                users_res = supabase_admin.auth.admin.list_users()
                for u in users_res:
                    if u.email == email:
                        user = u
                        break
                break
            if not user:
                raise RuntimeError("User exists but could not be found.")
        else:
            raise

    try:
        supabase_admin.table("user_roles").upsert({
            "user_id": user.id,
            "role": role
        }).execute()
    except Exception as e:  # noqa: BLE001 — best-effort upsert against an external API; log and continue rather than abort the run
        print(f"role upsert failed for {email}: {e}")

    try:
        supabase_admin.table("profiles").upsert({
            "user_id": user.id,
            "email": email,
            "full_name": full_name
        }).execute()
    except Exception as e:  # noqa: BLE001 — best-effort upsert against an external API; log and continue rather than abort the run
        print(f"profile upsert failed for {email}: {e}")
    
    return user.id

def update_ownership():
    prof_id = get_or_create_user(PROF_EMAIL, "professor", "Informatics Professor")
    admin_id = get_or_create_user(ADMIN_EMAIL, "admin", "Admin")

    print(f"Prof ID: {prof_id}")
    print(f"Admin ID: {admin_id}")

    print("Assigning all courses to admin...")
    supabase_admin.table("courses").update({"professor_id": admin_id}).neq("id", "00000000-0000-0000-0000-000000000000").execute()

    print("Assigning Datenbanksysteme to prof...")
    supabase_admin.table("courses").update({"professor_id": prof_id}).eq("title", "Datenbanksysteme").execute()

    print("Updating lectures ownership...")
    courses = supabase_admin.table("courses").select("id, title").execute()
    for c in courses.data:
        owner = prof_id if c["title"] == "Datenbanksysteme" else admin_id
        supabase_admin.table("lectures").update({"professor_id": owner}).eq("course_id", c["id"]).execute()

    print("Done!")

if __name__ == "__main__":
    update_ownership()
