"""Paid methods (ai_vision, ai_vision_strong): the API key file, the price table, the cost estimate shown
before a run, the cost of a run from the API's own usage fields, and the account's live model list.

The key is read only from KEY_FILE, never from the environment or a .env file, and only when that file is a
regular file of this user with mode 0600. key_problem() only stats the file (it never opens or reads it);
only read_key() reads it. The key never leaves this module or the runner: it is never printed, logged,
stored in a run record or a job, or put in an error message (redact() takes it out, and anything shaped
like an OpenAI key with it).

Standard library only: the bench must not import the app, and the OpenAI SDK would read OPENAI_* variables
and proxies from the environment.
"""
from __future__ import annotations

import http.client
import json
import math
import os
import re
import stat
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

KEY_FILE = Path.home() / ".config" / "learnstation-parser-bench" / "openai_key"
API_HOST = "api.openai.com"
MODELS_URL = f"https://{API_HOST}/v1/models"
MODELS_TIMEOUT = 30
MAX_OUTPUT_TOKENS = 16384  # the runner's max_completion_tokens per page: the estimate's worst case
REDACTED = "sk-…(redacted)"
_SECRET = re.compile(r"sk-[A-Za-z0-9*_\-]{4,}")


class KeyFileError(RuntimeError):
    """The key file is missing, empty, not a regular file, someone else's, or readable by others."""


def _shown(path: Path) -> str:
    return str(path).replace(str(Path.home()), "~")


def key_problem(path: Path | None = None) -> str | None:
    """Why the key file cannot be used, or None when it can. The message names the path, never the key.

    Only stats the file: it never opens or reads it (so a whitespace-only file passes here and is refused
    by read_key)."""
    path = KEY_FILE if path is None else path
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return f"key file missing ({_shown(path)})"
    except OSError as e:
        return f"key file unreadable ({_shown(path)}: {type(e).__name__})"
    if not stat.S_ISREG(info.st_mode):
        return f"key file is not a regular file ({_shown(path)})"
    if info.st_uid != os.getuid():
        return f"key file belongs to another user ({_shown(path)})"
    mode = stat.S_IMODE(info.st_mode)
    if mode != 0o600:
        return f"key file must have mode 0600, not {mode:04o} ({_shown(path)})"
    if info.st_size == 0:
        return f"key file is empty ({_shown(path)})"
    return None


def read_key(path: Path | None = None) -> str:
    path = KEY_FILE if path is None else path
    problem = key_problem(path)
    if problem:
        raise KeyFileError(problem)
    key, failure = "", None
    try:
        key = path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError) as e:
        failure = type(e).__name__  # only the name: a UnicodeDecodeError carries the whole file in .object
    # raised outside the except block, so no exception (and no file content) rides along as __context__
    if failure:
        raise KeyFileError(f"key file unreadable ({_shown(path)}: {failure})")
    if not key:
        raise KeyFileError(f"key file is empty ({_shown(path)})")
    if any(c.isspace() or not c.isprintable() for c in key):
        raise KeyFileError(f"key file must hold the key on one line, with no spaces or control characters ({_shown(path)})")
    return key


def redact(text: str, key: str | None = None) -> str:
    if key:
        text = text.replace(key, REDACTED)
    return _SECRET.sub(REDACTED, text)


@dataclass(frozen=True)
class Price:
    input_per_m: float       # USD per 1M input tokens (the page image and the prompt)
    output_per_m: float      # USD per 1M output tokens (a reasoning model's reasoning tokens bill as output)
    est_input_tokens: int    # estimate per page: the 2× page image plus the prompt
    est_output_tokens: int   # estimate per page: a transcription (plus reasoning, for a reasoning model)
    checked_on: str          # when the price was read from `source`
    source: str


# Standard tier, per 1M tokens. Set or re-checked in Plan 3a Task 16, with Abi, before any paid run.
PRICES: dict[str, Price] = {
    # gpt-4.1-mini: the probe page (a 2× landscape slide) took 3,292 input tokens (2026-10-31).
    "gpt-4.1-mini": Price(0.40, 1.60, 3_300, 1_000, "2026-10-31", "https://developers.openai.com/api/docs/pricing"),
    # gpt-6.1-sol: the probe page took 2,445 input tokens and no reasoning tokens (2026-10-31).
    "gpt-6.1-sol": Price(2.00, 10.00, 2_500, 1_000, "2026-10-31", "https://developers.openai.com/api/docs/pricing"),
}


def price_of(model: str) -> Price:
    if not model:
        raise ValueError("no model id is set for this method (tools.py, set in the protocol step)")
    try:
        return PRICES[model]
    except KeyError:
        raise ValueError(f"no price recorded for {model!r}: add it to paid.PRICES with the date and source "
                         "it was read from") from None


def usd(value: float, *, round_up: bool = False) -> str:
    """Dollars as the cost OK shows them: to the cent, and "<$0.01" for less than half a cent. A ceiling
    (round_up) is shown rounded up to the next cent, so "at most" is never understated."""
    if round_up:
        return f"${math.ceil(round(value * 100, 6)) / 100:.2f}"
    return "<$0.01" if 0 < value < 0.005 else f"${value:.2f}"


@dataclass(frozen=True)
class Estimate:
    model: str
    pages: int
    usd: float       # expected, from the price table's per-page token estimate
    max_usd: float   # if every page wrote MAX_OUTPUT_TOKENS

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    def line(self, tool_id: str) -> str:
        return (f"{tool_id}: {self.pages} page image{'' if self.pages == 1 else 's'} to OpenAI ({self.model}), "
                f"estimated {usd(self.usd)}, at most {usd(self.max_usd, round_up=True)}")


def estimate(model: str, pages: int) -> Estimate:
    price = price_of(model)
    if pages < 1:
        raise ValueError(f"an estimate needs at least one page, not {pages}")
    fixed = price.est_input_tokens * price.input_per_m
    per_page = (fixed + price.est_output_tokens * price.output_per_m) / 1e6
    worst = (fixed + MAX_OUTPUT_TOKENS * price.output_per_m) / 1e6
    return Estimate(model, pages, round(pages * per_page, 4), round(pages * worst, 4))


def _billed_without_usage(page: Mapping[str, Any]) -> bool:
    """A page that is billed, or may be, but whose token counts we do not have: the API answered 2xx and the
    runner flagged it (billed_unknown_usage) or the answer came without a usage object, or the run was stopped
    while its request was in flight (interrupted_in_flight)."""
    if page.get("prompt_tokens") is not None:
        return False
    if page.get("billed_unknown_usage") or page.get("interrupted_in_flight"):  # in flight when stopped: maybe billed
        return True
    return any(isinstance(a, dict) and isinstance(a.get("status"), int) and 200 <= a["status"] < 300
               for a in page.get("attempts") or [])


def cost(model: str, api: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """What a run spent, from the usage the API reported for each answered page, at the recorded price.
    A page that was billed but whose usage is unknown is counted in `pages_billed_without_usage` and makes
    `usd` a lower bound (`usd_is_lower_bound`): it is never silently left out."""
    if not api:
        return None
    price = price_of(model)
    records = [p for p in (api.get("pages") or {}).values() if isinstance(p, dict)]
    answered = [p for p in records if p.get("prompt_tokens") is not None]
    unknown = sum(1 for p in records if _billed_without_usage(p))

    def total(field: str) -> int:
        return sum(int(p.get(field) or 0) for p in answered)

    prompt, completion = total("prompt_tokens"), total("completion_tokens")
    basis = ("the API's usage fields at the recorded price; cached input is counted at the full price, so this "
             "is an upper bound; failed attempts are not billed; this is not the invoice")
    if unknown:
        basis += (f"; {unknown} page(s) were billed or may have been (usage unreadable, or the request was in flight "
                  "when the run stopped) and are NOT in this figure, so it is a lower bound")
    return {
        "requests": len(answered),
        "pages_billed_without_usage": unknown,
        "usd_is_lower_bound": bool(unknown),
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "cached_tokens": total("cached_tokens"),
        "reasoning_tokens": total("reasoning_tokens"),
        "usd": round((prompt * price.input_per_m + completion * price.output_per_m) / 1e6, 6),
        "price": {"model": model, **asdict(price)},
        "basis": basis,
    }


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect: urllib would re-send the Authorization header to the new location. Returning
    None makes any 3xx surface as an HTTPError."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


def direct_opener() -> urllib.request.OpenerDirector:
    """The one rule for every request that carries the key: no proxies (an empty ProxyHandler ignores
    HTTP(S)_PROXY and the system settings) and no redirects. The paid runner runs in its own environment: if
    it cannot import this module it must copy these two handlers."""
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def _direct_open(request: urllib.request.Request, timeout: float):
    return direct_opener().open(request, timeout=timeout)


def list_models(*, key_file: Path | None = None,
                opener: Callable[[urllib.request.Request, float], Any] | None = None) -> list[str]:
    """The model ids this account can use right now (GET /v1/models; free). For choosing ai_vision_strong."""
    key = read_key(key_file)
    request = urllib.request.Request(MODELS_URL, headers={"Authorization": f"Bearer {key}"})
    open_ = opener or _direct_open
    try:
        with open_(request, MODELS_TIMEOUT) as answer:
            data = json.loads(answer.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", errors="replace")[:300]
        except (OSError, http.client.HTTPException):
            body = ""
        message = f"listing models failed: HTTP {e.code} {redact(body, key)}"
    except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException) as e:
        message = f"listing models failed: {type(e).__name__}: {redact(str(e), key)}"
    else:
        return sorted(m["id"] for m in data.get("data", []) if isinstance(m, dict) and isinstance(m.get("id"), str))
    raise RuntimeError(message)  # outside the except block: the HTTP error (and its request) is not chained
