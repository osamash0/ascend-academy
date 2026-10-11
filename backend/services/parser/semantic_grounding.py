"""Semantic support for deck-quiz grounding (Arc 8).

The lexical verifier (quiz_grounding.assess_grounding) asks whether the
correct answer's words occur on the cited slide. The Arc 6 probe measured
what that misses: it rejected 14 of 16 correct paraphrases. This module adds
an embedding signal: the cosine similarity between the claim (question stem
plus correct answer) and the cited slide's boilerplate-stripped text.

Decision rule of ``semantic_support`` (pre-registered in
docs/superpowers/plans/2026-10-11-arc-8-semantic-grounding.md):
  1. Deterministic gates stay deterministic. A verdict in
     DETERMINISTIC_REASONS is returned exactly as the lexical verifier gives
     it, and nothing is embedded for it.
  2. Ambiguous: a distractor's claim is strictly closer to the slide than the
     key's claim AND clears the threshold itself, i.e. the slide supports
     another option at least as well as a passing key. A distractor that is
     merely less far away than a weak key leaves the question low_support.
  3. Otherwise ok when the lexical verifier accepts OR the key's cosine
     clears the threshold (combined rule); else low_support.
``score`` is the key's cosine; ``lexical`` keeps the lexical score.

The embedder is injected: ``async embed(texts) -> vectors``, one vector per
text, in order. ``semantic_texts`` lists exactly the texts a question needs,
so a caller can embed a whole deck in one request (BoundedEmbedder).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Mapping, Sequence

from backend.services.ai.quiz_validator import _normalize_answer_index
from backend.services.parser.deck_plan import DeckSkeleton
from backend.services.parser.quiz_grounding import STRUCTURAL_REASONS, GroundingVerdict, assess_grounding

Embedder = Callable[[Sequence[str]], Awaitable[Sequence[Sequence[float]]]]

# Verdicts no embedding may overturn: nothing to check against, or a number
# in the key that the slide does not contain.
DETERMINISTIC_REASONS = STRUCTURAL_REASONS | {"number_not_on_slide"}

# Slide text sent to the embedder; gemini-embedding-001 accepts 2048 tokens.
SLIDE_CHARS = 2000

# Set from the Arc 8 held-out calibration (backend/eval/semantic_grounding_eval.py)
# only if the pre-registered gate passes. While None, GROUNDING_SCORER=semantic
# falls back to the lexical verifier ("uncalibrated").
SEMANTIC_SUPPORT_THRESHOLD: float | None = None


class EmbeddingShapeError(ValueError):
    """Wrong vector count, mismatched lengths, or a zero vector."""


class EmbeddingBudgetExceeded(RuntimeError):
    """A BoundedEmbedder was asked for more new texts than it may fetch."""


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if not a or len(a) != len(b):
        raise EmbeddingShapeError(f"cannot compare vectors of length {len(a)} and {len(b)}")
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if not (math.isfinite(na) and math.isfinite(nb)):
        raise EmbeddingShapeError("non-finite vector: cosine similarity is undefined")
    if not na or not nb:
        raise EmbeddingShapeError("zero vector: cosine similarity is undefined")
    return sum(x * y for x, y in zip(a, b)) / (na * nb)


def claim_text(stem: str, option: str) -> str:
    stem, option = stem.strip(), option.strip()
    return f"{stem}\n{option}" if stem else option


def slide_text(skeleton: DeckSkeleton, number: int) -> str:
    return skeleton.slides[number - 1].text[:SLIDE_CHARS]


@dataclass(frozen=True)
class SemanticVerdict(GroundingVerdict):
    lexical: float = 0.0
    lexical_ok: bool = False
    cosine: float = 0.0


def _texts(question: Mapping[str, Any], skeleton: DeckSkeleton, number: int) -> List[str]:
    stem = str(question.get("question") or "")
    options = question["options"]
    key = _normalize_answer_index(question)
    distractors = [o for i, o in enumerate(options) if i != key and isinstance(o, str) and o.strip()]
    return [slide_text(skeleton, number), claim_text(stem, options[key]),
            *(claim_text(stem, o) for o in distractors)]


def semantic_texts(question: Mapping[str, Any], skeleton: DeckSkeleton) -> List[str]:
    """Texts semantic_support embeds for this question, in its order; [] when a
    deterministic verdict needs none."""
    lexical = assess_grounding(question, skeleton)
    if lexical.reason in DETERMINISTIC_REASONS or lexical.source_slide is None:
        return []
    return _texts(question, skeleton, lexical.source_slide)


async def semantic_support(
    question: Mapping[str, Any],
    skeleton: DeckSkeleton,
    embed: Embedder,
    threshold: float,
) -> SemanticVerdict:
    lexical = assess_grounding(question, skeleton)
    if lexical.reason in DETERMINISTIC_REASONS or lexical.source_slide is None:
        return SemanticVerdict(lexical.score, lexical.reason, lexical.source_slide, lexical=lexical.score)
    texts = _texts(question, skeleton, lexical.source_slide)
    vectors = list(await embed(texts))
    if len(vectors) != len(texts):
        raise EmbeddingShapeError(f"embedder returned {len(vectors)} vectors for {len(texts)} texts")
    slide_vec, key_vec, *others = vectors
    key_cos = cosine(key_vec, slide_vec)
    common = dict(lexical=lexical.score, lexical_ok=lexical.ok, cosine=key_cos)
    for vec in others:
        c = cosine(vec, slide_vec)
        if c > key_cos and c >= threshold:
            return SemanticVerdict(0.0, "ambiguous", lexical.source_slide, **common)
    ok = lexical.ok or key_cos >= threshold
    return SemanticVerdict(key_cos, "ok" if ok else "low_support", lexical.source_slide, **common)


class BoundedEmbedder:
    """Per-deck memo in front of an embedder with a hard budget: each distinct
    text is fetched once, one request carries at most ``max_batch`` new texts,
    and the deck fetches at most ``max_texts`` in total. Over budget raises
    EmbeddingBudgetExceeded BEFORE any request is sent."""

    def __init__(self, fetch: Embedder, max_texts: int, max_batch: int):
        self._fetch = fetch
        self._memo: Dict[str, List[float]] = {}
        self._max_batch = max_batch
        self.remaining = max_texts

    async def __call__(self, texts: Sequence[str]) -> List[List[float]]:
        missing = [t for t in dict.fromkeys(texts) if t not in self._memo]
        if missing:
            if len(missing) > self.remaining or len(missing) > self._max_batch:
                raise EmbeddingBudgetExceeded(
                    f"{len(missing)} new text(s); {self.remaining} left, at most {self._max_batch} per request")
            self.remaining -= len(missing)
            vectors = list(await self._fetch(missing))
            if len(vectors) != len(missing) or any(not v for v in vectors):
                raise EmbeddingShapeError(
                    f"embedder returned {len(vectors)} usable vectors for {len(missing)} texts")
            self._memo.update(zip(missing, (list(v) for v in vectors)))
        return [self._memo[t] for t in texts]
