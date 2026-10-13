import { libraryItems } from '../mocks/library';
import type { LibraryItem } from '../types';
import { liveWorld } from './world';

/**
 * What the viewer has published into Spaces (contributions).
 *
 * Live, contributions do not exist yet — there is no table for them — so the
 * honest answer is none, not the fixture shelf. Profile's "published" and
 * "likes" read this.
 */
export const myPublishedNow = (): LibraryItem[] =>
  liveWorld() ? [] : libraryItems().filter((i) => i.kind === 'contribution');
