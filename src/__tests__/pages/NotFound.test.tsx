import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import NotFound from "@/pages/NotFound";
import { renderWithProviders } from "@/test/renderWithProviders";

describe("NotFound page (smoke)", () => {
  it("renders the 404 card + a way home", () => {
    renderWithProviders(<NotFound />, { initialEntries: ["/missing"] });
    // Both faces of the card carry the code.
    expect(screen.getAllByText("404")).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("href", "/");
  });

  it("stands on the stage's black", () => {
    const { container } = renderWithProviders(<NotFound />);
    expect(container.querySelector('[class*="bg-black"]')).not.toBeNull();
  });

  it("turns the card when pressed", () => {
    renderWithProviders(<NotFound />);
    const card = screen.getByRole("button", { pressed: false });
    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "true");
  });
});
