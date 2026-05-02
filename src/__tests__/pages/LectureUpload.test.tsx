import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

vi.mock("@/hooks/use-ai-model", () => ({
  useAiModel: () => ({ aiModel: "groq", setAiModel: vi.fn() }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(() => ({
    user: { id: "prof-1", email: "p@p.com" },
    session: null,
    profile: null,
    role: "professor",
    loading: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn(),
  })),
}));

import LectureUpload from "@/pages/LectureUpload";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => supabaseMock.reset());

describe("LectureUpload page (smoke)", () => {
  it("mounts the Create Lecture header", () => {
    renderWithProviders(<LectureUpload />, {
      initialEntries: ["/professor/upload"],
    });
    expect(screen.getByText(/create lecture/i)).toBeInTheDocument();
  });

  it("renders the empty-slide state when no slides exist yet", () => {
    renderWithProviders(<LectureUpload />, {
      initialEntries: ["/professor/upload"],
    });
    expect(
      screen.getByText(/start building your lecture/i),
    ).toBeInTheDocument();
  });

  it("exposes both Create First Slide and Import PDF actions (first-row affordances)", () => {
    renderWithProviders(<LectureUpload />, {
      initialEntries: ["/professor/upload"],
    });
    expect(
      screen.getByRole("button", { name: /create first slide/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import pdf/i }),
    ).toBeInTheDocument();
  });

  it("shows the lecture title input field", () => {
    renderWithProviders(<LectureUpload />, {
      initialEntries: ["/professor/upload"],
    });
    expect(screen.getByLabelText(/lecture title/i)).toBeInTheDocument();
  });
});
