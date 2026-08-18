/**
 * Regression coverage for Milestone-4 audit finding R5: the fifth KPI tile
 * always read "System Health / Online / All systems operational" as a
 * literal, never derived from any real data. It now reads from the real
 * `/deployment-info` telemetry (`telemetry.health.api`) passed in as a prop.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminKPISummary } from "@/components/admin/AdminKPISummary";
import type { PlatformStats, DeploymentTelemetry } from "@/services/adminService";

const stats: PlatformStats = {
  users: { total: 10, professors: 2, admins: 1, students: 7, active_24h: 3 },
  content: { courses: 4, lectures: 20 },
  financial: { month_llm_cost_usd: 1.23 },
};

function makeTelemetry(api: string): DeploymentTelemetry {
  return {
    health: {
      database: api === "healthy" ? "healthy" : "unhealthy",
      database_connections: 3,
      ai_services: "connected",
      sentry: "disabled",
      sentry_dsn: "",
      api,
    },
    system: { os: "Linux", release: "test", python_version: "3.11.0" },
    deployments: { migrations_count: 1, app_version: "3.0.0" },
    environment: {},
  };
}

describe("AdminKPISummary — System Health tile (R5 regression)", () => {
  it('reads "Unknown" when telemetry has not loaded, never a hardcoded "Online"', () => {
    render(<AdminKPISummary stats={stats} telemetry={null} loading={false} />);
    expect(screen.getByText("System Health")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.queryByText("Online")).not.toBeInTheDocument();
  });

  it('reads "Online" when the real health check reports healthy', () => {
    render(<AdminKPISummary stats={stats} telemetry={makeTelemetry("healthy")} loading={false} />);
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getByText("All systems operational")).toBeInTheDocument();
  });

  it('reads "Degraded" when the real health check reports a problem', () => {
    render(<AdminKPISummary stats={stats} telemetry={makeTelemetry("degraded")} loading={false} />);
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.queryByText("Online")).not.toBeInTheDocument();
  });
});
