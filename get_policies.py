import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv('.env')

async def main():
    conn = await asyncpg.connect(os.getenv('DATABASE_URL'), statement_cache_size=0)
    
    # Get policies for courses and lectures
    policies = await conn.fetch('''
        SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check 
        FROM pg_policies 
        WHERE tablename IN ('courses', 'lectures')
    ''')
    
    for p in policies:
        print(f"Table: {p['tablename']}, Policy: {p['policyname']}, Roles: {p['roles']}, Cmd: {p['cmd']}")
        print(f"  Qual: {p['qual']}")
        print(f"  With Check: {p['with_check']}")
        print()

    await conn.close()

if __name__ == '__main__':
    asyncio.run(main())
