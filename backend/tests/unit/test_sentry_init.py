"""Sentry starts only where the privacy policy says the reports go.

The privacy policy names Sentry with storage in the EU, so a DSN outside
Sentry's EU region (``*.de.sentry.io``) must leave error reporting off rather
than quietly send reports to the US. The API and the worker start it the same
way, and every report says which environment it came from.
"""
from __future__ import annotations

import importlib

import sentry_sdk

from backend.core import sentry as sentry_mod
from backend.core.sentry import build_sentry_options, init_sentry, is_eu_dsn

EU_DSN = "https://k@o1.ingest.de.sentry.io/2"
US_DSN = "https://k@o1.ingest.us.sentry.io/2"


def _capture_init(monkeypatch):
    calls = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))
    return calls


def test_reports_carry_the_environment():
    assert build_sentry_options(EU_DSN, env="production")["environment"] == "production"


def test_only_the_eu_region_counts_as_eu():
    assert is_eu_dsn(EU_DSN)
    assert not is_eu_dsn(US_DSN)
    assert not is_eu_dsn("https://k@o1.ingest.sentry.io/2")
    assert not is_eu_dsn("https://k@evil.example/de.sentry.io/2")
    assert not is_eu_dsn("not a dsn")


def test_no_dsn_no_sentry(monkeypatch):
    calls = _capture_init(monkeypatch)
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert init_sentry("production") is False
    assert calls == []


def test_a_dsn_outside_the_eu_leaves_sentry_off(monkeypatch, caplog):
    calls = _capture_init(monkeypatch)
    monkeypatch.setenv("SENTRY_DSN", US_DSN)
    assert init_sentry("production") is False
    assert calls == []
    assert "EU" in caplog.text


def test_an_eu_dsn_starts_sentry_with_the_scrubbed_options(monkeypatch):
    calls = _capture_init(monkeypatch)
    monkeypatch.setenv("SENTRY_DSN", EU_DSN)
    assert init_sentry("production") is True
    assert len(calls) == 1
    assert calls[0]["dsn"] == EU_DSN
    assert calls[0]["environment"] == "production"
    assert calls[0]["send_default_pii"] is False
    assert calls[0]["before_send"] is sentry_mod.scrub_event


def test_the_worker_starts_sentry_too(monkeypatch):
    """Parses run in the worker; a failure there must reach Sentry like an API error."""
    started = []
    monkeypatch.setattr(sentry_mod, "init_sentry", lambda env: started.append(env) or True)
    import backend.workers.arq_worker as worker

    importlib.reload(worker)
    assert started, "backend/workers/arq_worker.py does not call init_sentry"
