# Studio Canvas — design

**Status:** Draft for review · 2026-10-10
**Scope:** v4 UI, mock data only (`src/features/spaces/`). The real file pipeline (MarkItDown + PaddleOCR) is a separate spec.
**Decided in conversation:** layout B (canvas with inline AI), Peek, the Morph switch, light by default, NotebookLM as reference and benchmark only, Streamdown for rendering.

---

## 1. What we are building

Studio is where you open your Material as a clean, readable page, understand it with an AI that always shows where its answers came from, and turn it into study material you can publish to a Space.

Three promises carry the whole design:

1. **The Material owns the screen.** The clean version of your file is the centre. AI and tools come to the page; the page never goes to them.
2. **The original is always one gesture away.** Nothing the system writes can pass for the source. *Peek* shows where one paragraph came from. *Morph* turns the whole page back into the original.
3. **Every AI output shows its evidence.** Answers and created items carry citations that open the original at the exact spot. Saying "based on your Material" in prose is never enough (Doc 1: grounding is chrome, not prose).

### What already exists, and what this spec does with it

| Existing work | Where | What we do |
|---|---|---|
| Studio list screens (uploads, drafts, impact) | `main`: `screens/LibraryStudioScreen.tsx` | **Keep.** They remain the dense batch-management screens under Library. |
| Reader: `TutorPanel`, `SelectionAsk`, `SourceView`, `mocks/tutor.ts` citation model | `main`: `components/reader/` | **Reuse.** Same "one question in flight" rule and the same rule that a citation is a pointer, never a footnote. Extend `TutorCitation` (see §6). |
| Studio v0.1 design study (Prepare → Write → Practice → Preview) + decisions table | branch `claude/two-faces-lesson-styling-1da325`, `docs/design-v4/studio/README.md` | **Keep its decisions** (no new public object, autosave ≠ publish, AI never publishes, Exclude rather than delete, role-aware publishing). Its step-rail workspace is replaced by the canvas. |
| Pipeline vision | same branch, `PIPELINE-UPGRADE-VISION.md` | **Adopt its contract:** stable page/block references, bounding boxes where available, extracted text kept separate from generated text, "do not invent geometry". §6 is built on it. |
| `studio-next` "Experience" builder (what `localhost:5173/v4/library/studio` shows today) | worktree `local-project-setup-50cb07`, unlanded | **Port pieces, don't merge.** Take its light/dark token idea, `OriginalPdfPreview` (react-pdf) and the `normalization.pdf` fixture. Not the 56 KB single component or its localStorage persistence. Its course-structure views (units, coverage, insights) are out of scope; see §12. |

---

## 2. Vocabulary (enforced by `scripts/check-vocabulary.mjs`)

UI copy may not say *lecture, slide, deck, document, student, professor, course, module, folder*. This spec uses:

- **Material**: an uploaded file (PDF, PPTX, image).
- **page**: a page of a Material. A PPTX slide is a page too.
- **Learn / Source**: the two views of a page (internally still 'clean' / 'original'). Learn is the default and comes first; the switch key is `S`. (Renamed 2026-10-10; later sections that say "Clean | Original" and `O` mean these.)
- **Lesson, Space, Practice, Contribution**: as defined in `01-foundations.md`.
- **Made from this**: the shelf of created items. Never "artifacts" in the UI.

---

## 3. Screens and routes

```
/v4/library/studio              Studio home   (new)
/v4/library/studio/c/:canvasId    Canvas        (new; the core of this spec)
/v4/library/uploads|drafts|impact   unchanged dense lists
```

`/v4/library/studio` must be declared before `/v4/library/:view` in `App.tsx`, the same way the existing Studio route comment notes.

### 3.1 Studio home

A calm entry point, not a dashboard.

- **Primary action: "Open Material".** A drop zone plus a file button. The mock creates a canvas from a fixture.
- **Continue where you left off:** the 3–6 most recent canvases, each with its Material name, Space, and last-opened time.
- **Needs you:** at most three rows (a failed creation, a processing Material, a draft waiting to publish), each linking to the place it happened.
- Links to the three dense lists in quiet text: "Manage uploads · Your drafts · How your work landed".

### 3.2 Canvas: layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ‹ Studio   Normalization.pdf · DBS        [Clean|Original] O   Saved   │  top bar
├───────┬──────────────────────────────────────────────────┬───────────────┤
│Sources│                                                    │  Peek gutter  │
│drawer │        page column  (max 68ch, centred)            │ (≥1200px) or  │
│(closed│        block · block · AI answer · block           │ Made-from-this│
│ by    │                                                    │ shelf         │
│default│                                                    │               │
├───────┴──────────────────────────────────────────────────┴───────────────┤
│  [scope chips]  ( Ask about this Material, or create something…    ↑ )   │  composer
│  Study guide · Quiz · Flashcards                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Top bar:** back, Material name + Space, the **Clean | Original** switch with its `O` hint, save state ("Saving…" / "Saved", `aria-live="polite"`), a "Made from this · 3" pill that opens the shelf, and **Publish**.
- **Sources drawer (left):** closed by default. Lists every Material in this canvas with a checkbox for scoping, plus "Add Material". Opening it pushes the page column on ≥1440px and overlays it below that.
- **Page column:** the clean version as ordered blocks. Each page starts with a quiet page divider ("page 12") that doubles as the Morph anchor.
- **Right gutter:** holds the pinned Peek on ≥1200px. Below 1200px, Peek opens as a bottom sheet.
- **Made-from-this shelf (right drawer):** created items and their job states (§5.3).
- **Composer (bottom, sticky):** a pill input, scope chips above it, create chips below it. It's always present, so AI is always one reach away without ever taking over the page.

**Responsive rules:**
- **≥1440px:** drawers can sit open beside the column.
- **1200–1439px:** drawers overlay the column; Peek uses the gutter.
- **768–1199px:** Peek uses a bottom sheet.
- **<768px:** one column, the composer collapses to a button, the switch becomes an icon toggle.
- No horizontal scroll at any width (checked at 375px).

### 3.3 Theme

Studio is **light by default**, with a dark option. v4 is dark-only today (`src/index.css` only defines dark `:root` tokens), so:

- **Scope it to `.studio-surface`.** A wrapper class redefines the shadcn HSL tokens (`--background`, `--foreground`, `--card`, `--border`, `--muted`, `--primary`, …), so anything already written with `bg-background`, `text-foreground`, `border-border` or `bg-card` flips automatically. Dark Studio is `.studio-surface[data-theme="dark"]`, mapping back to the v4 values.
- **Fix hard-coded alpha classes in reused components.** Some use classes like `bg-white/[0.02]` and `border-white/[0.07]`; these get two semantic utilities, `bg-surface-quiet` and `border-hairline`, defined per scope. Only reused components are touched, not the rest of v4.
- **Original pages always render on paper** (`#fdfcf8` with a hairline border) in both themes. `SourceView` had the dark background say "this is the source"; in a light Studio the cue becomes paper texture plus a serif page label.
- **Theme choice** is stored in `localStorage` (a per-viewer convenience), wrapped in try/catch.

### 3.4 Typography and rendering

- **One renderer for everything:** a `Markdown` component wrapping **Streamdown 2.7** (supports React 18 and Tailwind v3; add `./node_modules/streamdown/dist/*.js` to `tailwind.config.ts` `content`). The clean page, AI answers and created items all render through it, so the Material and the AI read as one surface.
- **Math:** KaTeX (already a dependency) through Streamdown's math support.
- **Sanitisation:** no raw HTML from Material text or model output. Streamdown's hardening stays on, and links open in a new tab with `rel="noopener noreferrer"`.
- **Clean page:** 17px / 1.7, max 68ch. **Chrome:** 13–14px Inter.
- **Streaming:** tokens fade in (Streamdown animation) under a `MotionConfig`; with reduced motion, text simply appears.

---

## 4. Seeing the original

### 4.1 Peek: one paragraph → its spot on the original

**Triggers:**

| Input | Opens Peek on… |
|---|---|
| Mouse | a block, after the pointer rests on it for **350 ms** (`pointerType === 'mouse'` only) |
| Touch | the block's page marker (`p.12` in the left margin), which is a real `<button>` |
| Keyboard | the focused block, with `Space`; `Esc` closes |
| Citation chip | the cited block (click/tap); also opens on hover-rest |

**What it shows:**
- The page image with the source region outlined (amber, 2px, 18% fill).
- A caption: "Original · Normalization.pdf · page 12".
- Buttons: **Pin** and **Full page**.

**Behaviour rules:**
1. **Same page → glide, don't reopen.** If the next block is on the page already showing, only the outline moves (Motion `layout` on the outline box, ~250 ms). A different page crossfades the image (150 ms).
2. **Grace period.** The Peek stays open while the pointer moves from the block into it, and closes 600 ms after the pointer leaves both, unless pinned.
3. **Pin.** A pinned Peek docks in the gutter and **follows your reading**: it tracks the block nearest the reading line (40% from the top of the viewport), updating at most every 150 ms. Unpin with the button or `Esc`.
4. **Nothing to show → no trigger.** A block with no source (an AI answer or text you wrote) has no page marker and no Peek. A marker that leads nowhere is the dead end `SourceView` was rebuilt to remove.
5. **Page-only geometry.** If the source has no block coordinates (§6.2), Peek shows the whole page without an outline, and the caption says "page 12" with nothing claiming a precise spot.
6. **Removed source.** If the Material's file was removed (`Material.sourceRemoved`), markers render as plain text and Peek shows: "The original file was removed. Your clean version keeps working."
7. **Full page** opens the page in a modal viewer (react-pdf for PDFs, zoomable; image for scans) with the region still outlined, using a page-turn transition (`rotateY` from 8° to 0° plus fade, 300 ms; a crossfade with reduced motion).

**Image source:** Peek uses pre-rendered page images (WebP, about 1600px wide), not live react-pdf rendering. It must open in under 100 ms, and the WebP-poster approach is already proven in this repo (the Supabase egress fix). In mocks, the images come from the fixture generator (§9).

### 4.2 Morph: the whole page ↔ the original

**Control:** the **Clean | Original** segmented switch in the top bar (`role="switch"`), plus the `O` key.

| Gesture | Result |
|---|---|
| Click/tap switch, or tap `O` (released < 250 ms) | Flip to the other view and **stay** |
| Press and hold switch or `O` (≥ 250 ms) | **Quick look:** flip, then flip back on release |
| Click a region in Original view | Flip back to Clean and land on that block (scroll into view, 1.2 s amber flash) |
| `Esc` in Original view | Back to Clean |

The `O` shortcut is ignored while focus is in an input, textarea or contenteditable.

**Choreography:**
1. **Find the anchor page:** the page with the most visible area. Only this page morphs; every other page crossfades (200 ms). This keeps the animation cheap on a 40-page Material.
2. **Fly each mapped block home.** Every clean block with a source mapping on the anchor page gets a `layoutId` (`morph-<sourceBlockId>`). In Original view, an overlay on the page image renders a box at each source block's bounding box with the same `layoutId`. Motion's shared-layout animation flies each block to its box: `cubic-bezier(.2,.8,.2,1)`, 600 ms, staggered 45 ms in reading order going out and reverse order coming back.
3. **Avoid squished text.** Motion animates layout with transforms, so the text's opacity drops to 0 during the first 40% of the flight, and the box arrives as an outline over the real page image. What you end up looking at is the true original, not a re-creation.
4. **Blocks with no source** (AI answers, your own writing) don't fly. They fade out on the spot (150 ms), since they don't exist in the original.
5. **Diff reveal.** Source blocks on the page that have no clean block (dropped, excluded or failed to extract) get a dashed outline and the label "Not in your version". Clicking one offers **"Add to your version"**, which re-includes it. Morph shows not only where things came from but what got lost.
6. **Edited blocks** get a small "Edited by you" tag on their region, so a reworded sentence is never mistaken for the source text.
7. **Keep your place.** After any switch, scroll so the anchor page's top sits where it was, and only then animate.
8. **Remember the choice.** The switch is persisted per viewer; reopening Studio restores the last view.
9. **Reduced motion:** a single 150 ms crossfade, no flight.
10. **Page-only geometry:** blocks fly to the page centre and fade. This is still a coherent motion, just a less precise one.

**Accessibility:**
- The switch announces "Showing original" / "Showing clean version" via `aria-live`.
- Regions in Original view are buttons labelled with their first words.
- Original view stays readable without the animation: it's the real page image plus an accessible region list.

---

## 5. The AI

### 5.1 Ask

1. **Where it lands.** The composer sends a question scoped to the selected Materials (all by default). The answer streams **into the page column** as an `ai-answer` block, inserted after an anchor:
   - the block holding the current selection (via `SelectionAsk`, "Ask about this"), or
   - the block at the reading line when there is no selection.
2. **What an answer carries:**
   - the question as a one-line header
   - the streamed Markdown
   - a citation chip row; chips open Peek on the cited block
   - next-step chips, e.g. "Make flashcards from this", which pre-fill a create request scoped to this answer's citations
3. **Keep or Discard.** Kept answers become `generated` blocks in your version and keep their citations. Discarded answers disappear and can be undone with a toast. Unkept answers survive navigation within the session but not a reload; the UI states this ("Keep it to save it").
4. **One question in flight.** The composer is disabled with "Answering…" while a stream runs, plus a **Stop** button. Stopping keeps what has arrived and labels it "Stopped".
5. **Failure.** A failure is shown inline in the answer block with the reason and a **Try again** that resends the same question. Never a fake answer.

### 5.1a Answers you can interact with (intelligent UI)

Inspired by [CopilotKit/OpenIntelligentUI](https://github.com/CopilotKit/OpenIntelligentUI). An answer isn't always a paragraph: for each question the AI **chooses the presentation** that helps most, which might be text, a side-by-side comparison, or a small working tool.

- **Typed blocks first, not generated code.** An answer is `{ title, format, blocks[], next[] }`, where every block is plain JSON from a fixed catalogue. That's OpenIntelligentUI's "native components" tier (A2UI). Plain data means each block can stream in on its own, carry its own citations, and be tested against fixtures.
- **The catalogue already exists.** The unlanded reader branch (`claude/two-faces-lesson-styling-1da325`, `components/reader/iui/spec.ts` + `Blocks.tsx`) built one for exactly this Material: `text`, `key`, `explore` (parts that light up on the page), `compare`, `fdTable` (an editable table checked live against a functional dependency), `closure` (X⁺ step by step), `bcnf` (a decomposition stepper), `check` (commit to an answer before seeing it) and `steps`. Plan 2 ports it and adds `citations: Citation[]` to every block.
- **No sandboxed generated HTML (OpenIntelligentUI's second tier) in v1.** Foundations parks "executable or embedded-code artifacts" until sandboxing and moderation exist. It could later be allowed for private, unpublishable answers in an isolated iframe. That would be a separate decision.
- **Keep** turns an interactive answer into a `generated` block that keeps its blocks. It stays interactive in your version.

### 5.2 Create

The create chips (Study guide · Quiz · Flashcards) open a small options popover. Options are stored with the item so Retry and Regenerate replay them exactly:

| Kind | Options | Becomes (§7) |
|---|---|---|
| Study guide | length: short / standard / detailed · focus (optional text) | text (Markdown) |
| Quiz | amount: fewer / standard / more · difficulty: easy / medium / hard · focus | practice set |
| Flashcards | amount: fewer / standard / more · difficulty · focus | practice set (card variant) |

Every kind also takes the current **scope** (selected Materials, or an answer's citations) and the language of the Material.

Mind map and audio overview are **not in v1** (§12).

### 5.3 Made from this: the shelf and job states

A create request returns immediately with an item in `queued`. You keep working.

```
queued → generating → ready
                    ↘ failed(code) ──Retry──→ queued   (same id, same options)
ready ──Regenerate──→ generating   (previous content kept for one-step undo)
ready ──Publish────→ published
```

- **Failure codes:** `rate_limited` ("The AI is busy. Your options are saved."), `no_content` ("These pages don't have enough to build a quiz from."), `timeout`, `provider`. Each has its own sentence; none shows a raw error.
- **States are explicit.** Faking success is not allowed: today's `generate_quiz` returns four "N/A" options for a metadata page (`backend/services/ai/tutor_service.py`). The Studio equivalent is `failed(no_content)`.
- **Shelf cards** show kind, options summary, sources ("from p. 10–14") and state. A ready card opens the item **in the page column** as a preview block (quiz is answerable, flashcards are flippable), with **Publish**, **Regenerate** and **Delete**.
- **Every created question or card carries citations**, rendered as chips on the preview (§6.3).

---

## 6. Data model

Mock-only for now, but shaped like the real thing so wiring later only changes the seam.

### 6.1 Source side: what the pipeline will produce

```ts
/** One page of a Material as the pipeline sees it. */
interface SourcePage {
  materialId: string;
  page: number;                 // 1-based, contiguous, as printed
  width: number; height: number; // points, for aspect ratio
  imageUrl: string;             // pre-rendered WebP
  geometry: 'block' | 'page';   // 'page' = no coordinates available; never invented
  blocks: SourceBlock[];        // empty when geometry === 'page'
}

interface SourceBlock {
  id: string;                   // stable across re-extraction where possible
  page: number;
  bbox: [x0: number, y0: number, x1: number, y1: number]; // normalised 0..1, origin top-left
  kind: 'heading' | 'paragraph' | 'list' | 'table' | 'code' | 'math' | 'figure' | 'handwriting';
  text: string;                 // extracted text, never generated
  confidence?: number;          // OCR only; < 0.8 renders a dotted underline in Clean view
  readingOrder: number;
}
```

### 6.2 Where geometry comes from (for the pipeline spec)

| Input | Engine | Geometry |
|---|---|---|
| PDF with a text layer | PyMuPDF `get_text("dict")` | block |
| Scanned PDF, photo, handwriting | PaddleOCR | block, plus confidence |
| PPTX | MarkItDown for text + `python-pptx` shape positions | block |
| Anything else | MarkItDown | page |

### 6.3 Canvas side: what you edit

```ts
interface CanvasDoc {            // internal name only; "document" never reaches UI copy
  id: string;
  materialIds: string[];
  spaceId: string | null;        // destination; required before publishing
  blocks: CanvasBlock[];
  revision: number;              // bumps on every edit; autosave uses it
  updatedAt: string;
}

type CanvasBlock =
  | { id: string; origin: 'extracted'; markdown: string; source: SourceRef; edited: boolean }
  | { id: string; origin: 'written';   markdown: string }
  | { id: string; origin: 'generated'; markdown: string; citations: Citation[]; askedAs: string }
  | { id: string; origin: 'item';      itemId: string };   // a created item previewed inline

interface SourceRef { materialId: string; page: number; blockIds: string[] } // union bbox when > 1

/** Extends the reader's TutorCitation: the same pointer rule, now down to a block. */
interface Citation {
  label: string;                 // "p. 12" or a Concept name
  materialId: string;
  page: number;
  blockId?: string;              // absent → whole page (page geometry)
  quote?: string;                // the supporting source text, shown in Peek's caption
}
```

**Why these choices:**
- **`origin` drives every rule in §4.** Only `extracted` blocks have markers, Peek and Morph flight. `generated` blocks have citations instead. `written` blocks have neither. One field, no special cases.
- **`edited` is a flag, not a copy.** The extracted text stays in `SourceBlock.text`. An edited block's markdown differs from it, and the "Edited by you" tag compares the two. That honours the pipeline vision's rule that extracted text and author edits never overwrite each other.
- **`blockIds[]`, not a single id.** One clean paragraph can merge two source lines; Morph flies it to their union bbox.

### 6.4 Created items

```ts
type ItemKind = 'study-guide' | 'quiz' | 'flashcards';
type ItemState =
  | { s: 'queued' } | { s: 'generating' } | { s: 'ready' } | { s: 'published'; to: PublishTarget }
  | { s: 'failed'; code: 'rate_limited' | 'no_content' | 'timeout' | 'provider' };

interface StudioItem {
  id: string; docId: string; kind: ItemKind; title: string;
  state: ItemState;
  options: StudyGuideOptions | QuizOptions | FlashcardOptions;   // replayed by Retry/Regenerate
  scope: { materialIds: string[]; citations?: Citation[] };
  content?: StudyGuideContent | QuizContent | FlashcardContent; // present when ready/published
  previous?: StudioItem['content'];                              // one-step undo after Regenerate
  createdAt: string;
}

interface QuizContent { questions: {
  prompt: string;
  options: { text: string; correct: boolean; why?: string }[]; // 2–5 options, exactly one correct
  citations: Citation[];                                        // at least one
}[] }
interface FlashcardContent { cards: { front: string; back: string; citations: Citation[] }[] }
interface StudyGuideContent { markdown: string; citations: Citation[] }
```

The quiz shape follows notebooklm-py's `answerOptions[{text, isCorrect}]` rather than today's backend shape (fixed four options with an int index, `backend/api/v1/ai_content.py`). That allows a per-option explanation and a variable number of options.

---

## 7. Publishing: respecting the locked object model

Foundations has no generic artifact object, and Studio does not add one. A ready item becomes one of the existing objects, decided by your role in the destination Space (the rule from the Studio v0.1 README):

| Your role in the Space | Study guide | Quiz / Flashcards |
|---|---|---|
| Owner / Editor, or Member in an Open Space | Lesson passage(s) in a draft Lesson | Lesson Practice |
| Member in a Guided Space | Contribution · type `text` | Contribution · type `practice-set` |

**The publish dialog shows:**
- the destination Space and, for Contributions, the anchor (Lesson or Concept, defaulting to the Lesson built from this Material)
- origin and real author
- the sources used
- a checklist:
  - **blockers:** no destination; quiz questions without a correct answer; items still generating
  - **warnings:** low-confidence OCR blocks among the cited ones

**Rules:**
- **Publish is the only action that changes who can see something.** Autosave never does.
- **Publishing into a private Space never makes it public.**
- **Grounding marker:** shown only when the Space has grounding switched on (Doc 1).

---

## 8. Architecture

### 8.1 Units (all under `src/features/spaces/`)

| Unit | Responsibility | Depends on |
|---|---|---|
| `studio/types.ts` | §6 types | — |
| `mocks/studio-canvas.ts` | fixtures + deterministic `askStudio()` (streaming async iterator on a timer) and `createItem()` (state transitions on timers, scripted failures) | types, generated fixture |
| `mocks/studio-canvas.generated.ts` | real pages, bboxes and text from `normalization.pdf` (§9) | — |
| `data/useSpaces.ts` | **the seam:** `useCanvas(id)`, `useSourcePages(materialIds)`, `useStudioItems(docId)`, `useAsk()`, `useCreate()`; same `{ state, data }` + `?mock=` scenarios as every other hook | mocks |
| `components/studio/Markdown.tsx` | Streamdown wrapper; the one renderer | streamdown |
| `components/studio/CanvasPage.tsx` | page column: blocks, page dividers, markers, keyboard focus order | Markdown |
| `components/studio/usePeek.ts` + `Peek.tsx` | Peek state machine (idle → pending(350 ms) → open → pinned) and the view | Radix Popover (exists) |
| `components/studio/useMorph.ts` + `MorphLayer.tsx` | tap/hold switch, anchor page, `layoutId` mapping, diff reveal | Motion (exists) |
| `components/studio/Composer.tsx` | input, scope chips, create chips + options popover, Stop | — |
| `components/studio/AnswerBlock.tsx` | streaming answer, citations, Keep/Discard, next steps | Markdown |
| `components/studio/Shelf.tsx` + `ItemPreview.tsx` | job cards; answerable quiz; flippable cards | — |
| `components/studio/SourcesDrawer.tsx` | Materials list, scoping, Add Material | — |
| `components/studio/PublishDialog.tsx` | §7 role mapping and checklist | — |
| `screens/StudioHomeScreen.tsx`, `screens/StudioCanvasScreen.tsx` | composition only | all of the above |

Each hook is testable without rendering. Each component gets its data through props, so the screen owns cross-cutting state (the current anchor block, the open Peek, the view) and nothing is lost when a drawer unmounts. That's the lesson recorded in `TutorPanel` about the thread living on the screen.

### 8.2 Reused from the reader

- `SelectionAsk`, extended with an anchor callback.
- The citation chip pattern from `TutorPanel`.
- `Pressable`, `states.tsx` (`ListSkeleton`, `NotFound`, `SpacesError`) and `MotionRoot`'s reduced-motion config.

### 8.3 New dependencies

- `streamdown@2.7.0` (pinned)
- That's all. Motion, Radix Popover, react-pdf and KaTeX are already in `package.json`.

---

## 9. Mock fixture: real data, not invented

A one-off script, `scripts/studio/build-fixture.py`, uses PyMuPDF on the real `public/v4-mock/normalization.pdf` (ported from the reader branch) to emit:

- `public/v4-mock/studio/p-<n>.webp`: one image per page, 1600px wide
- `mocks/studio-canvas.generated.ts`: `SourcePage[]` with real block bboxes and text, plus a default `CanvasDoc` with one `extracted` block per source block

The script's output is committed; the script is kept so the fixture can be regenerated.

Hand-written additions on top:

- **One page set to `geometry: 'page'`**, to exercise the PPTX/MarkItDown fallback.
- **One `handwriting` block with `confidence: 0.62`**, for the dotted underline and OCR warning.
- **One source block with no clean block**, for the diff reveal.
- **One `edited` block.**
- **Scripted AI exchanges** (deterministic, like `mocks/tutor.ts`), and one scripted `failed(rate_limited)` creation.

---

## 10. States

Every screen implements all four states via `?mock=` like the rest of v4.

| Surface | Loading | Empty | Error | Special |
|---|---|---|---|---|
| Home | list skeleton | "Open your first Material" | retry | processing / failed rows |
| Canvas | page skeleton | n/a (a canvas always has a Material) | `SpacesError` + back | source removed → §4.1 rule 6 |
| Peek | blurred placeholder at the page's aspect ratio | n/a | "Couldn't load this page" + retry | page-only geometry |
| Answer | streaming caret | n/a | inline reason + Try again | Stopped |
| Shelf | n/a | "Things you make from this Material appear here" | per-item failure codes | queued / generating |

---

## 11. Testing and verification

**Fixture guards** (`mocks/__tests__/studio-canvas.test.ts`, the repo's rule-guard pattern):
- every `SourceRef` and `Citation` resolves to an existing page or block
- every bbox lies within [0,1] with x0<x1 and y0<y1
- pages are contiguous from 1
- `geometry: 'page'` pages have no blocks
- every quiz question has exactly one correct option and at least one citation
- `extracted` blocks never carry citations; `generated` blocks always do

**Hook tests** (Vitest, fake timers):
- Peek: 350 ms intent delay, grace close, pin follows the reading line, touch marker path, `Space`/`Esc`
- Morph: tap (<250 ms) vs hold, `O` ignored in inputs, region click returns and flashes, reduced-motion path
- item lifecycle: Retry keeps id and options; Regenerate keeps one-step undo; no transition skips `generating`

**Component tests:** answer streaming + Stop, Keep/Discard + undo, publish role mapping table (§7) as a table-driven test.

**Accessibility:** extend `components/__tests__/a11y.test.tsx` (switch role and labels, marker buttons, 24px targets, focus order: column before gutter).

**Gates:**
- `tsc -p tsconfig.app.json` (not `tsconfig.json`, which checks nothing)
- ESLint
- `node scripts/check-vocabulary.mjs`
- Vitest for `src/features/spaces`

**Browser:** walkthrough on the dev server at 1440×900, 1280×800, 768×1024 and 375×812, in light and dark, with screenshots of Peek, Morph mid-flight and the shelf. No console errors.

---

## 12. Out of scope, and open decisions

**Out of scope for this spec:**
- The real pipeline: MarkItDown + PaddleOCR + PyMuPDF geometry, the endpoint, deployment of OCR off the 4 GB prod box. Its own spec; §6.1–6.2 is its contract.
- Real AI calls and streaming over SSE. The seam in §8.1 is where they plug in.
- Mind map (needs a foundations decision: it fits no v1 Contribution type) and audio overview.
- Rich-text editing. v1 edits a block's Markdown in place; a block editor library is a later decision.
- Collaboration, version history, the studio-next course-structure views (units, coverage, insights).

**Decisions (2026-10-10):**
1. **Base branch: fresh from `main`** (decided). Only the pieces listed in §1 are ported.
2. **Doc 2's "Studio = dense" rule: still open.** The canvas is calm on purpose. Proposed amendment: "Studio's list screens are dense; the Studio canvas is a calm working surface." Needs sign-off because 02-navigation is locked. Implementation doesn't wait on it.
3. **Peek is Studio-only** (decided). The reader keeps its 2026-09-18 decision.

**Plan 1 deviation:** "Full page" shows the high-resolution page image in a zoomable dialog. The react-pdf viewer arrives with the real pipeline, so the 5.5 MB PDF isn't committed for the mock.

---

## 13. Build order (input for the implementation plan)

1. **Foundation:** types, fixture generator + generated fixture, `.studio-surface` theme, `Markdown`, read-only canvas, routes, home skeleton.
2. **Peek.**
3. **Morph.**
4. **Ask:** composer, streaming answers, citations, Keep/Discard, selection anchor.
5. **Create:** options, shelf, lifecycle, item previews.
6. **Publish** dialog and role mapping; states pass; accessibility and responsive pass; browser verification.

Each step ends green on the gates in §11 and is reviewable on its own.
