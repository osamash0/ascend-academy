"""Backend Sentry events must not carry a person.

``sentry_sdk.init`` in ``backend/main.py`` had no ``before_send``; with the
FastAPI integration an event carries the request headers (incl. the bearer
token), cookies, query string and whatever ``set_user`` provided.
"""
from __future__ import annotations

from backend.core.sentry import build_sentry_options, scrub_event


def test_scrub_drops_user_headers_cookies_query_and_bodies():
    event = {
        "user": {"id": "u1", "email": "a@b.de", "ip_address": "1.2.3.4"},
        "request": {
            "url": "https://api.example/api/v1/ai/chat?token=abc",
            "headers": {"Authorization": "Bearer x", "Cookie": "sb=1"},
            "cookies": {"sb": "1"},
            "query_string": "token=abc",
            "data": {"user_message": "my private question"},
            "env": {"REMOTE_ADDR": "1.2.3.4"},
            "method": "POST",
        },
        "breadcrumbs": {"values": [{"category": "httplib", "data": {"url": "https://api.openai.com/v1/chat?x=1", "body": "..."}}]},
    }
    out = scrub_event(event, {})
    assert out is not None
    assert "user" not in out
    req = out["request"]
    for key in ("headers", "cookies", "query_string", "data", "env"):
        assert key not in req
    assert req["url"] == "https://api.example/api/v1/ai/chat"
    assert req["method"] == "POST"
    assert out["breadcrumbs"]["values"][0]["data"] == {"url": "https://api.openai.com/v1/chat"}


def test_options_disable_default_pii_and_sample_low_outside_development():
    opts = build_sentry_options("https://k@o.ingest.sentry.io/1", env="production")
    assert opts["send_default_pii"] is False
    assert opts["traces_sample_rate"] <= 0.1
    assert opts["profiles_sample_rate"] <= 0.1
    assert opts["before_send"] is scrub_event


def test_development_may_trace_everything():
    assert build_sentry_options("dsn", env="development")["traces_sample_rate"] == 1.0
