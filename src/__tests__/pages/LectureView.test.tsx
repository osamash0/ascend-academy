import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

// The shared mock does not natively expose `.rpc()` — LectureView calls
// `supabase.rpc('update_user_streak'|'add_xp_to_user')` inside handleQuizAnswer.
// We attach a permissive stub so quiz interaction tests can run without
// needing real Postgres functions.
(supabaseMock as unknown as { rpc: (...args: unknown[]) => Promise<unknown> }).rpc = vi
  .fn()
  .mockResolvedValue({ data: 1, error: null });

// jsdom does not implement Element.prototype.scrollIntoView; QuizCard and
// LectureView call it on result reveal. A no-op stub is enough.
if (!Element.prototype.scrollIntoView) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Element.prototype as any).scrollIntoView = function () {};
}

// AnimatePresence mode="wait" never resolves exit animations in jsdom, which
// keeps a stale QuizCard pinned to the DOM across slide transitions and breaks
// the multi-slide flow tests below. Stub framer-motion to render children
// inline with no transitions.
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const motionProxy = new Proxy({} as any, {
    get: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ({ children, ...rest }: any) => {
        const {
          // strip framer-motion-only props before forwarding
          initial: _i, animate: _a, exit: _e, transition: _t, variants: _v,
          whileHover: _wh, whileTap: _wt, whileInView: _wi, whileFocus: _wf,
          drag: _d, layout: _l, layoutId: _li, custom: _c, viewport: _vp,
          ...domProps
        } = rest;
        // Default to a div; specific tags not preserved but adequate for tests.
        return <div {...domProps}>{children}</div>;
      };
    },
  });
  return {
    ...actual,
    AnimatePresence: Passthrough,
    motion: motionProxy,
  };
});

vi.mock("@/hooks/useTTS", () => ({
  useTTS: () => ({
    speak: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    isSpeaking: false,
    isPaused: false,
    isLoading: false,
  }),
}));

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
  SlideViewer: ({
    title,
    onNext,
    onPrevious,
  }: {
    title?: string;
    onNext?: () => void;
    onPrevious?: () => void;
  }) => (
    <div data-testid="slide-viewer-stub">
      <span>{title}</span>
      <button type="button" onClick={onPrevious}>Previous</button>
      <button type="button" onClick={onNext}>Next</button>
    </div>
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

const logLearningEventMock = vi.fn().mockResolvedValue({ data: null, error: null });
const upsertLectureProgressMock = vi
  .fn()
  .mockResolvedValue({ data: null, error: null });
vi.mock("@/services/studentService", async () => {
  const actual = await vi.importActual<typeof import("@/services/studentService")>(
    "@/services/studentService",
  );
  return {
    ...actual,
    fetchLectureProgress: vi.fn().mockResolvedValue(null),
    upsertLectureProgress: (...a: unknown[]) => upsertLectureProgressMock(...a),
    logLearningEvent: (...a: unknown[]) => logLearningEventMock(...a),
    checkAchievementExists: vi.fn().mockResolvedValue(true),
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
  logLearningEventMock.mockClear();
  upsertLectureProgressMock.mockClear();
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

describe("LectureView replay stage", () => {
  const lecture = {
    id: "lec-1",
    title: "Replay Test",
    description: null,
    total_slides: 2,
    professor_id: "prof-1",
    created_at: "2025-01-01T00:00:00Z",
    pdf_url: null,
  };
  const slides = [
    { id: "slide-1", slide_number: 1, title: "Slide One", content_text: "x", summary: "" },
    { id: "slide-2", slide_number: 2, title: "Slide Two", content_text: "y", summary: "" },
  ];
  const questions = [
    {
      id: "q1",
      slide_id: "slide-1",
      question_text: "Question 1?",
      options: ["A", "B", "C", "D"],
      correct_answer: 0,
    },
    {
      id: "q2",
      slide_id: "slide-2",
      question_text: "Question 2?",
      options: ["A", "B", "C", "D"],
      correct_answer: 1,
    },
  ];

  function setupLecture() {
    fetchLectureMock.mockResolvedValue(lecture);
    fetchSlidesMock.mockResolvedValue(slides);
    fetchQuizQuestionsMock.mockResolvedValue(questions);
  }

  // Walks the lecture forward, answering both questions wrong, until the
  // review stage appears. Returns once "Review missed questions" is on screen.
  async function walkThroughWithBothWrong() {
    // Slide 1 → reveal quiz → wrong answer → continue.
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => screen.getByText("Question 1?"));
    // Pick option B (index 1) — wrong (correct is index 0).
    fireEvent.click(screen.getByRole("radio", { name: /Option B: B/i }));
    await waitFor(() => screen.getByTestId("quiz-continue"));
    fireEvent.click(screen.getByTestId("quiz-continue"));

    // Slide 2 → reveal quiz → wrong answer → finish lecture.
    await waitFor(() => screen.getAllByText("Slide Two")[0]);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => screen.getByText("Question 2?"));
    // Pick option A (index 0) — wrong (correct is index 1).
    fireEvent.click(screen.getByRole("radio", { name: /Option A: A/i }));
    await waitFor(() => screen.getByTestId("quiz-continue"));
    fireEvent.click(screen.getByTestId("quiz-continue"));

    await waitFor(() => screen.getByTestId("review-stage"));
  }

  it("queues both wrong questions into the review stage at lecture end", async () => {
    setupLecture();
    renderAtRoute();
    await waitFor(() => screen.getAllByText("Slide One")[0]);

    await walkThroughWithBothWrong();

    expect(screen.getByText(/Review missed questions/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2/i)).toBeInTheDocument();
    // The first missed question (Question 1) is shown first.
    expect(screen.getByText("Question 1?")).toBeInTheDocument();
  });

  it("logs a quiz_retry_attempt event on the second-pass answer and fires completion only once", async () => {
    setupLecture();
    renderAtRoute();
    await waitFor(() => screen.getAllByText("Slide One")[0]);

    await walkThroughWithBothWrong();

    // Answer the first review question correctly (correct = index 0).
    fireEvent.click(screen.getByRole("radio", { name: /Option A: A/i }));
    await waitFor(() => screen.getByTestId("quiz-continue"));

    // A retry-attempt event must have been emitted before continue is clicked.
    const retryCalls = logLearningEventMock.mock.calls.filter(
      (c) => c[1] === "quiz_retry_attempt",
    );
    expect(retryCalls.length).toBe(1);
    expect(retryCalls[0][2]).toMatchObject({
      questionId: "q1",
      correct: true,
      selectedAnswer: 0,
    });

    // Continue to the second review question.
    fireEvent.click(screen.getByTestId("quiz-continue"));
    await waitFor(() => screen.getByText("Question 2?"));
    expect(screen.getByText(/2 of 2/i)).toBeInTheDocument();

    // Answer the second wrong intentionally — second wrong is allowed and
    // must not loop back. Correct is B (index 1); pick A again.
    fireEvent.click(screen.getByRole("radio", { name: /Option A: A/i }));
    await waitFor(() => screen.getByTestId("quiz-continue"));
    fireEvent.click(screen.getByTestId("quiz-continue"));

    // After the last review question, lecture_complete fires exactly once.
    await waitFor(() => {
      const completes = logLearningEventMock.mock.calls.filter(
        (c) => c[1] === "lecture_complete",
      );
      expect(completes.length).toBe(1);
    });

    const allRetries = logLearningEventMock.mock.calls.filter(
      (c) => c[1] === "quiz_retry_attempt",
    );
    expect(allRetries.length).toBe(2);
  });

  it("shows the end-of-lecture recap with first answer, retry answer, and recovery status for each missed question", async () => {
    setupLecture();
    renderAtRoute();
    await waitFor(() => screen.getAllByText("Slide One")[0]);

    await walkThroughWithBothWrong();

    // First retry: answer Q1 correctly (A, index 0).
    fireEvent.click(screen.getByRole("radio", { name: /Option A: A/i }));
    await waitFor(() => screen.getByTestId("quiz-continue"));
    fireEvent.click(screen.getByTestId("quiz-continue"));

    // Second retry: answer Q2 wrong again (A, index 0; correct is B).
    await waitFor(() => screen.getByText("Question 2?"));
    fireEvent.click(screen.getByRole("radio", { name: /Option A: A/i }));
    await waitFor(() => screen.getByTestId("quiz-continue"));
    fireEvent.click(screen.getByTestId("quiz-continue"));

    // Recap card appears with one entry per missed question.
    await waitFor(() => screen.getByTestId("lecture-recap"));
    const items = screen.getAllByTestId("recap-item");
    expect(items).toHaveLength(2);

    // Q1: recovered on retry.
    expect(items[0]).toHaveTextContent("Question 1?");
    expect(items[0]).toHaveTextContent(/Got it on retry/i);

    // Q2: still missed.
    expect(items[1]).toHaveTextContent("Question 2?");
    expect(items[1]).toHaveTextContent(/Still missed/i);

    // Done button navigates to dashboard.
    fireEvent.click(screen.getByTestId("recap-done"));
    await waitFor(() => screen.getByText("Dashboard Stub"));
  });

  it("skips the review stage and completes immediately when no questions were missed", async () => {
    setupLecture();
    renderAtRoute();
    await waitFor(() => screen.getAllByText("Slide One")[0]);

    // Slide 1 → quiz → correct (A).
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => screen.getByText("Question 1?"));
    fireEvent.click(screen.getByRole("radio", { name: /Option A: A/i }));
    await waitFor(() => screen.getByTestId("quiz-continue"));
    fireEvent.click(screen.getByTestId("quiz-continue"));

    // Slide 2 → quiz → correct (B).
    await waitFor(() => screen.getAllByText("Slide Two")[0]);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => screen.getByText("Question 2?"));
    fireEvent.click(screen.getByRole("radio", { name: /Option B: B/i }));
    await waitFor(() => screen.getByTestId("quiz-continue"));
    fireEvent.click(screen.getByTestId("quiz-continue"));

    // No review stage; lecture_complete fired once.
    expect(screen.queryByTestId("review-stage")).toBeNull();
    await waitFor(() => {
      const completes = logLearningEventMock.mock.calls.filter(
        (c) => c[1] === "lecture_complete",
      );
      expect(completes.length).toBe(1);
    });
    expect(
      logLearningEventMock.mock.calls.filter((c) => c[1] === "quiz_retry_attempt"),
    ).toHaveLength(0);

    // Recap still appears with the celebratory empty state — no retry items.
    await waitFor(() => screen.getByTestId("lecture-recap"));
    expect(screen.queryAllByTestId("recap-item")).toHaveLength(0);
    expect(screen.getByTestId("lecture-recap")).toHaveTextContent(/Perfect run/i);
  });
});
