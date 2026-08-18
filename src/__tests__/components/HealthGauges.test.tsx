/**
 * Regression coverage for Milestone-4 audit finding R4: the "Platform API"
 * tile used to show a permanently-green ping animation and a hardcoded
 * "99.99%" uptime figure regardless of any real telemetry. It now reflects
 * the real `health.api` status derived from the deployment-info health check.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HealthGauges } from "@/components/admin/HealthGauges";
import type { DeploymentTelemetry } from "@/services/adminService";

function makeInfo(api: string, database: string): DeploymentTelemetry {
  return {
    health: {
      database,
      database_connections: 5,
      ai_services: "connected",
      sentry: "disabled",
      sentry_dsn: "",
      api,
    },
    system: { os: "Linux", release: "test", python_version: "3.11.0" },
    deployments: { migrations_count: 1, app_version: "3.0.0" },
    environment: { DB_POOL_MAX: "20" },
  };
}

describe("HealthGauges — Platform API tile (R4 regression)", () => {
  it("never renders a fabricated 99.99% uptime figure", () => {
    render(<HealthGauges info={makeInfo("healthy", "healthy")} loading={false} />);
    expect(screen.queryByText("99.99%")).not.toBeInTheDocument();
    expect(screen.queryByText(/Uptime \(30 days\)/i)).not.toBeInTheDocument();
  });

  it("shows 'healthy' derived from the real health check when everything is up", () => {
    render(<HealthGauges info={makeInfo("healthy", "healthy")} loading={false} />);
    // Both the DB Connections tile and the Platform API tile read "healthy"
    // here (api is derived from the same db_ok check) — assert both landed.
    expect(screen.getAllByText("healthy").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Critical dependencies responding/i)).toBeInTheDocument();
  });

  it("shows 'degraded' when the real health check reports a critical dependency down", () => {
    render(<HealthGauges info={makeInfo("degraded", "unhealthy")} loading={false} />);
    expect(screen.getByText("degraded")).toBeInTheDocument();
    expect(screen.getByText(/dependency is unreachable/i)).toBeInTheDocument();
  });
});
