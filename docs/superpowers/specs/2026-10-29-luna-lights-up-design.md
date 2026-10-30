# Luna lights up: the reader's faces arrive page by page — design

**Date:** 2026-10-29 · **Status:** agreed with Abi (decisions below) · **Tracks:** LS-039 · **Builds on:** `2026-10-26-library-and-spaces-design.md` §3 ("Luna reads along: the lights come on"), the instant reader (PR #139, branch `feat/instant-reader`)

## Why

Today a dropped file opens at once, but the full reader — Explain, Text, Ask, Practise, Luna — only arrives when the whole run is complete. In the live test (2026-10-29, an 82-slide deck) that was 703 s, and the last ~3.5 min of it came after Luna had already written every page: the timeline looked full while nothing happened.

Most of what the faces need exists long before the run ends. This design lets each face switch on per page as soon as its data exists, and moves the handover to the full reader from "run complete" to "first pages written".

## What the pipeline already gives (facts, 2026-10-29)

- `parse_pdf_unified` creates the `lectures` row, its `pdf_url` and `parse_runs.lecture_id` **before** any slide.
- Slides are written in **chunks of 8** as the per-slide synthesis finishes (`title`, `content_text`, `summary`, …). Slides carry no explanation and no quiz.
- Practice questions (`quiz_questions`) are written **once, at finalize**, from one deck-wide call.
- After the last slide the run still does: deck quiz, finalize, EN/DE localization of the whole deck, an embedding join (up to 2 × 120 s), concept graph (flag-gated), then `COMPLETED`.
- `GET /v4/reader/lectures/{id}` answers **409 only while the lecture has zero slides**; with one or more slides it returns 200 with the slides so far (`total_slides` is 0 until finalize).
- `POST …/pages/{p}/explain` and `…/ask` need only that page's slide row (404 before it exists). The Text face reads slide rows. None of them need the run to be complete.
- `GET …/ideas` (chapters) is generated lazily from slide titles. Luna's study session plans over the whole lesson.
- The student has no live channel to parse events; the reader polls `GET /v4/uploads/{run_id}/reading` every 3 s.

## Decisions (2026-10-29)

1. **Full reader early.** The person moves from their own file to the full reader as soon as Luna has written her first pages, at the page they are on. One reader; no dead wait at the end.
2. **Practise lights up at the end.** No parser change. Practise stays hidden until the questions exist, then appears once.
3. **Pages Luna hasn't reached show only Page.** Explain, Text and Ask are hidden on those pages and appear when she gets there.

## Design

### 1 · The reading status gains per-page readiness (backend)

`GET /api/v1/v4/uploads/{run_id}/reading` (`reading_view` / `early_reading` in `backend/services/v4_spaces_service.py`) adds three fields:

| Field | Meaning |
|---|---|
| `pagesReady: number[]` | slide numbers that have a slide row for this run's lecture, ascending (all pages once ready) |
| `practiceReady: boolean` | at least one `quiz_questions` row exists for the lecture |
| `readable: boolean` | the lecture exists and `pagesReady` is non-empty — the Lesson can be opened, whatever the stage |

- `pagesRead` stays (it is `pagesReady.length`), so the current early reader keeps working.
- `stage` keeps its three values (`developing` → `ready`, or `failed`). `readable` is a separate flag, so every existing "still developing" check keeps polling unchanged. (Decided while planning, 2026-10-29: a fourth stage would have touched every such check for no behavioural gain.)
- A failed run keeps its `pagesReady` and `lessonId`, so pages already written stay usable.
- Ownership is unchanged: the caller's own run only, otherwise 404.
- Payload size: at most one integer per page (≤ a few hundred), polled every 3 s while the run is going.

### 2 · The handover moves to `readable`

- `EarlyReader` hands over once, when `readable` and `lessonId` are set, at the current page (today: only at `ready`). The handover URL carries the run id (`&run=<runId>`) so the full reader knows which run to follow.
- The Library cover (`coverOf` in `useShelf.ts`) opens its Lesson when the upload is `ready` or `readable`. `GET /v4/uploads` gains the same `readable` flag, so the cover and the reader agree.
- Everything else of the handover stays as built in #139: whichever side notices first keeps the page; the local file is released on handover.

### 3 · The full reader follows the run (frontend)

The full reader (`LessonFacesScreen`) learns the lesson is still being read from the upload's reading status. A lesson that is not a still-running upload behaves exactly as today.

- **Run status in the reader.** A small hook gives the reader `{ pagesReady, practiceReady, stage, pages }` for the open lesson while its run is not `ready`, by polling the reading endpoint every 3 s. It stops at `ready` or `failed`. The lesson → run link is the `run` URL parameter from the handover, else the shelf's uploads (the upload whose `lessonId` is this lesson and which is not `ready`).
- **Refetch, never pin a partial bundle.** While the run is going, the reader re-reads the lesson (`getLecture`) whenever `pagesReady` grows, and the `lectures` memo does not keep a partial bundle once the run is `ready`. The page count shown is the run's `pages`, not `total_slides`.
- **Per-page faces.** On a page in `pagesReady`, the view tabs Explain and Text and the Ask companion show as today. On any other page only Page shows: the tabs are not rendered, and keys 2–3 do nothing. If the person is in Explain or Text and turns to a page Luna hasn't reached, the reader returns to Page.
- **Timeline.** The grey "read" part of `ReaderTimeline` is `pagesReady` (the highest contiguous page from 1, so it reads as a buffer).
- **The first light is seen.** The first time the tabs appear on the page the person is on (during this visit), the controls wake for ~4 s, the new tabs get a soft ring once, and Luna says one line once: "Explain is ready for this page." Never again for later pages in the same visit. Reduced motion: no ring animation, the line still shows.
- **Practise at the end.** The Practise entry is hidden until `practiceReady`. When it becomes true during the visit, it appears once with the same soft ring and Luna's line "Practise is ready." `usePracticeQuestions` must not keep an empty result cached from before `practiceReady`.
- **Chapters wait.** While the run is going, the deck is one section and `/ideas` is not requested; it is requested once the run is `ready`.
- **Luna's study session waits.** The offer to start a session is hidden until the run is `ready`.

### 4 · Edge cases

- **Run fails midway.** Pages in `pagesReady` keep their faces; the rest stay Page only; Practise stays hidden. One calm line, once: "Luna couldn't finish reading this — what she read is here." No retry from the reader (the Library's existing "Try again" stays the place for that).
- **Leaving and coming back.** The reader starts from whatever the reading status says at that moment; the first-light moment fires only for a change seen during the visit.
- **A lesson opened from a Space (not a still-running upload).** No reading status, no polling: exactly today's behaviour.
- **Cache churn (accepted).** Every slide insert bumps `content_revision`, so cached Explain/Ask answers for earlier pages miss once more pages land. Correct but costs repeat LLM calls. Not addressed here; noted for a later change of the cache key.
- **Localization.** While the run is going the reader serves canonical slide rows (the locale snapshot is written in the tail). The switch to localized text at `ready` happens on the next refetch; the page the person is on stays put.

### 5 · Copy (en + de, `v4Reader`)

| Key | en | de |
|---|---|---|
| `lights.explain` | Explain is ready for this page. | Erklären ist für diese Seite bereit. |
| `lights.practice` | Practise is ready. | Üben ist bereit. |
| `lights.stopped` | Luna couldn't finish reading this — what she read is here. | Luna konnte das nicht fertig lesen — was sie gelesen hat, ist hier. |

German avoids "Folie" and "Datei" (`docs/V4_GLOSSARY.md`).

## Principles kept

- Never wait: reading starts at zero seconds; faces are an upgrade, never a gate.
- Only show what we provide: a face appears only where it works.
- One fact, once: the page count lives in the timeline only.
- Monochrome; only Luna carries colour. Reduced motion respected.

## Out of scope

- Per-batch practice questions (parser change; rejected 2026-10-29).
- A live push channel (SSE/WebSocket) for parse events; polling is enough.
- Explaining pages Luna hasn't reached from the raw PDF text.
- Changing the `content_revision` cache key.
- Ghost Spaces and "Make it a Space" (separate specs).

## Testing

- **Backend unit:** `reading_view` for each stage (`developing` / `ready` / `failed`) and `readable`, `pagesReady` ordering and the all-pages case at `ready`, `practiceReady`; `uploads_for` emits `readable`; route still 404 for a foreign run. No database (fake connection, as in `test_v4_early_reading.py`).
- **Frontend:** handover at `readable`; cover opens its Lesson at `readable`; per-page tabs (shown on ready pages, absent elsewhere, Explain → Page when turning past Luna); refetch when `pagesReady` grows; timeline buffer; first-light fires once; Practise appears at `practiceReady` and not before (no pinned empty cache); `/ideas` and the Luna offer wait for `ready`; failed run keeps read pages; a Space lesson does not poll.
- **Live:** one real upload — time to first tabs, the first-light moment, Practise arriving, no dead wait at the end.
