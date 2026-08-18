import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    conn = await asyncpg.connect(os.getenv('DATABASE_URL'), statement_cache_size=0)
    
    await conn.execute('''
        DROP POLICY IF EXISTS "Authenticated users browse published courses" ON public.courses;
        CREATE POLICY "Authenticated users browse published courses"
        ON public.courses FOR SELECT
        TO authenticated
        USING (status = 'published' AND is_archived = false);

        DROP POLICY IF EXISTS "Authenticated users browse public lectures" ON public.lectures;
        CREATE POLICY "Authenticated users browse public lectures"
        ON public.lectures FOR SELECT
        TO authenticated
        USING (is_archived = false);
    ''')

    print("Added policies successfully.")
    await conn.close()

if __name__ == '__main__':
    asyncio.run(main())
