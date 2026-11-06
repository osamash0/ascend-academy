import type { LayoutBlock } from './types';

/**
 * How the Layout face sets a block: ported from the demo's rules branch
 * (`layout-demo/template.html`, `classify`), without the vision fields,
 * boxed notes and coverage it also knew about.
 *
 * `window` and `fig` are holes in the layer's ground: the pdf.js page shows
 * through them as it is. `deco` is furniture the layer leaves out.
 */
export type LayoutClass = 'h' | 'p' | 'l' | 'row' | 'math' | 'label' | 'table' | 'fig' | 'window' | 'deco';

/** The fitter's groups (`data-group`): one type size per group per page. */
export type LayoutGroup = 'h' | 'body' | 'small' | 'row' | 'fig';

const PUA = /[\uE000-\uF8FF]/;
const PAGE_NUMBER = /^(slide|folie|seite|page|s\.)\s*\d+(\s*(\/|of|von)\s*\d+)?$/i;

/**
 * The block's text as the layer sets it. A symbol-font bullet at the start of
 * a line arrives as a private-use character: it goes (the layer draws its own
 * bullets). Arrows get a space on each side. The parser already does both, so
 * this is a guard, not a step anyone relies on.
 */
export function cleanText(text: string): string {
  return text
    .split('\n')
    .map((l) =>
      l
        .replace(/^[\uE000-\uF8FF]\s*/, '')
        .replace(/\s*([→⇒←⇐↔⇔])\s*/g, ' $1 ')
        .trim(),
    )
    .join('\n');
}

function rule(b: LayoutBlock, t: string): LayoutClass {
  if (b.kind === 'table') return b.rows?.length ? 'table' : 'window';
  if (PAGE_NUMBER.test(t)) return 'deco';
  if (b.kind === 'figure') return 'fig';
  if (b.kind === 'heading') return 'h';
  const [, y0, , y1] = b.bbox;
  if (t.split('\n').length >= 4 && y1 - y0 < 0.075) return 'row';
  if (/[∀∃⇒]/.test(t) && !/^•/.test(t) && t.length < 90) return 'math';
  if (/^[^•\s][^•]{0,24}:$/.test(t)) return 'label';
  return b.kind === 'list' ? 'l' : 'p';
}

export function classify(b: LayoutBlock): LayoutClass {
  const t = cleanText(b.text || '').trim();
  const k = rule(b, t);
  /* Any private-use character left means the PDF's text is not the real text: the page shows as it is. */
  if (k !== 'fig' && k !== 'deco' && PUA.test(t)) return 'window';
  return k;
}

export function groupOf(k: LayoutClass): LayoutGroup {
  switch (k) {
    case 'h':
      return 'h';
    case 'label':
      return 'small';
    case 'row':
    case 'table':
      return 'row';
    case 'fig':
    case 'window':
      return 'fig';
    default:
      return 'body';
  }
}
