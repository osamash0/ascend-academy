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
| `student-happy-path.spec.ts` | Signup → dashboard → open lecture → complete quiz → completion toast | active |
| `professor-upload.spec.ts` | Login → upload PDF → SSE progress → publish lecture | active |
| `professor-analytics.spec.ts` | Open lecture analytics → all 4 panels render (drop-off, confidence-by-slide, score distribution, AI queries) | active |

All three journeys are now real tests. They share `helpers/supabase-mocks.ts`,
which installs hermetic `page.route()` handlers for Supabase auth, REST
tables, single-row `.single()` reads, RPCs, and storage uploads. Each spec
layers on the journey-specific mocks (FastAPI SSE, analytics dashboard
endpoint) on top of the baseline. The professor-analytics assertions target
the actual section headings rendered by `ProfessorAnalytics.tsx` — the
"distractors" panel from the original brief maps to the *Score Distribution*
and *Confidence By Slide* sections the page actually exposes.
