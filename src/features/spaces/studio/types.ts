/**
 * Studio canvas types — spec §6.
 *
 * Two sides. The *source* side is what the pipeline reads out of a Material
 * and never changes: pages, and blocks with where they sit on the page. The
 * *canvas* side is your version: blocks you read and edit, each saying where
 * it came from. `origin` is the one field every Studio rule keys on; having a
 * `source` is what every Peek/Morph rule keys on: `extracted` and `summary`
 * blocks have one, `generated` blocks carry citations instead, `written`
 * blocks have neither.
 */

import type { AnswerBlock } from './answers/spec';

/** Normalised to the page: 0..1, origin top-left. */
export type Box = [x0: number, y0: number, x1: number, y1: number];

export type SourceBlockKind =
  | 'heading' | 'paragraph' | 'list' | 'table' | 'code' | 'math' | 'figure' | 'handwriting';

export interface SourceBlock {
  /** Stable across re-extraction where the pipeline can manage it. */
  id: string;
  page: number;
  bbox: Box;
  kind: SourceBlockKind;
  /** Extracted text, never generated. Empty for figures. */
  text: string;
  /** OCR only. Below 0.8 the clean block gets a dotted underline. */
  confidence?: number;
  readingOrder: number;
}

export interface SourcePage {
  materialId: string;
  /** 1-based and contiguous — the number printed on the page. */
  page: number;
  /** Points; only the ratio matters. */
  width: number;
  height: number;
  imageUrl: string;
  /** `'page'` = no coordinates were available. They are never invented. */
  geometry: 'block' | 'page';
  /** Empty when `geometry === 'page'`. */
  blocks: SourceBlock[];
}

/** Where a clean block came from. `blockIds: []` means "this page, no finer". */
export interface SourceRef {
  materialId: string;
  page: number;
  blockIds: string[];
}

/** Extends the reader's `TutorCitation` rule — a pointer, never a footnote — down to a block. */
export interface Citation {
  label: string;
  materialId: string;
  page: number;
  blockId?: string;
  quote?: string;
}

export interface ExtractedBlock {
  id: string;
  origin: 'extracted';
  markdown: string;
  source: SourceRef;
  /** True once you changed the wording. The extracted text stays on the SourceBlock. */
  edited: boolean;
}

/** A few calm sentences condensing source blocks of ONE page (Living Learn spec §2–3). */
export interface SummaryBlock {
  id: string;
  origin: 'summary';
  /** 2–4 sentences; key terms as **term**. */
  markdown: string;
  /** Every source block it condenses; [] on page-only geometry. */
  source: SourceRef;
  /** The first paragraph of its page: read slightly brighter. */
  gist: boolean;
  /** You changed the wording. */
  edited: boolean;
}

/** A block with a place on the original: Peek, page markers, Morph flight. */
export type SourcedBlock = ExtractedBlock | SummaryBlock;

export interface WrittenBlock {
  id: string;
  origin: 'written';
  markdown: string;
}

export interface GeneratedBlock {
  id: string;
  origin: 'generated';
  markdown: string;
  citations: Citation[];
  askedAs: string;
  /** Typed parts the answer is composed of; `markdown` stays the plain-text version for screen readers and Morph. */
  blocks?: AnswerBlock[];
  /** A quiet label for the shape of the answer ("A table to try"). */
  format?: string;
  /** The block it grew under (Living Learn spec §4.2). */
  anchorId: string;
}

export type CanvasBlock = ExtractedBlock | SummaryBlock | WrittenBlock | GeneratedBlock;

/** Internal name only: the UI never says "document". */
export interface CanvasDoc {
  id: string;
  materialIds: string[];
  /** Destination Space; required before publishing (Plan 2). */
  spaceId: string | null;
  blocks: CanvasBlock[];
  revision: number;
  updatedAt: string;
}

export interface StudioMaterial {
  id: string;
  filename: string;
  spaceId: string | null;
  /** The file was removed; the clean version keeps working, the original can't be shown. */
  sourceRemoved: boolean;
}
