import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { classify, cleanText, groupOf, type LayoutClass } from './classify';
import { fitLayer } from './fit';
import { checkLayer } from './layoutGate';
import { morphIn, settle } from './morph';
import type { Box, LayoutBlock, LayoutPage, LayoutReady } from './types';
import './layout.css';

/**
 * The Layout face: one slide re-set block by block in the reader's type,
 * drawn over the pdf.js page in the page's own coordinates.
 *
 * The layer has its own ground. Pictures (and any block whose text cannot be
 * trusted) are holes cut into it, so the pdf.js page shows through them,
 * exact and sharp. Every block sits at its original box; the type sizes are
 * the fitter's (the group defaults in `layout.css` only keep it legible
 * until then). Text is rendered as React nodes, never as markup.
 *
 * `night` follows the reader's night paper, so the layer's ground matches the
 * page it covers.
 *
 * Once the layer has a real width it fits its type (`fit.ts`). A block that
 * fits no size becomes a window, a hole like a figure, and the layer is then
 * checked in the browser (`layoutGate.ts`); `onChecked` hears the verdict once
 * per fit. A page the browser checks fail is for the caller to show as the
 * original: it can keep the layer mounted with `shown={false}` (laid out,
 * measured, never seen), so a later check can still pass it.
 *
 * It enters with the morph (`morph.ts`) once a page first passes its checks;
 * under reduced motion it is simply there.
 *
 * Screen readers keep the pdf.js text layer underneath (the same words), so
 * the layer is hidden from them and the page is never read twice.
 */
export function LayoutLayer({
  page,
  night = false,
  shown = true,
  onChecked,
}: {
  page: LayoutPage;
  night?: boolean;
  shown?: boolean;
  onChecked?: (pass: boolean) => void;
}) {
  if (page.verdict !== 'layout') return null;
  return <ReadyLayer page={page} night={night} shown={shown} onChecked={onChecked} />;
}

/** A layer narrower than this has no real width: a hidden pane. Fitting there would pass every check by accident. */
const MIN_WIDTH = 50;
const NONE: ReadonlySet<string> = new Set();

/** The blocks that did not fit, for one page at one width and one state of the fonts. They are windows until any of them changes. */
interface Over {
  page: LayoutReady | null;
  width: number;
  fonts: number;
  ids: ReadonlySet<string>;
}

function ReadyLayer({
  page,
  night,
  shown,
  onChecked,
}: {
  page: LayoutReady;
  night: boolean;
  shown: boolean;
  onChecked?: (pass: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [fonts, setFonts] = useState(0);
  const [over, setOver] = useState<Over>({ page: null, width: 0, fonts: 0, ids: NONE });
  const heard = useRef(onChecked);
  const still = useRef(false);
  still.current = useReducedMotion() === true;
  /* The page the morph last ran for: it plays once per page, on its first passing check. */
  const morphed = useRef<LayoutReady | null>(null);
  useLayoutEffect(() => {
    heard.current = onChecked;
  });

  /* The layer's width, and again when it changes by more than a pixel. A hidden pane (0) never counts. */
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    let last = 0;
    const measure = (w: number) => {
      if (w > MIN_WIDTH && Math.abs(w - last) > 1) {
        last = w;
        setWidth(w);
      }
    };
    measure(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => e && measure(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /*
   * The type is measured in the fonts the browser has at that moment, and a swapped-in font (Inter is
   * font-display: swap, its latin-ext subset loads on demand) has other metrics. So fit and check run
   * again when the fonts are ready and whenever more of them finish loading. That means onChecked can
   * be called again for the same page: the latest call is the verdict.
   */
  useLayoutEffect(() => {
    const set = typeof document === 'undefined' ? undefined : (document.fonts as FontFaceSet | undefined);
    if (!set) return;
    let live = true;
    const bump = () => live && setFonts((n) => n + 1);
    if (set.status !== 'loaded') void set.ready.then(bump);
    set.addEventListener('loadingdone', bump);
    return () => {
      live = false;
      set.removeEventListener('loadingdone', bump);
    };
  }, []);

  const windows = over.page === page && over.width === width && over.fonts === fonts ? over.ids : NONE;

  /*
   * Fit, and give the blocks that fit no size to the windows (which runs this again, once). Then check.
   * Callers must pass a stable `page` object: a new identity for the same page refits and re-checks.
   */
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || width <= MIN_WIDTH) return;
    /* A block mid-rise is not where it rests: measure the layer at rest. */
    settle(el);
    fitLayer(el);
    const found = [...el.querySelectorAll<HTMLElement>('.blk[data-over]')].map((e) => e.dataset.id ?? '');
    if (found.some((id) => !windows.has(id))) {
      setOver({ page, width, fonts, ids: new Set([...windows, ...found]) });
      return;
    }
    const pass = checkLayer(el).pass;
    heard.current?.(pass);
    if (pass && morphed.current !== page) {
      morphed.current = page;
      if (!still.current) morphIn(el);
    }
  }, [page, width, fonts, windows]);

  const set = layoutBlocks(page, windows);
  const holes = set.filter(({ k }) => k === 'fig' || k === 'window').map(({ b }) => b.bbox);
  return (
    <div
      ref={root}
      className="ls-layout"
      aria-hidden="true"
      data-layout-page={page.page}
      data-night={night ? '' : undefined}
      data-veiled={shown ? undefined : ''}
    >
      <svg data-ground className="ls-ground" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden>
        <path fillRule="evenodd" d={groundPath(holes)} />
      </svg>
      {page.paths.length > 0 && (
        <svg className="reink" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden>
          {page.paths.map((x, i) => (
            <path
              key={i}
              d={x.d}
              data-b={x.bbox.join(',')}
              className={x.fill ? 'f' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}
      {set.map(({ b, k }) => (
        <Block key={b.id} b={b} k={k} />
      ))}
    </div>
  );
}

/** The blocks the layer sets, in reading order, with furniture left out. A block that did not fit is a window. */
function layoutBlocks(page: LayoutReady, windows: ReadonlySet<string>): Array<{ b: LayoutBlock; k: LayoutClass }> {
  return page.blocks
    .map((b) => ({ b, k: windows.has(b.id) ? ('window' as const) : classify(b) }))
    .filter(({ k }) => k !== 'deco');
}

function Block({ b, k }: { b: LayoutBlock; k: LayoutClass }) {
  const t = cleanText(b.text || '').trim();
  const cells = k === 'row' ? t.split('\n') : [];
  return (
    <div
      className={cn('blk', k, b.linked && 'linked', k === 'row' && /^[A-Za-z]/.test(cells[0]) && 'head')}
      data-id={b.id}
      data-kind={k}
      data-group={groupOf(k)}
      style={place(b.bbox)}
    >
      {content(b, k, t, cells)}
    </div>
  );
}

function content(b: LayoutBlock, k: LayoutClass, t: string, cells: string[]): ReactNode {
  switch (k) {
    case 'fig':
    case 'window':
    case 'deco':
      return null;
    case 'h': {
      const [first, ...rest] = t.split('\n');
      return (
        <>
          {first}
          {rest.length > 0 && <span className="sub">{rest.join(' ')}</span>}
        </>
      );
    }
    case 'row':
      return cells.map((c, i) => <span key={i}>{c}</span>);
    case 'table':
      return <Table rows={b.rows ?? []} colW={b.colW} />;
    case 'math':
      return mathNodes(oneLine(t).replace(/ ,/g, ','));
    case 'label':
      return oneLine(t).replace(/^•\s*/, '');
    default:
      return body(t);
  }
}

function Table({ rows, colW }: { rows: string[][]; colW?: number[] }) {
  const n = Math.max(0, ...rows.map((r) => r.length));
  /* Column widths from the original grid when known; otherwise from how much each column holds. */
  const w =
    colW && colW.length === n
      ? colW
      : Array.from({ length: n }, (_, i) => Math.max(3, ...rows.map((r) => (r[i] ?? '').length)));
  /* As shares of the table's width: the grid reads an fr sum below 1 as a part of the free space. */
  const sum = w.reduce((a, x) => a + Math.max(0, x), 0);
  const cols = w.map((x) => `minmax(0, ${sum > 0 ? +(Math.max(0, x) / sum).toFixed(4) : 1}fr)`).join(' ');
  return (
    <>
      {rows.map((r, ri) => (
        <div key={ri} className="tr" style={{ gridTemplateColumns: cols }}>
          {Array.from({ length: n }, (_, i) => (
            <span key={i}>{r[i] ?? ''}</span>
          ))}
        </div>
      ))}
    </>
  );
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ');

/** Paragraphs, or list items when the block is bulleted. */
function body(t: string): ReactNode {
  const bulleted = /^\s*•/.test(t) || t.includes('\n•');
  return t
    .split(/\n?•\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s, i) => (
      <div key={i} className={bulleted ? 'li' : undefined}>
        {oneLine(s)}
      </div>
    ));
}

/** A letter followed by a lone i or j is an index: `x i` sets as x with a subscript i. */
function mathNodes(s: string): ReactNode {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of s.matchAll(/\b([a-zA-Z]) ([ij])\b/g)) {
    const i = m.index ?? 0;
    out.push(s.slice(at, i), m[1], <sub key={i}>{m[2]}</sub>);
    at = i + m[0].length;
  }
  out.push(s.slice(at));
  return out;
}

const pct = (v: number) => `${+(v * 100).toFixed(3)}%`;

function place([x0, y0, x1, y1]: Box): CSSProperties {
  return { left: pct(x0), top: pct(y0), width: pct(x1 - x0), height: pct(y1 - y0) };
}

/** A page fraction in the ground's 0..1000 box, to a tenth. */
const unit = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10;

/**
 * The ground: the whole page, with a rectangle cut out for every hole. The
 * holes are first cut into disjoint rectangles (band by band), because under
 * the even-odd rule two overlapping holes would fill their overlap again.
 */
function groundPath(holes: Box[]): string {
  const rects = holes
    .map(([x0, y0, x1, y1]) => [unit(x0), unit(y0), unit(x1), unit(y1)])
    .filter(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0);
  const ys = [...new Set(rects.flatMap((r) => [r[1], r[3]]))].sort((a, b) => a - b);
  const out = ['M0 0H1000V1000H0Z'];
  for (let i = 0; i < ys.length - 1; i++) {
    const top = ys[i];
    const bottom = ys[i + 1];
    const spans = rects
      .filter((r) => r[1] <= top && r[3] >= bottom)
      .map((r) => [r[0], r[2]])
      .sort((a, b) => a[0] - b[0]);
    const merged: number[][] = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
      else merged.push([...s]);
    }
    for (const [x0, x1] of merged) out.push(`M${x0} ${top}H${x1}V${bottom}H${x0}Z`);
  }
  return out.join(' ');
}
