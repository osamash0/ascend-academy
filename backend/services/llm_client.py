import asyncio
import logging
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
)

logger = logging.getLogger(__name__)


class LLMTimeoutError(Exception):
    pass


class LLMRateLimitError(Exception):
    pass


def _is_retryable(exc: Exception) -> bool:
    """Return True for rate limits and transient errors, False for bad inputs."""
    msg = str(exc).lower()
    return any(k in msg for k in ("429", "rate limit", "quota", "503", "timeout"))


@retry(
    retry=retry_if_exception_type(LLMRateLimitError),
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=2, min=4, max=30),
    reraise=True,
)
async def _call_with_retry(fn):
    """
    fn must be a zero-argument callable (lambda/partial) — called fresh each retry.
    Dispatches to a thread executor so sync SDK calls don't block the event loop.
    """
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, fn)
    except LLMRateLimitError:
        raise
    except Exception as exc:
        if _is_retryable(exc):
            raise LLMRateLimitError(str(exc)) from exc
        raise


async def call_llm(fn, timeout_seconds: float = 25.0):
    """
    Wraps any LLM call with:
    - 25s hard timeout (raises LLMTimeoutError)
    - 3x exponential backoff on rate limits / transient errors

    fn must be a CALLABLE (lambda or partial), NOT a coroutine.
    For sync SDK calls (Groq, Gemini, Ollama), pass a lambda:
        result = await call_llm(lambda: groq_client.chat.completions.create(...).choices[0].message.content)

    The callable is dispatched to a thread executor so it never blocks the event loop.
    """
    try:
        return await asyncio.wait_for(
            _call_with_retry(fn),
            timeout=timeout_seconds,
        )
    except asyncio.TimeoutError:
        raise LLMTimeoutError(f"LLM call exceeded {timeout_seconds}s timeout")
