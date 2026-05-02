import { test, expect } from "@playwright/test";

test.describe("Professor PDF upload", () => {
  test.fixme("login → upload PDF → SSE progress → publish", async ({ page }) => {
    // 1. Mock supabase auth.signInWithPassword to return a synthetic professor session.
    // 2. Mock GET /rest/v1/profiles → role=professor.
    // 3. Visit /auth, log in → expect redirect to /professor/dashboard.
    await page.goto("/auth");
    await expect(page).toHaveURL(/\/auth/);
    //
    // 4. Navigate to /professor/upload, attach a small fixture PDF.
    // 5. Mock POST /api/upload/parse-pdf-stream to emit a deterministic SSE
    //    stream: info → progress(50) → slide(0) → progress(100) → complete.
    // 6. Assert the progress bar reaches 100 % and the "Publish" button is enabled.
    // 7. Click Publish → expect success toast + redirect to /professor/dashboard.
  });
});
