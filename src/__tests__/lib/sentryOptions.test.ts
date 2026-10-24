/**
 * Sentry must not behave like a behavioural tracker.
 *
 * Until a consent flow exists: no Session Replay (it records what the learner
 * does on screen), low tracing sample rate, and a beforeSend that strips the
 * fields most likely to carry a person: user, request headers/cookies, the
 * query string, and breadcrumb bodies.
 */
import { describe, expect, it } from "vitest";

import { buildSentryOptions } from "@/lib/sentryOptions";

describe("buildSentryOptions", () => {
  const opts = buildSentryOptions("https://key@o1.ingest.sentry.io/1");

  it("never enables session replay", () => {
    const names = (opts.integrations as Array<{ name: string }>).map((i) => i.name);
    expect(names).not.toContain("Replay");
    expect(opts.replaysSessionSampleRate).toBeUndefined();
    expect(opts.replaysOnErrorSampleRate).toBeUndefined();
  });

  it("samples at most a tenth of transactions", () => {
    expect(opts.tracesSampleRate).toBeLessThanOrEqual(0.1);
  });

  it("does not send default PII", () => {
    expect(opts.sendDefaultPii).toBe(false);
  });

  it("scrubs user identity, headers, cookies and query strings before sending", () => {
    const event = {
      user: { id: "u-1", email: "a@b.de", ip_address: "1.2.3.4" },
      request: {
        url: "https://learnstation.example/lecture/42?token=abc&slide=3",
        headers: { Authorization: "Bearer x", Cookie: "sb=1" },
        cookies: { sb: "1" },
        query_string: "token=abc",
      },
      breadcrumbs: [
        { category: "fetch", data: { url: "/api/v1/ai/chat", body: "my private question" } },
      ],
    };
    const out = opts.beforeSend!(event as never, {} as never) as unknown as typeof event | null;
    expect(out).not.toBeNull();
    expect(out!.user).toBeUndefined();
    expect(out!.request.headers).toBeUndefined();
    expect(out!.request.cookies).toBeUndefined();
    expect(out!.request.query_string).toBeUndefined();
    expect(out!.request.url).toBe("https://learnstation.example/lecture/42");
    expect(out!.breadcrumbs[0].data).toEqual({ url: "/api/v1/ai/chat" });
  });
});
