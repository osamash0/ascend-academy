import asyncio
from backend.core.database import supabase_admin

async def main():
    print("Checking course enrollments...")
    
    # Get all enrollments
    res = supabase_admin.table("course_enrollments").select("*").execute()
    print("Enrollments:", res.data)

asyncio.run(main())
