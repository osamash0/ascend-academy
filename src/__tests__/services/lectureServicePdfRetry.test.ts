/**
 * M22: `resolvePdfUrl` retries a transient (5xx) signed-URL failure a couple
 * of times before giving up, but fails fast on what looks like a permanent
 * 4xx (missing/forbidden object) instead of retrying forever.
 *
 * Isolated from the shared supabase mock (`sharedSupabaseMock`) because that
 * mock's `storage.from()` doesn't model `createSignedUrl` at all -- a local,
 * single-purpose mock keeps this test focused and doesn't risk changing
 * behavior for every other suite that imports the shared mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createSignedUrl = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({ createSignedUrl }),
    },
  },
}));

import { resolvePdfUrl } from "@/services/lectureService";

function storageError(status: number, message = "boom") {
  return { message, status };
}

beforeEach(() => {
  createSignedUrl.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolvePdfUrl retry (M22)", () => {
  it("returns null immediately for a null/empty pdf_url without calling the API", async () => {
    expect(await resolvePdfUrl(null)).toBeNull();
    expect(await resolvePdfUrl(undefined)).toBeNull();
    expect(await resolvePdfUrl("")).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("returns the signed URL on the first successful attempt", async () => {
    createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: "https://x/1.pdf" }, error: null });
    const url = await resolvePdfUrl("lectures/L1/file.pdf");
    expect(url).toBe("https://x/1.pdf");
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 503 and succeeds on the next attempt", async () => {
    createSignedUrl
      .mockResolvedValueOnce({ data: null, error: storageError(503) })
      .mockResolvedValueOnce({ data: { signedUrl: "https://x/2.pdf" }, error: null });

    const url = await resolvePdfUrl("lectures/L2/file.pdf");

    expect(url).toBe("https://x/2.pdf");
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it("gives up after repeated transient failures and returns null instead of retrying forever", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: storageError(503) });

    const url = await resolvePdfUrl("lectures/L3/file.pdf");

    expect(url).toBeNull();
    // Bounded: exactly the configured attempt budget, not unbounded retrying.
    expect(createSignedUrl.mock.calls.length).toBeGreaterThan(1);
    expect(createSignedUrl.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("does not retry a permanent 404 (missing object)", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: storageError(404, "Object not found") });

    const url = await resolvePdfUrl("lectures/L4/file.pdf");

    expect(url).toBeNull();
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a permanent 403 (forbidden)", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: storageError(403, "Forbidden") });

    const url = await resolvePdfUrl("lectures/L5/file.pdf");

    expect(url).toBeNull();
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("serves a cached URL without re-signing on a later call for the same object", async () => {
    createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: "https://x/6.pdf" }, error: null });
    await resolvePdfUrl("lectures/L6/file.pdf");
    expect(createSignedUrl).toHaveBeenCalledTimes(1);

    const cached = await resolvePdfUrl("lectures/L6/file.pdf");
    expect(cached).toBe("https://x/6.pdf");
    expect(createSignedUrl).toHaveBeenCalledTimes(1); // no additional call
  });

  it("bypasses the cache and mints a fresh token when forceRefresh is set (manual retry)", async () => {
    createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: "https://x/7.pdf" }, error: null });
    const first = await resolvePdfUrl("lectures/L7/file.pdf");
    expect(first).toBe("https://x/7.pdf");

    createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: "https://x/7-fresh.pdf" }, error: null });
    const fresh = await resolvePdfUrl("lectures/L7/file.pdf", { forceRefresh: true });

    expect(fresh).toBe("https://x/7-fresh.pdf");
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });
});
