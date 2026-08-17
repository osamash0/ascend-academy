/**
 * GDPR Art. 17 (erasure) and Art. 20 (portability) paths in Settings.
 *
 * Regression tests for two real defects:
 *  - the export was assembled in the browser from four tables (of the ~22 in
 *    account_service.EXPORT_TABLES), so the delivered file was incomplete;
 *  - a failed server delete silently fell back to deleting five tables from
 *    the client and then reported success, leaving auth.users, storage
 *    objects and every other table behind while telling the user their
 *    account was gone.
 *
 * These live in their own file rather than Settings.test.tsx: that suite's
 * preferences test races a 1000ms waitFor against a load path whose
 * `.finally()` is already flagged by tsc (Settings.tsx:483, "Property
 * 'finally' does not exist on type 'PromiseLike<void>'"), and adding another
 * module mock to its graph is enough to tip it over.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/integrations/supabase/client", async () => {
  const { createSupabaseMock } = await import("@/test/supabaseMock");
  return { supabase: createSupabaseMock() };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

const useAuthMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  useAuth: () => useAuthMock(),
}));

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  apiClient: {
    get: (...args: unknown[]) => apiGetMock(...args),
    post: (...args: unknown[]) => apiPostMock(...args),
  },
}));

import Settings from "@/pages/Settings";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseMock } from "@/test/supabaseMock";
import { renderWithProviders } from "@/test/renderWithProviders";

const supabaseMock = supabase as unknown as SupabaseMock;

const PROFILE = {
  id: "p1", user_id: "u1", email: "x@x.com", full_name: "Pat User",
  display_name: "Pat", avatar_url: null, total_xp: 0, current_level: 1,
  current_streak: 0, best_streak: 0,
};

beforeEach(() => {
  supabaseMock.reset();
  useAuthMock.mockReset();
  apiGetMock.mockReset();
  apiPostMock.mockReset();
});

/** Mount the Data & Privacy pane (selected via the `?tab=` query param). */
function renderDataPane(signOut = vi.fn()) {
  useAuthMock.mockReturnValue({
    user: { id: "u1", email: "x@x.com" },
    profile: PROFILE,
    role: "student",
    loading: false,
    signOut,
    refreshProfile: vi.fn(),
  });
  return renderWithProviders(<Settings />, {
    initialEntries: ["/settings?tab=data"],
  });
}

describe("Settings — GDPR export", () => {
  it("exports via the server endpoint rather than reading tables in the browser", async () => {
    apiGetMock.mockResolvedValue({ exported_at: "2026-08-15T00:00:00Z", profile: {} });
    // happy-dom has no real download pipeline; stub what the handler touches.
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:stub"),
      revokeObjectURL: vi.fn(),
    });

    renderDataPane();
    await userEvent.setup().click(screen.getByRole("button", { name: /^export$/i }));

    await waitFor(() =>
      expect(apiGetMock).toHaveBeenCalledWith("/api/auth/export-data"),
    );
    vi.unstubAllGlobals();
  });
});

describe("Settings — GDPR account erasure", () => {
  it("calls the server delete endpoint and signs the user out on success", async () => {
    apiPostMock.mockResolvedValue({ message: "Account deleted." });
    const signOut = vi.fn().mockResolvedValue(undefined);

    renderDataPane(signOut);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /delete my account/i }));
    await user.click(
      await screen.findByRole("button", { name: /yes, delete everything/i }),
    );

    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith("/api/auth/delete-account", {}),
    );
    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });

  it("does NOT delete rows client-side or sign out when the server delete fails", async () => {
    apiPostMock.mockRejectedValue(new Error("502 Bad Gateway"));
    const signOut = vi.fn().mockResolvedValue(undefined);
    supabaseMock.seed("profiles", [{ user_id: "u1", email: "x@x.com" }]);
    supabaseMock.seed("student_progress", [{ user_id: "u1", score: 1 }]);

    renderDataPane(signOut);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /delete my account/i }));
    await user.click(
      await screen.findByRole("button", { name: /yes, delete everything/i }),
    );

    await waitFor(() => expect(apiPostMock).toHaveBeenCalled());
    // The failure must surface, not be papered over with a partial local wipe.
    expect(signOut).not.toHaveBeenCalled();
    expect(supabaseMock.data.profiles.rows).toHaveLength(1);
    expect(supabaseMock.data.student_progress.rows).toHaveLength(1);
  });
});
