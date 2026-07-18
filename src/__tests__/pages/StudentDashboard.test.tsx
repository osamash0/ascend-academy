import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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

vi.mock("@/features/social/components/DashboardFriendsWidget", () => ({
  DashboardFriendsWidget: () => <div data-testid="mock-friends-widget" />
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

  it("renders the empty-state welcome when data has loaded but is empty", () => {
    useStudentDashboardMock.mockReturnValue({
      data: { lectures: [], progress: [], achievements: [] },
      isLoading: false,
    });
    renderWithProviders(<StudentDashboard />, { initialEntries: ["/dashboard"] });
    expect(screen.getByText(/no courses yet/i)).toBeInTheDocument();
  });

  it("renders the focused lecture when data is populated", async () => {
    // Some progress → hero kind 'resume' (not 'onboard'), so the focused
    // HeroStage + rail render the lecture title rather than the onboarding hero.
    useStudentDashboardMock.mockReturnValue({
      data: {
        lectures: [
          {
            id: "lec1",
            title: "Astrophysics 101",
            description: "Stars and galaxies",
            total_slides: 10,
            created_at: "2026-01-01T00:00:00Z",
            course_id: "c1",
            course: {
              id: "c1",
              title: "Database Systems",
            },
          },
        ],
        progress: [
          {
            lecture_id: "lec1",
            completed_slides: [1],
            total_questions_answered: 0,
            correct_answers: 0,
          },
        ],
        achievements: [],
      },
      isLoading: false,
    });
    renderWithProviders(<StudentDashboard />, { initialEntries: ["/dashboard"] });
    // Title appears in the hero and the rail tile — assert it's present.
    await waitFor(() =>
      expect(screen.getAllByText("Astrophysics 101").length).toBeGreaterThan(0),
    );
  });

  it("adapts to a brand-new student with a focused onboarding panel (no firehose)", async () => {
    // One lecture, zero progress → hero kind 'onboard'.
    useStudentDashboardMock.mockReturnValue({
      data: {
        lectures: [
          {
            id: "lec1",
            title: "Astrophysics 101",
            description: "Stars and galaxies",
            total_slides: 10,
            created_at: "2026-01-01T00:00:00Z",
            course_id: "c1",
            course: { id: "c1", title: "Database Systems" },
          },
        ],
        progress: [],
        achievements: [],
      },
      isLoading: false,
    });
    renderWithProviders(<StudentDashboard />, { initialEntries: ["/dashboard"] });
    // Onboard hero (WelcomeOnboardingHero) shows the "choose your path" panel…
    await waitFor(() => expect(screen.getByText(/ready to learn/i)).toBeInTheDocument());
    // …and NOT the full browse-row firehose (the per-course rail).
    expect(screen.queryByText("Database Systems")).not.toBeInTheDocument();
  });

  it("celebrates an all-done student with the review banner", async () => {
    // Single lecture, fully completed → hero kind 'review'.
    useStudentDashboardMock.mockReturnValue({
      data: {
        lectures: [
          {
            id: "lec1",
            title: "Astrophysics 101",
            description: "Stars and galaxies",
            total_slides: 2,
            created_at: "2026-01-01T00:00:00Z",
            course_id: "c1",
            course: { id: "c1", title: "Database Systems" },
          },
        ],
        progress: [
          {
            lecture_id: "lec1",
            completed_slides: [1, 2],
            total_questions_answered: 4,
            correct_answers: 3,
          },
        ],
        achievements: [],
      },
      isLoading: false,
    });
    renderWithProviders(<StudentDashboard />, { initialEntries: ["/dashboard"] });
    await waitFor(() =>
      expect(screen.getByText(/completed every lecture/i)).toBeInTheDocument(),
    );
  });

  it("renders the below-the-fold feed when not in onboard mode", async () => {
    // Partial progress → hero kind 'resume', so the deferred below-the-fold
    // feed (bento + browse-courses anchor) mounts, unlike the onboard hero.
    useStudentDashboardMock.mockReturnValue({
      data: {
        lectures: [
          {
            id: "lec1",
            title: "Astrophysics 101",
            description: "Stars and galaxies",
            total_slides: 10,
            created_at: "2026-01-01T00:00:00Z",
            course_id: "c1",
            course: { id: "c1", title: "Database Systems" },
          },
        ],
        progress: [
          {
            lecture_id: "lec1",
            completed_slides: [1],
            total_questions_answered: 0,
            correct_answers: 0,
          }
        ],
        achievements: [],
      },
      isLoading: false,
    });
    const { container } = renderWithProviders(<StudentDashboard />, {
      initialEntries: ["/dashboard"],
    });

    await waitFor(() =>
      expect(container.querySelector('[data-tour="browse-courses"]')).not.toBeNull(),
    );
  });
});
