"""
Shared SlowAPI Limiter instance.

Lives in its own module so route handlers can import it without creating
a circular dependency with backend.main.

Proxy trust (S-3, docs/ROADMAP_10X_FOUNDATION.md §14)
------------------------------------------------------
``request.client.host`` is NOT the raw TCP peer once ``ProxyHeadersMiddleware``
is installed (see ``backend/main.py``) — that middleware rewrites it to the
X-Forwarded-For value, but *only* when the immediate TCP peer is in its
``trusted_hosts`` allowlist. Anything from an untrusted peer is left alone.

This means it is now safe (and correct) for rate-limit key functions to read
``request.client.host`` directly, exactly like SlowAPI's own
``get_remote_address`` helper does. The previous implementation here
re-parsed the raw ``X-Forwarded-For`` header itself, taking the client-
supplied *first* entry — that bypassed the middleware's trust boundary
entirely and let any caller forge an arbitrary key by sending
``X-Forwarded-For: 1.2.3.4`` (a rotating value defeats per-IP limits). Do
NOT reintroduce direct header parsing here; go through
``request.client.host``.
"""
import hashlib

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def get_real_client_ip(request: Request) -> str:
    """Returns the resolved client IP.

    Trust boundary lives in ``ProxyHeadersMiddleware`` (main.py), not here:
    by the time this runs, ``request.client.host`` is either the real TCP
    peer, or — if that peer is a configured trusted proxy — the value it
    forwarded via X-Forwarded-For. Untrusted peers can't spoof it.
    """
    return get_remote_address(request)


def rate_limit_key(request: Request) -> str:
    """Default rate-limit key: authenticated user when available, else IP.

    SlowAPI calls ``key_func`` before route dependencies execute, so we
    can't rely on a resolved user object. Instead we derive a stable
    per-session key straight from the bearer token: a SHA-256 hash of the
    raw token. This ties the limit to a specific logged-in session
    regardless of X-Forwarded-For / shared-NAT IPs, and can't be bypassed
    by an attacker rotating a spoofed proxy header — the key is a hash of
    a credential they don't control. Falls back to the (proxy-trust-aware)
    client IP for anonymous requests.
    """
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
        # Sanity-check token shape (JWT: three dot-separated segments,
        # reasonable length) so malformed/garbage values fall back to the
        # IP bucket instead of spraying unbounded new keys past the limiter.
        if token and 20 <= len(token) <= 4096 and token.count(".") == 2:
            return "user:" + hashlib.sha256(token.encode("utf-8")).hexdigest()[:32]
    return "ip:" + get_real_client_ip(request)


limiter = Limiter(key_func=rate_limit_key, default_limits=["120/minute"])
