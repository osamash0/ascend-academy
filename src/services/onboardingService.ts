import { supabase } from '@/integrations/supabase/client';
import { logLearningEvent } from '@/services/studentService';

export type OnboardingPath = 'material' | 'example';
export type StudyGoal = 'weekly_study' | 'exam' | 'assignment' | 'understanding';

interface ProgressPatch {
  selected_path?: OnboardingPath;
  study_goal?: StudyGoal;
  demo_mission_step?: number;
  acquisition_source?: string | null;
  active_batch_id?: string | null;
  luna_customization_seen_at?: string | null;
  university_match_dismissed_at?: string | null;
}

interface CompletionResult {
  completed: boolean;
  path: OnboardingPath;
  study_goal: StudyGoal | null;
  onboarding_version: number;
}

/** Persist non-critical journey state without putting onboarding policy on the
 * profile row. The migration is additive, so keep this boundary isolated. */
export async function saveOnboardingProgress(userId: string, patch: ProgressPatch): Promise<void> {
  const { error } = await supabase
    .from('onboarding_progress')
    .upsert({ user_id: userId, version: 2, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

/** The upload batch this student left in flight, or null once it produced a
 * course. Lets the upload wizard resume instead of restarting. */
export async function fetchActiveBatchId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('onboarding_progress')
    .select('active_batch_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return null;
  return data?.active_batch_id ?? null;
}

export async function recordOnboardingEvent(
  userId: string,
  eventType: string,
  eventData: Record<string, unknown> = {},
): Promise<void> {
  await logLearningEvent(userId, eventType, { ...eventData, onboarding_version: 2 });
}

/**
 * Finalize path selection through the database rather than two browser
 * writes. The RPC updates the profile and emits the canonical, idempotent
 * onboarding_completed event in the same transaction.
 */
export async function completeActivationOnboarding(
  path: OnboardingPath,
  studyGoal?: StudyGoal,
): Promise<CompletionResult> {
  const { data, error } = await supabase.rpc('complete_activation_onboarding', {
    p_path: path,
    p_study_goal: studyGoal ?? null,
  });
  if (error) throw error;
  return data as unknown as CompletionResult;
}

/** Returns true only for a user's first meaningful learning activity. */
export async function recordOnboardingActivation(
  activityType: 'lecture' | 'grounded_ai' | 'quiz' | 'worksheet' | 'mock_exam',
  courseId?: string | null,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('record_onboarding_activation', {
    p_activity_type: activityType,
    p_course_id: courseId ?? null,
  });
  if (error) {
    // Activation telemetry must not block a study session.
    console.warn('Unable to record first learning activity', error);
    return false;
  }
  return Boolean(data);
}

/** Records the first return after activation exactly once. */
export async function recordOnboardingSecondSession(): Promise<boolean> {
  const { data, error } = await supabase.rpc('record_onboarding_second_session');
  if (error) {
    console.warn('Unable to record second onboarding session', error);
    return false;
  }
  return Boolean(data);
}
