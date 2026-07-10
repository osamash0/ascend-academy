import { http, HttpResponse } from "msw";

const API = "http://api.test";

/**
 * Route helper that registers each endpoint at BOTH `/api/...` and
 * `/api/v1/...`.
 *
 * The frontend has two URL conventions in play after the backend restructure:
 *   - `apiClient` rewrites every `/api/...` path to `/api/v1/...`.
 *   - A handful of services/hooks (concepts, upload/*, tts) still `fetch`
 *     raw `/api/...` URLs directly, bypassing the rewrite.
 * Registering both variants keeps these shared default handlers tolerant of
 * either convention, so a test does not silently break depending on which
 * code path its consumer uses.
 */
type Resolver = Parameters<typeof http.get>[1];
const v1 = (path: string) => path.replace(/(^.*)\/api\//, "$1/api/v1/");
const dual = (
  method: "get" | "post",
  path: string,
  resolver: Resolver,
) => [http[method](path, resolver), http[method](v1(path), resolver)];

export const defaultHandlers = [
  // ── Analytics ─────────────────────────────────────────────────────────────
  ...dual("get", `${API}/api/analytics/lecture/:id/overview`, () =>
    HttpResponse.json({
      success: true,
      data: {
        total_students: 42,
        completion_rate: 75.5,
        average_score: 82.3,
        average_time_minutes: 14.2,
        engagement_level: "Medium",
      },
    }),
  ),
  ...dual("get", `${API}/api/analytics/lecture/:id/slides`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          slide_number: 1,
          title: "Intro",
          view_count: 30,
          average_time_seconds: 12.5,
          drop_off_rate: 5.0,
        },
      ],
    }),
  ),
  ...dual("get", `${API}/api/analytics/lecture/:id/students`, () =>
    HttpResponse.json({
      success: true,
      data: [
        {
          student_id: "s1",
          student_name: "Nexus-ABCD",
          progress_percentage: 80,
          quiz_score: 90,
          typology: "Natural Comprehension",
          ai_interactions: 1,
          revisions: 0,
        },
      ],
    }),
  ),
  ...dual("get", `${API}/api/analytics/lecture/:id/dashboard`, () =>
    HttpResponse.json({
      success: true,
      data: {
        overview: {},
        slidePerformance: [],
        studentsMatrix: [],
        confidenceMap: { got_it: 0, unsure: 0, confused: 0 },
      },
    }),
  ),
  ...dual("get", `${API}/api/analytics/lecture/:id/dropoff`, () =>
    HttpResponse.json({ success: true, data: [] }),
  ),
  ...dual("get", `${API}/api/analytics/lecture/:id/distractors`, () =>
    HttpResponse.json({ success: true, data: [] }),
  ),
  ...dual("get", `${API}/api/analytics/lecture/:id/ai-queries`, () =>
    HttpResponse.json({ success: true, data: [] }),
  ),
  ...dual("get", `${API}/api/analytics/lecture/:id/confidence-by-slide`, () =>
    HttpResponse.json({ success: true, data: [] }),
  ),

  // ── AI generation ─────────────────────────────────────────────────────────
  ...dual("post", `${API}/api/ai/generate-summary`, () =>
    HttpResponse.json({ summary: "Test summary." }),
  ),
  ...dual("post", `${API}/api/ai/generate-quiz`, () =>
    HttpResponse.json({
      question: "What is 2+2?",
      options: ["3", "4", "5", "6"],
      correctAnswer: 1,
    }),
  ),
  ...dual("post", `${API}/api/ai/chat`, () =>
    HttpResponse.json({ reply: "Test reply.", citations: [] }),
  ),
  ...dual("post", `${API}/api/upload/attach-lecture`, () =>
    HttpResponse.json({ updated: 0 }),
  ),
  ...dual("get", `${API}/api/upload/config`, () =>
    HttpResponse.json({ maxUploadMb: 50, acceptedExtensions: [".pdf", ".pptx"] }),
  ),
  ...dual("post", `${API}/api/upload/enhance-slide/:slideId`, () =>
    HttpResponse.json({ slide_id: "s1", title: "Enhanced", summary: "Summary.", ai_enhanced: true }),
  ),
  ...dual("post", `${API}/api/ai/analytics-insights`, () =>
    HttpResponse.json({ summary: "Insight.", suggestions: ["Try X"] }),
  ),

  // ── Mind map ──────────────────────────────────────────────────────────────
  ...dual("get", `${API}/api/mind-map/:id`, () =>
    HttpResponse.json({ success: true, data: null }),
  ),
  ...dual("post", `${API}/api/mind-map/:id/generate`, () =>
    HttpResponse.json({
      success: true,
      data: {
        id: "root",
        label: "Root",
        type: "root",
        children: [
          {
            id: "cluster-1",
            label: "Topic A",
            type: "cluster",
            children: [
              { id: "slide-1", label: "Slide 1", type: "slide" },
            ],
          },
        ],
      },
      schema_version: 2,
    }),
  ),

  // ── Streaming PDF parse ───────────────────────────────────────────────────
  ...dual("post", `${API}/api/upload/parse-pdf-stream`, () => {
    const body =
      [
        `data: ${JSON.stringify({ type: "info", parser: "pymupdf" })}\n\n`,
        `data: ${JSON.stringify({ type: "phase", phase: "extract" })}\n\n`,
        `data: ${JSON.stringify({ type: "progress", current: 0, total: 1, message: "Parsing..." })}\n\n`,
        `data: ${JSON.stringify({ type: "phase", phase: "enhance" })}\n\n`,
        `data: ${JSON.stringify({
          type: "slide",
          index: 0,
          slide: {
            title: "Slide 1",
            content: "Body",
            summary: "Sum",
            questions: [
              { question: "Q?", options: ["a", "b", "c", "d"], correctAnswer: 0 },
            ],
          },
        })}\n\n`,
        `data: ${JSON.stringify({
          type: "deck_complete",
          deck_summary: "deck sum",
          deck_quiz: [
            {
              question: "Cross Q?",
              options: ["a", "b", "c", "d"],
              correctAnswer: 1,
              concept: "bridging",
              explanation: "links A and B",
              linked_slides: [0, 1],
            },
          ],
          total_slides: 1,
        })}\n\n`,
        `data: ${JSON.stringify({ type: "phase", phase: "finalize" })}\n\n`,
        `data: ${JSON.stringify({ type: "complete", total: 1 })}\n\n`,
      ].join("");
    return new HttpResponse(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }),

  // ── Courses ───────────────────────────────────────────────────────────────
  ...dual("get", `${API}/api/courses`, () =>
    HttpResponse.json({
      success: true,
      data: [],
    }),
  ),
  ...dual("get", `${API}/api/courses/browse`, () =>
    HttpResponse.json({
      success: true,
      data: [],
    }),
  ),
  ...dual("post", `${API}/api/courses/:id/enroll`, () =>
    HttpResponse.json({
      success: true,
      data: { enrolled: true },
    }),
  ),

  // ── Assignments ───────────────────────────────────────────────────────────
  ...dual("get", `${API}/api/assignments`, () =>
    HttpResponse.json({
      success: true,
      data: [],
    }),
  ),
  ...dual("get", `${API}/api/assignments/_meta/students`, () =>
    HttpResponse.json({
      success: true,
      data: [],
    }),
  ),

  // ── Worksheets & Practice Sheets ──────────────────────────────────────────
  ...dual("get", `${API}/api/lectures/:id/worksheets`, () =>
    HttpResponse.json({
      success: true,
      data: [],
    }),
  ),
  ...dual("get", `${API}/api/lectures/:id/practice-sheets`, () =>
    HttpResponse.json({
      success: true,
      data: [],
    }),
  ),

  // ── Concepts ──────────────────────────────────────────────────────────────
  ...dual("get", `http://localhost:8000/api/concepts/lecture/:id`, () =>
    HttpResponse.json({
      success: true,
      data: [],
    }),
  ),
  ...dual("get", `${API}/api/concepts/lecture/:id`, () =>
    HttpResponse.json({
      success: true,
      data: [],
    }),
  ),
];
