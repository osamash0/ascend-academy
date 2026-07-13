/**
 * Tests for the "Course facts" card on ProfessorCourseDetail (Roadmap Phase 3).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/renderWithProviders";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

vi.mock("@/lib/auth", () => ({
  useAuth: vi.fn(() => ({
    user: { id: "prof-1", email: "prof@test.com" },
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

import ProfessorCourseDetail from "@/pages/ProfessorCourseDetail";

const API = "http://api.test/api/v1";
// getCourse() only queries GET /api/courses/{id} directly for a UUID-shaped
// id; anything else is treated as a slug (extra listCourses/browseCourses
// lookups). Use a real UUID so the direct-fetch path is exercised.
const CID = "c1111111-1111-4111-8111-111111111111";

const COURSE = {
  id: CID,
  professor_id: "prof-1",
  title: "Intro to ML",
  description: null,
  color: null,
  icon: null,
  is_archived: false,
  status: "published",
  created_at: null,
  updated_at: null,
  lecture_count: 0,
  lectures: [],
};

function stubCourse() {
  server.use(
    http.get(`${API}/courses/${CID}`, () => HttpResponse.json({ success: true, data: COURSE })),
  );
}

function renderAtRoute() {
  return renderWithProviders(
    <Routes>
      <Route path="/professor/courses/:courseId" element={<ProfessorCourseDetail />} />
      <Route path="/course/:courseId/study-guide" element={<div>Study Guide Page Stub</div>} />
    </Routes>,
    { initialEntries: [`/professor/courses/${CID}`] },
  );
}

beforeEach(() => supabaseMock.reset());

describe("ProfessorCourseDetail — Course facts card", () => {
  it("shows the empty state when no facts have been extracted yet", async () => {
    stubCourse();
    server.use(
      http.get(`${API}/courses/${CID}/context`, () => HttpResponse.json({ success: true, data: null })),
    );
    renderAtRoute();

    expect(await screen.findByTestId("course-facts-card")).toBeInTheDocument();
    expect(screen.getByText(/no course facts yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add facts/i })).toBeInTheDocument();
  });

  it("renders extracted instructor, grading scheme, and exam dates", async () => {
    stubCourse();
    server.use(
      http.get(`${API}/courses/${CID}/context`, () =>
        HttpResponse.json({
          success: true,
          data: {
            course_id: CID, instructor: "Prof. Ada",
            exam_dates: [{ label: "Midterm", date: "2026-06-01" }],
            syllabus_facts: {}, grading_scheme: "50% exam, 50% homework", updated_at: null,
          },
        }),
      ),
    );
    renderAtRoute();

    expect(await screen.findByText(/Prof\. Ada/)).toBeInTheDocument();
    expect(screen.getByText(/50% exam, 50% homework/)).toBeInTheDocument();
    expect(screen.getByText(/Midterm: 2026-06-01/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });

  it("edits and saves the instructor field", async () => {
    const user = userEvent.setup();
    stubCourse();
    server.use(
      http.get(`${API}/courses/${CID}/context`, () => HttpResponse.json({ success: true, data: null })),
    );

    let receivedBody: unknown;
    server.use(
      http.patch(`${API}/courses/${CID}/context`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            course_id: CID, instructor: "Dr. Grace", exam_dates: [],
            syllabus_facts: {}, grading_scheme: null, updated_at: null,
          },
        });
      }),
    );

    renderAtRoute();
    await screen.findByTestId("course-facts-card");

    await user.click(screen.getByTestId("course-facts-edit"));
    const instructorInput = screen.getByLabelText(/instructor/i);
    await user.type(instructorInput, "Dr. Grace");
    await user.click(screen.getByTestId("course-facts-save"));

    await waitFor(() => expect(screen.getByText(/Dr\. Grace/)).toBeInTheDocument());
    expect(receivedBody).toMatchObject({ instructor: "Dr. Grace" });
  });

  it("adds and removes an exam date row while editing", async () => {
    const user = userEvent.setup();
    stubCourse();
    server.use(
      http.get(`${API}/courses/${CID}/context`, () => HttpResponse.json({ success: true, data: null })),
    );

    renderAtRoute();
    await user.click(await screen.findByTestId("course-facts-edit"));

    await user.click(screen.getByRole("button", { name: /add date/i }));
    expect(screen.getByPlaceholderText(/label \(e\.g\. midterm\)/i)).toBeInTheDocument();

    await user.click(screen.getByTitle("Remove"));
    expect(screen.queryByPlaceholderText(/label \(e\.g\. midterm\)/i)).not.toBeInTheDocument();
  });
});

function stubEmptyCourseContext() {
  server.use(
    http.get(`${API}/courses/${CID}/context`, () => HttpResponse.json({ success: true, data: null })),
  );
}

describe("ProfessorCourseDetail — Study guide card", () => {
  // The card is a thin entry point to the dedicated /course/:id/study-guide
  // page (src/pages/StudyGuide.tsx), which owns generation/regeneration/
  // printing — no need to stub GET .../study-guide here at all.

  it("renders an entry point to the study guide", async () => {
    stubCourse();
    stubEmptyCourseContext();
    renderAtRoute();

    expect(await screen.findByTestId("study-guide-card")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open study guide/i })).toBeInTheDocument();
  });

  it("navigates to the course's study guide page on click", async () => {
    const user = userEvent.setup();
    stubCourse();
    stubEmptyCourseContext();
    renderAtRoute();

    await user.click(await screen.findByTestId("study-guide-open"));

    expect(await screen.findByText("Study Guide Page Stub")).toBeInTheDocument();
  });
});
