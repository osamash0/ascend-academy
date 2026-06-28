import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { E2E_PROFESSOR } from "./global.setup";

const FIXTURE_PDF = fileURLToPath(new URL("../fixtures/sample.pdf", import.meta.url));

test.describe("Professor True E2E: PDF Upload", () => {
  test("login → upload PDF → parse (real LLM) → publish", async ({ page }) => {
    // 1. Log in via UI
    await page.goto("/auth");
    await page.locator("#email").fill(E2E_PROFESSOR.email);
    await page.locator("#password").fill(E2E_PROFESSOR.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for auth to redirect to dashboard
    await page.waitForURL(/\/professor\/dashboard/, { timeout: 15_000 });
    // Wait for dashboard heading to confirm login
    await expect(page.locator("h1")).toContainText(/Dashboard|Overview/i);

    // 2. Navigate to upload
    await page.goto("/professor/upload");
    await expect(page.getByRole("heading", { name: /create lecture/i })).toBeVisible({ timeout: 15_000 });

    // 3. Fill details and upload
    const uniqueTitle = `True E2E Lecture ${Date.now()}`;
    await page.locator("#title").fill(uniqueTitle);
    await page.locator('input[type="file"][accept=".pdf"]').setInputFiles(FIXTURE_PDF);

    // Wait for publish button to be ready
    const publishButton = page.getByRole("button", { name: /save lecture/i });
    await expect(publishButton).toBeVisible({ timeout: 10_000 });
    await expect(publishButton).toBeEnabled();

    // 4. Publish (This triggers the REAL backend PDF parser and AI generation)
    // NOTE: This can take 10-40 seconds depending on the local LLM or Groq API
    await publishButton.click();

    // The frontend should show extracting progress. Wait for completion toast.
    await expect(page.getByText(/Lecture created successfully/i, { exact: false })).toBeVisible({
      timeout: 90_000,
    });

    // 5. Redirects to dashboard automatically
    await page.waitForURL(/\/professor\/dashboard/, { timeout: 15_000 });

    // Assert the new lecture is visible on the dashboard
    await expect(page.getByText(uniqueTitle)).toBeVisible();
  });
});
