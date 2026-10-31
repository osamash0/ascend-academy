"""Live measurement of the quiz answer check (LS-115).

Offline: needs the real probe decks (see decks.py) and an LLM key. Runs
SYNTHESIS_QUIZ_VERIFY_PROMPT through the real model on
  - the drop-risk probe (data/grounding_probe.py): each pair's PARAPHRASED key
    must be agreed (a dispute is a false drop) and its on-topic HALLUCINATED
    key must be disputed (agreement is a false keep), with the probe's
    off-topic distractors and the key's position rotated;
  - the LS-115 regression on public/v4-mock/normalization.pdf slide 2: the
    two-clause question must be disputed, its sound twin agreed.
Cost logging is stubbed, so no row reaches any database or Redis.

    python -m backend.eval.quiz_answer_check [ai_model]
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from backend.eval.data.grounding_probe import DE_OFF_TOPIC, EN_OFF_TOPIC, PROBE_PAIRS
from backend.eval.decks import load_pdf_pages, real_deck_pages
from backend.services.parser import synthesis
from backend.services.parser.deck_plan import build_deck_skeleton

ROOT = Path(__file__).resolve().parents[2]

LS115 = {
    "question": "During database design, which step directly follows Conceptional Design and leads to relation schemas?",
    "options": ["Logical Design", "Physical Design", "Data Definition", "Distribution Design"],
    "correctAnswer": "Logical Design",
}
LS115_SOUND = {
    "question": "Which design step produces the relation schemas?",
    "options": ["Logical Design", "Physical Design", "Data Definition", "Requirement Analysis"],
    "correctAnswer": "Logical Design",
}


def _stub_cost_logging() -> None:
    from backend.services.ai import cost, orchestrator

    async def _nothing(*_a, **_k) -> None:
        return None

    cost.log_llm_call = _nothing
    cost.record_user_llm_spend = _nothing
    orchestrator._rotator.flush_success_to_redis = _nothing
    orchestrator._rotator.flush_openai_cost_to_redis = _nothing


def _question(stem: str, key: str, distractors: tuple[str, ...], slide: int, position: int) -> dict:
    options = list(distractors)
    options.insert(position % 4, key)
    return {"question": stem, "options": options, "correctAnswer": key, "source_slide": slide}


async def main(ai_model: str = "openai") -> dict:
    _stub_cost_logging()
    replies: list[str] = []
    real_quality = synthesis.generate_text

    async def _recording(prompt: str, ai_model: str | None = None, **kw) -> str:
        raw = await real_quality(prompt, ai_model=ai_model, **kw)
        replies.append(raw)
        return raw

    synthesis.generate_text = _recording

    cases: list[tuple[str, str, str, dict, int, object]] = []
    for deck in sorted({p.deck for p in PROBE_PAIRS}):
        if real_deck_pages(deck) is None:
            sys.exit(f"probe deck missing: {deck}")
    skeletons = {d: build_deck_skeleton(real_deck_pages(d)) for d in {p.deck for p in PROBE_PAIRS}}
    for i, p in enumerate(PROBE_PAIRS):
        off = EN_OFF_TOPIC if p.language == "en" else DE_OFF_TOPIC
        where = f"{p.deck.strip()[:14]} s{p.slide}"
        cases.append((where, "paraphrased", "agreed", _question(p.stem, p.paraphrased, off, p.slide, i), p.slide, skeletons[p.deck]))
        cases.append((where, "hallucinated", "disputed", _question(p.stem, p.hallucinated, off, p.slide, i + 1), p.slide, skeletons[p.deck]))
    norm = build_deck_skeleton(load_pdf_pages(ROOT / "public" / "v4-mock" / "normalization.pdf"))
    cases.append(("normalization s2", "LS-115", "disputed", LS115, 2, norm))
    cases.append(("normalization s2", "LS-115 sound twin", "agreed", LS115_SOUND, 2, norm))

    rows = []
    for where, kind, want, q, slide, skeleton in cases:
        before = len(replies)
        got = await synthesis._check_answer(q, slide, skeleton, ai_model)
        raw = replies[before] if len(replies) > before else ""
        rows.append({"where": where, "kind": kind, "want": want, "got": got, "reply": raw.strip()[:240]})

    for r in rows:
        mark = "ok " if r["got"] == r["want"] else ("ERR" if r["got"] == "error" else "XX ")
        print(f"{mark} {r['where']:<20} {r['kind']:<18} want={r['want']:<8} got={r['got']}")
        if r["got"] != r["want"]:
            print(f"      {r['reply']}")
    para = [r for r in rows if r["kind"] == "paraphrased"]
    hall = [r for r in rows if r["kind"] == "hallucinated"]
    summary = {
        "model": ai_model,
        "false_drops": f"{sum(r['got'] == 'disputed' for r in para)}/{len(para)}",
        "false_keeps": f"{sum(r['got'] == 'agreed' for r in hall)}/{len(hall)}",
        "errors": sum(r["got"] == "error" for r in rows),
        "ls115_caught": next(r["got"] for r in rows if r["kind"] == "LS-115") == "disputed",
        "ls115_twin_kept": next(r["got"] for r in rows if r["kind"] == "LS-115 sound twin") == "agreed",
    }
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    asyncio.run(main(*sys.argv[1:2]))
