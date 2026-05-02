# Playwright E2E Skeleton

Three high-value journeys are covered (or stubbed) here. They run against
locally-started dev servers and mock Supabase at the network layer via
`page.route()` so the suite stays hermetic.

## Run

```bash
npx playwright install --with-deps chromium  # one-time
npx playwright test                          # headless
npx playwright test --ui                     # interactive
```

## Journeys

| File | Journey | Status |
|---|---|---|
| `student-happy-path.spec.ts` | Signup → dashboard → open lecture → complete quiz → earn XP / badge | skeleton |
| `professor-upload.spec.ts` | Login → upload PDF → SSE progress → publish lecture | skeleton |
| `professor-analytics.spec.ts` | Open lecture analytics → all 4 panels render (overview, dropoff, distractors, AI queries) | skeleton |

The skeletons use `test.fixme()` so they show up in the report as expected-to-be-implemented work without failing the suite. Each `fixme` block carries the
exact route-mocking + assertion plan in comments — un-fixme as the journey
becomes a stable target.
