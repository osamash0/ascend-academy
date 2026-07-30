import { test, expect } from "@playwright/test";
import { E2E_STUDENT } from "./global.setup";

async function signInAsSeededStudent(page: import("@playwright/test").Page) {
  await page.goto("/auth");
  await page.locator("#email").fill(E2E_STUDENT.email);
  await page.locator("#password").fill(E2E_STUDENT.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

async function openSeededLecture(page: import("@playwright/test").Page) {
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "E2E Integration Course" })).toBeVisible();
  await page.getByRole("button", { name: "Browse Lectures" }).click();

  const lecture = page.getByRole("button", { name: /E2E Gamification Lecture/ });
  await lecture.click(); // Select the lecture in the rail.
  await lecture.click(); // Open the selected lecture inline.
  await page.getByRole("button", { name: "Open full page" }).click();
  await page.waitForURL(/\/lecture\//, { timeout: 15_000 });
}

test.describe("Student True E2E: Practice Sheets", () => {
  test("login → open an enrolled lecture → submit a published practice sheet", async ({ page }) => {
    await signInAsSeededStudent(page);
    await openSeededLecture(page);

    await page.getByRole("button", { name: "worksheets" }).click();
    await expect(page.getByText("E2E Practice Sheet")).toBeVisible();
    await page.getByRole("button", { name: /^Start/ }).click();

    await expect(page.getByText("What is 2+2?")).toBeVisible();
    await page.getByRole("button", { name: /4/ }).click();
    await page.getByRole("button", { name: /^Submit$/ }).click();

    await expect(page.getByText("Your score: 100%", { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
