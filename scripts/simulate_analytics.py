import asyncio
import os
import random
import uuid
from datetime import datetime, timedelta

os.environ.setdefault("APP_ENV", "development")
from backend.core.database import supabase_admin as supabase

LECTURE_ID = "6d2b028b-e4a7-4b95-9627-a8a06f533387"
NUM_STUDENTS = 20

async def generate_simulated_data():
    print(f"🚀 Starting simulation for lecture {LECTURE_ID}...")

    # Fetch Lecture & Slides
    res = supabase.table("lectures").select("*").eq("id", LECTURE_ID).execute()
    if not res.data:
        print(f"❌ Error: Lecture {LECTURE_ID} not found.")
        return
    lecture = res.data[0]

    res = supabase.table("slides").select("id, slide_number, slide_type").eq("lecture_id", LECTURE_ID).order("slide_number").execute()
    slides = res.data
    total_slides = len(slides)

    # Fetch existing users or create simulated ones
    fake_students = []
    print(f"⏳ Creating {NUM_STUDENTS} simulated students...")
    for i in range(NUM_STUDENTS):
        email = f"sim_user_{uuid.uuid4().hex[:8]}@example.com"
        try:
            user_res = supabase.auth.admin.create_user({
                "email": email,
                "password": "Password123!",
                "email_confirm": True,
                "user_metadata": {"role": "student"}
            })
            user_id = user_res.user.id
            fake_students.append(user_id)
            try:
                supabase.table("profiles").update({"full_name": f"Simulated Student {i+1}"}).eq("user_id", user_id).execute()
            except Exception:
                pass
        except Exception as e:
            continue

    print(f"✅ Generated {len(fake_students)} students. Simulating learning events...")

    for user_id in fake_students:
        session_id = str(uuid.uuid4())
        base_time = datetime.utcnow() - timedelta(days=random.randint(0, 7))

        max_slide_reached = total_slides if random.random() < 0.8 else random.randint(1, total_slides)
        visited_slides = []

        for i, slide in enumerate(slides[:max_slide_reached]):
            slide_num = slide["slide_number"]
            visited_slides.append(slide_num)
            
            # Simulate time passing
            time_spent = random.randint(15, 180)
            base_time += timedelta(seconds=time_spent)

            # 1. Slide View Event
            supabase.table("learning_events").insert({
                "user_id": user_id,
                "event_type": "slide_view",
                "event_data": {
                    "lecture_id": LECTURE_ID,
                    "slide_id": slide["id"],
                    "slide_number": slide_num,
                    "session_id": session_id,
                    "time_spent_seconds": time_spent
                },
                "created_at": base_time.isoformat()
            }).execute()

            # 2. Slide Confidence Feedback
            if random.random() < 0.2:
                supabase.table("learning_events").insert({
                    "user_id": user_id,
                    "event_type": "slide_confidence",
                    "event_data": {
                        "lecture_id": LECTURE_ID,
                        "slide_id": slide["id"],
                        "slide_number": slide_num,
                        "confidence": random.choice(["got_it", "got_it", "unsure", "confused"])
                    },
                    "created_at": base_time.isoformat()
                }).execute()

            # 3. AI Query Event
            if random.random() < 0.1:
                supabase.table("learning_events").insert({
                    "user_id": user_id,
                    "event_type": "ai_query",
                    "event_data": {
                        "lecture_id": LECTURE_ID,
                        "slide_id": slide["id"],
                        "slide_number": slide_num,
                        "query": "Can you explain this in simpler terms?",
                        "response_time_ms": random.randint(800, 3000)
                    },
                    "created_at": base_time.isoformat()
                }).execute()

            # 4. Quiz Answer Event
            if slide["slide_type"] == "quiz":
                is_correct = random.random() < 0.6
                supabase.table("learning_events").insert({
                    "user_id": user_id,
                    "event_type": "quiz_answer",
                    "event_data": {
                        "lecture_id": LECTURE_ID,
                        "slide_id": slide["id"],
                        "slide_number": slide_num,
                        "question_id": slide["id"],
                        "is_correct": is_correct,
                        "attempt_number": 1,
                        "selected_option": random.randint(0, 3)
                    },
                    "created_at": base_time.isoformat()
                }).execute()
        
        # Update progress table
        supabase.table("student_progress").upsert({
            "user_id": user_id,
            "lecture_id": LECTURE_ID,
            "completed_slides": visited_slides,
            "last_slide_viewed": max_slide_reached,
        }).execute()

    print("🎉 Simulation complete! Check the Professor Dashboard.")

if __name__ == "__main__":
    asyncio.run(generate_simulated_data())
