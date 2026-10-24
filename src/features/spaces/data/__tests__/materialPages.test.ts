import { describe, expect, it } from 'vitest';
import { fetchMaterialPages, isMaterialPages } from '../materialPages';

const ok = {
  materialId: 'L',
  pages: [{ materialId: 'L', page: 1, width: 720, height: 405, imageUrl: 'https://s/1', geometry: 'block',
            blocks: [{ id: 'p1-b0', page: 1, bbox: [0.1, 0.1, 0.9, 0.2], kind: 'heading', text: 'FDs', readingOrder: 0 }] }],
  summaries: [{ id: 's-p1-1', origin: 'summary', markdown: '**FDs**.', gist: true, edited: false,
                source: { materialId: 'L', page: 1, blockIds: ['p1-b0'] } }],
};
const res = (status: number, body?: unknown) =>
  Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));

describe('materialPages', () => {
  it('accepts the contract', () => {
    expect(isMaterialPages(ok)).toBe(true);
  });
  it('rejects a page with geometry page and blocks', () => {
    const bad = { ...ok, pages: [{ ...ok.pages[0], geometry: 'page' }] };
    expect(isMaterialPages(bad)).toBe(false);
  });
  it('rejects a summary pointing at a missing page', () => {
    const bad = { ...ok, summaries: [{ ...ok.summaries[0], source: { materialId: 'L', page: 9, blockIds: [] } }] };
    expect(isMaterialPages(bad)).toBe(false);
  });
  it('asks the right path', async () => {
    const paths: string[] = [];
    await fetchMaterialPages('L', (p) => { paths.push(p); return res(200, ok); });
    expect(paths).toEqual(['/api/v1/materials/L/pages']);
  });
  it('maps statuses', async () => {
    expect(await fetchMaterialPages('L', () => res(200, ok))).toEqual({ kind: 'ready', data: ok });
    expect(await fetchMaterialPages('L', () => res(409))).toEqual({ kind: 'developing' });
    expect(await fetchMaterialPages('L', () => res(404))).toEqual({ kind: 'missing' });
    expect(await fetchMaterialPages('L', () => res(500))).toEqual({ kind: 'error', status: 500 });
    expect(await fetchMaterialPages('L', () => res(200, { nope: 1 }))).toEqual({ kind: 'error', status: 200 });
  });
  it('encodes the id', async () => {
    const paths: string[] = [];
    await fetchMaterialPages('a/b', (p) => { paths.push(p); return res(404); });
    expect(paths).toEqual(['/api/v1/materials/a%2Fb/pages']);
  });
});
