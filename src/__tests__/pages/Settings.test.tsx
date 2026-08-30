import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("@/integrations/supabase/client", async () => {
  const { createSupabaseMock } = await import("@/test/supabaseMock");
  return { supabase: createSupabaseMock() };
});

// `toast` MUST be a single stable reference across renders, because the real
// module exports it as a module-scope function (use-toast.ts:137) and
// useToast() returns that same one every time. Returning a fresh vi.fn() per
// call — as this mock used to — manufactures an unstable dependency that the
// real app never has, and Settings' notification-preferences loader lists
// `toast` in its dependency array. The result was a runaway effect: 203
// notification_preferences reads in 400ms, each one flipping
// preferencesLoading back to true and re-disabling the toggle, so a click
// landed on a disabled control roughly two runs in three. That was the whole
// flake — a mock lying about another module's contract.
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
  toast: toastMock,
}));

const useAuthMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  useAuth: () => useAuthMock(),
}));

import Settings from "@/pages/Settings";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseMock } from "@/test/supabaseMock";
import { renderWithProviders } from "@/test/renderWithProviders";

const supabaseMock = supabase as unknown as SupabaseMock;

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
    // The Data & Privacy pane renders only when its tab is active (default is
    // 'general'); the page reads the active tab from the `?tab=` query param.
    renderWithProviders(<Settings />, { initialEntries: ["/settings?tab=data"] });
    // "Data & Privacy" appears twice once the tab is active: the nav label and
    // the pane heading — hence getAllByText.
    expect(screen.getAllByText(/data & privacy/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/export my data/i)).toBeInTheDocument();
  });

  it("lets a user opt out of future lifecycle reminders", async () => {
    useAuthMock.mockReturnValue({
      user: { id: "u1", email: "x@x.com" },
      profile: {
        id: "p1", user_id: "u1", email: "x@x.com", full_name: "Pat User",
        display_name: "Pat", avatar_url: null, total_xp: 0, current_level: 1,
        current_streak: 0, best_streak: 0,
      },
      role: "student", loading: false, signOut: vi.fn(), refreshProfile: vi.fn(),
    });
    supabaseMock.seed("notification_preferences", [{
      user_id: "u1", lifecycle_nudges_enabled: true, in_app_enabled: true,
    }]);

    renderWithProviders(<Settings />, { initialEntries: ["/settings?tab=preferences"] });
    const toggle = await screen.findByRole("switch", { name: /show learning reminders/i });
    await waitFor(() => expect(toggle).not.toBeDisabled());
    expect(toggle).toHaveAttribute("data-state", "checked");
    await userEvent.setup().click(toggle);

    // What the user actually observes comes first: the switch must flip.
    await waitFor(() => expect(toggle).toHaveAttribute("data-state", "unchecked"));
    // And the opt-out has to survive a reload, so also pin that it persisted.
    expect(supabaseMock.data.notification_preferences.rows[0].lifecycle_nudges_enabled).toBe(false);
  });
});
