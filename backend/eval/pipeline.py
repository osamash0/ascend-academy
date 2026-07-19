"""The pipeline abstraction the eval harness scores (Roadmap P1-3).

`EvalPipeline` is the seam between the harness (which only knows about
golden-set cases and scores) and "the actual AI pipeline" (which knows how
to generate a quiz answer, retrieve slides, and summarize a deck). This
lets the harness's scoring logic be tested deterministically (`FakePipeline`)
without live API calls, while `LivePipeline` wires the real calls for the
nightly run against actual models.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Awaitable, Callable, Dict, List, Protocol

from backend.eval.golden_sets import (
    QuizGoldenCase,
    RetrievalCase,
    SynthesisQualityCase,
    TutorFaithfulnessCase,
)


class EvalPipeline(Protocol):
    async def answer_quiz_question(self, case: QuizGoldenCase) -> int:
        """Returns the pipeline's chosen answer index for this question."""
        ...

    async def retrieve_for_tutor_question(self, case: TutorFaithfulnessCase) -> List[int]:
        """Returns the slide indices the tutor actually grounded its answer in."""
        ...

    async def retrieve_for_query(self, case: RetrievalCase) -> List[int]:
        """Returns the ranked slide indices retrieval returned for this query."""
        ...

    async def summarize_deck(self, case: SynthesisQualityCase) -> str:
        """Returns the pipeline's generated deck summary (for judging)."""
        ...


@dataclass
class FakePipeline:
    """Deterministic pipeline double for CI-safe harness tests: returns
    exactly the golden-set expectation by default (a "perfect" pipeline),
    with optional per-case overrides to simulate specific wrong answers —
    this is how test_eval_harness.py proves the scorer actually detects a
    regression rather than just echoing whatever it's fed."""

    quiz_overrides: Dict[str, int] | None = None  # keyed by f"{deck_id}:{slide_index}"
    tutor_overrides: Dict[str, List[int]] | None = None  # keyed by f"{deck_id}:{question}"
    retrieval_overrides: Dict[str, List[int]] | None = None  # keyed by f"{deck_id}:{query}"
    summary_overrides: Dict[str, str] | None = None  # keyed by deck_id

    async def answer_quiz_question(self, case: QuizGoldenCase) -> int:
        key = f"{case.deck_id}:{case.slide_index}"
        if self.quiz_overrides and key in self.quiz_overrides:
            return self.quiz_overrides[key]
        return case.expected_answer_index

    async def retrieve_for_tutor_question(self, case: TutorFaithfulnessCase) -> List[int]:
        key = f"{case.deck_id}:{case.question}"
        if self.tutor_overrides and key in self.tutor_overrides:
            return self.tutor_overrides[key]
        return sorted(case.expected_grounded_slide_indices)

    async def retrieve_for_query(self, case: RetrievalCase) -> List[int]:
        key = f"{case.deck_id}:{case.query}"
        if self.retrieval_overrides and key in self.retrieval_overrides:
            return self.retrieval_overrides[key]
        return sorted(case.expected_relevant_slide_indices)

    async def summarize_deck(self, case: SynthesisQualityCase) -> str:
        if self.summary_overrides and case.deck_id in self.summary_overrides:
            return self.summary_overrides[case.deck_id]
        return case.generated_summary


class LivePipeline:
    """Wires the harness to the real pipeline for a nightly run against live
    models. Requires real provider API keys and a populated database with
    the frozen decks loaded (see docs/EVAL_HARNESS.md) — not exercised in
    unit tests, which use FakePipeline instead."""

    def __init__(self, ai_model: str = "cerebras"):
        self.ai_model = ai_model

    async def answer_quiz_question(self, case: QuizGoldenCase) -> int:
        from backend.services.ai.orchestrator import generate_slide_quiz

        prompt_text = (
            f"{case.question}\n" + "\n".join(f"{i}. {o}" for i, o in enumerate(case.options))
        )
        result = await generate_slide_quiz(prompt_text, ai_model=self.ai_model)
        answer = result.get("correctAnswer")
        return int(answer) if answer is not None else -1

    async def retrieve_for_tutor_question(self, case: TutorFaithfulnessCase) -> List[int]:
        from backend.services.ai.retrieval import retrieve_relevant_slides

        hits = await retrieve_relevant_slides(case.question, lecture_id=case.deck_id, k=5)
        return [h["slide_index"] for h in hits]

    async def retrieve_for_query(self, case: RetrievalCase) -> List[int]:
        from backend.services.ai.retrieval import retrieve_relevant_slides

        hits = await retrieve_relevant_slides(case.query, lecture_id=case.deck_id, k=case.k)
        return [h["slide_index"] for h in hits]

    async def summarize_deck(self, case: SynthesisQualityCase) -> str:
        from backend.services.ai.orchestrator import generate_deck_summary

        return await generate_deck_summary(case.generated_summary, ai_model=self.ai_model)


JudgeFn = Callable[[str], Awaitable[str]]
