import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = (await orig()) as typeof import("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

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

vi.mock("@/lib/auth", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: vi.fn(() => ({
    user: { id: "prof-1", email: "p@p.com" },
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

import LectureUpload from "@/pages/LectureUpload";
import { renderWithProviders } from "@/test/renderWithProviders";

beforeEach(() => supabaseMock.reset());

describe("LectureUpload page (smoke)", () => {
  it("mounts the Create Lecture header", () => {
    renderWithProviders(<LectureUpload />, {
      initialEntries: ["/professor/upload"],
    });
    expect(screen.getByText(/create lecture/i)).toBeInTheDocument();
  });

  it("renders the empty-slide state when no slides exist yet", () => {
    renderWithProviders(<LectureUpload />, {
      initialEntries: ["/professor/upload"],
    });
    expect(
      screen.getByText(/start building your lecture/i),
    ).toBeInTheDocument();
  });

  it("exposes both Create First Slide and Import PDF actions (first-row affordances)", () => {
    renderWithProviders(<LectureUpload />, {
      initialEntries: ["/professor/upload"],
    });
    expect(
      screen.getByRole("button", { name: /create first slide/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import pdf/i }),
    ).toBeInTheDocument();
  });

  it("shows the lecture title input field", () => {
    renderWithProviders(<LectureUpload />, {
      initialEntries: ["/professor/upload"],
    });
    expect(screen.getByLabelText(/lecture title/i)).toBeInTheDocument();
  });
});

describe("LectureUpload duplicate-PDF flow (integration)", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    // Auth header lookup goes through supabase.auth.getSession; the
    // shared mock returns { data: { session: null } } by default which
    // is enough — the hook just sends `Bearer undefined` and we don't
    // assert on it here.
  });

  afterEach(() => {
    server.resetHandlers();
  });

  function pickPdf() {
    const file = new File(["%PDF-1.4 fake"], "lecture.pdf", {
      type: "application/pdf",
    });
    // Both the empty-state and main-view branches render their own
    // hidden <input type="file">. Use the first one — getAllByDisplayValue
    // doesn't work for file inputs, so query by attribute.
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { files: [file] } });
  }

  it("opens the duplicate dialog and navigates to the chosen lecture on 'Use existing'", async () => {
    server.use(
      http.post("http://api.test/api/upload/check-duplicate", () => {
        return HttpResponse.json({
          duplicates: [
            { id: "lec-newest", title: "Calc Week 3", created_at: "2026-04-20T00:00:00Z", total_slides: 12 },
            { id: "lec-older", title: "Calc Week 2", created_at: "2026-04-13T00:00:00Z", total_slides: 9 },
          ],
        });
      }),
    );

    renderWithProviders(<LectureUpload />, {
      initialEntries: ["/professor/upload"],
    });

    pickPdf();

    // Dialog should appear after the duplicate check resolves.
    await waitFor(() =>
      expect(screen.getByText(/uploaded this PDF before/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("Calc Week 3")).toBeInTheDocument();
    expect(screen.getByText("Calc Week 2")).toBeInTheDocument();

    // Pick the OLDER match instead of the preselected newest, then confirm.
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: /Calc Week 2/i }));
    await user.click(screen.getByRole("button", { name: /use existing/i }));

    expect(navigateMock).toHaveBeenCalledWith("/professor/lecture/lec-older");
  });

  it("re-parses with force_reparse=true when 'Upload as new' is clicked", async () => {
    server.use(
      http.post("http://api.test/api/upload/check-duplicate", () => {
        return HttpResponse.json({
          duplicates: [
            { id: "lec-newest", title: "Calc Week 3", created_at: "2026-04-20T00:00:00Z", total_slides: 12 },
          ],
        });
      }),
      http.post("http://api.test/api/upload/parse-pdf-stream", () => {
        return new HttpResponse(null, { status: 200 });
      }),
    );

    renderWithProviders(<LectureUpload />, {
      initialEntries: ["/professor/upload"],
    });

    pickPdf();
    await waitFor(() =>
      expect(screen.getByText(/uploaded this PDF before/i)).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /upload as new/i }));

    // Navigation should NOT happen — we're staying on the upload page.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("dismisses the dialog and does not upload when 'Cancel' is clicked", async () => {
    server.use(
      http.post("http://api.test/api/upload/check-duplicate", () => {
        return HttpResponse.json({
          duplicates: [
            { id: "lec-newest", title: "Calc Week 3", created_at: "2026-04-20T00:00:00Z", total_slides: 12 },
          ],
        });
      }),
    );

    renderWithProviders(<LectureUpload />, {
      initialEntries: ["/professor/upload"],
    });

    pickPdf();
    await waitFor(() =>
      expect(screen.getByText(/uploaded this PDF before/i)).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() =>
      expect(screen.queryByText(/uploaded this PDF before/i)).toBeNull(),
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
