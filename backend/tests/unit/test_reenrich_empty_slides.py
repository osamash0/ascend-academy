"""The owner-run re-enrich script fills only slides the model answered."""
from __future__ import annotations

from uuid import uuid4

from backend.scripts import reenrich_empty_slides as script
from backend.services.parser import unified_orchestrator as uo


async def test_generate_summaries_maps_slide_numbers_and_skips_empty(monkeypatch):
    rows = [
        {"id": uuid4(), "slide_number": n, "title": f"T{n}", "content_text": f"Text of slide {n} " * 3}
        for n in (9, 10, 11)
    ]
    seen = []

    async def fake_batch(text_items, ctx, model, pdf, instr, lang):
        seen.append(([i for i, _ in text_items], lang))
        return {8: {"summary": "Neun."}, 9: {"summary": "  "}, 10: RuntimeError("down")}

    monkeypatch.setattr(uo, "_synthesize_text_slide_batch", fake_batch)

    out = await script.generate_summaries(rows, "ctx", "openai", "de")

    assert seen == [([8, 9, 10], "de")]  # slide_number is 1-based, index 0-based
    assert out == {rows[0]["id"]: "Neun."}


def test_update_only_touches_slides_that_are_still_empty():
    assert "btrim(summary) = ''" in script.UPDATE_SUMMARY
    assert "WHERE id = $1" in script.UPDATE_SUMMARY
