/**
 * Regression coverage for Milestone-4 audit finding R1: the admin "Diagnostics"
 * tab used to render three hand-written fake Sentry issues whenever
 * SENTRY_AUTH_TOKEN/ORG/PROJECT were unset, while the accompanying
 * `configured: false` / `config_help` payload was written to state
 * (`sentryConfig`) that nothing ever rendered. An admin with no Sentry
 * integration configured therefore saw a plausible-looking but entirely
 * fabricated incident list with no indication it wasn't real.
 *
 * These tests assert the "not configured" banner actually renders and that
 * no fabricated issue titles ever reach the screen.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
  toast: vi.fn(),
}));

const {
  fetchErrorsMock,
  fetchDeploymentInfoMock,
  fetchPlatformStatsMock,
  fetchUsersMock,
  fetchEventsMock,
  fetchBackupsMock,
} = vi.hoisted(() => ({
  fetchErrorsMock: vi.fn(),
  fetchDeploymentInfoMock: vi.fn(),
  fetchPlatformStatsMock: vi.fn(),
  fetchUsersMock: vi.fn(),
  fetchEventsMock: vi.fn(),
  fetchBackupsMock: vi.fn(),
}));

vi.mock("@/services/adminService", async () => {
  const actual = await vi.importActual<typeof import("@/services/adminService")>(
    "@/services/adminService",
  );
  return {
    ...actual,
    adminService: {
      ...actual.adminService,
      fetchPlatformStats: fetchPlatformStatsMock,
      fetchUsers: fetchUsersMock,
      fetchEvents: fetchEventsMock,
      fetchBackups: fetchBackupsMock,
      fetchErrors: fetchErrorsMock,
      fetchDeploymentInfo: fetchDeploymentInfoMock,
    },
  };
});

import AdminDashboard from "@/pages/AdminDashboard";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => {
  supabaseMock.reset();
  toastMock.mockClear();
  fetchErrorsMock.mockReset();
  fetchDeploymentInfoMock.mockReset();
  fetchDeploymentInfoMock.mockResolvedValue({
    health: {
      database: "healthy",
      database_connections: 3,
      ai_services: "connected",
      sentry: "disabled",
      sentry_dsn: "",
      api: "healthy",
    },
    system: { os: "Linux", release: "test", python_version: "3.11.0" },
    deployments: { migrations_count: 42, app_version: "3.0.0" },
    environment: {},
  });
  fetchPlatformStatsMock.mockReset();
  fetchPlatformStatsMock.mockResolvedValue({
    users: { total: 10, professors: 2, admins: 1, students: 7, active_24h: 3 },
    content: { courses: 4, lectures: 20 },
    financial: { month_llm_cost_usd: 1.23 },
  });
  fetchUsersMock.mockReset();
  fetchUsersMock.mockResolvedValue({ success: true, data: [], meta: { total: 0, page: 1, limit: 20, total_pages: 1 } });
  fetchEventsMock.mockReset();
  fetchEventsMock.mockResolvedValue({ success: true, data: [], meta: { total: 0, page: 1, limit: 20, total_pages: 1 } });
  fetchBackupsMock.mockReset();
  fetchBackupsMock.mockResolvedValue([]);
});

describe("AdminDashboard — Diagnostics tab (R1 regression)", () => {
  it("renders the 'not configured' banner instead of fabricated issues when Sentry env vars are unset", async () => {
    fetchErrorsMock.mockResolvedValue({
      success: true,
      configured: false,
      config_help: {
        message: "Sentry Web API integration is not configured. Set SENTRY_AUTH_TOKEN, SENTRY_ORG, and SENTRY_PROJECT to enable live error monitoring.",
        org: null,
        project: null,
        has_token: false,
      },
      data: [],
    });

    renderWithProviders(<AdminDashboard />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Diagnostics/i }));

    await waitFor(() => {
      expect(screen.getByTestId("sentry-not-configured")).toBeInTheDocument();
    });
    expect(screen.getByText(/Sentry Web API integration is not configured/i)).toBeInTheDocument();

    // No fabricated incident data ever reaches the screen.
    expect(screen.queryByText(/PostgresError/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/column p\.display_name/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cannot read properties of undefined/i)).not.toBeInTheDocument();
  });

  it("does not render the banner when Sentry is configured and returns real issues", async () => {
    fetchErrorsMock.mockResolvedValue({
      success: true,
      configured: true,
      data: [
        {
          id: "1",
          title: "Real issue from Sentry",
          culprit: "src/real.ts",
          count: 2,
          userCount: 1,
          lastSeen: "2026-08-01T00:00:00Z",
          status: "unresolved",
          permalink: "https://sentry.io/x",
          level: "error",
          project: "learnstation-backend",
        },
      ],
    });

    renderWithProviders(<AdminDashboard />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Diagnostics/i }));

    await waitFor(() => {
      expect(screen.getByText("Real issue from Sentry")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("sentry-not-configured")).not.toBeInTheDocument();
  });
});

describe("AdminDashboard — System Health KPI (R5 regression)", () => {
  it("derives the System Health tile from real deployment telemetry instead of a hardcoded literal", async () => {
    fetchErrorsMock.mockResolvedValue({ success: true, configured: false, config_help: { message: "x", org: null, project: null, has_token: false }, data: [] });

    renderWithProviders(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("System Health")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("Online")).toBeInTheDocument();
    });
  });

  it("shows Degraded when the real health check reports a problem", async () => {
    fetchErrorsMock.mockResolvedValue({ success: true, configured: false, config_help: { message: "x", org: null, project: null, has_token: false }, data: [] });
    fetchDeploymentInfoMock.mockResolvedValue({
      health: {
        database: "unhealthy",
        database_connections: 0,
        ai_services: "not_configured",
        sentry: "disabled",
        sentry_dsn: "",
        api: "degraded",
      },
      system: { os: "Linux", release: "test", python_version: "3.11.0" },
      deployments: { migrations_count: 42, app_version: "3.0.0" },
      environment: {},
    });

    renderWithProviders(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Degraded")).toBeInTheDocument();
    });
  });
});

// R14: loadStats() swallowed errors to console.error only, so a failed fetch
// left `stats` null forever and the KPI strip pulsed its skeleton forever
// with no message and no way to retry.
describe("AdminDashboard — Platform stats load failure (R14 regression)", () => {
  it("shows the KPI error state with retry instead of pulsing skeletons forever", async () => {
    fetchPlatformStatsMock.mockRejectedValue(new Error("network down"));
    renderWithProviders(<AdminDashboard />);

    expect(await screen.findByTestId("admin-kpi-error")).toBeInTheDocument();
  });

  it("retries loading stats when the KPI retry button is clicked", async () => {
    const user = userEvent.setup();
    fetchPlatformStatsMock.mockRejectedValueOnce(new Error("network down"));
    fetchPlatformStatsMock.mockResolvedValueOnce({
      users: { total: 10, professors: 2, admins: 1, students: 7, active_24h: 3 },
      content: { courses: 4, lectures: 20 },
      financial: { month_llm_cost_usd: 1.23 },
    });
    renderWithProviders(<AdminDashboard />);

    await screen.findByTestId("admin-kpi-error");
    await user.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => {
      expect(screen.getByText("Total Users")).toBeInTheDocument();
    });
  });
});

// R20: both Content Control reads destructured only `.data` and dropped
// `.error` — an RLS rejection resolved to `[]` and rendered as "No content
// matches your filters" instead of a surfaced failure.
describe("AdminDashboard — Content Control read failure (R20 regression)", () => {
  it("routes a courses-read error into the existing toast handler", async () => {
    const user = userEvent.setup();
    const originalFrom = supabaseMock.from.bind(supabaseMock);
    const fromSpy = vi.spyOn(supabaseMock, "from").mockImplementation((table: string) => {
      if (table === "courses") {
        return { select: () => Promise.resolve({ data: null, error: { message: "RLS violation" } }) } as any;
      }
      return originalFrom(table);
    });

    try {
      renderWithProviders(<AdminDashboard />);
      await user.click(screen.getByRole("button", { name: /Content Control/i }));

      await waitFor(() => {
        expect(toastMock).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Error loading dashboard data" }),
        );
      });
    } finally {
      fromSpy.mockRestore();
    }
  });
});

// R26: the User Directory <tbody> had no empty state at all — a search with
// zero hits rendered a bare header with nothing under it, unlike the
// adjacent Event Stream table.
describe("AdminDashboard — User Directory empty state (R26 regression)", () => {
  it("shows a matching empty-state row when zero users match", async () => {
    fetchUsersMock.mockResolvedValue({ success: true, data: [], meta: { total: 0, page: 1, limit: 20, total_pages: 1 } });
    renderWithProviders(<AdminDashboard />);

    expect(await screen.findByText(/no users found/i)).toBeInTheDocument();
  });
});

// R27: `loading` was set by loadTabData but no tab body ever consulted it —
// it was wired only to the Refresh button's spinner — so first paint and
// every tab switch showed the tab's empty state until the request landed.
describe("AdminDashboard — tab loading gate (R27 regression)", () => {
  it("shows a loading skeleton instead of the empty state while the request is in flight", async () => {
    let resolveUsers!: (v: unknown) => void;
    let resolveEvents!: (v: unknown) => void;
    fetchUsersMock.mockReturnValue(new Promise((resolve) => { resolveUsers = resolve; }));
    fetchEventsMock.mockReturnValue(new Promise((resolve) => { resolveEvents = resolve; }));

    renderWithProviders(<AdminDashboard />);

    expect(screen.getByTestId("admin-tab-loading")).toBeInTheDocument();
    expect(screen.queryByText(/no events found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no users found/i)).not.toBeInTheDocument();

    resolveUsers({ success: true, data: [], meta: { total: 0, page: 1, limit: 20, total_pages: 1 } });
    resolveEvents({ success: true, data: [], meta: { total: 0, page: 1, limit: 20, total_pages: 1 } });

    await waitFor(() => {
      expect(screen.queryByTestId("admin-tab-loading")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/no events found/i)).toBeInTheDocument();
    expect(screen.getByText(/no users found/i)).toBeInTheDocument();
  });
});
