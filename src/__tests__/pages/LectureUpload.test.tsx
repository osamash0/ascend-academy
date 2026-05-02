import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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
  const fetchMock = vi.fn();

  beforeEach(() => {
    navigateMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    // Auth header lookup goes through supabase.auth.getSession; the
    // shared mock returns { data: { session: null } } by default which
    // is enough — the hook just sends `Bearer undefined` and we don't
    // assert on it here.
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          duplicates: [
            { id: "lec-newest", title: "Calc Week 3", created_at: "2026-04-20T00:00:00Z", total_slides: 12 },
            { id: "lec-older", title: "Calc Week 2", created_at: "2026-04-13T00:00:00Z", total_slides: 9 },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
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
    // No parse-pdf-stream call should have been made — only the
    // duplicate-check call (1 total fetch).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/check-duplicate/);
  });

  it("re-parses with force_reparse=true when 'Upload as new' is clicked", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          duplicates: [
            { id: "lec-newest", title: "Calc Week 3", created_at: "2026-04-20T00:00:00Z", total_slides: 12 },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    // Stub the parse-pdf-stream call with an empty SSE stream that
    // closes immediately so the hook doesn't hang.
    const emptyStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(emptyStream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
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

    // Wait for the second fetch (parse-pdf-stream) to fire.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toMatch(/parse-pdf-stream/);
    const formData = init.body as FormData;
    expect(formData.get("force_reparse")).toBe("true");
    // Navigation should NOT happen — we're staying on the upload page.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("opens the parse-cache dialog and uses saved parse without force_reparse", async () => {
    // 1) check-duplicate → no lecture matches.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ duplicates: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    // 2) check-parse-cache → cached parse exists.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ cached: true, parsed_at: "2026-04-15T12:00:00Z" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    // 3) parse-pdf-stream stub — empty SSE that closes immediately.
    const emptyStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(emptyStream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    renderWithProviders(<LectureUpload />, {
      initialEntries: ["/professor/upload"],
    });

    pickPdf();

    // Parse-cache dialog appears (NOT the lectures-duplicate dialog).
    await waitFor(() =>
      expect(screen.getByText(/parsed this PDF before/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/uploaded this PDF before/i)).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /use saved parse/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [url, init] = fetchMock.mock.calls[2];
    expect(String(url)).toMatch(/parse-pdf-stream/);
    const formData = init.body as FormData;
    // "Use saved parse" must NOT force a re-parse — the backend then
    // serves the cached payload via SSE. The hook omits the field
    // entirely when forceReparse is falsy; the backend defaults to
    // force_reparse=false so the cache short-circuit fires.
    expect(formData.get("force_reparse")).not.toBe("true");
  });

  it("re-parses with force_reparse=true when 'Generate fresh' is clicked", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ duplicates: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ cached: true, parsed_at: "2026-04-15T12:00:00Z" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const emptyStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(emptyStream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    renderWithProviders(<LectureUpload />, {
      initialEntries: ["/professor/upload"],
    });

    pickPdf();
    await waitFor(() =>
      expect(screen.getByText(/parsed this PDF before/i)).toBeInTheDocument(),
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /generate fresh/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [url, init] = fetchMock.mock.calls[2];
    expect(String(url)).toMatch(/parse-pdf-stream/);
    const formData = init.body as FormData;
    expect(formData.get("force_reparse")).toBe("true");
  });

  it("skips the parse-cache dialog when nothing is cached", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ duplicates: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ cached: false, parsed_at: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const emptyStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(emptyStream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    renderWithProviders(<LectureUpload />, {
      initialEntries: ["/professor/upload"],
    });

    pickPdf();

    // Wait until parse-pdf-stream fires — no dialog should appear.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.queryByText(/parsed this PDF before/i)).toBeNull();
    expect(screen.queryByText(/uploaded this PDF before/i)).toBeNull();
  });

  it("dismisses the dialog and does not upload when 'Cancel' is clicked", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          duplicates: [
            { id: "lec-newest", title: "Calc Week 3", created_at: "2026-04-20T00:00:00Z", total_slides: 12 },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
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
    // Only the duplicate-check call — no parse-pdf-stream.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
