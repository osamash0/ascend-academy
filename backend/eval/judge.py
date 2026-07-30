"""LLM-judge for open-ended synthesis quality (Roadmap P1-3).

The model call is injected (`JudgeFn`) rather than hardcoded to a specific
orchestrator function, so this is unit-testable with a canned response
(see backend/tests/unit/test_eval_harness.py) and only needs a real model
for the actual nightly run (backend/eval/pipeline.py's LivePipeline wires a
real one).
"""
from __future__ import annotations

import re
from typing import List

from backend.eval.golden_sets import SynthesisQualityCase
from backend.eval.pipeline import JudgeFn

_JUDGE_PROMPT_TEMPLATE = """You are grading a lecture-deck summary for quality.

Rubric: {rubric}

Summary to grade:
\"\"\"
{summary}
\"\"\"

Respond with ONLY a single integer from 1 to 10 (no explanation, no other text).
"""


def _parse_score(raw: str) -> float:
    """Extracts the first 1-10 integer from the judge's response. Returns 0.0
    (worst score, not a silent pass) if nothing parseable is found — a judge
    that can't produce a usable score must never be scored as "fine"."""
    match = re.search(r"\b(10|[1-9])\b", raw.strip())
    if not match:
        return 0.0
    return float(match.group(1))


async def judge_synthesis_quality(
    case: SynthesisQualityCase, summary: str, judge_fn: JudgeFn
) -> float:
    """Returns a 0-10 quality score for `summary` against `case`'s rubric."""
    prompt = _JUDGE_PROMPT_TEMPLATE.format(rubric=case.rubric, summary=summary)
    raw = await judge_fn(prompt)
    return _parse_score(raw)


async def judge_synthesis_quality_set(
    cases: List[SynthesisQualityCase], summaries: List[str], judge_fn: JudgeFn
) -> float:
    """Mean judge score (0-10, normalized to 0-1) across all cases. Returns
    0.0 for an empty set rather than raising or silently passing — an eval
    run with no synthesis cases loaded is a configuration bug, not a 10/10."""
    if not cases:
        return 0.0
    scores = [
        await judge_synthesis_quality(case, summary, judge_fn)
        for case, summary in zip(cases, summaries)
    ]
    return (sum(scores) / len(scores)) / 10.0
