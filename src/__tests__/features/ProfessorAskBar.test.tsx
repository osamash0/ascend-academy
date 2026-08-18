import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfessorAskBar } from "@/features/analytics/components/ProfessorAskBar";
import type { ProfessorChat } from "@/features/analytics/components/useProfessorChat";

function makeChat(overrides: Partial<ProfessorChat> = {}): ProfessorChat {
  return {
    messages: [
      { id: "m1", role: "user", content: "What should I focus on?" },
      { id: "m2", role: "model", content: "Focus on slide 4 engagement." },
    ],
    input: "",
    setInput: vi.fn(),
    loading: false,
    suggestions: [],
    active: true,
    aiModel: "gemini",
    submit: vi.fn(),
    regenerate: vi.fn(),
    reset: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

// R42: thumbs up/down used to fire a toast thanking the user but recorded
// nothing (no API call, no state, no store) — theatre, not real feedback.
// No feedback-recording endpoint exists for chat messages, so they were
// removed rather than left as fake controls. Regenerate/Copy remain real.
describe("ProfessorAskBar — R42 fake feedback buttons removed", () => {
  it("does not render thumbs up/down controls on an assistant message", () => {
    render(<ProfessorAskBar chat={makeChat()} variant="panel" />);

    expect(screen.queryByRole("button", { name: /helpful/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /not helpful/i })).not.toBeInTheDocument();
  });

  it("still renders the real Regenerate and Copy controls", () => {
    render(<ProfessorAskBar chat={makeChat()} variant="panel" />);

    expect(screen.getByRole("button", { name: /regenerate/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
  });

  it("calls the real regenerate() handler, not a fake toast-only stub", async () => {
    const regenerate = vi.fn();
    render(<ProfessorAskBar chat={makeChat({ regenerate })} variant="panel" />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /regenerate/i }));

    expect(regenerate).toHaveBeenCalledTimes(1);
  });
});
