/**
 * Render smoke test for the new course-wide overview section.
 * Mocks the analytics hook so we don't need MSW or a live API.
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

const mockOverview = {
  active_students: 12,
  average_completion: 73.5,
  average_quiz_accuracy: 81.2,
  median_time_minutes: 14.3,
  weakest_concepts: [
    { concept: "Backpropagation", miss_rate: 88.0, attempts: 25 },
    { concept: "Eigenvectors", miss_rate: 71.5, attempts: 14 },
  ],
  weakest_slides: [],
  activity_sparkline: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-04-${String(20 + i).padStart(2, "0")}`,
    count: i * 2,
  })),
  lecture_count: 4,
  days: 7,
};

vi.mock("@/features/analytics/hooks/useAnalytics", () => ({
  useProfessorOverview: () => ({
    data: mockOverview,
    isLoading: false,
    isError: false,
  }),
}));

import { ProfessorOverviewSection } from "@/features/analytics/components/ProfessorOverviewSection";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { Course } from "@/services/coursesService";

const courses: Course[] = [
  { id: "c1", title: "CS 101", description: "", professor_id: "p1", color: null, icon: null, status: "published", created_at: "2026-01-01", updated_at: null, lecture_count: 0, is_archived: false },
  { id: "c2", title: "Linear Algebra", description: "", professor_id: "p1", color: null, icon: null, status: "published", created_at: "2026-01-02", updated_at: null, lecture_count: 0, is_archived: false },
];

describe("ProfessorOverviewSection", () => {
  it("renders the four stat tiles, weakest concepts, and the sparkline scaffold", () => {
    renderWithProviders(<ProfessorOverviewSection courses={courses} />);

    // Section heading
    expect(screen.getByText(/Course Overview/i)).toBeInTheDocument();

    // Stat tiles (titles + values)
    expect(screen.getByText(/Active Students/i)).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    // Values may be split across nodes by StatsCard formatting — search the
    // rendered text content instead of relying on a single text node.
    // StatsCard normalizes percent strings via parseInt for its animated
    // counter, so we just verify the integer parts + unit landed on screen.
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/73\s*%/);
    expect(body).toMatch(/81\s*%/);

    // Weakest concept entries
    expect(screen.getByText("Backpropagation")).toBeInTheDocument();
    expect(body).toMatch(/88\s*%/);
    expect(screen.getByText("Eigenvectors")).toBeInTheDocument();

    // Course selector with both options
    const selector = screen.getByLabelText(/Course selector for overview/i) as HTMLSelectElement;
    expect(selector).toBeInTheDocument();
    expect(selector.options).toHaveLength(2);

    // Sparkline container is rendered (Recharts mounts a ResponsiveContainer)
    expect(screen.getByText(/7-Day Activity/i)).toBeInTheDocument();
  });

  it("renders nothing when the professor has no courses", () => {
    const { container } = renderWithProviders(<ProfessorOverviewSection courses={[]} />);
    // The section component returns null; the only thing left in the wrapper
    // is the next-themes injected <script>. Make sure none of our content
    // landed on the page.
    expect(container.querySelector("[aria-label='Course selector for overview']")).toBeNull();
    expect(container.textContent).not.toContain("Course Overview");
  });
});
