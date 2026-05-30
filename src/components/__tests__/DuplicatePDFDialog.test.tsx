/**
 * DuplicatePDFDialog tests.
 *
 * Guards the contract for the "you uploaded this PDF before" prompt:
 *   * Use existing  -> calls onUseExisting(matches[0].id)
 *   * Upload as new -> calls onUploadAsNew()
 *   * Cancel        -> calls onCancel()
 * and that the dialog only renders when `open` is true.
 */
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DuplicatePDFDialog } from "@/components/DuplicatePDFDialog";
import { renderWithProviders } from "@/test/renderWithProviders";

const matches = [
  { id: "lec-9", title: "Calc 101 — Week 3", created_at: "2026-04-15T12:00:00Z", total_slides: 12 },
  { id: "lec-7", title: "Calc 101 — Week 2", created_at: "2026-04-08T12:00:00Z", total_slides: 10 },
];

function setup(overrides: Partial<React.ComponentProps<typeof DuplicatePDFDialog>> = {}) {
  const props = {
    open: true,
    matches,
    onUseExisting: vi.fn(),
    onUploadAsNew: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  renderWithProviders(<DuplicatePDFDialog {...props} />);
  return props;
}

describe("DuplicatePDFDialog", () => {
  it("renders every match as a selectable radio (newest-first, newest preselected)", () => {
    setup();
    expect(screen.getByText(/uploaded this PDF before/i)).toBeInTheDocument();
    // Both matches are listed (no '+N other' summary).
    expect(screen.getByText("Calc 101 — Week 3")).toBeInTheDocument();
    expect(screen.getByText("Calc 101 — Week 2")).toBeInTheDocument();
    expect(screen.queryByText(/other matching lecture/)).toBeNull();
    // Two radios, with the newest (matches[0]) preselected.
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
    expect((radios[1] as HTMLInputElement).checked).toBe(false);
  });

  it("invokes onUseExisting with the default (newest) lecture id", async () => {
    const props = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /use existing/i }));
    expect(props.onUseExisting).toHaveBeenCalledTimes(1);
    expect(props.onUseExisting).toHaveBeenCalledWith("lec-9");
    expect(props.onUploadAsNew).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("lets the user pick a non-default match and routes to that id", async () => {
    const props = setup();
    const user = userEvent.setup();
    // Pick the older lecture instead of the default newest.
    await user.click(screen.getByRole("radio", { name: /Calc 101 — Week 2/i }));
    await user.click(screen.getByRole("button", { name: /use existing/i }));
    expect(props.onUseExisting).toHaveBeenCalledWith("lec-7");
  });

  it("invokes onUploadAsNew when the secondary action is clicked", async () => {
    const props = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /upload as new/i }));
    expect(props.onUploadAsNew).toHaveBeenCalledTimes(1);
    expect(props.onUseExisting).not.toHaveBeenCalled();
  });

  it("invokes onCancel when Cancel is clicked", async () => {
    const props = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onUseExisting).not.toHaveBeenCalled();
    expect(props.onUploadAsNew).not.toHaveBeenCalled();
  });

  it("does not render when open=false", () => {
    setup({ open: false });
    expect(screen.queryByText(/uploaded this PDF before/i)).toBeNull();
  });

  it("renders a single non-radio card with the singular description for one match", () => {
    setup({ matches: [matches[0]] });
    // No radios, no '+N other matching lecture' line.
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText(/other matching lecture/)).toBeNull();
    expect(
      screen.getByText(/matches an existing lecture in your library/i),
    ).toBeInTheDocument();
  });
});
