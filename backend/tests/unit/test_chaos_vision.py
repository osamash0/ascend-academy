"""Chaos Lab invariant 5: a vision leg that answers 404 (retired model) or 402
(billing) is disabled after its first failure — a 50-slide deck costs exactly
one doomed call to it, not 50.

gemini_vision leads the vision chain and raises google-genai errors, whose
status is on ``.code`` and whose message reads "404 NOT_FOUND. {...}".
"""
from __future__ import annotations

from hypothesis import example, given, settings
from hypothesis import strategies as st

from backend.services.ai import vision as vision_mod
from backend.tests.support.chaos_lab import (
    GARBAGE,
    OK,
    R402,
    R404,
    R429,
    R503,
    TIMEOUT,
    VISION_LEGS,
    chaos_lab,
)

# ai_model hint that puts each leg first (vision.py:106-114).
_PREFER = {"gemini_vision": "gemini", "groq_vision": "groq", "openai_vision": "openai"}


@settings(max_examples=60)
@given(
    dead_leg=st.sampled_from(VISION_LEGS),
    dead_fault=st.sampled_from([R402, R404]),
    survivor=st.sampled_from([OK, GARBAGE, R429, R503, TIMEOUT]),
    n_slides=st.integers(2, 50),
)
@example(dead_leg="gemini_vision", dead_fault=R404, survivor=OK, n_slides=50)
def test_dead_vision_leg_costs_exactly_one_doomed_call_per_deck(dead_leg, dead_fault, survivor, n_slides):
    scripts = {leg: [survivor] for leg in VISION_LEGS}
    scripts[dead_leg] = [dead_fault]
    with chaos_lab(scripts) as lab:
        results = [
            vision_mod._sync_analyze_vision("b64", raw_text="x", ai_model=_PREFER[dead_leg])
            for _ in range(n_slides)
        ]
        doomed = lab.provider.calls_to(dead_leg)
        assert doomed == 1, (
            f"{dead_leg} answered {dead_fault.kind} and was called {doomed} times "
            f"for a {n_slides}-slide deck"
        )
        assert lab.rotator.is_disabled(dead_leg)
    assert all(isinstance(r, dict) for r in results)
    if survivor == OK:
        assert all(r["served_by"] != dead_leg for r in results)
