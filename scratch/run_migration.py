"""
Run the lecture_mind_maps migration via Supabase REST API.
Requires SUPABASE_SERVICE_KEY in .env (different from the anon key).
"""
import os
import sys
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

url = os.getenv("SUPABASE_URL")
service_key = os.getenv("SUPABASE_SERVICE_KEY")

if not service_key:
    print("❌  SUPABASE_SERVICE_KEY not found in .env")
    print()
    print("To get your service role key:")
    print("  1. Go to https://supabase.com/dashboard")
    print("  2. Select your project (lkiiideqjoiksnycgplc)")
    print("  3. Settings → API")
    print("  4. Copy the 'service_role' key (NOT the anon key)")
    print()
    print("Then add this line to your .env file:")
    print('  SUPABASE_SERVICE_KEY="eyJ..."')
    sys.exit(1)

sql = open("supabase/migrations/20260426_lecture_mind_maps.sql").read()

res = requests.post(
    f"{url}/rest/v1/rpc/query" ,
    headers={
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    },
    json={"query": sql}
)

# The Supabase REST API doesn't expose raw SQL — use the pg endpoint
res2 = requests.post(
    f"{url}/pg",
    headers={
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/sql",
    },
    data=sql.encode()
)

print(f"Status: {res2.status_code}")
print(res2.text[:500])
