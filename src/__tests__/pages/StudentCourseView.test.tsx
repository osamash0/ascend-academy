/**
 * Regression test for R23 (Milestone-4/PROBLEMS.md).
 *
 * useStudentDashboard() used to be destructured without `isError`, so a
 * failed fetch fell through to `lectures = []` and rendered the "Empty
 * Course" copy — indistinguishable from a course that genuinely has no
 * lectures yet.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const motionProxy = new Proxy({} as any, {
    get: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ({ children, ...rest }: any) => {
        const {
          initial: _i, animate: _a, exit: _e, transition: _t, variants: _v,
          whileHover: _wh, whileTap: _wt, whileInView: _wi, whileFocus: _wf,
          drag: _d, layout: _l, layoutId: _li, custom: _c, viewport: _vp,
          ...domProps
        } = rest;
        return <div {...domProps}>{children}</div>;
      };
    },
  });
  return { ...actual, AnimatePresence: Passthrough, motion: motionProxy };
});

const useStudentDashboardMock = vi.fn();
vi.mock("@/features/student/hooks/useStudentDashboard", () => ({
  useStudentDashboard: () => useStudentDashboardMock(),
}));

import StudentCourseView from "@/pages/StudentCourseView";

function renderAtRoute() {
  return renderWithProviders(
    <Routes>
      <Route path="/course/:courseId" element={<StudentCourseView />} />
    </Routes>,
    { initialEntries: ["/course/course-1"] },
  );
}

beforeEach(() => {
  useStudentDashboardMock.mockReset();
});

describe("StudentCourseView — R23 error vs. empty-course state", () => {
  it("shows a loading spinner while the dashboard fetch is in flight", () => {
    useStudentDashboardMock.mockReturnValue({ data: null, isLoading: true, isError: false, refetch: vi.fn() });
    const { container } = renderAtRoute();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows a real error state with retry (not 'Empty Course') when the dashboard fetch fails", async () => {
    const refetch = vi.fn();
    useStudentDashboardMock.mockReturnValue({ data: null, isLoading: false, isError: true, refetch });

    renderAtRoute();

    expect(screen.queryByText("Empty Course")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load this course/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  });

  it("still shows 'Empty Course' for a genuinely empty (errorless) course", () => {
    useStudentDashboardMock.mockReturnValue({
      data: { lectures: [], progress: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderAtRoute();

    expect(screen.getByText("Empty Course")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load this course/i)).not.toBeInTheDocument();
  });
});
