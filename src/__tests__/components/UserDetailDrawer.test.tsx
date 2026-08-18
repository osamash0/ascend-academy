/**
 * R15: loadDetail() swallowed errors to console.error only, so a failed
 * fetch left `detail` null and the `loading || !detail` guard spun the
 * drawer forever with no reason given for the failure.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchUserDetailMock = vi.fn();
vi.mock("@/services/adminService", async () => {
  const actual = await vi.importActual<typeof import("@/services/adminService")>(
    "@/services/adminService",
  );
  return {
    ...actual,
    adminService: {
      ...actual.adminService,
      fetchUserDetail: (...args: unknown[]) => fetchUserDetailMock(...args),
    },
  };
});

import { UserDetailDrawer } from "@/components/admin/UserDetailDrawer";

const DETAIL = {
  profile: {
    user_id: "u1",
    email: "u1@test.com",
    display_name: "Test User",
    full_name: "Test User",
    avatar_url: null,
    roles: ["student"],
    current_level: 3,
    total_xp: 120,
  },
  monthly_spend_usd: 0.5,
  recent_events: [],
};

beforeEach(() => {
  fetchUserDetailMock.mockReset();
});

describe("UserDetailDrawer — load failure", () => {
  it("shows a distinct error state with retry instead of spinning forever", async () => {
    fetchUserDetailMock.mockRejectedValue(new Error("network down"));
    render(<UserDetailDrawer userId="u1" onClose={vi.fn()} onRoleChanged={vi.fn()} />);

    expect(await screen.findByTestId("user-drawer-error")).toBeInTheDocument();
  });

  it("retries and shows the real detail when the retry button is clicked", async () => {
    const user = userEvent.setup();
    fetchUserDetailMock.mockRejectedValueOnce(new Error("network down"));
    fetchUserDetailMock.mockResolvedValueOnce(DETAIL);

    render(<UserDetailDrawer userId="u1" onClose={vi.fn()} onRoleChanged={vi.fn()} />);

    await screen.findByTestId("user-drawer-error");
    await user.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("Test User")).toBeInTheDocument();
    expect(screen.queryByTestId("user-drawer-error")).not.toBeInTheDocument();
  });

  it("renders the real detail on success (no error state)", async () => {
    fetchUserDetailMock.mockResolvedValue(DETAIL);
    render(<UserDetailDrawer userId="u1" onClose={vi.fn()} onRoleChanged={vi.fn()} />);

    expect(await screen.findByText("Test User")).toBeInTheDocument();
    expect(screen.queryByTestId("user-drawer-error")).not.toBeInTheDocument();
  });
});
