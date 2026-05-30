import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

const useAuthMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  useAuth: () => useAuthMock(),
}));

import Settings from "@/pages/Settings";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => {
  supabaseMock.reset();
  useAuthMock.mockReset();
});

describe("Settings page (smoke)", () => {
  it("mounts a loading skeleton when profile is not yet loaded", () => {
    useAuthMock.mockReturnValue({
      user: { id: "u1", email: "x@x.com" },
      profile: null,
      role: "student",
      loading: false,
      signOut: vi.fn(),
      refreshProfile: vi.fn(),
    });
    const { container } = renderWithProviders(<Settings />, {
      initialEntries: ["/settings"],
    });
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("renders the Settings heading once profile is available", () => {
    useAuthMock.mockReturnValue({
      user: { id: "u1", email: "x@x.com" },
      profile: {
        id: "p1",
        user_id: "u1",
        email: "x@x.com",
        full_name: "Pat User",
        display_name: "Pat",
        avatar_url: null,
        total_xp: 0,
        current_level: 1,
        current_streak: 0,
        best_streak: 0,
      },
      role: "student",
      loading: false,
      signOut: vi.fn(),
      refreshProfile: vi.fn(),
    });
    renderWithProviders(<Settings />, { initialEntries: ["/settings"] });
    expect(
      screen.getByRole("heading", { level: 1, name: /settings/i }),
    ).toBeInTheDocument();
  });

  it("shows the Data & Privacy section once loaded (first row of options)", () => {
    useAuthMock.mockReturnValue({
      user: { id: "u1", email: "x@x.com" },
      profile: {
        id: "p1",
        user_id: "u1",
        email: "x@x.com",
        full_name: "Pat User",
        display_name: "Pat",
        avatar_url: null,
        total_xp: 0,
        current_level: 1,
        current_streak: 0,
        best_streak: 0,
      },
      role: "student",
      loading: false,
      signOut: vi.fn(),
      refreshProfile: vi.fn(),
    });
    renderWithProviders(<Settings />, { initialEntries: ["/settings"] });
    expect(screen.getByText(/data & privacy/i)).toBeInTheDocument();
    expect(screen.getByText(/export my data/i)).toBeInTheDocument();
  });
});
