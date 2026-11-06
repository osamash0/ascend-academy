/**
 * The Layout page: the contract between the parser (`lecture_layouts`) and the
 * reader. One per page, served as the bundle's top-level `layouts`.
 *
 * A page the parser re-set is `LayoutReady` and carries its blocks and paths.
 * A page it held back is `LayoutHeld`: the verdict and its reasons only, with
 * no blocks and no paths, so the reader has nothing to switch to.
 */

/** Page fractions `[x0, y0, x1, y1]`, top-left origin, like `SourceBlock`. */
export type Box = [number, number, number, number];

export type LayoutKind = 'heading' | 'paragraph' | 'list' | 'table' | 'figure';

export interface LayoutBlock {
  id: string;
  kind: LayoutKind;
  bbox: Box;
  text: string;
  rows?: string[][];
  colW?: number[];
  linked?: boolean;
  picture?: boolean;
  diagram?: boolean;
}

/**
 * A vector stroke or fill from the page, redrawn by the layer. `d` is already in
 * page space: a 0..1000 box over the whole page (the layer's one SVG viewBox).
 * `bbox` is the path's extent as page fractions; it is not used for placement.
 */
export interface LayoutPath {
  d: string;
  bbox: Box;
  fill: boolean;
}

export interface LayoutReady {
  page: number;
  verdict: 'layout';
  reasons: string[];
  blocks: LayoutBlock[];
  paths: LayoutPath[];
  version: number;
}

export interface LayoutHeld {
  page: number;
  verdict: 'original';
  reasons: string[];
  version: number;
}

export type LayoutPage = LayoutReady | LayoutHeld;

const KINDS: readonly string[] = ['heading', 'paragraph', 'list', 'table', 'figure'];

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isBox = (x: unknown): x is Box => Array.isArray(x) && x.length === 4 && x.every(isNum);
const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');

function isBlock(x: unknown): x is LayoutBlock {
  if (!isObj(x)) return false;
  if (typeof x.id !== 'string' || typeof x.text !== 'string') return false;
  if (typeof x.kind !== 'string' || !KINDS.includes(x.kind) || !isBox(x.bbox)) return false;
  if (x.rows !== undefined && !(Array.isArray(x.rows) && x.rows.every(isStrings))) return false;
  if (x.colW !== undefined && !(Array.isArray(x.colW) && x.colW.every(isNum))) return false;
  return true;
}

function isPath(x: unknown): x is LayoutPath {
  return isObj(x) && typeof x.d === 'string' && isBox(x.bbox) && typeof x.fill === 'boolean';
}

/** True for a well-formed served page, ready or held. Anything else is dropped, never trusted. */
export function isLayoutPage(x: unknown): x is LayoutPage {
  if (!isObj(x)) return false;
  if (!isNum(x.page) || !isNum(x.version) || !isStrings(x.reasons)) return false;
  if (x.verdict === 'original') return true;
  if (x.verdict !== 'layout') return false;
  return Array.isArray(x.blocks) && x.blocks.every(isBlock) && Array.isArray(x.paths) && x.paths.every(isPath);
}

/** One shared empty map, so a Lesson with no Layout keeps the same identity between renders. Never written to. */
export const NO_LAYOUTS: Map<number, LayoutReady> = new Map();

/** The pages the reader can switch to, by page number. A held page has no entry. */
export function readyLayouts(rows: unknown): Map<number, LayoutReady> {
  const out = new Map<number, LayoutReady>();
  if (!Array.isArray(rows)) return out;
  for (const r of rows) if (isLayoutPage(r) && r.verdict === 'layout') out.set(r.page, r);
  return out;
}
