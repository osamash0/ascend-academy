# Layout face Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Layout switch on the reader's Page face that re-sets a slide in the reader's calm type, block by block at its own place, with pictures shown through windows onto the pdf.js page.

**Architecture:** At parse time a deterministic PyMuPDF pass (a port of the local demo's `postprocess.py`) turns each page into a Layout page (blocks, picture windows, redrawn strokes, a verdict) and stores it in `lecture_layouts`. The reader response carries it. In the browser, `LayoutLayer` is drawn as `PdfPager`'s overlay, fitted, checked once more, and shown only where it passes.

**Tech Stack:** Python 3 + PyMuPDF (`fitz`) + Pillow, FastAPI, asyncpg via `get_db_connection`, Supabase SQL migration (applied by hand); React 18 + TypeScript + Vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-11-06-layout-face-design.md`

**Reference implementation (local only, never copy into the repo except code):** `~/learnstation-layout-face/tools/postprocess.py` (clean-up, 666 lines) and `~/learnstation-layout-face/layout-demo/template.html` (rendering `layoutFace`, `classify`, `fit`, `gate`). Its `decks/` and `board*/` folders hold lecture slides: never read them into tests, fixtures or commits.

## Global Constraints

- Lecture slide data never goes into the repo. Tests build PDFs in code or use the already committed `public/v4-mock/normalization.pdf`.
- Backend flag `FEATURE_LAYOUT_FACE` (default off); frontend `VITE_FEATURE_LAYOUT_FACE`, derived from it in `docker-compose.prod.yml`. Off = no new work, rows or fields.
- No AI calls. No page images or storage uploads. `FEATURE_STUDIO_PAGES` stays off.
- A Layout failure never fails a parse (log and continue).
- PyMuPDF calls that may run in threads hold `FITZ_LOCK` (`backend/services/parser/page_images.py`).
- Migrations: unique timestamp, applied by hand (`docs/runbooks/apply-a-migration-by-hand.md`); never `supabase db push`.
- Frontend: no hard-coded English (strings in `src/i18n/locales/{en,de}/v4Reader.json`, German du); no eyebrows, dots or glow; no `innerHTML` (render text as React nodes).
- Before every commit: `git status` and `git log -1` (several sessions share the repo).
- Gates: `npm run lint`, `npx vitest run`, `npx tsc --noEmit -p tsconfig.app.json`, `.venv/bin/python -m pytest backend/tests -m "not db" -q`, `ruff check backend/ --select F821,F811,F841`.
- Python: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python`.

## The Layout page (contract between PR A and PR B)

```jsonc
// one per page, lecture_layouts.layout; served as bundle "layouts": [LayoutPage]
{
  "page": 5,                       // 1-based
  "verdict": "layout",             // "layout" | "original"
  "reasons": [],                   // e.g. ["3 of 40 words missing"]; [] when layout
  "blocks": [                      // reading order
    { "id": "p5-b0", "kind": "heading", "bbox": [0.07, 0.06, 0.62, 0.12], "text": "…" },
    { "id": "t5-0", "kind": "table", "bbox": [...], "text": "a | b", "rows": [["a","b"]], "colW": [0.2, 0.3] },
    { "id": "pic5-0", "kind": "figure", "bbox": [...], "text": "", "picture": true },
    { "id": "p5-b3", "kind": "list", "bbox": [...], "text": "• one\n• two", "linked": true }
  ],                               // kind ∈ heading | paragraph | list | table | figure
  "paths": [ { "d": "M10.0,20.0L30.0,40.0", "bbox": [...], "fill": false } ],   // SVG path in a 0..1000 box
  "version": 1
}
```

bbox values are page fractions `[x0, y0, x1, y1]`, top-left origin, like `SourceBlock`.

---

# PR A — backend (branch `feat/layout-face-backend` from `origin/main`)

### Task A1: Package, geometry and characters

**Files:**
- Create: `backend/services/parser/layout/__init__.py` (empty docstring module)
- Create: `backend/services/parser/layout/geometry.py`
- Create: `backend/services/parser/layout/chars.py`
- Test: `backend/tests/unit/test_layout_chars.py`

**Interfaces:**
- Produces: `geometry.area(b)`, `inter(a,b)`, `union(bs)`, `near(a,b,g=0.02)`, `centre_in(b,r,pad=0.01)`, `white(c)` (port of `_white`). `chars.pua_map(page) -> dict[str,str]`, `chars.map_text(s, m) -> str`, `chars.wing_bullets(page) -> bool`, `chars.fix_chars(s, wing=False) -> str`, `chars.fix_dingbat_bullets(text, m) -> str`.

- [ ] **Step 1: Write the failing tests**

```python
"""Characters a reader must never see: symbol-font private-use glyphs, TeX and Unicode ligatures,
spacing accents, Wingdings bullets."""
from backend.services.parser.layout.chars import fix_chars, map_text, fix_dingbat_bullets
from backend.services.parser.layout.geometry import area, inter, union, near, centre_in, white


def test_tex_ligature_codes_become_letters():
    assert fix_chars("e\x1ecient \x1cnd") == "efficient find"


def test_unicode_ligatures_become_letters():
    assert fix_chars("ﬁle ﬂow") == "file flow"


def test_spacing_accent_composes_with_its_letter():
    assert fix_chars("Gr¨obner ¨Aquivalenz") == "Gröbner Äquivalenz"


def test_backtick_stays_code():
    assert fix_chars("`ls`") == "`ls`"


def test_wingdings_section_sign_bullet_goes_only_on_wingdings_pages():
    assert fix_chars("§ Speicher", wing=True) == "Speicher"
    assert fix_chars("§ 3 BGB", wing=False) == "§ 3 BGB"


def test_map_text_uses_the_page_map():
    assert map_text("a  b", {"": "→"}) == "a → b"


def test_dingbat_bullet_mid_line_becomes_the_pages_arrow():
    assert fix_dingbat_bullets("• A • B", {"": "→"}) == "• A → B"
    assert fix_dingbat_bullets("• A • B", {}) == "• A • B"


def test_geometry_helpers():
    assert area([0, 0, 0.5, 0.5]) == 0.25
    assert inter([0, 0, 0.5, 0.5], [0.25, 0.25, 1, 1]) == [0.25, 0.25, 0.5, 0.5]
    assert union([[0, 0, 0.1, 0.1], [0.5, 0.5, 0.6, 0.6]]) == [0, 0, 0.6, 0.6]
    assert near([0, 0, 0.1, 0.1], [0.11, 0, 0.2, 0.1])
    assert centre_in([0.4, 0.4, 0.6, 0.6], [0.3, 0.3, 0.7, 0.7])
    assert white(None) and white((1, 1, 1)) and not white((0, 0, 0))
```

- [ ] **Step 2: Run, expect FAIL** — `.venv/bin/python -m pytest backend/tests/unit/test_layout_chars.py -q` → `ModuleNotFoundError`.

- [ ] **Step 3: Implement.** Port verbatim from the reference: `area`, `inter`, `union`, `near`, `centre_in`, `_white` (rename `white`) into `geometry.py`; `SYMBOL`, `DINGS`, `pua_map`, `map_text`, `SPACING`, `ACCENT`, `TEX_LIG`, `LIGATURE`, `wing_bullets`, `fix_chars` into `chars.py`. Add `fix_dingbat_bullets`, lifted from the reference `main()` (lines 636–639):

```python
ARROWS = set("→⇒←⇐↔⇔")


def fix_dingbat_bullets(text: str, m: dict[str, str]) -> str:
    """The rules extractor turns a dingbat arrow mid-line into a bullet: give the arrow back."""
    if not m or "•" not in text[1:]:
        return text
    arrow = next(iter(set(m.values()) & ARROWS), None)
    return text[:1] + text[1:].replace(" • ", f" {arrow} ") if arrow else text
```

The reference's private-use range test (`"" <= c <= ""`) holds invisible characters; write it as `"" <= c <= ""`.

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git add backend/services/parser/layout backend/tests/unit/test_layout_chars.py && git commit -m "feat(layout): geometry and character fixes for the Layout face"`

### Task A2: Tables from cell grids

**Files:**
- Create: `backend/services/parser/layout/tables.py`
- Test: `backend/tests/unit/test_layout_tables.py`

**Interfaces:**
- Consumes: `geometry.*`, `chars.map_text`.
- Produces: `table_grids(page, m) -> list[{"bbox","rows","colW"}]`, `apply_tables(n, blocks, grids) -> None` (mutates `blocks`; drop the reference's `vision` parameter and the `"v"` key).

- [ ] **Step 1: Write the failing test** (PDF built in code):

```python
import fitz
from backend.services.parser.layout.tables import table_grids, apply_tables


def grid_page():
    doc = fitz.open()
    page = doc.new_page(width=800, height=600)
    for r in range(4):
        for c in range(3):
            rect = fitz.Rect(100 + c * 150, 100 + r * 40, 250 + c * 150, 140 + r * 40)
            page.draw_rect(rect, color=(0, 0, 0), width=0.5)
            page.insert_text((rect.x0 + 6, rect.y0 + 25), f"r{r}c{c}", fontsize=11)
    return doc, page


def test_a_cell_grid_is_a_table_with_verbatim_cells():
    doc, page = grid_page()
    grids = table_grids(page, {})
    assert len(grids) == 1
    assert grids[0]["rows"][0] == ["r0c0", "r0c1", "r0c2"]
    assert len(grids[0]["colW"]) == 3


def test_apply_tables_replaces_the_blocks_inside():
    doc, page = grid_page()
    grids = table_grids(page, {})
    blocks = [{"id": "p1-b0", "kind": "paragraph", "bbox": [0.15, 0.18, 0.3, 0.22], "text": "r0c0", "readingOrder": 0}]
    apply_tables(1, blocks, grids)
    assert [b["kind"] for b in blocks] == ["table"]
    assert blocks[0]["id"] == "t1-0"


def test_two_boxes_are_not_a_table():
    doc = fitz.open()
    page = doc.new_page(width=800, height=600)
    page.draw_rect(fitz.Rect(100, 100, 200, 140)); page.draw_rect(fitz.Rect(300, 100, 400, 140))
    assert table_grids(page, {}) == []
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — port `table_grids` and `apply_tables` verbatim (reference lines 459–524), minus `vision`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(layout): tables from cell grids`

### Task A3: Diagrams, pictures and figure boxes

**Files:**
- Create: `backend/services/parser/layout/figures.py`
- Test: `backend/tests/unit/test_layout_figures.py`

**Interfaces:**
- Consumes: `geometry.*`.
- Produces: `diagram_regions(page)`, `apply_regions(n, blocks, regions) -> dict`, `trim_figures(blocks) -> int`, `ink(page, rect, skip=()) -> float`, `drop_blank_figures(page, blocks, skip=()) -> int`, `repeated_places(doc) -> set` (renamed `repeated_xrefs`, **no module cache**: the caller computes it once per document and passes it on; the reference's `_REPEAT` keyed by `id(doc)` leaks and can collide in a long-running worker), `content_pictures(page, repeated) -> list[bbox]`, `apply_pictures(n, blocks, pics) -> int`. Drop `vision` parameters and `"v"` keys; leave `snap_figures` out (vision only).

- [ ] **Step 1: Write the failing tests:**

```python
import io
import random

import fitz
from PIL import Image

from backend.services.parser.layout.figures import (apply_pictures, apply_regions, content_pictures,
                                                    diagram_regions, drop_blank_figures, repeated_places)


def noise_png(w=120, h=90):
    rnd = random.Random(1)
    im = Image.new("RGB", (w, h))
    im.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)) for _ in range(w * h)])
    buf = io.BytesIO(); im.save(buf, "PNG"); return buf.getvalue()


def test_boxes_each_holding_a_label_are_one_diagram():
    doc = fitz.open(); page = doc.new_page(width=800, height=600)
    for i, x in enumerate((100, 300, 500)):
        page.draw_rect(fitz.Rect(x, 200, x + 120, 260), color=(0, 0, 0))
        page.insert_text((x + 10, 235), f"Node{i}", fontsize=12)
    page.draw_line((220, 230), (300, 230)); page.draw_line((420, 230), (500, 230))
    regions = diagram_regions(page)
    blocks = [{"id": f"p1-b{i}", "kind": "paragraph", "bbox": [(x + 10) / 800, 222 / 600, (x + 60) / 800, 238 / 600],
               "text": f"Node{i}", "readingOrder": i} for i, x in enumerate((100, 300, 500))]
    st = apply_regions(1, blocks, regions)
    assert st["diagrams"] == 1
    assert [b["kind"] for b in blocks] == ["figure"] and blocks[0]["diagram"]


def test_a_logo_on_every_page_is_furniture_and_a_photo_is_content():
    doc = fitz.open(); png = noise_png()
    for _ in range(4):
        p = doc.new_page(width=800, height=600)
        p.insert_image(fitz.Rect(700, 20, 780, 80), stream=png)          # logo: same place, every page
    doc[1].insert_image(fitz.Rect(200, 200, 500, 420), stream=noise_png(200, 150))   # photo: once
    rep = repeated_places(doc)
    assert content_pictures(doc[0], rep) == []
    pics = content_pictures(doc[1], rep)
    assert len(pics) == 1
    blocks = []
    assert apply_pictures(2, blocks, pics) == 1 and blocks[0]["picture"]


def test_an_empty_figure_box_is_dropped_but_one_with_words_stays():
    doc = fitz.open(); page = doc.new_page(width=800, height=600)
    page.insert_text((420, 330), "label", fontsize=12)
    blocks = [{"id": "f0", "kind": "figure", "bbox": [0.05, 0.05, 0.3, 0.3], "text": ""},
              {"id": "f1", "kind": "figure", "bbox": [0.5, 0.5, 0.6, 0.6], "text": ""}]
    assert drop_blank_figures(page, blocks) == 1
    assert [b["id"] for b in blocks] == ["f1"]
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — port `diagram_regions`, `apply_regions`, `trim_figures`, `ink`, `drop_blank_figures`, `place`, `repeated_xrefs` (→ `repeated_places(doc)`, no cache), `flat`, `content_pictures(page, repeated)` (takes the set instead of `doc`), `apply_pictures` (reference lines 41–206 and 384–453). Wrap pixmap calls (`ink`, `flat`) in `with FITZ_LOCK:`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(layout): diagrams, pictures and figure boxes`

### Task A4: Redrawn lines, and the flaws round 4 found

**Files:**
- Create: `backend/services/parser/layout/strokes.py`
- Modify: `backend/services/parser/layout/chars.py` (arrow bullet)
- Test: `backend/tests/unit/test_layout_strokes.py`

**Interfaces:**
- Produces: `reink(page, keep_out, texts) -> (paths, diagrams)`, `link_labels(blocks, paths) -> None`, `drop_furniture(blocks, footers, page_no) -> list[bbox]` (returns the dropped boxes, for the word check), `numbered_lines(text) -> bool`.

The four flaws (spec): fix each with a failing test first.

1. **Footers and page-number boxes.** `drop_furniture`: remove blocks whose id is in `extract_blocks(...)["footers"]`, and blocks whose whole text matches `^(slide|folie|seite|page|s\.)?\s*\d+(\s*(/|of|von)\s*\d+)?$` (case-insensitive) and sit in the outer band (`y0 > 0.86` or `y1 < 0.1`). In `reink`, skip a closed shape smaller than 6% × 6% of the page that holds no text block and sits in that band (the empty page-number chip).
2. **A diagram shown twice.** In `reink`, an item whose bbox overlaps any `keep_out` box by ≥ 50% of its own area counts as inside it (`drawn = True`, not redrawn). The reference only skipped items fully inside (± 0.006), so a light panel's crop plus its offset outline showed both.
3. **Wingdings arrow as ")".** Inspect first: `$PY -I -c "import fitz;d=fitz.open('<the IP deck PDF in ~/Downloads>');p=d[11];print([(s['font'],repr(s['text'])) for b in p.get_text('dict')['blocks'] for l in b.get('lines',[]) for s in l['spans'] if ')' in s['text']][:10])"`. Expected: the bullet span's font is a Wingdings/Symbol font whose text is a plain `)` (or ``). Add that code to `DINGS["wingdings"]` (`0x29: "→"` if the inspection confirms; otherwise the code it shows) and, for a non-PUA `)`, map it only when the span's font is a dingbat font: extend `pua_map` to return `{")": "→"}` for that page in that case, and apply `map_text` before `fix_chars`. Test with a stub page object whose `get_text("rawdict")` returns one span `{"font": "Wingdings-Regular", "chars": [{"c": ")"}], "text": ")"}`.
4. **Algorithm line numbers set as bullets.** `numbered_lines(text)`: true when ≥ 3 lines start with consecutive integers (`^\s*\d{1,3}[:.)]?\s`). Such a block keeps its numbers as text and is never turned into a list: in the build (Task A5) set `kind = "paragraph"` and keep line breaks.
5. **Stray outline chips** (a cover page's small empty outlines): in `reink`, skip a closed shape (`re`/`qu`) smaller than 4% × 4% that encloses no text block and is not part of a cluster of ≥ 3 items.

- [ ] **Step 1: Write the failing tests** — one per flaw (stub pages built with `fitz.open()`; e.g. a 30×20 pt rectangle at y=570 of 600 with no text is not in `paths`; an outline 10 pt offset from a figure box is not redrawn; `numbered_lines("1 a\n2 b\n3 c")` is true and `numbered_lines("• a\n• b")` false; a footer id is dropped), plus a happy path: an arrow between two labels is redrawn and the labels get `linked`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — port `reink`, `link_labels` (reference lines 531–611) with fixes 1, 2 and 5; add `drop_furniture`, `numbered_lines`, the dingbat mapping.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(layout): redrawn lines; footers, page chips, doubled diagrams, arrow bullets, line numbers`

### Task A5: One page in, one Layout page out (build + server checks)

**Files:**
- Create: `backend/services/parser/layout/checks.py`
- Create: `backend/services/parser/layout/build.py`
- Test: `backend/tests/unit/test_layout_build.py`

**Interfaces:**
- Consumes: everything above; `page_blocks.extract_blocks(page, n)`.
- Produces: `LAYOUT_VERSION = 1`; `build_page_layout(page, n, repeated) -> dict` (the Layout page contract); `checks.server_checks(page, blocks, pics, diagrams, paths, dropped) -> list[str]`.

The build, in the reference's order (`main()`, rules branch): `extract_blocks` → `drop_furniture` → per block `map_text` (via `pua_map`), `fix_dingbat_bullets`, `fix_chars` → `numbered_lines` → `table_grids`/`apply_tables` → `diagram_regions` (minus regions mostly inside a table) /`apply_regions` → `trim_figures` → `content_pictures`/`apply_pictures` → `drop_blank_figures` → `reink` (keep_out = tables + figures; texts = non-figure, non-table blocks) → `link_labels` → `server_checks`. Output blocks keep only `id, kind, bbox, text, rows?, colW?, linked?, picture?, diagram?`, sorted by `readingOrder`.

Server checks (port of `gate()` checks that need no rendering; normalise words like `norm_` in the template: lowercase, strip `\x1b-\x1f`, NFKD, drop marks and non-alphanumerics):
- no non-figure block → verdict `original`, reasons `["no text layer"]`;
- words: each PDF word is matched by a text block's words (multiset), or a longer-than-2 substring of all typed text, or lies inside a figure, or inside a dropped box, or is furniture (inside no block and `y0 > 0.86` or `y1 < 0.1`); coverage < 0.98 → `"{missing} of {total} words missing"`;
- broken characters: a text block matching `[¨´ˆ˜]` or `(^|\s)§\s` → `"broken characters in {n} blocks"`;
- pictures: each pic covered < 85% by figure boxes → `"{n} pictures lost or cut"`;
- diagrams: fewer than 60% of a diagram's items redrawn (path bbox equal) or inside a figure/table → `"{n} diagrams lost"`;
- under a window: a figure box covering > 20% of a text block's area → `"{n} lines under a crop"`;
- crops: area of blocks still holding private-use characters ÷ text area > 0.35 → `"{p}% of the text is crops"`.
Verdict `layout` when no reason, else `original`.

- [ ] **Step 1: Write the failing tests** — on the committed `public/v4-mock/normalization.pdf` (pages 1–12, as `test_page_blocks.py` does): every page returns the contract keys; `version == 1`; every bbox within 0..1; no block text contains `\x1b`–`\x1f` or private-use characters; at least 8 of 12 pages have verdict `layout`. And on PDFs built in code: a page with only an image → `original`, `["no text layer"]`; a page where a figure box covers a paragraph → reason contains `"under a crop"`; a plain text page → `layout`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `checks.py` and `build.py`.
- [ ] **Step 4: Run, expect PASS.** Also run the whole Layout suite.
- [ ] **Step 5: Commit** — `feat(layout): build a Layout page with server checks`

### Task A6: Table, flag and the parse hook

**Files:**
- Create: `supabase/migrations/20261106120000_lecture_layouts.sql`
- Create: `backend/services/parser/layout/store.py`
- Modify: `backend/core/config.py` (flag next to `feature_studio_pages`, ~line 150)
- Modify: `backend/services/parser/unified_orchestrator.py` (~line 1229, after step 4a)
- Test: `backend/tests/unit/test_layout_store.py`

**Interfaces:**
- Produces: `settings.feature_layout_face`; `store.build_layouts(lecture_id, pdf_bytes) -> int` (pages written); `store.upsert_layouts(lecture_id, pages) -> None`; `store.load_layouts(lecture_id) -> list[dict]`.

Migration (modelled on `20261013010000_lecture_pages.sql`):

```sql
-- Layout face (docs/superpowers/specs/2026-11-06-layout-face-design.md).
-- One row per page: the page re-set as blocks at their own places, with a verdict.
-- Written only by the parse worker (service role); readable exactly when the lecture is.
CREATE TABLE IF NOT EXISTS public.lecture_layouts (
    lecture_id  uuid        NOT NULL REFERENCES public.lectures(id) ON DELETE CASCADE,
    page        int         NOT NULL CHECK (page >= 1),
    layout      jsonb       NOT NULL,
    version     int         NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (lecture_id, page)
);
ALTER TABLE public.lecture_layouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read layouts of lectures you can read" ON public.lecture_layouts;
CREATE POLICY "Read layouts of lectures you can read"
ON public.lecture_layouts FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.lectures l WHERE l.id = lecture_layouts.lecture_id));
REVOKE ALL ON public.lecture_layouts FROM anon;
REVOKE ALL ON public.lecture_layouts FROM authenticated;
GRANT SELECT ON public.lecture_layouts TO authenticated;
```

Config:

```python
    # Layout face (docs/superpowers/specs/2026-11-06-layout-face-design.md): each page
    # re-set as blocks with a verdict, in lecture_layouts. No AI calls, no uploads.
    # Off = no new work or rows. Depends on migration 20261106120000_lecture_layouts.sql.
    feature_layout_face: bool = Field(alias="FEATURE_LAYOUT_FACE", default=False)
```

`build_layouts`: open the bytes with `fitz`, compute `repeated_places(doc)` once, `build_page_layout` per page inside `asyncio.to_thread` under `FITZ_LOCK`, upsert all rows in one transaction (`INSERT … ON CONFLICT (lecture_id, page) DO UPDATE`), then `DELETE … WHERE page > $last`. Orchestrator hook (non-fatal):

```python
        # ── 4a′. Layout face ──────────────────────────────────────────────────
        # Each page re-set as blocks with a verdict. Deterministic, no AI calls;
        # a failure here never fails the parse (the Page face is unaffected).
        if settings.feature_layout_face and created_lecture_id is not None:
            try:
                from backend.services.parser.layout.store import build_layouts
                await build_layouts(created_lecture_id, pdf_bytes)
            except Exception as exc:
                logger.warning("layout pass failed (non-fatal): %s", exc)
```

- [ ] **Step 1: Write the failing tests** — `build_layouts` with `upsert_layouts` monkeypatched records one row per page of `normalization.pdf`; an exception inside `build_page_layout` for one page still writes the others (that page stored as `original`, reasons `["layout failed"]`); the migration file name passes `backend/scripts/check_migration_timestamps.py`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** migration, flag, store, hook.
- [ ] **Step 4: Run, expect PASS**, plus `.venv/bin/python backend/scripts/check_migration_timestamps.py`.
- [ ] **Step 5: Commit** — `feat(layout): lecture_layouts, FEATURE_LAYOUT_FACE and the parse hook`

### Task A7: Serve layouts with the reader bundle

**Files:**
- Modify: `backend/services/v4_reader_service.py` (`get_lecture`, ~line 223)
- Test: `backend/tests/unit/test_v4_reader_service.py` (add cases)

**Interfaces:**
- Consumes: `store.load_layouts`.
- Produces: response key `"layouts": [LayoutPage]` at the top level next to `concepts`, **only** when `settings.feature_layout_face` is on and rows exist; absent otherwise. Rows with `version < LAYOUT_VERSION` are still served (the fill-in updates them). The client decides slide-deck vs document.

- [ ] **Step 1: Failing tests** — flag off → no `layouts` key and `load_layouts` not called; flag on with two rows → `layouts` ordered by page; a `load_layouts` exception → no key, the lecture still loads.
- [ ] **Step 2: Run, expect FAIL.** - [ ] **Step 3: Implement.** - [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit** — `feat(layout): the reader bundle carries layouts`

### Task A8: Fill in older lectures

**Files:**
- Create: `backend/scripts/backfill_layouts.py`
- Test: `backend/tests/unit/test_backfill_layouts.py`

Follow `backend/scripts/backfill_lecture_posters.py`: PDFs from `pdf-uploads` by `pdf_hash`, one download per hash, `--local-dir` (SHA-256 match, zero egress), `--dry-run` (bytes it would download), `--limit`, `--lecture-id`, `--force`. Selects lectures with no `lecture_layouts` rows or any row with `version < LAYOUT_VERSION`. Calls `build_layouts`.

- [ ] **Step 1: Failing tests** — selection logic with stubbed queries (missing → picked, stale → picked, current → skipped unless `--force`); `--dry-run` downloads nothing.
- [ ] **Step 2–4: FAIL → implement → PASS.**
- [ ] **Step 5: Commit** — `feat(layout): fill in layouts for older lectures`

### Task A9: Local parity check, gates and PR

- [ ] **Step 1:** Write `~/learnstation-layout-face/tools/parity.py` (local, not in the repo): for every rules page of `layout-demo/decks/blind4/jobs.json`, run `build_page_layout`; compare with `layout-demo/board4/report.json` (rules rows). Print: demo-pass pages the server holds (each with reasons); demo-held pages for server-side reasons (words, pictures, characters, diagrams, under a crop, crops) the server passes.
- [ ] **Step 2:** Accept when ≤ 3 of the 61 demo-pass pages are held (each explained) and ≥ 90% of server-side demo holds are held. Otherwise fix the port and re-run.
- [ ] **Step 3:** Run all backend gates (Global Constraints). Fix failures.
- [ ] **Step 4:** `git status`, `git log -1`, push the branch, open PR A (title `feat(layout): Layout face, backend (flag off)`), body: what, flag off, the migration to apply by hand, the parity result as numbers only (no slide content). Bind it with the ccd_pr tools.

---

# PR B — reader (branch `feat/layout-face-reader`, stacked on PR A's branch)

### Task B1: Types, flag and data

**Files:**
- Create: `src/features/spaces/components/reader/layout/types.ts`
- Modify: `src/features/spaces/data/liveRepository.ts` (`ReaderLecture`, ~line 145)
- Modify: `src/features/spaces/data/useReader.ts` (pass `layouts` through, ~line 274)
- Modify: `src/lib/featureFlags.ts`, `Dockerfile.frontend` (ARG + ENV), `docker-compose.prod.yml` (build arg `VITE_FEATURE_LAYOUT_FACE: ${FEATURE_LAYOUT_FACE:-0}`)
- Test: `src/features/spaces/components/reader/layout/__tests__/types.test.ts`

**Interfaces:**
- Produces:

```ts
export type Box = [number, number, number, number];
export type LayoutKind = 'heading' | 'paragraph' | 'list' | 'table' | 'figure';
export interface LayoutBlock { id: string; kind: LayoutKind; bbox: Box; text: string; rows?: string[][]; colW?: number[]; linked?: boolean; picture?: boolean; diagram?: boolean }
export interface LayoutPath { d: string; bbox: Box; fill: boolean }
export interface LayoutPage { page: number; verdict: 'layout' | 'original'; reasons: string[]; blocks: LayoutBlock[]; paths: LayoutPath[]; version: number }
export function isLayoutPage(x: unknown): x is LayoutPage
```

`ReaderLecture.layouts?: LayoutPage[]`; `LessonContentResult.layouts: Map<number, LayoutPage>` (only `isLayoutPage` rows; empty map when absent). `FEATURES.layoutFace`.

- [ ] Steps: failing test for `isLayoutPage` (accepts the contract example, rejects a missing `verdict`, a bbox of 3 numbers) → implement → PASS → `npx tsc --noEmit -p tsconfig.app.json` → commit `feat(layout): reader types and flag`.

### Task B2: Classify and render the layer

**Files:**
- Create: `src/features/spaces/components/reader/layout/classify.ts`
- Create: `src/features/spaces/components/reader/layout/LayoutLayer.tsx`
- Create: `src/features/spaces/components/reader/layout/layout.css` (imported by `LayoutLayer.tsx`)
- Test: `src/features/spaces/components/reader/layout/__tests__/classify.test.ts`, `__tests__/LayoutLayer.test.tsx`

**Interfaces:**
- Produces: `classify(b: LayoutBlock): 'h' | 'p' | 'l' | 'row' | 'math' | 'label' | 'table' | 'fig' | 'window' | 'deco'`; `<LayoutLayer page={LayoutPage} />` — renders `<div className="ls-layout" data-layout-page>` with `container-type: inline-size`, absolutely positioned blocks (`left/top/width/height` in %), `data-group` per block (as the template), an SVG ground with even-odd holes for figures and `window` blocks, and an SVG of `paths` (`viewBox 0 0 1000 1000`, `preserveAspectRatio="none"`, `vector-effect: non-scaling-stroke`).

`classify` ports the template's rules branch (`classify`, lines 323–344) without `BOXED`, `covered` and `v`: table → `table`; page-number text → `deco`; figure → `fig`; heading → `h`; ≥ 4 lines and height < 0.075 → `row`; `[∀∃⇒]` and < 90 chars and not starting `•` → `math`; `^[^•\s][^•]{0,24}:$` → `label`; list → `l`; else `p`. Any private-use character left → `window` (the pdf.js page shows through).

Rendering (port `layoutFace`, lines 362–421) as React nodes, never `innerHTML`: heading = first line + `<span class="sub">` rest; body = split on `\n?•\s*` into `<div class="li">` when bulleted; table = rows of CSS grid with `colW` fr columns; `row` = spans; `linked` adds the warm ink class. Colours come from the reader's theme tokens (the same ones `ReadingFace` uses); the warm ink is the reader's term colour. CSS ported from the template (`.blk …`, `.reink …` rules), renamed under `.ls-layout`.

- [ ] Steps: failing tests (classify table; a heading renders its first line; a figure block is a hole in the ground path, not a box with content; a block with `` becomes a window; no `dangerouslySetInnerHTML` in the file — assert with a source read) → implement → PASS → commit `feat(layout): the Layout layer`.

### Task B3: Fit and the browser checks

**Files:**
- Create: `src/features/spaces/components/reader/layout/fit.ts`
- Create: `src/features/spaces/components/reader/layout/layoutGate.ts`
- Modify: `LayoutLayer.tsx` (fit and check in `useLayoutEffect`, refit on `ResizeObserver` when width > 50 px)
- Test: `__tests__/fit.test.ts`, `__tests__/layoutGate.test.ts`

**Interfaces:**
- Produces: `RANGE` (template line 426); `ownSize(fits: (s: number) => boolean, lo: number, hi: number): number` (0 = cannot fit even at `lo * 0.8`; 8 halvings); `sharedSize(sizes: number[], lo: number, hi: number): number` (15th percentile of real sizes, clamped); `fitLayer(el: HTMLElement): void` (sets `font-size` in `cqw`, marks overflowing blocks `data-over`, which then render as windows); `collisions(lines: Array<[number, DOMRectLike]>): number`; `tinyBlocks(sizesCqw: number[]): number` (< 0.8); `struck(strokes: DOMRectLike[], lines: Array<[number, DOMRectLike]>): number`; `underWindow(windows: DOMRectLike[], lines: DOMRectLike[]): number`; `checkLayer(el: HTMLElement): { pass: boolean; reasons: string[] }`. `<LayoutLayer onChecked={(pass) => …} />`.

Port `fit` (lines 427–453) and the rendering-dependent parts of `gate` (collisions, tiny, strokes cross type, lines under a window for overflow windows, crop share including overflow windows; lines 582–633). Pure functions take plain rects so Vitest can test them without layout.

- [ ] Steps: failing tests (`ownSize` binary search returns the largest fitting size for `s <= 1.7`; `sharedSize` ignores one cramped outlier; `collisions` counts two overlapping lines of different blocks and ignores the same block; `tinyBlocks([0.7, 1])` is 1) → implement → PASS → commit `feat(layout): fit the layer and check it in the browser`.

### Task B4: The switch, the key and the morph on the Page face

**Files:**
- Create: `src/features/spaces/components/reader/layout/useLayoutFace.ts`
- Create: `src/features/spaces/components/reader/layout/LayoutSwitch.tsx`
- Modify: `src/features/spaces/screens/LessonFacesScreen.tsx` (overlay ~line 1485, tab row ~line 1382, key handler ~line 752)
- Modify: `src/i18n/locales/en/v4Reader.json`, `src/i18n/locales/de/v4Reader.json`
- Test: `__tests__/useLayoutFace.test.ts`, `__tests__/LayoutSwitch.test.tsx`

**Interfaces:**
- Produces: `useLayoutFace(layouts: Map<number, LayoutPage>, page: number) => { on: boolean; available: boolean; toggle(): void; markFailed(page: number): void }` — `on` remembered in `localStorage` key `ls-layout-face` (read/write in try/catch); `available` = flag on, page verdict `layout`, not failed in the browser. `<LayoutSwitch on available onToggle />` renders nothing when not available.

Wiring: only when `FEATURES.layoutFace && shape === 'slides' && view === 'slide'`. `overlay={<>{face.available && face.on && <LayoutLayer page={layouts.get(pdfPage)!} onChecked={(ok) => !ok && face.markFailed(pdfPage)} />}<Spotlight words={spot} /></>}`. The switch sits at the end of the view tab row (same chip style as the tabs, not a tab: `role="switch"`, `aria-checked`). Key `l`/`L` toggles when available (add next to the `f` handler; the digits stay the view keys). Morph: the layer enters with opacity 0 → 1 over 240 ms and each block with a 4 px rise, staggered 12 ms by reading order (cap 180 ms); composite properties only, no blur; `useReducedMotion()` → no animation. Strings: `layout.switch` ("Layout" / "Layout"), `layout.switchLabel` ("Show this page re-set" / "Zeig diese Seite neu gesetzt") — check `docs/V4_GLOSSARY.md`.

- [ ] Steps: failing tests (no switch when the flag is off, the verdict is `original`, or the page failed; toggling persists; reduced motion renders no transition) → implement → PASS → `npm run lint` (i18n parity) → commit `feat(layout): the Layout switch on the Page face`.

### Task B5: See it work, gates, PR

- [ ] **Step 1:** Local stack: backend `.env` with `FEATURE_LAYOUT_FACE=1`, frontend `VITE_FEATURE_LAYOUT_FACE=1` and `VITE_V4_DATA_MODE=live`; apply the migration to the **local/dev** database only. Upload `public/v4-mock/normalization.pdf`, open it in the reader (`preview_start` with `dev`, `backend-api`, `backend-worker`).
- [ ] **Step 2:** Check: the switch shows on passing pages; L toggles; zoom keeps type aligned; night mode readable; a failing page has no switch; console clean. Screenshot before/after for the PR.
- [ ] **Step 3:** All frontend gates. `git status`, `git log -1`, push, open PR B (base: PR A's branch, title `feat(layout): Layout face, reader (flag off)`), bind with ccd_pr.

## Rollout (Abi, after both PRs merge)

Apply `20261106120000_lecture_layouts.sql` by hand and verify with `pg_catalog`; deploy (frontend rebuild for the new build arg); set `FEATURE_LAYOUT_FACE=1`; `python -m backend.scripts.backfill_layouts --dry-run`, then for real; look at a few real lectures.
