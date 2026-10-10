"""Provider Chaos Lab (Arc 3): scripted fault injection for the LLM failover engine.

Seam. Every text leg is dispatched through exactly one function,
``orchestrator._call_provider`` (orchestrator.py:854), called from
``_generate_with_rotation`` at orchestrator.py:956-960, whose signature is
kept stable for test doubles on purpose (orchestrator.py:926-928). Vision
funnels through ``vision._call_{gemini,groq,openai}_vision``. Patching those
keeps classification, rotation, the rotator, call_llm's retry and cost
accounting all real; HTTP-level mocking would need three wire formats
(OpenAI-compatible, Groq SDK, google-genai) plus real clients that conftest
deliberately blanks.

Honesty. Faults are raised as the real SDK exception types with the same
``status_code`` / ``code`` attributes and message wording production sees:
the classifiers only have those to go on.

No sleeping. Rotator backoffs are ``time.monotonic()`` deadlines, so the lab
swaps orchestrator's ``time`` for a FrozenClock that only moves on
``advance()``; llm_client's tenacity retry keeps its stop/retry policy but
gets ``wait_none()``.
"""
from __future__ import annotations

import asyncio
import contextlib
import threading
import time as _real_time
from dataclasses import dataclass
from typing import Callable, Dict, Iterator, List, Optional, Sequence, Tuple

import httpx
import openai
import pytest
from google.genai import errors as genai_errors
from hypothesis import strategies as st
from tenacity import wait_none

from backend.core.config import settings
from backend.services import llm_client
from backend.services.ai import cost as cost_module
from backend.services.ai import orchestrator as orch
from backend.services.ai import vision as vision_mod
from backend.services.ai.cost import LLMUsage, estimate_cost
from backend.tests.fake_redis import FakeRedis

# Contract ceilings the invariants are written against. Literals on purpose:
# loosening the code under test must fail a test, not silently move the bar.
MAX_ATTEMPTS_PER_CALL = 8        # llm_client._call_with_retry: stop_after_attempt(8)
BACKOFF_CAP_SECONDS = 600.0      # ProviderRotator.record_rate_limit cap

CHAIN_LEGS: Tuple[str, ...] = tuple(dict.fromkeys([*orch.QUALITY_CHAIN, *orch.BULK_CHAIN]))
NON_OPENAI_LEGS: Tuple[str, ...] = tuple(p for p in CHAIN_LEGS if p != "openai")
VISION_LEGS: Tuple[str, ...] = ("gemini_vision", "groq_vision", "openai_vision")
_GOOGLE_FAMILY = frozenset(
    {pid for pid, cfg in orch.PROVIDER_REGISTRY.items() if cfg.uses_google_sdk}
    | {"gemini_vision"}
)
_FAKE_URL = "https://chaos-provider.invalid/v1/chat/completions"


@dataclass(frozen=True)
class Fault:
    kind: str                   # ok | garbage_json | ok_with_cost | 429 | 402 | 404 | 503 | timeout
    completion_tokens: int = 0  # ok_with_cost only


OK = Fault("ok")
GARBAGE = Fault("garbage_json")
R429 = Fault("429")
R402 = Fault("402")
R404 = Fault("404")
R503 = Fault("503")
TIMEOUT = Fault("timeout")
FAILURES: Tuple[Fault, ...] = (R429, R402, R404, R503, TIMEOUT)
TRANSPORT_OK_KINDS = frozenset({"ok", "garbage_json", "ok_with_cost"})
PERMANENT_KINDS = frozenset({"402", "404"})


def ok_with_cost(completion_tokens: int) -> Fault:
    return Fault("ok_with_cost", completion_tokens)


TEXT_FAULTS = st.sampled_from([OK, GARBAGE, *FAILURES])


def fault_scripts(legs: Sequence[str], faults: st.SearchStrategy = TEXT_FAULTS, *, max_len: int = 4):
    """Per-leg scripts: a leg plays its list one Fault per call, then repeats the last."""
    return st.fixed_dictionaries(
        {pid: st.lists(faults, min_size=1, max_size=max_len) for pid in legs}
    )


def answer_text(pid: str, fault: Fault) -> str:
    """The text a leg returns for a transport-level success."""
    if fault.kind == "garbage_json":
        # Opens an object and an array and closes neither: unparseable.
        return '{"chaos_leg": "%s", "slides": [{"title": ' % pid
    return f"ok:{pid}"


_OPENAI_BODIES: Dict[str, dict] = {
    "429": {"error": {"message": "Rate limit reached for requests per minute (RPM). Please try again in 2s.",
                      "type": "requests", "code": "rate_limit_exceeded"}},
    # Verbatim shape of the Cerebras 402 once misread as a rate limit: 'param': 'quota'.
    "402": {"message": "Payment required to access this resource. Visit your billing tab.",
            "type": "payment_required_error", "param": "quota", "code": "payment_required"},
    "404": {"error": {"message": "This model is unavailable for free. The paid version is available now",
                      "code": 404}},
    "503": {"error": {"message": "Service unavailable: the model is experiencing high demand", "code": 503}},
}
_GOOGLE_BODIES: Dict[str, dict] = {
    "429": {"error": {"code": 429, "message": "You exceeded your current quota. Please retry in 30s.",
                      "status": "RESOURCE_EXHAUSTED"}},
    "402": {"error": {"code": 402, "message": "Billing account required for this model.",
                      "status": "PAYMENT_REQUIRED"}},
    "404": {"error": {"code": 404, "message": "models/gemini-flash-latest is not found for API version "
                      "v1beta, or is not supported for generateContent.", "status": "NOT_FOUND"}},
    "503": {"error": {"code": 503, "message": "The model is overloaded. Please try again later.",
                      "status": "UNAVAILABLE"}},
}


def provider_error(pid: str, kind: str) -> Exception:
    """The exception ``pid``'s real SDK raises for fault ``kind``."""
    if pid in _GOOGLE_FAMILY:
        if kind == "timeout":
            return httpx.ReadTimeout("The read operation timed out")
        cls = genai_errors.ServerError if int(kind) >= 500 else genai_errors.ClientError
        return cls(int(kind), _GOOGLE_BODIES[kind])
    request = httpx.Request("POST", _FAKE_URL)
    if kind == "timeout":
        return openai.APITimeoutError(request=request)
    status = int(kind)
    body = _OPENAI_BODIES[kind]
    return openai.APIStatusError(
        f"Error code: {status} - {body}",
        response=httpx.Response(status, request=request),
        body=body,
    )


class ScriptedProvider:
    """Plays per-leg Fault scripts and records every call as (pid, Fault).

    A leg missing from ``scripts`` behaves as a retired model (404 forever).
    """

    def __init__(self, scripts: Dict[str, Sequence[Fault]]) -> None:
        self._scripts = {pid: list(s) for pid, s in scripts.items()}
        self._lock = threading.Lock()
        self.calls: List[Tuple[str, Fault]] = []

    def _next(self, pid: str) -> Fault:
        with self._lock:
            script = self._scripts.get(pid) or [R404]
            played = sum(1 for p, _ in self.calls if p == pid)
            fault = script[min(played, len(script) - 1)]
            self.calls.append((pid, fault))
            return fault

    def plays(self, pid: str) -> List[Fault]:
        return [f for p, f in self.calls if p == pid]

    def calls_to(self, pid: str) -> int:
        return len(self.plays(pid))

    def openai_cost_usd(self) -> float:
        model = orch.PROVIDER_REGISTRY["openai"].model
        return sum(
            estimate_cost("openai", model, LLMUsage(0, f.completion_tokens))
            for p, f in self.calls
            if p == "openai" and f.kind == "ok_with_cost"
        )

    def call_provider(self, provider_id: str, prompt: str, *, json_mode: bool = False):
        """Drop-in for orchestrator._call_provider: (text, usage) or raise."""
        fault = self._next(provider_id)
        if fault.kind in TRANSPORT_OK_KINDS:
            usage = LLMUsage(0, fault.completion_tokens) if fault.kind == "ok_with_cost" else None
            return answer_text(provider_id, fault), usage
        raise provider_error(provider_id, fault.kind)

    def vision_caller(self, vision_pid: str) -> Callable[..., dict]:
        """Drop-in for vision._call_<x>_vision (which return parsed JSON)."""
        def _call(*_args, **_kwargs) -> dict:
            fault = self._next(vision_pid)
            if fault.kind == "garbage_json":
                return orch.parse_json_response(answer_text(vision_pid, fault))
            if fault.kind in TRANSPORT_OK_KINDS:
                return {"slide_type": "content_slide", "served_by": vision_pid}
            raise provider_error(vision_pid, fault.kind)
        return _call


class FrozenClock:
    """Stands in for orchestrator's ``time`` module (only monotonic and
    perf_counter are used there). monotonic() moves only on advance()."""

    def __init__(self) -> None:
        self.now = 1_000_000.0

    def monotonic(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds

    @staticmethod
    def perf_counter() -> float:
        return _real_time.perf_counter()


@dataclass
class Lab:
    provider: ScriptedProvider
    rotator: "orch.ProviderRotator"
    clock: FrozenClock
    redis: Optional[FakeRedis]

    def run(self, entry: str, n_calls: int = 1, prompt: str = "chaos prompt") -> List[object]:
        """Runs ``n_calls`` sequential ``orchestrator.<entry>`` calls in one
        event loop, advancing the clock past the backoff cap between calls.
        Returns each call's text, or the exception it raised."""
        fn = getattr(orch, entry)

        async def _drive() -> List[object]:
            outcomes: List[object] = []
            for _ in range(n_calls):
                try:
                    outcomes.append(await fn(prompt))
                except Exception as exc:  # outcome under test, not a harness error
                    outcomes.append(exc)
                self.clock.advance(BACKOFF_CAP_SECONDS + 1.0)
            return outcomes

        return asyncio.run(_drive())


@contextlib.contextmanager
def chaos_lab(
    scripts: Dict[str, Sequence[Fault]],
    *,
    redis_up: bool = True,
    openai_ceiling_usd: float = 10.0,
) -> Iterator[Lab]:
    """Fresh failover world for one example; everything restored on exit."""
    provider = ScriptedProvider(scripts)
    rotator = orch.ProviderRotator()
    clock = FrozenClock()
    redis = FakeRedis() if redis_up else None

    async def _no_db_log(**_kwargs) -> None:
        return None

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(orch, "_rotator", rotator)
        mp.setattr(vision_mod, "_rotator", rotator)  # vision.py:8 binds its own reference at import
        mp.setattr(orch, "_clients", {pid: object() for pid in orch.PROVIDER_REGISTRY})
        mp.setattr(orch, "_JSON_MODE_UNSUPPORTED", set())
        mp.setattr(orch, "time", clock)
        mp.setattr(orch, "_call_provider", provider.call_provider)
        mp.setattr(vision_mod, "gemini_client", object())
        mp.setattr(vision_mod, "groq_client", object())
        mp.setattr(vision_mod, "openai_client", object())
        mp.setattr(vision_mod, "GROQ_VISION_MODEL", "chaos/vision-model")
        mp.setattr(vision_mod, "_call_gemini_vision", provider.vision_caller("gemini_vision"))
        mp.setattr(vision_mod, "_call_groq_vision", provider.vision_caller("groq_vision"))
        mp.setattr(vision_mod, "_call_openai_vision", provider.vision_caller("openai_vision"))
        mp.setattr(settings, "llm_openai_daily_cost_ceiling_usd", openai_ceiling_usd)
        mp.setattr(cost_module, "get_redis_or_none", lambda: redis)
        mp.setattr(cost_module, "log_llm_call", _no_db_log)
        mp.setattr(
            llm_client, "_call_with_retry",
            llm_client._call_with_retry.retry_with(wait=wait_none()),
        )
        yield Lab(provider=provider, rotator=rotator, clock=clock, redis=redis)
