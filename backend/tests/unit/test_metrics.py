"""Unit tests for P1-2 metrics: the /metrics endpoint (RED metrics via
prometheus-fastapi-instrumentator) and the custom domain metrics recorded at
their own call sites (auth-cache hit rate, generic cache hit rate, Arq queue
depth + job duration/outcome).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.core import metrics

client = TestClient(app)


def test_metrics_endpoint_exposes_prometheus_text_with_request_series():
    # Generate at least one request so the RED metrics have a data point.
    client.get("/openapi.json")
    resp = client.get("/metrics")
    assert resp.status_code == 200
    assert "text/plain" in resp.headers["content-type"]
    body = resp.text
    # prometheus-fastapi-instrumentator's default RED series.
    assert "http_requests_total" in body
    assert "http_request_duration_seconds" in body


def test_metrics_endpoint_exposes_custom_series_after_they_fire():
    metrics.AUTH_CACHE_TOTAL.labels(result="hit").inc()
    metrics.CACHE_TOTAL.labels(cache="pdf_parse", result="miss").inc()
    metrics.ARQ_QUEUE_DEPTH.set(3)
    metrics.ARQ_JOB_OUTCOME_TOTAL.labels(function="parse_pdf_unified", outcome="success").inc()
    metrics.ARQ_JOB_DURATION_SECONDS.labels(function="parse_pdf_unified").observe(1.5)

    body = client.get("/metrics").text
    assert "auth_cache_requests_total" in body
    assert "app_cache_requests_total" in body
    assert "arq_queue_depth" in body
    assert "arq_job_outcome_total" in body
    assert "arq_job_duration_seconds" in body


@pytest.mark.asyncio
async def test_verify_token_increments_auth_cache_hit(monkeypatch):
    from backend.core import auth_middleware

    before = metrics.AUTH_CACHE_TOTAL.labels(result="hit")._value.get()

    async def fake_get_cached_token(token):
        return {"id": "u1", "email": "a@b.com", "app_metadata": {}, "user_metadata": {}, "role": "student"}

    monkeypatch.setattr(auth_middleware, "get_cached_token", fake_get_cached_token)

    creds = type("Creds", (), {"credentials": "sometoken"})()
    user = await auth_middleware.verify_token(credentials=creds)

    assert user.id == "u1"
    after = metrics.AUTH_CACHE_TOTAL.labels(result="hit")._value.get()
    assert after == before + 1


@pytest.mark.asyncio
async def test_account_for_call_emits_llm_usage_metrics(monkeypatch):
    """The cost-accounting tail is the sole LLM Prometheus emission point."""
    from backend.services.ai import cost as cost_module
    from backend.services.ai import orchestrator
    from backend.services.ai.cost import LLMUsage

    async def _noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(orchestrator._rotator, "flush_success_to_redis", _noop)
    monkeypatch.setattr(cost_module, "estimate_cost", lambda *_args: 0.125)
    monkeypatch.setattr(cost_module, "log_llm_call", _noop)
    monkeypatch.setattr(cost_module, "record_user_llm_spend", _noop)

    labels = {"provider": "openai", "model": "gpt-4o-mini", "feature": "test_feature"}
    duration = metrics.LLM_CALL_DURATION_SECONDS.labels(**labels)
    cost = metrics.LLM_CALL_COST_USD_TOTAL.labels(**labels)
    prompt = metrics.LLM_CALL_TOKENS_TOTAL.labels(**labels, kind="prompt")
    completion = metrics.LLM_CALL_TOKENS_TOTAL.labels(**labels, kind="completion")
    before_duration = duration._sum.get()
    before_cost = cost._value.get()
    before_prompt = prompt._value.get()
    before_completion = completion._value.get()

    await orchestrator._account_for_call(
        "openai", "gpt-4o-mini", LLMUsage(prompt_tokens=120, completion_tokens=45),
        user_id="user-1", course_id="course-1", feature="test_feature", duration_seconds=0.25,
    )

    assert duration._sum.get() == pytest.approx(before_duration + 0.25)
    assert cost._value.get() == pytest.approx(before_cost + 0.125)
    assert prompt._value.get() == before_prompt + 120
    assert completion._value.get() == before_completion + 45
    body = client.get("/metrics").text
    assert "llm_call_duration_seconds" in body
    assert "llm_call_cost_usd_total" in body
    assert "llm_call_tokens_total" in body


@pytest.mark.asyncio
async def test_get_cached_parse_increments_miss_when_no_row(monkeypatch):
    from backend.services import cache as cache_module

    class _FakeResult:
        data = []

    class _FakeTable:
        def select(self, *_a, **_kw):
            return self

        def eq(self, *_a, **_kw):
            return self

        def execute(self):
            return _FakeResult()

    class _FakeAdmin:
        def table(self, name):
            return _FakeTable()

    monkeypatch.setattr(cache_module, "supabase_admin", _FakeAdmin())

    before = metrics.CACHE_TOTAL.labels(cache="pdf_parse", result="miss")._value.get()
    result = await cache_module.get_cached_parse("deadbeef")
    after = metrics.CACHE_TOTAL.labels(cache="pdf_parse", result="miss")._value.get()

    assert result is None
    assert after == before + 1


@pytest.mark.asyncio
async def test_queue_depth_sets_gauge(monkeypatch):
    from backend.services import upload_service

    async def fake_get_arq_pool():
        class _Pool:
            async def zcard(self, _name):
                return 7
        return _Pool()

    monkeypatch.setattr(upload_service, "get_arq_pool", fake_get_arq_pool)

    depth = await upload_service.queue_depth()
    assert depth == 7
    assert metrics.ARQ_QUEUE_DEPTH._value.get() == 7


@pytest.mark.asyncio
async def test_arq_after_job_end_records_duration_and_outcome(monkeypatch):
    from backend.workers import arq_worker

    class _FakeResultInfo:
        function = "parse_pdf_unified"
        success = True

    class _FakeJob:
        def __init__(self, job_id, redis):
            self.job_id = job_id
            self.redis = redis

        async def result_info(self):
            return _FakeResultInfo()

    monkeypatch.setattr("arq.jobs.Job", _FakeJob)

    ctx = {"job_id": "abc123", "redis": object(), "_metrics_start_ts": __import__("time").monotonic() - 0.05}
    before = metrics.ARQ_JOB_OUTCOME_TOTAL.labels(function="parse_pdf_unified", outcome="success")._value.get()

    await arq_worker.after_job_end(ctx)

    after = metrics.ARQ_JOB_OUTCOME_TOTAL.labels(function="parse_pdf_unified", outcome="success")._value.get()
    assert after == before + 1


@pytest.mark.asyncio
async def test_arq_after_job_end_fails_open_when_result_info_errors(monkeypatch):
    """A metrics-lookup failure must never raise — job processing continues
    regardless of whether Prometheus bookkeeping succeeds."""
    from backend.workers import arq_worker

    class _RaisingJob:
        def __init__(self, *_a, **_kw):
            pass

        async def result_info(self):
            raise ConnectionError("redis down")

    monkeypatch.setattr("arq.jobs.Job", _RaisingJob)

    ctx = {"job_id": "abc123", "redis": object(), "_metrics_start_ts": __import__("time").monotonic()}
    await arq_worker.after_job_end(ctx)  # must not raise

    body_metric = metrics.ARQ_JOB_OUTCOME_TOTAL.labels(function="unknown", outcome="unknown")._value.get()
    assert body_metric >= 1
