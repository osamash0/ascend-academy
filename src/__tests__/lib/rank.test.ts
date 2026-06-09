import { describe, expect, it } from 'vitest';
import { RANK_TIERS, rankForXp, rankProgress } from '@/lib/rank';

describe('rankForXp', () => {
  it('maps boundary values to the correct tier', () => {
    expect(rankForXp(0).name).toBe('Newcomer');
    expect(rankForXp(499).name).toBe('Newcomer');
    expect(rankForXp(500).name).toBe('Learner');
    expect(rankForXp(1499).name).toBe('Learner');
    expect(rankForXp(1500).name).toBe('Scholar');
    expect(rankForXp(3500).name).toBe('Expert');
    expect(rankForXp(7000).name).toBe('Master');
    expect(rankForXp(13000).name).toBe('Legend');
    expect(rankForXp(25000).name).toBe('Immortal');
    expect(rankForXp(999999).name).toBe('Immortal');
  });

  it('clamps negative / nullish XP to Newcomer', () => {
    expect(rankForXp(-50).name).toBe('Newcomer');
    expect(rankForXp(null).name).toBe('Newcomer');
    expect(rankForXp(undefined).name).toBe('Newcomer');
  });

  it('only the top two tiers animate', () => {
    const animated = RANK_TIERS.filter((t) => t.animated).map((t) => t.name);
    expect(animated).toEqual(['Legend', 'Immortal']);
  });
});

describe('rankProgress', () => {
  it('reports progress toward the next tier', () => {
    const p = rankProgress(1000); // Learner (500) → Scholar (1500)
    expect(p.tier.name).toBe('Learner');
    expect(p.next?.name).toBe('Scholar');
    expect(p.toNext).toBe(500);
    expect(p.pct).toBeCloseTo(0.5, 5);
  });

  it('caps out at the max tier', () => {
    const p = rankProgress(25000);
    expect(p.tier.name).toBe('Immortal');
    expect(p.next).toBeNull();
    expect(p.toNext).toBe(0);
    expect(p.pct).toBe(1);
  });
});
