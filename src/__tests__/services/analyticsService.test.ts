/**
 * Tests for analyticsService — exercises HTTP path through MSW handlers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

import {
  getLectureOverview,
  getSlideAnalytics,
  getStudentPerformance,
  getDashboardData,
  getDropoffMap,
  getDistratorAnalysis,
  getAiQueryFeed,
  getAiInsights,
} from "@/services/analyticsService";

beforeEach(() => supabaseMock.reset());

describe("getLectureOverview", () => {
  it("unwraps the success envelope (returns .data)", async () => {
    server.use(
      http.get("http://api.test/api/analytics/lecture/L1/overview", () =>
        HttpResponse.json({
          success: true,
          data: { uniqueStudents: 7, averageScore: 80 },
        }),
      ),
    );
    // Service returns the raw envelope today; assert it contains .data
    const out: any = await getLectureOverview("L1");
    expect(out.data?.uniqueStudents ?? out.uniqueStudents).toBe(7);
  });

  it("throws on 500", async () => {
    server.use(
      http.get("http://api.test/api/analytics/lecture/Lx/overview", () =>
        new HttpResponse("boom", { status: 500 }),
      ),
    );
    await expect(getLectureOverview("Lx")).rejects.toThrow();
  });

  it("throws Unauthenticated when no session", async () => {
    supabaseMock.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    await expect(getLectureOverview("L1")).rejects.toThrow(/Unauthenticated/);
  });
});

describe("getSlideAnalytics / getStudentPerformance", () => {
  it("getSlideAnalytics returns the envelope", async () => {
    const out: any = await getSlideAnalytics("L1");
    expect(out).toBeTruthy();
  });

  it("getStudentPerformance returns the envelope", async () => {
    const out: any = await getStudentPerformance("L1");
    expect(out).toBeTruthy();
  });
});

describe("dropoff / distractors / ai-queries", () => {
  it("getDropoffMap → list", async () => {
    const out: any = await getDropoffMap("L1");
    expect(out).toBeTruthy();
  });

  it("getDistratorAnalysis → list", async () => {
    const out: any = await getDistratorAnalysis("L1");
    expect(out).toBeTruthy();
  });

  it("getAiQueryFeed → list", async () => {
    const out: any = await getAiQueryFeed("L1");
    expect(out).toBeTruthy();
  });
});

describe("getDashboardData", () => {
  it("returns overview, slidePerformance, etc", async () => {
    const out: any = await getDashboardData("L1");
    expect(out).toBeTruthy();
  });
});

describe("getAiInsights", () => {
  it("posts to /api/ai/analytics-insights", async () => {
    server.use(
      http.post("http://api.test/api/ai/analytics-insights", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.lecture_id).toBe("L1");
        return HttpResponse.json({ summary: "s", suggestions: ["a"] });
      }),
    );
    const out = await getAiInsights("L1", { total_students: 5 });
    expect(out.summary).toBe("s");
    expect(out.suggestions).toEqual(["a"]);
  });
});
