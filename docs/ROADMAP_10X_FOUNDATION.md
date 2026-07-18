# Foundation 10x — Database & Backend Platform Roadmap

> Status: PROPOSED (2026-07-18) · Owner: Abdullah · Companion to `docs/ROADMAP_10X.md`
> Basis: a three-lens grounded audit of the live schema (83 migrations), the FastAPI
> backend (`backend/`), and the AI/LLM pipeline. Every claim below is backed by a
> `file:line` citation and, for the P0 security items, verified directly against source.

---

## 1. Why this document exists

`ROADMAP_10X.md` made the **product** 10x — SRS, exam mode, student uploads, planner,
global search. Most of it shipped. This roadmap is the other axis: the **load-bearing
foundation those products stand on**. A 10x product on a foundation that can be wiped by
an anonymous HTTP call, whose LLM spend is unmetered and unbounded, whose AI quality is
unmeasured, and which physically cannot run more than one web worker — is a 10x liability,
not a 10x asset.

The audit's one-line finding:

> **The product surface is mature and well-engineered. The foundation has three
> load-bearing cracks: (1) latent security/reproducibility bombs, (2) zero cost and
> quality instrumentation, and (3) a hard single-worker scaling ceiling. "10x" here means
> making it *safe and observable to grow 10x* in users, content, and cost — before we do.**

**Sequencing principle:** risk-reduction and instrumentation come before optimization.
You cannot optimize a cost you cannot measure, scale a system you cannot observe, or trust
a pipeline you cannot evaluate. Phases 0–1 make the system *legible*; Phases 2–4 make it
*fast, cheap, and maintainable*.

---

## 2. What's genuinely strong (build on, don't touch)

The audit was not all red. These are real assets and the roadmap deliberately reuses them:

- **RLS + SECURITY DEFINER helper discipline** — `has_role`, `lecture_visible_to_caller`,
  `assignment_owner_id`, `course_professor_id` break policy recursion the right way; 21 real
  RLS tests run against a Postgres container (`backend/tests/db/`).
- **Two-tier auth-token cache done right** — Redis L1 → `backend_cache` L2, keyed on
  `sha256(token)`, 45s TTL, purge-on-role-change (`backend/services/cache.py:59-120`).
- **Genuinely resilient LLM failover** — 9-provider chains, per-provider backoff, JSON
  salvage from truncated responses, drop-bad-quiz-questions-over-wrong-key, prompt-injection
  hardening in the tutor (`backend/services/ai/orchestrator.py`, `tutor.py`).
- **Correct content+version cache keys** — `pdf_hash`-keyed parse/blueprint/slide caches
  with checkpoint-resume (`parse_runs`/`parse_pages`, `UNIQUE(pdf_hash, pipeline_version)`).
- **Clean error contract + real health split** — `DomainError` → `{data, error}` envelope,
  `/health` vs `/health/ready` with per-dependency probes (`backend/main.py:196-335`).
- **Layered test suite + CI** — 1,257 test functions, nightly real-Postgres RLS suite.

---

## 3. Prioritized initiative map

| # | Initiative | Axis | Impact | Effort | Risk if skipped |
|---|---|---|---|---|---|
| **P0-1** | Lock down destructive/quota DEFINER RPCs | Security | ★★★★★ | S | **Critical** — unauth data wipe |
| **P0-2** | Fix or remove the idempotency middleware | Correctness | ★★★★ | S | High — self-inflicted outage |
| **P0-3** | Promote script-only DDL into migrations | Reproducibility | ★★★★★ | S–M | High — `db reset` breaks tutor |
| **P1-1** | LLM cost + token accounting & fleet budget | Cost | ★★★★★ | M | **Critical** — uncapped spend |
| **P1-2** | Application metrics + fix correlation IDs | Observability | ★★★★★ | M | High — blind in prod |
| **P1-3** | AI evaluation harness + golden sets | Quality | ★★★★★ | M–L | High — silent quality drift |
| **P1-4** | Scope single-lecture retrieval in SQL | Correctness | ★★★★ | S | High — tutor decays at scale |
| **P2-1** | Make RLS the API authorization boundary | Security/Velocity | ★★★★★ | L | High — cross-tenant leak surface |
| **P2-2** | Horizontal scale: asyncpg + move cron to Arq | Scale | ★★★★★ | M–L | High — 1-worker ceiling |
| **P2-3** | Worker hardening (DLQ, idempotency, status) | Reliability | ★★★★ | M | Med — silent backlog/poison jobs |
| **P2-4** | Fix analytics-cache invalidation thrash | Performance | ★★★★ | S–M | Med — cache useless under load |
| **P3-1** | Batch synthesis + budget pre-flight gate | Cost | ★★★★★ | M | High — ~8x parse cost |
| **P3-2** | Content-hash embedding dedupe + query cache | Cost | ★★★★ | S–M | Med — burns tightest free tier |
| **P3-3** | pgvector HNSW + real upsert constraint | Perf/Correctness | ★★★ | S–M | Med — recall decay, dup rows |
| **P4-1** | Break up god-objects + repository layer | Velocity | ★★★★ | L | Med — merge-conflict tax |
| **P4-2** | API contract: central DTOs + one envelope + pagination fix | Velocity/Correctness | ★★★ | M | Med — frontend special-casing |
| **P4-3** | Prompt registry + versioning + logging | Quality/Velocity | ★★★ | M | Med — can't A/B or debug prompts |
| **P4-4** | Migration governance + CI hardening + dead-code purge | Velocity | ★★★ | M | Low — accumulating drag |

Effort: S ≤ 3 days · M ≈ 1 week · L ≈ 2–3 weeks.

Two further tracks are detailed later: **Phase 5 — Data platform** (§13, the `learning_events`
spine: schema governance, OLTP/OLAP split, async ingestion, retention) and a **Security &
threat-model track** (§14, S-1…S-6: systematic RPC-exposure audit, GDPR posture, proxy/rate
limits, storage, supply chain, continuous CI). A **cost model** with 1x/10x/100x projections
is in §12. Phase 5 sequences after P2-4 (it builds on the cache/partitioning work); the
security track runs continuously, with S-1/S-2 escalated to near-P0 given the GDPR exposure.

---

## 4. Cross-cutting standards (apply to every initiative)

- **Every schema change is a real migration** in `supabase/migrations/` — no more
  `backend/scripts/*.sql`. Each ships with an RLS test proving isolation where relevant.
- **Every new external call** (LLM, DB, Redis) is bounded (timeout) and observable (metric).
- **No new `supabase_admin` (service-role) call site in `api/v1/`** without an explicit
  reviewer sign-off comment; prefer the RLS-enforcing per-user client.
- **Flag-not-delete** for behavioral changes; dead code is deleted outright.
- **Instrument first** — a change that claims a cost/latency win ships with the metric that
  proves it.

---

## 5. PHASE 0 — Stop the bleeding (days, not weeks)

These are cheap, urgent, and independent. Do them first regardless of everything else.

### P0-1 · Lock down destructive & quota SECURITY DEFINER RPCs

**Why.** Verified against source: `reset_all_analytics()` / `restore_analytics()`
(`supabase/migrations/20260614000000_...sql:29,109`) have **no `REVOKE`** — Postgres grants
`EXECUTE` to `PUBLIC` by default, and there is no global function lockdown anywhere in the
migrations. Their only guard is `IF auth.uid() IS NOT NULL AND NOT has_role(...,'admin')`,
which **short-circuits to allow when `auth.uid()` is NULL** (the `anon` PostgREST role). The
anon key ships in the browser (`.env.example:22` "safe to expose"). Net:
`POST /rest/v1/rpc/reset_all_analytics` with the public anon key **wipes `student_progress`,
`learning_events`, visits, practice attempts, achievements, notifications, and zeroes every
profile's XP** — unauthenticated. `increment_upload_quota(p_user_id, p_limit)`
(`20260710040000:153`) is likewise `PUBLIC`-executable and trusts caller args → any client
forges/bypasses the upload quota. `grant_xp` (`20260616000000:118`) *is* correctly locked to
`authenticated` and self-scoped via `auth.uid()`, but has **no cap on `p_xp`** → an
authenticated user grants themselves unbounded XP, poisoning the leaderboard.

**What.**
- `REVOKE ALL ON FUNCTION reset_all_analytics(), restore_analytics(uuid) FROM PUBLIC, anon, authenticated;`
  — these run only via `supabase_admin` from `backend/api/v1/admin.py:281`, so no client grant
  is needed. Replace the `auth.uid() IS NOT NULL AND` bypass with a positive assertion
  (`IF NOT has_role(auth.uid(),'admin') THEN RAISE`).
- `increment_upload_quota`: `REVOKE ... FROM PUBLIC, anon, authenticated` (it's called by the
  service-role backend only); or, if it must stay client-callable, derive the user from
  `auth.uid()` instead of `p_user_id` and drop `p_limit` in favor of a server-side lookup.
- `grant_xp`: add a per-call cap (e.g. `IF p_xp > 500 OR p_xp < 0 THEN RAISE`) and an allowed
  reason set; longer-term, route all XP through the service-role backend and `REVOKE` from
  `authenticated`.
- Audit **every** `SECURITY DEFINER` function for an explicit grant posture; add a
  migration-lint / CI check that fails on a new DEFINER function without a `REVOKE`/`GRANT`.

**Acceptance criteria.**
- [ ] Calling `reset_all_analytics`, `restore_analytics`, and `increment_upload_quota` via
      PostgREST with the anon key returns `403`/permission-denied (integration test with a
      raw anon-key HTTP call, not the backend client).
- [ ] Admin reset still works through `backend/api/v1/admin.py` (service-role path unchanged;
      existing admin test green).
- [ ] `grant_xp` rejects `p_xp` above the cap and below 0; the SRS/gamification tests still
      pass with legitimate grants.
- [ ] A repo-wide audit lists every `SECURITY DEFINER` function with its grant posture;
      each is either `PUBLIC`-safe by design (documented) or `REVOKE`d.
- [ ] CI fails a migration that adds a `SECURITY DEFINER` function without an explicit grant line.

### P0-2 · Fix or delete the idempotency middleware

**Why.** Verified: `check_idempotency` (`backend/core/idempotency.py`) keys on
`getattr(request.state, "user_id", "anonymous")`, but `request.state.user_id` is **never set
anywhere** in the backend. It's a `Depends()` on `exams.py:282,335` (and per audit,
`courses.py`/`review.py`). Consequences: (1) all users share the `"anonymous"` namespace, so
user A's `Idempotency-Key` 409s user B's unrelated request; (2) it `SETEX`s the key *before*
running the handler and never stores/replays the response, so it prevents duplicate
*execution* but returns a 409, not the original result; (3) it never releases the key on
failure — a transient 500 means that key **409s every retry for 24 hours**.

**What.** Either implement it correctly or remove it:
- *Correct path:* set `request.state.user_id` in `verify_token`; `SET NX` atomically as a lock;
  persist the response body+status on success and **replay** it on a repeat key; release/record
  on completion (success or terminal failure) so retries work.
- *Remove path:* if true idempotency isn't needed yet, delete the dependency and rely on the
  DB-level dedupe keys that already exist (`xp_events.dedupe_key`, review-grade uniqueness).

**Acceptance criteria.**
- [ ] Two different users sending the same `Idempotency-Key` value never collide (test).
- [ ] A repeated key returns the **original response** (same body + status), not a bare 409.
- [ ] A handler that raises releases the key so an immediate retry succeeds (no 24h lockout).
- [ ] Endpoints currently depending on it (`exams`, `courses`, `review`) behave correctly
      under double-submit (integration test asserting one side effect, one successful response).

### P0-3 · Promote script-only DDL into version control

**Why.** The `slide_embeddings` pgvector table and the `match_slides` retrieval RPC — the
backbone of the tutor/RAG feature — exist **only** in un-versioned `backend/scripts/slide_embeddings.sql`
and `backend/scripts/migrations.sql`, never in `supabase/migrations/`. Yet
`20260502000001_slide_parse_cache.sql:31` runs `ALTER TABLE slide_embeddings ...`, assuming
the script already ran. A clean `supabase db reset` from migrations alone leaves the entire
AI path broken (missing table + RPC). Worse, the two script copies have **drifted into
incompatible definitions**: one returns `pdf_hash`, one doesn't, and `retrieval.py:81` filters
on `pdf_hash` — so "which version is live" depends on whichever file someone ran by hand.

**What.**
- Move `slide_embeddings` DDL, its index, and the canonical `match_slides` (pick the
  `pdf_hash`-returning contract) into a real migration; delete the divergent script copies.
- Add a CI job: `supabase db reset` against an empty DB → boot the backend → run a smoke test
  that exercises upload→parse→tutor. This would have caught the drift automatically.
- Commit a `schema.sql` dump (`supabase db dump`) as a reviewable source-of-truth snapshot.

**Acceptance criteria.**
- [ ] `supabase db reset` on an empty database produces a schema where the tutor smoke test
      passes (embed → `match_slides` → grounded answer) with **zero** manual script runs.
- [ ] `backend/scripts/slide_embeddings.sql` and `migrations.sql` are deleted; `git grep`
      finds no DDL outside `supabase/migrations/`.
- [ ] A single canonical `match_slides` signature exists; a DB test asserts the deployed
      function's return columns match what `retrieval.py` consumes.
- [ ] CI runs the reset-from-migrations smoke test on every PR that touches `supabase/` or
      `backend/services/parser|ai/`.

---

## 6. PHASE 1 — See everything (instrumentation)

You cannot 10x what you cannot measure. This phase turns the system from opaque to legible.

### P1-1 · LLM cost + token accounting and a fleet-global budget

**Why.** The only budget mechanism is `ProviderRotator` (`orchestrator.py:418-509`): an
in-memory dict of **daily request counts** (not tokens, not dollars), reset at UTC midnight,
**per-process** — so every uvicorn/Arq worker has its own counter and the fleet collectively
blows past each provider's real limit and just absorbs 429s. There is **zero** per-user,
per-course, or per-month token/cost metering anywhere (`grep` for `total_tokens`/`cost_usd`
finds only archived `_legacy/`). The `openai` provider is configured `daily_limit=0`
(unlimited), `max_retries=0` (`orchestrator.py:216-225`) — if an `OPENAI_API_KEY` is set as
the paid fallback, **spend is uncapped and unattributable**. At 10x usage the free tiers
exhaust and you get either a quality collapse (all-429) or an uncapped bill.

**What.**
- Capture `resp.usage` on every OpenAI-compatible call in `_call_openai_compat`; persist
  `{ts, user_id, course_id, feature, provider, model, prompt_tokens, completion_tokens, est_cost}`
  to a new `llm_calls` table (append-only, service-role write).
- Move the daily/RPM counters out of in-process memory into Redis so the budget is
  fleet-global and survives restarts.
- Add a hard **per-user and per-month token/cost cap**, enforced pre-call (especially gating
  the unlimited `openai` fallback). This is also the monetization seam (`upload_quotas` sibling).
- Expose cost as metrics (`llm_cost_usd_total{provider,model,feature}`) and a per-user rollup
  the admin console can read.

**Acceptance criteria.**
- [ ] Every LLM completion writes an `llm_calls` row with token counts and an estimated cost;
      a parse of a known deck produces the expected row count (~1/slide + quiz).
- [ ] The daily provider budget is shared across ≥2 worker processes (test: two workers, one
      combined counter — the second worker sees the first's consumption).
- [ ] A user exceeding their monthly token cap gets a clear, typed error before any provider
      is called; the cap is configurable per plan.
- [ ] The `openai` (paid) provider cannot be invoked once the global daily cost ceiling is hit.
- [ ] `/metrics` (see P1-2) exposes cost and token counters by provider/model/feature.
- [ ] An admin can see per-user monthly LLM spend.

### P1-2 · Application metrics + correlation-ID fix

**Why.** No Prometheus, no OpenTelemetry, no `/metrics` — observability is JSON logs + Sentry
only (`grep` for `prometheus`/`/metrics`/`Counter(` finds only `collections.Counter`). You
cannot see queue depth, job duration, cache hit-rate, auth-cache efficiency, LLM latency, or
per-route p95 as time series. Separately, `set_correlation_id` mutates a **module-global
filter attribute** (`core/logging_config.py:31`), set per-request in middleware — under
concurrent async requests, request B overwrites A's ID before A's logs flush, so the one
thread you'd pull in an incident is wrong under load.

**What.**
- Add `prometheus-fastapi-instrumentator` for RED metrics at `/metrics`; add custom
  gauges/histograms for Arq queue depth, job duration/outcome, auth-cache hit rate, LLM
  latency + cost (P1-1), cache hit/miss.
- Ship Grafana + Prometheus in `docker-compose.prod.yml`; a starter dashboard for the
  golden signals.
- Replace the global-filter correlation ID with a `contextvars.ContextVar`.

**Acceptance criteria.**
- [ ] `/metrics` returns Prometheus text with request rate/latency/error by route, plus the
      custom queue/job/cache/LLM series.
- [ ] Under 50 concurrent requests, each request's log lines carry its own correlation ID
      (test asserts no cross-attribution).
- [ ] A Grafana dashboard renders the golden signals + queue depth + LLM cost from a live run.
- [ ] Alerts fire on: queue depth > threshold, `/health/ready` failing, error rate spike,
      daily LLM cost ceiling approached.

### P1-3 · AI evaluation harness + golden sets

**Why.** AI output quality is **unmeasured**. The only "eval" is
`tests/unit/test_course_tutor_grounding.py` — 21 synthetic-number assertions on a pure
threshold function; it never calls a model or embeds anything. There is no golden set or
regression harness for quiz correctness, tutor faithfulness, retrieval precision/recall,
synthesis quality, or card quality. No prompts or responses are ever logged
(`orchestrator.py`, `llm_client.py`). Every prompt change, model swap, and provider failover
silently changes output quality with no way to detect a regression — the single biggest blind
spot for a product whose value *is* the AI output.

**What.**
- Freeze ~5 representative decks as fixtures. Build golden sets for: (a) quiz answer-key
  correctness (human-verified), (b) tutor faithfulness (question → expected grounded slides),
  (c) retrieval precision@k on real embeddings.
- Nightly (not per-commit — it's slow/flaky/costly) eval against live models with an LLM-judge
  for open-ended quality; track scores over time and alert on regression beyond a band.
- Log every prompt+response behind a flag with TTL so any bad output is reproducible.

**Acceptance criteria.**
- [ ] A `make eval` / nightly CI job produces a scorecard: quiz-key accuracy %, tutor
      faithfulness %, retrieval P@k, synthesis quality (judge score) per frozen deck.
- [ ] A deliberate prompt regression (seeded) drops a score below its band and the job fails.
- [ ] Scores are persisted per run and plottable over time (trend, not just pass/fail).
- [ ] With prompt/response logging on, a flagged bad output can be replayed from stored inputs.

### P1-4 · Scope single-lecture tutor retrieval in SQL

**Why.** `retrieval.py:70-94` calls the **un-scoped** `match_slides` RPC with `limit≈20` then
filters to the lecture **in Python**. The RPC is a global cosine scan over *all*
`slide_embeddings`. This is the exact failure the team already fixed for the *course* path —
the migration comment says so verbatim (`20260710030000_global_search.sql:6-9`): a Python
post-filter over an unbounded ANN scan "would silently drop enrolled-course hits whenever the
candidate window fills up with other courses' slides." They built `match_slides_scoped` for
courses but left the single-lecture tutor on the old path. At 10x corpus the global top-20
fills with other lectures' slides and the target lecture's relevant slides stop appearing →
the flagship tutor silently loses grounding.

**What.** Add `match_slides_by_lecture(query_embedding, lecture_id/pdf_hash, threshold, count)`
that filters in SQL (mirror `match_slides_scoped`); retire the Python post-filter; drop the
4x over-fetch. Ship under P0-3's migration discipline.

**Acceptance criteria.**
- [ ] The single-lecture tutor retrieves via an SQL-scoped RPC; `retrieval.py` no longer
      post-filters candidates by lecture in Python.
- [ ] Seeded test: with N other lectures' embeddings loaded, a query still returns the target
      lecture's top-k relevant slides (the pre-fix path measurably fails this as N grows).
- [ ] Retrieval p95 improves or holds while `count` drops from ~20 to k (no over-fetch).
- [ ] Retrieval-quality metrics (similarity distribution, refusal rate, current-slide-only
      fallback rate) are logged per tutor call (feeds P1-2/P1-3).

---

## 7. PHASE 2 — Scale the foundation

### P2-1 · Make RLS the API authorization boundary

**Why.** Routers reference the RLS-**bypassing** service-role client `supabase_admin`
**151 times** vs **4** references to any RLS-enforcing client. Authorization is hand-rolled in
Python (e.g. `list_courses` reads all courses with `supabase_admin` then re-implements student
visibility in Python — `courses.py:194-233`). The database is not the authorization boundary;
every one of 151 sites must get the manual filter exactly right or it leaks cross-tenant data.

**What.** Route user-facing reads/writes through the per-user RLS-enforcing client (extend the
`analytics_service.get_auth_client` pattern); delete hand-rolled visibility filters like
`_student_visible_course_ids`. Reserve `supabase_admin` for background jobs, storage, and admin.
Add a lint rule banning `supabase_admin` imports in `api/v1/` without a sign-off comment.

**Acceptance criteria.**
- [ ] The highest-traffic user routes (courses, library, review, search) use the RLS client;
      cross-tenant isolation is proved by the existing `-m db` RLS test pattern extended to the API.
- [ ] `_student_visible_course_ids` and equivalent manual filters are deleted; the RLS policy
      enforces the same visibility (regression test: a non-enrolled student sees zero rows).
- [ ] A CI lint fails a new `supabase_admin` reference in `api/v1/` lacking a sign-off comment.
- [ ] `supabase_admin` call sites in `api/v1/` drop from 151 to a documented, audited minimum.

### P2-2 · Horizontal scale — asyncpg hot paths + move cron off the web process

**Why.** 359 sync `.table(...)` REST calls run in the threadpool; prod pins uvicorn
`--workers 1` (`docker-compose.prod.yml:114`) so the ~40-thread default pool is the entire
concurrency ceiling. And daily nudges run via **in-process APScheduler** with no leader
election (`nudge_scheduler.py`) — a second API replica would double-fire every nudge, which is
*why* it's pinned to one worker. The system physically cannot scale horizontally today.

**What.** Standardize hot user-facing read paths (analytics, review queue, search, course
overview) on parameterized `asyncpg` behind the existing pool; reserve Supabase REST for
storage/admin. Move daily nudges from APScheduler to Arq `cron_jobs` (unused today). Then lift
the `--workers 1` pin and run ≥2 replicas.

**Acceptance criteria.**
- [ ] Hot read endpoints use `asyncpg`; a load test shows throughput scaling past the previous
      threadpool ceiling on the same box.
- [ ] Nudges run as an Arq cron job; running 2 API replicas fires each nudge **exactly once**
      (test with duplicate-replica setup).
- [ ] Prod runs ≥2 uvicorn workers/replicas with no double-fired nudges and no scheduler
      coupling to web-process lifecycle.
- [ ] `/health/ready` and metrics remain correct across replicas.

### P2-3 · Worker hardening — DLQ, per-job idempotency, status table

**Why.** One Arq queue, no dead-letter handling, no per-job idempotency, no job status
table. Job observability is limited to Arq's `keep_result` in the 128MB `noeviction` queue
Redis, which can pressure memory under load. A permanently-failing job (poison pill) after
`max_tries=5` has nowhere to land, and a growing backlog is hard to detect/drain.

**What.** Add a DLQ for jobs that exhaust retries; make `parse_pdf_unified` /
`generate_review_cards` idempotent (dedupe by `pdf_hash`/`lecture_id`); add a `jobs` status
table (or metrics from P1-2) for queued/running/failed/DLQ counts and per-job duration.

**Acceptance criteria.**
- [ ] A job that fails `max_tries` times lands in the DLQ with its payload + last error; it is
      inspectable and manually re-drainable.
- [ ] Re-enqueuing the same `pdf_hash` while one is in flight does not double-process (test).
- [ ] Queue depth, running, failed, and DLQ counts are visible as metrics; an alert fires on
      DLQ growth or backlog beyond threshold.
- [ ] Queue Redis memory stays bounded under a burst load test (no OOM on the noeviction store).

### P2-4 · Fix analytics-cache invalidation thrash

**Why.** `trg_invalidate_analytics_cache` fires **AFTER INSERT per row** on `learning_events`
and does `DELETE FROM analytics_cache WHERE lecture_id = lid`
(`20260503000017_analytics_cache.sql:73-85`). `learning_events` is the fastest-growing table
(one row per slide view / quiz attempt), so a lecture's cache is wiped on **every** student
interaction — hit-rate collapses precisely when a lecture is actively used, and the professor
dashboard recomputes aggregates repeatedly. Correct but self-defeating; no debounce.

**What.** Replace per-row `DELETE`-on-every-event with a lightweight "mark dirty" (bump a
`dirty_at` on a per-lecture row) plus a short min-recompute interval; or move hot aggregates to
materialized views refreshed on a schedule. Standardize the `learning_events` key spelling
(`lecture_id` vs `lectureId`) the trigger currently double-parses.

**Acceptance criteria.**
- [ ] Under a simulated active lecture (100 events/min), analytics-cache hit-rate stays high
      (metric: hit-rate before vs after); the dashboard is not recomputed on every event.
- [ ] Professor dashboard data is at most `interval` stale and never wrong (bounded staleness,
      documented).
- [ ] `learning_events` uses one canonical key spelling; the trigger no longer parses two.
- [ ] p95 of the professor overview endpoint under load drops measurably vs baseline.

---

## 8. PHASE 3 — Cost & pipeline efficiency

### P3-1 · Batch per-slide synthesis + budget pre-flight gate

**Why.** The live pipeline does **one LLM call per slide** for resilience
(`unified_orchestrator.py` docstring:9-13), while a batched path
(`batch_analyze_text_slides`, 8 slides/call with overlap context) already exists and is
**unused** — an ~8x cost multiple on the dominant cost driver. Separately, the
`remaining_headroom` pre-flight abort exists only in the older `file_parse_service.py:276`,
not in the live `parse_pdf_unified` loop — so the live path starts a 40-slide job with
insufficient quota and fails mid-parse.

**What.** Route synthesis through `batch_analyze_text_slides` with **automatic per-slide
fallback on batch failure** (you have both halves — keep the resilience, capture the 8x).
Add a `remaining_headroom` pre-flight gate to `parse_pdf_unified` so under-budget jobs fail
fast instead of mid-way.

**Acceptance criteria.**
- [ ] A 30-slide deck parses with ≈N/8 synthesis calls (not N), verified via `llm_calls`
      (P1-1); output quality holds vs the per-slide baseline (P1-3 eval, no regression).
- [ ] A forced batch failure falls back to per-slide for that batch only; the lecture still
      completes with the correct slide count.
- [ ] A parse started with insufficient daily headroom aborts pre-flight with a clear status,
      not a mid-parse failure.

### P3-2 · Content-hash embedding dedupe + query-embedding cache

**Why.** `_safe_embedding_task` computes `content_hash = sha256(text)` **after** already
calling `generate_embeddings(text)` (`file_parse_service.py:822-843`) and nothing ever reads
`content_hash` to skip re-embedding. Any re-parse re-pays every Gemini embedding call — the
tightest free tier. Tutor query embeddings are also uncached (each question embeds fresh).

**What.** Before embedding, look up `slide_embeddings` by `content_hash` and reuse if present;
only embed changed slides on re-parse. Cache tutor query embeddings in Redis (short TTL).

**Acceptance criteria.**
- [ ] Re-parsing an unchanged deck issues **zero** embedding calls (verified via `llm_calls`).
- [ ] Changing one slide re-embeds exactly that slide.
- [ ] Repeated identical tutor questions within the TTL issue one query embedding, not N.

### P3-3 · pgvector HNSW + real upsert constraint

**Why.** `slide_embeddings` upsert is a documented **delete-then-insert** because the table
has no unique constraint (`cache.py:421-457`) — racy under concurrent parses (duplicate
embeddings) and churns dead tuples under the ivfflat index, degrading recall. All vector
indexes are `ivfflat` (never `hnsw`), whose recall degrades as the table outgrows its `lists`
value and which needs periodic REINDEX and data-at-build-time.

**What.** Add `UNIQUE(pdf_hash, slide_index, pipeline_version)` to `slide_embeddings`; replace
delete-then-insert with `INSERT ... ON CONFLICT DO UPDATE`; switch the vector index to
`hnsw (embedding vector_cosine_ops)`.

**Acceptance criteria.**
- [ ] Two concurrent parses of the same PDF produce no duplicate embedding rows (test).
- [ ] Upsert is a single `ON CONFLICT` statement; no delete-then-insert remains.
- [ ] Retrieval recall/latency holds or improves as the corpus grows past the old `lists`
      target (benchmark at 10x row count).

---

## 9. PHASE 4 — Velocity & platform hygiene

### P4-1 · Break up god-objects + finish the repository layer

**Why.** `analytics_service.py` is 1,801 lines / 40+ module functions with an 11x-repeated
`get_X`/`_compute_X` cache-wrapper and an unrelated student-scheduling function
(`get_personal_optimal_schedule:1664`). `file_parse_service.py` is 1,171. `repositories/`
holds only 183 LOC. High merge-conflict surface; hard to unit-test.

**What.** Split `analytics_service` by domain (lecture/quiz/professor/benchmark); extract the
cache-wrapper into one `@cached_analytic` decorator; move `courses`/`practice_sheets`/
`assignments` DB logic into services/repos so every router is thin like `analytics.py`.

**Acceptance criteria.**
- [ ] No backend source file exceeds ~600 lines; `analytics_service` is split into domain modules.
- [ ] The cache-wrapper boilerplate is a single decorator (net LOC drop, behavior unchanged —
      analytics tests green).
- [ ] `courses`/`practice_sheets`/`assignments` routers contain no direct DB calls.

### P4-2 · API contract — central DTOs, one envelope, pagination fix

**Why.** `schemas/` holds only `error.py` (11 lines); 77 Pydantic models are inline across
routers. Success responses are ad-hoc (`{success,data}`, bare dicts, `{title}`, `{enrolled}`
coexist). And `list_courses` filters by visibility **in Python after applying `limit`**
(`courses.py:207-233`) — so a page returns fewer than `limit` rows while `has_more`/cursor are
computed on the unfiltered set, silently mispaginating.

**What.** Centralize DTOs in `schemas/`; adopt one success envelope with `response_model=`
everywhere; ship a shared cursor-pagination helper that filters **before** `limit`; add
OpenAPI/contract tests so envelope drift fails CI.

**Acceptance criteria.**
- [ ] All response DTOs live in `schemas/`; every route declares `response_model=`.
- [ ] One documented success envelope; a contract test fails on drift.
- [ ] `list_courses` returns exactly `limit` visible rows when more exist, with correct
      `has_more`/cursor (regression test on the post-filter bug).

### P4-3 · Prompt registry — centralize, version, log

**Why.** Prompts are inline f-strings across ≥5 modules (`synthesis.py`, `tutor.py`,
`ask_*.py`), no versioning, no logging. You cannot A/B a prompt, correlate a bad output to the
prompt that produced it, or run P1-3 evals against a versioned prompt. Also: bulk/quality
chains send plain completions with no `response_format` (`orchestrator.py:525-531`) — provider
JSON mode would remove a class of parse failures for free.

**What.** Move all inline prompts into a registry with a `prompt_version` stamped onto each
`llm_calls` row (P1-1) and `pipeline_run_metrics`; enable provider JSON mode where supported.

**Acceptance criteria.**
- [ ] No inline prompt f-strings remain in service modules; all resolve through the registry.
- [ ] Every `llm_calls` row carries the `prompt_version` used.
- [ ] JSON mode is on for providers that support it; the JSON-salvage path's invocation rate
      (metric) drops.

### P4-4 · Migration governance + CI hardening + dead-code purge

**Why.** 3 timestamp collisions (`20260503000008/19/20`), no down-migrations, no schema dump,
7-migration RLS churn on `profiles`. Backend CI has no `ruff`/`mypy` and no `--cov-fail-under`.
30/39 `requirements.txt` lines are unpinned. Dead weight: `backend/_legacy/` (~2,514 LOC),
`scratch/`, empty `loadtest/`, `fast_upload_model` config, and dead tables `slide_chunks` +
`tutor_messages` (zero live writers/readers) plus write-idle `concept_mastery`/`concept_lectures`
that `scheduler.py`/`nudge_engine.py`/`study_guide_service.py` read and silently degrade on.

**What.** Timestamp-uniqueness lint; a squashed baseline migration + committed schema dump;
add `ruff` + `mypy` + `--cov-fail-under` to backend CI; pin deps with `pip-tools`/`uv`; delete
`_legacy/`, `scratch/`, empty `loadtest/`, `slide_chunks`/`tutor_messages`, and either wire or
stop reading the concept-mastery tables.

**Acceptance criteria.**
- [ ] CI fails a migration with a duplicate timestamp; a committed `schema.sql` matches the
      migration-applied schema.
- [ ] Backend CI runs `ruff` + `mypy` and enforces a coverage floor; `requirements.txt` is fully pinned.
- [ ] `_legacy/`, `scratch/`, empty `loadtest/`, `fast_upload_model`, `slide_chunks`, and
      `tutor_messages` are deleted (~2,500+ LOC removed); the reset-from-migrations smoke test (P0-3) still passes.
- [ ] Features reading `concept_mastery`/`concept_lectures` either get a real writer wired in
      or stop reading empty tables (no silent degradation).

---

## 10. Sequencing

```
Phase 0  (week 1)      ██  P0-1 · P0-2 · P0-3         ← ship immediately, independent
Phase 1  (weeks 1–4)     ████████  P1-1 · P1-2 · P1-3 · P1-4
Phase 2  (weeks 4–8)          ████████  P2-1 · P2-2 · P2-3 · P2-4
Phase 3  (weeks 7–10)              ██████  P3-1 · P3-2 · P3-3   (parallel w/ late P2)
Phase 4  (weeks 8–12)                 ██████  P4-1 · P4-2 · P4-3 · P4-4  (ongoing)
Phase 5  (weeks 10–14)                    ██████  P5-1 · P5-2 · P5-3 · P5-4  (after P2-4)
Security (continuous)  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓  S-1 · S-2 escalated near-P0; S-3…S-6 ongoing
```

| Milestone | Definition of done |
|---|---|
| **F0 — Safe** | No unauthenticated destructive/quota RPC; idempotency fixed; `db reset` reproduces the AI path from migrations alone. |
| **F1 — Legible** | LLM cost metered + capped; `/metrics` + Grafana live; nightly AI eval scorecard; tutor retrieval scoped in SQL. |
| **F2 — Scalable** | RLS is the API auth boundary; ≥2 web replicas with cron on Arq; worker DLQ + status; analytics cache no longer thrashes. |
| **F3 — Efficient** | Synthesis batched (~8x cost cut, quality held); embeddings deduped; HNSW + real upsert. |
| **F4 — Maintainable** | God-objects split; one API contract; prompt registry; migration governance + CI gates; dead code gone. |
| **F5 — Data-platform** | Typed event contract; analytics off the primary OLTP DB (views/replica/warehouse); async rollups; `learning_events` partitioned + retention. |
| **Sec — Compliant** | Full RPC/table exposure audit clean; GDPR sub-processor list + erasure/export live; proxy/rate/storage/supply-chain hardened; security in CI. |

---

## 11. Success metrics (how we know the foundation is 10x)

| Metric | Baseline (today) | Target |
|---|---|---|
| Unauthenticated destructive surface | ≥1 RPC (verified) | 0 |
| LLM spend visibility | none | per-call, per-user, per-month; hard cap enforced |
| LLM cost per parsed lecture | unmetered (~8x from no batching) | measured; ~1/8 synthesis cost |
| AI quality regressions caught | 0 (unmeasured) | caught nightly before ship |
| Prod incident MTTD | log-grep only | dashboard + alert (queue/latency/cost/readiness) |
| Max safe web workers | 1 (hard-pinned) | ≥ N (horizontal) |
| Cross-tenant authz surface | 151 manual filters | RLS-enforced, ~0 manual |
| Reproducible schema (`db reset`) | breaks AI path | full smoke test green |
| Dead/write-idle tables read at runtime | ≥5 | 0 |

---

## 12. Cost model & projections

> **These numbers are illustrative — the point is the *model and the levers*, not the
> decimals.** P1-1 (LLM cost accounting) replaces every estimate below with measured truth;
> until then, treat the inputs as knobs and plug your real telemetry. Today most traffic
> rides free provider tiers, so the *dollar* line is near-zero — the exposure is in the
> **tail** (uncapped paid fallback) and in what happens at 10x/100x when free tiers throttle.

### 12.1 Per-unit token model (the formula)

| Unit | LLM work | ~Tokens (blended) |
|---|---|---|
| One slide (live per-slide path) | 1 synthesis completion + 1 embedding | ~2.0k completion + ~0.5k embed |
| Deck-level quiz | 1 completion | ~6k (≈4k in / 2k out) |
| **One 30-slide lecture** | ~31 completions + 30 embeddings | **~64k completion + ~15k embed** |
| One tutor question | 1 query embed + 1 grounded generation | ~0.05k embed + ~3k completion |
| One review card grade | none (cards are one-time at parse; grading is pure) | 0 |

### 12.2 Volume scenarios (swap for your funnel)

| | 1x (early) | 10x | 100x |
|---|---|---|---|
| Active students | 50 | 500 | 5,000 |
| Lectures parsed / mo | 200 | 2,000 | 20,000 |
| Tutor questions / mo | 3,000 | 30,000 | 300,000 |
| **Completion-path tokens / mo** | ~21.8M | ~218M | ~2.18B |
| **Embedding tokens / mo** | ~3M | ~30M | ~300M |

Derivation: parse completions `200×64k = 12.8M`; tutor completions `3,000×3k = 9M`;
sum ≈ 21.8M at 1x, linear thereafter.

### 12.3 Dollar exposure (paid-fallback regime)

Using a **representative cheap-tier blended rate as a knob** (~$0.40 / M tokens — the
order-of-magnitude of a small hosted model; substitute your real fallback price):

| | 1x | 10x | 100x |
|---|---|---|---|
| Paid-equivalent LLM $/mo (per-slide path) | ~$9 | ~$87 | **~$870** |
| After P3-1 batching (synthesis −40–55%) | ~$5 | ~$45 | ~$450 |
| After P3-2 embedding dedupe (re-parses ≈ free) | marginal | marginal | further −10–20% |

**The number that should worry you is not the blended average — it's the tail.** The
`openai` provider is `daily_limit=0`, `max_retries=0` (`orchestrator.py:216-225`). If a
traffic spike throttles the free tiers and spills to a *frontier* paid model, 100x traffic
at frontier prices is **10–30x** the table above — uncapped, and unattributable to any user
or feature. P1-1's per-user cap + fleet budget + the `openai` ceiling is what converts this
from "surprise five-figure bill" to a bounded, budgeted line item.

### 12.4 Database tier

`learning_events` is the cost driver (§13): one row per interaction.

| Scale | Rough DB posture |
|---|---|
| 1x | Supabase Free/Pro ($25/mo) is fine |
| 10x | Pro + the analytics-cache fix (P2-4) so aggregation load doesn't dominate |
| 100x | Team-tier or self-managed Postgres on the existing Hetzner footprint **+ analytics offloaded to a read replica / warehouse** (§13) — running 1,801 lines of aggregation against the primary OLTP DB stops being viable |

**Takeaway:** at your current stage cost is not the constraint — *visibility* is. Ship P1-1
first so the 10x/100x columns become measured, then P3-1/P3-2 to bend the curve, and treat
the uncapped `openai` fallback as a P0-adjacent guardrail.

---

## 13. PHASE 5 — Data platform (the `learning_events` spine)

`learning_events` is the fastest-growing table and the substrate for all analytics, nudges,
and the SRS. Today it's an append-only JSONB log with **no `event_type` CHECK**, **two key
spellings** the invalidation trigger has to double-parse (`lectureId` vs `lecture_id`,
`20260503000017:60-71`), a per-row `DELETE` cache-bust trigger, and 1,801 lines of
in-request aggregation running against the primary OLTP database. That works at 1x and
collapses at 100x. This phase makes the event pipeline a real data platform.

### P5-1 · Event schema governance

**Why.** `event_type` is unconstrained free-text; payload shapes drift; consumers defensively
parse variants. There's no contract, no versioning, no validation at write.

**What.** Define a typed event contract (an enum/reference table + one canonical payload shape
per type + a `schema_version`), validated at the write boundary (Pydantic on the emit path,
CHECK/FK in the DB). Standardize on one key spelling.

**Acceptance criteria.**
- [ ] Every `learning_events` row has a known `event_type` (constrained) and a payload that
      validates against that type's schema; an unknown type is rejected at write.
- [ ] One canonical key spelling; the invalidation trigger no longer double-parses.
- [ ] A registry documents every event type + payload; adding a type is a reviewed change.

### P5-2 · OLTP / OLAP split

**Why.** Heavy analytics aggregation runs synchronously against the primary DB; the cache
that should absorb it thrashes (P2-4). This caps both dashboard latency and OLTP headroom.

**What.** Staged by lift: (a) time-partition `learning_events` + materialized views refreshed
on a schedule (builds on P2-4); (b) a logical read replica dedicated to analytics; (c) at
100x, CDC/batch-ship events into a columnar store (ClickHouse / DuckDB / BigQuery) with dbt
models for the professor-facing aggregates. Start at (a)+(b); graduate to (c) on evidence.

**Acceptance criteria.**
- [ ] Professor-analytics reads hit materialized views / replica / warehouse, not live
      per-request aggregation over the primary; p95 improves under load.
- [ ] Primary-DB CPU from analytics queries drops measurably (metric before/after).
- [ ] Dashboard staleness is bounded and documented; numbers reconcile with source events.

### P5-3 · Async ingestion pipeline

**Why.** The synchronous trigger couples student write-path latency to analytics bookkeeping.

**What.** Events land fast; a scheduled/streamed rollup job (Arq cron, building on P2-2)
computes aggregates out-of-band. Student writes no longer pay analytics cost inline.

**Acceptance criteria.**
- [ ] A student action's write latency is independent of analytics recompute (test/metric).
- [ ] Rollups are eventually-consistent within a documented window; a rollup failure is
      observable (P1-2) and self-heals on the next run.

### P5-4 · Retention & partitioning

**Why.** An unbounded per-interaction log grows without limit; old raw events have low value
vs their storage/scan cost, and GDPR wants retention limits (§14, S-2).

**What.** Time-partition `learning_events`; archive/downsample raw events older than a
threshold into rollups; a documented retention policy.

**Acceptance criteria.**
- [ ] `learning_events` is partitioned by time; dropping an old partition is O(1).
- [ ] A retention policy downsamples/archives raw events past the threshold; analytics that
      need history read rollups.
- [ ] Retention window is documented and aligned with the GDPR posture (S-2).

---

## 14. Security & threat-model track

> Extends the existing `threat_model.md`. P0-1 (RPC lockdown) is the acute fix; this track is
> the systematic pass. **GDPR is first-class here** — the product targets DACH universities,
> so EU data-protection is a requirement, not a nice-to-have.

### S-1 · Systematic PostgREST / RPC exposure audit

**Why.** The `reset_all_analytics` unauth-wipe (P0-1) is one instance of a *class*: with the
public anon key, every `SECURITY DEFINER` function and every exposed table/view is reachable
via PostgREST unless RLS/grants say otherwise. There is no global function lockdown in the
migrations, so each function's posture is individual and unaudited.

**What.** Enumerate every DEFINER function and its grant posture; every table/view PostgREST
exposes and its RLS; storage-bucket policies. Adopt "REVOKE-by-default, GRANT-explicitly" and
a CI check (from P0-1) enforcing it.

**Acceptance criteria.**
- [ ] A checked-in inventory lists every DEFINER function + exposed relation with its
      intended caller and grant posture; each is justified or locked down.
- [ ] A raw anon-key PostgREST probe of every RPC/table returns only intended access (test suite).
- [ ] CI fails any new DEFINER function or table lacking an explicit grant/RLS decision.

### S-2 · GDPR / EU data-protection posture

**Why (two hard findings).**
1. **Cross-border transfer + sub-processors.** Student-uploaded PDF *content* and tutor
   *questions* are sent to US LLM providers (Cerebras / Groq / Gemini / OpenAI). For an EU
   education product handling student data, this needs a documented sub-processor list, DPAs,
   and a lawful transfer basis (SCCs) — or EU-region/self-hosted inference for sensitive
   content. This is a genuine compliance gap.
2. **Right-to-erasure & portability.** There must be a user-initiated delete-my-account +
   data-export flow that cascades **all** PII and derived artifacts (profile, uploads,
   embeddings, `learning_events`, review state). Verify one exists and is complete.

**What.** Publish a sub-processor list + DPAs (or move sensitive inference in-region); build/
verify erasure + export; set data-minimization + retention (ties to P5-4). Hosting is already
EU (Hetzner) — that's a point in your favor to preserve.

**Acceptance criteria.**
- [ ] A sub-processor list + transfer basis exists for every provider student data reaches;
      or sensitive content is processed in-region.
- [ ] A user can request account deletion and every PII/derived row is removed or anonymized
      (test cascades: profile, uploads, embeddings, events, review schedule).
- [ ] A user can export their data in a portable format.
- [ ] A documented retention policy governs `learning_events` and uploads (aligned with P5-4).

### S-3 · Rate-limit & proxy-trust hardening

**Why.** `ProxyHeadersMiddleware(trusted_hosts=["*"])` (`main.py:73`) + a limiter keyed on the
first `X-Forwarded-For` value (`core/rate_limit.py:13-23`) → a client rotating XFF defeats
per-IP limits.

**What.** Pin the trusted proxy; have the edge overwrite (not append) XFF; key limits on the
authenticated user where available.

**Acceptance criteria.**
- [ ] A spoofed `X-Forwarded-For` cannot bypass rate limits (test); limits hold behind the
      real proxy for legitimate traffic.

### S-4 · Storage & upload security

**Why.** Student uploads are a fresh attack/abuse surface (untrusted PDFs, copyright, PII).

**What.** Confirm `file_validation.py` covers type/size/malformed; verify private-upload RLS
isolation (already tested — keep the regression); signed-URL TTLs; the copyright-takedown flow
(admin visibility toggle exists — document the process).

**Acceptance criteria.**
- [ ] Oversized/invalid/malformed uploads are rejected before parse with friendly errors.
- [ ] A private upload and every derived artifact are unreachable by any other user (RLS test).
- [ ] Storage URLs are time-limited; a documented takedown flow removes content + artifacts.

### S-5 · Secrets & supply chain

**Why.** 30/39 `requirements.txt` lines are unpinned (supply-chain drift); service-role key
and `.env` handling is broad (8KB `.env.example`).

**What.** Pin deps (`pip-tools`/`uv`, overlaps P4-4); add SCA + secret scanning to CI; audit
service-role key scope and storage.

**Acceptance criteria.**
- [ ] `requirements.txt` fully pinned; a lockfile is the build source of truth.
- [ ] CI runs dependency-vuln + secret scanning and fails on a new high-severity finding.
- [ ] The service-role key's blast radius is documented; it never reaches the browser bundle.

### S-6 · Continuous security in CI

**Why.** Security findings should be caught continuously, not in one-off audits.

**What.** Wire the existing `/security-review` pass + a scheduled scan into CI; treat the
RLS-as-boundary work (P2-1) as the enforced authorization layer with regression tests.

**Acceptance criteria.**
- [ ] A scheduled security scan runs and reports; the RLS regression suite gates merges.
- [ ] A deliberately-introduced cross-tenant leak (seeded) fails CI.

---

## 15. Explicitly out of scope (this roadmap)

- Product features — owned by `docs/ROADMAP_10X.md`.
- Frontend/UX work beyond what an API-contract change (P4-2) requires.
- Multi-region / DB sharding — premature until P2 proves single-region horizontal scale.
- Replacing Supabase/PostgREST — the goal is to use it correctly (RLS-as-boundary), not leave it.
- Billing implementation — P1-1's caps are the seam; billing is its own project (as in `ROADMAP_10X.md`).
