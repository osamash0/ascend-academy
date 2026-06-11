"""
Locust stress test for the Learnstation backend
================================================

Drives concurrent HTTP load against the local FastAPI backend using the real
access tokens minted by ``students.py``. Two user types:

* ``StudentUser`` — the bulk of the load. Realistic weighted mix of the hot
  paths a student actually triggers through the API: course listing/browsing,
  the personal schedule, and the **AI tutor chat** at a deliberately *low*
  weight so real LLM spend stays small while still measuring true end-to-end
  latency.
* ``ProfessorUser`` — a small slice (low weight ⇒ ~1-2 of 30 users). Hits the
  expensive analytics aggregation endpoints concurrently with student traffic.

Auth: every spawned user grabs a token from ``.students.json``; the backend
caches a verified token for 45s, so each token costs one Auth round-trip then
runs cheap (matches production behaviour).

Run (after `students --create` and `simulate_classroom`)::

    locust -f backend/loadtest/locustfile.py --host http://localhost:8000
    # then open http://localhost:8089, or headless:
    locust -f backend/loadtest/locustfile.py --host http://localhost:8000 \
        --headless --users 30 --spawn-rate 5 --run-time 3m --csv loadtest_report

Note: endpoints are rate-limited (chat 30/min, others 60/min) and all load
comes from one host/IP, so some 429s are expected — they're counted as
"throttled" (success), not failures, since they're the limiter doing its job.
"""

import json
import random
import itertools
import threading
from pathlib import Path

from locust import HttpUser, task, between, events

REGISTRY_PATH = Path(__file__).resolve().parent / ".students.json"

SAMPLE_QUESTIONS = [
    "Can you explain this slide in simpler terms?",
    "What's the key takeaway here?",
    "How does this relate to the previous topic?",
    "Give me an example of this concept.",
    "Why is this important?",
    "What should I focus on for the quiz?",
]
SAMPLE_SLIDE_TEXT = (
    "This slide introduces a core concept of the lecture, with definitions, "
    "a worked example, and a short summary of the key points to remember."
)


def _load_registry() -> dict:
    if not REGISTRY_PATH.exists():
        raise SystemExit(
            f"{REGISTRY_PATH} not found. Run:\n"
            "  python -m backend.loadtest.students --create 30\n"
            "  python -m backend.loadtest.simulate_classroom"
        )
    return json.loads(REGISTRY_PATH.read_text())


_REGISTRY = _load_registry()
_STUDENTS = [s for s in _REGISTRY.get("students", []) if s.get("access_token")]
_PROFESSOR = _REGISTRY.get("professor")
_LECTURES = _REGISTRY.get("lectures", [])

if not _STUDENTS:
    raise SystemExit("No students with tokens in registry. Re-run students --create.")

# Round-robin token assignment so spawned users spread across distinct accounts.
_student_cycle = itertools.cycle(_STUDENTS)
_cycle_lock = threading.Lock()


def _next_student() -> dict:
    with _cycle_lock:
        return next(_student_cycle)


def _check(response, name: str):
    """Treat 2xx as success and 429 (rate-limited) as expected throttling."""
    if response.status_code < 300:
        response.success()
    elif response.status_code == 429:
        # The limiter is working as intended; don't count as a failure.
        response.success()
    else:
        response.failure(f"{name} → HTTP {response.status_code}: {response.text[:200]}")


class StudentUser(HttpUser):
    """A student browsing courses and occasionally asking the AI tutor."""
    weight = 20
    wait_time = between(1, 5)  # think-time between actions

    def on_start(self):
        self.account = _next_student()
        self.client.headers.update({
            "Authorization": f"Bearer {self.account['access_token']}",
            "Content-Type": "application/json",
        })

    @task(10)
    def list_courses(self):
        with self.client.get("/api/courses", name="GET /api/courses",
                             catch_response=True) as r:
            _check(r, "list_courses")

    @task(6)
    def browse_courses(self):
        with self.client.get("/api/courses/browse", name="GET /api/courses/browse",
                             catch_response=True) as r:
            _check(r, "browse_courses")

    @task(4)
    def personal_schedule(self):
        with self.client.get("/api/analytics/personal/optimal-schedule",
                             name="GET /api/analytics/personal/optimal-schedule",
                             catch_response=True) as r:
            _check(r, "personal_schedule")

    @task(1)  # low weight on purpose — real LLM call, real cost
    def ask_ai_tutor(self):
        lecture_id = random.choice(_LECTURES)["id"] if _LECTURES else None
        body = {
            "slide_text": SAMPLE_SLIDE_TEXT,
            "user_message": random.choice(SAMPLE_QUESTIONS),
            "ai_model": "cerebras",
        }
        if lecture_id:
            body["lecture_id"] = lecture_id
        with self.client.post("/api/ai/chat", json=body, name="POST /api/ai/chat",
                              catch_response=True) as r:
            _check(r, "ask_ai_tutor")


class ProfessorUser(HttpUser):
    """A professor watching the analytics dashboards (heavy aggregation reads)."""
    weight = 1  # ~1-2 professors out of ~30 spawned users
    wait_time = between(2, 6)

    def on_start(self):
        if not _PROFESSOR or not _PROFESSOR.get("access_token"):
            self.environment.runner.quit()
            return
        self.client.headers.update({
            "Authorization": f"Bearer {_PROFESSOR['access_token']}",
            "Content-Type": "application/json",
        })

    def _lecture_id(self):
        return random.choice(_LECTURES)["id"] if _LECTURES else None

    @task(5)
    def dashboard(self):
        lid = self._lecture_id()
        if not lid:
            return
        with self.client.get(f"/api/analytics/lecture/{lid}/dashboard",
                             name="GET /api/analytics/lecture/[id]/dashboard",
                             catch_response=True) as r:
            _check(r, "dashboard")

    @task(3)
    def ai_queries(self):
        lid = self._lecture_id()
        if not lid:
            return
        with self.client.get(f"/api/analytics/lecture/{lid}/ai-queries",
                             name="GET /api/analytics/lecture/[id]/ai-queries",
                             catch_response=True) as r:
            _check(r, "ai_queries")

    @task(3)
    def confidence_by_slide(self):
        lid = self._lecture_id()
        if not lid:
            return
        with self.client.get(f"/api/analytics/lecture/{lid}/confidence-by-slide",
                             name="GET /api/analytics/lecture/[id]/confidence-by-slide",
                             catch_response=True) as r:
            _check(r, "confidence_by_slide")

    @task(2)
    def dropoff(self):
        lid = self._lecture_id()
        if not lid:
            return
        with self.client.get(f"/api/analytics/lecture/{lid}/dropoff",
                             name="GET /api/analytics/lecture/[id]/dropoff",
                             catch_response=True) as r:
            _check(r, "dropoff")


@events.test_start.add_listener
def _on_start(environment, **kwargs):
    print(f"🚀  Load test starting — {len(_STUDENTS)} student tokens, "
          f"{'1 professor' if _PROFESSOR else 'no professor'}, "
          f"{len(_LECTURES)} lectures available.")
    if not _LECTURES:
        print("⚠️   No lectures in registry — run simulate_classroom first "
              "(AI-chat grounding and professor analytics will be limited).")
