import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, CornerDownLeft, Orbit, Search, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { hitCount, search, type Hit } from '../mocks/search';

/**
 * ⌘K — one global search.
 *
 * Doc 2 fixes four rules and each one shows up here:
 *   1. Results **group by object type** — Spaces, Lessons, ideas, contributions.
 *   2. Every result **names the Space it lives in**.
 *   3. It **never renders content inline**. A hit is a title and a
 *      destination; opening one leaves the palette. Search is a jump tool, not
 *      a browse surface, and a preview pane would quietly make it the latter.
 *   4. It searches **only what you can already see** — enforced in
 *      `mocks/search.ts` rather than by hiding rows here, so a draft cannot
 *      leak through the search box.
 */

const GROUPS = [
  { key: 'spaces' as const, label: 'Spaces', icon: Orbit },
  { key: 'lessons' as const, label: 'Lessons', icon: BookOpen },
  { key: 'concepts' as const, label: 'Ideas', icon: Sparkles },
  { key: 'contributions' as const, label: 'From the community', icon: Sparkles },
];

export function SearchPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const results = useMemo(() => search(q), [q]);
  const total = hitCount(results);

  // Flat list so ↑/↓ can walk across the group boundaries.
  const flat = useMemo(
    () => GROUPS.flatMap((g) => results[g.key].map((hit) => ({ ...hit, group: g.key }))),
    [results],
  );
  const [cursor, setCursor] = useState(0);
  useEffect(() => setCursor(0), [q]);

  const go = (hit: Hit) => {
    onOpenChange(false);
    setQ('');
    navigate(hit.href);
  };

  // Closing any way — Escape, the backdrop, the X — clears the query. Only
  // `go` used to, so dismissing and reopening showed a stale search with the
  // cursor reset to the top of it.
  const setOpen = (v: boolean) => {
    if (!v) setQ('');
    onOpenChange(v);
  };

  /*
   * Keys are handled on the input, not on `window`.
   *
   * The window listener had three problems and each was invisible in a
   * screenshot. It had **no dependency array at all**, so it tore down and
   * re-registered on every keystroke — and `react-hooks/exhaustive-deps` only
   * fires when an array is present, so lint approved it; writing the
   * plausible-looking `[open]` would have approved a stale closure over
   * `cursor` instead. It called `preventDefault()` on Enter globally, which
   * cancelled the dialog's own Close button: tabbing to Close and pressing
   * Enter navigated to a search result instead of closing. And real DOM focus
   * and the visual highlight were two independent cursors that disagreed the
   * moment anyone pressed Tab.
   *
   * Scoping to the input means arrow keys only steer while you are typing,
   * which is where they belong, and Tab hands over to ordinary focus.
   */
  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flat[cursor]) {
      e.preventDefault();
      go(flat[cursor]);
    }
  };

  // Keep the highlight on screen. The list scrolls at about eight rows and a
  // one-character query fills it, so arrowing down moved an invisible cursor
  // and Enter jumped to something the user could not see.
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  let running = -1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        {/* Radix requires a title, and without one the dialog is announced as
            an unnamed "dialog". Visually hidden: the placeholder is the on-screen
            label, and a placeholder is not an accessible name. */}
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-3 border-b border-white/[0.08] px-4">
          <Search aria-hidden className="h-4 w-4 shrink-0 text-quiet" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search Spaces, Lessons and ideas…"
            aria-label="Search Spaces, Lessons and ideas"
            // Combobox semantics, so ↑/↓ and the highlight mean something to a
            // screen reader. Without these the arrow keys moved a cursor that
            // was announced to nobody and Enter acted on it.
            role="combobox"
            aria-expanded={total > 0}
            aria-controls="v4-search-results"
            aria-activedescendant={flat[cursor] ? `v4-hit-${flat[cursor].id}` : undefined}
            autoComplete="off"
            autoFocus
            className="h-14 w-full bg-transparent text-[16px] outline-none placeholder:text-faint"
          />
        </div>

        {/*
          The count, announced. `results` is recomputed on every keystroke and
          the list was replaced silently — a screen-reader user typed and heard
          nothing at all.
        */}
        <p aria-live="polite" className="sr-only">
          {q.trim() === ''
            ? ''
            : total === 0
              ? 'No results'
              : `${total} ${total === 1 ? 'result' : 'results'}`}
        </p>

        <div
          id="v4-search-results"
          role="listbox"
          aria-label="Search results"
          className="max-h-[24rem] overflow-y-auto p-2"
        >
          {!q.trim() ? (
            <p className="px-3 py-8 text-center text-[13.5px] text-quiet">
              Type to search what you can already see — your Spaces, and public ones.
            </p>
          ) : total === 0 ? (
            <p className="px-3 py-8 text-center text-[13.5px] text-quiet">
              Nothing matches “{q.trim()}”.
            </p>
          ) : (
            GROUPS.map((g) => {
              const hits = results[g.key];
              if (!hits.length) return null;
              return (
                <div key={g.key} className="mb-1">
                  <p className="px-3 pb-1 pt-2 text-[12px] text-faint">{g.label}</p>
                  {hits.map((hit) => {
                    running += 1;
                    const active = running === cursor;
                    return (
                      <button
                        key={`${g.key}-${hit.id}`}
                        id={`v4-hit-${hit.id}`}
                        ref={active ? activeRef : undefined}
                        role="option"
                        aria-selected={active}
                        type="button"
                        onMouseEnter={() => setCursor(flat.findIndex((f) => f.id === hit.id))}
                        onClick={() => go(hit)}
                        className={cn(
                          'console-focusable flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                          active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]',
                        )}
                      >
                        <g.icon aria-hidden className="h-4 w-4 shrink-0 text-quiet" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14.5px] font-medium text-foreground">
                            {hit.title}
                          </span>
                          {/* Rule 2: every result names its Space — except a
                              Space, which is its own context. */}
                          {hit.spaceName && (
                            <span className="block truncate text-[12.5px] text-quiet">
                              {hit.spaceName}
                            </span>
                          )}
                        </span>
                        {active && (
                          <CornerDownLeft aria-hidden className="h-3.5 w-3.5 shrink-0 text-faint" />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Opens the palette on ⌘K / Ctrl-K from anywhere. */
export function useSearchPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen };
}
