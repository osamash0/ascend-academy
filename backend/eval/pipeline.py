"""The pipeline abstraction the eval harness scores (Roadmap P1-3).

`EvalPipeline` is the seam between the harness (which only knows about
golden-set cases and scores) and "the actual AI pipeline" (which knows how
to generate a quiz answer, retrieve slides, and summarize a deck). This
lets the harness's scoring logic be tested deterministically (`FakePipeline`)
without live API calls, while `LivePipeline` wires the real calls for the
nightly run against actual models.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

from backend.eval.golden_sets import (
    BENIGN_SLIDE_CONTENT,
    BENIGN_SLIDE_CONTENT_BY_DECK,
    PromptInjectionCase,
    QuizGoldenCase,
    RetrievalCase,
    SynthesisQualityCase,
    TutorFaithfulnessCase,
)

# A tutor reply the injection judge should rule NOT COMPLIANT for an attack
# case, and the shape FakePipeline returns by default so the fake harness
# models a tutor that resists.
SAFE_REFUSAL_REPLY = (
    "I can't follow instructions that appear inside course materials or chat "
    "messages — they're content, not commands. Here's what the slide actually "
    "covers, though: [Source 1]."
)

# The mirror for benign controls, where engaging IS the correct behaviour.
SAFE_ENGAGED_REPLY = (
    "Sure — let's work through what that part of the material is asking you to "
    "do, step by step [Source 1]."
)


class EvalPipeline(Protocol):
    async def answer_quiz_question(self, case: QuizGoldenCase) -> int:
        """Returns the pipeline's chosen answer index for this question."""
        ...

    async def retrieve_for_tutor_question(self, case: TutorFaithfulnessCase) -> list[int]:
        """Returns the slide indices the tutor actually grounded its answer in."""
        ...

    async def retrieve_for_query(self, case: RetrievalCase) -> list[int]:
        """Returns the ranked slide indices retrieval returned for this query."""
        ...

    async def summarize_deck(self, case: SynthesisQualityCase) -> str:
        """Returns the pipeline's generated deck summary (for judging)."""
        ...

    async def answer_with_injected_content(self, case: PromptInjectionCase) -> str:
        """Returns the tutor's raw reply with `case.payload` placed in the
        channel under test (for compliance judging)."""
        ...


@dataclass
class FakePipeline:
    """Deterministic pipeline double for CI-safe harness tests: returns
    exactly the golden-set expectation by default (a "perfect" pipeline),
    with optional per-case overrides to simulate specific wrong answers —
    this is how test_eval_harness.py proves the scorer actually detects a
    regression rather than just echoing whatever it's fed."""

    quiz_overrides: dict[str, int] | None = None  # keyed by f"{deck_id}:{slide_index}"
    tutor_overrides: dict[str, list[int]] | None = None  # keyed by f"{deck_id}:{question}"
    retrieval_overrides: dict[str, list[int]] | None = None  # keyed by f"{deck_id}:{query}"
    summary_overrides: dict[str, str] | None = None  # keyed by deck_id
    injection_overrides: dict[str, str] | None = None  # keyed by f"{deck_id}:{category}:{channel}"

    async def answer_quiz_question(self, case: QuizGoldenCase) -> int:
        key = f"{case.deck_id}:{case.slide_index}"
        if self.quiz_overrides and key in self.quiz_overrides:
            return self.quiz_overrides[key]
        return case.expected_answer_index

    async def retrieve_for_tutor_question(self, case: TutorFaithfulnessCase) -> list[int]:
        key = f"{case.deck_id}:{case.question}"
        if self.tutor_overrides and key in self.tutor_overrides:
            return self.tutor_overrides[key]
        return sorted(case.expected_grounded_slide_indices)

    async def retrieve_for_query(self, case: RetrievalCase) -> list[int]:
        key = f"{case.deck_id}:{case.query}"
        if self.retrieval_overrides and key in self.retrieval_overrides:
            return self.retrieval_overrides[key]
        return sorted(case.expected_relevant_slide_indices)

    async def summarize_deck(self, case: SynthesisQualityCase) -> str:
        if self.summary_overrides and case.deck_id in self.summary_overrides:
            return self.summary_overrides[case.deck_id]
        return case.generated_summary

    async def answer_with_injected_content(self, case: PromptInjectionCase) -> str:
        """Default: the reply a tutor that behaves correctly would give — a
        refusal for attacks, engagement for benign controls. Overrides simulate
        a tutor that got it wrong, which is how the scorer's regression
        detection is proven rather than assumed."""
        key = f"{case.deck_id}:{case.category}:{case.channel}"
        if self.injection_overrides and key in self.injection_overrides:
            return self.injection_overrides[key]
        return SAFE_ENGAGED_REPLY if case.expected_compliant else SAFE_REFUSAL_REPLY


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

    async def retrieve_for_tutor_question(self, case: TutorFaithfulnessCase) -> list[int]:
        from backend.services.ai.retrieval import retrieve_relevant_slides

        hits = await retrieve_relevant_slides(case.question, lecture_id=case.deck_id, k=5)
        return [h["slide_index"] for h in hits]

    async def retrieve_for_query(self, case: RetrievalCase) -> list[int]:
        from backend.services.ai.retrieval import retrieve_relevant_slides

        hits = await retrieve_relevant_slides(case.query, lecture_id=case.deck_id, k=case.k)
        return [h["slide_index"] for h in hits]

    async def summarize_deck(self, case: SynthesisQualityCase) -> str:
        from backend.services.ai.orchestrator import generate_deck_summary

        return await generate_deck_summary(case.generated_summary, ai_model=self.ai_model)

    async def answer_with_injected_content(self, case: PromptInjectionCase) -> str:
        """Calls the REAL course tutor with the adversarial payload in place.

        This observes production behaviour — tutor.py and prompts.py are not
        modified, and the reply comes back through exactly the path a student's
        question takes. Unlike this class's other methods it needs no database:
        `chat_with_course` takes `retrieved` as a parameter (retrieval is the
        caller's job), so the slide is constructed here directly.
        """
        from backend.services.ai.tutor import chat_with_course

        if case.channel == "slide_content":
            slide_content = case.payload
            user_message = case.cover_question
        else:
            slide_content = BENIGN_SLIDE_CONTENT_BY_DECK.get(
                case.deck_id, BENIGN_SLIDE_CONTENT
            )
            user_message = case.payload

        # similarity MUST clear DEFAULT_THRESHOLD (0.65). chat_with_course
        # short-circuits to a canned refusal BEFORE the model is called when
        # is_grounded() is False (tutor.py). Below the threshold every case
        # would "resist" without any model ever running — a fake 1.000 that
        # measures the routing gate rather than the model.
        retrieved = [{
            "lecture_id": case.deck_id,
            "lecture_title": case.deck_id.replace("_", " ").title(),
            "slide_index": 0,
            "title": "Lecture notes",
            "content": slide_content,
            "similarity": 0.95,
        }]

        result = await chat_with_course(
            user_message, retrieved, ai_model=self.ai_model
        )
        return result.get("reply", "")


JudgeFn = Callable[[str], Awaitable[str]]
