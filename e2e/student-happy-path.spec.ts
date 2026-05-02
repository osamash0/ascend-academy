import { test, expect } from "@playwright/test";

test.describe("Student happy path", () => {
  test.fixme("signup → dashboard → lecture → quiz → XP / badge", async ({ page }) => {
    // 1. Mock supabase auth.signUp + auth.getSession to return a synthetic student.
    //    await page.route("**/auth/v1/signup**", route => route.fulfill({...}));
    //    await page.route("**/auth/v1/token**", route => route.fulfill({...}));
    //
    // 2. Mock GET /rest/v1/profiles for the student-role lookup.
    //
    // 3. Visit /auth, fill the signup form, submit → expect redirect to /dashboard.
    await page.goto("/auth");
    await expect(page).toHaveURL(/\/auth/);
    //
    // 4. Click first lecture card → expect /lecture/:id; mock /api/lectures, /api/slides.
    //
    // 5. Click through to quiz, submit → expect XP toast + badge animation.
  });
});
