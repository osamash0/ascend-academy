import os
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

sys.path.append(str(Path(__file__).parent.parent))

# Load .env
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")

from supabase import create_client, Client
supabase_admin: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

PROF_EMAIL = "prof@admin.com"
ADMIN_EMAIL = "admin@admin.com"
DEFAULT_PASSWORD = "Academy2026!"

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
                except Exception:
                    pass
                
                users_res = supabase_admin.auth.admin.list_users()
                for u in users_res:
                    if u.email == email:
                        user = u
                        break
                break
            if not user:
                raise Exception("User exists but could not be found.")
        else:
            raise e

    try:
        supabase_admin.table("user_roles").upsert({
            "user_id": user.id,
            "role": role
        }).execute()
    except Exception:
        pass
    
    try:
        supabase_admin.table("profiles").upsert({
            "user_id": user.id,
            "email": email,
            "full_name": full_name
        }).execute()
    except Exception:
        pass
    
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
