# Lesson Reader v2 — self-review

Task 7 of `READER-PROMPT.md`. Branch `claude/optimistic-snyder-1142b3`, base `473fbb0`.

Findings first, then fixes, then the open questions I am handing on rather than
closing. Every §3 bullet and every §2.1 rejected idea is walked at the end with
the command, mutation or measurement that confirmed it — and where a constraint
is not exercised by anything on this branch, that is said instead of claimed.

Gates at `f4ebb72`: `tsc -p tsconfig.app.json` clean · **563 tests / 46 files** ·
vocabulary clean over 72 files. (Baseline was 555/46; +8 tests, no file added.)

---

## Findings

### 1 · D1 is a real race, and it is much worse than the ledger records

**Reproduced, traced, named, fixed.** Fix in `eca7f70`.

The ledger had this as "failed once in seven full-suite runs, no mechanism
found". It failed in **eight consecutive full-suite runs** on this machine —
`1, 3, 3, 3` failures in the first four and `4, 4, 2` of 21 in three isolated
runs of `selectionAsk.test.tsx`. It is not confined to `stays for a press inside
it`; five different tests in that file failed across the runs. Every failure has
the same shape: the popover is simply absent immediately after the selection.

I traced it with a temporary `selectionchange` listener registered before the
render, and the trace is what settles it:

```
--- banner after 11226ms, article=true
--- act begin
--- removeAllRanges done
sc rc=1 collapsed=false len=357 pop=false
--- addRange done
--- act end pop=false          ← failing run
--- act end pop=true           ← passing run, identical event sequence
```

The event fires correctly — one range, uncollapsed, 357 characters, common
ancestor inside the article — and the popover is not in the DOM when `act`
returns. A second probe measured `article.contains(range.commonAncestorContainer)`
as **`true` in the failing case**, and re-selecting the identical range after
`await act(async () => {})` produced the popover in **5 of 5** failures.

So the selection is not the missing half; the **listener** is. `SelectionAsk`
registers `selectionchange` in a passive effect, and `waitFor` in the shared
`renderReader` helper resolves on the DOM mutation of the commit that mounted
the reader, not on that commit's effects. In the window between them the screen
is fully rendered and nothing is listening — and because the selection never
changes again, no later event recovers it. Contention widens the window, which
is why it looked like a 1-in-7 and why it first appeared during a mutation run.

**Fix:** one line in `renderReader` — wait for the effects as well as the DOM.
**14 consecutive full-suite runs green** afterwards, against 8 failing runs
before it, same machine, same load. Not a product defect: in a browser the
passive flush follows paint by a frame and no selection gesture is that fast.

Two dead ends worth recording so nobody re-walks them:

- **The environment is happy-dom 20.10.6, not jsdom** (`vitest.config.ts`).
  jsdom queues `selectionchange` as a task, which would have explained
  everything; happy-dom dispatches it inline
  (`happy-dom/lib/selection/Selection.js`, `#associateRange`). Ten comments
  across six files in this namespace reasoned from jsdom, including the one on
  the very helper involved. All ten corrected in `987b00a`.
- **The stale-`articleRef` theory is disproved**, not merely unexplored: the
  containment check was measured as true at the moment of failure, and the
  recovery used the same article element and the same `Range` object.

### 2 · The rail is not a side panel below 640px, and everything it covers stayed reachable

**WCAG 2.2 SC 2.4.11 (AA) failure.** Fix in `44f6dbc`.

The ledger and the brief both describe this as "the pager and the article
tabbable behind a full-width companion" and treat it as Task 3's no-focus-trap
decision showing up somewhere awkward. Measured, it is not that. There are
**three** regimes, and only the third breaks:

| width | rail | article |
|---|---|---|
| ≥ 900 | 384px, docked | shifted aside, fully visible |
| 640–899 | 384px, overlay | partly covered, the measure still readable |
| **< 640** | **full width** (`w-full sm:w-96`) | entirely covered below the header |

At 375px, `elementFromPoint` at the visible centre of **both** `LessonPager`
cards returns a descendant of the rail, and both cards still take focus. The
practice CTA is focusable too. Nothing is `aria-hidden`, so a screen reader
browsing the document reads the whole covered article as though it were on
screen. SC 2.4.11 is precisely "a component that receives keyboard focus is not
entirely hidden due to author-created content".

Task 3's reason for not trapping focus is stated in `ReaderRail.tsx`: *the
article is still the thing being read.* At 640 and up that is true. Below 640
the premise is **false**, so this is a decision that had never been taken rather
than one being reversed.

**Fix:** `inert` on two nodes — the docked wrapper and the floating pager — and
only while the rail covers everything. Not a focus trap and not a dialog: the
rail is `top-14`, the header sits above it at `z-40`, is visible at 375px, and
carries the exit *and* both toggles — and re-pressing a toggle is one of the
rail's three documented close paths. A trap confined to the rail would strand
that path and take the way out away from a keyboard user, which is worse than
the bug. `ReaderRail.tsx` is untouched, so the rail still owns nothing, and the
focus-return contract is unchanged (verified at 375px: opener restored, inert
gone, pager focusable again). The 640–899 band is deliberately left alone.

Browser evidence, 375px, rail open:

| control | before | after |
|---|---|---|
| Leave the reader, Read, Source, Tutor, Notes | focusable, visible | focusable, visible |
| Practise what you just read | focusable, off-screen behind the sheet | **not focusable** |
| Previous Lesson card | focusable, obscured by rail | **not focusable** |
| Next Lesson card | focusable, obscured by rail | **not focusable** |

`inert=""` emitted, `element.inert === true`. At 760px and 1432px: `inert` count 0,
dock transform `matrix(1,0,0,1,-192,0)` unchanged, article class byte-identical.

### 3 · Twelve backticks on screen, in prose shipped one commit before this one

**A user-visible copy defect.** Fix in `1c23082`. Reported to me by the Task 6
review; confirmed in a browser before touching it.

`l-s-crypto-6`'s passages were written with Markdown code spans, and
`ReaderScreen` renders every paragraph as a plain text node — there is no
Markdown anywhere in the passage path. The Lesson rendered `` `var("x, y")` ``,
`` `x^2 - y` ``, `` `2^10` `` with the grave accents visible. It is the only
passage prose in the fixture set that reaches for them, which is why five
reviews and a states sweep walked past it: the prose guards measure length and
refuse filler and have no opinion about punctuation.

Fixed in the prose rather than in the renderer — giving passages code spans is a
change to the `Passage` type and to what the reader is allowed to interpret,
which is not a fixture's decision. The new guard sweeps **every** written Lesson
and every Material page, because the rule belongs to the renderer and the next
author will reach for the same convention.

### 4 · A confirmation destroyed by the panel that proves it worked

**Found by driving my own fix rather than by reading it.** Fix in `f4ebb72`.

Inert content is not selectable. So below `sm`, opening the rail on the "Save as
note" path collapsed the very selection the note was made from —
`selectionchange` fired, the popover unmounted, and the live region announcing
"Saved to your notes." went with it. Measured at 375px before the guard: popover
absent, selection zero characters. That matters most exactly where it happened:
at 375 the note list is behind a full-screen sheet rather than beside the text,
and the list is not a live region, so a screen-reader user got **no announcement
of the save at all**.

The rule is written as what it is rather than as a special case: a confirmation
is a beat about something that has already happened, and losing the selection
does not un-happen it. The same thing occurs if the reader clicks elsewhere
during the 2.2 seconds, and the test drives it that way.

### 5 · Three guards that read stronger than they check

Fixed in `987b00a`. None changes what the reader does.

- **"Every branch offers a way out" counted links.** Three of its five tests
  asserted only that *some* `<a>` on the branch did not point at `/read`. On the
  branch that is reading, the practice CTA satisfies that alone — so deleting
  the header's exit outright left the test green, which is the exact regression
  the describe is named after. Now found by accessible name with its `href`
  pinned. **Mutation-verified**: removing `<ExitLink>` from `ReaderHeader`
  reddens two tests that were both green before.
- **The focus-ring sweep claimed a directory it does not have.** Its comment
  said every reader file is in the list "by directory". Two of the three entries
  are hand-named files, and `LessonPager.tsx` is the counterexample — a reader
  control outside `components/reader/` that is in the list because somebody
  noticed. List unchanged; the comment now says what it covers.
- **Ten "jsdom" comments in a happy-dom suite** — see finding 1.

### 6 · The vocabulary gate does not check three of the words §3 bans

**Recorded, not fixed** — it is a gate outside this slice.

`scripts/check-vocabulary.mjs` implements Doc 1 rule 6 and bans ten words.
§3 adds three more: *slide*, *deck*, *document* ("Never … in copy"). The checker
has never known about them, so a third of that bullet has been unenforced on
every file this branch added.

I confirmed the reader is clean anyway by widening the checker's `BANNED` list
to thirteen words and re-running: `✓ vocabulary clean — 72 file(s) checked`. So
this is a gap in the gate, not a violation in the code — but it is a gap that
would not have been noticed by anything except this experiment. Widening the
shared script is a change to a namespace-wide gate on the last slice of a
reader branch, which is why it is written down rather than done.

### 7 · Rule 1's blocking half is exercised; the pager's is not, in a browser

Stated plainly rather than claimed.

- **The Member half is real and I drove it.** `l-s-crypto-12` is
  `needs-review` in `s-crypto`, where the viewer is a `member`.
  `/v4/space/s-crypto/lesson/l-s-crypto-12/read` renders *"That Lesson isn't
  here"* with a way back — not the Lesson. That is `visibleLesson` refusing an
  id, end to end.
- **The Owner half too.** `l-s-linalg-4` is a `draft` in a Space the viewer
  owns, and it renders. Its control set is `Leave the reader · Tutor · Notes ·
  Back to the Lesson` — byte-for-byte the set a Member gets on the equivalent
  unwritten Lesson `l-s-dbs-3`. That is the "role never changes the reader"
  bullet confirmed by comparison rather than by grep.
- **The pager's Rule 1 skip cannot be seen in a browser on any fixture.** Only
  two Lessons in the whole fixture set have passages, and the pager only mounts
  on the branch that has them — and neither is adjacent to an unpublished
  Lesson. It is covered by `navigation.test.ts` over every Space, and that guard
  is real: pointing `adjacentLessons` at `lessonsForSpace` reddens it
  (`s-linalg` 2 → 3 `processing`). But the claim is "the guard holds", not "I
  watched it hold".

### 8 · Task 6's fixture moves what three screens draw

**Recorded, not a defect** — from the Task 6 review, kept here so nobody
screenshots `s-crypto` and wonders.

The ledger's hazard for G6 was about *Space-level counts*, and adding a shape to
an existing Lesson does leave those alone. But `l-s-crypto-6` gaining two
Concepts moves what three screens render: `LessonScreen` grows an "Ideas in this
Lesson" row reading 0/2, `SpaceMap`'s node for that Lesson goes 0/0 → 0/2, and
`SpaceBento`/search gain two searchable Concepts. The suite is green because
nothing pins those. "Adding a shape to an existing Lesson moves nothing but the
Lesson" is not quite true of what gets drawn.

### 9 · Smaller things, recorded

- **`?mock=empty` falls through to the normal render.** Pre-existing and
  correct: a Lesson's emptiness is a shape of the Lesson, not a load state.
- **`:focus-visible` cannot be verified in this harness** (Task 6's concern 1,
  re-confirmed). Scripted `.focus()` does not grant it. What is verified is that
  the rule exists and every reader control carries `console-focusable`, swept.
- **The preview console holds two stale `[vite] Failed to reload
  ReaderScreen.tsx` errors** from my own mutation cycle; the buffer is not
  cleared by a reload. After a reload the page renders and the only warnings are
  the two pre-existing React Router v7 future-flag ones. Reported rather than
  chased — C4's rule.
- **`preview_click` and same-tick reads lied repeatedly**, exactly as C4 says:
  nine synchronous `Next page` clicks advanced the pager by one (React batching,
  not a product bug — real clicks are separate tasks), and a citation jump read
  `scrollY: 0` until a screenshot forced frames, after which it completed to
  1455. No code was "fixed" for either.

---

## Fixes

| commit | what | proved by |
|---|---|---|
| `eca7f70` | D1 — wait for the commit's effects, not only its DOM | 14 full runs green vs 8 failing; trace above |
| `1c23082` | backticks out of `l-s-crypto-6`; markup guard over every passage and page | M3: restoring one backtick reddens the guard |
| `44f6dbc` | `inert` on what a full-screen rail covers, below `sm` only | M1, M2, M4, M5 below; browser at 375/760/1432 |
| `987b00a` | three guards and ten comments that overstated themselves | M6 below |
| `f4ebb72` | the save confirmation outlives its selection | M7 below |

### Mutations — made, run, restored. None survived.

| # | mutation | result | what it proves |
|---|---|---|---|
| M1 | drop `inert` from the floating pager only | 1 failed / 32 | the half-fix that leaves the two measured cards is caught |
| M2 | `inert` whenever the rail is open, at any width | 1 failed / 32 | the wide branch is driven, not just the free one |
| M3 | put one backtick back in `l-s-crypto-6` | 1 failed / 23 | the markup guard fires on the exact regression |
| M4 | move the query to `(min-width: 768px)` | 1 failed / 12 | the coupling to `ReaderRail`'s `sm:` is pinned |
| M5 | spell it `inert: true` | 3 failed / 32 | React 18 silently drops it; both the render tests and the source guard catch it |
| M6 | delete `<ExitLink>` from `ReaderHeader` | 2 failed / 18 | the tightened way-out guard; green before this change |
| M7 | remove the `confirming` guard | 1 failed / 22 | the confirmation dies with its selection without it |
| M8 | `adjacentLessons` walks `lessonsForSpace` | 1 failed / 4 | the pager's Rule 1 guard is non-vacuous |
| M9 | `grantXp` into `TutorPanel.tsx` | 1 failed / 23 | the progress sweep reaches every reader file |

`git status --porcelain` empty after each. The M4 guard failed on its **first**
run for the right reason and the wrong cause — its regex latched onto the dock's
`[@media(min-width:900px)]:` Tailwind class and reported 900 with every part of
the rule correct. Narrowed to a standalone quoted query.

---

## The three §8 questions, and the two Task 6 handed on

### §8 · What reading does to the map — still open, and it did not feel wrong

Building against it for a full slice, the refusal reads as correct rather than
as a gap. The dots in the header are the one place it could have leaked and they
are a readout of what the engine already cleared — `0 of 5 ideas cleared` before
and after reading the whole of `l-s-dbs-4` with the rail open and the document
scrolled to the bottom, measured. The one thing I would put to whoever decides
it: the reader now has *three* things that look like progress and are not — the
dots, the 2px scroll bar, and the Source view's `n / 12`. Each is individually
justified. Together they are most of the vocabulary a progress system would use,
already spent, on a surface that awards nothing. That is worth knowing before
something real is added to the same bar.

### §8 · Community in the reader — proposal, not built

Nothing was added, and the contributions stay on the Lesson overview. The place
it wants to be is specific enough to write down: the tutor's citation chips
already establish "this answer came from somewhere in this Lesson, and you can
press it". A *"3 members explained this idea"* chip on a passage would be the
same gesture pointing at people instead of at text, and it would sit naturally
beside the citation chips rather than needing new chrome. **Proposal:** if it is
built, build it as a fourth citation kind rather than as a section under the
passage — a section reintroduces the community column the reader was designed
without, and a chip does not. Not built, because §8 says not to.

### §8 · Tutor memory resets per Lesson — reads correctly, with one caveat

In use it is right: the empty state promises "anything in this Lesson", every
citation is scoped to this Lesson, and a thread that survived would make both
quietly untrue. The caveat is that **the reset is currently unreachable in the
assembled app** — the pager navigates to a different route, so the screen
unmounts and everything resets by itself. The reset block exists for a
navigation nothing produces. That is fine as defensive code and it is honestly
commented as such, but it means "v1 resets per Lesson" is not a behaviour anyone
has observed; it is a behaviour the router makes unavoidable. If the pager's
destination changes (below), the reset becomes reachable for the first time and
should be watched rather than assumed.

### Task 6 (a) · The pager's destination — surfaced, not decided

From the reader, "next Lesson" lands on the Lesson **overview**, so continuing
to read costs a second click. `LessonPager` is shared with `LessonScreen`, where
the overview is obviously right.

I did not change it, and I want to be clear about why rather than deferring by
default. Task 6 argued weakly for changing it; the Task 4 review said it "should
be decided rather than absorbed". Both are right that it is a decision. What
tips it for me is the second-order effect neither of them could weigh: changing
the destination makes the lesson-change reset block reachable for the first
time, and that block resets **six** pieces of state including the tutor thread.
It has never executed in a browser. Changing a shared component's destination
and simultaneously turning on a code path that has only ever been exercised by a
`rerender` in a unit test is two changes, and the second one is invisible until
somebody pages between two Lessons with a conversation open. **Proposal:** if it
is taken, take it as its own slice with the reset as its subject, not as a prop
added to a pager.

### Task 6 (b) · The 375px overlay — decided, and fixed

See finding 2. It was an accessibility question, it is an SC 2.4.11 failure
rather than a cosmetic one, and it is closed.

### D2 · The popover does not follow the dock — measured, and deliberately left

Quantified at 1432px on the Save-as-note path, rail closed → open:

| | before | after |
|---|---|---|
| article left | 380 | 188 |
| first paragraph left | 404 | 212 |
| confirmation left | 551 | 599 |

So the column moves 192px left and the confirmation moves 48px *right* (it
re-centres on the stale anchor because the confirmation is narrower than the two
buttons). Net **240px** of separation for the 2.2s beat.

**Left, and I am the last slice, so here is the reasoning rather than a
deferral.** Every available fix costs more than the defect:

- *Dismiss on dock* removes the only aria-live announcement that the save
  succeeded — the note list is not a live region. That trades a cosmetic drift
  for finding 4, which I have just spent a commit fixing at the other width.
- *Follow the dock* requires re-deriving a rectangle from a `Range` the
  component deliberately does not keep (`Anchor` copies the numbers precisely
  because a live range is invalidated by the next re-render), and it would glue
  a message that names no location — "Saved to your notes." — to a sentence.
- The drift obscures nothing, breaks no state, and leaves nothing unreachable.

It is also now **narrower than the ledger records**: below 640 it does not
happen at all, because inert collapses the selection and the confirmation is
held by the guard in `f4ebb72` at coordinates that nothing has moved. The
pre-dock beat exists only at ≥900, where the shift is 192px of a ≥900px window.

---

## §3 GLOBAL CONSTRAINTS — every bullet, and how it was confirmed

### Focus surface

- `SURFACES.lessonReader` is `'focus'` — `components/Scene.tsx:46`, read.
  `ReaderScreen.tsx:277` passes it. **Guarded**: `reader.test.ts` "renders on the
  plain ground, not the console texture".
- **No `SpacesTopBar`** — `grep` finds no import in any reader file; browser at
  1432px returns `topBar: false`.
- **Summoned, never squatting** — measured in a browser at 1432, 1016 and 892,
  rail closed then open. `article.className` is byte-identical
  (`mx-auto max-w-2xl px-6 pb-32 pt-28`), paragraph width identical to the
  hundredth of a pixel (**555.0859375** in all six readings), article width 672
  in all six. Only `left` moves: 380 → 188 at 1432. The wrapper carries
  `matrix(1,0,0,1,-192,0)` at 1432 and 1016, clamped to `-134` at 892 — first
  character at `+4` and `0` respectively, `scrollWidth − clientWidth = 0`
  everywhere.
- **Rail state does not persist across Lessons** — driven: opened the rail on
  `l-s-dbs-4`, navigated to `l-s-crypto-6/read`, rail absent and both toggles
  `aria-pressed="false"`.

### Vocabulary law

`node scripts/check-vocabulary.mjs` → `✓ vocabulary clean — 72 file(s) checked`.
**But see finding 6**: the checker enforces ten of the thirteen words §3 lists.
I confirmed the missing three by widening `BANNED` to include *slide*, *deck*
and *document* and re-running — still clean over all 72 files. The Material is
called the Material and its unit is a page throughout: browser text on
`l-s-dbs-10` reads "Page 1", "1 / 6", "This page belongs to B-trees", and
`ReaderScreen.tsx:653` reads "The Material this Lesson was built from".

### Grounding is chrome, not prose

- **Marker only when `space.groundingEnabled`** — driven end-to-end both ways.
  `s-dbs` (on): rail contains "Grounded — answers draw on this Space's Lessons
  and name where they came from." `s-crypto` (off), on a Lesson **with prose**:
  `groundingMarker: false`. No greyed marker, no marker at all.
- **Tutor prose never claims groundedness** — all five reply bodies in
  `mocks/tutor.ts` extracted and matched against
  `/grounded|based on (your|this|the) (material|lesson|space)|according to|from
  your material|i (have )?(read|searched)/i`: **0 hits**.
- The marker copy exists in exactly one non-test file, `TutorPanel.tsx:190`.

### Reading changes no progress

- **Mutation M9**: `grantXp` added to `TutorPanel.tsx` → `reader.test.ts`
  "changes no progress, in any file the reader is made of" goes red. The sweep
  is the directory, so it covers files not yet written.
- **Driven**: read `l-s-dbs-4` with the rail open and the document scrolled to
  the bottom — dots read `0 of 5 ideas cleared` before and after.
- **No XP chrome** — `grep -inE "\bxp\b|streak|\blevel\b|badge|points|score"`
  over `components/reader/`, `ReaderScreen.tsx` and `mocks/tutor.ts` returns
  five hits, **all in comments explaining why it is absent**, none in code.

### Notes are Lesson-anchored and private, quote inside the body

Driven at 375px: selected 360 characters, pressed Save as note, and the note
appears at the top of the rail's list as `"A functional dependency is a
promise…"` — the quote, in quotation marks, as the whole body. `git diff` over
`mocks/` on this branch is 0 lines outside `lessons.ts` fixture data: no new
field, no new anchor type. `selectionAsk.test.tsx` pins the stored string
exactly (`toBe`, not `toContain`) and asserts `lessonId` and `spaceId`.

### Rule 1 — Members see only published content

Driven both ways in a browser; see finding 7. `visibleLesson`
(`mocks/lessons.ts:808`) is the only path `ReaderScreen` uses to resolve a
Lesson (`:152`).

### The pager walks published Lessons only

`adjacentLessons` reads `publishedLessonsForSpace` (`mocks/lessons.ts:823`).
**Mutation M8** confirms the guard is non-vacuous. **Not observable in a
browser on any fixture** — finding 7 says why.

### Role never changes the reader

`grep -n "viewerRole|isOwner|canEdit"` over `components/reader/` and
`ReaderScreen.tsx`: **none**. Confirmed by comparison rather than by absence:
the reader on a draft in an Owner Space (`l-s-linalg-4`) offers exactly
`Leave the reader · Tutor · Notes · Back to the Lesson` — the same four
controls a Member gets on `l-s-dbs-3`.

### A11y

- **Keyboard-reachable with a visible ring** — every new control carries
  `console-focusable`, swept by `a11y.test.tsx` over `ReaderScreen.tsx`,
  `LessonPager.tsx` and all of `components/reader/`. The sweep's coverage claim
  is now honest (finding 5). `:focus-visible` itself is not verifiable in this
  harness — finding 9.
- **The rail is a named landmark** — `getByRole('complementary', { name:
  'Reader companions' })`, and the source guard that pairs with it is
  non-vacuous since Task 6.
- **Focus obscured by an overlay** — finding 2, fixed.
- **Reduced motion** — nothing new animates. The only two things I added are an
  HTML attribute and a media query. `jumpToPassage` states `behavior` explicitly
  against the app-wide `scroll-behavior: smooth` (`ReaderScreen.tsx:422`), and
  `a11y.test.tsx` still forbids `transition-transform` / `transition-opacity` /
  `hover:scale-` across the namespace.

### Do not touch

`git diff --name-only 3194c40..HEAD` — 22 files, **all** under
`src/features/spaces/`. No file under `features/courses/`, `features/student/`,
`features/assignments/` or `docs/design-v4/` is touched, and no reader file
imports from any of them (the only namespace mentions are in comments and
markdown explaining the separation). Mock data only: `useSpaces.ts` is the
single data seam and contains no API call, no Supabase and no backend import.

---

## §2.1 — the four rejected ideas, checked against the built screen

Source: the mock's own "Design notes" table in
`docs/design-v4/reader-mockup.html:377-387`.

| rejected | how I confirmed it is absent |
|---|---|
| **Model picker** | `grep -inE "gpt\|gemini\|llama\|mistral\|openai\|anthropic\|\bmodel\b\|vendor\|temperature\|regenerate\|thumbs\|rating"` over the three tutor-bearing files: three hits, all in comments ("wiring a model later", "the model asserting its own trustworthiness", "no failure to model"). No control, no vendor name, no rating, no regenerate. Browser: the tutor panel's controls are three quick prompts, an input and Send. |
| **Inline AI rewriting** | `grep -inE "rewrite\|rephrase\|improve this\|edit this\|suggest an edit\|replace text"` over the same files: **none**. The tutor writes into its own thread and nothing else; `TutorPanel` has no handler that touches passage text, and the only writes the reader makes are `addNote` / `updateNote` / `deleteNote` into the note store. |
| **Sibling-Lesson stepper in the header** | `grep "LessonPager\|prev\|next"` in `ReaderHeader.tsx`: **none**. Browser inventory of the bar at 1432px: exit · Read/Source segment · progress dots · Tutor · Notes. Prev/next stay at the end, in `LessonPager`, which is what the mock says was *kept*. |
| **Persistent XP/level HUD** | See "Reading changes no progress" — five comment hits, no code. The nearest thing in the bar is the Concept dot readout, which is `cleared`-vs-not and never a percentage, and the 2px scroll bar, which is `aria-hidden` and carries no label. |
| *(parked)* **Canvas / whiteboard** | `grep -inE "canvas\|whiteboard\|excalidraw"` over the reader: **none**. |

---

## Browser pass — Task 6's state list, re-run at `f4ebb72`

Dev server 5214, `preview_*` only. Widths are `document.documentElement.clientWidth`.

| state | route | what rendered |
|---|---|---|
| passages + Material with pages | `s-dbs / l-s-dbs-4` | Read/Source segment, 5 passages, practice CTA, pager both ways, `0 of 5 ideas cleared` |
| passages, `material: null` | `s-crypto / l-s-crypto-6` | h1 + 2 passages, **no** segment, `0 of 2 ideas cleared`, measure 555.0859375, **0 backticks on screen** |
| Material with pages, no passages | `s-dbs / l-s-dbs-10` | page card, `1 / 6`, sync line as **text** not a button, "Back to the Lesson", no `LessonPager` (F6), overflow 0 |
| neither | `s-dbs / l-s-dbs-3` | "Not written yet" + "Back to the Lesson", header present, no segment |
| `groundingEnabled: false` | `s-crypto / l-s-crypto-6` | tutor opens with **no** marker; `s-dbs` shows it |
| `?mock=loading` | `l-s-dbs-4?mock=loading` | `aria-busy`, no `<header>`, exit at `[16, 10]` 36px → `/v4/space/s-dbs/lesson/l-s-dbs-4` |
| `?mock=error` | `l-s-dbs-4?mock=error` | "Couldn't load this Lesson" + "Try again" + the same exit at `[16, 10]` |
| Rule 1 refusal | `s-crypto / l-s-crypto-12` | "That Lesson isn't here" + "Back to Advanced Topics in Cryptography" |
| Owner reading a draft | `s-linalg / l-s-linalg-4` | renders; identical control set to a Member's unwritten Lesson |

### §9's end-to-end path

Select 90 characters in a passage → popover with "Ask the tutor" / "Save as note"
→ Ask → rail opens on **Tutor**, quote chip carries the sentence, grounding
marker present → send "Give me a concrete example" → reply arrives with chips
**"Functional dependency"** and **"Material · page 2"** → press the page chip →
segment flips to **Source**, readout `2 / 12`, card titled "Functional
dependency", sync line naming it → press the Concept chip **from the Material**
→ segment flips back to **Read**, `passage-c-l-s-dbs-4-1` on screen. Paged to
`11 / 12` ("This page belongs to BCNF"), pressed the sync line → Read view,
smooth scroll to `passage-c-l-s-dbs-4-5` ("Boyce-Codd normal form"), settling at
`scrollY 1455` of a 1455 maximum. Closed the rail → article class and paragraph
width byte-identical to the calm reader.

### Widths

1432, 1016, 892, 760, 375 — the five the hazard list names. `scrollWidth −
clientWidth = 0` at every width, in both views, rail open and closed. The Source
card's `text-[clamp(19px,2.4vw,26px)]` walks 26 → 19 and the card tracks its
column. Console across the pass: the two pre-existing React Router v7
future-flag warnings, plus the two stale HMR errors described in finding 9.

---

## What is left open

1. **The vocabulary gate is missing three words** (finding 6). One line in a
   shared script, and the reader is already clean under it.
2. **The pager's destination** (Task 6 (a)) — a slice of its own, with the
   lesson-change reset as its subject.
3. **A community affordance on a passage** — proposed above as a fourth citation
   kind, not built.
4. **`ReaderScreen.tsx` is 852 lines** (`wc -l`, not an estimate). Task 6 flagged the trend and declined to
   split under a sweep; I have added a hook and a derived value and declined for
   the same reason on the last slice before the final gate. It is the first thing
   a successor should propose, and the natural seam is the four Lesson-shape
   branches, not the composition helper.
5. **D2** — measured at 240px, deliberately left, reasoning above.
