/**
 * The database's avatar catalog (migration 20261012000400) must match the
 * app's catalog item for item, or the server would reject gear the app shows
 * as unlocked (or allow gear it shows as locked). Regenerate the seed rows
 * from catalog.ts whenever an item is added or its unlock changes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RANK_TIERS } from '@/lib/rank';
import { CATALOG } from '../catalog';

const sql = readFileSync(resolve(__dirname, '../../../../supabase/migrations/20261012000400_avatar_unlock_guard.sql'), 'utf8');

const seeded = new Map(
  [...sql.matchAll(/\('([a-z0-9-]+)', '([a-z]+)', '([a-z]+)', (NULL|'[^']*')\)/g)].map(([, id, slot, kind, value]) => [
    id,
    { slot, kind, value: value === 'NULL' ? null : value.slice(1, -1) },
  ]),
);

const expected = (u: (typeof CATALOG)[number]['unlock']) =>
  u.kind === 'free' ? null : u.kind === 'rank' ? u.tier : u.kind === 'badge' ? u.key : String(u.kind === 'level' ? u.level : u.days);

describe('avatar catalog: app vs database', () => {
  it('seeds exactly the items the app has', () => {
    expect([...seeded.keys()].sort()).toEqual(CATALOG.map((i) => i.id).sort());
  });

  it.each(CATALOG.map((i) => [i.id, i] as const))('%s has the same slot and unlock', (_id, item) => {
    const row = seeded.get(item.id)!;
    expect(row).toEqual({ slot: item.slot, kind: item.unlock.kind, value: expected(item.unlock) });
  });

  it('mirrors every rank threshold', () => {
    for (const tier of RANK_TIERS) expect(sql).toMatch(new RegExp(`WHEN '${tier.name}'\\s+THEN ${tier.min}\\b`));
  });
});
