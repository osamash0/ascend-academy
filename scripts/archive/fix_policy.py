import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    conn = await asyncpg.connect(os.getenv('DATABASE_URL'), statement_cache_size=0)
    
    rows = await conn.fetch("SELECT DISTINCT visibility FROM lectures")
    for r in rows:
        print(f"Visibility: {r['visibility']}")

    # Let's fix the policy to avoid data leak!
    await conn.execute('''
        DROP POLICY IF EXISTS "Authenticated users browse public lectures" ON public.lectures;
        CREATE POLICY "Authenticated users browse public lectures"
        ON public.lectures FOR SELECT
        TO authenticated
        USING (is_archived = false AND visibility = 'public');
    ''')

    print("Fixed policy.")
    await conn.close()

if __name__ == '__main__':
    asyncio.run(main())
