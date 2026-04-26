import asyncio
from core.database import supabase

async def test():
    lecture_id = "9b8b4fc4-2d0e-48d7-a132-831b6b8d2c79"
    # test getting progress
    progress_res = supabase.table("student_progress").select("*").eq("lecture_id", lecture_id).execute()
    print("progress_res:", progress_res.data)
    
    # test getting events
    events_res = supabase.table("learning_events").select("*").contains("event_data", {"lectureId": lecture_id}).execute()
    print("events_res by contains:", len(events_res.data))
    
    # test getting all events and filtering manually
    all_events_res = supabase.table("learning_events").select("*").execute()
    print("all_events count:", len(all_events_res.data))
    if all_events_res.data:
        print("sample event_data:", all_events_res.data[-1].get("event_data"))
    
asyncio.run(test())
