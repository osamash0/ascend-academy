# How it's landing — the owner's view of a Space

*Design spec, 2026-10-26. Status: draft for Abi's review. Planning + fixture demo only; nothing reaches v4 until the demo is approved.*

Brings the professor Insight Garden (`docs/analytics-redesign/00..02`) into v4, where roles live in the room: whoever creates a Space owns it, and an owner "sees analytics" (`docs/design-v4/01-foundations.md:29`).

## 0. Decisions already made (Abi, 2026-10-26)

| Question | Decision |
|---|---|
| Where | An owner-only door inside each Space: Space → Lesson → page/idea. Evidence opens the real page in the reader. |
| Who may open it | Ownership (`courses.professor_id = viewer`), never a global role. No door on the personal Space. |
| How numbers are made | Server-side aggregates. Owners never get row-level reads of members' activity. The owner's own reading is excluded. |
| Signals | Behaviour (dwell, re-reads, Explain/Ask, checkpoint and practice misses graded on the server) **plus one quiet check-in** — "clicked / still foggy" — at idea checkpoints. |
| Members' questions | Stored. The owner sees **AI themes only**, and only when **≥5 different people** asked on that page. Never verbatim. Enforced in Plan 1: the legacy views skip `v4_reader` rows and the professor events RLS policy excludes them. |
| Person-level pieces (Strugglers list, Journey) | Carried over behind a flag; real members see nothing person-level until Abi's privacy call. |
| What stays legacy | Advanced Analytics and the professor dashboard. |

Name: **How it's landing** · de **Wie es ankommt** (echoes the One Library "how it landed" step, `docs/superpowers/specs/2026-10-11-one-library-design.md:24`).

## 1. Audit — what we built, what it does today, what happens to it

Verified on `222225af`. "Works" = runs against real data; "broken" = wrong output; "unused" = no caller.

### 1.1 Engine (keep)

| Piece | Where | State | Verdict |
|---|---|---|---|
| Detectors (11 kinds) | `backend/services/insights/detectors.py:608-620` | works, 27 unit tests | **Keep untouched.** They take a metric bundle, not a DB. |
| Ranking | `engine.py:13-31` | works | Keep. |
| Bundle (per-lecture metrics) | `bundle.py:213-304` | works, reads through the owner's JWT (RLS) | **Adapt:** add a second source that aggregates a whole Space server-side (§4 B2). |
| Copy | `copy.py` (English, "slide", "students", hardcoded) | works | **Move to the frontend.** v4 is en+de and bans these words; the backend will emit kind + metrics only. Legacy garden keeps `copy.py`. |
| Cache | `analytics_cache`, 300 s, service-role RLS (`analytics_cache.py:22`) | works | Keep; new view name `landing` keyed by Space. |
| Severity bands | `schema.py` calm < 0.33 ≤ watch < 0.66 ≤ act | works | Keep; rendered as light, not colour (§5). |

### 1.2 Cards and pictures (keep, restyle)

| Piece | Where | State | Verdict |
|---|---|---|---|
| Feed + card | `src/features/analytics/garden/GardenFeed.tsx` (86), `InsightCard.tsx` (118) | works, browser-verified | **Port** into `src/features/spaces/landing/`, restyled for the stage. Deliberate copy, not shared: the console can then be deleted later. |
| One picture per kind | `Layer2Viz.tsx` (110), `viz/ConfusionWaveChart.tsx`, `SlideRangeList.tsx`, `MetricTiles.tsx` | works | Port. `MetricTiles` goes (one fact, once). |
| Healthy state | `HealthyEmptyState.tsx` | works | Port; becomes the calm card. |
| Picker rails | `GardenLecturePicker.tsx` (569) | works | **Drop.** The Space is the picker. |
| Attention palette | `attention.ts` teal/sand/coral | works | **Drop.** Monochrome + Space accent. |

### 1.3 Evidence (one fix, one privacy gate)

| Piece | Where | State | Verdict |
|---|---|---|---|
| Members' AI questions, verbatim | `evidence.py:21-52`, `GroupedQueriesList.tsx` | works | **Adapt → themes** (§4 B6). Note `evidence.py:40` reads `response`, which the event schema forbids (`schemas/learning_events.py:130-132`): always null. |
| Confidence 2×2 | `evidence.py:54-106`, `ConfidenceAccuracyGrid.tsx` | works | Keep. The check-in feeds it, now paired exactly: "said *clicked*, then missed the checkpoint". |
| One person's journey | `evidence.py:108-197`, `StudentJourneyStoryboard.tsx` | **broken** — filters `user_id` by the pseudonym (`evidence.py:124,139,163,177` vs `detectors.py:177`), always empty | Fix on the server (pseudonym resolved inside the service, never a UUID on the wire); **flag off** until the privacy call. |
| Strugglers list | `detectors.py:138-185`, `viz/AtRiskStudentList.tsx` | works | Pseudonym `md5(user_id)` (`analytics_utils.py:16-22`) links one person across Spaces → **per-Space salt**; **flag off** until the privacy call. |
| Dashboard `studentsMatrix` | `analytics_service.py:797-798, 948` | returns raw user UUIDs | Not ported. Legacy only. |

### 1.4 Ask (merge later)

| Piece | Where | State | Verdict |
|---|---|---|---|
| Owner chat, grounded | `ProfessorAskBar.tsx` (176), `useProfessorChat.ts` (170), `POST /analytics/professor/chat`, `ask_professor.py:527-581` | works; owner-wide scope; `_bulk_fetch_confidence` (`:254-258`) pulls every confidence event with no lecture filter, capped at 10 000 rows | **Later (Phase D):** one ask in the room, Space-scoped. |
| Ask-your-data (intents) | `AskYourDataPanel.tsx` (346), `POST /analytics/lecture/{id}/ask` | works, lecture scope | Merge into the above later. |
| `POST /professor/ask` + `askProfessorData` | `analytics.py:698`, `analyticsService.ts:186` | **unused** | Drop. |

### 1.5 Overview, benchmarks, AI helpers (absorb or later)

| Piece | Where | State | Verdict |
|---|---|---|---|
| 7-day overview + weakest ideas | `ProfessorOverviewSection.tsx`, `GET /professor/overview`, `analytics_service.py:1015-1339` | works (`require_professor`) | **Absorb:** weakest ideas become idea cards in the feed; the four stat tiles go. |
| Benchmarks | `BenchmarksSection.tsx`, `/lecture|course/{id}/benchmarks` | works (`require_professor`) | Later. |
| Exam aggregate | `/course/{id}/exam-aggregate`, 5-attempt floor | works; **not** behind `FEATURE_EXAM_MODE` though `/exams` is (`main.py:257`) | Later, where exam mode is on. Fix the gate when touched. |
| Deeper AI narration | `POST /ai/analytics-insights` (`ai_content.py:149`) | works, but **any signed-in user may call it**; `AdvancedAnalytics.tsx:634,786` sends `hard_slides` the schema drops | Later as "go deeper"; guard by ownership when ported. |
| Per-page recommendation | `POST /ai/slides/{id}/recommendation` | works, owner-checked | Later as "what could help" on a page card. |

### 1.6 Left behind (legacy, untouched)

`AdvancedAnalytics.tsx` (1 471 lines; "Where people quit" and "Confidence by page" always empty because `get_dashboard_data` hardcodes `[]` at `analytics_service.py:851-852`; the hidden Intervention Hub would render real avatars), `ProfessorDashboard.tsx`, `ProfessorAnalytics.tsx` + the console routes. Small cleanups worth doing when nearby: `ProfessorAnalytics.tsx:27` logs `analytics_dashboard_viewed`, which the CHECK constraint rejects (silent); `analyticsService.getConfidenceBySlide` calls `/confidence` but the route is `/confidence-by-slide` (unused); `computedAt` gets `+00:00Z`.

### 1.7 Tests today
Detectors 27, analytics service 12, cache 10, ask 7+9, endpoints 12 (`backend/tests/…`). **Untested:** `/insights`, `/evidence`, `bundle.py`, `evidence.py`, `engine.py`, every garden component.

## 2. Four people in the room

The reader is the product. Nothing below changes a member's reader except one optional tap.

**Mira, a member** (second semester, reads Database Systems on her phone).
Needs: the reader exactly as it is; the check-in to be one tap, skippable, never blocking; one honest line about what the owner sees (join screen + privacy page): *"The people who run this Space see how pages land for the group — never your name, never your questions."* (Ships as the shorter line in A11 until the legacy person-level views are gated.)
Must never see: the door, anyone else's numbers, her own name in anything an owner sees. Her Luna, notes and memory stay hers (documented promise, `2026-10-24-luna-study-sessions-design.md:32,89`).

**Jonas, who made a Space for six friends.**
Needs: a door that reads like the rest of v4, not a professor console; honest empty states, because with six readers most pages sit under the 5-reader floor: *"Six people are reading. Patterns show once five of you have been through a page."* No door on his personal Space (uploads).
Must never see: which friend is slipping. With six people, "one person" is a name. This is why person-level pieces stay off by default.

**Lena, a tutor** (owns the Space for her exercise group, ~35 members, decks she didn't write).
Needs: the three pages to go over next session; what people kept asking on them (themes); which Lesson feels heavy; a link straight to the page. Lesson-level ranking matters more than any single card.
Must never see: verbatim questions (a 35-person group identifies people by phrasing). Enforced in Plan 1: the legacy views skip `v4_reader` rows and the professor events RLS policy excludes them.

**Prof. K., 200 members, 10 Lessons.**
Needs: the Space-level ranking (which Lesson needs re-explaining), the trap pages (calibration), quizzes that test the wrong thing, themes at scale, and numbers that stay honest at scale. Later: export for a teaching report, "what could help", benchmarks.
Must never see: members' activity in *other* Spaces (today's RLS lets a professor read a member's events from any course they own, `20260621000000_scope_professor_read_policies.sql:27-56` — the Space-scoped path closes this for v4), nor their own previews counted as members.

Across all four: the owner's own reading is excluded; everything is aggregates; every card can open the real page.

## 3. Why "lift and re-home", not link out or rebuild

- Link to `/professor/analytics`: lecture-only console, "professor/slide" words, needs the professor role, and gets no v4 data anyway.
- Rebuild: throws away 11 tested detectors and three working pictures.
- Lift and re-home: engine + pictures stay; a Space-scoped data source and a stage-styled door are the new parts.

## 4. Phases

### Phase A — the v4 reader starts recording what the engine needs
Today v4 writes two events: `slide_view` (`v4_reading_service.py:99-117`: no `sessionId`, last page lost on tab close, dwell runs under Explain/Luna, ≥2 s threshold) and `quiz_attempt` (`v4_practice_service.py:96-108`: retries logged as first tries). Both skip `validate_event()` and would fail the registry schemas.

| # | Change | Where | Notes |
|---|---|---|---|
| A1 | `sessionId` per reader mount; sent with every progress ping; `timestamp` stamped server-side | `data/reading.ts`, `v4_reader.py:83-103`, `v4_reading_service.py` | Make the v4 `slide_view` pass `SlideView` (allow optional `page`, `source`). |
| A2 | Last page survives: `keepalive`/`sendBeacon` on `pagehide` | `data/reading.ts` | Fixes dropoff ending one page early. |
| A3 | Dwell pauses while Explain covers the page (full screen on narrow screens), a checkpoint, the teach-back, the break room or the practice bench covers it, or the tab is hidden. Luna sits beside or below the page and does **not** pause it (decided 2026-10-29). | `LessonFacesScreen.tsx` (checkpoint already reports `onOpenChange`) | Send `seconds` net of covered time. |
| A4 | `slide_back_navigation` when the page goes backwards | progress body gains `from_page`; server writes `{fromSlideId,toSlideId,sessionId}` | Feeds Speed Bump. |
| A5 | `lecture_complete` when `completed_at` is set | `v4_reading_service.py:80-87` | Feeds engagement/time. |
| A6 | Retry detection on the server: a `quiz_attempt` already on file for (user, question) → write `quiz_retry_attempt` | `v4_practice_service.py` | No client change; fixes first-try rates. |
| A7 | Explain / Ask write `ai_tutor_query {lectureId, slideId, sessionId, kind: explain\|ask, query}` | `v4_reader_service.py:658-704, 752-820` | Question text stored (decided). Explain's "query" is empty; `kind` tells them apart. |
| A8 | **The check-in**: at an idea's last page, beside the checkpoint offer, one row "Clicked · Still foggy"; optional; writes `confidence_rating {rating: got_it\|confused, slideId, idea, sessionId}` | `CheckpointCard.tsx` offer state | Reuses the existing event type; `unsure` unused. The checkpoint that follows gives the calibration pair. |
| A9 | Checkpoints graded on the server: generated checkpoint cached with answers under an id; `POST …/checkpoint/{id}/answer` grades and writes `checkpoint_attempt {lectureId, slideId, idea, kind, correct, sessionId}` | `v4_rehearsal_service.py:340-410`, `CheckpointCard.tsx:78-81` | New event type → CHECK constraint + `EVENT_REGISTRY` in one migration. Teach-back verdict emits the same (no text). Luna check results: **never** emitted (decided: Luna stays fully private). |
| A10 | v4 writers go through `validate_event()` | `event_repo.py:38` | One path, one schema. |
| A11 | Words for members: join screen line + privacy page line (en+de) | `JoinSpaceScreen.tsx`, privacy page | Honest, before any data is shown to owners. The join line ships as "…can see how its pages are read." The privacy page keeps its current bullet until the ≥5 floor is enforced and the legacy person-level views are gated (Silent Strugglers rows, `/students`, `/dashboard` `studentsMatrix`, the assignments roster, raw ids); then both change in the same PR (decided 2026-10-29). |

Nothing in Phase A changes what a member sees except A8 and A11. Owner-only tables (`v4_rehearsal_attempts`, Luna, notes, `learner_memory`) are not opened.

### Phase B — a Space-scoped engine with an ownership guard
| # | Change | Where |
|---|---|---|
| B1 | `assert_space_owner(course_id, uid)` — ownership only, 404 on the personal Space | `backend/domain/authorization.py` (exists, unused today) |
| B2 | A second bundle source: service-role SQL scoped to *this* Space — events whose `lectureId` ∈ the Space's lectures **and** `user_id` ∈ its enrollments **and** `user_id ≠ owner`. Detectors untouched. | `insights/bundle.py` → `sources/legacy_rls.py`, `sources/space.py` |
| B3 | Reader floor: `MIN_READERS = 5` per page and per Lesson; below it a card does not exist; the Space reports its floor state with the count | `insights/space_engine.py` |
| B4 | `GET /v4/spaces/{id}/landing` → the `Landing` shape in `src/features/spaces/landing/types.ts`: `{spaceId, spaceName, members, readers, floor, figures:{reading, landing, cleared} each {value, history[8 weeks]}, lessons:[{id, title, order, pages, readers, light, color, help[]}], insights[], questions[], themes[]}`. `help` = one 0–1 value per page (the per-page help index: Explain/Ask opened, foggy check-ins, turning back, normalised over the Space), absent under the floor. `color` = the hue sampled from the Lesson's first page (`sampleAccent`, stored at parse time). Insights ranked across Lessons (max severity × readers), each with `lessonId` + `page`. Cache view `landing`, 300 s. | `backend/api/v1/v4_landing.py` |
| B5 | Backend emits kind + metrics + targetRef + detail; **no English strings**. Copy lives in `v4Landing.json` (en+de, v4 words). | frontend i18n |
| B6 | Themes: pages with ≥5 distinct askers (owner excluded) → ≤3 themes summarised from `ai_tutor_query[kind=ask]` texts (openai_only tier, metered), cached as view `themes`. `GET …/landing/evidence?kind=themes&page=` returns themes + asker count, never texts. | `insights/themes.py` |
| B7 | Per-Space pseudonyms: `anon_name(user_id, course_id, salt)` | `analytics_utils.py` |
| B8 | Journey fixed server-side (pseudonym → user resolved in the service); Strugglers + Journey behind `FEATURE_LANDING_PEOPLE` (off) | `evidence.py` |
| B9 | Tests: guard (owner / member / stranger / personal), scoping (owner excluded, other Spaces excluded, floor), endpoint 403/404, themes threshold, pseudonym salting. Detector tests reused. | `backend/tests/unit`, `integration` |

### Phase C — the door, on the stage
| # | Change | Where |
|---|---|---|
| C1 | Route `/v4/space/:spaceId/landing` (declared before `:tab`), `SpaceOwnerGate` (viewerRole === 'owner' && !personal), else back to the Space | `App.tsx:402`, `SpaceRoute.tsx` |
| C2 | Entry: owners get one ghost pill beside **Rehearse** on the Space masthead — "How it's landing". No number on it (one fact, once). | `CourseScreen.tsx:142-148` |
| C3 | Screen (direction E, §7): back link carrying the Space's name, title, **Luna** saying the one line (the page to open, or the floor), the one white **Open page N** → **three figures** with their eight weeks → **the map**: every Lesson as its pages, lit by `help` in the Lesson's colour, finding pages labelled and opening the page, each finding one sentence that opens in place onto why + evidence (themes / clicked vs. missed) + **Open page N** → **Questions for you**. Under the floor: Luna says so once; no figures, no light. | `src/features/spaces/landing/LandingScreen.tsx`, `Figures.tsx`, `LessonMap.tsx`, `LunaBubble.tsx`, `Picture.tsx` |
| C4 | Built (in the lab) to both design floors (§7); no cards, no gauges, no glow | `landing/light.ts` |
| C5 | Data seam `data/landing.ts` (demo ← `mocks/landing.ts`, live ← B4); seam ratchet respected | `src/features/spaces/data` |
| C6 | en+de, vocabulary gate, reduced motion, phone width | — |
| C7 | Tests: owner sees pill / member doesn't; gate redirects; floor state; expand; open-page link; German render | `src/features/spaces/__tests__` |

### Phase D — later, out of this spec
Ask in the room (B's chat + ask-your-data, Space-scoped); "what could help" per page; go-deeper narration; benchmarks + exam aggregate; weekly digest; the console's retirement.

## 5. The demo (before anything touches v4)

A DEV-only route `/landing-lab` (like `/avatar-lab`, `App.tsx:365`) renders **Phase C's screen on fixtures**:
- **Database Systems** (`mocks/spaces.ts` `s-dbs`, 184 members, 10 Lessons): ~8 insights across four Lessons — a help hotspot on Normalization p. 12 with three themes, a Lesson that feels heavy, a trap page in Transactions (clicked vs. missed), a skipped page, a speed bump, a healthy Lesson, and one Lesson under the floor.
- **Jonas's Space** (6 members): the floor state.
- A members' line as it would read on the join screen.

Fixture file `mocks/landing.ts`; no backend, no telemetry, no v4 route. Browser-verified on desktop and phone, dark, with screenshots. Then stop.

**Status 2026-10-26:** built; the door scene is direction E (§7); directions A to D stay in the lab for comparison (`?scene=mockA` … `mockD`). Gates: `tsc -p tsconfig.app.json`, eslint, v4 strings, i18n parity, vocabulary, 29 tests (door, reachability, seal, seam, strings guard), Hallmark `sloplint` clean on the door (one dismissed: `AnsweredHere` has no interactive element), Impeccable flags only Inter.

## 6. Questions — a learner reaches the people who run the Space (approved 2026-10-26)

One gesture for the learner, one row for the owner, Luna as the messenger.

**Learner.** Under any Ask answer, under any Luna answer, and on "Still foggy" at a check-in, one quiet line: *Still foggy? Send it to the Space.* Tap → a small sheet: the question prefilled in the learner's own words (editable, ≤500), the page attached, one switch *without my name* (off), **Send**. If Luna is open she says *"Sent. I'll tell you when they answer."* (templated, no model call). Luna's tables stay private: the text leaves her only when the learner taps Send.

**Owner.** A row of the door, **Questions for you · n** (the one place a count is allowed); in direction E it follows the map, one line to move above it: page chip (opens the page), the question, name or *Someone*, when. Inline answer, two sends: **Answer them** (visibility `asker`) or **Answer for everyone** (visibility `space` — the answer lands on that page for every member as a quiet *answered here* card). v1: only the owner answers; members answering each other is a later switch.

**Arrival.** Notification `question_answered` with `target {kind:'page', spaceId, lessonId, page, questionId}` → the reader opens at the page with the answer beneath. If Luna is open she delivers it: *"They answered your question about page 12 — want to read it?"* (client-side, from the notification).

**The line.** Explicitly sent questions are verbatim, because the learner chose to send them (with or without a name). Passive AI questions stay themes-only. *Without my name* hides the name from the owner only; delivery still works.

**Data.** `space_questions(id, course_id→courses, lecture_id→lectures, page, idea, asker_id→auth.users on delete cascade, text, anonymous, answer, answered_by, answered_at, visibility asker|space, created_at)`. RLS: asker reads own; owner reads all in their Space; members read `visibility='space' and answer is not null` where enrolled; backend writes. Endpoints: `POST /v4/spaces/{id}/questions` (can_view_course, 5/min), `DELETE …/questions/{qid}` (asker, withdraw), `GET /v4/reader/lectures/{id}/answers` (own + space-visible, per page), `POST /v4/spaces/{id}/questions/{qid}/answer` (`assert_space_owner`; writes answer + notification; invalidates `landing`). `GET …/landing` returns open questions first. `_KINDS` gains `question_answered`.

**Phases.** A12 Send sheet + table + send endpoint. B10 answer endpoint + notification + landing includes questions. C8 Questions row, answer composer, *answered here* card in the reader. Demo adds the Send sheet, the Questions row with an answer, and the answer landing on a page.

## 7. Visual direction: E, the map (2026-10-26)

Five directions were built in the lab on the same fixtures: **A** a path of Lesson nodes, **B** stat tiles and cover tiles, **C** a rail of covers with light bars, **D** the v4 edition (masthead, figures, journey line, UpNext, a hairline list). Abi asked for friendlier and more visual ("more like Duolingo, not overwhelming"), colour from the decks, then "look from A to D and come up with a better one". All four drew the same fact four ways: where in a Lesson the trouble sits. D also said every finding twice. **E draws it once and makes it the screen.**

- **The map is the analytics.** Each Lesson is its pages, one cell per page. Dark is landing (Doc 2: darkness is the content). A cell takes the Lesson's colour as its help index rises; a page a finding is about is lit outright, labelled with its number, and opens that page. No separate findings list.
- **A finding is a sentence that opens in place** onto why it matters, its evidence (themes at ≥5 askers, never verbatim; clicked vs. missed with the trap cell lit) and **Open page N**. One open at a time. The garden's expand-in-place rule, kept. Never-verbatim is enforced in Plan 1 by the legacy views skipping `v4_reader` rows and the professor events RLS policy excluding them.
- **Colour comes from the content.** Each Lesson speaks in its own colour (live: `sampleAccent` of its first page). The skylight takes the colour of the Lesson that needs the owner most.
- **Luna says the one line**, beside the one white action. No lede under the title, no eyebrow above it; the Space's name rides on the back link.
- **Figures, not gauges.** Three figures with worded qualifiers, each with its last eight weeks as bars, parted by hairlines.

Rules adopted from Hallmark's floor and Impeccable's craft floor (how to run both: memory `reference_hallmark_impeccable`): no eyebrow (54) and no middle-dot meta (63) on the door's own chrome; never a gauge or progress ring standing in for a figure; no zero-offset glow on dark (elevation by lightness); no icon-in-a-coin cards (the lazy container); numbers in ink, colour as a swatch or a cell; one authored motion (cells and bars draw once); copy without em or en dashes; `aria-hidden` on decorative SVG; no colour literals outside tokens. Brief wins over tool: Inter stays (the app's face), the stage stays pure black. Open: `QuestionsRow`'s "name · time · page" meta still uses the dot (v4's house pattern).

## 8. Open for Abi
1. Privacy call on Strugglers + Journey (after the demo, with the room in front of you). Until then both stay behind `FEATURE_LANDING_PEOPLE`, off.
2. Whether the door also lists *what members shared* later (contributions are fixture-only today).
3. Questions above or below the map (§6, §7): one line either way.

Decided since: Luna's in-session check results do **not** feed the owner's view; Luna stays fully private (Abi, 2026-10-26).
