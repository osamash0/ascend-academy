# AI Backend Deep Session — "The Parser Learns to Read a Deck" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the parser from "read the first N slides" to "understand the deck first". Prove every step with tests that can fail: property-based, metamorphic, chaos and mutation-verified tests. Real lecture decks act as the final judge.

**Architecture:** A new pure layer, the **Deck Cartographer** (`services/parser/deck_plan.py`), turns raw page texts into a `DeckSkeleton`. The skeleton holds the boilerplate lines, a role for each slide, and the sections. It makes no LLM call, so it can be tested exhaustively. Each later stage (quiz sampling, lecture meta, grounding checks, receipts) reads the skeleton instead of slicing `slides[:10]`. The AI layer gets a **Chaos Lab**: scripted fake providers drive `orchestrator.py` through 402/429/503/timeout/garbage-JSON storms, and property tests check the invariants that broke in production before.

**Tech Stack:** Python 3.11, FastAPI, pytest + pytest-asyncio, **hypothesis** (new dev dependency), PyMuPDF (`fitz`), Supabase/Postgres + pgvector (db tests via testcontainers), respx.

**Spec:** the agreed "deck plan first" direction from the 2026-09-17 parser review (memory `project-parser-redesign-2026-09`). Arcs 1–2 below are its deterministic core. Arcs 3–6 each get their own detailed plan file, written when the arc starts, because their exact interfaces depend on code read at that point (see "Arc plans written at arc start").

## Global Constraints

- Python: `/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python` (the worktree has no venv). Run all commands from the worktree root.
- Unit suite command: `.venv-python -m pytest backend/tests -m "not db" -q`, where `.venv-python` is the absolute path above. Baseline on 2026-10-10: record it in Task 0. Never drop below baseline.
- **TDD is literal.** Write the test, run it, see the expected failure, then implement. Writing a test that passes on its first run means it was never shown to catch anything.
- **Mutation-verify every guard.** After a task is green, put the defect back with a Python exact-string replace (`assert target in src`, never `sed` with brackets). Confirm a `N failed` line appears, then restore and check `git diff --stat` is clean for that file. A run that prints nothing counts as broken, not passed.
- **Never** run `supabase db push`. Never write to the prod Supabase project (`lkiiideqjoiksnycgplc`). Migrations exist as files only and are tested via `pytest -m db` (testcontainers).
- Never dispatch the CI workflow (its E2E job mutates the real project). No `git push` without asking the user.
- No bare `git stash`. Use WIP commits instead (other sessions share the stash stack).
- Prompt text changes need a version bump in `backend/services/ai/prompts.py` `PROMPT_VERSIONS`.
- Commit after every task, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Real decks live in `~/Downloads` (`00 DBS Introduction.pdf` 66pp, ` 03__SR_Prozesse_v07_27.04.2025.pdf` 85pp). Tests that use them read `DECK_LAB_DIR` (default `~/Downloads`) and **skip** when the file is absent, so CI stays green.

---

## Session map

| Arc | Name | Layer | Creative testing technique | Ships |
|---|---|---|---|---|
| 0 | Instruments | tests | hypothesis + synthetic deck strategy | dev dep, `deck_strategies.py` |
| 1 | Deck Cartographer | parsing | property + metamorphic + real-deck characterization | `deck_plan.py` |
| 2 | Coverage-aware synthesis | parsing / AI | regression for the slides[:10] bias, fixes the renumbering bug | sampler wired into quiz + meta |
| 3 | Provider Chaos Lab | AI layer | fault-injection simulator + invariant properties | `tests/chaos/` |
| 4 | Grounded quiz verifier | AI layer | support scoring + adversarial fixtures | `quiz_grounding.py`, reconciliation loop |
| 5 | Parse receipts | DB + API | migration + RLS db tests + endpoint ownership tests | `parse_receipts` table, `GET /api/v1/lectures/{id}/parse-receipt` |
| 6 | Deck Lab scorecard | eval | before/after on real decks, no LLM needed for coverage metrics | `backend/eval/deck_lab.py` + report |

Order rationale: Arcs 1–2 are pure, low-risk and unblock everything else. Arc 3 hardens the layer every later LLM call depends on. Arc 4 needs Arc 2's original slide indices. Arc 5 persists what 1–4 produce. Arc 6 is the proof. Each arc ends shippable on its own.

---

## Arc 0 — Instruments

### Task 0: Baseline + hypothesis + synthetic deck strategy

**Files:**
- Modify: `backend/requirements-dev.txt`
- Create: `backend/tests/support/__init__.py`, `backend/tests/support/deck_strategies.py`
- Test: `backend/tests/unit/test_deck_strategies.py`

**Interfaces:**
- Produces: `decks(min_pages=4, max_pages=40) -> SearchStrategy[list[str]]` and `FOOTER_LINES: tuple[str, ...]`, used by Arcs 1, 2, 6.

- [ ] **Step 1: Record the baseline**

Run: `PY=/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python; $PY -m pytest backend/tests -m "not db" -q 2>&1 | tail -3`
Write the passed/failed counts into the session log at the bottom of this file.

- [ ] **Step 2: Add hypothesis**

Append to `backend/requirements-dev.txt` under the HTTP mocking block:
```
# ── Property-based testing (deck cartographer, chaos lab) ────────────────────
hypothesis>=6.100
```
Run: `$PY -m pip install "hypothesis>=6.100"`. Then run `$PY -m pytest backend/tests/unit/test_requirements_parity.py -q`. If parity rejects a dev-only package, add `hypothesis` to that test's allowlist with a comment.

- [ ] **Step 3: Write the failing strategy test**

```python
# backend/tests/unit/test_deck_strategies.py
from hypothesis import given, settings
from backend.tests.support.deck_strategies import decks, FOOTER_LINES


@settings(max_examples=50)
@given(decks())
def test_generated_decks_carry_footer_on_every_page(pages):
    assert len(pages) >= 4
    for page in pages:
        for line in FOOTER_LINES:
            assert line.split("{n}")[0] in page
```

Run: `$PY -m pytest backend/tests/unit/test_deck_strategies.py -q`. Expected: FAIL with `ModuleNotFoundError: backend.tests.support`.

- [ ] **Step 4: Implement the strategy**

```python
# backend/tests/support/deck_strategies.py
"""Hypothesis strategies that generate lecture-deck-shaped page texts.

Each generated deck has a title page, optional section dividers, and content
pages, and every page carries the same footer — just like a real export,
where '{n}' becomes the page number. That gives tests a known ground truth
for boilerplate and roles.
"""
from __future__ import annotations

from hypothesis import strategies as st

FOOTER_LINES = ("Prof. Dr. Example | Datenbanksysteme", "Seite {n}")

_WORD = st.text(alphabet="abcdefghijklmnopqrstuvwxyzäöü", min_size=3, max_size=10)
_SENTENCE = st.lists(_WORD, min_size=6, max_size=14).map(lambda ws: " ".join(ws).capitalize() + ".")
_CONTENT = st.lists(_SENTENCE, min_size=2, max_size=6).map("\n".join)


def _with_footer(body: str, n: int) -> str:
    return body + "\n" + "\n".join(line.replace("{n}", str(n)) for line in FOOTER_LINES)


@st.composite
def decks(draw, min_pages: int = 4, max_pages: int = 40) -> list[str]:
    n = draw(st.integers(min_value=min_pages, max_value=max_pages))
    bodies = ["Lecture Title\nWinter 2026"]
    for _ in range(n - 1):
        bodies.append(draw(_CONTENT))
    return [_with_footer(b, i + 1) for i, b in enumerate(bodies)]
```
Also create an empty `backend/tests/support/__init__.py`.

- [ ] **Step 5: Run, then commit**

Run: `$PY -m pytest backend/tests/unit/test_deck_strategies.py -q`. Expected: `1 passed`.
```bash
git add backend/requirements-dev.txt backend/tests/support backend/tests/unit/test_deck_strategies.py
git commit -m "test: add hypothesis and a synthetic lecture-deck strategy"
```

---

## Arc 1 — Deck Cartographer (pure, no LLM)

`services/parser/deck_plan.py` is the single source of deck structure. Each function in it is pure and deterministic, and nothing in it calls the network.

### Task 1: Boilerplate detection and stripping

**Files:**
- Create: `backend/services/parser/deck_plan.py`
- Test: `backend/tests/unit/test_deck_plan_boilerplate.py`

**Interfaces:**
- Produces: `normalize_line(line: str) -> str`, `find_boilerplate(pages: list[str], min_share: float = 0.6, min_pages: int = 4) -> frozenset[str]`, `strip_boilerplate(page: str, boilerplate: frozenset[str]) -> str`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/unit/test_deck_plan_boilerplate.py
import random

from hypothesis import given, settings
from backend.services.parser.deck_plan import find_boilerplate, normalize_line, strip_boilerplate
from backend.tests.support.deck_strategies import decks, FOOTER_LINES


def test_page_numbers_normalize_to_one_line():
    assert normalize_line("Seite 3 / 66") == normalize_line("  Seite 41 /  66 ")


def test_repeated_footer_is_found_and_unique_lines_are_not():
    pages = [f"Topic {c}\nUnique body {c}\nUni Marburg | DBS\nSeite {i}" for i, c in enumerate("abcdef")]
    bp = find_boilerplate(pages)
    assert normalize_line("Uni Marburg | DBS") in bp
    assert normalize_line("Seite 1") in bp
    assert not any("unique body" in line for line in bp)


def test_short_decks_never_report_boilerplate():
    pages = ["Same\nA", "Same\nB", "Same\nC"]
    assert find_boilerplate(pages) == frozenset()


def test_a_line_repeated_on_one_page_counts_once():
    pages = ["x\nx\nx\nx\nx"] + [f"page {i}" for i in range(5)]
    assert normalize_line("x") not in find_boilerplate(pages)


def test_strip_keeps_order_of_remaining_lines():
    bp = frozenset({normalize_line("Footer")})
    assert strip_boilerplate("a\nFooter\nb\nc", bp) == "a\nb\nc"


@settings(max_examples=60)
@given(decks())
def test_property_generated_footer_is_always_detected_and_removed(pages):
    bp = find_boilerplate(pages)
    for line in FOOTER_LINES:
        assert normalize_line(line.replace("{n}", "7")) in bp
    for page in pages:
        stripped = strip_boilerplate(page, bp)
        assert "Datenbanksysteme" not in stripped


@settings(max_examples=40)
@given(decks())
def test_metamorphic_page_order_does_not_change_boilerplate(pages):
    shuffled = pages[:]
    random.Random(0).shuffle(shuffled)
    assert find_boilerplate(shuffled) == find_boilerplate(pages)
```

- [ ] **Step 2: Run and see it fail**

Run: `$PY -m pytest backend/tests/unit/test_deck_plan_boilerplate.py -q`. Expected: FAIL with `ModuleNotFoundError ... deck_plan`.

- [ ] **Step 3: Implement**

```python
# backend/services/parser/deck_plan.py
"""Deck Cartographer — deterministic deck structure before any LLM call.

The pipeline used to read the first 15 slides for lecture meta and the
first 10 for the quiz (constants inherited from v4 and never chosen). This
module computes structure for the WHOLE deck instead: boilerplate lines
repeated by the export template, a role for each slide, and section
boundaries. It is pure: no I/O, no network, deterministic for a given input.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Iterable

_WS = re.compile(r"\s+")
_DIGITS = re.compile(r"\d+")


def normalize_line(line: str) -> str:
    """Case-fold, collapse whitespace, and replace digit runs with '#', so
    'Seite 3 / 66' and 'Seite 41 / 66' count as the same template line."""
    return _DIGITS.sub("#", _WS.sub(" ", line).strip().lower())


def _lines(page: str) -> Iterable[str]:
    return (ln for ln in page.splitlines() if ln.strip())


def find_boilerplate(pages: list[str], min_share: float = 0.6, min_pages: int = 4) -> frozenset[str]:
    """Normalized lines present on at least ``min_share`` of pages.

    Each line is counted at most once per page. Decks shorter than
    ``min_pages`` have too little evidence, so they report nothing."""
    if len(pages) < min_pages:
        return frozenset()
    counts: Counter[str] = Counter()
    for page in pages:
        counts.update({normalize_line(ln) for ln in _lines(page)})
    threshold = min_share * len(pages)
    return frozenset(line for line, c in counts.items() if line and c >= threshold)


def strip_boilerplate(page: str, boilerplate: frozenset[str]) -> str:
    return "\n".join(ln for ln in _lines(page) if normalize_line(ln) not in boilerplate)
```

- [ ] **Step 4: Run to green**

Run: `$PY -m pytest backend/tests/unit/test_deck_plan_boilerplate.py -q`. Expected: `7 passed`.

- [ ] **Step 5: Mutation-verify**

Use a Python exact replace to change `{normalize_line(ln) for ln in _lines(page)}` (a set) into `[normalize_line(ln) for ln in _lines(page)]` (a list). Expect `test_a_line_repeated_on_one_page_counts_once` to fail. Then change `_DIGITS.sub("#", ...)` to drop the digit substitution. Expect the page-number tests to fail. Restore both and confirm with `git diff --stat`.

- [ ] **Step 6: Commit**

```bash
git add backend/services/parser/deck_plan.py backend/tests/unit/test_deck_plan_boilerplate.py
git commit -m "feat(parser): deck cartographer — boilerplate detection"
```

### Task 2: Slide roles and sections → `DeckSkeleton`

**Files:**
- Modify: `backend/services/parser/deck_plan.py`
- Test: `backend/tests/unit/test_deck_plan_skeleton.py`

**Interfaces:**
- Consumes: Task 1 functions.
- Produces:
  - `class SlideRole(str, Enum)` with values `title, agenda, section, content, exercise, summary, references, empty`
  - `classify_role(index: int, text: str) -> SlideRole` (`text` must already be stripped of boilerplate)
  - `@dataclass(frozen=True) class SlidePlan: index: int; role: SlideRole; text: str; section: int`
  - `@dataclass(frozen=True) class Section: index: int; title: str; start: int; end: int` (`end` is inclusive)
  - `@dataclass(frozen=True) class DeckSkeleton: boilerplate: frozenset[str]; slides: tuple[SlidePlan, ...]; sections: tuple[Section, ...]`
  - `build_deck_skeleton(pages: list[str]) -> DeckSkeleton`

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/unit/test_deck_plan_skeleton.py
import pytest
from hypothesis import given, settings

from backend.services.parser.deck_plan import SlideRole, build_deck_skeleton, classify_role
from backend.tests.support.deck_strategies import decks

LONG = "Relational algebra defines selection, projection and join over sets of tuples in detail."


@pytest.mark.parametrize("index,text,role", [
    (0, "Datenbanksysteme\nWS 2026", SlideRole.TITLE),
    (3, "", SlideRole.EMPTY),
    (3, "Agenda\n1. Intro\n2. SQL", SlideRole.AGENDA),
    (3, "Gliederung\nTeil A", SlideRole.AGENDA),
    (3, "Übung 2\n" + LONG, SlideRole.EXERCISE),
    (3, "Exercise: normalize this schema\n" + LONG, SlideRole.EXERCISE),
    (3, "Zusammenfassung\n" + LONG, SlideRole.SUMMARY),
    (3, "Summary\n" + LONG, SlideRole.SUMMARY),
    (3, "Literatur\nElmasri, Navathe", SlideRole.REFERENCES),
    (3, "2. Relationale Algebra", SlideRole.SECTION),
    (3, "Selection\n" + LONG, SlideRole.CONTENT),
])
def test_classify_role(index, text, role):
    assert classify_role(index, text) is role


def test_sections_start_at_dividers_and_partition_the_deck():
    pages = ["Title", "Intro text " + LONG, "1. Basics", LONG, LONG, "2. SQL", LONG]
    sk = build_deck_skeleton(pages)
    assert [(s.title, s.start, s.end) for s in sk.sections] == [
        ("Title", 0, 1), ("1. Basics", 2, 4), ("2. SQL", 5, 6),
    ]
    assert [p.section for p in sk.slides] == [0, 0, 1, 1, 1, 2, 2]


@settings(max_examples=60)
@given(decks())
def test_property_sections_are_a_contiguous_partition(pages):
    sk = build_deck_skeleton(pages)
    covered = [i for s in sk.sections for i in range(s.start, s.end + 1)]
    assert covered == list(range(len(pages)))
    assert all(sk.slides[i].section == s.index for s in sk.sections for i in range(s.start, s.end + 1))


@settings(max_examples=60)
@given(decks())
def test_property_roles_never_see_boilerplate(pages):
    sk = build_deck_skeleton(pages)
    assert sk.slides[0].role is SlideRole.TITLE
    assert all("Datenbanksysteme" not in p.text for p in sk.slides)


@settings(max_examples=40)
@given(decks(min_pages=6))
def test_metamorphic_appending_a_page_keeps_existing_roles(pages):
    before = build_deck_skeleton(pages)
    after = build_deck_skeleton(pages + [pages[-1]])
    if before.boilerplate == after.boilerplate:
        assert [p.role for p in after.slides[: len(pages)]] == [p.role for p in before.slides]
```

- [ ] **Step 2: Run and see it fail**

Run: `$PY -m pytest backend/tests/unit/test_deck_plan_skeleton.py -q`. Expected: FAIL with `ImportError: cannot import name 'SlideRole'`.

- [ ] **Step 3: Implement (append to `deck_plan.py`)**

```python
from dataclasses import dataclass
from enum import Enum


class SlideRole(str, Enum):
    TITLE = "title"
    AGENDA = "agenda"
    SECTION = "section"
    CONTENT = "content"
    EXERCISE = "exercise"
    SUMMARY = "summary"
    REFERENCES = "references"
    EMPTY = "empty"


# Matched against the slide's FIRST non-empty line only. Lecture decks here
# are German or English, so each pattern covers both.
_HEADING_ROLES: tuple[tuple[re.Pattern[str], SlideRole], ...] = (
    (re.compile(r"^(agenda|outline|overview|inhalt|gliederung|übersicht)\b", re.I), SlideRole.AGENDA),
    (re.compile(r"^(übung|uebung|aufgabe|exercise|quiz|task)\b", re.I), SlideRole.EXERCISE),
    (re.compile(r"^(zusammenfassung|summary|fazit|recap|conclusion|takeaways?)\b", re.I), SlideRole.SUMMARY),
    (re.compile(r"^(literatur|references|quellen|bibliography|further reading)\b", re.I), SlideRole.REFERENCES),
)
_SECTION_MAX_WORDS = 6


@dataclass(frozen=True)
class SlidePlan:
    index: int
    role: SlideRole
    text: str
    section: int


@dataclass(frozen=True)
class Section:
    index: int
    title: str
    start: int
    end: int  # inclusive


@dataclass(frozen=True)
class DeckSkeleton:
    boilerplate: frozenset[str]
    slides: tuple[SlidePlan, ...]
    sections: tuple[Section, ...]


def classify_role(index: int, text: str) -> SlideRole:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines or len(" ".join(lines)) < 3:
        return SlideRole.EMPTY
    if index == 0:
        return SlideRole.TITLE
    for pattern, role in _HEADING_ROLES:
        if pattern.match(lines[0]):
            return role
    if len(lines) <= 2 and len(" ".join(lines).split()) <= _SECTION_MAX_WORDS:
        return SlideRole.SECTION
    return SlideRole.CONTENT


def _first_line(text: str) -> str:
    return next((ln.strip() for ln in text.splitlines() if ln.strip()), "")


def build_deck_skeleton(pages: list[str]) -> DeckSkeleton:
    boilerplate = find_boilerplate(pages)
    texts = [strip_boilerplate(p, boilerplate) for p in pages]
    roles = [classify_role(i, t) for i, t in enumerate(texts)]

    starts = [0] + [i for i, r in enumerate(roles) if r is SlideRole.SECTION and i != 0]
    sections = tuple(
        Section(index=k, title=_first_line(texts[s]), start=s,
                end=(starts[k + 1] - 1 if k + 1 < len(starts) else len(pages) - 1))
        for k, s in enumerate(starts)
    ) if pages else ()

    section_of = {i: s.index for s in sections for i in range(s.start, s.end + 1)}
    slides = tuple(
        SlidePlan(index=i, role=roles[i], text=texts[i], section=section_of[i])
        for i in range(len(pages))
    )
    return DeckSkeleton(boilerplate=boilerplate, slides=slides, sections=sections)
```
Move the `dataclass`/`Enum` imports to the top of the module with the others.

- [ ] **Step 4: Run to green.** Expected: `15 passed`. If a generated sentence starts with a role keyword (for example "Summary ..."), that is a real ambiguity, not a flaky test. Fix it by making `_WORD` exclude those keywords in `deck_strategies.py`, and note it in the session log.

- [ ] **Step 5: Mutation-verify.** (a) Change `if index == 0:` to `if index == -1:`. Expect the TITLE assertions to fail. (b) Make `build_deck_skeleton` use raw `pages` for roles instead of `texts`. Expect `test_property_roles_never_see_boilerplate` to fail. Restore both.

- [ ] **Step 6: Commit** — `git commit -m "feat(parser): deck skeleton — slide roles and sections"`

### Task 3: Real-deck characterization tests (Deck Lab fixtures)

**Files:**
- Create: `backend/tests/unit/test_deck_plan_real_decks.py`

**Interfaces:**
- Consumes: `build_deck_skeleton`, PyMuPDF `fitz`.
- Produces: a `real_deck_pages(name) -> list[str] | None` helper, defined in this test file and reused by Arc 6.

- [ ] **Step 1: Write the test**

```python
# backend/tests/unit/test_deck_plan_real_decks.py
"""Characterization tests against the user's real lecture decks.

These are skipped when the PDFs are absent (CI). They pin what the
2026-09-17 review measured by hand: the DBS deck repeats template lines on
all 66 pages, which used to leak into every per-slide prompt."""
import os
from pathlib import Path

import pytest

from backend.services.parser.deck_plan import SlideRole, build_deck_skeleton

DECK_DIR = Path(os.environ.get("DECK_LAB_DIR", Path.home() / "Downloads"))


def real_deck_pages(name: str):
    path = DECK_DIR / name
    if not path.exists():
        return None
    import fitz
    with fitz.open(path) as doc:
        return [page.get_text("text") for page in doc]


@pytest.fixture
def dbs():
    pages = real_deck_pages("00 DBS Introduction.pdf")
    if pages is None:
        pytest.skip("real DBS deck not available")
    return pages


def test_dbs_deck_has_template_boilerplate(dbs):
    sk = build_deck_skeleton(dbs)
    assert len(dbs) == 66
    assert len(sk.boilerplate) >= 3


def test_dbs_deck_stripping_removes_less_than_half_the_text(dbs):
    sk = build_deck_skeleton(dbs)
    raw = sum(len(p) for p in dbs)
    kept = sum(len(s.text) for s in sk.slides)
    assert 0.5 * raw < kept < raw


def test_dbs_deck_is_mostly_content(dbs):
    sk = build_deck_skeleton(dbs)
    content = sum(1 for s in sk.slides if s.role is SlideRole.CONTENT)
    assert content >= 0.5 * len(dbs)
```

- [ ] **Step 2: Run it.** Expected: `3 passed` locally. Then run `DECK_LAB_DIR=/nonexistent $PY -m pytest backend/tests/unit/test_deck_plan_real_decks.py -q`. Expected: `3 skipped`.
- [ ] **Step 3: Print the observed skeleton** (role histogram, section titles, boilerplate lines) into the session log. If any section title looks wrong (for example a slide reading only "Beispiel" counted as a section), add that exact string as a parametrized case in `test_classify_role` **first** (red), fix the heuristic, and go green. Real data drives the heuristics. Hypothesis stops them from regressing.
- [ ] **Step 4: Commit** — `git commit -m "test(parser): characterize the cartographer on real lecture decks"`

---

## Arc 2 — Coverage-aware synthesis (kills the `slides[:10]` bias)

**Bug found while planning:** `generate_quiz_questions` filters slides and then labels them `[Slide {i + 1}]` by **position in the filtered list**. So `[Slide 3]` in the prompt is often not slide 3 of the deck. Any slide reference the model produces is off. `analyze_lecture_meta` only ever sees the first 15 slides.

### Task 4: `select_slides` — a deterministic, section-balanced sampler

**Files:**
- Modify: `backend/services/parser/deck_plan.py`
- Test: `backend/tests/unit/test_deck_plan_sampler.py`

**Interfaces:**
- Produces: `select_slides(skeleton: DeckSkeleton, budget: int, roles: frozenset[SlideRole] = QUIZ_ROLES, min_chars: int = 50) -> list[int]` (sorted original indices), plus `QUIZ_ROLES = frozenset({CONTENT, SUMMARY, EXERCISE})` and `META_ROLES = frozenset({TITLE, AGENDA, SECTION, SUMMARY, CONTENT})`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/unit/test_deck_plan_sampler.py
from hypothesis import given, settings, strategies as st

from backend.services.parser.deck_plan import QUIZ_ROLES, build_deck_skeleton, select_slides
from backend.tests.support.deck_strategies import decks

BODY = "A relational schema decomposes into BCNF when every determinant is a key of the relation."


def tag(i: int) -> str:
    # Letters, not digits: normalize_line folds digit runs to '#', so
    # "Point 3" and "Point 7" would be ONE repeated line and get stripped
    # as boilerplate.
    return "".join(chr(97 + int(d)) for d in str(i))


def _deck(n_sections: int, per_section: int) -> list[str]:
    pages = ["Course Title"]
    for s in range(n_sections):
        pages.append(f"{s + 1}. Chapter")
        pages += [f"Case {tag(s * 100 + k)}: {BODY}" for k in range(per_section)]
    return pages


def test_regression_reaches_beyond_the_first_ten_slides():
    sk = build_deck_skeleton(_deck(4, 10))
    picked = select_slides(sk, budget=10)
    assert max(picked) > 20


def test_every_section_is_represented_when_budget_allows():
    sk = build_deck_skeleton(_deck(5, 8))
    picked = select_slides(sk, budget=10)
    assert {sk.slides[i].section for i in picked} == {1, 2, 3, 4, 5}


@settings(max_examples=80)
@given(decks(), st.integers(min_value=0, max_value=30))
def test_property_sampler_contract(pages, budget):
    sk = build_deck_skeleton(pages)
    picked = select_slides(sk, budget=budget)
    eligible = [s.index for s in sk.slides if s.role in QUIZ_ROLES and len(s.text) >= 50]
    assert picked == sorted(set(picked))
    assert set(picked) <= set(eligible)
    assert len(picked) == min(budget, len(eligible))
    assert select_slides(sk, budget=budget) == picked  # deterministic
```

- [ ] **Step 2: Run and see it fail.** Expected: `ImportError: cannot import name 'select_slides'`.

- [ ] **Step 3: Implement**

```python
QUIZ_ROLES = frozenset({SlideRole.CONTENT, SlideRole.SUMMARY, SlideRole.EXERCISE})
META_ROLES = frozenset({SlideRole.TITLE, SlideRole.AGENDA, SlideRole.SECTION, SlideRole.SUMMARY, SlideRole.CONTENT})


def _spread(items: list[int], k: int) -> list[int]:
    """k evenly spaced picks from items, always including the first."""
    if k >= len(items):
        return list(items)
    step = len(items) / k
    return [items[int(j * step)] for j in range(k)]


def select_slides(
    skeleton: DeckSkeleton, budget: int,
    roles: frozenset[SlideRole] = QUIZ_ROLES, min_chars: int = 50,
) -> list[int]:
    """Pick up to ``budget`` slides spread across ALL sections.

    Round-robin over sections hands each section an equal share. Leftover
    budget goes to the sections with the most eligible slides. Inside a
    section, picks are evenly spaced, not front-loaded."""
    by_section: dict[int, list[int]] = {}
    for s in skeleton.slides:
        if s.role in roles and len(s.text) >= min_chars:
            by_section.setdefault(s.section, []).append(s.index)
    if budget <= 0 or not by_section:
        return []
    quota = {sec: 0 for sec in by_section}
    remaining = budget
    while remaining > 0:
        progressed = False
        for sec in sorted(by_section, key=lambda k: (-len(by_section[k]), k)):
            if remaining and quota[sec] < len(by_section[sec]):
                quota[sec] += 1
                remaining -= 1
                progressed = True
        if not progressed:
            break
    return sorted(i for sec, idxs in by_section.items() for i in _spread(idxs, quota[sec]))
```

- [ ] **Step 4: Green.** **Step 5: Mutation-verify** by replacing the body with `return sorted(eligible)[:budget]`, which is the old behavior. Expect both regression tests to fail. Restore. **Step 6: Commit** — `feat(parser): section-balanced slide sampler`.

### Task 5: Wire the sampler into quiz + meta, and fix slide numbering

**Files:**
- Modify: `backend/services/parser/synthesis.py` (`analyze_lecture_meta`, `generate_quiz_questions`)
- Modify: `backend/services/parser/unified_orchestrator.py` (the two call sites, ~L621 and ~L852): build the skeleton once per run, after `raw_slides` exists
- Modify: `backend/services/ai/prompts.py` (bump `LECTURE_META_ANALYSIS_PROMPT` and `SYNTHESIS_DECK_QUIZ_PROMPT` versions only if their template text changes; label changes in the code alone need no bump)
- Test: extend `backend/tests/unit/test_synthesis.py`

**Interfaces:**
- `generate_quiz_questions(slides, lecture_title, ai_model, source_language="en", skeleton: DeckSkeleton | None = None)`. When `skeleton` is None it builds one from `slides`. That keeps every existing caller and test valid.
- `analyze_lecture_meta(..., skeleton: DeckSkeleton | None = None)` uses `select_slides(skeleton, 15, META_ROLES, min_chars=1)`, always plus slide 0.

- [ ] **Step 1: Failing tests** (append to `test_synthesis.py`, which reuses its `llm` fixture):

```python
async def test_quiz_prompt_labels_slides_with_their_real_deck_numbers(llm):
    xenon = "The xenon atom has many electrons and reacts rarely with other elements."
    yttrium = "The yttrium metal is silvery and appears in rare earth mineral deposits."
    slides = ["Title", "short", xenon, "tiny", yttrium]
    llm["reply"] = "[]"
    await synthesis.generate_quiz_questions(slides, "T", "groq")
    prompt = llm["bulk_prompts"][0]
    assert "[Slide 3]: The xenon" in prompt and "[Slide 5]: The yttrium" in prompt
    assert "[Slide 1]: The xenon" not in prompt


async def test_quiz_sees_late_slides_of_a_long_deck(llm):
    tag = lambda i: "".join(chr(97 + int(d)) for d in str(i))  # letters survive normalize_line
    slides = ["Title"] + [f"Fact {tag(i)} states that indexes speed up lookups on large tables." for i in range(40)]
    llm["reply"] = "[]"
    await synthesis.generate_quiz_questions(slides, "T", "groq")
    assert any(f"Fact {tag(i)} " in llm["bulk_prompts"][0] for i in range(30, 40))


async def test_meta_sees_slides_beyond_fifteen(llm):
    tag = lambda i: "".join(chr(97 + int(d)) for d in str(i))
    slides = ["Title"] + [
        f"1. Part {i}" if i % 10 == 0 else f"Note {tag(i)} explains how transactions keep data consistent."
        for i in range(60)
    ]
    llm["reply"] = "{}"
    await synthesis.analyze_lecture_meta(slides, "groq")
    assert "Part 50" in llm["text_prompts"][0]
```
(Check the file's existing async marker convention first, `pytest.mark.asyncio` or auto mode, and match it.)

- [ ] **Step 2: Run, see 3 failures.** Expected: the first fails with `[Slide 1]: xxx` present, the second and third because late slides are absent.
- [ ] **Step 3: Implement.** In `generate_quiz_questions`: `skeleton = skeleton or build_deck_skeleton(slides)`, `picked = select_slides(skeleton, 10)`, label each with `[Slide {i + 1}]: {skeleton.slides[i].text[:500]}`. Feeding boilerplate-stripped text is intended, because it saves tokens. Same pattern for meta, with the `[:400]` cut. In the orchestrator, compute `skeleton = build_deck_skeleton(raw_slides)` once next to `detect_source_language` and pass it to both calls.
- [ ] **Step 4: Full unit suite** — run it and compare against the baseline. Existing tests that asserted the old `[Slide 1]` labelling are **wrong by design**. Update them, and name each in the commit message.
- [ ] **Step 5: Mutation-verify** by putting the `enumerate(...)` renumbering back. Expect the label test to fail. Restore.
- [ ] **Step 6: Commit** — `fix(parser): quiz/meta prompts cover the whole deck and cite real slide numbers`.

---

## Arc plans written at arc start

Each of these gets its own plan file `docs/superpowers/plans/2026-10-10-arc-N-<name>.md`, written at the start of the arc. Each is written after reading the exact code it touches, using the same task template (failing test → red → minimal code → green → mutation check → commit). The test contracts are fixed **now**, and the later plan may not weaken them.

### Arc 3 — Provider Chaos Lab (`backend/tests/chaos/`)
A `ScriptedProvider` replaces the HTTP layer for each provider id (via respx, or the orchestrator's provider-call seam, chosen after reading `orchestrator.py:147-960`). It plays a script per provider: `ok`, `429`, `402`, `503`, `timeout`, `garbage_json`, `ok_with_cost(x)`. Hypothesis generates random scripts across all chain legs. **Invariants (each one is a property test):**
1. After a leg returns 402, that leg receives zero more calls in the process (the 2026-09-18 bug where 402 was read as a rate limit).
2. The openai cumulative cost never exceeds `llm_openai_daily_cost_ceiling_usd` plus one call's cost, even when every other leg is failing (the "last-ditch re-admits the ceiling" bug).
3. Total attempts per `generate_text*` call are ≤ `len(chain) × max_retries`. No unbounded loop exists.
4. If any leg returns `ok`, the call returns that text. A garbage-JSON reply never reaches `parse_json_response` callers as a dict.
5. A vision leg that returns 404 is disabled after its first failure (50-slide deck → exactly 1 doomed call).

Every invariant is mutation-verified against the exact historical fix (revert the 402-before-quota ordering → invariant 1 fails).

### Arc 4 — Grounded quiz verifier (`services/ai/quiz_grounding.py`)
The quiz prompt (now with real slide numbers) asks for a `source_slide` per question. `support_score(question, skeleton) -> float` checks it deterministically: the content-token overlap between the correct answer + question stem and the cited slide's stripped text, with stop words removed for DE+EN. Below the threshold, the question is regenerated once against that slide, then dropped. Adversarial fixtures: a correct answer copied from a *different* slide, a hallucinated number, a distractor that matches the slide better than the key. Contract: zero shipped questions cite a non-existent slide, and the hallucination fixtures are all rejected.

### Arc 5 — Parse receipts (DB + API)
Migration `supabase/migrations/2026101000000_parse_receipts.sql`: a `parse_receipts` table (`run_id` PK→parse_runs, `lecture_id`, `deck_skeleton jsonb`, `slide_provenance jsonb` [provider, model, prompt_version, cost_usd, route per slide], `quiz_grounding jsonb`) with RLS mirroring `lectures` read access. db tests (`-m db`, testcontainers): the owner professor can read it, other professors cannot, anon cannot, students in the course can read only the skeleton view. Endpoint `GET /api/v1/lectures/{id}/parse-receipt` with `TestClient` + `fake_supabase` ownership tests (two professor JWTs, as in `test_courses_list_owner_scoping.py`). The orchestrator writes the receipt in its existing finalize step. **File only; never pushed to prod in this session.**

### Arc 6 — Deck Lab scorecard (`backend/eval/deck_lab.py`)
`python -m backend.eval.deck_lab --decks "00 DBS Introduction.pdf" " 03__SR_Prozesse_v07_27.04.2025.pdf"` prints a scorecard per deck, **old vs new**, with no LLM calls:
- section coverage of the quiz input (old `[:10]` vs `select_slides`)
- share of deck pages visible to the meta pass
- boilerplate tokens removed from per-slide prompts (≈ cost saved per parse)
- role histogram

Unit-tested on a synthetic deck with known answers. Output goes to `docs/DECK_LAB_2026_10.md`, which gives the thesis and Lehre@Philipp materials real before/after numbers.

---

## Session log

**Fixture rule (found in self-review):** synthetic slides must vary by *letters*, never digits. `normalize_line` folds digit runs, so numbered fixtures collapse into boilerplate.
(Filled in during execution: baseline counts, real-deck observations, mutation results, deviations.)
