import asyncio
from backend.core.database import supabase_admin

async def main():
    print("Checking Database Systems lectures...")
    
    # Get course id for "Database Systems"
    res = supabase_admin.table("courses").select("id").eq("title", "Database Systems").execute()
    if not res.data:
        print("Course not found!")
        return
        
    course_id = res.data[0]["id"]
    print(f"Course ID: {course_id}")
    
    # Get all lectures for this course
    lec_res = supabase_admin.table("lectures").select("id, title, is_archived").eq("course_id", course_id).execute()
    print("Lectures:", lec_res.data)

asyncio.run(main())
