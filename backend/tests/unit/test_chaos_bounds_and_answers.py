"""Chaos Lab invariants 3 and 4.

3. Bounded attempts: one generate_text / generate_text_bulk call makes at most
   len(chain) x MAX_ATTEMPTS_PER_CALL provider calls (each rotation pass calls
   each available leg at most once; call_llm re-runs the pass up to 8 times).
4. If any leg answers, the call returns that answer (the first answering leg
   in chain order) — and garbage JSON never surfaces as a populated
   container from parse_json_response.
"""
from __future__ import annotations

from hypothesis import assume, example, given, settings
from hypothesis import strategies as st

from backend.services.ai import orchestrator as orch
from backend.tests.support.chaos_lab import (
    CHAIN_LEGS,
    GARBAGE,
    MAX_ATTEMPTS_PER_CALL,
    OK,
    R429,
    R503,
    TIMEOUT,
    TRANSPORT_OK_KINDS,
    answer_text,
    chaos_lab,
    fault_scripts,
)

ENTRIES = st.sampled_from(["generate_text", "generate_text_bulk"])


def _chain(entry: str):
    return orch.QUALITY_CHAIN if entry == "generate_text" else orch.BULK_CHAIN


@settings(max_examples=150)
@given(scripts=fault_scripts(CHAIN_LEGS), entry=ENTRIES)
@example(scripts={pid: [R429] for pid in CHAIN_LEGS}, entry="generate_text")
@example(scripts={pid: [R503] for pid in CHAIN_LEGS}, entry="generate_text_bulk")
def test_provider_calls_per_entry_call_are_bounded(scripts, entry):
    bound = len(_chain(entry)) * MAX_ATTEMPTS_PER_CALL
    with chaos_lab(scripts) as lab:
        lab.run(entry, 1)
        made = len(lab.provider.calls)
    assert made <= bound, f"{made} provider calls for one {entry} call (bound {bound})"


@settings(max_examples=150)
@given(scripts=fault_scripts(CHAIN_LEGS, max_len=1), entry=ENTRIES)
@example(scripts={**{pid: [TIMEOUT] for pid in CHAIN_LEGS}, "openai": [OK]}, entry="generate_text")
@example(scripts={**{pid: [R503] for pid in CHAIN_LEGS}, "gemma": [GARBAGE]}, entry="generate_text_bulk")
def test_if_any_leg_answers_the_call_returns_that_answer(scripts, entry):
    first_ok = next(
        (pid for pid in _chain(entry) if scripts[pid][0].kind in TRANSPORT_OK_KINDS), None
    )
    assume(first_ok is not None)
    with chaos_lab(scripts) as lab:
        [out] = lab.run(entry, 1)
    expected = answer_text(first_ok, scripts[first_ok][0])
    assert out == expected, f"expected {first_ok!r}'s answer {expected!r}, got {out!r}"
    if scripts[first_ok][0] == GARBAGE:
        assert orch.parse_json_response(out) == {}


_NO_BRACKETS = st.text(alphabet=st.characters(exclude_characters="{}[]"), max_size=200)
_UNCLOSED_OBJECT = st.integers(0, 40).map(
    lambda n: '{"title": "Intro", "content": "x", "page_number": 3}'[:n]
)
_KNOWN_GARBAGE = st.sampled_from(
    [answer_text(pid, GARBAGE) for pid in CHAIN_LEGS]
    + ["<html>502 Bad Gateway</html>", "```json\n{oops```", "Sure! Here is the JSON you asked for:"]
)


@given(raw=st.one_of(_NO_BRACKETS, _UNCLOSED_OBJECT, _KNOWN_GARBAGE))
def test_garbage_never_parses_to_a_populated_container(raw):
    out = orch.parse_json_response(raw)
    assert not (isinstance(out, (dict, list)) and out), f"{raw!r} parsed to {out!r}"


@given(raw=st.text(max_size=300))
def test_parse_json_response_never_raises(raw):
    orch.parse_json_response(raw)
