import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
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

import ProfessorDashboard from "@/pages/ProfessorDashboard";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => {
  supabaseMock.reset();
  archiveLectureMock.mockClear();
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
