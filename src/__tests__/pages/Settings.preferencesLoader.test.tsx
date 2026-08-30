/**
 * The notification-preferences loader must fetch ONCE per user, no matter how
 * often Settings re-renders.
 *
 * This is deliberately hostile: `useToast` here returns a NEW function on every
 * call. The real hook doesn't do that (`toast` is module-scope in
 * use-toast.ts), so this is not reproducing production — it is removing the
 * loader's reliance on another module's referential-stability, which is an
 * implementation detail it should not be coupled to.
 *
 * Why this earns a test rather than a comment: when that assumption broke
 * (inside Settings.test.tsx's own mock), the loader ran 203 times in 400ms,
 * each pass flipping `preferencesLoading` back to true and re-disabling the
 * toggle. It presented as an unrelated flaky test, not as a fetch loop. The
 * codebase has been here before — see the memoization note in src/lib/auth.tsx
 * about a refreshProfile loop that sustained 60 requests/second per open tab.
 * A render-triggered refetch is invisible locally and expensive in production.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", async () => {
  const { createSupabaseMock } = await import("@/test/supabaseMock");
  return { supabase: createSupabaseMock() };
});

// Intentionally unstable: a fresh function per call.
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
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

describe("Settings — notification preferences loader", () => {
  it("reads preferences once even when a hook dependency changes identity every render", async () => {
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

    let reads = 0;
    const realFrom = supabaseMock.from.bind(supabaseMock);
    vi.spyOn(supabaseMock, "from").mockImplementation((table: string) => {
      if (table === "notification_preferences") reads++;
      return realFrom(table);
    });

    renderWithProviders(<Settings />, { initialEntries: ["/settings?tab=preferences"] });
    await screen.findByRole("switch", { name: /show learning reminders/i });

    // Let any runaway effect chain have room to run away.
    await new Promise((r) => setTimeout(r, 300));

    expect(reads).toBe(1);
  });
});
