"""
Analytics Mock Data Seeder
--------------------------
Seeds realistic learning_events and student_progress data for the analytics dashboard.
Uses existing lectures + the professor's real user ID (as a mock student) so no
new auth.users need to be created.

Usage:
    cd /Users/abdullahabobaker/Desktop/ascend-academy
    python -m backend.scripts.seed_analytics_mock
"""

import sys
import uuid
import random
from pathlib import Path
from datetime import datetime, timedelta

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(project_root))

from backend.core.database import supabase

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def rand_past_dt(days_back: int = 7) -> str:
    """Random ISO timestamp within the last N days."""
    offset = timedelta(
        days=random.randint(0, days_back),
        hours=random.randint(0, 23),
        minutes=random.randint(0, 59),
    )
    dt = datetime.utcnow() - offset
    return dt.isoformat()


CONFIDENCE_OPTIONS = ["got_it", "unsure", "confused"]
CONFIDENCE_WEIGHTS = [0.55, 0.30, 0.15]   # realistic distribution


# ------------------------------------------------------------------
# Main seeder
# ------------------------------------------------------------------

def seed(user_id: str):
    print("🌱  Analytics Mock Data Seeder")
    print("━" * 40)
    professor_id = user_id
    print(f"👤  Using user   : {professor_id}")

    # ── 2. Find existing lectures ─────────────────────────────────────
    lec_res = supabase.table("lectures").select("id, title, total_slides").execute()
    lectures = lec_res.data or []

    if not lectures:
        print("❌  No lectures found. Please upload at least one lecture via the app first.")
        return

    print(f"📚  Found {len(lectures)} lecture(s)")

    # ── 3. Fetch slides for every lecture ────────────────────────────
    all_slides = {}   # lecture_id -> list of slide dicts
    for lec in lectures:
        sr = supabase.table("slides").select("id, slide_number, title").eq("lecture_id", lec["id"]).execute()
        all_slides[lec["id"]] = sr.data or []

    # ── 4. Use professor + 4 random fake user UUIDs ───────────────────
    mock_users = [professor_id] + [str(uuid.uuid4()) for _ in range(4)]
    print(f"👥  Generating data for {len(mock_users)} mock students")

    events_inserted = 0
    progress_inserted = 0

    for student_id in mock_users:
        # Each student engages with 1-3 lectures
        sample_lectures = random.sample(lectures, min(random.randint(1, 3), len(lectures)))

        for lec in sample_lectures:
            slides = all_slides.get(lec["id"], [])
            if not slides:
                continue

            # How many slides did this student view?
            num_viewed = random.randint(max(1, len(slides) // 2), len(slides))
            viewed_slides = random.sample(slides, num_viewed)
            completed_slide_nums = [s["slide_number"] for s in viewed_slides]

            total_questions = 0
            correct_answers = 0

            # lecture_start event
            supabase.table("learning_events").insert({
                "user_id": student_id,
                "event_type": "lecture_start",
                "event_data": {"lectureId": lec["id"]},
                "created_at": rand_past_dt(7),
            }).execute()
            events_inserted += 1

            for slide in viewed_slides:
                ts = rand_past_dt(7)

                # slide_view
                duration = random.randint(20, 240)
                supabase.table("learning_events").insert({
                    "user_id": student_id,
                    "event_type": "slide_view",
                    "event_data": {
                        "lectureId": lec["id"],
                        "slideId": slide["id"],
                        "slideTitle": slide.get("title") or f"Slide {slide['slide_number']}",
                        "duration_seconds": duration,
                        "timestamp": ts,
                    },
                    "created_at": ts,
                }).execute()
                events_inserted += 1

                # quiz_attempt (70% chance per slide)
                if random.random() < 0.70:
                    correct = random.random() < 0.65   # 65% correct rate
                    time_to_answer = random.randint(5, 45)
                    total_questions += 1
                    if correct:
                        correct_answers += 1

                    supabase.table("learning_events").insert({
                        "user_id": student_id,
                        "event_type": "quiz_attempt",
                        "event_data": {
                            "lectureId": lec["id"],
                            "slideId": slide["id"],
                            "slideTitle": slide.get("title") or f"Slide {slide['slide_number']}",
                            "correct": correct,
                            "time_to_answer_seconds": time_to_answer,
                            "timestamp": ts,
                        },
                        "created_at": ts,
                    }).execute()
                    events_inserted += 1

                # confidence_rating (60% chance per slide)
                if random.random() < 0.60:
                    rating = random.choices(CONFIDENCE_OPTIONS, weights=CONFIDENCE_WEIGHTS)[0]
                    supabase.table("learning_events").insert({
                        "user_id": student_id,
                        "event_type": "confidence_rating",
                        "event_data": {
                            "lectureId": lec["id"],
                            "slideId": slide["id"],
                            "slideTitle": slide.get("title") or f"Slide {slide['slide_number']}",
                            "rating": rating,
                            "timestamp": ts,
                        },
                        "created_at": ts,
                    }).execute()
                    events_inserted += 1

            # Possibly complete the lecture
            if num_viewed == len(slides) or random.random() < 0.4:
                xp = correct_answers * 10
                supabase.table("learning_events").insert({
                    "user_id": student_id,
                    "event_type": "lecture_complete",
                    "event_data": {
                        "lectureId": lec["id"],
                        "xpEarned": xp,
                        "correctAnswers": correct_answers,
                        "total_duration_seconds": random.randint(300, 2400),
                        "completed_at": rand_past_dt(7),
                    },
                    "created_at": rand_past_dt(7),
                }).execute()
                events_inserted += 1

            # student_progress record
            quiz_score = round((correct_answers / total_questions * 100) if total_questions > 0 else 0)
            try:
                supabase.table("student_progress").upsert({
                    "user_id": student_id,
                    "lecture_id": lec["id"],
                    "completed_slides": completed_slide_nums,
                    "quiz_score": quiz_score,
                    "total_questions_answered": total_questions,
                    "correct_answers": correct_answers,
                    "xp_earned": correct_answers * 10,
                }, on_conflict="user_id,lecture_id").execute()
                progress_inserted += 1
            except Exception as e:
                print(f"  ⚠️  student_progress upsert failed: {e}")

    print(f"\n✅  Done!")
    print(f"   {events_inserted}   learning_events inserted")
    print(f"   {progress_inserted}   student_progress records upserted")
    print(f"\n🔗  Open Analytics: http://localhost:8080/professor/analytics")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Seed analytics mock data")
    parser.add_argument(
        "--user-id", required=True,
        help="Your Supabase user UUID (find it in Supabase Dashboard → Authentication → Users)"
    )
    args = parser.parse_args()
    seed(args.user_id)
