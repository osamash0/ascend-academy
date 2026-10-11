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
