import os
import asyncio
import asyncpg
import urllib.parse

with open('.env', 'r') as f:
    for line in f:
        if line.startswith('DATABASE_URL='):
            db_url = line.strip().split('=', 1)[1]
            if db_url.startswith('"') and db_url.endswith('"'):
                db_url = db_url[1:-1]
            break

async def main():
    conn = await asyncpg.connect(db_url)
    rows = await conn.fetch("SELECT policyname, qual FROM pg_policies WHERE tablename IN ('courses', 'lectures');")
    for row in rows:
        print(f"{row['policyname']}: {row['qual']}")
    await conn.close()

if __name__ == '__main__':
    asyncio.run(main())
