/**
 * R2: fetchAiInsights() used to swallow a failed
 * POST /api/ai/analytics-insights into fabricated, hardcoded "AI Summary"
 * content — indistinguishable from a genuine AI response. These tests
 * assert the honest error state instead: a distinct error card (not the
 * fabricated summary/suggestions), with a working retry.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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

const mockDashboardData = {
  overview: { uniqueStudents: 5, totalAttempts: 20, totalCorrect: 15, averageScore: 75, totalEvents: 30 },
  activityByDay: [],
  slidePerformance: [],
  studentsMatrix: [],
  funnel: [],
  confidenceMap: { got_it: 0, unsure: 0, confused: 0 },
  liveTicker: [],
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
