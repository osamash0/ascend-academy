/**
 * homeFeed — the "brains" of the student home page.
 *
 * Pure, framework-free functions that decide WHAT the student sees and in WHAT
 * order. The dashboard component renders whatever these return; all ranking and
 * prioritisation rules live here so they can be unit-tested in isolation.
 *
 *   selectHero()   → the single highest-value next action ("what shows first")
 *   buildWidgets() → the PS5-style bento cells (stats / glanceable cards)
 *   buildRows()    → the Netflix browse rails (Continue + one per course)
 */
import { splitLectureTitle } from '@/lib/utils';
import type { Lecture, StudentProgress, Achievement, Profile, CourseVisit } from '@/types/domain';

// ─── Shared derived shapes ────────────────────────────────────────────────────

export type LectureStatus = 'new' | 'progress' | 'done';

/** Everything the UI needs about one lecture, with its progress folded in. */
export interface LectureView {
  lecture: Lecture;
  progress?: StudentProgress;
  status: LectureStatus;
  /** Completion percent, 0–100. */
  pct: number;
  completedSlides: number;
  totalSlides: number;
  /** Quiz accuracy percent for this lecture, 0–100 (0 when nothing answered). */
  accuracy: number;
  badge: string | null;
  cleanTitle: string;
  /** Numeric badge prefix as a number when present (for sequence ordering). */
  order: number;
}

export type ProgressIndex = Map<string, StudentProgress>;

/** Build a lecture-id → progress lookup once, then reuse it everywhere. */
export function indexProgress(progress: StudentProgress[]): ProgressIndex {
  const map: ProgressIndex = new Map();
  for (const p of progress) map.set(p.lecture_id, p);
  return map;
}

export function toLectureView(lecture: Lecture, progress?: StudentProgress): LectureView {
  const { badge, cleanTitle } = splitLectureTitle(lecture.title);
  const totalSlides = lecture.total_slides ?? 0;

  // Prefer the granular slide_states map (accurate: counts only 'visited').
  // Fall back to the legacy completed_slides array for rows without the new column.
  let visitedCount: number;
  if (progress?.slide_states && Object.keys(progress.slide_states).length > 0) {
    visitedCount = Object.values(progress.slide_states).filter((s) => s === 'visited').length;
  } else {
    visitedCount = progress?.completed_slides?.length ?? 0;
  }

  const pct = totalSlides > 0 ? Math.round((visitedCount / totalSlides) * 100) : 0;
  const status: LectureStatus = pct >= 100 ? 'done' : visitedCount > 0 ? 'progress' : 'new';
  const answered = progress?.total_questions_answered ?? 0;
  const accuracy = answered > 0 ? Math.round(((progress?.correct_answers ?? 0) / answered) * 100) : 0;
  const order = badge != null ? parseFloat(badge) : Number.POSITIVE_INFINITY;
  return { lecture, progress, status, pct, completedSlides: visitedCount, totalSlides, accuracy, badge, cleanTitle, order };
}

function buildViews(lectures: Lecture[], byId: ProgressIndex): LectureView[] {
  return lectures.map((l) => toLectureView(l, byId.get(l.id)));
}

/** Recency key for a progress row: updated_at, else completed_at, else epoch. */
function recencyOf(p?: StudentProgress): number {
  const ts = p?.updated_at ?? p?.completed_at;
  if (!ts) return 0;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Sequence order within a course: numeric badge first, then created_at. */
function bySequence(a: LectureView, b: LectureView): number {
  if (a.order !== b.order) return a.order - b.order;
  return Date.parse(a.lecture.created_at) - Date.parse(b.lecture.created_at);
}

// ─── 1. Hero resolver — "what shows first" ─────────────────────────────────────

export type HeroKind = 'resume' | 'next' | 'review' | 'onboard';

export interface HeroChoice {
  kind: HeroKind;
  view: LectureView;
  ctaLabel: string;
  /** 1-based slide to jump to (resume only); undefined ⇒ start at the beginning. */
  resumeSlide?: number;
  /** Short eyebrow explaining why this was chosen. */
  reason: string;
}

const CTA: Record<HeroKind, string> = {
  resume: 'Continue',
  next: 'Start',
  review: 'Review',
  onboard: 'Begin',
};

const REASON: Record<HeroKind, string> = {
  resume: 'Jump back in',
  next: 'Up next for you',
  review: "You're all caught up",
  onboard: 'Start your journey',
};

/**
 * Pick exactly ONE hero by priority:
 *   resume  → most recently active in-progress lecture
 *   next    → next uncompleted lecture in the course you're furthest along in
 *   review  → lowest-accuracy completed lecture (everything done)
 *   onboard → first lecture overall (brand-new student)
 * Returns null only when there are no lectures at all.
 */
export function selectHero(lectures: Lecture[], byId: ProgressIndex): HeroChoice | null {
  const views = buildViews(lectures, byId);
  if (views.length === 0) return null;

  // 1. Resume — in-progress, most recently touched.
  const inProgress = views
    .filter((v) => v.status === 'progress')
    .sort((a, b) => recencyOf(b.progress) - recencyOf(a.progress));
  if (inProgress.length > 0) {
    const view = inProgress[0];
    const last = view.progress?.last_slide_viewed ?? 0;
    return {
      kind: 'resume',
      view,
      ctaLabel: CTA.resume,
      resumeSlide: last > 0 ? last : undefined,
      reason: REASON.resume,
    };
  }

  // 2. Onboard — brand-new student (no progress anywhere): welcome them in with
  //    the first lecture in sequence rather than a curt "Start".
  const hasAnyProgress = views.some((v) => v.status !== 'new');
  if (!hasAnyProgress) {
    const first = [...views].sort(bySequence)[0];
    return { kind: 'onboard', view: first, ctaLabel: CTA.onboard, reason: REASON.onboard };
  }

  // 3. Next — has history but nothing in progress: next uncompleted lecture in
  //    the course they're furthest along in.
  const next = selectNextUp(views);
  if (next) {
    return { kind: 'next', view: next, ctaLabel: CTA.next, reason: REASON.next };
  }

  // 4. Review — everything is done: surface the weakest completed lecture.
  const completed = views
    .filter((v) => v.status === 'done')
    .sort((a, b) => a.accuracy - b.accuracy);
  return { kind: 'review', view: completed[0], ctaLabel: CTA.review, reason: REASON.review };
}

/**
 * The next uncompleted lecture to recommend. Prefers the course the student has
 * made the most progress in (most completed lectures), then the earliest
 * uncompleted lecture in sequence within it. Falls back across all courses.
 */
function selectNextUp(views: LectureView[]): LectureView | undefined {
  const uncompleted = views.filter((v) => v.status !== 'done');
  if (uncompleted.length === 0) return undefined;

  // Score each course by how many lectures are already done in it.
  const doneByCourse = new Map<string, number>();
  for (const v of views) {
    if (v.status !== 'done') continue;
    const key = v.lecture.course_id ?? '__uncat__';
    doneByCourse.set(key, (doneByCourse.get(key) ?? 0) + 1);
  }

  const courseScore = (v: LectureView) => doneByCourse.get(v.lecture.course_id ?? '__uncat__') ?? 0;

  return [...uncompleted].sort((a, b) => {
    const scoreDiff = courseScore(b) - courseScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return bySequence(a, b);
  })[0];
}

// ─── 2. Bento widgets — glanceable PS5-style cells ─────────────────────────────

export interface TrophiesWidget {
  kind: 'trophies';
  total: number;
  recent: Achievement[];
  level: number;
  xp: number;
}

export interface CourseProgressEntry {
  courseId: string;
  title: string;
  color?: string | null;
  total: number;
  completed: number;
  pct: number;
}

export interface CourseProgressWidget {
  kind: 'courseProgress';
  courses: CourseProgressEntry[];
  /** Overall completion across all courses, 0–100. */
  overallPct: number;
}

export interface UpNextWidget {
  kind: 'upNext';
  view: LectureView;
}

export interface StreakWidget {
  kind: 'streak';
  current: number;
  best: number;
  level: number;
  xp: number;
}

export type Widget = TrophiesWidget | CourseProgressWidget | UpNextWidget | StreakWidget;

const UNCATEGORIZED = '__uncat__';
const UNCATEGORIZED_TITLE = 'Other';

export function buildWidgets(
  lectures: Lecture[],
  byId: ProgressIndex,
  achievements: Achievement[],
  profile?: Profile | null,
): Widget[] {
  const views = buildViews(lectures, byId);
  const widgets: Widget[] = [];

  // Streak / level summary (always shown).
  widgets.push({
    kind: 'streak',
    current: profile?.current_streak ?? 0,
    best: profile?.best_streak ?? 0,
    level: profile?.current_level ?? 1,
    xp: profile?.total_xp ?? 0,
  });

  // Trophies.
  widgets.push({
    kind: 'trophies',
    total: achievements.length,
    recent: achievements.slice(0, 3),
    level: profile?.current_level ?? 1,
    xp: profile?.total_xp ?? 0,
  });

  // Up next (only when there's an uncompleted lecture to recommend).
  const next = selectNextUp(views);
  if (next) widgets.push({ kind: 'upNext', view: next });

  // Per-course progress.
  const courses = buildCourseProgress(views);
  if (courses.length > 0) {
    const total = courses.reduce((s, c) => s + c.total, 0);
    const completed = courses.reduce((s, c) => s + c.completed, 0);
    widgets.push({
      kind: 'courseProgress',
      courses,
      overallPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    });
  }

  return widgets;
}

function buildCourseProgress(views: LectureView[]): CourseProgressEntry[] {
  const groups = new Map<string, CourseProgressEntry>();
  for (const v of views) {
    const id = v.lecture.course_id ?? UNCATEGORIZED;
    const title = v.lecture.course?.title ?? UNCATEGORIZED_TITLE;
    let entry = groups.get(id);
    if (!entry) {
      entry = { courseId: id, title, color: v.lecture.course?.color, total: 0, completed: 0, pct: 0 };
      groups.set(id, entry);
    }
    entry.total += 1;
    if (v.status === 'done') entry.completed += 1;
  }
  const list = [...groups.values()].filter((e) => e.courseId !== UNCATEGORIZED);
  for (const e of list) e.pct = e.total > 0 ? Math.round((e.completed / e.total) * 100) : 0;
  // Most-active courses first.
  return list.sort((a, b) => {
    return b.completed - a.completed || a.title.localeCompare(b.title);
  });
}

// ─── 3. Browse rows — Netflix rails ────────────────────────────────────────────

export interface Row {
  id: string;
  title: string;
  eyebrow: string;
  items: LectureView[];
}

/**
 * Build the browse rails:
 *   - "Continue Learning": in-progress lectures, most recently active first.
 *   - One row per course, ordered by LIFS (Last In, First Shown):
 *       1. Most recently visited course (via courseVisits) floats to position 1.
 *       2. Tiebreaker: most completed lectures.
 *   - Uncategorised ("Other") always last.
 * Empty rows are omitted.
 *
 * @param courseVisits Pass the course_visits rows from the dashboard fetch.
 *                     When empty (new student or table not deployed), falls
 *                     back to the legacy completion-count ordering.
 */
export function buildRows(
  lectures: Lecture[],
  byId: ProgressIndex,
  courseVisits: CourseVisit[] = [],
): Row[] {
  const views = buildViews(lectures, byId);
  const rows: Row[] = [];

  const continueItems = views
    .filter((v) => v.status === 'progress')
    .sort((a, b) => recencyOf(b.progress) - recencyOf(a.progress));
  if (continueItems.length > 0) {
    rows.push({ id: 'continue', eyebrow: 'Resume', title: 'Continue Learning', items: continueItems });
  }

  // Build a course-id → last_visited_at lookup (ms since epoch, 0 if never).
  const visitRecency = new Map<string, number>();
  for (const cv of courseVisits) {
    const ms = Date.parse(cv.last_visited_at);
    visitRecency.set(cv.course_id, Number.isNaN(ms) ? 0 : ms);
  }

  // Group remaining browse content per course.
  const courseGroups = new Map<string, { title: string; items: LectureView[] }>();
  for (const v of views) {
    const id = v.lecture.course_id ?? UNCATEGORIZED;
    const title = v.lecture.course?.title ?? UNCATEGORIZED_TITLE;
    let g = courseGroups.get(id);
    if (!g) {
      g = { title, items: [] };
      courseGroups.set(id, g);
    }
    g.items.push(v);
  }

  const completedByCourse = (id: string) =>
    courseGroups.get(id)?.items.filter((v) => v.status === 'done').length ?? 0;

  const orderedIds = [...courseGroups.keys()]
    .filter((id) => id !== UNCATEGORIZED)
    .sort((a, b) => {
      // Primary: most recently visited (LIFS / MRF) — 0 when never visited.
      const recencyDiff = (visitRecency.get(b) ?? 0) - (visitRecency.get(a) ?? 0);
      if (recencyDiff !== 0) return recencyDiff;
      // Secondary: most completed lectures (original tiebreaker).
      return completedByCourse(b) - completedByCourse(a);
    });

  for (const id of orderedIds) {
    const g = courseGroups.get(id)!;
    rows.push({
      id: `course:${id}`,
      eyebrow: 'Course',
      title: g.title,
      items: [...g.items].sort(bySequence),
    });
  }

  return rows;
}

// ─── 4. Recently Viewed — deduplicated mixed list ───────────────────────────

export interface RecentItem {
  kind: 'lecture' | 'course';
  /** For lectures: the lecture view. For courses: undefined. */
  lectureView?: LectureView;
  /** For courses: the course entry. For lectures: undefined. */
  courseEntry?: { courseId: string; title: string; color?: string | null; totalLectures: number; completedLectures: number };
  /** ISO timestamp of the last interaction (drives MRF ordering). */
  lastTouchedAt: string;
}

/**
 * Build the "Recently Viewed" mixed list.
 *
 * Rules (no-redundancy contract):
 *   - Exclude the hero lecture (already shown above the fold).
 *   - Exclude lectures already shown in the "Continue Learning" rail.
 *   - Include up to 3 recently-touched lectures that do NOT appear in Continue.
 *   - Include up to 3 recently-visited courses (deduplicated vs lecture entries).
 *   - The final list is ordered MRF (most recent first), capped at 5 items.
 *
 * @param herLectureId  The lecture id currently shown in the hero (exclude it).
 * @param continueIds   The lecture ids shown in the "Continue Learning" rail.
 * @param courseVisits  Course-level recency rows from the dashboard fetch.
 * @param courseGroups  Map of courseId → {title, color, total, completed}.
 */
export function buildRecentlyViewed(
  lectures: Lecture[],
  byId: ProgressIndex,
  courseVisits: CourseVisit[],
  heroLectureId: string | null,
  continueIds: Set<string>,
): RecentItem[] {
  const items: RecentItem[] = [];

  // ── Recently touched lectures (from StudentProgress.updated_at) ──────────
  const lectureItems = buildViews(lectures, byId)
    .filter((v) => {
      if (!v.progress?.updated_at) return false;          // never opened
      if (v.lecture.id === heroLectureId) return false;   // hero — skip
      if (continueIds.has(v.lecture.id)) return false;    // in Continue rail
      return true;
    })
    .sort((a, b) => recencyOf(b.progress) - recencyOf(a.progress))
    .slice(0, 3);

  for (const v of lectureItems) {
    items.push({
      kind: 'lecture',
      lectureView: v,
      lastTouchedAt: v.progress?.updated_at ?? v.progress?.completed_at ?? '',
    });
  }

  // ── Recently visited courses ─────────────────────────────────────────────
  // Build course summary from lectures.
  const courseMap = new Map<string, { title: string; color?: string | null; total: number; completed: number }>();
  for (const l of lectures) {
    if (!l.course_id || !l.course) continue;
    let entry = courseMap.get(l.course_id);
    if (!entry) {
      entry = { title: l.course.title, color: l.course.color, total: 0, completed: 0 };
      courseMap.set(l.course_id, entry);
    }
    entry.total += 1;
    const v = byId.get(l.id);
    // Course-level %: use slide_states visited count where available.
    const visitedInLecture =
      v?.slide_states && Object.keys(v.slide_states).length > 0
        ? Object.values(v.slide_states).filter((s) => s === 'visited').length
        : v?.completed_slides?.length ?? 0;
    const pct = visitedInLecture && l.total_slides
      ? Math.round((visitedInLecture / l.total_slides) * 100) : 0;
    if (pct >= 100) entry.completed += 1;
  }

  // The lecture items already represent their courses in many cases;
  // add course-level rows only for courses NOT already represented by a lecture.
  const lectureCoursesRepresented = new Set(
    lectureItems.map((v) => v.lecture.course_id).filter(Boolean) as string[],
  );

  const courseItems = courseVisits
    .filter((cv) => courseMap.has(cv.course_id) && !lectureCoursesRepresented.has(cv.course_id))
    .slice(0, 3);

  for (const cv of courseItems) {
    const c = courseMap.get(cv.course_id)!;
    items.push({
      kind: 'course',
      courseEntry: {
        courseId: cv.course_id,
        title: c.title,
        color: c.color,
        totalLectures: c.total,
        completedLectures: c.completed,
      },
      lastTouchedAt: cv.last_visited_at,
    });
  }

  // Final MRF sort, capped at 5 items.
  return items
    .sort((a, b) => Date.parse(b.lastTouchedAt) - Date.parse(a.lastTouchedAt))
    .slice(0, 5);
}
