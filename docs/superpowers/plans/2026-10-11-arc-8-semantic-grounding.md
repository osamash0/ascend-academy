> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Parent plan: docs/superpowers/plans/2026-10-10-ai-backend-deep-session.md (Global Constraints bind). **Controller rulings (2026-10-11):** PR #92 (openai_only mode, OpenAI embeddings path with its own cost logging) edits embeddings.py/orchestrator.py/vision.py/cost.py — so Task 3 keeps ONLY the batch embedding call (no metering, no call_context/llm_calls/receipt changes; embedding metering is #92s); the embedding MODEL id is part of the cache key and recorded next to the calibrated threshold (a threshold is only valid for the model it was fitted on); Task 7 Step 3 runs only after the user approves in chat.
> **Note (2026-10-11):** Task 5 (production wiring, GROUNDING_SCORER) was implemented and then REVERTED after the pre-registered gate failed — see docs/superpowers/plans/2026-10-11-arc-8-ledger.md.

# Arc 8: Semantic grounding (TDD implementation plan)

Worktree: `/Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/arc8-semantic-grounding` (branch `claude/arc8-semantic-grounding`, base e201023). Run everything from the worktree root with `PY=/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python`.

## Facts I checked in the code (these drive the design)

- **Lexical verifier.** `quiz_grounding.assess_grounding(question, skeleton, threshold=SUPPORT_THRESHOLD) -> GroundingVerdict(score, reason, source_slide)` is a frozen dataclass with an `.ok` property.
  - `STRUCTURAL_REASONS` = {no_source, source_out_of_range, empty_slide, no_answer}.
  - `number_not_on_slide` is a separate, deterministic content verdict.
  - Lexical ambiguity forces score 0.
- **Embeddings.** `embeddings.generate_embeddings(text)` makes one SDK call per text. `batch_generate_embeddings` fans out to per-text calls and swallows errors into `[]`.
  - Neither one meters.
  - The SDK (google-genai 1.66.0) exposes `ContentEmbedding.statistics.token_count`. It is populated on Vertex only, so on the Gemini Developer API tokens are **not reported**.
- **Cost.** `cost.estimate_cost` prices every non-`openai` provider at $0, under the documented free-tier policy in cost.py.
  - No Google embedding price exists in code or config.
  - Embedding cost is therefore recorded as 0.0 under that policy. No price is invented.
- **Why metering can't reuse `_account_for_call`.** `orchestrator._account_for_call` also flushes the rotator's chat-provider counter. Using it for embeddings would inflate gemini's chat quota count, so embeddings get their own small accounting tail.
- **Receipt timing.** The receipt is written at `unified_orchestrator.py:1117`, before slide-embedding tasks are joined at `:1169`. A receipt can therefore never count all slide embeddings. So `"embeddings"` **stays** in `llm_usage.unmetered`: it is not fully metered in the receipt, even though every call lands in `llm_calls`. Vision and the admin classifier stay as declared gaps.
- **Network guard.** `BlockedOutboundAccess` derives from `BaseException`, and unit tests set an unroutable `DATABASE_URL`.
  - Any unit test that reaches the real `cost.log_llm_call` blows up.
  - `test_ai_models_smoke.py` tests `test_generate_embeddings_uses_current_model` and `..._pads_or_trims_...` call the real `generate_embeddings` with a fake client. They need an autouse stub of `cost.log_llm_call` (Task 3).
- **Calibration pairs** currently live inside `backend/tests/unit/test_quiz_grounding_real_decks.py` as `DBS_PAIRS` (8) and `SR_PAIRS` (11).
  - `sha256(repr((list(DBS_PAIRS), list(SR_PAIRS))))` = `ca8b73bd54f0bfc40b75d1736bf884c5227c8e52780210bbf8ce2e2fb698f475`.
  - Probe field-tuple sha256 = `8d5299c3b3521a32c92eec41fe091282aa66640888b0e57d151f49b28f640beb`.
  - I computed both read-only from the current files.
- **Real decks.** All four are present in `~/Downloads`: `00 DBS Introduction.pdf`, ` 03__SR_Prozesse_v07_27.04.2025.pdf`, `07 DBS Transactions.pdf`, `05__SR_Speicherverwaltung_v02_06.05.2026.pdf`.
- **Fake-embedder numbers.** I computed every one of them read-only with the exact fake below on `GRAPH_DECK_PAGES` slide 3 and `LONG_DECK`. Examples: paraphrase cosine 0.471, hallucination 0.118, `Prim` 0.167, distractor `Dijkstra computes…` 0.639.
- **Fixtures.** No new decks. Tests reuse `GRAPH_DECK_PAGES` (6 pages, footer on 5 of 6, letter-varied) and `LONG_DECK` (18 pages), which already obey the fixture rule.

## Pre-registration (fixed before any real embedding is fetched)

1. **Scorer, combined rule.** Deterministic gates first: `STRUCTURAL_REASONS ∪ {number_not_on_slide}`, unchanged and with no embedding call.
   - Then **ambiguous**: a distractor claim (stem + option) whose cosine to the slide is strictly greater than the key claim's AND ≥ threshold.
   - Otherwise **ok** iff lexical ok OR cos(stem + key, slide) ≥ threshold. Else `low_support`.
   - Slide text is truncated to 2000 characters. No `task_type`: this is the same call production makes.
2. **Calibration (held out).** The threshold is fitted ONLY on the 38 Arc 4 calibration answers (calibration decks). Answers decided by deterministic gates are excluded and counted.
   - Rule: midpoints between adjacent distinct scores; choose the fewest errors (grounded < t plus ungrounded ≥ t), then the widest gap (rounded to 1e-9), then the higher t.
3. **Probe.** The 16 pre-registered pairs (32 answers, disjoint decks) are scored ONCE at that threshold. Lexical, semantic and combined columns are reported. Neither pair set may change; both are sha256-pinned in Task 2.
4. **Gate**, applied to the COMBINED column. It passes only if all of these hold:
   - all 32 answers are scored;
   - calibration errors ≤ 2;
   - false drops ≤ 2/16;
   - false keeps ≤ 1/16.
5. **Consequences.**
   - FAIL: `SEMANTIC_SUPPORT_THRESHOLD` stays `None` (semantic mode falls back to lexical, "uncalibrated"). ENFORCE stays False. GROUNDING_SCORER default stays "lexical". Numbers are recorded in the ENFORCE comment and the ledger.
   - PASS: the threshold constant is set to the calibrated value. Flipping the production defaults (GROUNDING_SCORER=semantic, ENFORCE=True) is authorised by the data but runs as a separate user-approved Arc 8b task, because it adds Gemini calls per parse and drops questions in production.
6. **Sanity check.** The lexical column must reproduce Arc 6 (false-drop 14/16, false-keep 0/16). If it does not, stop: the pipeline has a bug.
7. **Known risk, written down in advance.** The stem dominates the claim embedding: in the fake, every distractor claim scored 0.655 because the stem overlaps the slide. This can raise false keeps.
   - Calibration's ungrounded keys share their grounded twins' stems, so the held-out threshold already absorbs this.
   - If the probe fails because of it, a key-only or "delta" variant is a NEW pre-registered arc with a new probe. It must never be a tweak against this probe.

## Task order

1 → 2 → 3 → 4 (needs 1, 2, 3) → 5 (needs 1, 3) → 6 (needs 4, 5) → 7 (needs all; **user approval**).

---

## Task 1: Semantic support scorer (pure, injectable)

**Files:**
- Create `backend/services/parser/semantic_grounding.py`
- Create `backend/tests/support/fake_embedder.py`
- Create `backend/tests/unit/test_semantic_grounding.py`

**Interfaces**
- Consumes:
  - `quiz_grounding.assess_grounding`, `STRUCTURAL_REASONS`, `GroundingVerdict`
  - `quiz_validator._normalize_answer_index(q) -> Optional[int]`
  - `deck_plan.DeckSkeleton` (`.slides[i].text`)
- Produces:
  - `Embedder = Callable[[Sequence[str]], Awaitable[Sequence[Sequence[float]]]]`
  - `DETERMINISTIC_REASONS: frozenset[str]`; `SLIDE_CHARS = 2000`; `SEMANTIC_SUPPORT_THRESHOLD: float | None = None`
  - `class EmbeddingShapeError(ValueError)`; `class EmbeddingBudgetExceeded(RuntimeError)`
  - `cosine(a, b) -> float`; `claim_text(stem: str, option: str) -> str`; `slide_text(skeleton, number: int) -> str`
  - `@dataclass(frozen=True) class SemanticVerdict(GroundingVerdict)` with extra fields `lexical: float = 0.0, lexical_ok: bool = False, cosine: float = 0.0`
  - `semantic_texts(question: Mapping, skeleton) -> list[str]`
  - `async semantic_support(question: Mapping, skeleton: DeckSkeleton, embed: Embedder, threshold: float) -> SemanticVerdict`
  - `class BoundedEmbedder(fetch: Embedder, max_texts: int, max_batch: int)`, which is an async callable with a `.remaining: int` attribute
- Test support:
  - `HashingEmbedder(synonyms=None, fail=False)` with `.calls`, `.vector(text)`, `DIMS = 512`
  - `ScriptedEmbedder(slides, cosines)`

**Step 1: failing tests.** Write `backend/tests/support/fake_embedder.py`:
```python
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
```
Then write `backend/tests/unit/test_semantic_grounding.py`:
```python
"""Arc 8 semantic support scorer: deterministic gates, the combined rule and
semantic ambiguity. Offline: a hashing fake stands in for Gemini. Cosines were
hand-checked against HashingEmbedder on GRAPH_DECK_PAGES slide 3 (Dijkstra)."""
from __future__ import annotations

import pytest

from backend.services.parser.deck_plan import build_deck_skeleton
from backend.services.parser.quiz_grounding import assess_grounding
from backend.services.parser.semantic_grounding import (
    SEMANTIC_SUPPORT_THRESHOLD,
    BoundedEmbedder,
    EmbeddingBudgetExceeded,
    EmbeddingShapeError,
    claim_text,
    cosine,
    semantic_support,
    semantic_texts,
    slide_text,
)
from backend.tests.support.fake_embedder import HashingEmbedder
from backend.tests.support.quiz_grounding_deck import GRAPH_DECK_PAGES

SK = build_deck_skeleton(GRAPH_DECK_PAGES)
T = 0.4
SYNONYMS = {"minimal": "shortest", "routes": "paths", "origin": "source", "determines": "computes"}
STEM = "What does this procedure determine?"
OFF = ["Photosynthesis", "Plate tectonics", "Baroque counterpoint"]


def _q(options, answer, source=3, stem=STEM):
    return {"question": stem, "options": options, "correctAnswer": answer, "source_slide": source}


PARAPHRASE = _q(["Minimal routes from one origin", *OFF], "Minimal routes from one origin")
HALLUCINATION = _q(["Minimum spanning trees over all vertices", *OFF], "Minimum spanning trees over all vertices")
LEXICAL_OK = _q(["Dijkstra", "Kruskal", "Prim", "Floyd"], "Dijkstra",
                stem="Which algorithm computes shortest paths from a single source?")


@pytest.fixture
def embed():
    return HashingEmbedder(SYNONYMS)


def test_threshold_is_uncalibrated_until_the_arc8_measurement():
    assert SEMANTIC_SUPPORT_THRESHOLD is None


async def test_paraphrase_the_lexical_scorer_rejects_is_accepted(embed):
    assert assess_grounding(PARAPHRASE, SK).reason == "low_support"
    v = await semantic_support(PARAPHRASE, SK, embed, T)
    assert v.ok and v.reason == "ok" and v.source_slide == 3
    assert not v.lexical_ok and v.lexical == 0.0
    assert v.score == v.cosine == pytest.approx(0.471, abs=0.001)


async def test_on_topic_hallucination_stays_low_support_even_with_a_closer_weak_distractor(embed):
    # "Photosynthesis" (0.167) is closer than the key (0.118) but is itself
    # below the threshold: that is not ambiguity, the key is just unsupported.
    v = await semantic_support(HALLUCINATION, SK, embed, T)
    assert v.reason == "low_support" and not v.ok
    assert v.cosine == pytest.approx(0.118, abs=0.001)


async def test_lexically_supported_key_passes_even_below_the_cosine_threshold(embed):
    v = await semantic_support(LEXICAL_OK, SK, embed, threshold=1.01)
    assert v.ok and v.lexical_ok and v.cosine < 1.01


async def test_distractor_the_slide_supports_better_than_the_key_is_ambiguous(embed):
    q = _q(["Prim", "Dijkstra computes shortest paths from a single source", *OFF[1:]], "Prim")
    v = await semantic_support(q, SK, embed, T)
    assert v.reason == "ambiguous" and v.score == 0.0 and not v.ok
    assert v.cosine == pytest.approx(0.167, abs=0.001)


@pytest.mark.parametrize("question, reason", [
    ({k: v for k, v in PARAPHRASE.items() if k != "source_slide"}, "no_source"),
    ({**PARAPHRASE, "source_slide": 99}, "source_out_of_range"),
    ({**PARAPHRASE, "correctAnswer": "nonsense"}, "no_answer"),
    (_q(["5 colors", "3 colors", "6 colors", "8 colors"], "5 colors", source=5), "number_not_on_slide"),
])
async def test_deterministic_gates_never_reach_the_embedder(embed, question, reason):
    v = await semantic_support(question, SK, embed, T)
    assert v.reason == reason == assess_grounding(question, SK).reason and not v.ok
    assert embed.calls == [] and semantic_texts(question, SK) == []


def test_semantic_texts_lists_slide_then_key_then_distractors():
    texts = semantic_texts(PARAPHRASE, SK)
    assert texts == [slide_text(SK, 3), claim_text(STEM, "Minimal routes from one origin"),
                     *(claim_text(STEM, o) for o in OFF)]
    assert texts[0].startswith("Dijkstra Algorithm") and "University of Marburg" not in texts[0]


async def test_embedder_returning_the_wrong_number_of_vectors_raises():
    async def short(texts):
        return [[1.0, 0.0]]

    with pytest.raises(EmbeddingShapeError):
        await semantic_support(PARAPHRASE, SK, short, T)


def test_cosine_rejects_zero_and_mismatched_vectors():
    assert cosine([1.0, 0.0], [2.0, 0.0]) == pytest.approx(1.0)
    with pytest.raises(EmbeddingShapeError):
        cosine([0.0, 0.0], [1.0, 0.0])
    with pytest.raises(EmbeddingShapeError):
        cosine([1.0], [1.0, 0.0])


def test_claim_text_joins_stem_and_option():
    assert claim_text(" Q? ", " A ") == "Q?\nA" and claim_text("", "A") == "A"


async def test_bounded_embedder_fetches_each_text_once_and_enforces_its_budget():
    inner = HashingEmbedder()
    bounded = BoundedEmbedder(inner, max_texts=3, max_batch=10)
    first = await bounded(["a slide", "a claim", "a slide"])
    assert inner.calls == [["a slide", "a claim"]] and first[0] == first[2]
    await bounded(["a claim"])
    assert len(inner.calls) == 1 and bounded.remaining == 1
    with pytest.raises(EmbeddingBudgetExceeded):
        await bounded(["new one", "new two"])
    assert len(inner.calls) == 1


async def test_bounded_embedder_refuses_a_request_larger_than_max_batch():
    with pytest.raises(EmbeddingBudgetExceeded):
        await BoundedEmbedder(HashingEmbedder(), max_texts=10, max_batch=2)(["x one", "x two", "x three"])


async def test_bounded_embedder_rejects_empty_vectors():
    async def broken(texts):
        return [[] for _ in texts]

    with pytest.raises(EmbeddingShapeError):
        await BoundedEmbedder(broken, 5, 5)(["slide text"])
```
**Step 2: run** `$PY -m pytest backend/tests/unit/test_semantic_grounding.py -m "not db" -q`. Expected: collection error `ModuleNotFoundError: No module named 'backend.services.parser.semantic_grounding'`.

**Step 3: implementation.** Write `backend/services/parser/semantic_grounding.py`:
```python
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
```
**Step 4: green.** Run the same command; all pass. Then run the whole unit suite: `$PY -m pytest -m "not db" -q`.

**Step 5: mutation check** (revert after each mutation):
- Change `if c > key_cos and c >= threshold:` to `if c > key_cos:`. Expected to fail: `test_on_topic_hallucination_stays_low_support_even_with_a_closer_weak_distractor`.
- Change `ok = lexical.ok or key_cos >= threshold` to `ok = key_cos >= threshold`. Expected to fail: `test_lexically_supported_key_passes_even_below_the_cosine_threshold`.
- Change `DETERMINISTIC_REASONS = STRUCTURAL_REASONS | {"number_not_on_slide"}` to `DETERMINISTIC_REASONS = STRUCTURAL_REASONS`. Expected to fail: the `number_not_on_slide` parametrization.

**Step 6: commit.** `feat(grounding): semantic support scorer with deterministic gates and semantic ambiguity (Arc 8.1)`, with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the authoring model, per the trailer ruling).

---

## Task 2: Calibration pairs as data, pinned pre-registration, threshold rule

**Files:**
- Create `backend/eval/data/grounding_calibration.py`
- Create `backend/eval/semantic_grounding_eval.py`
- Modify `backend/tests/unit/test_quiz_grounding_real_decks.py`
- Create `backend/tests/unit/test_semantic_calibration.py`

**Interfaces**
- Consumes: `grounding_probe.CALIBRATION_DECKS`, `EN_OFF_TOPIC`, `DE_OFF_TOPIC`, `PROBE_PAIRS`.
- Produces:
  - `DBS_DECK`, `SR_DECK`, `DBS_PAIRS: list[tuple[int, str, str, str]]`, `SR_PAIRS`
  - `CALIBRATION_SETS: tuple[tuple[str, list, tuple[str, ...]], ...]`, as (deck, pairs, off-topic distractors)
  - `@dataclass(frozen=True) Calibration(threshold: float, grounded: tuple[float, ...], ungrounded: tuple[float, ...], gated: int = 0)` with properties `false_drops`, `false_keeps`, `errors`, `scored`
  - `calibrate_threshold(grounded: Sequence[float], ungrounded: Sequence[float], gated: int = 0) -> Calibration`

**Step 1: failing tests.** Write `backend/tests/unit/test_semantic_calibration.py`:
```python
"""Arc 8 pre-registration guards and the held-out threshold rule."""
from __future__ import annotations

import hashlib

import pytest

from backend.eval.data.grounding_calibration import CALIBRATION_SETS, DBS_PAIRS, SR_PAIRS
from backend.eval.data.grounding_probe import CALIBRATION_DECKS, PROBE_PAIRS
from backend.eval.semantic_grounding_eval import Calibration, calibrate_threshold

# Computed from the Arc 4 lists before they moved; any edit to a pair breaks it.
CALIBRATION_SHA256 = "ca8b73bd54f0bfc40b75d1736bf884c5227c8e52780210bbf8ce2e2fb698f475"
PROBE_SHA256 = "8d5299c3b3521a32c92eec41fe091282aa66640888b0e57d151f49b28f640beb"


def test_calibration_pairs_are_the_arc4_pairs_unchanged():
    digest = hashlib.sha256(repr((list(DBS_PAIRS), list(SR_PAIRS))).encode()).hexdigest()
    assert digest == CALIBRATION_SHA256
    assert (len(DBS_PAIRS), len(SR_PAIRS)) == (8, 11)


def test_probe_pairs_are_pre_registered_and_unchanged():
    fields = tuple((p.deck, p.slide, p.stem, p.paraphrased, p.hallucinated, p.language) for p in PROBE_PAIRS)
    assert hashlib.sha256(repr(fields).encode()).hexdigest() == PROBE_SHA256


def test_calibration_sets_use_the_calibration_decks_only():
    assert tuple(deck for deck, _, _ in CALIBRATION_SETS) == CALIBRATION_DECKS
    assert not {deck for deck, _, _ in CALIBRATION_SETS} & {p.deck for p in PROBE_PAIRS}


def test_separable_scores_put_the_threshold_at_the_midpoint():
    cal = calibrate_threshold([0.8, 0.9], [0.2, 0.3])
    assert cal.threshold == pytest.approx(0.55) and cal.errors == 0 and cal.scored == 4


def test_overlap_minimises_errors_then_prefers_the_widest_gap():
    cal = calibrate_threshold([0.4, 0.7, 0.9], [0.1, 0.5])
    assert cal.threshold == pytest.approx(0.25)  # 0.25 (gap 0.3) beats 0.6 (gap 0.2), both 1 error
    assert (cal.false_drops, cal.false_keeps) == (0, 1)


def test_equal_errors_and_gaps_prefer_the_higher_threshold():
    cal = calibrate_threshold([0.3, 0.9], [0.1, 0.7])
    assert cal.threshold == pytest.approx(0.8)


def test_gated_answers_are_carried_not_scored():
    cal = calibrate_threshold([0.8], [0.2], gated=3)
    assert cal.gated == 3 and cal.scored == 2


@pytest.mark.parametrize("grounded, ungrounded", [([], [0.1]), ([0.5], []), ([0.5], [0.5])])
def test_degenerate_input_is_refused(grounded, ungrounded):
    with pytest.raises(ValueError):
        calibrate_threshold(grounded, ungrounded)


def test_calibration_counts_errors_against_its_own_threshold():
    cal = Calibration(threshold=0.5, grounded=(0.1, 0.6), ungrounded=(0.5, 0.2))
    assert (cal.false_drops, cal.false_keeps, cal.errors) == (1, 1, 2)
```
**Step 2: run** `$PY -m pytest backend/tests/unit/test_semantic_calibration.py -m "not db" -q`. Expected: `ModuleNotFoundError: No module named 'backend.eval.data.grounding_calibration'`.

**Step 3: implementation.** Write `backend/eval/data/grounding_calibration.py`, copying the pairs VERBATIM from the current test file:
```python
"""Arc 4 calibration pairs, moved verbatim from
tests/unit/test_quiz_grounding_real_decks.py in Arc 8 so the Deck Lab can fit
the semantic threshold on them.

Held-out protocol (Arc 8, pre-registered): the semantic threshold is fitted
ONLY on these pairs (calibration decks), then the probe
(grounding_probe.py, disjoint decks) is scored once at that threshold.
Neither set may be edited because of a score; tests/unit/test_semantic_calibration.py
pins both by sha256.

Each pair: (1-based slide, stem, grounded key, ungrounded key). The grounded
key is stated on that slide; the ungrounded key is copied from a different
slide of the same deck or carries a number that is not on the slide.
"""
from __future__ import annotations

from backend.eval.data.grounding_probe import CALIBRATION_DECKS, DE_OFF_TOPIC, EN_OFF_TOPIC

DBS_DECK, SR_DECK = CALIBRATION_DECKS

DBS_PAIRS = [
    (19, "Which problem arises when each advisor keeps their own client data?",
     "Redundancy through double client entries", "Waste of physical storage through multiply saved data"),
    (24, "How many records did AT&T store in 2015?", "1.9 trillion records", "3.4 trillion records"),
    (26, "Why is searching a 10 Gbyte CSV file slow?",
     "On average 10/2 Gbyte will be read", "The DBMS distributes the file over a server cluster"),
    (30, "What happens to data when every software manages its own formats?",
     "Data are saved redundantly", "Users must know the internal representation of the data"),
    (31, "What do applications lack without data independence?",
     "They must know the internal representation and storage media", "Data are saved redundantly in many formats"),
    (16, "Which task does a DBMS take over for multi-user operation?",
     "Transaction management and access control", "Redundancy through double client entries"),
    (35, "Which systems surround database systems in IT infrastructures?",
     "Batch and data stream systems", "Text processing and accounting software"),
    (11, "What does a database management system manage?",
     "Access to one or more databases", "Batch and data stream systems"),
]
SR_PAIRS = [
    (3, "Was ermöglicht ein Prozess auf einem Ein-Prozessor-System?",
     "Quasi-parallele Ausführung", "Zeitscheiben im Millisekundenbereich"),
    (4, "Was besitzen Threads im Gegensatz zu Prozessen nicht?",
     "Eine eigene Ressourcenumgebung wie einen Speicherbereich", "Einen eigenen Befehlszähler und Stack im Kernteil"),
    (7, "Wodurch wird der Ablauf beim Multitasking gesteuert?",
     "Durch Zeitscheiben", "Durch die Prozesstabelle im Hauptspeicher"),
    (14, "Wie nennt man die Zeit, nach der das Betriebssystem neu zuteilt?", "Zeitscheibe", "Prozesskontrollblock"),
    (17, "Was ist eine Prozesstabelle?",
     "Eine Liste von Prozesskontrollblöcken", "Eine exakte Kopie des Elternprozesses"),
    (18, "Was erzeugt der Systemaufruf fork()?",
     "Eine exakte Kopie des ausführenden Prozesses als Kindprozess", "Eine Liste von Prozesskontrollblöcken"),
    (24, "In welchem Zustand wartet ein Prozess auf ein Ereignis?",
     "Blockiert", "In der Prozesstabelle im Hauptspeicher"),
    (16, "Was besitzt jeder Prozess, das vor dem Zugriff anderer Prozesse geschützt ist?",
     "Einen eigenen Adressraum", "Eine eigene Zeitscheibe"),
    (26, "Wo werden Prozesse verwaltet, die auf ein Ereignis warten?",
     "In ereignisspezifischen Warteschlangen", "In der Prozesstabelle im Hauptspeicher"),
    (27, "Welcher Programmfehler kann zur Deaktivierung eines Prozesses führen?",
     "Divide by Zero", "Ein Deadlock zwischen zwei Semaphoren"),
    (28, "Was gehört zur Buchführung über Prozesse?",
     "Verwaltung der Prozesstabelle", "Präemptives Multitasking mit Zeitscheiben"),
]

# (deck file name, pairs, off-topic distractors)
CALIBRATION_SETS = ((DBS_DECK, DBS_PAIRS, EN_OFF_TOPIC), (SR_DECK, SR_PAIRS, DE_OFF_TOPIC))
```
Write `backend/eval/semantic_grounding_eval.py` (Task 4 extends it):
```python
"""Arc 8 semantic grounding measurement: held-out calibration, then one probe run.

Protocol (pre-registered in docs/superpowers/plans/2026-10-11-arc-8-semantic-grounding.md):
  1. The cosine threshold is fitted ONLY on the Arc 4 calibration pairs
     (backend/eval/data/grounding_calibration.py) with ``calibrate_threshold``.
  2. The probe (backend/eval/data/grounding_probe.py, disjoint decks) is scored
     once at that threshold; its scores never feed back into step 1.
  3. ``decide`` applies the pre-registered gate to the combined scorer.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True)
class Calibration:
    threshold: float
    grounded: tuple[float, ...]
    ungrounded: tuple[float, ...]
    gated: int = 0  # calibration answers decided by a deterministic gate, not scored

    @property
    def false_drops(self) -> int:
        return sum(1 for s in self.grounded if s < self.threshold)

    @property
    def false_keeps(self) -> int:
        return sum(1 for s in self.ungrounded if s >= self.threshold)

    @property
    def errors(self) -> int:
        return self.false_drops + self.false_keeps

    @property
    def scored(self) -> int:
        return len(self.grounded) + len(self.ungrounded)


def calibrate_threshold(grounded: Sequence[float], ungrounded: Sequence[float], gated: int = 0) -> Calibration:
    """Pre-registered rule: candidates are the midpoints between adjacent
    distinct scores; pick the fewest errors (grounded < t plus ungrounded >= t),
    then the widest gap around the midpoint (rounded to 1e-9), then the higher
    threshold. Sees calibration scores only."""
    if not grounded or not ungrounded:
        raise ValueError("calibration needs grounded and ungrounded scores")
    values = sorted(set(grounded) | set(ungrounded))
    if len(values) < 2:
        raise ValueError("calibration scores do not vary; no threshold separates them")
    best: tuple[tuple[int, float, float], float] | None = None
    for lo, hi in zip(values, values[1:]):
        t = (lo + hi) / 2
        errors = sum(1 for s in grounded if s < t) + sum(1 for s in ungrounded if s >= t)
        rank = (errors, -round(hi - lo, 9), -t)
        if best is None or rank < best[0]:
            best = (rank, t)
    return Calibration(best[1], tuple(grounded), tuple(ungrounded), gated)
```
In `backend/tests/unit/test_quiz_grounding_real_decks.py`:
- Delete the comment line `# (1-based slide, stem, grounded key, ungrounded key)` and the two literal lists `DBS_PAIRS = [...]` and `SR_PAIRS = [...]`.
- Add the import `from backend.eval.data.grounding_calibration import DBS_PAIRS, SR_PAIRS` directly above `from backend.eval.decks import real_deck_pages`.
- Append this sentence to the module docstring: `The pairs live in backend/eval/data/grounding_calibration.py (moved verbatim in Arc 8).`
- Everything else is unchanged.

**Step 4: green.**
- `$PY -m pytest backend/tests/unit/test_semantic_calibration.py backend/tests/unit/test_quiz_grounding_real_decks.py -m "not db" -q`. The real-deck file still passes with the same numbers (0.663/0.339/0.816) because the decks are in ~/Downloads.
- Full suite: `$PY -m pytest -m "not db" -q`.

**Step 5: mutation check:**
- Change `rank = (errors, -round(hi - lo, 9), -t)` to `rank = (errors, round(hi - lo, 9), -t)`. Expected to fail: `test_overlap_minimises_errors_then_prefers_the_widest_gap`.
- Change `-t)` to `t)`. Expected to fail: `test_equal_errors_and_gaps_prefer_the_higher_threshold`.
- Change `"Durch Zeitscheiben"` in SR_PAIRS to `"Durch die Zeitscheiben"`. Expected to fail: `test_calibration_pairs_are_the_arc4_pairs_unchanged`.

**Step 6: commit.** `refactor(eval): calibration pairs as data with sha256 pre-registration pins; held-out threshold rule (Arc 8.2)`

---

## Task 3: Batch embedding call and embedding metering (call context + llm_calls)

**Files:**
- Modify `backend/services/ai/embeddings.py`
- Modify `backend/services/ai/call_context.py`
- Modify `backend/services/parser/unified_orchestrator.py` (`_llm_usage_receipt`)
- Create `backend/tests/unit/test_embedding_metering.py`
- Modify `backend/tests/unit/test_ai_models_smoke.py` (autouse stub)
- Modify `backend/tests/unit/test_unified_orchestrator.py` (append 1 test)

**Interfaces**
- Consumes: `call_context.ServedCall`, `current_llm_call_context`, `record_served_call`; `cost.LLMUsage`, `estimate_cost(provider_id, model, usage)`, `log_llm_call(**kw)`.
- Produces:
  - `EMBEDDING_PROVIDER = "gemini"`, `EMBEDDING_PROMPT_NAME = "EMBEDDING"`, `EMBED_BATCH_MAX = 100`
  - `_sync_embed(contents: str | list[str]) -> tuple[list[list[float]], int | None]`
  - `async generate_embeddings_batch(texts: Sequence[str], *, meter: bool = True) -> list[list[float]]`
  - `async _account_for_embedding(tokens: int | None) -> None`
  - `ServedCall.usage_reported: bool = True`
  - Receipt `llm_usage["calls_without_usage"]: int`
  - `unmetered` unchanged

**Step 1: failing tests.** Write `backend/tests/unit/test_embedding_metering.py`:
```python
"""Arc 8: embedding calls are metered like completions (call context +
llm_calls). The Gemini client is faked; nothing leaves the process."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from backend.services.ai import cost as cost_module
from backend.services.ai import embeddings as emb_mod
from backend.services.ai.call_context import llm_call_scope


class _Models:
    def __init__(self, token_count=None, fail=False, short=False):
        self.token_count, self.fail, self.short = token_count, fail, short
        self.calls: list = []

    def embed_content(self, model, contents, config=None):
        self.calls.append(contents)
        if self.fail:
            raise RuntimeError("quota exhausted")
        texts = [contents] if isinstance(contents, str) else list(contents)
        if self.short:
            texts = texts[:-1]
        out = []
        for i, _ in enumerate(texts):
            emb = SimpleNamespace(values=[0.1 * (i + 1)] * emb_mod.EMBEDDING_DIMS)
            if self.token_count is not None:
                emb.statistics = SimpleNamespace(token_count=self.token_count)
            out.append(emb)
        return SimpleNamespace(embeddings=out)


@pytest.fixture
def logged(monkeypatch):
    rows: list = []

    async def fake_log(**kwargs):
        rows.append(kwargs)

    monkeypatch.setattr(cost_module, "log_llm_call", fake_log)
    return rows


def _client(monkeypatch, **kw):
    models = _Models(**kw)
    monkeypatch.setattr(emb_mod, "gemini_client", SimpleNamespace(models=models))
    return models


async def test_single_embedding_is_metered_with_reported_tokens(monkeypatch, logged):
    _client(monkeypatch, token_count=7)
    sink: list = []
    with llm_call_scope(run_id="run-1", calls=sink, slide_indices=(3,), prompt_name="BATCH_SLIDE_PROMPT"):
        vec = await emb_mod.generate_embeddings("slide text")
    assert len(vec) == emb_mod.EMBEDDING_DIMS
    (call,) = sink
    assert (call.provider, call.model) == ("gemini", emb_mod.EMBEDDING_MODEL)
    assert (call.prompt_tokens, call.completion_tokens, call.cost_usd) == (7, 0, 0.0)
    assert call.usage_reported is True
    # Never inherits the surrounding prompt or slide: an embedding is its own run-level call.
    assert (call.prompt_name, call.slide_indices) == ("EMBEDDING", None)
    (row,) = logged
    assert (row["feature"], row["provider_id"], row["model"]) == ("embedding", "gemini", emb_mod.EMBEDDING_MODEL)
    assert row["usage"].prompt_tokens == 7 and row["cost_usd"] == 0.0
    assert (row["run_id"], row["slide_indices"], row["prompt_name"]) == ("run-1", None, "EMBEDDING")


async def test_unreported_tokens_are_zero_and_flagged(monkeypatch, logged):
    _client(monkeypatch)  # Gemini Developer API: no statistics on the response
    sink: list = []
    with llm_call_scope(calls=sink):
        await emb_mod.generate_embeddings("slide text")
    assert sink[0].prompt_tokens == 0 and sink[0].usage_reported is False
    assert logged[0]["usage"] is None


async def test_batch_is_one_request_with_vectors_in_input_order(monkeypatch, logged):
    models = _client(monkeypatch, token_count=5)
    sink: list = []
    with llm_call_scope(calls=sink):
        out = await emb_mod.generate_embeddings_batch(["one text", "two text", "three text"])
    assert models.calls == [["one text", "two text", "three text"]]
    assert [v[0] for v in out] == pytest.approx([0.1, 0.2, 0.3])
    assert all(len(v) == emb_mod.EMBEDDING_DIMS for v in out)
    (call,) = sink
    assert call.prompt_tokens == 15 and len(logged) == 1


async def test_batch_rejects_too_many_and_blank_texts_without_calling_the_api(monkeypatch, logged):
    models = _client(monkeypatch)
    with pytest.raises(ValueError):
        await emb_mod.generate_embeddings_batch(["t"] * (emb_mod.EMBED_BATCH_MAX + 1))
    with pytest.raises(emb_mod.EmbeddingUnavailableError):
        await emb_mod.generate_embeddings_batch(["fine", "  "])
    assert await emb_mod.generate_embeddings_batch([]) == []
    assert models.calls == [] and logged == []


async def test_batch_with_a_missing_vector_raises_and_is_not_metered(monkeypatch, logged):
    _client(monkeypatch, short=True)
    with pytest.raises(RuntimeError, match="2 embeddings for 3 texts"):
        await emb_mod.generate_embeddings_batch(["a text", "b text", "c text"])
    assert logged == []


async def test_a_failed_call_is_not_metered(monkeypatch, logged):
    _client(monkeypatch, fail=True)
    with pytest.raises(RuntimeError, match="quota"):
        await emb_mod.generate_embeddings("slide text")
    assert logged == []


async def test_unmetered_batch_for_the_offline_eval(monkeypatch, logged):
    _client(monkeypatch)
    sink: list = []
    with llm_call_scope(calls=sink):
        await emb_mod.generate_embeddings_batch(["a text"], meter=False)
    assert sink == [] and logged == []


async def test_accounting_failure_never_fails_the_embedding(monkeypatch):
    _client(monkeypatch)

    async def boom(**_kw):
        raise RuntimeError("db down")

    monkeypatch.setattr(cost_module, "log_llm_call", boom)
    assert len(await emb_mod.generate_embeddings("slide text")) == emb_mod.EMBEDDING_DIMS
```
Append to `backend/tests/unit/test_unified_orchestrator.py`, after `test_llm_usage_receipt_surfaces_dropped_calls`:
```python
def test_llm_usage_receipt_counts_embedding_calls_run_level_and_flags_missing_usage():
    from backend.services.ai.call_context import ServedCall
    calls = [
        _served("groq", "m", 100, 10, 0.0, "BATCH_SLIDE_PROMPT", (0,)),
        ServedCall(provider="gemini", model="gemini-embedding-001", prompt_tokens=0, completion_tokens=0,
                   cost_usd=0.0, prompt_name="EMBEDDING", slide_indices=None, usage_reported=False),
    ]
    out, usage = uo._llm_usage_receipt([{"index": 0}], calls)
    assert [s["prompt"] for s in out[0]["served_by"]] == ["BATCH_SLIDE_PROMPT"]
    assert usage["by_prompt"]["EMBEDDING"] == {"calls": 1, "cost_usd": 0.0}
    assert usage["by_provider"]["gemini"]["calls"] == 1
    assert usage["calls_without_usage"] == 1
    # Slide embeddings are joined after the receipt is written: still not fully metered there.
    assert "embeddings" in usage["unmetered"]
```
**Step 2: run** `$PY -m pytest backend/tests/unit/test_embedding_metering.py backend/tests/unit/test_unified_orchestrator.py -k "embedding or metered or batch or flag" -m "not db" -q`. Expected failures:
- `AttributeError: module 'backend.services.ai.embeddings' has no attribute 'generate_embeddings_batch'` / `EMBED_BATCH_MAX`
- empty `sink`
- `TypeError: ServedCall.__init__() got an unexpected keyword argument 'usage_reported'`

**Step 3: implementation.**

In `call_context.py`, add after `prompt_version: Optional[str] = None` in `ServedCall`:
```python
    # False when the provider reported no token counts (Gemini embeddings on
    # the Developer API): prompt_tokens is then 0, not a measurement.
    usage_reported: bool = True
```
In `embeddings.py`:
- Change `from typing import List` to `from typing import List, Optional, Sequence, Tuple, Union`.
- After `EMBEDDING_DIMS = 768`, add:
```python
# Arc 8 metering. "gemini" is the provider id used in llm_calls for the same
# GEMINI_API_KEY. Pricing: cost.estimate_cost prices every non-OpenAI
# provider at $0 (free tier, see cost.py); Google's paid-tier embedding price
# is not recorded anywhere in this codebase, so no price is guessed here.
EMBEDDING_PROVIDER = "gemini"
EMBEDDING_PROMPT_NAME = "EMBEDDING"
# Gemini's batchEmbedContents accepts at most 100 texts per request.
EMBED_BATCH_MAX = 100
```
Replace the whole `_sync_generate_embeddings` function with:
```python
def _fit_dims(values: List[float]) -> List[float]:
    if len(values) > EMBEDDING_DIMS:
        return values[:EMBEDDING_DIMS]
    if len(values) < EMBEDDING_DIMS:
        return values + [0.0] * (EMBEDDING_DIMS - len(values))
    return values


def _sync_embed(contents: Union[str, List[str]]) -> Tuple[List[List[float]], Optional[int]]:
    """One embed_content request for one text (str) or several (list).

    Returns the vectors in input order plus the summed token count, or None
    when the response carries none (the Gemini Developer API reports no
    ``statistics``; Vertex does). Never returns a zero vector: an
    unconfigured client raises EmbeddingUnavailableError, and every other
    failure (bad model name, network error, malformed or short response)
    propagates so the caller sees the real fault instead of silently writing
    useless all-zero vectors into pgvector and poisoning semantic-cache + RAG.
    """
    if not gemini_client:
        raise EmbeddingUnavailableError(
            "GEMINI_API_KEY is not configured, so no embedding can be produced. "
            "Refusing to return a zero vector: it would survive the retrieval "
            "similarity filter rather than simply being ignored."
        )

    # First try with explicit output_dimensionality; older SDKs don't ship
    # EmbedContentConfig and will raise ImportError/TypeError — for *those*
    # specific cases we fall back to the model's default dim and trim/pad.
    res = None
    try:
        from google.genai import types as _gtypes
        res = gemini_client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=contents,
            config=_gtypes.EmbedContentConfig(output_dimensionality=EMBEDDING_DIMS),
        )
    except (ImportError, AttributeError, TypeError) as sdk_compat:
        logger.debug(
            "google-genai SDK lacks EmbedContentConfig (%s); retrying without config",
            sdk_compat,
        )
        res = gemini_client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=contents,
        )
    # Note: any *other* exception (RuntimeError, RPC error, 4xx/5xx)
    # propagates — we want the caller to know.

    if not res or not res.embeddings:
        raise RuntimeError(
            f"generate_embeddings: Gemini returned an empty embeddings response "
            f"for model {EMBEDDING_MODEL!r}. Check API key, quota, and model availability."
        )
    expected = 1 if isinstance(contents, str) else len(contents)
    if len(res.embeddings) != expected:
        raise RuntimeError(
            f"generate_embeddings: Gemini returned {len(res.embeddings)} embeddings for {expected} texts"
        )

    vectors: List[List[float]] = []
    tokens = 0
    reported = True
    for emb in res.embeddings:
        values = list(emb.values)
        # Guard: all-zero vector means something went wrong server-side (e.g. the
        # model returned an empty float array that was then padded).  Raise so the
        # caller knows to retry rather than persist a useless zero vector.
        if values and all(v == 0.0 for v in values):
            raise RuntimeError(
                f"generate_embeddings: received an all-zero vector from {EMBEDDING_MODEL!r}. "
                "This usually means the API returned an empty embedding. Retrying may help."
            )
        vectors.append(_fit_dims(values))
        count = getattr(getattr(emb, "statistics", None), "token_count", None)
        if count is None:
            reported = False
        else:
            tokens += int(count)
    return vectors, (tokens if reported else None)


def _sync_generate_embeddings(text: str) -> List[float]:
    """Synchronous single-text embedding (kept for existing callers)."""
    return _sync_embed(text)[0][0]


async def _account_for_embedding(tokens: Optional[int]) -> None:
    """Arc 8: meter one successful embedding request like a completion — a
    ServedCall for the parse receipt and a ``public.llm_calls`` row
    (feature "embedding"). Run-level: prompt_name is always EMBEDDING and no
    slide is attributed, whatever scope the caller is in. Never raises."""
    try:
        from backend.services.ai.call_context import ServedCall, current_llm_call_context, record_served_call
        from backend.services.ai.cost import LLMUsage, estimate_cost, log_llm_call

        usage = LLMUsage(prompt_tokens=tokens, completion_tokens=0) if tokens is not None else None
        cost = estimate_cost(EMBEDDING_PROVIDER, EMBEDDING_MODEL, usage)
        ctx = current_llm_call_context()
        record_served_call(ServedCall(
            provider=EMBEDDING_PROVIDER, model=EMBEDDING_MODEL,
            prompt_tokens=tokens or 0, completion_tokens=0, cost_usd=cost,
            prompt_name=EMBEDDING_PROMPT_NAME, slide_indices=None,
            usage_reported=tokens is not None,
        ))
        await log_llm_call(
            user_id=None, course_id=None, feature="embedding",
            provider_id=EMBEDDING_PROVIDER, model=EMBEDDING_MODEL, usage=usage, cost_usd=cost,
            run_id=ctx.run_id, slide_indices=None, prompt_name=EMBEDDING_PROMPT_NAME,
        )
    except Exception as exc:
        logger.warning("could not meter embedding call (non-fatal): %s", exc)
```
Replace the body of `generate_embeddings` after the blank-text guard. The final line `return await asyncio.to_thread(_sync_generate_embeddings, text)` becomes:
```python
    vectors, tokens = await asyncio.to_thread(_sync_embed, text)
    await _account_for_embedding(tokens)
    return vectors[0]
```
Add the docstring line `Arc 8: a successful call is metered (_account_for_embedding).` Then add after `generate_embeddings`:
```python
async def generate_embeddings_batch(texts: Sequence[str], *, meter: bool = True) -> List[List[float]]:
    """Embed up to EMBED_BATCH_MAX texts in ONE request; vectors in input order.

    Unlike batch_generate_embeddings (one request per text, failures become
    []), this raises on any failure, so a caller can fall back as a whole.
    ``meter=False`` is for the offline Deck Lab eval only: it must not write
    llm_calls rows into whatever database the shell's .env points at."""
    texts = list(texts)
    if not texts:
        return []
    if len(texts) > EMBED_BATCH_MAX:
        raise ValueError(f"{len(texts)} texts exceed one request's limit of {EMBED_BATCH_MAX}")
    if any(not t.strip() for t in texts):
        raise EmbeddingUnavailableError(
            "Refusing to embed blank text: the result would be a zero vector, "
            "which survives pgvector's similarity filter instead of being ignored."
        )
    vectors, tokens = await asyncio.to_thread(_sync_embed, texts)
    if meter:
        await _account_for_embedding(tokens)
    return vectors
```
In `unified_orchestrator._llm_usage_receipt`:
- Replace the docstring sentence `Vision, embeddings and the admin-slide classifier are not metered; ``unmetered`` names them so the totals are not read as complete.` with:
  `Vision and the admin-slide classifier are not metered. Embedding calls are (Arc 8: provider gemini, prompt EMBEDDING, run-level), but slide embeddings are joined after the receipt is written, so only those finished by then are counted; ``unmetered`` keeps naming embeddings so the totals are not read as complete. ``calls_without_usage`` counts calls whose provider reported no token counts.`
- Insert directly before `totals["vision_metered"] = False`:
```python
    totals["calls_without_usage"] = sum(1 for call in calls if not call.usage_reported)
```
In `backend/tests/unit/test_ai_models_smoke.py`, add after the imports:
```python
@pytest.fixture(autouse=True)
def _no_embedding_accounting(monkeypatch):
    """Arc 8 meters embeddings into llm_calls; these boundary tests only check
    the SDK call, and the unit-test DB guard would otherwise trip."""
    from backend.services.ai import cost as cost_module

    async def _noop(**_kw):
        return None

    monkeypatch.setattr(cost_module, "log_llm_call", _noop)
```
**Step 4: green.** Run the Step 2 command, then `$PY -m pytest backend/tests/unit/test_ai_models_smoke.py backend/tests/unit/test_embedding_zero_vector_guard.py backend/tests/unit/test_llm_call_context.py -m "not db" -q`, then the full suite `$PY -m pytest -m "not db" -q`. A `BlockedOutboundAccess` from any other test that calls the real `generate_embeddings` with a working fake client means it needs the same stub.

**Step 5: mutation check:**
- In `_account_for_embedding`, change `prompt_name=EMBEDDING_PROMPT_NAME, slide_indices=None,` (the ServedCall one) to `prompt_name=ctx.prompt_name, slide_indices=ctx.slide_indices,`. Expected to fail: `test_single_embedding_is_metered_with_reported_tokens`.
- Delete `    if len(res.embeddings) != expected:` and its `raise` block. Expected to fail: `test_batch_with_a_missing_vector_raises_and_is_not_metered`.
- Change `    if meter:` to `    if True:`. Expected to fail: `test_unmetered_batch_for_the_offline_eval`.

**Step 6: commit.** `feat(metering): single-request embedding batch; embeddings metered into call context and llm_calls; receipt counts calls without usage (Arc 8.3)`

---

## Task 4: Eval runner (embedding cache, held-out calibration, one probe run, decision rule)

**Files:**
- Create `backend/eval/embedding_cache.py`
- Rewrite `backend/eval/semantic_grounding_eval.py` (superset of Task 2)
- Create `backend/tests/unit/test_semantic_grounding_eval.py`

**Interfaces**
- Consumes:
  - Task 1 (`semantic_support`, `semantic_texts`, `DETERMINISTIC_REASONS`, `Embedder`, `SemanticVerdict`, `EmbeddingShapeError`)
  - Task 2 (`CALIBRATION_SETS`, `Calibration`, `calibrate_threshold`)
  - Task 3 (`generate_embeddings_batch(texts, meter=False)`, `EMBED_BATCH_MAX`, `EMBEDDING_MODEL`, `EMBEDDING_DIMS`)
  - `deck_lab.probe_question`, `PARAPHRASED`, `HALLUCINATED`; `decks.real_deck_pages(name, deck_dir)`
- Produces:
  - `ALLOW_API_ENV = "DECK_LAB_ALLOW_EMBEDDING_API"`, `DEFAULT_EMBEDDING_CACHE: Path` (= `backend/eval/data/grounding_embeddings.json`)
  - `class EmbeddingCacheMiss(RuntimeError)`; `text_key(text) -> str`
  - `EmbeddingCache(path, model, dims, vectors={}, fetched=0)` with `.load(path, model, dims)`, `.missing(texts)`, `.embedder(fetch=None) -> Embedder`, `.save()`
  - `COLUMNS`, `DECISION_COLUMN`, `MAX_FALSE_DROPS`, `MAX_FALSE_KEEPS`, `MAX_CALIBRATION_ERRORS`, `EXPECTED_PROBE_ANSWERS`
  - `SemanticOutcome`, `ColumnRates`, `SemanticProbeResult.rates(column)`, `Decision`, `SemanticRun`
  - `calibration_items(skeletons, sets=None)`, `probe_items(pairs, skeletons)`
  - `async calibrate(items, embed) -> Calibration`
  - `async run_semantic_probe(items, embed, threshold, missing_decks=()) -> SemanticProbeResult`
  - `decide(cal, probe, expected_answers=EXPECTED_PROBE_ANSWERS) -> Decision`
  - `async _live_fetch(texts)`; `async run_semantic_grounding(deck_dir: Path, cache_path: Path, allow_api: bool) -> SemanticRun`

**Step 1: failing tests.** Write `backend/tests/unit/test_semantic_grounding_eval.py`:
```python
"""Arc 8 measurement mechanics on the synthetic LONG_DECK. Exact cosines via
ScriptedEmbedder; offline (no network, no API)."""
from __future__ import annotations

import json

import pytest

from backend.eval import semantic_grounding_eval as sge
from backend.eval.data.grounding_probe import EN_OFF_TOPIC, ProbePair
from backend.eval.deck_lab import HALLUCINATED, PARAPHRASED, run_grounding_probe
from backend.eval.embedding_cache import EmbeddingCache, EmbeddingCacheMiss, text_key
from backend.services.parser.deck_plan import build_deck_skeleton
from backend.services.parser.semantic_grounding import claim_text, slide_text
from backend.tests.support.deck_lab_decks import LONG_DECK, write_pdf
from backend.tests.support.fake_embedder import HashingEmbedder, ScriptedEmbedder

SK = build_deck_skeleton(LONG_DECK)
SKELETONS = {"cal.pdf": SK, "probe.pdf": SK}
CAL_SETS = (("cal.pdf", [
    (3, "What does the alpha slide explain?", "The alpha concept", "The bravo concept"),
    (4, "What does the bravo slide explain?", "The bravo concept", "The charlie concept"),
    (5, "What does the charlie slide explain?", "The charlie concept", "Exactly 7 charlie concepts"),
], EN_OFF_TOPIC),)
PROBE = [
    ProbePair("probe.pdf", 6, "What does the delta slide explain?", "Fourth letter idea", "Quantum tunnelling", "en"),
    ProbePair("probe.pdf", 7, "What does the echo slide explain?", "Reverberation notion", "Sound bouncing idea", "en"),
]
COSINES = {
    claim_text("What does the alpha slide explain?", "The alpha concept"): 0.9,
    claim_text("What does the alpha slide explain?", "The bravo concept"): 0.3,
    claim_text("What does the bravo slide explain?", "The bravo concept"): 0.8,
    claim_text("What does the bravo slide explain?", "The charlie concept"): 0.2,
    claim_text("What does the charlie slide explain?", "The charlie concept"): 0.85,
    claim_text("What does the delta slide explain?", "Fourth letter idea"): 0.7,
    claim_text("What does the delta slide explain?", "Quantum tunnelling"): 0.2,
    claim_text("What does the echo slide explain?", "Reverberation notion"): 0.4,
    claim_text("What does the echo slide explain?", "Sound bouncing idea"): 0.6,
}


def _embedder():
    return ScriptedEmbedder([slide_text(SK, n) for n in range(1, len(SK.slides) + 1)], COSINES)


async def test_calibration_scores_calibration_answers_and_skips_gated_ones():
    cal = await sge.calibrate(sge.calibration_items(SKELETONS, CAL_SETS), _embedder())
    assert cal.grounded == pytest.approx((0.9, 0.8, 0.85))
    assert cal.ungrounded == pytest.approx((0.3, 0.2))
    assert cal.gated == 1  # "Exactly 7 charlie concepts": number_not_on_slide
    assert cal.threshold == pytest.approx(0.55) and cal.errors == 0


async def test_probe_reports_lexical_semantic_and_combined_columns():
    probe = await sge.run_semantic_probe(sge.probe_items(PROBE, SKELETONS), _embedder(), threshold=0.55)
    assert [(o.answer, o.lexical_ok, o.semantic_ok, o.combined_ok) for o in probe.outcomes] == [
        ("Fourth letter idea", False, True, True),
        ("Quantum tunnelling", False, False, False),
        ("Reverberation notion", False, False, False),
        ("Sound bouncing idea", False, True, True),
    ]
    assert probe.rates("lexical") == sge.ColumnRates(2, 2, 0, 2)
    assert probe.rates("semantic") == sge.ColumnRates(1, 2, 1, 2)
    assert probe.rates("combined") == sge.ColumnRates(1, 2, 1, 2)


async def test_lexical_column_reproduces_the_arc6_lexical_probe():
    probe = await sge.run_semantic_probe(sge.probe_items(PROBE, SKELETONS), _embedder(), threshold=0.55)
    arc6 = run_grounding_probe(PROBE, SKELETONS)
    assert [o.lexical_ok for o in probe.outcomes] == [o.accepted for o in arc6.outcomes]


async def test_combined_keeps_a_lexically_supported_answer_the_cosine_misses():
    pair = ProbePair("probe.pdf", 8, "What does the foxtrot slide explain?", "The foxtrot concept",
                     "Quantum tunnelling", "en")
    probe = await sge.run_semantic_probe(sge.probe_items([pair], SKELETONS), _embedder(), threshold=0.55)
    para = probe.outcomes[0]
    assert para.lexical_ok and not para.semantic_ok and para.combined_ok


def _probe_with(fd, fk, n=16):
    outcomes = []
    for i in range(n):
        pair = ProbePair("p.pdf", i + 1, "s", "p", "h", "en")
        outcomes.append(sge.SemanticOutcome(pair, PARAPHRASED, "p", 0.0, 0.0, "x", False, i >= fd, i >= fd))
        outcomes.append(sge.SemanticOutcome(pair, HALLUCINATED, "h", 0.0, 0.0, "x", False, i < fk, i < fk))
    return sge.SemanticProbeResult(0.5, tuple(outcomes), ())


@pytest.mark.parametrize("fd, fk, eligible", [(2, 1, True), (3, 0, False), (0, 2, False)])
def test_pre_registered_gate(fd, fk, eligible):
    assert sge.decide(sge.calibrate_threshold([0.8, 0.9], [0.2, 0.3]), _probe_with(fd, fk)).eligible is eligible


def test_gate_names_every_failure():
    bad_cal = sge.Calibration(threshold=0.5, grounded=(0.1, 0.2, 0.3, 0.9), ungrounded=(0.1,))
    d = sge.decide(bad_cal, _probe_with(3, 2, n=10))
    assert not d.eligible
    assert d.failures == (
        "probe incomplete: 20/32 answers scored",
        "calibration errors 3/5 > 2",
        "combined false drop 3/10 > 2",
        "combined false keep 2/10 > 1",
    )


def test_decision_constants_are_the_pre_registered_ones():
    assert (sge.DECISION_COLUMN, sge.MAX_FALSE_DROPS, sge.MAX_FALSE_KEEPS,
            sge.MAX_CALIBRATION_ERRORS, sge.EXPECTED_PROBE_ANSWERS) == ("combined", 2, 1, 2, 32)


async def test_cache_fetches_misses_once_then_serves_offline(tmp_path):
    path = tmp_path / "emb.json"
    fetched = []

    async def fetch(texts):
        fetched.append(list(texts))
        return [[float(len(t)), 1.0] for t in texts]

    cache = EmbeddingCache.load(path, "m", 2)
    out = await cache.embedder(fetch)(["zz one", "zz three", "zz one"])
    assert fetched == [["zz one", "zz three"]] and out == [[6.0, 1.0], [8.0, 1.0], [6.0, 1.0]]
    assert cache.fetched == 2
    cache.save()
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    assert (data["model"], data["dims"]) == ("m", 2) and set(data["vectors"]) == {text_key("zz one"), text_key("zz three")}
    assert "zz" not in raw  # keys are hashes: no slide text in the file
    offline = EmbeddingCache.load(path, "m", 2)
    assert await offline.embedder()(["zz three"]) == [[8.0, 1.0]]
    with pytest.raises(EmbeddingCacheMiss, match="DECK_LAB_ALLOW_EMBEDDING_API"):
        await offline.embedder()(["never seen"])


def test_cache_refuses_vectors_from_another_model(tmp_path):
    path = tmp_path / "emb.json"
    EmbeddingCache(path, "m", 2, {text_key("x"): [1.0, 0.0]}).save()
    with pytest.raises(ValueError, match="m/2"):
        EmbeddingCache.load(path, "other", 2)


@pytest.fixture
def lab(tmp_path, monkeypatch):
    deck_dir = tmp_path / "decks"
    deck_dir.mkdir()
    write_pdf(deck_dir / "cal.pdf", LONG_DECK)
    write_pdf(deck_dir / "probe.pdf", LONG_DECK)
    monkeypatch.setattr(sge, "CALIBRATION_SETS", CAL_SETS)
    monkeypatch.setattr(sge, "PROBE_PAIRS", PROBE)
    live = HashingEmbedder()
    monkeypatch.setattr(sge, "_live_fetch", live)
    return deck_dir, tmp_path / "emb.json", live


async def test_run_fetches_once_then_reruns_offline_identically(lab):
    deck_dir, cache, live = lab
    first = await sge.run_semantic_grounding(deck_dir, cache, allow_api=True)
    assert len(live.calls) == 1 and first.fetched > 0 and cache.exists()
    second = await sge.run_semantic_grounding(deck_dir, cache, allow_api=False)
    assert len(live.calls) == 1 and second.fetched == 0 and second.cached == first.fetched
    assert second.calibration == first.calibration and second.probe == first.probe
    assert first.decision.failures[0] == "probe incomplete: 4/32 answers scored"


async def test_offline_run_without_a_cache_raises_before_any_fetch(lab):
    deck_dir, cache, live = lab
    with pytest.raises(EmbeddingCacheMiss):
        await sge.run_semantic_grounding(deck_dir, cache, allow_api=False)
    assert live.calls == [] and not cache.exists()


async def test_missing_calibration_decks_score_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(sge, "CALIBRATION_SETS", CAL_SETS)
    monkeypatch.setattr(sge, "PROBE_PAIRS", PROBE)
    run = await sge.run_semantic_grounding(tmp_path, tmp_path / "emb.json", allow_api=False)
    assert run.missing_calibration_decks == ("cal.pdf",) and run.calibration is None and run.probe is None


async def test_calibration_and_probe_decks_must_be_disjoint(tmp_path, monkeypatch):
    monkeypatch.setattr(sge, "CALIBRATION_SETS", CAL_SETS)
    monkeypatch.setattr(sge, "PROBE_PAIRS", [ProbePair("cal.pdf", 6, "s", "p", "h", "en")])
    with pytest.raises(ValueError, match="overlap"):
        await sge.run_semantic_grounding(tmp_path, tmp_path / "emb.json", allow_api=False)
```
**Step 2: run** `$PY -m pytest backend/tests/unit/test_semantic_grounding_eval.py -m "not db" -q`. Expected: `ModuleNotFoundError: No module named 'backend.eval.embedding_cache'`.

**Step 3: implementation.** Write `backend/eval/embedding_cache.py`:
```python
"""Offline embedding cache for the Deck Lab semantic grounding run (Arc 8).

Vectors live in one JSON file keyed by sha256(text), so the file holds no
slide text. The file records model and dimensions; loading it for another
model or dimension is refused rather than mixing vectors.

``embedder(fetch)`` serves cached vectors and sends only misses to
``fetch``. With ``fetch=None`` (offline, the default) a miss raises
EmbeddingCacheMiss, so a rerun can never reach the network by accident.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence

from backend.services.parser.semantic_grounding import Embedder, EmbeddingShapeError

ALLOW_API_ENV = "DECK_LAB_ALLOW_EMBEDDING_API"
DEFAULT_EMBEDDING_CACHE = Path(__file__).resolve().parent / "data" / "grounding_embeddings.json"


class EmbeddingCacheMiss(RuntimeError):
    """Texts are missing from the cache and fetching them was not allowed."""


def text_key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass
class EmbeddingCache:
    path: Path
    model: str
    dims: int
    vectors: Dict[str, List[float]] = field(default_factory=dict)
    fetched: int = 0

    @classmethod
    def load(cls, path: Path, model: str, dims: int) -> "EmbeddingCache":
        if not path.exists():
            return cls(path, model, dims)
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("model") != model or data.get("dims") != dims:
            raise ValueError(f"{path} holds {data.get('model')}/{data.get('dims')} vectors, not {model}/{dims}")
        return cls(path, model, dims, {k: [float(x) for x in v] for k, v in data["vectors"].items()})

    def missing(self, texts: Sequence[str]) -> List[str]:
        return [t for t in dict.fromkeys(texts) if text_key(t) not in self.vectors]

    def embedder(self, fetch: Optional[Embedder] = None) -> Embedder:
        async def embed(texts: Sequence[str]) -> List[List[float]]:
            miss = self.missing(texts)
            if miss:
                if fetch is None:
                    raise EmbeddingCacheMiss(
                        f"{len(miss)} text(s) are not in {self.path}. Fetching them sends slide text to "
                        f"Google's embedding API; set {ALLOW_API_ENV}=1 to allow it.")
                vectors = list(await fetch(miss))
                if len(vectors) != len(miss) or any(not v for v in vectors):
                    raise EmbeddingShapeError(f"fetch returned {len(vectors)} usable vectors for {len(miss)} texts")
                for text, vec in zip(miss, vectors):
                    self.vectors[text_key(text)] = [float(x) for x in vec]
                self.fetched += len(miss)
            return [self.vectors[text_key(t)] for t in texts]

        return embed

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"model": self.model, "dims": self.dims, "vectors": dict(sorted(self.vectors.items()))}
        self.path.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
```
Rewrite `backend/eval/semantic_grounding_eval.py` in full:
```python
"""Arc 8 semantic grounding measurement: held-out calibration, then one probe run.

Protocol (pre-registered in docs/superpowers/plans/2026-10-11-arc-8-semantic-grounding.md):
  1. The cosine threshold is fitted ONLY on the Arc 4 calibration pairs
     (backend/eval/data/grounding_calibration.py) with ``calibrate_threshold``.
  2. The probe (backend/eval/data/grounding_probe.py, disjoint decks) is scored
     once at that threshold; its scores never feed back into step 1.
  3. ``decide`` applies the pre-registered gate to the combined scorer.
Embeddings come from an EmbeddingCache; the live API is reached only when
the caller allows it (deck_lab: DECK_LAB_ALLOW_EMBEDDING_API=1), unmetered,
in requests of at most EMBED_BATCH_MAX texts.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

from backend.eval.data.grounding_calibration import CALIBRATION_SETS
from backend.eval.data.grounding_probe import PROBE_PAIRS, ProbePair
from backend.eval.deck_lab import HALLUCINATED, PARAPHRASED, probe_question
from backend.eval.decks import real_deck_pages
from backend.eval.embedding_cache import EmbeddingCache
from backend.services.parser.deck_plan import DeckSkeleton, build_deck_skeleton
from backend.services.parser.semantic_grounding import (
    DETERMINISTIC_REASONS,
    Embedder,
    SemanticVerdict,
    semantic_support,
    semantic_texts,
)

# ── pre-registered decision rule (fixed before the real embedding run) ─────
COLUMNS = ("lexical", "semantic", "combined")
DECISION_COLUMN = "combined"
MAX_FALSE_DROPS = 2          # of 16 paraphrased answers
MAX_FALSE_KEEPS = 1          # of 16 hallucinated answers
MAX_CALIBRATION_ERRORS = 2   # of the scored calibration answers
EXPECTED_PROBE_ANSWERS = 2 * len(PROBE_PAIRS)  # 32


@dataclass(frozen=True)
class Calibration:
    threshold: float
    grounded: tuple[float, ...]
    ungrounded: tuple[float, ...]
    gated: int = 0  # calibration answers decided by a deterministic gate, not scored

    @property
    def false_drops(self) -> int:
        return sum(1 for s in self.grounded if s < self.threshold)

    @property
    def false_keeps(self) -> int:
        return sum(1 for s in self.ungrounded if s >= self.threshold)

    @property
    def errors(self) -> int:
        return self.false_drops + self.false_keeps

    @property
    def scored(self) -> int:
        return len(self.grounded) + len(self.ungrounded)


def calibrate_threshold(grounded: Sequence[float], ungrounded: Sequence[float], gated: int = 0) -> Calibration:
    """Pre-registered rule: candidates are the midpoints between adjacent
    distinct scores; pick the fewest errors (grounded < t plus ungrounded >= t),
    then the widest gap around the midpoint (rounded to 1e-9), then the higher
    threshold. Sees calibration scores only."""
    if not grounded or not ungrounded:
        raise ValueError("calibration needs grounded and ungrounded scores")
    values = sorted(set(grounded) | set(ungrounded))
    if len(values) < 2:
        raise ValueError("calibration scores do not vary; no threshold separates them")
    best: tuple[tuple[int, float, float], float] | None = None
    for lo, hi in zip(values, values[1:]):
        t = (lo + hi) / 2
        errors = sum(1 for s in grounded if s < t) + sum(1 for s in ungrounded if s >= t)
        rank = (errors, -round(hi - lo, 9), -t)
        if best is None or rank < best[0]:
            best = (rank, t)
    return Calibration(best[1], tuple(grounded), tuple(ungrounded), gated)


@dataclass(frozen=True)
class SemanticOutcome:
    pair: ProbePair
    kind: str  # PARAPHRASED | HALLUCINATED
    answer: str
    lexical: float
    cosine: float
    reason: str  # the combined verdict's reason
    lexical_ok: bool
    semantic_ok: bool
    combined_ok: bool

    def kept(self, column: str) -> bool:
        return {"lexical": self.lexical_ok, "semantic": self.semantic_ok, "combined": self.combined_ok}[column]


@dataclass(frozen=True)
class ColumnRates:
    false_drops: int
    paraphrased: int
    false_keeps: int
    hallucinated: int


@dataclass(frozen=True)
class SemanticProbeResult:
    threshold: float
    outcomes: tuple[SemanticOutcome, ...]
    missing_decks: tuple[str, ...]

    def rates(self, column: str) -> ColumnRates:
        para = [o for o in self.outcomes if o.kind == PARAPHRASED]
        hall = [o for o in self.outcomes if o.kind == HALLUCINATED]
        return ColumnRates(sum(1 for o in para if not o.kept(column)), len(para),
                           sum(1 for o in hall if o.kept(column)), len(hall))


@dataclass(frozen=True)
class Decision:
    eligible: bool
    failures: tuple[str, ...]


@dataclass(frozen=True)
class SemanticRun:
    calibration: Calibration | None
    probe: SemanticProbeResult | None
    decision: Decision | None
    missing_calibration_decks: tuple[str, ...]
    fetched: int  # texts sent to the live API in this run
    cached: int   # distinct texts served from the cache file
    cache_path: Path
    model: str


def calibration_question(stem: str, key: str, distractors: Sequence[str], slide: int) -> dict:
    """The question exactly as tests/unit/test_quiz_grounding_real_decks.py builds it."""
    return {"question": stem, "options": [key, *distractors], "correctAnswer": key, "source_slide": slide}


def calibration_items(skeletons: Mapping[str, DeckSkeleton], sets=None) -> list[tuple[str, dict, DeckSkeleton]]:
    sets = CALIBRATION_SETS if sets is None else sets
    items: list[tuple[str, dict, DeckSkeleton]] = []
    for deck, pairs, distractors in sets:
        sk = skeletons.get(deck)
        if sk is None:
            continue
        for slide, stem, good, bad in pairs:
            items.append(("grounded", calibration_question(stem, good, distractors, slide), sk))
            items.append(("ungrounded", calibration_question(stem, bad, distractors, slide), sk))
    return items


def probe_items(pairs: Sequence[ProbePair], skeletons: Mapping[str, DeckSkeleton]) -> list[tuple]:
    out: list[tuple] = []
    for pair in pairs:
        sk = skeletons.get(pair.deck)
        if sk is None:
            continue
        for kind, answer in ((PARAPHRASED, pair.paraphrased), (HALLUCINATED, pair.hallucinated)):
            out.append((pair, kind, answer, probe_question(pair, answer), sk))
    return out


async def calibrate(items: Sequence[tuple[str, dict, DeckSkeleton]], embed: Embedder) -> Calibration:
    grounded: list[float] = []
    ungrounded: list[float] = []
    gated = 0
    for label, q, sk in items:
        v = await semantic_support(q, sk, embed, threshold=math.inf)  # raw cosine; no ambiguity at inf
        if v.reason in DETERMINISTIC_REASONS:
            gated += 1
            continue
        (grounded if label == "grounded" else ungrounded).append(v.cosine)
    return calibrate_threshold(grounded, ungrounded, gated)


def outcome_from_verdict(pair: ProbePair, kind: str, answer: str, v: SemanticVerdict,
                         threshold: float) -> SemanticOutcome:
    decided = v.reason in DETERMINISTIC_REASONS or v.reason == "ambiguous"
    return SemanticOutcome(pair, kind, answer, v.lexical, v.cosine, v.reason,
                           lexical_ok=v.lexical_ok,
                           semantic_ok=not decided and v.cosine >= threshold,
                           combined_ok=v.ok)


async def run_semantic_probe(items: Sequence[tuple], embed: Embedder, threshold: float,
                             missing_decks: Sequence[str] = ()) -> SemanticProbeResult:
    outcomes = []
    for pair, kind, answer, q, sk in items:
        v = await semantic_support(q, sk, embed, threshold)
        outcomes.append(outcome_from_verdict(pair, kind, answer, v, threshold))
    return SemanticProbeResult(threshold, tuple(outcomes), tuple(missing_decks))


def decide(cal: Calibration, probe: SemanticProbeResult,
           expected_answers: int = EXPECTED_PROBE_ANSWERS) -> Decision:
    failures: list[str] = []
    if len(probe.outcomes) != expected_answers:
        failures.append(f"probe incomplete: {len(probe.outcomes)}/{expected_answers} answers scored")
    if cal.errors > MAX_CALIBRATION_ERRORS:
        failures.append(f"calibration errors {cal.errors}/{cal.scored} > {MAX_CALIBRATION_ERRORS}")
    r = probe.rates(DECISION_COLUMN)
    if r.false_drops > MAX_FALSE_DROPS:
        failures.append(f"{DECISION_COLUMN} false drop {r.false_drops}/{r.paraphrased} > {MAX_FALSE_DROPS}")
    if r.false_keeps > MAX_FALSE_KEEPS:
        failures.append(f"{DECISION_COLUMN} false keep {r.false_keeps}/{r.hallucinated} > {MAX_FALSE_KEEPS}")
    return Decision(not failures, tuple(failures))


async def _live_fetch(texts: Sequence[str]) -> list[list[float]]:
    """Google's embedding API, unmetered (an eval must not write llm_calls rows
    into whatever database the shell's .env names), <= EMBED_BATCH_MAX per request."""
    from backend.services.ai.embeddings import EMBED_BATCH_MAX, generate_embeddings_batch

    texts = list(texts)
    out: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH_MAX):
        out.extend(await generate_embeddings_batch(texts[i:i + EMBED_BATCH_MAX], meter=False))
    return out


async def run_semantic_grounding(deck_dir: Path, cache_path: Path, allow_api: bool) -> SemanticRun:
    from backend.services.ai.embeddings import EMBEDDING_DIMS, EMBEDDING_MODEL

    cal_decks = [deck for deck, _, _ in CALIBRATION_SETS]
    overlap = set(cal_decks) & {p.deck for p in PROBE_PAIRS}
    if overlap:
        raise ValueError(f"calibration and probe decks overlap: {sorted(overlap)}")
    skeletons: dict[str, DeckSkeleton] = {}
    for deck in dict.fromkeys([*cal_decks, *(p.deck for p in PROBE_PAIRS)]):
        pages = real_deck_pages(deck, deck_dir)
        if pages is not None:
            skeletons[deck] = build_deck_skeleton(pages)
    missing_cal = tuple(d for d in cal_decks if d not in skeletons)
    if missing_cal:
        return SemanticRun(None, None, None, missing_cal, 0, 0, cache_path, EMBEDDING_MODEL)
    missing_probe = tuple(sorted({p.deck for p in PROBE_PAIRS} - set(skeletons)))
    cache = EmbeddingCache.load(cache_path, EMBEDDING_MODEL, EMBEDDING_DIMS)
    embed = cache.embedder(_live_fetch if allow_api else None)
    cal_items = calibration_items(skeletons)
    pr_items = probe_items(PROBE_PAIRS, skeletons)
    texts = [t for _, q, sk in cal_items for t in semantic_texts(q, sk)]
    texts += [t for *_, q, sk in pr_items for t in semantic_texts(q, sk)]
    unique = list(dict.fromkeys(texts))
    await embed(unique)  # one prefetch: every miss goes out together
    calibration = await calibrate(cal_items, embed)  # calibration decks only
    probe = await run_semantic_probe(pr_items, embed, calibration.threshold, missing_probe)  # once, at that threshold
    if cache.fetched:
        cache.save()
    return SemanticRun(calibration, probe, decide(calibration, probe), (), cache.fetched,
                       len(unique) - cache.fetched, cache_path, EMBEDDING_MODEL)
```
**Step 4: green.** Run the Step 1 command, then `$PY -m pytest backend/tests/unit/test_semantic_calibration.py backend/tests/unit/test_deck_lab_cli.py -m "not db" -q`, then the full suite.

**Step 5: mutation check:**
- In `decide`, change `if r.false_drops > MAX_FALSE_DROPS:` to `if r.false_drops >= MAX_FALSE_DROPS:`. Expected to fail: `test_pre_registered_gate[2-1-True]`.
- In `EmbeddingCache.embedder`, delete `if fetch is None:` and its `raise` (dedenting nothing else). Expected to fail: `test_cache_fetches_misses_once_then_serves_offline` and `test_offline_run_without_a_cache_raises_before_any_fetch`.
- In `outcome_from_verdict`, change `semantic_ok=not decided and v.cosine >= threshold,` to `semantic_ok=not decided,`. Expected to fail: `test_probe_reports_lexical_semantic_and_combined_columns`.

**Step 6: commit.** `feat(eval): offline embedding cache, held-out semantic calibration, single probe run and pre-registered gate (Arc 8.4)`

---

## Task 5: Production wiring (GROUNDING_SCORER, bounded and fail-open)

**Files:**
- Modify `backend/core/config.py`
- Modify `backend/services/parser/synthesis.py`
- Create `backend/tests/unit/test_synthesis_semantic_grounding.py`

**Interfaces**
- Consumes: Task 1 (`BoundedEmbedder`, `EmbeddingBudgetExceeded`, `semantic_support`, `semantic_texts`, `semantic_grounding.SEMANTIC_SUPPORT_THRESHOLD`); Task 3 (`generate_embeddings_batch`, `EMBED_BATCH_MAX`).
- Produces:
  - `Settings.grounding_scorer: str` (alias `GROUNDING_SCORER`, default `"lexical"`)
  - `synthesis.MAX_GROUNDING_EMBED_TEXTS = 120`
  - `async synthesis._grounding_embed(texts) -> list[list[float]]`
  - `synthesis._requested_scorer() -> str`
  - Grounding summary gains `"scorer"` (and `"scorer_fallback"` ∈ {uncalibrated, over_embed_cap, embedding_error}) ONLY when semantic is requested. The default summary is byte-identical.

**Step 1: failing tests.** Write `backend/tests/unit/test_synthesis_semantic_grounding.py`:
```python
"""Arc 8: GROUNDING_SCORER wiring in ground_deck_quiz. The default is
unchanged; semantic mode makes one bounded embedding request per deck and
fails open to the lexical verifier."""
from __future__ import annotations

import json

import pytest

from backend.core.config import Settings, settings
from backend.services.parser import semantic_grounding, synthesis
from backend.tests.support.fake_embedder import HashingEmbedder
from backend.tests.support.quiz_grounding_deck import GRAPH_DECK_PAGES

SYNONYMS = {"minimal": "shortest", "routes": "paths", "origin": "source", "determines": "computes"}
STEM = "What does this procedure determine?"


def _mcq(options, answer, source=3, stem=STEM):
    return {"question": stem, "options": options, "correctAnswer": answer, "source_slide": source,
            "concept": "c", "explanation": "e", "difficulty": "easy"}


PARAPHRASE = _mcq(["Minimal routes from one origin", "Photosynthesis", "Plate tectonics", "Baroque counterpoint"],
                  "Minimal routes from one origin")
GOOD = _mcq(["Dijkstra", "Kruskal", "Prim", "Floyd"], "Dijkstra",
            stem="Which algorithm computes shortest paths from a single source?")
NO_SOURCE = {k: v for k, v in GOOD.items() if k != "source_slide"}


@pytest.fixture
def llm(monkeypatch):
    box = {"reply": "[]", "calls": 0}

    async def _gen(prompt, ai_model=None):
        box["calls"] += 1
        return box["reply"]

    monkeypatch.setattr(synthesis, "generate_text", _gen)
    monkeypatch.setattr(synthesis, "generate_text_bulk", _gen)
    return box


@pytest.fixture
def embed(monkeypatch):
    fake = HashingEmbedder(SYNONYMS)
    monkeypatch.setattr(synthesis, "_grounding_embed", fake)
    return fake


@pytest.fixture
def semantic(monkeypatch):
    monkeypatch.setattr(settings, "grounding_scorer", "semantic", raising=False)
    monkeypatch.setattr(semantic_grounding, "SEMANTIC_SUPPORT_THRESHOLD", 0.4)


async def _quiz(llm, questions, stats=None):
    llm["reply"] = json.dumps(questions)
    return await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq", stats=stats)


def test_default_scorer_is_lexical():
    assert Settings.model_fields["grounding_scorer"].default == "lexical"


async def test_default_mode_never_embeds_and_keeps_the_arc6_summary(llm, embed):
    stats: dict = {}
    out = await _quiz(llm, [PARAPHRASE], stats)
    assert out[0]["grounding_flag"] == "low_support"
    assert embed.calls == [] and "scorer" not in stats


async def test_semantic_keeps_a_paraphrase_unflagged_with_one_request_per_deck(llm, embed, semantic):
    stats: dict = {}
    out = await _quiz(llm, [PARAPHRASE, GOOD, NO_SOURCE], stats)
    assert [q["question"] for q in out] == [PARAPHRASE["question"], GOOD["question"]]
    assert "grounding_flag" not in out[0]
    assert out[0]["support_score"] == pytest.approx(0.471, abs=0.001)
    assert len(embed.calls) == 1 and len(embed.calls[0]) == 9  # slide 3 + 4 claims x 2 questions
    assert stats["scorer"] == "semantic" and "scorer_fallback" not in stats
    assert stats["drop_reasons"] == {"no_source": 1}


async def test_embedding_failure_falls_back_to_lexical_and_never_fails_the_quiz(llm, monkeypatch, semantic):
    fake = HashingEmbedder(SYNONYMS, fail=True)
    monkeypatch.setattr(synthesis, "_grounding_embed", fake)
    stats: dict = {}
    out = await _quiz(llm, [PARAPHRASE, GOOD], stats)
    assert [q.get("grounding_flag") for q in out] == ["low_support", None]
    assert stats["scorer"] == "lexical" and stats["scorer_fallback"] == "embedding_error"
    assert len(fake.calls) == 1


async def test_uncalibrated_threshold_falls_back_without_embedding(llm, embed, monkeypatch):
    monkeypatch.setattr(settings, "grounding_scorer", "semantic", raising=False)
    monkeypatch.setattr(semantic_grounding, "SEMANTIC_SUPPORT_THRESHOLD", None)
    stats: dict = {}
    await _quiz(llm, [PARAPHRASE], stats)
    assert embed.calls == [] and stats["scorer"] == "lexical" and stats["scorer_fallback"] == "uncalibrated"


async def test_over_budget_deck_falls_back_without_embedding(llm, embed, semantic, monkeypatch):
    monkeypatch.setattr(synthesis, "MAX_GROUNDING_EMBED_TEXTS", 3)
    stats: dict = {}
    await _quiz(llm, [PARAPHRASE], stats)
    assert embed.calls == [] and stats["scorer_fallback"] == "over_embed_cap"


async def test_one_unusable_vector_falls_back_for_that_question_only(llm, semantic, monkeypatch):
    real = HashingEmbedder(SYNONYMS)

    async def zero_for_paraphrase(texts):
        return [[0.0] * real.DIMS if "Minimal routes" in t else real.vector(t) for t in texts]

    monkeypatch.setattr(synthesis, "_grounding_embed", zero_for_paraphrase)
    stats: dict = {}
    out = await _quiz(llm, [PARAPHRASE, GOOD], stats)
    assert [q.get("grounding_flag") for q in out] == ["low_support", None]
    assert stats["scorer"] == "semantic"


async def test_enforce_with_semantic_does_not_repair_a_supported_paraphrase(llm, embed, semantic, monkeypatch):
    monkeypatch.setattr(synthesis, "ENFORCE_SUPPORT_THRESHOLD", True)
    out = await _quiz(llm, [PARAPHRASE])
    assert len(out) == 1 and llm["calls"] == 1
```
**Step 2: run** `$PY -m pytest backend/tests/unit/test_synthesis_semantic_grounding.py -m "not db" -q`. Expected failures:
- `KeyError: 'grounding_scorer'` (model_fields)
- `AttributeError: <module synthesis> has no attribute '_grounding_embed'`

**Step 3: implementation.**

In `backend/core/config.py`, after the `parser_llm_model` field, add:
```python
    # Arc 8: deck-quiz grounding scorer. "lexical" (default) is the Arc 4
    # token-overlap verifier. "semantic" adds a Gemini embedding signal
    # (services/parser/semantic_grounding.py); it needs a calibrated
    # SEMANTIC_SUPPORT_THRESHOLD and falls back to lexical until then.
    grounding_scorer: str = Field(alias="GROUNDING_SCORER", default="lexical")
```
In `synthesis.py`:
- Imports: add `from backend.core.config import settings` and `from backend.services.ai.embeddings import EMBED_BATCH_MAX, generate_embeddings_batch` after the `call_context` import.
- Add `from backend.services.parser import semantic_grounding` and `from backend.services.parser.semantic_grounding import BoundedEmbedder, EmbeddingBudgetExceeded, semantic_support, semantic_texts` after the `quiz_grounding` import.
- Replace the last line of the ENFORCE comment block, `# in both modes.`, with:
```python
# in both modes.
# Arc 8: the semantic scorer exists (GROUNDING_SCORER=semantic). The probe
# re-run and its pre-registered gate are in
# docs/superpowers/plans/2026-10-11-arc-8-semantic-grounding.md; this flag
# changes only as that gate decides.
```
Add after `ENFORCE_SUPPORT_THRESHOLD = False`:
```python
# Arc 8: per-deck embedding budget for GROUNDING_SCORER=semantic. The first
# request embeds every cited slide plus each question's key and distractor
# claims (12 questions x 5 texts = 60); enforce-mode repairs may fetch the
# rest. One request carries at most EMBED_BATCH_MAX texts.
MAX_GROUNDING_EMBED_TEXTS = 120


async def _grounding_embed(texts: List[str]) -> List[List[float]]:
    """Production embedder for semantic grounding: one metered Gemini request."""
    return await generate_embeddings_batch(list(texts))


def _requested_scorer() -> str:
    return "semantic" if getattr(settings, "grounding_scorer", "lexical") == "semantic" else "lexical"
```
In `ground_deck_quiz`, insert directly after `repair_slots = asyncio.Semaphore(MAX_CONCURRENT_REPAIRS)`:
```python
    scorer = _requested_scorer()
    threshold = semantic_grounding.SEMANTIC_SUPPORT_THRESHOLD
    fallback = ""
    embedder: BoundedEmbedder | None = None
    if scorer == "semantic":
        if threshold is None:
            fallback = "uncalibrated"
        else:
            embedder = BoundedEmbedder(_grounding_embed, MAX_GROUNDING_EMBED_TEXTS, EMBED_BATCH_MAX)
            texts: List[str] = []
            for q in questions:
                if isinstance(q, dict):
                    try:
                        texts += semantic_texts(q, skeleton)
                    except Exception:  # _one reports this question's own failure
                        pass
            try:
                await embedder(list(dict.fromkeys(texts)))  # the whole deck in one request
            except EmbeddingBudgetExceeded:
                fallback, embedder = "over_embed_cap", None
            except Exception as exc:
                logger.warning("semantic grounding unavailable, using lexical (non-fatal): %s", exc)
                fallback, embedder = "embedding_error", None

    async def _verdict(q: Dict[str, Any]) -> GroundingVerdict:
        if embedder is None:
            return assess_grounding(q, skeleton)
        try:
            return await semantic_support(q, skeleton, embedder, threshold)
        except Exception as exc:
            logger.warning("semantic grounding failed for one question, using lexical: %s", exc)
            return assess_grounding(q, skeleton)
```
In `_one`:
- Replace `        verdict = assess_grounding(q, skeleton)` with `        verdict = await _verdict(q)`.
- Replace `        second = assess_grounding(repaired, skeleton)` with `        second = await _verdict(repaired)`.

Insert directly before `    logger.info("deck_quiz_grounding %s", json.dumps(summary, sort_keys=True))`:
```python
    if scorer == "semantic":
        summary["scorer"] = "semantic" if embedder is not None else "lexical"
        if fallback:
            summary["scorer_fallback"] = fallback
```
**Step 4: green.** Run the Step 1 file, then `$PY -m pytest backend/tests/unit/test_synthesis.py backend/tests/unit/test_synthesis_quiz_mapping.py backend/tests/unit/test_unified_orchestrator.py -m "not db" -q`. The exact-equality summary test `test_advisory_summary_counts_flags_and_matches_stats` must still pass. Then the full suite.

**Step 5: mutation check:**
- Revert `        verdict = await _verdict(q)` to `        verdict = assess_grounding(q, skeleton)`. Expected to fail: `test_semantic_keeps_a_paraphrase_unflagged_with_one_request_per_deck`.
- Remove the `except Exception as exc:` branch around `await embedder(...)` (keeping only `except EmbeddingBudgetExceeded`). Expected to fail: `test_embedding_failure_falls_back_to_lexical_and_never_fails_the_quiz` (RuntimeError escapes).
- Change `default="lexical"` to `default="semantic"`. Expected to fail: `test_default_scorer_is_lexical`.

**Step 6: commit.** `feat(grounding): GROUNDING_SCORER setting; semantic grounding in ground_deck_quiz, one bounded embedding request per deck, fail-open to lexical (Arc 8.5)`

---

## Task 6: Deck Lab "Semantic grounding" section and opt-in CLI step

**Files:**
- Modify `backend/eval/deck_lab.py`
- Modify `backend/eval/README.md`
- Create `backend/tests/unit/test_deck_lab_semantic.py`

**Interfaces**
- Consumes: Task 4 (`SemanticRun`, `SemanticProbeResult.rates`, `COLUMNS`, gate constants, `run_semantic_grounding`); `embedding_cache.ALLOW_API_ENV`, `DEFAULT_EMBEDDING_CACHE`, `EmbeddingCacheMiss`; `settings.grounding_scorer`; `synthesis.ENFORCE_SUPPORT_THRESHOLD`; `semantic_grounding.SEMANTIC_SUPPORT_THRESHOLD`.
- Produces:
  - `render_semantic_section(run: SemanticRun | None) -> list[str]`
  - `_semantic_interpretation(run) -> str`
  - `render_markdown(reports, probe, provenance, semantic=None) -> str`
  - `provenance_lines(deck_dir, names, threshold, embeddings: str | None = None)`
  - CLI flags `--grounding-semantic`, `--embedding-cache`
  - Exit code 2 on a cache miss without permission

**Step 1: failing tests.** Write `backend/tests/unit/test_deck_lab_semantic.py`:
```python
"""Arc 8 Deck Lab section: rendered only from the run's numbers; the CLI
step is opt-in and never reaches the API without DECK_LAB_ALLOW_EMBEDDING_API=1."""
from __future__ import annotations

from pathlib import Path

import pytest

from backend.eval import semantic_grounding_eval as sge
from backend.eval.data.grounding_probe import EN_OFF_TOPIC, ProbePair
from backend.eval.deck_lab import HALLUCINATED, PARAPHRASED, main, render_semantic_section
from backend.tests.support.deck_lab_decks import LONG_DECK, write_pdf
from backend.tests.support.fake_embedder import HashingEmbedder

PAIR = ProbePair("07 DBS Transactions.pdf", 7, "Q?", "para answer", "hallu answer", "en")
OUTCOMES = (
    sge.SemanticOutcome(PAIR, PARAPHRASED, "para answer", 0.208, 0.71, "ok", False, True, True),
    sge.SemanticOutcome(PAIR, HALLUCINATED, "hallu answer", 0.0, 0.42, "low_support", False, False, False),
)
CAL = sge.Calibration(threshold=0.55, grounded=(0.9, 0.8), ungrounded=(0.3, 0.2), gated=1)


def _md(decision):
    run = sge.SemanticRun(CAL, sge.SemanticProbeResult(0.55, OUTCOMES, ()), decision, (), 5, 3,
                          Path("backend/eval/data/grounding_embeddings.json"), "gemini-embedding-001")
    return "\n".join(render_semantic_section(run))


FAILED = sge.Decision(False, ("probe incomplete: 2/32 answers scored",))


def test_section_reports_threshold_calibration_and_three_columns():
    md = _md(FAILED)
    assert "## Semantic grounding" in md
    assert "`gemini-embedding-001`, 5 text(s) fetched live, 3 from `grounding_embeddings.json`" in md
    assert "- Threshold: 0.550 (cosine of stem + key vs. cited slide)" in md
    assert ("- Calibration: 0/4 misclassified; grounded min 0.800, ungrounded max 0.300; "
            "1 answer(s) decided by deterministic gates, not scored") in md
    assert "| lexical | 1/1 (100%) | 0/1 (0%) |" in md
    assert "| semantic | 0/1 (0%) | 0/1 (0%) |" in md
    assert "| combined | 0/1 (0%) | 0/1 (0%) |" in md
    assert "| `07 DBS Transactions.pdf` | 7 | paraphrased | para answer | 0.208 | 0.710 | ok | no | yes | yes |" in md


def test_interpretation_follows_a_failed_gate():
    md = _md(FAILED)
    assert "FAILED (probe incomplete: 2/32 answers scored)" in md and "stays advisory" in md
    assert "PASSED" not in md
    assert "false drops 1 -> 0, false keeps 0 -> 0" in md


def test_interpretation_follows_a_passed_gate_and_the_live_flags(monkeypatch):
    from backend.core.config import settings
    from backend.services.parser import synthesis

    monkeypatch.setattr(synthesis, "ENFORCE_SUPPORT_THRESHOLD", True)
    monkeypatch.setattr(settings, "grounding_scorer", "semantic", raising=False)
    md = _md(sge.Decision(True, ()))
    assert "PASSED" in md and "FAILED" not in md
    assert "ENFORCE_SUPPORT_THRESHOLD=True, GROUNDING_SCORER=semantic" in md


def test_section_says_not_run_without_the_flag():
    md = "\n".join(render_semantic_section(None))
    assert "Not run." in md and "--grounding-semantic" in md


def test_section_skips_without_calibration_decks():
    run = sge.SemanticRun(None, None, None, ("00 DBS Introduction.pdf",), 0, 0, Path("x.json"), "m")
    assert "Skipped: calibration decks not found" in "\n".join(render_semantic_section(run))


CAL_DECK, PROBE_DECK = "00 DBS Syn.pdf", "07 DBS SynProbe.pdf"


@pytest.fixture
def lab(tmp_path, monkeypatch):
    d = tmp_path / "decks"
    d.mkdir()
    write_pdf(d / CAL_DECK, LONG_DECK)
    write_pdf(d / PROBE_DECK, LONG_DECK)
    monkeypatch.setattr(sge, "CALIBRATION_SETS", ((CAL_DECK, [
        (3, "What does the alpha slide explain?", "The alpha concept", "The bravo concept"),
        (4, "What does the bravo slide explain?", "The bravo concept", "The charlie concept"),
    ], EN_OFF_TOPIC),))
    monkeypatch.setattr(sge, "PROBE_PAIRS", [
        ProbePair(PROBE_DECK, 6, "What does the delta slide explain?", "Fourth letter idea", "Quantum tunnelling", "en"),
    ])
    live = HashingEmbedder()
    monkeypatch.setattr(sge, "_live_fetch", live)
    monkeypatch.delenv("DECK_LAB_ALLOW_EMBEDDING_API", raising=False)
    return d, tmp_path / "emb.json", live


def _args(d, cache, out):
    return ["--dir", str(d), "--grounding-semantic", "--embedding-cache", str(cache), "--out", str(out)]


def test_cli_without_cache_or_permission_exits_2_and_sends_nothing(lab, tmp_path, capsys):
    d, cache, live = lab
    assert main(_args(d, cache, tmp_path / "lab.md")) == 2
    assert "DECK_LAB_ALLOW_EMBEDDING_API" in capsys.readouterr().err
    assert live.calls == [] and not cache.exists() and not (tmp_path / "lab.md").exists()


def _section(path: Path) -> list[str]:
    body = path.read_text(encoding="utf-8").split("## Semantic grounding", 1)[1]
    return [line for line in body.splitlines() if not line.startswith("Embeddings:")]


def test_cli_live_run_writes_the_cache_and_an_offline_rerun_matches(lab, tmp_path, monkeypatch):
    d, cache, live = lab
    monkeypatch.setenv("DECK_LAB_ALLOW_EMBEDDING_API", "1")
    first = tmp_path / "a.md"
    assert main(_args(d, cache, first)) == 0
    assert len(live.calls) == 1 and cache.exists()
    assert "- Threshold:" in first.read_text(encoding="utf-8")
    assert "  embeddings:" in first.read_text(encoding="utf-8")
    monkeypatch.delenv("DECK_LAB_ALLOW_EMBEDDING_API")
    second = tmp_path / "b.md"
    assert main(_args(d, cache, second)) == 0
    assert len(live.calls) == 1
    assert _section(first) == _section(second)


def test_default_cli_run_renders_not_run_and_never_embeds(lab, tmp_path):
    d, _, live = lab
    out = tmp_path / "plain.md"
    assert main(["--dir", str(d), "--out", str(out)]) == 0
    assert "## Semantic grounding" in out.read_text(encoding="utf-8") and live.calls == []
```
**Step 2: run** `$PY -m pytest backend/tests/unit/test_deck_lab_semantic.py -m "not db" -q`. Expected: `ImportError: cannot import name 'render_semantic_section' from 'backend.eval.deck_lab'`.

**Step 3: implementation.** In `deck_lab.py`:

1. Imports. Add `import asyncio` and `import os`, change `from typing import Mapping, Sequence` to `from typing import TYPE_CHECKING, Mapping, Sequence`, and add:
```python
from backend.eval.embedding_cache import ALLOW_API_ENV, DEFAULT_EMBEDDING_CACHE, EmbeddingCacheMiss

if TYPE_CHECKING:
    from backend.eval.semantic_grounding_eval import SemanticRun
```
2. Replace `provenance_lines` with:
```python
def provenance_lines(deck_dir: Path, names: Sequence[str], threshold: float,
                     embeddings: str | None = None) -> list[str]:
    shown = str(deck_dir).replace(str(Path.home()), "~", 1)
    lines = [
        "<!--",
        f"  generated : {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%SZ')}",
        f"  commit    : {_git_sha()}",
        f"  deck dir  : {shown} ({len(names)} decks)",
        f"  threshold : SUPPORT_THRESHOLD = {threshold}",
        "  LLM calls : 0",
    ]
    if embeddings:
        lines.append(f"  embeddings: {embeddings}")
    return lines + ["-->"]
```
3. Add after `_interpretation`:
```python
def _yes(flag: bool) -> str:
    return "yes" if flag else "no"


def _semantic_interpretation(run: "SemanticRun") -> str:
    """Reading guide under the semantic rates; every clause follows the run's
    numbers, the pre-registered gate and the live flags."""
    from backend.core.config import settings
    from backend.eval import semantic_grounding_eval as sge
    from backend.services.parser import semantic_grounding, synthesis

    half = sge.EXPECTED_PROBE_ANSWERS // 2
    gate = (f"Pre-registered gate ({sge.DECISION_COLUMN} false drop <= {sge.MAX_FALSE_DROPS}/{half}, "
            f"false keep <= {sge.MAX_FALSE_KEEPS}/{half}, calibration errors <= {sge.MAX_CALIBRATION_ERRORS}): ")
    if run.decision.eligible:
        gate += ("PASSED — the data allow re-enabling enforcement with GROUNDING_SCORER=semantic "
                 "(a separate, user-approved change; this report changes no flag).")
    else:
        gate += (f"FAILED ({'; '.join(run.decision.failures)}) — the verifier stays advisory; "
                 "these numbers are recorded, not tuned.")
    lex, comb = run.probe.rates("lexical"), run.probe.rates("combined")
    shift = (f"Combined vs lexical on the probe: false drops {lex.false_drops} -> {comb.false_drops}, "
             f"false keeps {lex.false_keeps} -> {comb.false_keeps}.")
    live = (f"Live configuration: ENFORCE_SUPPORT_THRESHOLD={synthesis.ENFORCE_SUPPORT_THRESHOLD}, "
            f"GROUNDING_SCORER={settings.grounding_scorer}, "
            f"SEMANTIC_SUPPORT_THRESHOLD={semantic_grounding.SEMANTIC_SUPPORT_THRESHOLD}.")
    return f"{gate} {shift} {live}"


def render_semantic_section(run: "SemanticRun | None") -> list[str]:
    out = ["", "## Semantic grounding", ""]
    if run is None:
        return out + ["Not run. `--grounding-semantic` scores the probe with embeddings (opt-in: it reads the",
                      f"embedding cache, or with {ALLOW_API_ENV}=1 sends slide text to Google's embedding API)."]
    if run.calibration is None:
        missing = ", ".join(_label(d) for d in run.missing_calibration_decks)
        return out + [f"Skipped: calibration decks not found in the deck dir ({missing}); "
                      "the threshold is never fitted on the probe."]
    from backend.eval.semantic_grounding_eval import COLUMNS

    cal, probe = run.calibration, run.probe
    out += [
        "Held-out protocol: the cosine threshold is fitted only on the Arc 4 calibration pairs",
        "(`backend/eval/data/grounding_calibration.py`), then the probe is scored once at it.",
        "Combined = lexical ok OR cosine >= threshold; ambiguous = a distractor closer than the key",
        "that clears the threshold itself.",
        f"Embeddings: `{run.model}`, {run.fetched} text(s) fetched live, {run.cached} from `{run.cache_path.name}`.",
        "",
        f"- Threshold: {cal.threshold:.3f} (cosine of stem + key vs. cited slide)",
        f"- Calibration: {cal.errors}/{cal.scored} misclassified; grounded min {min(cal.grounded):.3f}, "
        f"ungrounded max {max(cal.ungrounded):.3f}; {cal.gated} answer(s) decided by deterministic gates, not scored",
        "",
        "| Scorer | False drop | False keep |",
        "|---|---|---|",
    ]
    for column in COLUMNS:
        r = probe.rates(column)
        out.append(f"| {column} | {_rate(r.false_drops, r.paraphrased)} | {_rate(r.false_keeps, r.hallucinated)} |")
    if probe.missing_decks:
        out.append(f"\nNot scored, deck missing: {', '.join(_label(d) for d in probe.missing_decks)}")
    out += [
        "",
        _semantic_interpretation(run),
        "",
        "| Deck | Slide | Kind | Answer | Lexical | Cosine | Reason | Lexical kept | Semantic kept | Combined kept |",
        "|---|---:|---|---|---:|---:|---|---|---|---|",
    ]
    for o in probe.outcomes:
        out.append(f"| {_label(o.pair.deck)} | {o.pair.slide} | {o.kind} | {o.answer} | {o.lexical:.3f} | "
                   f"{o.cosine:.3f} | {o.reason} | {_yes(o.lexical_ok)} | {_yes(o.semantic_ok)} | {_yes(o.combined_ok)} |")
    return out
```
4. `render_markdown` changes:
   - Change its signature to `def render_markdown(reports: Sequence[DeckReport], probe: ProbeResult, provenance: Sequence[str], semantic: "SemanticRun | None" = None) -> str:`.
   - Insert `    out += render_semantic_section(semantic)` immediately before `    return "\n".join(out) + "\n"`.
5. In `build_parser`, before `return p`, add:
```python
    p.add_argument("--grounding-semantic", action="store_true",
                   help="also score the grounding probe with embeddings (Arc 8). Offline from "
                        f"--embedding-cache unless {ALLOW_API_ENV}=1, which sends slide text to "
                        "Google's embedding API")
    p.add_argument("--embedding-cache", default=str(DEFAULT_EMBEDDING_CACHE),
                   help="JSON cache of embeddings keyed by sha256 of the text")
```
6. In `main`, replace the line `    md = render_markdown(reports, probe, provenance_lines(deck_dir, names, probe.threshold))` with:
```python
    semantic = None
    if args.grounding_semantic:
        from backend.eval import semantic_grounding_eval  # lazy: it imports this module
        try:
            semantic = asyncio.run(semantic_grounding_eval.run_semantic_grounding(
                deck_dir, Path(args.embedding_cache), allow_api=os.environ.get(ALLOW_API_ENV) == "1"))
        except EmbeddingCacheMiss as exc:
            print(str(exc), file=sys.stderr)
            return 2
    embeddings = None if semantic is None else (
        f"{semantic.fetched} text(s) fetched live, {semantic.cached} from cache ({semantic.model})")
    md = render_markdown(reports, probe, provenance_lines(deck_dir, names, probe.threshold, embeddings), semantic)
```
7. Module docstring "Run:" line becomes:
   `Run: python -m backend.eval.deck_lab [--decks NAME ...] [--dir DIR] [--out FILE] [--grounding-semantic [--embedding-cache FILE]]`

In `backend/eval/README.md`, append to the Deck Lab section:
```markdown
### Semantic grounding (Arc 8, opt-in)

`--grounding-semantic` fits a cosine threshold on the Arc 4 calibration pairs
(`backend/eval/data/grounding_calibration.py`) and scores the pre-registered
probe once at it (`backend/eval/semantic_grounding_eval.py`). Vectors come
from `backend/eval/data/grounding_embeddings.json` (keyed by sha256, no text).
A cache miss exits 2 unless `DECK_LAB_ALLOW_EMBEDDING_API=1`. That sends slide
text to Google's embedding API with your GEMINI_API_KEY (unmetered; no llm_calls rows).
Tests: `pytest backend/tests/unit/test_semantic_grounding_eval.py backend/tests/unit/test_deck_lab_semantic.py`
```
**Step 4: green.** `$PY -m pytest backend/tests/unit/test_deck_lab_semantic.py backend/tests/unit/test_deck_lab_cli.py backend/tests/unit/test_deck_lab_probe.py backend/tests/unit/test_deck_lab_metrics.py -m "not db" -q`, then the full suite.

**Step 5: mutation check:**
- Change `allow_api=os.environ.get(ALLOW_API_ENV) == "1"` to `allow_api=True`. Expected to fail: `test_cli_without_cache_or_permission_exits_2_and_sends_nothing`.
- In the row f-string, swap `{_yes(o.lexical_ok)} | {_yes(o.semantic_ok)}` to `{_yes(o.semantic_ok)} | {_yes(o.lexical_ok)}`. Expected to fail: `test_section_reports_threshold_calibration_and_three_columns`.
- Change `    if run.decision.eligible:` to `    if True:`. Expected to fail: `test_interpretation_follows_a_failed_gate`.

**Step 6: commit.** `feat(deck-lab): Semantic grounding section rendered from the run; opt-in --grounding-semantic with offline cache (Arc 8.6)`

---

## Task 7: Real measurement (CONTROLLER MUST GET USER APPROVAL FIRST)

**Files:**
- Generated: `docs/DECK_LAB_2026_10.md`
- Generated: `backend/eval/data/grounding_embeddings.json` (commit only if the user agrees)
- Create `backend/tests/unit/test_semantic_grounding_real_decks.py`
- Modify `backend/services/parser/synthesis.py` (ENFORCE comment numbers)
- Branch PASS only: modify `backend/services/parser/semantic_grounding.py` and `backend/tests/unit/test_semantic_grounding.py`

**Interfaces**
- Consumes: everything above.
- Produces: the recorded scorecard, pinned recorded numbers, and the pre-registered consequence applied.

**Step 1: offline dry run (no network).** `$PY -m backend.eval.deck_lab --grounding-semantic --out docs/DECK_LAB_2026_10.md; echo exit=$?`
- Expected: `exit=2`, with stderr `N text(s) are not in …/backend/eval/data/grounding_embeddings.json. Fetching them sends slide text to Google's embedding API; set DECK_LAB_ALLOW_EMBEDDING_API=1 to allow it.`
- The doc is not written. Record N (about 200: slide + key + 3 distractor claims per scored answer).

**Step 2: ⚠ USER APPROVAL REQUIRED (controller, not a subagent).** Ask the user before running Step 3. Tell them:
- **What is sent:** the boilerplate-stripped text (≤2000 chars each) of the cited slides from 4 of their own decks (`00 DBS Introduction`, `03 SR Prozesse`, `07 DBS Transactions`, `05 SR Speicherverwaltung`), plus about N short question/answer strings.
- **Where:** Google's Gemini embedding API (`gemini-embedding-001`), with their `GEMINI_API_KEY`. This is the same provider the product already uses for slide embeddings.
- **How much:** ⌈N/100⌉ requests. No `llm_calls` rows are written (`meter=False`).
- **What is stored:** vectors only, keyed by sha256, in `backend/eval/data/grounding_embeddings.json`.
- **Ask separately** whether that cache file may be committed (it makes reruns offline and reproducible, and enables the tripwire test).

Do not proceed without a clear yes. If the user declines, Arc 8 ends with tasks 1–6 (tooling ready, measurement not run). Record this in the ledger.

**Step 3 (only after approval):** `DECK_LAB_ALLOW_EMBEDDING_API=1 $PY -m backend.eval.deck_lab --grounding-semantic --out docs/DECK_LAB_2026_10.md`. Expected: `wrote docs/DECK_LAB_2026_10.md`, and the cache file now exists.

**Step 4: offline reproducibility.**
```
$PY -m backend.eval.deck_lab --grounding-semantic --out "$TMPDIR/deck_lab_offline.md"
diff <(sed '/^<!--/,/^-->/d' docs/DECK_LAB_2026_10.md | grep -v '^Embeddings:') <(sed '/^<!--/,/^-->/d' "$TMPDIR/deck_lab_offline.md" | grep -v '^Embeddings:')
```
Expected: no diff, and the provenance shows `0 text(s) fetched live`.

**Step 5: sanity gate.** In the scorecard, the semantic section's lexical row must read `| lexical | 14/16 (88%) | 0/16 (0%) |`, which reproduces Arc 6. If it does not, STOP and debug. Do not interpret.

**Step 6: pin the recorded numbers.** Write `backend/tests/unit/test_semantic_grounding_real_decks.py`, copying the four RECORDED values from the scorecard lines `- Threshold:`, `| combined |` and `- Calibration:`:
```python
"""Arc 8 measurement reproduced offline from the committed embedding cache.
Skipped without the cache file or the real decks; never reaches the network
(the cache embedder has no fetch, so a changed slide text fails loudly)."""
from __future__ import annotations

import asyncio

import pytest

from backend.eval import semantic_grounding_eval as sge
from backend.eval.decks import DECK_DIR
from backend.eval.embedding_cache import DEFAULT_EMBEDDING_CACHE

RECORDED_THRESHOLD = 0.000          # replace with the "- Threshold:" value from docs/DECK_LAB_2026_10.md
RECORDED_COMBINED = (0, 0)          # replace with (false drops, false keeps) from the "| combined |" row
RECORDED_CALIBRATION_ERRORS = 0     # replace with the "- Calibration: E/S" numerator
RECORDED_ELIGIBLE = False           # True iff the interpretation says PASSED


@pytest.fixture(scope="module")
def run():
    if not DEFAULT_EMBEDDING_CACHE.exists():
        pytest.skip("embedding cache not committed")
    r = asyncio.run(sge.run_semantic_grounding(DECK_DIR, DEFAULT_EMBEDDING_CACHE, allow_api=False))
    if r.calibration is None or r.probe.missing_decks:
        pytest.skip("real calibration/probe decks not available")
    return r


def test_lexical_column_reproduces_arc6(run):
    r = run.probe.rates("lexical")
    assert (r.false_drops, r.false_keeps, r.paraphrased, r.hallucinated) == (14, 0, 16, 16)


def test_recorded_threshold_and_rates_reproduce(run):
    assert run.calibration.threshold == pytest.approx(RECORDED_THRESHOLD, abs=1e-3)
    assert run.calibration.errors == RECORDED_CALIBRATION_ERRORS
    c = run.probe.rates("combined")
    assert (c.false_drops, c.false_keeps) == RECORDED_COMBINED
    assert run.decision.eligible is RECORDED_ELIGIBLE
```
(The four RECORDED constants are the only values copied by hand, each from a named scorecard line. Every other number comes from code.)

Then run `$PY -m pytest backend/tests/unit/test_semantic_grounding_real_decks.py -m "not db" -q`; it must pass. Mutation check: set `RECORDED_COMBINED` to the wrong tuple, see it fail, then revert.

**Step 7: apply the pre-registered consequence.**
- **FAIL** (the interpretation says FAILED):
  - Change nothing in flags or defaults. `SEMANTIC_SUPPORT_THRESHOLD` stays `None`.
  - Append to the synthesis ENFORCE comment one line with the measured numbers, in this form: `# Arc 8 probe (2026-10-11): combined false drop X/16, false keep Y/16 at cosine threshold T (calibration errors E/S): gate failed; stays advisory.` Use the numbers from the scorecard.
- **PASS**:
  - In `semantic_grounding.py`, set `SEMANTIC_SUPPORT_THRESHOLD = <RECORDED_THRESHOLD rounded to 3 decimals>`. In `test_semantic_grounding.py`, replace `test_threshold_is_uncalibrated_until_the_arc8_measurement` with `assert SEMANTIC_SUPPORT_THRESHOLD == pytest.approx(RECORDED_THRESHOLD, abs=1e-3)`, importing it from the real-deck test module.
  - Append the same numbers line to the ENFORCE comment, ending "gate passed".
  - Do NOT flip `GROUNDING_SCORER`'s default or `ENFORCE_SUPPORT_THRESHOLD` here. The controller presents the numbers and asks the user to approve Arc 8b (defaults flip). That task must also add `_grounding_embed` stubs to tests that rely on the default scorer, because the unit network guard raises a BaseException.

**Step 8: verify and commit.**
- Run the full suite `$PY -m pytest -m "not db" -q`.
- `git add docs/DECK_LAB_2026_10.md backend/tests/unit/test_semantic_grounding_real_decks.py backend/services/parser/synthesis.py`, plus the cache file only if approved, plus the PASS-branch files.
- Commit message: `eval(grounding): Arc 8 semantic probe — <PASSED|FAILED> pre-registered gate (combined FD X/16, FK Y/16 at T)`.
- The controller records in the ledger: the approval (who, when, N texts, requests), the numbers, the branch taken, and whether the cache was committed.

---

### Critical Files for Implementation
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/arc8-semantic-grounding/backend/services/parser/semantic_grounding.py (new; scorer, BoundedEmbedder)
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/arc8-semantic-grounding/backend/services/parser/synthesis.py (ground_deck_quiz wiring, ENFORCE comment)
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/arc8-semantic-grounding/backend/services/ai/embeddings.py (single-request batch + metering)
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/arc8-semantic-grounding/backend/eval/semantic_grounding_eval.py (new; held-out calibration, probe, gate) with /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/arc8-semantic-grounding/backend/eval/embedding_cache.py
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/arc8-semantic-grounding/backend/eval/deck_lab.py (section + opt-in CLI)
- Also touched: `backend/services/ai/call_context.py`, `backend/services/parser/unified_orchestrator.py` (`_llm_usage_receipt`), `backend/core/config.py`, `backend/eval/data/grounding_calibration.py`, `backend/tests/unit/test_quiz_grounding_real_decks.py`, `backend/tests/unit/test_ai_models_smoke.py`
