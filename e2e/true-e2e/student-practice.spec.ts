import { test, expect } from "@playwright/test";
import { E2E_STUDENT } from "./global.setup";

test.describe("Student True E2E: Practice Sheets", () => {
  test("login → onboard → join course → complete practice sheet", async ({ page }) => {
    // 1. Log in via UI
    await page.goto("/auth");
    await page.locator("#email").fill(E2E_STUDENT.email);
    await page.locator("#password").fill(E2E_STUDENT.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // 2. Since this is a fresh account, they might hit /onboarding
    try {
      await page.waitForURL(/\/onboarding/, { timeout: 5000 });
      // If we hit onboarding, click Next through it
      await page.getByRole("button", { name: /next/i }).click();
      await page.getByRole("button", { name: /next/i }).click();
      await page.getByRole("button", { name: /next/i }).click();
      await page.getByRole("button", { name: /start learning/i }).click();
    } catch {
      // Ignored if they go straight to dashboard
    }

    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });

    // 3. Navigate to Course Library
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: /course library/i })).toBeVisible();

    // Join the E2E Course
    await page.getByPlaceholder(/join code/i).fill("E2E-TEST-CODE");
    await page.getByRole("button", { name: /join course/i }).click();

    // Wait for enrollment success toast
    await expect(page.getByText(/Successfully joined course/i)).toBeVisible({ timeout: 10_000 });

    // The course should now be visible on the library page or we can navigate to it
    await page.getByRole("button", { name: /E2E Integration Course/i }).first().click();

    // 4. We are on the Course Detail view. Navigate to Practice Sheets tab
    await page.getByRole("tab", { name: /practice/i }).click();
    
    // Open the practice sheet
    await page.getByRole("button", { name: /E2E Practice Sheet/i }).click();

    // 5. We are inside the practice sheet modal/view.
    // Question: What is 2+2? Options: 3, 4, 5
    // Option 4 is index 1 (correct)
    await expect(page.getByText("What is 2+2?")).toBeVisible();
    await page.getByText("4", { exact: true }).click();
    
    // Submit the sheet
    await page.getByRole("button", { name: /submit sheet/i }).click();

    // 6. Assert success and real grading from backend
    await expect(page.getByText(/Sheet graded/i)).toBeVisible({ timeout: 10_000 });
    // Real XP should be awarded for completion
    await expect(page.getByText(/You earned .* XP/i)).toBeVisible();
  });
});
