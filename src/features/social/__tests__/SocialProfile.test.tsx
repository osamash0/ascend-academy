/**
 * R28: SocialProfile had no loading or error state at all, and
 * useSocialUser() returns hardcoded fallback values (name "You", 0 XP,
 * level 1, streak 0, "No roles set") — indistinguishable from a genuine
 * brand-new account before/without real data actually loading. The fix
 * gates the page on the auth profile finishing its load and the
 * social-extras RPC (institution/roles/weekly XP), and surfaces a distinct
 * error state if the extras fetch fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import SocialProfile from "../pages/SocialProfile";
import * as hooks from "../hooks";
import * as authModule from "@/lib/auth";

vi.mock("../hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks")>();
  return {
    ...actual,
    useMySocialExtras: vi.fn(),
    useFriends: vi.fn(),
    useUserCourses: vi.fn(),
    useWeeklyXpByDay: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(),
}));

// SocialProfile calls useSocial() for the leaderboard role-filter action —
// unrelated to this fix. Stub it out (same pattern as
// src/__tests__/pages/StudentDashboard.test.tsx) to avoid needing a real
// SocialProvider (realtime presence channel, etc.) in this unit test.
vi.mock("../store", () => ({
  useSocial: () => ({
    setRoleFilter: vi.fn(),
    onlineUserIds: new Set<string>(),
    sendNudge: vi.fn(),
    roleFilter: null,
  }),
}));

const PROFILE = {
  user_id: "u1",
  display_name: "Real Name",
  full_name: "Real Name",
  avatar_url: null,
  total_xp: 500,
  current_level: 4,
  current_streak: 3,
};

function mockAuth(overrides: Record<string, unknown> = {}) {
  vi.mocked(authModule.useAuth).mockReturnValue({
    user: { id: "u1" },
    session: null,
    profile: PROFILE,
    role: "student",
    loading: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
    ...overrides,
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hooks.useFriends).mockReturnValue({ data: [] } as any);
  vi.mocked(hooks.useUserCourses).mockReturnValue({ data: [] } as any);
  vi.mocked(hooks.useWeeklyXpByDay).mockReturnValue({ data: [] } as any);
});

describe("SocialProfile — loading/error gating (R28 regression)", () => {
  it("shows a loading state instead of fallback placeholder values while auth is still loading", () => {
    mockAuth({ profile: null, loading: true });
    vi.mocked(hooks.useMySocialExtras).mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<SocialProfile />);

    expect(screen.getByTestId("social-profile-loading")).toBeInTheDocument();
    expect(screen.queryByText("You")).not.toBeInTheDocument();
    expect(screen.queryByText(/no roles set/i)).not.toBeInTheDocument();
  });

  it("shows a loading state while the social-extras RPC is in flight, even once auth resolves", () => {
    mockAuth();
    vi.mocked(hooks.useMySocialExtras).mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<SocialProfile />);

    expect(screen.getByTestId("social-profile-loading")).toBeInTheDocument();
  });

  it("shows a distinct error state with retry when the social-extras RPC fails", async () => {
    mockAuth();
    const refetch = vi.fn();
    vi.mocked(hooks.useMySocialExtras).mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      refetch,
    } as any);

    renderWithProviders(<SocialProfile />);

    expect(screen.getByTestId("social-profile-error")).toBeInTheDocument();
    expect(screen.queryByText("Real Name")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("renders the real profile once both auth and extras have loaded successfully", () => {
    mockAuth();
    vi.mocked(hooks.useMySocialExtras).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { institution: "Uni Marburg", roles: ["Student"], weeklyXp: 40 },
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<SocialProfile />);

    expect(screen.getByText("Real Name")).toBeInTheDocument();
    expect(screen.queryByTestId("social-profile-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("social-profile-error")).not.toBeInTheDocument();
  });
});
