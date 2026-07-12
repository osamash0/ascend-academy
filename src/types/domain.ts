/**
 * Single source of truth for all domain entity interfaces.
 *
 * Rules:
 *  - Every domain shape lives here exactly once.
 *  - Local re-declarations in pages/components are forbidden — import from here.
 *  - API response shapes that differ from these domain types belong in api.ts.
 */

// ─── Auth ───────────────────────────────────────────────────────────────────

export type UserRole = 'student' | 'professor' | null;

export interface Profile {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  total_xp: number;
  current_level: number;
  current_streak: number;
  best_streak: number;
  last_active_date?: string | null;
}

// ─── Lectures ────────────────────────────────────────────────────────────────

/** Lightweight course summary embedded on lecture rows for grouping/UX. */
export interface CourseSummary {
  id: string;
  title: string;
  color?: string | null;
  description?: string | null;
  what_you_will_learn?: string[];
  average_rating?: number;
  rating_count?: number;
}

/** Worksheet attached to a lecture (PDF / docx / etc). */
export interface Worksheet {
  id: string;
  lecture_id: string;
  title: string;
  file_url: string;
  file_type: string | null;
  size_bytes: number | null;
  uploaded_by?: string | null;
  created_at?: string;
}

export interface Lecture {
  id: string;
  title: string;
  description: string | null;
  total_slides: number;
  created_at: string;
  pdf_url?: string | null;
  is_archived?: boolean;
  /** Optional course grouping (null = Uncategorized). */
  course_id?: string | null;
  /** Resolved course summary when the API hydrates it. */
  course?: CourseSummary | null;
  /** Optional worksheet list when the API or service hydrates it. */
  worksheets?: Worksheet[];
}

export interface Slide {
  id: string;
  slide_number: number;
  title: string | null;
  content_text: string | null;
  summary: string | null;
  /** Roadmap Phase 5.2: persisted professor instruction for regenerating this slide. */
  regen_instruction?: string | null;
}

// ─── Quiz ────────────────────────────────────────────────────────────────────

export interface QuizQuestion {
  id: string;
  slide_id: string;
  question_text: string;
  options: string[];
  correct_answer: number;
  /**
   * One-sentence justification for the correct answer (from the upgraded
   * concept-testing quiz prompt). Optional so older rows without metadata
   * don't break consumers.
   */
  explanation?: string;
  /** The concept the question is testing (e.g. the slide's proposed_title). */
  concept?: string;
  /** Cognitive level targeted by the question. */
  cognitive_level?: 'recall' | 'apply' | 'analyse';
  /**
   * For deck-level cross-slide questions, the 0-based slide indices that
   * a student needs to combine to answer correctly. Always present (may be
   * empty) on cross-slide questions; absent on per-slide questions.
   */
  linked_slides?: number[];
}

// ─── Progress ────────────────────────────────────────────────────────────────

/**
 * Per-slide visit state stored as JSONB in `student_progress.slide_states`.
 *
 * - `visited`  — student explicitly navigated through this slide
 * - `skipped`  — student jumped past it without viewing
 * - `current`  — the slide they are on right now (at most one per row)
 *
 * Slides absent from the map are implicitly `unvisited`.
 */
export type SlideState = 'visited' | 'skipped' | 'current';

export interface StudentProgress {
  lecture_id: string;
  /** Legacy flat array kept for backward compat — prefer slide_states. */
  completed_slides: number[];
  /**
   * Granular per-slide state map.
   * Key = slide_number as a string (JSON keys are always strings).
   * Value = SlideState.  Absent key = unvisited.
   */
  slide_states?: Record<string, SlideState>;
  quiz_score: number;
  total_questions_answered: number;
  correct_answers: number;
  xp_earned?: number;
  last_slide_viewed?: number | null;
  completed_at?: string | null;
  /** Last time this progress row changed — used to rank "Continue" by recency. */
  updated_at?: string | null;
}

/** Per-(student, course) visit — used for LIFS / MRF course-row ordering. */
export interface CourseVisit {
  course_id: string;
  last_visited_at: string; // ISO timestamp
  visit_count: number;
}

/** Single lecture-open event — used for the "Recently Viewed" mixed list. */
export interface LectureVisit {
  id: string;
  lecture_id: string;
  course_id: string | null;
  visited_at: string; // ISO timestamp
}

// ─── Gamification ────────────────────────────────────────────────────────────

export interface Achievement {
  id: string;
  badge_name: string;
  badge_description: string | null;
  badge_icon: string | null;
  earned_at: string;
}

export interface LevelUpResult {
  newLevel: number;
  xpEarned: number;
  leveledUp: boolean;
}

// ─── Mind Map ────────────────────────────────────────────────────────────────

export interface TreeNode {
  id: string;
  label: string;
  type: 'root' | 'cluster' | 'slide' | 'concept';
  summary?: string;
  children?: TreeNode[];
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface LectureOverview {
  total_students: number;
  completion_rate: number;
  average_score: number;
  average_time_minutes: number;
  engagement_level: string;
}

export type SlideRecommendationLabel =
  | 'needs_review'
  | 'satisfactory'
  | 'outstanding'
  | 'insufficient_data';

export interface SlideAnalytics {
  slide_id?: string;
  slide_number: number;
  title: string;
  view_count: number;
  average_time_seconds: number;
  drop_off_rate: number;
  confusion_rate?: number;
  quiz_attempts?: number;
  quiz_success_rate?: number | null;
  recommendation_label?: SlideRecommendationLabel;
  recommendation_reasons?: string[];
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
  status: 'Excelling' | 'On Track' | 'At Risk';
}
