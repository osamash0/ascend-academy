# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: true-e2e/gamification.spec.ts >> Student True E2E: Gamification XP & Badges >> login → view slide → earn XP → check achievements
- Location: e2e/true-e2e/gamification.spec.ts:5:3

# Error details

```
TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
============================================================
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - region "Notifications (F8)":
    - list
  - region "Notifications alt+T"
  - generic [ref=e3]:
    - button "Back to Home" [ref=e5] [cursor=pointer]:
      - img
      - generic [ref=e6]: Back to Home
    - group "Language" [ref=e8]:
      - img [ref=e9]
      - button "en" [pressed] [ref=e12] [cursor=pointer]
      - button "de" [ref=e13] [cursor=pointer]
    - generic [ref=e16]:
      - generic "Luna astronaut, moon phase full" [ref=e17] [cursor=pointer]:
        - img [ref=e18]
      - paragraph [ref=e57]: All set! Let's start, click Sign In.
    - generic [ref=e59]:
      - generic [ref=e60] [cursor=pointer]:
        - img [ref=e62]
        - generic [ref=e67]: Learnstation
      - generic [ref=e68]:
        - heading "Sign In" [level=2] [ref=e69]
        - paragraph [ref=e70]: Sign in to pick up where you left off.
      - generic [ref=e71]:
        - generic [ref=e72]:
          - text: Email Address
          - generic [ref=e73]:
            - img [ref=e74]
            - textbox "Email Address" [ref=e77]:
              - /placeholder: name@example.com
              - text: student.e2e@ascend-academy.test
        - generic [ref=e78]:
          - generic [ref=e79]:
            - generic [ref=e80]: Password
            - button "Forgot Password?" [ref=e81] [cursor=pointer]
          - generic [ref=e82]:
            - img [ref=e83]
            - textbox "Password" [ref=e86]:
              - /placeholder: ••••••••
              - text: Password123!
            - button "Show input text" [ref=e87] [cursor=pointer]:
              - img [ref=e88]
        - button "Sign In" [ref=e91] [cursor=pointer]:
          - text: Sign In
          - img
      - button "Don't have an account? Create one" [ref=e93] [cursor=pointer]
      - generic [ref=e94]:
        - img [ref=e96]
        - paragraph [ref=e98]: Your dashboard is ready.
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | import { E2E_STUDENT } from "./global.setup";
  3  | 
  4  | test.describe("Student True E2E: Gamification XP & Badges", () => {
  5  |   test("login → view slide → earn XP → check achievements", async ({ page }) => {
  6  |     // 1. Log in via UI
  7  |     await page.goto("/auth");
  8  |     await page.locator("#email").fill(E2E_STUDENT.email);
  9  |     await page.locator("#password").fill(E2E_STUDENT.password);
  10 |     await page.getByRole("button", { name: /sign in/i }).click();
  11 | 
  12 |     // 2. Wait for dashboard
  13 |     // Might hit onboarding if run isolated, but usually not if sequential
  14 |     try {
  15 |       await page.waitForURL(/\/onboarding/, { timeout: 3000 });
  16 |       await page.getByRole("button", { name: /next/i }).click();
  17 |       await page.getByRole("button", { name: /next/i }).click();
  18 |       await page.getByRole("button", { name: /next/i }).click();
  19 |       await page.getByRole("button", { name: /start learning/i }).click();
  20 |     } catch { }
  21 | 
> 22 |     await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
     |                ^ TimeoutError: page.waitForURL: Timeout 15000ms exceeded.
  23 |     await expect(page.locator("h1")).toContainText(/Dashboard|Overview/i);
  24 | 
  25 |     // 3. Navigate to Library to find the lecture
  26 |     await page.goto("/library");
  27 |     await page.getByRole("button", { name: /E2E Integration Course/i }).first().click();
  28 | 
  29 |     // In the course detail, find the lecture and open it
  30 |     await page.getByRole("tab", { name: /lectures/i }).click();
  31 |     await page.getByRole("button", { name: /E2E Gamification Lecture/i }).click();
  32 | 
  33 |     // 4. We are now in the Lecture View on Slide 1.
  34 |     // Opening a slide triggers `recordEvent({ event_type: "slide_view" })`.
  35 |     // The backend processes this, awards XP, and updates the `student_progress` table.
  36 |     // The frontend listens to real-time changes and pops a toast.
  37 |     await expect(page.getByText("First Slide")).toBeVisible({ timeout: 10_000 });
  38 | 
  39 |     // Wait for the Gamification XP Toast
  40 |     await expect(page.getByText(/You earned .* XP/i)).toBeVisible({ timeout: 15_000 });
  41 | 
  42 |     // 5. Navigate to Achievements page to verify stats
  43 |     await page.goto("/achievements");
  44 |     await expect(page.getByRole("heading", { name: /Achievements/i })).toBeVisible();
  45 | 
  46 |     // Verify XP is > 0 and the badge (if earned) is visible
  47 |     const xpElement = page.getByText(/XP/i).first();
  48 |     await expect(xpElement).toBeVisible();
  49 |     
  50 |     // "First Steps" badge is typically awarded after the first event
  51 |     await expect(page.getByText(/First Steps/i)).toBeVisible();
  52 |   });
  53 | });
  54 | 
```