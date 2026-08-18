import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import FindFriends from "../pages/FindFriends";
import * as hooks from "../hooks";

vi.mock("../hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks")>();
  return {
    ...actual,
    useSearchUsers: vi.fn(),
    useFriendSuggestions: vi.fn(),
  };
});

describe("FindFriends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hooks.useSearchUsers).mockReturnValue({
      data: [],
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    } as any);
    vi.mocked(hooks.useFriendSuggestions).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);
  });

  it("renders the generic no-match copy for a real empty search result", () => {
    renderWithProviders(<FindFriends />);
    expect(screen.getByText("No learners match your search.")).toBeInTheDocument();
  });

  // R25: useSearchUsers() failing used to fall through to `results.length
  // === 0` and render the same "No learners match your search." copy —
  // indistinguishable from a real, empty result set.
  it("shows a real error state (not 'No learners match your search') when the search fails", () => {
    vi.mocked(hooks.useSearchUsers).mockReturnValue({
      data: [],
      isFetching: false,
      isError: true,
      refetch: vi.fn(),
    } as any);

    renderWithProviders(<FindFriends />);

    expect(screen.queryByText("No learners match your search.")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't search right now/i)).toBeInTheDocument();
  });

  it("retries the search when the retry button is clicked", async () => {
    const refetch = vi.fn();
    vi.mocked(hooks.useSearchUsers).mockReturnValue({
      data: [],
      isFetching: false,
      isError: true,
      refetch,
    } as any);

    renderWithProviders(<FindFriends />);
    screen.getByRole("button", { name: /retry/i }).click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
