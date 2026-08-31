import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, CornerDownLeft, Orbit, Search, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  let running = -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b border-white/[0.08] px-4">
          <Search aria-hidden className="h-4 w-4 shrink-0 text-quiet" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Spaces, Lessons and ideas…"
            aria-label="Search"
            autoFocus
            className="h-14 w-full bg-transparent text-[16px] outline-none placeholder:text-faint"
          />
        </div>

        <div className="max-h-[24rem] overflow-y-auto p-2">
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
                          {/* Rule 2: every result names its Space. */}
                          <span className="block truncate text-[12.5px] text-quiet">
                            {hit.spaceName}
                          </span>
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
