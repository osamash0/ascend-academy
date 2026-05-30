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
npx playwright test e2e/student-happy-path.spec.ts   # one spec
npx playwright test --headed --debug         # step through with inspector
```

The Playwright suite is **hermetic** — every Supabase REST/auth call and
every FastAPI endpoint is intercepted with `page.route()`, so the tests do
not need a running backend, real database, or live Supabase project. The
Vite dev server is started automatically by `playwright.config.ts`
(`webServer.command: npm run dev`).

CI runs the suite on three triggers (see `.github/workflows/ci.yml`):

1. PRs labeled **`e2e`** — opt-in to keep PR cycles fast.
2. The nightly schedule (03:17 UTC) — catches regressions even without a PR.
3. `workflow_dispatch` — re-run on demand from the Actions tab.

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
   - End-to-end → `e2e/<journey-name>.spec.ts`
3. **Re-use a fixture before inventing one.** Backend fixtures live in
   `backend/tests/conftest.py`; frontend helpers live in `src/test/`; e2e
   helpers live in `e2e/helpers/`.
4. **No real network.** If a test needs to reach the internet or a real
   Supabase project, stop and add a fake / handler instead.
5. **No production data.** Never paste a real UUID or real student name into a
   fixture. Use `Faker` (backend) or hand-rolled synthetic values (frontend).

### 5a. Writing a new end-to-end (Playwright) test

E2E specs drive the real React app while mocking Supabase + FastAPI with
`page.route()`. Every spec follows the same recipe:

```ts
import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { mockSupabase, loginAs, STUDENT } from "./helpers/supabase-mocks";

// `package.json` declares `"type": "module"`, so use `import.meta.url`
// (NOT `__dirname`) for any fixture path resolution.
const FIXTURE = fileURLToPath(new URL("./fixtures/sample.pdf", import.meta.url));

test("describes one user journey", async ({ page }) => {
  // 1. Install the baseline Supabase mocks (auth + profile + role + RPCs).
  //    Pass any tables your journey reads as arrays; pass `singletons` for
  //    `.single()` reads. Inserts/updates/deletes are auto-handled.
  await mockSupabase(page, {
    user: STUDENT,
    tables: { lectures: [/*…*/], slides: [/*…*/], quiz_questions: [/*…*/] },
    singletons: { lectures: /*…*/ },
  });

  // 2. Layer journey-specific overrides AFTER mockSupabase. Playwright matches
  //    handlers in REVERSE registration order, so anything registered later
  //    wins — useful for one-off FastAPI endpoints, SSE streams, etc.
  await page.route(/\/api\/upload\/parse-pdf-stream/, (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: SSE }));

  // 3. Drive the UI with role-based selectors (preferred) or stable IDs.
  await loginAs(page, STUDENT, /\/dashboard/);
  await page.getByRole("article", { name: /lecture title/i }).click();
  await expect(page.getByText(/lecture complete/i)).toBeVisible();
});
```

Five rules that keep the suite reliable:

1. **Route-handler order matters.** Playwright iterates handlers in *reverse*
   registration order. Register broad fallbacks (e.g. `/auth/v1/`) **first**
   and specific handlers (e.g. `/auth/v1/token`) **last**, otherwise the
   fallback will steal the request. `mockSupabase` already follows this rule.
2. **Always include CORS + OPTIONS preflight.** Every JSON response needs
   `access-control-allow-origin: *`, and any handler that may receive a
   preflight must short-circuit `OPTIONS` with `204` and the
   `access-control-allow-headers/methods` triplet (see
   `e2e/helpers/supabase-mocks.ts`).
3. **`.single()` reads are content-negotiated.** Supabase JS sets
   `Accept: application/vnd.pgrst.object+json` for `.single()`. Branch on the
   header: return the single object on hit, or `406 PGRST116` when there is
   no row (Supabase converts that to `{ data: null, error }`).
4. **Use stable selectors.** Prefer `getByRole("button", { name: /…/ })` and
   `#id` selectors over class chains. If a button label depends on state
   (e.g. SlideViewer's `Continue` ↔ `Finish Course`), use a regex that
   matches both.
5. **Wait for navigation, not timeouts.** Use `page.waitForURL(/regex/)` and
   `expect(locator).toBeVisible({ timeout })` — never `page.waitForTimeout`.

When a journey finishes, add it to the table at the top of `e2e/README.md`
and bump `playwright.config.ts` only if you genuinely need a longer
`webServer.timeout` or a new project.

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
