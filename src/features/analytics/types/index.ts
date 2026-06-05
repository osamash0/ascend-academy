export interface LectureOverview {
  total_students: number;
  completion_rate: number;
  average_score: number;
  average_time_minutes: number;
  engagement_level: string;
}

export interface SlideAnalytics {
  slide_number: number;
  title: string;
  view_count: number;
  average_time_seconds: number;
  drop_off_rate: number;
}

export interface QuizAnalytics {
  question_id: string;
  question_text: string;
  success_rate: number;
  difficulty: string;
  attempts: number;
}

export interface StudentPerformance {
  student_id: string;
  student_name: string;
  progress_percentage: number;
  quiz_score: number;
  status: "Excelling" | "On Track" | "At Risk";
}

// ── Insight Garden ────────────────────────────────────────────────────────────
// Wire contract for the /api/analytics/lecture/:id/insights endpoint. Mirrors
// the backend `make_insight` shape exactly (camelCase keys).

export type InsightKind =
  | "confusion_hotspot"
  | "silent_misleader"
  | "skipped_slide"
  | "speed_bump"
  | "overpacked"
  | "silent_strugglers"
  | "leaky_bucket"
  | "confusion_block"
  | "quiz_misalignment"
  | "calibration_gap"
  | "healthy";

export type InsightScope = "slide" | "student" | "quiz" | "lecture";
export type InsightAttention = "calm" | "watch" | "act";

export interface InsightCue {
  metric?: { label: string; value: string };
  sparkline?: number[];
}

export interface InsightTargetRef {
  slideId?: string;
  slideNumber?: number;
  studentId?: string;
  questionId?: string;
}

export interface Insight {
  id: string;
  kind: InsightKind;
  scope: InsightScope;
  severity: number;
  attention: InsightAttention;
  headline: string;
  summary: string;
  interpretation: string;
  targetRef: InsightTargetRef;
  cue: InsightCue;
  metrics: Record<string, number | string>;
  /** Richer kind-specific structures (student lists, slide ranges) for Layer 2. */
  detail: Record<string, unknown>;
  evidenceKinds: string[];
}

export interface InsightFeed {
  lectureId: string;
  computedAt: string;
  insights: Insight[];
}
