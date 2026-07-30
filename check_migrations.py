import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    conn = await asyncpg.connect(os.getenv('DATABASE_URL'), statement_cache_size=0)
    
    rows = await conn.fetch("SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 50")
    for r in rows:
        print(r['version'])

    await conn.close()

if __name__ == '__main__':
    asyncio.run(main())
