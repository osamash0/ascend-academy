/**
 * Regression tests for R22 and R29 (Milestone-4/PROBLEMS.md).
 *
 * R22: the achievements query destructured away `error` and had no
 * `.catch()`, so an RLS/network failure resolved to `[]` and rendered the
 * 🌱 "no badges yet" empty state — indistinguishable from truly having
 * earned nothing.
 *
 * R29: `const { data } = useStudentDashboard();` discarded isLoading/isError
 * entirely, so the overview tab rendered hard zeros ("0% Quiz Accuracy",
 * "0 Lectures Done") before data arrived, and those zeros were permanent on
 * a real fetch failure.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

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
  return { ...actual, AnimatePresence: Passthrough, motion: motionProxy };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "student@test.com" },
    profile: {
      user_id: "u1",
      total_xp: 120,
      current_level: 2,
      current_streak: 1,
      best_streak: 3,
    },
  }),
}));

const useStudentDashboardMock = vi.fn();
vi.mock("@/features/student/hooks/useStudentDashboard", () => ({
  useStudentDashboard: () => useStudentDashboardMock(),
}));

// Achievements are fetched directly via supabase.from('achievements')... in
// Ascent.tsx; this minimal chain-mock lets each test control {data, error}.
const achievementsResponse: { current: { data: unknown; error: unknown } } = {
  current: { data: [], error: null },
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "achievements") throw new Error(`unexpected table: ${table}`);
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => Promise.resolve(achievementsResponse.current),
      };
      return builder;
    },
  },
}));

vi.mock("@/services/gamificationService", () => ({
  fetchBadgeCatalog: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/features/skilltree/useSkillTree", () => ({
  useSkillTree: () => ({ tree: [], counts: {}, conceptsAvailable: false, hasContent: false }),
}));

// Out of scope for R22/R29 — stub heavy, unrelated children so the test
// stays focused on the achievements/dashboard error-vs-empty logic.
vi.mock("@/components/AcademicProfileEditor", () => ({
  AcademicProfileEditor: () => null,
}));
vi.mock("@/components/UniversityEmailLink", () => ({
  UniversityEmailLink: () => null,
}));
vi.mock("@/features/student/components/FullJourneyPath", () => ({
  FullJourneyPath: () => null,
}));

import Ascent from "@/pages/Ascent";

beforeEach(() => {
  useStudentDashboardMock.mockReset();
  achievementsResponse.current = { data: [], error: null };
});

function mockDashboard(overrides: Record<string, unknown> = {}) {
  useStudentDashboardMock.mockReturnValue({
    data: { lectures: [], progress: [], achievements: [], courses: [], courseVisits: [] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  });
}

describe("Ascent — R29 dashboard loading/error handling", () => {
  it("shows a loading skeleton (no hard zeros) while the dashboard is resolving", () => {
    mockDashboard({ data: null, isLoading: true });

    renderWithProviders(<Ascent />);

    expect(screen.queryByText(/quiz accuracy/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/answer your first quiz/i)).not.toBeInTheDocument();
  });

  it("shows a real error state with retry (not permanent zeros) when the dashboard fetch fails", async () => {
    const refetch = vi.fn();
    mockDashboard({ data: null, isError: true, refetch });

    renderWithProviders(<Ascent />);

    expect(screen.getByText(/couldn't load your progress/i)).toBeInTheDocument();
    expect(screen.queryByText(/quiz accuracy/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  });

  it("renders the real metrics once the dashboard has successfully loaded", () => {
    mockDashboard();

    renderWithProviders(<Ascent />);

    expect(screen.getByText(/quiz accuracy/i)).toBeInTheDocument();
    expect(screen.getByText(/lectures done/i)).toBeInTheDocument();
  });
});

describe("Ascent — R22 achievements error vs. empty state", () => {
  it("shows a real error state (not the 'no badges yet' empty state) when the achievements fetch fails", async () => {
    mockDashboard();
    achievementsResponse.current = { data: null, error: new Error("rls denied") };

    renderWithProviders(<Ascent />);
    fireEvent.click(screen.getByTestId("ascent-tab-trophies"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't load your badges/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/no badges yet/i)).not.toBeInTheDocument();
  });

  it("retries the achievements fetch when the retry button is clicked", async () => {
    mockDashboard();
    achievementsResponse.current = { data: null, error: new Error("rls denied") };

    renderWithProviders(<Ascent />);
    fireEvent.click(screen.getByTestId("ascent-tab-trophies"));
    await waitFor(() => screen.getByText(/couldn't load your badges/i));

    achievementsResponse.current = { data: [], error: null };
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText(/no badges yet/i)).toBeInTheDocument();
    });
  });

  it("still shows the genuine 'no badges yet' empty state when there is no error", async () => {
    mockDashboard();
    achievementsResponse.current = { data: [], error: null };

    renderWithProviders(<Ascent />);
    fireEvent.click(screen.getByTestId("ascent-tab-trophies"));

    await waitFor(() => {
      expect(screen.getByText(/no badges yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/couldn't load your badges/i)).not.toBeInTheDocument();
  });
});
