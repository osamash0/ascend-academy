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

Running it
----------
    python -m backend.eval.retrieval_grid --golden backend/eval/data/golden_set.json

Needs real provider API keys (for query embedding) and database access.
The sweep embeds queries and runs ANN/FTS search; it calls NO generation
model, so a full grid is cheap.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import statistics
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

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
    errors: int = 0
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
            "errors": self.errors,
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
        if out.get("error"):
            result.errors += 1
            # A failed lookup is a miss, not an exclusion. Dropping it would
            # silently raise every rate below.
            found.append(0.0); anchors.append(0.0); rrs.append(0.0); precisions.append(0.0)
            result.per_question.append({"id": case.id, "error": out["error"]})
            continue

        keys = out.get("keys", [])
        texts = out.get("texts", [])
        sims = out.get("similarities", [])

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
        })

    n = len(cases)
    # Retrieval quality is scored over EVERY case: an errored lookup is a
    # miss the system really produced, and excluding it would inflate the
    # rates.
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


# ── Live retrieval (needs DB + API keys) ─────────────────────────────────

async def _retrieve(case: GoldenQuestion, regime: str, k: int, threshold: float) -> Dict[str, Any]:
    """Run one query through one regime and normalise the result.

    Note what is deliberately NOT passed: `current_slide_index`. The lecture
    retriever anchors the current slide at position 0 with a synthetic
    similarity of 0.0, which would hand the evaluation a free hit whenever
    the expected slide happened to be the one on screen.
    """
    started = time.perf_counter()
    try:
        if regime == REGIME_LECTURE_DENSE:
            from backend.services.ai.retrieval import retrieve_relevant_slides
            hits = await retrieve_relevant_slides(
                case.question, lecture_id=case.lecture_id, k=k, threshold=threshold
            )
            keys = [(case.lecture_id, int(h["slide_index"])) for h in hits]
        elif regime == REGIME_COURSE_HYBRID:
            if not case.course_id:
                return {"error": f"case {case.id} has no course_id (required for {regime})"}
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
    return {
        "keys": keys,
        "texts": [f"{h.get('title', '')} {h.get('content', '')}" for h in hits],
        "similarities": [float(h.get("similarity", 0.0)) for h in hits],
        "latency_ms": latency_ms,
    }


async def run_grid(
    cases: Sequence[GoldenQuestion],
    ks: Sequence[int],
    thresholds: Sequence[float],
    regimes: Sequence[str] = REGIMES,
) -> List[ConfigResult]:
    """Sweep every (regime, k, threshold) cell and score each one."""
    results: List[ConfigResult] = []
    total = len(regimes) * len(ks) * len(thresholds)
    done = 0
    for regime in regimes:
        for k in ks:
            for threshold in thresholds:
                outcomes = [await _retrieve(c, regime, k, threshold) for c in cases]
                results.append(score_config(cases, outcomes, regime, k, threshold))
                done += 1
                logger.info("grid %d/%d — %s k=%d thr=%.2f", done, total, regime, k, threshold)
    return results


# ── Output ───────────────────────────────────────────────────────────────

def to_markdown_table(results: Sequence[ConfigResult]) -> str:
    """Render the grid as a markdown table ready to paste into the thesis."""
    header = (
        "| Regime | k | Thr | n | Slide found | Anchor found | MRR | P@k | "
        "Latency (ms) | Refusal | False refusal | Err |\n"
        "|---|---|---|---|---|---|---|---|---|---|---|---|"
    )
    lines = [header]
    for r in sorted(results, key=lambda x: (-x.mrr, x.regime, x.k)):
        lines.append(
            f"| {r.regime} | {r.k} | {r.threshold:.2f} | {r.n} | "
            f"{r.slide_found_rate:.3f} | {r.anchor_found_rate:.3f} | {r.mrr:.3f} | "
            f"{r.precision_at_k:.3f} | {r.median_latency_ms:.0f} | "
            f"{r.refusal_rate:.3f} | {r.false_refusal_rate:.3f} | {r.errors} |"
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


async def main_async(args: argparse.Namespace) -> int:
    cases = load_golden_set(args.golden)
    logger.info("loaded %d golden questions from %s", len(cases), args.golden)

    regimes = [r for r in args.regimes.split(",") if r.strip()]
    results = await run_grid(cases, _parse_ints(args.k), _parse_floats(args.threshold), regimes)

    table = to_markdown_table(results)
    print("\n=== Retrieval grid ===")
    print(table)

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "grid_results.md").write_text(table + "\n", encoding="utf-8")
    (outdir / "grid_results.csv").write_text(to_csv(results) + "\n", encoding="utf-8")
    (outdir / "grid_per_question.json").write_text(
        json.dumps([{**r.as_row(), "per_question": r.per_question} for r in results], indent=2),
        encoding="utf-8",
    )
    print(f"\nWrote grid_results.md, grid_results.csv and grid_per_question.json to {outdir}/")

    if results:
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
    parser.add_argument("--outdir", default="thesis/results", help="where to write results")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(levelname)s %(message)s",
    )
    raise SystemExit(asyncio.run(main_async(args)))


if __name__ == "__main__":
    main()
