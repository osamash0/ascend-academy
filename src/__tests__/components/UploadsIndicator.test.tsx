import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "u@u.com" }, role: "professor" }),
}));

const apiGetMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  apiClient: { get: (...args: unknown[]) => apiGetMock(...args) },
}));

vi.mock("@/components/ui/sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { UploadsIndicator } from "@/components/UploadsIndicator";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => {
  apiGetMock.mockReset();
});

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// R53: `GET /api/upload/jobs` already returns started_at/finished_at, but
// nothing in the uploads panel ever rendered them — a job stuck for hours
// looked identical to one that had just started. The panel now surfaces job
// age for in-flight jobs so a stuck job is visually obvious.
describe("UploadsIndicator — R53 job age surfacing", () => {
  it("shows elapsed time for an in-flight job", async () => {
    apiGetMock.mockResolvedValue({
      jobs: [
        {
          run_id: "run-1",
          batch_id: null,
          filename: "09-pq.pdf",
          pdf_hash: "hash1",
          status: "extracting",
          lecture_id: null,
          course_id: null,
          error: null,
          started_at: minutesAgoIso(47),
          finished_at: null,
        },
      ],
    });

    renderWithProviders(<UploadsIndicator />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("uploads-indicator"));

    await waitFor(() => {
      expect(screen.getByText(/extracting for 47 minutes/)).toBeInTheDocument();
    });
  });

  it("does not show an age for a job with no started_at", async () => {
    apiGetMock.mockResolvedValue({
      jobs: [
        {
          run_id: "run-2",
          batch_id: null,
          filename: "clean.pdf",
          pdf_hash: "hash2",
          status: "queued",
          lecture_id: null,
          course_id: null,
          error: null,
          started_at: null,
          finished_at: null,
        },
      ],
    });

    renderWithProviders(<UploadsIndicator />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("uploads-indicator"));

    await waitFor(() => {
      expect(screen.getByTestId("job-status-line")).toHaveTextContent("queued");
    });
    expect(screen.queryByText(/for.*minute/)).not.toBeInTheDocument();
  });

  it("does not show an age for a completed job (age is only meaningful in flight)", async () => {
    apiGetMock.mockResolvedValue({
      jobs: [
        {
          run_id: "run-3",
          batch_id: null,
          filename: "done.pdf",
          pdf_hash: "hash3",
          status: "completed",
          lecture_id: "lec-1",
          course_id: null,
          error: null,
          started_at: minutesAgoIso(120),
          finished_at: new Date().toISOString(),
        },
      ],
    });

    renderWithProviders(<UploadsIndicator />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("uploads-indicator"));

    await waitFor(() => {
      expect(screen.getByTestId("job-status-line")).toHaveTextContent("completed");
    });
    expect(screen.queryByText(/for.*minute/)).not.toBeInTheDocument();
  });
});
