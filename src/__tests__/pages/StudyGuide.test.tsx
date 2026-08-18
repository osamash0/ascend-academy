import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";

const fetchStudyGuideMock = vi.fn();
vi.mock("@/services/coursesService", () => ({
  fetchStudyGuide: (...args: unknown[]) => fetchStudyGuideMock(...args),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ role: "student" }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

import StudyGuide from "@/pages/StudyGuide";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => {
  fetchStudyGuideMock.mockReset();
});

function renderAt(courseId = "course-1") {
  return renderWithProviders(
    <Routes>
      <Route path="/course/:courseId/study-guide" element={<StudyGuide />} />
    </Routes>,
    { initialEntries: [`/course/${courseId}/study-guide`] },
  );
}

// R48: the error state used to be a terminal dead end — no way to retry a
// transient failure (the likeliest real-world cause, e.g. a 500).
describe("StudyGuide page — R48 retry on error", () => {
  it("shows a Retry button in the error state that calls refetch", async () => {
    fetchStudyGuideMock.mockRejectedValue(new Error("boom"));

    renderAt();

    await screen.findByText(/couldn't load the study guide/i);
    const retryButton = screen.getByRole("button", { name: /retry/i });
    expect(retryButton).toBeInTheDocument();

    // Fix the mock so the retry succeeds, proving it re-triggers the query.
    fetchStudyGuideMock.mockResolvedValue({
      lectures: [],
      concepts: [],
      course_facts: { instructor: null, exam_dates: [], grading_scheme: null },
    });

    const user = userEvent.setup();
    await user.click(retryButton);

    await waitFor(() => {
      expect(fetchStudyGuideMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByText(/couldn't load the study guide/i)).not.toBeInTheDocument();
    });
  });

  it("does not show a retry button when the study guide loads successfully", async () => {
    fetchStudyGuideMock.mockResolvedValue({
      lectures: [],
      concepts: [],
      course_facts: { instructor: null, exam_dates: [], grading_scheme: null },
    });

    renderAt();

    await waitFor(() => {
      expect(fetchStudyGuideMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});
