/**
 * Unit tests for the lecture service.
 *
 * The supabase client is replaced with our in-memory mock so we can assert
 * on the exact PostgREST chain the service uses without hitting the network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

import {
  fetchLecture,
  fetchSlides,
  fetchProfessorLectures,
  insertQuizQuestion,
  updateQuizQuestion,
  updateSlideContent,
  deleteSlideWithQuestions,
  deleteLecture,
} from "@/services/lectureService";

beforeEach(() => supabaseMock.reset());

describe("fetchLecture", () => {
  it("returns the lecture when found", async () => {
    supabaseMock.seed("lectures", [
      { id: "L1", title: "Bio 101", professor_id: "P1" },
    ]);
    const out = await fetchLecture("L1");
    expect(out?.title).toBe("Bio 101");
  });

  it("returns null when missing", async () => {
    supabaseMock.seed("lectures", []);
    expect(await fetchLecture("nope")).toBeNull();
  });
});

describe("fetchSlides", () => {
  it("returns slides ordered by slide_number", async () => {
    supabaseMock.seed("slides", [
      { id: "s2", lecture_id: "L1", slide_number: 2, title: "B" },
      { id: "s1", lecture_id: "L1", slide_number: 1, title: "A" },
    ]);
    const out = await fetchSlides("L1");
    expect(out.map((s) => s.slide_number)).toEqual([1, 2]);
  });

  it("returns [] on empty", async () => {
    supabaseMock.seed("slides", []);
    expect(await fetchSlides("L1")).toEqual([]);
  });

  it("filters by lecture_id", async () => {
    supabaseMock.seed("slides", [
      { id: "s1", lecture_id: "L1", slide_number: 1, title: "A" },
      { id: "s2", lecture_id: "L2", slide_number: 1, title: "X" },
    ]);
    const out = await fetchSlides("L1");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("s1");
  });
});

describe("fetchProfessorLectures", () => {
  it("returns only the requested professor's lectures", async () => {
    supabaseMock.seed("lectures", [
      { id: "L1", professor_id: "P1", title: "A", created_at: "2026-01-01" },
      { id: "L2", professor_id: "P2", title: "B", created_at: "2026-01-02" },
    ]);
    const out = await fetchProfessorLectures("P1");
    expect(out.map((l) => l.id)).toEqual(["L1"]);
  });
});

describe("insertQuizQuestion / updateQuizQuestion", () => {
  it("inserts a row into quiz_questions", async () => {
    await insertQuizQuestion({
      slide_id: "s1",
      question_text: "Q",
      options: ["a", "b", "c", "d"],
      correct_answer: 0,
    });
    expect(supabaseMock.data["quiz_questions"].rows).toHaveLength(1);
  });

  it("update applies patch to matching row", async () => {
    supabaseMock.seed("quiz_questions", [
      { id: "Q1", question_text: "old", options: [], correct_answer: 0 },
    ]);
    await updateQuizQuestion("Q1", {
      question_text: "new",
      options: ["a", "b", "c", "d"],
      correct_answer: 1,
    });
    const row = supabaseMock.data["quiz_questions"].rows[0];
    expect(row.question_text).toBe("new");
    expect(row.correct_answer).toBe(1);
  });
});

describe("updateSlideContent", () => {
  it("patches the slide row", async () => {
    supabaseMock.seed("slides", [
      { id: "s1", title: "old", content_text: "" },
    ]);
    await updateSlideContent("s1", { title: "new" });
    expect(supabaseMock.data["slides"].rows[0].title).toBe("new");
  });
});

describe("deleteSlideWithQuestions", () => {
  it("deletes the slide and its questions", async () => {
    supabaseMock.seed("slides", [{ id: "s1" }]);
    supabaseMock.seed("quiz_questions", [
      { id: "q1", slide_id: "s1" },
      { id: "q2", slide_id: "s1" },
      { id: "q3", slide_id: "s2" },
    ]);
    await deleteSlideWithQuestions("s1");
    expect(supabaseMock.data["quiz_questions"].rows.map((r) => r.id)).toEqual(["q3"]);
    expect(supabaseMock.data["slides"].rows).toEqual([]);
  });
});

describe("deleteLecture", () => {
  it("cascades through quiz_questions, student_progress, slides, lectures", async () => {
    supabaseMock.seed("lectures", [{ id: "L1", pdf_url: null }]);
    supabaseMock.seed("slides", [
      { id: "s1", lecture_id: "L1" },
      { id: "s2", lecture_id: "L1" },
    ]);
    supabaseMock.seed("quiz_questions", [
      { id: "q1", slide_id: "s1" },
      { id: "q2", slide_id: "s2" },
    ]);
    supabaseMock.seed("student_progress", [
      { user_id: "u1", lecture_id: "L1" },
    ]);

    await deleteLecture("L1");

    expect(supabaseMock.data["quiz_questions"].rows).toEqual([]);
    expect(supabaseMock.data["student_progress"].rows).toEqual([]);
    expect(supabaseMock.data["slides"].rows).toEqual([]);
    expect(supabaseMock.data["lectures"].rows).toEqual([]);
  });
});
