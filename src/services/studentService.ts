/**
 * Student data service — the only module allowed to call supabase directly
 * for student-domain reads. Pages and components call these functions instead
 * of importing supabase themselves.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Lecture, StudentProgress, Achievement } from '@/types/domain';

export interface StudentDashboardData {
  lectures: Lecture[];
  progress: StudentProgress[];
  achievements: Achievement[];
}

export async function fetchStudentDashboard(userId: string): Promise<StudentDashboardData> {
  const [lecturesRes, progressRes, achievementsRes] = await Promise.all([
    supabase
      .from('lectures')
      .select('id, title, description, total_slides, created_at, course_id, course:courses(id, title, color)')
      .order('created_at', { ascending: false })
      .limit(200),

    supabase
      .from('student_progress')
      .select('lecture_id, completed_slides, quiz_score, total_questions_answered, correct_answers, last_slide_viewed, completed_at')
      .eq('user_id', userId)
      .limit(500),

    supabase
      .from('achievements')
      .select('id, badge_name, badge_description, badge_icon, earned_at')
      .eq('user_id', userId)
      .order('earned_at', { ascending: false })
      .limit(50),
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

  const lectures: Lecture[] = (lecturesRes.data ?? []) as unknown as Lecture[];

  const progress: StudentProgress[] = (progressRes.data ?? []).map(p => ({
    ...p,
    completed_slides: Array.isArray(p.completed_slides) ? p.completed_slides : [],
  }));

  const achievements: Achievement[] = achievementsRes.data ?? [];

  return { lectures, progress, achievements };
}

export async function fetchLectureProgress(userId: string, lectureId: string): Promise<StudentProgress | null> {
  const { data } = await supabase
    .from('student_progress')
    .select('lecture_id, completed_slides, quiz_score, total_questions_answered, correct_answers, last_slide_viewed, completed_at')
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
