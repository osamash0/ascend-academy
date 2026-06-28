/**
 * usePDFUpload hook tests (consolidated).
 *
 * Two complementary suites for the same hook, merged here from the former
 * duplicate at src/hooks/__tests__/usePDFUpload.test.tsx:
 *
 *  1. "SSE consumer" — drives the MSW stream (info/progress/slide/deck_complete/
 *     complete) and asserts the hook walks every phase, captures the deck quiz,
 *     and auto-dismisses; plus client-side file validation + overlay reset.
 *  2. "duplicate-detection branching" — stubs fetch directly (the SSE path
 *     deadlocks under MSW + jsdom's ReadableStream) to assert the dedupe flow:
 *     onDuplicate short-circuits the parse; no/failed match falls back to a
 *     normal upload; "Upload as new" sends force_reparse=true.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

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

import { usePDFUpload } from "@/hooks/usePDFUpload";

beforeEach(() => supabaseMock.reset());
afterEach(() => vi.unstubAllGlobals());

// ── shared helpers ────────────────────────────────────────────────────────────

function makeFile(content = "%PDF-1.4 fake bytes"): File {
  return new File([content], "lecture.pdf", { type: "application/pdf" });
}

function makeChangeEvent(file: File | null) {
  // jsdom won't let us assign a real FileList — fake the minimal shape the hook
  // reads (.files[0] + a writable .value it clears after handling).
  return {
    target: { files: file ? [file] : [], value: "fake-name.pdf" },
  } as unknown as React.ChangeEvent<HTMLInputElement>;
}

function renderUpload(overrides: Record<string, unknown> = {}) {
  return renderHook(() =>
    usePDFUpload({
      setSlides: vi.fn(),
      setActiveSlideIndex: vi.fn(),
      title: "",
      setTitle: vi.fn(),
      ...overrides,
    }),
  );
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function installFetchRouter(
  routes: Record<string, (init: RequestInit) => Response | Promise<Response>>,
) {
  const calls: FetchCall[] = [];
  const spy = vi.fn(async (input: RequestInfo, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    calls.push({ url, init });
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) return handler(init);
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", spy);
  return { calls, spy };
}

// ── 1. SSE consumer + validation (MSW-driven) ─────────────────────────────────

describe("usePDFUpload", () => {
  it("walks SSE stream to completion", async () => {
    const setSlides = vi.fn();
    const setActive = vi.fn();
    const setTitle = vi.fn();

    const { result } = renderHook(() =>
      usePDFUpload({ setSlides, setActiveSlideIndex: setActive, title: "", setTitle }),
    );

    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "doc.pdf", {
      type: "application/pdf",
    });
    const e = {
      target: { files: [file], value: "" },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await result.current.handleFileUpload(e);
    });

    await waitFor(() => {
      expect(setSlides).toHaveBeenCalled();
    });
    expect(setActive).toHaveBeenCalledWith(0);
    expect(setTitle).toHaveBeenCalled();
    expect(result.current.parserUsed).toBe("pymupdf");
    expect(result.current.parsePhase).toBe("finalize");
    expect(result.current.deckQuiz).toHaveLength(1);
    expect(result.current.deckQuiz[0].linked_slides).toEqual([0, 1]);
    expect(result.current.deckQuiz[0].concept).toBe("bridging");
    expect(result.current.deckQuiz[0].explanation).toBe("links A and B");

    // After `complete`, the overlay auto-dismisses ~800ms later.
    await waitFor(
      () => {
        expect(result.current.isUploading).toBe(false);
      },
      { timeout: 2000 },
    );
    expect(result.current.parserUsed).toBeNull();
    expect(result.current.parsePhase).toBeNull();
  });

  it("rejects non-PDF files", async () => {
    const setSlides = vi.fn();
    const { result } = renderUpload({ setSlides });
    const file = new File(["x"], "doc.txt", { type: "text/plain" });
    await act(async () => {
      await result.current.handleFileUpload(makeChangeEvent(file));
    });
    expect(setSlides).not.toHaveBeenCalled();
  });

  it("rejects oversize files", async () => {
    const setSlides = vi.fn();
    const { result } = renderUpload({ setSlides });
    const big = new File([new Uint8Array(51 * 1024 * 1024)], "big.pdf", {
      type: "application/pdf",
    });
    const e = {
      target: { files: [big], value: "" },
    } as unknown as React.ChangeEvent<HTMLInputElement>;
    await act(async () => {
      await result.current.handleFileUpload(e);
    });
    expect(setSlides).not.toHaveBeenCalled();
  });

  it("closeUploadOverlay resets state", () => {
    const { result } = renderUpload();
    act(() => result.current.closeUploadOverlay());
    expect(result.current.isUploading).toBe(false);
    expect(result.current.uploadProgress).toBe(0);
  });
});

// ── 2. Duplicate-detection branching (direct fetch stub) ──────────────────────

describe("usePDFUpload duplicate-detection branching", () => {
  it("calls onDuplicate and skips the streaming parser when matches exist", async () => {
    const file = makeFile();
    const matches = [
      { id: "L1", title: "Existing", created_at: "2026-04-01T00:00:00Z", total_slides: 7 },
    ];

    const { calls } = installFetchRouter({
      "/api/upload/check-duplicate": (init) => {
        const body = JSON.parse(init.body as string) as { pdf_hash?: string };
        expect(body.pdf_hash).toMatch(/^[0-9a-f]{64}$/);
        return new Response(JSON.stringify({ duplicates: matches }), { status: 200 });
      },
      "/api/upload/parse-pdf-stream": () => new Response("err", { status: 500 }),
    });

    const onDuplicate = vi.fn();
    const { result } = renderUpload();

    const event = makeChangeEvent(file);
    await act(async () => {
      await result.current.handleFileUpload(event, { onDuplicate });
    });

    expect(onDuplicate).toHaveBeenCalledTimes(1);
    const [passedFile, passedMatches, passedHash] = onDuplicate.mock.calls[0];
    expect(passedFile).toBe(file);
    expect(passedMatches).toEqual(matches);
    expect(passedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(calls.some((c) => c.url.includes("/parse-pdf-stream"))).toBe(false);
    expect(result.current.isUploading).toBe(false);
    expect(event.target.value).toBe("");
  });

  it("falls back to startUpload (no force_reparse) when no duplicates are returned", async () => {
    const file = makeFile();

    let receivedFD: FormData | null = null;
    installFetchRouter({
      "/api/upload/check-duplicate": () =>
        new Response(JSON.stringify({ duplicates: [] }), { status: 200 }),
      "/api/upload/parse-pdf-stream": (init) => {
        receivedFD = init.body as FormData;
        return new Response("err", { status: 500 });
      },
    });

    const onDuplicate = vi.fn();
    const { result } = renderUpload();

    await act(async () => {
      await result.current.handleFileUpload(makeChangeEvent(file), { onDuplicate });
    });

    expect(onDuplicate).not.toHaveBeenCalled();
    expect(receivedFD).not.toBeNull();
    expect(receivedFD!.get("force_reparse")).toBeNull();
    expect(receivedFD!.get("ai_model")).toBe("groq");
  });

  it("startUpload(file, {forceReparse:true}) sends force_reparse=true", async () => {
    const file = makeFile();

    let receivedFD: FormData | null = null;
    installFetchRouter({
      "/api/upload/parse-pdf-stream": (init) => {
        receivedFD = init.body as FormData;
        return new Response("err", { status: 500 });
      },
    });

    const { result } = renderUpload();
    await act(async () => {
      await result.current.startUpload(file, { forceReparse: true });
    });

    expect(receivedFD).not.toBeNull();
    expect(receivedFD!.get("force_reparse")).toBe("true");
  });

  it("falls back to a normal upload when the duplicate-check endpoint errors", async () => {
    const file = makeFile();

    const { calls } = installFetchRouter({
      "/api/upload/check-duplicate": () =>
        new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
      "/api/upload/parse-pdf-stream": () => new Response("err", { status: 500 }),
    });

    const onDuplicate = vi.fn();
    const { result } = renderUpload();
    await act(async () => {
      await result.current.handleFileUpload(makeChangeEvent(file), { onDuplicate });
    });

    expect(onDuplicate).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.includes("/parse-pdf-stream"))).toBe(true);
  });
});
