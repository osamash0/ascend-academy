import asyncio
from backend.core.database import supabase_admin

async def main():
    print("Checking RLS policies on lectures...")
    res = supabase_admin.rpc(
        "run_sql", 
        {"sql": "SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'lectures';"}
    ).execute()
    # Or just use the supabase_admin connection to execute raw query
    # if there is no run_sql rpc we can't do it easily via python supabase client.
    print(res.data)

asyncio.run(main())
