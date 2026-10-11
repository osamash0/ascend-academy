"""Per-call LLM accounting context (Arc 7).

The parse orchestrator knows which run, slide and prompt an LLM call belongs
to; the accounting tail (orchestrator._account_for_call) knows which provider
served it and what it cost. A ContextVar carries the first to the second
without changing any signature in between: synthesis.analyze_slide,
generate_text_bulk and batch_analyze_text_slides are shared with other callers
and copied by test fakes.

Rules that keep this correct under asyncio:
  - asyncio.gather wraps each coroutine in a Task, and a Task copies the
    context when it is CREATED. A per-slide scope must therefore be entered
    inside each coroutine (unified_orchestrator._synthesize_slide_scoped),
    never around the gather.
  - asyncio.to_thread copies the context into the worker thread.
  - ``calls`` is one list shared by reference with every child context, so a
    call recorded in any Task of a parse lands in that parse's list.
Concurrent parses in one worker run in separate Tasks and never see each
other's context (a module global would mix them).
"""
from __future__ import annotations

import contextlib
import dataclasses
import logging
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import Any, Iterator, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Upper bound on calls kept in memory per parse. A 136-page deck makes ~20
# batch calls plus fallbacks; this only stops a runaway loop from growing the
# list without limit.
MAX_RECORDED_CALLS = 5000


@dataclass(frozen=True)
class ServedCall:
    provider: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    prompt_name: Optional[str]
    slide_indices: Optional[Tuple[int, ...]]


@dataclass(frozen=True)
class LLMCallContext:
    run_id: Optional[str] = None
    slide_indices: Optional[Tuple[int, ...]] = None
    prompt_name: Optional[str] = None
    calls: Optional[List[ServedCall]] = None


_CURRENT: ContextVar[LLMCallContext] = ContextVar("llm_call_context", default=LLMCallContext())


def current_llm_call_context() -> LLMCallContext:
    return _CURRENT.get()


def push_llm_call_context(**changes: Any) -> Token:
    return _CURRENT.set(dataclasses.replace(_CURRENT.get(), **changes))


def pop_llm_call_context(token: Token) -> None:
    _CURRENT.reset(token)


@contextlib.contextmanager
def llm_call_scope(**changes: Any) -> Iterator[LLMCallContext]:
    token = push_llm_call_context(**changes)
    try:
        yield _CURRENT.get()
    finally:
        pop_llm_call_context(token)


def record_served_call(call: ServedCall) -> None:
    """Append to the current parse's call list, if any. Never raises."""
    try:
        sink = _CURRENT.get().calls
        if sink is not None and len(sink) < MAX_RECORDED_CALLS:
            sink.append(call)
    except Exception as exc:
        logger.warning("could not record served LLM call (non-fatal): %s", exc)
