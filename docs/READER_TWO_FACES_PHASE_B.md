# Lesson Reader · Two Faces — Phase B (prototype)

*2026-09-18. Builds the survivor of `READER_TWO_FACES_PHASE_A.md` (Focal Plane, since renamed) on the ground mapped in `VIEWER_IMPLEMENTATION_AUDIT.md`. Branch `claude/viewer-implementation-audit-72b762`, uncommitted.*

## Open it

```
/v4/space/s-dbs/lesson/l-s-dbs-4/faces
```

Dev-only, like every `/v4` route. It sits **beside** the existing reader at `/read` so the two can be compared; nothing in the old reader changed. The Material is the real Normalization deck (82 pages, `public/v4-mock/normalization.pdf`, 5.5 MB — copied from Downloads, not yet committed). The only Lesson with content is `l-s-dbs-4`; every other Lesson says "Nothing to read yet" and offers the way back.

What to try, in order: the page is the light; press the dark around it. `\` turns it over from the keyboard. Select a sentence on either face. Press an idea's name in the text. Press the small white page beside a block. Press the formula on page 6. Press the spine at the right edge. Practise what you just read, then press the room.

## Reused, extended, new — and why

| Piece | Verdict | Why |
|---|---|---|
| `TutorPanel` | **Reused** + one optional prop `landable` | The thread, citations, quick prompts and composer are exactly the design. The only thing the fixture-bound version could not do was answer "can this citation land?" against real pages, so the caller may answer it. |
| `SelectionAsk` | **Reused unchanged** | Already scoped to an element by ref; passing the focused face's ref makes it work on the PDF text layer too. Its two verbs are the design's two verbs. |
| `SourceView` | **Extended** with a `sheet` slot | The pager and the "This page belongs to {Concept}" line are the sync mechanism between faces. The text card they wrapped is replaced by the rendered page. |
| `ReaderRail` | **Refactored**: its focus/Escape contract lifted into `useSummoned` | The rail as a permanent home dies; its two promises (focus in, focus back, Escape unless typing) live on in the companion card. The rail itself still works and still passes its tests. |
| `ReaderExit` | **Reused** | The one piece of chrome the design keeps. |
| `NoteEditor`, `states.tsx`, `LessonPager`, `Pressable`, `Scene`, `MotionRoot` | **Reused unchanged** | Notes, skeletons, the end-of-Lesson pager, the press feel, the surface rule, the one MotionConfig. |
| `mocks/tutor.ts::askTutor`, `mocks/notes.ts`, `mocks/practice.ts` | **Reused unchanged** | The tutor seam keeps its signature; notes and practice are the same stores the rest of v4 reads. |
| `SlideViewer`'s react-pdf block | **Lifted** into `src/components/pdf/PdfPage` | The rendering alone: worker, `Document`/`Page`, text layer, slow-load copy. `SlideViewer` itself is not yet rewired to it (see next hour). |
| `LectureView`'s three `PROSE_CLASS` copies | **Replaced** by `src/components/markdown/Prose` | One renderer for the pipeline's Markdown, typed to the craft spec, outside the namespace so the old product can adopt it. |
| `ReaderHeader`'s tablist, dots, rail toggles | **Not used** | A header toggle, a progress readout in the chrome, and permanent companion buttons are three of the anti-patterns. The dots became the spine. |
| `FocalPlane` (`Plane`, `Block`) | **New** | Nothing in the codebase blurs and recedes a live layer, or ripples sharpness from an anchor. |
| `ReadingFace`, `SourceFace` | **New** | The two faces as scroll-owning planes that report and follow one anchor. |
| `Spine` | **New** | Replaces the step pills. Scales to forty. |
| `Companion` | **New** (chrome only) | An anchored card is a different object from a docked rail; what goes in it is reused. |
| `PracticePlane` | **New** (thin) | The Lesson's practice bank on a workbench plane, so leaving practice is the same gesture as switching faces. `PracticeScreen` is a routed screen and could not be mounted as a plane. |
| `anchors.ts` | **New**, pure | The shared spine: sections from `Slide[]` + `LectureConcept[]`, anchors, first pages. No React. |

## The seams are real

`data/useSpaces.ts` gained two hooks whose **return types are the endpoints' own** — `LocalizedLectureBundle` and `LectureConcept[]`, moved into `@/types/domain` and re-exported from the services that fetch them:

```ts
useLesson(spaceId, lessonId)      → { state, space, lesson, prev, next }   // Rule 1 applied
useLessonContent(lessonId)        → { state, bundle, concepts, pdfUrl }
```

The live bodies are three existing calls: `fetchLocalizedLectureBundle`, `fetchLectureConcepts`, `resolvePdfUrl(bundle.lecture.pdf_url)`. No component knows which body is behind the hook. The mock body reads `mocks/content.ts`, whose `Slide[]` rows were generated from the real deck with `pdftotext` and structured the way the parser structures a page.

The namespace's import guard was widened by three deliberate lines (`@/components/pdf`, `@/components/markdown`, `@/types/domain`), each with its reason in `boundary.test.ts`.

## Required endpoints (what the UI uses that nothing returns)

1. **Lesson tutor with `grounded` and Concept citations.** `POST /api/v1/ai/chat` returns `{reply, citations:[{slide_index}]}`. The panel needs `{conceptId | materialPage}` and, where the Space has grounding on, `grounded: boolean`. `materialPage = slide_index + 1`; `conceptId` is the reverse of `slide_indices`, which the client can do until the server does. The course-scoped `/search/ask` already returns `grounded`; a Lesson-scoped sibling is the smaller change.
2. **Private, Lesson-anchored notes.** `mocks/notes.ts` has no table.
3. **Concept progress per Learner.** `concept_mastery` exists; nothing serves `untouched | discovered | cleared` for a Lesson's Concepts.
4. **The Lesson's accent colour.** Sampled client-side from the rendered page today (`sampleAccent`, settling on the first content page). Belongs on the Lesson at ingest.
5. **Pages with Concepts in one call** would remove a client join, but is not required: `slides` + `concept_lectures.slide_indices` suffice.

## Verified

- `tsc -p tsconfig.app.json` clean · `vitest run src/features/spaces` **56 files, 669 tests** (23 new) · `check-vocabulary.mjs` clean over 90 files · eslint: no errors.
- In the browser at 1440×900: opens on the Material with only exit, spine, pager, sync line and one hint; the room press turnes with the ripple; the accent settles on the deck's blue (`hsl(194 90% 68%)`); spine jumps land on a Concept's first page; selection → Ask opens the tutor beside the sentence; a `Material · page 2` citation turns the object to page 2 and the reading face is at page 2 when pressed back; the heading mark opens notes; the page chip turns to that page; the formula on page 6 opens a question about itself; practice recedes both faces and returns to the face it left; at 900px the card sits under the block.

## Known gaps, stated

- **Phone width.** The page chips sit in a left margin the phone does not have, and the spine crowds the right edge. Both need another home below `sm`.
- **A companion can open out of view** when its mark is not on screen (only reproducible by scripting; a person presses a heading they can see). It never auto-scrolls, on purpose — a card that dragged the page was the worst bug of this pass.
- **Formula mark is pointer-only.** KaTeX output has no focusable element; the keyboard route to the tutor is the selection verbs and the sr-only face switch.
- **Blur cost.** Every block carries its own filter. Fine on this deck; an offscreen cull is the obvious optimisation.
- **Peek** was cut, per the Phase A default.

## After Abi's first look (2026-09-18)

- **Not a focus surface.** The reader renders through `SURFACES.lessonFaces = 'browse'`: the console wash, glow and particles sit under the blurred other face. Plain black made the page float in a void. The old `/read` reader keeps `focus`.
- **Blur toned down.** `room.blur` 28 → 10px, `room.scale` 1.14 → 1.06. The receding face now reads as the same object one step back rather than a smear. Phase A's numbers are superseded by these.
- **Blur removed.** After toning it down, it went: the receding face only dims; it is flat wallpaper (scale 1). `FocalPlane.tsx` became `Planes.tsx`; `Block` is a plain wrapper; the ripple is gone with the blur. The Phase A "moment of delight" therefore no longer exists and needs a new answer.
- **The name.** Route `/faces`, screen `LessonFacesScreen`, no "focal" wording left in code. The Phase A document keeps the name as the record of the concept.
- **Focus.** The companion card no longer takes keyboard focus when it opens (`useSummoned(…, { takeFocus: false })`); Escape still closes it. A button pressed by pointer releases focus, so the next key press does not light a ring on it.
- **Wallpaper is content only.** When a face is behind the other, its pager, sync line and footer fade to zero (`SourceView` gained a `wallpaper` prop); only the page or the column shows through.

## Phase B2 — concept C built (2026-09-18)

Built from `READER_TWO_FACES_PHASE_A2.md`, on the same skeleton:

- **One slot, two faces.** `Planes.tsx` is an opacity switch (320 ms). The other face is transparent, `inert`, hidden from assistive tech. No blur, no scale, no room press.
- **The room is the current page.** `Room.tsx`: a still of the page at the anchor, blurred 40px once (a static filter on an image), dimmed 60 %, dissolving to the next page over 1.1 s. `RoomStill` renders the page out of sight at 640px and hands over its pixels; stills are cached per page. Required endpoint: a poster per page (today `poster_url` is page 1 only).
- **The turn is a verb on the words.** `SelectionAsk` gained an optional third verb (`also`): **Read this** on the page, **Show page** in the text. The caption's Concept press and the page chips remain as the other bridges; `\` and the sr-only button for the keyboard.
- **The same sentence, found.** `findText.ts` locates the selected words on the other face across its markup (text layer spans or paragraphs); `FoundLine.tsx` draws a hairline in the accent under each line of the match, left to right, and fades. Absent where the words are not on the other face (authored prose; scanned pages).
- **Companion on the page** (Moonlight) at the height of the selected words when the window is ≥ 760px; under the page otherwise. Beside the column in the text as before.
- Verified in the browser: room still behind the card; `\` turns; select "Thorsten Papenbrock" on page 1 → Read this → the column arrives with those words underlined; select "Requirement Analysis" in the text → Show page → page 2 with the words lit on the text layer; Ask from the page → card on the page.
- Gates: `tsc` clean · spaces suite green · vocabulary clean · lint no errors.

## Phase B3 — the document, and a studio above it (2026-09-18)

Abi, on seeing C: "I want the original PDF to be the original full preview and the studio is a layer above it." Built as the first of the two readings: the text is in the layer.

- **The document is the ground.** `src/components/pdf/PdfScroll.tsx` (new, shared): one `Document`, every page as a slot of the right aspect from the moment the file opens, pages painted only within two screens of the window and released again. Text layer on. Reports the page under the anchor line; `scrollToPdfPage` takes it to a page. Route unchanged: `/v4/space/:spaceId/lesson/:lessonId/faces`.
- **The room** is still the blurred still of the current page (`Room`, `RoomStill`), behind the whole document.
- **The studio** (`components/reader/Studio.tsx`, new): a 440px layer over the right of the document (full width below 1024px), summoned and dismissed; the document steps aside by half its width as a transform. Inside it, `ReadingFace` unchanged — the column, the marks, the companion in flow, the practice footer — following the document's anchor. Escape peels one layer: the companion first, then the studio.
- **Ways in.** Select words on the page → Ask · Keep · **Read this** (opens the studio at those words, underlined). Select in the studio → Ask · Keep · **Show page** (scrolls the document to the page, lights the words on its text layer). The Concept's name in the page line at the bottom left. `\`. The spine's ticks and the text's page chips scroll the document.
- **Removed:** `SourceFace` (the single-page face), the two-face dissolve as the model. `Planes.tsx` remains the opacity switch `ReadingFace` and `PracticePlane` render through.
- Verified in the browser: pages window in and out while scrolling; the page line follows; the Concept press opens the studio at page 6 with the text positioned there; "Read this" on "German: Funktionale Abhängigkeit" underlines it in the studio; "Show page" on "Goal: Avoid redundancies" scrolls the document to page 5 and underlines it on the page; Escape closes the notes and leaves the studio.
- Gates: `tsc` clean · spaces suite **57 files, 675 tests** · vocabulary clean · lint no errors.
