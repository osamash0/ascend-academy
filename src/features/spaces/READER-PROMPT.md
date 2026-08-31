# Build prompt · Lesson Reader v2 (Read · Source · Companions)

*A self-contained brief for extending the v4 Lesson Reader. Assumes no memory of previous
sessions. Written 2026-08-31 by the session that designed the reader vision mock.*

---

## 1 · What you are building, in one paragraph

The v4 reader today (`screens/ReaderScreen.tsx`) is a calm prose column — correct, and kept.
You are adding three things around it without breaking its calm: a **Source view** (the
original Material pages, page-synced to the passage being read — the layout the old product's
Library view got right), a **summonable right rail** with two panels (**Tutor** — grounded
chat; **Notes** — the existing private notes), and **selection-to-ask** (select text in a
passage → ask the tutor or save a note, with the selection carried as context). The vision
is drawn, interactive, at `docs/design-v4/reader-mockup.html` — open it in a browser first
and click everything. Where this prompt and that mock disagree with the design docs, the
docs win — say so rather than guessing.

**Mock data only. No API calls, no Supabase, no backend imports.** Work on your own branch
in your own worktree. Never commit to `main`.

## 2 · Read before writing code

1. `docs/design-v4/reader-mockup.html` — the vision, in a browser. Its collapsed
   "Design notes" section lists what was kept and rejected, with reasons. Rejected ideas
   stay rejected: no model picker, no inline AI rewriting, no sibling-Lesson stepper in
   the header, no persistent XP HUD, no canvas.
2. `docs/design-v4/01-foundations.md` (Locked v1.15) — source of truth.
3. `docs/design-v4/02-navigation.md` (Locked, may live on another worktree — search
   `find ~/Desktop/ascend-academy/.claude/worktrees -name "02-navigation.md"`). The reader
   is a **Learn** surface: calm, no dense controls, and an Owner sees exactly the reader a
   Member sees.
4. `src/features/spaces/screens/ReaderScreen.tsx` — what exists. Its three named decisions
   (passage-per-Concept, measured 52ch, reading changes no progress) all survive this build.
5. `src/features/spaces/BUILD-PROMPT.md` §self-review loop and
   `mocks/__tests__/fixtures.test.ts` — the working pattern and the test pattern to copy.

## 3 · The rules that bind this screen

- **Focus surface.** `Scene` with `SURFACES.lessonReader`; no top bar. The rail is
  *summoned, never squatting*: with the rail closed, the screen must render exactly the
  calm column that exists today. Rail state does not persist across Lessons.
- **Vocabulary law.** Banned words in UI copy: professor · student · teacher · instructor ·
  course · classroom · module · folder · lecture · LMS. The source view is the **Material**;
  its unit is a **page**. Do not say "slide" or "deck" in copy.
- **Grounding is chrome, not prose** (Doc 1, locked). The tutor panel carries one quiet
  grounded marker at its top when the Space's grounding is on; when grounding is off,
  render **no marker at all**. The tutor's message text never claims groundedness.
- **Reading changes no progress.** Nothing on this screen marks a Concept cleared, awards
  XP, or lights the map. No XP chrome anywhere in the reader.
- **Notes are Lesson-anchored and private** (Doc 1). Selection-to-note captures the
  selected text as a quote *inside the note body*, not as a new anchor type. Reuse
  `NoteEditor` and the `mocks/notes.ts` store; "Private to you, and gathered in your
  Library." is the established copy.
- **The pager walks published Lessons only** — `adjacentLessons` already enforces this.
- **Role never changes the reader.** No Owner-only controls here; editing lives in Studio.

## 4 · Components to build (all under `features/spaces/`)

| Piece | What it is |
|---|---|
| `components/reader/ReaderHeader.tsx` | Fixed slim bar: exit ✕, `Space · Lesson N`, centered Read/Source segment, Concept progress dots, two rail toggles. The segment renders only when the Lesson has both passages and a Material with pages. |
| `components/reader/SourceView.tsx` | Material pages, one at a time, with a pager (`n / total`) and a "belongs to {Concept}" sync line linking back to the passage. Mock pages are styled placeholders — see §5. |
| `components/reader/ReaderRail.tsx` | The docked panel: Tutor/Notes tabs, close. On <900px it overlays instead of docking. Owns open/tab state, controlled from the header and the selection popover. |
| `components/reader/TutorPanel.tsx` | Grounded marker (conditional), empty state, thread of quote-chip / user / tutor messages, citation chips that scroll to the cited passage (`§ heading`) or name a Material page, three quick prompts, composer. |
| `components/reader/SelectionAsk.tsx` | Popover on text selection inside the article: "Ask the tutor" / "Save as note". Position above the selection; dismiss on outside click, scroll, and Escape. Keyboard path too: the article is focusable content — do not make selection the *only* way to reach the tutor. |
| `mocks/tutor.ts` | The swap seam, same shape as `data/useSpaces.ts`: `askTutor(lessonId, question, quote?) → TutorReply` where `TutorReply = { text: string; citations: Array<{label: string; conceptId?: string; materialPage?: number}> }`. Canned, deterministic replies keyed by lesson — wiring later means replacing this module only. |

`ReaderScreen.tsx` composes these; the article column itself changes as little as possible.

## 5 · Mock data to add

- **Pages on Material**: extend the `Material` type (or a parallel `pages` fixture in
  `mocks/`) with `pageCount` and per-page placeholder content for the one Lesson that has
  passages. Every page maps to a `conceptId` — that mapping powers the sync line and the
  "Material · p. n" citations.
- **Tutor replies**: 3–4 canned exchanges for the fixture Lesson, at least one with a
  quote context and two citations (one Concept, one Material page).
- **States to cover, not just the happy path**: Lesson with passages + Material (full
  experience) · passages but Material deleted (`material: null` → no Source segment, and
  citations to pages render as plain text, not links) · Material but no passages (Source
  view is the default and Read is absent — this replaces today's "Not written yet" dead
  end when a Material exists) · neither (today's "Not written yet" stays) · grounding off
  (no marker) · `?mock=loading|error` (existing pattern).

## 6 · Slices, in order

1. **ReaderHeader + view toggle** — header replaces the current inline ✕ row; Read/Source
   segment switches views; dots reflect Concept progress. Calm column unchanged otherwise.
2. **SourceView** — pages, pager, sync line. States: material deleted, no passages.
3. **ReaderRail + NotesPanel** — rail chrome, Notes tab reusing `NoteEditor`/note store.
4. **TutorPanel** — thread, citations that navigate, quick prompts, composer, grounded
   marker logic, empty state.
5. **SelectionAsk** — popover, quote → tutor context chip, quote → note body.
6. **States & a11y sweep** — every state in §5; focus-visible everywhere; rail is a
   `complementary` landmark; popover has a keyboard path; reduced-motion respected.
7. **Self-review loop** — the BUILD-PROMPT §review pattern: walk every rule in §3 against
   the built screen and write the violations you find before fixing them.

Tests follow the existing patterns (`labels.test.tsx` bans the banned words — add the new
copy; `surfaces.test.tsx` — reader stays a focus surface with rail open; `reachable` /
`deadends` — Source↔Read links, citation navigation; fixture rule-guards for the
page↔concept mapping and tutor citations pointing at real Concepts).

## 7 · Do not decide these — surface them instead

- **What reading does to the map** is still open (Doc 1). The reader keeps changing no
  progress; if that feels wrong while building, report it, don't fix it.
- **Community in the reader**: contributions stay on the Lesson overview for now. If a
  citation-like "3 members explained this idea" affordance seems to belong on a passage,
  write it up as a proposal instead of building it.
- **Tutor memory across Lessons** (does the thread persist?) — v1: thread resets per
  Lesson. Flag if that reads badly in use.

## 8 · Verify before claiming done

`/v4/space/:spaceId/lesson/:lessonId/read` in the browser via the preview tools, every
state in §5, plus: select text → ask → citation chip → lands on the right passage; close
rail → screen is pixel-identical to the calm reader; `?mock=` variants. The gate that
lies: `tsc -p tsconfig.json` checks nothing — use `tsconfig.app.json`.
