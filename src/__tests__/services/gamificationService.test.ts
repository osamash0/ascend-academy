/**
 * Tests for gamificationService.ts
 *
 * All functions are thin RPC/DB wrappers. We verify:
 *   - the correct RPC name and args are passed to supabase.rpc
 *   - the correct table/query is issued for fetchBadgeCatalog
 *   - error paths return graceful fallbacks (no throw) per the service's contract
 *   - awardBadge handles array vs. object data shapes from the RPC
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedSupabaseMock as supabaseMock } from '@/test/sharedSupabaseMock';

vi.mock('@/integrations/supabase/client', async () => {
  const m = await import('@/test/sharedSupabaseMock');
  return { supabase: m.sharedSupabaseMock };
});

import {
  awardBadge,
  evaluateBadges,
  fetchBadgeCatalog,
  grantXp,
  type BadgeDefinition,
} from '@/services/gamificationService';

const BADGE_DEF: BadgeDefinition = {
  key: 'first_lecture',
  name: 'First Lecture',
  description: 'Completed your first lecture',
  icon: '📘',
  category: 'learning',
  xp_reward: 50,
  metric: null,
  threshold: null,
  sort_order: 1,
  is_secret: false,
};

beforeEach(() => {
  supabaseMock.reset();
  // Reset rpc mock between tests
  vi.mocked(supabaseMock.rpc).mockReset();
  vi.mocked(supabaseMock.rpc).mockResolvedValue({ data: null, error: null });
});

// ─── grantXp ─────────────────────────────────────────────────────────────────

describe('grantXp', () => {
  it('calls grant_xp RPC with correct p_xp, p_reason, p_dedupe_key', async () => {
    await grantXp(100, 'quiz_complete', 'lecture:abc');
    expect(supabaseMock.rpc).toHaveBeenCalledWith('grant_xp', {
      p_xp: 100,
      p_reason: 'quiz_complete',
      p_dedupe_key: 'lecture:abc',
    });
  });

  it('sends p_dedupe_key as null when dedupeKey is omitted', async () => {
    await grantXp(50, 'slide_view');
    expect(supabaseMock.rpc).toHaveBeenCalledWith('grant_xp', {
      p_xp: 50,
      p_reason: 'slide_view',
      p_dedupe_key: null,
    });
  });

  it('does not throw when RPC returns an error (fire-and-forget)', async () => {
    vi.mocked(supabaseMock.rpc).mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    });
    // grantXp only console.warns on error — it must not throw
    await expect(grantXp(10, 'test')).resolves.toBeUndefined();
  });

  it('returns void (undefined) on success', async () => {
    const result = await grantXp(25, 'badge_reward', 'badge:on_fire');
    expect(result).toBeUndefined();
  });
});

// ─── awardBadge ──────────────────────────────────────────────────────────────

describe('awardBadge', () => {
  it('calls award_badge RPC with the badge key', async () => {
    vi.mocked(supabaseMock.rpc).mockResolvedValue({ data: [BADGE_DEF], error: null });
    await awardBadge('first_lecture');
    expect(supabaseMock.rpc).toHaveBeenCalledWith('award_badge', { p_key: 'first_lecture' });
  });

  it('returns the BadgeDefinition when RPC returns an array with one item', async () => {
    vi.mocked(supabaseMock.rpc).mockResolvedValue({ data: [BADGE_DEF], error: null });
    const result = await awardBadge('first_lecture');
    expect(result?.key).toBe('first_lecture');
    expect(result?.name).toBe('First Lecture');
  });

  it('returns the BadgeDefinition when RPC returns an object directly (not array)', async () => {
    vi.mocked(supabaseMock.rpc).mockResolvedValue({ data: BADGE_DEF, error: null });
    const result = await awardBadge('first_lecture');
    expect(result?.key).toBe('first_lecture');
  });

  it('returns null when badge was already awarded (RPC returns empty array)', async () => {
    vi.mocked(supabaseMock.rpc).mockResolvedValue({ data: [], error: null });
    const result = await awardBadge('first_lecture');
    expect(result).toBeNull();
  });

  it('returns null when RPC returns null data (badge not found)', async () => {
    vi.mocked(supabaseMock.rpc).mockResolvedValue({ data: null, error: null });
    const result = await awardBadge('nonexistent');
    expect(result).toBeNull();
  });

  it('returns null (does not throw) when RPC returns an error', async () => {
    vi.mocked(supabaseMock.rpc).mockResolvedValue({
      data: null,
      error: { message: 'permission denied' },
    });
    await expect(awardBadge('on_fire')).resolves.toBeNull();
  });
});

// ─── evaluateBadges ───────────────────────────────────────────────────────────

describe('evaluateBadges', () => {
  it('calls evaluate_badges RPC (no extra args beyond the name)', async () => {
    vi.mocked(supabaseMock.rpc).mockResolvedValue({ data: [], error: null });
    await evaluateBadges();
    // The rpc helper always passes args as second param; expect it to be called
    // with 'evaluate_badges' as the first argument regardless of undefined args.
    expect(supabaseMock.rpc).toHaveBeenCalled();
    expect(vi.mocked(supabaseMock.rpc).mock.calls[0][0]).toBe('evaluate_badges');
  });

  it('returns the array of newly-awarded BadgeDefinitions', async () => {
    vi.mocked(supabaseMock.rpc).mockResolvedValue({ data: [BADGE_DEF], error: null });
    const result = await evaluateBadges();
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('first_lecture');
  });

  it('returns empty array when no badges were newly awarded', async () => {
    vi.mocked(supabaseMock.rpc).mockResolvedValue({ data: [], error: null });
    const result = await evaluateBadges();
    expect(result).toEqual([]);
  });

  it('returns empty array (does not throw) when RPC returns an error', async () => {
    vi.mocked(supabaseMock.rpc).mockResolvedValue({
      data: null,
      error: { message: 'internal error' },
    });
    await expect(evaluateBadges()).resolves.toEqual([]);
  });

  it('returns empty array when data is null', async () => {
    vi.mocked(supabaseMock.rpc).mockResolvedValue({ data: null, error: null });
    const result = await evaluateBadges();
    expect(result).toEqual([]);
  });
});

// ─── fetchBadgeCatalog ────────────────────────────────────────────────────────

describe('fetchBadgeCatalog', () => {
  it('returns all badge definitions from badge_definitions table', async () => {
    supabaseMock.seed('badge_definitions', [
      { ...BADGE_DEF },
      { ...BADGE_DEF, key: 'on_fire', name: 'On Fire', sort_order: 2 },
    ]);
    const result = await fetchBadgeCatalog();
    expect(result).toHaveLength(2);
    expect(result.map((b) => b.key)).toContain('first_lecture');
    expect(result.map((b) => b.key)).toContain('on_fire');
  });

  it('returns empty array when table is empty', async () => {
    supabaseMock.seed('badge_definitions', []);
    const result = await fetchBadgeCatalog();
    expect(result).toEqual([]);
  });
});
