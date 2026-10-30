# Library & Spaces: drop it, read it now, it gets smarter — design

**Date:** 2026-10-26 · **Status:** direction agreed with Abi (three decisions below) · **Supersedes:** `2026-10-24-first-run-tour-design.md` (the separate tour) · **Builds on:** `2026-10-11-one-library-design.md` · **Tracks:** LS-038, LS-039

## Vision

> **Drop anything. Read it now. Luna makes it smarter while you read, and tidies it into Spaces when it belongs together.**

The Library is the best place to *hold* your files: bringing them in takes no effort, and reading them is excellent even if you never touch an AI feature. Spaces are where files become a *learning path*. People understand Spaces by seeing their own files as one, never by reading an explanation.

Most people are lazy about files. So: **no sorting, no forms, no waiting, no questions at the door.**

## Decisions (2026-10-26)

1. **Read instantly.** A dropped PDF opens at once in a plain but excellent viewer, straight from the device, before the upload finishes. Explain, Ask and Practise light up in the same viewer as Luna finishes. No waiting screen.
2. **Ghost Spaces.** When files belong together, Luna shows a dashed, suggested Space with those files already in order. One tap makes it real. Nothing happens without that tap.
3. **Private by default.** A Space made from your own files is yours alone. Inviting or opening it up is a later, separate step inside the Space.

## Four situations, one flow

Every scenario we listed (pupil with a worksheet, student with slides, a paper, a manual, a whole course, a book in chapters, a training, a language course, an end-of-term folder, a curious visitor) is one of four situations:

| Situation | What the person does | What happens |
|---|---|---|
| **Understand one thing** | drops one file | It opens at once; the smart faces arrive while they read |
| **Go through a subject** | drops several related files, now or over weeks | Reads at once; Luna offers a ghost Space "{Topic} · {n} parts" |
| **Sort a pile** | drops a folder or a mix | Everything lands on the shelf, titled and grouped; ghost Spaces for each group |
| **Nothing yet** | — | A real example page to try, or open Spaces to join |

Exam dates, studying with others and teaching are **not** asked at the door. They are options *inside* a Space later (a test date, inviting people).

## The flow

### 1 · Bring in (everywhere the same)
One entrance with four doors: the empty Library, the first shelf cell **Bring something in**, the full-page drop veil (One Library §5.3), and **Bring in a file** on Home. All of them accept one file, many, or a folder.

### 2 · Read now: the Reader
**Upgrade, don't replace.** The one v4 reader is `LessonFacesScreen` (`/v4/space/:spaceId/lesson/:lessonId/faces`). Space lessons and a student's own uploads both end there: `/v4/library/m/:id` redirects into it once processing has made the lesson. This work upgrades *that* reader. It does not build a second one. The throwaway demo `/v4/reader-lab` (2026-10-26) only shows the target feel.

**What it already has (2026-10-26, after syncing with main):**
- Full-viewport black stage, with chrome that fades after 2.8 s (`useIdle`).
- `PdfPager` with the shared pdf.js worker (#119); ←/→, wheel and swipe turn the page; ↑/↓ step through a slide's points.
- Page · Explain · Text tabs. Explain includes Ask and Related; Practise is a separate layer.
- Luna study sessions (#125): a side column at ≥1024 px and a bottom sheet below that. Luna drives the page.
- Night paper, a "turn your phone" hint, and saving a selection as a note.

**What it lacks:**
- Opening before processing ends: the backend answers 409 until the lecture has content, and the Library shows a wait screen.
- A document (portrait) mode.
- A timeline and any processing progress.
- The Fullscreen API and safe-area handling.
- Find in the document, and zoom.

- **Instant open.** The first file opens straight away, rendered from the local file (object URL), so there is no network wait (the demo measured ~300–800 ms to the first page on an 82-slide deck). Once the upload is done, the Reader switches to the signed URL.
- **Two modes, one set of controls**, chosen from the page shape (page 1's width vs height):
  - **Slides → cinema.** One slide fills the screen on black, as large as it fits. The frame is exactly one page wide, so the neighbouring slides never peek in. Turn with ← → / space, a swipe, or the wheel.
  - **Documents and papers → scroll.** Full-width pages, scrolling (`PdfScroll`). Fit-to-screen would make portrait text tiny.
- **Controls behave like a video player.** The top bar (back, title, full screen) and the bottom bar (timeline, faces, Luna) fade out after ~2.5 s of stillness, and the pointer hides. Any move, tap or key brings them back. They stay while a face other than Page is open, while the pointer rests on them, and while Luna is saying something.
- **The timeline is the deck.** White = where you are. Light grey = how far Luna has read (the "buffered" part of a stream). Hovering shows "Slide 34 · Luna soon". A click jumps there. This is how processing is explained without a word.
- **Faces: split by what they are** (decided with Abi 2026-10-26):
  - **Explain · Text · Practise replace the page**, as on the landing. They cross-fade over the whole stage, and Esc / Page goes back. This replaces today's dock-beside-the-page `Studio` for these faces.
  - **Luna's study session stays beside the page** (side column on desktop, bottom sheet on phones), as today. It is a conversation *about* the page and turns pages itself, so the page must stay in view.
  - Keys 1–4 switch faces; F toggles full screen.
- **It needs no AI to be great:** jump to page, find in text, your own highlights and notes, "carry on where you stopped". Page thumbnails load lazily.
- **Phones:** tap toggles the controls, and the bottom bar respects the safe area. A landscape slide on an upright phone uses only about a third of the screen, so the Reader suggests turning the phone once (or follows the rotation).
- **Upload behind it.** If it fails, the person keeps reading and is told calmly once ("Saved on this device only — try again"). Large files (up to 50 MB) must not make a phone stall. Several files: the first one opens, and the others land on the shelf as covers that are already readable.

### 3 · Luna reads along: the lights come on
- A quiet strip in the Reader shows Luna's progress ("Reading · 12 / 82").
- As her work lands, the faces switch on **per page** (a face is real for every page Luna has finished): **Explain** → **Ask** → **Practise**, each with a soft ring the first time. Nothing jumps. The page the person is on stays put.
- **The first light must be seen.** Hidden controls must not hide the moment Learnstation becomes more than a PDF viewer. The first time a face lights up, the controls come back for a few seconds and Luna says it once ("Explain is ready for this page.").
- Luna's understanding of the material (slides / long document / paper / series, the real title) becomes **one line plus up to three quiet suggestions** in the strip, never a blocking question. For example: "A paper. *Explain it simply* · *Key points* · *Ask it things*". Tapping one switches the Reader to that face.
- Backend need (LS-039): progress and finished pages per run must reach the student, and pages should become available **before** the whole run ends. Today they only appear at the end, and the canvas answers 409 until then.

### 4 · Luna tidies up: ghost Spaces
- Luna works out, from the files alone (names, numbering, shared words, page shape, titles inside the PDF), which files belong together. This can run in the browser and needs no AI. The demo proved it on real lectures, for example "A series: 4 parts, in order".
- Each group appears at the top of the Library as a **ghost Space**: a dashed card "Cryptanalysis · 4 parts", with the covers inside in order.
- Opening it shows the course *as it would be*: the path in order, "Start with part 1", and progress placeholders. Then **Make it a Space**, or **Not now**, which dismisses it for that group.
- Over time a ghost can grow ("A 5th part? Add it to Cryptanalysis") when a new file matches a real Space.

### 5 · Spaces: your desk for one subject
- **Library = your shelf**, everything you brought in. **Space = your desk for one subject**, where those files become a path in order, with progress, review, "carry on here" and, later, people.
- **One file, two places:** a file stays in the Library *and* sits in a Space, by reference. Nothing is moved or copied, so nothing gets lost.
- You can also drop new files straight into a Space. They land in the Library too.
- Created private. Inside the Space, later: rename, reorder, a test date, invite people, open it up.

### 6 · First time = first drop
There is no separate tour. Someone new gets the empty Library (or Home's two doors: **Bring in a file** / **Try a page**), and the first drop *is* the onboarding.
- Luna guides it with one or two words at a time, using her existing reactions.
- The first time the lights come on, she gives each face one short tip.
- The first ghost Space she makes gets one sentence: "These belong together — this is what a Space is."
- "Nothing yet" opens the real example page (the landing's `LivePage`) and the open Spaces.

## Principles

- **Never wait.** Reading starts at zero seconds. AI is an upgrade, not a gate.
- **Suggest, don't ask.** Every Luna suggestion can be ignored at no cost.
- **Show, don't explain.** Spaces are taught by your own files in order.
- **Only show what we provide.** No promised feature that the next screen does not have.
- **Monochrome.** Only Luna carries colour. One fact once.

## What exists, what has to be built

The implementation plan is `docs/superpowers/plans/2026-10-26-instant-reader.md` (Reader phase first).


| Need | Exists | To build |
|---|---|---|
| Instant reader | the v4 reader (faces, #119, #125); `PdfPager`, `PdfScroll`, `PdfPage`; v4 signed PDF URLs | Open from the local file, then the signed URL; cinema (slides) vs scroll (documents); video-player controls; buffered timeline; find, notes, lazy thumbnails |
| Bring-in everywhere | v4 `BringIn` (multi-file, drop veil, `U`), `POST /api/v1/v4/uploads` | Folder input; one shared intake for Home + Library |
| Lights come on | parser emits per-slide events (`parse:{pdf_hash}`) | Student progress (LS-039); serve finished pages before the run ends; Reader faces enabling per page |
| Understanding the material | demo `tourLabAnalyse.ts` (shape, series, numbering, inner title, exams) | Move it into the real data layer with tests |
| Ghost Spaces | covers, "Group by Space" | Grouping → suggested Space; dismiss memory |
| Make it a Space | v4 has no Space creation (the hub hands off to the old `/professor/courses?new=1`) | v4 endpoint: create a private Space from Library items, in order, by reference |
| Upload limit | 5 uploads a month | Decision 2026-10-24: a whole series counts as one upload. Settle the rule in the backend |
| Ships at all | — | LS-037 (v4 build flags in prod), LS-032 (student uploads on in prod) |

## Out of scope for this version
- A separate tour, Crew ID card or shelf-title ending (tried 2026-10-24, rejected).
- Asking about exams or goals at the door.
- Sharing or inviting during creation.
- AI-written content for the "Nothing yet" path.

## Open questions
- **Non-PDF files** (PPTX, photos — One Library mentions both): convert on the device for instant reading, or read after upload?
- **Phones:** "drop" means "choose files". Is a folder pick possible on iOS? (Probably not, so: multi-select.)
- **Ghost Space names:** from shared file words (works today), or from the titles Luna reads (better, needs the parse)?

## Testing
- Unit: material shape, series detection, ordering, inner titles, grouping into ghost Spaces, the dismiss rule.
- Reader: opens from a local file at zero network; cinema frame never shows neighbours; controls hide/return; the first light brings the controls back; faces enable per page without moving the scroll position; documents use scroll mode.
- Browser: one file / a series / a mixed folder / nothing, on desktop and phone width, EN and DE, reduced motion; upload failure keeps reading.
