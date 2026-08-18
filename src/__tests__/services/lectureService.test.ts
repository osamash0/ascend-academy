/**
 * Unit tests for the lecture service.
 *
 * The supabase client is replaced with our in-memory mock so we can assert
 * on the exact PostgREST chain the service uses without hitting the network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
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
  enhanceSlide,
  saveExistingLecture,
} from "@/services/lectureService";

const API = "http://api.test/api/v1";

beforeEach(() => {
  supabaseMock.reset();
  // saveExistingLecture always fires this fire-and-forget-shaped retry at
  // the end; give it a default handler so tests don't need to know about it.
  server.use(
    http.post(`${API}/localized-content/lectures/:id/retry`, () => HttpResponse.json({})),
  );
});

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
      { id: "L1", professor_id: "P1", title: "A", created_at: "2026-01-01", is_archived: false },
      { id: "L2", professor_id: "P2", title: "B", created_at: "2026-01-02", is_archived: false },
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

  it("returns the inserted row's id", async () => {
    const { id } = await insertQuizQuestion({
      slide_id: "s1",
      question_text: "Q",
      options: ["a", "b", "c", "d"],
      correct_answer: 0,
    });
    expect(id).toBe(supabaseMock.data["quiz_questions"].rows[0].id);
  });
});

describe("saveExistingLecture", () => {
  const baseSlide = (overrides: Record<string, unknown> = {}) => ({
    id: "S1",
    title: "Original Title",
    content: "Original content",
    summary: "Original summary",
    questions: [{ question: "", options: ["", "", "", ""], correctAnswer: 0 }],
    ...overrides,
  });

  const seedLecture = () => {
    supabaseMock.seed("lectures", [{ id: "L1", title: "Old", description: "Old desc" }]);
  };

  it("writes exactly one slide PATCH when only that slide's title changed (M4: no write amplification)", async () => {
    seedLecture();
    const original = [baseSlide({ id: "S1" }), baseSlide({ id: "S2" }), baseSlide({ id: "S3" })];
    const edited = [
      { ...original[0], title: "Edited Title" },
      original[1],
      original[2],
    ];

    const fromSpy = vi.spyOn(supabaseMock, "from");
    await saveExistingLecture("L1", {
      title: "Old",
      description: "Old desc",
      slides: edited,
      originalSlides: original,
    });

    const slideWrites = fromSpy.mock.calls.filter((c) => c[0] === "slides");
    // Exactly one .from("slides") call for the one changed slide - the two
    // untouched slides must not be re-written at all.
    expect(slideWrites).toHaveLength(1);
  });

  it("issues zero quiz_questions writes when no question changed (M4: no write amplification)", async () => {
    seedLecture();
    const original = [
      baseSlide({ id: "S1", questions: [{ id: "Q1", question: "Q?", options: ["a", "b", "c", "d"], correctAnswer: 1 }] }),
    ];
    const edited = [{ ...original[0], title: "New Title" }]; // slide changes, question does not

    const fromSpy = vi.spyOn(supabaseMock, "from");
    await saveExistingLecture("L1", {
      title: "Old",
      description: "Old desc",
      slides: edited,
      originalSlides: original,
    });

    expect(fromSpy.mock.calls.filter((c) => c[0] === "quiz_questions")).toHaveLength(0);
  });

  it("does not resurrect a slide the user never touched (M4/N1: stale local copy must not overwrite it)", async () => {
    seedLecture();
    // The DB currently holds content the user's local `slides` array does
    // NOT reflect (e.g. a background job updated it after this editor
    // loaded). The user only edited a *different* slide.
    supabaseMock.seed("slides", [
      { id: "S1", lecture_id: "L1", slide_number: 1, title: "Untouched", content_text: "Newer content from elsewhere", summary: "" },
    ]);
    const original = [baseSlide({ id: "S1", content: "Original content (stale)" }), baseSlide({ id: "S2" })];
    const edited = [original[0], { ...original[1], title: "Edited slide 2" }];

    await saveExistingLecture("L1", {
      title: "Old",
      description: "Old desc",
      slides: edited,
      originalSlides: original,
    });

    const s1 = supabaseMock.data["slides"].rows.find((r) => r.id === "S1");
    // Untouched slide's DB row must survive exactly as it was - not
    // overwritten with the editor's stale local copy.
    expect(s1?.content_text).toBe("Newer content from elsewhere");
  });

  it("still writes a slide whose id has no baseline entry (defensive default)", async () => {
    seedLecture();
    supabaseMock.seed("slides", [
      { id: "S1", lecture_id: "L1", slide_number: 1, title: "DB value", content_text: "c", summary: "s" },
    ]);
    const edited = [baseSlide({ id: "S1", title: "Brand new to this session" })];
    await saveExistingLecture("L1", { title: "Old", description: "Old desc", slides: edited, originalSlides: [] });
    const s1 = supabaseMock.data["slides"].rows.find((r) => r.id === "S1");
    expect(s1?.title).toBe("Brand new to this session");
  });

  it("inserts a genuinely new question and skips an unchanged one on the same slide", async () => {
    seedLecture();
    const original = [
      baseSlide({
        id: "S1",
        questions: [{ id: "Q1", question: "Old Q", options: ["a", "b", "c", "d"], correctAnswer: 0 }],
      }),
    ];
    const edited = [
      {
        ...original[0],
        questions: [
          { id: "Q1", question: "Old Q", options: ["a", "b", "c", "d"], correctAnswer: 0 }, // unchanged
          { question: "New Q", options: ["w", "x", "y", "z"], correctAnswer: 2 }, // new, no id
        ],
      },
    ];

    await saveExistingLecture("L1", {
      title: "Old",
      description: "Old desc",
      slides: edited,
      originalSlides: original,
    });

    const questions = supabaseMock.data["quiz_questions"].rows;
    expect(questions).toHaveLength(1);
    expect(questions[0].question_text).toBe("New Q");
  });

  it("updates a question whose content changed", async () => {
    seedLecture();
    supabaseMock.seed("quiz_questions", [
      { id: "Q1", slide_id: "S1", question_text: "Old Q", options: ["a", "b", "c", "d"], correct_answer: 0 },
    ]);
    const original = [
      baseSlide({ id: "S1", questions: [{ id: "Q1", question: "Old Q", options: ["a", "b", "c", "d"], correctAnswer: 0 }] }),
    ];
    const edited = [
      { ...original[0], questions: [{ id: "Q1", question: "Changed Q", options: ["a", "b", "c", "d"], correctAnswer: 0 }] },
    ];

    await saveExistingLecture("L1", {
      title: "Old",
      description: "Old desc",
      slides: edited,
      originalSlides: original,
    });

    expect(supabaseMock.data["quiz_questions"].rows[0].question_text).toBe("Changed Q");
  });

  it("still inserts brand-new (id-less) slides alongside diffed existing ones", async () => {
    seedLecture();
    const original = [baseSlide({ id: "S1" })];
    const edited = [original[0], { title: "New Slide", content: "c", summary: "s", questions: [] }];

    await saveExistingLecture("L1", {
      title: "Old",
      description: "Old desc",
      slides: edited,
      originalSlides: original,
    });

    const titles = supabaseMock.data["slides"].rows.map((r) => r.title);
    expect(titles).toContain("New Slide");
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

describe("enhanceSlide", () => {
  it("posts to the enhance endpoint and returns the enhanced fields", async () => {
    // Served by the default MSW handler for /api/upload/enhance-slide/:id.
    const res = await enhanceSlide("SL1");
    expect(res.ai_enhanced).toBe(true);
    expect(res.title).toBe("Enhanced");
    expect(res.summary).toBe("Summary.");
  });
});
