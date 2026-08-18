import { describe, expect, it } from "vitest";
import { formatJobAge, jobAgeMinutes, LIKELY_STUCK_MINUTES } from "@/lib/jobAge";

const NOW = new Date("2026-08-18T12:00:00Z").getTime();

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

describe("formatJobAge", () => {
  it("returns null for a missing timestamp", () => {
    expect(formatJobAge(null, NOW)).toBeNull();
    expect(formatJobAge(undefined, NOW)).toBeNull();
  });

  it("returns null for an unparseable timestamp", () => {
    expect(formatJobAge("not-a-date", NOW)).toBeNull();
  });

  it("returns 'just started' for under a minute", () => {
    expect(formatJobAge(minutesAgo(0), NOW)).toBe("just started");
  });

  it("formats minutes for under an hour", () => {
    expect(formatJobAge(minutesAgo(47), NOW)).toBe("47 minutes");
    expect(formatJobAge(minutesAgo(1), NOW)).toBe("1 minute");
  });

  it("formats hours for under a day", () => {
    expect(formatJobAge(minutesAgo(180), NOW)).toBe("3 hours");
    expect(formatJobAge(minutesAgo(60), NOW)).toBe("1 hour");
  });

  it("formats days beyond 24 hours", () => {
    expect(formatJobAge(minutesAgo(60 * 30), NOW)).toBe("1 day");
    expect(formatJobAge(minutesAgo(60 * 24 * 3), NOW)).toBe("3 days");
  });

  it("returns null for a future timestamp (clock skew) rather than a negative age", () => {
    expect(formatJobAge(new Date(NOW + 60_000).toISOString(), NOW)).toBeNull();
  });
});

describe("jobAgeMinutes", () => {
  it("computes whole minutes elapsed", () => {
    expect(jobAgeMinutes(minutesAgo(47), NOW)).toBe(47);
  });

  it("flags LIKELY_STUCK_MINUTES as the documented threshold used by callers", () => {
    expect(jobAgeMinutes(minutesAgo(LIKELY_STUCK_MINUTES), NOW)).toBeGreaterThanOrEqual(LIKELY_STUCK_MINUTES);
  });

  it("returns null for missing/invalid input", () => {
    expect(jobAgeMinutes(null, NOW)).toBeNull();
    expect(jobAgeMinutes("garbage", NOW)).toBeNull();
  });
});
