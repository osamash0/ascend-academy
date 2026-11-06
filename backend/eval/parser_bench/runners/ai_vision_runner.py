"""`ai_vision`, `ai_vision_strong`: each requested page rendered at 2× (PNG) and sent to the OpenAI chat
completions endpoint with one fixed prompt, one request per page.

Only the pages named by --pages are rendered and sent. The key is read from --key-file, which must be a
regular file of this user with mode 0600; it is never printed, and every message this runner writes has the
key, and anything shaped like an OpenAI key, taken out. The network goes to api.openai.com only: the endpoint
is fixed here, proxies from the environment are ignored, and a redirect is never followed (urllib would
send the Authorization header on to the new location): any 3xx fails the page.

Transient failures (HTTP 429 except insufficient_quota, 500, 502, 503, 504, a timeout, a lost connection or
any other OSError before an answer came) are retried, MAX_ATTEMPTS in all, waiting Retry-After (between 0
and MAX_WAIT) or BACKOFF; every attempt is recorded. An answer that was received (any 2xx, which is billed)
is never retried: a body that is cut off or is not JSON, or an empty answer, fails the page. A page that
still fails, or comes back empty, fails the run: the runner writes what it has (the pages done, the usage
and attempts of every page, and "failed") and exits 3, so the cost stays on record. So does any unexpected
error (a Ctrl-C too, which is then raised again). SIGTERM (what the bench sends first when it stops a run) is
treated like Ctrl-C, so a stopped run still writes its record; a request that was in flight when it stopped
is recorded as "interrupted_in_flight" (it may have been billed). A truncated answer (finish_reason "length") is kept; its
usage record says so.

Usage: python -I ai_vision_runner.py <in.pdf> <out.json> --pages 2,5 --model <id>
       --temperature <number|default> --key-file <path>
"""
import argparse
import base64
import http.client
import json
import math
import os
import re
import signal
import stat
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from importlib.metadata import version

ENDPOINT = "https://api.openai.com/v1/chat/completions"
PROMPT = ("Transcribe this page to Markdown. Add nothing: no introduction, no comment, "
          "no code fence around the answer.")
ZOOM = 2.0
MAX_OUTPUT_TOKENS = 16384
TIMEOUT = 120          # seconds per request
MAX_ATTEMPTS = 4       # per page: the first try and three retries
BACKOFF = (2, 4, 8)    # seconds before retry 1, 2, 3 when the answer names no Retry-After
MAX_WAIT = 30          # a longer Retry-After is cut to this
RETRY_STATUS = frozenset({429, 500, 502, 503, 504})
REDACTED = "sk-…(redacted)"
_SECRET = re.compile(r"sk-[A-Za-z0-9*_\-]{4,}")


class PageFailed(Exception):
    """A page that got no usable answer. The message is already redacted; `attempts` says what was tried.
    `billed` is True when the endpoint answered 2xx (so the page was charged) but the answer gave no usage."""

    def __init__(self, message, attempts, billed=False):
        super().__init__(message)
        self.attempts = attempts
        self.billed = billed


def redact(text, key):
    if key:
        text = text.replace(key, REDACTED)
    return _SECRET.sub(REDACTED, text)


def read_key(path):
    """The key from a regular file of this user with mode 0600 (the rule of paid.read_key, repeated because
    this runner imports nothing from the bench); SystemExit, never carrying the key or the file's bytes."""
    problem = None
    try:
        info = os.lstat(path)
    except OSError as e:
        info, problem = None, "the key file is missing" if isinstance(e, FileNotFoundError) else f"the key file is unreadable ({type(e).__name__})"
    if info is not None and (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600):
        problem = "the key file must be a regular file of this user with mode 0600"
    key = ""
    if problem is None:
        try:
            with open(path, encoding="utf-8") as f:
                key = f.read().strip()
        except (OSError, UnicodeDecodeError) as e:
            problem = f"the key file is unreadable ({type(e).__name__})"  # only the name: a decode error carries the bytes
    if problem is None and not key:
        problem = "the key file is empty"
    if problem is None and any(c.isspace() or not c.isprintable() for c in key):
        problem = "the key file must hold the key on one line, with no spaces or control characters"
    if problem:  # raised outside every except block: nothing rides along as __context__
        raise SystemExit(f"ai_vision_runner: {problem}")
    return key


def render(pdf, pages):
    """Each requested page as a PNG at ZOOM; no other page is rendered."""
    import pymupdf

    images = {}
    with pymupdf.open(pdf) as doc:
        for n in pages:
            if not 1 <= n <= doc.page_count:
                raise SystemExit(f"ai_vision_runner: page {n} is outside 1–{doc.page_count}")
            images[n] = doc[n - 1].get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM)).tobytes("png")
    return images


def request_body(model, temperature, png):
    body = {
        "model": model,
        "max_completion_tokens": MAX_OUTPUT_TOKENS,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode("ascii")}},
        ]}],
    }
    if temperature is not None:
        body["temperature"] = temperature
    return body


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect: urllib would re-send the Authorization header to the new location. Returning
    None makes any 3xx surface as an HTTPError (the rule of paid.direct_opener, repeated for the same reason)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _opener():
    """Straight to the endpoint: an empty ProxyHandler ignores HTTP(S)_PROXY and the system proxy settings."""
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())


def _open(request, timeout):
    return _opener().open(request, timeout=timeout)


def _error(e):
    """(OpenAI's error code, the parameter it names, one line of text) from an HTTP error."""
    try:
        raw = e.read().decode("utf-8", errors="replace")
    except (OSError, http.client.HTTPException):  # a cut-off error body (IncompleteRead) is no reason to crash
        raw = ""
    try:
        err = json.loads(raw).get("error") or {}
    except (ValueError, AttributeError):
        err = {}
    if not isinstance(err, dict):
        err = {}
    code = err.get("code")
    message = err.get("message") or raw[:200] or str(e.reason)
    return code, err.get("param"), f"HTTP {e.code}" + (f" {code}" if code else "") + f": {message}"


def _backoff(attempt):
    return min(BACKOFF[min(attempt - 1, len(BACKOFF) - 1)], MAX_WAIT)


def _wait(e, attempt):
    after = e.headers.get("Retry-After") if e.headers is not None else None
    try:
        seconds = float(after)
    except (TypeError, ValueError):
        return _backoff(attempt)
    if not math.isfinite(seconds):  # "nan", "inf": not a time
        return _backoff(attempt)
    return min(max(seconds, 0.0), MAX_WAIT)


def post(body, key, *, opener=None, sleep=None, attempts=None):
    """One page's request with bounded retries: (the answer, every attempt). PageFailed when none succeeds.
    `attempts` may be a list the caller keeps: every attempt is appended to it as it is made, so a crash
    elsewhere still leaves the record.

    Only a request that got no answer at all, or a transient HTTP error, is sent again. Once the endpoint
    answered 2xx the request is billed, so whatever follows (a body cut off, not JSON) ends the page. Every
    PageFailed is raised outside the except blocks, so no exception (with its request) rides along."""
    opener = opener or _open
    data = json.dumps(body).encode("utf-8")
    attempts = [] if attempts is None else attempts
    failed, billed = None, False
    for attempt in range(1, MAX_ATTEMPTS + 1):
        record = {"attempt": attempt, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "in_flight": True}
        attempts.append(record)  # on the trail before the request leaves: an interrupt mid-request still leaves it
        request = urllib.request.Request(ENDPOINT, data=data, method="POST",
                                         headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        start = time.monotonic()
        answer, retry, wait = None, False, 0
        try:
            answer = opener(request, TIMEOUT)
        except urllib.error.HTTPError as e:
            code, param, text = _error(e)
            if 300 <= e.code < 400:
                text += " (a redirect is never followed)"
            record.update(status=e.code, error=redact(text, key))
            if e.code == 400 and param == "temperature":
                failed = f"the model rejects temperature={body.get('temperature')!r} ({record['error']})"
            retry, wait = e.code in RETRY_STATUS and code != "insufficient_quota", _wait(e, attempt)
        except (OSError, http.client.HTTPException) as e:
            # URLError, a timeout, and what urllib does not wrap (getresponse(): ConnectionResetError,
            # RemoteDisconnected, ssl.SSLError): no answer came, so the request is sent again
            record.update(status=None, error=redact(f"{type(e).__name__}: {getattr(e, 'reason', e)}", key))
            retry, wait = True, _backoff(attempt)
        record["seconds"] = round(time.monotonic() - start, 2)
        if answer is None:
            del record["in_flight"]
        else:
            status = getattr(answer, "status", None) or 200
            payload = None
            try:
                with answer:
                    payload = json.loads(answer.read().decode("utf-8"))
            except (OSError, http.client.HTTPException) as e:
                record.update(status=status, error=f"the answer was cut off while reading ({type(e).__name__})")
                failed = "the answer was cut off while reading"
            except ValueError:  # not JSON (or not UTF-8)
                record.update(status=status, error="the answer was not JSON")
                failed = "the answer was not JSON"
            record["seconds"] = round(time.monotonic() - start, 2)
            del record["in_flight"]
            if failed is None:
                record["status"] = status
            else:
                billed = True
            if failed is None:
                return payload, attempts
            break  # received means billed: never sent again
        if failed is not None or not retry:
            break
        if attempt < MAX_ATTEMPTS:
            record["wait_s"] = wait
            (sleep or time.sleep)(wait)
    else:
        failed = f"no answer after {MAX_ATTEMPTS} attempts (last: {attempts[-1]['error']})"
    if failed is None:  # a non-retryable HTTP error
        failed = attempts[-1]["error"]
    raise PageFailed(failed, attempts, billed)


def usage_of(answer):
    usage = answer.get("usage") or {}
    choice = (answer.get("choices") or [{}])[0] or {}
    return {
        "model": answer.get("model"),
        "response_id": answer.get("id"),
        "system_fingerprint": answer.get("system_fingerprint"),
        "finish_reason": choice.get("finish_reason"),
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "cached_tokens": (usage.get("prompt_tokens_details") or {}).get("cached_tokens"),
        "reasoning_tokens": (usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
    }


def content_of(answer):
    """The answer's text, or None when it is empty (a refusal, or every token spent before any text)."""
    choice = (answer.get("choices") or [{}])[0] or {}
    content = (choice.get("message") or {}).get("content")
    return content if isinstance(content, str) and content.strip() else None


def parse(argv):
    parser = argparse.ArgumentParser(prog="ai_vision_runner")
    parser.add_argument("pdf")
    parser.add_argument("out")
    parser.add_argument("--pages", required=True, type=lambda s: sorted({int(x) for x in s.split(",") if x.strip()}))
    parser.add_argument("--model", required=True)
    parser.add_argument("--temperature", required=True, help='a number, or "default" to leave it to the model')
    parser.add_argument("--key-file", required=True)
    args = parser.parse_args(argv)
    if not args.model.strip():
        parser.error("--model is empty")
    if not args.pages:
        parser.error("--pages names no page")
    args.temperature = None if args.temperature == "default" else float(args.temperature)
    return args


def settings(args):
    return {
        "model": args.model,
        "prompt": PROMPT,
        "zoom": ZOOM,
        "image": "PNG as a data URL; detail not set (the API default)",
        "temperature": "model default" if args.temperature is None else args.temperature,
        "max_completion_tokens": MAX_OUTPUT_TOKENS,
        "one_request_per_page": True,
        "pages_sent": args.pages,
        "timeout_s": TIMEOUT,
        "max_attempts": MAX_ATTEMPTS,
        "retry_on": sorted(RETRY_STATUS),
        "endpoint": ENDPOINT,
        "renderer": f"pymupdf {version('pymupdf')}",
        "http": "urllib (Python standard library), proxies ignored",
    }


def _on_sigterm(signum, frame):
    raise KeyboardInterrupt  # the interrupt path below writes the record


class _sigterm_as_interrupt:
    """While active, SIGTERM is a Ctrl-C (Python runs the handler even while a request is blocked), so a
    stopped run still writes what it was charged for. The previous handler comes back on exit."""

    def __enter__(self):
        try:
            self.previous = signal.signal(signal.SIGTERM, _on_sigterm)
        except ValueError:  # not the main thread: nothing to install
            self.previous = None
        return self

    def ignore(self):
        """The record is being written: a second SIGTERM must not interrupt that."""
        if self.previous is not None:
            signal.signal(signal.SIGTERM, signal.SIG_IGN)

    def __exit__(self, *exc):
        if self.previous is not None:
            signal.signal(signal.SIGTERM, self.previous)
        return False


def main(argv):
    args = parse(argv[1:])
    key = read_key(args.key_file)
    images = render(args.pdf, args.pages)
    with _sigterm_as_interrupt() as term:
        _run(args, key, images, term)


def _run(args, key, images, term):
    pages, usage, failure, interrupt = {}, {}, None, None
    n, start, trail = None, time.monotonic(), []
    try:
        for n in args.pages:
            start, trail = time.monotonic(), []
            try:
                answer, attempts = post(request_body(args.model, args.temperature, images[n]), key, attempts=trail)
            except PageFailed as e:
                usage[str(n)] = _failed_usage(e.attempts, start, e.billed)
                failure = f"page {n}: {e}"
                break
            record = dict(usage_of(answer), attempts=attempts, requested_at=attempts[0]["at"],
                          seconds=round(time.monotonic() - start, 2))
            usage[str(n)] = record
            print(f"page {n}: {record['prompt_tokens']} in / {record['completion_tokens']} out tokens, {record['model']}, "
                  f"finish {record['finish_reason']}, {len(attempts)} attempt(s), {record['seconds']} s", flush=True)
            text = content_of(answer)
            if text is None:
                failure = f"page {n}: empty answer (finish_reason {record['finish_reason']!r})"
                break
            pages[str(n)] = text
    except BaseException as e:  # anything unexpected, Ctrl-C and SIGTERM included: what was paid for is still written below
        term.ignore()
        if trail and str(n) not in usage:
            usage[str(n)] = _failed_usage(trail, start, billed=any(200 <= (a.get("status") or 0) < 300 for a in trail))
        try:
            detail = str(e)
        except Exception:  # an exception whose text cannot be made must not cost the record
            detail = "(no message)"
        failure = f"page {n}: unexpected {type(e).__name__}: {detail}"
        interrupt = e if isinstance(e, KeyboardInterrupt) else None
    models = sorted({r["model"] for r in usage.values() if r.get("model")})
    result = {"version": "+".join(models) or "unknown", "settings": settings(args), "pages": pages,
              "api": {"endpoint": ENDPOINT, "model_requested": args.model, "pages": usage}}
    if failure:
        result["failed"] = redact(failure, key)
    term.ignore()  # a SIGTERM now would only cut the record short
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    if failure:
        print(f"ai_vision_runner: {result['failed']}", file=sys.stderr, flush=True)
        if interrupt is not None:
            raise interrupt
        raise SystemExit(3)


def _failed_usage(attempts, start, billed):
    """The usage record of a page with no usable answer: what was tried and when, and whether it was charged.
    A request still in flight when the run stopped is marked: it may have been billed."""
    in_flight = any(a.get("in_flight") for a in attempts)
    attempts = [{**{k: v for k, v in a.items() if k != "in_flight"}, "interrupted": True} if a.get("in_flight") else a
                for a in attempts]
    record = {"attempts": attempts, "requested_at": attempts[0]["at"] if attempts else None,
              "seconds": round(time.monotonic() - start, 2)}
    if in_flight:
        record["interrupted_in_flight"] = True
    if billed:
        record["billed_unknown_usage"] = True  # answered 2xx but the answer carries no usage: a cost step must flag it
    return record


if __name__ == "__main__":
    main(sys.argv)
