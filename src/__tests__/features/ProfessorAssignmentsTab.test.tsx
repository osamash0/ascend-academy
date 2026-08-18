/**
 * R13: a failed listAssignments() used to be swallowed into an empty array,
 * so the tab rendered the same "No assignments yet" copy as a professor who
 * genuinely has none — risking a professor creating a duplicate of an
 * assignment that actually already exists because they can't tell "none
 * exist" from "failed to load".
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";

const listAssignmentsMock = vi.fn();
const listEnrollableStudentsMock = vi.fn();
vi.mock("@/services/assignmentsService", async () => {
  const actual = await vi.importActual<typeof import("@/services/assignmentsService")>(
    "@/services/assignmentsService",
  );
  return {
    ...actual,
    listAssignments: (...args: unknown[]) => listAssignmentsMock(...args),
    listEnrollableStudents: (...args: unknown[]) => listEnrollableStudentsMock(...args),
  };
});

import { ProfessorAssignmentsTab } from "@/features/assignments/ProfessorAssignmentsTab";

beforeEach(() => {
  listAssignmentsMock.mockReset();
  listEnrollableStudentsMock.mockReset();
  listEnrollableStudentsMock.mockResolvedValue([]);
});

describe("ProfessorAssignmentsTab — load failure", () => {
  it("shows a distinct error state with retry instead of 'No assignments yet'", async () => {
    listAssignmentsMock.mockRejectedValue(new Error("network down"));
    renderWithProviders(<ProfessorAssignmentsTab lectures={[]} />);

    expect(await screen.findByTestId("assignments-error")).toBeInTheDocument();
    expect(screen.queryByText(/no assignments yet/i)).not.toBeInTheDocument();
  });

  it("retries and shows the real list when the retry button is clicked", async () => {
    const user = userEvent.setup();
    listAssignmentsMock.mockRejectedValueOnce(new Error("network down"));
    listAssignmentsMock.mockResolvedValueOnce([
      {
        id: "a1",
        title: "Week 1 Reading",
        description: null,
        lecture_ids: ["lec-1"],
        due_at: "2026-01-01T00:00:00Z",
        min_quiz_score: 70,
      },
    ]);
    renderWithProviders(<ProfessorAssignmentsTab lectures={[{ id: "lec-1", title: "Intro" }]} />);

    await screen.findByTestId("assignments-error");
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("Week 1 Reading")).toBeInTheDocument();
  });

  it("renders the genuine empty state when the load succeeds with zero assignments", async () => {
    listAssignmentsMock.mockResolvedValue([]);
    renderWithProviders(<ProfessorAssignmentsTab lectures={[]} />);

    expect(await screen.findByText(/no assignments yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("assignments-error")).not.toBeInTheDocument();
  });
});
