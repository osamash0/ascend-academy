"""Deterministic, offline embedders for grounding tests (no network).

HashingEmbedder: bag of content tokens (quiz_grounding.content_tokens, so
casefold, umlaut folding, stopwords and suffix stripping match the lexical
scorer). Each token is mapped through an optional synonym table and hashed
(sha256) into one of DIMS buckets. Synonyms model a paraphrase: two words the
lexical scorer cannot match land in the same bucket.

ScriptedEmbedder: exact cosines for tests that need exact numbers. A text in
``slides`` maps to (1, 0); a text in ``cosines`` maps to (c, sqrt(1 - c^2)),
whose cosine with every slide is c; anything else maps to (0, 1).
"""
from __future__ import annotations

import hashlib
import math
from typing import Iterable, List, Mapping, Sequence

from backend.services.parser.quiz_grounding import content_tokens


def _token(word: str) -> str:
    (tok,) = content_tokens(word)
    return tok


class HashingEmbedder:
    DIMS = 512

    def __init__(self, synonyms: Mapping[str, str] | None = None, fail: bool = False):
        self.synonyms = {_token(a): _token(b) for a, b in (synonyms or {}).items()}
        self.fail = fail
        self.calls: List[List[str]] = []

    def vector(self, text: str) -> List[float]:
        v = [0.0] * self.DIMS
        tokens = sorted(content_tokens(text))
        for tok in tokens:
            tok = self.synonyms.get(tok, tok)
            v[int(hashlib.sha256(tok.encode()).hexdigest(), 16) % self.DIMS] += 1.0
        if not tokens:
            v[int(hashlib.sha256(text.casefold().encode()).hexdigest(), 16) % self.DIMS] += 1.0
        return v

    async def __call__(self, texts: Sequence[str]) -> List[List[float]]:
        self.calls.append(list(texts))
        if self.fail:
            raise RuntimeError("embedding backend unavailable")
        return [self.vector(t) for t in texts]


class ScriptedEmbedder:
    def __init__(self, slides: Iterable[str], cosines: Mapping[str, float]):
        self.slides = set(slides)
        self.cosines = dict(cosines)
        self.calls: List[List[str]] = []

    async def __call__(self, texts: Sequence[str]) -> List[List[float]]:
        self.calls.append(list(texts))
        out: List[List[float]] = []
        for t in texts:
            if t in self.slides:
                out.append([1.0, 0.0])
            elif t in self.cosines:
                c = self.cosines[t]
                out.append([c, math.sqrt(max(0.0, 1.0 - c * c))])
            else:
                out.append([0.0, 1.0])
        return out
