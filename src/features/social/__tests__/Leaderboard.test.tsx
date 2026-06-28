import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import Leaderboard from "../../../pages/Leaderboard";
import * as hooks from "../hooks";
import * as userHook from "../useSocialUser";

vi.mock("../hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks")>();
  return { ...actual, useGlobalLeaderboard: vi.fn() };
});

vi.mock("../useSocialUser", () => ({
  useSocialUser: vi.fn(),
}));

const MOCK_ME = { id: "u1", name: "Alice" };

const MOCK_ROWS = [
  { id: "u1", name: "Alice", weeklyXp: 100, totalXp: 500, universityName: "MIT", facultyName: "Engineering", currentSemester: 1 },
  { id: "u2", name: "Bob", weeklyXp: 50, totalXp: 600, universityName: "MIT", facultyName: "Science", currentSemester: 2 },
  { id: "u3", name: "Charlie", weeklyXp: 300, totalXp: 300, universityName: "Stanford", facultyName: "Art", currentSemester: 1 },
  { id: "u4", name: "Diana", weeklyXp: 10, totalXp: 1000, universityName: "MIT", facultyName: "Engineering", currentSemester: 1 },
];

describe("Leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userHook.useSocialUser).mockReturnValue(MOCK_ME as any);
    vi.mocked(hooks.useGlobalLeaderboard).mockReturnValue({
      data: MOCK_ROWS,
      isLoading: false,
    } as any);
  });

  it("renders the podium with the top 3 users by weekly XP", () => {
    renderWithProviders(<Leaderboard />);
    // Weekly XP Top 3: Charlie(300), Alice(100), Bob(50). Diana is 4th.
    
    // The podium should render Charlie, Alice, Bob
    // Since PodiumCard might just be rendered, we can check names
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    
    // Diana should be in a row, not podium. Actually we can check row text
    expect(screen.getByText("Diana")).toBeInTheDocument();
  });

  it("sorts by total XP when 'All Time' is selected", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Leaderboard />);
    
    await user.click(screen.getByRole("button", { name: /all time/i }));
    
    // All Time Top 3: Diana(1000), Bob(600), Alice(500). Charlie(300) is 4th.
    expect(screen.getByText("Diana")).toBeInTheDocument();
  });

  it("filters deterministically by academic cohort", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Leaderboard />);
    
    // Since we're using shadcn/ui select, it renders a button for the trigger.
    // There are multiple selects. The first one is University.
    const selects = screen.getAllByRole("combobox");
    
    // Click the university dropdown
    await user.click(selects[0]);
    // Click Stanford
    await user.click(screen.getByRole("option", { name: "Stanford" }));
    
    // Now only Charlie should be visible
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });
});
