/**
 * Launch Control's verdict: failing gates and unconfirmed manual gates are
 * "before launch"; ticking the manual ones is the only way to reach "Ready".
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LaunchOverview } from "@/services/launchControlService";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));

const { fetchOverviewMock } = vi.hoisted(() => ({ fetchOverviewMock: vi.fn() }));
vi.mock("@/services/launchControlService", () => ({
  launchControlService: { fetchOverview: fetchOverviewMock, setClassification: vi.fn() },
}));

import LaunchControl from "@/pages/LaunchControl";
import { renderWithProviders } from "@/test/renderWithProviders";

function overview(gates: LaunchOverview["gates"]): LaunchOverview {
  return {
    generated_at: new Date().toISOString(),
    gates,
    models: { mode: "openai_only", quality: "gpt-4.1-mini", bulk: "gpt-4.1-nano" },
    pulse: {
      classification_ready: true,
      totals: { real_users: 3, all_users: 10, signups_7d: 1, active_24h: 1, active_7d: 2 },
      funnel: { signed_up: 3, onboarded: 2, activated: 2, came_back: 1, week_2_active: 0 },
      sources: [],
      signups_daily: [{ date: "2026-10-11", signups: 1 }],
      feed: [],
    },
    ai: {
      ceiling_usd: 10, user_cap_usd: 2, today_usd: 0.5, month_usd: 1,
      daily: [], by_feature: [], by_provider: [], top_users: [],
    },
    catalog: [],
  };
}

describe("LaunchControl", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchOverviewMock.mockReset();
  });

  it("counts failing gates and unconfirmed manual checks", async () => {
    fetchOverviewMock.mockResolvedValue(overview([
      { id: "ai_mode", label: "All AI runs on OpenAI", status: "pass", detail: "" },
      { id: "catalog", label: "Every visible lecture passes", status: "fail", detail: "3 of 5 pass" },
      { id: "backup", label: "Fresh database backup taken", status: "confirm", detail: "" },
    ]));
    renderWithProviders(<LaunchControl />);
    expect(await screen.findByText("2 things before launch")).toBeInTheDocument();
  });

  it("is ready only once the manual checks are confirmed", async () => {
    fetchOverviewMock.mockResolvedValue(overview([
      { id: "ai_mode", label: "All AI runs on OpenAI", status: "pass", detail: "" },
      { id: "backup", label: "Fresh database backup taken", status: "confirm", detail: "" },
    ]));
    renderWithProviders(<LaunchControl />);
    expect(await screen.findByText("1 thing before launch")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm: Fresh database backup taken" }));
    expect(screen.getByText("Ready for lift-off")).toBeInTheDocument();
  });
});
