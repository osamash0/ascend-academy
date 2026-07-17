"""Unit tests for backend.services.parser.synthesis.

These are the content-generation primitives the unified pipeline calls. The LLM
is mocked at its boundary (``synthesis.generate_text`` / ``generate_text_bulk``)
so no model runs; ``parse_json_response`` and ``with_voice`` run for real. We
assert how the code ASSEMBLES prompts and HANDLES the model's response —
well-formed, malformed, wrong-typed — never the model's content.
"""
from __future__ import annotations

import json

import pytest

from backend.services.parser import synthesis


@pytest.fixture
def llm(monkeypatch):
    """Capture prompts and drive canned raw model output for both LLM entry
    points synthesis uses. Set ``box['reply']`` (str or callable(prompt)->str)."""
    box: dict = {"reply": "{}", "text_prompts": [], "bulk_prompts": [], "calls": 0}

    async def _gen_text(prompt, ai_model=None):
        box["text_prompts"].append(prompt)
        box["calls"] += 1
        r = box["reply"]
        return r(prompt) if callable(r) else r

    async def _gen_bulk(prompt, ai_model=None):
        box["bulk_prompts"].append(prompt)
        box["calls"] += 1
        r = box["reply"]
        return r(prompt) if callable(r) else r

    monkeypatch.setattr(synthesis, "generate_text", _gen_text)
    monkeypatch.setattr(synthesis, "generate_text_bulk", _gen_bulk)
    return box


# ── analyze_lecture_meta ──────────────────────────────────────────────────────

async def test_analyze_lecture_meta_limits_to_first_15_slides(llm):
    llm["reply"] = json.dumps({"title": "X", "keyTopics": []})
    slides = [f"slide {i} content text" for i in range(20)]
    await synthesis.analyze_lecture_meta(slides, "cerebras")
    prompt = llm["text_prompts"][0]
    assert "[Slide 15]" in prompt
    assert "[Slide 16]" not in prompt


async def test_analyze_lecture_meta_appends_course_hint_only_when_present(llm):
    llm["reply"] = "{}"
    await synthesis.analyze_lecture_meta(["a b c"], "cerebras")
    assert "already covers" not in llm["text_prompts"][0]

    await synthesis.analyze_lecture_meta(["a b c"], "cerebras", course_context_hint="Graphs; Trees")
    assert "already covers" in llm["text_prompts"][1]
    assert "Graphs; Trees" in llm["text_prompts"][1]


async def test_analyze_lecture_meta_returns_parsed_dict(llm):
    llm["reply"] = json.dumps({"title": "Intro", "subject": "CS"})
    out = await synthesis.analyze_lecture_meta(["content"], "cerebras")
    assert out["title"] == "Intro"
    assert out["subject"] == "CS"


async def test_analyze_lecture_meta_garbage_returns_empty_dict(llm):
    llm["reply"] = "the model rambled without any json"
    out = await synthesis.analyze_lecture_meta(["content"], "cerebras")
    assert out == {}


# ── analyze_slide ─────────────────────────────────────────────────────────────

async def test_analyze_slide_sets_zero_based_index_and_content(llm):
    llm["reply"] = json.dumps({"title": "T", "aiInsight": "insight"})
    res = await synthesis.analyze_slide(3, "raw slide text", "ctx", "cerebras")
    assert res["slide_index"] == 2          # 1-based slide_number → 0-based
    assert res["content"] == "raw slide text"


async def test_analyze_slide_embeds_context_and_text_in_prompt(llm):
    llm["reply"] = "{}"
    await synthesis.analyze_slide(1, "photosynthesis basics", "Biology lecture", "cerebras")
    prompt = llm["bulk_prompts"][0]
    assert "photosynthesis basics" in prompt
    assert "Biology lecture" in prompt


async def test_analyze_slide_non_dict_response_becomes_empty_dict(llm):
    # Model returns a JSON array — not a slide dict.
    llm["reply"] = json.dumps([1, 2, 3])
    res = await synthesis.analyze_slide(1, "text here", "ctx", "cerebras")
    assert res["slide_index"] == 0
    assert res["content"] == "text here"


async def test_analyze_slide_empty_text_falls_back_to_insight(llm):
    llm["reply"] = json.dumps({"aiInsight": "the takeaway", "title": "T"})
    res = await synthesis.analyze_slide(1, "   ", "ctx", "cerebras")
    assert res["content"] == "the takeaway"


async def test_analyze_slide_empty_text_and_empty_model_uses_placeholder(llm):
    llm["reply"] = "garbage no json"
    res = await synthesis.analyze_slide(1, "", "ctx", "cerebras")
    assert res["content"] == "No extractable text."


# ── generate_quiz_questions ──────────────────────────────────────────────────

async def test_generate_quiz_skips_llm_when_no_rich_slides(llm):
    # Every slide is <= 50 chars → no content slides → [] and NO LLM call.
    out = await synthesis.generate_quiz_questions(["short", "also short"], "T", "cerebras")
    assert out == []
    assert llm["calls"] == 0


async def test_generate_quiz_returns_list_when_model_returns_array(llm):
    q = {"question": "Q?", "options": ["a", "b", "c", "d"], "correctAnswer": "a"}
    llm["reply"] = json.dumps([q])
    rich = "x" * 60
    out = await synthesis.generate_quiz_questions([rich], "Graphs", "cerebras")
    assert out == [q]
    assert "Graphs" in llm["bulk_prompts"][0]


async def test_generate_quiz_non_list_response_returns_empty(llm):
    llm["reply"] = json.dumps({"not": "an array"})
    out = await synthesis.generate_quiz_questions(["x" * 60], "T", "cerebras")
    assert out == []


async def test_generate_quiz_caps_at_10_content_slides(llm):
    llm["reply"] = "[]"
    slides = ["x" * 60 for _ in range(15)]
    await synthesis.generate_quiz_questions(slides, "T", "cerebras")
    prompt = llm["bulk_prompts"][0]
    assert "[Slide 10]" in prompt
    assert "[Slide 11]" not in prompt


# ── generate_cross_lecture_questions ─────────────────────────────────────────

async def test_cross_lecture_no_candidates_skips_llm(llm):
    prior = [{"id": "l1", "title": "One", "top_concept": ""}]  # no usable concept
    out = await synthesis.generate_cross_lecture_questions("Cur", prior, "cerebras")
    assert out == []
    assert llm["calls"] == 0


async def test_cross_lecture_tags_source_and_drops_unknown_concept(llm):
    prior = [{"id": "l1", "title": "Lecture One", "top_concept": "Hashing"}]
    reply = [
        {"question": "Q1", "options": ["a", "b", "c", "d"],
         "correctAnswer": "a", "source_concept": "Hashing"},
        {"question": "Q2", "options": ["a", "b", "c", "d"],
         "correctAnswer": "b", "source_concept": "Unknown"},   # dropped: no match
        "not a dict",                                            # dropped: not a dict
    ]
    llm["reply"] = json.dumps(reply)
    out = await synthesis.generate_cross_lecture_questions("Current", prior, "cerebras")
    assert len(out) == 1
    assert out[0]["_source_lecture_id"] == "l1"
    assert out[0]["_source_lecture_title"] == "Lecture One"


async def test_cross_lecture_llm_exception_returns_empty(monkeypatch):
    async def _boom(*a, **k):
        raise RuntimeError("llm down")

    monkeypatch.setattr(synthesis, "generate_text_bulk", _boom)
    prior = [{"id": "l1", "title": "One", "top_concept": "Trees"}]
    out = await synthesis.generate_cross_lecture_questions("Cur", prior, "cerebras")
    assert out == []


async def test_cross_lecture_non_list_response_returns_empty(llm):
    llm["reply"] = json.dumps({"foo": "bar"})
    prior = [{"id": "l1", "title": "One", "top_concept": "Trees"}]
    out = await synthesis.generate_cross_lecture_questions("Cur", prior, "cerebras")
    assert out == []


async def test_cross_lecture_caps_candidates_at_two(llm):
    llm["reply"] = "[]"
    prior = [
        {"id": f"l{i}", "title": f"L{i}", "top_concept": f"C{i}"} for i in range(5)
    ]
    await synthesis.generate_cross_lecture_questions("Cur", prior, "cerebras")
    prompt = llm["bulk_prompts"][0]
    assert "C0" in prompt and "C1" in prompt
    assert "C2" not in prompt  # only first 2 candidates used


# ── _map_cross_lecture_quiz ──────────────────────────────────────────────────

def test_map_cross_lecture_resolves_and_carries_source_tags():
    q = {
        "question": "Q?",
        "options": ["alpha", "beta", "gamma", "delta"], "correctAnswer": "gamma",
        "explanation": "because", "source_concept": "Hashing",
        "_source_lecture_id": "l1", "_source_lecture_title": "One",
    }
    out = synthesis._map_cross_lecture_quiz([q])
    assert len(out) == 1
    assert out[0]["correctAnswer"] == 2           # index of "gamma"
    assert out[0]["concept"] == "Hashing"
    assert out[0]["source_lecture_id"] == "l1"
    assert out[0]["linked_slides"] == [0]


def test_map_cross_lecture_drops_unresolvable_answer():
    q = {"question": "Q?", "options": ["a", "b", "c", "d"], "correctAnswer": "ZZZ"}
    assert synthesis._map_cross_lecture_quiz([q]) == []


# ── extract_syllabus_facts ───────────────────────────────────────────────────

async def test_extract_syllabus_facts_returns_dict(llm):
    llm["reply"] = json.dumps({"instructor": "Dr. Smith", "exam_dates": []})
    out = await synthesis.extract_syllabus_facts("Instructor: Dr. Smith", "cerebras")
    assert out["instructor"] == "Dr. Smith"


async def test_extract_syllabus_facts_non_dict_returns_empty(llm):
    llm["reply"] = json.dumps(["a", "list"])
    out = await synthesis.extract_syllabus_facts("text", "cerebras")
    assert out == {}


async def test_extract_syllabus_facts_exception_returns_empty(monkeypatch):
    async def _boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(synthesis, "generate_text", _boom)
    out = await synthesis.extract_syllabus_facts("text", "cerebras")
    assert out == {}
