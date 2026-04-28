import asyncio
from core.database import supabase
from services.analytics_service import get_dashboard_data

async def test():
    lecture_id = "9b8b4fc4-2d0e-48d7-a132-831b6b8d2c79"
    try:
        data = get_dashboard_data(lecture_id)
        print("Success! Keys:", data.keys())
    except Exception as e:
        import traceback
        traceback.print_exc()
        
asyncio.run(test())
