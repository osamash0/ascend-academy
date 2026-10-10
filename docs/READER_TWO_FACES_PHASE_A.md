# Lesson Reader · Two Faces — Phase A (design, no code)

*2026-09-17. Follows `docs/VIEWER_IMPLEMENTATION_AUDIT.md`. References read: Learnstation view 1 + 2, Moonlight, Redacto.*

## 0 · What the references say, and what we take

| | What it does well | What we take | What we leave |
|---|---|---|---|
| **Learnstation today** | The room is dark and the slide is the only light. View 2's blurred slide *as the room* is the one motif that already feels like ours. | The lit sheet in a dark room; the slide-as-wallpaper. The Excalidraw canvas exists and gets a home. | Step pills (8 max), XP header, Continue/Previous, course-progress bar, "Ask AI" bar, three-tab panel, a summary that paraphrases the slide beside it. |
| **Moonlight** | The PDF is never displaced. The chat is a card *on the page*, titled after the topic. | Chat as an anchored, titled card; tools appear where you are. | The floating tool pill (permanent), the right rail, the model picker, the blue. |
| **Redacto** | One column. The only AI action is a verb, on selection. | The column, the verb, the silence. | Light palette; the left nav; the formatting toolbar. |

Our source is the light. Everything else is the room.

## 1 · The shared spine (what makes "land at section 3" possible)

Both faces are built on the same skeleton, and the skeleton comes straight from what the backend has today:

- **Page** — the atomic unit of the source. One PDF page = one `slides` row (`content_text`, `summary`).
- **Concept** — a group of pages, via `concept_lectures.slide_indices`. The reading face's `h2`s.
- **Anchor** — `{conceptId, page}`. Every block in the reading face carries the page it was set from; every page in the source carries its Concept.

The reader holds exactly one anchor at a time. Switching faces never changes it. That is the whole trick: the other face is always positioned at the anchor before it is ever shown, so there is nothing to "find" on arrival. Scroll offset is stored as *anchor + fraction within the anchor*, not as pixels, so a 16:9 page and a 52ch column agree about where you are.

This is also where the mock's `Passage[]` becomes real: a passage is the concatenated `content_text` of a Concept's pages, each block tagged with its page. No new content type is invented.

## 2 · Three concepts

The brief bans three flips. These differ in *where the second face lives while you are not looking at it*: inside the sheet (Lantern), behind you in the room (Focal Plane), beside you on a hinge (Seam).

---

### Concept A · Lantern

**Core idea:** the white page is a lit sheet; the reading face is the same sheet unfolded. The card's own edges grow into the column and the typeset text rises out of the raster.

**Transition.** Shared-element morph of the page card (the `layoutId` is the card). The card's rect tweens from the 16:9 page (~860×484) to the column's rect (555px wide, tall). The PDF raster cross-fades out at the exact position where the Markdown of the same page fades in; the white ground fades to the room's dark at the same time, so the "sheet" goes from lit-white to lit-text. The room (blurred wallpaper) is fixed; the spine is fixed. The eye follows the card's expanding edge. 420 ms, one curve (`cubic-bezier(.2,0,0,1)`), text fade lagging the edge by 80 ms. Reverse is the exact inverse; the column folds back into the page you are on.

**Layers and marks.** Everything lives *in the margin of the sheet*: a heading, hovered, draws a hairline into the left margin and that hairline is the note anchor; a formula's underline opens the canvas beside the sheet with the formula placed; a figure's corner tick opens "Related" under it. The margin is part of the card, so layers travel with the sheet when it folds.

**Tutor.** A margin card clipped to the sheet, anchored at the selected line, titled with the selection. It folds with the sheet on face switch and unfolds on the other face at the same anchor. Leaves on Escape or when the anchor scrolls a screen away, collapsing to a dot at the line.

**Survives:** `SelectionAsk`, `TutorPanel`, `NoteEditor`, `resolvePdfUrl`, the react-pdf block, `Scene`/`MotionRoot`, `LessonPager`. `SourceView`'s pager. Dies: `ReaderHeader`'s tablist and rail toggles, `ReaderRail`.

**Why it dies.** The morph promises that the Markdown is *inside* the PDF, which is false and reads as false the moment a page's text is re-flowed across two sections. Geometrically, the target rect at "section 3" is a paragraph somewhere mid-column, so the unfold either starts from a card you cannot see or lands on text you were not reading. And a 420 ms shape-morph is a spectacle the first five times and a tax the fiftieth: people switch faces dozens of times an hour, and the motion must get out of the way, not perform. Keep from it: **the sheet is lit, and the light is the same on both faces.**

---

### Concept B · Focal Plane

**Core idea:** both faces are always in the room. One is at reading distance, sharp; the other is the room itself — enlarged, blurred, behind. Switching is refocusing. Nothing arrives, nothing leaves. *This is View 2's motif, made load-bearing.*

**Transition.** Two planes swap roles. The outgoing face recedes: `scale 1 → 1.14`, `blur 0 → 28px`, `brightness 1 → .55`, `saturate 1 → .8`. The incoming face, already positioned at the anchor, comes forward with the inverse, lagging 80 ms so the eye lets go before it grabs. 560 ms total, one curve (`.2,0,0,1`). Focus crosses at ~40 %. What stays fixed: the room bounds, the spine at the right edge, the anchor's y (the **focal line**, 38 % from the top — headings on the reading face and page tops on the source both sit on it). What the eye follows: *sharpness*. It is the pull of a lens, and the body already knows what that means. Reduced motion: no scale, no blur animation — a 200 ms opacity crossfade between two static states, the wallpaper pre-blurred. Peek: pointer resting on the room for 500 ms sharpens it to 35 % and pulls it 4 % forward, then lets it go if you leave — you can *check* the other face without committing.

**Layers.** Depth is literal: every layer is a focal plane, and anything blurred is one step up.

| Layer | Name | What is on screen | Mark that opens it (drawn from the text) | Way back up |
|---|---|---|---|---|
| L0 | **Surface** | The face in focus. The other face as room. The exit ✕. A hairline spine at the right edge. Nothing else. | — (this is where you start) | — |
| L1 | **Margin** | Marks appear *in* the text once you have engaged (first selection, or first refocus): headings gain a hairline anchor with a note dot; formulas gain a faint underline; figures a corner tick; the page ordinal appears as a tiny white page-chip beside each section. | Selecting **a word or sentence** → two verbs at the selection: **Ask** · **Keep**. Hovering **a heading** → its hairline. | Click into plain text; marks fade in 180 ms and stay until the Lesson closes (earned once). |
| L2 | **Companion** | A card at the focal plane, anchored to the mark, in the gutter beside the passage (right of the column; beside the page on the source face). The face steps back a half-step (`scale .985`, `brightness .85`, *no blur* — still legible). Tutor thread, notes for this Concept, worksheet for this Concept, related Lessons: same card, content chosen by the mark. | **Ask** → tutor titled with your selection. **Keep** → note prefilled with the quote. **Heading hairline** → this Concept's notes + related. **Figure tick** → "Explain this figure" (a tutor turn with the figure as quote). | Escape · click into the face · scroll the anchor a screen away → the card folds to a dot at the anchor (thread kept). |
| L3 | **Workbench** | A full plane: the canvas (Excalidraw) or a worksheet. The face recedes to the room exactly as the other face does — you can see, blurred, where you came from. | **Formula underline** → canvas with the formula placed at the centre. **Worksheet** → from the Concept's Companion card ("Practise this idea"). | Click the room, or Escape → refocus back to the face, same 560 ms. Same gesture as switching faces. |

One rule holds the model together: **whatever is blurred is where you came from, and touching it takes you back.** Face switch, closing the canvas, leaving a worksheet — one gesture, one motion. Complexity is earned (L1 appears only after the first engagement) and it is un-earned the same way, by touching the room.

The spine replaces the pills: a vertical hairline at the right edge, one tick per Concept (on the source face, ticks per page grouped by Concept), the current one lit in the Lesson's accent. It scales to forty. Pointer near it fans out the Concept names as a quiet column; click jumps the anchor. It is an index, not a progress bar, and never the primary way to move — scrolling and ⌘↓/⌘↑ are.

**Tutor.** Appears as the L2 card, anchored to the mark, titled after what you selected — Moonlight's one great idea. The card is where you are looking, never where the chrome is. Leaves to a dot; reopens from the dot; resets when the Lesson changes. No sparkle, no "AI", no model. The grounded marker is one quiet line at the card's top and only when the Space's grounding is on (existing rule).

**Survives:** `Scene`, `MotionRoot`, `Pressable` (the motion contract). `TutorPanel` (all props; gains a `title`). `SelectionAsk` (extended to the PDF text layer — `SlideViewer` already has this popover over the page; merge them). `NoteEditor`. `SourceView`'s pager and sync line, with the text card replaced by react-pdf `<Page>` lifted from `SlideViewer`. `LessonPager` at the end of the Lesson only. `LectureBackdrop` (it *is* the room; it already does the 12 s slow drift). `resolvePdfUrl`, `fetchLocalizedLectureBundle`. The Excalidraw embed, `WorksheetsPanel`, `RelatedAcrossCoursesPanel` as L3/L2 content. **Dies:** `ReaderHeader`'s tablist, dots and rail toggles (the exit survives, alone); `ReaderRail` as a permanent home (its focus-return and Escape logic move into the Companion card); step pills; XP header; Continue/Previous; course progress; the Ask bar; the three-tab panel; the summary panel.

---

### Concept C · Seam

**Core idea:** the two faces share one scroll on one spine, and a vertical seam between them is the control. Drag the seam left: the source uncovers the reading face; drag it right: the reverse. Park it anywhere. Switching is a scrub, not a toggle.

**Transition.** The seam follows the pointer at 1:1; both faces are fully laid out underneath, clipped by the seam, and because they share the spine the same anchor is on both sides of the line at the same y. Release snaps to the nearer edge in 240 ms on the house curve. A keyboard scrub (hold `\`) sweeps the seam across in 400 ms. The eye follows the seam. Nothing scales or blurs; the room stays the current blurred wallpaper.

**Layers and marks.** Layers open *behind the seam*: Ask opens the tutor in the uncovered half, so the answer sits literally beside the source it answers. Notes, worksheets, canvas likewise take the other half. Way back: drag the seam over them.

**Tutor.** Fills the uncovered half at the anchor's height, titled with the selection. Leaves when the seam covers it.

**Survives:** `SelectionAsk`, `TutorPanel`, `NoteEditor`, react-pdf block, `resolvePdfUrl`, `Scene`/`MotionRoot`. Dies: `SourceView`'s pager (the source becomes one continuous scroll), `ReaderHeader`, `ReaderRail`, `LessonPager` (the spine is the pager).

**Why it dies.** Its resting states are its worst states: a half-uncovered screen is the noisiest thing this brief could produce, and the seam itself is a permanent affordance drawn across the source — exactly the chrome we are trying to remove. Worse, the drag competes with text selection, and selection is the door to every layer; on touch a horizontal drag is the browser's back gesture. It fails "beat Redacto on quiet" and "beat Moonlight on keeping the source central" at once. Keep from it: **the shared spine.** Section 1 is Seam's one true idea, and Focal Plane needs it.

---

## 3 · The survivor: Focal Plane

Focal Plane wins because it answers the brief's two hard sentences with one mechanism. "The same object turning" — nothing enters or leaves; the object you were reading is still there, behind you, at the same anchor, and refocusing is a motion the eye already knows the meaning of. "Progressive depth" — depth stops being a metaphor: every layer is a plane, the one you came from is visibly one step back, and the way up is always the same gesture, so the model teaches itself the first time you use it. It keeps the source central more literally than Moonlight does (the source is either the page you are reading or the room you are reading in — it is never off-screen) and it is quieter than Redacto at L0 (a sheet, a room, an exit, a hairline). It is the only concept that makes View 2's motif — the thing we already like about our own product — do structural work instead of decorating. Its costs are honest and engineering-shaped rather than design-shaped: animating blur on a live column needs care (rasterize the receding face for the 560 ms, or use the poster for the source room), and two laid-out faces cost memory. Neither changes what the Learner sees.

## 4 · Craft spec for Focal Plane

### 4.1 Type and measure (people read here for an hour)

Inter throughout (already loaded). Dark ground, so ink is never pure white and body weight stays at 400 with slightly more size than a light-ground page would need.

| Role | Size / line | Weight · tracking | Notes |
|---|---|---|---|
| Lesson title `h1` | 34 / 1.15 | 700 · −0.02em | Existing. |
| Concept `h2` | 22 / 1.25 | 600 · −0.01em | Sits on the focal line when it is the anchor. |
| `h3` | 18 / 1.4 | 600 | |
| **Body** | **18 / 1.7 (30.6px)** | 400 · 0 | Up from today's 17/1.75. Measure **52ch ≈ 66 characters**, measured, unchanged. |
| Lists | body, hanging markers in the accent | | |
| Formula (display) | KaTeX at 1.05em, centred | | 2 lines of air above and below. |
| Code | 15.5 mono | | |
| Marks, captions, spine labels | 12.5 / 1.3 | 500 · +0.01em | `tabular-nums`. |

Ink: `--ink: rgba(232,236,243,.92)` · `--ink-quiet: .64` · `--ink-faint: .40`. Links and marks in the Lesson's **accent, sampled from the source** (see 4.4). Never a second accent.

Source face: the page renders at its native aspect, width clamped to `min(860px, 100% − 96px)`, its top edge on the focal line, white ground `#FFFFFF` with a 6px radius. The page is the only white on screen.

### 4.2 Spacing rhythm

Base 8. Vertical rhythm on the reading face is the body line (30.6px ≈ 1 line):

- paragraph gap 1 line · `h3` above 2 lines · `h2` above 4 lines, below 1 · display formula 2 lines each side · Lesson end → "Practise what you just read" 6 lines.
- Column gutter to the margin: 40px. Companion card: 384px wide (the rail's width, kept), 24px padding, 12px radius, hairline `rgba(255,255,255,.08)`, sits 24px right of the column; below 1280px it overlays the gutter side; below 900px it sits under the anchor block as a full-width sheet.
- Focal line: 38 % of viewport height. Spine: 24px from the right edge, ticks 12px apart, min 4px when compressed.
- Marks never add height. A hairline anchor lives in the margin; an underline lives inside the line box; a page-chip is 12×9px inset in the gutter.

### 4.3 One easing, one set of times

Extend `MotionRoot`'s contract rather than adding to it. One curve everywhere: **`cubic-bezier(.2, 0, 0, 1)`** (already `MOTION_EASE`). The single spring (`PRESS_SPRING`, 400/30) stays for press only.

| Token | Value | Used for |
|---|---|---|
| `--t-press` | 120 ms | hover/tap on Pressable (existing feel) |
| `--t-mark` | 180 ms | marks appearing, verbs at a selection, spine fan-out |
| `--t-card` | 280 ms | Companion card in/out, fold-to-dot |
| `--t-focus` | 560 ms | refocus between planes (faces, Workbench) |
| `--t-lag` | 80 ms | the incoming plane starts after the outgoing lets go |
| `--t-ripple` | 60 ms / 200 px | focus ripple stagger (4.5) |
| `--room-blur` | 28 px | the room |
| `--room-scale` | 1.14 | the room |
| `--room-dim` | brightness .55 · saturate .8 | the room |
| `--step-back` | scale .985 · brightness .85 | the face while a Companion is open |
| `--peek` | 35 % of the refocus, 500 ms hold | resting on the room |
| room drift | scale 1 → 1.02 over 12 s, ease-out | inherited from `LectureBackdrop` |

Reduced motion: every transform and blur token collapses to an opacity crossfade at 200 ms. Nothing else changes.

### 4.4 Shared visual DNA — why a white page and a dark column read as one object

1. **The light comes from the source.** The room's glow is the blurred source; the reading face is lit by it. Both faces cast the same soft light below them (`0 32px 96px −32px rgba(255,255,255,.10)`).
2. **The colour comes from the source.** The Lesson's accent is sampled from the page's dominant chroma at ingest (the blue of "Softwaretechnik") and stored on the Lesson. Headings' hairlines, marks, the lit spine tick, the verbs — all in that accent. Change the PDF, change the colour of the reading face.
3. **Each face carries a trace of the other, in the other's material.** The reading face shows a tiny white page-chip (12×9, the page in miniature) beside each section's first line; the source face shows a one-line typeset caption under the page — Concept name and page ordinal — in the reading face's type. Neither is a control at L0; both become marks at L1.
4. **The same spine, the same focal line.** Ticks in the same place, anchor at the same height, on both faces.
5. **The same silence.** No card borders on the faces, no shadow ramps, no shadcn rhythm. Radii: 6 on the page, 12 on the Companion, 0 on the column.

### 4.5 The moment of delight — the focus ripple

Not asked for: when the reading face comes forward, **the sentence you were looking at resolves first.** The anchor block (heading plus its first line) runs the incoming curve at 0.6× duration; every other block starts 60 ms later per 200px of distance from the focal line. Sharpness ripples outward from where your eyes already are, top and bottom, and the column is fully crisp at 560 ms. Going the other way, the page does the same: the region of the page the anchor came from clears first, the rest of the page a beat behind. It costs nothing to understand — it is what a lens does — and it tells the Learner *where they landed* before a single word is read. This is the motion someone switches faces to see again.

### 4.6 Anti-pattern check

Header toggle — none (the room is the switch; `\` or ⌘/ on the keyboard). Step pills — replaced by the spine. Slide transitions — none; nothing translates on a face switch. Permanent sidebar — none; the Companion is anchored, folds to a dot. Permanent Ask bar — none; two verbs on selection. "AI"/sparkle — none; the card is titled with your words. Duplicated nav — the exit is the only chrome button. Progress bar as navigation — the spine is an index and the reader changes no progress. Summary beside the slide — gone; the reading face *is* the text, at reading distance, one face away.

## 5 · What I need from you before Phase B

1. **The switch gesture.** Click the room (default) plus `\` on the keyboard. Touch: two-finger pinch-out to recede, pinch-in on the room to pull forward — or tap the room? Pick one for touch.
2. **Peek** (rest on the room for 500 ms to half-sharpen it): keep or cut? It is the one motion that fires without intent.
3. **Excalidraw as a Workbench plane** (full plane, face becomes the room) vs. inline under the formula. I have specified the plane.
4. **The accent sampled from the PDF** — at ingest (a colour column on the Lesson) or client-side from the poster? Design wants it stored.
5. **L1 earned once per Lesson or once per Learner?** Specified per Lesson; per Learner would mean a returning Learner never sees the bare L0 again.
6. **Practice at the end of the Lesson** stays as the only forward CTA; XP stays out of the reader entirely. Confirm.
