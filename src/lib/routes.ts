/**
 * Centralized application routing dictionary.
 * Use these constants instead of hardcoded strings for navigation.
 */

export const PublicRoutes = {
  LANDING: '/',
  AUTH: '/auth',
  /** The same page, opened in sign-up mode — what every "Start" CTA links to. */
  SIGNUP: '/auth?mode=signup',
  RESET_PASSWORD: '/reset-password',
  IMPRESSUM: '/impressum',
  DATENSCHUTZ: '/datenschutz',
} as const;

export const StudentRoutes = {
  HOME: '/dashboard',
  REVIEW: '/review',
  MY_MATERIALS: '/materials',
  ONBOARDING: '/onboarding',
  LIBRARY: '/library',
  ONBOARDING_START: '/onboarding/start',
  ONBOARDING_UPLOAD: '/onboarding/upload',
  COURSE_V3: (id: string) => `/course-v3/${id}`,
  COURSE_DETAIL: (id: string) => `/course/${id}`,
  EXAM: (courseId: string) => `/exam/${courseId}`,
  EXAM_TAKE: (examId: string) => `/exam/take/${examId}`,
  EXAM_REPORT: (examId: string) => `/exam/report/${examId}`,
  STUDY_GUIDE: (courseId: string) => `/course/${courseId}/study-guide`,
  ASCENT: '/ascent',
  AVATAR: '/avatar',
  ASK_LUNA: '/ask-luna',
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
  UPLOAD_BATCH_REVIEW: (batchId: string) => `/professor/upload/batch/${batchId}/review`,
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

export const AdminRoutes = {
  DASHBOARD: '/admin/dashboard',
  LAUNCH: '/admin/launch',
} as const;

/** The v4 rooms a first run can hand over to. */
export const V4Routes = {
  HOME: '/v4/home',
  LIBRARY: '/v4/library',
  SPACES: '/v4/spaces',
} as const;

/**
 * Each role's own landing page. Every "you can't be here" redirect goes here,
 * so an admin or professor is never dropped onto the student dashboard. An
 * unknown role (the lookup failed) goes to /dashboard, which says so.
 */
export const homeForRole = (role: string | null | undefined): string => {
  if (role === 'professor') return ProfessorRoutes.DASHBOARD;
  if (role === 'admin') return AdminRoutes.DASHBOARD;
  return StudentRoutes.HOME;
};

/**
 * A `?next=` worth following after sign-in: a path inside this app. Anything
 * else (another origin, a protocol-relative `//host`, a `/\host` trick, the
 * auth page itself) is dropped, so the parameter can never send anyone
 * off-site or round in a circle.
 */
export const safeNextPath = (next: string | null | undefined): string | null => {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  const path = next.split(/[?#]/)[0];
  if (path === PublicRoutes.AUTH || path.startsWith(`${PublicRoutes.AUTH}/`)) return null;
  return next;
};

/**
 * Where the sign-up confirmation email brings someone back to: the start page,
 * still holding the link they were sent (LS-047). The start page is a public
 * route, so once the session lands it sends them on — through first run, then
 * to `next`. If Supabase's redirect allow-list refuses the query, it falls
 * back to the Site URL: the old behaviour, nothing worse.
 */
export const confirmReturnUrl = (next: string | null | undefined): string => {
  const safe = safeNextPath(next);
  return `${window.location.origin}/${safe ? `?next=${encodeURIComponent(safe)}` : ''}`;
};
