import asyncio
from backend.core.database import supabase_admin

async def main():
    print("Unarchiving courses...")
    supabase_admin.table("courses").update({"is_archived": False}).neq("id", "00000000-0000-0000-0000-000000000000").execute()
    print("Unarchiving lectures...")
    supabase_admin.table("lectures").update({"is_archived": False}).neq("id", "00000000-0000-0000-0000-000000000000").execute()
    print("Done!")

asyncio.run(main())
