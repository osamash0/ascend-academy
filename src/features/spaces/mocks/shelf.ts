import { shareOutcome, type Mode, type Role, type ShelfItem } from '../studio/shelf';
import { insertAnswer } from '../studio/edit';
import type { CanvasDoc, GeneratedBlock } from '../studio/types';
import { itemsOfKind } from './library';
import { locateLesson } from './lessons';
import { STUDIO_CANVAS } from './studio-canvas';
import { STUDIO_ANSWERS } from './studio-answers';

/**
 * The shelf store — everything the viewer brought in, in memory.
 * Same shape as `reanchor-store.ts`: module state + subscribe.
 */

const NORM_COVER = '/v4-mock/studio/normalization-p1.webp';
const ZERO = { pagesRead: 0, recallKnew: 0, recallTotal: 0, answers: 0, notes: 0 };

const MATERIAL_PREFIX = 'lib-mat-';

/** Uploads are Materials in Library, named `lib-mat-<lessonId>`; the id carries the Lesson. */
const uploads = (): ShelfItem[] =>
  itemsOfKind('material').flatMap((m): ShelfItem[] => {
    if (!m.id.startsWith(MATERIAL_PREFIX)) return [];
    const lessonId = m.id.slice(MATERIAL_PREFIX.length);
    const found = locateLesson(lessonId);
    // No Lesson to open, or one that was archived: it is not on the shelf.
    if (!found || found.lesson.state === 'archived') return [];
    const { lesson, spaceId } = found;
    const state = lesson.state;
    return [
      {
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
      },
    ];
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
    // `answers` is not written here: it is counted from the page's own canvas (`seedCanvases`).
    progress: { pagesRead: 6, recallKnew: 9, recallTotal: 31, answers: 0, notes: 1 },
    lastOpenedAt: '2026-10-11T08:00:00Z',
    lastPage: 6,
    addedAt: '2026-10-10T09:00:00Z',
  },
  {
    id: 'm-design-notes',
    filename: 'Design process — my notes.pdf',
    // A sample opens the 12 sample pages, so it counts those: "page 9 of 12" stays true.
    pageCount: 12,
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
    pageCount: 12,
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

/* ── Each page's own canvas ─────────────────────────────────────
   Keyed by item id: what you asked, removed or included on that page. An item
   with no entry shows its canvas as it came. Samples that open the same canvas
   each get their own entry, so nothing one page gains shows on another. */

const SEED_QUESTIONS = ['What does pseudotransitivity give me?', 'Quiz me on Armstrong’s axioms'];

/** Two answers already asked on Normalization.pdf: the "2 answers" its cover says are on its page. */
function seedCanvases(): Map<string, CanvasDoc> {
  let doc: CanvasDoc = { ...STUDIO_CANVAS, updatedAt: '2026-10-11T08:00:00Z' };
  SEED_QUESTIONS.forEach((q, n) => {
    const a = STUDIO_ANSWERS.find((x) => x.question === q);
    if (!a) return;
    const block: GeneratedBlock = {
      id: `seed-ans-${n + 1}`,
      origin: 'generated',
      markdown: a.markdown,
      citations: a.citations,
      askedAs: a.question,
      question: a.question,
      anchorId: a.anchorId,
      ...(a.blocks && { blocks: a.blocks }),
      ...(a.format && { format: a.format }),
    };
    doc = insertAnswer(doc, block);
  });
  return new Map([['m-norm', doc]]);
}

const answersIn = (doc: CanvasDoc): number => doc.blocks.filter((b) => b.origin === 'generated').length;

/** The items, with every canvas-backed item's answer count read off its page. */
const withCounts = (list: ShelfItem[], docs: Map<string, CanvasDoc>): ShelfItem[] =>
  list.map((i) => {
    const doc = docs.get(i.id);
    return doc ? { ...i, progress: { ...i.progress, answers: answersIn(doc) } } : i;
  });

let canvases: Map<string, CanvasDoc> = seedCanvases();
let items: ShelfItem[] = withCounts(seed(), canvases);
let seq = 0;
let answerSeq = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((fn) => fn());
const set = (next: ShelfItem[]) => {
  items = next;
  emit();
};
/** A change that changes nothing — unknown id, or `fn` returning the same item — emits nothing. */
const patch = (id: string, fn: (i: ShelfItem) => ShelfItem) => {
  const at = items.findIndex((i) => i.id === id);
  if (at < 0) return;
  const next = fn(items[at]);
  if (next === items[at]) return;
  const out = [...items];
  out[at] = next;
  set(out);
};

export const getItems = (): ShelfItem[] => items;

export const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/* ── Development ───────────────────────────────────────────────
   A brought-in file reads in about three and a half seconds: "Reading your
   pages…" at once, "Writing your summary…" at 1.2 s, ready at 3.3 s. The
   timers live here, beside the item, not in the cover that shows them: a file
   on a hidden filter, or opened mid-way, still settles. */

export const WRITING_AT = 1200;
export const READY_AT = 3300;
/** How long a cover that just became ready says "· ready". */
export const PULSE_MS = 2000;

export type DevPhase = 'reading' | 'writing';

/** Snapshots: replaced, never mutated, so a reader can compare by identity. */
let phases = new Map<string, DevPhase>();
let pulses = new Set<string>();
const development = new Map<string, ReturnType<typeof setTimeout>[]>();
const pulseTimers = new Map<string, ReturnType<typeof setTimeout>>();

const setPhase = (id: string, phase: DevPhase | null) => {
  phases = new Map(phases);
  if (phase) phases.set(id, phase);
  else phases.delete(id);
};

const stopDeveloping = (id: string) => {
  development.get(id)?.forEach(clearTimeout);
  development.delete(id);
  if (phases.has(id)) setPhase(id, null);
};

const endPulse = (id: string) => {
  clearTimeout(pulseTimers.get(id));
  pulseTimers.delete(id);
  if (!pulses.has(id)) return;
  pulses = new Set(pulses);
  pulses.delete(id);
};

/** Starts (or starts again) one file's development. The caller emits. */
const develop = (id: string, fail: boolean) => {
  stopDeveloping(id);
  endPulse(id);
  setPhase(id, 'reading');
  development.set(id, [
    setTimeout(() => {
      setPhase(id, 'writing');
      emit();
    }, WRITING_AT),
    setTimeout(() => {
      development.delete(id);
      setPhase(id, null);
      const at = items.findIndex((i) => i.id === id);
      if (at >= 0 && items[at].stage === 'developing') {
        const out = [...items];
        out[at] = { ...items[at], stage: fail ? 'failed' : 'ready' };
        items = out;
        if (!fail) {
          pulses = new Set(pulses).add(id);
          pulseTimers.set(
            id,
            setTimeout(() => {
              endPulse(id);
              emit();
            }, PULSE_MS),
          );
        }
      }
      emit();
    }, READY_AT),
  ]);
};

/** Where a file's development is: 'reading', 'writing', or undefined when it is not developing here. */
export const phaseOf = (id: string): DevPhase | undefined => phases.get(id);
/** True for about two seconds after a file you brought in became ready. */
export const isPulsing = (id: string): boolean => pulses.has(id);

/** `fail` (the `?mock=import-error` preview) makes it end unread. */
export const bringIn = (
  filename: string,
  now: string = new Date().toISOString(),
  { fail = false }: { fail?: boolean } = {},
): string => {
  const id = `m-new-${++seq}`;
  develop(id, fail);
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
      broughtIn: true,
    },
    ...items,
  ]);
  return id;
};

/** Settles a developing file at once (tests; a real import's callback). Its timers stop. */
export const settleDeveloping = (id: string, ok: boolean): void => {
  const had = phases.has(id);
  stopDeveloping(id);
  const before = items;
  patch(id, (i) => (i.stage === 'developing' ? { ...i, stage: ok ? 'ready' : 'failed' } : i));
  if (had && items === before) emit();
};

/** Try again: a failed import begins developing afresh. */
export const retryDeveloping = (id: string, { fail = false }: { fail?: boolean } = {}): void => {
  const target = items.find((i) => i.id === id);
  if (!target || target.stage !== 'failed') return;
  develop(id, fail);
  patch(id, (i) => ({ ...i, stage: 'developing', broughtIn: true }));
};

/** A page past the last (a sample with more pages than its file) counts as the last. */
export const markRead = (id: string, page: number): void =>
  patch(id, (i) => {
    const last = Math.max(1, Math.min(i.pageCount, page));
    const pagesRead = Math.max(i.progress.pagesRead, last);
    if (i.lastPage === last && i.progress.pagesRead === pagesRead) return i;
    return { ...i, lastPage: last, progress: { ...i.progress, pagesRead } };
  });

/** This page's canvas as you left it; null when it is still the canvas it came with. */
export const canvasFor = (id: string): CanvasDoc | null => canvases.get(id) ?? null;

/** Every page's canvas, as one snapshot: a new Map whenever any of them changes. */
export const getCanvases = (): ReadonlyMap<string, CanvasDoc> => canvases;

/**
 * Keep a page's canvas. Its answer count is read off it, so the cover and the
 * page can never disagree. An unknown id, or the same doc, changes nothing.
 */
export const saveCanvas = (id: string, doc: CanvasDoc, now: string = new Date().toISOString()): void => {
  if (!items.some((i) => i.id === id) || canvases.get(id) === doc) return;
  canvases = new Map(canvases).set(id, { ...doc, updatedAt: now });
  const answers = answersIn(doc);
  const at = items.findIndex((i) => i.id === id);
  if (items[at].progress.answers !== answers) {
    const out = [...items];
    out[at] = { ...items[at], progress: { ...items[at].progress, answers } };
    items = out;
  }
  emit();
};

/** A fresh id for an answer: unique across every page and every visit. */
export const newAnswerId = (): string => `ans-${++answerSeq}`;

export const setRecall = (id: string, knew: number, total: number): void =>
  patch(id, (i) => ({ ...i, progress: { ...i.progress, recallKnew: knew, recallTotal: total } }));

export const touch = (id: string, now: string = new Date().toISOString()): void =>
  patch(id, (i) => (i.lastOpenedAt === now ? i : { ...i, lastOpenedAt: now }));

/**
 * Share a ready, private file. One still developing, one that failed, or one
 * already drafted or shared stays as it is (Publish and Take back are for those):
 * returns whether it was shared.
 */
export const share = (id: string, spaceId: string, role: Role, mode: Mode): boolean => {
  const target = items.find((i) => i.id === id);
  if (!target || target.stage !== 'ready' || target.share.kind !== 'private') return false;
  const o = shareOutcome(role, mode);
  patch(id, (i) => ({
    ...i,
    share:
      o.kind === 'draft'
        ? { kind: 'draft', spaceId, as: o.as }
        : { kind: 'shared', spaceId, as: o.as, likes: 0, endorsed: false, cleared: 0 },
  }));
  return true;
};

export const publish = (id: string): void =>
  patch(id, (i) =>
    i.share.kind === 'draft' && i.stage === 'ready'
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
  // Removed mid-development and its timers ran out meanwhile: it develops again.
  const { id, stage, broughtIn } = removed.item;
  if (stage === 'developing' && broughtIn && !development.has(id)) develop(id, false);
  const next = [...items];
  next.splice(Math.min(removed.index, next.length), 0, removed.item);
  set(next);
};

/** Test seam — each test starts from the seed. */
export const __reset = (): void => {
  for (const t of development.values()) t.forEach(clearTimeout);
  development.clear();
  for (const t of pulseTimers.values()) clearTimeout(t);
  pulseTimers.clear();
  phases = new Map();
  pulses = new Set();
  canvases = seedCanvases();
  items = withCounts(seed(), canvases);
  seq = 0;
  answerSeq = 0;
  emit();
};
