/**
 * Auth is a static, instantly-rendered form (no async data fetch), so the
 * canonical "mount + loading + empty + first-row" smoke pattern is mapped
 * to equivalents:
 *   - mount               => login form is present
 *   - loading-equivalent  => submit button is enabled (no in-flight call)
 *   - empty-equivalent    => email + password fields start empty
 *   - first-row-equivalent => switching to signup reveals role/consent UI
 */
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

import Auth from "@/pages/Auth";
import { renderWithProviders } from "@/test/renderWithProviders";

const baseAuth = {
  user: null,
  session: null,
  profile: null,
  role: null,
  loading: false,
  signIn: vi.fn().mockResolvedValue({ error: null }),
  signUp: vi.fn().mockResolvedValue({ error: null }),
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
};

beforeEach(() => {
  supabaseMock.reset();
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue(baseAuth);
});

describe("Auth page (smoke)", () => {
  it("mount: renders the login form with email + password fields", () => {
    renderWithProviders(<Auth />, { initialEntries: ["/auth"] });
    expect(screen.getAllByText(/initiate session/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/email identity/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/access key/i)).toBeInTheDocument();
  });

  it("loading equivalent: submit button is enabled when no auth call is in flight", () => {
    renderWithProviders(<Auth />, { initialEntries: ["/auth"] });
    const submit = screen.getByRole("button", { name: /initiate session/i });
    expect(submit).toBeInTheDocument();
    expect(submit).not.toBeDisabled();
  });

  it("empty equivalent: form starts with empty email and password values", () => {
    renderWithProviders(<Auth />, { initialEntries: ["/auth"] });
    expect(screen.getByLabelText(/email identity/i)).toHaveValue("");
    expect(screen.getByLabelText(/access key/i)).toHaveValue("");
  });

  it("first-row equivalent: switching to signup mode reveals role + consent controls", async () => {
    const { default: userEventModule } = await import("@testing-library/user-event");
    const user = userEventModule.setup();
    renderWithProviders(<Auth />, { initialEntries: ["/auth"] });

    await user.click(
      screen.getByRole("button", { name: /join the mission/i }),
    );

    expect(screen.getByText(/enlist operator/i)).toBeInTheDocument();
    expect(screen.getByText(/designation/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });
});
