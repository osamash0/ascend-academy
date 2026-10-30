"""Regression: a returned batch reply must never leave its slides empty.

Prod, 2026-10-30 (Softwaretechnik decks): the BATCH_SLIDE_PROMPT call for
slides 9-16 of one deck came back (2984 completion tokens) yet all 8 slides
were stored with summary='' and review_reason='empty_content', with nothing
logged; on another deck 4 slides were logged "missing from batch response —
using fallback" and still stored empty. Two holes in the mapping:

* A reply with as many items as slides was aligned by POSITION without
  checking the items carried a summary, so slide-shaped-but-wrong items
  (here: the keys came back translated) became 8 silent empty slides.
* A slide missing from the reply got a fallback row with summary="", and
  ``unified_orchestrator._synthesize_text_slide_batch`` only retried indices
  ABSENT from the result, so that row was stored as if it were content.

``batch_slide_reply_git_branching.json`` is a real gpt-4o-mini reply to the
prod prompt shape for 3.pdf slides 9-16 (content trimmed); prod does not keep
raw replies, so the failing shapes are derived from it.
"""
from __future__ import annotations

import copy
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List

import pytest

from backend.services.ai import orchestrator
from backend.services.ai.call_context import llm_call_scope
from backend.services.parser import unified_orchestrator as uo

RECORDED = json.loads(
    (Path(__file__).parents[1] / "support" / "recorded" / "batch_slide_reply_git_branching.json")
    .read_text(encoding="utf-8")
)
FIRST_INDEX = 8  # page_number 9 in the recorded reply is slide index 8
SLIDE_TEXT = "Git Branches: einen neuen Branch anlegen, wechseln und integrieren."


def _slides() -> List[Dict[str, Any]]:
    return [
        {"index": FIRST_INDEX + k, "page_number": FIRST_INDEX + k + 1, "text": f"{SLIDE_TEXT} ({k})"}
        for k in range(8)
    ]


def _reply(items: List[Dict[str, Any]]) -> str:
    return json.dumps({"slides": items}, ensure_ascii=False)


def _recorded_items() -> List[Dict[str, Any]]:
    return copy.deepcopy(RECORDED["slides"])


@pytest.fixture
def llm(monkeypatch):
    """Serve queued raw replies to every BULK call; record the prompts."""
    state: Dict[str, Any] = {"replies": [], "prompts": []}

    async def _noop(*_a, **_k):
        return None

    async def fake_call_llm(fn, timeout_seconds=None):
        return fn()

    def fake_rotation(prompt, chain, preferred=None, **_kw):
        state["prompts"].append(prompt)
        if not state["replies"]:
            raise AssertionError("unexpected extra LLM call")
        return state["replies"].pop(0), "openai", "gpt-4o-mini", None

    import backend.services.llm_client as llm_client

    monkeypatch.setattr(orchestrator, "_account_for_call", _noop)
    monkeypatch.setattr(orchestrator, "enforce_llm_budget", _noop)
    monkeypatch.setattr(orchestrator._rotator, "refresh_from_redis", _noop)
    monkeypatch.setattr(orchestrator, "_regenerate_failing_slide_quizzes", _noop)
    monkeypatch.setattr(orchestrator, "_generate_with_rotation", fake_rotation)
    monkeypatch.setattr(llm_client, "call_llm", fake_call_llm)
    return state


def _asked_pages(prompt: str) -> List[int]:
    return [int(n) for n in re.findall(r"=== SLIDE (\d+) \(index=", prompt)]


async def test_recorded_reply_fills_every_slide(llm):
    llm["replies"] = [_reply(_recorded_items())]

    results = await orchestrator.batch_analyze_text_slides(_slides(), source_language="de")

    assert [r["index"] for r in results] == list(range(FIRST_INDEX, FIRST_INDEX + 8))
    assert all(r["summary"] for r in results)
    assert not any(r.get("missing_from_batch") for r in results)
    assert len(llm["prompts"]) == 1


async def test_reply_without_summaries_is_not_trusted_by_position(llm):
    """The 3.pdf shape: 8 items, so the old code aligned them by position,
    but none carries a usable summary. Raise so the caller retries per slide
    instead of storing 8 empty slides without a word in the log."""
    items = [
        {"Seitennummer": it["page_number"], "Titel": it["title"], "Zusammenfassung": it["summary"]}
        for it in _recorded_items()
    ]
    llm["replies"] = [_reply(items)]

    with pytest.raises(ValueError, match="unusable"):
        await orchestrator.batch_analyze_text_slides(_slides(), source_language="de")


async def test_slides_missing_from_reply_are_retried_as_a_smaller_batch(llm, caplog):
    """The 4.pdf shape: the reply covers half the batch. The missing half is
    asked again (and only that half), and every slide ends up with content."""
    items = _recorded_items()
    llm["replies"] = [_reply(items[:4]), _reply(items[4:])]

    with caplog.at_level(logging.WARNING), llm_call_scope(run_id="run-4pdf"):
        results = await orchestrator.batch_analyze_text_slides(_slides(), source_language="de")

    assert len(llm["prompts"]) == 2
    assert _asked_pages(llm["prompts"][1]) == [13, 14, 15, 16]
    assert [r["index"] for r in results] == list(range(FIRST_INDEX, FIRST_INDEX + 8))
    assert all(r["summary"] for r in results)
    assert not any(r.get("missing_from_batch") for r in results)
    assert any("run-4pdf" in rec.getMessage() for rec in caplog.records)


async def test_item_with_empty_summary_counts_as_missing(llm):
    items = _recorded_items()
    blank = copy.deepcopy(items[3])
    blank["summary"] = ""
    llm["replies"] = [_reply(items[:3] + [blank] + items[4:]), _reply([items[3]])]

    results = await orchestrator.batch_analyze_text_slides(_slides(), source_language="de")

    assert _asked_pages(llm["prompts"][1]) == [12]
    assert all(r["summary"] for r in results)


async def test_slides_still_missing_after_retry_are_flagged(llm, caplog):
    items = _recorded_items()
    llm["replies"] = [_reply(items[:4]), _reply([])]

    with caplog.at_level(logging.WARNING), llm_call_scope(run_id="run-flag"):
        results = await orchestrator.batch_analyze_text_slides(_slides(), source_language="de")

    flagged = [r["index"] for r in results if r.get("missing_from_batch")]
    assert flagged == [12, 13, 14, 15]
    assert all(r["summary"] for r in results if not r.get("missing_from_batch"))
    assert any(
        "run-flag" in rec.getMessage() and rec.levelno == logging.WARNING
        for rec in caplog.records
    )


async def test_page_number_as_string_or_index_key_still_maps(llm):
    items = _recorded_items()
    for k, it in enumerate(items):
        if k % 2:
            it["page_number"] = str(it["page_number"])
        else:
            it["index"] = FIRST_INDEX + k
            del it["page_number"]
    llm["replies"] = [_reply(items)]

    results = await orchestrator.batch_analyze_text_slides(_slides(), source_language="de")

    by_index = {r["index"]: r for r in results}
    for k, it in enumerate(_recorded_items()):
        assert by_index[FIRST_INDEX + k]["summary"] == it["summary"]


async def test_wrong_page_numbers_do_not_cross_wire_slides(llm):
    """Items are matched by their page number, never by list position, when
    they carry one: a reply in reverse order still lands on the right slides."""
    llm["replies"] = [_reply(list(reversed(_recorded_items())))]

    results = await orchestrator.batch_analyze_text_slides(_slides(), source_language="de")

    by_index = {r["index"]: r for r in results}
    for k, it in enumerate(_recorded_items()):
        assert by_index[FIRST_INDEX + k]["title"] == it["title"]


async def test_unified_batch_helper_retries_flagged_slides_per_slide(llm, monkeypatch):
    """End to end through the unified parse's batch helper: the reply drops
    half the slides twice, and the per-slide path fills exactly those."""
    items = _recorded_items()
    llm["replies"] = [_reply(items[:4]), _reply([])]
    per_slide: List[int] = []

    async def fake_synth(idx, text, ctx, model, pdf, source_language="en"):
        per_slide.append(idx)
        return {"title": f"T{idx}", "content": text, "summary": f"Zusammenfassung {idx}",
                "slide_type": "text", "vision_routed": False}

    monkeypatch.setattr(uo, "_synthesize_slide", fake_synth)
    text_items = [(s["index"], s["text"]) for s in _slides()]

    out = await uo._synthesize_text_slide_batch(text_items, "Kontext", "openai", b"", {}, "de")

    assert sorted(per_slide) == [12, 13, 14, 15]
    assert sorted(out) == list(range(FIRST_INDEX, FIRST_INDEX + 8))
    assert all(out[i]["summary"] for i in out)
    assert [out[i]["route"] for i in range(8, 12)] == ["batch"] * 4
