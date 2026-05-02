import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
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

import LectureEdit from "@/pages/LectureEdit";
import { renderWithProviders } from "@/test/renderWithProviders";

function renderAtRoute() {
  return renderWithProviders(
    <Routes>
      <Route path="/professor/lecture/:lectureId" element={<LectureEdit />} />
      <Route path="/professor/dashboard" element={<div>Dashboard Stub</div>} />
    </Routes>,
    { initialEntries: ["/professor/lecture/lec-1"] },
  );
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  supabaseMock.reset();
  // LectureEdit's load handler logs PGRST116 ("no rows") via console.error
  // when the seeded `lectures` table is empty (the not-found smoke case).
  // That is expected behavior under test, so we silence the log.
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("LectureEdit page (smoke)", () => {
  it("mounts a loading spinner before the lecture loads", async () => {
    const { container } = renderAtRoute();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    await waitFor(() => {
      expect(container.querySelector(".animate-spin")).toBeNull();
    });
  });

  it("falls back gracefully when the lecture is not found (no spinner remains)", async () => {
    renderAtRoute();
    await waitFor(() => {
      expect(document.querySelector(".animate-spin")).toBeNull();
    });
  });

  it("renders the Edit Lecture form when the lecture is found, with one slide row", async () => {
    supabaseMock.seed("lectures", [
      {
        id: "lec-1",
        title: "Linear Algebra",
        description: "Vectors and matrices",
        total_slides: 1,
        pdf_url: null,
        professor_id: "prof-1",
        created_at: "2025-01-01T00:00:00Z",
      },
    ]);
    supabaseMock.seed("slides", [
      {
        id: "slide-1",
        lecture_id: "lec-1",
        slide_number: 1,
        title: "Vector Spaces",
        content_text: "Definitions",
        summary: "Intro to vector spaces",
      },
    ]);
    supabaseMock.seed("quiz_questions", []);

    renderAtRoute();

    expect(
      await screen.findByRole("heading", { level: 1, name: /edit lecture/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/slide 1/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/linear algebra/i)).toBeInTheDocument();
  });
});
