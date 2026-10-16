import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { levelFor, optionsFor, type Depth } from './depth';
import type { PageGroup } from './geometry';
import { inDialog, isTyping, menuOpen } from './keys';
import { sectionFor } from './usePageNav';
import type { SourcePage } from './types';

const NO_DEPTH: Record<number, Depth> = {};

interface Options {
  materialId: string | undefined;
  groups: PageGroup[];
  pages: SourcePage[];
  sourceRemoved: boolean;
  /** Source is shown: the dial and its keys rest, and each page keeps its depth for the way back. */
  original: boolean;
  /** The pager's page: where `[` and `]` act when focus is on no page. */
  current: number | null;
  /** Runs in the same commit as a depth change (the screen drops the last flight's layoutIds). */
  onChange(): void;
}

/**
 * How deep each page reads in Learn (Learn deeper §3). Per Material, this
 * visit only; Source overrides it while shown, and Learn gets it back.
 *
 * `levels` is where every page stands (`levelFor`: the depth you chose if the
 * page offers it, else Summary), the one rule the screen and the canvas share.
 * A depth change keeps the top of that page's section where it is on screen,
 * and `[` / `]` go shallower and deeper on the page that holds focus, else on
 * the pager's page.
 */
export function useDepth({ materialId, groups, pages, sourceRemoved, original, current, onChange }: Options) {
  const [held, setHeld] = useState<{ id: string | undefined; map: Record<number, Depth> }>({
    id: materialId,
    map: NO_DEPTH,
  });
  const depth = held.id === materialId ? held.map : NO_DEPTH;
  const levels = useMemo(() => {
    const out: Record<number, Depth> = {};
    for (const g of groups) out[g.page] = levelFor(g, pages, depth, sourceRemoved);
    return out;
  }, [groups, pages, depth, sourceRemoved]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /** The page whose dial moved: its top stays where it is on screen (§3.4). */
  const anchor = useRef<{ page: number; top: number } | null>(null);

  const onDepth = useCallback(
    (page: number, d: Depth, all: boolean) => {
      const el = sectionFor('clean', page);
      anchor.current = el ? { page, top: el.getBoundingClientRect().top } : null;
      // Computed here, not in an updater: StrictMode runs updaters twice.
      const next = { ...depth };
      if (all) {
        for (const g of groups) if (optionsFor(g, pages, sourceRemoved).includes(d)) next[g.page] = d;
      } else next[page] = d;
      onChangeRef.current();
      setHeld({ id: materialId, map: next });
    },
    [depth, groups, pages, sourceRemoved, materialId],
  );

  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const el = sectionFor('clean', a.page);
    if (!el) return;
    const delta = el.getBoundingClientRect().top - a.top;
    // Instant: the app's root scrolls smoothly, and a glide here is the page running away.
    if (delta !== 0) window.scrollBy({ top: delta, behavior: 'instant' });
  }, [depth]);

  /* `[` shallower, `]` deeper (§3.3) — Learn only, with the page's key guards. */
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (e.key !== '[' && e.key !== ']') return;
    // German layouts type [ and ] with Option (Mac) or AltGr (Windows, seen as Ctrl+Alt): Alt is fine, Cmd and Ctrl alone are not.
    if (e.repeat || e.metaKey || (e.ctrlKey && !e.altKey)) return;
    if (isTyping(e.target) || inDialog(e.target) || menuOpen(e.target)) return;
    if (original) return;
    const focused =
      e.target instanceof Element ? e.target.closest<HTMLElement>('[data-view="clean"][data-page-anchor]') : null;
    const page = focused ? Number(focused.dataset.pageAnchor) : current;
    const g = page === null ? undefined : groups.find((x) => x.page === page);
    if (!g) return;
    const options = optionsFor(g, pages, sourceRemoved);
    const next = options[options.indexOf(levels[g.page] ?? 'summary') + (e.key === ']' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    onDepth(g.page, next, false);
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  return { levels, onDepth };
}
