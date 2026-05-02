import { describe, expect, it, vi, beforeEach } from "vitest";
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

vi.mock("@/lib/auth", () => {
  const user = { id: "u1", email: "s@s.com" };
  const profile = {
    id: "p1",
    user_id: "u1",
    email: "s@s.com",
    full_name: "Stu Dent",
    display_name: "Stu",
    avatar_url: null,
    total_xp: 0,
    current_level: 1,
    current_streak: 0,
    best_streak: 0,
  };
  return {
    useAuth: () => ({
      user,
      session: null,
      profile,
      role: "student",
      loading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      refreshProfile: vi.fn().mockResolvedValue(undefined),
    }),
  };
});

vi.mock("@/components/SlideViewer", () => ({
  SlideViewer: ({ slide }: { slide: { title?: string } }) => (
    <div data-testid="slide-viewer-stub">{slide?.title}</div>
  ),
}));

vi.mock("@/components/LectureSidebar", () => ({
  LectureSidebar: () => <div data-testid="lecture-sidebar-stub" />,
}));

vi.mock("@/components/LectureChat", () => ({
  LectureChat: () => <div data-testid="lecture-chat-stub" />,
}));

const fetchLectureMock = vi.fn();
const fetchSlidesMock = vi.fn();
const fetchQuizQuestionsMock = vi.fn();
vi.mock("@/services/lectureService", async () => {
  const actual = await vi.importActual<typeof import("@/services/lectureService")>(
    "@/services/lectureService",
  );
  return {
    ...actual,
    fetchLecture: (...a: unknown[]) => fetchLectureMock(...a),
    fetchSlides: (...a: unknown[]) => fetchSlidesMock(...a),
    fetchQuizQuestions: (...a: unknown[]) => fetchQuizQuestionsMock(...a),
  };
});

vi.mock("@/services/studentService", async () => {
  const actual = await vi.importActual<typeof import("@/services/studentService")>(
    "@/services/studentService",
  );
  return {
    ...actual,
    fetchLectureProgress: vi.fn().mockResolvedValue(null),
    upsertLectureProgress: vi.fn().mockResolvedValue({ data: null, error: null }),
    logLearningEvent: vi.fn().mockResolvedValue({ data: null, error: null }),
    checkAchievementExists: vi.fn().mockResolvedValue(false),
    awardAchievement: vi.fn().mockResolvedValue({ data: null, error: null }),
    insertNotification: vi.fn().mockResolvedValue({ data: null, error: null }),
    countCompletedLectures: vi.fn().mockResolvedValue(0),
  };
});

vi.mock("@/features/mindmap/hooks/useMindMap", () => ({
  useMindMap: () => ({
    map: { data: null, isLoading: false, isError: false },
    generate: { mutate: vi.fn(), isPending: false },
  }),
}));

import LectureView from "@/pages/LectureView";
import { renderWithProviders } from "@/test/renderWithProviders";

function renderAtRoute() {
  return renderWithProviders(
    <Routes>
      <Route path="/lecture/:lectureId" element={<LectureView />} />
      <Route path="/dashboard" element={<div>Dashboard Stub</div>} />
    </Routes>,
    { initialEntries: ["/lecture/lec-1"] },
  );
}

beforeEach(() => {
  supabaseMock.reset();
  fetchLectureMock.mockReset();
  fetchSlidesMock.mockReset();
  fetchQuizQuestionsMock.mockReset();
});

describe("LectureView page (smoke)", () => {
  it("mounts with a loading spinner before the lecture data resolves", () => {
    fetchLectureMock.mockReturnValue(new Promise(() => {}));
    fetchSlidesMock.mockResolvedValue([]);
    fetchQuizQuestionsMock.mockResolvedValue([]);
    const { container } = renderAtRoute();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("renders mock slides when the lecture loads with no real slides", async () => {
    fetchLectureMock.mockResolvedValue({
      id: "lec-1",
      title: "Intro to Testing",
      description: null,
      total_slides: 4,
      professor_id: "prof-1",
      created_at: "2025-01-01T00:00:00Z",
      pdf_url: null,
    });
    fetchSlidesMock.mockResolvedValue([]);
    fetchQuizQuestionsMock.mockResolvedValue([]);

    renderAtRoute();
    await waitFor(() => {
      expect(screen.getByText(/intro to testing/i)).toBeInTheDocument();
    });
  });

  it("renders the first real slide title when slides exist", async () => {
    fetchLectureMock.mockResolvedValue({
      id: "lec-1",
      title: "Algorithms",
      description: null,
      total_slides: 1,
      professor_id: "prof-1",
      created_at: "2025-01-01T00:00:00Z",
      pdf_url: null,
    });
    fetchSlidesMock.mockResolvedValue([
      {
        id: "slide-1",
        slide_number: 1,
        title: "Big-O Notation",
        content_text: "Time complexity overview.",
        summary: "Complexity intro.",
      },
    ]);
    fetchQuizQuestionsMock.mockResolvedValue([]);

    renderAtRoute();
    await waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Big-O Notation");
    });
  });
});
