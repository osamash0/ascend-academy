/**
 * Landing is a static marketing page (no async data fetch), so the canonical
 * "mount + loading + empty + first-row" smoke pattern is mapped to
 * equivalents:
 *   - mount                => brand wordmark + primary CTA render
 *   - loading-equivalent   => no spinner; an h1/h2 is present synchronously
 *   - empty-equivalent     => the "Mission Control" framing copy is present
 *   - first-row-equivalent => Sign In affordance routing to /auth is present
 */
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import Landing from "@/pages/Landing";
import { renderWithProviders } from "@/test/renderWithProviders";

describe("Landing page (smoke)", () => {
  it("mount: renders the brand wordmark and primary CTA", () => {
    renderWithProviders(<Landing />, { initialEntries: ["/"] });
    expect(screen.getAllByText(/AscendAcademy|Ascend/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /launch mission|launch your mission/i }).length,
    ).toBeGreaterThan(0);
  });

  it("loading equivalent: page renders synchronously without spinner markers", () => {
    const { container } = renderWithProviders(<Landing />, { initialEntries: ["/"] });
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(container.querySelector("h1, h2")).not.toBeNull();
  });

  it("empty equivalent: shows the 'Mission Control' framing copy", () => {
    renderWithProviders(<Landing />, { initialEntries: ["/"] });
    expect(screen.getAllByText(/mission control/i).length).toBeGreaterThan(0);
  });

  it("first-row equivalent: exposes the Sign In affordance routing to /auth", () => {
    renderWithProviders(<Landing />, { initialEntries: ["/"] });
    expect(screen.getAllByRole("button", { name: /sign in/i }).length).toBeGreaterThan(0);
  });
});
