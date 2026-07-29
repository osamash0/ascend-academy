import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    conn = await asyncpg.connect(os.getenv('DATABASE_URL'), statement_cache_size=0)
    
    await conn.execute('''
        DROP POLICY IF EXISTS "Authenticated users browse published courses" ON public.courses;
        DROP POLICY IF EXISTS "Authenticated users browse public lectures" ON public.lectures;
        DROP POLICY IF EXISTS "Authenticated users browse lectures of published courses" ON public.lectures;
    ''')

    print("Reverted policies.")
    await conn.close()

if __name__ == '__main__':
    asyncio.run(main())
