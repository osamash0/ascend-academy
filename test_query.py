import asyncio
from backend.core.database import supabase_admin

async def main():
    res_all = supabase_admin.table("courses").select("id, title, is_archived").execute()
    print("All courses:", res_all.data)
    
    res_false = supabase_admin.table("courses").select("id, title, is_archived").eq("is_archived", False).execute()
    print("Unarchived courses:", res_false.data)

asyncio.run(main())
