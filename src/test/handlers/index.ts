import { http, HttpResponse } from "msw";

const API = "http://api.test";

export const defaultHandlers = [
  // ── Analytics ─────────────────────────────────────────────────────────────
  http.get(`${API}/api/analytics/lecture/:id/overview`, () =>
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
  http.get(`${API}/api/analytics/lecture/:id/slides`, () =>
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
  http.get(`${API}/api/analytics/lecture/:id/students`, () =>
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
  http.get(`${API}/api/analytics/lecture/:id/dashboard`, () =>
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
  http.get(`${API}/api/analytics/lecture/:id/dropoff`, () =>
    HttpResponse.json({ success: true, data: [] }),
  ),
  http.get(`${API}/api/analytics/lecture/:id/distractors`, () =>
    HttpResponse.json({ success: true, data: [] }),
  ),
  http.get(`${API}/api/analytics/lecture/:id/ai-queries`, () =>
    HttpResponse.json({ success: true, data: [] }),
  ),
  http.get(`${API}/api/analytics/lecture/:id/confidence-by-slide`, () =>
    HttpResponse.json({ success: true, data: [] }),
  ),

  // ── AI generation ─────────────────────────────────────────────────────────
  http.post(`${API}/api/ai/generate-summary`, () =>
    HttpResponse.json({ summary: "Test summary." }),
  ),
  http.post(`${API}/api/ai/generate-quiz`, () =>
    HttpResponse.json({
      question: "What is 2+2?",
      options: ["3", "4", "5", "6"],
      correctAnswer: 1,
    }),
  ),
  http.post(`${API}/api/ai/chat`, () => HttpResponse.json({ reply: "Test reply." })),
  http.post(`${API}/api/ai/analytics-insights`, () =>
    HttpResponse.json({ summary: "Insight.", suggestions: ["Try X"] }),
  ),

  // ── Mind map ──────────────────────────────────────────────────────────────
  http.get(`${API}/api/mind-map/:id`, () =>
    HttpResponse.json({ success: true, data: null }),
  ),
  http.post(`${API}/api/mind-map/:id/generate`, () =>
    HttpResponse.json({
      success: true,
      data: { name: "Root", children: [{ name: "Topic A" }] },
    }),
  ),

  // ── Streaming PDF parse ───────────────────────────────────────────────────
  http.post(`${API}/api/upload/parse-pdf-stream`, () => {
    const body =
      [
        `data: ${JSON.stringify({ type: "info", parser: "pymupdf" })}\n\n`,
        `data: ${JSON.stringify({ type: "progress", current: 0, total: 1, message: "Parsing..." })}\n\n`,
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
        `data: ${JSON.stringify({ type: "complete", total: 1 })}\n\n`,
      ].join("");
    return new HttpResponse(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }),
];
