import builtins
import http.client
import io
import json
import os
import re
import urllib.error
import urllib.request
import urllib.response
from pathlib import Path

import pytest

from backend.eval.parser_bench import paid

KEY = "sk-test-SECRET-0123456789"  # gitleaks:allow — made-up test value, not a credential


def key_file(folder, text=KEY, mode=0o600):
    path = folder / "openai_key"
    path.write_text(text + "\n")
    path.chmod(mode)
    return path


def test_a_private_key_file_is_read_and_stripped(tmp_path):
    path = key_file(tmp_path)
    assert paid.key_problem(path) is None and paid.read_key(path) == KEY


def test_key_problem_only_looks_at_the_file_it_never_opens_or_reads_it(tmp_path, monkeypatch):
    path = key_file(tmp_path)

    def forbidden(*args, **kwargs):
        raise AssertionError("key_problem opened or read the key file")

    for owner, name in [(builtins, "open"), (io, "open"), (os, "open"), (Path, "open"),
                        (Path, "read_text"), (Path, "read_bytes")]:
        monkeypatch.setattr(owner, name, forbidden)
    assert paid.key_problem(path) is None
    assert "must have mode 0600" in paid.key_problem(_chmod(path, 0o644))
    assert paid.key_problem(tmp_path / "absent").startswith("key file missing")


def _chmod(path, mode):
    path.chmod(mode)
    return path


def test_a_missing_key_file_is_named(tmp_path):
    assert paid.key_problem(tmp_path / "absent").startswith("key file missing")


@pytest.mark.parametrize("mode", [0o644, 0o640, 0o604, 0o700])
def test_a_key_file_others_can_read_or_with_another_mode_is_refused(tmp_path, mode):
    problem = paid.key_problem(key_file(tmp_path, mode=mode))
    assert f"0600, not {mode:04o}" in problem and "SECRET" not in problem
    with pytest.raises(paid.KeyFileError):
        paid.read_key(key_file(tmp_path, mode=mode))


def test_an_empty_key_file_is_refused(tmp_path):
    path = key_file(tmp_path, text="")
    path.write_text("")  # zero bytes: key_problem sees it from the size alone
    path.chmod(0o600)
    assert "empty" in paid.key_problem(path)
    with pytest.raises(paid.KeyFileError, match="empty"):
        paid.read_key(path)


def test_a_key_file_of_only_whitespace_is_refused_when_it_is_read(tmp_path):
    path = key_file(tmp_path, text="   ")
    assert paid.key_problem(path) is None  # key_problem never reads, so it cannot see this
    with pytest.raises(paid.KeyFileError, match="empty"):
        paid.read_key(path)


def test_a_link_or_a_folder_is_not_a_key_file(tmp_path):
    real = key_file(tmp_path)
    link = tmp_path / "link"
    os.symlink(real, link)
    assert "not a regular file" in paid.key_problem(link)
    assert "not a regular file" in paid.key_problem(tmp_path)


def test_the_default_key_file_is_the_one_in_the_config_folder():
    assert paid.KEY_FILE.parts[-3:] == (".config", "learnstation-parser-bench", "openai_key")


def test_redact_removes_the_key_and_anything_shaped_like_one():
    text = f"Incorrect API key provided: {KEY}. Also sk-proj-****abcd."
    out = paid.redact(text, KEY)
    assert "SECRET" not in out and "abcd" not in out and out.count("sk-…(redacted)") == 2


def test_every_recorded_price_names_when_and_where_it_was_read():
    assert "gpt-4.1-mini" in paid.PRICES
    for price in paid.PRICES.values():
        assert price.input_per_m > 0 and price.output_per_m > 0
        assert price.est_input_tokens > 0 and price.est_output_tokens > 0
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", price.checked_on) and price.source.startswith("http")


def test_a_model_without_a_price_or_an_id_is_refused():
    with pytest.raises(ValueError, match="no price recorded"):
        paid.price_of("gpt-unknown")
    with pytest.raises(ValueError, match="no model id"):
        paid.price_of("")


def test_the_estimate_and_its_worst_case(monkeypatch):
    monkeypatch.setattr(paid, "PRICES", {"gpt-test": paid.Price(1.0, 2.0, 1000, 500, "2026-10-31", "https://example.org")})
    e = paid.estimate("gpt-test", 10)
    assert (e.usd, e.max_usd) == (0.02, 0.3377)  # 10 × (1000·1 + 500·2)/1e6; 10 × (1000·1 + 16384·2)/1e6
    assert e.line("x") == "x: 10 page images to OpenAI (gpt-test), estimated $0.02, at most $0.34"
    assert paid.estimate("gpt-test", 1).line("x").startswith("x: 1 page image to")
    assert e.as_dict() == {"model": "gpt-test", "pages": 10, "usd": 0.02, "max_usd": 0.3377}


def test_the_benchmark_estimate_for_the_production_model():
    e = paid.estimate("gpt-4.1-mini", 24)
    assert (e.usd, e.max_usd) == (0.0701, 0.6608)  # 3,300 in / 1,000 out per page, set from the probe


def test_dollars_are_shown_to_the_cent():
    assert (paid.usd(0.0634), paid.usd(0.004), paid.usd(0), paid.usd(1.005)) == ("$0.06", "<$0.01", "$0.00", "$1.00")


def test_the_cost_of_a_run_comes_from_the_usage_the_api_reported(monkeypatch):
    monkeypatch.setattr(paid, "PRICES", {"gpt-test": paid.Price(1.0, 2.0, 1000, 500, "2026-10-31", "https://example.org")})
    api = {"pages": {"1": {"prompt_tokens": 1000, "completion_tokens": 100, "cached_tokens": 0, "reasoning_tokens": 0},
                     "2": {"prompt_tokens": 2000, "completion_tokens": 300},
                     "3": {"attempts": [{"attempt": 1, "status": 500}]}}}  # a page that never got an answer is not billed
    c = paid.cost("gpt-test", api)
    assert (c["requests"], c["prompt_tokens"], c["completion_tokens"], c["usd"]) == (2, 3000, 400, 0.0038)
    assert c["price"]["checked_on"] == "2026-10-31" and "upper bound" in c["basis"]
    assert paid.cost("gpt-test", None) is None
    assert c["usd_is_lower_bound"] is False and c["pages_billed_without_usage"] == 0


def test_a_billed_page_without_readable_usage_makes_the_cost_a_lower_bound(monkeypatch):
    monkeypatch.setattr(paid, "PRICES", {"gpt-test": paid.Price(1.0, 2.0, 1000, 500, "2026-10-31", "https://example.org")})
    api = {"pages": {"1": {"prompt_tokens": 1000, "completion_tokens": 100},
                     "2": {"billed_unknown_usage": True, "attempts": [{"attempt": 1, "status": 200}]},
                     "3": {"prompt_tokens": None, "attempts": [{"attempt": 1, "status": 200}]},  # 2xx without a usage object
                     "4": {"attempts": [{"attempt": 1, "status": 500}]},  # never answered: not billed
                     "5": {"interrupted_in_flight": True, "requested_at": "2026-10-31T10:00:00+00:00",
                           "attempts": [{"attempt": 1, "interrupted": True}]}}}  # stopped mid-request: may be billed
    c = paid.cost("gpt-test", api)
    assert (c["requests"], c["usd"], c["pages_billed_without_usage"], c["usd_is_lower_bound"]) == (1, 0.0012, 3, True)
    assert "lower bound" in c["basis"] and "NOT in this figure" in c["basis"]


def test_list_models_asks_openai_with_the_key_and_returns_sorted_ids(tmp_path):
    seen = []

    def opener(request, timeout):
        seen.append((request.full_url, request.get_header("Authorization"), timeout))
        return io.BytesIO(json.dumps({"data": [{"id": "gpt-b"}, {"id": "gpt-a"}, {"x": 1}]}).encode())

    assert paid.list_models(key_file=key_file(tmp_path), opener=opener) == ["gpt-a", "gpt-b"]
    assert seen == [("https://api.openai.com/v1/models", f"Bearer {KEY}", 30)]


def test_an_error_from_openai_never_shows_the_key(tmp_path):
    def opener(request, timeout):
        body = json.dumps({"error": {"message": f"Incorrect API key provided: {KEY}"}}).encode()
        raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", {}, io.BytesIO(body))

    with pytest.raises(RuntimeError) as raised:
        paid.list_models(key_file=key_file(tmp_path), opener=opener)
    assert "401" in str(raised.value) and "SECRET" not in str(raised.value)
    assert raised.value.__cause__ is None and raised.value.__context__ is None  # the request (with its header) is not chained


def test_requests_go_straight_to_openai_whatever_the_proxy_settings(monkeypatch):
    built = []
    monkeypatch.setattr(urllib.request, "build_opener", lambda *handlers: built.append(handlers) or pytest.fail("stop"))
    with pytest.raises(BaseException):
        paid._direct_open(urllib.request.Request(paid.MODELS_URL), 1)
    [handlers] = built
    [proxy] = [h for h in handlers if isinstance(h, urllib.request.ProxyHandler)]
    assert proxy.proxies == {}
    [redirect] = [h for h in handlers if isinstance(h, urllib.request.HTTPRedirectHandler)]
    assert redirect.redirect_request(urllib.request.Request(paid.MODELS_URL), None, 302, "Found", {}, "https://other.example/") is None


def test_a_redirect_is_never_followed_so_the_key_never_reaches_a_second_origin(tmp_path, monkeypatch):
    sent = []

    def fake_https_open(self, request):  # replaces the socket: answers every request with a 302 to another host
        sent.append((request.full_url, request.get_header("Authorization")))
        headers = http.client.HTTPMessage()
        headers["Location"] = "https://elsewhere.example/steal"
        answer = urllib.response.addinfourl(io.BytesIO(b"moved " + KEY.encode()), headers, request.full_url, 302)
        answer.msg = "Found"
        return answer

    monkeypatch.setattr(urllib.request.HTTPSHandler, "https_open", fake_https_open)
    with pytest.raises(RuntimeError) as raised:
        paid.list_models(key_file=key_file(tmp_path), opener=paid._direct_open)
    assert "302" in str(raised.value) and "SECRET" not in str(raised.value)
    assert raised.value.__cause__ is None and raised.value.__context__ is None
    assert sent == [(paid.MODELS_URL, f"Bearer {KEY}")]  # one request, to api.openai.com only


def test_a_key_file_that_is_not_text_is_refused_without_its_content_riding_on_the_exception(tmp_path):
    path = tmp_path / "openai_key"
    path.write_bytes(b"sk-proj-AAAA-SECRET\xff\xfe")
    path.chmod(0o600)
    with pytest.raises(paid.KeyFileError) as raised:
        paid.read_key(path)
    assert raised.value.__context__ is None and raised.value.__cause__ is None
    assert "SECRET" not in str(raised.value) and "SECRET" not in repr(raised.value)
    assert "UnicodeDecodeError" in str(raised.value)


@pytest.mark.parametrize("text", ["sk-proj-AAAA\nSECOND", "sk-proj AAAA", "sk-proj-AAAA\x00"])
def test_a_key_with_whitespace_or_control_characters_inside_is_refused(tmp_path, text):
    with pytest.raises(paid.KeyFileError, match="one line") as raised:
        paid.read_key(key_file(tmp_path, text=text))
    assert "AAAA" not in str(raised.value)


def test_the_at_most_figure_rounds_up_to_the_cent_and_the_estimate_rounds_normally():
    e = paid.estimate("gpt-4.1-mini", 24)
    assert e.max_usd == 0.6608 and e.line("x").endswith("estimated $0.07, at most $0.67")
    assert paid.usd(0.6541, round_up=True) == "$0.66" and paid.usd(0.66, round_up=True) == "$0.66"


def test_an_estimate_needs_at_least_one_page():
    for pages in (0, -3):
        with pytest.raises(ValueError, match="at least one page"):
            paid.estimate("gpt-4.1-mini", pages)


def test_a_broken_http_answer_is_a_redacted_error_too(tmp_path):
    def opener(request, timeout):
        raise http.client.IncompleteRead(KEY.encode())

    with pytest.raises(RuntimeError) as raised:
        paid.list_models(key_file=key_file(tmp_path), opener=opener)
    assert "IncompleteRead" in str(raised.value) and "SECRET" not in str(raised.value)
    assert raised.value.__cause__ is None and raised.value.__context__ is None
