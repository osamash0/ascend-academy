import { test, expect } from "@playwright/test";
import { E2E_STUDENT } from "./global.setup";

test.describe("Student True E2E: seeded course access", () => {
  test("login → browse enrolled course → open its lecture", async ({ page }) => {
    await page.goto("/auth");
    await page.locator("#email").fill(E2E_STUDENT.email);
    await page.locator("#password").fill(E2E_STUDENT.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "E2E Integration Course" })).toBeVisible();
    await page.getByRole("button", { name: "Browse Lectures" }).click();

    const lecture = page.getByRole("button", { name: /E2E Gamification Lecture/ });
    await lecture.click();
    await lecture.click();
    await page.getByRole("button", { name: "Open full page" }).click();
    await page.waitForURL(/\/lecture\//, { timeout: 15_000 });

    await expect(page.locator("h1").filter({ hasText: /^First Slide$/ })).toBeVisible({ timeout: 15_000 });
  });
});
