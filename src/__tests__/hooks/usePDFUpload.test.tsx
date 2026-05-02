/**
 * Smoke tests for the usePDFUpload SSE consumer hook.
 *
 * The MSW handler in src/test/handlers/index.ts emits a deterministic SSE
 * stream containing one `info`, one `progress`, one `slide`, and one
 * `complete` event. This test asserts the hook walks all four states.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/use-ai-model", () => ({
  useAiModel: () => ({ aiModel: "groq" }),
}));

import { usePDFUpload } from "@/hooks/usePDFUpload";

beforeEach(() => supabaseMock.reset());

describe("usePDFUpload", () => {
  it("walks SSE stream to completion", async () => {
    const setSlides = vi.fn();
    const setActive = vi.fn();
    const setTitle = vi.fn();

    const { result } = renderHook(() =>
      usePDFUpload({
        setSlides,
        setActiveSlideIndex: setActive,
        title: "",
        setTitle,
      }),
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
    // The last phase marker emitted by the MSW stream is "finalize".
    expect(result.current.parsePhase).toBe("finalize");
    // deck_complete payload from MSW handler captured into state
    expect(result.current.deckQuiz).toHaveLength(1);
    expect(result.current.deckQuiz[0].linked_slides).toEqual([0, 1]);
    expect(result.current.deckQuiz[0].concept).toBe("bridging");
    expect(result.current.deckQuiz[0].explanation).toBe("links A and B");

    // After `complete`, the overlay auto-dismisses ~800ms later. Wait for
    // the timer to fire and assert the upload state has been reset.
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
    const { result } = renderHook(() =>
      usePDFUpload({
        setSlides,
        setActiveSlideIndex: vi.fn(),
        title: "",
        setTitle: vi.fn(),
      }),
    );
    const file = new File(["x"], "doc.txt", { type: "text/plain" });
    const e = {
      target: { files: [file], value: "" },
    } as unknown as React.ChangeEvent<HTMLInputElement>;
    await act(async () => {
      await result.current.handleFileUpload(e);
    });
    expect(setSlides).not.toHaveBeenCalled();
  });

  it("rejects oversize files", async () => {
    const setSlides = vi.fn();
    const { result } = renderHook(() =>
      usePDFUpload({
        setSlides,
        setActiveSlideIndex: vi.fn(),
        title: "",
        setTitle: vi.fn(),
      }),
    );
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
    const { result } = renderHook(() =>
      usePDFUpload({
        setSlides: vi.fn(),
        setActiveSlideIndex: vi.fn(),
        title: "",
        setTitle: vi.fn(),
      }),
    );
    act(() => result.current.closeUploadOverlay());
    expect(result.current.isUploading).toBe(false);
    expect(result.current.uploadProgress).toBe(0);
  });
});
