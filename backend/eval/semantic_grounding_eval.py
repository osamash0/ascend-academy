
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
from backend.services.ai.embeddings import EMBED_BATCH_MAX, EMBEDDING_DIMS, EMBEDDING_MODEL_ID, generate_embeddings_batch
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
    model: str = ""  # embedding model id the scores (and so the threshold) belong to

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


def calibrate_threshold(grounded: Sequence[float], ungrounded: Sequence[float], gated: int = 0,
                        model: str = "") -> Calibration:
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
    return Calibration(best[1], tuple(grounded), tuple(ungrounded), gated, model)


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
    model: str = ""  # embedding model id the calibrated threshold is valid for


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


async def calibrate(items: Sequence[tuple[str, dict, DeckSkeleton]], embed: Embedder,
                    model: str = "") -> Calibration:
    grounded: list[float] = []
    ungrounded: list[float] = []
    gated = 0
    for label, q, sk in items:
        v = await semantic_support(q, sk, embed, threshold=math.inf)  # raw cosine; no ambiguity at inf
        if v.reason in DETERMINISTIC_REASONS:
            gated += 1
            continue
        (grounded if label == "grounded" else ungrounded).append(v.cosine)
    return calibrate_threshold(grounded, ungrounded, gated, model)


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
    return Decision(not failures, tuple(failures), cal.model)


async def _live_fetch(texts: Sequence[str]) -> list[list[float]]:
    """Google's embedding API, unmetered (an eval must not write llm_calls rows
    into whatever database the shell's .env names), <= EMBED_BATCH_MAX per request."""
    texts = list(texts)
    out: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH_MAX):
        out.extend(await generate_embeddings_batch(texts[i:i + EMBED_BATCH_MAX]))
    return out


async def run_semantic_grounding(deck_dir: Path, cache_path: Path, allow_api: bool) -> SemanticRun:
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
        return SemanticRun(None, None, None, missing_cal, 0, 0, cache_path, EMBEDDING_MODEL_ID)
    missing_probe = tuple(sorted({p.deck for p in PROBE_PAIRS} - set(skeletons)))
    cache = EmbeddingCache.load(cache_path, EMBEDDING_MODEL_ID, EMBEDDING_DIMS)
    embed = cache.embedder(_live_fetch if allow_api else None)
    cal_items = calibration_items(skeletons)
    pr_items = probe_items(PROBE_PAIRS, skeletons)
    texts = [t for _, q, sk in cal_items for t in semantic_texts(q, sk)]
    texts += [t for *_, q, sk in pr_items for t in semantic_texts(q, sk)]
    unique = list(dict.fromkeys(texts))
    await embed(unique)  # one prefetch: every miss goes out together
    calibration = await calibrate(cal_items, embed, EMBEDDING_MODEL_ID)  # calibration decks only
    probe = await run_semantic_probe(pr_items, embed, calibration.threshold, missing_probe)  # once, at that threshold
    if cache.fetched:
        cache.save()
    return SemanticRun(calibration, probe, decide(calibration, probe), (), cache.fetched,
                       len(unique) - cache.fetched, cache_path, EMBEDDING_MODEL_ID)