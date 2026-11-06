# Layout face: design

*2026-11-06. Approved in chat with Abi. Not described in the thesis (after the `dfc20df6` pin).*

## What

Layout is a switch on the reader's Page face. It re-sets a slide in the reader's calm type: every block stays where it
sat on the page, pictures and diagrams stay pictures, and a page that fails the checks stays the original.
First version: slide decks only (pages shown by `PdfPager`), rules only, no AI calls.

## Why this shape

The demo (local only, never in the repo: it holds lecture slides) ran four blind rounds. With the rules and the
clean-up, 71% of round-4 pages passed. The rest stay the original, so the reader never sees a broken page.
A vision pass (88% in round 4) can follow behind its own flag.

## Backend (PR A)

- `backend/services/parser/layout_blocks.py`: the demo's clean-up, ported. It takes a PyMuPDF page plus
  `page_blocks.extract_blocks` and returns blocks (bbox, kind, text, table columns), picture windows, the page's lines as normalised strokes, and a verdict `layout | original` with reasons.
  The steps: characters (symbol fonts, ligatures, accents), table grids, vector diagrams, pictures (logos = the same
  image drawn at the same place on many pages), snapping and trimming, empty crops dropped, lines redrawn (panels and
  furniture skipped), list items split. Also fix the flaws round 4 found on pages that pass: running footers and
  page-number boxes set as text or empty outlines, a diagram shown twice (crop of a light panel plus its redrawn lines),
  a Wingdings arrow coming through as ")", algorithm line numbers set as bullets, stray outline chips.
- Server checks at parse time: words missing (against the PDF's own words), broken characters, pictures lost or cut,
  diagrams lost, mostly crops, lines under a crop.
- New table `lecture_layouts (lecture_id, page, layout jsonb, version int)`, with RLS like `lecture_pages`. Applied by
  hand following `docs/runbooks/apply-a-migration-by-hand.md`, never `supabase db push`.
- It runs in the parse after the reading copy, behind `FEATURE_LAYOUT_FACE` (default off). It stores only JSON, a few
  KB per page, with no page images and no storage buckets (`FEATURE_STUDIO_PAGES` stays off).
- Served as an optional `layouts` field in `GET /v4/reader/lectures/{id}`, only when the flag is on. The reader uses
  them only for slide decks. Sub/superscripts and code lines come with the vision pass, later.
- `backend/scripts/backfill_layouts.py` fills older lectures from their stored reading copy where `layout` is missing
  or `version` is old.
- Tests use PDFs built in code (ligatures, a Symbol arrow, a cell grid, a boxed diagram, a repeated logo). No lecture
  slides in the repo. Parity is checked locally only: blind round 4 must reach 61 of 86 pages with rules.

## Reader (PR B)

- `src/features/spaces/components/reader/layout/`:
  - `LayoutLayer.tsx`: passed as `PdfPager`'s `overlay`, in the page's own coordinates.
  - `fit.ts`: container-relative sizes, so the layer scales with zoom.
  - `layoutGate.ts`: pure browser checks after fitting (lines colliding, text too small, lines crossing type).
- The layer has its own background in the reader's theme. Picture windows are cut into it, so the pdf.js page shows
  through, exact and sharp. Text is real and selectable, and existing marks stay on top.
- A quiet switch on the Page face plus a key (L, if free), remembered per learner. A page stored as `original`, or one
  failing the browser checks, has no switch and shows the original. No message, no count.
- The morph from the demo: composite only (opacity and transform on layers drawn in advance), no blur, instant under
  reduced motion.
- `VITE_FEATURE_LAYOUT_FACE` is derived from the backend flag in `docker-compose.prod.yml`. Switch label in `v4`
  en/de locales, checked against `docs/V4_GLOSSARY.md`.
- Vitest: gate functions, blocks at their positions, pictures as windows, sub/sup rendering, no switch on `original`,
  reduced motion.

## Rollout (Abi)

Apply the migration by hand, deploy, set `FEATURE_LAYOUT_FACE=1`, run the backfill, then look at a few real lectures
before telling anyone.

## Not in this version

The vision pass, document-shaped files, and Layout in the Text or Explain faces.
