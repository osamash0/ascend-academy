import { describe, expect, it } from "vitest";
import { getTimeOfDayPeriod } from "@/lib/greeting";

function atHour(hour: number): Date {
  const d = new Date(2026, 0, 1, hour, 0, 0);
  return d;
}

// R54: "Good morning" used to be shown from 00:00 to 11:59 with no night
// band at all (`if (hour < 12) return morning`), duplicated verbatim in
// ProfessorDashboard and StudentDashboard. This is the single shared helper
// both now call — its boundaries are the only place the hour math lives.
describe("getTimeOfDayPeriod (R54)", () => {
  it("returns 'night' for the early-morning hours before 5am", () => {
    expect(getTimeOfDayPeriod(atHour(0))).toBe("night");
    expect(getTimeOfDayPeriod(atHour(1))).toBe("night");
    expect(getTimeOfDayPeriod(atHour(4))).toBe("night");
  });

  it("returns 'morning' from 5am up to (not including) noon", () => {
    expect(getTimeOfDayPeriod(atHour(5))).toBe("morning");
    expect(getTimeOfDayPeriod(atHour(9))).toBe("morning");
    expect(getTimeOfDayPeriod(atHour(11))).toBe("morning");
  });

  it("returns 'afternoon' from noon up to (not including) 5pm", () => {
    expect(getTimeOfDayPeriod(atHour(12))).toBe("afternoon");
    expect(getTimeOfDayPeriod(atHour(16))).toBe("afternoon");
  });

  it("returns 'evening' from 5pm up to (not including) 10pm", () => {
    expect(getTimeOfDayPeriod(atHour(17))).toBe("evening");
    expect(getTimeOfDayPeriod(atHour(21))).toBe("evening");
  });

  it("returns 'night' from 10pm onward — the regression case for R54", () => {
    // Before the fix, 1am (and every hour from 0-11) mapped to "morning".
    expect(getTimeOfDayPeriod(atHour(22))).toBe("night");
    expect(getTimeOfDayPeriod(atHour(23))).toBe("night");
  });

  it("defaults to the current time when no date is passed", () => {
    // Just verify it doesn't throw and returns a valid period.
    expect(["morning", "afternoon", "evening", "night"]).toContain(getTimeOfDayPeriod());
  });
});
