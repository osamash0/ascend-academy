"""Eval harness CLI (Roadmap P1-3). Run with: python -m backend.eval.run_eval

Runs the golden set against a pipeline (LivePipeline by default — needs real
provider API keys and DB access; pass --fake for a smoke run against
FakePipeline, useful for verifying the harness itself is wired correctly),
scores it, persists the scorecard to `eval_runs`, and exits non-zero if any
metric falls below its band (a CI-failing regression).
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from typing import List

from backend.eval.golden_sets import (
    QUIZ_GOLDEN_SET,
    RETRIEVAL_GOLDEN_SET,
    SYNTHESIS_QUALITY_GOLDEN_SET,
    TUTOR_FAITHFULNESS_GOLDEN_SET,
)
from backend.eval.judge import judge_synthesis_quality_set
from backend.eval.pipeline import EvalPipeline, FakePipeline, LivePipeline
from backend.eval.scorer import Scorecard, check_regression, score_quiz_key_accuracy, score_retrieval_precision_at_k, score_tutor_faithfulness

logger = logging.getLogger(__name__)


async def run_scorecard(pipeline: EvalPipeline, judge_fn=None) -> Scorecard:
    actual_answers = [await pipeline.answer_quiz_question(c) for c in QUIZ_GOLDEN_SET]
    quiz_score = score_quiz_key_accuracy(QUIZ_GOLDEN_SET, actual_answers)

    tutor_retrieved = [
        await pipeline.retrieve_for_tutor_question(c) for c in TUTOR_FAITHFULNESS_GOLDEN_SET
    ]
    tutor_score = score_tutor_faithfulness(TUTOR_FAITHFULNESS_GOLDEN_SET, tutor_retrieved)

    retrieval_retrieved = [
        await pipeline.retrieve_for_query(c) for c in RETRIEVAL_GOLDEN_SET
    ]
    retrieval_score = score_retrieval_precision_at_k(RETRIEVAL_GOLDEN_SET, retrieval_retrieved)

    synthesis_score = 0.0
    if judge_fn is not None and SYNTHESIS_QUALITY_GOLDEN_SET:
        summaries = [await pipeline.summarize_deck(c) for c in SYNTHESIS_QUALITY_GOLDEN_SET]
        synthesis_score = await judge_synthesis_quality_set(
            SYNTHESIS_QUALITY_GOLDEN_SET, summaries, judge_fn
        )

    return Scorecard(
        quiz_key_accuracy=quiz_score,
        tutor_faithfulness=tutor_score,
        retrieval_precision_at_k=retrieval_score,
        synthesis_quality=synthesis_score,
    )


async def persist_scorecard(scorecard: Scorecard, passed: bool, failing_metrics: List[str]) -> None:
    """Best-effort: writes one row per run to `eval_runs` so scores are
    plottable over time. Never raises — a persistence failure shouldn't
    mask (or be masked by) the actual pass/fail signal from stdout/exit code."""
    try:
        from backend.core.database import get_db_connection
        conn_cm = await get_db_connection()
        async with conn_cm as conn:
            await conn.execute(
                """
                INSERT INTO public.eval_runs
                    (quiz_key_accuracy, tutor_faithfulness, retrieval_precision_at_k,
                     synthesis_quality, passed, failing_metrics)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                scorecard.quiz_key_accuracy,
                scorecard.tutor_faithfulness,
                scorecard.retrieval_precision_at_k,
                scorecard.synthesis_quality,
                passed,
                failing_metrics,
            )
    except Exception as exc:
        logger.warning("Failed to persist eval scorecard (continuing): %s", exc)


async def main_async(use_fake: bool) -> int:
    if use_fake:
        pipeline: EvalPipeline = FakePipeline()
        judge_fn = None  # no live model in fake mode; synthesis_quality reports 0.0
    else:
        pipeline = LivePipeline()

        async def judge_fn(prompt: str) -> str:
            from backend.services.ai.orchestrator import generate_text
            return await generate_text(prompt, ai_model="cerebras")

    scorecard = await run_scorecard(pipeline, judge_fn=judge_fn)
    failing = check_regression(scorecard)
    passed = not failing

    print("=== AI Eval Scorecard ===")
    for metric, value in scorecard.as_dict().items():
        flag = "FAIL" if metric in failing else "ok"
        print(f"  {metric:28s} {value:.3f}  [{flag}]")
    print(f"Result: {'PASS' if passed else 'FAIL'}")
    if failing:
        print(f"Regressed metrics: {', '.join(failing)}")

    await persist_scorecard(scorecard, passed, failing)
    return 0 if passed else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the AI eval harness.")
    parser.add_argument(
        "--fake", action="store_true",
        help="Use FakePipeline (no live API calls) to smoke-test the harness itself.",
    )
    args = parser.parse_args()
    exit_code = asyncio.run(main_async(use_fake=args.fake))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
