"""
Seed Service - Generates sample data for analytics dashboard
"""
import uuid
import random
import sys
from pathlib import Path

# Add project root to sys.path
project_root = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(project_root))

from datetime import datetime, timedelta
from backend.core.database import supabase

# Sample data
LECTURE_TITLES = [
    "Introduction to Machine Learning",
    "Advanced Data Structures",
    "Web Development Fundamentals"
]

FIRST_NAMES = ["Emma", "Liam", "Olivia", "Noah", "Ava", "Ethan", "Sophia", "Mason", "Isabella", "William",
               "Mia", "James", "Charlotte", "Benjamin", "Amelia", "Lucas", "Harper", "Henry", "Evelyn", "Alex"]

LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"]

def generate_student_id():
    """Generate a realistic student UUID"""
    return str(uuid.uuid4())

def generate_lecture_with_slides(title, professor_id):
    """Create a lecture with slides"""
    # Create lecture
    lecture_data = {
        "title": title,
        "description": f"An engaging course on {title.lower()}",
        "professor_id": professor_id,
        "total_slides": 10
    }
    
    lecture = supabase.table("lectures").insert(lecture_data).execute()
    lecture_id = lecture.data[0]["id"]
    
    # Create slides
    slides = []
    for i in range(1, 11):
        slide_data = {
            "lecture_id": lecture_id,
            "slide_number": i,
            "title": f"Slide {i}: Key Concept {i}",
            "content_text": f"This slide covers important topic #{i}",
            "summary": f"Summary of concept {i}"
        }
        slide = supabase.table("slides").insert(slide_data).execute()
        slides.append(slide.data[0])
        
        # Create 2 quiz questions per slide
        for q in range(2):
            quiz_data = {
                "slide_id": slide.data[0]["id"],
                "question_text": f"Question {q+1} about concept {i}?",
                "options": ["Option A", "Option B", "Option C", "Option D"],
                "correct_answer": random.randint(0, 3)
            }
            supabase.table("quiz_questions").insert(quiz_data).execute()
    
    return lecture_id, slides

def generate_student_engagement(student_id, lecture_id, slides):
    """Generate realistic engagement events for a student"""
    # Create student progress
    completed_slides = random.sample(range(1, 11), random.randint(5, 10))
    progress_data = {
        "user_id": student_id,
        "lecture_id": lecture_id,
        "completed_slides": completed_slides,
        "last_slide_viewed": max(completed_slides) if completed_slides else 1,
        "xp_earned": len(completed_slides) * 10
    }
    supabase.table("student_progress").insert(progress_data).execute()
    
    # Generate slide view events
    for slide in slides:
        if slide["slide_number"] in completed_slides:
            # Time spent varies (30-300 seconds)
            duration = random.randint(30, 300)
            event_data = {
                "user_id": student_id,
                "event_type": "slide_viewed",
                "event_data": {
                    "slide_id": slide["id"],
                    "slide_number": slide["slide_number"],
                    "duration_seconds": duration
                }
            }
            supabase.table("learning_events").insert(event_data).execute()

def seed_analytics_data(demo_mode=True):
    """Main seeding function
    
    Args:
        demo_mode: If True, creates lectures without professor_id FK constraint
    """
    print("🌱 Starting analytics data seeding...")
    
    if demo_mode:
        print("🎮 Running in DEMO MODE (bypassing professor auth)")
        print("⚠️  Note: Lectures will be created without a real professor")
        
        # For demo, we'll insert directly into database, bypassing FK for now
        # In real usage, lectures need real professor IDs
        lecture_ids = []
        all_slides = []
        
        print("📚 Creating sample lectures...")
        professor_id = "8b2ab13c-a6a9-4894-bef4-77e30c335d48"  # User's actual UUID
        
        for title in LECTURE_TITLES:
            # Insert lecture
            lecture_data = {
                "title": title,
                "description": f"An engaging course on {title.lower()}",
                "professor_id": professor_id,
                "total_slides": 10
            }
            
            try:
                lecture = supabase.table("lectures").insert(lecture_data).execute()
                if lecture.data:
                    lecture_id = lecture.data[0]["id"]
                    lecture_ids.append(lecture_id)
                    
                    # Create slides
                    slides = []
                    for i in range(1, 11):
                        slide_data = {
                            "lecture_id": lecture_id,
                            "slide_number": i,
                            "title": f"Slide {i}: Key Concept {i}",
                            "content_text": f"This slide covers important topic #{i}",
                            "summary": f"Summary of concept {i}"
                        }
                        slide = supabase.table("slides").insert(slide_data).execute()
                        if slide.data:
                            slides.append(slide.data[0])
                            
                            # Create quiz questions
                            for q in range(2):
                                quiz_data = {
                                    "slide_id": slide.data[0]["id"],
                                    "question_text": f"Question {q+1} about concept {i}?",
                                    "options": ["Option A", "Option B", "Option C", "Option D"],
                                    "correct_answer": random.randint(0, 3)
                                }
                                supabase.table("quiz_questions").insert(quiz_data).execute()
                    
                    all_slides.extend(slides)
                    print(f"  ✓ Created: {title}")
                else:
                    print(f"  ⚠️  No data returned for {title}")
            except Exception as e:
                print(f"  ❌ Error creating {title}: {str(e)}")
        
        # Generate virtual students and engagement
        # SKIPPED: Would require creating auth.users entries
        # The analytics will work with just lectures/slides for now
        print("👥 Skipping virtual student data (would need auth setup)")
        student_ids = []
        
        print(f"\n✅ Seeding complete!")
        print(f"   - {len(lecture_ids)} lectures")
        print(f"   - {len(all_slides)} slides")
        if lecture_ids:
            print(f"\n💡 First Lecture ID for testing: {lecture_ids[0]}")
        return
    
    # Original code for real users
    print("👤 Finding professor user...")
    try:
        # Try to find a user from the auth.users table (via Supabase Admin API if possible, or just use the first user found in user_roles)
        # Since we can't easily query auth.users with the standard client service key unless we are admin,
        # we will check the 'user_roles' table which we know the frontend populates.
        
        response = supabase.table("user_roles").select("user_id").eq("role", "professor").limit(1).execute()
        
        if response.data and len(response.data) > 0:
            professor_id = response.data[0]["user_id"]
            print(f"  ✓ Found professor: {professor_id}")
        else:
             # Fallback: try to find ANY user if no professor rule exists yet
            response = supabase.table("user_roles").select("user_id").limit(1).execute()
            if response.data:
                 professor_id = response.data[0]["user_id"]
                 print(f"  ✓ Found user (role unknown): {professor_id}")
            else:
                print("  ⚠️  No users found in 'user_roles'. Please sign up via the app first.")
                print("  💡 Tip: Go to http://localhost:8080/auth")
                return
    except Exception as e:
        print(f"  ❌ Error finding user: {e}")
        return
    
    # Rest of original code
    lecture_ids = []
    all_slides = []
    
    for title in LECTURE_TITLES:
        lecture_id, slides = generate_lecture_with_slides(title, professor_id)
        lecture_ids.append(lecture_id)
        all_slides.extend(slides)
        print(f"  ✓ Created: {title}")
    
    print("👥 Creating virtual students...")
    student_ids = []
    for i in range(20):
        student_id = generate_student_id()
        student_ids.append(student_id)
        
        num_lectures = random.randint(1, 3)
        for lecture_id in random.sample(lecture_ids, num_lectures):
            lecture_slides = [s for s in all_slides if s["lecture_id"] == lecture_id]
            generate_student_engagement(student_id, lecture_id, lecture_slides)
    
    print(f"  ✓ Created {len(student_ids)} virtual students")
    print("\n✅ Seeding complete!")
    print(f"   - {len(lecture_ids)} lectures")
    print(f"   - {len(all_slides)} slides")
    print(f"   - {len(student_ids)} students")
    if lecture_ids:
        print(f"\n💡 Lecture IDs for testing:")
        for lecture_id in lecture_ids:
            print(f"   - {lecture_id}")

if __name__ == "__main__":
    # Disable demo mode to try and find a real user
    seed_analytics_data(demo_mode=False)
