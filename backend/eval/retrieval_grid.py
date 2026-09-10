"""Retrieval grid evaluation over REAL lecture decks (thesis Section 6).

Why this exists alongside `golden_sets.py`
------------------------------------------
`golden_sets.py` holds small synthetic fixtures whose `deck_id` values are
strings like "algorithms_101". Those are fine for proving the scorer detects
a seeded regression (`test_eval_harness.py`), but they cannot measure the
real system: `lectures.id` is a UUID, so a synthetic deck id matches no row
and `LivePipeline`'s retrieval calls return nothing. This module is the
real-corpus counterpart. It is deliberately additive — nothing here changes
`golden_sets.py` or `scorer.py`, so the existing harness tests keep passing.

What it measures
----------------
For each golden question (a real `lecture_id`, a human-verified
`slide_index`, and an anchor phrase that must appear in the retrieved text),
it sweeps a grid of retrieval configurations and reports:

  slide_found        did the expected slide appear anywhere in the top-k?
  anchor_found       did the anchor phrase appear in the retrieved text?
  reciprocal_rank    1/rank of the expected slide (0 if absent) -> MRR
  precision_at_k     |retrieved ∩ expected| / k
  latency_ms         wall-clock per query

...across two regimes that exist in this codebase and differ in more than
parameters:

  lecture_dense   `retrieve_relevant_slides` — dense ANN, scoped to one
                  lecture in SQL. This is what students actually reach.
  course_hybrid   `retrieve_relevant_slides_course_scoped` — dense + FTS
                  fused with Reciprocal Rank Fusion, scoped to a course,
                  and gated: below the similarity threshold the course
                  tutor refuses BEFORE any model call.

The gate is the interesting part. Because only one regime can refuse, this
harness also reports the gate's `refusal_rate` and — the number worth the
most to the thesis — its `false_refusal_rate`: questions the corpus
demonstrably answers (the expected slide *was* retrieved) that the gate
rejected anyway. That quantifies the cost of the safety threshold.

Trusting what it produces
-------------------------
Twice now this harness has written a plausible-looking table from a run that
measured the environment rather than the retriever, so it now refuses on two
independent grounds. One counts failures. The other checks the numbers against
themselves: `slide_found` must not fall as k rises, and (in `lecture_dense`)
must not rise as the threshold tightens. Both follow from the retrieval SQL, so
a run that violates either is rejected on arithmetic alone — no need to have
anticipated how it would break. Production catches its own provider failures by
design and never raises, so counting exceptions alone would keep missing this.

Running it
----------
    python -m backend.eval.retrieval_grid --golden backend/eval/data/golden_set.json

Needs real provider API keys (for query embedding) and database access. The
sweep runs ANN/FTS search and calls NO generation model. Query embeddings are
computed once per DISTINCT question before the sweep and served to every cell,
so a full grid costs 50 embedding calls rather than the 1232 the naive loop
paid — which is what exhausted a 1000/day free tier on 2026-09-09. Results go
to a timestamped subdirectory of `--outdir` with a provenance header.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import re
import statistics
import subprocess
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

# A retrieved slide is identified by (lecture_id, slide_index). The lecture
# component matters for the course-scoped regime, where hits span lectures;
# for the lecture-scoped regime it is constant but kept so both regimes
# score through identical code.
SlideKey = Tuple[str, int]

REGIME_LECTURE_DENSE = "lecture_dense"
REGIME_COURSE_HYBRID = "course_hybrid"
REGIMES = (REGIME_LECTURE_DENSE, REGIME_COURSE_HYBRID)


# ── Golden set ───────────────────────────────────────────────────────────

@dataclass(frozen=True)
class GoldenQuestion:
    """One human-verified question against a real ingested lecture.

    `slide_index` and `anchor` must both be verified by a human against the
    actual slide. A golden set graded against the model's own opinion is not
    a regression detector — the same rule `golden_sets.py` states.

    `anchor` is a short verbatim phrase from the expected slide. It gives a
    passage-level signal that survives the slide being retrieved for the
    wrong reason, and it is how `anchor_found` approximates precision below
    slide granularity.
    """
    id: str
    question: str
    lecture_id: str          # real UUID from `lectures.id`
    slide_index: int         # human-verified, 0-based to match `slides`
    anchor: str = ""
    category: str = "text"   # "text" | "visual" — visual probes the
                             # 25-character vision-routing threshold
    course_id: str = ""      # required for the course_hybrid regime
    expected_answer: str = ""  # reference text; not auto-scored here

    @property
    def key(self) -> SlideKey:
        return (str(self.lecture_id), int(self.slide_index))


def load_golden_set(path: str | Path) -> List[GoldenQuestion]:
    """Load a golden set from JSON and fail loudly on a malformed case.

    Failing loudly is deliberate: a silently skipped case inflates every
    score that follows it, and an evaluation that quietly grades fewer
    questions than it claims is worse than one that does not run.
    """
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    questions = raw["questions"] if isinstance(raw, dict) else raw

    out: List[GoldenQuestion] = []
    for i, item in enumerate(questions):
        missing = [f for f in ("question", "lecture_id", "slide_index") if f not in item]
        if missing:
            raise ValueError(f"golden case #{i} is missing required field(s): {missing}")
        out.append(
            GoldenQuestion(
                id=str(item.get("id", i)),
                question=item["question"],
                lecture_id=str(item["lecture_id"]),
                slide_index=int(item["slide_index"]),
                anchor=item.get("anchor", ""),
                category=item.get("category", "text"),
                course_id=str(item.get("course_id", "")),
                expected_answer=item.get("expected_answer", ""),
            )
        )
    if not out:
        raise ValueError(f"golden set at {path} contains no questions")
    return out


# ── Pure metrics (no I/O — unit-testable without a database) ─────────────

def slide_found(retrieved: Sequence[SlideKey], expected: SlideKey) -> bool:
    """Did the expected slide appear anywhere in the retrieved list?"""
    return expected in tuple(retrieved)


def reciprocal_rank(retrieved: Sequence[SlideKey], expected: SlideKey) -> float:
    """1/rank of the expected slide (rank is 1-based); 0.0 if absent.

    Averaged over a question set this is MRR — the metric the reference
    literature reports for this kind of lookup task, where there is one
    right answer and finding it early matters.
    """
    for position, key in enumerate(retrieved, start=1):
        if key == expected:
            return 1.0 / position
    return 0.0


def precision_at_k(retrieved: Sequence[SlideKey], expected: SlideKey, k: int) -> float:
    """|top-k ∩ expected| / k.

    With exactly one relevant slide per question this is capped at 1/k, so a
    perfect retriever scores 0.20 at k=5. Report it against that ceiling or
    it reads as a failure — `scorer.py` makes the same point about its own
    band. MRR and slide_found are the more legible headline numbers.
    """
    if k <= 0:
        return 0.0
    hits = 1 if expected in tuple(retrieved)[:k] else 0
    return hits / k


def anchor_found(retrieved_texts: Sequence[str], anchor: str) -> bool:
    """Did the anchor phrase appear in any retrieved slide's text?

    Case- and whitespace-insensitive: slide text is extracted from PDFs and
    carries inconsistent spacing and line breaks, so an exact match would
    measure extraction noise rather than retrieval quality.
    """
    if not anchor:
        return False
    needle = " ".join(anchor.lower().split())
    return any(needle in " ".join(t.lower().split()) for t in retrieved_texts if t)


def is_grounded_by_threshold(similarities: Sequence[float], threshold: float) -> bool:
    """Mirrors `backend.services.ai.tutor.is_grounded` (max sim >= threshold).

    Reimplemented rather than imported so the metrics stay dependency-free
    and testable without the backend installed. `test_retrieval_grid.py`
    asserts the two agree, so this cannot drift silently.
    """
    return any(s >= threshold for s in similarities)


# ── Results ──────────────────────────────────────────────────────────────

@dataclass
class ConfigResult:
    """Scores for one (regime, k, threshold) cell of the grid."""
    regime: str
    k: int
    threshold: float
    n: int = 0
    slide_found_rate: float = 0.0
    anchor_found_rate: float = 0.0
    mrr: float = 0.0
    precision_at_k: float = 0.0
    median_latency_ms: float = 0.0
    refusal_rate: float = 0.0
    false_refusal_rate: float = 0.0
    false_refusal_share: float = 0.0
    # Queries whose top-k contained the SAME (lecture_id, slide_index) twice.
    # Aggregate embedding coverage can look healthy while hiding duplicates —
    # a lecture at 98.9% may be "2 slides duplicated, 3 missing", not "3
    # missing". A duplicated slide consumes several top-k slots and depresses
    # precision for reasons that have nothing to do with retrieval quality, so
    # this must be visible rather than silently averaged away.
    queries_with_duplicate_hits: int = 0
    errors: int = 0
    # Cases the regime could not run at all (see _retrieve). Reported, never
    # scored — a metric averaged over a shifting population is not comparable.
    skipped: int = 0
    # Distinct error strings seen, so the CLI can name the cause instead of
    # leaving it in warnings that scroll past.
    error_messages: List[str] = field(default_factory=list)
    per_question: List[Dict[str, Any]] = field(default_factory=list)

    def as_row(self) -> Dict[str, Any]:
        return {
            "regime": self.regime,
            "k": self.k,
            "threshold": self.threshold,
            "n": self.n,
            "slide_found": round(self.slide_found_rate, 4),
            "anchor_found": round(self.anchor_found_rate, 4),
            "mrr": round(self.mrr, 4),
            "p_at_k": round(self.precision_at_k, 4),
            "latency_ms": round(self.median_latency_ms, 1),
            "refusal": round(self.refusal_rate, 4),
            "false_refusal": round(self.false_refusal_rate, 4),
            "false_refusal_share": round(self.false_refusal_share, 4),
            "dup_hits": self.queries_with_duplicate_hits,
            "errors": self.errors,
            "skipped": self.skipped,
        }


def score_config(
    cases: Sequence[GoldenQuestion],
    outcomes: Sequence[Dict[str, Any]],
    regime: str,
    k: int,
    threshold: float,
) -> ConfigResult:
    """Aggregate per-question outcomes into one grid cell. Pure function.

    `outcomes[i]` corresponds to `cases[i]` and carries the keys
    "keys" (ranked SlideKeys), "texts", "similarities", "latency_ms" and
    optionally "error".
    """
    result = ConfigResult(regime=regime, k=k, threshold=threshold, n=len(cases))
    if not cases:
        return result

    found, anchors, rrs, precisions, latencies = [], [], [], [], []
    refusals, false_refusals = 0, 0

    for case, out in zip(cases, outcomes):
        if out.get("skipped"):
            result.skipped += 1
            result.per_question.append({"id": case.id, "skipped": out["skipped"]})
            continue

        if out.get("error"):
            result.errors += 1
            msg = str(out["error"])
            if msg not in result.error_messages:
                result.error_messages.append(msg)
            # A failed lookup is a miss, not an exclusion. Dropping it would
            # silently raise every rate below.
            found.append(0.0); anchors.append(0.0); rrs.append(0.0); precisions.append(0.0)
            result.per_question.append({"id": case.id, "error": out["error"]})
            continue

        keys = out.get("keys", [])
        texts = out.get("texts", [])
        sims = out.get("similarities", [])

        if len(keys) != len(set(keys)):
            result.queries_with_duplicate_hits += 1

        hit = slide_found(keys, case.key)
        anchor_hit = anchor_found(texts, case.anchor)
        rr = reciprocal_rank(keys, case.key)
        prec = precision_at_k(keys, case.key, k)

        found.append(1.0 if hit else 0.0)
        anchors.append(1.0 if anchor_hit else 0.0)
        rrs.append(rr)
        precisions.append(prec)
        if out.get("latency_ms") is not None:
            latencies.append(float(out["latency_ms"]))

        # The gate only exists in the course-scoped regime, but computing it
        # for both makes the comparison explicit: it shows what the lecture
        # tutor *would* have refused if it still had the gate it lost.
        grounded = is_grounded_by_threshold(sims, threshold)
        if not grounded:
            refusals += 1
            # A refusal is "false" when the corpus demonstrably answered the
            # question — the expected slide was retrieved and the gate
            # rejected it anyway on similarity alone.
            if hit:
                false_refusals += 1

        result.per_question.append({
            "id": case.id,
            "category": case.category,
            "slide_found": hit,
            "anchor_found": anchor_hit,
            "reciprocal_rank": round(rr, 4),
            "grounded": grounded,
            "top_similarity": round(max(sims), 4) if sims else 0.0,
            "duplicate_hits": len(keys) - len(set(keys)),
            "latency_ms": round(float(out["latency_ms"]), 1)
            if out.get("latency_ms") is not None else None,
        })

    # `n` counts only cases this regime actually attempted. Skipped cases are
    # excluded from every rate, so a regime is never penalised for questions it
    # was structurally unable to run.
    n = len(cases) - result.skipped
    if n <= 0:
        return result
    # Among attempted cases, retrieval quality is scored over ALL of them: an
    # errored lookup is a miss the system really produced, and dropping it
    # would inflate the rates.
    result.slide_found_rate = sum(found) / n
    result.anchor_found_rate = sum(anchors) / n
    result.mrr = sum(rrs) / n
    result.precision_at_k = sum(precisions) / n
    result.median_latency_ms = statistics.median(latencies) if latencies else 0.0

    # Gate metrics are scored over cases the gate actually judged. An
    # errored lookup returned no similarities, so counting it as a refusal
    # would conflate infrastructure failure with a threshold decision — and
    # the false-refusal number is the one the thesis leans on hardest, so it
    # must mean exactly what it says.
    scored = n - result.errors
    result.refusal_rate = (refusals / scored) if scored else 0.0
    result.false_refusal_rate = (false_refusals / scored) if scored else 0.0
    # Of the refusals, what share were wrong? This is the number that says
    # what the gate costs when it fires, independent of how often it fires.
    result.false_refusal_share = (false_refusals / refusals) if refusals else 0.0
    return result


# ── Reading the failures production is designed not to raise ─────────────
#
# The 2026-09-09 quota incident is the reason this section exists. A grid run
# completed, reported `Err 0` on all 32 rows, and named a best configuration of
# `MRR 0.806, slide_found 0.940` — while Gemini was returning
# `429 RESOURCE_EXHAUSTED` for most of the sweep. Nothing raised, because
# nothing is supposed to:
#
#   retrieval.py:120-124  catches the embedding failure, logs a WARNING, and
#                         returns `_current_only(...)` — `[]` here, since the
#                         harness deliberately passes no current slide.
#   retrieval.py:206-213  catches embed *and* search together, leaving
#                         `vector_hits = []`, then runs keyword search and RRF
#                         as though the dense arm had simply matched nothing.
#   cache.py:380-382      catches the RPC failure, logs an ERROR, returns `[]`.
#
# That is correct behaviour for a student-facing tutor: degrade, do not 500.
# It is exactly wrong for a measurement harness, which then cannot distinguish
# an exhausted quota from an honest "nothing was similar enough". Counting
# exceptions measures nothing when the code under test is built never to throw.
#
# So the harness reads the warnings those handlers already emit. This requires
# no change to the production code — which is deployed, and which is behaving
# as designed.

# Loggers whose WARNING+ records mean a lookup silently degraded. Prefix match,
# so a swallow point added later under `backend.` is caught without edits here.
_FAILURE_LOGGER_PREFIX = "backend."


class _BackendLogCapture(logging.Handler):
    """Collect WARNING+ records emitted by `backend.*` while it is installed."""

    def __init__(self) -> None:
        super().__init__(level=logging.WARNING)
        self.records: List[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        if not record.name.startswith(_FAILURE_LOGGER_PREFIX):
            return
        try:
            self.records.append(record.getMessage())
        except Exception:  # noqa: BLE001 — a broken format string must not end the sweep
            self.records.append(str(record.msg))


@contextlib.contextmanager
def capture_backend_failures() -> Iterator[_BackendLogCapture]:
    """Capture `backend.*` WARNING+ records for the duration of one query.

    The handler is attached to the `backend` logger rather than to root so the
    harness's own logging is not swept up with it. Its level is forced to
    WARNING for the duration: a record is filtered at its originating logger's
    *effective* level, so a caller who set the root logger to ERROR would
    otherwise suppress exactly the warnings this exists to read.
    """
    handler = _BackendLogCapture()
    backend_logger = logging.getLogger("backend")
    previous_level = backend_logger.level
    if backend_logger.getEffectiveLevel() > logging.WARNING:
        backend_logger.setLevel(logging.WARNING)
    backend_logger.addHandler(handler)
    try:
        yield handler
    finally:
        backend_logger.removeHandler(handler)
        backend_logger.setLevel(previous_level)


# ── Query embeddings: computed once, before the sweep ────────────────────

@dataclass
class EmbeddingPrecompute:
    """Outcome of embedding every distinct question exactly once."""
    embeddings: Dict[str, List[float]] = field(default_factory=dict)
    failures: Dict[str, str] = field(default_factory=dict)
    calls: int = 0
    median_latency_ms: float = 0.0

    @property
    def ok(self) -> bool:
        return not self.failures


async def precompute_query_embeddings(
    cases: Sequence[GoldenQuestion],
    *,
    rate_limit_per_second: float = 0.0,
    max_attempts: int = 3,
) -> EmbeddingPrecompute:
    """Embed each DISTINCT question once, before any configuration is scored.

    This is the fix for the quota incident, and it is arithmetic rather than
    cleverness. `run_grid` loops regime -> k -> threshold -> case, and a query's
    embedding depends on none of those three, so the old code paid for the same
    50 vectors 32 times over:

        lecture_dense   16 cells x 50 cases = 800
        course_hybrid   16 cells x 27 cases = 432   (23 lack a course_id)
                                              ----
                                              1232 calls per grid

    against a free-tier ceiling of 1000 embed_content requests per day. Nothing
    absorbed the repetition: the Redis cache in front of `_embed_query_cached`
    (retrieval.py:81-89) needs `init_redis()` to have been awaited, which a
    standalone script never does, so every lookup missed and re-embedded.

    Embedding the 50 distinct questions once costs 50 calls — a full grid is
    then re-runnable twenty times a day inside the same free tier, and grid size
    stops driving quota entirely.

    The second benefit matters as much as the first: this fails *fast*.
    `generate_embeddings` propagates rather than swallowing (embeddings.py:101),
    so a 429 surfaces here, before a single cell is scored. The caller aborts
    with a named cause and writes nothing, so there is no half-corrupted table
    to notice later — or to miss.
    """
    from backend.services.ai.embeddings import generate_embeddings

    distinct: List[str] = []
    for case in cases:
        if case.question not in distinct:
            distinct.append(case.question)

    out = EmbeddingPrecompute()
    latencies: List[float] = []

    for i, question in enumerate(distinct):
        # Serialised on purpose. The whole point is to stay far inside the
        # provider's per-minute ceiling; concurrency would buy seconds on a
        # 50-call pass and risk the exact failure this function exists to stop.
        if rate_limit_per_second > 0 and i:
            await asyncio.sleep(1.0 / rate_limit_per_second)

        last_error = ""
        for attempt in range(1, max_attempts + 1):
            started = time.perf_counter()
            try:
                out.calls += 1
                vector = await generate_embeddings(question)
                latencies.append((time.perf_counter() - started) * 1000.0)
                out.embeddings[question] = vector
                break
            except Exception as exc:  # noqa: BLE001
                last_error = f"{type(exc).__name__}: {exc}"
                # Retry only what retrying can fix. A per-minute 429 clears in
                # seconds; a per-day quota, a bad key or a missing module does
                # not, and sleeping through those wastes the author's time
                # before delivering the same failure.
                if attempt < max_attempts and _is_transient(last_error):
                    await asyncio.sleep(_retry_delay_seconds(last_error, attempt))
                    continue
                out.failures[question] = last_error
                break

    out.median_latency_ms = statistics.median(latencies) if latencies else 0.0
    return out


# Failures a wait cannot fix. Checked first, because several of them contain
# words that also appear in genuinely transient errors — `EmbeddingUnavailable`
# is a missing API key, not a busy server, and retrying it three times costs the
# author a minute to deliver the identical failure.
_PERMANENT_SIGNALS = (
    "perday",                 # a spent daily allowance, not a per-minute throttle
    "embeddingunavailable",
    "modulenotfounderror",
    "no module named",
    "importerror",
    "not configured",
    "api_key",
    "api key",
    "permission",
    "invalid",
    " 401",
    " 403",
    " 404",
)

_TRANSIENT_SIGNALS = (
    r"\b429\b", r"\b503\b", r"\bunavailable\b", r"\bdeadline\b",
    r"\btimeout\b", r"\btimed out\b", r"rate[ _]limit", r"too many requests",
)


def _is_transient(message: str) -> bool:
    """Is this worth retrying? Per-minute throttling yes, spent quota no.

    Word boundaries matter here rather than being pedantry: a bare substring
    test for "unavailable" matches `EmbeddingUnavailableError`, which is what a
    missing `GEMINI_API_KEY` raises and is the least retryable failure there is.
    """
    lowered = message.lower()
    flattened = lowered.replace("_", "").replace("-", "")
    if any(signal in flattened or signal in lowered for signal in _PERMANENT_SIGNALS):
        return False
    return any(re.search(pattern, lowered) for pattern in _TRANSIENT_SIGNALS)


def _retry_delay_seconds(message: str, attempt: int) -> float:
    """Honour the provider's own `retryDelay` when it names one.

    Google returns `'retryDelay': '7s'` alongside a 429. Obeying it beats
    guessing, and it is already in the message the exception carried.
    """
    match = re.search(r"'retryDelay':\s*'(\d+)s'", message)
    if match:
        return float(match.group(1)) + 1.0
    return float(2 ** attempt)


@contextlib.contextmanager
def serve_embeddings_from(precomputed: Dict[str, List[float]]) -> Iterator[None]:
    """Serve `retrieval._embed_query_cached` from `precomputed` for the sweep.

    Swapping the module attribute is what makes the precompute reach the
    production retriever without touching it: `retrieve_relevant_slides` looks
    the name up on its own module at call time, so the substitution is complete
    for both regimes and is undone in `finally` whatever happens.

    Consequence to report honestly: `latency_ms` in the results then measures
    ANN/FTS search plus slide enrichment, NOT the embedding round trip. That is
    the better number for comparing configurations — embedding cost is constant
    across every cell, so including it only adds noise — but the results table
    says so in its provenance header, and the embedding latency is reported
    separately from the precompute pass.
    """
    from backend.services.ai import retrieval as _retrieval

    original = _retrieval._embed_query_cached

    async def _from_precomputed(query: str) -> List[float]:
        try:
            return precomputed[query]
        except KeyError:
            # Unreachable when the precompute covered this golden set, and loud
            # rather than silent if it ever is reached: returning [] here would
            # reintroduce precisely the failure mode this module fixes.
            raise RuntimeError(
                f"no precomputed embedding for query {query[:60]!r} — the "
                "precompute pass and the sweep disagree about the case list"
            )

    _retrieval._embed_query_cached = _from_precomputed
    try:
        yield
    finally:
        _retrieval._embed_query_cached = original


# ── Live retrieval (needs DB + API keys) ─────────────────────────────────

async def _retrieve(case: GoldenQuestion, regime: str, k: int, threshold: float) -> Dict[str, Any]:
    """Run one query through one regime and normalise the result.

    Note what is deliberately NOT passed: `current_slide_index`. The lecture
    retriever anchors the current slide at position 0 with a synthetic
    similarity of 0.0, which would hand the evaluation a free hit whenever
    the expected slide happened to be the one on screen.
    """
    started = time.perf_counter()
    with capture_backend_failures() as captured:
        try:
            if regime == REGIME_LECTURE_DENSE:
                from backend.services.ai.retrieval import retrieve_relevant_slides
                hits = await retrieve_relevant_slides(
                    case.question, lecture_id=case.lecture_id, k=k, threshold=threshold
                )
                keys = [(case.lecture_id, int(h["slide_index"])) for h in hits]
            elif regime == REGIME_COURSE_HYBRID:
                if not case.course_id:
                    # NOT an error: the case is unrunnable in this regime because
                    # `lectures.course_id` is null, which is a property of the data
                    # and not of the retriever. Counting it as a miss would make the
                    # course-scoped regime look worse for a reason that has nothing
                    # to do with retrieval, and the regime comparison is the whole
                    # point of running both. Excluded from every denominator.
                    return {"skipped": f"lecture has no course_id, so {regime} cannot be scoped"}
                from backend.services.ai.retrieval import retrieve_relevant_slides_course_scoped
                hits = await retrieve_relevant_slides_course_scoped(
                    case.question, course_ids=[case.course_id], k=k, threshold=threshold
                )
                keys = [(str(h["lecture_id"]), int(h["slide_index"])) for h in hits]
            else:
                return {"error": f"unknown regime {regime!r}"}
        except Exception as exc:  # noqa: BLE001 — one bad query must not end the sweep
            logger.warning("retrieval failed for case %s (%s): %s", case.id, regime, exc)
            return {"error": f"{type(exc).__name__}: {exc}"}

    latency_ms = (time.perf_counter() - started) * 1000.0

    # A lookup that degraded silently is an error, not a miss. Without this the
    # run scores an exhausted quota as "the retriever found nothing" — the exact
    # shape that produced a citable table of plausible numbers on 2026-09-09.
    # The captured text carries the real cause (the provider's own
    # `429 RESOURCE_EXHAUSTED ...` line) into `error_messages`, where
    # `credibility_report` already knows how to surface it.
    if captured.records:
        return {
            "error": f"silent degradation: {captured.records[0]}",
            "latency_ms": latency_ms,
        }

    return {
        "keys": keys,
        "texts": [f"{h.get('title', '')} {h.get('content', '')}" for h in hits],
        "similarities": [float(h.get("similarity", 0.0)) for h in hits],
        "latency_ms": latency_ms,
    }


@dataclass
class GridRun:
    """Everything a sweep produced: the scored cells and the raw per-case
    outcomes behind them.

    The outcomes are retained rather than discarded after scoring because the
    regime comparison has to be re-scored over a different population than the
    headline table — see `paired_results`. Re-running the sweep to get them
    back would cost a second full pass over the corpus.
    """
    results: List[ConfigResult] = field(default_factory=list)
    outcomes: Dict[Tuple[str, int, float], List[Dict[str, Any]]] = field(default_factory=dict)
    cases: List[GoldenQuestion] = field(default_factory=list)


async def run_grid(
    cases: Sequence[GoldenQuestion],
    ks: Sequence[int],
    thresholds: Sequence[float],
    regimes: Sequence[str] = REGIMES,
) -> GridRun:
    """Sweep every (regime, k, threshold) cell and score each one."""
    run = GridRun(cases=list(cases))
    total = len(regimes) * len(ks) * len(thresholds)
    done = 0
    for regime in regimes:
        for k in ks:
            for threshold in thresholds:
                outcomes = [await _retrieve(c, regime, k, threshold) for c in cases]
                run.outcomes[(regime, k, threshold)] = outcomes
                run.results.append(score_config(cases, outcomes, regime, k, threshold))
                done += 1
                logger.info("grid %d/%d — %s k=%d thr=%.2f", done, total, regime, k, threshold)
    return run


# ── The regime comparison, on one population ─────────────────────────────

def paired_case_ids(run: GridRun, regimes: Sequence[str]) -> List[str]:
    """Ids of the cases EVERY swept regime actually attempted.

    A case is attempted in a regime unless that regime skipped it. Skipping is
    a property of the data, not of the run: `course_hybrid` cannot scope a
    lecture whose `course_id` is null, so it skips those cases in every cell.
    """
    per_regime: List[set] = []
    for regime in regimes:
        attempted = None
        for (r, _k, _t), outcomes in run.outcomes.items():
            if r != regime:
                continue
            ids = {c.id for c, o in zip(run.cases, outcomes) if not o.get("skipped")}
            attempted = ids if attempted is None else (attempted & ids)
        if attempted is not None:
            per_regime.append(attempted)
    if not per_regime:
        return []
    common = set.intersection(*per_regime)
    return [c.id for c in run.cases if c.id in common]


def paired_results(run: GridRun, regimes: Sequence[str]) -> List[ConfigResult]:
    """Re-score every cell over the cases all regimes could run.

    Why this exists, and why the headline table is not enough. In the corpus as
    it stands only 3 of the 6 lectures carry a `course_id`, so `lecture_dense`
    is scored on 50 questions across 6 lectures and `course_hybrid` on 27
    across 3. Printing both as rows of a single table invites exactly the wrong
    reading: the difference between them then mixes *regime* with *corpus*, and
    the false-refusal rate — the number this evaluation exists to produce — is
    computed on a different population than the number it is compared against.

    Restricting both regimes to the common set makes the comparison a
    comparison. The full-corpus table is kept as the headline `lecture_dense`
    retrieval result, where the larger n is a strength rather than a confound.

    One asymmetry survives this and must be stated rather than fixed: even on
    identical questions the regimes search different spaces — `lecture_dense`
    is scoped to a single lecture, `course_hybrid` to a whole course. A lower
    hybrid score is therefore partly a harder task and not purely a worse
    retriever. That belongs in the threats-to-validity section and in the
    table caption; it is inherent to the regimes, and it is the point of the
    comparison, but only if it is named.
    """
    keep = set(paired_case_ids(run, regimes))
    if not keep:
        return []

    paired: List[ConfigResult] = []
    for (regime, k, threshold), outcomes in run.outcomes.items():
        if regime not in regimes:
            continue
        subset = [(c, o) for c, o in zip(run.cases, outcomes) if c.id in keep]
        if not subset:
            continue
        cases = [c for c, _ in subset]
        outs = [o for _, o in subset]
        paired.append(score_config(cases, outs, regime, k, threshold))
    return sorted(paired, key=lambda r: (r.regime, r.k, r.threshold))


# ── Output ───────────────────────────────────────────────────────────────

def to_markdown_table(results: Sequence[ConfigResult]) -> str:
    """Render the grid as a markdown table ready to paste into the thesis."""
    header = (
        "| Regime | k | Thr | n | Slide found | Anchor found | MRR | P@k | "
        "Latency (ms) | Refusal | False refusal | Err | Skip |\n"
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|"
    )
    lines = [header]
    for r in sorted(results, key=lambda x: (-x.mrr, x.regime, x.k)):
        lines.append(
            f"| {r.regime} | {r.k} | {r.threshold:.2f} | {r.n - r.skipped} | "
            f"{r.slide_found_rate:.3f} | {r.anchor_found_rate:.3f} | {r.mrr:.3f} | "
            f"{r.precision_at_k:.3f} | {r.median_latency_ms:.0f} | "
            f"{r.refusal_rate:.3f} | {r.false_refusal_rate:.3f} | {r.errors} | {r.skipped} |"
        )
    return "\n".join(lines)


def to_csv(results: Sequence[ConfigResult]) -> str:
    rows = [r.as_row() for r in results]
    if not rows:
        return ""
    cols = list(rows[0].keys())
    out = [",".join(cols)]
    out.extend(",".join(str(row[c]) for c in cols) for row in rows)
    return "\n".join(out)


# ── CLI ──────────────────────────────────────────────────────────────────

def _parse_floats(text: str) -> List[float]:
    return [float(x) for x in text.split(",") if x.strip()]


def _parse_ints(text: str) -> List[int]:
    return [int(x) for x in text.split(",") if x.strip()]


# ── Invariants the retriever provably satisfies ──────────────────────────

def _cells(results: Sequence[ConfigResult]) -> List[ConfigResult]:
    """Cells with at least one attempted case. A fully-skipped cell scores 0.0
    by definition, and comparing that against a scored cell would manufacture a
    violation out of the `course_id` gap in the golden set."""
    return [r for r in results if (r.n - r.skipped) > 0]


def monotonicity_violations(
    results: Sequence[ConfigResult], tolerance: float = 0.02
) -> List[str]:
    """Report cells that contradict a property the retrieval code guarantees.

    These are not heuristics. Each follows from the retrieval semantics, which
    is what makes them safe to reject a run on:

    **k-monotonicity — both regimes.** For a fixed (regime, threshold), a larger
    top-k returns a superset of a smaller one, so `slide_found` cannot fall as k
    rises. `retrieve_relevant_slides` truncates one ordered candidate list at k
    (retrieval.py:150); `rrf_fuse` takes `ordered_keys[:k]` from a pool sized
    `max(k * 2, 8)`, which also grows with k (retrieval.py:210,218,275).

    **Threshold-monotonicity — `lecture_dense` ONLY.** Verified in the SQL of
    `match_slides_by_lecture` (migration 20260719020001, lines 45-53): the
    function filters on `1 - (embedding <=> query) > match_threshold`, THEN
    orders by distance ascending, THEN applies `LIMIT match_count`. Because the
    ordering is by the same quantity the filter tests, a stricter threshold
    removes exactly a *suffix* of the ranked list — it can never promote a
    lower-ranked slide into the top-k. So `slide_found` cannot rise as the
    threshold rises. It is deliberately NOT checked for `course_hybrid`: there the
    threshold filters only the vector arm (retrieval.py:210) while the keyword
    arm is unfiltered, so shrinking the vector list changes the RRF ranking and
    can *promote* a keyword-only slide into the fused top-k. That regime is
    legitimately non-monotone in threshold, and asserting otherwise would
    reject healthy runs.

    `tolerance` exists because two things can legitimately move one case: HNSW
    is approximate, and `_fetch_slide` drops an enriched hit when the slide row
    is missing (retrieval.py:155-157). The default 0.02 is one case in fifty —
    large enough for that, far too small to hide a real failure. Against the
    2026-09-09 quota-corrupted run these checks fire eight times, the largest
    at 0.940.
    """
    scored = _cells(results)
    violations: List[str] = []
    # Compare against a hair over the tolerance. `0.86 - 0.84` is
    # 0.020000000000000018 in binary floating point, so a bare `> tolerance`
    # rejects a movement of exactly one case in fifty — the very size the
    # tolerance exists to permit.
    limit = tolerance + 1e-9

    by_regime_threshold: Dict[Tuple[str, float], List[ConfigResult]] = {}
    for r in scored:
        by_regime_threshold.setdefault((r.regime, r.threshold), []).append(r)
    for (regime, threshold), group in sorted(by_regime_threshold.items()):
        ordered = sorted(group, key=lambda r: r.k)
        for lower, higher in zip(ordered, ordered[1:]):
            drop = lower.slide_found_rate - higher.slide_found_rate
            if drop > limit:
                violations.append(
                    f"{regime} thr={threshold:.2f}: slide_found FELL from "
                    f"{lower.slide_found_rate:.3f} at k={lower.k} to "
                    f"{higher.slide_found_rate:.3f} at k={higher.k} "
                    f"(-{drop:.3f}). A larger top-k is a superset of a smaller "
                    f"one, so this cannot happen to a retriever that ran."
                )

    by_regime_k: Dict[Tuple[str, int], List[ConfigResult]] = {}
    for r in scored:
        if r.regime != REGIME_LECTURE_DENSE:
            continue
        by_regime_k.setdefault((r.regime, r.k), []).append(r)
    for (regime, k), group in sorted(by_regime_k.items()):
        ordered = sorted(group, key=lambda r: r.threshold)
        for looser, stricter in zip(ordered, ordered[1:]):
            rise = stricter.slide_found_rate - looser.slide_found_rate
            if rise > limit:
                violations.append(
                    f"{regime} k={k}: slide_found ROSE from "
                    f"{looser.slide_found_rate:.3f} at thr={looser.threshold:.2f} to "
                    f"{stricter.slide_found_rate:.3f} at thr={stricter.threshold:.2f} "
                    f"(+{rise:.3f}). The threshold is a hard SQL filter on one "
                    f"candidate list, so a stricter one cannot return more."
                )
    return violations


def latency_anomalies(results: Sequence[ConfigResult], ratio: float = 5.0) -> List[str]:
    """Flag a regime whose per-cell median latencies split by an order of magnitude.

    A deliberate WARNING rather than a rejection: a cold cache, a noisy VM or a
    single slow lecture can all stretch the spread, so this is the one signal
    here that is genuinely a heuristic. It earns its place because it is what
    made the 2026-09-09 corruption legible by eye — the dead cells clustered at
    53-59 ms because no network embedding call was made at all, against
    463-817 ms for the cells that really ran, a 15x spread.
    """
    notes: List[str] = []
    by_regime: Dict[str, List[ConfigResult]] = {}
    for r in _cells(results):
        if r.median_latency_ms > 0:
            by_regime.setdefault(r.regime, []).append(r)
    for regime, group in sorted(by_regime.items()):
        if len(group) < 2:
            continue
        fastest = min(group, key=lambda r: r.median_latency_ms)
        slowest = max(group, key=lambda r: r.median_latency_ms)
        if slowest.median_latency_ms >= ratio * fastest.median_latency_ms:
            notes.append(
                f"{regime}: median latency spans "
                f"{fastest.median_latency_ms:.0f} ms (k={fastest.k} thr={fastest.threshold:.2f}) "
                f"to {slowest.median_latency_ms:.0f} ms (k={slowest.k} thr={slowest.threshold:.2f}), "
                f"a {slowest.median_latency_ms / fastest.median_latency_ms:.1f}x spread. "
                f"Cells far below the rest often made no network call at all."
            )
    return notes


def credibility_report(
    results: Sequence[ConfigResult],
    max_error_rate: float,
    monotonicity_tolerance: float = 0.02,
):
    """Decide whether a run is worth reporting, and say why if it is not.

    Returns (ok, message). Two independent grounds for rejection, because the
    two failures this harness has actually produced were caught by neither the
    same signal nor the same reasoning:

    **Error rate.** Counting an errored lookup as a miss is right when a few
    queries fail and wrong when most do, because the score then measures the
    environment rather than the retriever. This caught the 2026-09-08
    `No module named 'fastapi'` run, where every lookup raised.

    **Invariant violations.** The 2026-09-09 quota run raised nothing at all —
    production catches its own failures by design — so it reported `Err 0` on
    every row and passed the error-rate check cleanly. What gave it away was
    that the numbers contradicted each other: `slide_found` fell as k rose, and
    rose as the threshold tightened. Both are impossible for a retriever that
    ran, so a run that does either is rejected on the arithmetic alone, with no
    need to have detected the cause.

    The second check is the one that matters most, because it does not depend
    on anticipating *how* a run will break.
    """
    attempted = sum(r.n - r.skipped for r in results)
    errored = sum(r.errors for r in results)
    if attempted <= 0:
        return False, ("Every case was skipped: no regime could run any question. "
                       "Check that the golden set's lectures have a course_id for "
                       "course-scoped regimes.")

    seen: List[str] = []
    for r in results:
        for m in r.error_messages:
            if m not in seen:
                seen.append(m)

    sections: List[str] = []

    rate = errored / attempted
    if rate > max_error_rate:
        lines = [f"{errored} of {attempted} attempted lookups failed ({rate:.0%}).",
                 "", "Distinct errors:"]
        lines += [f"  - {m[:400]}" for m in seen[:8]]
        if any("No module named" in m for m in seen):
            lines += ["", "A missing module means the backend dependencies are not installed "
                          "in this interpreter. Install the lean set and re-run:",
                      "    pip install -r backend/requirements-docker.txt"]
        if any(_is_quota_message(m) for m in seen):
            lines += ["", "The provider refused on quota. With the query embeddings "
                          "precomputed a full grid costs one call per DISTINCT question "
                          "(50, not 1232), so this should now only mean the daily "
                          "allowance was already spent before the run started. Wait for "
                          "the reset, or pass --rate-limit to pace the precompute."]
        sections.append("\n".join(lines))

    violations = monotonicity_violations(results, monotonicity_tolerance)
    if violations:
        lines = [f"{len(violations)} result(s) contradict a property the retriever "
                 f"provably satisfies:", ""]
        lines += [f"  - {v}" for v in violations[:8]]
        if len(violations) > 8:
            lines.append(f"  ... and {len(violations) - 8} more")
        lines += ["", "A run whose own numbers are mutually impossible measured "
                      "something other than retrieval quality — most likely a provider "
                      "or database failure that the production code caught and logged "
                      "rather than raised. Check the WARNING lines above for "
                      "`429`, `RPC failed`, or `embedding failed`."]
        sections.append("\n".join(lines))

    if not sections:
        return True, ""

    sections.append("No results were written: a plausible-looking table produced by a "
                    "broken run is worse than no table at all. Re-run once the cause is "
                    "fixed, or pass --allow-errors to write it anyway.")
    return False, "\n\n".join(sections)


def _is_quota_message(message: str) -> bool:
    lowered = message.lower()
    return "429" in lowered or "resource_exhausted" in lowered or "quota" in lowered


def _git_sha() -> str:
    """Short HEAD sha, so a table can be traced back to the code that made it."""
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True, timeout=5)
        sha = out.stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain"],
                               capture_output=True, text=True, timeout=5).stdout.strip()
        return f"{sha}{'-dirty' if dirty else ''}" if sha else "unknown"
    except Exception:  # noqa: BLE001 — provenance is best-effort, never fatal
        return "unknown"


def provenance_header(
    args: argparse.Namespace,
    cases: Sequence[GoldenQuestion],
    embed: EmbeddingPrecompute,
    verdict: str,
) -> str:
    """A header that travels with the table.

    The 2026-09-09 incident produced a file that was indistinguishable from a
    good one once it left the terminal. A table that states its own date, code
    revision, corpus and verdict cannot be mistaken for another run's, and a
    rejected run cannot be mistaken for an accepted one.
    """
    return "\n".join([
        "<!--",
        f"  generated : {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%SZ')}",
        f"  commit    : {_git_sha()}",
        f"  golden set: {args.golden} ({len(cases)} questions, "
        f"{len({c.question for c in cases})} distinct)",
        f"  grid      : regimes={args.regimes} k={args.k} threshold={args.threshold}",
        f"  embeddings: {embed.calls} call(s) for "
        f"{len(embed.embeddings)} distinct question(s), "
        f"median {embed.median_latency_ms:.0f} ms",
        f"  verdict   : {verdict}",
        "",
        "  Latency below is ANN/FTS search plus slide enrichment. It EXCLUDES the",
        "  query-embedding round trip, which is precomputed once per distinct",
        "  question and served from memory for every cell — embedding cost is",
        "  constant across configurations, so including it would only add noise",
        "  to the comparison. The embedding latency is reported on the line above.",
        "-->",
        "",
    ])


async def main_async(args: argparse.Namespace) -> int:
    cases = load_golden_set(args.golden)
    logger.info("loaded %d golden questions from %s", len(cases), args.golden)

    outdir = Path(args.outdir)
    # Refuse to sit next to output from an earlier run. The corrupted table from
    # 2026-09-09 was written to this exact path, and a stale file beside a fresh
    # one is how the wrong numbers reach a thesis.
    legacy = outdir / "grid_results.md"
    if legacy.exists() and not args.force:
        print(f"\n=== REFUSING TO RUN ===\n{legacy} already exists.")
        print("Results are now written to a timestamped subdirectory, so this file is")
        print("from an earlier run and none of its numbers can be trusted.")
        print("")
        print("Move it rather than deleting it — a rejected run is evidence, and this")
        print("one carries measurements that exist nowhere else:")
        print("    thesis/results-rejected/<date>/")
        print("")
        print("Then re-run, or pass --force to run alongside it.")
        return 3

    regimes = [r for r in args.regimes.split(",") if r.strip()]

    # ── Phase 1: embed every distinct question, once, before scoring anything.
    print(f"Embedding {len({c.question for c in cases})} distinct question(s)...")
    embed = await precompute_query_embeddings(
        cases, rate_limit_per_second=args.rate_limit
    )
    print(f"  {embed.calls} call(s), median {embed.median_latency_ms:.0f} ms, "
          f"{len(embed.failures)} failure(s)")

    if not embed.ok and not args.allow_errors:
        print("\n=== RUN REJECTED (before the sweep) ===")
        print(f"{len(embed.failures)} of {len(embed.failures) + len(embed.embeddings)} "
              f"question(s) could not be embedded.\n")
        for question, why in list(embed.failures.items())[:5]:
            print(f"  {question[:70]!r}\n    -> {why[:300]}\n")
        if any(_is_quota_message(w) for w in embed.failures.values()):
            print("The daily embedding allowance is spent. A full grid now costs one")
            print("call per DISTINCT question (50, not the 1232 the old sweep paid),")
            print("so waiting for the quota reset is enough — no other change needed.")
        print("Nothing was written. Scoring a grid on embeddings that do not exist")
        print("produces a table that looks like a result and measures the provider.")
        return 2

    # ── Phase 2: sweep, with every cell served the same precomputed vectors.
    with serve_embeddings_from(embed.embeddings):
        run = await run_grid(
            cases, _parse_ints(args.k), _parse_floats(args.threshold), regimes
        )
    results = run.results

    ok, why = credibility_report(results, args.max_error_rate, args.monotonicity_tolerance)
    for note in latency_anomalies(results):
        print(f"\nWARNING  {note}")

    if not ok and not args.allow_errors:
        print("\n=== RUN REJECTED ===")
        print(why)
        return 2

    table = to_markdown_table(results)
    print("\n=== Retrieval grid (full corpus) ===")
    print(table)

    # The regime comparison, scored over one population. Only meaningful when
    # more than one regime was swept AND they differ in what they could run;
    # otherwise it would duplicate the table above under a heading implying it
    # says something new.
    paired = paired_results(run, regimes) if len(regimes) > 1 else []
    paired_table = ""
    if paired:
        kept = len(paired_case_ids(run, regimes))
        if kept < len(cases):
            paired_table = to_markdown_table(paired)
            print(f"\n=== Regime comparison (paired, n={kept} of {len(cases)}) ===")
            print("Both regimes scored on the SAME questions — the ones every regime could")
            print("run. The table above scores each regime on everything it could attempt,")
            print("so its rows do not share a population and must not be compared directly.")
            print(paired_table)
            print("\nNote: even paired, the regimes search different spaces — lecture_dense")
            print("is scoped to one lecture, course_hybrid to a whole course. A lower hybrid")
            print("score is partly a harder task, not purely a worse retriever.")

    if not ok:
        print("\n*** --allow-errors was set; the numbers below are NOT trustworthy ***")
        print(why)

    verdict = "ACCEPTED" if ok else "REJECTED - written under --allow-errors, DO NOT CITE"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    rundir = outdir / stamp
    rundir.mkdir(parents=True, exist_ok=True)

    header = provenance_header(args, cases, embed, verdict)
    (rundir / "grid_results.md").write_text(header + table + "\n", encoding="utf-8")
    (rundir / "grid_results.csv").write_text(to_csv(results) + "\n", encoding="utf-8")
    if paired_table:
        kept = len(paired_case_ids(run, regimes))
        (rundir / "grid_paired.md").write_text(
            header
            + f"<!-- Regime comparison. Both regimes scored on the SAME {kept} of "
              f"{len(cases)} questions — the ones every regime could run. The regimes "
              f"still search different spaces (one lecture vs a whole course), so a "
              f"lower hybrid score is partly a harder task. -->\n\n"
            + paired_table + "\n",
            encoding="utf-8",
        )
        (rundir / "grid_paired.csv").write_text(to_csv(paired) + "\n", encoding="utf-8")
    (rundir / "grid_per_question.json").write_text(
        json.dumps({
            "generated_utc": stamp,
            "commit": _git_sha(),
            "golden_set": str(args.golden),
            "verdict": verdict,
            "embedding_calls": embed.calls,
            "embedding_median_ms": round(embed.median_latency_ms, 1),
            "configs": [{**r.as_row(), "per_question": r.per_question} for r in results],
        }, indent=2),
        encoding="utf-8",
    )
    written = ["grid_results.md", "grid_results.csv", "grid_per_question.json"]
    if paired_table:
        written += ["grid_paired.md", "grid_paired.csv"]
    print(f"\nWrote {', '.join(written)} to {rundir}/")

    if results and ok:
        best = max(results, key=lambda r: r.mrr)
        print(
            f"\nBest by MRR: {best.regime} k={best.k} threshold={best.threshold:.2f} "
            f"-> MRR {best.mrr:.3f}, slide_found {best.slide_found_rate:.3f}"
        )
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Retrieval grid evaluation over real decks.")
    parser.add_argument("--golden", default="backend/eval/data/golden_set.json",
                        help="path to the golden-set JSON")
    parser.add_argument("--k", default="3,5,8,10", help="comma-separated top-k values")
    parser.add_argument("--threshold", default="0.0,0.5,0.65,0.75",
                        help="comma-separated similarity thresholds")
    parser.add_argument("--regimes", default=",".join(REGIMES),
                        help=f"comma-separated regimes from {REGIMES}")
    parser.add_argument("--outdir", default="thesis/results",
                        help="parent directory; each run writes a timestamped subdirectory")
    parser.add_argument("--max-error-rate", type=float, default=0.20,
                        help="reject the run and write nothing if more than this share "
                             "of attempted lookups failed (default 0.20)")
    parser.add_argument("--monotonicity-tolerance", type=float, default=0.02,
                        help="how far slide_found may move against a guaranteed "
                             "monotonicity before the run is rejected. Default 0.02 — "
                             "one case in fifty, which covers HNSW approximation and a "
                             "dropped slide row without hiding a real failure")
    parser.add_argument("--rate-limit", type=float, default=0.0,
                        help="cap the embedding precompute at this many requests per "
                             "second. Rarely needed: the precompute makes one call per "
                             "distinct question, not one per grid cell")
    parser.add_argument("--force", action="store_true",
                        help="run even though an earlier run's output sits in --outdir")
    parser.add_argument("--allow-errors", action="store_true",
                        help="score and write results despite failures or violated "
                             "invariants. Explicit opt-in: the output is stamped "
                             "DO NOT CITE, because the numbers measure the environment "
                             "as much as the retriever")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(levelname)s %(message)s",
    )
    raise SystemExit(asyncio.run(main_async(args)))


if __name__ == "__main__":
    main()
