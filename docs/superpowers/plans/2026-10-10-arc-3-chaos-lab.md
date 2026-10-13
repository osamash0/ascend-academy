> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Parent plan: docs/superpowers/plans/2026-10-10-ai-backend-deep-session.md (its Global Constraints bind every task here).

# Arc 3 — Provider Chaos Lab: TDD implementation plan

## 0. Findings that shape the plan (read before executing)

### Two invariants already fail today, so two tasks include real bug fixes

**BUG A: the openai daily cost ceiling is never enforced in any process where Redis is not initialised. This breaks invariant 2.**
- `backend/services/ai/orchestrator.py:724-737`: `flush_openai_cost_to_redis` returns early when `get_redis_or_none()` is `None` (lines 727-728).
- It only adds to the in-memory `self._openai_daily_cost_usd` *after* a successful Redis write (lines 734-735). With Redis down or uninitialised, the in-memory total stays at 0.0, so the ceiling check in `available()` (line 635) never trips.
- In production this is the Arq worker, which runs all PDF/bulk generation:
  - `init_redis()` is only called from `backend/main.py:72`.
  - The worker's `startup` (`backend/workers/arq_worker.py:74-78`) only initialises the DB pool.
  - So `backend/core/redis.py:42-43` raises, and `get_redis_or_none()` returns `None` in the worker every time.
- The same is true in unit tests: the `fake_redis` fixture patches `aioredis.from_url` but never sets `core.redis.redis_client`.
- Fix (Task 3): add to the in-memory total unconditionally, then write to Redis best-effort.

**BUG B: a Google-SDK leg that returns 404 (retired Gemini/Gemma slug) is never disabled. This breaks invariants 1 and 5.**
- google-genai's `APIError` puts the HTTP status in `.code`, not `.status_code` (`google/genai/errors.py:53`). Its message is `f'{code} {status}. {details}'`, e.g. `"404 not_found. {'error': {...}}"`. I checked this against the installed google-genai.
- The text path checks `getattr(exc, "status_code", None) == 404 or "error code: 404" in msg or "status 404" in msg` (orchestrator.py:1004-1008). None of these match, so the error lands in the generic `continue` branch and is retried on every call. This affects the `gemini` and `gemma` legs.
- The vision path checks `getattr(exc, "status_code", None) in (402, 404) or "error code: 404"/"error code: 402"/"model_not_found"/"payment_required"` (vision.py:150-156). It misses the same way.
- `gemini_vision` is the **head** of the vision chain (vision.py:96-97), so a retired Gemini slug costs one doomed call per slide: 50 for a 50-slide deck.
- Fix (Tasks 2 and 5): add a shared `_http_status(exc)` helper that reads an int `status_code` or `code`.

### Seam choice: monkeypatch `_call_provider`, not respx
- **One dispatch point.** Every text leg goes through `orchestrator._call_provider` (orchestrator.py:854). `_generate_with_rotation` calls it at :956-960.
- **The signature is already stable for test doubles.** Its docstring says so (orchestrator.py:926-928), and existing tests use this seam: test_provider_failover_hardening.py:139, test_ai_models_smoke.py:301/381.
- **Vision has the same pattern.** It funnels through `vision._call_gemini_vision` / `_call_groq_vision` / `_call_openai_vision` (vision.py:65/32/47). test_provider_failover_hardening.py:220-221 already patches these.
- **respx would be worse, for three reasons:**
  1. It would need three wire formats: the OpenAI-compatible client, the Groq SDK at orchestrator.py:886-893, and google-genai at :838-851.
  2. It needs real clients, but conftest deliberately blanks the provider keys (conftest.py:61-65). So `_clients` holds `None` for most legs and requests would never be made.
  3. conftest's outbound guard monkeypatches `httpx.HTTPTransport.handle_request` (conftest.py:166), which fights respx's transport mocking.
- **What keeps it honest:** the ScriptedProvider raises the **real SDK exception types**, built the way production builds them:
  - `openai.APIStatusError("Error code: N - {body}", response=httpx.Response(N, ...), body=...)` and `openai.APITimeoutError` for OpenAI-compatible and Groq legs.
  - `google.genai.errors.ClientError` / `ServerError` for gemini, gemma and gemini_vision.
  
  That way the classification code (orchestrator.py:971-1032, vision.py:143-174) sees exactly what production sees. Raising generic exceptions with production's wording is the only reason BUG B was invisible to the existing tests.

### How backoff waits, and how to avoid sleeping
- **Rotator backoff never sleeps.** It records `time.monotonic()` deadlines (orchestrator.py:556) and `available()` compares against them (:615). The lab replaces orchestrator's module-level `time` with a `FrozenClock`; orchestrator only uses `time.monotonic` and `time.perf_counter`. Advancing it past the 600s cap (orchestrator.py:555) lapses every backoff. asyncio's own clock is untouched.
- **The real sleep is in tenacity.** `backend/services/llm_client.py:33-38`: `@retry(retry_if_exception_type(LLMRateLimitError), stop=stop_after_attempt(8), wait=wait_exponential(multiplier=2, min=4, max=60), reraise=True)`, wrapped in `asyncio.wait_for(…, 25s)`.
  - `call_llm` looks up `_call_with_retry` as a module global, so the lab swaps in `_call_with_retry.retry_with(wait=wait_none())`. I verified with tenacity 9.1.4 that this keeps stop=8 and that `.retry_with` exists on async functions.
  - **Consequence for invariant 3:** call_llm re-runs the **whole chain** up to 8 times whenever the last leg's error string contains "429", "rate limit", "quota", "503" or "timeout" (llm_client.py:28-31). So the per-call bound is `len(chain) × 8 = 64`.

### Process-global state the lab must rebuild for every Hypothesis example
| Global | Location | Why |
|---|---|---|
| `orch._rotator` | orchestrator.py:740 | backoff, disabled set, counts, openai cost |
| `vision._rotator` | vision.py:8 | **bound by value at import**: patching only `orch._rotator` leaves vision on the old one |
| `orch._clients` | orchestrator.py:477 | `available()` hard-gates legs with no client (:629). Under conftest, `openai`, `openrouter`, `mistral`, `cloudflare` and `cerebras` are `None` |
| `orch._JSON_MODE_UNSUPPORTED` | orchestrator.py:758 | process-lifetime set |
| `orch.time` | orchestrator.py:38 | time travel |
| `orch._call_provider` | :854 | seam |
| `vision.gemini_client` / `groq_client` / `openai_client` / `GROQ_VISION_MODEL` / `_call_*_vision` | vision.py:7, 32-77 | vision legs |
| `settings.llm_openai_daily_cost_ceiling_usd` | config.py:160 | ceiling |
| `cost.get_redis_or_none` | cost.py:97 | redis up/down toggle (rotator methods import it at call time) |
| `cost.log_llm_call` | cost.py:149 | avoids the DB path. `_account_for_call` imports it at call time (orchestrator.py:1262) |
| `llm_client._call_with_retry` | llm_client.py:39 | zero-wait retries |

**Hypothesis caveat:** `@given` tests must not take the function-scoped `monkeypatch` fixture, because the `function_scoped_fixture` health check is not suppressed by the "ascend" profile (conftest.py:103). The lab is therefore a context manager built on `pytest.MonkeyPatch.context()` and entered **inside** each example. Using `asyncio.run` inside sync tests has precedent at test_ai_models_smoke.py:318.

### Mutation-verify helper (used by every task)
Apply a mutation with:
```
/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python - <<'PY'
import pathlib
p = pathlib.Path("<FILE>"); s = p.read_text()
old = '''<OLD>'''; new = '''<NEW>'''
assert s.count(old) == 1, s.count(old); p.write_text(s.replace(old, new))
PY
```
- Undo it by running the same script with OLD and NEW swapped. **Do not use `git checkout`**: the working tree already has unrelated modifications (synthesis.py, unified_orchestrator.py and their tests).
- Commit only the paths each task names.
- Every mutation string below is quoted from the current source; I verified each occurs exactly once.

Run everything from `/Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd` with `PY=/Users/abdullahabobaker/Desktop/ascend-academy/.venv/bin/python`.

---

## Task 1 — Chaos Lab harness (ScriptedProvider, FrozenClock, `chaos_lab`)

**Files**
- Create: `backend/tests/support/chaos_lab.py`
- Test: `backend/tests/unit/test_chaos_lab_harness.py`

**Interfaces**
- Consumes:
  - `orchestrator._call_provider(provider_id: str, prompt: str, *, json_mode: bool = False) -> Tuple[str, Optional[LLMUsage]]`
  - `orchestrator.ProviderRotator()`, `.available(chain) -> List[str]`, `.record_rate_limit(pid)`, `.is_disabled(pid)`
  - `orchestrator.generate_text(prompt, ai_model="cerebras", *, ...) -> str`, `generate_text_bulk(...)`
  - `vision._sync_analyze_vision(b64_image, raw_text="", ai_model="groq", blueprint_context="") -> Dict`
  - `llm_client._call_with_retry.retry_with(...)`
  - `cost.estimate_cost(provider_id, model, usage) -> float`, `cost.LLMUsage(prompt_tokens, completion_tokens)`
  - `backend.tests.fake_redis.FakeRedis()`
- Produces:
  - `Fault(kind: str, completion_tokens: int = 0)`
  - constants `OK, GARBAGE, R429, R402, R404, R503, TIMEOUT`, `FAILURES`, `TRANSPORT_OK_KINDS`, `PERMANENT_KINDS`
  - `ok_with_cost(completion_tokens: int) -> Fault`
  - `TEXT_FAULTS: SearchStrategy[Fault]`
  - `fault_scripts(legs, faults=TEXT_FAULTS, *, max_len=4) -> SearchStrategy[Dict[str, List[Fault]]]`
  - `answer_text(pid: str, fault: Fault) -> str`
  - `provider_error(pid: str, kind: str) -> Exception`
  - `ScriptedProvider(scripts)`: `.call_provider`, `.vision_caller(pid)`, `.calls: List[Tuple[str, Fault]]`, `.plays(pid)`, `.calls_to(pid)`, `.openai_cost_usd()`
  - `FrozenClock`: `.monotonic()`, `.advance(s)`, `.perf_counter()`
  - `Lab(provider, rotator, clock, redis)`: `.run(entry: str, n_calls: int = 1, prompt: str = "chaos prompt") -> List[object]`
  - `chaos_lab(scripts, *, redis_up=True, openai_ceiling_usd=10.0) -> ContextManager[Lab]`
  - `CHAIN_LEGS`, `NON_OPENAI_LEGS`, `VISION_LEGS`, `MAX_ATTEMPTS_PER_CALL = 8`, `BACKOFF_CAP_SECONDS = 600.0`

**Steps**

1. **Write the failing test** `backend/tests/unit/test_chaos_lab_harness.py`:
```python
"""Self-tests for the Provider Chaos Lab harness (backend/tests/support/chaos_lab.py).

The invariant suites trust the lab to (a) raise faults in the exact SDK
shapes production sees, (b) rebuild every piece of process-global failover
state per example and put it back afterwards, and (c) never sleep. Each is
pinned here so a broken harness fails loudly instead of making the invariant
suites vacuous.
"""
from __future__ import annotations

import time

import openai
import pytest
from google.genai import errors as genai_errors

from backend.services import llm_client
from backend.services.ai import orchestrator as orch
from backend.services.ai import vision as vision_mod
from backend.tests.support.chaos_lab import (
    GARBAGE,
    MAX_ATTEMPTS_PER_CALL,
    OK,
    R429,
    ScriptedProvider,
    answer_text,
    chaos_lab,
    ok_with_cost,
    provider_error,
)


def test_script_plays_in_order_then_repeats_its_last_fault():
    p = ScriptedProvider({"groq": [OK, R429]})
    assert p.call_provider("groq", "x") == ("ok:groq", None)
    for _ in range(2):
        with pytest.raises(openai.APIStatusError) as caught:
            p.call_provider("groq", "x")
        assert caught.value.status_code == 429
    assert p.plays("groq") == [OK, R429, R429]
    assert p.calls_to("groq") == 3


def test_unscripted_leg_behaves_as_a_retired_model():
    p = ScriptedProvider({})
    with pytest.raises(openai.APIStatusError) as caught:
        p.call_provider("mistral", "x")
    assert caught.value.status_code == 404


def test_google_legs_fail_with_google_sdk_errors():
    err = provider_error("gemini", "404")
    assert isinstance(err, genai_errors.ClientError)
    assert err.code == 404
    # The shape that hides a Gemini 404 from status_code / "error code: 404" sniffs.
    assert getattr(err, "status_code", None) is None
    assert "error code: 404" not in str(err).lower()
    assert isinstance(provider_error("gemma", "503"), genai_errors.ServerError)


def test_openai_family_402_carries_the_historic_quota_body():
    err = provider_error("openrouter", "402")
    assert err.status_code == 402
    assert "quota" in str(err).lower()


def test_ok_with_cost_reports_usage_and_lands_in_the_ledger():
    p = ScriptedProvider({"openai": [ok_with_cost(10_000)]})
    text, usage = p.call_provider("openai", "x")
    assert text == "ok:openai"
    assert usage.completion_tokens == 10_000
    assert p.openai_cost_usd() > 0


def test_garbage_answer_is_unparseable():
    p = ScriptedProvider({"gemma": [GARBAGE]})
    text, _usage = p.call_provider("gemma", "x")
    assert text == answer_text("gemma", GARBAGE)
    assert orch.parse_json_response(text) == {}


def test_lab_installs_fresh_global_state_and_restores_it():
    def snapshot():
        return (
            orch._rotator, vision_mod._rotator, orch._call_provider,
            orch._clients, llm_client._call_with_retry, orch.time,
        )

    before = snapshot()
    with chaos_lab({}) as lab:
        assert orch._rotator is lab.rotator
        assert vision_mod._rotator is lab.rotator
        assert lab.rotator is not before[0]
        assert orch._call_provider == lab.provider.call_provider
        # every leg has a (fake) client, so a fresh rotator offers the whole chain
        assert orch._rotator.available(orch.BULK_CHAIN) == orch.BULK_CHAIN
    after = snapshot()
    assert all(a is b for a, b in zip(after, before))


def test_frozen_clock_lapses_backoff_without_sleeping():
    with chaos_lab({}) as lab:
        lab.rotator.record_rate_limit("groq")
        assert lab.rotator.available(["groq", "openrouter"]) == ["openrouter"]
        lab.clock.advance(601.0)
        assert lab.rotator.available(["groq", "openrouter"]) == ["groq", "openrouter"]


def test_retries_run_without_real_backoff_sleeps():
    with chaos_lab({pid: [R429] for pid in orch.BULK_CHAIN}) as lab:
        started = time.perf_counter()
        [outcome] = lab.run("generate_text_bulk", 1)
        elapsed = time.perf_counter() - started
    assert isinstance(outcome, llm_client.LLMRateLimitError), outcome
    assert len(lab.provider.calls) == len(orch.BULK_CHAIN) * MAX_ATTEMPTS_PER_CALL
    assert elapsed < 5.0, f"retries slept for real ({elapsed:.1f}s)"


def test_vision_seams_are_scripted():
    with chaos_lab({"openai_vision": [OK]}) as lab:
        result = vision_mod._sync_analyze_vision("b64", raw_text="x", ai_model="openai")
    assert result["served_by"] == "openai_vision"
    assert lab.provider.calls_to("openai_vision") == 1
```

2. **Run:** `$PY -m pytest backend/tests/unit/test_chaos_lab_harness.py -m "not db" -q`. Expected: a collection error, `ModuleNotFoundError: No module named 'backend.tests.support.chaos_lab'`.

3. **Minimal implementation:** create `backend/tests/support/chaos_lab.py`. This task needs no production change.
```python
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
```

4. **Run to green:** `$PY -m pytest backend/tests/unit/test_chaos_lab_harness.py -m "not db" -q`. Expected: 10 passed.

5. **Mutation-verify** in `backend/tests/support/chaos_lab.py`. Undo each one after checking.
   - (a) OLD `        mp.setattr(vision_mod, "_rotator", rotator)  # vision.py:8 binds its own reference at import\n` → NEW `` (empty). Expected: `test_lab_installs_fresh_global_state_and_restores_it` fails.
   - (b) OLD `        mp.setattr(orch, "time", clock)\n` → NEW ``. Expected: `test_frozen_clock_lapses_backoff_without_sleeping` fails.
   - (c) OLD `            llm_client._call_with_retry.retry_with(wait=wait_none()),` → NEW `            llm_client._call_with_retry,`. Expected: `test_retries_run_without_real_backoff_sleeps` fails with `LLMTimeoutError` after about 25s.

6. **Commit** `backend/tests/support/chaos_lab.py` and `backend/tests/unit/test_chaos_lab_harness.py`:
```
test(ai): Provider Chaos Lab harness — scripted SDK-faithful fault injection

ScriptedProvider replaces orchestrator._call_provider and the vision
callers, raising real openai / google-genai exception types; FrozenClock
time-travels rotator backoffs; tenacity retries run with wait_none().

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Task 2 — Invariant 1: a leg that answered 402 or 404 is never called again (fixes BUG B in the text path)

**Files**
- Modify: `backend/services/ai/orchestrator.py` (add `_http_status`; use it at the old lines 982 and 1005)
- Test: `backend/tests/unit/test_chaos_permanent_failures.py`

**Interfaces**
- Consumes: the Task 1 lab, plus `orch.generate_text` / `generate_text_bulk` and `ProviderRotator.is_disabled`.
- Produces: `orchestrator._http_status(exc: BaseException) -> Optional[int]`.

**Steps**

1. **Write the failing test** `backend/tests/unit/test_chaos_permanent_failures.py`:
```python
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
```

2. **Run:** `$PY -m pytest backend/tests/unit/test_chaos_permanent_failures.py -m "not db" -q`. Expected failures:
   - `test_http_status_reads_both_sdk_error_shapes`: `AttributeError: module 'backend.services.ai.orchestrator' has no attribute '_http_status'`.
   - The property test fails on the explicit example with `gemini=[R404]`: `AssertionError: leg 'gemini' answered 404 and was then called 15 more time(s)`. That is 8 attempts × 2 calls: the openai leg's 503 is the last error, which call_llm treats as retryable.
   - The 402 example passes today. It is a guard for Step 5a.

3. **Minimal implementation** in `backend/services/ai/orchestrator.py`.
   - (i) Insert immediately before the line `def _generate_with_rotation(`:
```python
def _http_status(exc: BaseException) -> Optional[int]:
    """The HTTP status a provider SDK exception carries, or None.

    openai/groq SDK errors expose it as ``status_code``. google-genai's
    ``APIError`` (gemini, gemma, gemini_vision) exposes it as ``code`` and words
    its message "404 NOT_FOUND. {...}", which none of the string sniffs match,
    so a retired Gemini slug used to be retried on every call. Only ints count:
    openai's APIError also has a ``code`` attribute, but there it is the
    string error code (e.g. "model_not_found").
    """
    for attr in ("status_code", "code"):
        value = getattr(exc, attr, None)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None


```
   - (ii) Replace `                getattr(exc, "status_code", None) == 402` with `                _http_status(exc) == 402`.
   - (iii) Replace `                getattr(exc, "status_code", None) == 404` with `                _http_status(exc) == 404`.

4. **Run to green:**
   - `$PY -m pytest backend/tests/unit/test_chaos_permanent_failures.py backend/tests/unit/test_provider_failover_hardening.py backend/tests/unit/test_ai_models_smoke.py -m "not db" -q`. Expected: all pass.

5. **Mutation-verify** in `backend/services/ai/orchestrator.py`.
   - (a) Recreate the historic 402-as-429 bug. This takes two replacements, applied together:
     - OLD `            is_rate_limit = not is_payment_required and any(` → NEW `            is_rate_limit = any(`
     - OLD `            if is_payment_required:\n                _rotator.record_unavailable(pid, "402 payment required (billing)")` → NEW `            if is_payment_required and not is_rate_limit:\n                _rotator.record_unavailable(pid, "402 payment required (billing)")`
     - Expected: the explicit example `groq=[R402]` fails. groq gets a backoff instead of being disabled; once every leg is backed off, `available()` returns `hard_eligible` and groq is called again.
   - (b) Revert this task's fix: OLD `                _http_status(exc) == 404` → NEW `                getattr(exc, "status_code", None) == 404`. Expected: the `gemini=[R404]` example fails.
   - Undo both.

6. **Commit** `backend/services/ai/orchestrator.py` and `backend/tests/unit/test_chaos_permanent_failures.py`:
```
fix(ai): disable google-genai legs on 404/402 — status lives on .code

google-genai's APIError carries the HTTP status in `.code` and words its
message "404 NOT_FOUND. {...}", so the status_code/"error code: 404" sniffs
never matched and a retired gemini/gemma slug was retried on every call.
Adds _http_status() and a Chaos Lab property: a leg that answered 402/404
receives zero further calls in the process.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Task 3 — Invariant 2: openai spend ≤ ceiling + one call, and `[]` means no call (fixes BUG A)

**Files**
- Modify: `backend/services/ai/orchestrator.py` (`ProviderRotator.flush_openai_cost_to_redis`)
- Test: `backend/tests/unit/test_chaos_openai_ceiling.py`

**Interfaces**
- Consumes:
  - `ProviderRotator.flush_openai_cost_to_redis(cost_usd: float) -> None` (async)
  - `ProviderRotator.record_unavailable(pid, reason)`
  - `ProviderRotator.available(chain)`
  - the lab's `ok_with_cost`, `ScriptedProvider.openai_cost_usd`
- Produces: no new interfaces. The fix changes behaviour: the in-memory cost now always increments.

**Steps**

1. **Write the failing test** `backend/tests/unit/test_chaos_openai_ceiling.py`:
```python
"""Chaos Lab invariant 2: openai's cumulative cost never exceeds the daily
ceiling plus one call's cost — even when every other leg fails, and even when
Redis is down (the Arq worker never calls init_redis(), so in production its
get_redis_or_none() is always None). And ``[]`` from available() means no
provider is called at all.

History: two "if nothing is available, try everything" fallbacks
(available()'s last_ditch list and _generate_with_rotation overwriting an
empty list with the raw chain) re-admitted openai past its ceiling.
"""
from __future__ import annotations

import asyncio

from hypothesis import example, given, settings
from hypothesis import strategies as st

from backend.services.ai import orchestrator as orch
from backend.services.ai.cost import LLMUsage, estimate_cost
from backend.tests.support.chaos_lab import (
    FAILURES,
    NON_OPENAI_LEGS,
    R404,
    chaos_lab,
    fault_scripts,
    ok_with_cost,
)

ENTRIES = st.sampled_from(["generate_text", "generate_text_bulk"])
_ALL_DEAD = {pid: [R404] for pid in NON_OPENAI_LEGS}


def _call_cost(tokens: int) -> float:
    return estimate_cost("openai", orch.PROVIDER_REGISTRY["openai"].model, LLMUsage(0, tokens))


@settings(max_examples=120)
@given(
    others=fault_scripts(NON_OPENAI_LEGS, st.sampled_from(list(FAILURES)), max_len=3),
    tokens=st.lists(st.integers(1_000, 20_000), min_size=1, max_size=4),
    ceiling_in_calls=st.floats(0.5, 4.0),
    n_calls=st.integers(1, 12),
    redis_up=st.booleans(),
    entry=ENTRIES,
)
@example(others=_ALL_DEAD, tokens=[10_000], ceiling_in_calls=2.0, n_calls=10,
         redis_up=False, entry="generate_text_bulk")
@example(others=_ALL_DEAD, tokens=[10_000], ceiling_in_calls=2.0, n_calls=10,
         redis_up=True, entry="generate_text")
def test_openai_spend_never_exceeds_ceiling_plus_one_call(
    others, tokens, ceiling_in_calls, n_calls, redis_up, entry
):
    max_call = max(_call_cost(t) for t in tokens)
    ceiling = max_call * ceiling_in_calls
    scripts = {**others, "openai": [ok_with_cost(t) for t in tokens]}
    with chaos_lab(scripts, redis_up=redis_up, openai_ceiling_usd=ceiling) as lab:
        lab.run(entry, n_calls)
        spent = lab.provider.openai_cost_usd()
    assert spent <= ceiling + max_call + 1e-12, (
        f"openai spent ${spent:.6f} against a ${ceiling:.6f} ceiling "
        f"(one call ≤ ${max_call:.6f}, redis_up={redis_up})"
    )


def test_empty_available_means_no_provider_is_called():
    scripts = {**_ALL_DEAD, "openai": [ok_with_cost(10_000)]}
    with chaos_lab(scripts, openai_ceiling_usd=0.01) as lab:
        for pid in NON_OPENAI_LEGS:
            lab.rotator.record_unavailable(pid, "chaos: retired model")
        asyncio.run(lab.rotator.flush_openai_cost_to_redis(0.02))  # past the ceiling
        assert lab.rotator.available(orch.BULK_CHAIN) == []
        [outcome] = lab.run("generate_text_bulk", 1)
    assert lab.provider.calls == [], f"providers called despite available()==[]: {lab.provider.calls}"
    assert isinstance(outcome, RuntimeError) and "No LLM provider available" in str(outcome), outcome
```

2. **Run:** `$PY -m pytest backend/tests/unit/test_chaos_openai_ceiling.py -m "not db" -q`. Expected:
   - The property test fails on the `redis_up=False` explicit example: `AssertionError: openai spent $<10c> against a $<2c> ceiling ... redis_up=False`. openai serves all 10 calls because `flush_openai_cost_to_redis` returns before it touches the in-memory total.
   - `test_empty_available_means_no_provider_is_called` passes today. It is a guard for Steps 5a/5b.

3. **Minimal implementation:** replace the whole method body in `backend/services/ai/orchestrator.py`. OLD (exact, current lines 724-737):
```python
    async def flush_openai_cost_to_redis(self, cost_usd: float) -> None:
        """Atomically adds to openai's fleet-wide daily cost total."""
        from backend.services.ai.cost import get_redis_or_none, openai_daily_cost_key
        redis = get_redis_or_none()
        if redis is None:
            return
        try:
            key = openai_daily_cost_key()
            await redis.incrbyfloat(key, cost_usd)
            await redis.expire(key, 2 * 86400)
            with self._lock:
                self._openai_daily_cost_usd += cost_usd
        except Exception as exc:
            logger.debug("ProviderRotator.flush_openai_cost_to_redis failed: %s", exc)
```
NEW:
```python
    async def flush_openai_cost_to_redis(self, cost_usd: float) -> None:
        """Adds to openai's daily cost: always to this process's in-memory
        total, then best-effort to the fleet-wide Redis counter.

        The local add must not depend on Redis. A process with Redis down —
        or never initialised, which is every Arq worker (only main.py calls
        init_redis()) — used to skip it, so the ceiling in `available()`
        compared against a total stuck at $0 and never tripped.
        `refresh_from_redis` takes max(local, fleet), so this never
        double-counts.
        """
        with self._lock:
            self._reset_if_new_day()
            self._openai_daily_cost_usd += cost_usd
        from backend.services.ai.cost import get_redis_or_none, openai_daily_cost_key
        redis = get_redis_or_none()
        if redis is None:
            return
        try:
            key = openai_daily_cost_key()
            await redis.incrbyfloat(key, cost_usd)
            await redis.expire(key, 2 * 86400)
        except Exception as exc:
            logger.debug("ProviderRotator.flush_openai_cost_to_redis failed: %s", exc)
```

4. **Run to green:**
   - `$PY -m pytest backend/tests/unit/test_chaos_openai_ceiling.py backend/tests/unit/test_llm_cost.py backend/tests/unit/test_provider_failover_hardening.py -m "not db" -q`. Expected: all pass. The existing ceiling tests at test_llm_cost.py:237-290 still hold.

5. **Mutation-verify** in `backend/services/ai/orchestrator.py`. Undo each one after checking.
   - (a) Recreate the `available()` last_ditch fallback: OLD `        return ok or hard_eligible` → NEW `        return ok or hard_eligible or [p for p in chain if p not in self._disabled]`. Expected: `test_empty_available_means_no_provider_is_called` fails (`available()` returns `['openai']`), and the property fails on the all-dead examples.
   - (b) Recreate the "overwrite the empty list" fallback in `_generate_with_rotation`: OLD `    available = _rotator.available(chain)\n    if not available:` → NEW `    available = _rotator.available(chain) or list(chain)\n    if not available:`. Expected: `test_empty_available_means_no_provider_is_called` fails because the calls list is non-empty.
   - (c) Revert this task's fix by swapping NEW back to OLD from Step 3. Expected: the `redis_up=False` example fails again.

6. **Commit** `backend/services/ai/orchestrator.py` and `backend/tests/unit/test_chaos_openai_ceiling.py`:
```
fix(ai): enforce openai daily cost ceiling without Redis

flush_openai_cost_to_redis only bumped the in-memory total after a
successful Redis write, so with Redis absent (every Arq worker — only
main.py calls init_redis) the ceiling compared against $0 forever. Count
locally first, then mirror to Redis best-effort. Chaos Lab property: openai
spend <= ceiling + one call under random failures, Redis up or down; and
available()==[] means zero provider calls.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Task 4 — Invariants 3 and 4: bounded attempts, any ok answer wins, garbage never parses to content

**Files**
- Test: `backend/tests/unit/test_chaos_bounds_and_answers.py`. Tests only; this is expected to pass today.

**Interfaces**
- Consumes:
  - the lab's `MAX_ATTEMPTS_PER_CALL`, `answer_text`, `TRANSPORT_OK_KINDS`, `GARBAGE`
  - `orch.QUALITY_CHAIN`, `orch.BULK_CHAIN`
  - `orch.parse_json_response(raw) -> Any`
- Produces: nothing new.

**Steps**

1. **Write the test** `backend/tests/unit/test_chaos_bounds_and_answers.py`:
```python
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
```

2. **Run:** `$PY -m pytest backend/tests/unit/test_chaos_bounds_and_answers.py -m "not db" -q`. Expected: 4 passed.
   - The all-429 example makes exactly 64 calls, which is the bound.
   - This is a guard task. If it unexpectedly goes red, treat the falsifying example as a new bug and do a RED→fix cycle like Tasks 2 and 3.

3. **Minimal implementation:** none.

4. **Run to green:** same command as Step 2. Expected: 4 passed.

5. **Mutation-verify.** Undo each one after checking.
   - (a) Invariant 3, in `backend/services/llm_client.py`: OLD `    stop=stop_after_attempt(8),` → NEW `    stop=stop_after_attempt(50),`. Expected: the all-429 example fails (400 > 64).
   - (b) Invariant 4 fail-over, in `backend/services/ai/orchestrator.py`: OLD `                # Still try next provider for non-fatal errors (network glitches, etc.)\n                continue` → NEW `                # Still try next provider for non-fatal errors (network glitches, etc.)\n                raise`. Expected: the TIMEOUT→openai example fails, because the outcome is an `APITimeoutError` instead of `"ok:openai"`.
   - (c) Garbage, in `backend/services/ai/orchestrator.py`: OLD `                return salvaged\n        return {}` → NEW `                return salvaged\n        return {"content": raw}`. Expected: `test_garbage_never_parses_to_a_populated_container` fails.

6. **Commit** `backend/tests/unit/test_chaos_bounds_and_answers.py`:
```
test(ai): Chaos Lab — bounded provider attempts and answer-wins properties

Per entry call <= len(chain) x 8 provider calls under random fault scripts;
if any leg answers, its text is returned; garbage JSON never parses to a
populated container.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Task 5 — Invariant 5: a dead vision leg gets exactly one doomed call per deck (fixes BUG B in vision)

**Depends on:** Task 2, which adds `_http_status`.

**Files**
- Modify: `backend/services/ai/vision.py` (the import, and the `is_permanent` check at vision.py:150-156)
- Test: `backend/tests/unit/test_chaos_vision.py`

**Interfaces**
- Consumes:
  - `vision._sync_analyze_vision(b64_image, raw_text="", ai_model="groq", blueprint_context="")`
  - `orchestrator._http_status`
  - the lab's `VISION_LEGS`, `ScriptedProvider.vision_caller`
- Produces: nothing new.

**Steps**

1. **Write the failing test** `backend/tests/unit/test_chaos_vision.py`:
```python
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
```

2. **Run:** `$PY -m pytest backend/tests/unit/test_chaos_vision.py -m "not db" -q`. Expected: it fails on the explicit example with `AssertionError: gemini_vision answered 404 and was called 50 times for a 50-slide deck`. vision.py:150-156 sees neither `status_code` nor "error code: 404" in a google-genai `ClientError`.

3. **Minimal implementation** in `backend/services/ai/vision.py`:
   - (i) OLD `    _rotator, parse_json_response\n)` → NEW `    _rotator, parse_json_response, _http_status\n)`
   - (ii) OLD `                getattr(exc, "status_code", None) in (402, 404)` → NEW `                _http_status(exc) in (402, 404)`

4. **Run to green:**
   - `$PY -m pytest backend/tests/unit/test_chaos_vision.py backend/tests/unit/test_provider_failover_hardening.py backend/tests/unit/test_ai_models_smoke.py -m "not db" -q`. Expected: all pass.
   - Then run the whole lab plus the unit suite: `$PY -m pytest backend/tests/unit -m "not db" -q`.

5. **Mutation-verify** in `backend/services/ai/vision.py`. Undo each one after checking.
   - (a) Revert the fix: OLD `                _http_status(exc) in (402, 404)` → NEW `                getattr(exc, "status_code", None) in (402, 404)`. Expected: the gemini_vision 404 example fails (50 calls).
   - (b) Remove the disabled-provider filter: OLD `    providers = [p for p in providers if not _rotator.is_disabled(p)]` → NEW `    providers = list(providers)`. Expected: every example fails (the dead leg is called on every slide).

6. **Commit** `backend/services/ai/vision.py` and `backend/tests/unit/test_chaos_vision.py`:
```
fix(ai): vision disables a google-genai leg on 404/402

gemini_vision (head of the vision chain) raises google-genai errors whose
status is on .code, so a retired Gemini slug was never classified as
permanent and fired one doomed request per slide. Reuse _http_status().
Chaos Lab property: a dead vision leg gets exactly one call per deck.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## Follow-ups observed, deliberately out of scope
- **Arq worker never calls `init_redis()`** (`backend/workers/arq_worker.py:74-78`). After Task 3 the ceiling holds per process, but the worker still never writes or reads the fleet-wide counters (the provider daily counts or openai cost). Wiring `init_redis()` into the worker's `startup` would restore the fleet-wide cap.
- **`parse_json_response` returns scalars for scalar JSON** (`'null'`→`None`, `'42'`→`42`). A truncated array with exactly one complete object (`'[{"a":"x"},{"a":"y'`) comes back as the dict `{'a':'x'}`, not a list. I verified both by running the function. `as_slide_item_list` absorbs the second case; the first could break callers that call `.get` on the result, such as vision results.

### Critical Files for Implementation
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/services/ai/orchestrator.py
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/services/ai/vision.py
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/services/llm_client.py
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/tests/support/chaos_lab.py (new)
- /Users/abdullahabobaker/Desktop/ascend-academy/.claude/worktrees/ai-backend-architecture-bbd7fd/backend/tests/conftest.py (reference: outbound guard, fake_redis, Hypothesis "ascend" profile, provider-key blanking)
