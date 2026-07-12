/**
 * Roadmap Phase 5.2 ("regenerate with feedback"): the professor-only
 * regenerate-content panel on SlideViewer — instruction input, submit, and
 * the single-level undo affordance.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SlideViewer } from "@/components/SlideViewer";

function renderViewer(props: Partial<React.ComponentProps<typeof SlideViewer>> = {}) {
  return render(
    <SlideViewer
      title="Intro to Gradients"
      content="Some content"
      summary="A summary of the slide."
      slideNumber={1}
      totalSlides={3}
      onPrevious={() => {}}
      onNext={() => {}}
      isFirst
      isLast={false}
      {...props}
    />,
  );
}

describe("SlideViewer — regenerate with feedback (Roadmap 5.2)", () => {
  it("hides the regenerate toggle for students", () => {
    renderViewer({ isProfessor: false, onRegenerateContent: vi.fn() });
    expect(screen.queryByTestId("regenerate-content-toggle")).not.toBeInTheDocument();
  });

  it("hides the regenerate toggle when no handler is supplied, even for professors", () => {
    renderViewer({ isProfessor: true, onRegenerateContent: undefined });
    expect(screen.queryByTestId("regenerate-content-toggle")).not.toBeInTheDocument();
  });

  it("opens the panel and submits an instruction", async () => {
    const onRegenerateContent = vi.fn();
    renderViewer({ isProfessor: true, onRegenerateContent });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("regenerate-content-toggle"));

    const input = screen.getByTestId("regenerate-instruction-input");
    await user.type(input, "Focus on the proof steps.");
    await user.click(screen.getByTestId("regenerate-content-submit"));

    expect(onRegenerateContent).toHaveBeenCalledWith("Focus on the proof steps.");
  });

  it("submits undefined when the instruction is left blank", async () => {
    const onRegenerateContent = vi.fn();
    renderViewer({ isProfessor: true, onRegenerateContent });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("regenerate-content-toggle"));
    await user.click(screen.getByTestId("regenerate-content-submit"));

    expect(onRegenerateContent).toHaveBeenCalledWith(undefined);
  });

  it("prefills the instruction input from a persisted regenInstruction", async () => {
    renderViewer({
      isProfessor: true,
      onRegenerateContent: vi.fn(),
      regenInstruction: "Keep it concise.",
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("regenerate-content-toggle"));

    expect(screen.getByTestId("regenerate-instruction-input")).toHaveValue("Keep it concise.");
  });

  it("shows the undo affordance only when canUndoRegenerate is true", async () => {
    const onUndoRegenerate = vi.fn();
    renderViewer({
      isProfessor: true,
      onRegenerateContent: vi.fn(),
      canUndoRegenerate: true,
      onUndoRegenerate,
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("regenerate-content-toggle"));

    const undoButton = screen.getByTestId("regenerate-undo");
    await user.click(undoButton);
    expect(onUndoRegenerate).toHaveBeenCalledTimes(1);
  });

  it("hides the undo affordance when canUndoRegenerate is false", async () => {
    renderViewer({
      isProfessor: true,
      onRegenerateContent: vi.fn(),
      canUndoRegenerate: false,
      onUndoRegenerate: vi.fn(),
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("regenerate-content-toggle"));

    expect(screen.queryByTestId("regenerate-undo")).not.toBeInTheDocument();
  });

  it("disables submit and undo while a regenerate is in flight", async () => {
    renderViewer({
      isProfessor: true,
      onRegenerateContent: vi.fn(),
      isRegeneratingContent: true,
      canUndoRegenerate: true,
      onUndoRegenerate: vi.fn(),
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("regenerate-content-toggle"));

    expect(screen.getByTestId("regenerate-content-submit")).toBeDisabled();
    expect(screen.getByTestId("regenerate-undo")).toBeDisabled();
  });
});
