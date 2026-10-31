"""Sentry options for the API and worker processes.

Error monitoring only: default PII off, low sampling outside development,
and a ``before_send`` that strips what identifies a person or carries their
content — the user block, request headers (bearer token), cookies, the query
string, request bodies, the WSGI env (client IP) and breadcrumb payloads.

The privacy policy says reports are stored in the EU, so Sentry starts only
with a DSN in Sentry's EU region (``*.de.sentry.io``); any other DSN leaves
it off.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

import sentry_sdk

logger = logging.getLogger(__name__)

_REQUEST_FIELDS_TO_DROP = ("headers", "cookies", "query_string", "data", "env")
_EU_HOST_SUFFIX = ".de.sentry.io"


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
        "environment": env,
        "traces_sample_rate": rate,
        "profiles_sample_rate": rate,
        "send_default_pii": False,
        "before_send": scrub_event,
    }


def is_eu_dsn(dsn: str) -> bool:
    """True when the DSN sends to Sentry's EU region (``o123.ingest.de.sentry.io``)."""
    try:
        host = urlsplit(dsn).hostname or ""
    except ValueError:
        return False
    return host.endswith(_EU_HOST_SUFFIX)


def init_sentry(env: str) -> bool:
    """Start error reporting from ``SENTRY_DSN``; returns whether it started."""
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        return False
    if not is_eu_dsn(dsn):
        logger.warning("SENTRY_DSN is not in Sentry's EU region (*.de.sentry.io); error reporting stays off")
        return False
    sentry_sdk.init(**build_sentry_options(dsn, env=env))
    return True
