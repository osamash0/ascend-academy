import type { SourcePage, SummaryBlock } from '../studio/types';

/**
 * The live contract for a Studio material's pages — real-pages spec §6.
 * The live SpacesRepository calls this with its own authed `get`; this file
 * never fetches by itself and never touches mocks.
 */
export interface MaterialPages {
  materialId: string;
  pages: SourcePage[];
  summaries: SummaryBlock[];
}

export type MaterialPagesResult =
  | { kind: 'ready'; data: MaterialPages }
  | { kind: 'developing' }
  | { kind: 'missing' }
  | { kind: 'error'; status: number };

export type MaterialStage = 'developing' | 'ready' | 'failed';

/** One row of `GET /api/v1/materials`, the fields the shelf needs. */
export interface MaterialListItem {
  run_id: string;
  lecture_id: string | null;
  title: string;
  filename: string;
  stage: MaterialStage;
  page_count: number;
  pages_ready: number;
  poster_url: string | null;
  created_at: string;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isBox = (b: unknown) => Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number');

function isPage(p: unknown): p is SourcePage {
  if (!isObj(p)) return false;
  const geometryOk = p.geometry === 'block' || (p.geometry === 'page' && Array.isArray(p.blocks) && p.blocks.length === 0);
  return (
    typeof p.materialId === 'string' && typeof p.page === 'number' && typeof p.imageUrl === 'string' &&
    typeof p.width === 'number' && typeof p.height === 'number' && geometryOk && Array.isArray(p.blocks) &&
    p.blocks.every((b) => isObj(b) && typeof b.id === 'string' && isBox(b.bbox) && typeof b.text === 'string')
  );
}

export function isMaterialPages(x: unknown): x is MaterialPages {
  if (!isObj(x) || typeof x.materialId !== 'string' || !Array.isArray(x.pages) || !Array.isArray(x.summaries)) return false;
  if (!x.pages.every(isPage)) return false;
  const pageNos = new Set((x.pages as SourcePage[]).map((p) => p.page));
  return x.summaries.every(
    (s) => isObj(s) && s.origin === 'summary' && typeof s.markdown === 'string' && isObj(s.source) &&
      typeof s.source.page === 'number' && pageNos.has(s.source.page) && Array.isArray(s.source.blockIds),
  );
}

export async function fetchMaterialPages(
  id: string,
  get: (path: string) => Promise<Response>,
): Promise<MaterialPagesResult> {
  const r = await get(`/api/v1/materials/${encodeURIComponent(id)}/pages`);
  if (r.status === 409) return { kind: 'developing' };
  if (r.status === 404) return { kind: 'missing' };
  if (!r.ok) return { kind: 'error', status: r.status };
  const body: unknown = await r.json().catch(() => null);
  return isMaterialPages(body) ? { kind: 'ready', data: body } : { kind: 'error', status: r.status };
}
