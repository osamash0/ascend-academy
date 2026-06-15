import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const motionProxy = new Proxy({} as any, {
    get: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ({ children, ...rest }: any) => {
        const {
          initial: _i, animate: _a, exit: _e, transition: _t, variants: _v,
          whileHover: _wh, whileTap: _wt, whileInView: _wi, whileFocus: _wf,
          drag: _d, layout: _l, layoutId: _li, custom: _c, viewport: _vp,
          ...domProps
        } = rest;
        return <div {...domProps}>{children}</div>;
      };
    },
  });
  return {
    ...actual,
    AnimatePresence: Passthrough,
    motion: motionProxy,
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

import StudentCourseLibrary from "@/pages/StudentCourseLibrary";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => {
  supabaseMock.reset();
  useStudentDashboardMock.mockReset();
});

describe("StudentCourseLibrary page (smoke)", () => {
  it("mounts loading spinner when loading", () => {
    useStudentDashboardMock.mockReturnValue({ data: null, isLoading: true, isError: false });
    const { container } = renderWithProviders(<StudentCourseLibrary />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders library with mock data", async () => {
    useStudentDashboardMock.mockReturnValue({
      data: {
        lectures: [
          {
            id: "lec1",
            title: "1.1 Introduction to Databases",
            description: "Database basics",
            total_slides: 10,
            created_at: "2026-01-01T00:00:00Z",
            course_id: "c1",
            course: {
              id: "c1",
              title: "Datenbanksysteme",
            },
          },
        ],
        courses: [
          {
            id: "c1",
            title: "Datenbanksysteme",
            description: "Learn about DBs",
          }
        ],
        progress: [
          {
            lecture_id: "lec1",
            completed_slides: [1, 2],
            total_questions_answered: 2,
            correct_answers: 2,
          }
        ],
      },
      isLoading: false,
      isError: false,
    });

    renderWithProviders(<StudentCourseLibrary />);
    await waitFor(() => {
      console.log("RENDERED TEXT:", document.body.textContent);
      expect(screen.getAllByText("Database Systems").length).toBeGreaterThan(0);
    });
  });
});
