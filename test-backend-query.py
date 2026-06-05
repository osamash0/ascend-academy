import asyncio
from backend.core.database import supabase_admin
from backend.core.auth_middleware import _is_professor

async def test_courses_query():
    uid = "97be3636-98bc-4cbe-9928-cc400556172e"
    
    class FakeUser:
        def __init__(self, uid):
            self.id = uid
            self.app_metadata = {}
    
    user = FakeUser(uid)
    is_prof = _is_professor(user)
    print(f"Is prof: {is_prof}")
    
    q = supabase_admin.table("courses").select(
        "id, professor_id, title, description, color, icon, is_archived, created_at, updated_at"
    )
    if is_prof:
        q = q.eq("professor_id", uid)
        
    q = q.eq("is_archived", False)
    rows = q.order("created_at", desc=True).execute().data or []
    print(f"Courses length: {len(rows)}")
    print(rows)

asyncio.run(test_courses_query())
