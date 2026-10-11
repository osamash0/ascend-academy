"""Grounded quiz verifier — does the slide a deck-quiz question cites
actually support its answer?

The deck quiz prompt asks for ``source_slide``: the real 1-based deck number
of the slide the correct answer is stated on. This module checks that claim
deterministically, with no LLM: content tokens of the correct answer (and,
more weakly, of the question stem) must occur on the cited slide's
boilerplate-stripped text.

Normalisation is light and symmetric (slide and question alike): casefold,
umlaut folding (casefold already maps ß to ss), DE+EN stopword removal, and
iterative stripping of a few inflection suffixes so Prozess/Prozesse/
Prozessen and edge/edges meet. Without suffix stripping the grounded minimum
on the calibration pairs falls from 0.663 to 0.427. Digits are never
stemmed; stems shorter than four characters stay whole.

Tokens are weighted by smoothed inverse slide frequency over the deck, so a
word on most slides ("data", "Prozess") counts less than a slide-specific
one. Without it the ungrounded maximum rises from 0.339 to 0.500.

Hard gates return 0.0: missing/garbage/out-of-range source, empty slide,
unresolvable answer, a digit in the answer that is not on the slide, and a
distractor the slide supports strictly better than the key (ambiguous).

Known limit: lexical support, not entailment. A key copied from the cited
slide but attached to the wrong entity passes. The threshold is calibrated
on real decks in tests/unit/test_quiz_grounding_real_decks.py.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Mapping

from backend.services.ai.quiz_validator import _normalize_answer_index
from backend.services.parser.deck_plan import DeckSkeleton

# Calibrated on 19 real DBS/SR question pairs (2026-10-11): grounded min 0.663,
# ungrounded max 0.339 (both SR slide 7) -- 0.5 is the midpoint, margins >= 0.16.
# See tests/unit/test_quiz_grounding_real_decks.py.
SUPPORT_THRESHOLD = 0.5

_UMLAUTS = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue"})
_WORD = re.compile(r"[^\W_]+")
_SUFFIXES = ("ungen", "ung", "en", "er", "es", "e", "s")
_MIN_STEM = 4
_SOURCE = re.compile(r"^\s*\[?\s*(?:slide|folie)?\s*(\d{1,4})\s*\]?\s*$", re.I)

_EN_STOPWORDS = """
a about above after again against all also am an and any are as at be because been before being below between
both but by can could did do does doing done down during each either every few for from further had has have
having he her here hers him his how i if in into is it its itself just many may me might more most much must my
neither no nor not of off often on once only or other our ours out over own same shall she should so some such
than that the their theirs them then there these they this those through to too under until up upon very was we
were what when where which while who whom whose why will with within without would you your
"""
_DE_STOPWORDS = """
aber alle allem allen aller alles als also am an auch auf aus bei beim bin bis bist bzw da damit dann das dass
dein deine dem den denn der des dessen die dies diese diesem diesen dieser dieses doch dort du durch eigene
eigenem eigenen eigener eigenes ein eine einem einen einer eines er es etwa euch für hat hatte haben ich ihm ihn
ihr ihre im in ins ist jede jedem jeden jeder jedes kann kein keine keinem keinen keiner können man mit muss nach
nicht noch nur ob oder ohne sehr sein seine sich sie sind so soll sowie über um und uns unter usw vom von vor war
waren warum was weil welche welchem welchen welcher welches wenn wer werden wie wieso wird wo wodurch womit wurde
wurden zu zum zur zwischen
"""
STOPWORDS = frozenset(w.casefold().translate(_UMLAUTS) for w in (_EN_STOPWORDS + _DE_STOPWORDS).split())


def _stem(token: str) -> str:
    while True:
        for suffix in _SUFFIXES:
            if (token.endswith(suffix) and len(token) - len(suffix) >= _MIN_STEM
                    and not (suffix == "s" and token.endswith("ss"))):
                token = token[: -len(suffix)]
                break
        else:
            return token


def content_tokens(text: str) -> frozenset[str]:
    out: set[str] = set()
    for tok in _WORD.findall(text.casefold().translate(_UMLAUTS)):
        if tok.isdigit():
            out.add(tok)
        elif len(tok) >= 2 and tok not in STOPWORDS:
            out.add(_stem(tok))
    return frozenset(out)


@lru_cache(maxsize=16)
def _deck_index(skeleton: DeckSkeleton) -> tuple[tuple[frozenset[str], ...], Counter]:
    slides = tuple(content_tokens(s.text) for s in skeleton.slides)
    return slides, Counter(t for toks in slides for t in toks)


def _coverage(tokens: frozenset[str], slide: frozenset[str], df: Counter, n: int) -> float:
    def weight(t: str) -> float:
        return math.log((n + 1) / (df.get(t, 0) + 1)) + 1.0

    total = sum(weight(t) for t in tokens)
    if not total:
        return 0.0
    return sum(weight(t) for t in tokens if t in slide) / total


def parse_source_slide(raw: Any) -> int | None:
    """1-based slide number from what a model writes: 7, 7.0, "7", "Slide 7",
    "[Slide 7]", "Folie 7". Anything else is None."""
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, float) and raw.is_integer():
        return int(raw)
    if isinstance(raw, str):
        m = _SOURCE.match(raw)
        return int(m.group(1)) if m else None
    return None


@dataclass(frozen=True)
class GroundingVerdict:
    score: float
    reason: str
    # The validated, non-empty cited slide (1-based); None when there is
    # nothing on the deck to check or repair against.
    source_slide: int | None

    @property
    def ok(self) -> bool:
        return self.reason == "ok"


def assess_grounding(
    question: Mapping[str, Any],
    skeleton: DeckSkeleton,
    threshold: float = SUPPORT_THRESHOLD,
) -> GroundingVerdict:
    raw = question.get("source_slide")
    if raw is None:
        raw = question.get("slideId")  # pre-v3 prompt key, same meaning
    number = parse_source_slide(raw)
    if number is None:
        return GroundingVerdict(0.0, "no_source", None)
    if not 1 <= number <= len(skeleton.slides):
        return GroundingVerdict(0.0, "source_out_of_range", None)
    slides, df = _deck_index(skeleton)
    slide = slides[number - 1]
    if not slide:
        return GroundingVerdict(0.0, "empty_slide", None)
    options = question.get("options")
    key_idx = _normalize_answer_index(question)
    if key_idx is None or not isinstance(options[key_idx], str):
        return GroundingVerdict(0.0, "no_answer", number)
    key = content_tokens(options[key_idx])
    if any(t.isdigit() and t not in slide for t in key):
        return GroundingVerdict(0.0, "number_not_on_slide", number)
    n = len(slides)
    key_cov = _coverage(key, slide, df, n)
    for i, opt in enumerate(options):
        if i != key_idx and isinstance(opt, str) and _coverage(content_tokens(opt), slide, df, n) > key_cov:
            return GroundingVerdict(0.0, "ambiguous", number)
    stem = content_tokens(str(question.get("question") or ""))
    score = key_cov * (0.5 + 0.5 * _coverage(stem, slide, df, n))
    return GroundingVerdict(score, "ok" if score >= threshold else "low_support", number)


def support_score(question: Mapping[str, Any], skeleton: DeckSkeleton) -> float:
    return assess_grounding(question, skeleton).score
