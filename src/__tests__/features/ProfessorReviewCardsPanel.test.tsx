/**
 * Tests for ProfessorReviewCardsPanel (Roadmap Phase 4.1 — professor
 * visibility/control over auto-generated SRS review cards).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/renderWithProviders";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

import { ProfessorReviewCardsPanel } from "@/features/review/ProfessorReviewCardsPanel";

beforeEach(() => supabaseMock.reset());

const API = "http://api.test/api/v1";

describe("ProfessorReviewCardsPanel", () => {
  it("shows an empty state when the lecture has no cards yet", async () => {
    server.use(
      http.get(`${API}/review/lecture/lec-1/cards`, () =>
        HttpResponse.json({ cards: [], total: 0 }),
      ),
    );
    renderWithProviders(<ProfessorReviewCardsPanel lectureId="lec-1" />);

    expect(await screen.findByText(/no review cards yet/i)).toBeInTheDocument();
  });

  it("lists cards and shows the visible/total count", async () => {
    server.use(
      http.get(`${API}/review/lecture/lec-1/cards`, () =>
        HttpResponse.json({
          total: 2,
          cards: [
            { card_id: "c1", source_type: "quiz_question", front: { question: "What is gradient descent?" }, back: {}, concept_id: null, hidden: false },
            { card_id: "c2", source_type: "quiz_question", front: { question: "Define overfitting" }, back: {}, concept_id: null, hidden: true },
          ],
        }),
      ),
    );
    renderWithProviders(<ProfessorReviewCardsPanel lectureId="lec-1" />);

    expect(await screen.findByText(/what is gradient descent\?/i)).toBeInTheDocument();
    expect(screen.getByText(/define overfitting/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 cards? visible/i)).toBeInTheDocument();
  });

  it("hides a visible card and updates the count", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API}/review/lecture/lec-1/cards`, () =>
        HttpResponse.json({
          total: 1,
          cards: [
            { card_id: "c1", source_type: "quiz_question", front: { question: "What is gradient descent?" }, back: {}, concept_id: null, hidden: false },
          ],
        }),
      ),
      http.post(`${API}/review/cards/c1/hide`, () =>
        HttpResponse.json({ card_id: "c1", hidden: true }),
      ),
    );
    renderWithProviders(<ProfessorReviewCardsPanel lectureId="lec-1" />);

    await screen.findByText(/what is gradient descent\?/i);
    await user.click(screen.getByRole("button", { name: /^hide$/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /^unhide$/i })).toBeInTheDocument());
    expect(screen.getByText(/0 of 1 card visible/i)).toBeInTheDocument();
  });

  it("unhides a hidden card", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API}/review/lecture/lec-1/cards`, () =>
        HttpResponse.json({
          total: 1,
          cards: [
            { card_id: "c1", source_type: "quiz_question", front: { question: "What is gradient descent?" }, back: {}, concept_id: null, hidden: true },
          ],
        }),
      ),
      http.post(`${API}/review/cards/c1/unhide`, () =>
        HttpResponse.json({ card_id: "c1", hidden: false }),
      ),
    );
    renderWithProviders(<ProfessorReviewCardsPanel lectureId="lec-1" />);

    await screen.findByRole("button", { name: /^unhide$/i });
    await user.click(screen.getByRole("button", { name: /^unhide$/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /^hide$/i })).toBeInTheDocument());
    expect(screen.getByText(/1 of 1 card visible/i)).toBeInTheDocument();
  });
});
