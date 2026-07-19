"""Centralized Prometheus metric objects (Roadmap Foundation 10x, Phase 1 P1-2).

Before this module, the only application observability was JSON logs +
Sentry — no `/metrics` endpoint, no golden-signal dashboards, no visibility
into Arq queue depth, auth-cache effectiveness, or LLM latency. RED metrics
(request rate/error/duration by route) are wired separately in
``backend/main.py`` via ``prometheus-fastapi-instrumentator``; the objects
here are the custom, domain-specific series the roadmap calls out:
  - Arq queue depth + per-job duration/outcome
  - Auth-token cache hit rate
  - LLM call latency (cost/tokens are already captured to ``llm_calls`` by
    P1-1 — these Counters expose the same numbers to Prometheus too)
  - Generic cache hit/miss

Defined in one module (rather than inline at each call site) so every
importer shares the same registered Collector instances — re-instantiating
a Counter/Histogram with the same name from two different modules raises
``ValueError: Duplicated timeseries`` at import time.
"""
from prometheus_client import Counter, Gauge, Histogram

ARQ_QUEUE_DEPTH = Gauge(
    "arq_queue_depth",
    "Jobs currently enqueued (not yet started) on the Arq default queue.",
)

ARQ_JOB_DURATION_SECONDS = Histogram(
    "arq_job_duration_seconds",
    "Arq job execution duration in seconds, from dispatch to completion.",
    ["function"],
)

ARQ_JOB_OUTCOME_TOTAL = Counter(
    "arq_job_outcome_total",
    "Arq job completions by function and outcome.",
    ["function", "outcome"],  # outcome: success | failure | unknown
)

AUTH_CACHE_TOTAL = Counter(
    "auth_cache_requests_total",
    "Auth-token cache lookups (backend/core/auth_middleware.py's verify_token).",
    ["result"],  # result: hit | miss
)

CACHE_TOTAL = Counter(
    "app_cache_requests_total",
    "Generic application cache lookups by cache name and outcome.",
    ["cache", "result"],  # cache: pdf_parse | ... ; result: hit | miss
)

# NOT YET WIRED: these three are defined here (so the names/labels are
# settled) but nothing calls them yet. Emitting real values needs the
# per-call provider/model/usage data that P1-1 (branch
# fix/p1-1-llm-cost-accounting, backend/services/ai/cost.py + orchestrator.py's
# _account_for_call) computes — that branch predates this one and doesn't have
# backend/core/metrics.py to import from, and this branch doesn't have P1-1's
# usage-tuple-returning orchestrator.py to instrument. Wire these into
# _account_for_call (wrap the call_llm(...) invocation in
# time.perf_counter(), pass duration through) as a follow-up once both
# branches are merged to main — don't reimplement a shallower version against
# the pre-P1-1 orchestrator.py shape, it'll just be thrown away.
LLM_CALL_DURATION_SECONDS = Histogram(
    "llm_call_duration_seconds",
    "LLM provider call latency in seconds (includes rotation/retry within one logical call).",
    ["provider", "model", "feature"],
)

LLM_CALL_COST_USD_TOTAL = Counter(
    "llm_call_cost_usd_total",
    "Cumulative estimated USD cost of LLM calls.",
    ["provider", "model", "feature"],
)

LLM_CALL_TOKENS_TOTAL = Counter(
    "llm_call_tokens_total",
    "Cumulative LLM tokens consumed.",
    ["provider", "model", "feature", "kind"],  # kind: prompt | completion
)
