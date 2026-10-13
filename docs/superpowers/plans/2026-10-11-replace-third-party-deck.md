# Replace the Third-Party Lecture Deck — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No copyrighted third-party teaching material ships in the public repository or on the public website. The v4 reader's demo Lesson runs on an original, openly licensed Normalization deck with the same shape, so the product and its tests keep working unchanged.

**Architecture:** One Python source module holds the original deck: 82 pages, each a title, lines and an optional display formula. A generator renders it to `public/v4-mock/normalization.pdf` (720×405 pt, the same geometry as today) with PyMuPDF, and writes `src/features/spaces/mocks/content.normalization.ts` from the same source. The PDF and its text therefore agree by construction. Page count, the concept page ranges and the six "tool" pages keep their topics, so `content.ts`, `explain.ts`, the anchors and 22 test files need no structural change. A guard test fails if the professor's name or deck reappear. Removing the old material from git *history* is a separate, optional runbook behind a decision.

**Tech Stack:** Python 3 + PyMuPDF (`fitz`, already a backend dependency via `backend/services/parser/poster.py`), TypeScript mocks, Vitest.

**Spec:** Abi, 2026-10-11: "secure the work … the professor's lecture PDF is in the public repo". The facts are recorded below.

## Decisions Abi must make before Task 1 (do not start without them)

| # | Question | Default if no answer |
|---|---|---|
| D1 | Do you have the author's **written** permission to publish *03 DBS Normalization* (Philipps-Universität Marburg) under a licence that allows a public repo and website? If yes, stop here: replace this plan with "add attribution + licence note", Task 6 only. | Replace the deck (this plan). |
| D2 | Purge the old PDF and its extracted text from **git history** too (Task 7: force-push every branch, every session re-clones, GitHub Support request for PR refs)? | No. Remove it from HEAD only, and tell the author it remains in history. |
| D3 | Remove `project_docs/GPU Server · Wiki · FB12 _ AG Papenbrock _ Wiki · GitLab.pdf` (an internal group wiki: GPU server hostname, IP 137.248.184.1, jump host; no passwords)? | Yes, from HEAD (Task 5). |
| D4 | The `lecture-pdfs` storage bucket is **public**: every uploaded lecture PDF is fetchable by URL. Make it private and serve signed URLs? | Out of scope here; record it as its own plan. |

## Facts this plan is built on (verified 2026-10-11)

- **What is on `main`:**
  - `public/v4-mock/normalization.pdf` (5.5 MB, the real deck, added in `c8529ce` via #75).
  - `src/features/spaces/mocks/content.normalization.ts`: 82 `Slide` rows of `pdftotext` output from that deck, including the author's name on page 1 and in footers.
  - `docs/READER_TWO_FACES_PHASE_B.md` and `scripts/check-vocabulary.mjs` reference the file.
- **Why it's urgent:** everything under `public/` is served by the website, so the deploy that ships #75 would put the PDF on learnstation.duckdns.org. Production is still behind `main`, so it isn't served yet. **This plan must land before that deploy.**
- **Not on `main` yet:**
  - `claude/studio-canvas-spec` adds `public/v4-mock/studio/normalization-p1..p12.webp` and a JSON fixture rendered from the same PDF (via `scripts/studio/build_fixture.py`). The Studio session must regenerate them from the new deck (Task 5).
  - `claude/two-faces-lesson-styling-1da325` is a local dev branch with the same files.
- **Structure the rest of the code relies on:**
  - 82 pages.
  - Concept ranges in `src/features/spaces/mocks/content.ts`:

    | Idea | Pages |
    |---|---|
    | Functional dependency | 4–29 |
    | BCNF | 41–60 and 74–75 |
    | 1NF | 67–69 |
    | 2NF | 70–71 |
    | 3NF | 72–73 |

  - The lesson overview groups the ideas as FD 1–40, BCNF 41–66, 1NF 67–69, 2NF 70–71, 3NF 72–82.
  - Tool pages in `src/features/spaces/mocks/explain.ts`:

    | Page | Topic | Tool |
    |---|---|---|
    | 2 | Where normalization sits in design | explore |
    | 5 | One wide table repeats itself | compare |
    | 6 | FD definition | fdTable |
    | 9 | Armstrong's axioms | steps |
    | 33 | Attribute closure | closure |
    | 46 | BCNF | bcnf |

  - Pages 6, 46, 67, 70 and 72 open with prose **we** wrote (shared with `mocks/lessons.ts`). Pages 6 and 46 end with a display formula.
- **Tests:** no test asserts any literal deck sentence. The only shared string is the title "Normalization", which stays.

## Global Constraints

- **Every word of the new deck is original.** Do not paraphrase the old deck page by page; write each page from the outline topic below. No author names, university names or logos.
- The deck carries the licence line **"Learnstation sample deck · CC BY 4.0"** on page 1 and on page 82.
- Geometry: 720×405 pt pages, 82 pages. Monochrome (black text on off-white `#f7f7f4`), matching the landing page's authored slide.
- The v4 vocabulary rule applies to UI copy, not to slide content: deck pages may say "lecture" (it's material, not UI). `node scripts/check-vocabulary.mjs` must stay at its current count or lower.
- Gates: `npx tsc -p tsconfig.app.json --noEmit`, `npx vitest run src/features/spaces`, `node scripts/check-vocabulary.mjs`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File structure

| File | Responsibility |
|---|---|
| `scripts/v4-mock/normalization_deck.py` (create) | The deck itself: `PAGES`, a list of 82 dicts (`title`, `lines`, optional `formula`). Content only. |
| `scripts/v4-mock/build_normalization_deck.py` (create) | Renders `PAGES` to the PDF and writes the TS fixture. No content. |
| `scripts/v4-mock/test_build_normalization_deck.py` (create) | Generator tests (pytest). |
| `public/v4-mock/normalization.pdf` (replace) | Generated. |
| `src/features/spaces/mocks/content.normalization.ts` (replace) | Generated. |
| `src/features/spaces/mocks/__tests__/thirdParty.test.ts` (create) | Guard: no third-party deck or author in the v4 mocks or `public/`. |
| `docs/READER_TWO_FACES_PHASE_B.md` (modify) | Point to the new source. |
| `project_docs/GPU Server … .pdf` (delete, if D3) | |
| `docs/runbooks/purge-third-party-deck-history.md` (create, if D2) | |

## The deck outline (page → topic). Write 2–5 lines per page in your own words.

| Pages | Topic per page |
|---|---|
| 1 | Title: "Normalization", subtitle "Learnstation sample deck · CC BY 4.0" |
| 2 | Where normalization sits: requirements → conceptual model (ER) → relations → *normalization refines them* → physical design |
| 3 | What this Lesson covers: functional dependencies · closure · BCNF · the normal forms |
| 4 | From an ER model to relations: the translation is correct but can still store one fact many times |
| 5 | One wide table: `Orders(OrderId, Customer, City)`; each customer's city repeats on every order |
| 6 | **Definition of an FD.** Keep today's opening prose (ours) verbatim, then a short formal line, then the display formula `X \to A \iff \forall t_1,t_2: t_1[X]=t_2[X] \Rightarrow t_1[A]=t_2[A]` |
| 7 | Example: `Track(Title, Album, Year)` with `Album → Year`, shown on four rows |
| 8 | Splitting and combining apply to the right-hand side only, with one counterexample for the left |
| 9 | Armstrong's axioms: reflexivity, augmentation, transitivity. They are sound and complete |
| 10 | Reflexivity and augmentation, each with a two-row argument |
| 11 | Transitivity: proof from the definition |
| 12 | Derived rules: union, decomposition, pseudotransitivity, each derived from the axioms |
| 13 | Trivial dependencies (`A,B → A`) always hold; fully non-trivial = disjoint sides |
| 14 | Minimal dependencies: no attribute can be dropped from the left |
| 15 | Where FDs are used: schema design, query optimisation, data cleaning, integration |
| 16–18 | Worked example in three steps on `Loans(Member, Book, Title, DueDate)`: state the FDs, spot the repetition, propose the split |
| 19–20 | FDs describe the schema, not the sample: a sample can refute an FD but never prove one (two pages, two examples) |
| 21 | Where FDs come from: domain knowledge, documentation, conversations with the people who use the data |
| 22 | FDs as integrity constraints the database can enforce |
| 23 | Finding candidate FDs in data (profiling); candidates still need a person to confirm |
| 24 | Keys through FDs: X is a superkey iff X → every attribute |
| 25 | Superkey, candidate key, primary key: the terms, side by side |
| 26 | Finding candidate keys: an attribute that never appears on a right-hand side is in every key |
| 27 | Redundancy caused by a non-key determinant |
| 28 | Update, insert and delete anomalies, one small table each |
| 29 | Redundancy is the symptom; decomposition is the cure |
| 30 | Section divider: "Closure" (same layout as 3, with Closure highlighted) |
| 31 | Sets of FDs and when two sets are equivalent |
| 32 | Covers and minimal covers |
| 33 | **Attribute closure X⁺**: everything X decides; a definition and a one-line example |
| 34 | The closure algorithm, as numbered steps |
| 35 | Closure: worked example with four FDs |
| 36 | Why the algorithm stops and is correct |
| 37 | Membership: does F imply X → A? Compute X⁺ and look |
| 38 | Which FDs hold after projecting onto fewer attributes |
| 39 | Projection: a worked example |
| 40 | Section divider: "BCNF" |
| 41 | Redundancy stated precisely |
| 42 | Decomposition: replacing one relation by projections |
| 43 | Lossless decomposition: the shared attributes are a key of one side |
| 44 | Lossless: an example |
| 45 | Lossy: an example that produces spurious rows on join |
| 46 | **BCNF.** Keep today's opening prose (ours) verbatim, then the display formula `\forall X \to A \in F^{+}: A \in X \lor X \text{ is a superkey}` |
| 47 | The BCNF decomposition algorithm, as numbered steps |
| 48–52 | The BCNF algorithm, worked on one relation in five steps (one split per page) |
| 53 | BCNF on instance data: before and after |
| 54–55 | Recovering the original by joining (two pages) |
| 56 | When a key disappears: BCNF can lose dependency preservation |
| 57 | Decomposition and ER modelling: the split often reveals a missing entity |
| 58–59 | Every two-attribute relation is in BCNF (proof, then example) |
| 60–64 | Normalizing from data: profile → candidate FDs → choose a key → split → check (one step per page) |
| 65 | What automation can and cannot decide (semantics stays human) |
| 66 | Section divider: "The normal forms" |
| 67 | **Normal forms at a glance.** Keep today's opening prose (ours) verbatim |
| 68 | 1NF: atomic values |
| 69 | 1NF: an example |
| 70 | **2NF.** Keep today's opening prose (ours) verbatim |
| 71 | 2NF: normalizing an example |
| 72 | **3NF.** Keep today's opening prose (ours) verbatim |
| 73 | The 3NF synthesis algorithm |
| 74 | BCNF revisited |
| 75 | 3NF vs. BCNF: when they differ, with the classic overlapping-keys case |
| 76 | 4NF |
| 77 | Multivalued dependencies |
| 78 | Normal forms at a glance: a summary table |
| 79 | Section divider: "Wrap-up" |
| 80 | Where normalization sits (recap of page 2) |
| 81 | Summary: five bullets |
| 82 | End: "Learnstation sample deck · CC BY 4.0 · written for this product" |

---

### Task 1: Generator and tests (with a 3-page stub deck)

**Files:**
- Create: `scripts/v4-mock/build_normalization_deck.py`
- Create: `scripts/v4-mock/normalization_deck.py` (start with only pages 1–3, to drive the tests)
- Create: `scripts/v4-mock/test_build_normalization_deck.py`

**Interfaces:**
- Produces: `PAGES: list[dict]` (keys `title: str`, `lines: list[str]`, optional `formula: str`), `render_pdf(pages, path) -> None`, `render_ts(pages) -> str`, and the CLI `python scripts/v4-mock/build_normalization_deck.py` (writes both artefacts, prints the page count).

- [ ] **Step 1: Write the failing generator tests**

```python
# scripts/v4-mock/test_build_normalization_deck.py
"""The deck's PDF and its text fixture come from one source and must agree."""
import importlib.util
import pathlib

import fitz  # PyMuPDF

HERE = pathlib.Path(__file__).parent


def _load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


build = _load("build_normalization_deck")
deck = _load("normalization_deck")


def test_pdf_has_one_page_per_entry_at_slide_geometry(tmp_path):
    out = tmp_path / "d.pdf"
    build.render_pdf(deck.PAGES, out)
    doc = fitz.open(out)
    assert len(doc) == len(deck.PAGES)
    assert (round(doc[0].rect.width), round(doc[0].rect.height)) == (720, 405)


def test_pdf_text_layer_matches_the_source(tmp_path):
    out = tmp_path / "d.pdf"
    build.render_pdf(deck.PAGES, out)
    doc = fitz.open(out)
    for i, page in enumerate(deck.PAGES):
        assert page["title"] in doc[i].get_text(), f"page {i + 1} title missing from the PDF"


def test_ts_fixture_rows_mirror_the_source():
    ts = build.render_ts(deck.PAGES)
    assert ts.count("slide_number:") == len(deck.PAGES)
    assert "sl-l-s-dbs-4-1" in ts and "summary: null" in ts
    assert "export const normalizationSlides: Slide[]" in ts


def test_licence_line_is_on_the_title_page():
    assert "CC BY 4.0" in " ".join(deck.PAGES[0]["lines"])
```

- [ ] **Step 2: Run them to verify they fail**

Run: `.venv/bin/python -m pytest scripts/v4-mock/test_build_normalization_deck.py -q`
Expected: FAIL (the modules don't exist).

- [ ] **Step 3: Write the stub deck (pages 1–3 only for now)**

```python
# scripts/v4-mock/normalization_deck.py
"""Normalization — an original sample deck for Learnstation's v4 demo Lesson.

Learnstation sample deck · CC BY 4.0. Every page is written for this product;
see docs/superpowers/plans/2026-10-11-replace-third-party-deck.md for the
outline. Pages 6, 46, 67, 70 and 72 open with the same prose as
src/features/spaces/mocks/lessons.ts so the two fixtures tell one story.
"""

PAGES: list[dict] = [
    {"title": "Normalization", "lines": ["Learnstation sample deck · CC BY 4.0"]},
    {
        "title": "Where normalization sits in the design process",
        "lines": [
            "Requirements: what the data must describe",
            "Conceptual model: entities and relationships",
            "Relations: tables translated from the model",
            "Normalization: refine the tables so each fact lives once",
            "Physical design: indexes, storage, tuning",
        ],
    },
    {
        "title": "What this Lesson covers",
        "lines": ["Functional dependencies", "Closure", "Boyce–Codd normal form", "The normal forms"],
    },
]
```

- [ ] **Step 4: Write the generator**

```python
# scripts/v4-mock/build_normalization_deck.py
"""Render scripts/v4-mock/normalization_deck.py to the demo PDF and its fixture.

    .venv/bin/python scripts/v4-mock/build_normalization_deck.py

Writes public/v4-mock/normalization.pdf and
src/features/spaces/mocks/content.normalization.ts. Never edit those by hand.
"""
from __future__ import annotations

import importlib.util
import json
import pathlib

import fitz  # PyMuPDF

ROOT = pathlib.Path(__file__).resolve().parents[2]
W, H = 720, 405
PAPER = (0.969, 0.969, 0.957)   # #f7f7f4
INK = (0.11, 0.11, 0.11)
BAR = (0.12, 0.23, 0.30)        # #1f3b4d, as on the landing page's authored slide


def render_pdf(pages: list[dict], path) -> None:
    doc = fitz.open()
    for i, p in enumerate(pages, start=1):
        pg = doc.new_page(width=W, height=H)
        pg.draw_rect(pg.rect, color=None, fill=PAPER)
        pg.draw_rect(fitz.Rect(0, 0, W, 22), color=None, fill=BAR)
        pg.insert_textbox(fitz.Rect(40, 40, W - 40, 80), p["title"], fontsize=22, fontname="hebo", color=INK)
        body = "\n".join(f"•  {ln}" for ln in p.get("lines", []))
        if p.get("formula"):
            body += f"\n\n{p['formula']}"
        pg.insert_textbox(fitz.Rect(48, 92, W - 48, H - 40), body, fontsize=13, fontname="helv", color=INK)
        pg.insert_text((W - 120, H - 18), f"Learnstation · {i}", fontsize=8, color=(0.45, 0.45, 0.45))
    doc.save(path, deflate=True, garbage=4)


def _content(p: dict) -> str:
    text = "\n".join(f"- {ln}" for ln in p.get("lines", []))
    if p.get("formula"):
        text += f"\n\n$$\n{p['formula']}\n$$"
    return text


def render_ts(pages: list[dict]) -> str:
    rows = [
        f"  {{ id: 'sl-l-s-dbs-4-{i}', slide_number: {i}, title: {json.dumps(p['title'], ensure_ascii=False)}, "
        f"content_text: {json.dumps(_content(p), ensure_ascii=False)}, summary: null }},"
        for i, p in enumerate(pages, start=1)
    ]
    return (
        "import type { Slide } from '@/types/domain';\n\n"
        "/**\n"
        " * The Normalization Material, page by page — `slides` rows as\n"
        " * `GET /api/v1/localized-content/lectures/{id}` returns them.\n"
        " *\n"
        " * GENERATED by scripts/v4-mock/build_normalization_deck.py from\n"
        " * scripts/v4-mock/normalization_deck.py (Learnstation sample deck,\n"
        " * CC BY 4.0). Do not edit by hand. `summary` is null throughout: the\n"
        " * reading face renders `content_text`.\n"
        " */\n"
        "export const normalizationSlides: Slide[] = [\n" + "\n".join(rows) + "\n];\n"
    )


def _deck():
    spec = importlib.util.spec_from_file_location("deck", pathlib.Path(__file__).with_name("normalization_deck.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.PAGES


if __name__ == "__main__":
    pages = _deck()
    render_pdf(pages, ROOT / "public/v4-mock/normalization.pdf")
    (ROOT / "src/features/spaces/mocks/content.normalization.ts").write_text(render_ts(pages))
    print(f"wrote {len(pages)} pages")
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest scripts/v4-mock/test_build_normalization_deck.py -q`
Expected: 4 passed.

- [ ] **Step 6: Commit (generator only; don't run the CLI yet)**

```bash
git add scripts/v4-mock/
git commit -m "feat(v4-mock): generator for an original Normalization sample deck"
```

---

### Task 2: Write the deck (82 original pages)

**Files:**
- Modify: `scripts/v4-mock/normalization_deck.py`
- Modify: `scripts/v4-mock/test_build_normalization_deck.py` (add the shape test)

**Interfaces:**
- Consumes: the outline above.
- Produces: `PAGES` with exactly 82 entries; pages 6 and 46 carry `formula`.

- [ ] **Step 1: Add the failing shape test**

```python
# append to scripts/v4-mock/test_build_normalization_deck.py
TOOL_PAGES = {2: "design", 5: "table", 6: "functional dependency", 9: "axiom",
              33: "closure", 46: "bcnf"}


def test_deck_keeps_the_shape_the_product_relies_on():
    assert len(deck.PAGES) == 82
    assert deck.PAGES[5].get("formula") and deck.PAGES[45].get("formula")
    for page, word in TOOL_PAGES.items():
        p = deck.PAGES[page - 1]
        blob = (p["title"] + " " + " ".join(p["lines"])).lower()
        assert word in blob, f"page {page} must stay about '{word}' (explain.ts tool page)"
    assert "CC BY 4.0" in " ".join(deck.PAGES[81]["lines"])


def test_no_third_party_names():
    import json
    text = json.dumps(deck.PAGES, ensure_ascii=False).lower()
    for banned in ("papenbrock", "marburg", "philipps", "hasso", "potsdam"):
        assert banned not in text
```

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv/bin/python -m pytest scripts/v4-mock/test_build_normalization_deck.py -q`
Expected: FAIL (`len == 3`).

- [ ] **Step 3: Write pages 4–82 from the outline**

Write each page from its outline row, in your own words, with 2–5 lines. For pages 6, 46, 67, 70 and 72, copy the opening paragraph *we* wrote. Run `git show origin/main:src/features/spaces/mocks/content.normalization.ts`, take the prose that opens each of those five pages (it's ours; it matches `mocks/lessons.ts`), and stop before the first line that came from the original deck. Use the formulas from the outline for pages 6 and 46. Section dividers (30, 40, 66, 79) repeat page 3's four lines, with the section's own line prefixed by `▸ `.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest scripts/v4-mock/test_build_normalization_deck.py -q`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/v4-mock/normalization_deck.py scripts/v4-mock/test_build_normalization_deck.py
git commit -m "feat(v4-mock): write the 82-page original Normalization deck"
```

---

### Task 3: Swap the artefacts and prove the product still works

**Files:**
- Replace: `public/v4-mock/normalization.pdf`, `src/features/spaces/mocks/content.normalization.ts` (both generated)
- Create: `src/features/spaces/mocks/__tests__/thirdParty.test.ts`

- [ ] **Step 1: Write the failing guard test**

```ts
// src/features/spaces/mocks/__tests__/thirdParty.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizationSlides } from '../content.normalization';

/**
 * The demo Lesson ships with the public website, so it must be material we
 * may publish: the original sample deck, never a professor's slides
 * (2026-10-11, docs/superpowers/plans/2026-10-11-replace-third-party-deck.md).
 */
const BANNED = /papenbrock|philipps|marburg|hasso|potsdam/i;

describe('the demo deck is ours to publish', () => {
  it('names no third-party author or institution', () => {
    for (const s of normalizationSlides) {
      expect(`${s.title} ${s.content_text}`, `page ${s.slide_number}`).not.toMatch(BANNED);
    }
  });

  it('carries its licence on the first and last page', () => {
    expect(normalizationSlides[0].content_text).toContain('CC BY 4.0');
    expect(normalizationSlides[81].content_text).toContain('CC BY 4.0');
  });

  it('is generated, not hand-edited', () => {
    const src = readFileSync(join(process.cwd(), 'src/features/spaces/mocks/content.normalization.ts'), 'utf8');
    expect(src).toContain('GENERATED by scripts/v4-mock/build_normalization_deck.py');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/spaces/mocks/__tests__/thirdParty.test.ts`
Expected: FAIL (page 1 names the author).

- [ ] **Step 3: Generate the artefacts**

Run: `.venv/bin/python scripts/v4-mock/build_normalization_deck.py`
Expected: `wrote 82 pages`. Check with `ls -la public/v4-mock/normalization.pdf`: well under 5.5 MB (text only, typically under 200 KB).

- [ ] **Step 4: Run the guard, the spaces suite and the type check**

Run: `npx vitest run src/features/spaces/mocks/__tests__/thirdParty.test.ts && npx vitest run src/features/spaces && npx tsc -p tsconfig.app.json --noEmit && node scripts/check-vocabulary.mjs | tail -1`
Expected:
- The guard passes (3).
- The spaces suite matches its pre-swap total (702 at the time of writing). `lessonFaces` may time out under heavy machine load; re-run it alone.
- `tsc` is clean, and the vocabulary count is no higher than before.
- If a test fails on a page-specific string, change the test to read the value from `normalizationSlides`, not a new literal.

- [ ] **Step 5: Look at it in the reader**

Start the dev server (`dev-align` in `.claude/launch.json`) and open `/v4/space/s-dbs/lesson/l-s-dbs-4/faces?page=6`.
Expected:
- The page shows the new deck: title, bullets, and the formula on page 6.
- The Text view shows the same words.
- Turning to pages 33 and 46 shows the closure and BCNF pages with their Explain tools.

- [ ] **Step 6: Commit**

```bash
git add public/v4-mock/normalization.pdf src/features/spaces/mocks/content.normalization.ts src/features/spaces/mocks/__tests__/thirdParty.test.ts
git commit -m "fix(v4-mock): the demo Lesson runs on our own CC BY deck, not a professor's slides"
```

---

### Task 4: Docs and vocabulary checker

**Files:**
- Modify: `docs/READER_TWO_FACES_PHASE_B.md` (the sentences naming `~/Downloads/03 DBS Normalization.pdf` → "the Learnstation sample deck, generated by `scripts/v4-mock/build_normalization_deck.py`")
- Modify: `scripts/check-vocabulary.mjs:104` only if the generated file's comment now trips a rule; otherwise leave it

- [ ] **Step 1: Update the doc and re-run the checker**

Run: `node scripts/check-vocabulary.mjs | tail -1`
Expected: same count or lower than before Task 3.

- [ ] **Step 2: Commit**

```bash
git add docs/READER_TWO_FACES_PHASE_B.md scripts/check-vocabulary.mjs
git commit -m "docs: the reader's demo deck is generated from our own source"
```

---

### Task 5: Other copies (other sessions' branches, and the wiki PDF if D3)

**Files:**
- Delete (if D3): `project_docs/GPU Server · Wiki · FB12 _ AG Papenbrock _ Wiki · GitLab.pdf`

- [ ] **Step 1: Remove the wiki PDF (only if Abi chose D3)**

```bash
git rm "project_docs/GPU Server · Wiki · FB12 _ AG Papenbrock _ Wiki · GitLab.pdf"
git commit -m "chore: remove an internal university wiki export from the public repo"
```

- [ ] **Step 2: Tell the owning sessions**

Send the Studio session (branch `claude/studio-canvas-spec`) this message:
"After the deck-replacement PR merges, rerun `scripts/studio/build_fixture.py` against the new `public/v4-mock/normalization.pdf`. That regenerates `public/v4-mock/studio/normalization-p*.webp` and the JSON fixture. Commit the result; the old renders are the professor's slides."

Send the reader session the same note for `claude/two-faces-lesson-styling-1da325`, or tell it that branch can be archived.

- [ ] **Step 3: Before any deploy, verify nothing of the old deck is in HEAD**

Run: `git grep -nIi "papenbrock" -- src public scripts | grep -v academic || echo clean`
Expected: `clean`. Matches in `backend/services/academic/*` and the Marburg catalog migrations are the public university catalog, not the deck, and stay.

---

### Task 6: If D1 = permission granted (replaces Tasks 1–5)

- [ ] Add `public/v4-mock/NOTICE.md` naming the author, the deck, the licence granted and the date.
- [ ] Add a one-line attribution to the end of `content.normalization.ts`'s header comment.
- [ ] Commit with the permission's date in the message.

---

### Task 7: History purge runbook (only if D2 = yes)

**Files:**
- Create: `docs/runbooks/purge-third-party-deck-history.md`

- [ ] **Step 1: Write the runbook exactly as below, and execute it only with Abi present**

```markdown
# Purge the third-party deck from git history

Destructive: rewrites every commit since 2026-10-10 on every branch.
Preconditions:
- Every Claude session has stopped and pushed (check them with ListAgents).
- Every open PR is merged or noted.
- Abi confirms in chat.

1. Fresh mirror:
   git clone --mirror git@github.com:osamash0/ascend-academy.git /tmp/purge.git
2. Tool: .venv/bin/pip install git-filter-repo
3. Rewrite. Drop the PDF and the studio renders everywhere. Replace the
   old text fixture's history with the current (original) file:
   cd /tmp/purge.git
   git filter-repo --invert-paths \
     --path public/v4-mock/normalization.pdf \
     --path-glob 'public/v4-mock/studio/normalization-p*.webp' \
     --path "project_docs/GPU Server · Wiki · FB12 _ AG Papenbrock _ Wiki · GitLab.pdf"
   (content.normalization.ts keeps its history; its old versions contain
   the author's text. To drop those as well, add
   --path src/features/spaces/mocks/content.normalization.ts and re-add the
   generated file in a new commit after the push.)
4. Push: git push --force --mirror origin
5. GitHub keeps PR refs (refs/pull/*) and cached views. Open a GitHub
   Support request ("remove sensitive data: cached views and PR refs") with
   the list of affected PRs (#75 and later).
6. Every local clone and worktree: delete it and re-clone. Never merge an
   old clone back in: that resurrects the files.
```

- [ ] **Step 2: Commit the runbook (do not run it as part of this plan)**

```bash
git add docs/runbooks/purge-third-party-deck-history.md
git commit -m "docs: runbook to purge the third-party deck from history"
```

## Self-review

- **Spec coverage:**
  - Professor's PDF in the public repo → Tasks 1–3 (HEAD) and Task 7 (history, if chosen).
  - Its extracted text → Task 3.
  - The website would serve it → Task 3 replaces the file under `public/` before any deploy.
  - Copies on other branches → Task 5.
  - The wiki export → D3 and Task 5.
- **Shape preserved:**
  - 82 pages, concept ranges and tool pages are asserted in Task 2.
  - Our own prose on the five definition pages is reused.
  - No test asserted deck sentences (verified), so the swap is low-churn.
- **Types:** `PAGES`, `render_pdf` and `render_ts` match across Tasks 1–3. The fixture keeps exporting `normalizationSlides: Slide[]` with the same ids (`sl-l-s-dbs-4-{n}`).
- **Not covered here:** D4 (the public `lecture-pdfs` bucket) needs its own plan.
