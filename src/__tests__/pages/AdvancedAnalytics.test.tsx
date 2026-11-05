/**
 * R2: fetchAiInsights() used to swallow a failed
 * POST /api/ai/analytics-insights into fabricated, hardcoded "AI Summary"
 * content — indistinguishable from a genuine AI response. These tests
 * assert the honest error state instead: a distinct error card (not the
 * fabricated summary/suggestions), with a working retry.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(() => ({
    user: { id: "prof-1", email: "prof@test.com" },
    session: null,
    profile: null,
    role: "professor",
    loading: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  })),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

vi.mock("@/hooks/use-ai-model", () => ({
  useAiModel: () => ({ aiModel: "gemini" }),
}));

const fetchProfessorLecturesMock = vi.fn();
vi.mock("@/services/lectureService", async () => {
  const actual = await vi.importActual<typeof import("@/services/lectureService")>(
    "@/services/lectureService",
  );
  return {
    ...actual,
    fetchProfessorLectures: (...args: unknown[]) => fetchProfessorLecturesMock(...args),
  };
});

const getSlideAnalyticsMock = vi.fn();
vi.mock("@/services/analyticsService", async () => {
  const actual = await vi.importActual<typeof import("@/services/analyticsService")>(
    "@/services/analyticsService",
  );
  return {
    ...actual,
    getSlideAnalytics: (...args: unknown[]) => getSlideAnalyticsMock(...args),
  };
});

const useAnalyticsMock = vi.fn();
vi.mock("@/features/analytics/hooks/useAnalytics", () => ({
  useAnalytics: (lectureId: string | null) => useAnalyticsMock(lectureId),
}));

const apiClientPostMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  apiClient: {
    get: vi.fn(),
    post: (...args: unknown[]) => apiClientPostMock(...args),
  },
}));

vi.mock("@/components/NeuralBackground", () => ({
  NeuralBackground: () => null,
}));
vi.mock("@/components/ThreeDScatterPlot", () => ({
  ThreeDScatterPlot: () => null,
}));
vi.mock("@/features/analytics/components/AskYourDataPanel", () => ({
  AskYourDataPanel: () => null,
}));
vi.mock("@/features/analytics/components/BenchmarksSection", () => ({
  BenchmarksSection: () => null,
}));

import AdvancedAnalytics from "@/pages/AdvancedAnalytics";
import { renderWithProviders } from "@/test/renderWithProviders";

const LECTURE_ID = "11111111-1111-1111-1111-111111111111";

// The dashboard's floored shape: counts of people, null where fewer than five stand behind a figure.
const mockDashboardData = {
  overview: { uniqueStudents: 5, totalAttempts: 5, averageScore: 75, totalEvents: 6 },
  activityByDay: [
    { date: "Mon", people: null },
    { date: "Tue", people: 5 },
  ],
  slidePerformance: [],
  scoreBands: [],
  funnel: [],
  confidenceMap: null,
  liveTicker: [{ type: "quiz_attempt", people: 5 }],
  dropoffData: [],
  aiQueryFeed: [],
  confidenceBySlide: [],
  retryPerformance: [],
};

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/professor/analytics/:lectureId" element={<AdvancedAnalytics />} />
    </Routes>,
    { initialEntries: [`/professor/analytics/${LECTURE_ID}`] },
  );
}

beforeEach(() => {
  supabaseMock.reset();
  fetchProfessorLecturesMock.mockReset();
  fetchProfessorLecturesMock.mockResolvedValue([]);
  getSlideAnalyticsMock.mockReset();
  getSlideAnalyticsMock.mockResolvedValue([]);
  useAnalyticsMock.mockReset();
  useAnalyticsMock.mockReturnValue({
    dashboard: { data: mockDashboardData, isLoading: false, isError: false },
  });
  apiClientPostMock.mockReset();
});

describe("AdvancedAnalytics — AI insights failure (R2)", () => {
  it("shows an honest error card instead of fabricated insights when the request fails", async () => {
    const user = userEvent.setup();
    apiClientPostMock.mockRejectedValueOnce(new Error("500 Internal Server Error"));
    renderPage();

    const generateButton = await screen.findByRole("button", { name: /generate course insights/i });
    await user.click(generateButton);

    expect(await screen.findByTestId("ai-insights-error")).toBeInTheDocument();
    expect(screen.getByText(/couldn't load ai insights/i)).toBeInTheDocument();

    // None of the previously-fabricated copy should ever render.
    expect(screen.queryByText(/ai insights unavailable right now/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/engagement is lower on a few key slides/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/a leaderboard could help boost activity here/i)).not.toBeInTheDocument();
  });

  it("retries and renders the real AI summary once the retry succeeds", async () => {
    const user = userEvent.setup();
    apiClientPostMock.mockRejectedValueOnce(new Error("500 Internal Server Error"));
    apiClientPostMock.mockResolvedValueOnce({
      summary: "Genuine AI-derived summary.",
      suggestions: ["Real suggestion one.", "Real suggestion two."],
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: /generate course insights/i }));
    const retryButton = await screen.findByTestId("ai-insights-retry");
    await user.click(retryButton);

    await waitFor(() => {
      expect(screen.queryByTestId("ai-insights-error")).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/genuine ai-derived summary/i)).toBeInTheDocument();
  });

  it("renders the real AI summary on the first successful call", async () => {
    const user = userEvent.setup();
    apiClientPostMock.mockResolvedValueOnce({
      summary: "Everything looks great this week.",
      suggestions: ["Keep it up."],
    });
    renderPage();

    await user.click(await screen.findByRole("button", { name: /generate course insights/i }));

    expect(await screen.findByText(/everything looks great this week/i)).toBeInTheDocument();
    expect(screen.queryByTestId("ai-insights-error")).not.toBeInTheDocument();
  });
});

describe("AdvancedAnalytics — slides too few people stand behind", () => {
  it("shows a dash, never 0, for every figure the backend left null", async () => {
    const user = userEvent.setup();
    getSlideAnalyticsMock.mockResolvedValue([
      {
        slide_id: "s1",
        slide_number: 7,
        title: "Quiet slide",
        view_count: null,
        average_time_seconds: null,
        drop_off_rate: null,
        confusion_rate: null,
        quiz_attempts: null,
        quiz_success_rate: null,
        recommendation_label: "insufficient_data",
        recommendation_reasons: ["low_view_count"],
      },
    ]);
    renderPage();

    await user.click(await screen.findByRole("button", { name: /show all 1 slides/i }));

    const row = (await screen.findByText("Quiet slide")).closest("tr") as HTMLElement;
    const cells = within(row).getAllByRole("cell");
    // # | Slide | Views | Drop-off | Confusion | Quiz
    expect(cells.slice(2, 6).map((c) => c.textContent)).toEqual(["—", "—", "—", "—"]);
    expect(row.textContent).not.toMatch(/0%/);
  });
});

describe("AdvancedAnalytics — a withheld confidence map is not asked about", () => {
  const metricFeedbackCalls = () =>
    apiClientPostMock.mock.calls.filter(([url]) => url === "/api/ai/metric-feedback");

  function showDashboard(confidenceMap: unknown) {
    useAnalyticsMock.mockReturnValue({
      dashboard: { data: { ...mockDashboardData, confidenceMap }, isLoading: false, isError: false },
    });
  }

  it("says it waits for five people and sends nothing to the interpretation model", async () => {
    const user = userEvent.setup();
    apiClientPostMock.mockResolvedValue({ feedback: "should never be asked" });
    showDashboard(null);
    renderPage();

    await user.click(await screen.findByText("Student Confidence"));

    expect(await screen.findByText(/shows once five people have rated a page/i)).toBeInTheDocument();
    expect(metricFeedbackCalls()).toHaveLength(0);
  });

  it("still asks for a map that has people behind it", async () => {
    const user = userEvent.setup();
    apiClientPostMock.mockResolvedValue({ feedback: "ok" });
    showDashboard({ got_it: 4, unsure: 1, confused: 0 });
    renderPage();

    await user.click(await screen.findByText("Student Confidence"));

    await waitFor(() => expect(metricFeedbackCalls()).toHaveLength(1));
    expect(metricFeedbackCalls()[0][1]).toMatchObject({ metric_value: { got_it: 4, unsure: 1, confused: 0 } });
  });
});

describe("AdvancedAnalytics — figures fewer than five people stand behind", () => {
  const metricFeedbackCalls = () =>
    apiClientPostMock.mock.calls.filter(([url]) => url === "/api/ai/metric-feedback");

  const withheldOverview = {
    uniqueStudents: null,
    totalAttempts: null,
    averageScore: null,
    totalEvents: null,
  };

  function showDashboard(patch: Record<string, unknown>) {
    useAnalyticsMock.mockReturnValue({
      dashboard: { data: { ...mockDashboardData, ...patch }, isLoading: false, isError: false },
    });
  }

  it("shows a dash on every overview card, never 0, and asks the model nothing when one is clicked", async () => {
    const user = userEvent.setup();
    apiClientPostMock.mockResolvedValue({ feedback: "should never be asked" });
    showDashboard({ overview: withheldOverview });
    renderPage();

    const card = (await screen.findByText("Engaged Students")).closest("div.glass-card") as HTMLElement;
    expect(card.textContent).toContain("—");
    expect(card.textContent).not.toMatch(/\b0\b/);
    await user.click(screen.getByText("Global Score Avg"));
    await user.click(screen.getByText("Students Who Answered"));
    await user.click(screen.getByText("Active Students"));

    expect(metricFeedbackCalls()).toHaveLength(0);
    expect(screen.getByRole("button", { name: /generate course insights/i })).toBeDisabled();
  });

  it("does not crash on a slide whose figures were all withheld", async () => {
    showDashboard({
      overview: withheldOverview,
      slidePerformance: [
        { id: "s1", name: "Quiet", avgDuration: null, correctRate: null, quizAttempts: null, aiQueries: null, revisions: null, confusionIndex: null },
      ],
    });
    renderPage();
    expect(await screen.findByText("Engaged Students")).toBeInTheDocument();
  });

  it("puts a dash where a retry-table side was withheld and never prints null", async () => {
    const user = userEvent.setup();
    apiClientPostMock.mockResolvedValue({ feedback: "ok" });
    showDashboard({
      retryPerformance: [
        {
          question_id: "q1",
          question_text: "Which join keeps unmatched rows?",
          first_attempt_total: 5,
          first_attempt_misses: 3,
          first_attempt_miss_rate: 60,
          retry_total: null,
          retry_misses: null,
          retry_miss_rate: null,
        },
      ],
    });
    renderPage();

    await user.click(await screen.findByText("Most-Missed Questions"));

    const row = (await screen.findByText("Which join keeps unmatched rows?")).closest("tr") as HTMLElement;
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
    expect(cells.slice(1)).toEqual(["60%", "3 / 5", "—", "—"]);
    expect(row.textContent).not.toMatch(/null/);
  });

  it("tells the week in counts of students and never one person's event", async () => {
    showDashboard({ liveTicker: [{ type: "quiz_attempt", people: 7 }] });
    renderPage();

    expect(await screen.findByText(/7 students answered a quiz question this week/i)).toBeInTheDocument();
    expect(screen.queryByText(/listening for semantic events/i)).not.toBeInTheDocument();
  });

  it("says nothing about the week until five students have done something", async () => {
    showDashboard({ liveTicker: [] });
    renderPage();
    expect(await screen.findByText(/shows once five students have done something this week/i)).toBeInTheDocument();
  });
});


describe("AdvancedAnalytics — nothing withheld ever reaches the model", () => {
  const callsTo = (url: string) => apiClientPostMock.mock.calls.filter(([u]) => u === url);

  function showDashboard(patch: Record<string, unknown>) {
    useAnalyticsMock.mockReturnValue({
      dashboard: { data: { ...mockDashboardData, ...patch }, isLoading: false, isError: false },
    });
  }

  // Five people opened the lecture, fewer than five answered anything.
  const openedNotAnswered = { uniqueStudents: 5, totalAttempts: null, averageScore: null, totalEvents: 5 };

  it("waits to offer course insights until five people have answered, so no request is ever sent", async () => {
    const user = userEvent.setup();
    showDashboard({ overview: openedNotAnswered });
    renderPage();

    const button = await screen.findByRole("button", { name: /generate course insights/i });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(callsTo("/api/ai/analytics-insights")).toHaveLength(0);
  });

  it("posts course insights without a single null or the raw correct count", async () => {
    const user = userEvent.setup();
    apiClientPostMock.mockResolvedValue({ summary: "s", suggestions: [] });
    showDashboard({});
    renderPage();

    await user.click(await screen.findByRole("button", { name: /generate course insights/i }));

    await waitFor(() => expect(callsTo("/api/ai/analytics-insights")).toHaveLength(1));
    const body = callsTo("/api/ai/analytics-insights")[0][1] as Record<string, unknown>;
    expect(Object.values(body).some((v) => v === null || v === undefined)).toBe(false);
    expect(body).not.toHaveProperty("total_correct");
    expect(body).not.toHaveProperty("total_attempts");
    expect(body).toMatchObject({ total_students: 5, average_score: 75, people_answered: 5 });
  });

  it("leaves a withheld figure out of the context sent with a stat card", async () => {
    const user = userEvent.setup();
    apiClientPostMock.mockResolvedValue({ feedback: "ok" });
    showDashboard({ overview: openedNotAnswered });
    renderPage();

    await user.click(await screen.findByText("Engaged Students"));

    await waitFor(() => expect(callsTo("/api/ai/metric-feedback")).toHaveLength(1));
    const { context_stats: context } = callsTo("/api/ai/metric-feedback")[0][1] as { context_stats: Record<string, unknown> };
    expect(context).toEqual({ total_students: 5 });
  });

  const allWithheldRetry = [
    { question_id: "q1", question_text: "Q", first_attempt_total: null, first_attempt_misses: null, first_attempt_miss_rate: null, retry_total: null, retry_misses: null, retry_miss_rate: null },
  ];

  it("does not ask about a week whose every day was withheld", async () => {
    const user = userEvent.setup();
    apiClientPostMock.mockResolvedValue({ feedback: "should never be asked" });
    showDashboard({ activityByDay: [{ date: "Mon", people: null }, { date: "Tue", people: null }] });
    renderPage();

    await user.click(await screen.findByText("Interaction Velocity"));
    expect(callsTo("/api/ai/metric-feedback")).toHaveLength(0);
  });

  it("does not ask about a retry table whose every row was withheld", async () => {
    const user = userEvent.setup();
    apiClientPostMock.mockResolvedValue({ feedback: "should never be asked" });
    showDashboard({ retryPerformance: allWithheldRetry });
    renderPage();

    await user.click(await screen.findByText("Most-Missed Questions"));
    expect(callsTo("/api/ai/metric-feedback")).toHaveLength(0);
  });

  it("sends only the figures that exist when some rows were withheld and some were not", async () => {
    const user = userEvent.setup();
    apiClientPostMock.mockResolvedValue({ feedback: "ok" });
    showDashboard({
      retryPerformance: [
        ...allWithheldRetry,
        { question_id: "q2", question_text: "Q2", first_attempt_total: 5, first_attempt_misses: 2, first_attempt_miss_rate: 40, retry_total: null, retry_misses: null, retry_miss_rate: null },
      ],
    });
    renderPage();

    await user.click(await screen.findByText("Most-Missed Questions"));

    await waitFor(() => expect(callsTo("/api/ai/metric-feedback")).toHaveLength(1));
    const { metric_value: rows } = callsTo("/api/ai/metric-feedback")[0][1] as { metric_value: Record<string, unknown>[] };
    expect(JSON.stringify(rows)).not.toContain("null");
    expect(rows[1]).toEqual({ question_id: "q2", question_text: "Q2", first_attempt_total: 5, first_attempt_misses: 2, first_attempt_miss_rate: 40 });
  });

  it("draws the week as people per day and says nothing when every day is under five", async () => {
    showDashboard({ activityByDay: [{ date: "Mon", people: null }, { date: "Tue", people: null }] });
    renderPage();
    expect(await screen.findByText(/shows once five people have taken the quiz on a day this week/i)).toBeInTheDocument();
  });
});
