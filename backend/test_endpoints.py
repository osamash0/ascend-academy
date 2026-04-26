import asyncio
from backend.core.database import supabase
from backend.services.analytics_service import get_dropoff_map, get_confidence_by_slide, get_ai_query_feed

async def test():
    lecture_id = "9b8b4fc4-2d0e-48d7-a132-831b6b8d2c79"
    try:
        dropoff = get_dropoff_map(lecture_id)
        print("Dropoff:", dropoff)
        conf = get_confidence_by_slide(lecture_id)
        print("Conf:", conf)
        ai = get_ai_query_feed(lecture_id)
        print("AI:", ai)
    except Exception as e:
        import traceback
        traceback.print_exc()
        
asyncio.run(test())
