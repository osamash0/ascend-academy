"""Sentry options for the API and worker processes.

Error monitoring only: default PII off, low sampling outside development,
and a ``before_send`` that strips what identifies a person or carries their
content — the user block, request headers (bearer token), cookies, the query
string, request bodies, the WSGI env (client IP) and breadcrumb payloads.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

_REQUEST_FIELDS_TO_DROP = ("headers", "cookies", "query_string", "data", "env")


def _strip_query(url: Any) -> Any:
    if isinstance(url, str) and "?" in url:
        return url.split("?", 1)[0]
    return url


def scrub_event(event: Dict[str, Any], hint: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    event.pop("user", None)
    request = event.get("request")
    if isinstance(request, dict):
        for field in _REQUEST_FIELDS_TO_DROP:
            request.pop(field, None)
        if "url" in request:
            request["url"] = _strip_query(request["url"])
    crumbs = event.get("breadcrumbs")
    values = crumbs.get("values") if isinstance(crumbs, dict) else crumbs
    if isinstance(values, list):
        for crumb in values:
            if isinstance(crumb, dict) and isinstance(crumb.get("data"), dict):
                url = _strip_query(crumb["data"].get("url"))
                crumb["data"] = {"url": url} if url is not None else {}
    return event


def build_sentry_options(dsn: str, *, env: str) -> Dict[str, Any]:
    rate = 1.0 if env == "development" else 0.1
    return {
        "dsn": dsn,
        "traces_sample_rate": rate,
        "profiles_sample_rate": rate,
        "send_default_pii": False,
        "before_send": scrub_event,
    }
