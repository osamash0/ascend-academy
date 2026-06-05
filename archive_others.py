import asyncio
from backend.core.database import supabase_admin

async def main():
    print("Archiving all courses except Database Systems...")
    
    # We will fetch all courses, and then archive the ones that are not "Database Systems"
    res = supabase_admin.table("courses").select("id, title").execute()
    
    for course in res.data:
        if course["title"] != "Database Systems":
            print(f"Archiving: {course['title']} ({course['id']})")
            supabase_admin.table("courses").update({"is_archived": True}).eq("id", course["id"]).execute()
            # Also optionally archive their lectures, though not strictly required for onboarding visibility
            supabase_admin.table("lectures").update({"is_archived": True}).eq("course_id", course["id"]).execute()
            
    print("Done!")

asyncio.run(main())
