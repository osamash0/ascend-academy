import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — runs E2E journeys against locally-started dev servers.
 * Supabase is mocked via Playwright route interception inside each test so
 * the suite stays hermetic (no real auth, no real database).
 *
 * Trigger:
 *   - Locally:    `npx playwright test`
 *   - On a PR:    add the `e2e` label (gated in .github/workflows/ci.yml)
 *   - Nightly:    cron job in CI
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:5000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "python -m uvicorn backend.main:app --port 8000",
      url: "http://localhost:8000/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
