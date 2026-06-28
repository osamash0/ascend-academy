/**
 * Smoke test for the professor course-wide overview service helper.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

import { getProfessorOverview } from "@/services/analyticsService";

beforeEach(() => supabaseMock.reset());

describe("getProfessorOverview", () => {
  it("unwraps the envelope and returns the overview payload", async () => {
    server.use(
      http.get("http://api.test/api/v1/analytics/professor/overview", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("course_id")).toBe("C1");
        expect(url.searchParams.get("days")).toBe("7");
        return HttpResponse.json({
          success: true,
          data: {
            active_students: 4,
            average_completion: 62.5,
            average_quiz_accuracy: 71.0,
            median_time_minutes: 12.0,
            weakest_concepts: [{ concept: "Recursion", miss_rate: 80, attempts: 10 }],
            weakest_slides: [],
            activity_sparkline: Array.from({ length: 7 }, (_, i) => ({
              date: `2026-05-0${i + 1}`,
              count: i,
            })),
            lecture_count: 3,
            days: 7,
          },
        });
      }),
    );

    const out = await getProfessorOverview("C1", 7);
    expect(out.active_students).toBe(4);
    expect(out.weakest_concepts).toHaveLength(1);
    expect(out.activity_sparkline).toHaveLength(7);
    expect(out.lecture_count).toBe(3);
  });
});
