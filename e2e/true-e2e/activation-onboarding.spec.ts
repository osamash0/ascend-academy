import { test, expect } from "@playwright/test";
import { E2E_ONBOARDING_STUDENT } from "./global.setup";

test.describe("Student True E2E: activation onboarding", () => {
  test("a new learner can select a goal and begin the material upload journey", async ({ page }) => {
    await page.goto("/auth");
    await page.locator("#email").fill(E2E_ONBOARDING_STUDENT.email);
    await page.locator("#password").fill(E2E_ONBOARDING_STUDENT.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL(/\/onboarding\/start/, { timeout: 15_000 });
    await page.getByRole("button", { name: "Build my course" }).click();
    await page.getByRole("button", { name: /Prepare for an exam/ }).click();
    await page.getByRole("button", { name: "Continue with this goal" }).click();

    await page.waitForURL(/\/onboarding\/upload/, { timeout: 20_000 });
    await expect(page.getByText("Your focus: exam preparation.")).toBeVisible();
  });
});
