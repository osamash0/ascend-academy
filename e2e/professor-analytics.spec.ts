import { test, expect } from "@playwright/test";

test.describe("Professor analytics", () => {
  test.fixme("open lecture analytics → all 4 panels render", async ({ page }) => {
    // 1. Mock supabase session → professor.
    // 2. Mock GET /api/analytics/lecture/:id/overview, /slides, /distractors,
    //    /ai-queries with synthetic but realistic shapes (see backend/tests/contract).
    // 3. Visit /professor/analytics/:id.
    await page.goto("/professor/analytics/test-lecture-id");
    //
    // 4. Assert the four panel headings render: Overview, Drop-off, Distractors,
    //    AI Queries.
    await expect(page.getByRole("heading", { name: /overview/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /drop.?off/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /distractors/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /ai queries/i })).toBeVisible();
  });
});
