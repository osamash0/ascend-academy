"""
Shared SlowAPI Limiter instance.

Lives in its own module so route handlers can import it without creating
a circular dependency with backend.main. Using get_remote_address as the
key function means anonymous endpoints are limited per IP; for endpoints
that already require auth we still key by IP, which is the right safety
net against brute-force / abuse from a single source.
"""
from fastapi import Request
from slowapi import Limiter

def get_real_client_ip(request: Request) -> str:
    """Safely extracts client IP from reverse proxy X-Forwarded-For header,

    falling back to direct host address if not present.
    """
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host or "127.0.0.1"

limiter = Limiter(key_func=get_real_client_ip, default_limits=["120/minute"])
