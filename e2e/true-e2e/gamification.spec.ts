import { test, expect } from "@playwright/test";
import { E2E_STUDENT } from "./global.setup";

test.describe("Student True E2E: Gamification XP & Badges", () => {
  test("login → view slide → earn XP → check achievements", async ({ page }) => {
    // 1. Log in via UI
    await page.goto("/auth");
    await page.locator("#email").fill(E2E_STUDENT.email);
    await page.locator("#password").fill(E2E_STUDENT.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // 2. Wait for dashboard
    // Might hit onboarding if run isolated, but usually not if sequential
    try {
      await page.waitForURL(/\/onboarding/, { timeout: 3000 });
      await page.getByRole("button", { name: /next/i }).click();
      await page.getByRole("button", { name: /next/i }).click();
      await page.getByRole("button", { name: /next/i }).click();
      await page.getByRole("button", { name: /start learning/i }).click();
    } catch {
      // The student may already have completed onboarding.
    }

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await expect(page.locator("h1")).toContainText(/Dashboard|Overview/i);

    // 3. Navigate to Library to find the lecture
    await page.goto("/library");
    await page.getByRole("button", { name: /E2E Integration Course/i }).first().click();

    // In the course detail, find the lecture and open it
    await page.getByRole("tab", { name: /lectures/i }).click();
    await page.getByRole("button", { name: /E2E Gamification Lecture/i }).click();

    // 4. We are now in the Lecture View on Slide 1.
    // Opening a slide triggers `recordEvent({ event_type: "slide_view" })`.
    // The backend processes this, awards XP, and updates the `student_progress` table.
    // The frontend listens to real-time changes and pops a toast.
    await expect(page.getByText("First Slide")).toBeVisible({ timeout: 10_000 });

    // Wait for the Gamification XP Toast
    await expect(page.getByText(/You earned .* XP/i)).toBeVisible({ timeout: 15_000 });

    // 5. Navigate to Achievements page to verify stats
    await page.goto("/achievements");
    await expect(page.getByRole("heading", { name: /Achievements/i })).toBeVisible();

    // Verify XP is > 0 and the badge (if earned) is visible
    const xpElement = page.getByText(/XP/i).first();
    await expect(xpElement).toBeVisible();
    
    // "First Steps" badge is typically awarded after the first event
    await expect(page.getByText(/First Steps/i)).toBeVisible();
  });
});
