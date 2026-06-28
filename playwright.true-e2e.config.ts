import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Load environment variables (such as Supabase service role key)
dotenv.config();

/**
 * Playwright config — runs TRUE E2E journeys against locally-started dev servers.
 * Supabase is NOT mocked. It connects to the real local database and real backend.
 *
 * Trigger:
 *   - Locally:    `npm run test:e2e`
 */
export default defineConfig({
  testDir: "./e2e/true-e2e",
  // True E2E tests take longer (AI generation, real DB queries)
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // Run sequentially to avoid DB state collisions during global setup/teardown
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Restrict to 1 worker to ensure database state is predictable
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  
  // Set up global test users in the database
  globalSetup: "./e2e/true-e2e/global.setup.ts",
  
  use: {
    baseURL: "http://localhost:5001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Pass along standard env vars to the browser context if needed
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:5001",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "python -m uvicorn backend.main:app --port 8000",
      url: "http://localhost:8000/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
