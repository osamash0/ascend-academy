import asyncio
from backend.core.database import supabase_admin

async def fix():
    roles = supabase_admin.table("user_roles").select("*").eq("role", "student").execute()
    student_ids = [r["user_id"] for r in roles.data]
    print(f"Found {len(student_ids)} students in user_roles.")
    
    lectures = supabase_admin.table("lectures").select("*").eq("visibility", "course").execute()
    print(f"Total course lectures: {len(lectures.data)}")
    
    count = 0
    for l in lectures.data:
        if l["professor_id"] in student_ids:
            print(f"Fixing lecture {l['id']}")
            supabase_admin.table("lectures").update({
                "visibility": "private_student",
                "student_owner_id": l["professor_id"],
                "professor_id": None
            }).eq("id", l["id"]).execute()
            count += 1
            
    print(f"Fixed {count} lectures.")

if __name__ == "__main__":
    asyncio.run(fix())
