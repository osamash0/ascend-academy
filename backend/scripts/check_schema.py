import asyncio
import os
from backend.core.database import get_db_connection

async def main():
    async with await get_db_connection() as conn:
        columns = await conn.fetch("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'slides';")
        print("slides columns:", [dict(c) for c in columns])
        
        columns2 = await conn.fetch("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'lectures';")
        print("lectures columns:", [dict(c) for c in columns2])

if __name__ == "__main__":
    asyncio.run(main())
