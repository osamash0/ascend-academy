"""
Regression tests for M78 (CORS config): dev environments must always be able
to reach the backend from localhost, even if CORS_ALLOWED_ORIGINS/ALLOWED_ORIGINS
is explicitly set (e.g. a dev .env copied from a prod-style config). Production
origins must never gain localhost.
"""
from backend.main import _build_cors_origins, DEV_LOCAL_ORIGINS


def test_dev_gets_localhost_even_with_explicit_allowlist(monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://example.com")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.setattr("backend.main.settings.env", "development")

    origins = _build_cors_origins()

    assert "https://example.com" in origins
    for local in DEV_LOCAL_ORIGINS:
        assert local in origins


def test_prod_explicit_allowlist_never_gains_localhost(monkeypatch):
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://learnstation.duckdns.org,https://195-201-221-137.sslip.io")
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.setattr("backend.main.settings.env", "production")

    origins = _build_cors_origins()

    assert origins == [
        "https://learnstation.duckdns.org",
        "https://195-201-221-137.sslip.io",
    ]
    for local in DEV_LOCAL_ORIGINS:
        assert local not in origins


def test_no_env_vars_falls_back_to_dev_localhost_list(monkeypatch):
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.delenv("REPLIT_DEV_DOMAIN", raising=False)
    monkeypatch.delenv("REPLIT_DOMAINS", raising=False)

    origins = _build_cors_origins()

    for local in DEV_LOCAL_ORIGINS:
        assert local in origins
