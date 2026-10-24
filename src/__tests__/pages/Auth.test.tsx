/**
 * The sign-in / sign-up page on the v4 stage (2026-10-24).
 *
 * One page, two modes. "Start learning" on the landing opens it in sign-up
 * mode (`?mode=signup`). Everyone signs up as a learner: there is no role
 * picker. Errors are one sentence under the form, never a toast. When Supabase
 * returns no session, the page says "check your inbox" instead of sending the
 * person to a protected route that would bounce them straight back here.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route, useLocation } from "react-router-dom";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

const { toastFn } = vi.hoisted(() => ({ toastFn: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastFn }),
  toast: toastFn,
}));

const { logLearningEvent } = vi.hoisted(() => ({ logLearningEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/studentService", () => ({ logLearningEvent }));

const useAuthMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  useAuth: () => useAuthMock(),
}));

import Auth from "@/pages/Auth";
import { renderWithProviders } from "@/test/renderWithProviders";

const signIn = vi.fn();
const signUp = vi.fn();

const baseAuth = {
  user: null,
  session: null,
  profile: null,
  role: null,
  loading: false,
  signIn,
  signUp,
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
};

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function mount(entry: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/auth" element={<><Auth /><Where /></>} />
      <Route path="/onboarding" element={<div>first-run</div>} />
    </Routes>,
    { initialEntries: [entry] },
  );
}

const passwordField = () => screen.getByLabelText(/^password$/i);

beforeEach(() => {
  supabaseMock.reset();
  toastFn.mockClear();
  signIn.mockReset().mockResolvedValue({ error: null });
  signUp.mockReset().mockResolvedValue({ error: null, needsConfirmation: false });
  useAuthMock.mockReset();
  useAuthMock.mockReturnValue(baseAuth);
});

describe("Auth page, sign-in mode", () => {
  it("opens in sign-in mode with empty email and password fields", () => {
    mount("/auth");
    expect(screen.getByRole("heading", { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toHaveValue("");
    expect(passwordField()).toHaveValue("");
    expect(screen.getByRole("button", { name: /sign in/i })).toBeEnabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("says what went wrong under the form, not in a toast", async () => {
    signIn.mockResolvedValue({ error: new Error("Invalid login credentials") });
    const user = userEvent.setup();
    mount("/auth");
    await user.type(screen.getByLabelText(/email address/i), "a@b.de");
    await user.type(passwordField(), "secret1");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/couldn't match that email and password/i)).toBeInTheDocument();
    expect(toastFn).not.toHaveBeenCalled();
  });

  it("checks the email before calling the server, and asks for a password", async () => {
    const user = userEvent.setup();
    mount("/auth");
    await user.type(screen.getByLabelText(/email address/i), "nope");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/doesn't look right/i)).toBeInTheDocument();
    expect(screen.getByText(/enter your password/i)).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("lets an existing shorter password through at sign-in", async () => {
    const user = userEvent.setup();
    mount("/auth");
    await user.type(screen.getByLabelText(/email address/i), "old@b.de");
    await user.type(passwordField(), "abc123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("old@b.de", "abc123"));
  });
});

describe("Auth page, sign-up mode", () => {
  it("opens straight in sign-up mode from ?mode=signup, with consent and no role picker", () => {
    mount("/auth?mode=signup");
    expect(screen.getByRole("heading", { name: /start here/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText(/professor|student|role/i)).not.toBeInTheDocument();
  });

  it("switches to sign-up from sign-in with Create one", async () => {
    const user = userEvent.setup();
    mount("/auth");
    await user.click(screen.getByRole("button", { name: /create one/i }));
    expect(await screen.findByRole("heading", { name: /start here/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("keeps a shared link's return path when switching modes", async () => {
    const user = userEvent.setup();
    mount("/auth?next=%2Fcourse%2Fabc");
    await user.click(screen.getByRole("button", { name: /create one/i }));
    expect(screen.getByTestId("where").textContent).toMatch(/mode=signup/);
    expect(screen.getByTestId("where").textContent).toMatch(/next=%2Fcourse%2Fabc/);
    await user.click(await screen.findByRole("button", { name: /^sign in$/i }));
    expect(screen.getByTestId("where").textContent).toBe("/auth?next=%2Fcourse%2Fabc");
  });

  it("asks for at least 8 characters for a new password", async () => {
    const user = userEvent.setup();
    mount("/auth?mode=signup");
    expect(screen.getByText(/^at least 8 characters$/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/email address/i), "new@b.de");
    await user.type(passwordField(), "secret1");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(await screen.findByText(/^at least 8 characters\.$/i)).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("asks for consent before creating the account", async () => {
    const user = userEvent.setup();
    mount("/auth?mode=signup");
    await user.type(screen.getByLabelText(/email address/i), "new@b.de");
    await user.type(passwordField(), "secret12");
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(await screen.findByText(/agree to the privacy policy first/i)).toBeInTheDocument();
    expect(signUp).not.toHaveBeenCalled();
  });

  it("creates the account with email and password only, then goes to first run", async () => {
    const user = userEvent.setup();
    mount("/auth?mode=signup");
    await user.type(screen.getByLabelText(/email address/i), "new@b.de");
    await user.type(passwordField(), "secret12");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => expect(signUp).toHaveBeenCalledWith("new@b.de", "secret12"));
    expect(await screen.findByText("first-run", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("shows check-your-inbox when there is no session yet, and stays on the page", async () => {
    signUp.mockResolvedValue({ error: null, needsConfirmation: true });
    const user = userEvent.setup();
    mount("/auth?mode=signup");
    await user.type(screen.getByLabelText(/email address/i), "new@b.de");
    await user.type(passwordField(), "secret12");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /create account/i }));
    expect(await screen.findByRole("heading", { name: /check your inbox/i })).toBeInTheDocument();
    expect(screen.getByText(/new@b\.de/)).toBeInTheDocument();
    expect(screen.queryByText("first-run")).not.toBeInTheDocument();
  });
});
