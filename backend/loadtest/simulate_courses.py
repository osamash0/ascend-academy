"""
Course + enrollment simulator — test course↔user interaction + course analytics
================================================================================

Builds the *course* layer on top of the seeded classroom (``simulate_classroom``):

  * creates courses owned by the **test professor** (whose token we control, so
    the professor analytics HTTP endpoints can be verified),
  * assigns the seeded lectures to those courses (``lectures.course_id``),
  * enrolls students two ways so both code paths work:
      - ``course_enrollments``            (the ``POST /enroll`` button path), and
      - ``assignments → assignment_lectures → assignment_enrollments``
        (what ``_student_visible_course_ids`` uses for the student course list),
  * records course/assignment ids in the registry.

Professor analytics (``/professor/overview?course_id=…`` and
``/course/{id}/benchmarks``) read the course's lectures → ``student_progress`` +
``learning_events`` (already seeded), so they light up once lectures are
assigned to a course.

Then ``--publish-to <email>`` flips ownership of the lectures + courses +
assignments to a real professor account so the data shows under a normal login.

Usage::

    # 1. build everything under the test professor (+ verify with its token)
    python -m backend.loadtest.simulate_courses

    # 2. hand it to your real professor account to view in the UI
    python -m backend.loadtest.simulate_courses --publish-to prof@admin.com
"""

import sys
import argparse
import random
from pathlib import Path
from datetime import datetime, timedelta

project_root = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(project_root))

from backend.core.database import supabase_admin
from backend.loadtest.students import load_registry, save_registry

# Which seeded lectures (by title) group into which course.
COURSE_PLAN = [
    {
        "title": "Computer Science Foundations",
        "description": "Core CS: machine learning and data structures.",
        "color": "#6366f1", "icon": "cpu",
        "lectures": ["Introduction to Machine Learning", "Advanced Data Structures"],
        "enroll_fraction": 0.95,
    },
    {
        "title": "Web Engineering",
        "description": "Building and shipping modern web applications.",
        "color": "#10b981", "icon": "globe",
        "lectures": ["Web Development Fundamentals"],
        "enroll_fraction": 0.75,
    },
]


# Flips to False the first time we learn course_enrollments isn't deployed.
_COURSE_ENROLLMENTS_OK = [True]


def _clear_owner_artifacts(owner_id: str) -> None:
    """Delete courses + assignments owned by a professor (test-account cleanup)."""
    courses = supabase_admin.table("courses").select("id").eq("professor_id", owner_id).execute().data or []
    for c in courses:
        supabase_admin.table("courses").delete().eq("id", c["id"]).execute()
    # assignments have no course FK cascade, so remove them explicitly.
    supabase_admin.table("assignments").delete().eq("professor_id", owner_id).execute()
    if courses:
        print(f"  🧹  Cleared {len(courses)} pre-existing course(s) from prior runs.")


def _resolve_user_id(email: str) -> str:
    row = supabase_admin.table("profiles").select("user_id").eq("email", email).single().execute().data
    if not row:
        raise SystemExit(f"No profile found for {email}")
    return row["user_id"]


# ---------------------------------------------------------------------------
# Build (under the test professor)
# ---------------------------------------------------------------------------

def build() -> None:
    print("🏗️   Course + enrollment simulator — build")
    print("━" * 48)
    registry = load_registry()
    if not registry or not registry.get("lectures"):
        raise SystemExit("Run students --create and simulate_classroom first.")

    owner_id = registry["professor"]["id"]            # test professor (we hold its token)
    students = registry.get("students", [])
    lectures = registry["lectures"]                   # [{id, title, slide_ids}]
    title_to_id = {l["title"]: l["id"] for l in lectures}

    # Claim the lectures back under the test professor (they may have been
    # published to a real account by a prior run) so analytics ownership checks
    # pass while we verify.
    for l in lectures:
        supabase_admin.table("lectures").update({"professor_id": owner_id}).eq("id", l["id"]).execute()
    registry.pop("reassigned_to", None)

    # Idempotency: clear any courses/assignments the test professor already owns
    # (e.g. left over from a previous/failed run). The test professor only ever
    # owns load-test artifacts, so this is safe.
    _clear_owner_artifacts(owner_id)

    due_at = (datetime.now().astimezone() + timedelta(days=30)).isoformat()
    courses_out = []
    assignments_out = []

    for plan in COURSE_PLAN:
        lec_ids = [title_to_id[t] for t in plan["lectures"] if t in title_to_id]
        if not lec_ids:
            print(f"  ⚠️  No matching lectures for course '{plan['title']}' — skipping.")
            continue

        course = supabase_admin.table("courses").insert({
            "professor_id": owner_id,
            "title": plan["title"],
            "description": plan["description"],
            "color": plan["color"],
            "icon": plan["icon"],
            "is_archived": False,
        }).execute().data[0]
        course_id = course["id"]
        print(f"📘  Course: {plan['title']}  ({len(lec_ids)} lectures)")

        # Assign lectures to the course.
        for lid in lec_ids:
            supabase_admin.table("lectures").update({"course_id": course_id}).eq("id", lid).execute()

        # Assignment chain (drives student course-list visibility).
        assignment = supabase_admin.table("assignments").insert({
            "professor_id": owner_id,
            "course_id": course_id,
            "title": f"{plan['title']} — Module 1",
            "description": "Auto-generated load-test assignment.",
            "due_at": due_at,
            "min_quiz_score": 60,
        }).execute().data[0]
        assignment_id = assignment["id"]
        for lid in lec_ids:
            supabase_admin.table("assignment_lectures").upsert(
                {"assignment_id": assignment_id, "lecture_id": lid},
                on_conflict="assignment_id,lecture_id",
            ).execute()

        # Enroll a realistic subset of students. The assignment chain drives
        # the student course list; course_enrollments is the newer ``/enroll``
        # path — seed it too when the table exists in this project.
        n_enroll = max(1, round(len(students) * plan["enroll_fraction"]))
        enrolled = random.sample(students, min(n_enroll, len(students)))
        for s in enrolled:
            supabase_admin.table("assignment_enrollments").upsert(
                {"assignment_id": assignment_id, "user_id": s["id"]},
                on_conflict="assignment_id,user_id",
            ).execute()
            if _COURSE_ENROLLMENTS_OK[0]:
                try:
                    supabase_admin.table("course_enrollments").upsert(
                        {"user_id": s["id"], "course_id": course_id},
                        on_conflict="user_id,course_id",
                    ).execute()
                except Exception as e:
                    if "PGRST205" in str(e) or "course_enrollments" in str(e):
                        _COURSE_ENROLLMENTS_OK[0] = False
                        print("    ℹ️   course_enrollments table not present in this "
                              "project — using the assignment chain only.")
                    else:
                        raise
        print(f"    👥  Enrolled {len(enrolled)}/{len(students)} students")

        courses_out.append({"id": course_id, "title": plan["title"], "lecture_ids": lec_ids,
                            "enrolled": [s["id"] for s in enrolled]})
        assignments_out.append({"id": assignment_id, "course_id": course_id})

    registry["courses"] = courses_out
    registry["assignments"] = assignments_out
    save_registry(registry)

    print(f"\n✅  Built {len(courses_out)} course(s) under the test professor.")
    print("   Verify professor analytics + student visibility, then publish:")
    print("   python -m backend.loadtest.simulate_courses --publish-to <your prof email>")


# ---------------------------------------------------------------------------
# Publish (hand ownership to a real professor account)
# ---------------------------------------------------------------------------

def publish(email: str) -> None:
    print(f"🚀  Publishing course data to {email}")
    print("━" * 48)
    registry = load_registry()
    target_id = _resolve_user_id(email)

    for l in registry.get("lectures", []):
        supabase_admin.table("lectures").update({"professor_id": target_id}).eq("id", l["id"]).execute()
    for c in registry.get("courses", []):
        supabase_admin.table("courses").update({"professor_id": target_id}).eq("id", c["id"]).execute()
    for a in registry.get("assignments", []):
        supabase_admin.table("assignments").update({"professor_id": target_id}).eq("id", a["id"]).execute()

    registry["reassigned_to"] = {"email": email, "user_id": target_id}
    save_registry(registry)
    print(f"✅  Lectures + {len(registry.get('courses', []))} course(s) + "
          f"{len(registry.get('assignments', []))} assignment(s) now owned by {email}.")
    print("   Log in as that account → Professor → Courses / Analytics.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Simulate courses + enrollments")
    parser.add_argument("--publish-to", metavar="EMAIL",
                        help="Reassign lectures/courses/assignments to this professor account")
    args = parser.parse_args()
    if args.publish_to:
        publish(args.publish_to)
    else:
        build()
