/**
 * Gamification service — the single client surface for the server-side XP/badge
 * engine (migration 20260616000000). All awarding is authoritative + idempotent
 * on the DB side; these are thin RPC wrappers.
 */
import { supabase } from '@/integrations/supabase/client';

// The gamification RPCs + badge_definitions table are added via migration
// 20260616000000 and are not in the generated Supabase types yet.
const rpc = (name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as any)(name, args);

export interface BadgeDefinition {
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  xp_reward: number;
  metric: string | null;
  threshold: number | null;
  sort_order: number;
  is_secret: boolean;
}

/**
 * Claim a fixed completion/review reward with its canonical activity key.
 * The database validates the source record, amount and deduplication key.
 * Fire-and-forget safe: callers should not block the UI on this.
 */
export async function grantXp(
  xp: number,
  reason: string,
  dedupeKey?: string,
): Promise<void> {
  const { error } = await rpc('grant_xp', {
    p_xp: xp,
    p_reason: reason,
    p_dedupe_key: dedupeKey ?? null,
  });
  if (error) console.warn('grantXp failed', error);
}

/** Submit a quiz answer for a fixed reward, once per question across readers. */
export async function grantQuizXp(questionId: string, selectedIndex: number): Promise<void> {
  const { error } = await rpc('grant_quiz_xp', {
    p_question_id: questionId,
    p_selected_index: selectedIndex,
  });
  if (error) console.warn('grantQuizXp failed', error);
}

/**
 * Award an EVENT badge (one with no server-derivable metric, e.g. "Voice Heard",
 * "On Fire"). Returns the badge definition if it was newly awarded, else null.
 * State badges are awarded via {@link evaluateBadges} and are refused here.
 */
export async function awardBadge(key: string): Promise<BadgeDefinition | null> {
  const { data, error } = await rpc('award_badge', { p_key: key });
  if (error) {
    console.warn('awardBadge failed', error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row && (row as BadgeDefinition).key ? (row as BadgeDefinition) : null;
}

/**
 * Server-side sweep: awards every state badge whose threshold is now met from
 * durable tables. Returns the newly-awarded definitions (for popups). Cheap +
 * idempotent — safe to call after any meaningful action.
 */
export async function evaluateBadges(): Promise<BadgeDefinition[]> {
  const { data, error } = await rpc('evaluate_badges');
  if (error) {
    console.warn('evaluateBadges failed', error);
    return [];
  }
  return (data ?? []) as BadgeDefinition[];
}

/** Read the full badge catalog (RLS: any authenticated user). */
export async function fetchBadgeCatalog(): Promise<BadgeDefinition[]> {
  const { data, error } = await (supabase.from as any)('badge_definitions')
    .select('key, name, description, icon, category, xp_reward, metric, threshold, sort_order, is_secret')
    .order('sort_order', { ascending: true });
  if (error) {
    console.warn('fetchBadgeCatalog failed', error);
    return [];
  }
  return (data ?? []) as BadgeDefinition[];
}
