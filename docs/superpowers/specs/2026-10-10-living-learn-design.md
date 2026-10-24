# Living Learn — design

**Date:** 2026-10-10 · **Branch:** `claude/studio-canvas-spec` · **Extends:** [Studio canvas design](2026-10-10-studio-canvas-design.md) (called "the Studio spec" below). Where this doc and the Studio spec disagree, this doc wins, and each such point is listed in §9.

## 1. The idea, in the user's words

> "the thing that is in the background gets filled based on what the user is doing in the AI session, and the base default is just summarizing in a very cool, smooth, eye-relaxing style … make it also smooth for the transition"

Today the Learn view is a near copy of the PDF text. After this change, Learn is a **living page**:

- **At the start** it is a calm summary of the Material: a few lines per page.
- **As you ask**, each answer grows into the page, right under the paragraph it is about, and stays there.
- **Source** still shows the real page, and every summary paragraph still flies home to the area it came from.

Decided with the user (2026-10-10, mockups in `.superpowers/brainstorm/`):

| Question | Decision |
|---|---|
| How does the page change when you ask? | **Grow in place.** The answer is woven under the paragraph it belongs to. The summary never rewrites itself. |
| How short is the starting summary? | **A few lines per page**: 2–4 sentences, key terms highlighted. |
| Which reading style? | **A · Quiet prose**: short calm paragraphs, key terms in warm light. |
| Growing animation | **As in the demo**: anchor glows, space opens, a thin teal line draws down, words settle from blurred to sharp. |
| Real AI now or mock first? | **Mock first.** Summary and answers are authored fixture data. Real AI plugs into the same seam later (Plan 2 and the pipeline spec). |

## 2. What Learn shows

1. **Summary paragraphs, one page at a time.** Each source page gets 2–4 sentences. The first paragraph of a page is its *gist* and is slightly brighter (`text-white` vs the body's `text-white/80`). The page divider stays as it is now.
2. **Key terms in warm light.** Terms are authored as `**term**` in the Markdown and render in a warm off-white (`#f3e7c9`, token `--studio-term`), weight 500, not bold. Light theme uses a dark amber (`#8a5a00`).
3. **Reading column** as now: 17px, line height 1.8, max ~64ch, black ground.
4. **Your handwriting is never summarised.** A `handwriting` source block (your own words on the page) stays verbatim as an extracted block, with its confidence underline, after the summary of its page.
5. **Your notes stay where you put them.** A `written` block keeps its place in the block order. When a default canvas is first converted to the summary, each note goes after the summary paragraph whose `source.blockIds` contains the source block the note used to follow.
6. **Nothing is lost.** The near-copy text lives on as the source text. Source view's diff reveal (Studio spec §4.2 rule 5) shows source blocks that no summary paragraph covers as "Not in your version", and **Add to your version** still includes one as a verbatim extracted block.

## 3. Linking back to the PDF

A summary paragraph condenses several source blocks of **one page**. It carries a normal `SourceRef` with all of their ids, so the rules that already exist apply unchanged:

- **Peek** outlines the union box of those blocks (`unionBox`), with the caption "Source · Normalization.pdf · page N".
- **Morph** flies the paragraph to that union box; going back lands on the paragraph.
- **Page-only geometry** (page 3 in the fixture): the paragraph has `blockIds: []`, Peek shows the whole page without an outline, and Morph flies to the page centre.
- **A summary paragraph never spans two pages.** If an idea runs across a page break, it is two paragraphs. This keeps Peek and Morph exact.

## 4. Asking: the page grows

### 4.1 The composer
- A quiet pill at the bottom centre (max 560px), in the reader's style: `rounded-full bg-white/[0.06]`, hairline border, white **Ask** button.
- The pager moves into the composer's right end as a compact `‹ 2 / 12 ›` group. Below 640px the pager is hidden; scroll moves between pages.
- Up to three **suggested questions** sit above the composer as small chips until you ask your first one.
- The hint line becomes: "Rest on a paragraph to see the source, press S, or ask below."
- **One question at a time.** While an answer is arriving, the input is disabled and the button reads "Answering…".

### 4.2 Where an answer lands
1. If text is selected, the anchor is the block holding the selection.
2. Otherwise the anchor is the block the answer's first citation points to (mock: the scripted answer names its `anchorId`).
3. If neither applies, the anchor is the block at the reading line (40% from the top).

The answer is inserted **directly after its anchor**, after any answers already attached to that anchor (oldest first).

### 4.3 The growing choreography (Motion only, no CSS keyframes)

| Step | What moves | Timing |
|---|---|---|
| 1 | The anchor paragraph glows: a soft teal wash (`rgba(159,211,199,.06)`, 8px spread) | fades in 300 ms, holds until step 5 |
| 2 | Space opens under the anchor: height `0 → auto` | 700 ms, `cubic-bezier(.2,.8,.2,1)` |
| 3 | A 2px teal rule draws down the answer's left edge (`scaleY 0 → 1`, origin top) and the "From your question" tag fades in | starts 150 ms into step 2, 900 ms |
| 4 | Words settle: each word goes from `opacity 0, blur(6px)` to `opacity 1, blur(0)` | 550 ms each, staggered 55 ms; after 40 words the rest settle sentence by sentence, so no answer takes longer than ~2.5 s |
| 5 | The glow fades out | 800 ms |

With real streaming (Plan 2), step 4 runs as tokens arrive instead of on a timer.

### 4.4 Keeping your place
- **Your view never moves on its own.** If the anchor is above the viewport, the growth is compensated so the text you are reading stays put. (Set `overflow-anchor: none` on the column and correct `scrollTop` by the height change, on the same frame.)
- **Answer lands off-screen** (below the viewport): a small chip appears above the composer, "Added below ↓". Clicking it scrolls to the answer. It disappears after 6 s or once the answer is on screen.
- **Answer lands on screen:** no scroll, no chip.

### 4.5 What an answer looks like
- The "From your question" tag (teal, 12px), then the question as one quiet line, then the answer in the reading style at 16px in full white.
- Citation chips (Studio spec §5.1) under the answer. A chip opens Peek on the cited block.
- A **Remove** button appears on hover and focus (a ≥24px target).

### 4.6 Answers stay
- An answer is saved into your version as a `generated` block the moment it finishes. There is **no Keep / Discard step** (this replaces Studio spec §5.1 rule 3).
- **Remove** collapses it (height to 0, 400 ms) and shows an "Answer removed · Undo" toast for 6 s.
- In the mock, answers live in the canvas state for the session. A reload restores the authored canvas. Persistence comes with the real backend (Plan 2).

### 4.7 Questions the mock cannot answer
The mock has a fixed set of scripted answers (§6.3). A question that matches none of them gets an honest inline line, never an invented answer: "In this preview I can answer a few questions about Normalization — try one of these:", followed by the suggested-question chips.

### 4.8 Answers in Source view and Morph
Answers have no place on the original page. In Morph they fade out on the spot (Studio spec §4.2 rule 4) and fade back in on return. Their citation chips still open Peek.

## 5. Reduced motion and accessibility
- **Reduced motion:** steps 1–5 collapse into one 150 ms fade of the whole answer. The glow, rule draw and word settle are skipped. Remove is a 150 ms fade.
- **Screen readers:** the answer region has `aria-live="polite"` and announces "Answer added under: {first words of the anchor}". Word-settle spans are not separate live updates: the finished text is announced once.
- **Keyboard:** the composer is reachable with `/`, which is ignored while typing or inside a dialog (the same guard as `S`). Enter sends. After an answer lands, focus stays in the composer. "Added below ↓" is a real button.
- Key-term colour meets 4.5:1 contrast on both grounds.

## 6. Data model

### 6.1 A new block origin: `summary`

```ts
export interface SummaryBlock {
  id: string;
  origin: 'summary';
  markdown: string;          // 2–4 sentences, key terms as **term**
  source: SourceRef;         // one page; blockIds = every source block it condenses ([] on page-only geometry)
  gist: boolean;             // first paragraph of its page
  edited: boolean;           // you changed the wording
}

export type CanvasBlock = ExtractedBlock | SummaryBlock | WrittenBlock | GeneratedBlock;
```

**The rule changes from "origin decides" to "having a `source` decides".** Peek, page markers, Morph flight, the "Edited by you" tag and the reading-line pick all key on `'source' in block`, which is true for `extracted` and `summary` blocks. A small helper `hasSource(block)` in `studio/edit.ts` replaces the `origin === 'extracted'` checks. "Edited by you" on a summary block compares against the authored summary text, not the source text.

### 6.2 Generated blocks get an anchor

```ts
export interface GeneratedBlock {
  id: string;
  origin: 'generated';
  markdown: string;
  citations: Citation[];
  askedAs: string;
  anchorId: string;          // the block it grew under (§4.2)
}
```

### 6.3 Mock fixture additions
- `mocks/studio-summary.ts`: authored summary blocks for all 12 pages of Normalization.pdf in the A style. Every `blockIds` entry must exist on that page in `studio-normalization.json`. The text passes the vocabulary gate.
- The default canvas `c-norm` becomes: summary blocks, the handwriting block `p2-hw` with its note, the written note `w-1` placed by the §2.5 rule, and one edited summary paragraph (replacing today's edited extracted block).
- **Diff reveal stays exercised:** at least one source block on a block-geometry page is covered by no summary paragraph.
- `mocks/studio-answers.ts`: 4–6 scripted answers (question, matching keywords, anchor summary id, Markdown, citations). Questions like "Why does repeated data cause problems?", "What is a functional dependency?", "How do 2NF and 3NF differ?". Deterministic, like `mocks/tutor.ts`.
- The seam stays `data/useSpaces.ts`. The screen calls one hook, `useAsk(canvasId)`, which returns `{ ask(question, anchorHint), answering, lastAddedId }`. The mock resolves after 600 ms, and `?mock=` can force the "cannot answer" path.

## 7. Units (all under `src/features/spaces/studio/`)

| Unit | Job |
|---|---|
| `types.ts` | `SummaryBlock`, `anchorId`, `hasSource` re-exported from `edit.ts` |
| `edit.ts` | `hasSource`, `insertAnswer(doc, answer)` (after anchor and its earlier answers), `removeBlock(doc, id)` |
| `components/SummaryBlock.tsx` | Renders a summary paragraph: gist styling, warm terms, marker, Peek and Morph exactly like `CleanBlock` (shares its internals rather than copying them) |
| `components/WovenAnswer.tsx` | The growing choreography of §4.3, Remove, and the reduced-motion path |
| `components/Composer.tsx` | Composer pill, suggested chips, pager slot, `/` key, the "Answering…" state |
| `components/AddedBelow.tsx` | The off-screen chip |
| `useKeepPlace.ts` | Scroll compensation when content grows above the viewport |
| `useAsk.ts` (in `data/`) | The seam: mock now, real later |

## 8. Testing
- **Pure:** `insertAnswer` ordering (several answers on one anchor; an anchor that is a written note); `removeBlock` plus undo; the note-placement rule of §2.5; a fixture test that every summary `blockIds` entry exists on its page and that the diff reveal has at least one uncovered block.
- **Components:** a summary paragraph opens Peek on the union box and flies home in Morph; answers fade (not fly) in Morph; the composer is disabled while answering; `/` focuses it, but not inside an input or dialog; an unknown question shows the honest line; Remove plus Undo restores the same position.
- **Motion:** a `WovenAnswer` exit exists (the motion.test rule); reduced motion renders no blur or stagger.
- **Keep place:** with the anchor above the viewport, `scrollTop` is corrected by the inserted height.
- **Gates:** `tsc -p tsconfig.app.json`, eslint, `check-vocabulary`, `vitest run src/features/spaces`, a11y, boundary.
- **Browser:** at 1440px and on phone, ask a scripted question, watch it grow, check "Added below ↓", Remove and Undo, then Source and back.

## 9. Changes to the Studio spec
| Studio spec | Now |
|---|---|
| §5.1 rule 3, Keep or Discard | Answers stay automatically; Remove plus Undo. |
| §5.1 rule 1, answer lands after the selection or reading-line block | The anchor order is selection → first citation → reading line (§4.2). |
| §6.3, `origin` drives every rule | Having a `source` drives the Peek/Morph rules; `summary` is a new origin. |
| §9, the default canvas has one extracted block per source block | The default canvas is the summary, plus handwriting and notes. |
| §3.2, the pager pill stands alone at the bottom | The pager lives inside the composer's right end. |

## 10. Out of scope
- **Real AI:** generating the summary and live answers (Plan 2, plus the pipeline spec's summary step).
- **Intelligent-UI answer blocks** (Studio spec §5.1a): Plan 2. A woven answer is Markdown only here.
- **Create, Publish, the Sources drawer:** Plan 2.
- **Regenerating or restyling the summary** (shorter, longer, simpler): later.

## 11. As built (2026-10-11)

Where the build differs from the text above, the build wins:

| Section | As built |
|---|---|
| §6.3 `useAsk(canvasId)` → `{ ask, answering, lastAddedId }` | `useAsk()` → `{ ask, answering, suggestions }`. `AskResult` is `answer` \| `unknown` \| `busy`; `busy` (an earlier question still in flight) is ignored silently. |
| §6.3 `?mock=` forces "cannot answer" | Dropped: any unscripted question exercises that path. |
| §7 `SummaryBlock.tsx`, `AddedBelow.tsx` | Summary paragraphs render through `CleanBlock` (`hasSource` + `data-gist`); "Added below ↓" is a `Composer` notice. |
| §4.6 Undo toast | An inline notice above the composer: "Answer removed · Undo". |
| Studio spec §4.2 rule 5, one "Not in your version" pill per block | One quiet chip per page ("N parts not in your version"). Each dashed outline is the button: the first click offers "Add to your version", the second click adds it. |
| §4.5 citation chips | They read `p. N · first words of the quote`; the full quote is in the chip's name and title. They open Peek on the summary paragraph that covers the cited block. |
| §4.7 the honest line | "In this preview I can answer a few questions about this Material — try one of these:" |
| §2.6 "Edited by you" on summaries | Uses the `edited` flag, not a text comparison. |
