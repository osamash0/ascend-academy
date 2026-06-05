# Professor Analytics Redesign — Design Spec

> Phase 2 deliverable. Builds on [00-brief.md](00-brief.md).
> Status: **DRAFT for review.** Next: Plan (component decomposition + backend insight engine).

---

## 1. Concept — "The Insight Garden" (a console, not a dashboard)

PS5-inspired: ambient, one-thing-in-focus, negative space as luxury. The professor **descends into** data rather than having it sprayed at them. Three principles:

1. **Breathe before you read.** At rest, content fills **< 40% of the viewport**; the rest is calm (dark) space with a subtle ambient backdrop. Large rounded cards, soft shadows. No grid of gauges fighting for attention.
2. **Talk like a human.** Every number carries a plain-language interpretation in the professor's voice. *"Nearly half the class got stuck here"* — not *"confusion 42%."*
3. **Progressive depth, not popups.** Selecting a card expands it **in place**; going deeper opens evidence **inside** that card. Never a new page; never lose your place. A single "back" gesture collapses one layer at a time.

---

## 2. The core abstraction — the **Insight**

The garden is a **dynamic, urgency-ranked feed of Insights** (decision: dynamic feed, not fixed tiles). An Insight is one detected finding about the lecture.

```ts
interface Insight {
  id: string;
  kind: InsightKind;            // see catalog §6
  scope: 'slide' | 'student' | 'quiz' | 'lecture';
  targetRef?: { slideId?; slideNumber?; studentId?; questionId? };
  severity: number;             // 0..1 — drives ordering + color
  attention: 'calm' | 'watch' | 'act';  // banded from severity
  headline: string;             // friendly question/observation (templated)
  summary: string;              // one-sentence templated interpretation
  cue: { sparkline?: number[]; metric?: { label; value } };
  metrics: Record<string, number>;   // supporting figures for Layer 2
  evidenceKinds: EvidenceKind[];      // what Layer 3 can show
}
```

**Severity** = magnitude of the signal × reach (share of students affected), normalized per kind. Feed is sorted by severity desc. **Attention banding** maps severity → color: calm **teal** → watch **sand** → act **warm coral**. Only a handful of cards are visible at rest; the rest scroll below the fold.

**Where it runs:** recommended new backend endpoint **`GET /api/analytics/lecture/{id}/insights`** returns the ranked, typed, copy-filled `Insight[]`. The frontend is a pure renderer + state machine. (Centralizes the detection logic, makes it unit-testable, and reuses for the future cross-lecture view.) *Plan-phase decision — see §8.*

**Empty / healthy state** is a first-class design concern: when nothing crosses `watch`, the garden shows a single calm card — *"This lecture looks healthy. Nothing needs your attention right now."* — possibly with a positive insight (see catalog).

---

## 3. The three layers

### Layer 1 — The Garden (10-second glance)
A vertical, scrollable wall of large cards over ambient space; only a handful visible. **Card anatomy:**
- Friendly **headline** (question or observation): *"A slide that hides a trap."*
- One-sentence **summary**: *"80% felt sure — but 60% missed the quiz."*
- A **single subtle cue**: a tiny sparkline or one muted number. Card edge/tint shifts calm-teal → warm-coral by `attention`.
- No screaming numbers; tone informational, never alarming.

### Layer 2 — The Expanded Insight (2-minute exploration)
Card expands in place; siblings fade to low opacity / shift aside; expansion **fills the empty space that was always there**. Story format:
- Natural-language **headline**: *"Most students sailed through, but slide 12 acted like a wall."*
- **One** key visualization, stylized for calm (e.g. confusion-time as a soft density "mountain," not a raw scatter). Muted palette, minimal axes, slow unfolding transitions.
- **Interpretation** beside the viz (templated).
- **Gentle action prompts** → deeper: *"Want to see what students asked the AI here?"* and workspace actions: **mark as reviewed**, **add a note**.

### Layer 3 — The Evidence Drawer (drill-down)
Opens **inside** the expanded card (bottom panel / side drawer); garden faintly visible behind; context never replaced. Evidence is still **narrated**, never raw tables:
- **Grouped student queries** with a thematic heading: *"Students kept circling two missing concepts: 'degrees of freedom' and 'test assumptions' — neither appears on the slide."* (NLP — Tier 2; v1 = raw grouped list.)
- **Confidence-accuracy 2×2** as a friendly grid with readable icons (*"Thought they knew, but didn't"*).
- **Student-journey storyboard**: one student's slide path as a horizontal strip, dwell as color intensity, confidence + quiz markers. No table.

A single back gesture collapses drawer → card → garden.

---

## 4. Visual language

- **Theme:** dark, spacious; ambient particle/gradient backdrop (subtle, performance-cheap — `backdrop-filter`, low-cost canvas, or static gradient).
- **Palette:** muted nature tones — deep **teal** (calm/healthy), warm **sand** (watch), soft **coral** (act). Avoid harsh red/green.
- **Cards:** large radius, soft shadow, generous padding, low-contrast borders.
- **Motion:** Framer Motion **layout animations** for expand/collapse; slow, easing transitions ("unfolding," not "reporting"). Respect `prefers-reduced-motion`.
- **Typography:** strong hierarchy; headline > summary > supporting; humanist sans.
- **Relocated, not retired:** the current page (neural background, 3D scatter, gamification, the 13-section scroll) is preserved **as-is** in a separate, isolated **Advanced Analytics** view at `/professor/analytics/:lectureId/advanced`, reached by a quiet link from the garden ("Open advanced analytics →"). The garden is the new default; advanced is opt-in for power users.

---

## 5. Narration strategy (hybrid)

- **Templated, instant, deterministic** for all always-visible copy (headlines, summaries, Layer 2 interpretations). Generated in the insight engine from metrics. Free, reliable on every load.
- **On-demand AI** for deeper interpretive narration (*"I think the confusion stems from a missing definition…"*) via the existing `POST /api/ai/analytics-insights`. Triggered only when the professor asks to go deeper — garden stays instant.

---

## 6. Insight catalog (v1 = Tier 0, from existing data)

Each kind: trigger → Layer 1 copy → Layer 2 story → Layer 3 evidence. All v1 kinds computable from current events (slide↔quiz FK confirmed).

| Kind | Scope | Trigger (Tier 0) | Layer 1 headline | Layer 2 / Layer 3 |
|---|---|---|---|---|
| **Confusion Hotspot** | slide | high confused% + high AI-query rate + high back-nav + long dwell | "A slide where many call for help." | AI-query/back-nav wave chart + sample query → grouped queries (L3) |
| **Silent Misleader** | slide | high got_it% + low queries/back-nav + low first-attempt quiz accuracy | "A slide that hides a trap." | confidence-vs-accuracy dot plot → the exact quiz item (L3) |
| **Skipped Slide** | slide | very short median dwell + few ratings + completion drop after | "A slide that's being overlooked." | engagement-time drop bar → suggestion |
| **Speed Bump** | slide | normal confusion + dwell spike + back-nav from i+1→i | "A slide students realize they missed — later." | transition-friction view → back-nav origins |
| **Overpacked** | slide | high confused + long dwell + high queries + bimodal dwell *(+revisit = Tier 1)* | "A slide that asks too much at once." | mirrored dwell histogram ("cloud") → revisit pattern (Tier 1) |
| **Silent Strugglers** | student | students w/ short dwell + no AI help + quiz miss / drop-off | "Someone might be silently slipping." | at-risk student list → student-journey storyboard (L3) |
| **Leaky Bucket** | lecture | >20% attrition at a slide (drop-off slope) | "Is this lecture feeling heavy?" | completion funnel "mountain" → slide before the drop |
| **Confusion Block** | lecture | contiguous slides w/ high confusion (moving avg) | "A stretch where the class lost the thread." | confusion heatmap band → per-slide breakdown |
| **Quiz Misalignment** | quiz | item failure high but slide looks easy (low dwell/confusion) | "Are my quizzes testing what I think?" | quiz-alignment scatter → the misaligned item |
| **Calibration Gap** | slide/lecture | high overconfidence rate (got it → wrong) | "Confidence that doesn't match results." | confidence-accuracy 2×2 → student samples |
| **Healthy / Positive** | lecture/slide | nothing ≥ watch; or confusion that self-resolved | "This lecture looks healthy." / "Slide 9 turned things around." | minimal; reassurance |

**Tier 2 (NLP) enrichments** layer *into* existing cards' evidence — missing-concept ratio + query clusters power the Confusion Hotspot's L3 narration; Bloom's gap sharpens Quiz Misalignment. They don't add new card kinds initially.

---

## 7. Cross-lecture (future, architect now)
Today: single lecture. The Insight model is lecture-scoped but the feed pattern generalizes: a future **course garden** ranks *lecture-level* insights ("Lecture 5 is feeling heavy") that drill into the lecture's own garden. Build the endpoint + types lecture-scoped but not hard-coded to one lecture.

---

## 8. Architecture sketch (for the Plan phase)
- **Backend:** `GET /api/analytics/lecture/{id}/insights` — insight engine consumes existing aggregations (extend `analytics_service.py`), emits ranked `Insight[]` with templated copy. Unit-testable detectors per kind. (Decision to confirm: engine in backend vs. derived client-side from the existing dashboard payload.)
- **Frontend:** decompose the 1348-line monolith into:
  - `useInsights(lectureId)` (TanStack Query)
  - `InsightGarden` (feed + ambient layout + empty state)
  - `InsightCard` (rest → expanded, owns its Layer 2 viz)
  - `EvidenceDrawer` (Layer 3)
  - a small **view state machine**: `garden → expanded(id) → evidence(id, kind)`; single back gesture.
  - per-kind Layer 2 viz components (heatmap "mountain," dot plot, dwell "cloud," funnel, scatter, 2×2, journey storyboard).
- **Phase 0 enrichments** (approved): add `slideId` + `sessionId` to `ai_tutor_query`; store AI responses.

---

## 9. Decisions (resolved 2026-06-05)
- [x] **Insight engine = backend endpoint.** `GET /api/analytics/lecture/{id}/insights` returns ranked, typed, copy-filled `Insight[]`. Frontend is a pure renderer. Detectors are unit-testable; reusable for cross-lecture.
- [x] **Feed volume = top findings + "show all".** ~3–4 highest-severity cards in the calm view; the rest one tap away under a quiet "show all findings" affordance.
- [x] **Positive insights = yes.** Graceful healthy empty state always; surface occasional positive wins. Companion, not alarm.
- [x] **Workspace actions (mark-reviewed / notes) = deferred.** v1 is read-only insight exploration. Add the workspace layer (new table + write endpoints) once the model proves out.
