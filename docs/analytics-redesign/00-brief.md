# Professor Analytics Redesign — Consolidated Brief

> Phase 1 deliverable. Fuses the research vision with the verified backend data model.
> Status: **DRAFT for review.** Next phases: Design (IA + visual) → Plan (component decomposition) → Implement.

---

## 1. Problem statement

The current page (`src/pages/ProfessorAnalytics.tsx`, ~1348-line monolith) is **messy and lacks logical design on what to show and how**. It stacks 13 undifferentiated sections vertically with no priority or grouping, spends visual weight on spectacle (3D scatter, neural backgrounds, gamification) rather than comprehension, and shows several **descriptive vanity metrics** instead of **diagnostic, actionable signal**.

**Goal (confirmed):** full overhaul — visual/UX + new metrics + code quality + AI actionability — serving three professor jobs equally:
1. Spot at-risk students *before the exam*.
2. Find and fix weak slides/content.
3. Get a high-level health snapshot for reporting.

---

## 2. Design principles (the editorial gate)

Every element on the redesigned page must earn its place against these rules:

1. **Diagnostic, not descriptive.** Each signal must help the professor locate *where the breakdown is* on the **triad**:
   - **Engagement** failure (didn't really engage — passive skim, drop-off)
   - **Comprehension** failure (engaged but didn't get it — confusion, quiz miss)
   - **Material** flaw (the content itself — query gaps, miscalibration)
2. **Leading over lagging.** Prioritize signals detectable *mid-course* (drop-off slope, confusion spike, speed-skipping) over post-mortem grades. The page should convey *what needs attention now*.
3. **Metric hygiene gate** — every number must pass **robustness + interpretability + actionability**. Reject anything that collapses opposing patterns or doesn't point to a specific action. (See §7 kill-list.)
4. **Action, not analysis.** Professors aren't data analysts. Where possible, present a *named diagnosis + prescribed action* (archetypes, §5), not raw numbers to interpret.
5. **Progressive disclosure.** Surface need-to-know; reveal evidence only on demand (3-tier IA, §6).

---

## 3. The five core questions (requirements)

| # | Question | Triad axis | Status post-audit |
|---|----------|------------|-------------------|
| 1 | Which slides are confusion hotspots? | Material | **Ready** (Tier 0) |
| 2 | Which students are disengaging / struggling silently? | Student/Engagement | **Ready** (Tier 0) |
| 3 | Are quiz items testing what slides teach, at the right difficulty? | Effectiveness | **Mostly ready** (FK exists; Bloom's level needs NLP — Tier 2) |
| 4 | Are students' confidence judgments calibrated? | Effectiveness | **Ready** (FK exists — Tier 0) |
| 5 | What concepts do students repeatedly ask the AI about (missing content)? | Material | **Needs NLP** (Tier 2) |

---

## 4. Metric universe (post-audit feasibility)

Legend: 🟢 ready now · 🟡 needs session reconstruction · 🔵 needs NLP pipeline

### Slide level
| Metric | Signal | Feasibility |
|---|---|---|
| Median dwell (+ IQR) | typical processing time, split by completion | 🟢 |
| Dwell bimodality coefficient | polarizing slide (some know it, some stuck) | 🟢 |
| Confusion-rating proportion | direct "confused" self-report | 🟢 |
| Confusion–accuracy misalignment | "got it" but failed linked quiz (illusion of knowing) | 🟢 *(FK confirmed)* |
| AI-tutor query rate | help-seeking per viewer (⚠ slideTitle-matched) | 🟢 |
| Back-navigation return rate | later slide exposed earlier gap | 🟢 |
| Dwell coefficient of variation | non-uniform cognitive load | 🟢 |
| Slide re-visitation index | deliberate return after completion | 🟡 |
| Quiz-linked first-attempt failure | fraction wrong on first try | 🟢 *(FK confirmed)* |
| Confidence–query paradox | high "got it" + high queries (surface confidence) | 🟢 |

### Lecture level
| Metric | Signal | Feasibility |
|---|---|---|
| Completion funnel & drop-off slope | the "leaky bucket" slide | 🟢 |
| Slide-level confusion heatmap | clusters of difficulty | 🟢 |
| Quiz performance distribution (dip test) | bimodal = left some behind | 🟢 |
| Pacing anomaly score | wild dwell variance across slides | 🟢 |
| Early disengagement (speed-run) signal | >3 consecutive <3s slides, no quiz | 🟢 |
| Confusion→quiz resolution ratio | did confusion self-correct? | 🟢 *(FK confirmed)* |
| AI tutor volume trend | spike-then-decline (healthy) vs sustained | 🟢 |

### Free-text / AI queries (all 🔵 NLP)
Missing-concept ratio · Bloom's level per slide · recurring confusion clusters (theme cloud) · AI-resolution effectiveness (⚠ outcome only — AI response text not stored) · query↔quiz Bloom's gap.

### Novel signals
Confidence calibration gap (🟢) · inter-slide transition friction (🟢) · confidence evolution on re-visits (🟢) · session rhythm / attention decay (🟡) · AI-question sophistication trajectory (🔵) · concept dependency leakage (🔵).

---

## 5. Slide-problem archetypes (metrics → named diagnoses)

The classifier that makes the page *actionable*. Each problem slide is labeled with at most one archetype + a prescribed action.

| Archetype | Signature | Action | Feasibility |
|---|---|---|---|
| **Silent Misleader** (illusion of knowing) | high "got it", low queries, low back-nav, **low quiz accuracy** | add a check-your-understanding / worked example | 🟢 |
| **Confusion Hotspot** (overt breakdown) | high "confused", high query rate, high back-nav, long dwell | rewrite / split / add walkthrough | 🟢 |
| **Skipped Slide** (perceived irrelevance) | very short dwell, few ratings, drop in completion after | remove / shorten / mark optional | 🟢 |
| **Speed Bump** (temporal disruption) | normal confusion, dwell spike, back-nav from i+1→i | add bridging sentence/diagram | 🟢 |
| **Overpacked** (cognitive overload) | high confused, long dwell, high queries, bimodal dwell, high revisit | chunk / split / reduce load | 🟡 *(revisit needs sessions)* |

---

## 6. Information architecture — three attention tiers

Replaces the flat 13-section scroll. Matches the attention a busy professor can give.

### Tier A — 10-second glance (Executive Summary)
- **At-risk alert** — one prominent sentence: *"34% dropped off at slide 12; 28% rated slide 15 'confused'."*
- **Health gauges** — meaningful completion (target >85%), quiz median (>70%), AI-query anomaly vs prior lectures.
- **Top-3 problem slides** — ranked by composite confusion score (confusion + queries + back-nav), each tagged with its archetype.

### Tier B — 2-minute scan (Lecture-at-a-Glance)
- **Confusion×time heatmap** — slide index × {% confused, median time, AI queries}; red = problem zones.
- **Quiz-alignment scatter** — slide difficulty (x) vs quiz failure rate (y); misaligned items stand out.
- **Engagement distribution** — histogram of completion% / time; surfaces the non-finisher tail.
- **AI query theme cloud** — 🔵 most-asked topics, sized by frequency.

### Tier C — drill-down (on demand, only when a flag is triggered)
- **Slide detail card** — dwell violin, anonymized query list, confusion–accuracy matrix, sample confidence sequences.
- **Student journey playback** — one student's slide-by-slide path, dwell, confidence, quiz attempts as a timeline. (🟢 from raw events.)
- **Confusion-theme deep dive** — 🔵 representative queries for a cluster.

---

## 7. Anti-pattern kill-list (what we remove or recompute)

| Currently shown | Problem | Replace with |
|---|---|---|
| mean time / mean dwell | masks bimodal groups | **median + IQR**, split by completion |
| raw AI-query count | curiosity vs confusion ambiguous | pair with confusion/outcome |
| raw quiz score | collapses retries | **first-attempt correctness** + attempts-to-correct |
| binary completion | 5s/slide "completes" | **completion with evidence** (dwell threshold + ratings/quiz) |
| login/session counts | trivial action | active study sessions |
| leaderboards / "gaming mode" | noisy, demotivating, no action | **cut** from professor view |
| mean confidence | masks calibration | confidence **tied to outcomes** |

---

## 8. Backend reality & risks (from audit)

**Confirmed available:** 7 event types in `learning_events`; slide_view duration+timestamps; back-nav direction (`fromSlideId`/`toSlideId`); confidence ratings (got_it/unsure/confused) timestamped; first-attempt vs retry via event type; **`quiz_questions.slide_id → slides.id` FK**; `slides.content_text`. Dashboard computed live (CTEs ~100–500ms) in `backend/services/analytics_service.py`, endpoint `backend/api/analytics.py:225`.

**Risks / decisions needed:**
1. **AI queries tagged by `slideTitle` (string), not `slide_id`** → fuzzy attribution. *Recommend: add `slideId` to the event going forward.*
2. **No `sessionId`** → session metrics require >30 min gap reconstruction (approximate). *Recommend: emit `sessionId` going forward.*
3. **AI response text not stored** → can measure resolution *outcome*, not AI answer *quality*. *Recommend: store responses going forward.*
4. **`content_text` populated-extent unknown** → Tier 2 NLP needs a data audit/backfill first.
5. **Live computation cost** → many new metrics may need materialized views / pre-aggregation later.

---

## 9. Phased rollout (proposed)

- **Phase 0 — small event enrichments** (cheap, unlock accuracy): add `slideId` + `sessionId` to ai_tutor_query; consider storing AI responses. Non-blocking, do early.
- **Phase 1 — Tier 0 redesign**: new 3-tier IA shell + exec summary + confusion heatmap + quiz-alignment scatter + engagement distribution + archetypes 1–4 + calibration. Decompose the monolith. **This is the bulk of the value and ships from existing data.**
- **Phase 2 — Tier 1**: session reconstruction → revisitation, session rhythm, Overpacked archetype, student journey playback.
- **Phase 3 — Tier 2**: NLP pipeline → missing-concept ratio, Bloom's level, confusion clusters/theme cloud, dependency leakage. (Gated on content_text backfill.)

---

## 10. Decisions (resolved 2026-06-05)

- [x] **Interaction model: the "Insight Garden."** Not tabs, not a long scroll. A calm, spacious canvas showing only **2–3 large, softly-glowing tiles at rest** — the emptiness is intentional. **Each tile is a self-contained *question*, not a metric name.** Selecting a tile **expands it in place** within the same window; other content recedes gracefully; calm is never broken. A persistent "step back to the garden" gesture is always available. Drill-down (Tier C) opens *within* an expanded tile, layered — never a new page.
- [x] **Visual identity: clean analytical style.** Retire neural background, 3D scatter, and gamification/leaderboards. Restrained palette, generous whitespace, soft-glow accents, strong typographic hierarchy, honest 2D charts. One accent reserved for "needs attention."
- [x] **Cross-lecture: yes, architecturally — single lecture for now.** Build the data/IA to support a course-level / multi-lecture executive view, but only one lecture exists today, so the first build renders a single lecture. The "at-risk *lecture* alert" degrades to an "at-risk *slide* alert" within the one lecture until more exist.
- [x] **Phase 0 event enrichments: approved.** Add `slideId` + `sessionId` to `ai_tutor_query`; store AI responses. Do early so better data accrues while we build.

### How the Garden maps to the 3-tier IA (§6)
- **Garden view = Tier A.** The tiles *are* the executive glance; an ambient at-risk line may sit above them.
- **Expanded tile = Tier B.** A selected question unfolds into its supporting visualizations.
- **Within-tile drill-down = Tier C.** Evidence (slide detail card, student journey playback) opens layered inside the expanded tile.
