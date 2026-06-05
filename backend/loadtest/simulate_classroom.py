"""
Classroom data simulator — "how the data looks when many users interact"
=========================================================================

Writes realistic ``learning_events`` + ``student_progress`` rows for every
student in ``.students.json`` (created by ``students.py``), so the professor
analytics dashboard shows a believable full classroom: drop-off curves,
confidence-by-slide, quiz performance, completion rates.

This mirrors what the frontend writes client-side (``src/services/studentService.ts``)
and matches the event_data shapes the analytics aggregations expect (see
``backend/scripts/seed_analytics_mock.sql``). It writes directly to Supabase
via the service-role client — it does NOT go through the HTTP API, so it is
fast and cheap (this is the *data* dimension, not the *load* dimension).

Lectures are owned by the test professor in the registry so the professor's
analytics ownership checks pass. The lecture + slide ids used are written back
into the registry for the Locust stress test to reuse.

Usage::

    cd /Users/abdullahabobaker/Desktop/ascend-academy
    python -m backend.loadtest.simulate_classroom
"""

import sys
import random
from pathlib import Path
from datetime import datetime, timedelta

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(project_root))

from backend.core.database import supabase_admin
from backend.loadtest.students import load_registry, save_registry

CONFIDENCE_OPTIONS = ["got_it", "unsure", "confused"]

# Three cohorts give the dashboard a realistic spread instead of uniform data.
#   (label, correct_rate, view_fraction, confused_weight, complete_chance)
COHORTS = [
    ("strong",     0.85, (0.85, 1.0), [0.80, 0.15, 0.05], 0.90),
    ("average",    0.62, (0.55, 0.9), [0.50, 0.32, 0.18], 0.55),
    ("struggling", 0.38, (0.30, 0.7), [0.25, 0.35, 0.40], 0.20),
]
COHORT_WEIGHTS = [0.30, 0.45, 0.25]


SAMPLE_LECTURES = [
    {
        "title": "Introduction to Machine Learning",
        "description": "Core concepts of supervised and unsupervised learning algorithms",
        "slides": [
            "What is Machine Learning?", "Supervised vs Unsupervised Learning",
            "Linear Regression Fundamentals", "Decision Trees and Random Forests",
            "Neural Network Basics", "Model Training and Validation",
            "Overfitting and Regularisation", "Real-World ML Applications",
        ],
    },
    {
        "title": "Advanced Data Structures",
        "description": "Graphs, trees, heaps, and algorithm complexity analysis",
        "slides": [
            "Review: Arrays and Linked Lists", "Binary Search Trees",
            "Balanced Trees (AVL & Red-Black)", "Graph Representations",
            "BFS and DFS Traversal", "Heaps and Priority Queues",
            "Hash Tables and Collision Handling", "Complexity Analysis (Big-O)",
        ],
    },
    {
        "title": "Web Development Fundamentals",
        "description": "HTML, CSS, JavaScript and the modern web stack",
        "slides": [
            "How the Web Works", "HTML Structure and Semantics",
            "CSS Layout and Flexbox", "JavaScript Basics", "DOM Manipulation",
            "Fetch API and REST", "Intro to React", "Deploying a Web App",
        ],
    },
]


def rand_past_dt(days_back: int = 7) -> str:
    offset = timedelta(
        days=random.randint(0, days_back),
        hours=random.randint(0, 23),
        minutes=random.randint(0, 59),
    )
    return (datetime.utcnow() - offset).isoformat()


def ensure_lectures(professor_id: str) -> list[dict]:
    """Return the test professor's lectures, creating 3 sample ones if none."""
    existing = (
        supabase_admin.table("lectures")
        .select("id, title, total_slides")
        .eq("professor_id", professor_id)
        .execute()
        .data or []
    )
    if existing:
        print(f"📚  Professor already owns {len(existing)} lecture(s) — reusing.")
        return existing

    print("📚  No lectures owned by test professor — creating 3 sample lectures…")
    for mock in SAMPLE_LECTURES:
        n_slides = len(mock["slides"])
        lec = supabase_admin.table("lectures").insert({
            "title": mock["title"],
            "description": mock["description"],
            "professor_id": professor_id,
            "total_slides": n_slides,
        }).execute()
        if not lec.data:
            print(f"  ⚠️  Failed to create lecture: {mock['title']}")
            continue
        lec_id = lec.data[0]["id"]
        print(f"  ✓  {mock['title']}")
        for i, title in enumerate(mock["slides"], start=1):
            slide = supabase_admin.table("slides").insert({
                "lecture_id": lec_id,
                "slide_number": i,
                "title": title,
                "content_text": f"## {title}\n\nKey concepts and detailed explanation for this topic.",
                "summary": f"This slide covers {title.lower()}.",
            }).execute()
            if slide.data:
                supabase_admin.table("quiz_questions").insert({
                    "slide_id": slide.data[0]["id"],
                    "question_text": f"Which of the following best describes '{title}'?",
                    "options": ["The correct explanation", "An incorrect alternative",
                                "A misleading option", "None of the above"],
                    "correct_answer": 0,
                }).execute()

    return (
        supabase_admin.table("lectures")
        .select("id, title, total_slides")
        .eq("professor_id", professor_id)
        .execute()
        .data or []
    )


def simulate_student(student_id: str, lectures: list[dict], slides_by_lec: dict) -> tuple[int, int]:
    """Seed one student's activity. Returns (events, progress_rows)."""
    label, correct_rate, view_frac, conf_weights, complete_chance = random.choices(
        COHORTS, weights=COHORT_WEIGHTS
    )[0]

    events = 0
    progress = 0
    # Each student engages with 1-3 lectures.
    sample = random.sample(lectures, min(random.randint(1, 3), len(lectures)))

    for lec in sample:
        slides = slides_by_lec.get(lec["id"], [])
        if not slides:
            continue

        lo = max(1, int(len(slides) * view_frac[0]))
        hi = max(lo, int(len(slides) * view_frac[1]))
        num_viewed = random.randint(lo, min(hi, len(slides)))
        viewed = sorted(random.sample(slides, num_viewed), key=lambda s: s["slide_number"])

        total_q = 0
        correct = 0

        supabase_admin.table("learning_events").insert({
            "user_id": student_id, "event_type": "lecture_start",
            "event_data": {"lectureId": lec["id"]}, "created_at": rand_past_dt(),
        }).execute()
        events += 1

        for slide in viewed:
            ts = rand_past_dt()
            title = slide.get("title") or f"Slide {slide['slide_number']}"
            supabase_admin.table("learning_events").insert({
                "user_id": student_id, "event_type": "slide_view",
                "event_data": {
                    "lectureId": lec["id"], "slideId": slide["id"], "slideTitle": title,
                    "duration_seconds": random.randint(20, 240), "timestamp": ts,
                }, "created_at": ts,
            }).execute()
            events += 1

            if random.random() < 0.75:
                is_correct = random.random() < correct_rate
                total_q += 1
                correct += 1 if is_correct else 0
                supabase_admin.table("learning_events").insert({
                    "user_id": student_id, "event_type": "quiz_attempt",
                    "event_data": {
                        "lectureId": lec["id"], "slideId": slide["id"], "slideTitle": title,
                        "correct": is_correct, "time_to_answer_seconds": random.randint(5, 45),
                        "timestamp": ts,
                    }, "created_at": ts,
                }).execute()
                events += 1

            if random.random() < 0.65:
                rating = random.choices(CONFIDENCE_OPTIONS, weights=conf_weights)[0]
                supabase_admin.table("learning_events").insert({
                    "user_id": student_id, "event_type": "confidence_rating",
                    "event_data": {
                        "lectureId": lec["id"], "slideId": slide["id"],
                        "slideTitle": title, "rating": rating, "timestamp": ts,
                    }, "created_at": ts,
                }).execute()
                events += 1

        completed = num_viewed == len(slides) or random.random() < complete_chance
        if completed:
            supabase_admin.table("learning_events").insert({
                "user_id": student_id, "event_type": "lecture_complete",
                "event_data": {
                    "lectureId": lec["id"], "xpEarned": correct * 10,
                    "correctAnswers": correct,
                    "total_duration_seconds": random.randint(300, 2400),
                    "completed_at": rand_past_dt(),
                }, "created_at": rand_past_dt(),
            }).execute()
            events += 1

        quiz_score = round(correct / total_q * 100) if total_q else 0
        try:
            supabase_admin.table("student_progress").upsert({
                "user_id": student_id, "lecture_id": lec["id"],
                "completed_slides": [s["slide_number"] for s in viewed],
                "quiz_score": quiz_score, "total_questions_answered": total_q,
                "correct_answers": correct, "xp_earned": correct * 10,
                "last_slide_viewed": viewed[-1]["slide_number"] if viewed else 1,
                "completed_at": rand_past_dt() if completed else None,
            }, on_conflict="user_id,lecture_id").execute()
            progress += 1
        except Exception as e:
            print(f"  ⚠️  student_progress upsert failed: {e}")

    return events, progress


def main() -> None:
    print("🏫  Classroom data simulator")
    print("━" * 44)
    registry = load_registry()
    if not registry or not registry.get("professor"):
        raise SystemExit("No registry found. Run: python -m backend.loadtest.students --create 30")

    professor_id = registry["professor"]["id"]
    students = registry.get("students", [])
    if not students:
        raise SystemExit("No students in registry.")

    lectures = ensure_lectures(professor_id)
    if not lectures:
        raise SystemExit("Could not find or create any lectures.")

    slides_by_lec: dict[str, list] = {}
    for lec in lectures:
        slides_by_lec[lec["id"]] = (
            supabase_admin.table("slides")
            .select("id, slide_number, title")
            .eq("lecture_id", lec["id"])
            .order("slide_number")
            .execute().data or []
        )

    print(f"👥  Simulating activity for {len(students)} students across {len(lectures)} lectures…")
    total_events = 0
    total_progress = 0
    for idx, student in enumerate(students, start=1):
        e, p = simulate_student(student["id"], lectures, slides_by_lec)
        total_events += e
        total_progress += p
        if idx % 10 == 0:
            print(f"    …{idx}/{len(students)} students")

    # Persist lecture/slide ids so the Locust file can ground AI chat + query
    # analytics without re-discovering them.
    registry["lectures"] = [
        {"id": lec["id"], "title": lec["title"],
         "slide_ids": [s["id"] for s in slides_by_lec.get(lec["id"], [])]}
        for lec in lectures
    ]
    save_registry(registry)

    print(f"\n✅  Done!")
    print(f"   {total_events}  learning_events inserted")
    print(f"   {total_progress}  student_progress rows upserted")
    print(f"   {len(lectures)}  lectures available for analytics")
    print("\nView it: open the professor analytics dashboard, or")
    print("  curl -H \"Authorization: Bearer <prof token>\" \\")
    print(f"    http://localhost:8000/api/analytics/lecture/{lectures[0]['id']}/dashboard")


if __name__ == "__main__":
    main()
