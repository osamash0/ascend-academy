# Viewer implementation audit

*2026-09-17 · branch `claude/viewer-implementation-audit-72b762` @ a696be1 · read-only pass, no code changed.*
*Gates checked: the 8 reader test files pass (186/186, 36 s).*

## 0 · The shape of the ground

There is not one viewer. There are **three**, on two design generations, and they do not share code:

| | Route | Data | Lines | Status |
|---|---|---|---|---|
| **A. v4 Reader** `features/spaces/screens/ReaderScreen.tsx` | `/v4/space/:spaceId/lesson/:lessonId/read` — **DEV-only** (`import.meta.env.DEV` guard on the whole `/v4` tree, `App.tsx:290`) | 100 % fixtures under `features/spaces/mocks/` | 878 + 5 reader components (~1,400) | Built 2026-08-31→09-16, 186 tests, self-review in `features/spaces/READER-REPORT.md` |
| **B. LectureView** `pages/LectureView.tsx` | `/lecture/:id[?slide=n]` (`SharedRoutes.LECTURE`) | Live: `/api/v1/localized-content/…` + Supabase signed URLs | 1,645 + `SlideViewer.tsx` 727 | Production student viewer |
| **C. InlineLecturePlayer** `features/student/components/InlineLecturePlayer.tsx` | Embedded in `pages/StudentCourseLibrary.tsx` | Same as B | 1,604 | Production; a second copy of B "inside the library" with its own react-pdf + markdown + quiz glue |

Also present, **unused**: `components/LectureChat.tsx` (drawer tutor with `slide_index` citation chips and a model picker) has zero importers. `components/PDFLightbox.tsx` is upload-side only (`LectureUpload.tsx`).

The rest of this report treats **A as the target** and **B as the source of live contracts**. C is B's twin and inherits every verdict on B.

---

## 1 · Components

### 1a · v4 Reader (A) — `src/features/spaces/`

| Component | Props | Owns |
|---|---|---|
| `screens/ReaderScreen.tsx` | route params only | **All reading state**: `view: 'read'∣'source'`, `railTab: 'tutor'∣'notes'∣null`, `page` (Material page), `quote` (carried selection), `turns: Turn[]` + id counter (tutor thread, lifted so it survives rail close), `noteTick`, `articleRef`. Derives `showToggle` / `effectiveView` from the four Lesson shapes (prose · pages · both · neither). Resets everything when `lessonId` changes (set-during-render). Composes header, dock wrapper, rail, both panels, `SelectionAsk`, `LessonPager`. Dock shift is two Tailwind literals `DOCKED_READ` / `DOCKED_SOURCE` (calc-clamped translate, no transition). Applies `inert` to the page below 640 px when the rail covers it. Loading/error/not-found branches via `useScreenState()` + `states.tsx`. |
| `components/reader/ReaderHeader.tsx` | `spaceName, lessonOrder, backTo, concepts: Concept[], view, onViewChange?, showToggle, railOpen, railTab, onRailToggle` | Fixed 56 px bar: exit link, breadcrumb, Read/Source `tablist` (only when `showToggle`), Concept dots (readout of `progress`, no handler), Tutor/Notes toggles with `aria-pressed`, 2 px `aria-hidden` scroll-progress bar (own `ratio` state). Exports `ReaderExit`, `VIEW_PANEL_ID`, `viewTabId`, types `ReaderView`, `RailTab`. |
| `components/reader/SourceView.tsx` | `pages: MaterialPage[], concepts, page, onPageChange, onJumpToPassage?` | Stateless. One light "paper" card (title + bullets), ‹ n / total › pager, "belongs to **{Concept}**" sync line. **Renders extracted text, not a PDF.** |
| `components/reader/ReaderRail.tsx` | `open, tab, onTabChange, onClose, tutor: ReactNode, notes: ReactNode` | Chrome only: `<aside aria-label="Reader companions">`, tab row, close, Escape listener, focus-in on open / focus-return on close. **Unmounted when closed** (no layout trace, no animation). 384 px; docks ≥900, overlays 640–899, full-bleed <640. |
| `components/reader/TutorPanel.tsx` | `lesson, groundingEnabled, onCiteConcept(conceptId), onCiteMaterial(page), pendingQuote?, onQuoteConsumed, turns, onTurnsChange, mintTurnId` | Only `draft` state. Grounded marker (iff `groundingEnabled`), empty state, thread of `Turn {id, question, quote?, status: pending∣done∣error, reply?}`, citation chips (concept → jump; page → inert text when `material === null`), 3 quick prompts, composer, retry on error. Calls `mocks/tutor.askTutor`. |
| `components/reader/SelectionAsk.tsx` | `articleRef, onAsk(quote), onSaveNote(quote)` | `selectionchange` scoped to the article, `MIN_SELECTION = 8`, fixed popover clamped to viewport, dismiss on outside/scroll/Escape/collapse, "Saved to your notes." live-region confirmation that survives selection loss. |
| `components/LessonPager.tsx` | `spaceId, prev, next, companionOpen?` | Fixed prev/next **Lesson** cards; binds ← → globally (conflicts with a page pager — noted in code, unresolved). |
| `components/Scene.tsx` | `surface, status?, gradientIndex?, motionKey?` | Always mounts `DepthScene`; fades a near-black layer in for `'focus'` surfaces (reader, practice, map). |
| `components/MotionRoot.tsx` | layout route | The one `MotionConfig` for `/v4` + route cross-fade. |
| `components/NoteEditor.tsx`, `components/states.tsx`, `components/Pressable.tsx` | — | Reused as-is by the reader. |

### 1b · Legacy (B) — `src/pages/LectureView.tsx` + `src/components/SlideViewer.tsx`

| Component | Props | Owns |
|---|---|---|
| `LectureView.tsx` | route `lectureId` | **Everything**: 30+ `useState` — lecture/slides/questions, PDF URL + retry, quiz answers, review stage, recap, XP, tabs `'slide'∣'worksheets'∣'related'`, tutor chat (`messages`, `streaming`, `chatActive`, abort ref), regenerate/undo, mind map, Pomodoro, TTS. Progress via `useSlideProgress`; XP via `GamificationProvider`; i18n via `react-i18next`. Tutor UI is inline (lines ~1500–1600), replacing the slide notes pane when `chatActive`. |
| `SlideViewer.tsx` | 25 props: `title, content, summary, slideNumber, totalSlides, onPrevious/onNext, isFirst/isLast, pdfUrl, pdfLoadFailed, onPdfRetry, pageNumber, onConfidenceRate, initialConfidence, mindMap*, isProfessor, onRegenerateContent/…Undo, onAskAbout` | One glass card, vertical: **react-pdf `Document/Page` on top** ("Original Source Material", text layer enabled → select-text → "ask about" popover feeding `onAskAbout`), markdown notes below (`react-markdown` + gfm + math + KaTeX), confidence rating, TTS, garbage-text detection, owner-only regenerate UI. |

---

## 2 · Data flow

### v4 Reader (A)
`data/useSpaces.ts` calls itself "the data seam" but **the reader bypasses it** — it only takes `useScreenState()` (the `?mock=loading|error` round-trip) from there. Everything else is imported straight from mocks:

```
spaceById(spaceId)                 mocks/spaces.ts
visibleLesson(space, lessonId)     mocks/lessons.ts   ← Rule 1 (members see published only)
adjacentLessons(spaceId, lessonId) mocks/lessons.ts   ← pager, published only
notesForLesson/addNote/updateNote/deleteNote   mocks/notes.ts  ← module-level mutable array + noteTick
askTutor(lessonId, question, quote?) → Promise<TutorReply>   mocks/tutor.ts  ← the declared swap seam
```

**Lesson shape** (`types.ts`): `id, spaceId, title, order, state, origin, author, grounding, progress, percentComplete, concepts: Concept[] {id, name, progress}, material: Material | null, contributionCount, practiceCount, passages?: Passage[]`.
`Material {id, filename, sizeBytes, uploadedBy, uploadedAt, sourceRemoved, pages?: MaterialPage[]}` · `MaterialPage {page (1-based), conceptId, title, bullets: string[]}` · `Passage {conceptId, heading, body: string[]}`.
Both prose types are **plain text arrays — the renderer has no Markdown path** (READER-REPORT finding 3 fixed a fixture rather than add one). Only `l-s-dbs-4` (Normalization) and `l-s-crypto-6` carry passages; only `l-s-dbs-4` has pages.

### Legacy (B)
```
fetchLocalizedLectureBundle(id)   services/lectureService.ts
  → GET /api/v1/localized-content/lectures/{id}
  → { locale, requested_locale, is_original_language,
      lecture: Lecture {id,title,description,total_slides,pdf_url,poster_url,course_id,source_language,content_revision},
      slides: Slide[] {id, slide_number, title, content_text, summary, regen_instruction?},
      questions: QuizQuestion[] }

resolvePdfUrl(lecture.pdf_url)    services/lectureService.ts
  → supabase.storage.from('lecture-pdfs').createSignedUrl(path, 8h)
    sessionStorage-cached, 3× backoff on 5xx (egress fix, 2026-08-17)
  → react-pdf <Document file=url> <Page pageNumber={slideIndex+1}>
```
- **PDF** = private bucket `lecture-pdfs`, signed client-side under RLS. Poster WebP in `lecture-posters`.
- **"Parsed Markdown"** does not exist as a document. What exists is **per page**: `slides.content_text` (extracted text, parser writes it as `content`) and `slides.summary` (AI narrative). Both are rendered as Markdown. One slide row == one PDF page; `slide_number` is 1-based in the table, `slide_indices` in `concept_lectures` are 0-based (`synthesis.py:224`).
- Chunks for retrieval live in `slide_chunks (lecture_id, page_index, chunk_index, text, section, embedding)`; raw parser output per page sits in `parse_pages.content JSONB`. Neither is API-exposed for reading.

---

## 3 · Backend contracts

All under `/api/v1`, bearer auth, mounted in `backend/main.py:231-267`.

| Endpoint | Returns | Used by |
|---|---|---|
| `GET localized-content/lectures/{id}` | the bundle above; viewer check = professor ∨ student owner ∨ enrolment | B, C |
| `POST localized-content/lectures/{id}/retry` | `{lecture_id, status}` | B ("preparing" branch) |
| `POST ai/chat` — `ChatRequest {slide_text, user_message, chat_history[], ai_model='cerebras', lecture_id?, pdf_hash?, current_slide_index?, session_id?}` | `ChatResponse {reply, citations: [{slide_index, similarity}], session_id?}` — **JSON only, no streaming** (the SSE branch in `LectureView.handleAsk` is dead code). Grounding = `match_slides_by_lecture` RPC over `slide_embeddings`; citations filtered to retrieved set. 30/min. | B, C |
| `POST search/ask` — `{course_id, question, history, ai_model, allow_ungrounded}` | `{reply, citations: [{source_index,…}], grounded: bool}` — refuses before the LLM call when not grounded unless `allow_ungrounded` | course "Ask anything" (not the viewer) |
| `GET concepts/lecture/{id}` | `{success, data: [{concept_id, name, weight, slide_indices[]}]}` | B "Related across courses" panel |
| `GET concepts/{id}/related-lectures` | related lecture list | B |
| `GET mind-map/{lecture_id}`, `POST …/generate` | tree | B (feature-flagged off in `SlideViewer`) |
| `POST ai/slides/{id}/regenerate-content`, `…/undo-regenerate` | `{slide}` | B, owner only |
| `POST/GET ai/sessions`, `GET ai/sessions/{id}/messages` | persisted tutor sessions | **nobody in the viewer** — B keeps the thread in memory |
| Storage (direct) | signed URL on `lecture-pdfs` | B, C |

### What the v4 UI needs that nothing exposes

1. **`Lesson.passages` (prose per Concept).** No table, no generator. Nearest raw material: `slides.summary` per page + `concept_lectures.slide_indices` to group pages under a concept. Prose would still have to be generated or authored.
2. **`MaterialPage {title, bullets, conceptId}` in one call.** `slides` has title/content per page; the concept assignment lives in `concept_lectures.slide_indices` (0-based). Two calls plus a client join today; no bullets (content is Markdown text).
3. **Concept-level tutor citations.** `/ai/chat` cites `slide_index` only. `materialPage` ≈ `slide_index + 1` is a direct map; `conceptId` needs the `slide_indices` reverse lookup.
4. **`grounded` flag on the Lesson tutor.** `/ai/chat` never says; `/search/ask` does but is course-scoped and has no `lecture_id`. `Space.groundingEnabled` / `strictMode` have no columns.
5. **Concept progress (`untouched∣discovered∣cleared`).** `concept_mastery` table exists (`20260503000011`) — whether it is written today was not verified in this pass; memory notes flagged it dead in July.
6. **Private Lesson-anchored Notes.** No table found in `supabase/migrations`.
7. **Space / Lesson lifecycle / Origin / roles.** v4 concepts with no schema (already logged as NEEDS-BACKEND across the namespace, 14 sites).

---

## 4 · Reuse verdict

**Build on (clean, pure props, tested):**
- The five `components/reader/*` files and `LessonPager`. State is lifted to the screen; the rail owns nothing; every prop is data or a callback. 186 tests including a11y, responsive, and fixture-consistency guards.
- `mocks/tutor.ts::askTutor` **signature** — `(lessonId, question, quote?) → Promise<{text, citations: [{label, conceptId?} | {label, materialPage?}]}>`. Keep the signature, replace the body.
- `Scene` / `MotionRoot` / `Pressable` — the motion contract for the whole namespace.
- `services/lectureService.ts::resolvePdfUrl` + `fetchLocalizedLectureBundle` — hardened, cached, typed. Import them into the seam; do not rewrite.
- `backend/services/ai/tutor.py::chat_with_lecture` + `retrieval.py` — real grounding, real citations, real tests.

**Tangled (do not extend; extract what you need):**
- `LectureView.tsx` (1,645 lines, ~30 state atoms, five features in one component) and `InlineLecturePlayer.tsx` (its 1,604-line twin). Any fix lands twice.
- `SlideViewer.tsx` — 25 props; PDF rendering, TTS, confidence, regenerate, mind map and ask-about in one card. The **react-pdf setup block** (worker URL, `Document/Page`, text-layer selection → popover, `PdfLoadingIndicator`, slow-load copy) is the one piece worth lifting out.
- `LectureChat.tsx` — dead; has a model picker (rejected by the v4 design). Delete rather than revive.

**The seams, in order of leverage:**
1. **`ReaderScreen` lines 1–20** — the four mock imports (`spaceById`, `visibleLesson`, `adjacentLessons`, notes store). Route them through `data/useSpaces.ts` first, so the swap is one file.
2. **`askTutor`** — one module, one function.
3. **Type adapters** — `Slide[] → MaterialPage[]` (page = `slide_number`, title, bullets ← content) and `Slide[] + concepts_for_lecture → Passage[]` are pure functions with no home yet.
4. **`SourceView`'s card body** — currently text; a real Material view swaps the card for `<Page>` from react-pdf fed by `resolvePdfUrl`. The pager, sync line and the page-lifted state stay.
5. **`useScreenState`** — becomes the real loading/error of whatever fetch replaces it; the branches already exist.

---

## 5 · Motion & state today

**v4 (A)** — `motion/react` v13 (`motion` package), *not* framer-motion.
- One `MotionConfig`: `duration 0.18`, ease `[0.2,0,0,1]`, `reducedMotion="user"` (`MotionRoot`). Route cross-fade 0.16 s opacity, `mode="wait"`, keyed per screen.
- `Scene` blackout fade 0.45 s; `Pressable` spring 400/30 hover 1.04 / tap 0.98 — the only spring.
- **The reader itself animates almost nothing**: the rail mounts/unmounts, the dock steps (Motion can't interpolate a `calc` of percentages; `transition-transform` is banned namespace-wide because it ignores reduced motion), the passage jump uses `scrollIntoView` with `behavior` from `useReducedMotion()`. The header's scroll bar is CSS width.
- State: `useState` in `ReaderScreen`; a module-level mutable notes array + tick; no context, no store, no react-query in the namespace. Vocabulary law enforced by `scripts/check-vocabulary.mjs` (10 words; the reader brief's *slide/deck/document* are not in it).

**Legacy (B/C)** — `framer-motion` v12, 99 importing files.
- Slide change animates **twice**: `LectureView` wraps `SlideViewer` in `AnimatePresence mode="wait"` (y ±20, 0.5 s) and `SlideViewer` wraps its body again (x ±10, 0.4 s). PDF popover and TTS bars are `AnimatePresence`d. `DepthScene` + `LectureBackdrop` parallax console under everything.
- State: `useSlideProgress` (persisted per slide via `studentService`), `GamificationProvider` context for XP, `useAuth`, react-query client used only for invalidation, `react-i18next` for all copy. Chat thread in-memory, lost on unmount.

---

## 6 · State of the ground

The v4 reader is a finished, well-tested **UI shell with no data behind it**: clean components, a deliberate tutor seam, a motion contract, and a Lesson type whose two content fields (`passages`, `material.pages`) correspond to nothing the backend stores. The production viewer is the opposite: real data, real grounding, real PDF rendering, wired into two monolithic components that duplicate each other and animate the same change twice. The live contracts are narrower than the v4 shapes in three specific ways — content is per page not per Concept, citations are page indices not Concept ids, and the Lesson tutor never reports groundedness — and wider in one: the bundle is locale-resolved, which the reader has no concept of. The design session should treat the reader components and `lectureService` as fixed points and spend its decisions on the adapter layer between them and on which of the two production viewers the reader replaces.

## 7 · Open questions for the design session

1. **What is the Source view?** Rendered PDF pages (what B does, via `resolvePdfUrl` + react-pdf) or extracted text cards (what the mock draws)? The Material type has no `pdfUrl`.
2. **Where do passages come from?** Generated per Concept at ingest, authored, or is the Read view really the per-page `slides.summary` Markdown re-labelled? If Markdown, the passage renderer needs a Markdown path it currently refuses.
3. **Tutor endpoint:** extend `/ai/chat` (add `grounded`, concept citations, drop `slide_text`) or a Lesson-scoped sibling of `/search/ask`? Streaming, yes or no — nothing streams today.
4. **Citation granularity:** page vs Concept. Both need the `slide_indices` map; who owns it, client or server?
5. **Which viewer does the reader replace** — `LectureView`, `InlineLecturePlayer`, both — and how do `/lecture/:id` and `/v4/…/read` coexist while `/v4` is DEV-only?
6. **Identity:** does a v4 `Lesson.id` equal a `lectures.id`, and `Space.id` a `courses.id`? Nothing asserts it either way.
7. **Progress:** reading changes nothing (locked). What replaces B's confidence rating, per-slide progress and completion XP in the reader, if anything?
8. **Notes persistence** — table or keep in Library only?
9. **Locale:** the bundle can arrive in the "wrong" language with `is_original_language`; the reader has no copy for that and no i18n at all.
10. **Motion library:** unify on `motion/react` (v4) or keep framer-motion for the legacy tree during coexistence?
11. **Arrow keys:** `LessonPager` claims ← → for Lessons; the Source pager wants them for pages. One screen, one meaning.
