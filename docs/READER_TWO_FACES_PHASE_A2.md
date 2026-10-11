# Lesson Reader · Two Faces — Phase A, second pass (design, no code)

*2026-09-18. Starts over from the three references after the first prototype. Supersedes `READER_TWO_FACES_PHASE_A.md`. Nothing here is built.*

## 0 · What the first pass taught

The Focal Plane concept lived on one mechanism, depth of field, and the mechanism died in the browser in four steps: the plain-black focus surface read as a void, the blur made the other face a smear, the step-back went with it, and the other face's chrome showing through had to be hidden. What survived is worth keeping: the shared spine (one anchor, both faces positioned before either is shown), the marks in the text, the companion card, the practice plane, the spine at the edge. What has to be redesigned is the thing the brief cares about most: **how the two faces relate and how the object turns.**

Two rules are added to the brief from that experience:

- **Nothing live is blurred or scaled.** The only blur is the one the product already has — a still image of the page, blurred once, as the room (Learnstation view 2).
- **The way to turn must be visible.** Pressing empty dark was the design being quiet about the one thing it could not afford to be quiet about.

Read from the references literally this time: the room is view 2's blurred page. The source face is Moonlight's page with a card on it. The reading face is Redacto's column with a verb on selection. The question is only what sits between them.

## 1 · The constant room

Before the concepts, the one thing all three share. **The room is the current page**: a still of it, blurred and dimmed once, behind both faces — exactly view 2, made continuous. It does not change when the face changes; it changes when *the page* changes, dissolving to the next page's still over 1.1 s (the `LectureBackdrop` cross-fade the product already has). So turning the Lesson over happens inside a room that stays put, which is most of what "the same object" means to the eye; and reading past a page boundary quietly turns the wallpaper with you.

The still comes from the rendered page canvas (`PdfPage` already reports it) until the backend has per-page posters; today `poster_url` exists for page 1 only.

## 2 · Three concepts

They differ in **what the second face is while you are not reading it**: the back of the card (A), a small copy always in view (B), or nothing at all (C).

---

### A · The card has a back

**Core idea.** The white page is a physical card. Its text is written on the back. Turning the Lesson over is turning the card.

**Transition.** A rotation about the card's vertical axis, 3D, 640 ms on the house ease: the face rotates away to 90°, the back rotates in from −90°, the card's silhouette never leaves the centre. What stays fixed: the room, the spine, the card's position and width. The eye follows the card's edge. Reduced motion: an opacity crossfade of the two sides in place, 200 ms. Land-at-section-3 is automatic because the back of page N *is* the text of page N.

**Layers and marks.** Surface: the card and the room. Margin: the card's own caption line under it names its Concept and page (a press on the Concept name turns the card). Companion: the tutor and notes open as a card *on* the page — Moonlight — beside the selected words. Workbench: practice as a second card that comes forward while this one sits behind it, dimmed.

**Tutor.** Appears on the page where you selected, titled with the selection. Leaves on Escape or by pressing the page.

**Survives:** `PdfPage`, `SourceView`'s pager and caption, `TutorPanel`, `SelectionAsk`, `Companion`, `PracticePlane`, `Spine`, `anchors.ts`, `LectureBackdrop`. Dies: `ReadingFace` as a column — reading becomes per page.

**Why it dies.** Reading becomes paginated: one page's text at a time, at the size of a 16:9 card, with a pager. That is the old product's viewer with better manners, and it gives up Redacto's one thing — a column you can sit inside for an hour. And a 3D flip is a spectacle: the first pass showed that any motion big enough to notice is motion the fiftieth switch resents.

---

### B · Lantern and column

**Core idea.** Both faces are always on screen: one large at reading distance, the other small — the page as a lantern in the corner while you read, the column's current heading as a small card while you look at the page. Pressing the small one swaps their sizes.

**Transition.** A size-and-position exchange, transform only (`layoutId`), 480 ms: the small thing grows into the centre while the large thing shrinks into the corner, both along a straight path. What stays fixed: the room and the spine. The eye follows whichever is growing. Reduced motion: crossfade in place. Anchor: the small page always shows the current page; the small card always names the current Concept, so the swap lands where you are by construction.

**Layers and marks.** The small face *is* the mark that turns the object — visible, nameable, always there. Otherwise as A: caption line, selection verbs, companion on the page or beside the column, practice as a plane.

**Tutor.** Beside the large face, at the selection; titled with it.

**Survives:** everything from the first pass except `Planes`; `ReadingFace` and `SourceFace` become the two sizes of one pair.

**Why it dies.** It puts a second object on the screen permanently, and the brief's first sentence about the surface is "nothing else visible". A thumbnail in the corner is chrome, however honest — and on a phone it is chrome you cannot afford. It also answers the discoverability problem with a permanent fixture, when the cheaper answer (C) is a verb where the Learner already is.

---

### C · One slot, two faces

**Core idea.** There is one place at reading distance and one thing in it. Turning the Lesson over replaces the page with the column in that place, or the column with the page, with nothing moving: a cross-dissolve in the same room. The other face does not exist until it is asked for.

**Transition.** Opacity only, 320 ms on the house ease, both faces positioned at the anchor before the dissolve starts — the incoming face fades in already at section 3. Nothing translates, nothing scales, the room does not change (it changes with the page, not the face). Reduced motion: the same, at 200 ms. It is the quietest possible turn, and after the first pass that is the point.

**How you turn it.** Not by pressing the dark. Three marks, all drawn from what is already there:

1. **On selection.** Selecting words on either face shows three verbs, not two: **Ask · Keep · Read this** on the page, **Ask · Keep · Show page** in the text. The third verb turns the object *to the same words*.
2. **The caption under the page** — "Page 6 · Functional dependency" — the Concept name is the press that opens the text at that passage (the sync line the first pass kept).
3. **The small white page beside each block** in the text opens the Material at that page (the chip the first pass built).

Plus `\` on the keyboard and the sr-only button for anyone who does not see marks. Nothing lives in the chrome.

**Layers.** Surface: the face, the room, the exit, the spine. Margin: the caption's Concept becomes a press, the chips appear, headings gain their hairline, formulas their underline — earned on first selection, as before. Companion: a card at the selection (on the page, beside the column). Workbench: practice as a plane; the face dims to make room and comes back when the plane is pressed away.

**Tutor.** Moonlight's: a card on the page or beside the passage, titled with the selection, gone on Escape or a press outside it, with a dot left at the sentence to reopen the thread.

**Survives:** all of the first pass except `Planes`' recede; `Plane` becomes a plain opacity switch. `LectureBackdrop` gains its real job.

---

## 3 · The survivor: C

C wins because it is the concept the first pass was walking toward with every one of Abi's cuts. Each removal — the blur, the step-back, the chrome showing through — took away something that made the other face *present* while it was not being read, and what was left each time was better. C finishes the thought: the other face is not present, and the room, which is the same page either way, carries the continuity instead. It keeps the source more central than Moonlight (when the page is showing there is nothing else on screen at all), and it is quieter than Redacto (a column, a room, a hairline). It fixes the first pass's real failure, discoverability, without adding a fixture: the turn is a *verb on the words* — select a sentence on the page and "Read this" lands you on that sentence in the text. That is also where the delight now lives (§4.4). Its cost is honesty about how plain it is: a cross-dissolve is not a spectacle, and this design no longer wants one.

## 4 · Craft spec for C

### 4.1 The room and the page

- Room: `LectureBackdrop` with the current page's still, blurred 40 px, brightness 0.45, saturate 0.9, over the console wash and particles (browse surface). Dissolves to the next page over 1.1 s, drifts 2 % over 12 s — both existing.
- Page: white, 16 px radius (view 2's card, not the 6 px of the first pass), `0 24px 60px rgba(0,0,0,.45)` shadow plus the soft light `0 32px 96px −32px rgba(255,255,255,.10)`; width `min(860px, 100% − 96px)`; top edge on the anchor line (38 %). Caption under it: Concept · page, 12.5 px, quiet.
- Nothing else on the source face at Surface: exit, spine, pager, caption, one hint line.

### 4.2 The column

Unchanged from the first pass, which measured it: Inter, body 18 / 1.7 at 52ch (≈66 chars), `h2` 22 / 1.25 for Concepts, `h3` 18 for page subtitles that add something, ink `rgba(232,236,243,.92)`. Rhythm on the 30.6 px line: paragraph 1 line, `h3` above 2, `h2` above 4. Column on the room directly — no card, no border. A page chip (12×9, white) in the gutter beside each block's first line.

### 4.3 One ease, one set of times

House curve `cubic-bezier(.2,0,0,1)` everywhere except the spring on press.

| Token | Value | For |
|---|---|---|
| `--t-press` | 120 ms | press feel |
| `--t-mark` | 180 ms | marks, verbs, spine names |
| `--t-card` | 280 ms | companion in/out |
| `--t-turn` | 320 ms | the cross-dissolve between faces |
| `--t-room` | 1100 ms | wallpaper dissolve to the next page (existing) |

No filter animates, no scale animates, no blur on anything live. Reduced motion: dissolves at 200 ms, room dissolve kept (opacity).

### 4.4 The moment of delight — the same sentence, found

Select a sentence on the page and press **Read this**: the object turns, and the column arrives with *that sentence* underlined by a hairline in the Lesson's accent that draws itself left to right over 480 ms and fades over the next second. The other way round, **Show page** turns to the page and the same words light on the PDF's text layer for a beat. Nothing about the layout moves; what moves is a line under the words you chose, on the face you did not choose them on. It proves the two faces are one object more directly than any transition could, and it is the reason to turn the Lesson over just to watch it find the sentence again. Implementation is honest: the text layer and the block share the page, so a substring search inside one block finds it.

### 4.5 Shared DNA

The light and the accent still come from the source (sampled from the first content page; a Lesson column at ingest later). The room is the same page under both faces. Each face carries the other's trace in the other's material: the page chip beside the text, the typeset caption under the page. Radii: 16 on the page, 12 on cards, 0 on the column.

### 4.6 Anti-pattern check

No header toggle (turning is a verb on the words, a caption, a chip). No pills (spine). No slide transitions (nothing translates). No permanent sidebar or Ask bar. No "AI" or sparkle. No progress bar as navigation. No summary beside the page. And, from this pass: no blur or scale on live content, and nothing to find by pressing the dark.

## 5 · Decide before Phase B

1. **"Read this" needs the page's text layer.** Where the PDF has no text layer (scanned pages), the verb is absent and the caption is the only bridge. Acceptable?
2. **Per-page stills for the room**: client snapshot of the rendered canvas now; a `poster_url` per page at ingest later. Confirm the client route for the prototype.
3. **The page's own chrome at Surface**: pager under the page, or only the caption with ← → on the keyboard? I would keep the pager; it is the Material's own grammar.
4. **Companion on the page** (Moonlight, over the PDF) vs beside it. I propose on the page for the source face, beside the column for the text.
