"""Chaos Lab invariant 1: after a leg answers 402 (billing) or 404 (model or
route gone), that leg receives zero further calls in the process.

History: a Cerebras 402 whose body contained 'param': 'quota' was sniffed as
a rate limit and re-fired forever; and a google-genai 404 ("404 NOT_FOUND.
{...}", status on ``.code`` not ``.status_code``) was never recognised at
all, so a retired Gemini/Gemma slug was retried on every call.
"""
from __future__ import annotations

from hypothesis import example, given, settings
from hypothesis import strategies as st

from backend.services.ai import orchestrator as orch
from backend.tests.support.chaos_lab import (
    CHAIN_LEGS,
    PERMANENT_KINDS,
    R402,
    R404,
    R429,
    R503,
    chaos_lab,
    fault_scripts,
    provider_error,
)

ENTRIES = st.sampled_from(["generate_text", "generate_text_bulk"])


def _all(fault, **overrides):
    scripts = {pid: [fault] for pid in CHAIN_LEGS}
    scripts.update(overrides)
    return scripts


def test_http_status_reads_both_sdk_error_shapes():
    assert orch._http_status(provider_error("gemini", "404")) == 404
    assert orch._http_status(provider_error("gemma", "402")) == 402
    assert orch._http_status(provider_error("openrouter", "404")) == 404
    assert orch._http_status(RuntimeError("Error code: 404")) is None

    class StringCode(Exception):
        code = "model_not_found"  # openai's APIError.code is a string error code

    assert orch._http_status(StringCode()) is None


@settings(max_examples=150)
@given(scripts=fault_scripts(CHAIN_LEGS), n_calls=st.integers(1, 5), entry=ENTRIES)
@example(scripts=_all(R429, groq=[R402]), n_calls=2, entry="generate_text")       # historic 402-as-429
@example(scripts=_all(R503, gemini=[R404]), n_calls=2, entry="generate_text")     # retired Gemini slug
@example(scripts=_all(R503, gemma=[R404]), n_calls=2, entry="generate_text_bulk")  # retired Gemma slug
def test_leg_that_answered_402_or_404_is_never_called_again(scripts, n_calls, entry):
    with chaos_lab(scripts) as lab:
        lab.run(entry, n_calls)
        for pid in CHAIN_LEGS:
            plays = lab.provider.plays(pid)
            first = next((i for i, f in enumerate(plays) if f.kind in PERMANENT_KINDS), None)
            if first is None:
                continue
            assert len(plays) == first + 1, (
                f"leg {pid!r} answered {plays[first].kind} and was then called "
                f"{len(plays) - first - 1} more time(s): {[f.kind for f in plays]}"
            )
            assert lab.rotator.is_disabled(pid), f"{pid!r} answered {plays[first].kind} but is not disabled"
