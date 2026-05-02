import { test, expect } from "@playwright/test";
import path from "node:path";
import { mockSupabase, loginAs, PROFESSOR } from "./helpers/supabase-mocks";

/**
 * Professor PDF upload journey: log in → /professor/upload → attach PDF →
 * SSE stream drives the progress overlay to 100 % → click Publish → assert
 * success toast + redirect to /professor/dashboard.
 *
 * The FastAPI endpoint `/api/upload/parse-pdf-stream` is mocked with a
 * deterministic SSE payload (info → progress → slide → progress → complete)
 * so the upload hook drains it synchronously in one fulfilled response.
 */
test.describe("Professor PDF upload", () => {
  test("login → upload PDF → SSE progress → publish", async ({ page }) => {
    await mockSupabase(page, {
      user: PROFESSOR,
      tables: {
        // Empty professor dashboard — we only land on it after publishing.
        lectures: [],
      },
    });

    // ─── Mock the SSE parse endpoint with a deterministic stream ────────────
    const sseBody = [
      `data: ${JSON.stringify({ type: "info", parser: "opendataloader-pdf" })}`,
      "",
      `data: ${JSON.stringify({
        type: "progress",
        current: 1,
        total: 2,
        message: "Extracting page 1",
      })}`,
      "",
      `data: ${JSON.stringify({
        type: "slide",
        index: 0,
        slide: {
          title: "Mission Brief",
          content: "Brief slide content from the parser.",
          summary: "Mission brief summary.",
          questions: [
            {
              question: "Are we ready for launch?",
              options: ["Yes", "No", "Maybe", "Later"],
              correctAnswer: 0,
            },
          ],
        },
      })}`,
      "",
      `data: ${JSON.stringify({
        type: "progress",
        current: 2,
        total: 2,
        message: "Finalizing",
      })}`,
      "",
      `data: ${JSON.stringify({ type: "complete" })}`,
      "",
      "",
    ].join("\n");

    await page.route("**/api/upload/parse-pdf-stream", (route) => {
      if (route.request().method() === "OPTIONS") {
        return route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST,OPTIONS",
            "access-control-allow-headers": "*",
          },
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "access-control-allow-origin": "*" },
        body: sseBody,
      });
    });

    // ─── Storage upload mock (PDF bytes go to lecture-pdfs bucket) ──────────
    await page.route(/\/storage\/v1\/object\/lecture-pdfs\//, (route) => {
      const m = route.request().method();
      if (m === "OPTIONS") {
        return route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST,PUT,OPTIONS",
            "access-control-allow-headers": "*",
          },
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ Key: "lecture-pdfs/lectures/test/sample.pdf" }),
      });
    });

    // ─── Log in as professor, then navigate to the upload page ──────────────
    await loginAs(page, PROFESSOR, /\/professor\/dashboard/);
    await page.goto("/professor/upload");
    await expect(
      page.getByRole("heading", { name: /create lecture/i }),
    ).toBeVisible();

    // Set the title BEFORE uploading (handleSubmit requires non-empty title).
    await page.locator("#title").fill("Mission Briefing Lecture");

    // Attach the PDF — the input is hidden, but Playwright can target it.
    const fixture = path.resolve(__dirname, "fixtures/sample.pdf");
    await page.locator('input[type="file"][accept=".pdf"]').setInputFiles(fixture);

    // ─── Wait for the SSE stream to drive the editor view ───────────────────
    // After `complete` the empty state is replaced by the slide editor and
    // the "Publish" button becomes visible.
    const publishButton = page.getByRole("button", { name: /^publish$/i });
    await expect(publishButton).toBeVisible({ timeout: 15_000 });
    await expect(publishButton).toBeEnabled();

    // ─── Publish: triggers storage upload + lectures/slides inserts ─────────
    await publishButton.click();

    // Success toast + redirect.
    await expect(page.getByText(/lecture created successfully/i)).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForURL(/\/professor\/dashboard/);
  });
});
