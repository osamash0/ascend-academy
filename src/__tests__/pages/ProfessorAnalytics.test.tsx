import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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

const useAnalyticsMock = vi.fn();
vi.mock("@/features/analytics/hooks/useAnalytics", () => ({
  useAnalytics: (lectureId: string | null) => useAnalyticsMock(lectureId),
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
  useAnalyticsMock.mockReset();
  useAnalyticsMock.mockReturnValue({
    dashboard: { data: null, isLoading: false, isError: false },
  });
});

describe("ProfessorAnalytics page (smoke)", () => {
  it("mounts a loading spinner while lectures are being fetched", () => {
    fetchProfessorLecturesMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderWithProviders(<ProfessorAnalytics />, {
      initialEntries: ["/professor/analytics"],
    });
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders the empty-state when professor has no lectures", async () => {
    fetchProfessorLecturesMock.mockResolvedValue([]);
    renderWithProviders(<ProfessorAnalytics />, {
      initialEntries: ["/professor/analytics"],
    });
    expect(
      await screen.findByText(/no active missions found/i),
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
    renderWithProviders(<ProfessorAnalytics />, {
      initialEntries: ["/professor/analytics"],
    });
    await waitFor(() => {
      expect(screen.getByText("Cell Biology")).toBeInTheDocument();
    });
  });
});
