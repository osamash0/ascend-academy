import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("@/integrations/supabase/client", async () => {
  const { createSupabaseMock } = await import("@/test/supabaseMock");
  return { supabase: createSupabaseMock() };
});

/*
 * The mocked hook must hand back the *same* `toast` function on every render.
 *
 * The real `useToast` returns a fresh wrapper object each render, but its
 * `toast` property is a module-level function, so that identity never changes.
 * `PreferencesSettings` depends on it: its preferences-loading effect lists
 * `[user, toast, t]`, and `toast` holding still is what makes the effect run
 * once.
 *
 * A factory returning `{ toast: vi.fn() }` breaks that contract — a new mock
 * function per render, so the effect re-ran on every render and each run set
 * `preferencesLoading` back to true. The switch is
 * `disabled={!user || preferencesLoading || savingNudges}`, so it flickered
 * between enabled and disabled. Instrumenting the query boundary showed one
 * run issuing **87** SELECTs against `notification_preferences` before
 * settling and another only 3 — the variance being the flakiness itself.
 *
 * That is what made the opt-out test below fail roughly 4 runs in 5. It waits
 * for `not.toBeDisabled()`, catches one of the brief enabled windows, then
 * `userEvent.click` lands in a disabled one — where a click is silently a
 * no-op. No upsert, so the seeded row keeps `lifecycle_nudges_enabled: true`
 * and the assertion reports "expected true to be false" while pointing at a
 * component that behaved correctly the entire time.
 *
 * `vi.hoisted` because `vi.mock` factories are lifted above module scope and
 * cannot close over an ordinary `const` declared here.
 */
const { toastFn, dismissFn } = vi.hoisted(() => ({
  toastFn: vi.fn(),
  dismissFn: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  // A new object per call, like the real hook — but stable function identities.
  useToast: () => ({ toast: toastFn, dismiss: dismissFn }),
  toast: toastFn,
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
  // Shared across tests now that the identities are stable, so clear the
  // recorded calls per test rather than leaving them to accumulate.
  toastFn.mockClear();
  dismissFn.mockClear();
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

    await waitFor(() => {
      expect(supabaseMock.data.notification_preferences.rows[0].lifecycle_nudges_enabled).toBe(false);
    });
  });
});
