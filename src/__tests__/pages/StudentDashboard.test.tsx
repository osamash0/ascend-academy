import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

vi.mock("framer-motion", async () => {
  const actual =
    await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    useScroll: () => ({
      scrollX: { get: () => 0, set: () => {}, on: () => () => {} },
      scrollY: { get: () => 0, set: () => {}, on: () => () => {} },
      scrollXProgress: { get: () => 0, set: () => {}, on: () => () => {} },
      scrollYProgress: { get: () => 0, set: () => {}, on: () => () => {} },
    }),
    useTransform: () => ({
      get: () => 0,
      set: () => {},
      on: () => () => {},
    }),
  };
});

vi.mock("@/lib/auth", () => {
  const user = { id: "u1", email: "student@test.com" };
  const profile = {
    id: "p1",
    user_id: "u1",
    email: "student@test.com",
    full_name: "Test Student",
    display_name: "Test",
    avatar_url: null,
    total_xp: 50,
    current_level: 2,
    current_streak: 1,
    best_streak: 4,
  };
  return {
    useAuth: () => ({
      user,
      session: null,
      profile,
      role: "student",
      loading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      refreshProfile: vi.fn(),
    }),
  };
});

const useStudentDashboardMock = vi.fn();
vi.mock("@/features/student/hooks/useStudentDashboard", () => ({
  useStudentDashboard: () => useStudentDashboardMock(),
}));

import StudentDashboard from "@/pages/StudentDashboard";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => {
  supabaseMock.reset();
  useStudentDashboardMock.mockReset();
});

describe("StudentDashboard page (smoke)", () => {
  it("mounts a loading skeleton when query is loading", () => {
    useStudentDashboardMock.mockReturnValue({ data: null, isLoading: true });
    const { container } = renderWithProviders(<StudentDashboard />, {
      initialEntries: ["/dashboard"],
    });
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("renders the welcome banner when data has loaded but is empty", () => {
    useStudentDashboardMock.mockReturnValue({
      data: { lectures: [], progress: [], achievements: [] },
      isLoading: false,
    });
    renderWithProviders(<StudentDashboard />, { initialEntries: ["/dashboard"] });
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
    expect(screen.getByText(/courses started/i)).toBeInTheDocument();
  });

  it("renders the first lecture row when data is populated", () => {
    useStudentDashboardMock.mockReturnValue({
      data: {
        lectures: [
          {
            id: "lec1",
            title: "Astrophysics 101",
            description: "Stars and galaxies",
            total_slides: 10,
          },
        ],
        progress: [],
        achievements: [],
      },
      isLoading: false,
    });
    renderWithProviders(<StudentDashboard />, { initialEntries: ["/dashboard"] });
    expect(screen.getByText("Astrophysics 101")).toBeInTheDocument();
  });
});
