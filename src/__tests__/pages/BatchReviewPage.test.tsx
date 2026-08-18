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
    status: "completed",
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

// M14: the header count and the rendered card count must come from the same
// source and therefore can never drift apart, even when some members of the
// batch are still in flight.
describe("BatchReviewPage — M14 header/rendered count consistency", () => {
  it("the header count always equals the number of rendered cards", async () => {
    const mixedRows = [
      { ...rows[0], run_id: "run-1", title: "Lecture One" },
      { ...rows[0], run_id: "run-2", title: "Lecture Two", status: "extracting", lecture_id: null },
      { ...rows[0], run_id: "run-3", title: "Lecture Three", status: "failed", error: "boom" },
    ];
    fetchBatchSummaryMock.mockResolvedValue(mixedRows);

    renderAtBatch("batch-3");

    await screen.findByText("Lecture One");
    await waitFor(() => {
      expect(screen.getByText("3 lectures ready")).toBeInTheDocument();
    });
    // Every one of the 3 members renders a card — none silently dropped.
    expect(screen.getByText("Lecture One")).toBeInTheDocument();
    expect(screen.getByText("Lecture Two")).toBeInTheDocument();
    expect(screen.getByText("Lecture Three")).toBeInTheDocument();
  });
});

// M15: in-flight/stuck batch members must render with an explicit state
// indicator instead of being silently omitted or looking like an empty
// finished lecture (0 slides / 0 quiz questions / blank summary).
describe("BatchReviewPage — M15 in-progress/stuck member visibility", () => {
  it("renders a 'still processing' indicator for a non-terminal, non-failed member", async () => {
    fetchBatchSummaryMock.mockResolvedValue([
      { ...rows[0], run_id: "run-2", title: "Stuck Lecture", status: "extracting", lecture_id: null, slide_count: 0, quiz_count: 0, deck_summary: null },
    ]);

    renderAtBatch("batch-4");

    await screen.findByText("Stuck Lecture");
    expect(screen.getByTestId("in-progress-label")).toHaveTextContent("extracting");
    // No editor/review actions on a card that isn't actually done yet.
    expect(screen.queryByTestId("done-reviewing")).not.toBeInTheDocument();
  });

  it("still shows a failed member with its error, distinct from in-progress", async () => {
    fetchBatchSummaryMock.mockResolvedValue([
      { ...rows[0], run_id: "run-2", title: "Broken Lecture", status: "failed", error: "Parsing failed: corrupt PDF" },
    ]);

    renderAtBatch("batch-5");

    await screen.findByText("Broken Lecture");
    expect(screen.getByText("Parsing failed: corrupt PDF")).toBeInTheDocument();
    expect(screen.queryByTestId("in-progress-label")).not.toBeInTheDocument();
  });
});

// M51: duplicate titles within the same batch must be disambiguated so
// review cards aren't indistinguishable from one another.
describe("BatchReviewPage — M51 duplicate-title disambiguation", () => {
  it("appends the source filename when two members share a title", async () => {
    fetchBatchSummaryMock.mockResolvedValue([
      { ...rows[0], run_id: "run-1", title: "Advanced Topics in Cryptography", filename: "week1.pdf", slide_count: 44 },
      { ...rows[0], run_id: "run-2", title: "Advanced Topics in Cryptography", filename: "week2.pdf", slide_count: 79 },
    ]);

    renderAtBatch("batch-6");

    await waitFor(() => {
      expect(screen.getByText("Advanced Topics in Cryptography (week1.pdf)")).toBeInTheDocument();
      expect(screen.getByText("Advanced Topics in Cryptography (week2.pdf)")).toBeInTheDocument();
    });
  });

  it("does not alter a title that is unique within the batch", async () => {
    fetchBatchSummaryMock.mockResolvedValue([
      { ...rows[0], run_id: "run-1", title: "Unique Lecture", filename: "week1.pdf" },
      { ...rows[0], run_id: "run-2", title: "Another Unique Lecture", filename: "week2.pdf" },
    ]);

    renderAtBatch("batch-7");

    await waitFor(() => {
      expect(screen.getByText("Unique Lecture")).toBeInTheDocument();
      expect(screen.getByText("Another Unique Lecture")).toBeInTheDocument();
    });
  });
});
