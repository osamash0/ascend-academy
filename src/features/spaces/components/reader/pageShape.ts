/**
 * Whether a file reads as slides (one page at a time, filling the screen) or
 * as a document (pages scrolled at a readable width). Decided from page 1's
 * height / width: anything clearly taller than wide is a document. Unknown
 * reads as slides, which is what the reader did before it could tell.
 */
export type PageShape = 'slides' | 'document';

/** Taller than this (height / width) is a portrait document. A4 is 1.41. */
const PORTRAIT = 1.15;

export const shapeOf = (aspect: number | null): PageShape =>
  aspect !== null && aspect > PORTRAIT ? 'document' : 'slides';
