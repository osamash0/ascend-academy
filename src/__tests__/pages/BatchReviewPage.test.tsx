import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";

const fetchBatchSummaryMock = vi.fn();
vi.mock("@/services/uploadBatchService", () => ({
  fetchBatchSummary: (...args: unknown[]) => fetchBatchSummaryMock(...args),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import BatchReviewPage from "@/pages/BatchReviewPage";
import { renderWithProviders } from "@/test/renderWithProviders";

const rows = [
  {
    run_id: "run-1",
    status: "complete",
    error: null,
    filename: "lecture-1.pdf",
    lecture_id: "lec-1",
    title: "Intro to Testing",
    deck_summary: "Summary",
    slide_count: 10,
    quiz_count: 3,
    flagged_count: 0,
  },
];

function renderAtBatch(batchId = "batch-1") {
  return renderWithProviders(
    <Routes>
      <Route path="/professor/upload/batch/:batchId/review" element={<BatchReviewPage />} />
    </Routes>,
    { initialEntries: [`/professor/upload/batch/${batchId}/review`] },
  );
}

beforeEach(() => {
  fetchBatchSummaryMock.mockReset();
  fetchBatchSummaryMock.mockResolvedValue(rows);
  localStorage.clear();
});

// R44: "Done reviewing" used to mutate only an in-memory Set, so a page
// refresh reset every card back to unreviewed. Now persisted to
// localStorage keyed by batch id.
describe("BatchReviewPage — R44 reviewed-state persistence", () => {
  it("persists a reviewed card to localStorage and restores it across a remount (simulated refresh)", async () => {
    const { unmount } = renderAtBatch("batch-1");

    await screen.findByText("Intro to Testing");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("done-reviewing"));

    await waitFor(() => {
      const raw = localStorage.getItem("ascend_batch_reviewed_batch-1");
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual(["run-1"]);
    });

    // Simulate a page refresh: unmount and mount a fresh instance.
    unmount();
    renderAtBatch("batch-1");

    await screen.findByText("Intro to Testing");
    // The row should immediately render as already-reviewed (no
    // "Done reviewing" button left for it) and the completed checkmark shown.
    await waitFor(() => {
      expect(screen.queryByTestId("done-reviewing")).not.toBeInTheDocument();
    });
  });

  it("scopes persisted state to the batch id — a different batch starts fresh", async () => {
    localStorage.setItem("ascend_batch_reviewed_batch-1", JSON.stringify(["run-1"]));

    renderAtBatch("batch-2");

    await screen.findByText("Intro to Testing");
    // batch-2 has no stored state, so the row should still show its
    // "Done reviewing" action.
    expect(screen.getByTestId("done-reviewing")).toBeInTheDocument();
  });
});
