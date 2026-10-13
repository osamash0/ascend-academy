# Real pages: files in, Studio pages out

**Date:** 2026-10-11 · **Status:** approved in conversation, awaiting written review
**Builds on:** the unified parse pipeline (`backend/services/parser/unified_orchestrator.py`, PIPELINE_VERSION "5"), draft PR #84 (Deck Cartographer, parse receipts), the Studio types in `src/features/spaces/studio/types.ts`, and the One Library spec (`2026-10-11-one-library-design.md`).

## 1. Why

Studio is built and reviewed, but it runs on one sample PDF and scripted answers. Nobody can try it with their own file. This spec makes a dropped file (PDF, PPTX, or a photo of notes) produce the same page data the sample has:

- a picture of every page (Source view, Peek, Morph),
- the page's text blocks with their positions (Peek outlines, Morph targets, "Not in your version"),
- a calm summary per page with **terms** and the blocks it covers (Learn, Recall, the Depth dial).

The sample proved the shape. This spec fills it with real files.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Extend the existing unified pipeline**; no second pipeline. | One read of the file, one AI bill. Two pipelines is the mess the 2026-06 rebuild removed. |
| D2 | **No MarkItDown, no PaddleOCR.** Positions come from PyMuPDF `get_text("dict")`; image pages and photos go to the vision model. | MarkItDown drops positions. PaddleOCR was removed on purpose (`ocr_fallback.py`) and is too heavy for the 4 GB server. |
| D3 | **A Studio material is a `lectures` row.** Own uploads stay `visibility='private_student'`; creator uploads stay course lectures. | Private uploads already live there; Share to a Space needs nothing new. |
| D4 | **New table `lecture_pages`**, one row per page, shaped like Studio's `SourcePage` plus the summary. | `slides` is the reader's table; Studio needs geometry and coverage the reader never uses. Keeping them apart lets each evolve. |
| D5 | **The summary rides on the per-page AI call we already make.** | No extra calls for text pages. |
| D6 | **Never invent geometry.** A page with untrustworthy boxes is `geometry: 'page'` with `blocks: []`. | The frontend already handles it, and wrong outlines are worse than none. |
| D7 | **Flag, don't replace.** Backend `FEATURE_STUDIO_PAGES`, frontend `VITE_STUDIO_LIVE`. With both off, nothing changes. | The project's standing safety rule for parser work. |
| D8 | **Land after PR #84.** | #84 rewrites the same orchestrator (boilerplate stripping, receipts). Building beside it means fighting conflicts. |

## 3. Formats

| In | How it enters | Geometry |
|---|---|---|
| PDF with text | as is | `block` |
| PDF page that is only an image (scan, exported picture) | as is; that page goes to vision | `block` from vision boxes, else `page` |
| PPTX | `office_convert.to_pdf` (LibreOffice, already built), then as a PDF | `block` |
| Photo: JPG, PNG, HEIC | PyMuPDF `convert_to_pdf` makes a one-page PDF (HEIC via `pillow-heif`) | `block` from vision boxes, else `page` |

**Deploy prerequisite:** LibreOffice (`soffice`) is not in the Docker image today (`office_convert.py:25-29`). It must be added to the worker image, or PPTX stays rejected exactly as now (`upload.py:48-65`). The size cost is roughly 400 MB, accepted for v1.

**Not in v1:** handwriting inside a PDF page that also has typed text (the text layer wins); multi-photo uploads stitched into one material (each photo is its own material); DOCX.

## 4. Data

### 4.1 Table `lecture_pages`

```sql
create table public.lecture_pages (
  lecture_id  uuid not null references public.lectures(id) on delete cascade,
  page        int  not null check (page >= 1),
  width       real not null,          -- PDF points; only the ratio matters
  height      real not null,
  image_path  text not null,          -- object path in bucket lecture-pages
  geometry    text not null check (geometry in ('block','page')),
  blocks      jsonb not null default '[]',   -- SourceBlock[] (types.ts), ids "p{page}-b{n}"
  summary     text,                   -- markdown, key terms as **bold**; null if the AI step failed
  gist        text,                   -- first paragraph of summary
  covers      text[] not null default '{}',  -- SourceBlock ids the summary condenses
  status      text not null default 'ready' check (status in ('ready','needs_review')),
  updated_at  timestamptz not null default now(),
  primary key (lecture_id, page)
);
alter table public.lecture_pages enable row level security;
-- select: same rule as the lecture (owner of a private_student lecture, or anyone who can read the course lecture)
-- insert/update/delete: service role only (the worker writes)
revoke all on public.lecture_pages from anon;
```

The migration is additive. It is applied manually via psql through the pooler, as the project's migrations always are; never `supabase db push`. It also grants nothing to `anon` (the 2026-10-11 lesson on SECURITY DEFINER grants).

### 4.2 Bucket `lecture-pages`

- Private.
- Object path: `{lecture_id}/p{page}.webp`.
- 1440 px wide, WebP at quality 80 (the fixture's settings; about 100 KB per page).
- `cache-control: private, max-age=31536000, immutable`. A re-parse writes new paths with a `?v=` revision, so the cache never serves a stale page.

### 4.3 Blocks

The `blocks` JSON is exactly `SourceBlock` from `types.ts`: `id`, `page`, `bbox` (normalised 0..1, top-left origin), `kind`, `text`, `confidence?` (vision only), `readingOrder`.

Ids are `p{page}-b{n}`, where `n` is the block's index in PyMuPDF's output. They are stable as long as the file is unchanged, which is what `SourceRef.blockIds` needs.

## 5. Pipeline

Three new steps run inside `parse_pdf_unified`, per page, when `FEATURE_STUDIO_PAGES` is on.

### 5.1 Read: `backend/services/parser/page_blocks.py` (new)

`extract_blocks(page) -> PageBlocks` is the logic of `scripts/studio/build_fixture.py`, moved into the service and tested:

- Headings are blocks whose largest span is at least 1.35 × the page's median font size and shorter than 120 characters.
- Lists are blocks whose lines all start with a bullet; bullets that sit on their own line are joined to the text after them.
- Figures are image blocks, skipped when they cover more than 60 % of the page (background) or less than 0.2 % (logo).
- Running footers (blocks starting below 90 % of the height) stay as source blocks but are **never** in `covers`, so "Not in your version" stays honest.
- A page with fewer than 25 characters of text is **image-only** and goes to §5.3.

The fixture script then becomes a thin caller of `page_blocks`, so the sample and production can't drift apart.

### 5.2 Picture: `backend/services/parser/page_images.py` (new)

`render_page_webp(page) -> bytes`, then upload to the bucket. This reuses the `poster.py` pattern. The page-1 poster stays as it is, because covers depend on it.

### 5.3 Write: summary and coverage

**Text pages.** The `analyze_slide` call (`synthesis.py:66`) gets an extended prompt version in the prompt registry. The page text is sent with block markers, for example `[p6-b2] Every determinant is a candidate key…`. Footers are excluded, and so are PR #84's boilerplate lines. The JSON reply gains:

```json
{ "studio": { "summary": "markdown, 3–6 calm lines, key terms in **bold**", "covers": ["p6-b2","p6-b3"] } }
```

- The existing fields (title, summary, quiz…) are unchanged, so the reader is unaffected.
- `covers` is validated: unknown ids are dropped.
- If `studio` is missing or unparsable, the page is stored with `summary: null`, `status: 'needs_review'`. Its blocks and picture still exist.

**Image-only pages and photos.** The vision call is extended to return `blocks` as `{kind, text, box_2d: [ymin,xmin,ymax,xmax] on 0–1000, confidence}` plus the same `studio` object.

- Gemini returns this box format natively, so pages that need boxes use the Gemini vision leg.
- If the configured vision model can't return boxes (today's prod default, gpt-4o-mini), the page is `geometry: 'page'`.

**Box sanity check** (`page_blocks.validate_vision_boxes`). The boxes are accepted only if all of these hold:
- every box lies inside the page, with positive area;
- no two boxes overlap by more than 50 % of the smaller one;
- together the boxes cover at least 15 % of the page.

Otherwise the page is `geometry: 'page'` with `blocks: []`, and the summary is kept with empty `covers`.

### 5.4 Save and tell

- An upsert into `lecture_pages` per page.
- A new SSE / Redis event `page {page, total, geometry, status}`.
- The existing `progress` event keeps working for the reader's upload UI.
- On `complete`, the lecture is ready.

### 5.5 Cost

| Page type | AI calls before | AI calls after |
|---|---|---|
| Text page | 1 text call | 1 text call (a longer reply, roughly 150 more output tokens) |
| Image page or photo | 1 vision call | 1 vision call (Gemini when boxes are wanted) |

The vision provider is unmetered in receipts today (PR #84, Arc 7). That stays a known gap and is not fixed here.

## 6. API

All endpoints are under the existing `/api/v1`, use the existing auth, and are rate-limited like their neighbours.

- **`POST /materials/upload`** (exists): accepts `.pdf .pptx .jpg .jpeg .png .heic`. Conversion happens before hashing, so a re-uploaded photo dedupes. Quota rules are unchanged.
- **`POST /upload/batch`** (exists): same formats for creators.
- **`GET /materials`** (exists): each item gains `stage: 'developing' | 'ready' | 'failed'` from `parse_runs.status`, plus `page_count`, `pages_ready`, and `poster_url`.
- **`GET /materials/{lecture_id}/pages`** (new) returns:
  ```
  { pages: SourcePage[], summaries: SummaryBlock[] }
  ```
  - `imageUrl` is a signed URL with a 1-hour TTL.
  - `SummaryBlock` ids are `s-p{page}`, with `source.blockIds = covers` and `gist`.
  - It returns 404 if the caller can't read the lecture and 409 while the material is still developing.
- **`POST /upload/jobs/{run_id}/retry`** (exists): Try again.

Live progress: the Library polls `GET /materials` every 3 s while any item is developing, and stops when none are. This reuses the `UploadsIndicator` pattern. No SSE in the browser for v1.

## 7. Frontend

The seam is already there. Only data files change; the components do not.

**Coordination (2026-10-11):** a parallel session ("Admin sign in setup") is wiring all of v4 to real data. It routes every screen through the hooks in `data/useSpaces.ts` / `data/useShelf.ts` (with a guard test against direct `mocks/*` imports) and adds a `SpacesRepository` with a demo and a live implementation. When that lands:
- the calls below become methods on the **live** `SpacesRepository`, and `VITE_STUDIO_LIVE` folds into its demo/live switch;
- no screen or component imports `mocks/*` or calls `fetch` directly.

The rows below describe *what* the live side must return, whichever file ends up holding it.

| File | Change |
|---|---|
| `data/useShelf.ts` | With `VITE_STUDIO_LIVE`, `items` come from `GET /materials`. `useDevelopment(id)` maps `pages_ready / page_count` to the phases "Reading your pages… 4 of 12", then "Writing your summary…". The mock store stays the source when the flag is off. |
| `library/BringIn.tsx` | Sends real bytes. `accept` gains `.heic`. Errors use the existing "Couldn't read this file" path. |
| `data/useSpaces.ts` (page lookup, 307-321) | Live materials load `GET /materials/{id}/pages` (React Query, stale time 1 h). The default canvas is built from `summaries`, the same way `mocks/studio-canvas.ts` builds it from the sample. |
| `mocks/shelf.ts` | `bringIn` and `develop` stay for the flag-off path and the tests. |

**What stays local in v1:** the overlay of a material's canvas (your answers, edits, notes), Recall marks and progress stay in the browser store they use today. Saving them to the server is the next spec (real AI behind Ask, together with canvas persistence). This spec is only about the pages.

## 8. Failure behaviour

| What fails | What the learner sees |
|---|---|
| The whole file (corrupt, encrypted, LibreOffice missing, timeout) | The cover shows "Couldn't read this file" and **Try again**. `parse_runs.error` holds the reason. |
| One page's summary | The page opens; Learn shows its extracted text (as at Full) instead of a summary; Recall has no terms there. Status is `needs_review`. |
| One page's boxes | `geometry: 'page'`: Peek and Morph fall back to the whole page, as page 3 of the sample does now. |
| A page picture upload | The run retries the upload 3 times. If it still fails, the page fails, and the file is `failed`, because Source view needs every picture. |
| Quota | The existing 403 message, shown as a toast on Bring in. |

## 9. Testing

1. **Golden file:** `page_blocks.extract_blocks` run on the sample's Normalization.pdf, pages 1–12, must reproduce `src/features/spaces/mocks/studio-normalization.json` block for block: ids, kinds, text, and boxes to 4 decimals. The fixture is the spec.
2. **Unit tests:**
   - `validate_vision_boxes`: inside, overlap and coverage cases, plus box_2d conversion.
   - `covers` validation, which drops unknown ids.
   - Photo-to-PDF conversion, including HEIC.
   - The prompt reply parser: missing `studio` leads to `needs_review`.
3. **DB test** (`-m db`, testcontainers): migration, RLS (an owner reads; another learner gets nothing; anon gets nothing), and an upsert on re-parse.
4. **End-to-end with a scripted LLM:** upload a 3-page PDF, see `page` events, then `GET /pages` returns 3 pages with signed URLs.
5. **Deck Lab** (`python -m backend.eval.deck_lab`), run on the 25 real decks with a new report, for each deck:
   - the share of pages with `geometry: 'block'`,
   - the share with a summary,
   - the average number of terms per page,
   - the uncovered share.
6. **Frontend:** `useShelf` and `useSpaces` live-mode tests with a mocked fetch. The existing guard tests (reachable, motion, modes, boundary, dead-ends) stay green.
7. **Manual:**
   - one real DBS deck (PDF),
   - one PPTX,
   - one phone photo of handwritten notes,
   - each taken from Bring in to Studio in the browser, with Peek, Morph, Recall and the Depth dial checked on each.

## 10. Order of work (for the plan)

1. Migration and bucket (applied locally first).
2. `page_blocks` plus the golden test; the fixture script calls it.
3. `page_images`.
4. The prompt version and reply parsing for text pages.
5. The vision blocks, the box check, and photo intake.
6. Orchestrator wiring behind `FEATURE_STUDIO_PAGES`, the `page` events, and the e2e test.
7. The API: `GET /materials` stage fields and `GET /materials/{id}/pages`.
8. The frontend live mode behind `VITE_STUDIO_LIVE`.
9. Deck Lab report and the manual pass.

## 11. Open risks

- **Vision box quality on handwriting** is unmeasured. The box check bounds the damage, and Deck Lab plus the manual photo pass will tell.
- **LibreOffice in the image** adds about 400 MB and a cold start. If that is too much, PPTX stays off and is announced as such (the existing behaviour).
- **Storage:** the free tier is 1 GB, which is roughly 10,000 pages. That is fine for a pilot; watch it, together with egress, given the August overage.
- **Dependency on PR #84** (D8). If it stalls, steps 1–3 and 5 don't touch the orchestrator and can go first.

## 12. Amendments while planning (2026-10-11)

Reading the code for the plan changed five things. Where they differ, these override the sections above.

1. **The summary is its own call, not a rider (overrides D5, §5.3, §5.5).**
   - Text pages are no longer synthesised one call per page. The live pipeline batches them, 8 per call (`batch_analyze_text_slides`), and PR #84 and #92 both change that code.
   - Extending that shared prompt would change what the live reader receives. So Studio summaries come from a separate `studio_summary` call, also batched 8 pages per call.
   - Image-only pages and photos get their own vision call, which returns the boxes and the summary together.
   - **Cost:**
     - text pages: one extra batched call per 8 pages;
     - image pages: one extra vision call each;
     - both only when `FEATURE_STUDIO_PAGES` is on.

     The reader's calls and outputs are untouched.
2. **OpenAI, not Gemini, for boxes (overrides §5.3).**
   - The launch runs `AI_PROVIDER_MODE=openai_only` (PR #92), which refuses other provider keys.
   - Vision boxes are asked of whichever vision model is configured, and the box check decides.
   - Expect more `geometry: 'page'` on photos until a box-capable model is allowed. The geometry report (plan Task 10) and the manual pass measure how many.
3. **Several paragraphs per page (overrides §4.1).**
   - Studio's sample has up to three summary paragraphs per page, each with its own covered blocks.
   - `lecture_pages` therefore stores `summary jsonb` as `[{markdown, covers}]`, replacing `summary`, `gist` and `covers`.
   - The first paragraph is the gist. The API turns them into `SummaryBlock`s `s-p{page}-{k}`.
4. **Picture path (overrides §4.2).** `lectures/{lecture_id}/p{page}.webp`, so segment 2 is the lecture id, as in the other lecture buckets. The bucket has no client policies at all: every read is a backend-signed URL.
5. **A pass after the reader's loop (refines §5).**
   - The Studio work runs as one pass after the per-slide loop rather than inside it.
   - `pages_ready` therefore rises during the "Writing your summary…" phase.
   - Deck Lab lives on PR #84's branch, so a no-AI geometry report over the real decks stands in for it (plan Task 10).
   - The frontend part is a typed client (`data/materialPages.ts`) that the parallel session's live repository calls.
