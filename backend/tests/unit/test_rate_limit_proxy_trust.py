"""
Regression tests for S-3 (rate-limit & proxy-trust hardening).

docs/ROADMAP_10X_FOUNDATION.md §14: `ProxyHeadersMiddleware(trusted_hosts=["*"])`
plus a limiter that re-parsed the raw `X-Forwarded-For` header itself meant any
client could forge `X-Forwarded-For: <anything>` and have it accepted as their
"real" IP, trivially defeating per-IP rate limiting by rotating the header.

These tests exercise the fix at two levels:
  1. `ProxyHeadersMiddleware` scoped to `backend.main._trusted_proxy_hosts()`
     only honors X-Forwarded-For from a trusted peer (unit-level, no HTTP).
  2. `backend.core.rate_limit.rate_limit_key` / `get_real_client_ip` no longer
     re-parse the header directly, so they inherit that trust boundary.
"""
import hashlib
import os

import pytest
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware


async def _echo_client(request):
    return PlainTextResponse(request.client.host if request.client else "")


def _make_client(trusted_hosts, peer_ip: str) -> TestClient:
    app = Starlette(routes=[Route("/", _echo_client)])
    wrapped = ProxyHeadersMiddleware(app, trusted_hosts=trusted_hosts)
    return TestClient(wrapped, client=(peer_ip, 12345))


# ── ProxyHeadersMiddleware trust boundary ────────────────────────────────────

def test_spoofed_xff_ignored_from_untrusted_peer():
    """A caller NOT connecting from a trusted proxy can't inject X-Forwarded-For."""
    client = _make_client(["127.0.0.1", "172.16.0.0/12"], peer_ip="203.0.113.9")
    resp = client.get("/", headers={"X-Forwarded-For": "1.2.3.4"})
    # The forged header must be ignored; the real peer address wins.
    assert resp.text == "203.0.113.9"


def test_xff_honored_from_trusted_docker_bridge_peer():
    """The nginx sidecar (docker bridge peer) IS trusted, so its XFF is honored."""
    client = _make_client(["127.0.0.1", "172.16.0.0/12"], peer_ip="172.20.0.5")
    resp = client.get("/", headers={"X-Forwarded-For": "198.51.100.7"})
    assert resp.text == "198.51.100.7"


def test_wildcard_trust_was_the_vulnerability():
    """Sanity check: the OLD config (`trusted_hosts=["*"]`) trusted everyone,
    which is exactly why a spoofed header worked from any peer. Documented
    here so nobody reintroduces `"*"` as the default."""
    client = _make_client(["*"], peer_ip="203.0.113.9")
    resp = client.get("/", headers={"X-Forwarded-For": "1.2.3.4"})
    assert resp.text == "1.2.3.4"  # forged value wins — this is the bug S-3 fixes


# ── backend.main._trusted_proxy_hosts() ──────────────────────────────────────

def test_trusted_proxy_hosts_default_excludes_wildcard(monkeypatch):
    monkeypatch.delenv("TRUSTED_PROXY_HOSTS", raising=False)
    from backend.main import _trusted_proxy_hosts

    hosts = _trusted_proxy_hosts()
    assert "*" not in hosts
    assert "127.0.0.1" in hosts


def test_trusted_proxy_hosts_env_override(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HOSTS", "10.0.0.1, 10.0.0.2")
    from backend.main import _trusted_proxy_hosts

    assert _trusted_proxy_hosts() == ["10.0.0.1", "10.0.0.2"]


# ── backend.core.rate_limit key functions ────────────────────────────────────

def test_get_real_client_ip_does_not_reparse_xff_header():
    """`get_real_client_ip` must trust only `request.client.host` (already
    resolved by ProxyHeadersMiddleware upstream) and never read the raw
    X-Forwarded-For header itself — that re-parsing was the bypass."""
    from backend.core.rate_limit import get_real_client_ip

    class _FakeClient:
        host = "203.0.113.9"

    class _FakeRequest:
        client = _FakeClient()
        headers = {"X-Forwarded-For": "1.2.3.4"}  # attacker-supplied, must be ignored

    assert get_real_client_ip(_FakeRequest()) == "203.0.113.9"


def test_rate_limit_key_prefers_authenticated_user_over_ip():
    from backend.core.rate_limit import rate_limit_key

    token = "a" * 10 + "." + "b" * 10 + "." + "c" * 10  # shape: header.payload.sig

    class _FakeRequest:
        client = None
        headers = {"authorization": f"Bearer {token}"}

    expected = "user:" + hashlib.sha256(token.encode("utf-8")).hexdigest()[:32]
    assert rate_limit_key(_FakeRequest()) == expected


def test_rate_limit_key_is_stable_per_token_and_differs_across_tokens():
    from backend.core.rate_limit import rate_limit_key

    def _req(tok):
        class _R:
            client = None
            headers = {"authorization": f"Bearer {tok}"}
        return _R()

    tok_a = "a" * 10 + "." + "b" * 10 + "." + "c" * 10
    tok_b = "d" * 10 + "." + "e" * 10 + "." + "f" * 10

    assert rate_limit_key(_req(tok_a)) == rate_limit_key(_req(tok_a))
    assert rate_limit_key(_req(tok_a)) != rate_limit_key(_req(tok_b))


def test_rate_limit_key_falls_back_to_ip_for_malformed_token():
    from backend.core.rate_limit import rate_limit_key

    class _FakeClient:
        host = "203.0.113.9"

    class _FakeRequest:
        client = _FakeClient()
        headers = {"authorization": "Bearer not-a-jwt"}

    assert rate_limit_key(_FakeRequest()) == "ip:203.0.113.9"


def test_rate_limit_key_falls_back_to_ip_when_unauthenticated():
    from backend.core.rate_limit import rate_limit_key

    class _FakeClient:
        host = "203.0.113.9"

    class _FakeRequest:
        client = _FakeClient()
        headers = {}

    assert rate_limit_key(_FakeRequest()) == "ip:203.0.113.9"


def test_spoofed_xff_no_longer_bypasses_key_when_untrusted(monkeypatch):
    """End-to-end of the exact exploit in the roadmap: a client rotates
    X-Forwarded-For hoping to get a fresh rate-limit bucket each time. With
    the middleware trust boundary in place (peer not trusted), the header is
    ignored and the resolved key stays pinned to the real peer IP, so
    rotating it buys the attacker nothing."""
    from backend.core.rate_limit import get_real_client_ip

    class _FakeRequest:
        # Represents what request.client.host would be AFTER
        # ProxyHeadersMiddleware has run and decided this peer is untrusted:
        # it never gets overwritten from X-Forwarded-For, so every spoofed
        # value collapses to the same real key.
        class client:
            host = "203.0.113.9"
        headers = {"X-Forwarded-For": "9.9.9.9"}

    key1 = get_real_client_ip(_FakeRequest())

    class _FakeRequest2:
        class client:
            host = "203.0.113.9"
        headers = {"X-Forwarded-For": "1.1.1.1"}  # rotated, still ignored

    key2 = get_real_client_ip(_FakeRequest2())
    assert key1 == key2 == "203.0.113.9"
