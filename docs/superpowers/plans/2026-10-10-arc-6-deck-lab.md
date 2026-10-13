> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Parent plan: docs/superpowers/plans/2026-10-10-ai-backend-deep-session.md (its Global Constraints bind every task here). Execute AFTER Arc 5.

# Arc 6: Deck Lab scorecard, TDD implementation plan

Everything this plan calls exists in the worktree, and I checked that. I hand-checked every expected number in the synthetic tests by running the real `deck_plan` and `quiz_grounding` code in memory, with no file writes. I also checked the 16 probe pairs against the real slides for the "no three-word copy" rule. I did **not** score them with `assess_grounding`, so the set is not fitted to the scorer.

## Findings that shape the plan

1. **The old selectors only exist in git history (commit f34a787).** They were:
   - quiz: `content_slides = [s for s in slides if len(s) > 50][:10]` on raw page text
   - meta: `enumerate(slides[:15])`

   Task 3 re-implements both in the eval module as named reference functions that return indices.
2. **The new meta selection is written inline in `synthesis.py` (lines 74–76) and nowhere else.** If the eval copied it, the copy could drift. Task 2 moves it into `deck_plan.select_meta_slides(skeleton, budget=15)` and makes `synthesis.py` call it. The eval then measures the exact code production runs.
3. **The per-slide prompt saving is not shipped today.** `unified_orchestrator.py` (~line 739, `text_items = [(i, raw_slides[i]) ...]`) still sends the raw, unstripped slide to per-slide synthesis. Only the meta and quiz prompts use the stripped text. So the scorecard has to call that number an *implied* saving. The render text says this. Wiring the stripped text into per-slide synthesis is a separate follow-up.
4. **`real_deck_pages` currently lives in a test module, and a second test imports it from there.** It is in `test_deck_plan_real_decks.py`, and `test_quiz_grounding_real_decks.py:23` imports it. Task 1 moves it to `backend/eval/decks.py` and updates both tests.
5. **Deck discovery in `~/Downloads` finds 25 decks.**
   - 11 DBS decks: 00 Einfuehrung, 00 Introduction, and 01 through 09.
   - 14 SR decks. "02 … Kopie" is skipped, and so are the four `-2` copies.
   - The real run should report `Total (25 decks)`.
6. **The probe uses two decks other than the calibration decks.** The calibration used 00 DBS Introduction and 03 SR Prozesse. The probe uses `07 DBS Transactions.pdf` (79 pages) and `05__SR_Speicherverwaltung_v02_06.05.2026.pdf` (52 pages, 3 sections).
7. **Probe questions pass the answer as text, not an index.** `_normalize_answer_index` folds 1-based integers down to 0-based. So `correctAnswer` is the option string, the same as in the calibration tests.

Shared settings for every task:
- Python: `PY=/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python`
- Run all commands from the worktree root.
- Tests run with `-m "not db"`.

---

## Task 1: Shared real-deck loader (`backend/eval/decks.py`) and synthetic deck fixtures

**Files**
- Create: `backend/eval/decks.py`
- Create: `backend/tests/support/deck_lab_decks.py` (test fixture data, not collected by pytest)
- Create: `backend/tests/unit/test_eval_decks.py`
- Modify: `backend/tests/unit/test_deck_plan_real_decks.py`
- Modify: `backend/tests/unit/test_quiz_grounding_real_decks.py`

**Interfaces**
- Consumes: `fitz` (PyMuPDF 1.27.1)
- Produces:
  - `DECK_DIR: Path`
  - `is_lecture_deck(name: str) -> bool`
  - `discover_decks(deck_dir: Path | None = None) -> list[str]`
  - `load_pdf_pages(path: Path) -> list[str]`
  - `real_deck_pages(name: str, deck_dir: Path | None = None) -> list[str] | None`
  - Fixtures: `FOOTER`, `content_page(word) -> str`, `LONG_DECK: list[str]`, `SHORT_DECK: list[str]`, `write_pdf(path: Path, pages: list[str]) -> None`

**Step 1: write the fixture module and the failing test**

`backend/tests/support/deck_lab_decks.py`:
```python
"""Synthetic decks with hand-checked Deck Lab answers.

Rules the fixtures obey (see deck_plan.py):
  - lines differ by LETTERS, never only by digits (normalize_line folds digit
    runs to '#', so "Point 3" and "Point 7" would be one boilerplate line);
  - every deck has >= 4 pages, so boilerplate detection runs;
  - FOOTER is on every page (>= 60%), so it is stripped as boilerplate.

LONG_DECK (18 pages): title, agenda, 10 content, agenda, 5 content.
Two agendas -> three sections: 0 = [0], 1 = [1..11], 2 = [12..17].
Eligible quiz sections: {1, 2}.
  legacy quiz  [2..11]                          -> covers 1/2, span 9/18 = 0.50
  new quiz     [2,4,6,8,10,13,14,15,16,17]      -> covers 2/2, span 15/18 = 0.83
  legacy meta  [0..14]                          -> 15/18 seen, last page 15
  new meta     [0,1,2,3,5,6,7,9,10,12..17]      -> 15/18 seen, last page 18
  boilerplate  3 footer tokens x 18 pages = 54 removed, 3.0 per slide

SHORT_DECK (4 pages): title + 3 content, one section.
  legacy = new quiz [1,2,3] -> 1/1, span 2/4 = 0.50
  legacy = new meta [0..3]  -> 4/4 seen, last page 4
  boilerplate 3 x 4 = 12 removed
"""
from __future__ import annotations

from pathlib import Path

FOOTER = "Course Footer Line"
_WORDS = (
    "alpha bravo charlie delta echo foxtrot golf hotel india juliet "
    "kilo lima mike november oscar papa quebec romeo"
).split()
_AGENDA = f"Agenda\nPart one\nPart two\n{FOOTER}"


def content_page(word: str) -> str:
    return f"Heading {word}\nThis slide explains the {word} concept in enough words to pass.\n{FOOTER}"


LONG_DECK: list[str] = (
    [f"Lecture Title Alpha\n{FOOTER}", _AGENDA]
    + [content_page(w) for w in _WORDS[:10]]
    + [_AGENDA]
    + [content_page(w) for w in _WORDS[10:15]]
)
SHORT_DECK: list[str] = [f"Lecture Title Bravo\n{FOOTER}"] + [content_page(w) for w in _WORDS[15:18]]


def write_pdf(path: Path, pages: list[str]) -> None:
    """Tiny real PDF, one text block per page (PyMuPDF; no network)."""
    import fitz

    doc = fitz.open()
    for text in pages:
        doc.new_page().insert_text((72, 72), text, fontsize=9)
    doc.save(path)
    doc.close()
```

`backend/tests/unit/test_eval_decks.py`:
```python
import pytest

from backend.eval import decks
from backend.eval.decks import discover_decks, is_lecture_deck, load_pdf_pages, real_deck_pages
from backend.tests.support.deck_lab_decks import write_pdf


@pytest.mark.parametrize("name", [
    "00 DBS Introduction.pdf",
    "09 DBS Index Structures.pdf",
    " 03__SR_Prozesse_v07_27.04.2025.pdf",
    "14__SR_Internet_v02_16.06.2026.pdf",
])
def test_lecture_deck_names_are_recognised(name):
    assert is_lecture_deck(name)


@pytest.mark.parametrize("name", [
    "09 DBS Index Structures-2.pdf",
    " 03__SR_Prozesse_v07_27.04.2025-2.pdf",
    "02__SR_Aufgaben_BS_v01_20.04.2025 Kopie.pdf",
    "00 DBS Introduction.pptx",
    "DBS26_Uebung1.pdf",
    "notes.pdf",
])
def test_duplicates_and_non_decks_are_skipped(name):
    assert not is_lecture_deck(name)


def test_discover_decks_lists_only_lecture_decks_sorted(tmp_path):
    for name in ["01 DBS Basics.pdf", " 03__SR_Prozesse_v07_27.04.2025.pdf",
                 "01 DBS Basics-2.pdf", "notes.pdf", "00 DBS Introduction.pdf"]:
        (tmp_path / name).write_bytes(b"")
    assert discover_decks(tmp_path) == [
        "00 DBS Introduction.pdf", "01 DBS Basics.pdf", " 03__SR_Prozesse_v07_27.04.2025.pdf",
    ]


def test_discover_decks_on_missing_dir_is_empty(tmp_path):
    assert discover_decks(tmp_path / "absent") == []


def test_real_deck_pages_reads_page_text(tmp_path):
    write_pdf(tmp_path / "00 DBS Mini.pdf", ["Heading alpha", "Heading bravo"])
    pages = real_deck_pages("00 DBS Mini.pdf", tmp_path)
    assert [p.strip() for p in pages] == ["Heading alpha", "Heading bravo"]
    assert load_pdf_pages(tmp_path / "00 DBS Mini.pdf") == pages


def test_real_deck_pages_is_none_when_absent(tmp_path):
    assert real_deck_pages("00 DBS Missing.pdf", tmp_path) is None


def test_default_dir_is_read_at_call_time(tmp_path, monkeypatch):
    write_pdf(tmp_path / "00 DBS Mini.pdf", ["Heading alpha"])
    monkeypatch.setattr(decks, "DECK_DIR", tmp_path)
    assert real_deck_pages("00 DBS Mini.pdf") is not None
```

**Step 2: run it and see it fail**

`$PY -m pytest backend/tests/unit/test_eval_decks.py -m "not db" -q`

Expected: a collection error, `ModuleNotFoundError: No module named 'backend.eval.decks'`.

**Step 3: minimal implementation**

`backend/eval/decks.py`:
```python
"""Real lecture decks on disk, for the offline Deck Lab and the real-deck
characterization tests. No network and no LLM: it only reads PDFs.

Two series live in ~/Downloads (override with $DECK_LAB_DIR):
  "00 DBS Introduction.pdf"                  English DBS series
  " 03__SR_Prozesse_v07_27.04.2025.pdf"      German SR series
Some SR names start with a space; that space is part of the real name.
Copies the OS made on re-download ("...-2.pdf", "... Kopie.pdf") are
skipped so no deck is counted twice.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

DECK_DIR = Path(os.environ.get("DECK_LAB_DIR", Path.home() / "Downloads"))

_DECK_NAME = re.compile(r"^\s*\d{2}(?: DBS |__SR_).+\.pdf$")
_DUPLICATE_MARKERS = ("-2", "Kopie")


def is_lecture_deck(name: str) -> bool:
    return bool(_DECK_NAME.match(name)) and not any(m in name for m in _DUPLICATE_MARKERS)


def discover_decks(deck_dir: Path | None = None) -> list[str]:
    """Lecture-deck file names in ``deck_dir``, ordered by name ignoring the
    leading space some SR files carry."""
    root = deck_dir if deck_dir is not None else DECK_DIR
    if not root.is_dir():
        return []
    names = [p.name for p in root.iterdir() if p.is_file() and is_lecture_deck(p.name)]
    return sorted(names, key=lambda n: n.strip())


def load_pdf_pages(path: Path) -> list[str]:
    import fitz  # PyMuPDF; lazy so importing this module stays cheap

    with fitz.open(path) as doc:
        return [page.get_text("text") for page in doc]


def real_deck_pages(name: str, deck_dir: Path | None = None) -> list[str] | None:
    path = (deck_dir if deck_dir is not None else DECK_DIR) / name
    if not path.exists():
        return None
    return load_pdf_pages(path)
```

Then point the two real-deck tests at the new module:
- In `backend/tests/unit/test_deck_plan_real_decks.py`:
  - Delete `import os`, `from pathlib import Path`, the `DECK_DIR = ...` line and the whole `def real_deck_pages(...)` function.
  - Add `from backend.eval.decks import DECK_DIR, real_deck_pages` next to the `deck_plan` import.
  - Leave the rest unchanged. The last test still uses `DECK_DIR.glob`.
- In `backend/tests/unit/test_quiz_grounding_real_decks.py`, change line 23 from `from backend.tests.unit.test_deck_plan_real_decks import real_deck_pages` to `from backend.eval.decks import real_deck_pages`.

**Step 4: green**

`$PY -m pytest backend/tests/unit/test_eval_decks.py backend/tests/unit/test_deck_plan_real_decks.py backend/tests/unit/test_quiz_grounding_real_decks.py -m "not db" -q`

All pass. The real-deck tests also pass locally, because the PDFs are present.

**Step 5: mutation check**

In `backend/eval/decks.py`, change `_DUPLICATE_MARKERS = ("-2", "Kopie")` to `_DUPLICATE_MARKERS = ("-2",)`.
- Re-run. `test_duplicates_and_non_decks_are_skipped[02__SR_Aufgaben_BS_v01_20.04.2025 Kopie.pdf]` fails.
- Revert and re-run: green.

**Commit:** `feat(eval): shared real-deck loader with duplicate-copy filtering; real-deck tests import it`

---

## Task 2: Move the meta-pass selection into `deck_plan.select_meta_slides`

**Files**
- Modify: `backend/services/parser/deck_plan.py`
- Modify: `backend/services/parser/synthesis.py`
- Create: `backend/tests/unit/test_deck_plan_meta_selection.py`
- Modify (append one test): `backend/tests/unit/test_synthesis.py`

**Interfaces**
- Consumes: `select_slides(skeleton, budget, roles, min_chars)`, `META_ROLES`, `DeckSkeleton`
- Produces: `select_meta_slides(skeleton: DeckSkeleton, budget: int = 15) -> list[int]`. `synthesis.analyze_lecture_meta` reads exactly these slides.

**Step 1: failing tests**

`backend/tests/unit/test_deck_plan_meta_selection.py`:
```python
from backend.services.parser.deck_plan import (
    META_ROLES,
    build_deck_skeleton,
    select_meta_slides,
    select_slides,
)
from backend.tests.support.deck_lab_decks import LONG_DECK

BODY = "A relational schema decomposes into BCNF when every determinant is a key of the relation."


def tag(i: int) -> str:
    # Letters, not digits: normalize_line folds digit runs to '#'.
    return "".join(chr(97 + int(d)) for d in str(i))


def _numbered_deck(n_sections: int, per_section: int) -> list[str]:
    pages = ["Course Title"]
    for s in range(n_sections):
        pages.append(f"{s + 1}. Chapter")
        pages += [f"Case {tag(s * 100 + k)}: {BODY}" for k in range(per_section)]
    return pages


def test_hand_checked_selection_on_the_long_fixture():
    sk = build_deck_skeleton(LONG_DECK)
    assert select_meta_slides(sk) == [0, 1, 2, 3, 5, 6, 7, 9, 10, 12, 13, 14, 15, 16, 17]


def test_title_is_kept_and_budget_holds_when_sections_outnumber_the_budget():
    sk = build_deck_skeleton(_numbered_deck(20, 2))
    spread = select_slides(sk, 15, META_ROLES, min_chars=1)
    assert 0 not in spread  # 21 sections, budget 15: the title section loses its slot
    picked = select_meta_slides(sk)
    assert picked == [0] + spread[:14]
    assert len(picked) == 15


def test_zero_budget_selects_nothing():
    assert select_meta_slides(build_deck_skeleton(LONG_DECK), 0) == []


def test_empty_deck_selects_nothing():
    assert select_meta_slides(build_deck_skeleton([])) == []
```

Append to `backend/tests/unit/test_synthesis.py`, after `test_meta_sees_slides_beyond_fifteen`:
```python
async def test_meta_prompt_reads_exactly_the_deck_plan_meta_selection(llm, monkeypatch):
    llm["reply"] = "{}"
    slides = ["Title"] + [f"Note {_letters(i)} explains how transactions keep data consistent." for i in range(30)]
    monkeypatch.setattr(synthesis, "select_meta_slides", lambda sk: [0, 7, 21])
    await synthesis.analyze_lecture_meta(slides, "groq")
    prompt = llm["text_prompts"][0]
    assert prompt.count("[Slide ") == 3
    assert "[Slide 8]" in prompt and "[Slide 22]" in prompt
```

**Step 2: run it and see it fail**

`$PY -m pytest backend/tests/unit/test_deck_plan_meta_selection.py backend/tests/unit/test_synthesis.py -m "not db" -q`

Expected:
- `ImportError: cannot import name 'select_meta_slides' from 'backend.services.parser.deck_plan'` (collection error).
- The synthesis test fails with `AttributeError: <module 'backend.services.parser.synthesis'> has no attribute 'select_meta_slides'`.

**Step 3: minimal implementation**

Append to `backend/services/parser/deck_plan.py`, after `select_slides`:
```python
def select_meta_slides(skeleton: DeckSkeleton, budget: int = 15) -> list[int]:
    """Slides the lecture-meta prompt reads: up to ``budget`` spread across
    all sections over META_ROLES (any non-empty text), and always the title
    slide, which names the lecture."""
    if budget <= 0:
        return []
    picked = select_slides(skeleton, budget, META_ROLES, min_chars=1)
    if skeleton.slides and 0 not in picked:
        picked = [0] + picked[: budget - 1]
    return picked
```

Then two edits in `backend/services/parser/synthesis.py`.

First, the import block at lines 37–42 becomes:
```python
from backend.services.parser.deck_plan import (
    DeckSkeleton,
    build_deck_skeleton,
    select_meta_slides,
    select_slides,
)
```

Second, in `analyze_lecture_meta`, replace these three lines:
```python
    picked = select_slides(skeleton, 15, META_ROLES, min_chars=1)
    if skeleton.slides and 0 not in picked:
        picked = [0] + picked[:14]
```
with:
```python
    picked = select_meta_slides(skeleton)
```

**Step 4: green**

`$PY -m pytest backend/tests/unit/test_deck_plan_meta_selection.py backend/tests/unit/test_synthesis.py backend/tests/unit/test_deck_plan_sampler.py backend/tests/unit/test_unified_orchestrator.py -m "not db" -q`

All pass, including the existing `test_analyze_lecture_meta_caps_prompt_at_15_slides` and `test_meta_sees_slides_beyond_fifteen`.

**Step 5: mutation check**
- In `deck_plan.py`, change `picked = [0] + picked[: budget - 1]` to `picked = [0] + picked`.
  - `test_title_is_kept_and_budget_holds_when_sections_outnumber_the_budget` fails (16 slides instead of 15).
  - Revert.
- In `synthesis.py`, temporarily put back the three inline lines instead of `picked = select_meta_slides(skeleton)`.
  - `test_meta_prompt_reads_exactly_the_deck_plan_meta_selection` fails, because the prompt count is not 3.
  - Revert. Green.

**Commit:** `refactor(parser): name the meta-pass slide selection (select_meta_slides) so eval measures production`

---

## Task 3: Pure scorecard metrics (`backend/eval/deck_lab.py`)

**Files**
- Create: `backend/eval/deck_lab.py`
- Create: `backend/tests/unit/test_deck_lab_metrics.py`

**Interfaces**
- Consumes: `build_deck_skeleton`, `select_slides`, `select_meta_slides`, `QUIZ_ROLES`, `SlideRole`, `DeckSkeleton`
- Produces:
  - `legacy_quiz_selection(pages: Sequence[str]) -> list[int]`
  - `legacy_meta_selection(pages: Sequence[str]) -> list[int]`
  - `new_quiz_selection(skeleton: DeckSkeleton) -> list[int]`
  - `new_meta_selection(skeleton: DeckSkeleton) -> list[int]`
  - `eligible_sections(skeleton: DeckSkeleton) -> frozenset[int]`
  - `section_coverage(skeleton: DeckSkeleton, picked: Sequence[int]) -> tuple[int, int]`
  - `deck_span(picked: Sequence[int], n_pages: int) -> float`
  - `page_visibility(picked: Sequence[int], n_pages: int) -> tuple[float, int]`
  - `whitespace_tokens(text: str) -> int`
  - `boilerplate_tokens_removed(pages: Sequence[str], skeleton: DeckSkeleton) -> int`
  - `role_histogram(skeleton: DeckSkeleton) -> dict[str, int]`
  - `DeckReport` (frozen dataclass), `score_deck(name: str, pages: Sequence[str]) -> DeckReport`
  - `CorpusTotals` (frozen dataclass), `corpus_totals(reports: Sequence[DeckReport]) -> CorpusTotals`

**Step 1: failing test**

`backend/tests/unit/test_deck_lab_metrics.py`:
```python
import pytest

from backend.eval.deck_lab import (
    boilerplate_tokens_removed,
    corpus_totals,
    deck_span,
    eligible_sections,
    legacy_meta_selection,
    legacy_quiz_selection,
    new_meta_selection,
    new_quiz_selection,
    page_visibility,
    role_histogram,
    score_deck,
    section_coverage,
)
from backend.services.parser.deck_plan import build_deck_skeleton
from backend.tests.support.deck_lab_decks import LONG_DECK, SHORT_DECK


@pytest.fixture
def long_sk():
    return build_deck_skeleton(LONG_DECK)


def test_fixture_structure_is_what_the_docstring_claims(long_sk):
    assert len(LONG_DECK) == 18 and len(SHORT_DECK) == 4
    assert long_sk.boilerplate == frozenset({"course footer line"})
    assert [(s.start, s.end) for s in long_sk.sections] == [(0, 0), (1, 11), (12, 17)]


def test_legacy_quiz_selection_reproduces_the_old_expression():
    picked = legacy_quiz_selection(LONG_DECK)
    assert [LONG_DECK[i] for i in picked] == [s for s in LONG_DECK if len(s) > 50][:10]
    assert picked == list(range(2, 12))


def test_legacy_quiz_threshold_is_strictly_more_than_fifty_raw_chars():
    assert legacy_quiz_selection(["x" * 50, "y" * 51, "z" * 49, "w" * 80]) == [1, 3]


def test_legacy_meta_selection_is_the_first_fifteen_pages():
    assert legacy_meta_selection(LONG_DECK) == list(range(15))
    assert legacy_meta_selection(SHORT_DECK) == [0, 1, 2, 3]


def test_new_selections_match_hand_checked_answers(long_sk):
    assert new_quiz_selection(long_sk) == [2, 4, 6, 8, 10, 13, 14, 15, 16, 17]
    assert new_meta_selection(long_sk) == [0, 1, 2, 3, 5, 6, 7, 9, 10, 12, 13, 14, 15, 16, 17]


def test_section_coverage_counts_only_eligible_sections(long_sk):
    assert eligible_sections(long_sk) == frozenset({1, 2})
    assert section_coverage(long_sk, legacy_quiz_selection(LONG_DECK)) == (1, 2)
    assert section_coverage(long_sk, new_quiz_selection(long_sk)) == (2, 2)
    # The title slide sits in section 0, which holds nothing a quiz can use.
    assert section_coverage(long_sk, [0, 2]) == (1, 2)
    assert section_coverage(long_sk, []) == (0, 2)


def test_deck_span():
    assert deck_span(list(range(2, 12)), 18) == pytest.approx(9 / 18)
    assert deck_span([2, 17], 18) == pytest.approx(15 / 18)
    assert deck_span([], 18) == 0.0
    assert deck_span([3], 18) == 0.0


def test_page_visibility():
    assert page_visibility(list(range(15)), 18) == (pytest.approx(15 / 18), 15)
    assert page_visibility([0, 17, 17], 18) == (pytest.approx(2 / 18), 18)
    assert page_visibility([], 18) == (0.0, 0)


def test_boilerplate_tokens_removed(long_sk):
    assert boilerplate_tokens_removed(LONG_DECK, long_sk) == 54
    assert boilerplate_tokens_removed(SHORT_DECK, build_deck_skeleton(SHORT_DECK)) == 12


def test_role_histogram_lists_every_role(long_sk):
    assert role_histogram(long_sk) == {
        "title": 1, "agenda": 2, "section": 0, "content": 15,
        "exercise": 0, "summary": 0, "references": 0, "empty": 0,
    }


def test_score_deck_long():
    r = score_deck("00 DBS Syn.pdf", LONG_DECK)
    assert (r.pages, r.sections, r.eligible_sections, r.boilerplate_lines) == (18, 3, 2, 1)
    assert (r.quiz_covered_old, r.quiz_covered_new) == (1, 2)
    assert r.span_old == pytest.approx(0.5)
    assert r.span_new == pytest.approx(15 / 18)
    assert r.meta_share_old == pytest.approx(15 / 18)
    assert r.meta_share_new == pytest.approx(15 / 18)
    assert (r.meta_last_old, r.meta_last_new) == (15, 18)
    assert r.boilerplate_removed == 54
    assert r.tokens_saved_per_slide == pytest.approx(3.0)


def test_corpus_totals_pool_counts_and_average_spans():
    t = corpus_totals([score_deck("a", LONG_DECK), score_deck("b", SHORT_DECK)])
    assert (t.decks, t.pages, t.sections, t.eligible_sections) == (2, 22, 4, 3)
    assert (t.quiz_covered_old, t.quiz_covered_new) == (2, 3)
    assert t.mean_span_old == pytest.approx(0.5)
    assert t.mean_span_new == pytest.approx((15 / 18 + 0.5) / 2)
    assert (t.meta_seen_old, t.meta_seen_new) == (19, 19)
    assert t.meta_share_new == pytest.approx(19 / 22)
    assert (t.meta_reaches_end_old, t.meta_reaches_end_new) == (1, 2)
    assert (t.boilerplate_lines, t.boilerplate_removed) == (2, 66)
    assert t.tokens_saved_per_slide == pytest.approx(3.0)
    roles = dict(t.roles)
    assert (roles["title"], roles["agenda"], roles["content"]) == (2, 2, 18)


def test_corpus_totals_of_nothing_is_zero_not_a_crash():
    t = corpus_totals([])
    assert t.decks == 0
    assert t.mean_span_new == 0.0 and t.meta_share_new == 0.0 and t.tokens_saved_per_slide == 0.0
```

**Step 2: run it and see it fail**

`$PY -m pytest backend/tests/unit/test_deck_lab_metrics.py -m "not db" -q`

Expected: `ModuleNotFoundError: No module named 'backend.eval.deck_lab'`.

**Step 3: minimal implementation**

`backend/eval/deck_lab.py`:
```python
"""Deck Lab — old-vs-new scorecard on real lecture decks, with no LLM call.

Measures what the deck skeleton (services/parser/deck_plan.py) changed in
what the pipeline SHOWS the model, on the user's real PDFs:
  - quiz input: which slides the deck-quiz prompt reads (budget 10)
  - meta pass:  which slides the lecture-meta prompt reads (budget 15)
  - boilerplate: template tokens the skeleton strips from every slide
  - structure:  role histogram and section count

The "old" selectors are re-implemented here as named reference functions
(legacy_*), copied from synthesis.py as it was before commit f34a787, so the
comparison does not depend on dead code. The "new" selectors call the very
functions production calls.

Run: python -m backend.eval.deck_lab [--decks NAME ...] [--dir DIR] [--out FILE]
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Sequence

from backend.services.parser.deck_plan import (
    QUIZ_ROLES,
    DeckSkeleton,
    SlideRole,
    build_deck_skeleton,
    select_meta_slides,
    select_slides,
)

QUIZ_BUDGET = 10
META_BUDGET = 15
QUIZ_MIN_CHARS = 50  # select_slides' default; also the eligibility rule


# ── selectors ────────────────────────────────────────────────────────────

def legacy_quiz_selection(pages: Sequence[str]) -> list[int]:
    """Pre-f34a787 quiz input, `[s for s in slides if len(s) > 50][:10]`,
    on RAW page text, returned as 0-based indices instead of texts."""
    return [i for i, page in enumerate(pages) if len(page) > 50][:QUIZ_BUDGET]


def legacy_meta_selection(pages: Sequence[str]) -> list[int]:
    """Pre-f34a787 meta input, `slides[:15]`."""
    return list(range(min(META_BUDGET, len(pages))))


def new_quiz_selection(skeleton: DeckSkeleton) -> list[int]:
    return select_slides(skeleton, QUIZ_BUDGET)


def new_meta_selection(skeleton: DeckSkeleton) -> list[int]:
    return select_meta_slides(skeleton, META_BUDGET)


# ── metrics ──────────────────────────────────────────────────────────────

def eligible_sections(skeleton: DeckSkeleton) -> frozenset[int]:
    """Sections holding at least one slide the new quiz selector may pick.
    Old and new are scored against this same denominator."""
    return frozenset(
        s.section for s in skeleton.slides
        if s.role in QUIZ_ROLES and len(s.text) >= QUIZ_MIN_CHARS
    )


def section_coverage(skeleton: DeckSkeleton, picked: Sequence[int]) -> tuple[int, int]:
    """(eligible sections with at least one pick, eligible sections)."""
    eligible = eligible_sections(skeleton)
    covered = {skeleton.slides[i].section for i in picked} & eligible
    return len(covered), len(eligible)


def deck_span(picked: Sequence[int], n_pages: int) -> float:
    """(last pick - first pick) / deck length; 0.0 for no or one pick."""
    if not picked or n_pages <= 0:
        return 0.0
    return (max(picked) - min(picked)) / n_pages


def page_visibility(picked: Sequence[int], n_pages: int) -> tuple[float, int]:
    """(share of deck pages seen, last page seen as 1-based number; 0 = none)."""
    if not picked or n_pages <= 0:
        return 0.0, 0
    return len(set(picked)) / n_pages, max(picked) + 1


def whitespace_tokens(text: str) -> int:
    return len(text.split())


def boilerplate_tokens_removed(pages: Sequence[str], skeleton: DeckSkeleton) -> int:
    """Whitespace tokens in the raw pages minus those in the stripped texts."""
    raw = sum(whitespace_tokens(p) for p in pages)
    kept = sum(whitespace_tokens(s.text) for s in skeleton.slides)
    return raw - kept


def role_histogram(skeleton: DeckSkeleton) -> dict[str, int]:
    counts = Counter(s.role for s in skeleton.slides)
    return {role.value: counts.get(role, 0) for role in SlideRole}


# ── per-deck and corpus reports ──────────────────────────────────────────

@dataclass(frozen=True)
class DeckReport:
    name: str
    pages: int
    sections: int
    eligible_sections: int
    boilerplate_lines: int
    quiz_old: tuple[int, ...]
    quiz_new: tuple[int, ...]
    quiz_covered_old: int
    quiz_covered_new: int
    meta_old: tuple[int, ...]
    meta_new: tuple[int, ...]
    boilerplate_removed: int
    roles: tuple[tuple[str, int], ...]

    @property
    def span_old(self) -> float:
        return deck_span(self.quiz_old, self.pages)

    @property
    def span_new(self) -> float:
        return deck_span(self.quiz_new, self.pages)

    @property
    def meta_share_old(self) -> float:
        return page_visibility(self.meta_old, self.pages)[0]

    @property
    def meta_share_new(self) -> float:
        return page_visibility(self.meta_new, self.pages)[0]

    @property
    def meta_last_old(self) -> int:
        return page_visibility(self.meta_old, self.pages)[1]

    @property
    def meta_last_new(self) -> int:
        return page_visibility(self.meta_new, self.pages)[1]

    @property
    def tokens_saved_per_slide(self) -> float:
        return self.boilerplate_removed / self.pages if self.pages else 0.0


def score_deck(name: str, pages: Sequence[str]) -> DeckReport:
    pages = list(pages)
    sk = build_deck_skeleton(pages)
    quiz_old = legacy_quiz_selection(pages)
    quiz_new = new_quiz_selection(sk)
    covered_old, eligible = section_coverage(sk, quiz_old)
    covered_new, _ = section_coverage(sk, quiz_new)
    return DeckReport(
        name=name,
        pages=len(pages),
        sections=len(sk.sections),
        eligible_sections=eligible,
        boilerplate_lines=len(sk.boilerplate),
        quiz_old=tuple(quiz_old),
        quiz_new=tuple(quiz_new),
        quiz_covered_old=covered_old,
        quiz_covered_new=covered_new,
        meta_old=tuple(legacy_meta_selection(pages)),
        meta_new=tuple(new_meta_selection(sk)),
        boilerplate_removed=boilerplate_tokens_removed(pages, sk),
        roles=tuple(role_histogram(sk).items()),
    )


@dataclass(frozen=True)
class CorpusTotals:
    decks: int
    pages: int
    sections: int
    eligible_sections: int
    quiz_covered_old: int
    quiz_covered_new: int
    mean_span_old: float
    mean_span_new: float
    meta_seen_old: int  # distinct pages seen, summed over decks
    meta_seen_new: int
    meta_reaches_end_old: int  # decks whose last page is seen
    meta_reaches_end_new: int
    boilerplate_lines: int
    boilerplate_removed: int
    roles: tuple[tuple[str, int], ...]

    @property
    def meta_share_old(self) -> float:
        return self.meta_seen_old / self.pages if self.pages else 0.0

    @property
    def meta_share_new(self) -> float:
        return self.meta_seen_new / self.pages if self.pages else 0.0

    @property
    def tokens_saved_per_slide(self) -> float:
        return self.boilerplate_removed / self.pages if self.pages else 0.0


def corpus_totals(reports: Sequence[DeckReport]) -> CorpusTotals:
    n = len(reports)
    roles: Counter[str] = Counter()
    for r in reports:
        roles.update(dict(r.roles))
    return CorpusTotals(
        decks=n,
        pages=sum(r.pages for r in reports),
        sections=sum(r.sections for r in reports),
        eligible_sections=sum(r.eligible_sections for r in reports),
        quiz_covered_old=sum(r.quiz_covered_old for r in reports),
        quiz_covered_new=sum(r.quiz_covered_new for r in reports),
        mean_span_old=sum(r.span_old for r in reports) / n if n else 0.0,
        mean_span_new=sum(r.span_new for r in reports) / n if n else 0.0,
        meta_seen_old=sum(len(set(r.meta_old)) for r in reports),
        meta_seen_new=sum(len(set(r.meta_new)) for r in reports),
        meta_reaches_end_old=sum(1 for r in reports if r.pages and r.meta_last_old == r.pages),
        meta_reaches_end_new=sum(1 for r in reports if r.pages and r.meta_last_new == r.pages),
        boilerplate_lines=sum(r.boilerplate_lines for r in reports),
        boilerplate_removed=sum(r.boilerplate_removed for r in reports),
        roles=tuple((role.value, roles.get(role.value, 0)) for role in SlideRole),
    )
```

**Step 4: green**

`$PY -m pytest backend/tests/unit/test_deck_lab_metrics.py -m "not db" -q`

All 13 tests pass.

**Step 5: mutation check**
- Change `if len(page) > 50][:QUIZ_BUDGET]` to `if len(page) >= 50][:QUIZ_BUDGET]`.
  - `test_legacy_quiz_threshold_is_strictly_more_than_fifty_raw_chars` fails: you get `[0, 1, 3]`.
  - Revert.
- Change `covered = {skeleton.slides[i].section for i in picked} & eligible` to `covered = {skeleton.slides[i].section for i in picked}`.
  - `test_section_coverage_counts_only_eligible_sections` fails: you get `(2, 2)`, not `(1, 2)`.
  - Revert. Green.

**Commit:** `feat(eval): deck lab metrics — section coverage, span, meta visibility, boilerplate, roles`

---

## Task 4: Grounding drop-risk probe (data module and runner)

**Files**
- Create: `backend/eval/data/__init__.py` (docstring only)
- Create: `backend/eval/data/grounding_probe.py`
- Modify (append): `backend/eval/deck_lab.py`
- Create: `backend/tests/unit/test_grounding_probe_set.py`
- Create: `backend/tests/unit/test_deck_lab_probe.py`

**Interfaces**
- Consumes: `assess_grounding(question: Mapping, skeleton: DeckSkeleton, threshold: float = SUPPORT_THRESHOLD) -> GroundingVerdict` (`.score`, `.reason`, `.ok`), and `SUPPORT_THRESHOLD` (0.5)
- Produces:
  - `ProbePair(deck, slide, stem, paraphrased, hallucinated, language)`
  - Constants: `PROBE_PAIRS`, `PROBE_DECKS`, `PROBE_DECK_EN`, `PROBE_DECK_DE`, `CALIBRATION_DECKS`, `EN_OFF_TOPIC`, `DE_OFF_TOPIC`
  - In `deck_lab`: `PARAPHRASED`, `HALLUCINATED`
  - `probe_question(pair: ProbePair, answer: str) -> dict`
  - `ProbeOutcome`
  - `ProbeResult` with properties `paraphrased`, `hallucinated`, `false_drops`, `false_keeps`, `false_drop_rate`, `false_keep_rate`
  - `run_grounding_probe(pairs: Sequence[ProbePair], skeletons: Mapping[str, DeckSkeleton], threshold: float = SUPPORT_THRESHOLD) -> ProbeResult`

**Step 1: failing tests**

`backend/tests/unit/test_grounding_probe_set.py`:
```python
"""Integrity of the hand-written probe set. The real-deck half checks the
writing rule (no three-word copy from the cited slide) and skips without
the PDFs. Nothing here scores a pair: scoring is the Deck Lab's job."""
import re

import pytest

from backend.eval.data.grounding_probe import (
    CALIBRATION_DECKS,
    PROBE_DECK_DE,
    PROBE_DECK_EN,
    PROBE_DECKS,
    PROBE_PAIRS,
)
from backend.eval.decks import real_deck_pages
from backend.services.parser.deck_plan import build_deck_skeleton

_WORD = re.compile(r"[^\W_]+")


def _trigrams(text: str) -> set[tuple[str, ...]]:
    words = _WORD.findall(text.casefold())
    return {tuple(words[i:i + 3]) for i in range(len(words) - 2)}


def test_set_is_modest_and_balanced():
    assert 12 <= len(PROBE_PAIRS) <= 20
    en = sum(p.deck == PROBE_DECK_EN for p in PROBE_PAIRS)
    de = sum(p.deck == PROBE_DECK_DE for p in PROBE_PAIRS)
    assert en == de == len(PROBE_PAIRS) // 2


def test_probe_decks_are_not_the_calibration_decks():
    assert not set(PROBE_DECKS) & set(CALIBRATION_DECKS)
    assert {p.deck for p in PROBE_PAIRS} == set(PROBE_DECKS)


def test_language_matches_deck():
    for p in PROBE_PAIRS:
        assert p.language == ("en" if p.deck == PROBE_DECK_EN else "de")


def test_hallucinations_carry_no_digits():
    assert not [p for p in PROBE_PAIRS if any(ch.isdigit() for ch in p.hallucinated)]


def test_one_pair_per_cited_slide_and_answers_differ():
    keys = [(p.deck, p.slide) for p in PROBE_PAIRS]
    assert len(keys) == len(set(keys))
    assert all(p.paraphrased != p.hallucinated for p in PROBE_PAIRS)


@pytest.fixture(scope="module")
def skeletons():
    out = {}
    for deck in PROBE_DECKS:
        pages = real_deck_pages(deck)
        if pages is None:
            pytest.skip("real probe decks not available")
        out[deck] = build_deck_skeleton(pages)
    return out


@pytest.mark.parametrize("pair", PROBE_PAIRS, ids=lambda p: f"{p.language}-slide{p.slide}")
def test_answers_do_not_copy_three_words_from_the_cited_slide(pair, skeletons):
    sk = skeletons[pair.deck]
    assert 1 <= pair.slide <= len(sk.slides)
    slide = _trigrams(sk.slides[pair.slide - 1].text)
    assert slide, "cited slide is empty"
    assert not _trigrams(pair.paraphrased) & slide
    assert not _trigrams(pair.hallucinated) & slide
```

`backend/tests/unit/test_deck_lab_probe.py`:
```python
import pytest

from backend.eval.data.grounding_probe import ProbePair
from backend.eval.deck_lab import HALLUCINATED, PARAPHRASED, probe_question, run_grounding_probe
from backend.services.parser.deck_plan import build_deck_skeleton
from backend.tests.support.deck_lab_decks import LONG_DECK

# Hand-checked against assess_grounding on LONG_DECK (slide 3 = alpha, 4 = bravo):
#   P1 "The alpha concept"                  -> 1.0 ok           (kept: correct)
#   H1 "Quantum entanglement of photons"     -> 0.0 low_support  (dropped: correct)
#   P2 "Quantum tunnelling"                  -> 0.0 low_support  (FALSE DROP)
#   H2 "The bravo concept, in enough words"  -> 1.0 ok           (FALSE KEEP: lexical, not entailment)
PAIRS = [
    ProbePair("syn", 3, "What does the alpha slide explain?",
              "The alpha concept", "Quantum entanglement of photons", "en"),
    ProbePair("syn", 4, "What does the bravo slide explain?",
              "Quantum tunnelling", "The bravo concept, in enough words", "en"),
]


@pytest.fixture
def skeletons():
    return {"syn": build_deck_skeleton(LONG_DECK)}


def test_probe_question_uses_answer_text_and_off_topic_distractors():
    q = probe_question(PAIRS[0], "The alpha concept")
    assert q["options"][0] == "The alpha concept" == q["correctAnswer"]
    assert q["source_slide"] == 3 and len(q["options"]) == 4
    assert "Photosynthesis in chloroplasts" in q["options"]


def test_probe_counts_false_drops_and_false_keeps(skeletons):
    r = run_grounding_probe(PAIRS, skeletons)
    assert [(o.kind, o.reason, o.accepted) for o in r.outcomes] == [
        (PARAPHRASED, "ok", True),
        (HALLUCINATED, "low_support", False),
        (PARAPHRASED, "low_support", False),
        (HALLUCINATED, "ok", True),
    ]
    assert (r.paraphrased, r.hallucinated) == (2, 2)
    assert [o.answer for o in r.false_drops] == ["Quantum tunnelling"]
    assert [o.answer for o in r.false_keeps] == ["The bravo concept, in enough words"]
    assert r.false_drop_rate == pytest.approx(0.5)
    assert r.false_keep_rate == pytest.approx(0.5)
    assert r.threshold == 0.5 and r.missing_decks == ()


def test_probe_passes_the_threshold_through(skeletons):
    r = run_grounding_probe(PAIRS, skeletons, threshold=1.01)
    assert not any(o.accepted for o in r.outcomes)
    assert r.false_drop_rate == pytest.approx(1.0) and r.false_keep_rate == 0.0


def test_missing_deck_is_reported_not_scored(skeletons):
    absent = ProbePair("absent.pdf", 2, "Q?", "a b", "c d", "de")
    r = run_grounding_probe([*PAIRS, absent], skeletons)
    assert r.missing_decks == ("absent.pdf",)
    assert len(r.outcomes) == 4


def test_rates_are_none_when_nothing_was_scored():
    r = run_grounding_probe(PAIRS, {})
    assert r.outcomes == () and r.false_drop_rate is None and r.false_keep_rate is None
```

**Step 2: run it and see it fail**

`$PY -m pytest backend/tests/unit/test_grounding_probe_set.py backend/tests/unit/test_deck_lab_probe.py -m "not db" -q`

Expected:
- `ModuleNotFoundError: No module named 'backend.eval.data.grounding_probe'`
- `ImportError: cannot import name 'HALLUCINATED' from 'backend.eval.deck_lab'`

**Step 3: minimal implementation**

`backend/eval/data/__init__.py`:
```python
"""Hand-written evaluation data (golden sets, probe pairs)."""
```

`backend/eval/data/grounding_probe.py`:
```python
"""Grounding verifier drop-risk probe — hand-written pairs over real slides.

Why: SUPPORT_THRESHOLD (services/parser/quiz_grounding.py) was calibrated on
pairs whose grounded keys stayed close to the slide's own wording, and whose
ungrounded keys were copied from other slides. A model paraphrases, and a
model hallucinates on-topic. This set measures the two errors the
calibration could not see:
  false drop  — a correct, PARAPHRASED answer is rejected
  false keep  — an ON-TOPIC answer the cited slide does not state is accepted

Writing rule (fixed before any pair was scored; pairs are not tuned to the scorer):
  1. Decks differ from the calibration decks: 07 DBS Transactions (EN) and
     05 SR Speicherverwaltung (DE).
  2. The stem is a student's question in plain words.
  3. paraphrased: states a fact the cited slide states, reworded. It may keep
     the slide's technical terms (System R, MMU, Basisregister), but no three
     consecutive words of it appear consecutively on the slide (casefolded,
     punctuation ignored).
  4. hallucinated: a plausible, on-topic claim in the deck's vocabulary that
     the cited slide does NOT state, written freehand (not a sentence lifted
     from another slide). No digits, so the digit gate cannot catch it for
     free. Rule 3's three-word limit applies to it too.
  5. Distractors are off-topic, as in the calibration, so the ambiguity gate
     cannot mask the raw support score.
  6. Any later edit is logged below with its reason and the scores before
     and after. Never edit a pair because of its score.
Rules 1, 3 and 4 are checked in tests/unit/test_grounding_probe_set.py.

Change log:
  2026-10-11  initial 16 pairs (8 EN, 8 DE), written before any scoring.
"""
from __future__ import annotations

from dataclasses import dataclass

PROBE_DECK_EN = "07 DBS Transactions.pdf"
PROBE_DECK_DE = "05__SR_Speicherverwaltung_v02_06.05.2026.pdf"
PROBE_DECKS = (PROBE_DECK_EN, PROBE_DECK_DE)
# The decks SUPPORT_THRESHOLD was calibrated on; the probe must not reuse them.
CALIBRATION_DECKS = ("00 DBS Introduction.pdf", " 03__SR_Prozesse_v07_27.04.2025.pdf")

EN_OFF_TOPIC = ("Photosynthesis in chloroplasts", "Plate tectonics", "Baroque counterpoint")
DE_OFF_TOPIC = ("Photosynthese in Chloroplasten", "Plattentektonik", "Barocker Kontrapunkt")


@dataclass(frozen=True)
class ProbePair:
    deck: str
    slide: int  # real 1-based deck slide number, as the quiz prompt cites it
    stem: str
    paraphrased: str  # grounded on `slide`, reworded (rule 3)
    hallucinated: str  # on-topic, NOT stated on `slide` (rule 4)
    language: str  # "en" | "de": picks the off-topic distractors


def _en(slide: int, stem: str, paraphrased: str, hallucinated: str) -> ProbePair:
    return ProbePair(PROBE_DECK_EN, slide, stem, paraphrased, hallucinated, "en")


def _de(slide: int, stem: str, paraphrased: str, hallucinated: str) -> ProbePair:
    return ProbePair(PROBE_DECK_DE, slide, stem, paraphrased, hallucinated, "de")


PROBE_PAIRS: tuple[ProbePair, ...] = (
    # 07 DBS Transactions
    _en(7, "In one sentence, what is a database transaction?",  # slide: definition of a transaction
        "An ordered series of operations taking the database from one consistent state into another",
        "A single SQL statement that the DBMS executes without any locking"),
    _en(11, "What does atomicity guarantee for a transaction?",  # slide: ACID, atomicity first
        "It runs completely or has no effect whatsoever",
        "Transactions are always executed on a separate replica server"),
    _en(13, "Who first formalised transactions, and where?",  # slide: history, System R / Jim Gray
        "Jim Gray, in the System R project",
        "Edgar Codd, in the relational prototype Ingres"),
    _en(14, "What can go wrong when several travel agencies book the same flight at once?",  # slide: scenarios
        "One seat may be sold to more than one customer",
        "The flight database refuses all bookings until the agencies synchronise their clocks"),
    _en(19, "Which anomalies can a non-serializable schedule cause?",  # slide: list of sync problems
        "Lost updates, dirty reads and phantoms",
        "Deadlocks, livelocks and starvation of the transaction manager"),
    _en(29, "What is allowed under the read uncommitted isolation level?",  # slide: weakest level
        "Values not yet committed can be accessed, and no locks are taken",
        "Every read places a shared lock that is held until commit"),
    _en(32, "What is the simplest way to avoid every synchronization problem?",  # slide: solution 1, serial
        "Running transactions in sequence, never concurrently",
        "Giving every transaction the isolation level read committed"),
    _en(35, "What makes a schedule serializable?",  # slide: schedule properties
        "An interleaving whose effect equals that of some serial execution",
        "An interleaving in which no transaction ever reads a value written by another one"),
    # 05 SR Speicherverwaltung
    _de(5, "Wozu dient der Schutz in der Speicherverwaltung?",  # Folie: Aufgaben der Speicherverwaltung
        "Er begrenzt, worauf ein Prozess im physischen Speicher zugreifen darf",
        "Er verschlüsselt den Hauptspeicher jedes Prozesses"),
    _de(7, "Was ist der Nachteil der einzelnen zusammenhängenden Zuteilung?",  # Folie: Single Continuous Allocation
        "Sie verschwendet Speicherplatz und erlaubt nur ein Programm gleichzeitig",
        "Sie erfordert eine mehrstufige Seitentabelle pro Programm"),
    _de(9, "Welches Problem entsteht bei der partitionierten Zuteilung?",  # Folie: Partitioned Allocation
        "Der Arbeitsspeicher wird zerstückelt",
        "Programme müssen vor dem Start in Segmente zerlegt werden"),
    _de(12, "Welche Hardware braucht die verschiebbare partitionierte Zuteilung?",  # Folie: Relocatable
        "Ein Basisregister für die Verschiebung, ergänzt um ein Grenzregister für den Schutz",
        "Einen Translation Lookaside Buffer für die Verschiebung"),
    _de(15, "Welche Einschränkung haben feste Speicherbereiche?",  # Folie: Probleme fester Speicherbereiche
        "Der adressierbare Raum kann nicht größer als der Hauptspeicher sein",
        "Sie verhindern, dass zwei Prozesse gleichzeitig rechnen"),
    _de(19, "Was ist der TLB?",  # Folie: Implementierung Seitentabelle (2)
        "Ein schneller Hardware-Zwischenspeicher für Seitenübersetzungen innerhalb der MMU",
        "Eine Tabelle auf der Festplatte, die ausgelagerte Seiten protokolliert"),
    _de(21, "Warum verwendet man mehrstufige Seitentabellen?",  # Folie: Mehrstufige Seitentabelle
        "Weil eine einzige Tabelle zu umfangreich wird und sich über viele Seiten erstreckt",
        "Weil jede Stufe einen eigenen Prozessorkern bedient"),
    _de(29, "Was zeigt das Validitätsbit in der Seitentabelle an?",  # Folie: Validitätsbit
        "Ob die Seite gerade im Hauptspeicher liegt; fehlt sie, folgt eine Seitenfehler-Unterbrechung",
        "Ob die Seite seit dem letzten Zugriff verändert wurde"),
)
```

Append to `backend/eval/deck_lab.py`. First add these imports to the import header:
```python
from typing import Mapping, Sequence

from backend.eval.data.grounding_probe import DE_OFF_TOPIC, EN_OFF_TOPIC, ProbePair
from backend.services.parser.quiz_grounding import SUPPORT_THRESHOLD, assess_grounding
```
Then add at the end of the file:
```python
# ── grounding verifier drop-risk probe ───────────────────────────────────

PARAPHRASED = "paraphrased"
HALLUCINATED = "hallucinated"


def probe_question(pair: ProbePair, answer: str) -> dict:
    """The question exactly as the calibration builds it: the answer TEXT as
    key (an int key would be folded 1-based -> 0-based), off-topic distractors."""
    distractors = EN_OFF_TOPIC if pair.language == "en" else DE_OFF_TOPIC
    return {
        "question": pair.stem,
        "options": [answer, *distractors],
        "correctAnswer": answer,
        "source_slide": pair.slide,
    }


@dataclass(frozen=True)
class ProbeOutcome:
    pair: ProbePair
    kind: str  # PARAPHRASED | HALLUCINATED
    answer: str
    score: float
    reason: str
    accepted: bool


@dataclass(frozen=True)
class ProbeResult:
    threshold: float
    outcomes: tuple[ProbeOutcome, ...]
    missing_decks: tuple[str, ...]

    @property
    def paraphrased(self) -> int:
        return sum(1 for o in self.outcomes if o.kind == PARAPHRASED)

    @property
    def hallucinated(self) -> int:
        return sum(1 for o in self.outcomes if o.kind == HALLUCINATED)

    @property
    def false_drops(self) -> tuple[ProbeOutcome, ...]:
        return tuple(o for o in self.outcomes if o.kind == PARAPHRASED and not o.accepted)

    @property
    def false_keeps(self) -> tuple[ProbeOutcome, ...]:
        return tuple(o for o in self.outcomes if o.kind == HALLUCINATED and o.accepted)

    @property
    def false_drop_rate(self) -> float | None:
        return len(self.false_drops) / self.paraphrased if self.paraphrased else None

    @property
    def false_keep_rate(self) -> float | None:
        return len(self.false_keeps) / self.hallucinated if self.hallucinated else None


def run_grounding_probe(
    pairs: Sequence[ProbePair],
    skeletons: Mapping[str, DeckSkeleton],
    threshold: float = SUPPORT_THRESHOLD,
) -> ProbeResult:
    """Score every pair's paraphrased and hallucinated answer on its cited
    slide. Pairs whose deck is absent are reported, never silently dropped."""
    outcomes: list[ProbeOutcome] = []
    for pair in pairs:
        sk = skeletons.get(pair.deck)
        if sk is None:
            continue
        for kind, answer in ((PARAPHRASED, pair.paraphrased), (HALLUCINATED, pair.hallucinated)):
            v = assess_grounding(probe_question(pair, answer), sk, threshold)
            outcomes.append(ProbeOutcome(pair, kind, answer, v.score, v.reason, v.ok))
    missing = tuple(sorted({p.deck for p in pairs} - set(skeletons)))
    return ProbeResult(threshold, tuple(outcomes), missing)
```

**Step 4: green**

`$PY -m pytest backend/tests/unit/test_grounding_probe_set.py backend/tests/unit/test_deck_lab_probe.py backend/tests/unit/test_deck_lab_metrics.py -m "not db" -q`

All pass. The 16 parametrized real-deck rule tests also pass locally; I pre-checked that every trigram overlap is empty.

**Step 5: mutation check**
- In `run_grounding_probe`, change `assess_grounding(probe_question(pair, answer), sk, threshold)` to `assess_grounding(probe_question(pair, answer), sk)`.
  - `test_probe_passes_the_threshold_through` fails: P1 is accepted at the default 0.5.
  - Revert.
- Change `if pair.language == "en" else DE_OFF_TOPIC` to `if pair.language == "de" else DE_OFF_TOPIC`.
  - `test_probe_question_uses_answer_text_and_off_topic_distractors` fails.
  - Revert. Green.

**Commit:** `feat(eval): grounding drop-risk probe — 16 paraphrased/hallucinated pairs on unseen real decks`

---

## Task 5: CLI, markdown scorecard, smoke test, README, and the committed real-deck run

**Files**
- Modify (append): `backend/eval/deck_lab.py`
- Create: `backend/tests/unit/test_deck_lab_cli.py`
- Modify: `backend/eval/README.md`, adding a "Deck Lab" section
- Create (generated, never hand-edited): `docs/DECK_LAB_2026_10.md`

**Interfaces**
- Consumes:
  - `discover_decks`, `real_deck_pages`, `decks.DECK_DIR`
  - `score_deck`, `corpus_totals`
  - `run_grounding_probe`, `PROBE_PAIRS`, `PROBE_DECKS`
  - `backend.eval.retrieval_grid._git_sha() -> str` (exists at line 1032; that module imports only stdlib)
- Produces:
  - `ROLE_COLUMNS: tuple[str, ...]`
  - `provenance_lines(deck_dir: Path, names: Sequence[str], threshold: float) -> list[str]`
  - `render_markdown(reports: Sequence[DeckReport], probe: ProbeResult, provenance: Sequence[str]) -> str`
  - `build_parser() -> argparse.ArgumentParser`
  - `main(argv: Sequence[str] | None = None) -> int`
  - Run as `python -m backend.eval.deck_lab`

**Step 1: failing test**

`backend/tests/unit/test_deck_lab_cli.py`:
```python
"""CLI smoke test on tiny synthetic PDFs written with PyMuPDF. No network,
no LLM. Expected rows follow the hand-checked answers in
tests/support/deck_lab_decks.py."""
import pytest

from backend.eval.data.grounding_probe import ProbePair
from backend.eval.deck_lab import main, render_markdown, run_grounding_probe, score_deck
from backend.services.parser.deck_plan import build_deck_skeleton
from backend.tests.support.deck_lab_decks import LONG_DECK, SHORT_DECK, write_pdf

LONG = "00 DBS Syn.pdf"
SHORT = " 01__SR_Syn_v01_01.01.2026.pdf"  # leading space, like the real SR files


@pytest.fixture
def deck_dir(tmp_path):
    d = tmp_path / "decks"
    d.mkdir()
    write_pdf(d / LONG, LONG_DECK)
    write_pdf(d / SHORT, SHORT_DECK)
    write_pdf(d / "00 DBS Syn-2.pdf", LONG_DECK)  # OS re-download copy: must be skipped
    return d


def test_cli_writes_scorecard_for_discovered_decks(deck_dir, tmp_path):
    out = tmp_path / "lab.md"
    assert main(["--dir", str(deck_dir), "--out", str(out)]) == 0
    md = out.read_text(encoding="utf-8")
    assert "Syn-2" not in md
    # quiz input
    assert "| `00 DBS Syn.pdf` | 18 | 3 | 2 | 1 | 2 | 0.50 | 0.83 |" in md
    assert f"| `{SHORT}` | 4 | 1 | 1 | 1 | 1 | 0.50 | 0.50 |" in md
    assert "| **Total (2 decks)** | 22 | 4 | 3 | 2 | 3 | 0.50 | 0.67 |" in md
    # meta pass
    assert "| `00 DBS Syn.pdf` | 83% | 83% | 15 | 18 |" in md
    assert "| **Total (2 decks)** | 86% | 86% | 1/2 decks to the end | 2/2 decks to the end |" in md
    # boilerplate
    assert "| `00 DBS Syn.pdf` | 1 | 54 | 3.0 |" in md
    assert "| **Total (2 decks)** | 2 | 66 | 3.0 |" in md
    # roles
    assert "| `00 DBS Syn.pdf` | 3 | 1 | 2 | 0 | 15 | 0 | 0 | 0 | 0 |" in md
    # probe decks are not in the synthetic dir
    assert "Probe skipped" in md and "07 DBS Transactions.pdf" in md
    assert "LLM calls : 0" in md


def test_cli_scores_only_the_named_decks(deck_dir, tmp_path):
    out = tmp_path / "lab.md"
    assert main(["--dir", str(deck_dir), "--decks", LONG, "--out", str(out)]) == 0
    md = out.read_text(encoding="utf-8")
    assert "01__SR_Syn" not in md and "**Total (1 deck)**" in md


def test_cli_prints_to_stdout_without_out(deck_dir, capsys):
    assert main(["--dir", str(deck_dir), "--decks", LONG]) == 0
    assert capsys.readouterr().out.startswith("# Deck Lab")


def test_cli_fails_loudly_on_a_missing_deck(deck_dir, capsys):
    assert main(["--dir", str(deck_dir), "--decks", "09 DBS Nope.pdf"]) == 1
    assert "09 DBS Nope.pdf" in capsys.readouterr().err


def test_cli_fails_when_no_decks_are_found(tmp_path, capsys):
    assert main(["--dir", str(tmp_path)]) == 1
    assert "no lecture decks" in capsys.readouterr().err


def test_probe_section_reports_rates_and_rows():
    pairs = [
        ProbePair("syn", 3, "What does the alpha slide explain?",
                  "The alpha concept", "Quantum entanglement of photons", "en"),
        ProbePair("syn", 4, "What does the bravo slide explain?",
                  "Quantum tunnelling", "The bravo concept, in enough words", "en"),
    ]
    probe = run_grounding_probe(pairs, {"syn": build_deck_skeleton(LONG_DECK)})
    md = render_markdown([score_deck("syn", LONG_DECK)], probe, ["<!-- test -->"])
    assert "- False drop (paraphrased grounded answer rejected): 1/2 (50%)" in md
    assert "- False keep (on-topic hallucination accepted): 1/2 (50%)" in md
    assert "| `syn` | 4 | hallucinated | The bravo concept, in enough words | 1.000 | ok | yes |" in md
    assert "| `syn` | 4 | paraphrased | Quantum tunnelling | 0.000 | low_support | no |" in md
```

**Step 2: run it and see it fail**

`$PY -m pytest backend/tests/unit/test_deck_lab_cli.py -m "not db" -q`

Expected: `ImportError: cannot import name 'main' from 'backend.eval.deck_lab'`.

**Step 3: minimal implementation**

The final import header of `backend/eval/deck_lab.py` replaces everything between `from __future__ import annotations` and the first `QUIZ_BUDGET` line:
```python
import argparse
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping, Sequence

from backend.eval import decks
from backend.eval.data.grounding_probe import (
    DE_OFF_TOPIC,
    EN_OFF_TOPIC,
    PROBE_DECKS,
    PROBE_PAIRS,
    ProbePair,
)
from backend.eval.decks import discover_decks, real_deck_pages
from backend.eval.retrieval_grid import _git_sha
from backend.services.parser.deck_plan import (
    QUIZ_ROLES,
    DeckSkeleton,
    SlideRole,
    build_deck_skeleton,
    select_meta_slides,
    select_slides,
)
from backend.services.parser.quiz_grounding import SUPPORT_THRESHOLD, assess_grounding
```

Append at the end of the file:
```python
# ── markdown scorecard ───────────────────────────────────────────────────

ROLE_COLUMNS: tuple[str, ...] = tuple(role.value for role in SlideRole)


def _label(name: str) -> str:
    return f"`{name}`"  # backticks keep the leading space of real SR names visible


def _pct(x: float) -> str:
    return f"{100 * x:.0f}%"


def _rate(num: int, den: int) -> str:
    return f"{num}/{den} ({100 * num / den:.0f}%)" if den else "n/a (nothing scored)"


def provenance_lines(deck_dir: Path, names: Sequence[str], threshold: float) -> list[str]:
    shown = str(deck_dir).replace(str(Path.home()), "~", 1)
    return [
        "<!--",
        f"  generated : {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%SZ')}",
        f"  commit    : {_git_sha()}",
        f"  deck dir  : {shown} ({len(names)} decks)",
        f"  threshold : SUPPORT_THRESHOLD = {threshold}",
        "  LLM calls : 0",
        "-->",
    ]


def render_markdown(reports: Sequence[DeckReport], probe: ProbeResult, provenance: Sequence[str]) -> str:
    t = corpus_totals(reports)
    total = f"**Total ({t.decks} deck{'' if t.decks == 1 else 's'})**"
    out: list[str] = ["# Deck Lab — old vs new slide selection (no LLM calls)", "", *provenance, ""]
    out += [
        "Generated by `python -m backend.eval.deck_lab`. Every number in this file is",
        "computed by the tool; none is edited by hand.",
        "",
        "## Quiz input (budget 10)",
        "",
        "Old: `[s for s in slides if len(s) > 50][:10]` on raw page text (pre-f34a787).",
        "New: `select_slides(skeleton, 10)`. A section is *eligible* when it holds a",
        "content/summary/exercise slide with at least 50 boilerplate-stripped characters;",
        "both arms are scored against the same eligible sections. Span = (last pick - first",
        "pick) / pages; the total row shows the mean span over decks.",
        "",
        "| Deck | Pages | Sections | Eligible sections | Covered (old) | Covered (new) | Span (old) | Span (new) |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for r in reports:
        out.append(f"| {_label(r.name)} | {r.pages} | {r.sections} | {r.eligible_sections} | "
                   f"{r.quiz_covered_old} | {r.quiz_covered_new} | {r.span_old:.2f} | {r.span_new:.2f} |")
    out.append(f"| {total} | {t.pages} | {t.sections} | {t.eligible_sections} | "
               f"{t.quiz_covered_old} | {t.quiz_covered_new} | {t.mean_span_old:.2f} | {t.mean_span_new:.2f} |")

    out += [
        "",
        "## Meta pass (budget 15)",
        "",
        "Old: `slides[:15]`. New: `select_meta_slides(skeleton)` — `select_slides(skeleton, 15,",
        "META_ROLES, min_chars=1)` plus the title slide. Pages seen = distinct pages in the",
        "prompt / deck pages; last page is 1-based.",
        "",
        "| Deck | Pages seen (old) | Pages seen (new) | Last page (old) | Last page (new) |",
        "|---|---:|---:|---:|---:|",
    ]
    for r in reports:
        out.append(f"| {_label(r.name)} | {_pct(r.meta_share_old)} | {_pct(r.meta_share_new)} | "
                   f"{r.meta_last_old} | {r.meta_last_new} |")
    out.append(f"| {total} | {_pct(t.meta_share_old)} | {_pct(t.meta_share_new)} | "
               f"{t.meta_reaches_end_old}/{t.decks} decks to the end | "
               f"{t.meta_reaches_end_new}/{t.decks} decks to the end |")

    out += [
        "",
        "## Boilerplate stripped per parse",
        "",
        "Tokens removed = whitespace tokens of the raw pages minus those of the stripped",
        "skeleton texts (whitespace tokens, not model tokens). Per slide prompt = removed /",
        "pages: the IMPLIED saving if every per-slide prompt sent stripped text. Today only",
        "the meta and quiz prompts do; per-slide synthesis still sends `raw_slides[i]`",
        "(unified_orchestrator.py).",
        "",
        "| Deck | Template lines | Tokens removed | Tokens saved per slide prompt |",
        "|---|---:|---:|---:|",
    ]
    for r in reports:
        out.append(f"| {_label(r.name)} | {r.boilerplate_lines} | {r.boilerplate_removed} | "
                   f"{r.tokens_saved_per_slide:.1f} |")
    out.append(f"| {total} | {t.boilerplate_lines} | {t.boilerplate_removed} | {t.tokens_saved_per_slide:.1f} |")

    out += [
        "",
        "## Slide roles and sections",
        "",
        "| Deck | Sections | " + " | ".join(ROLE_COLUMNS) + " |",
        "|---|---:|" + "---:|" * len(ROLE_COLUMNS),
    ]
    for r in reports:
        out.append(f"| {_label(r.name)} | {r.sections} | " + " | ".join(str(c) for _, c in r.roles) + " |")
    out.append(f"| {total} | {t.sections} | " + " | ".join(str(c) for _, c in t.roles) + " |")

    out += ["", "## Grounding verifier drop-risk probe", ""]
    if not probe.outcomes:
        missing = ", ".join(_label(d) for d in probe.missing_decks)
        out.append(f"Probe skipped: probe decks not found in the deck dir ({missing}).")
    else:
        out += [
            f"`assess_grounding` at SUPPORT_THRESHOLD = {probe.threshold} (not changed in this arc)",
            "on the hand-written pairs in `backend/eval/data/grounding_probe.py`; the writing",
            "rule is in that module's docstring. Distractors are off-topic, so scores are the",
            "raw support of each answer on its cited slide.",
            "",
            f"- False drop (paraphrased grounded answer rejected): "
            f"{_rate(len(probe.false_drops), probe.paraphrased)}",
            f"- False keep (on-topic hallucination accepted): "
            f"{_rate(len(probe.false_keeps), probe.hallucinated)}",
        ]
        if probe.missing_decks:
            out.append(f"- Not scored, deck missing: {', '.join(_label(d) for d in probe.missing_decks)}")
        out += [
            "",
            "| Deck | Slide | Kind | Answer | Score | Reason | Kept |",
            "|---|---:|---|---|---:|---|---|",
        ]
        for o in probe.outcomes:
            out.append(f"| {_label(o.pair.deck)} | {o.pair.slide} | {o.kind} | {o.answer} | "
                       f"{o.score:.3f} | {o.reason} | {'yes' if o.accepted else 'no'} |")
    return "\n".join(out) + "\n"


# ── CLI ──────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m backend.eval.deck_lab",
        description="Old-vs-new slide selection scorecard on real lecture PDFs (no LLM calls).",
    )
    p.add_argument("--decks", nargs="+", metavar="NAME",
                   help="deck file names inside --dir (default: every lecture deck found there)")
    p.add_argument("--dir", default=None,
                   help="directory holding the PDFs (default: $DECK_LAB_DIR or ~/Downloads)")
    p.add_argument("--out", default=None, help="write the markdown here instead of stdout")
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    deck_dir = Path(args.dir).expanduser() if args.dir else decks.DECK_DIR
    names = list(args.decks) if args.decks else discover_decks(deck_dir)
    if not names:
        print(f"no lecture decks found in {deck_dir}", file=sys.stderr)
        return 1
    reports: list[DeckReport] = []
    for name in names:
        pages = real_deck_pages(name, deck_dir)
        if pages is None:
            print(f"deck not found: {name!r} in {deck_dir}", file=sys.stderr)
            return 1
        reports.append(score_deck(name, pages))
    skeletons: dict[str, DeckSkeleton] = {}
    for deck in PROBE_DECKS:
        pages = real_deck_pages(deck, deck_dir)
        if pages is not None:
            skeletons[deck] = build_deck_skeleton(pages)
    probe = run_grounding_probe(PROBE_PAIRS, skeletons)
    md = render_markdown(reports, probe, provenance_lines(deck_dir, names, probe.threshold))
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(md, encoding="utf-8")
        print(f"wrote {out}")
    else:
        print(md, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Append to `backend/eval/README.md`:
````markdown
---

## Deck Lab — offline slide-selection scorecard (no LLM, no DB)

```bash
python -m backend.eval.deck_lab                                  # every deck in ~/Downloads, markdown to stdout
python -m backend.eval.deck_lab --out docs/DECK_LAB_2026_10.md   # the committed run
python -m backend.eval.deck_lab --dir /path/to/pdfs --decks "07 DBS Transactions.pdf"
```

Reads the real PDFs (`backend/eval/decks.py`; `$DECK_LAB_DIR` overrides
`~/Downloads`; `-2`/`Kopie` copies are skipped), builds the deck skeleton, and
compares the pre-f34a787 selectors (`legacy_quiz_selection`,
`legacy_meta_selection`, re-implemented in `deck_lab.py`) with the live ones
(`select_slides`, `select_meta_slides`). It also runs the grounding
drop-risk probe (`backend/eval/data/grounding_probe.py`) at the unchanged
`SUPPORT_THRESHOLD`. The generated markdown is committed as-is; never edit
its numbers by hand. Rerun the tool instead.

Tests: `pytest backend/tests/unit/test_deck_lab_metrics.py backend/tests/unit/test_deck_lab_probe.py backend/tests/unit/test_deck_lab_cli.py backend/tests/unit/test_grounding_probe_set.py`
````

**Step 4: green, then the full suite**
- `$PY -m pytest backend/tests/unit/test_deck_lab_cli.py -m "not db" -q`: 6 pass.
- `$PY -m pytest backend/tests/unit -m "not db" -q`: no new failures.

**Step 5: mutation check**
- In the quiz row of `render_markdown`, swap `f"{r.quiz_covered_old} | {r.quiz_covered_new} | {r.span_old:.2f} | {r.span_new:.2f} |"` to `f"{r.quiz_covered_new} | {r.quiz_covered_old} | {r.span_old:.2f} | {r.span_new:.2f} |"`.
  - `test_cli_writes_scorecard_for_discovered_decks` fails.
  - Revert.
- In `main`, change `names = list(args.decks) if args.decks else discover_decks(deck_dir)` to `names = list(args.decks) if args.decks else sorted(p.name for p in deck_dir.glob("*.pdf"))`.
  - The same test fails: `Syn-2` appears.
  - Revert. Green.

**Step 6: commit the code**

Commit: `feat(eval): deck lab CLI renders the old-vs-new scorecard as markdown`

Commit this before the real run, so the provenance `commit` line is a clean sha.

**Step 7: the real run (manual step, numbers are never hand-edited)**
1. `$PY -m backend.eval.deck_lab --out docs/DECK_LAB_2026_10.md`. Expect `wrote docs/DECK_LAB_2026_10.md`.
2. Sanity checks:
   - `grep -c "decks)" docs/DECK_LAB_2026_10.md` should show the total rows.
   - `grep "Total (25 decks)" docs/DECK_LAB_2026_10.md` should match: 11 DBS + 14 SR, as counted in `~/Downloads` on 2026-10-11.
   - `grep -E "^- False (drop|keep)" docs/DECK_LAB_2026_10.md` should show two lines, each over `/16`.
3. Determinism check. Run again into the scratchpad, then diff with the header lines removed. The diff must be empty:
   ```
   $PY -m backend.eval.deck_lab --out "$SCRATCH/lab2.md"
   diff <(grep -v -e '^  generated' -e '^  commit' docs/DECK_LAB_2026_10.md) <(grep -v -e '^  generated' -e '^  commit' "$SCRATCH/lab2.md")
   ```
4. Do not edit the file. Do not change `SUPPORT_THRESHOLD` or any probe pair because of the result, even if the false-drop rate is high. If it is high, that is the finding: it goes in the commit body and becomes the input for a later arc.
5. Commit: `docs(eval): Deck Lab 2026-10 scorecard on real DBS/SR decks`. For the body, paste the output of `grep -E "^\- False|\*\*Total" docs/DECK_LAB_2026_10.md` verbatim, so no number is typed by hand.

---

## Follow-up outside this arc

Per-slide synthesis still sends raw, unstripped page text. In `unified_orchestrator.py` this is `text_items = [(i, raw_slides[i]) ...]` (~line 739) and `_synthesize_slide(i, raw_slides[i], ...)`. The scorecard's "tokens saved per slide prompt" is therefore a potential saving, not a realized one, and the render text says so. Making it real is a separate change: pass `skeleton.slides[i].text` when a skeleton exists.

### Critical Files for Implementation
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/eval/deck_lab.py (new)
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/eval/decks.py (new; replaces the helper in backend/tests/unit/test_deck_plan_real_decks.py)
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/eval/data/grounding_probe.py (new)
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/services/parser/deck_plan.py (adds select_meta_slides)
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/services/parser/synthesis.py (calls select_meta_slides)