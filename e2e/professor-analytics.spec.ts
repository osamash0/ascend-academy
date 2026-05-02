import { test, expect } from "@playwright/test";
import { mockSupabase, loginAs, PROFESSOR } from "./helpers/supabase-mocks";

/**
 * Professor analytics journey: log in → /professor/analytics/:id → assert
 * that the four primary panels render after the dashboard endpoint resolves.
 *
 * The skeleton called for "Overview / Drop-off / Distractors / AI Queries".
 * The actual page exposes those domains under these section headings:
 *   • "Where Students Quit"   (drop-off bar chart)
 *   • "Confidence By Slide"   (slide-level confidence breakdown)
 *   • "Score Distribution"    (learner-population bands ≈ distractor signal)
 *   • "Student Questions Feed" (AI-tutor query feed)
 * Plus the lecture title rendered as the page <h1>.
 */
test.describe("Professor analytics", () => {
  test("open lecture analytics → all 4 panels render", async ({ page }) => {
    const lectureId = "test-lecture-id";
    const lecture = {
      id: lectureId,
      title: "Astrocartography Module",
      description: "Mapping student trajectories.",
      total_slides: 3,
      created_at: new Date().toISOString(),
    };

    await mockSupabase(page, {
      user: PROFESSOR,
      tables: { lectures: [lecture] },
      singletons: { lectures: lecture },
    });

    // FastAPI dashboard payload — shape mirrors backend.api.analytics.dashboard.
    const dashboard = {
      data: {
        overview: {
          uniqueStudents: 12,
          averageScore: 73,
          totalEvents: 482,
          totalAttempts: 96,
        },
        slidePerformance: [
          {
            id: "s1",
            name: "Intro",
            avgDuration: 22,
            correctRate: 80,
            confusionIndex: 18,
            quizAttempts: 12,
            aiQueries: 4,
            revisions: 1,
          },
          {
            id: "s2",
            name: "Core",
            avgDuration: 41,
            correctRate: 55,
            confusionIndex: 62,
            quizAttempts: 11,
            aiQueries: 9,
            revisions: 5,
          },
        ],
        confidenceMap: { got_it: 30, unsure: 8, confused: 4 },
        dropoffData: [
          { title: "Intro", dropout_count: 1, dropout_percentage: 8 },
          { title: "Core", dropout_count: 4, dropout_percentage: 33 },
        ],
        confidenceBySlide: [
          { title: "Intro", got_it: 9, unsure: 2, confused: 1 },
          { title: "Core", got_it: 5, unsure: 4, confused: 3 },
        ],
        activityByDay: [
          { date: "Mon", attempts: 12 },
          { date: "Tue", attempts: 18 },
        ],
        studentsMatrix: [
          {
            student_id: "u1",
            student_name: "Astra",
            typology: "Natural Learner",
            ai_interactions: 2,
            revisions: 1,
            quiz_score: 88,
          },
          {
            student_id: "u2",
            student_name: "Nova",
            typology: "At Risk",
            ai_interactions: 7,
            revisions: 5,
            quiz_score: 35,
          },
        ],
        // Field shapes here match ProfessorAnalytics.tsx contract exactly:
        //   liveTicker  → { type, description, time }
        //   aiQueryFeed → { id, query_text, created_at, ... }
        liveTicker: [
          {
            type: "completion",
            description: "Astra completed slide 1",
            time: new Date().toISOString(),
          },
        ],
        aiQueryFeed: [
          {
            id: "aq1",
            query_text: "What does orbital decay mean?",
            created_at: new Date().toISOString(),
            student_name: "Nova",
            slide_title: "Core",
          },
        ],
      },
    };

    await page.route(
      /\/api\/analytics\/lecture\/[^/]+\/dashboard/,
      (route) => {
        if (route.request().method() === "OPTIONS") {
          return route.fulfill({
            status: 204,
            headers: {
              "access-control-allow-origin": "*",
              "access-control-allow-methods": "GET,OPTIONS",
              "access-control-allow-headers": "*",
            },
          });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify(dashboard),
        });
      },
    );

    // ─── Log in, then jump straight to the per-lecture analytics view ──────
    await loginAs(page, PROFESSOR, /\/professor\/dashboard/);
    await page.goto(`/professor/analytics/${lectureId}`);

    // Page header (lecture title rendered as <h1>).
    await expect(
      page.getByRole("heading", { level: 1, name: lecture.title }),
    ).toBeVisible({ timeout: 15_000 });

    // Four primary analytics panels.
    await expect(
      page.getByRole("heading", { name: /where students quit/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /confidence by slide/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /score distribution/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /student questions feed/i }),
    ).toBeVisible();
  });
});
