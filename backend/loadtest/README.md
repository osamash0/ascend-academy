# Load testing & multi-user data simulation

Two related goals, one shared user pool:

1. **Stress test** — drive concurrent HTTP load at the backend and measure
   latency / throughput / error rate (`locustfile.py`).
2. **"How the data looks when many users interact"** — populate a realistic
   classroom so the professor analytics dashboard shows believable data
   (`simulate_classroom.py`).

Both need real Supabase users, because the backend verifies every token against
Supabase Auth and `learning_events` / `student_progress` have a NOT NULL foreign
key to `auth.users`. `students.py` creates that pool.

> ⚠️ **Read before running**
> - These scripts create **real users** in your Supabase project (all under the
>   `@learnstation.test` domain). They are deleted by `--teardown`
>   (`ON DELETE CASCADE` removes all their events/progress too).
> - The Locust **AI tutor** task makes **real LLM calls** through LiteLLM —
>   real cost. It is intentionally low-weight + rate-limited, but the cost is
>   not zero. Use a **dev** Supabase/LiteLLM, never production.
> - `.students.json` holds real (short-lived) access tokens and is gitignored.

## Prerequisites

- `.env` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and an anon key
  (`SUPABASE_ANON_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY`).
- Dev deps installed: `pip install -r backend/requirements.txt -r backend/requirements-dev.txt`
  (adds `locust`).

## Runbook

```bash
cd /Users/abdullahabobaker/Desktop/ascend-academy

# 0. Bring up the local stack (API on :8000)
docker compose up --build            # or: docker compose up redis litellm api -d

# 1. Create the user pool (1 professor + 30 students) → writes .students.json
python -m backend.loadtest.students --create 30

# 2. Simulate a classroom (writes learning_events + student_progress directly)
python -m backend.loadtest.simulate_classroom

# 3a. SEE THE DATA — open the professor analytics dashboard in the frontend
#     (localhost:3000), or hit the API directly:
PROF_TOKEN=$(python -c "import json,pathlib; \
  print(json.loads(pathlib.Path('backend/loadtest/.students.json').read_text())['professor']['access_token'])")
LEC_ID=$(python -c "import json,pathlib; \
  print(json.loads(pathlib.Path('backend/loadtest/.students.json').read_text())['lectures'][0]['id'])")
curl -s -H "Authorization: Bearer $PROF_TOKEN" \
  "http://localhost:8000/api/analytics/lecture/$LEC_ID/dashboard" | jq

# 3b. STRESS TEST — interactive UI at http://localhost:8089
locust -f backend/loadtest/locustfile.py --host http://localhost:8000

#     …or headless with a CSV report:
locust -f backend/loadtest/locustfile.py --host http://localhost:8000 \
  --headless --users 30 --spawn-rate 5 --run-time 3m --csv loadtest_report

# 4. Tear everything down (deletes test users + all cascaded rows)
python -m backend.loadtest.students --teardown
```

## Seeing the data in the professor UI (important)

The seeded lectures are owned by the **test professor** (`loadtest-prof@learnstation.test`).
The professor analytics page (`/professor/analytics`) lists only lectures where
`lectures.professor_id == <the logged-in user>` (`src/services/lectureService.ts`
→ `fetchProfessorLectures`). So logging in as your own account shows nothing
until you point the data at it.

To view the seeded classroom under **your own** professor login, reassign the
sample lectures to your account (student activity is keyed by `lecture_id`, so
only lecture ownership has to change):

```bash
python - <<'PY'
import json, pathlib
from backend.core.database import supabase_admin
TARGET = "prof@admin.com"   # ← your professor email
reg = json.loads(pathlib.Path("backend/loadtest/.students.json").read_text())
uid = supabase_admin.table("profiles").select("user_id").eq("email", TARGET).single().execute().data["user_id"]
for l in reg.get("lectures", []):
    supabase_admin.table("lectures").update({"professor_id": uid}).eq("id", l["id"]).execute()
reg["reassigned_to"] = {"email": TARGET, "user_id": uid}
pathlib.Path("backend/loadtest/.students.json").write_text(json.dumps(reg, indent=2))
print("reassigned", len(reg.get("lectures", [])), "lectures to", TARGET)
PY
```

Then log in as that account → **Professor → Analytics** → pick a lecture.

> **Trade-off:** the Locust `ProfessorUser` tasks authenticate as the *test*
> professor and assert lecture ownership. After reassigning to a real account
> the test professor no longer owns the lectures, so those analytics tasks will
> 403. Either run the **stress test before reassigning**, or treat the student
> tasks as the load and the reassignment as the "view it" step. `--teardown`
> records `reassigned_to` and deletes the moved lectures so nothing is orphaned.

## Courses, enrollment & course-level analytics

`simulate_courses.py` adds the course layer on top of the seeded classroom so
you can test course↔user interaction and **course-level** professor analytics:

```bash
# Build courses, assign lectures, enroll students — under the TEST professor
# (so its token can verify the professor analytics endpoints).
python -m backend.loadtest.simulate_courses

# Hand ownership to your real professor account to view in the UI.
python -m backend.loadtest.simulate_courses --publish-to prof@admin.com
```

What it does:
- Creates 2 courses (`Computer Science Foundations`, `Web Engineering`) and
  assigns the seeded lectures to them (`lectures.course_id`).
- Enrolls a realistic subset of students via the `assignments →
  assignment_lectures → assignment_enrollments` chain (what
  `_student_visible_course_ids` uses for the student course list). It also seeds
  `course_enrollments` *if that table exists in your project* — note the
  `20260604000000_course_enrollments` migration was **not applied** to the
  current Supabase project, so only the assignment chain is used there.

Verified end-to-end (test-professor / student tokens):
- `GET /api/analytics/professor/overview?course_id=…` → active students,
  completion %, quiz accuracy, median time, weakest slide/concept.
- `GET /api/analytics/course/{id}/benchmarks` → current course vs peer courses.
- `GET /api/courses` as an **enrolled** student lists the course; a
  **non-enrolled** student sees none (RLS visibility enforced).

> Same ownership trade-off as lectures: build/verify under the test professor,
> then `--publish-to` your account for viewing. `--teardown` deletes the
> published courses + assignments + lectures recorded in the registry.

## What each piece does

| File | Role |
|------|------|
| `students.py` | Create/teardown the user pool via the service-role admin API; sign users in to capture tokens; maintains `.students.json`. |
| `simulate_classroom.py` | Ensures lectures/slides/quizzes owned by the test professor exist, then writes realistic per-student `learning_events` + `student_progress` (strong / average / struggling cohorts) **directly to Supabase** — no HTTP, so it's fast and free. |
| `locustfile.py` | `StudentUser` (course reads + personal schedule + low-weight real AI chat) and `ProfessorUser` (analytics aggregation reads). Auth via registry tokens. |

## Reading the results

In the Locust UI / CSV, watch:
- **RPS** and **p50 / p95 / p99** per endpoint — analytics dashboards are the
  heavy aggregation reads; AI chat is dominated by LLM latency.
- **Failures** — `429` responses are *not* counted as failures (the rate
  limiter doing its job, expected because all load comes from one host). Real
  failures are 5xx / unexpected 4xx.
- Tail `docker compose logs -f api` during the run for backend errors.

## Tuning

- Scale the classroom: `--create 150` / `--create 500` (slower seed + teardown).
- Concurrency: Locust `--users` / `--spawn-rate` / `--run-time`.
- Student↔professor mix: `weight` on `StudentUser` (20) vs `ProfessorUser` (1).
- AI cost: lower the `@task(1)` weight on `ask_ai_tutor`, or remove it for a
  zero-cost reads-only run.
