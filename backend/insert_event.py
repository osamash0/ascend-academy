import asyncio
from backend.core.database import supabase
from backend.services.analytics_service import get_dashboard_data

async def test():
    lecture_id = "9b8b4fc4-2d0e-48d7-a132-831b6b8d2c79"
    # insert a mock event
    res = supabase.table("learning_events").insert({
        "user_id": "96b5a191-23d3-41bb-92cc-40bfb729623e", # some uuid
        "event_type": "slide_view",
        "event_data": {"lectureId": lecture_id, "slideId": "1", "duration_seconds": 15}
    }).execute()
    print("inserted:", res)
    try:
        data = get_dashboard_data(lecture_id)
        print("Data processed ok!")
    except Exception as e:
        import traceback
        traceback.print_exc()

asyncio.run(test())
