import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";

const useExamAttemptMock = vi.fn();
const useSaveExamAnswerMock = vi.fn();
const useSubmitExamMock = vi.fn();
const useGenerateExamMock = vi.fn();
vi.mock("@/features/student/hooks/useExamMode", () => ({
  useExamAttempt: (...args: unknown[]) => useExamAttemptMock(...args),
  useSaveExamAnswer: (...args: unknown[]) => useSaveExamAnswerMock(...args),
  useSubmitExam: (...args: unknown[]) => useSubmitExamMock(...args),
  useGenerateExam: (...args: unknown[]) => useGenerateExamMock(...args),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "student-1" } }),
}));

vi.mock("@/components/console", () => ({
  DepthScene: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

vi.mock("@/services/onboardingService", () => ({
  recordOnboardingActivation: vi.fn(),
  recordOnboardingEvent: vi.fn(),
}));

import { MockExamTake } from "@/pages/MockExam";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => {
  useExamAttemptMock.mockReset();
  useSaveExamAnswerMock.mockReset();
  useSubmitExamMock.mockReset();
  useSaveExamAnswerMock.mockReturnValue({ mutate: vi.fn() });
  useSubmitExamMock.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
});

// R38: navigate() used to be called directly in the render body when the
// attempt was already submitted — a side-effect-during-render anti-pattern
// that trips React's "Cannot update a component while rendering a different
// component" warning. The fix renders <Navigate replace /> instead.
describe("MockExamTake — R38 already-submitted redirect", () => {
  it("redirects to the report page without calling setState/navigate during render", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    useExamAttemptMock.mockReturnValue({
      isLoading: false,
      data: {
        exam_id: "exam-1",
        course_id: "course-1",
        started_at: new Date().toISOString(),
        submitted_at: new Date().toISOString(), // already submitted
        time_limit_s: 1800,
        answers: {},
        questions: [{ id: "q1", slide_id: "s1", question_text: "Q?", options: ["A", "B"] }],
      },
    });

    renderWithProviders(
      <Routes>
        <Route path="/exam/take/:examId" element={<MockExamTake />} />
        <Route path="/exam/report/:examId" element={<div>Report Page</div>} />
      </Routes>,
      { initialEntries: ["/exam/take/exam-1"] },
    );

    expect(await screen.findByText("Report Page")).toBeInTheDocument();

    // The specific React warning this bug produces must never fire.
    const sawRenderWarning = consoleError.mock.calls.some((call) =>
      String(call[0]).includes("Cannot update a component"),
    );
    expect(sawRenderWarning).toBe(false);

    consoleError.mockRestore();
  });

  it("renders the exam runner (not a redirect) when the attempt is not yet submitted", () => {
    useExamAttemptMock.mockReturnValue({
      isLoading: false,
      data: {
        exam_id: "exam-1",
        course_id: "course-1",
        started_at: new Date().toISOString(),
        submitted_at: null,
        time_limit_s: 1800,
        answers: {},
        questions: [{ id: "q1", slide_id: "s1", question_text: "Q?", options: ["A", "B"] }],
      },
    });

    renderWithProviders(
      <Routes>
        <Route path="/exam/take/:examId" element={<MockExamTake />} />
        <Route path="/exam/report/:examId" element={<div>Report Page</div>} />
      </Routes>,
      { initialEntries: ["/exam/take/exam-1"] },
    );

    expect(screen.queryByText("Report Page")).not.toBeInTheDocument();
  });
});
