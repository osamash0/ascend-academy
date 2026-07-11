/**
 * Frontend feature flags — parallels backend settings.feature_review_engine
 * (FEATURE_REVIEW_ENGINE). No flag-delivery endpoint exists yet in this app,
 * so this reads a build-time Vite env var directly; if more flags accumulate,
 * revisit serving them from the backend instead of duplicating per-flag env vars.
 */
export const FEATURES = {
  reviewEngine: import.meta.env.VITE_FEATURE_REVIEW_ENGINE === '1',
  globalSearch: import.meta.env.VITE_FEATURE_GLOBAL_SEARCH === '1',
  studentUploads: import.meta.env.VITE_FEATURE_STUDENT_UPLOADS === '1',
} as const;
