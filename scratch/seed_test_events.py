import os
import sys
from pathlib import Path
from datetime import datetime, timedelta
import random

# Add project root to sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from backend.core.database import supabase

def seed_events():
    # Try to find a user
    res = supabase.table("profiles").select("user_id").limit(1).execute()
    if not res.data:
        print("No users found in database.")
        return
    
    user_id = res.data[0]["user_id"]
    print(f"Seeding events for user: {user_id}")
    
    events = []
    now = datetime.now()
    
    # Seed 50 events over the last 7 days
    for i in range(50):
        # Pick a random hour, but weight it towards 10 AM (hour 10)
        hour = random.choices(range(24), weights=[1,1,1,1,1, 5,10,15,20,25, 50,40,30,20,15, 10,5,5,5,5, 1,1,1,1])[0]
        day_offset = random.randint(0, 7)
        ts = (now - timedelta(days=day_offset)).replace(hour=hour, minute=random.randint(0, 59))
        
        event_type = random.choice(["slide_view", "quiz_attempt", "lecture_start"])
        event_data = {}
        
        if event_type == "slide_view":
            event_data = {"duration_seconds": random.randint(10, 120)}
        elif event_type == "quiz_attempt":
            event_data = {"correct": random.random() > 0.3} # 70% accuracy
            
        events.append({
            "user_id": user_id,
            "event_type": event_type,
            "event_data": event_data,
            "created_at": ts.isoformat()
        })
    
    res = supabase.table("learning_events").insert(events).execute()
    print(f"Inserted {len(res.data)} events.")

if __name__ == "__main__":
    seed_events()
