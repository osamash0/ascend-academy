/**
 * Tests for QuizCard's new concept-testing affordances:
 *  - "Concept · ..." badge appears when a concept prop is passed.
 *  - Linked-slide chips render and call onJumpToSlide with the right number.
 *  - The explanation toggle reveals the explanation text only after answer.
 *
 * The base interaction (selecting an answer, scoring callback) is exercised
 * indirectly via the LectureView smoke tests — this file focuses on the new
 * UI surfaces added for cross-slide quizzes.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

vi.mock("@/hooks/useTTS", () => ({
  useTTS: () => ({
    speak: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    isSpeaking: false,
    isPaused: false,
    isLoading: false,
  }),
}));

import { QuizCard } from "@/components/QuizCard";
import { renderWithProviders } from "@/test/renderWithProviders";

const baseProps = {
  question: "Which combination explains TCP's reliability over IP?",
  options: [
    "Sequence numbers + ACKs + retransmission",
    "UDP datagrams",
    "Static ARP entries",
    "DHCP lease renewal",
  ],
  correctAnswer: 0,
  onAnswer: () => {},
  questionNumber: 1,
  totalQuestions: 5,
};

describe("QuizCard concept-testing UI", () => {
  it("renders neither a concept badge nor linked-slide chips when those props are omitted", () => {
    renderWithProviders(<QuizCard {...baseProps} />);
    expect(screen.queryByTestId("quiz-concept-badge")).toBeNull();
    expect(screen.queryByTestId("quiz-linked-slides")).toBeNull();
  });

  it("renders the concept badge with the provided text", () => {
    renderWithProviders(<QuizCard {...baseProps} concept="TCP reliability" />);
    expect(screen.getByTestId("quiz-concept-badge").textContent).toContain(
      "TCP reliability",
    );
  });

  it("renders one chip per linked slide and invokes onJumpToSlide with the displayed number", () => {
    const onJumpToSlide = vi.fn();
    renderWithProviders(
      <QuizCard
        {...baseProps}
        linkedSlides={[2, 5]}
        onJumpToSlide={onJumpToSlide}
      />,
    );
    const chips = screen.getAllByRole("button", { name: /jump to slide/i });
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toContain("Slide 2");
    expect(chips[1].textContent).toContain("Slide 5");
    fireEvent.click(chips[1]);
    expect(onJumpToSlide).toHaveBeenCalledWith(5);
  });

  it("disables the chips when no onJumpToSlide handler is supplied", () => {
    renderWithProviders(<QuizCard {...baseProps} linkedSlides={[1]} />);
    const chip = screen.getByRole("button", { name: /jump to slide 1/i });
    expect((chip as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides the explanation toggle until an option is selected", async () => {
    renderWithProviders(
      <QuizCard
        {...baseProps}
        explanation="TCP layers reliability mechanisms over IP's best-effort delivery."
      />,
    );
    expect(screen.queryByText(/show explanation/i)).toBeNull();
    // Pick an option — the result panel + explanation toggle should appear.
    fireEvent.click(
      screen.getByRole("radio", {
        name: /option a:/i,
      }),
    );
    const toggle = await screen.findByText(/show explanation/i);
    fireEvent.click(toggle);
    expect(
      screen.getByText(/TCP layers reliability mechanisms/i),
    ).toBeInTheDocument();
  });
});
