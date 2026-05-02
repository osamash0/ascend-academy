"""Unit tests for the quiz validator and the cross-slide quiz prompt builder.

These are pure-Python tests — no LLM calls, no network. The orchestrator-side
generators (``generate_deck_quiz``, ``batch_analyze_text_slides``) are
exercised via small monkeypatches that swap the LLM call out for a recorded
response, so we can assert that:

  * a degenerate quiz triggers exactly one regeneration (and no more),
  * a valid quiz never triggers a regeneration,
  * the cross-slide prompt embeds the planner's slide indices and concepts.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import pytest

from backend.services.ai.quiz_validator import (
    coerce_linked_slides,
    validate_cross_slide_question,
    validate_mcq,
    validate_and_regenerate,
    _normalize_answer_index,
)


# ---------------------------------------------------------------------------
# validate_mcq — pure rule checks
# ---------------------------------------------------------------------------

class TestValidateMcq:
    def _good(self) -> Dict[str, Any]:
        return {
            "question": "Which property of TCP guarantees in-order delivery?",
            "options": [
                "Sliding window with sequence numbers",
                "Stateless datagrams",
                "ECN bits in the IP header",
                "Per-packet retransmission timers without ordering",
            ],
            "answer": "A",
        }

    def test_valid_question_passes(self):
        ok, reason = validate_mcq(self._good())
        assert ok is True
        assert reason == ""

    def test_accepts_integer_answer(self):
        q = self._good()
        q["answer"] = 0
        ok, _ = validate_mcq(q)
        assert ok

    def test_accepts_correctAnswer_camelcase(self):
        q = self._good()
        del q["answer"]
        q["correctAnswer"] = 0
        ok, _ = validate_mcq(q)
        assert ok

    def test_rejects_all_of_the_above(self):
        q = self._good()
        q["options"][3] = "All of the above"
        ok, reason = validate_mcq(q)
        assert ok is False
        assert "degenerate" in reason

    def test_rejects_none_of_the_above_case_insensitive(self):
        q = self._good()
        q["options"][2] = "NONE of THE Above"
        ok, _ = validate_mcq(q)
        assert ok is False

    def test_rejects_duplicate_options(self):
        q = self._good()
        q["options"][2] = q["options"][0]
        ok, reason = validate_mcq(q)
        assert ok is False
        assert "duplicate" in reason

    def test_rejects_substring_option(self):
        # The correct answer being a strict substring of a distractor is the
        # other classic LLM failure mode (e.g. "Paris" vs "Paris, France").
        q = self._good()
        q["options"] = [
            "Paris",
            "Paris, France",
            "Berlin",
            "Madrid",
        ]
        q["answer"] = "A"
        ok, reason = validate_mcq(q)
        assert ok is False
        assert "substring" in reason

    def test_rejects_wrong_option_count(self):
        q = self._good()
        q["options"] = q["options"][:3]
        ok, reason = validate_mcq(q)
        assert ok is False
        assert "4 options" in reason

    def test_rejects_empty_question(self):
        q = self._good()
        q["question"] = "   "
        ok, _ = validate_mcq(q)
        assert ok is False

    def test_rejects_missing_answer(self):
        q = self._good()
        del q["answer"]
        ok, reason = validate_mcq(q)
        assert ok is False
        assert "answer" in reason

    def test_rejects_out_of_range_answer(self):
        q = self._good()
        q["answer"] = "Z"
        ok, _ = validate_mcq(q)
        assert ok is False

    def test_rejects_non_dict(self):
        ok, _ = validate_mcq([1, 2, 3])  # type: ignore[arg-type]
        assert ok is False

    def test_normalize_handles_letter_and_int_and_text(self):
        opts = ["alpha", "beta", "gamma", "delta"]
        assert _normalize_answer_index({"options": opts, "answer": "C"}) == 2
        assert _normalize_answer_index({"options": opts, "answer": 3}) == 3
        assert _normalize_answer_index({"options": opts, "answer": "gamma"}) == 2
        assert _normalize_answer_index({"options": opts, "answer": "9"}) is None


# ---------------------------------------------------------------------------
# validate_and_regenerate — exactly-one-retry contract
# ---------------------------------------------------------------------------

class TestRegenerationContract:
    def _bad(self) -> Dict[str, Any]:
        return {
            "question": "What is X?",
            "options": ["A", "A", "B", "All of the above"],
            "answer": "D",
        }

    def _good(self) -> Dict[str, Any]:
        return {
            "question": "What is X?",
            "options": ["alpha", "beta", "gamma", "delta"],
            "answer": "A",
        }

    @pytest.mark.asyncio
    async def test_valid_question_skips_regen(self):
        calls = {"n": 0}

        async def regen():
            calls["n"] += 1
            return self._good()

        out = await validate_and_regenerate(self._good(), regen)
        assert calls["n"] == 0
        assert out["options"][0] == "alpha"

    @pytest.mark.asyncio
    async def test_invalid_triggers_exactly_one_regen(self):
        calls = {"n": 0}

        async def regen():
            calls["n"] += 1
            return self._good()

        out = await validate_and_regenerate(self._bad(), regen)
        assert calls["n"] == 1
        assert out["options"][0] == "alpha"

    @pytest.mark.asyncio
    async def test_regen_failure_returns_original(self):
        async def regen():
            raise RuntimeError("LLM unreachable")

        bad = self._bad()
        out = await validate_and_regenerate(bad, regen)
        # Falls back to the original — degraded but renderable.
        assert out is bad

    @pytest.mark.asyncio
    async def test_regen_returning_garbage_returns_original(self):
        async def regen():
            return "not a dict"  # type: ignore[return-value]

        bad = self._bad()
        out = await validate_and_regenerate(bad, regen)
        assert out is bad


# ---------------------------------------------------------------------------
# Cross-slide prompt builder + generate_deck_quiz path
# ---------------------------------------------------------------------------

def _sample_blueprint() -> Dict[str, Any]:
    return {
        "lecture_title": "TCP/IP Networking",
        "overall_summary": "A tour of layered networking.",
        "cross_slide_quiz_concepts": [
            "How TCP achieves reliability on top of best-effort IP",
            "When NAT breaks end-to-end addressing",
        ],
        "narrative_arc": [
            {
                "section_name": "Transport layer",
                "key_takeaways": [
                    "TCP uses sequence numbers and ACKs for reliability",
                    "Sliding window controls in-flight data",
                ],
            },
        ],
        "slide_plans": [
            {
                "index": 0,
                "proposed_title": "Layered model",
                "concepts": ["IP best-effort delivery"],
                "related_previous_slides": [],
            },
            {
                "index": 1,
                "proposed_title": "TCP reliability mechanisms",
                "concepts": ["TCP reliability", "Sliding window"],
                # Slide 1 builds on slide 0 — this is the kind of pair we
                # want to surface in the cross-slide prompt.
                "related_previous_slides": [0],
            },
            {
                "index": 2,
                "proposed_title": "NAT and address translation",
                "concepts": ["Address translation"],
                "related_previous_slides": [0, 1],
            },
        ],
    }


class TestCrossSlidePromptBuilder:
    def test_prompt_embeds_concepts_takeaways_and_slides(self):
        from backend.services.ai.orchestrator import _build_cross_slide_quiz_prompt
        prompt = _build_cross_slide_quiz_prompt(_sample_blueprint(), "deck summary text")

        # All three sources of pedagogical signal must reach the LLM.
        assert "How TCP achieves reliability" in prompt
        assert "sliding window" in prompt.lower()
        assert "slide 0" in prompt and "slide 2" in prompt
        assert "TCP reliability mechanisms" in prompt
        assert "deck summary text" in prompt
        # Hard requirements must also be there.
        assert "linked_slides" in prompt
        assert "all of the above" in prompt.lower()

    def test_has_cross_slide_signal_requires_concepts_and_plans(self):
        from backend.services.ai.orchestrator import _has_cross_slide_signal
        bp = _sample_blueprint()
        assert _has_cross_slide_signal(bp) is True
        assert _has_cross_slide_signal({}) is False
        assert _has_cross_slide_signal(None) is False
        # Concepts but no plans → still false (no slide indices to ground in).
        assert _has_cross_slide_signal(
            {"cross_slide_quiz_concepts": ["X"], "slide_plans": []}
        ) is False


# ---------------------------------------------------------------------------
# generate_deck_quiz: end-to-end with the LLM stubbed out
# ---------------------------------------------------------------------------

class TestGenerateDeckQuiz:
    """We patch ``generate_text`` to return a recorded JSON string and assert
    the orchestrator's bookkeeping (validation, regeneration, linked_slides
    coercion) matches the contract."""

    @pytest.mark.asyncio
    async def test_uses_cross_slide_prompt_when_blueprint_present(self, monkeypatch):
        from backend.services.ai import orchestrator

        captured = {"prompts": []}

        async def fake_generate_text(prompt: str, *_a, **_kw) -> str:
            captured["prompts"].append(prompt)
            # Return a single valid cross-slide question.
            return (
                '[{"question":"How does TCP layer on IP for reliability?",'
                ' "options":["Sequence numbers + ACKs","UDP checksums",'
                ' "ARP caching","DHCP leases"],'
                ' "answer":"A","explanation":"Slide 1 explains TCP reliability'
                ' mechanisms; slide 0 places it on top of IP.",'
                ' "linked_slides":[0,1],'
                ' "concept":"TCP reliability"}]'
            )

        monkeypatch.setattr(orchestrator, "generate_text", fake_generate_text)

        out = await orchestrator.generate_deck_quiz(
            "summary", blueprint=_sample_blueprint()
        )

        # The cross-slide prompt was used — slide map + concepts present.
        assert len(captured["prompts"]) == 1
        assert "How TCP achieves reliability" in captured["prompts"][0]
        assert "linked_slides" in captured["prompts"][0]

        assert len(out) == 1
        assert out[0]["linked_slides"] == [0, 1]
        assert out[0]["concept"] == "TCP reliability"

    @pytest.mark.asyncio
    async def test_falls_back_to_summary_prompt_without_blueprint(self, monkeypatch):
        from backend.services.ai import orchestrator

        captured = {"prompts": []}

        async def fake_generate_text(prompt: str, *_a, **_kw) -> str:
            captured["prompts"].append(prompt)
            return (
                '[{"question":"Q?","options":["w","x","y","z"],'
                ' "answer":"A","explanation":"because"}]'
            )

        monkeypatch.setattr(orchestrator, "generate_text", fake_generate_text)
        out = await orchestrator.generate_deck_quiz("just a summary", blueprint=None)

        # Legacy prompt — does NOT include the cross-slide instructions.
        assert "linked_slides" not in captured["prompts"][0]
        assert len(out) == 1
        # No linked_slides key forced when fallback prompt was used.
        assert "linked_slides" not in out[0]

    @pytest.mark.asyncio
    async def test_invalid_question_triggers_one_regeneration(self, monkeypatch):
        from backend.services.ai import orchestrator

        call_count = {"n": 0}

        async def fake_generate_text(prompt: str, *_a, **_kw) -> str:
            call_count["n"] += 1
            if call_count["n"] == 1:
                # First attempt: degenerate question (all/none of the above).
                return (
                    '[{"question":"What?","options":["x","x",'
                    ' "All of the above","y"],"answer":"A","linked_slides":[0,1]}]'
                )
            # Second attempt: clean question.
            return (
                '[{"question":"What?","options":["alpha","beta","gamma","delta"],'
                ' "answer":"B","linked_slides":[0,2],"concept":"c"}]'
            )

        monkeypatch.setattr(orchestrator, "generate_text", fake_generate_text)

        out = await orchestrator.generate_deck_quiz("s", blueprint=_sample_blueprint())

        # One degenerate + one regen = exactly two calls. No infinite loop.
        assert call_count["n"] == 2
        assert out[0]["options"] == ["alpha", "beta", "gamma", "delta"]

    @pytest.mark.asyncio
    async def test_linked_slides_are_coerced_and_deduped(self, monkeypatch):
        from backend.services.ai import orchestrator

        async def fake_generate_text(*_a, **_kw) -> str:
            # Strings, duplicates, and a negative index — all handled.
            return (
                '[{"question":"q?","options":["a","b","c","d"],"answer":"A",'
                ' "linked_slides":["1","1",2,-3,"x"],"concept":"k"}]'
            )

        monkeypatch.setattr(orchestrator, "generate_text", fake_generate_text)
        out = await orchestrator.generate_deck_quiz("s", blueprint=_sample_blueprint())
        assert out[0]["linked_slides"] == [1, 2]

    @pytest.mark.asyncio
    async def test_non_list_response_returns_empty(self, monkeypatch):
        from backend.services.ai import orchestrator

        async def fake_generate_text(*_a, **_kw) -> str:
            return '{"oops": true}'

        monkeypatch.setattr(orchestrator, "generate_text", fake_generate_text)
        out = await orchestrator.generate_deck_quiz("s", blueprint=_sample_blueprint())
        assert out == []


# ---------------------------------------------------------------------------
# validate_cross_slide_question + linked_slides cardinality contract
# ---------------------------------------------------------------------------

class TestValidateCrossSlideQuestion:
    def _good(self) -> Dict[str, Any]:
        return {
            "question": "How does TCP build reliability on top of IP?",
            "options": [
                "Sequence numbers + ACKs + retransmission",
                "Stateless datagrams",
                "ECN bits in the IP header",
                "Hop-by-hop checksums",
            ],
            "answer": "A",
            "linked_slides": [0, 1],
            "concept": "TCP reliability",
        }

    def test_passes_when_two_distinct_indices(self):
        ok, _ = validate_cross_slide_question(self._good(), valid_slide_indices={0, 1, 2})
        assert ok

    def test_rejects_single_linked_slide(self):
        q = self._good()
        q["linked_slides"] = [1]
        ok, reason = validate_cross_slide_question(q)
        assert ok is False
        assert "at least 2" in reason

    def test_rejects_duplicate_collapsing_to_one(self):
        # The contract is *distinct* slides; a list like [2, 2] is really
        # a single-slide question and must fail just like [2] does.
        q = self._good()
        q["linked_slides"] = [2, 2]
        ok, reason = validate_cross_slide_question(q)
        assert ok is False
        assert "at least 2" in reason

    def test_rejects_missing_linked_slides(self):
        q = self._good()
        del q["linked_slides"]
        ok, reason = validate_cross_slide_question(q)
        assert ok is False
        assert "linked_slides" in reason

    def test_rejects_index_outside_slide_map(self):
        q = self._good()
        q["linked_slides"] = [0, 99]
        ok, reason = validate_cross_slide_question(q, valid_slide_indices={0, 1, 2})
        assert ok is False
        assert "99" in reason

    def test_skips_index_range_check_when_slide_set_unknown(self):
        # When the caller doesn't pass a slide-index set we still require
        # >= 2 distinct entries but don't fail on out-of-range indices.
        q = self._good()
        q["linked_slides"] = [42, 99]
        ok, _ = validate_cross_slide_question(q, valid_slide_indices=None)
        assert ok

    def test_falls_through_to_mcq_failure(self):
        # An MCQ with degenerate options should fail before we even look
        # at linked_slides.
        q = self._good()
        q["options"][3] = "All of the above"
        ok, reason = validate_cross_slide_question(q, valid_slide_indices={0, 1, 2})
        assert ok is False
        assert "degenerate" in reason

    def test_coerce_linked_slides_handles_mixed_types(self):
        assert coerce_linked_slides(["1", 2, "1", -3, "x", True]) == [1, 2]
        assert coerce_linked_slides(None) == []
        assert coerce_linked_slides([]) == []


# ---------------------------------------------------------------------------
# Cross-slide prompt builder — related_previous_slides bridging
# ---------------------------------------------------------------------------

class TestCrossSlideBridges:
    def test_prompt_surfaces_related_previous_slides(self):
        from backend.services.ai.orchestrator import _build_cross_slide_quiz_prompt
        prompt = _build_cross_slide_quiz_prompt(_sample_blueprint(), "summary")

        # The bridge section must explicitly tell the model that slide 1
        # builds on slide 0 and slide 2 builds on slides 0, 1.
        assert "slide 1 builds on slide(s) 0" in prompt
        assert "slide 2 builds on slide(s) 0, 1" in prompt
        # The instruction must point the model at this section.
        assert "slide-to-prerequisite bridges" in prompt.lower()

    def test_prompt_drops_invalid_bridge_indices(self):
        from backend.services.ai.orchestrator import _build_cross_slide_quiz_prompt
        bp = _sample_blueprint()
        # Planner sometimes hallucinates bad indices; we should silently
        # filter them and not emit a bogus "slide N builds on slide -1" line.
        bp["slide_plans"][1]["related_previous_slides"] = [-1, 99, 1]  # 1 == self
        prompt = _build_cross_slide_quiz_prompt(bp, "summary")
        assert "slide -1" not in prompt
        assert "slide(s) 99" not in prompt
        # Self-reference (slide 1 → slide 1) should also be dropped.
        assert "slide 1 builds on slide(s) 1" not in prompt

    def test_prompt_handles_blueprint_without_bridges(self):
        from backend.services.ai.orchestrator import _build_cross_slide_quiz_prompt
        bp = _sample_blueprint()
        for p in bp["slide_plans"]:
            p.pop("related_previous_slides", None)
        prompt = _build_cross_slide_quiz_prompt(bp, "summary")
        assert "no explicit bridges from planner" in prompt


# ---------------------------------------------------------------------------
# Deterministic linked_slides repair after a failed regen
# ---------------------------------------------------------------------------

class TestLinkedSlidesRepair:
    @pytest.mark.asyncio
    async def test_repairs_via_concept_match_after_regen_still_fails(self, monkeypatch):
        from backend.services.ai import orchestrator

        # Both attempts return a question with only ONE linked slide, which
        # violates the cross-slide contract. The orchestrator must repair
        # deterministically rather than let the bad linked_slides through.
        async def fake_generate_text(*_a, **_kw) -> str:
            return (
                '[{"question":"How does TCP layer on IP?",'
                ' "options":["Sequence numbers + ACKs","UDP datagrams",'
                ' "Hop checksums","ARP caching"],"answer":"A",'
                ' "linked_slides":[1],"concept":"TCP reliability"}]'
            )

        monkeypatch.setattr(orchestrator, "generate_text", fake_generate_text)
        out = await orchestrator.generate_deck_quiz(
            "s", blueprint=_sample_blueprint()
        )

        # Repair should have produced >= 2 distinct slide indices, including
        # the LLM's original [1] plus one matched via the concept map (the
        # planner's slide_plans link "TCP reliability" to slide index 1; the
        # padding step then adds the lowest unused slide index).
        assert len(out) == 1
        ls = out[0]["linked_slides"]
        assert isinstance(ls, list)
        assert len(ls) >= 2
        assert len(set(ls)) == len(ls)
        # All repaired indices must be from the actual slide map.
        assert set(ls).issubset({0, 1, 2})

    @pytest.mark.asyncio
    async def test_drops_question_when_repair_impossible(self, monkeypatch):
        from backend.services.ai import orchestrator

        # Single-slide blueprint (only one valid index) — there is no way
        # to construct a >= 2 cross-slide question, so the orchestrator
        # should drop the question rather than emit an invalid one.
        bp = {
            "cross_slide_quiz_concepts": ["X"],
            "slide_plans": [{"index": 0, "proposed_title": "Only slide"}],
        }

        async def fake_generate_text(*_a, **_kw) -> str:
            return (
                '[{"question":"q?","options":["a","b","c","d"],"answer":"A",'
                ' "linked_slides":[0],"concept":"X"}]'
            )

        monkeypatch.setattr(orchestrator, "generate_text", fake_generate_text)
        out = await orchestrator.generate_deck_quiz("s", blueprint=bp)
        assert out == []


# ---------------------------------------------------------------------------
# Per-slide batched regeneration
# ---------------------------------------------------------------------------

class TestPerSlideQuizRegeneration:
    """``batch_analyze_text_slides`` should detect failing per-slide MCQs
    and re-prompt them in a single batched follow-up call (never one call
    per slide — that would defeat batching)."""

    @pytest.fixture
    def _slides(self) -> List[Dict[str, Any]]:
        return [
            {"index": 0, "page_number": 1, "text": "Slide one body about TCP."},
            {"index": 1, "page_number": 2, "text": "Slide two body about IP."},
            {"index": 2, "page_number": 3, "text": "Slide three body about NAT."},
        ]

    @pytest.mark.asyncio
    async def test_failing_slides_trigger_single_batched_regen(self, monkeypatch, _slides):
        from backend.services.ai import orchestrator

        calls: List[str] = []

        # First call returns: slide 1 OK, slide 2 BAD (all-of-the-above),
        # slide 3 BAD (duplicate options). The regen call returns clean
        # questions for the two failing slides — and crucially, only ONE
        # additional LLM call is made regardless of how many failed.
        async def fake_call_llm(fn):
            raw = fn()
            calls.append(raw)
            return raw

        first_response = (
            '['
            '{"page_number":1,"title":"S1","content":"...","summary":"",'
            '  "questions":[{"question":"What is TCP?","options":'
            '   ["Reliable","Stateless","Hop","ARP"],"answer":"A"}]},'
            '{"page_number":2,"title":"S2","content":"...","summary":"",'
            '  "questions":[{"question":"What is IP?","options":'
            '   ["x","y","z","All of the above"],"answer":"D"}]},'
            '{"page_number":3,"title":"S3","content":"...","summary":"",'
            '  "questions":[{"question":"What is NAT?","options":'
            '   ["dup","dup","b","c"],"answer":"A"}]}'
            ']'
        )
        regen_response = (
            '['
            '{"page_number":2,"questions":[{"question":"What does IP do?",'
            ' "options":["Best-effort delivery","Reliable transport",'
            ' "Encryption","Compression"],"answer":"A","explanation":"e",'
            ' "concept":"IP","cognitive_level":"recall"}]},'
            '{"page_number":3,"questions":[{"question":"What does NAT do?",'
            ' "options":["Translate addresses","Encrypt traffic",'
            ' "Compress packets","Route between AS"],"answer":"A",'
            ' "explanation":"e","concept":"NAT","cognitive_level":"recall"}]}'
            ']'
        )

        # Capture which prompts go through _generate_with_rotation.
        seen_prompts: List[str] = []
        responses = iter([first_response, regen_response])

        def fake_rotation(prompt: str, _chain: List[str]) -> str:
            seen_prompts.append(prompt)
            return next(responses)

        monkeypatch.setattr(orchestrator, "_generate_with_rotation", fake_rotation)
        # call_llm wraps the lambda; just call it.
        from backend.services import llm_client
        async def passthrough_call_llm(fn):
            return fn()
        monkeypatch.setattr(llm_client, "call_llm", passthrough_call_llm)

        out = await orchestrator.batch_analyze_text_slides(_slides)

        # Exactly two LLM calls: one for the batch, one for the regen.
        assert len(seen_prompts) == 2
        assert "REGENERATE" in seen_prompts[1].upper() or "regenerate" in seen_prompts[1].lower()

        # Slide 1 kept its original question (was already valid).
        assert out[0]["questions"][0]["question"] == "What is TCP?"
        # Slides 2 + 3 picked up the regenerated questions.
        assert "Best-effort delivery" in out[1]["questions"][0]["options"]
        assert "Translate addresses" in out[2]["questions"][0]["options"]

    @pytest.mark.asyncio
    async def test_no_regen_when_all_slides_pass(self, monkeypatch, _slides):
        from backend.services.ai import orchestrator
        from backend.services import llm_client

        seen_prompts: List[str] = []
        clean_response = (
            '['
            '{"page_number":1,"title":"S1","content":"x","summary":"",'
            '  "questions":[{"question":"q1?","options":["a","b","c","d"],"answer":"A"}]},'
            '{"page_number":2,"title":"S2","content":"x","summary":"",'
            '  "questions":[{"question":"q2?","options":["e","f","g","h"],"answer":"B"}]},'
            '{"page_number":3,"title":"S3","content":"x","summary":"",'
            '  "questions":[{"question":"q3?","options":["i","j","k","l"],"answer":"C"}]}'
            ']'
        )

        def fake_rotation(prompt: str, _chain: List[str]) -> str:
            seen_prompts.append(prompt)
            return clean_response

        async def passthrough_call_llm(fn):
            return fn()

        monkeypatch.setattr(orchestrator, "_generate_with_rotation", fake_rotation)
        monkeypatch.setattr(llm_client, "call_llm", passthrough_call_llm)

        await orchestrator.batch_analyze_text_slides(_slides)
        # Only the initial batch call — no regen needed.
        assert len(seen_prompts) == 1

    @pytest.mark.asyncio
    async def test_regen_invalid_question_still_accepted_per_contract(
        self, monkeypatch, _slides,
    ):
        """One-retry contract (matches validate_and_regenerate): when the
        regen call returns parseable JSON but the question itself still
        fails validate_mcq, accept the second attempt as-is rather than
        silently keeping the original."""
        from backend.services.ai import orchestrator
        from backend.services import llm_client

        first_response = (
            '['
            '{"page_number":1,"title":"S1","content":"x","summary":"",'
            '  "questions":[{"question":"q1?","options":'
            '   ["x","x","y","All of the above"],"answer":"A"}]},'
            '{"page_number":2,"title":"S2","content":"x","summary":"",'
            '  "questions":[{"question":"q2?","options":["a","b","c","d"],"answer":"A"}]},'
            '{"page_number":3,"title":"S3","content":"x","summary":"",'
            '  "questions":[{"question":"q3?","options":["e","f","g","h"],"answer":"B"}]}'
            ']'
        )
        # Regen returns parseable JSON but the new options for slide 1 are
        # still degenerate (duplicate "z"s).
        regen_response = (
            '['
            '{"page_number":1,"title":"S1","content":"x","summary":"",'
            '  "questions":[{"question":"q1-v2?","options":'
            '   ["z","z","w","v"],"answer":"A"}]}'
            ']'
        )
        responses = iter([first_response, regen_response])

        def fake_rotation(prompt: str, _chain: List[str]) -> str:
            return next(responses)

        async def passthrough_call_llm(fn):
            return fn()

        monkeypatch.setattr(orchestrator, "_generate_with_rotation", fake_rotation)
        monkeypatch.setattr(llm_client, "call_llm", passthrough_call_llm)

        out = await orchestrator.batch_analyze_text_slides(_slides)
        # The regen result was accepted even though it's still invalid —
        # one-retry contract takes precedence over silent fallback.
        assert out[0]["questions"][0]["question"] == "q1-v2?"
        assert out[0]["questions"][0]["options"] == ["z", "z", "w", "v"]

    @pytest.mark.asyncio
    async def test_regen_failure_keeps_original(self, monkeypatch, _slides):
        from backend.services.ai import orchestrator
        from backend.services import llm_client

        first_response = (
            '['
            '{"page_number":1,"title":"S1","content":"x","summary":"",'
            '  "questions":[{"question":"q1?","options":'
            '   ["x","x","y","All of the above"],"answer":"A"}]},'
            '{"page_number":2,"title":"S2","content":"x","summary":"",'
            '  "questions":[{"question":"q2?","options":["a","b","c","d"],"answer":"A"}]},'
            '{"page_number":3,"title":"S3","content":"x","summary":"",'
            '  "questions":[{"question":"q3?","options":["e","f","g","h"],"answer":"B"}]}'
            ']'
        )
        # Regen returns garbage — we should silently keep the original
        # (still-degenerate) question rather than error.
        responses = iter([first_response, "not even json"])

        def fake_rotation(prompt: str, _chain: List[str]) -> str:
            return next(responses)

        async def passthrough_call_llm(fn):
            return fn()

        monkeypatch.setattr(orchestrator, "_generate_with_rotation", fake_rotation)
        monkeypatch.setattr(llm_client, "call_llm", passthrough_call_llm)

        out = await orchestrator.batch_analyze_text_slides(_slides)
        # Slide 1 still has its original (bad) question — we promised one
        # retry, not perfect content.
        assert out[0]["questions"][0]["options"][0] == "x"
