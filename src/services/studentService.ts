/**
 * Student data service — the only module allowed to call supabase directly
 * for student-domain reads. Pages and components call these functions instead
 * of importing supabase themselves.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Lecture, StudentProgress, Achievement, CourseVisit, LectureVisit, CourseSummary } from '@/types/domain';

export interface StudentDashboardData {
  lectures: Lecture[];
  courses: Partial<CourseSummary>[];
  progress: StudentProgress[];
  achievements: Achievement[];
  /** Per-course recency — drives LIFS ordering of browse rows. */
  courseVisits: CourseVisit[];
}

export async function fetchStudentDashboard(userId: string): Promise<StudentDashboardData> {
  const [lecturesRes, progressRes, achievementsRes, courseVisitsRes, coursesRes] = await Promise.all([
    supabase
      .from('lectures')
      .select('id, title, description, total_slides, created_at, pdf_url, course_id, course:courses(id, title, color, description)')
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .limit(200),

    supabase
      .from('student_progress')
      .select('lecture_id, completed_slides, slide_states, quiz_score, total_questions_answered, correct_answers, last_slide_viewed, completed_at, updated_at')
      .eq('user_id', userId)
      .limit(500),

    supabase
      .from('achievements')
      .select('id, badge_name, badge_description, badge_icon, earned_at')
      .eq('user_id', userId)
      .order('earned_at', { ascending: false })
      .limit(50),

    supabase
      .from('course_visits')
      .select('course_id, last_visited_at, visit_count')
      .eq('user_id', userId)
      .order('last_visited_at', { ascending: false })
      .limit(100),

    supabase
      .from('courses')
      .select('id, title, color, description')
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  if (lecturesRes.error) {
    console.error('Error fetching student dashboard lectures:', lecturesRes.error);
  }
  if (progressRes.error) {
    console.error('Error fetching student dashboard progress:', progressRes.error);
  }
  if (achievementsRes.error) {
    console.error('Error fetching student dashboard achievements:', achievementsRes.error);
  }
  if (courseVisitsRes.error) {
    // Table may not exist on older environments — degrade gracefully.
    console.warn('course_visits fetch error (degrading gracefully):', courseVisitsRes.error);
  }

  const lectures: Lecture[] = (lecturesRes.data ?? []) as unknown as Lecture[];

  const progress: StudentProgress[] = (progressRes.data ?? []).map(p => ({
    ...p,
    completed_slides: Array.isArray(p.completed_slides) ? p.completed_slides : [],
  }));

  const achievements: Achievement[] = achievementsRes.data ?? [];
  const courseVisits: CourseVisit[] = (courseVisitsRes.data ?? []) as CourseVisit[];
  const courses: Partial<CourseSummary>[] = (coursesRes.data ?? []) as Partial<CourseSummary>[];

  return { lectures, courses, progress, achievements, courseVisits };
}

export async function fetchLectureProgress(userId: string, lectureId: string): Promise<StudentProgress | null> {
  const { data } = await supabase
    .from('student_progress')
    .select('lecture_id, completed_slides, slide_states, quiz_score, total_questions_answered, correct_answers, last_slide_viewed, completed_at, updated_at')
    .eq('user_id', userId)
    .eq('lecture_id', lectureId)
    .single();

  if (!data) return null;
  return {
    ...data,
    completed_slides: Array.isArray(data.completed_slides) ? data.completed_slides : [],
  };
}

export async function upsertLectureProgress(
  userId: string,
  lectureId: string,
  patch: Partial<Omit<StudentProgress, 'lecture_id'>>,
): Promise<void> {
  await supabase
    .from('student_progress')
    .upsert(
      { user_id: userId, lecture_id: lectureId, ...patch },
      { onConflict: 'user_id,lecture_id' },
    );
}

export async function logLearningEvent(
  userId: string,
  eventType: string,
  eventData: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from('learning_events')
    .insert({ user_id: userId, event_type: eventType, event_data: eventData as any });
}

/**
 * Upsert a course_visit row — increments visit_count and bumps last_visited_at.
 * Fire-and-forget: caller should not await this on the critical render path.
 */
export async function recordCourseVisit(userId: string, courseId: string): Promise<void> {
  await supabase.rpc('upsert_course_visit', { p_user_id: userId, p_course_id: courseId });
  // Fallback if RPC not deployed: raw upsert.
}

/**
 * Record daily activity to update the days active streak.
 * Fire-and-forget: caller should not await this on the critical render path.
 */
export async function recordDailyActivity(): Promise<void> {
  await supabase.rpc('record_daily_activity');
}

/**
 * Insert a lecture_visit row (append-only session log).
 * Fire-and-forget: caller should not await this on the critical render path.
 */
export async function recordLectureVisit(
  userId: string,
  lectureId: string,
  courseId: string | null,
): Promise<void> {
  await supabase
    .from('lecture_visits')
    .insert({ user_id: userId, lecture_id: lectureId, course_id: courseId });
}

/**
 * Fetch the N most recently opened lectures (for the Recently Viewed panel).
 * Returns at most `limit` rows, ordered newest first.
 */
export async function fetchRecentLectureVisits(
  userId: string,
  limit = 6,
): Promise<LectureVisit[]> {
  const { data } = await supabase
    .from('lecture_visits')
    .select('id, lecture_id, course_id, visited_at')
    .eq('user_id', userId)
    .order('visited_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as LectureVisit[];
}

export async function checkAchievementExists(userId: string, badgeName: string): Promise<boolean> {
  const { data } = await supabase
    .from('achievements')
    .select('id')
    .eq('user_id', userId)
    .eq('badge_name', badgeName)
    .single();
  return !!data;
}

export async function awardAchievement(
  userId: string,
  badge: { name: string; description: string; icon: string },
): Promise<void> {
  await supabase.from('achievements').insert({
    user_id: userId,
    badge_name: badge.name,
    badge_description: badge.description,
    badge_icon: badge.icon,
  });
}

export async function insertNotification(
  userId: string,
  title: string,
  message: string,
  type: string,
): Promise<void> {
  await supabase.from('notifications').insert({ user_id: userId, title, message, type });
}

export async function countCompletedLectures(userId: string): Promise<number> {
  const { count } = await supabase
    .from('student_progress')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  return count ?? 0;
}

export interface AccountExportData {
  exported_at: string;
  profile: unknown;
  progress: unknown;
  achievements: unknown;
  learning_events: unknown;
}

export async function exportAccountData(userId: string): Promise<AccountExportData> {
  const [profileRes, progressRes, achievementsRes, eventsRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('user_id', userId).single(),
    supabase.from('student_progress').select('*').eq('user_id', userId),
    supabase.from('achievements').select('*').eq('user_id', userId),
    supabase.from('learning_events').select('*').eq('user_id', userId),
  ]);
  return {
    exported_at: new Date().toISOString(),
    profile: profileRes.data,
    progress: progressRes.data,
    achievements: achievementsRes.data,
    learning_events: eventsRes.data,
  };
}

export async function deleteAccountData(userId: string): Promise<void> {
  await supabase.from('learning_events').delete().eq('user_id', userId);
  await supabase.from('student_progress').delete().eq('user_id', userId);
  await supabase.from('achievements').delete().eq('user_id', userId);
  await supabase.from('user_roles').delete().eq('user_id', userId);
  await supabase.from('profiles').delete().eq('user_id', userId);
}
