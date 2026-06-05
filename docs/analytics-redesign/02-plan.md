# Professor Analytics Redesign — Implementation Plan

> Phase 3 deliverable. Grounded in the actual code. Builds on [00-brief.md](00-brief.md) + [01-design.md](01-design.md).
> Status: **DRAFT for review** before implementation.

---

## 0. Ground truth (from reading the code)

**Backend** — `backend/services/analytics_service.py` has two computation styles:
- **Per-feature functions** (`_compute_slide_analytics`, `_compute_confidence_by_slide`, `_compute_quiz_analytics`, `_compute_distractor_analysis`, `_compute_retry_performance`, `_compute_dropoff_map`, `_compute_ai_query_feed`, `_compute_student_performance`) — Supabase client + `_fetch_all()`, each wrapped in `analytics_cache.get_or_compute(...)`.
- **Dashboard** (`_compute_dashboard_data`, async) — raw SQL over the asyncpg pool via `get_db_connection()`; the only thing the current frontend reads.
- slide↔quiz join already works: `qid_to_slide` from `quiz_questions.select("id, slide_id, ...")` and SQL `JOIN slides s ON s.id = q.slide_id`. FK confirmed.
- Cache: `analytics_cache.get_or_compute(lecture_id, view_name, fn, ttl_seconds=300)`; `invalidate(lecture_id)` already wired into event writes.

**Frontend** — `src/pages/ProfessorAnalytics.tsx` (1348 lines) reads only the dashboard via `useAnalytics`. Routes `App.tsx:190/200`: `/professor/analytics` (picker) + `/professor/analytics/:lectureId` (detail).

**Event emission** — all slide-scoped events already carry `slideId` **except `ai_tutor_query`** (`LectureChat.tsx:238`, sends only `slideTitle`). No `sessionId` anywhere. AI response text unstored.

| Event | Site | slideId | sessionId |
|---|---|---|---|
| slide_view | LectureView.tsx:132 | ✅ | ❌ |
| confidence_rating | LectureView.tsx:880 | ✅ | ❌ |
| slide_back_navigation | LectureView.tsx:411 | ✅ from/to | ❌ |
| quiz_attempt / retry | LectureView.tsx:441/621 | via questionId | ❌ |
| ai_tutor_query | **LectureChat.tsx:238** | ❌ slideTitle only | ❌ |

---

## 1. Backend insight engine

New package `backend/services/insights/`:
- `schema.py` — Pydantic `Insight`, `InsightKind` (11 values, §6 of design), `Attention` (calm/watch/act), `EvidenceKind`, `InsightCue`, `TargetRef`. Mirrors the TS `Insight` interface exactly (one wire contract).
- `bundle.py` — `build_metric_bundle(lecture_id, token)`: composes existing cached aggregates (same approach as `_compute_lecture_benchmark_metrics`) + one new asyncpg block `_compute_insight_metrics` for the gaps below.
- `detectors.py` — one **pure** function per kind (bundle→insights), unit-testable like `_calculate_retry_performance`. Each returns `severity∈[0,1]` and a min-sample guard.
- `copy.py` — templated headline/summary/interpretation per kind (the §5 instant baseline).
- `engine.py` — `build_insights(...)`: gather bundle → run detectors → score/band/sort → attach copy → return ranked `Insight[]`.

### Coverage — computable now vs. needs new SQL
| Kind | Now? | Gap |
|---|---|---|
| Confusion Hotspot | ✅ | (exact after Phase 0 slideId) |
| Silent Strugglers | ✅ | none (`get_student_performance`) |
| Leaky Bucket | ✅ | none (`get_dropoff_map`) |
| Confusion Block | ✅ | moving avg over confidence-by-slide (pure Python) |
| Quiz Misalignment | ✅ | none |
| Healthy/Positive | ✅ | derived when nothing ≥ watch |
| Silent Misleader | ⚠️ | first-attempt accuracy rolled up to **slide** (small) |
| Skipped Slide | ⚠️ | **median/IQR dwell** (current code uses mean — kill-list rejects) |
| Speed Bump | ⚠️ | **directional** back-nav counts (from i+1→i) |
| Overpacked | ⚠️ | dwell **bimodality** (+ revisit = Tier 1) |
| Calibration Gap | ⚠️ | **per-student confidence×quiz join** (biggest gap; v1 = slide-level approximation) |

**4 new SQL aggregations** (asyncpg, `_compute_dashboard_data` style, one DB block in `bundle.py`): median/IQR/CV dwell per slide (`percentile_cont`); first-attempt accuracy per slide; directional back-nav `(fromSlideId,toSlideId)`; calibration pairs per `(user_id, slide_id)`.

### Severity, endpoint, caching
- `severity = magnitude × reach`, normalized **per kind**; band → attention (teal/sand/coral). Sort desc; top 3–4 = calm view, rest under "show all".
- Min-sample guard in every detector (reuse `insufficient_data` discipline from `compute_slide_recommendation`).
- Endpoint `GET /api/analytics/lecture/{id}/insights` in `backend/api/analytics.py`, mirroring `get_dashboard_data` (async, `_assert_lecture_owner` first, `AnalyticsResponse` envelope). Service `get_lecture_insights` → `analytics_cache.get_or_compute_async(lecture_id, "insights", ..., ttl=300)`. Reuses existing cache table + invalidation — no new wiring.
- Deeper narration = **existing** `POST /api/ai/analytics-insights` (`ai_content.py:252`), opt-in from Layer 2/3 only. No new AI endpoint.

---

## 2. Frontend decomposition

Routes + picker preserved. Extract `LecturePicker` out of the monolith into `src/features/analytics/components/LecturePicker.tsx` (keep `fetchProfessorLectures` + navigate). New package `src/features/analytics/garden/`:

```
ProfessorAnalytics.tsx (thin shell: picker vs garden)
└─ <InsightGarden lectureId>
   ├─ useInsights(lectureId)            // TanStack Query, mirrors useAnalytics
   ├─ <GardenAmbient/>                  // cheap static gradient backdrop
   ├─ <AtRiskBanner/>                   // ambient at-risk line
   ├─ <GardenFeed>                      // top 3–4 + "show all findings"
   │   └─ <InsightCard/> xN             // rest → expanded; owns Layer 2
   │       ├─ <Layer2Viz kind=…/>       // per-kind dispatcher
   │       └─ <EvidenceDrawer/>         // Layer 3, mounts inside expanded
   └─ <HealthyEmptyState/>
```
- **State machine** (`useGardenState`): `garden → expanded(id) → evidence(id,kind)`; single `back()` pops one layer. Layers are in-place — no router change.
- **Motion:** Framer Motion `layout`/`layoutId` for expand-in-place; `AnimatePresence` for sibling fade; `MotionConfig reducedMotion="user"`.
- **Per-kind Layer-2 viz** (`garden/viz/`, honest 2D, muted palette): ConfusionWaveChart, ConfidenceAccuracyDotPlot, Confidence2x2, EngagementDropBar, TransitionFrictionView, DwellCloudHistogram, AtRiskStudentList, StudentJourneyStoryboard, CompletionFunnelMountain, ConfusionHeatmapBand, QuizAlignmentScatter, PositiveReassurance.
- **Data:** add `getLectureInsights` to `src/services/analyticsService.ts`; `useInsights` hook; `Insight`/`InsightKind`/`Attention`/`EvidenceKind` TS types in `src/features/analytics/types/index.ts` (match Pydantic exactly).

---

## 3. Phase 0 — event enrichments (do first, no migration)
- **3a** `ai_tutor_query` gets `slideId`: add `slideId?` prop to `LectureChatProps` (LectureChat.tsx:35), pass `currentSlide.id` from the two render sites in `LectureView.tsx` (~1119/1138), include in payload (line 238). Makes hotspot attribution exact.
- **3b** `sessionId` on all events: generate a per-session UUID in `LectureView.tsx` (ref, set on lecture_start:314), thread into every `logLearningEvent` + into `LectureChat` via prop. Unlocks Tier 1 later.
- **3c** Store AI response: add `response: data.reply` (+ citations) to the `ai_tutor_query` event at LectureChat.tsx:238 (`data.reply` already in scope). Unlocks Tier 2.

JSONB is schemaless → no DB migration.

---

## 4. Phased build sequence (each independently verifiable)
- **Phase 0** — event enrichments (small PR). Verify new `learning_events` rows carry slideId/sessionId/response.
- **Phase 1** — vertical slice, **Confusion Hotspot end-to-end**: backend (schema/bundle reusing slide+confidence aggregates/detector/copy/engine/endpoint/cache) + frontend (types, service, useInsights, InsightGarden shell, GardenFeed, one InsightCard rest+expanded, ConfusionWaveChart, state machine, LecturePicker extraction). Verify: load lecture → ranked card → expand → wave chart + copy → back. Detector unit-tested.
- **Phase 2** — breadth, no-new-SQL kinds: Silent Strugglers, Leaky Bucket, Confusion Block, Quiz Misalignment, Healthy/Positive + cross-kind severity sort + "show all" + HealthyEmptyState + AtRiskBanner.
- **Phase 3** — new-SQL kinds: median/IQR dwell→Skipped Slide; first-attempt-by-slide→Silent Misleader; directional back-nav→Speed Bump; calibration pairs→Calibration Gap; Overpacked (degraded, no revisit) + their viz.
- **Phase 4** — Layer 3 evidence + on-demand AI; then **relocate (not retire)** the monolith: rename `ProfessorAnalytics.tsx`'s current body to `AdvancedAnalytics.tsx`, mount it untouched at a new route `/professor/analytics/:lectureId/advanced` (NeuralBackground, ThreeDScatterPlot/ThreeDBar, gaming mode, per-metric feedback all preserved). Add a quiet "Open advanced analytics →" link from the garden. Re-home AskYourData/Benchmarks as calm garden sections if kept.
- **Phase 5 (later)** — Tier 1 session reconstruction; Tier 2 NLP over `slides.content_text` + stored AI responses enriching existing cards' L3 (no new kinds).

---

## 5. Risks · tests · retire
**Risks:** extra asyncpg block per cache-miss (mitigate: 300s cache; flag materialized views later); pre-Phase-0 slideTitle fuzziness (ship Phase 0 first); Calibration Gap weakest-grounded (slide-level approx first); small-N false alarms (min-sample guards); single-lecture degrade (detector scope, types lecture-scoped).

**Tests:** backend per-detector unit tests with synthetic bundles (model: `_calculate_retry_performance`); endpoint ownership/envelope test; frontend useInsights query test, InsightCard state-machine test, per-viz interaction + reduced-motion (model: `AskYourDataPanel.test.tsx`).

**Relocate (NOT retire):** the entire current monolith → `AdvancedAnalytics.tsx` at `/professor/analytics/:lectureId/advanced`, preserved as-is (NeuralBackground, ThreeDScatterPlot, ThreeDBar, gaming mode, 13-section body, per-metric feedback). Add `App.tsx` route + quiet garden link. Nothing deleted.
**Keep & reuse:** all `analytics_service` aggregates, `analytics_cache`, `_assert_lecture_owner`, `/api/ai/analytics-insights`, LecturePicker logic, `fetchProfessorLectures`, dashboard endpoint (still used by Ask-Your-Data/Benchmarks).
**Migrations:** none for v1 (workspace notes/reviewed deferred — the only future new table).

**Trade-offs:** backend engine (testable/reusable) over client-derived; reuse cached aggregates (consistency) over one mega-query (latency); templated baseline + opt-in AI (instant, free critical path).

---

## Critical files
- `backend/services/analytics_service.py` — extend (bundle reuses aggregates; add 4 new SQL fns)
- `backend/api/analytics.py` — add `GET /lecture/{id}/insights` (~line 225 pattern)
- `backend/services/analytics_cache.py` — reuse `get_or_compute_async`, `view_name="insights"`
- `backend/services/insights/` — NEW package (schema/bundle/detectors/copy/engine)
- `src/pages/ProfessorAnalytics.tsx` — monolith → garden shell; extract LecturePicker
- `src/components/LectureChat.tsx` + `src/pages/LectureView.tsx` — Phase 0 enrichments
- `src/features/analytics/garden/` + `types/index.ts` + `hooks/useInsights.ts` + `services/analyticsService.ts` — NEW frontend
