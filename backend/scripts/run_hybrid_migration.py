import asyncio
import os
from dotenv import load_dotenv
load_dotenv()

from backend.core.database import db_transaction, handle_db_errors

async def run_migration():
    async with handle_db_errors():
        async with db_transaction() as conn:
            with open("supabase/migrations/20260624200000_hybrid_search.sql", "r", encoding="utf-8") as f:
                sql = f.read()
            print("Executing migration...")
            await conn.execute(sql)
            print("Migration applied successfully!")

if __name__ == "__main__":
    asyncio.run(run_migration())
