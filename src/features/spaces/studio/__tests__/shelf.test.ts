import { describe, expect, it } from 'vitest';
import {
  continueItem, filterItems, groupBySpace, journeyOf, lifeLine, shareOutcome, sortItems, yourWords,
  type ShelfItem, type WordEntry,
} from '../shelf';

const item = (o: Partial<ShelfItem> = {}): ShelfItem => ({
  id: 'x', filename: 'X.pdf', pageCount: 12, cover: '', stage: 'ready',
  share: { kind: 'private' }, opens: { kind: 'canvas', canvasId: 'c-norm' },
  progress: { pagesRead: 0, recallKnew: 0, recallTotal: 0, answers: 0, notes: 0 },
  lastOpenedAt: null, lastPage: null, addedAt: '2026-10-01T00:00:00Z', ...o,
});
const prog = (p: Partial<ShelfItem['progress']>) => ({ ...item().progress, ...p });
const shared = (o = {}) => ({ kind: 'shared' as const, spaceId: 's-dbs', as: 'lesson' as const, likes: 0, endorsed: false, cleared: 0, ...o });

describe('journeyOf', () => {
  it('developing private', () => {
    expect(journeyOf(item({ stage: 'developing' }))).toEqual({ brought: 'done', understood: 'now', shared: 'todo', landed: 'todo' });
  });
  it('ready unread -> understood now', () => {
    expect(journeyOf(item()).understood).toBe('now');
  });
  it('read -> understood done, shared now', () => {
    const j = journeyOf(item({ progress: prog({ pagesRead: 1 }) }));
    expect(j.understood).toBe('done');
    expect(j.shared).toBe('now');
  });
  it('draft -> shared now', () => {
    expect(journeyOf(item({ share: { kind: 'draft', spaceId: 's-linalg', as: 'lesson' } })).shared).toBe('now');
  });
  it('shared with no reaction -> landed now', () => {
    const j = journeyOf(item({ share: shared() }));
    expect(j.shared).toBe('done');
    expect(j.landed).toBe('now');
  });
  it('shared with likes -> landed done', () => {
    expect(journeyOf(item({ share: shared({ likes: 3 }) })).landed).toBe('done');
  });
});

describe('shareOutcome', () => {
  it('owner/editor -> draft lesson in any mode', () => {
    for (const role of ['owner', 'editor'] as const) {
      for (const mode of ['guided', 'open'] as const) {
        const o = shareOutcome(role, mode);
        expect([o.as, o.kind]).toEqual(['lesson', 'draft']);
        expect(o.copy('Database Systems')).toEqual({ key: 'share.outcome.draft', params: { space: 'Database Systems' } });
      }
    }
  });
  it('member + open', () => {
    const o = shareOutcome('member', 'open');
    expect([o.as, o.kind]).toEqual(['community-lesson', 'shared']);
    expect(o.copy('Database Systems')).toEqual({ key: 'share.outcome.open', params: undefined });
  });
  it('member + guided', () => {
    const o = shareOutcome('member', 'guided');
    expect([o.as, o.kind]).toEqual(['contribution', 'shared']);
    expect(o.copy('Database Systems')).toEqual({ key: 'share.outcome.contribution', params: undefined });
  });
});

describe('lifeLine', () => {
  it('omits zeros', () => {
    expect(lifeLine(item({ progress: prog({ pagesRead: 6, recallKnew: 9, recallTotal: 31, answers: 2, notes: 1 }) }))).toEqual([
      { key: 'life.read', params: { read: 6, total: 12 } },
      { key: 'life.recall', params: { knew: 9, total: 31 } },
      { key: 'life.answers', params: { count: 2 } },
      { key: 'life.notes', params: { count: 1 } },
    ]);
    expect(lifeLine(item())).toEqual([]);
    expect(lifeLine(item({ progress: prog({ answers: 1 }) }))).toEqual([{ key: 'life.answers', params: { count: 1 } }]);
  });
});

describe('filterItems', () => {
  const priv = item({ id: 'p', filename: 'Alpha.pdf' });
  const draft = item({ id: 'd', filename: 'Beta.pdf', share: { kind: 'draft', spaceId: 's-linalg', as: 'lesson' } });
  const doneShared = item({ id: 's1', filename: 'Gamma.pdf', share: shared(), progress: prog({ pagesRead: 12 }) });
  const readingShared = item({ id: 's2', filename: 'Delta.pdf', share: shared(), progress: prog({ pagesRead: 3 }) });
  const all = [priv, draft, doneShared, readingShared];
  it('filters', () => {
    expect(filterItems(all, 'reading', '').map((i) => i.id)).toEqual(['p', 'd', 's2']);
    expect(filterItems(all, 'shared', '').map((i) => i.id)).toEqual(['d', 's1', 's2']);
    expect(filterItems(all, 'all', '')).toHaveLength(4);
    expect(filterItems(all, 'words', '')).toEqual([]);
    expect(filterItems(all, 'all', 'aLPha').map((i) => i.id)).toEqual(['p']);
  });
});

describe('sortItems', () => {
  const a = item({ id: 'a', filename: 'b.pdf', lastOpenedAt: '2026-10-05T00:00:00Z', addedAt: '2026-10-01T00:00:00Z' });
  const b = item({ id: 'b', filename: 'a.pdf', lastOpenedAt: null, addedAt: '2026-10-09T00:00:00Z' });
  const c = item({ id: 'c', filename: 'c.pdf', lastOpenedAt: '2026-10-07T00:00:00Z', addedAt: '2026-10-03T00:00:00Z' });
  it('recent: opened newest first, never-opened last', () => {
    expect(sortItems([a, b, c], 'recent').map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });
  it('recent: developing and failed lead, newest first, ahead of opened ones', () => {
    const d1 = item({ id: 'd1', stage: 'developing', addedAt: '2026-10-02T00:00:00Z' });
    const d2 = item({ id: 'd2', stage: 'developing', addedAt: '2026-10-10T00:00:00Z' });
    const f = item({ id: 'f', stage: 'failed', addedAt: '2026-10-06T00:00:00Z' });
    expect(sortItems([a, d1, c, f, d2], 'recent').map((i) => i.id)).toEqual(['d2', 'f', 'd1', 'c', 'a']);
  });
  it('added newest first', () => {
    expect(sortItems([a, b, c], 'added').map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });
  it('az', () => {
    expect(sortItems([a, b, c], 'az').map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('groupBySpace', () => {
  it('A-Z by space, private last', () => {
    const names: Record<string, string> = { 's-dbs': 'Database Systems', 's-linalg': 'Algebra' };
    const g = groupBySpace(
      [item({ id: 'p' }), item({ id: 'a', share: shared() }), item({ id: 'b', share: { kind: 'draft', spaceId: 's-linalg', as: 'lesson' } })],
      (id) => names[id],
    );
    expect(g.map((x) => x.title)).toEqual(['Algebra', 'Database Systems', 'Only you']);
    expect(g[2].items[0].id).toBe('p');
  });
});

describe('continueItem', () => {
  it('newest ready, ignoring developing/failed', () => {
    const cover = 'p1.webp';
    const items = [
      item({ id: 'a', cover, lastOpenedAt: '2026-10-01T00:00:00Z' }),
      item({ id: 'b', cover, lastOpenedAt: '2026-10-05T00:00:00Z' }),
      item({ id: 'c', cover, stage: 'developing', lastOpenedAt: '2026-10-09T00:00:00Z' }),
      item({ id: 'd', cover, stage: 'failed', lastOpenedAt: '2026-10-10T00:00:00Z' }),
    ];
    expect(continueItem(items)?.id).toBe('b');
    expect(continueItem([])).toBeNull();
  });
});

describe('yourWords', () => {
  it('newest first, stable on ties', () => {
    const e = (id: string, at: string): WordEntry => ({ kind: 'note', id, itemId: null, page: null, title: id, body: '', at, href: '/' });
    expect(yourWords([e('a', '2026-10-01'), e('b', '2026-10-03'), e('c', '2026-10-03'), e('d', '2026-10-02')]).map((x) => x.id)).toEqual(['b', 'c', 'd', 'a']);
  });
});
