import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";

const useExamAttemptMock = vi.fn();
const useSendMissesToReviewMock = vi.fn();
vi.mock("@/features/student/hooks/useExamMode", () => ({
  useExamAttempt: (...args: unknown[]) => useExamAttemptMock(...args),
  useSendMissesToReview: (...args: unknown[]) => useSendMissesToReviewMock(...args),
}));

vi.mock("@/components/console", () => ({
  DepthScene: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

import { MockExamReport } from "@/pages/MockExamReport";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => {
  useExamAttemptMock.mockReset();
  useSendMissesToReviewMock.mockReset();
  useSendMissesToReviewMock.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
});

function renderReport() {
  return renderWithProviders(
    <Routes>
      <Route path="/exam/report/:examId" element={<MockExamReport />} />
    </Routes>,
    { initialEntries: ["/exam/report/exam-1"] },
  );
}

describe("MockExamReport page — R34 miss_rate rounding", () => {
  it("rounds a floating-point miss_rate to a whole percentage in the label and width style", () => {
    // Computed (not a literal) so the genuine IEEE-754 rounding noise
    // (0.29000000000000004) survives eslint's no-loss-of-precision rule —
    // `* 100` without rounding would render "29.000000000000004%", the
    // exact repro from R34.
    const noisyMissRate = 1 - 0.71;
    useExamAttemptMock.mockReturnValue({
      isLoading: false,
      data: {
        course_id: "course-1",
        report: {
          score: 71,
          correct_count: 5,
          total: 7,
          weakest_concepts: [
            {
              concept: "Normalization",
              miss_rate: noisyMissRate,
              total: 4,
              correct: 1,
            },
          ],
          missed_question_ids: ["q1"],
        },
      },
    });

    const { container } = renderReport();

    // The raw unrounded float must never reach the DOM.
    expect(screen.queryByText(/29\.000000000000004/)).not.toBeInTheDocument();
    expect(screen.getByText(/^29% miss rate$/)).toBeInTheDocument();

    const bar = container.querySelector(".bg-warning.h-full.rounded-full") as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.width).toBe("29%");
  });

  it("rounds a clean miss_rate without introducing decimals", () => {
    useExamAttemptMock.mockReturnValue({
      isLoading: false,
      data: {
        course_id: "course-1",
        report: {
          score: 90,
          correct_count: 9,
          total: 10,
          weakest_concepts: [
            { concept: "Indexing", miss_rate: 0.5, total: 2, correct: 1 },
          ],
          missed_question_ids: [],
        },
      },
    });

    renderReport();

    expect(screen.getByText(/^50% miss rate$/)).toBeInTheDocument();
  });
});
