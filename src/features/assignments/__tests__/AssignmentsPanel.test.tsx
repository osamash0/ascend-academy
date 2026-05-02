/**
 * Smoke tests for the student-facing AssignmentsPanel.
 *
 * We mock the assignments + dashboard services directly (rather than going
 * through the apiClient layer) so the test focuses on rendering / status
 * pill mapping rather than HTTP plumbing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { AssignmentsPanel } from "@/features/assignments/AssignmentsPanel";
import type { Assignment } from "@/services/assignmentsService";

vi.mock("@/services/assignmentsService", () => ({
  listAssignments: vi.fn(),
}));

vi.mock("@/services/studentService", () => ({
  fetchStudentDashboard: vi.fn(),
}));

import { listAssignments } from "@/services/assignmentsService";
import { fetchStudentDashboard } from "@/services/studentService";

const mockListAssignments = vi.mocked(listAssignments);
const mockFetchDashboard = vi.mocked(fetchStudentDashboard);

function makeAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: "a1",
    professor_id: "prof1",
    course_id: null,
    title: "Week 1",
    description: "Catch up on lecture 1",
    due_at: "2099-01-01T00:00:00Z",
    min_quiz_score: null,
    created_at: null,
    lecture_ids: ["L1", "L2"],
    status: "in_progress",
    completed_count: 1,
    total_count: 2,
    progress_percentage: 50,
    ...overrides,
  };
}

beforeEach(() => {
  mockFetchDashboard.mockResolvedValue({
    progress: [],
    achievements: [],
    profile: null,
  } as unknown as Awaited<ReturnType<typeof fetchStudentDashboard>>);
});

describe("AssignmentsPanel", () => {
  it("renders nothing when the student has no assignments", async () => {
    mockListAssignments.mockResolvedValue([]);
    const { container } = renderWithProviders(
      <AssignmentsPanel userId="u1" />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("assignments-panel-loading")).toBeNull();
    });
    expect(container.querySelector('[data-testid="assignments-panel"]')).toBeNull();
  });

  it("renders the assignment with its status pill", async () => {
    mockListAssignments.mockResolvedValue([
      makeAssignment({ status: "overdue", title: "Late one" }),
    ]);
    renderWithProviders(<AssignmentsPanel userId="u1" />);

    await waitFor(() => {
      expect(screen.getByText("Late one")).toBeInTheDocument();
    });
    expect(screen.getByTestId("assignment-status-a1")).toHaveTextContent(/overdue/i);
  });

  it("shows completed count and lecture totals", async () => {
    mockListAssignments.mockResolvedValue([
      makeAssignment({
        completed_count: 2,
        total_count: 3,
        progress_percentage: 66,
      }),
    ]);
    renderWithProviders(<AssignmentsPanel userId="u1" />);
    await waitFor(() => {
      expect(screen.getByText(/2 \/ 3 lectures/i)).toBeInTheDocument();
    });
  });
});
