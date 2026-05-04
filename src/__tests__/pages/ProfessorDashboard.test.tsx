import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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

vi.mock("@/services/lectureService", async () => {
  const actual = await vi.importActual<typeof import("@/services/lectureService")>(
    "@/services/lectureService",
  );
  return {
    ...actual,
    deleteLecture: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
});

import ProfessorDashboard from "@/pages/ProfessorDashboard";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => supabaseMock.reset());

describe("ProfessorDashboard page (smoke)", () => {
  it("mounts a loading skeleton on first render", async () => {
    const { container } = renderWithProviders(<ProfessorDashboard />, {
      initialEntries: ["/professor/dashboard"],
    });
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByText(/no lectures detected/i)).toBeInTheDocument();
    });
  });

  it("renders the empty-state when the professor has no lectures", async () => {
    renderWithProviders(<ProfessorDashboard />, {
      initialEntries: ["/professor/dashboard"],
    });
    await waitFor(
      () => {
        expect(screen.getByText(/no lectures detected/i)).toBeInTheDocument();
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
      },
    ]);
    renderWithProviders(<ProfessorDashboard />, {
      initialEntries: ["/professor/dashboard"],
    });
    await waitFor(
      () => {
        expect(screen.getByText("Quantum Mechanics")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    expect(screen.getByText(/active protocol/i)).toBeInTheDocument();
  });
});
