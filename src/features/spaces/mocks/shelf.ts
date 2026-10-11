import { shareOutcome, type Mode, type Role, type ShelfItem } from '../studio/shelf';
import { itemsOfKind } from './library';
import { locateLesson } from './lessons';

/**
 * The shelf store — everything the viewer brought in, in memory.
 * Same shape as `reanchor-store.ts`: module state + subscribe.
 */

const NORM_COVER = '/v4-mock/studio/normalization-p1.webp';
const ZERO = { pagesRead: 0, recallKnew: 0, recallTotal: 0, answers: 0, notes: 0 };

const uploads = (): ShelfItem[] =>
  itemsOfKind('material').map((m) => {
    const spaceId = m.spaceId ?? '';
    const lessonId = (m.href ?? '').split('/').pop() ?? '';
    const state = locateLesson(lessonId)?.lesson.state;
    return {
      id: m.id,
      filename: m.title,
      pageCount: 1,
      cover: '',
      stage: m.pending && state === 'processing' ? 'developing' : 'ready',
      share:
        state === 'published'
          ? { kind: 'shared', spaceId, as: 'lesson', likes: 0, endorsed: false, cleared: 0 }
          : { kind: 'draft', spaceId, as: 'lesson' },
      opens: { kind: 'lesson', spaceId, lessonId },
      progress: { ...ZERO },
      lastOpenedAt: null,
      lastPage: null,
      addedAt: m.updatedAt,
    } satisfies ShelfItem;
  });

const seed = (): ShelfItem[] => [
  {
    id: 'm-norm',
    filename: 'Normalization.pdf',
    pageCount: 12,
    cover: NORM_COVER,
    stage: 'ready',
    share: { kind: 'shared', spaceId: 's-dbs', as: 'contribution', likes: 3, endorsed: false, cleared: 2 },
    opens: { kind: 'canvas', canvasId: 'c-norm' },
    progress: { pagesRead: 6, recallKnew: 9, recallTotal: 31, answers: 2, notes: 1 },
    lastOpenedAt: '2026-10-11T08:00:00Z',
    lastPage: 6,
    addedAt: '2026-10-10T09:00:00Z',
  },
  {
    id: 'm-design-notes',
    filename: 'Design process — my notes.pdf',
    pageCount: 4,
    cover: '/v4-mock/studio/normalization-p2.webp',
    stage: 'ready',
    share: { kind: 'private' },
    opens: { kind: 'canvas', canvasId: 'c-norm' },
    progress: { ...ZERO, pagesRead: 4 },
    lastOpenedAt: '2026-10-09T18:00:00Z',
    lastPage: null,
    addedAt: '2026-10-08T10:00:00Z',
    sample: true,
  },
  {
    id: 'm-axioms',
    filename: 'Axioms cheat sheet.pdf',
    pageCount: 2,
    cover: '/v4-mock/studio/normalization-p9.webp',
    stage: 'ready',
    share: { kind: 'draft', spaceId: 's-linalg', as: 'lesson' },
    opens: { kind: 'canvas', canvasId: 'c-norm' },
    progress: { ...ZERO, pagesRead: 1 },
    lastOpenedAt: null,
    lastPage: null,
    addedAt: '2026-10-07T10:00:00Z',
    sample: true,
  },
  ...uploads(),
];

let items: ShelfItem[] = seed();
let seq = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((fn) => fn());
const set = (next: ShelfItem[]) => {
  items = next;
  emit();
};
const patch = (id: string, fn: (i: ShelfItem) => ShelfItem) =>
  set(items.map((i) => (i.id === id ? fn(i) : i)));

export const getItems = (): ShelfItem[] => items;

export const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const bringIn = (filename: string, now: string = new Date().toISOString()): string => {
  const id = `m-new-${++seq}`;
  set([
    {
      id,
      filename,
      pageCount: 12,
      cover: NORM_COVER,
      stage: 'developing',
      share: { kind: 'private' },
      opens: { kind: 'canvas', canvasId: 'c-norm' },
      progress: { ...ZERO },
      lastOpenedAt: null,
      lastPage: null,
      addedAt: now,
      sample: true,
    },
    ...items,
  ]);
  return id;
};

export const settleDeveloping = (id: string, ok: boolean): void =>
  patch(id, (i) => (i.stage === 'developing' ? { ...i, stage: ok ? 'ready' : 'failed' } : i));

export const markRead = (id: string, page: number): void =>
  patch(id, (i) => ({
    ...i,
    lastPage: page,
    progress: { ...i.progress, pagesRead: Math.min(i.pageCount, Math.max(i.progress.pagesRead, page)) },
  }));

export const bumpAnswers = (id: string, delta: number): void =>
  patch(id, (i) => ({
    ...i,
    progress: { ...i.progress, answers: Math.max(0, i.progress.answers + delta) },
  }));

export const setRecall = (id: string, knew: number, total: number): void =>
  patch(id, (i) => ({ ...i, progress: { ...i.progress, recallKnew: knew, recallTotal: total } }));

export const touch = (id: string, now: string = new Date().toISOString()): void =>
  patch(id, (i) => ({ ...i, lastOpenedAt: now }));

export const share = (id: string, spaceId: string, role: Role, mode: Mode): void => {
  const o = shareOutcome(role, mode);
  patch(id, (i) => ({
    ...i,
    share:
      o.kind === 'draft'
        ? { kind: 'draft', spaceId, as: o.as }
        : { kind: 'shared', spaceId, as: o.as, likes: 0, endorsed: false, cleared: 0 },
  }));
};

export const publish = (id: string): void =>
  patch(id, (i) =>
    i.share.kind === 'draft'
      ? {
          ...i,
          share: {
            kind: 'shared',
            spaceId: i.share.spaceId,
            as: i.share.as,
            likes: 0,
            endorsed: false,
            cleared: 0,
          },
        }
      : i,
  );

export const unshare = (id: string): void => patch(id, (i) => ({ ...i, share: { kind: 'private' } }));

export const remove = (id: string): { item: ShelfItem; index: number } | null => {
  const index = items.findIndex((i) => i.id === id);
  if (index < 0) return null;
  const item = items[index];
  set(items.filter((i) => i.id !== id));
  return { item, index };
};

export const restore = (removed: { item: ShelfItem; index: number }): void => {
  if (items.some((i) => i.id === removed.item.id)) return;
  const next = [...items];
  next.splice(Math.min(removed.index, next.length), 0, removed.item);
  set(next);
};

/** Test seam — each test starts from the seed. */
export const __reset = (): void => {
  items = seed();
  seq = 0;
  emit();
};
