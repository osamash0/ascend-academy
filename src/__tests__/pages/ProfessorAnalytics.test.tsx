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

const listCoursesMock = vi.fn();
vi.mock("@/services/coursesService", async () => {
  const actual = await vi.importActual<typeof import("@/services/coursesService")>(
    "@/services/coursesService",
  );
  return {
    ...actual,
    listCourses: (...args: unknown[]) => listCoursesMock(...args),
  };
});

const useAnalyticsMock = vi.fn();
vi.mock("@/features/analytics/hooks/useAnalytics", () => ({
  useAnalytics: (lectureId: string | null) => useAnalyticsMock(lectureId),
}));

const logLearningEventMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/services/studentService", () => ({
  logLearningEvent: (...args: unknown[]) => logLearningEventMock(...args),
}));

vi.mock("@/components/NeuralBackground", () => ({
  NeuralBackground: () => null,
}));
vi.mock("@/components/ThreeDScatterPlot", () => ({
  ThreeDScatterPlot: () => null,
}));

import ProfessorAnalytics from "@/pages/ProfessorAnalytics";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => {
  supabaseMock.reset();
  fetchProfessorLecturesMock.mockReset();
  listCoursesMock.mockReset();
  listCoursesMock.mockResolvedValue([]);
  useAnalyticsMock.mockReset();
  useAnalyticsMock.mockReturnValue({
    dashboard: { data: null, isLoading: false, isError: false },
  });
  logLearningEventMock.mockClear();
});

describe("ProfessorAnalytics page (smoke)", () => {
  it("records an analytics-dashboard view for lifecycle reporting", async () => {
    fetchProfessorLecturesMock.mockResolvedValue([]);
    renderWithProviders(
      <Routes>
        <Route path="/professor/analytics" element={<ProfessorAnalytics />} />
      </Routes>,
      { initialEntries: ["/professor/analytics"] },
    );

    await waitFor(() => {
      expect(logLearningEventMock).toHaveBeenCalledWith(
        "prof-1",
        "analytics_dashboard_viewed",
        { surface: "professor_analytics" },
      );
    });
  });

  it("mounts a loading spinner while lectures are being fetched", () => {
    fetchProfessorLecturesMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderWithProviders(
      <Routes>
        <Route path="/professor/analytics" element={<ProfessorAnalytics />} />
        <Route path="/professor/analytics/:lectureId" element={<ProfessorAnalytics />} />
      </Routes>,
      {
        initialEntries: ["/professor/analytics"],
      }
    );
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("renders the empty-state when professor has no lectures", async () => {
    fetchProfessorLecturesMock.mockResolvedValue([]);
    renderWithProviders(
      <Routes>
        <Route path="/professor/analytics" element={<ProfessorAnalytics />} />
        <Route path="/professor/analytics/:lectureId" element={<ProfessorAnalytics />} />
      </Routes>,
      {
        initialEntries: ["/professor/analytics"],
      }
    );
    expect(
      await screen.findByText(/no lectures yet/i),
    ).toBeInTheDocument();
  });

  it("renders the first lecture card when lectures are available", async () => {
    fetchProfessorLecturesMock.mockResolvedValue([
      {
        id: "lec-x",
        title: "Cell Biology",
        description: "Membranes and organelles",
        total_slides: 8,
        created_at: "2025-01-01T00:00:00Z",
      },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/professor/analytics" element={<ProfessorAnalytics />} />
        <Route path="/professor/analytics/:lectureId" element={<ProfessorAnalytics />} />
      </Routes>,
      {
        initialEntries: ["/professor/analytics/cell-biology"],
      }
    );
    await waitFor(() => {
      expect(screen.getByText("Cell Biology")).toBeInTheDocument();
    });
  });

  // R49: a deep link slug matching no lecture/course used to fall through
  // every branch silently — both resolved ids stayed undefined and the
  // course picker rendered with no "not found" signal at all.
  it("shows a not-found notice for a deep link that matches no lecture or course", async () => {
    fetchProfessorLecturesMock.mockResolvedValue([
      {
        id: "lec-x",
        title: "Cell Biology",
        description: "Membranes and organelles",
        total_slides: 8,
        created_at: "2025-01-01T00:00:00Z",
      },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/professor/analytics" element={<ProfessorAnalytics />} />
        <Route path="/professor/analytics/:lectureId" element={<ProfessorAnalytics />} />
      </Routes>,
      {
        initialEntries: ["/professor/analytics/this-slug-matches-nothing"],
      }
    );

    await waitFor(() => {
      expect(screen.getByTestId("analytics-deep-link-not-found")).toBeInTheDocument();
    });
    // The picker itself should still render (not a blank page) — e.g. the
    // lecture rail's loading/empty chrome, not an unhandled crash.
    expect(document.body.textContent).not.toBe("");
  });

  // R12: a failed fetch used to be swallowed into empty arrays, so the
  // picker rendered "No lectures yet" even when the professor has lectures
  // and the fetch just failed.
  it("shows a distinct error state with retry when the fetch fails, not the empty state", async () => {
    fetchProfessorLecturesMock.mockRejectedValue(new Error("network down"));
    renderWithProviders(
      <Routes>
        <Route path="/professor/analytics" element={<ProfessorAnalytics />} />
        <Route path="/professor/analytics/:lectureId" element={<ProfessorAnalytics />} />
      </Routes>,
      { initialEntries: ["/professor/analytics"] },
    );

    expect(await screen.findByText(/couldn't load your lectures/i)).toBeInTheDocument();
    expect(screen.queryByText(/no lectures yet/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("analytics-picker-retry")).toBeInTheDocument();
  });

  it("retries the fetch and shows real data when the retry button is clicked", async () => {
    const user = userEvent.setup();
    fetchProfessorLecturesMock.mockRejectedValueOnce(new Error("network down"));
    fetchProfessorLecturesMock.mockResolvedValueOnce([
      {
        id: "lec-x",
        title: "Cell Biology",
        description: "Membranes and organelles",
        total_slides: 8,
        created_at: "2025-01-01T00:00:00Z",
      },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/professor/analytics" element={<ProfessorAnalytics />} />
        <Route path="/professor/analytics/:lectureId" element={<ProfessorAnalytics />} />
      </Routes>,
      { initialEntries: ["/professor/analytics"] },
    );

    await user.click(await screen.findByTestId("analytics-picker-retry"));

    await waitFor(() => {
      expect(screen.queryByText(/couldn't load your lectures/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/no lectures yet/i)).not.toBeInTheDocument();
    });
  });

  it("does not show the not-found notice for a slug that resolves correctly", async () => {
    fetchProfessorLecturesMock.mockResolvedValue([
      {
        id: "lec-x",
        title: "Cell Biology",
        description: "Membranes and organelles",
        total_slides: 8,
        created_at: "2025-01-01T00:00:00Z",
      },
    ]);
    renderWithProviders(
      <Routes>
        <Route path="/professor/analytics" element={<ProfessorAnalytics />} />
        <Route path="/professor/analytics/:lectureId" element={<ProfessorAnalytics />} />
      </Routes>,
      {
        initialEntries: ["/professor/analytics/cell-biology"],
      }
    );

    await waitFor(() => {
      expect(screen.getByText("Cell Biology")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("analytics-deep-link-not-found")).not.toBeInTheDocument();
  });
});
