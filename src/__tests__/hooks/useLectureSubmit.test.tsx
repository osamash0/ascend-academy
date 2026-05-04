/**
 * Smoke test: useLectureSubmit persists cross-slide deck-quiz items into
 * quiz_questions, anchored to the first linked slide and with the full
 * linked_slides list in metadata.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "prof-1" } }),
}));

const insertQuizQuestionMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/services/lectureService", () => ({
  insertQuizQuestion: (q: unknown) => insertQuizQuestionMock(q),
}));

import { useLectureSubmit } from "@/hooks/useLectureSubmit";
import type { SlideData, DeckQuizItem } from "@/types/lectureUpload";

beforeEach(() => {
  supabaseMock.reset();
  insertQuizQuestionMock.mockClear();
  navigateMock.mockClear();
});

describe("useLectureSubmit deck-quiz persistence", () => {
  it("anchors deck quiz items to first linked slide and stores linked_slides in metadata", async () => {
    const slides: SlideData[] = [
      { title: "S1", content: "c1", summary: "", questions: [] },
      { title: "S2", content: "c2", summary: "", questions: [] },
      { title: "S3", content: "c3", summary: "", questions: [] },
    ];
    const deckQuiz: DeckQuizItem[] = [
      {
        question: "Cross Q?",
        options: ["a", "b", "c", "d"],
        correctAnswer: 1,
        explanation: "links",
        concept: "bridge",
        linked_slides: [1, 2],
      },
      {
        // dropped: only one valid index
        question: "Bad Q?",
        options: ["a", "b", "c", "d"],
        correctAnswer: 0,
        linked_slides: [99],
      },
    ];

    const { result } = renderHook(() =>
      useLectureSubmit({
        slides,
        title: "T",
        description: "",
        pdfFile: null,
        pdfHash: null,
        deckQuiz,
      }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    await waitFor(() => {
      expect(insertQuizQuestionMock).toHaveBeenCalled();
    });

    expect(insertQuizQuestionMock).toHaveBeenCalledTimes(1);
    const call = insertQuizQuestionMock.mock.calls[0][0];
    expect(call.question_text).toBe("Cross Q?");
    expect(call.correct_answer).toBe(1);
    expect(call.metadata.linked_slides).toEqual([1, 2]);
    expect(call.metadata.concept).toBe("bridge");
    expect(call.metadata.explanation).toBe("links");
    // Anchored to slide at index 1 — verify the slide_id matches the
    // second inserted slide row in the mock store.
    const slideRows = supabaseMock.data.slides?.rows ?? [];
    const anchorSlide = slideRows.find((r: Record<string, unknown>) => r.slide_number === 2);
    expect(anchorSlide).toBeDefined();
    expect(call.slide_id).toBe(anchorSlide!.id);
  });

  it("skips deck quiz persistence when deckQuiz is empty", async () => {
    const slides: SlideData[] = [
      { title: "S1", content: "c1", summary: "", questions: [] },
    ];

    const { result } = renderHook(() =>
      useLectureSubmit({
        slides,
        title: "T",
        description: "",
        pdfFile: null,
        pdfHash: null,
        deckQuiz: [],
      }),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled();
    });
    expect(insertQuizQuestionMock).not.toHaveBeenCalled();
  });
});
