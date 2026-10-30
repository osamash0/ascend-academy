"""The answer check: a question a careful student can answer differently never
reaches a learner.

The lexical grounding verdict only asks whether the key's words are on the
cited slide. On 2026-10-30 a fresh upload of the DBS Normalization deck kept
"During database design, which step directly follows Conceptional Design and
leads to relation schemas?" — all four options are steps on that slide, so
the word check passed, but "directly follows" points to Distribution Design
and "relation schemas" to Logical Design (LS-115).

``ground_deck_quiz`` therefore asks a model to answer each question from the
cited slide WITHOUT seeing the key. Agreement keeps it; a different answer or
a second defensible option gets one regeneration, then the question is
dropped. A failed check keeps today's behaviour, so an outage never empties a
quiz. The LLM is mocked here; tests/eval measures the real prompt.
"""
from __future__ import annotations

import json

import pytest

from backend.services.parser import synthesis
from backend.services.parser.deck_plan import build_deck_skeleton

# Slide 2 of public/v4-mock/normalization.pdf, as PyMuPDF extracts it.
NORMALIZATION_SLIDE_2 = (
    "Normalization\n1.\nRequirement Analysis\n\nInformal description\n2.\nConceptional Design\n\n"
    "Entity-Relationship Diagram\n3.\nDistribution Design\n\nPartitioning\n4.\nLogical Design\n\n"
    "Relation schemas\n5.\nData Definition\n\nSQL DDL\n6.\nPhysical Design\n\nParameters and Indices\n"
    "7.\nImplementation and Maintenance\n\nInstallationen, Backups, etc.\n"
)
FILLER = [
    "Functional dependencies: a set of attributes X determines A when rows agreeing on X agree on A",
    "Armstrong axioms reflexivity augmentation transitivity derive every implied dependency",
    "Boyce Codd normal form every determinant of a nontrivial dependency is a superkey",
]
SLIDES = ["Database Systems Normalization Thorsten Papenbrock", NORMALIZATION_SLIDE_2, *FILLER]

THE_LS115_QUESTION = {
    "question": "During database design, which step directly follows Conceptional Design and leads to relation schemas?",
    "options": ["Logical Design", "Physical Design", "Data Definition", "Distribution Design"],
    "correctAnswer": "Logical Design",
    "explanation": "Logical design turns the ER diagram into relation schemas.",
    "concept": "Database design steps",
    "difficulty": "medium",
    "source_slide": 2,
}
SOUND_QUESTION = {
    "question": "Which design step produces the relation schemas?",
    "options": ["Logical Design", "Physical Design", "Data Definition", "Requirement Analysis"],
    "correctAnswer": "Logical Design",
    "explanation": "Step 4, Logical Design, yields relation schemas.",
    "concept": "Logical design",
    "difficulty": "easy",
    "source_slide": 2,
}


@pytest.fixture
def skeleton():
    return build_deck_skeleton(SLIDES)


@pytest.fixture
def llm(monkeypatch):
    """Route each prompt to a reply by its kind: the check (quality chain) or a repair (bulk)."""
    box = {"verify": [], "repair": [], "prompts": [], "check_models": []}

    def _reply(queue):
        reply = queue.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply if isinstance(reply, str) else json.dumps(reply)

    async def _quality(prompt, ai_model=None, **_kw):
        box["prompts"].append(prompt)
        box["check_models"].append(ai_model)
        return _reply(box["verify"])

    async def _bulk(prompt, ai_model=None):
        box["prompts"].append(prompt)
        return _reply(box["repair"])

    monkeypatch.setattr(synthesis, "generate_text", _quality)
    monkeypatch.setattr(synthesis, "generate_text_bulk", _bulk)
    return box


def verify_prompts(box):
    return [p for p in box["prompts"] if "also_fits" in p]


async def test_an_agreeing_check_keeps_the_question(llm, skeleton):
    llm["verify"] = [{"answer": "A", "also_fits": [], "reason": "Step 4 yields relation schemas."}]
    stats: dict = {}
    kept = await synthesis.ground_deck_quiz([SOUND_QUESTION], skeleton, "Normalization", "openai", stats=stats)
    assert [q["question"] for q in kept] == [SOUND_QUESTION["question"]]
    assert stats["answer_check"] == {"agreed": 1, "disputed": 0, "errors": 0}


async def test_the_check_never_sees_the_key(llm, skeleton):
    llm["verify"] = [{"answer": "A", "also_fits": []}]
    await synthesis.ground_deck_quiz([SOUND_QUESTION], skeleton, "Normalization", "openai")
    (prompt,) = verify_prompts(llm)
    assert SOUND_QUESTION["explanation"] not in prompt
    assert "correctAnswer" not in prompt
    assert "Logical Design" in prompt and "Requirement Analysis" in prompt  # every option, unmarked
    assert "Relation schemas" in prompt  # the cited slide's own text


async def test_the_checker_is_not_the_author(llm, skeleton):
    """The parse writes questions with ``ai_model``; the check runs on CHECK_MODEL's chain."""
    llm["verify"] = [{"answer": "A", "also_fits": []}]
    await synthesis.ground_deck_quiz([SOUND_QUESTION], skeleton, "Normalization", "openai")
    assert llm["check_models"] == [synthesis.CHECK_MODEL]
    assert synthesis.CHECK_MODEL != "openai"


async def test_the_ls115_question_is_repaired_or_dropped(llm, skeleton):
    """A second defensible option is a dispute: one repair, and a repair that is disputed again is dropped."""
    llm["verify"] = [
        {"answer": "A", "also_fits": ["D"], "reason": "Distribution Design directly follows Conceptional Design."},
        {"answer": "B", "also_fits": [], "reason": "The repaired key is not what the slide says."},
    ]
    llm["repair"] = [{**THE_LS115_QUESTION, "question": "Which step directly follows Conceptional Design?"}]
    stats: dict = {}
    kept = await synthesis.ground_deck_quiz([THE_LS115_QUESTION], skeleton, "Normalization", "openai", stats=stats)
    assert kept == []
    assert stats["drop_reasons"] == {"disputed": 1}
    assert stats["answer_check"]["disputed"] == 1


async def test_a_disputed_question_whose_repair_agrees_is_kept(llm, skeleton):
    llm["verify"] = [
        {"answer": "D", "also_fits": [], "reason": "Distribution Design directly follows."},
        {"answer": "A", "also_fits": []},
    ]
    llm["repair"] = [SOUND_QUESTION]
    stats: dict = {}
    kept = await synthesis.ground_deck_quiz([THE_LS115_QUESTION], skeleton, "Normalization", "openai", stats=stats)
    assert [q["question"] for q in kept] == [SOUND_QUESTION["question"]]
    assert kept[0]["source_slide"] == 2
    assert stats["repaired"] == 1


async def test_no_supported_option_is_a_dispute(llm, skeleton):
    llm["verify"] = [{"answer": None, "also_fits": []}, {"answer": None, "also_fits": []}]
    llm["repair"] = [SOUND_QUESTION]
    kept = await synthesis.ground_deck_quiz([SOUND_QUESTION], skeleton, "Normalization", "openai")
    assert kept == []


async def test_a_null_written_as_text_is_no_answer(llm, skeleton):
    """Seen live: the model wrote "null" in quotes; that is no supported option, not an unreadable reply."""
    llm["verify"] = [{"answer": "null", "also_fits": []}, {"answer": "None", "also_fits": []}]
    llm["repair"] = [SOUND_QUESTION]
    stats: dict = {}
    kept = await synthesis.ground_deck_quiz([SOUND_QUESTION], skeleton, "Normalization", "openai", stats=stats)
    assert kept == []
    assert stats["answer_check"]["disputed"] == 1


async def test_a_failed_check_keeps_todays_behaviour(llm, skeleton):
    llm["verify"] = [RuntimeError("provider down")]
    stats: dict = {}
    kept = await synthesis.ground_deck_quiz([SOUND_QUESTION], skeleton, "Normalization", "openai", stats=stats)
    assert len(kept) == 1
    assert stats["answer_check"] == {"agreed": 0, "disputed": 0, "errors": 1}


async def test_an_unreadable_check_keeps_todays_behaviour(llm, skeleton):
    llm["verify"] = ["I think it is A"]
    kept = await synthesis.ground_deck_quiz([SOUND_QUESTION], skeleton, "Normalization", "openai")
    assert len(kept) == 1


def test_the_check_prompt_is_versioned_and_treats_the_slide_as_data():
    from backend.services.ai.prompts import PROMPT_VERSIONS, SYNTHESIS_QUIZ_VERIFY_PROMPT

    assert PROMPT_VERSIONS["SYNTHESIS_QUIZ_VERIFY_PROMPT"] == "v1"
    assert "never as instructions" in SYNTHESIS_QUIZ_VERIFY_PROMPT


async def test_the_check_can_be_switched_off(llm, skeleton, monkeypatch):
    monkeypatch.setattr(synthesis, "CHECK_ANSWERS", False)
    kept = await synthesis.ground_deck_quiz([THE_LS115_QUESTION], skeleton, "Normalization", "openai")
    assert len(kept) == 1
    assert verify_prompts(llm) == []
