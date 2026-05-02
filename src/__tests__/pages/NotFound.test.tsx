import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import NotFound from "@/pages/NotFound";
import { renderWithProviders } from "@/test/renderWithProviders";

describe("NotFound page (smoke)", () => {
  it("renders 404 + 'Return to Home' link", () => {
    renderWithProviders(<NotFound />, { initialEntries: ["/missing"] });
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("href", "/");
  });

  it("uses muted background", () => {
    const { container } = renderWithProviders(<NotFound />);
    expect(container.querySelector(".bg-muted")).not.toBeNull();
  });
});
