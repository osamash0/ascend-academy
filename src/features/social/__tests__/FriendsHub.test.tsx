import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import FriendsHub from "../pages/FriendsHub";
import * as hooks from "../hooks";

vi.mock("../hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks")>();
  return {
    ...actual,
    useFriends: vi.fn(),
    useFriendRequests: vi.fn(),
  };
});

describe("FriendsHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hooks.useFriends).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);
    vi.mocked(hooks.useFriendRequests).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);
  });

  it("renders empty state when no friends or requests exist", () => {
    renderWithProviders(<FriendsHub />);
    expect(screen.getByText("Find your first study buddy")).toBeInTheDocument();
  });

  it("renders online friends section when online friends exist", () => {
    vi.mocked(hooks.useFriends).mockReturnValue({
      data: [
        { id: "u1", name: "Alice", online: true, weeklyXp: 50, totalXp: 100 },
        { id: "u2", name: "Bob", online: false, weeklyXp: 0, totalXp: 10 },
      ],
      isLoading: false,
    } as any);

    renderWithProviders(<FriendsHub />);
    
    // Should show online section
    expect(screen.getByText(/1 friend active now/i)).toBeInTheDocument();
    
    // Both friends should appear in the total list
    const allFriendsHeading = screen.getByText("All friends");
    expect(allFriendsHeading).toBeInTheDocument();
    
    // Alice and Bob should be rendered
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("renders incoming requests", () => {
    vi.mocked(hooks.useFriendRequests).mockReturnValue({
      data: [
        { id: "req1", name: "Charlie", direction: "incoming", mutualFriends: 2 }
      ],
      isLoading: false,
    } as any);

    renderWithProviders(<FriendsHub />);

    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText(/2 mutual friends/i)).toBeInTheDocument();
  });

  // R25: useFriends() failing used to fall straight into the onboarding
  // empty state ("Find your first study buddy") — an outage looked
  // identical to a brand-new account with no friends yet.
  it("shows a real error state (not the onboarding empty state) when useFriends() fails", () => {
    vi.mocked(hooks.useFriends).mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<FriendsHub />);

    expect(screen.queryByText("Find your first study buddy")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load your friends/i)).toBeInTheDocument();
  });

  it("retries useFriends() when the retry button is clicked", async () => {
    const refetch = vi.fn();
    vi.mocked(hooks.useFriends).mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      refetch,
    } as any);

    renderWithProviders(<FriendsHub />);
    screen.getByRole("button", { name: /retry/i }).click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
