import { useMemo, useSyncExternalStore } from 'react';
import type { LoadState } from '../types';
import * as shelfStore from '../mocks/shelf';
import { addNote, allNotes, notesVersion, subscribeNotes, updateNote } from './notes';
import { myContributionById } from '../mocks/library';
import { canvasById, pagesFor } from '../mocks/studio-canvas';
import { spaceById } from '../mocks/spaces';
import { locateLesson } from '../mocks/lessons';
import { continueItem, yourWords } from '../studio/shelf';
import type { ShelfItem, WordEntry } from '../studio/shelf';
import type { CanvasDoc } from '../studio/types';
import type { Contribution } from '../types';
import { useScreenState } from './useSpaces';
import { liveWorld } from './world';

/**
 * The shelf seam. Screens read the shelf only through these hooks and change it
 * only through `shelfActions`; wiring a backend later replaces this file's body.
 */

/** Re-export of the store's mutations, for screens. */
export const shelfActions = shelfStore;

/**
 * `?mock=import-error` makes every brought-in file fail to read. It is read here,
 * beside the store, so the shared Scenario type (which screens settle on) stays as it was.
 */
export const importWillFail = (): boolean =>
  new URLSearchParams(window.location.search).get('mock') === 'import-error';

/** A page's canvas as you left it, or as it came. */
const docOf = (item: ShelfItem, canvases: ReadonlyMap<string, CanvasDoc>): CanvasDoc | null =>
  item.opens.kind === 'canvas' ? (canvases.get(item.id) ?? canvasById(item.opens.canvasId) ?? null) : null;

function wordsNow(items: ShelfItem[], canvases: ReadonlyMap<string, CanvasDoc>): WordEntry[] {
  const notes: WordEntry[] = allNotes().map((n) => ({
    kind: 'note',
    id: n.id,
    itemId: null,
    page: null,
    title: n.lessonTitle,
    body: n.body,
    at: n.updatedAt,
    // A note written in Library belongs to no Lesson yet: it has nowhere to open.
    href: n.lessonId && n.spaceId ? `/v4/space/${n.spaceId}/lesson/${n.lessonId}` : '',
  }));
  // Every page's answers, from the same canvas the page shows. A sample's own
  // written note is part of the sample; the answers you ask there are yours.
  const canvas: WordEntry[] = items.flatMap((item): WordEntry[] => {
    const doc = docOf(item, canvases);
    if (!doc) return [];
    // An answer or a note of yours sits on the page of the summary before it.
    let page: number | null = null;
    return doc.blocks.flatMap((b): WordEntry[] => {
      if (b.origin === 'summary' || b.origin === 'extracted') page = b.source.page;
      if (b.origin !== 'generated' && (b.origin !== 'written' || item.sample)) return [];
      return [
        {
          kind: b.origin === 'generated' ? 'answer' : 'written',
          id: b.id,
          itemId: item.id,
          page,
          title: b.origin === 'generated' ? b.askedAs : 'My note',
          body: b.markdown,
          at: doc.updatedAt,
          href: `/v4/library/m/${item.id}#b-${b.id}`,
        },
      ];
    });
  });
  return yourWords([...notes, ...canvas]);
}

const NONE: ShelfItem[] = [];

/** Live has no shelf files yet — see `useShelf`. Library hides bringing one in. */
export const shelfAcceptsFiles = (): boolean => liveWorld() === null;

export function useShelf(): {
  state: LoadState;
  items: ShelfItem[];
  continueItem: ShelfItem | null;
  words: WordEntry[];
} {
  const state = useScreenState();
  const all = useSyncExternalStore(shelfStore.subscribe, shelfStore.getItems);
  const canvases = useSyncExternalStore(shelfStore.subscribe, shelfStore.getCanvases);
  const notesV = useSyncExternalStore(subscribeNotes, notesVersion);
  const ready = state === 'ready';
  /*
   * Live, the shelf holds no files yet: what it brings in is in-memory and
   * develops on a timer, and the seed is the fixtures' Normalization deck —
   * neither belongs in a real account. Your words (real notes) stay.
   */
  const live = liveWorld() !== null;
  // `notesV` is the cue to re-read the note store: a note was written.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shelf = live ? NONE : all;
  const words = useMemo(() => (ready ? wordsNow(shelf, canvases) : []), [ready, shelf, canvases, notesV]);
  const items = ready ? shelf : [];
  return { state, items, continueItem: ready ? continueItem(shelf) : null, words };
}

export function useShelfItem(id: string | undefined): { state: LoadState; item: ShelfItem | null } {
  const state = useScreenState();
  const all = useSyncExternalStore(shelfStore.subscribe, shelfStore.getItems);
  const item = id && !liveWorld() ? (all.find((i) => i.id === id) ?? null) : null;
  if (state !== 'ready') return { state, item: null };
  return { state: item ? 'ready' : 'empty', item };
}

/**
 * A page's own canvas as you left it (answers asked, removed, sources
 * included); null while it is still the canvas it came with. Change it only
 * through `shelfActions.saveCanvas`, so the cover's answer count follows.
 */
export function useShelfCanvas(itemId: string | undefined): CanvasDoc | null {
  return useSyncExternalStore(shelfStore.subscribe, () => (itemId ? shelfStore.canvasFor(itemId) : null));
}

/** A brought-in file's development, as its cover shows it. */
export function useDevelopment(id: string): { phase: shelfStore.DevPhase; pulse: boolean } {
  const phase = useSyncExternalStore(shelfStore.subscribe, () => shelfStore.phaseOf(id));
  const pulse = useSyncExternalStore(shelfStore.subscribe, () => shelfStore.isPulsing(id));
  return { phase: phase ?? 'reading', pulse };
}

/** Your words: a note written in Library, which belongs to no Lesson yet. */
export const writeNote = (body: string): void => {
  addNote({ lessonId: '', body });
};

/** Your words: a note rewritten in place. */
export const rewriteNote = (id: string, body: string): void => {
  updateNote(id, body);
};

/** The contribution behind a Library entry (`lib-con-<id>`), for re-anchoring it. */
export const contributionForEntry = (entryId: string): Contribution | undefined =>
  myContributionById(entryId.replace(/^lib-con-/, ''));

/** The name a cover gives a Space it is shared or drafted in. */
export const shelfSpaceName = (spaceId: string): string => spaceById(spaceId)?.name ?? 'a Space';

export interface Glance {
  /** The page image to show: the cover, or the asked-for page. '' when there is none. */
  image: string;
  /** The page's summary, first paragraphs first; [] when there is no summary. */
  lines: string[];
}

/**
 * What a page shows at a glance: its image and its summary's first lines.
 * `page` omitted means the cover's own page. Lessons have no canvas summary.
 */
export function useGlance(item: ShelfItem, page?: number, max = 2): Glance {
  return useMemo(() => {
    if (item.opens.kind !== 'canvas') return { image: item.cover, lines: [] };
    const canvas = canvasById(item.opens.canvasId);
    if (!canvas) return { image: item.cover, lines: [] };
    const pages = pagesFor(canvas.materialIds);
    const asked = page !== undefined ? pages.find((p) => p.page === page) : undefined;
    const target = asked ?? pages.find((p) => p.imageUrl === item.cover);
    if (!target) return { image: item.cover, lines: [] };
    const lines = canvas.blocks
      .flatMap((b) => (b.origin === 'summary' && b.source.page === target.page ? [b.markdown] : []))
      .slice(0, max);
    return { image: asked ? asked.imageUrl : item.cover, lines };
  }, [item.opens, item.cover, page, max]);
}

/** A name that tells you nothing — `lesson-3.pdf`, `scan.jpg` — gives way to the Lesson's own title. */
const GENERIC_NAME = /^(lesson|file|untitled|scan|upload)[-_ ]?\d*\.[a-z0-9]+$/i;

const lessonTitleOf = (item: ShelfItem): string | null =>
  item.opens.kind === 'lesson' ? (locateLesson(item.opens.lessonId)?.lesson.title ?? null) : null;

/** The name a cover shows: its filename, unless that is generic and a Lesson's title says more. */
export const shelfTitle = (item: ShelfItem): string => {
  const lesson = lessonTitleOf(item);
  return lesson && GENERIC_NAME.test(item.filename.trim()) ? lesson : item.filename;
};

/**
 * A cover's names. A file brought in through a Space is often called
 * `lesson-3.pdf`; its Lesson's title is what tells two of them apart.
 */
export function useCoverTitle(item: ShelfItem): { title: string; lessonTitle: string | null } {
  return useMemo(
    () => ({ title: shelfTitle(item), lessonTitle: lessonTitleOf(item) }),
    // The names depend on these two only, not on progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item.filename, item.opens],
  );
}
