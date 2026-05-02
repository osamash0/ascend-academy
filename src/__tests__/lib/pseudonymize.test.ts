import { describe, expect, it } from "vitest";
import { pseudonymizeId } from "@/lib/pseudonymize";

describe("pseudonymizeId (frontend)", () => {
  it("is deterministic", async () => {
    const a = await pseudonymizeId("user-abc");
    const b = await pseudonymizeId("user-abc");
    expect(a).toBe(b);
  });

  it("returns a 64-char SHA-256 hex string", async () => {
    const out = await pseudonymizeId("user-abc");
    expect(out).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs across users", async () => {
    const out = new Set<string>();
    for (let i = 0; i < 30; i++) out.add(await pseudonymizeId(`u-${i}`));
    expect(out.size).toBeGreaterThan(20);
  });

  it("does not contain the raw user id", async () => {
    const out = await pseudonymizeId("alice@example.com");
    expect(out.toLowerCase()).not.toContain("alice");
    expect(out).not.toContain("@");
  });
});
