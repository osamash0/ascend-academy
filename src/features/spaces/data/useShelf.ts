import { useMemo, useSyncExternalStore } from 'react';
import type { LoadState } from '../types';
import * as shelfStore from '../mocks/shelf';
import { allNotes } from '../mocks/notes';
import { STUDIO_CANVAS } from '../mocks/studio-canvas';
import { continueItem, yourWords } from '../studio/shelf';
import type { ShelfItem, WordEntry } from '../studio/shelf';
import { useScreenState } from './useSpaces';

/**
 * The shelf seam. Screens read the shelf only through these hooks and change it
 * only through `shelfActions`; wiring a backend later replaces this file's body.
 */

/** Re-export of the store's mutations, for screens. */
export const shelfActions = shelfStore;

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
    href: `/v4/space/${n.spaceId}/lesson/${n.lessonId}`,
  }));
  // Answers asked in a session are not persisted globally yet: the seed canvas only.
  const canvas: WordEntry[] = STUDIO_CANVAS.blocks.flatMap((b): WordEntry[] => {
    if (b.origin !== 'generated' && b.origin !== 'written') return [];
    return [
      {
        kind: b.origin === 'generated' ? 'answer' : 'written',
        id: b.id,
        itemId: MATERIAL_ID,
        page: null,
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
  const ready = state === 'ready';
  // `all` is the cue to re-read: a note or a count changed with the shelf.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const words = useMemo(() => (ready ? wordsNow() : []), [ready, all]);
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
