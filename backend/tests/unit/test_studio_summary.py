from __future__ import annotations

import asyncio
import json

import pytest

from backend.services.parser import studio_summary as ss


def _pb(page: int, texts: list[str], footer: str | None = None) -> dict:
    blocks = [{"id": f"p{page}-b{i}", "page": page, "bbox": [0.1, 0.1 + i * 0.1, 0.9, 0.15 + i * 0.1],
               "kind": "paragraph", "text": t, "readingOrder": i} for i, t in enumerate(texts)]
    footers = []
    if footer:
        fid = f"p{page}-b{len(texts)}"
        blocks.append({"id": fid, "page": page, "bbox": [0.1, 0.95, 0.9, 0.98], "kind": "paragraph",
                       "text": footer, "readingOrder": len(texts)})
        footers.append(fid)
    return {"width": 720, "height": 405, "blocks": blocks,
            "markdown": {b["id"]: b["text"] for b in blocks}, "footers": footers,
            "text_chars": sum(len(t) for t in texts)}


def test_prompt_marks_blocks_and_leaves_footers_out(monkeypatch):
    seen = {}

    async def fake(prompt, ai_model, **kw):
        seen["prompt"], seen["kw"] = prompt, kw
        return json.dumps({"pages": [{"page": 2, "paragraphs": [{"markdown": "A **key** idea.", "covers": ["p2-b0"]}]}]})

    monkeypatch.setattr(ss, "generate_text_bulk", fake)
    out = asyncio.run(ss.summarize_text_pages(
        [(2, _pb(2, ["Every determinant is a key."], footer="Papenbrock 2024"))],
        lecture_title="Normalization", ai_model="openai", source_language="en"))
    assert "[p2-b0] Every determinant is a key." in seen["prompt"]
    assert "Papenbrock 2024" not in seen["prompt"]
    assert seen["kw"]["json_mode"] is True
    assert seen["kw"]["prompt_name"] == "studio_summary"
    assert out == {2: [{"markdown": "A **key** idea.", "covers": ["p2-b0"]}]}


def test_unknown_and_footer_covers_are_dropped():
    allowed = {"p2-b0", "p2-b1"}
    raw = [{"markdown": "One.", "covers": ["p2-b0", "p9-b9", "p2-b1", "p2-b0"]}]
    assert ss.clean_paragraphs(raw, allowed) == [{"markdown": "One.", "covers": ["p2-b0", "p2-b1"]}]


def test_paragraphs_are_capped_at_three_and_blank_ones_dropped():
    raw = [{"markdown": f"P{i}.", "covers": []} for i in range(5)] + [{"markdown": "  ", "covers": []}]
    assert [p["markdown"] for p in ss.clean_paragraphs(raw, set())] == ["P0.", "P1.", "P2."]


def test_garbage_gives_no_paragraphs():
    assert ss.clean_paragraphs("nope", set()) == []
    assert ss.clean_paragraphs([{"covers": ["x"]}], {"x"}) == []


def test_batches_of_eight(monkeypatch):
    calls = []

    async def fake(prompt, ai_model, **kw):
        nums = [int(line.split()[1]) for line in prompt.splitlines() if line.startswith("PAGE ")]
        calls.append(nums)
        return json.dumps({"pages": [{"page": n, "paragraphs": [{"markdown": f"S{n}.", "covers": []}]} for n in nums]})

    monkeypatch.setattr(ss, "generate_text_bulk", fake)
    pages = [(n, _pb(n, [f"Text of page {n} long enough."])) for n in range(1, 18)]
    out = asyncio.run(ss.summarize_text_pages(pages, lecture_title="T", ai_model="openai", source_language="en"))
    assert [len(c) for c in calls] == [8, 8, 1]
    assert sorted(out) == list(range(1, 18))


def test_a_failed_batch_leaves_its_pages_out(monkeypatch):
    async def fake(prompt, ai_model, **kw):
        if "PAGE 1\n" in prompt:
            raise RuntimeError("provider down")
        return json.dumps({"pages": [{"page": 9, "paragraphs": [{"markdown": "Nine.", "covers": []}]}]})

    monkeypatch.setattr(ss, "generate_text_bulk", fake)
    pages = [(n, _pb(n, [f"Page {n} text here."])) for n in range(1, 10)]
    out = asyncio.run(ss.summarize_text_pages(pages, lecture_title="T", ai_model="openai", source_language="en"))
    assert out == {9: [{"markdown": "Nine.", "covers": []}]}


def test_string_page_numbers_are_coerced(monkeypatch):
    async def fake(prompt, ai_model, **kw):
        return json.dumps({"pages": [{"page": "2", "paragraphs": [{"markdown": "ok", "covers": ["p2-b0"]}]},
                                     {"page": "x", "paragraphs": [{"markdown": "no", "covers": []}]}]})

    monkeypatch.setattr(ss, "generate_text_bulk", fake)
    out = asyncio.run(ss._batch([(2, _pb(2, ["Hello"]))], "T", "m", "English"))
    assert list(out) == [2]


def test_summary_batches_overlap(monkeypatch):
    """A 100+ page deck must not pay one provider round-trip per batch in
    series (the 900 s job timeout): batches run concurrently, at most 3."""
    import time

    live, peak = [0], [0]

    async def slow(prompt, ai_model, **kw):
        live[0] += 1
        peak[0] = max(peak[0], live[0])
        await asyncio.sleep(0.2)
        live[0] -= 1
        nums = [int(line.split()[1]) for line in prompt.splitlines() if line.startswith("PAGE ")]
        return json.dumps({"pages": [{"page": n, "paragraphs": [{"markdown": f"S{n}.", "covers": []}]} for n in nums]})

    monkeypatch.setattr(ss, "generate_text_bulk", slow)
    pages = [(n, _pb(n, [f"Text of page {n}."])) for n in range(1, 49)]  # 6 batches
    t0 = time.perf_counter()
    out = asyncio.run(ss.summarize_text_pages(pages, lecture_title="T", ai_model="openai", source_language="en"))
    elapsed = time.perf_counter() - t0
    assert sorted(out) == list(range(1, 49))
    assert elapsed < 0.2 * 6 * 0.6, f"serial would be 1.2 s, took {elapsed:.2f} s"
    assert peak[0] == ss.STUDIO_CONCURRENCY == 3


def test_bold_terms_are_capped_at_five_per_page():
    terms = [f"term{i}" for i in range(12)]
    raw = [
        {"markdown": " ".join(f"**{t}**" for t in terms[:6]) + " and **TERM0** again.", "covers": []},
        {"markdown": " ".join(f"**{t}**" for t in terms[6:]) + ".", "covers": []},
    ]
    out = ss.clean_paragraphs(raw, set())
    md = " ".join(p["markdown"] for p in out)
    import re

    bold = re.findall(r"\*\*(.+?)\*\*", md)
    assert len({b.lower() for b in bold}) == ss.MAX_BOLD_PER_PAGE == 5
    assert {b.lower() for b in bold} == {"term0", "term1", "term2", "term3", "term4"}
    assert "**TERM0**" in md, "a repeat of an already-bold term stays bold and is not counted again"
    for t in terms:
        assert t in md, "unbolded terms keep their text"
    assert "**term5**" not in md and "term5" in md


def test_prompts_ask_about_the_subject_not_the_page():
    from backend.services.parser.vision_blocks import VISION_BLOCKS_PROMPT

    sentence = ('Write about the subject itself. Never describe the page, slide or document '
                '(no "This page outlines…", "The slide shows…").')
    assert sentence in ss.STUDIO_SUMMARY_PROMPT
    assert sentence in VISION_BLOCKS_PROMPT
    # Both prompts are still valid format strings.
    ss.STUDIO_SUMMARY_PROMPT.format(title="T", language="English", pages="PAGE 1")
    VISION_BLOCKS_PROMPT.format(title="T", language="English", page=1)
