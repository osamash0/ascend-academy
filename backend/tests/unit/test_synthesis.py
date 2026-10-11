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


def _letters(i: int) -> str:
    """Digits-as-letters so synthetic slides differ after normalize_line
    (which folds digit runs and would mark numbered fixtures as boilerplate)."""
    return "".join(chr(97 + int(d)) for d in str(i))


# ── analyze_lecture_meta ──────────────────────────────────────────────────────

async def test_analyze_lecture_meta_caps_prompt_at_15_slides(llm):
    llm["reply"] = json.dumps({"title": "X", "keyTopics": []})
    slides = [f"slide {_letters(i)} content text about topic {_letters(i * 7)}" for i in range(20)]
    await synthesis.analyze_lecture_meta(slides, "cerebras")
    prompt = llm["text_prompts"][0]
    assert prompt.count("[Slide ") == 15
    assert "[Slide 1]" in prompt  # the title slide is always included


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


async def test_generate_quiz_returns_grounded_questions_from_model_array(llm):
    rich = "Graphs consist of vertices and edges that model pairwise relations."
    q = {"question": "What do graphs consist of?",
         "options": ["Vertices and edges", "Rows and columns", "Keys and values", "Pages and frames"],
         "correctAnswer": "Vertices and edges", "source_slide": 2}
    llm["reply"] = json.dumps([q])
    out = await synthesis.generate_quiz_questions(["Graphs", rich], "Graphs", "cerebras")  # slide 0 is the title
    assert [o["question"] for o in out] == [q["question"]]
    assert out[0]["source_slide"] == 2 and out[0]["support_score"] == 1.0
    assert "Graphs" in llm["bulk_prompts"][0]


async def test_generate_quiz_non_list_response_returns_empty(llm):
    llm["reply"] = json.dumps({"not": "an array"})
    rich = "Graphs consist of vertices and edges that model pairwise relations."
    out = await synthesis.generate_quiz_questions(["Graphs", rich], "T", "cerebras")
    assert out == []
    assert llm["calls"] == 1  # the guard under test was actually reached


async def test_generate_quiz_caps_at_10_content_slides(llm):
    llm["reply"] = "[]"
    slides = [f"Fact {_letters(i)} states that indexes speed up lookups on large tables." for i in range(15)]
    await synthesis.generate_quiz_questions(slides, "T", "cerebras")
    prompt = llm["bulk_prompts"][0]
    assert prompt.count("[Slide ") == 10


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


# ── whole-deck sampling + real slide numbers ─────────────────────────────────

async def test_quiz_prompt_labels_slides_with_their_real_deck_numbers(llm):
    xenon = "The xenon atom has many electrons and reacts rarely with other elements."
    yttrium = "The yttrium metal is silvery and appears in rare earth mineral deposits."
    slides = ["Title", "short", xenon, "tiny", yttrium]
    llm["reply"] = "[]"
    await synthesis.generate_quiz_questions(slides, "T", "groq")
    prompt = llm["bulk_prompts"][0]
    assert "[Slide 3]: The xenon" in prompt and "[Slide 5]: The yttrium" in prompt
    assert "[Slide 1]: The xenon" not in prompt


async def test_quiz_sees_late_slides_of_a_long_deck(llm):
    tag = _letters
    slides = ["Title"] + [f"Fact {tag(i)} states that indexes speed up lookups on large tables." for i in range(40)]
    llm["reply"] = "[]"
    await synthesis.generate_quiz_questions(slides, "T", "groq")
    assert any(f"Fact {tag(i)} " in llm["bulk_prompts"][0] for i in range(30, 40))


async def test_meta_sees_slides_beyond_fifteen(llm):
    tag = _letters
    slides = ["Title"] + [
        f"1. Part {i}" if i % 10 == 0 else f"Note {tag(i)} explains how transactions keep data consistent."
        for i in range(60)
    ]
    llm["reply"] = "{}"
    await synthesis.analyze_lecture_meta(slides, "groq")
    assert "Part 50" in llm["text_prompts"][0]


async def test_meta_prompt_reads_exactly_the_deck_plan_meta_selection(llm, monkeypatch):
    llm["reply"] = "{}"
    slides = ["Title"] + [f"Note {_letters(i)} explains how transactions keep data consistent." for i in range(30)]
    monkeypatch.setattr(synthesis, "select_meta_slides", lambda sk: [0, 7, 21])
    await synthesis.analyze_lecture_meta(slides, "groq")
    prompt = llm["text_prompts"][0]
    assert prompt.count("[Slide ") == 3
    assert "[Slide 8]" in prompt and "[Slide 22]" in prompt


# Golden digests of the rendered meta prompt, captured from the inline
# selection BEFORE it moved into deck_plan.select_meta_slides (Arc 6 task 2):
# the refactor must leave the prompt byte-identical.
_META_PROMPT_GOLDEN = {
    "long_fixture": ("21ef66bfce2acd4ace9ed9da2bc4d6af4dcc0a0c830ac8c1d767f8d8e328739d", 1937),
    "sixty_one_slides": ("fc09a51aa1dcba1d280424f7fc6675944b270e9fd99c05a45e2822ec397c9781", 1461),
}


async def test_meta_prompt_is_byte_identical_to_the_pre_refactor_prompt(llm):
    import hashlib

    from backend.tests.support.deck_lab_decks import LONG_DECK

    decks = {
        "long_fixture": LONG_DECK,
        "sixty_one_slides": ["Title"] + [
            f"1. Part {i}" if i % 10 == 0 else f"Note {_letters(i)} explains how transactions keep data consistent."
            for i in range(60)
        ],
    }
    for name, deck in decks.items():
        llm["text_prompts"].clear()
        await synthesis.analyze_lecture_meta(deck, "groq")
        prompt = llm["text_prompts"][0]
        assert (hashlib.sha256(prompt.encode()).hexdigest(), len(prompt)) == _META_PROMPT_GOLDEN[name], name


# ── grounded deck quiz prompts (Arc 4) ───────────────────────────────────────

def test_deck_quiz_prompt_asks_for_source_slide_and_is_versioned():
    from backend.services.ai.prompts import PROMPT_VERSIONS, SYNTHESIS_DECK_QUIZ_PROMPT
    assert "source_slide" in SYNTHESIS_DECK_QUIZ_PROMPT
    assert "slideId" not in SYNTHESIS_DECK_QUIZ_PROMPT
    assert "Which is NOT" in SYNTHESIS_DECK_QUIZ_PROMPT  # negated questions are forbidden
    assert PROMPT_VERSIONS["SYNTHESIS_DECK_QUIZ_PROMPT"] == "v3"


def test_repair_prompt_formats_with_one_slide_and_is_versioned():
    from backend.services.ai.prompts import PROMPT_VERSIONS, SYNTHESIS_QUIZ_REPAIR_PROMPT
    out = SYNTHESIS_QUIZ_REPAIR_PROMPT.format(
        lecture_title="T", concept="C", slide_number=7, slide_text="body", output_language="German",
    )
    assert "[Slide 7]:\nbody" in out and "must be 7" in out and "German" in out
    assert out.count("[Slide ") == 1
    assert PROMPT_VERSIONS["SYNTHESIS_QUIZ_REPAIR_PROMPT"] == "v1"


async def test_rendered_deck_quiz_prompt_requests_source_slide(llm):
    llm["reply"] = "[]"
    rich = "Graphs consist of vertices and edges that model pairwise relations."
    await synthesis.generate_quiz_questions(["Graphs", rich], "T", "groq")
    assert "source_slide" in llm["bulk_prompts"][0]


# ── grounded deck quiz verifier (Arc 4) ──────────────────────────────────────
import re as _re

from backend.services.parser.quiz_grounding import SUPPORT_THRESHOLD
from backend.tests.support.quiz_grounding_deck import GRAPH_DECK_PAGES

_REPAIR_MARK = "Rewrite one multiple-choice question"


def _mcq(question, options, answer, source, concept="c"):
    return {"question": question, "options": options, "correctAnswer": answer,
            "source_slide": source, "concept": concept, "explanation": "e", "difficulty": "easy"}


GOOD = _mcq("Which algorithm computes shortest paths from a single source?",
            ["Dijkstra", "Kruskal", "Prim", "Floyd"], "Dijkstra", 3, concept="Dijkstra")
OTHER_SLIDE = _mcq("Which algorithm builds a minimum spanning tree?",
                   ["Kruskal", "Bellman", "Floyd", "Johnson"], "Kruskal", 3, concept="MST")
BAD_NUMBER = _mcq("How many colors suffice for planar maps?",
                  ["5 colors", "3 colors", "6 colors", "8 colors"], "5 colors", 5, concept="Coloring")
AMBIGUOUS = _mcq("What does an edge join?",
                 ["Two adjacent faces", "Exactly two vertices", "Three cycles", "A forest"],
                 "Two adjacent faces", 2, concept="Edges")
NO_SOURCE = {k: v for k, v in GOOD.items() if k != "source_slide"}
OUT_OF_RANGE = {**GOOD, "source_slide": 99}
GARBAGE = {**GOOD, "source_slide": "somewhere"}


def _router(first_reply, repairs=None):
    """The deck-quiz call gets ``first_reply``; a repair call gets the entry of
    ``repairs`` keyed by the [Slide N] label in its prompt (else '{}')."""
    repairs = repairs or {}

    def reply(prompt):
        if _REPAIR_MARK in prompt:
            for n, r in repairs.items():
                if f"[Slide {n}]:" in prompt:
                    return r
            return "{}"
        return first_reply
    return reply


def _repair_prompts(llm):
    return [p for p in llm["bulk_prompts"] if _REPAIR_MARK in p]


async def test_adversarial_questions_are_all_rejected_when_repairs_fail(llm):
    llm["reply"] = _router(json.dumps([GOOD, OTHER_SLIDE, BAD_NUMBER, AMBIGUOUS, NO_SOURCE, OUT_OF_RANGE, GARBAGE]))
    out = await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq")
    assert [q["question"] for q in out] == [GOOD["question"]]
    assert out[0]["source_slide"] == 3 and out[0]["support_score"] >= SUPPORT_THRESHOLD
    # One repair each for (a), (b), (c) against their cited slide; none for (d).
    labels = sorted(int(_re.search(r"\[Slide (\d+)\]:", p).group(1)) for p in _repair_prompts(llm))
    assert labels == [2, 3, 5]
    assert llm["calls"] == 1 + 3


async def test_repair_sees_only_the_cited_slide_and_a_grounded_repair_ships(llm):
    fixed = _mcq("Which algorithm requires non-negative edge weights?",
                 ["Dijkstra", "Kruskal", "Prim", "Floyd"], "Dijkstra", 3)
    llm["reply"] = _router(json.dumps([OTHER_SLIDE]), {3: json.dumps(fixed)})
    out = await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq")
    assert [q["question"] for q in out] == [fixed["question"]]
    assert out[0]["source_slide"] == 3
    (prompt,) = _repair_prompts(llm)
    assert prompt.count("[Slide ") == 1
    assert "Dijkstra computes shortest paths" in prompt
    assert "Kruskal builds" not in prompt and "University of Marburg" not in prompt


async def test_repair_that_relocates_to_another_slide_is_pinned_back_and_dropped(llm):
    moved = _mcq("Which algorithm builds a minimum spanning tree?",
                 ["Kruskal", "Bellman", "Floyd", "Johnson"], "Kruskal", 4)
    llm["reply"] = _router(json.dumps([OTHER_SLIDE]), {3: json.dumps(moved)})
    out = await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq")
    assert out == []
    assert len(_repair_prompts(llm)) == 1  # exactly one attempt, then drop


async def test_repair_exception_drops_only_that_question(llm):
    def reply(prompt):
        if _REPAIR_MARK in prompt:
            raise RuntimeError("provider down")
        return json.dumps([GOOD, OTHER_SLIDE])
    llm["reply"] = reply
    out = await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq")
    assert [q["question"] for q in out] == [GOOD["question"]]


async def test_no_shipped_question_cites_a_nonexistent_slide(llm):
    sources = [None, "somewhere", 0, -3, 7, 99, 1.5, True, [3], 1, "Slide 3", 3]
    llm["reply"] = _router(json.dumps([{**GOOD, "source_slide": s} for s in sources]),
                           {1: json.dumps({**GOOD, "source_slide": 99})})
    out = await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq")
    assert len(out) == 2
    assert all(1 <= q["source_slide"] <= len(GRAPH_DECK_PAGES) for q in out)
    assert all(q["source_slide"] == 3 for q in out)
    assert llm["calls"] == 2  # quiz + the one repair for in-range slide 1


async def test_one_structured_summary_line_per_generation(llm, caplog):
    import logging
    fixed = _mcq("Which algorithm requires non-negative edge weights?",
                 ["Dijkstra", "Kruskal", "Prim", "Floyd"], "Dijkstra", 3)
    llm["reply"] = _router(json.dumps([GOOD, OTHER_SLIDE, BAD_NUMBER, NO_SOURCE, OUT_OF_RANGE]),
                           {3: json.dumps(fixed)})
    with caplog.at_level(logging.INFO, logger=synthesis.logger.name):
        await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq")
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("deck_quiz_grounding ")]
    assert len(lines) == 1
    payload = json.loads(lines[0].split(" ", 1)[1])
    assert payload["proposed"] == 5 and payload["kept"] == 2 and payload["repaired"] == 1
    assert payload["dropped"] == 3
    assert payload["drop_reasons"] == {"no_source": 1, "source_out_of_range": 1, "repair_failed": 1}


async def test_model_array_is_capped_and_repairs_are_bounded(llm, caplog):
    import logging
    llm["reply"] = _router(json.dumps([OTHER_SLIDE] * 30))
    with caplog.at_level(logging.INFO, logger=synthesis.logger.name):
        out = await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq")
    assert out == []
    assert len(_repair_prompts(llm)) <= synthesis.MAX_DECK_QUIZ_QUESTIONS == 12
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("deck_quiz_grounding "))
    payload = json.loads(line.split(" ", 1)[1])
    assert payload["proposed"] == 30 and payload["dropped"] == 30
    assert payload["drop_reasons"]["over_cap"] == 18


async def test_repair_concurrency_is_bounded(monkeypatch):
    import asyncio
    state = {"now": 0, "peak": 0}

    async def fake(prompt, ai_model=None):
        if _REPAIR_MARK not in prompt:
            return json.dumps([OTHER_SLIDE] * 10)
        state["now"] += 1
        state["peak"] = max(state["peak"], state["now"])
        for _ in range(5):
            await asyncio.sleep(0)
        state["now"] -= 1
        return "{}"

    monkeypatch.setattr(synthesis, "generate_text_bulk", fake)
    await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq")
    assert 1 < state["peak"] <= synthesis.MAX_CONCURRENT_REPAIRS == 3


async def test_unexpected_error_drops_only_that_question(llm, monkeypatch, caplog):
    import logging
    real = synthesis.assess_grounding

    def flaky(q, skeleton, *a, **k):
        if q.get("concept") == "MST":
            raise RuntimeError("boom")
        return real(q, skeleton, *a, **k)

    monkeypatch.setattr(synthesis, "assess_grounding", flaky)
    llm["reply"] = _router(json.dumps([GOOD, OTHER_SLIDE, GOOD]))
    with caplog.at_level(logging.INFO, logger=synthesis.logger.name):
        out = await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq")
    assert [q["question"] for q in out] == [GOOD["question"]] * 2
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("deck_quiz_grounding "))
    assert json.loads(line.split(" ", 1)[1])["drop_reasons"] == {"grounding_error": 1}


async def test_grounded_question_maps_to_its_zero_based_source_slide(llm):
    llm["reply"] = _router(json.dumps([GOOD]))
    mapped = synthesis._map_deck_quiz(await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq"))
    assert mapped[0]["linked_slides"] == [2]
    assert mapped[0]["support_score"] >= SUPPORT_THRESHOLD



# ── Arc 5: grounding summary returned, not only logged ───────────────────────

async def test_grounding_summary_is_returned_through_stats(llm):
    fixed = _mcq("Which algorithm requires non-negative edge weights?",
                 ["Dijkstra", "Kruskal", "Prim", "Floyd"], "Dijkstra", 3)
    llm["reply"] = _router(json.dumps([GOOD, OTHER_SLIDE, BAD_NUMBER, NO_SOURCE, OUT_OF_RANGE]),
                           {3: json.dumps(fixed)})
    stats: dict = {}
    out = await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq", stats=stats)
    assert isinstance(out, list) and len(out) == 2
    assert stats == {
        "proposed": 5, "kept": 2, "repaired": 1, "dropped": 3,
        "drop_reasons": {"no_source": 1, "source_out_of_range": 1, "repair_failed": 1},
    }


async def test_stats_equals_the_logged_summary_line(llm, caplog):
    import logging
    llm["reply"] = _router(json.dumps([OTHER_SLIDE] * 30))
    stats: dict = {}
    with caplog.at_level(logging.INFO, logger=synthesis.logger.name):
        await synthesis.generate_quiz_questions(GRAPH_DECK_PAGES, "Graphs", "groq", stats=stats)
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("deck_quiz_grounding "))
    assert json.loads(line.split(" ", 1)[1]) == stats
    assert stats["drop_reasons"]["over_cap"] == 18


async def test_stats_untouched_when_no_quiz_is_attempted(llm):
    stats: dict = {}
    out = await synthesis.generate_quiz_questions(["short", "also short"], "T", "cerebras", stats=stats)
    assert out == [] and stats == {}
