import { useMemo, useSyncExternalStore } from 'react';
import type { LoadState } from '../types';
import * as shelfStore from '../mocks/shelf';
import { allNotes, notesVersion, subscribeNotes } from '../mocks/notes';
import { STUDIO_CANVAS, canvasById, pagesFor } from '../mocks/studio-canvas';
import { spaceById } from '../mocks/spaces';
import { locateLesson } from '../mocks/lessons';
import { continueItem, yourWords } from '../studio/shelf';
import type { ShelfItem, WordEntry } from '../studio/shelf';
import { useScreenState } from './useSpaces';

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

const MATERIAL_ID = 'm-norm';

function wordsNow(): WordEntry[] {
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
  // Answers asked in a session are not persisted globally yet: the seed canvas only.
  // An answer or a note of yours sits on the page of the summary before it.
  let page: number | null = null;
  const canvas: WordEntry[] = STUDIO_CANVAS.blocks.flatMap((b): WordEntry[] => {
    if (b.origin === 'summary' || b.origin === 'extracted') page = b.source.page;
    if (b.origin !== 'generated' && b.origin !== 'written') return [];
    return [
      {
        kind: b.origin === 'generated' ? 'answer' : 'written',
        id: b.id,
        itemId: MATERIAL_ID,
        page,
        title: b.origin === 'generated' ? b.askedAs : 'My note',
        body: b.markdown,
        at: STUDIO_CANVAS.updatedAt,
        href: `/v4/library/m/${MATERIAL_ID}#b-${b.id}`,
      },
    ];
  });
  return yourWords([...notes, ...canvas]);
}

export function useShelf(): {
  state: LoadState;
  items: ShelfItem[];
  continueItem: ShelfItem | null;
  words: WordEntry[];
} {
  const state = useScreenState();
  const all = useSyncExternalStore(shelfStore.subscribe, shelfStore.getItems);
  const notesV = useSyncExternalStore(subscribeNotes, notesVersion);
  const ready = state === 'ready';
  // `all` and `notesV` are the cues to re-read: a count changed, or a note was written.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const words = useMemo(() => (ready ? wordsNow() : []), [ready, all, notesV]);
  const items = ready ? all : [];
  return { state, items, continueItem: ready ? continueItem(all) : null, words };
}

export function useShelfItem(id: string | undefined): { state: LoadState; item: ShelfItem | null } {
  const state = useScreenState();
  const all = useSyncExternalStore(shelfStore.subscribe, shelfStore.getItems);
  const item = id ? (all.find((i) => i.id === id) ?? null) : null;
  if (state !== 'ready') return { state, item: null };
  return { state: item ? 'ready' : 'empty', item };
}

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
