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


def _interpretation(probe: ProbeResult) -> str:
    """The reading guide under the probe rates. Both the false-keep sentence and
    the consequence sentence follow the computed rates and the live flag."""
    from backend.services.parser import synthesis  # lazy: heavy import, read at render time

    keeps = len(probe.false_keeps)
    if keeps == 0:
        keep_sentence = ("A false-keep rate of zero shows only that lexically distant "
                         "hallucinations are rejected, not that the verifier cannot be fooled.")
    else:
        keep_sentence = (f"{keeps} hallucinated answer{'' if keeps == 1 else 's'} passed the "
                         "verifier, so lexical overlap can be fooled by on-topic wording.")
    if synthesis.ENFORCE_SUPPORT_THRESHOLD:
        consequence = ("the verifier is enforced (ENFORCE_SUPPORT_THRESHOLD=True): "
                       "low-overlap questions are repaired once, then dropped.")
    else:
        consequence = ("the verifier now runs in advisory mode by default "
                       "(ENFORCE_SUPPORT_THRESHOLD=False) — low-overlap questions are flagged, not dropped.")
    return ("How to read these rates: the paraphrases were written under a strict "
            "no-three-word-copy rule, so the false-drop rate is a lower bound on paraphrase "
            f"fidelity for a lexical scorer, not an estimate of production behaviour. {keep_sentence} "
            f"Consequence: {consequence}")


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
        "(unified_orchestrator.py), so this saving is implied, not yet realized (follow-up).",
        "",
        "| Deck | Template lines | Tokens removed | Implied tokens saved per slide prompt |",
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
            _interpretation(probe),
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
