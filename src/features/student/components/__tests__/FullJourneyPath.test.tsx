import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { FullJourneyPath } from "../FullJourneyPath";

vi.mock("@/lib/pixi", () => ({
  PixiStage: () => <div data-testid="pixi-stage-mock" />,
  readPixiPalette: () => ({
    primary: 0x000000,
    accent: 0x000000,
    background: 0x000000,
    foreground: 0x000000,
    muted: 0x000000,
  }),
}));

const mockNodes = [
  { id: '1', label: 'Intro', status: 'completed' as const },
  { id: '2', label: 'Basics', status: 'active' as const },
];

describe("FullJourneyPath", () => {
  it("renders a visually hidden list for accessibility", () => {
    renderWithProviders(<FullJourneyPath nodes={mockNodes} />);
    
    expect(screen.getByText("Intro (completed)")).toBeInTheDocument();
    expect(screen.getByText("Basics (active)")).toBeInTheDocument();
  });

  it("opens the drawer when a node is selected from the accessible list", () => {
    renderWithProviders(<FullJourneyPath nodes={mockNodes} />);
    
    // Drawer should not be open yet
    expect(screen.queryByText(/Welcome to the detailed view for/i)).toBeNull();

    // Click the visually hidden button for "Intro"
    fireEvent.click(screen.getByRole("button", { name: "Intro (completed)" }));

    // Drawer should open and display the details
    expect(screen.getAllByText("Intro").length).toBeGreaterThan(0);
    expect(screen.getByText("Status: completed")).toBeInTheDocument();
    expect(screen.getByText(/Welcome to the detailed view for/i)).toBeInTheDocument();
  });
});
