# Testing — How to Run, Write, and Debug

This is the operator's manual for the Learnstation test suite. The architectural
"why" lives in [`TESTING_STRATEGY.md`](../TESTING_STRATEGY.md); this document is
the "how".

---

## 1. Suites at a glance

| Suite | Tool | Default scope | Command |
|---|---|---|---|
| Backend unit | `pytest` | `backend/tests/unit/` | `python -m pytest backend/tests/unit -q` |
| Backend integration | `pytest` + FastAPI `TestClient` | `backend/tests/integration/` | `python -m pytest backend/tests/integration -q` |
| Backend contract | `pytest` snapshot | `backend/tests/contract/` | `python -m pytest backend/tests/contract -q` |
| Backend DB / RLS | `pytest -m db` (nightly) | `backend/tests/db/` | `python -m pytest -m db` |
| Frontend unit + page-smoke | Vitest + MSW | `src/**/*.test.{ts,tsx}` | `npx vitest run` |
| End-to-end | Playwright (PR-label `e2e`) | `e2e/` | `npx playwright test` |

The default `python -m pytest backend/tests` and `npx vitest run` commands run
everything that is fast and hermetic. Slow / external suites (`db`, `e2e`) are
gated behind explicit markers / labels and only run nightly.

---

## 2. First-time setup

```bash
# Backend deps (uv is blocked in nix; use pip --user)
pip install --user -r backend/requirements.txt

# Frontend deps
npm install --legacy-peer-deps
```

Tests need **no** secrets, no real Supabase project, and no LLM key. If a test
ever requires one of those, that test is wrong — see §6.

---

## 3. Running the suites

### Backend

```bash
# Everything (unit + integration + contract). Currently 117 tests in ~14s.
python -m pytest backend/tests --no-header -q

# A single file
python -m pytest backend/tests/unit/test_content_filter.py -q

# A single test
python -m pytest backend/tests/unit/test_content_filter.py::test_heavy_stem -q

# With coverage report
python -m pytest backend/tests --cov=backend --cov-report=html
open htmlcov/index.html
```

### Frontend

```bash
# All tests once
npx vitest run

# Watch mode
npx vitest

# A single file
npx vitest run src/__tests__/services/lectureService.test.ts

# Coverage
npx vitest run --coverage
open coverage/index.html
```

### Database / RLS (nightly)

These tests boot a throwaway Postgres via `testcontainers-postgres` and apply
every file under `supabase/migrations/` in order. They are slow (~30s startup)
and gated behind the `db` marker.

```bash
python -m pytest -m db
```

### End-to-end (Playwright)

```bash
npx playwright install --with-deps chromium  # one-time
npx playwright test
npx playwright test --ui                     # interactive runner
```

---

## 4. How the mocks work

### Supabase (backend)

`backend/tests/fake_supabase.py` ships an in-memory `FakeSupabaseClient` that
mimics the PostgREST query chain (`from_().select().eq().order().execute()`,
`maybe_single()`, `upsert()`, `insert()`, `update()`, `delete()`). The
`conftest.py` `app` fixture monkey-patches `backend.core.database.get_supabase`
and the per-token `get_supabase_for_token` factory to return the fake. Tests
seed rows via `fake.seed("lectures", [{...}])`.

### Supabase (frontend)

`src/test/supabaseMock.ts` returns a chainable mock with the same surface
(`from()`, `select()`, `eq()`, `order()`, `single()`, `auth.getSession()` …).
For tests that need to both seed/inspect AND inject the mock, import the
singleton from `src/test/sharedSupabaseMock.ts` and mock the supabase client
module to re-export it:

```ts
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

beforeEach(() => supabaseMock.reset());
```

The async factory + dynamic `import()` is required because `vi.mock` is
hoisted; using a top-level `const supabaseMock = createSupabaseMock()` outside
`vi.hoisted()` triggers a `Cannot access ... before initialization` error.

### LLM providers (backend)

`backend/tests/conftest.py` exposes `mock_llm_provider`, which patches
`backend.domain.llm.provider_factory.get` to return a deterministic in-memory
provider. Tests can override individual responses:

```python
def test_quiz_generation(app_client, authed, mock_llm_provider):
    mock_llm_provider.set_response("quiz", {"questions": [...]})
    r = app_client.post("/api/ai/quiz", json={...}, headers=authed())
    assert r.status_code == 200
```

### HTTP API (frontend)

`src/test/server.ts` runs an [MSW](https://mswjs.io) Node server. Default
handlers live in `src/test/handlers/index.ts` and cover analytics, AI,
mind-map, and the streaming PDF upload endpoint. Override per-test with
`server.use(http.get(...))`.

---

## 5. Writing a new test

1. **Pick the layer.** Use the table in §1 to choose where the test belongs.
   When unsure, default to the highest layer that still gives you fast feedback
   (a unit test almost always beats an integration test if both can express the
   assertion).
2. **Place the file.**
   - Backend unit → `backend/tests/unit/test_<module>.py`
   - Backend integration → `backend/tests/integration/test_<router>_router.py`
   - Backend contract → `backend/tests/contract/test_response_schemas.py`
   - Frontend → mirror the source path under `src/__tests__/`
3. **Re-use a fixture before inventing one.** Backend fixtures live in
   `backend/tests/conftest.py`; frontend helpers live in `src/test/`.
4. **No real network.** If a test needs to reach the internet or a real
   Supabase project, stop and add a fake / handler instead.
5. **No production data.** Never paste a real UUID or real student name into a
   fixture. Use `Faker` (backend) or hand-rolled synthetic values (frontend).

---

## 6. Flake & quarantine policy

- A test that fails on `main` blocks the entire branch. Re-run **once** to rule
  out infrastructure noise. If it fails again, revert the offending commit or
  fix the test in the same PR.
- A test that flakes locally but passes in CI is quarantined with
  `@pytest.mark.flaky` (backend) or `it.skipIf(...)` (frontend) and a TODO with
  the owning author. Quarantine is a 7-day countdown — un-quarantine or delete
  by then.

---

## 7. Coverage targets

| Surface | Target | Enforced in CI |
|---|---|---|
| `backend/services/**` | ≥ 70 % statements | yes (job fails below) |
| `backend/api/**` | ≥ 70 % statements | yes |
| `backend/core/**`, `backend/domain/**` | ≥ 70 % statements | yes |
| `src/services/**`, `src/hooks/**` | ≥ 60 % statements | yes |
| `src/pages/**` | smoke-only (mount + loading + empty + first-row) | n/a |
| `src/components/ui/**` (shadcn primitives) | excluded | n/a |

The first-batch suite (this task) ships ≥ 80 cases as the seed; the rest grows
incrementally — each new feature ships with the tests that move its line of the
table closer to target.

---

## 8. Runbook — "where do I start when X breaks?"

| Failure looks like… | Start here |
|---|---|
| `401 Unauthorized` in an integration test | `conftest.py::authed` — has the test passed `headers=authed()`? Is `app.dependency_overrides[verify_token]` wired? |
| `pgrst` / `from_` errors in unit tests | `backend/tests/fake_supabase.py` — does the chain you're calling exist? Add the missing method, don't mock it inline. |
| `Cannot access supabaseMock before initialization` (Vitest) | Use the `sharedSupabaseMock` pattern in §4, not a top-level `const`. |
| MSW `Cannot find request handler` | Add an explicit `server.use(http.get(URL, …))` in the test, or add a default handler to `src/test/handlers/index.ts` if every test needs it. |
| `429 Too Many Requests` between tests | The autouse `reset_rate_limit` fixture should clear slowapi state per-test; if you added a new limiter, register it in that fixture. |
| Streaming endpoint hangs in tests | The MSW SSE handler emits a finite `info → progress → slide → complete` sequence. If your code waits for an event that's not in that list, add it to `src/test/handlers/index.ts`. |
| LLM call returns "administrative information" unexpectedly | The slide hit the metadata short-circuit in `services/content_filter.py`. Add more substantive content to the test fixture. |
| RLS policy regression | `backend/tests/db/` — re-run `pytest -m db` locally; the failing assertion will name the policy and table. |
