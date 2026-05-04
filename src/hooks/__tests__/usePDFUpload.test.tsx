/**
 * usePDFUpload hook — duplicate-PDF detection branching.
 *
 * Guards Task #21's contract: when a professor picks a PDF whose
 * SHA-256 already matches one of their lectures, the hook must call the
 * caller-supplied onDuplicate handler INSTEAD of starting the streaming
 * parser. When there is no match (or the lookup fails), it falls back
 * to the normal upload flow with force_reparse omitted; the explicit
 * "Upload as new" path passes force_reparse=true.
 *
 * We stub `fetch` directly rather than going through MSW — the SSE
 * streaming path that startUpload drives interacts badly with jsdom's
 * ReadableStream pipeline and MSW interception, which deadlocks the
 * hook. A direct stub is simpler and lets us assert the exact request
 * URL/body the hook produced.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

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

function makeFile(content = "%PDF-1.4 fake bytes"): File {
  return new File([content], "lecture.pdf", { type: "application/pdf" });
}

function makeChangeEvent(file: File | null) {
  // jsdom won't let us assign FileList directly — fake the minimal shape
  // the hook reads (.files[0] + writable .value).
  return {
    target: {
      files: file ? [file] : [],
      value: "fake-name.pdf",
    },
  } as unknown as React.ChangeEvent<HTMLInputElement>;
}

function renderUpload() {
  return renderHook(() =>
    usePDFUpload({
      setSlides: vi.fn(),
      setActiveSlideIndex: vi.fn(),
      title: "",
      setTitle: vi.fn(),
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePDFUpload duplicate-detection branching", () => {
  it("calls onDuplicate and skips the streaming parser when matches exist", async () => {
    const file = makeFile();
    const matches = [
      { id: "L1", title: "Existing", created_at: "2026-04-01T00:00:00Z", total_slides: 7 },
    ];

    const { calls } = installFetchRouter({
      "/api/upload/check-duplicate": (init) => {
        const body = JSON.parse(init.body as string) as { pdf_hash?: string };
        // SHA-256 of any input is 64 lowercase hex chars.
        expect(body.pdf_hash).toMatch(/^[0-9a-f]{64}$/);
        return new Response(JSON.stringify({ duplicates: matches }), { status: 200 });
      },
      "/api/upload/parse-pdf-stream": () =>
        new Response("err", { status: 500 }),
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
    // Only the duplicate-check call was made — no streaming parse.
    expect(calls.some((c) => c.url.includes("/parse-pdf-stream"))).toBe(false);
    expect(result.current.isUploading).toBe(false);
    // Input value must be cleared so the same file can be re-picked.
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

    // Soft-fail: the 500 turned into "no duplicates" so we proceeded.
    expect(onDuplicate).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.includes("/parse-pdf-stream"))).toBe(true);
  });
});
