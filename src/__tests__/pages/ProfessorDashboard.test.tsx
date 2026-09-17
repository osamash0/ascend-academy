import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

/*
 * One `toast`, not a new one per render. The real hook returns a fresh wrapper
 * object each render but its `toast` is module-level, so the identity is
 * stable — and components list it in effect dependency arrays on that basis.
 * See `Settings.test.tsx` for the flake this shape caused there.
 */
const { toastFn } = vi.hoisted(() => ({ toastFn: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastFn }),
  toast: toastFn,
}));

vi.mock("@/lib/auth", () => {
  const user = { id: "prof-1", email: "prof@test.com" };
  return {
    useAuth: () => ({
      user,
      session: null,
      profile: null,
      role: "professor",
      loading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      refreshProfile: vi.fn(),
    }),
  };
});

const archiveLectureMock = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("@/services/lectureService", async () => {
  const actual = await vi.importActual<typeof import("@/services/lectureService")>(
    "@/services/lectureService",
  );
  return {
    ...actual,
    deleteLecture: vi.fn().mockResolvedValue({ data: null, error: null }),
    archiveLecture: (...args: unknown[]) => archiveLectureMock(...args),
  };
});

const listCoursesMock = vi.fn();
vi.mock("@/services/coursesService", async () => {
  const actual = await vi.importActual<typeof import("@/services/coursesService")>(
    "@/services/coursesService",
  );
  return {
    ...actual,
    listCourses: (...args: unknown[]) => listCoursesMock(...args),
  };
});

import ProfessorDashboard from "@/pages/ProfessorDashboard";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => {
  supabaseMock.reset();
  archiveLectureMock.mockClear();
  listCoursesMock.mockReset();
  listCoursesMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProfessorDashboard page (smoke)", () => {
  it("mounts a loading skeleton on first render", async () => {
    const { container } = renderWithProviders(<ProfessorDashboard />, {
      initialEntries: ["/professor/dashboard"],
    });
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByText(/no lectures yet/i)).toBeInTheDocument();
    });
  });

  it("renders the empty-state when the professor has no lectures", async () => {
    renderWithProviders(<ProfessorDashboard />, {
      initialEntries: ["/professor/dashboard"],
    });
    await waitFor(
      () => {
        expect(screen.getByText(/no lectures yet/i)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("renders the first lecture row when lectures exist", async () => {
    supabaseMock.seed("lectures", [
      {
        id: "lec-1",
        title: "Quantum Mechanics",
        description: "Wave functions",
        total_slides: 12,
        created_at: "2025-01-01T00:00:00Z",
        pdf_url: "https://example/test.pdf",
        professor_id: "prof-1",
        is_archived: false,
      },
    ]);
    renderWithProviders(<ProfessorDashboard />, {
      initialEntries: ["/professor/dashboard"],
    });
    await waitFor(
      () => {
        expect(screen.getAllByText("Quantum Mechanics")[0]).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    expect(screen.getByText(/active protocol/i)).toBeInTheDocument();
  });

  // R41: handleArchiveLecture existed but was never wired into any control —
  // ProfessorHeroStage only exposed analytics/edit/preview/delete icons. Now
  // wired in as a real "Archive Lecture" icon button.
  it("wires the Archive control on the hero stage to handleArchiveLecture", async () => {
    supabaseMock.seed("lectures", [
      {
        id: "lec-1",
        title: "Quantum Mechanics",
        description: "Wave functions",
        total_slides: 12,
        created_at: "2025-01-01T00:00:00Z",
        pdf_url: "https://example/test.pdf",
        professor_id: "prof-1",
        is_archived: false,
      },
    ]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWithProviders(<ProfessorDashboard />, {
      initialEntries: ["/professor/dashboard"],
    });
    await waitFor(
      () => {
        expect(screen.getAllByText("Quantum Mechanics")[0]).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /archive lecture/i }));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(archiveLectureMock).toHaveBeenCalledWith("lec-1"));

    confirmSpy.mockRestore();
  });

  // R19: listCourses() failure was console.error-only, so `courses` stayed
  // [] and ProfessorOverviewSection returned null — the entire Course
  // Overview block silently disappeared with no indication anything failed.
  it("shows an error card for Course Overview instead of silently vanishing", async () => {
    listCoursesMock.mockRejectedValue(new Error("network down"));
    renderWithProviders(<ProfessorDashboard />, {
      initialEntries: ["/professor/dashboard"],
    });

    expect(await screen.findByTestId("course-overview-error")).toBeInTheDocument();
  });

  it("retries loading courses when the Course Overview retry button is clicked", async () => {
    const user = userEvent.setup();
    listCoursesMock.mockRejectedValueOnce(new Error("network down"));
    listCoursesMock.mockResolvedValueOnce([
      {
        id: "course-1",
        professor_id: "prof-1",
        title: "Intro to ML",
        description: null,
        color: null,
        icon: null,
        is_archived: false,
        status: "published",
        created_at: null,
        updated_at: null,
        lecture_count: 0,
      },
    ]);
    renderWithProviders(<ProfessorDashboard />, {
      initialEntries: ["/professor/dashboard"],
    });

    await screen.findByTestId("course-overview-error");
    await user.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => {
      expect(screen.queryByTestId("course-overview-error")).not.toBeInTheDocument();
    });
  });

  // R54: "Good morning" used to show from 00:00-11:59 with no night band.
  it("shows the night greeting at 1am instead of 'Good morning'", async () => {
    // Spy on getHours (not vi.useFakeTimers — that also freezes the
    // setTimeout/microtask machinery react-query and waitFor rely on).
    const hoursSpy = vi.spyOn(Date.prototype, "getHours").mockReturnValue(1);

    supabaseMock.seed("lectures", [
      {
        id: "lec-1",
        title: "Quantum Mechanics",
        description: "Wave functions",
        total_slides: 12,
        created_at: "2025-01-01T00:00:00Z",
        pdf_url: "https://example/test.pdf",
        professor_id: "prof-1",
        is_archived: false,
      },
    ]);
    renderWithProviders(<ProfessorDashboard />, {
      initialEntries: ["/professor/dashboard"],
    });
    await waitFor(
      () => {
        expect(screen.getAllByText("Quantum Mechanics")[0]).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    expect(screen.queryByText(/good morning/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/good to see you/i).length).toBeGreaterThan(0);

    hoursSpy.mockRestore();
  });
});
