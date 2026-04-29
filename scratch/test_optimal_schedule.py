import os
import sys
from pathlib import Path
from datetime import datetime, timedelta

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from backend.services import analytics_service
from backend.core.database import supabase

def test_optimal_schedule():
    # Try to find a user with events
    res = supabase.table("learning_events").select("user_id").limit(1).execute()
    if not res.data:
        print("No events found in database.")
        return
    
    user_id = res.data[0]["user_id"]
    print(f"Testing for user: {user_id}")
    
    schedule = analytics_service.get_personal_optimal_schedule(user_id)
    print("\nOptimal Schedule Result:")
    import json
    print(json.dumps(schedule, indent=2))

if __name__ == "__main__":
    test_optimal_schedule()
