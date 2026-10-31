"""The paid runner against a stand-in for urllib's opener: no socket, no network, no key. (The unit tests'
network guard in backend/tests/conftest.py refuses every socket, 127.0.0.1 included.)"""
import base64
import http.client
import importlib.util
import io
import json
import os
import signal
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

import backend.eval.parser_bench as bench_pkg
from backend.eval.parser_bench import paid
from backend.tests.unit.parser_bench_fixtures import make_deck

RUNNER = Path(bench_pkg.__file__).parent / "runners" / "ai_vision_runner.py"
KEY = "sk-test-SECRET-0123456789"


def _load():
    spec = importlib.util.spec_from_file_location("ai_vision_runner", RUNNER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeOpenAI:
    """Stands in for the runner's opener (`_open`): answers from a script of (status, body, headers), or
    "timeout" for a lost connection, and records every request. Nothing leaves the process."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.requests = []

    def __call__(self, request, timeout):
        self.requests.append({"url": request.full_url, "auth": request.get_header("Authorization"),
                              "timeout": timeout, "body": json.loads(request.data)})
        answer = self.answers.pop(0) if self.answers else (500, {"error": {"message": "no answer left"}}, {})
        if answer == "timeout":
            raise urllib.error.URLError(TimeoutError("timed out"))
        if isinstance(answer, BaseException):  # what urllib lets through unwrapped (it wraps only request errors)
            raise answer
        status, body, headers = answer
        data = io.BytesIO(json.dumps(body).encode())
        if status != 200:
            raise urllib.error.HTTPError(request.full_url, status, "error", headers, data)
        return data


def ok(text="# Heading\n\n- a point", model="gpt-test-2026-01-01", prompt=1200, completion=80, finish="stop"):
    return (200, {"id": "chatcmpl-1", "model": model, "system_fingerprint": "fp_1",
                  "choices": [{"message": {"role": "assistant", "content": text}, "finish_reason": finish}],
                  "usage": {"prompt_tokens": prompt, "completion_tokens": completion,
                            "prompt_tokens_details": {"cached_tokens": 0}, "completion_tokens_details": {"reasoning_tokens": 0}}}, {})


def error(status, code=None, param=None, message="boom", headers=None):
    return (status, {"error": {"message": message, "code": code, "param": param, "type": "x"}}, headers or {})


@pytest.fixture
def runner(monkeypatch):
    module = _load()
    monkeypatch.setattr(module, "BACKOFF", (0, 0, 0))
    monkeypatch.setattr(module, "MAX_WAIT", 0)
    return module


@pytest.fixture
def serve(runner, monkeypatch):
    def start(*answers):
        fake = FakeOpenAI(answers)
        monkeypatch.setattr(runner, "_open", fake)
        return fake

    return start


@pytest.fixture
def files(tmp_path):
    key = tmp_path / "openai_key"
    key.write_text(KEY + "\n")
    key.chmod(0o600)
    return make_deck(tmp_path / "deck.pdf"), tmp_path / "out.json", key


def argv(files, pages="2,5", temperature="0.0", model="gpt-test"):
    deck, out, key = files
    return ["runner", str(deck), str(out), "--pages", pages, "--model", model, "--temperature", temperature, "--key-file", str(key)]


def test_only_the_requested_pages_are_sent_one_request_each(runner, serve, files):
    fake = serve(ok("# Two"), ok("# Five"))
    runner.main(argv(files))
    data = json.loads(files[1].read_text(encoding="utf-8"))
    assert data["pages"] == {"2": "# Two", "5": "# Five"} and data["version"] == "gpt-test-2026-01-01"
    assert len(fake.requests) == 2 and all(r["auth"] == f"Bearer {KEY}" for r in fake.requests)
    assert {(r["url"], r["timeout"]) for r in fake.requests} == {("https://api.openai.com/v1/chat/completions", 120)}
    body = fake.requests[0]["body"]
    assert (body["model"], body["temperature"], body["max_completion_tokens"]) == ("gpt-test", 0.0, 16384)
    [text, image] = body["messages"][0]["content"]
    assert text == {"type": "text", "text": runner.PROMPT}
    png = base64.b64decode(image["image_url"]["url"].removeprefix("data:image/png;base64,"))
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and int.from_bytes(png[16:20], "big") == 842 * 2  # the page at 2×
    usage = data["api"]["pages"]["5"]
    assert (usage["prompt_tokens"], usage["completion_tokens"], usage["finish_reason"], usage["model"]) == (1200, 80, "stop", "gpt-test-2026-01-01")
    assert [a["status"] for a in usage["attempts"]] == [200] and usage["requested_at"].endswith("+00:00")
    assert data["settings"]["pages_sent"] == [2, 5] and data["settings"]["prompt"] == runner.PROMPT
    assert "failed" not in data


def test_transient_errors_are_retried_and_every_attempt_is_recorded(runner, serve, files):
    fake = serve(error(429, headers={"Retry-After": "0"}), error(503), ok())
    runner.main(argv(files, pages="3"))
    data = json.loads(files[1].read_text(encoding="utf-8"))
    attempts = data["api"]["pages"]["3"]["attempts"]
    assert [a["status"] for a in attempts] == [429, 503, 200] and len(fake.requests) == 3
    assert attempts[0]["wait_s"] == 0 and "HTTP 429" in attempts[0]["error"]


def test_a_lost_connection_is_retried(runner, serve, files):
    fake = serve("timeout", ok())
    runner.main(argv(files, pages="1"))
    attempts = json.loads(files[1].read_text(encoding="utf-8"))["api"]["pages"]["1"]["attempts"]
    assert [a["status"] for a in attempts] == [None, 200] and "URLError" in attempts[0]["error"] and len(fake.requests) == 2


def test_a_page_that_keeps_failing_fails_the_run_and_keeps_what_was_paid_for(runner, serve, files, capsys):
    serve(ok("# Two"), error(500), error(500), error(500), error(500))
    with pytest.raises(SystemExit) as raised:
        runner.main(argv(files))
    assert raised.value.code == 3
    data = json.loads(files[1].read_text(encoding="utf-8"))
    assert data["pages"] == {"2": "# Two"} and data["failed"].startswith("page 5: no answer after 4 attempts")
    assert data["api"]["pages"]["2"]["prompt_tokens"] == 1200
    assert [a["status"] for a in data["api"]["pages"]["5"]["attempts"]] == [500, 500, 500, 500]
    assert "page 5" in capsys.readouterr().err


def test_insufficient_quota_is_not_retried(runner, serve, files):
    fake = serve(error(429, code="insufficient_quota", message="You exceeded your current quota"))
    with pytest.raises(SystemExit):
        runner.main(argv(files, pages="1"))
    assert len(fake.requests) == 1


def test_a_rejected_temperature_is_reported_never_dropped(runner, serve, files):
    fake = serve(error(400, code="unsupported_value", param="temperature",
                       message="Unsupported value: 'temperature' does not support 0 with this model."))
    with pytest.raises(SystemExit):
        runner.main(argv(files, pages="1"))
    data = json.loads(files[1].read_text(encoding="utf-8"))
    assert "rejects temperature=0.0" in data["failed"] and len(fake.requests) == 1


def test_temperature_default_sends_none(runner, serve, files):
    fake = serve(ok())
    runner.main(argv(files, pages="1", temperature="default"))
    assert "temperature" not in fake.requests[0]["body"]
    assert json.loads(files[1].read_text(encoding="utf-8"))["settings"]["temperature"] == "model default"


def test_an_empty_answer_fails_the_run_with_its_usage(runner, serve, files):
    serve(ok(text="", finish="length", completion=16384))
    with pytest.raises(SystemExit):
        runner.main(argv(files, pages="1"))
    data = json.loads(files[1].read_text(encoding="utf-8"))
    assert data["pages"] == {} and "empty answer" in data["failed"] and data["api"]["pages"]["1"]["completion_tokens"] == 16384


def test_a_truncated_answer_is_kept_and_marked(runner, serve, files):
    serve(ok(text="# Long", finish="length"))
    runner.main(argv(files, pages="1"))
    data = json.loads(files[1].read_text(encoding="utf-8"))
    assert data["pages"] == {"1": "# Long"} and data["api"]["pages"]["1"]["finish_reason"] == "length"


def test_the_key_never_appears_in_output_log_or_errors(runner, serve, files, capsys):
    serve(error(401, code="invalid_api_key", message=f"Incorrect API key provided: {KEY}."))
    with pytest.raises(SystemExit):
        runner.main(argv(files, pages="1"))
    captured = capsys.readouterr()
    for text in (captured.out, captured.err, files[1].read_text(encoding="utf-8")):
        assert "SECRET" not in text


@pytest.mark.parametrize("mode, text, says", [(0o644, KEY, "0600"), (0o600, "  ", "empty")])
def test_the_key_file_must_be_private_and_not_empty(runner, files, mode, text, says):
    files[2].write_text(text)
    files[2].chmod(mode)
    with pytest.raises(SystemExit) as raised:
        runner.main(argv(files))
    assert says in str(raised.value.code) and "SECRET" not in str(raised.value.code)
    with pytest.raises(paid.KeyFileError):  # paid.py refuses the same file (a 0644 file at the stat, a blank one at the read)
        paid.read_key(files[2])


@pytest.mark.parametrize("text", [KEY + " extra", "sk-te\tst-1234567", "sk-test-\x00abc1234"])
def test_a_key_with_inner_whitespace_or_control_characters_is_refused_like_paid_does(runner, files, text):
    files[2].write_text(text)
    files[2].chmod(0o600)
    with pytest.raises(SystemExit) as raised:
        runner.main(argv(files))
    assert "one line" in str(raised.value.code) and "SECRET" not in str(raised.value.code) and text not in str(raised.value.code)
    assert raised.value.__context__ is None and raised.value.__cause__ is None
    with pytest.raises(paid.KeyFileError):
        paid.read_key(files[2])


def test_the_key_reader_agrees_with_paid_on_other_files(runner, tmp_path):
    link = tmp_path / "link"
    link.symlink_to(tmp_path)
    folder = tmp_path / "dir"
    folder.mkdir(mode=0o600)
    for path in (link, folder, tmp_path / "missing"):
        with pytest.raises(SystemExit):
            runner.read_key(path)
        with pytest.raises(paid.KeyFileError):
            paid.read_key(path)
    good = tmp_path / "good"
    good.write_text(KEY + "\n")
    good.chmod(0o600)
    assert runner.read_key(good) == paid.read_key(good) == KEY


def test_an_unreadable_key_file_exits_without_chained_file_bytes(runner, tmp_path):
    bad = tmp_path / "bad"
    bad.write_bytes(b"sk-\xff\xfe-SECRET")
    bad.chmod(0o600)
    with pytest.raises(SystemExit) as raised:
        runner.read_key(bad)
    assert "SECRET" not in str(raised.value.code) and raised.value.__context__ is None and raised.value.__cause__ is None


def test_a_missing_key_file_or_a_page_outside_the_file_stops_before_any_request(runner, serve, files):
    fake = serve(ok())
    files[2].unlink()
    with pytest.raises(SystemExit, match="missing"):
        runner.main(argv(files))
    files[2].write_text(KEY)
    files[2].chmod(0o600)
    with pytest.raises(SystemExit, match="outside"):
        runner.main(argv(files, pages="9"))
    assert fake.requests == []


def test_the_endpoint_is_openai_and_proxies_are_ignored(monkeypatch):
    module = _load()
    assert module.ENDPOINT == f"https://{paid.API_HOST}/v1/chat/completions"
    assert module.MAX_OUTPUT_TOKENS == paid.MAX_OUTPUT_TOKENS and module.ZOOM == 2.0
    built = []
    monkeypatch.setattr(urllib.request, "build_opener", lambda *handlers: built.append(handlers) or pytest.fail("stop"))
    with pytest.raises(BaseException):
        module._open(urllib.request.Request(module.ENDPOINT), 1)
    [handlers] = built
    assert isinstance(handlers[0], urllib.request.ProxyHandler) and handlers[0].proxies == {}
    assert any(isinstance(h, urllib.request.HTTPRedirectHandler) for h in handlers[1:])


def test_no_redirect_is_followed_so_the_key_is_never_re_sent(monkeypatch):
    module = _load()
    built = []
    monkeypatch.setattr(urllib.request, "build_opener", lambda *handlers: built.append(handlers) or pytest.fail("stop"))
    with pytest.raises(BaseException):
        module._open(urllib.request.Request(module.ENDPOINT), 1)
    monkeypatch.undo()
    [redirect] = [h for h in built[0] if isinstance(h, urllib.request.HTTPRedirectHandler)]
    request = urllib.request.Request(module.ENDPOINT, headers={"Authorization": f"Bearer {KEY}"})
    assert redirect.redirect_request(request, None, 302, "Found", {}, "https://elsewhere.example/") is None
    # the real opener: urllib's own redirect handler is replaced, and (an empty ProxyHandler adds no handler
    # of its own but keeps the default one, which reads HTTP(S)_PROXY, out) no proxy handler is left
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.invalid:3128")
    opener = module._opener()
    assert not any(type(h) is urllib.request.HTTPRedirectHandler for h in opener.handlers)
    assert any(type(h).__name__ == "_NoRedirect" for h in opener.handlers)
    assert not any(isinstance(h, urllib.request.ProxyHandler) for h in opener.handlers)


@pytest.mark.parametrize("status", [301, 302, 307, 308])
def test_a_redirect_is_not_retried_and_fails_the_page_redacted(runner, serve, files, capsys, status):
    fake = serve(error(status, message=f"moved: {KEY}", headers={"Location": "https://elsewhere.example/v1"}))
    with pytest.raises(SystemExit) as raised:
        runner.main(argv(files, pages="1"))
    assert raised.value.code == 3 and len(fake.requests) == 1
    data = json.loads(files[1].read_text(encoding="utf-8"))
    assert f"HTTP {status}" in data["failed"] and [a["status"] for a in data["api"]["pages"]["1"]["attempts"]] == [status]
    for text in (capsys.readouterr().err, files[1].read_text(encoding="utf-8")):
        assert "SECRET" not in text


def test_nothing_is_retried_after_an_answer_was_received(runner, monkeypatch, files):
    """A 2xx is billed: a body that is cut off or is not JSON fails the page; it never sends a second request."""
    class Cut:
        def __init__(self, exc):
            self.exc = exc

        def read(self):
            raise self.exc

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    for body in (Cut(TimeoutError("read timed out")), Cut(ConnectionResetError("reset")), io.BytesIO(b"<html>not json</html>"),
                 io.BytesIO(b"\xff\xfe")):
        sent = []
        monkeypatch.setattr(runner, "_open", lambda request, timeout, body=body: sent.append(request) or body)
        with pytest.raises(SystemExit) as raised:
            runner.main(argv(files, pages="1"))
        assert raised.value.code == 3 and len(sent) == 1
        attempts = json.loads(files[1].read_text(encoding="utf-8"))["api"]["pages"]["1"]["attempts"]
        assert len(attempts) == 1 and attempts[0]["status"] == 200


def test_an_empty_or_refused_answer_is_never_retried(runner, serve, files):
    for answer in (ok(text="", finish="stop"), (200, {"choices": [{"message": {"content": None, "refusal": "no"}, "finish_reason": "stop"}]}, {})):
        fake = serve(answer, ok())
        with pytest.raises(SystemExit):
            runner.main(argv(files, pages="1"))
        assert len(fake.requests) == 1


def test_the_prompt_is_fixed():
    assert _load().PROMPT == ("Transcribe this page to Markdown. Add nothing: no introduction, no comment, "
                              "no code fence around the answer.")


@pytest.mark.parametrize("raw", [ConnectionResetError("reset by peer"), http.client.RemoteDisconnected("closed"),
                                 ssl.SSLEOFError("EOF occurred"), http.client.IncompleteRead(b"x")])
def test_errors_urllib_does_not_wrap_are_retried_and_recorded(runner, serve, files, raw):
    fake = serve(raw, ok())
    runner.main(argv(files, pages="1"))
    attempts = json.loads(files[1].read_text(encoding="utf-8"))["api"]["pages"]["1"]["attempts"]
    assert [a["status"] for a in attempts] == [None, 200] and type(raw).__name__ in attempts[0]["error"] and len(fake.requests) == 2


def test_an_unwrapped_error_that_keeps_coming_fails_the_page_with_its_attempts(runner, serve, files):
    fake = serve(*[ConnectionResetError(f"reset {KEY}")] * 4)
    with pytest.raises(SystemExit) as raised:
        runner.main(argv(files, pages="1"))
    assert raised.value.code == 3 and len(fake.requests) == 4
    text = files[1].read_text(encoding="utf-8")
    assert "SECRET" not in text and "no answer after 4 attempts" in json.loads(text)["failed"]


def test_a_cut_off_error_body_is_survived(runner, serve, files):
    class CutBody(io.BytesIO):
        def read(self, *a):
            raise http.client.IncompleteRead(b"par")

    def opener(request, timeout):
        raise urllib.error.HTTPError(request.full_url, 500, "error", {}, CutBody())

    runner._open = opener
    with pytest.raises(SystemExit) as raised:
        runner.main(argv(files, pages="1"))
    assert raised.value.code == 3
    assert len(json.loads(files[1].read_text(encoding="utf-8"))["api"]["pages"]["1"]["attempts"]) == 4


@pytest.mark.parametrize("after", ["-1", "nan", "inf", "-inf", "1e999", "soon"])
def test_a_hostile_retry_after_never_crashes_the_wait(runner, serve, files, monkeypatch, after):
    slept = []
    monkeypatch.setattr(runner.time, "sleep", slept.append)
    monkeypatch.setattr(runner, "BACKOFF", (1, 1, 1))
    monkeypatch.setattr(runner, "MAX_WAIT", 5)
    serve(error(429, headers={"Retry-After": after}), ok())
    runner.main(argv(files, pages="1"))
    assert len(slept) == 1 and 0 <= slept[0] <= 5


def test_an_unexpected_error_after_page_one_still_writes_the_record(runner, serve, files, capsys, monkeypatch):
    serve(ok("# Two"))
    real = runner.post

    def post(body, key, **kw):
        if serve_calls:
            raise RuntimeError(f"surprise with {KEY}")
        serve_calls.append(1)
        return real(body, key, **kw)

    serve_calls = []
    monkeypatch.setattr(runner, "post", post)
    with pytest.raises(SystemExit) as raised:
        runner.main(argv(files))
    assert raised.value.code == 3
    data = json.loads(files[1].read_text(encoding="utf-8"))
    assert data["pages"] == {"2": "# Two"} and data["api"]["pages"]["2"]["prompt_tokens"] == 1200
    assert data["failed"].startswith("page 5: unexpected RuntimeError") and "SECRET" not in data["failed"]
    assert "SECRET" not in capsys.readouterr().err


def test_an_unexpected_error_inside_a_page_keeps_that_pages_attempts(runner, serve, files, monkeypatch):
    serve(error(503), ok())
    monkeypatch.setattr(runner, "usage_of", lambda answer: 1 / 0)
    with pytest.raises(SystemExit):
        runner.main(argv(files, pages="1"))
    data = json.loads(files[1].read_text(encoding="utf-8"))
    page = data["api"]["pages"]["1"]
    assert [a["status"] for a in page["attempts"]] == [503, 200] and page["requested_at"] and "ZeroDivisionError" in data["failed"]
    assert page["billed_unknown_usage"] is True


def test_ctrl_c_writes_the_record_then_is_raised_again(runner, serve, files, monkeypatch):
    serve(ok("# Two"))
    calls = []
    real = runner.post

    def post(body, key, **kw):
        if calls:
            raise KeyboardInterrupt
        calls.append(1)
        return real(body, key, **kw)

    monkeypatch.setattr(runner, "post", post)
    with pytest.raises(KeyboardInterrupt):
        runner.main(argv(files))
    data = json.loads(files[1].read_text(encoding="utf-8"))
    assert data["pages"] == {"2": "# Two"} and "KeyboardInterrupt" in data["failed"]


def test_a_billed_answer_without_usage_is_marked_and_every_failed_page_has_requested_at(runner, monkeypatch, files):
    monkeypatch.setattr(runner, "_open", lambda request, timeout: io.BytesIO(b"<html>"))
    with pytest.raises(SystemExit):
        runner.main(argv(files, pages="1"))
    page = json.loads(files[1].read_text(encoding="utf-8"))["api"]["pages"]["1"]
    assert page["billed_unknown_usage"] is True and page["requested_at"].endswith("+00:00")
    runner._open = FakeOpenAI([error(500)] * 4)
    with pytest.raises(SystemExit):
        runner.main(argv(files, pages="1"))
    page = json.loads(files[1].read_text(encoding="utf-8"))["api"]["pages"]["1"]
    assert "billed_unknown_usage" not in page and page["requested_at"].endswith("+00:00")


def test_sigterm_during_a_request_writes_the_record_with_the_request_in_flight(runner, files, monkeypatch):
    answers = [ok("# Two")]

    def opener(request, timeout):
        if answers:
            return io.BytesIO(json.dumps(answers.pop(0)[1]).encode())
        os.kill(os.getpid(), signal.SIGTERM)  # what the bench sends first when it stops a run
        time.sleep(5)  # never reached: the handler raises first

    monkeypatch.setattr(runner, "_open", opener)
    before = signal.getsignal(signal.SIGTERM)
    with pytest.raises(KeyboardInterrupt):
        runner.main(argv(files))
    assert signal.getsignal(signal.SIGTERM) == before  # the handler is only installed while the run is active
    data = json.loads(files[1].read_text(encoding="utf-8"))
    assert data["pages"] == {"2": "# Two"} and "KeyboardInterrupt" in data["failed"]
    page = data["api"]["pages"]["5"]
    assert page["interrupted_in_flight"] is True and page["requested_at"]
    assert page["attempts"][0]["interrupted"] is True and "in_flight" not in page["attempts"][0]
    assert data["api"]["pages"]["2"]["prompt_tokens"] == 1200 and "interrupted_in_flight" not in data["api"]["pages"]["2"]


def test_a_finished_request_is_not_marked_in_flight(runner, serve, files):
    serve(error(503), ok())
    runner.main(argv(files, pages="1"))
    page = json.loads(files[1].read_text(encoding="utf-8"))["api"]["pages"]["1"]
    assert [("in_flight" in a, "interrupted" in a) for a in page["attempts"]] == [(False, False)] * 2
    assert "interrupted_in_flight" not in page
