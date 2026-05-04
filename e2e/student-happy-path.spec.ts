import { test, expect } from "@playwright/test";
import { mockSupabase, STUDENT } from "./helpers/supabase-mocks";

/**
 * Student journey: signup → dashboard → open a lecture → answer the only
 * quiz question correctly → assert the completion toast.
 *
 * Every Supabase REST/auth call is mocked via `page.route()` so the suite
 * stays hermetic. We seed exactly one lecture, one slide, and one question
 * so the quiz flow finishes in a single click and we can assert the final
 * "Lecture Complete" toast emitted by `handleLectureComplete`.
 */
test.describe("Student happy path", () => {
  test("signup → dashboard → lecture → quiz → completion toast", async ({
    page,
  }) => {
    const lecture = {
      id: "lec-1",
      title: "Cosmic Onboarding 101",
      description: "A brief tour of the orbital academy.",
      total_slides: 1,
      pdf_url: null,
      professor_id: "professor-stub",
      created_at: new Date().toISOString(),
    };
    const slide = {
      id: "slide-1",
      slide_number: 1,
      title: "Welcome aboard",
      content_text: "First slide content.",
      summary: "Intro slide.",
      lecture_id: lecture.id,
    };
    const question = {
      id: "q-1",
      slide_id: slide.id,
      question_text: "Is this the welcome slide?",
      options: ["Yes", "Definitely not"],
      correct_answer: 0,
    };

    await mockSupabase(page, {
      user: STUDENT,
      tables: {
        lectures: [lecture],
        slides: [slide],
        quiz_questions: [
          {
            id: question.id,
            slide_id: question.slide_id,
            question_text: question.question_text,
            options: question.options,
            correct_answer: question.correct_answer,
            slides: { lecture_id: lecture.id },
          },
        ],
        student_progress: [],
        achievements: [],
        notifications: [],
        learning_events: [],
      },
      singletons: { lectures: lecture },
    });

    // 1. Visit /auth and switch to signup mode.
    await page.goto("/auth");
    await expect(page).toHaveURL(/\/auth/);
    await page.getByText(/join the mission/i).click();

    // 2. Fill the signup form (Student is the default role) and consent.
    await page.locator("#email").fill(STUDENT.email);
    await page.locator("#password").fill("Sup3rSecret!");
    await page.locator('input[type="checkbox"]').check();
    await page
      .getByRole("button", { name: /authorize enlistment/i })
      .click();

    // 3. Mocked signup → SIGNED_IN → DashboardRouter sends students to /dashboard.
    await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: /your courses/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: lecture.title }),
    ).toBeVisible();

    // 4. Click the lecture card (role="article", aria-label includes the title).
    await page.getByRole("article", { name: new RegExp(lecture.title, "i") }).click();
    await page.waitForURL(/\/lecture\//);

    // 5. Slide loads → click the slide-advance button to surface the quiz.
    //    With a single slide, isLast=true so the button label is "Finish Course".
    await expect(
      page.getByRole("heading", { name: slide.title }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /finish course|continue/i })
      .click();

    // 6. Quiz card appears — answer correctly.
    const correctOption = page.getByRole("button", {
      name: new RegExp(`option a:.*${question.options[0]}`, "i"),
    });
    await expect(correctOption).toBeVisible();
    await correctOption.click();

    // 7. handleLectureComplete fires the success toast (~1.5s settle).
    await expect(
      page.getByText(/lecture complete/i).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/you earned .* xp/i).first(),
    ).toBeVisible();
  });
});
