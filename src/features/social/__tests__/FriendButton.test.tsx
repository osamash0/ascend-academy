import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import { FriendButton } from "../components/FriendButton";
import * as hooks from "../hooks";

vi.mock("../hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks")>();
  return { ...actual, useFriendActions: vi.fn() };
});

describe("FriendButton", () => {
  const mockAdd = vi.fn();
  const mockCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hooks.useFriendActions).mockReturnValue({
      add: { mutate: mockAdd, isPending: false },
      cancel: { mutate: mockCancel, isPending: false },
      accept: { mutate: vi.fn(), isPending: false },
      decline: { mutate: vi.fn(), isPending: false },
      unfriend: { mutate: vi.fn(), isPending: false },
      bootstrap: { mutate: vi.fn(), isPending: false },
    } as any);
  });

  it("renders Add friend when relationship is none", () => {
    renderWithProviders(<FriendButton userId="u2" relationship="none" />);
    expect(screen.getByRole("button", { name: /add friend/i })).toBeInTheDocument();
  });

  it("renders Friends when relationship is friends", () => {
    renderWithProviders(<FriendButton userId="u2" relationship="friends" />);
    const btn = screen.getByRole("button", { name: /friends/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("renders Awaiting you when relationship is incoming", () => {
    renderWithProviders(<FriendButton userId="u2" relationship="incoming" />);
    const btn = screen.getByRole("button", { name: /awaiting you/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeDisabled();
  });

  it("renders Pending when relationship is pending_outgoing", () => {
    renderWithProviders(<FriendButton userId="u2" relationship="pending_outgoing" />);
    expect(screen.getByRole("button", { name: /pending/i })).toBeInTheDocument();
  });

  it("calls add friend mutation on click when none", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FriendButton userId="u2" relationship="none" />);
    await user.click(screen.getByRole("button", { name: /add friend/i }));
    expect(mockAdd).toHaveBeenCalledWith("u2");
  });

  it("calls cancel mutation on click when pending", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FriendButton userId="u2" relationship="pending_outgoing" />);
    await user.click(screen.getByRole("button", { name: /pending/i }));
    expect(mockCancel).toHaveBeenCalledWith("u2");
  });
});
