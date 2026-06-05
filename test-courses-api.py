import asyncio
import httpx
from backend.core.database import supabase_admin

async def test_api():
    # 1. Create a session for the user using supabase admin
    print("Creating session...")
    res = supabase_admin.auth.admin.create_session({
        "user_id": "97be3636-98bc-4cbe-9928-cc400556172e"
    })
    token = res.session.access_token
    print(f"Token: {token[:20]}...")
    
    # 2. Call the courses API
    print("Calling /api/courses...")
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "http://localhost:8000/api/courses",
            headers={"Authorization": f"Bearer {token}"}
        )
        print("Status:", resp.status_code)
        print("Response:", resp.text)

asyncio.run(test_api())
