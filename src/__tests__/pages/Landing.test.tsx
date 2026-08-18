/**
 * Landing is a static marketing page (no async data fetch), so the canonical
 * "mount + loading + empty + first-row" smoke pattern is mapped to
 * equivalents:
 *   - mount                => brand wordmark + primary CTA render
 *   - loading-equivalent   => no spinner; an h1/h2 is present synchronously
 *   - empty-equivalent     => the "Master Your Studies" hero headline is present
 *   - first-row-equivalent => Sign In affordance routing to /auth is present
 */
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import Landing from "@/pages/Landing";
import { renderWithProviders } from "@/test/renderWithProviders";

describe("Landing page (smoke)", () => {
  it("mount: renders the brand wordmark and primary CTA", () => {
    renderWithProviders(<Landing />, { initialEntries: ["/"] });
    expect(screen.getAllByText(/Learnstation/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /get started/i }).length,
    ).toBeGreaterThan(0);
  });

  it("loading equivalent: page renders synchronously without spinner markers", () => {
    const { container } = renderWithProviders(<Landing />, { initialEntries: ["/"] });
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(container.querySelector("h1, h2")).not.toBeNull();
  });

  it("empty equivalent: shows the 'Master Your Studies' hero headline", () => {
    renderWithProviders(<Landing />, { initialEntries: ["/"] });
    expect(screen.getAllByText(/master your/i).length).toBeGreaterThan(0);
  });

  it("first-row equivalent: exposes the Sign In affordance routing to /auth", () => {
    renderWithProviders(<Landing />, { initialEntries: ["/"] });
    expect(screen.getAllByRole("button", { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  // M27/M3: the footer used to have 13 dead `href="#"` links, including the
  // one labelled "Privacy" — leaving the privacy policy and imprint pages
  // unreachable from the footer. Privacy now points at /datenschutz, and a
  // real Imprint link was added; every other link that pointed at a page
  // that doesn't exist in this app (Enterprise, Careers, Blog, API
  // Reference, Community, About, Contact, Security, Twitter, GitHub) was
  // removed rather than left dangling.
  it("wires the footer's legal links and removes the rest of the dead ones", () => {
    const { container } = renderWithProviders(<Landing />, { initialEntries: ["/"] });
    const footer = container.querySelector("footer");
    expect(footer).not.toBeNull();

    const links = Array.from(footer!.querySelectorAll("a"));
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((a) => a.getAttribute("href") !== "#")).toBe(true);

    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/datenschutz");
    expect(hrefs).toContain("/impressum");
  });
});
