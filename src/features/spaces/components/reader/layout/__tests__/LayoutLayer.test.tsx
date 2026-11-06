import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { LayoutLayer } from '../LayoutLayer';
import type { LayoutBlock, LayoutPage, LayoutReady } from '../types';

const page = (blocks: LayoutBlock[], paths: LayoutReady['paths'] = []): LayoutReady => ({
  page: 5,
  verdict: 'layout',
  reasons: [],
  blocks,
  paths,
  version: 1,
});

const draw = (p: LayoutPage, night?: boolean) => render(<LayoutLayer page={p} night={night} />).container;
const blockEl = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-id="${id}"]`);
const ground = (c: HTMLElement) => c.querySelector('svg[data-ground] path')!.getAttribute('d')!;

describe('LayoutLayer', () => {
  it('is a container the size of the page, numbered by page', () => {
    const c = draw(page([]));
    const root = c.querySelector<HTMLElement>('.ls-layout')!;
    expect(root).not.toBeNull();
    expect(root.dataset.layoutPage).toBe('5');
  });

  it('draws nothing for a page held as original', () => {
    const c = draw({ page: 7, verdict: 'original', reasons: ['3 of 40 words missing'], version: 1 });
    expect(c.querySelector('.ls-layout')).toBeNull();
  });

  it('places each block at its box in percent', () => {
    const c = draw(page([{ id: 'p1', kind: 'paragraph', bbox: [0.1, 0.2, 0.5, 0.6], text: 'Words.' }]));
    const el = blockEl(c, 'p1')!;
    expect(el.style.left).toBe('10%');
    expect(el.style.top).toBe('20%');
    expect(el.style.width).toBe('40%');
    expect(el.style.height).toBe('40%');
    expect(el.dataset.kind).toBe('p');
    expect(el.dataset.group).toBe('body');
  });

  it('sets a heading as its first line with the rest beneath it', () => {
    const c = draw(page([{ id: 'h1', kind: 'heading', bbox: [0.1, 0.05, 0.9, 0.15], text: 'Normalization\nwhy and how' }]));
    const el = blockEl(c, 'h1')!;
    expect(el.dataset.group).toBe('h');
    expect(el.firstChild?.textContent).toBe('Normalization');
    expect(el.querySelector('.sub')?.textContent).toBe('why and how');
  });

  it('cuts a figure out of the ground instead of drawing it', () => {
    const c = draw(
      page([
        { id: 'h1', kind: 'heading', bbox: [0.1, 0.05, 0.9, 0.15], text: 'Title' },
        { id: 'pic', kind: 'figure', bbox: [0.1, 0.2, 0.5, 0.6], text: '', picture: true },
      ]),
    );
    const svg = c.querySelector('svg[data-ground]')!;
    const path = svg.querySelector('path')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 1000');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
    expect(path.getAttribute('fill-rule')).toBe('evenodd');
    expect(ground(c)).toBe('M0 0H1000V1000H0Z M100 200H500V600H100Z');
    const fig = blockEl(c, 'pic')!;
    expect(fig.dataset.group).toBe('fig');
    expect(fig.textContent).toBe('');
    expect(fig.children).toHaveLength(0);
  });

  it('cuts overlapping figures as one window, never re-filling the overlap', () => {
    const c = draw(
      page([
        { id: 'a', kind: 'figure', bbox: [0.1, 0.1, 0.5, 0.5], text: '' },
        { id: 'b', kind: 'figure', bbox: [0.3, 0.3, 0.7, 0.7], text: '' },
      ]),
    );
    const d = ground(c);
    // The union, cut into disjoint rectangles: three bands.
    expect(d).toBe('M0 0H1000V1000H0Z M100 100H500V300H100Z M100 300H700V500H100Z M300 500H700V700H300Z');
  });

  it('turns a block with a private-use glyph into a window with no text', () => {
    const c = draw(page([{ id: 'w', kind: 'paragraph', bbox: [0.2, 0.7, 0.6, 0.8], text: 'x  y' }]));
    const el = blockEl(c, 'w')!;
    expect(el.dataset.kind).toBe('window');
    expect(el.textContent).toBe('');
    expect(ground(c)).toContain('M200 700H600V800H200Z');
  });

  it('leaves page numbers out', () => {
    const c = draw(page([{ id: 'n', kind: 'paragraph', bbox: [0.9, 0.9, 0.95, 0.95], text: 'Seite 4' }]));
    expect(blockEl(c, 'n')).toBeNull();
  });

  it('splits a bulleted block into items', () => {
    const c = draw(page([{ id: 'l', kind: 'list', bbox: [0.1, 0.2, 0.9, 0.6], text: '• one\nmore\n• two' }]));
    const items = blockEl(c, 'l')!.querySelectorAll('.li');
    expect([...items].map((i) => i.textContent)).toEqual(['one more', 'two']);
  });

  it('gives a linked block the warm ink', () => {
    const c = draw(page([{ id: 'k', kind: 'list', bbox: [0.1, 0.2, 0.9, 0.6], text: 'Key', linked: true }]));
    expect(blockEl(c, 'k')!.classList.contains('linked')).toBe(true);
  });

  it('sets a table as rows of a grid with the original column widths', () => {
    const c = draw(
      page([{ id: 't', kind: 'table', bbox: [0.1, 0.2, 0.9, 0.6], text: '', rows: [['a', 'b'], ['1']], colW: [0.2, 0.3] }]),
    );
    const el = blockEl(c, 't')!;
    expect(el.dataset.group).toBe('row');
    const rows = el.querySelectorAll<HTMLElement>('.tr');
    expect(rows).toHaveLength(2);
    // The original widths as shares of the table, so the columns fill its box.
    expect(rows[0].style.gridTemplateColumns).toBe('minmax(0, 0.4fr) minmax(0, 0.6fr)');
    expect(rows[1].querySelectorAll('span')).toHaveLength(2);
  });

  it('sets a row as cells', () => {
    const c = draw(page([{ id: 'r', kind: 'paragraph', bbox: [0.1, 0.5, 0.9, 0.55], text: 'Name\n1\n2\n3' }]));
    const el = blockEl(c, 'r')!;
    expect(el.dataset.group).toBe('row');
    expect(el.querySelectorAll('span')).toHaveLength(4);
    expect(el.classList.contains('head')).toBe(true);
  });

  it('redraws the paths in a 0..1000 box', () => {
    const c = draw(page([], [{ d: 'M10.0,20.0L30.0,40.0', bbox: [0.01, 0.02, 0.03, 0.04], fill: true }]));
    const svg = c.querySelector('svg.reink')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 1000');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
    const p = svg.querySelector('path')!;
    expect(p.getAttribute('d')).toBe('M10.0,20.0L30.0,40.0');
    expect(p.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(p.classList.contains('f')).toBe(true);
  });

  it('follows the reader into night paper', () => {
    expect(draw(page([])).querySelector('.ls-layout')!.hasAttribute('data-night')).toBe(false);
    expect(draw(page([]), true).querySelector('.ls-layout')!.hasAttribute('data-night')).toBe(true);
  });

  it('sets both paper and night tokens itself, so the app theme never leaks in', () => {
    const css = readFileSync(join(process.cwd(), 'src/features/spaces/components/reader/layout/layout.css'), 'utf8');
    const scope = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)));
    for (const sel of ['.ls-layout:not([data-night])', '.ls-layout[data-night]']) {
      const body = scope(sel);
      for (const token of ['--surface-1:', '--foreground:', '--border:', '--secondary:', '--text-quiet:', '--text-faint:'])
        expect(body, `${sel} ${token}`).toContain(token);
    }
    expect(scope('.ls-layout[data-night]')).toContain('--surface-1: 0 0% 8%;');
  });

  it('sets a letter and a lone i or j as an index in maths', () => {
    const c = draw(page([{ id: 'm', kind: 'paragraph', bbox: [0.1, 0.2, 0.9, 0.3], text: '∀x i ∈ X ⇒ y j , z' }]));
    const el = blockEl(c, 'm')!;
    expect(el.dataset.kind).toBe('math');
    expect([...el.querySelectorAll('sub')].map((s) => s.textContent)).toEqual(['i', 'j']);
    expect(el.textContent).toBe('∀xi ∈ X ⇒ yj, z');
  });

  it('renders text as React nodes, never as HTML', () => {
    const src = readFileSync(join(process.cwd(), 'src/features/spaces/components/reader/layout/LayoutLayer.tsx'), 'utf8');
    expect(src).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    const c = draw(page([{ id: 'x', kind: 'paragraph', bbox: [0.1, 0.2, 0.9, 0.6], text: '<b>bold</b>' }]));
    expect(blockEl(c, 'x')!.querySelector('b')).toBeNull();
    expect(blockEl(c, 'x')!.textContent).toBe('<b>bold</b>');
  });
});

describe('LayoutLayer: a selection holds only words the learner sees', () => {
  /* The layer drawn inside a page slot, as PdfPager's overlay is. */
  const inSlot = (props: { shown?: boolean } = {}) => {
    const slot = document.createElement('div');
    document.body.appendChild(slot);
    const r = render(<LayoutLayer page={page([])} {...props} />, { container: slot });
    return { slot, ...r };
  };

  it('marks the page under it while it is shown, so the hidden text there cannot be selected', () => {
    const { slot, rerender, unmount } = inSlot();
    expect(slot.hasAttribute('data-layout-over')).toBe(true);
    /* Veiled (the browser checks failed): the original is what is seen and selected. */
    rerender(<LayoutLayer page={page([])} shown={false} />);
    expect(slot.hasAttribute('data-layout-over')).toBe(false);
    rerender(<LayoutLayer page={page([])} />);
    expect(slot.hasAttribute('data-layout-over')).toBe(true);
    /* Switched off: the page is the page again. */
    unmount();
    expect(slot.hasAttribute('data-layout-over')).toBe(false);
    slot.remove();
  });

  it('never marks the page when it mounts veiled', () => {
    const { slot } = inSlot({ shown: false });
    expect(slot.hasAttribute('data-layout-over')).toBe(false);
    slot.remove();
  });

  it('makes the pdf.js text under a shown layer unselectable, and lets its ground take a drag', () => {
    const css = readFileSync(join(process.cwd(), 'src/features/spaces/components/reader/layout/layout.css'), 'utf8');
    const rule = (sel: string) => {
      const at = css.indexOf(sel);
      expect(at, sel).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf('}', at));
    };
    const text = rule('[data-layout-over] > .react-pdf__Page .textLayer');
    expect(text).toContain('user-select: none');
    expect(text).toContain('-webkit-user-select: none');
    /* The ground's paint takes the pointer; its even-odd holes still pass it to the page. */
    expect(rule('.ls-layout .ls-ground path {')).toContain('pointer-events: visiblePainted');
  });
});
