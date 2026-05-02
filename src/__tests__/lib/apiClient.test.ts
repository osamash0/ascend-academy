import { beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

import { apiClient } from "@/lib/apiClient";

beforeEach(() => supabaseMock.reset());

describe("apiClient", () => {
  it("attaches Bearer token from session", async () => {
    server.use(
      http.get("http://api.test/api/echo", ({ request }) => {
        return HttpResponse.json({ auth: request.headers.get("authorization") });
      }),
    );
    const out: any = await apiClient.get("/api/echo");
    expect(out.auth).toBe("Bearer test-token");
  });

  it("throws Unauthenticated when no session", async () => {
    supabaseMock.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    await expect(apiClient.get("/api/echo")).rejects.toThrow(/Unauthenticated/);
  });

  it("converts non-2xx to thrown Error containing status + path", async () => {
    server.use(
      http.get("http://api.test/api/boom", () =>
        new HttpResponse("internal", { status: 500 }),
      ),
    );
    await expect(apiClient.get("/api/boom")).rejects.toThrow(/500/);
  });

  it("POST sends JSON body", async () => {
    server.use(
      http.post("http://api.test/api/items", async ({ request }) => {
        const body = await request.json();
        return HttpResponse.json({ received: body });
      }),
    );
    const out: any = await apiClient.post("/api/items", { x: 1 });
    expect(out.received).toEqual({ x: 1 });
  });

  it("PUT works", async () => {
    server.use(
      http.put("http://api.test/api/items/1", () => HttpResponse.json({ ok: true })),
    );
    const out: any = await apiClient.put("/api/items/1", { x: 2 });
    expect(out.ok).toBe(true);
  });

  it("DELETE works", async () => {
    server.use(
      http.delete("http://api.test/api/items/1", () => HttpResponse.json({ deleted: 1 })),
    );
    const out: any = await apiClient.delete("/api/items/1");
    expect(out.deleted).toBe(1);
  });

  it("stream returns the raw Response", async () => {
    server.use(
      http.post("http://api.test/api/stream", () =>
        new HttpResponse("data: x\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    );
    const res = await apiClient.stream("/api/stream", { x: 1 });
    expect(res.ok).toBe(true);
    const txt = await res.text();
    expect(txt).toContain("data: x");
  });

  it("stream throws on 500", async () => {
    server.use(
      http.post("http://api.test/api/streambad", () =>
        new HttpResponse("nope", { status: 500 }),
      ),
    );
    await expect(apiClient.stream("/api/streambad", {})).rejects.toThrow();
  });
});
