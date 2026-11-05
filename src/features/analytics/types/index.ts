/** People, never the owner; each figure is null until five people stand behind it. */
export interface LectureOverview {
  total_students: number | null;
  completion_rate: number | null;
  average_score: number | null;
  average_time_minutes: number | null;
  engagement_level: string;
}

export interface SlideAnalytics {
  slide_number: number;
  title: string;
  view_count: number | null;
  average_time_seconds: number | null;
  drop_off_rate: number | null;
}

export interface QuizAnalytics {
  question_id: string;
  question_text: string;
  /** People, from each one's first try; null until five people have tried the question. */
  success_rate: number | null;
  difficulty: string | null;
  attempts: number | null;
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
  /** A count of fewer than five people is null (never 0 or a small number); render it as a dash. */
  metrics: Record<string, number | string | null>;
  /** Richer kind-specific structures (student lists, slide ranges) for Layer 2. */
  detail: Record<string, unknown>;
  evidenceKinds: string[];
}

export interface InsightFeed {
  lectureId: string;
  computedAt: string;
  insights: Insight[];
}

// ── Layer 3 — Evidence Drawer ─────────────────────────────────────────────────

export interface AiQueryEvidenceItem {
  query: string;
  response: string | null;
  createdAt: string;
}

export interface AiQueriesEvidence {
  kind: 'ai_queries';
  queries: AiQueryEvidenceItem[];
  /** null while fewer than five people have asked (withheld, which is not "none were asked"). */
  totalCount: number | null;
}

export interface ConfidenceBreakdownEvidence {
  kind: 'confidence_breakdown';
  quadrants: {
    confidentCorrect: number;
    confidentWrong: number;
    unsureCorrect: number;
    unsureWrong: number;
  };
  total: number;
}

export type InsightEvidence = AiQueriesEvidence | ConfidenceBreakdownEvidence;
