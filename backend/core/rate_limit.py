"""
Shared SlowAPI Limiter instance.

Lives in its own module so route handlers can import it without creating
a circular dependency with backend.main. Using get_remote_address as the
key function means anonymous endpoints are limited per IP; for endpoints
that already require auth we still key by IP, which is the right safety
net against brute-force / abuse from a single source.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
