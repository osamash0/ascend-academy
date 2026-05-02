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
}

// ─── Lectures ────────────────────────────────────────────────────────────────

export interface Lecture {
  id: string;
  title: string;
  description: string | null;
  total_slides: number;
  created_at: string;
  pdf_url?: string | null;
  /** Optional course grouping (null = Uncategorized). */
  course_id?: string | null;
}

export interface Slide {
  id: string;
  slide_number: number;
  title: string | null;
  content_text: string | null;
  summary: string | null;
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

export interface StudentProgress {
  lecture_id: string;
  completed_slides: number[];
  quiz_score: number;
  total_questions_answered: number;
  correct_answers: number;
  xp_earned?: number;
  last_slide_viewed?: number | null;
  completed_at?: string | null;
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
  status: 'Excelling' | 'On Track' | 'At Risk';
}
