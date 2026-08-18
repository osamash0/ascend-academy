import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "u@u.com" } }),
}));

vi.mock("@/lib/gamification/GamificationProvider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gamification/GamificationProvider")>(
    "@/lib/gamification/GamificationProvider",
  );
  return {
    ...actual,
    useGamification: () => ({
      evaluate: vi.fn(),
      awardBadge: vi.fn(),
      grantXp: vi.fn(),
    }),
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/apiClient", () => ({
  apiClient: { post: vi.fn().mockResolvedValue({}) },
}));

import { FeedbackWidget } from "@/components/FeedbackWidget";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => vi.clearAllMocks());

// R47: the route-matching map was keyed by exact pathname, and the entry
// for the advanced-analytics screen used a static string that could never
// match the real dynamic route `/professor/analytics/:lectureId/advanced`.
// Feedback filed from that screen fell through to the generic fallback with
// `features: []` and the raw pathname as the page name.
describe("FeedbackWidget — R47 dynamic route matching", () => {
  it("resolves the real page name/features for the dynamic advanced-analytics route", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/professor/analytics/:lectureId/advanced" element={<FeedbackWidget />} />
      </Routes>,
      { initialEntries: ["/professor/analytics/lec-123/advanced"] },
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId("feedback-launcher"));

    expect(screen.getByText("Advanced Analytics")).toBeInTheDocument();
    // features non-empty means the datalist is rendered.
    expect(document.getElementById("feedback-features-list")).not.toBeNull();
  });

  it("falls back to the raw pathname with no features for a truly unknown route", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/some/unknown/route" element={<FeedbackWidget />} />
      </Routes>,
      { initialEntries: ["/some/unknown/route"] },
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId("feedback-launcher"));

    expect(screen.getByText("/some/unknown/route")).toBeInTheDocument();
    expect(document.getElementById("feedback-features-list")).toBeNull();
  });

  it("still resolves the static /professor/analytics route correctly (no dynamic segment)", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/professor/analytics" element={<FeedbackWidget />} />
      </Routes>,
      { initialEntries: ["/professor/analytics"] },
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId("feedback-launcher"));

    expect(screen.getByText("Professor Analytics")).toBeInTheDocument();
  });
});
