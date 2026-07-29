import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    conn = await asyncpg.connect(os.getenv('DATABASE_URL'), statement_cache_size=0)
    
    await conn.execute('''
        DROP POLICY IF EXISTS "Authenticated users browse public lectures" ON public.lectures;
        DROP POLICY IF EXISTS "Authenticated users browse lectures of published courses" ON public.lectures;
        
        CREATE POLICY "Authenticated users browse lectures of published courses"
        ON public.lectures FOR SELECT
        TO authenticated
        USING (
            visibility = 'course' 
            AND EXISTS (
                SELECT 1 FROM public.courses c 
                WHERE c.id = lectures.course_id 
                  AND c.status = 'published' 
                  AND c.is_archived = false
            )
        );
    ''')

    print("Added correct lectures policy.")
    await conn.close()

if __name__ == '__main__':
    asyncio.run(main())
