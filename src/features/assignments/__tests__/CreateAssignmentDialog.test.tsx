/**
 * Happy-path test for the professor's create-assignment dialog.
 *
 * Mocks the service layer so we exercise form state, validation, and the
 * submitted payload shape — not the HTTP transport.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import { CreateAssignmentDialog } from "@/features/assignments/CreateAssignmentDialog";

vi.mock("@/services/assignmentsService", () => ({
  createAssignment: vi.fn().mockResolvedValue({ id: "new-assignment" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { createAssignment } from "@/services/assignmentsService";
const mockCreate = vi.mocked(createAssignment);

describe("CreateAssignmentDialog", () => {
  it("submits the form with title, due date, and selected lecture", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();

    renderWithProviders(
      <CreateAssignmentDialog
        open
        onOpenChange={onOpenChange}
        lectures={[
          { id: "L1", title: "Intro to topology" },
          { id: "L2", title: "Sheaves" },
        ]}
        onCreated={onCreated}
      />,
    );

    await user.type(
      screen.getByTestId("assignment-title-input"),
      "Week 5 catch-up",
    );

    // Pick the first lecture.
    const checkbox = screen.getByTestId("assignment-lecture-L1");
    await user.click(checkbox);

    // Set a due date in the future.
    const dueInput = screen.getByTestId("assignment-due-input") as HTMLInputElement;
    fireEvent.change(dueInput, { target: { value: "2099-12-31" } });

    const submit = screen.getByTestId("assignment-submit-button");
    expect(submit).not.toBeDisabled();

    await user.click(submit);

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
    const payload = mockCreate.mock.calls[0][0];
    expect(payload.title).toBe("Week 5 catch-up");
    expect(payload.lecture_ids).toEqual(["L1"]);
    expect(payload.due_at).toContain("2099-12-31");
    expect(onCreated).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables submit until title and at least one lecture are set", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CreateAssignmentDialog
        open
        onOpenChange={() => {}}
        lectures={[{ id: "L1", title: "Intro" }]}
      />,
    );

    const submit = screen.getByTestId("assignment-submit-button");
    expect(submit).toBeDisabled();

    await user.type(screen.getByTestId("assignment-title-input"), "Title only");
    expect(submit).toBeDisabled();

    await user.click(screen.getByTestId("assignment-lecture-L1"));
    expect(submit).not.toBeDisabled();
  });
});
