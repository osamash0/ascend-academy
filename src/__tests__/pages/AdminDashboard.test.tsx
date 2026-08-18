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

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

const { fetchErrorsMock, fetchDeploymentInfoMock } = vi.hoisted(() => ({
  fetchErrorsMock: vi.fn(),
  fetchDeploymentInfoMock: vi.fn(),
}));

vi.mock("@/services/adminService", async () => {
  const actual = await vi.importActual<typeof import("@/services/adminService")>(
    "@/services/adminService",
  );
  return {
    ...actual,
    adminService: {
      ...actual.adminService,
      fetchPlatformStats: vi.fn().mockResolvedValue({
        users: { total: 10, professors: 2, admins: 1, students: 7, active_24h: 3 },
        content: { courses: 4, lectures: 20 },
        financial: { month_llm_cost_usd: 1.23 },
      }),
      fetchUsers: vi.fn().mockResolvedValue({ success: true, data: [], meta: { total: 0, page: 1, limit: 20, total_pages: 1 } }),
      fetchEvents: vi.fn().mockResolvedValue({ success: true, data: [], meta: { total: 0, page: 1, limit: 20, total_pages: 1 } }),
      fetchBackups: vi.fn().mockResolvedValue([]),
      fetchErrors: fetchErrorsMock,
      fetchDeploymentInfo: fetchDeploymentInfoMock,
    },
  };
});

import AdminDashboard from "@/pages/AdminDashboard";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => {
  supabaseMock.reset();
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
