/**
 * Centralized application routing dictionary.
 * Use these constants instead of hardcoded strings for navigation.
 */

export const PublicRoutes = {
  LANDING: '/',
  AUTH: '/auth',
  IMPRESSUM: '/impressum',
  DATENSCHUTZ: '/datenschutz',
} as const;

export const StudentRoutes = {
  HOME: '/dashboard',
  ONBOARDING: '/onboarding',
  LIBRARY: '/library',
  COURSE_V3: (id: string) => `/course-v3/${id}`,
  COURSE_DETAIL: (id: string) => `/course/${id}`,
  ACHIEVEMENTS: '/achievements',
  LEADERBOARD: '/leaderboard',
  INSIGHTS: '/insights',
  // Social gamification
  FRIENDS: '/friends',
  FRIENDS_REQUESTS: '/friends/requests',
  FRIENDS_FIND: '/friends/find',
  PROFILE: '/profile',
  PROFILE_USER: (id: string) => `/profile/${id}`,
} as const;

export const ProfessorRoutes = {
  DASHBOARD: '/professor/dashboard',
  ANALYTICS: '/professor/analytics',
  ANALYTICS_LECTURE: (id: string) => `/professor/analytics/${id}`,
  ADVANCED_ANALYTICS: (id: string) => `/professor/analytics/${id}/advanced`,
  UPLOAD: '/professor/upload',
  FAST_UPLOAD: '/professor/fast-upload',
  COURSES: '/professor/courses',
  COURSE_DETAIL: (id: string) => `/professor/courses/${id}`,
  ARCHIVE: '/professor/archive',
  LECTURE_EDIT: (id: string) => `/professor/lecture/${id}`,
  PIPELINE_TEST: '/professor/pipeline-test',
} as const;

export const SharedRoutes = {
  SETTINGS: '/settings',
  LECTURE: (id: string, slide?: number) => (slide ? `/lecture/${id}?slide=${slide}` : `/lecture/${id}`),
} as const;
