import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")
supabase = create_client(url, key)

lecture_id = "9b8b4fc4-2d0e-48d7-a132-831b6b8d2c79"

print(f"Checking lecture {lecture_id}...")
res = supabase.table("lectures").select("*").eq("id", lecture_id).execute()
print(f"Lecture data: {res.data}")

if res.data:
    prof_id = res.data[0]["professor_id"]
    print(f"Professor ID: {prof_id}")
    roles = supabase.table("user_roles").select("*").eq("user_id", prof_id).execute()
    print(f"Professor roles: {roles.data}")
else:
    print("Lecture not found!")
