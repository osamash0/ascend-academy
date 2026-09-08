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


def _require_lecture_uuid(deck_id: str, case_label: str) -> str:
    """Reject a synthetic deck id before it reaches the database.

    `lectures.id` is a UUID. The frozen golden sets in `golden_sets.py` use
    readable placeholders ("algorithms_101"), which match no row — so
    retrieval silently returns nothing and every retrieval metric scores
    0.0. A zero that means "misconfigured" is indistinguishable from a zero
    that means "the retriever failed", and reporting the second when the
    first is true would be a fabricated result.

    So this fails loudly instead. For a real-corpus run use
    `backend.eval.retrieval_grid`, whose golden set carries real lecture
    UUIDs.
    """
    from uuid import UUID

    try:
        UUID(str(deck_id))
    except (ValueError, AttributeError, TypeError):
        raise ValueError(
            f"LivePipeline needs a real lecture UUID, got deck_id={deck_id!r} "
            f"for {case_label}. The frozen golden sets are synthetic and "
            f"cannot be run against a live database — use "
            f"`python -m backend.eval.retrieval_grid` with a real-corpus "
            f"golden set, or run this harness with --fake."
        ) from None
    return str(deck_id)


class LivePipeline:
    """Wires the harness to the real pipeline for a nightly run against live
    models. Requires real provider API keys and a populated database whose
    lecture UUIDs match the golden set — not exercised in unit tests, which
    use FakePipeline instead.

    Note: the frozen sets in `golden_sets.py` are synthetic, so this class
    cannot run against them (see `_require_lecture_uuid`). The real-corpus
    evaluation lives in `backend.eval.retrieval_grid`.
    """

    def __init__(self, ai_model: str = "cerebras"):
        self.ai_model = ai_model

    async def answer_quiz_question(self, case: QuizGoldenCase) -> int:
        """Ask the model to ANSWER the golden question, not to write a new one.

        The previous implementation called `generate_slide_quiz`, which
        *generates* a fresh question with its own invented options, then
        compared that question's `correctAnswer` index against the golden
        index into a different option list. The two indices were unrelated,
        so the metric measured nothing. Answering and generating are
        different tasks; this measures answering.
        """
        from backend.services.ai.orchestrator import generate_text

        options = "\n".join(f"{i}. {o}" for i, o in enumerate(case.options))
        prompt = (
            "Answer the multiple-choice question using only the option list.\n"
            "Reply with the index of the correct option and nothing else — "
            "a single integer, no explanation.\n\n"
            f"Question: {case.question}\n{options}\n\nAnswer index:"
        )
        raw = await generate_text(prompt, ai_model=self.ai_model)

        # Take the first integer in the reply that names a valid option, so a
        # chatty model ("The answer is 2.") still scores. -1 marks an
        # unparseable answer, which the scorer counts as wrong rather than
        # dropping — a silent drop would inflate accuracy.
        import re

        for token in re.findall(r"\d+", str(raw)):
            index = int(token)
            if 0 <= index < len(case.options):
                return index
        return -1

    async def retrieve_for_tutor_question(self, case: TutorFaithfulnessCase) -> List[int]:
        from backend.services.ai.retrieval import retrieve_relevant_slides

        lecture_id = _require_lecture_uuid(case.deck_id, f"tutor case {case.question[:40]!r}")
        hits = await retrieve_relevant_slides(case.question, lecture_id=lecture_id, k=5)
        return [h["slide_index"] for h in hits]

    async def retrieve_for_query(self, case: RetrievalCase) -> List[int]:
        from backend.services.ai.retrieval import retrieve_relevant_slides

        lecture_id = _require_lecture_uuid(case.deck_id, f"retrieval case {case.query[:40]!r}")
        hits = await retrieve_relevant_slides(case.query, lecture_id=lecture_id, k=case.k)
        return [h["slide_index"] for h in hits]

    async def summarize_deck(self, case: SynthesisQualityCase) -> str:
        from backend.services.ai.orchestrator import generate_deck_summary

        return await generate_deck_summary(case.generated_summary, ai_model=self.ai_model)


JudgeFn = Callable[[str], Awaitable[str]]
