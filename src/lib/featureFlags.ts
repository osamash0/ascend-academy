/**
 * Frontend feature flags — parallels backend settings.feature_review_engine
 * (FEATURE_REVIEW_ENGINE). No flag-delivery endpoint exists yet in this app,
 * so this reads a build-time Vite env var directly; if more flags accumulate,
 * revisit serving them from the backend instead of duplicating per-flag env vars.
 */
// "1" or "true", the same values the backend's bool settings accept: in the
// prod build these come straight from the backend flags (docker-compose.prod.yml).
const on = (v: string | undefined) => v === '1' || v === 'true';

export const FEATURES = {
  lunaSessions: on(import.meta.env.VITE_FEATURE_LUNA_SESSIONS),
  reviewEngine: on(import.meta.env.VITE_FEATURE_REVIEW_ENGINE),
  globalSearch: on(import.meta.env.VITE_FEATURE_GLOBAL_SEARCH),
  studentUploads: on(import.meta.env.VITE_FEATURE_STUDENT_UPLOADS),
  examMode: on(import.meta.env.VITE_FEATURE_EXAM_MODE),
  studyGuide: on(import.meta.env.VITE_FEATURE_STUDY_GUIDE),
  askLuna: on(import.meta.env.VITE_FEATURE_ASK_LUNA),
} as const;
