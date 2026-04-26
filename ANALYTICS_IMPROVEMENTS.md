# Analytics Improvements

## Bug Fixes

### `backend/services/analytics_service.py`

| Bug | Location | Fix |
|-----|----------|-----|
| `return sorted(students, ...)` — `students` variable never defined | `get_quiz_analytics()` L171 | Changed to `sorted(quiz_analytics, ...)` |
| `event_type = 'slide_viewed'` — wrong event type | `get_lecture_overview()` L57 | Changed to `'slide_view'` |
| `event_type = 'slide_viewed'` — wrong event type | `get_slide_analytics()` L99 | Changed to `'slide_view'` |
| `event_data.get("slide_id")` — key is camelCase in DB | `get_slide_analytics()` L106 | Changed to `event_data.get("slideId")` |
| `total_students` used before assignment | `get_slide_analytics()` L114 | Added `student_progress` fetch at function top |
| `get_student_performance()` function missing — `/students` endpoint crashed with 500 | `analytics_service.py` | Implemented the function |

---

## New Backend Service Functions

### `get_student_performance(lecture_id, token)`
Returns anonymized per-student breakdown: progress %, quiz score, typology classification, AI query count, revision count. Extracted from `get_dashboard_data()` into a standalone function so `/students` endpoint works.

### `get_distractor_analysis(lecture_id, token)`
Aggregates `selectedAnswer` from `quiz_attempt` events per question. Returns `answer_distribution` (index → count) and `most_common_wrong_answer`. Helps professors identify which wrong options students gravitate to — signals ambiguous distractors or conceptual gaps.

### `get_dropoff_map(lecture_id, token)`
Queries `student_progress.last_slide_viewed` for students where `completed_at IS NULL`. Groups by slide number to show exactly where students abandoned the lecture. `last_slide_viewed` was tracked but never analyzed.

### `get_confidence_by_slide(lecture_id, token)`
Groups `confidence_rating` events by `slideId` to produce per-slide got_it/unsure/confused counts + `confusion_rate`. Previously only an aggregate total was shown; this gives per-slide granularity.

### `get_ai_query_feed(lecture_id, token)`
Returns latest 50 `ai_tutor_query` events with `query_text` and `slide_title` (no user IDs). The query text was collected in every AI interaction but never exposed to professors. This is the clearest direct signal of what students don't understand.

### `get_dashboard_data()` — extended
Added `completionTimes` field: buckets `lecture_complete` events by `total_duration_seconds` into `< 5min`, `5–15min`, `15–30min`, `> 30min`. Spikes in the fast bucket indicate students are skipping content.

---

## New API Endpoints

All endpoints: require professor auth, assert lecture ownership via `_assert_lecture_owner`, use specific columns (no `select('*')`), limit event queries.

| Endpoint | Description |
|----------|-------------|
| `GET /api/analytics/lecture/{id}/distractors` | Wrong-answer distribution per quiz question |
| `GET /api/analytics/lecture/{id}/dropoff` | Slide-level dropout map for non-completers |
| `GET /api/analytics/lecture/{id}/confidence-by-slide` | Per-slide confidence rating breakdown |
| `GET /api/analytics/lecture/{id}/ai-queries` | Latest 50 student AI tutor query texts (anonymized) |

Pydantic response models added: `StudentPerformanceItem`, `QuizAnalyticsItem`, `SlideAnalyticsItem`, `DistractorQuestion`, `DropoffPoint`, `SlideConfidence`, `AIQueryItem`, `AnalyticsListResponse`.

---

## Frontend Changes (`src/pages/ProfessorAnalytics.tsx`)

### Fixes
- `API_BASE` hardcoded to `http://localhost:8000` → now uses `import.meta.env.VITE_API_URL` with fallback
- Integrated existing `useAnalytics` hook (was unused) to pull `studentsMatrix`, `funnel`, `slidePerformance`, `completionTimes` from `/dashboard`

### New Sections Added

| Section | Data Source | What It Shows |
|---------|-------------|---------------|
| **7-Day Activity Timeline** | `activityByDay` (was computed but never rendered) | Quiz attempts per day of the week |
| **Score Distribution** | `scoreDistribution` (was computed but never rendered) | Student count per score band (0–20%, …, 81–100%) — color graded red→green |
| **Student Cohort Table** | `useAnalytics` → `studentsMatrix` | Anonymized table: progress bar, quiz score, typology badge, AI queries, revisions |
| **Completion Funnel** | `useAnalytics` → `funnel` | Animated funnel: Started → Midpoint → Completed with drop-off % labels |
| **Completion Time Distribution** | `useAnalytics` → `completionTimes` | Histogram of how long students take; < 5min bars flagged in amber |
| **Slide Confusion Index** | `useAnalytics` → `slidePerformance.confusionIndex` | Color-coded bar chart (red/yellow/green) showing computed friction per slide |
| **Where Students Quit** | `GET /dropoff` | Drop-off count per slide for non-completers; >20% dropout highlighted red |
| **Confidence By Slide** | `GET /confidence-by-slide` | Stacked bar chart per slide showing got_it/unsure/confused split |
| **Student Questions Feed** | `GET /ai-queries` | Scrollable feed of actual student questions to the AI tutor, grouped by slide |

### Loading & Empty States
Every new section has:
- Skeleton placeholders while data loads
- Meaningful empty state message when no data exists (not a blank panel)

---

## Data Traceability

Every feature is grounded in existing collected data:

| Feature | DB Source |
|---------|-----------|
| Drop-off map | `student_progress.last_slide_viewed` |
| Completion times | `learning_events` where `event_type='lecture_complete'`, field `total_duration_seconds` |
| Per-slide confidence | `learning_events` where `event_type='confidence_rating'`, field `slideId` |
| AI query feed | `learning_events` where `event_type='ai_tutor_query'`, field `query` |
| Distractor analysis | `learning_events` where `event_type='quiz_attempt'`, field `selectedAnswer` |
| Student typology | `student_progress` + `learning_events` (already computed in backend, now displayed) |
| Confusion index | `learning_events` (AI queries × 30 + revisions × 15 + quiz failures × 10) — already computed, now displayed |
| Score distribution | `student_progress.quiz_score` — already fetched, now visualized |
| Activity timeline | `learning_events.created_at` — already fetched, now visualized |
