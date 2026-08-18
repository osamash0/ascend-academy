/**
 * Regression coverage for Milestone-4 audit finding R3: the admin "Error
 * Volume (Last 7 Days)" chart was a hardcoded array (`[12, 19, 15, 25, 22,
 * 30, 28]`) rendered with hover tooltips as though it were real history.
 * There is no real historical error-volume data source in the backend, so
 * the fabricated chart was deleted outright (`ErrorTrendChart.tsx` removed)
 * and replaced with `ErrorSeverityBreakdown`, which only renders values
 * derived from the real `errors` prop.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorSeverityBreakdown } from "@/components/admin/ErrorSeverityBreakdown";

describe("ErrorSeverityBreakdown (R3 regression)", () => {
  it("never renders the old fabricated 7-day trend chart", () => {
    render(<ErrorSeverityBreakdown errors={[]} />);
    expect(screen.queryByText(/Error Volume \(Last 7 Days\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/30 errors/i)).not.toBeInTheDocument();
  });

  it("derives the severity breakdown from the real errors prop", () => {
    render(
      <ErrorSeverityBreakdown
        errors={[
          { count: 5, level: "fatal" },
          { count: 3, level: "error" },
          { count: 2, level: "warning" },
        ]}
      />,
    );
    expect(screen.getByText("Fatal (5)")).toBeInTheDocument();
    expect(screen.getByText("Error (3)")).toBeInTheDocument();
    expect(screen.getByText("Warning (2)")).toBeInTheDocument();
  });
});
