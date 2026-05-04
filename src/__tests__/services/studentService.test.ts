import { beforeEach, describe, expect, it, vi } from "vitest";
import { sharedSupabaseMock as supabaseMock } from "@/test/sharedSupabaseMock";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/sharedSupabaseMock");
  return { supabase: m.sharedSupabaseMock };
});

import {
  fetchStudentDashboard,
  fetchLectureProgress,
  upsertLectureProgress,
  awardAchievement,
  checkAchievementExists,
  insertNotification,
  logLearningEvent,
  exportAccountData,
  deleteAccountData,
} from "@/services/studentService";

beforeEach(() => supabaseMock.reset());

describe("fetchStudentDashboard", () => {
  it("returns lectures, progress, achievements together", async () => {
    supabaseMock.seed("lectures", [
      { id: "L1", title: "T", description: "", total_slides: 5, created_at: "2026-01-01" },
    ]);
    supabaseMock.seed("student_progress", [
      {
        user_id: "u1", lecture_id: "L1",
        completed_slides: [1, 2], quiz_score: 80,
        total_questions_answered: 5, correct_answers: 4,
        last_slide_viewed: 2, completed_at: null,
      },
    ]);
    supabaseMock.seed("achievements", [
      { id: "a1", user_id: "u1", badge_name: "First Lecture",
        badge_description: "", badge_icon: "x", earned_at: "2026-01-01" },
    ]);

    const out = await fetchStudentDashboard("u1");
    expect(out.lectures).toHaveLength(1);
    expect(out.progress[0].completed_slides).toEqual([1, 2]);
    expect(out.achievements).toHaveLength(1);
  });

  it("normalises completed_slides to array on bad data", async () => {
    supabaseMock.seed("lectures", []);
    supabaseMock.seed("student_progress", [
      {
        user_id: "u1", lecture_id: "L1",
        completed_slides: null,
        quiz_score: 0, total_questions_answered: 0, correct_answers: 0,
        last_slide_viewed: 0, completed_at: null,
      },
    ]);
    supabaseMock.seed("achievements", []);
    const out = await fetchStudentDashboard("u1");
    expect(Array.isArray(out.progress[0].completed_slides)).toBe(true);
  });

  it("scopes per user_id", async () => {
    supabaseMock.seed("lectures", []);
    supabaseMock.seed("student_progress", [
      { user_id: "u1", lecture_id: "L1", completed_slides: [], quiz_score: 0,
        total_questions_answered: 0, correct_answers: 0, last_slide_viewed: 0,
        completed_at: null },
      { user_id: "u2", lecture_id: "L1", completed_slides: [], quiz_score: 0,
        total_questions_answered: 0, correct_answers: 0, last_slide_viewed: 0,
        completed_at: null },
    ]);
    supabaseMock.seed("achievements", []);
    const out = await fetchStudentDashboard("u1");
    expect(out.progress).toHaveLength(1);
  });
});

describe("fetchLectureProgress", () => {
  it("returns null when no row", async () => {
    supabaseMock.seed("student_progress", []);
    expect(await fetchLectureProgress("u1", "L1")).toBeNull();
  });
});

describe("upsertLectureProgress", () => {
  it("creates a row when absent", async () => {
    await upsertLectureProgress("u1", "L1", { quiz_score: 90 });
    const row = supabaseMock.data["student_progress"].rows.find((r) => r.user_id === "u1");
    expect(row?.quiz_score).toBe(90);
  });

  it("updates existing on conflict", async () => {
    supabaseMock.seed("student_progress", [
      { user_id: "u1", lecture_id: "L1", quiz_score: 50 },
    ]);
    await upsertLectureProgress("u1", "L1", { quiz_score: 99 });
    const row = supabaseMock.data["student_progress"].rows[0];
    expect(row.quiz_score).toBe(99);
  });
});

describe("achievements + notifications", () => {
  it("checkAchievementExists is true after award", async () => {
    await awardAchievement("u1", { name: "B", description: "", icon: "x" });
    expect(await checkAchievementExists("u1", "B")).toBe(true);
  });

  it("checkAchievementExists false when missing", async () => {
    expect(await checkAchievementExists("u1", "MissingBadge")).toBe(false);
  });

  it("insertNotification writes a row", async () => {
    await insertNotification("u1", "Title", "Msg", "info");
    expect(supabaseMock.data["notifications"].rows).toHaveLength(1);
  });
});

describe("logLearningEvent", () => {
  it("writes user_id + event_type + event_data", async () => {
    await logLearningEvent("u1", "slide_view", { slideId: "s1" });
    const row = supabaseMock.data["learning_events"].rows[0];
    expect(row.user_id).toBe("u1");
    expect(row.event_type).toBe("slide_view");
    expect(row.event_data).toEqual({ slideId: "s1" });
  });
});

describe("exportAccountData / deleteAccountData", () => {
  it("export bundles 4 datasets with timestamp", async () => {
    supabaseMock.seed("profiles", [{ user_id: "u1" }]);
    supabaseMock.seed("student_progress", [{ user_id: "u1" }]);
    supabaseMock.seed("achievements", []);
    supabaseMock.seed("learning_events", []);
    const out = await exportAccountData("u1");
    expect(out.exported_at).toMatch(/T/);
    expect(out.profile).toBeTruthy();
  });

  it("delete cascades all four tables", async () => {
    supabaseMock.seed("profiles", [{ user_id: "u1" }]);
    supabaseMock.seed("student_progress", [{ user_id: "u1" }]);
    supabaseMock.seed("achievements", [{ user_id: "u1" }]);
    supabaseMock.seed("user_roles", [{ user_id: "u1" }]);
    supabaseMock.seed("learning_events", [{ user_id: "u1" }]);
    await deleteAccountData("u1");
    expect(supabaseMock.data["profiles"].rows).toEqual([]);
    expect(supabaseMock.data["student_progress"].rows).toEqual([]);
    expect(supabaseMock.data["achievements"].rows).toEqual([]);
    expect(supabaseMock.data["user_roles"].rows).toEqual([]);
    expect(supabaseMock.data["learning_events"].rows).toEqual([]);
  });
});
