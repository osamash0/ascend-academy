import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { Layers, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useShelf, shelfSpaceName } from '../data/useShelf';
import { useLibrary } from '../data/useSpaces';
import {
  filterItems,
  groupBySpace,
  sortItems,
  type ShelfFilter,
  type ShelfItem,
  type ShelfSort,
} from '../studio/shelf';
import { inDialog, isTyping } from '../studio/keys';
import { FLIGHT_EASE } from '../studio/motion';
import { viewer } from '../mocks/people';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { Masthead, Skylight, ghostPillSm } from '../components/stage';
import { Scene, SURFACES } from '../components/Scene';
import { EnterList, EnterListItem } from '../components/Enter';
import { SpacesError, SpacesSkeleton } from '../components/states';
import { Cover } from '../library/Cover';
import { BringInTile, DropVeil, useBringIn } from '../library/BringIn';
import { ContinueCard } from '../library/ContinueCard';
import { YourWords } from '../library/YourWords';
import { ZoomThrough } from '../library/ZoomThrough';

/**
 * Library — the shelf (One Library spec §5.1).
 *
 * Everything you brought in, as living covers; what you wrote, as "Your
 * words". One index: the Studio home, uploads, drafts and impact screens are
 * gone, and their questions are filters here (`?f=reading|shared|words`).
 *
 * Learn mode: calm and browsable. Search, sort and grouping only appear once
 * the shelf is big enough to need them (9 items), so a new shelf stays quiet.
 */

const FILTERS: { key: ShelfFilter; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'reading', label: 'Reading' },
  { key: 'shared', label: 'Shared' },
  { key: 'words', label: 'Your words' },
];

const SORTS: { key: ShelfSort; label: string }[] = [
  { key: 'recent', label: 'Recently opened' },
  { key: 'added', label: 'Added' },
  { key: 'az', label: 'A–Z' },
];

/** From this many items up, the shelf offers search, sort and grouping. */
const BIG_SHELF = 9;

const asFilter = (v: string | null): ShelfFilter =>
  FILTERS.some((f) => f.key === v) ? (v as ShelfFilter) : 'all';

const LIBRARY_ACCENT = null;

export default function LibraryScreen() {
  const { state, items, continueItem, words } = useShelf();
  /* Read beside the shelf, so both settle together rather than one after the other. */
  const { items: contributions } = useLibrary('contribution');
  /*
   * A re-anchor mutates a store outside React, and `useLibrary` recomputes on
   * render — so the orphans need a nudge to be re-read.
   */
  const [, reread] = useReducer((n: number) => n + 1, 0);
  const [params, setParams] = useSearchParams();
  const reduce = useReducedMotion();
  const filter = asFilter(params.get('f'));
  const big = items.length >= BIG_SHELF;
  const q = big ? (params.get('q') ?? '') : '';
  const [sort, setSort] = useState<ShelfSort>('recent');
  const [grouped, setGrouped] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const bring = useBringIn(state === 'ready');
  const tile = (variant: 'cell' | 'empty') => (
    <BringInTile inputRef={bring.inputRef} onFiles={bring.bringFiles} variant={variant} />
  );

  /* "{file} is ready", said politely, when a cover finishes developing. */
  const stages = useRef(new Map<string, ShelfItem['stage']>());
  const [said, setSaid] = useState('');
  useEffect(() => {
    const ready: string[] = [];
    for (const i of items) {
      if (stages.current.get(i.id) === 'developing' && i.stage === 'ready') ready.push(i.filename);
      stages.current.set(i.id, i.stage);
    }
    if (ready.length)
      setSaid(ready.map((f) => `${f} is ready`).join('. '));
  }, [items]);

  /** One URL param, set or cleared, leaving the others (mock, select) alone. */
  const setParam = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  /* `/` finds, on the shelf only, and never while you are typing or in a dialog. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || inDialog(e.target)) return;
      const box = searchRef.current;
      if (!box) return;
      e.preventDefault();
      box.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const counts = useMemo(
    () => ({
      all: items.length,
      reading: filterItems(items, 'reading', '').length,
      shared: filterItems(items, 'shared', '').length,
      words: words.length,
    }),
    [items, words],
  );
  const shown = useMemo(() => sortItems(filterItems(items, filter, q), sort), [items, filter, q, sort]);

  // Library stands on the stage. It has no subject of its own, so its light
  // is the brand's — neutral white — never a colour (monochrome brand).
  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.library} status="progress" motionKey="library" accent={LIBRARY_ACCENT}>
      <SpacesTopBar active="library" viewer={viewer} />
      <div className="relative">
        <Skylight accent={LIBRARY_ACCENT} />
        {body}
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {said}
      </div>
      <DropVeil show={bring.veil} />
    </Scene>
  );

  if (state === 'loading') return chrome(<SpacesSkeleton />);
  if (state === 'error') return chrome(<SpacesError what="your Library" />);

  const fade = { duration: reduce ? 0.15 : 0.24, ease: FLIGHT_EASE };
  const showContinue = !!continueItem && (filter === 'all' || filter === 'reading') && !q;

  return chrome(
    <ZoomThrough>
      <div className="relative mx-auto max-w-[1120px] px-4 pb-24 pt-10 sm:px-6 lg:px-8">
        <header>
          <Masthead title="Library" lede="What you brought in, what you made of it, and what you shared." />
        </header>

        {items.length === 0 ? (
          tile('empty')
        ) : (
          <>
            <div className="mt-8 flex flex-col items-center gap-4">
              <div
                role="tablist"
                aria-label="Filter"
                className="flex flex-wrap items-center justify-center gap-1.5"
              >
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.key}
                    onClick={() => setParam('f', f.key === 'all' ? null : f.key)}
                    className={cn(
                      'console-focusable h-9 rounded-full px-4 text-[13.5px] font-medium transition-colors',
                      filter === f.key
                        ? 'bg-white/[0.10] text-foreground'
                        : 'text-quiet hover:bg-white/[0.05] hover:text-foreground',
                    )}
                  >
                    {f.label}
                    <span className="ml-1.5 tabular-nums text-faint">{counts[f.key]}</span>
                  </button>
                ))}
              </div>

              {big && filter !== 'words' && (
                <div className="flex w-full flex-wrap items-center justify-center gap-2">
                  <label className="relative block w-full sm:w-72">
                    <Search
                      aria-hidden
                      className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint"
                    />
                    <input
                      ref={searchRef}
                      type="search"
                      aria-label="Search your Library"
                      placeholder="Search your Library   /"
                      value={q}
                      onChange={(e) => setParam('q', e.target.value || null)}
                      className="console-focusable h-9 w-full rounded-full border border-white/12 bg-white/[0.05] pl-9 pr-4 text-[13.5px] text-foreground placeholder:text-faint"
                    />
                  </label>
                  <select
                    aria-label="Sort"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as ShelfSort)}
                    className="console-focusable h-9 rounded-full border border-white/12 bg-white/[0.05] px-3.5 text-[13px] text-quiet"
                  >
                    {SORTS.map((s) => (
                      <option key={s.key} value={s.key} className="bg-black text-foreground">
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-pressed={grouped}
                    onClick={() => setGrouped((g) => !g)}
                    className={cn(ghostPillSm, grouped && 'bg-white/[0.12] text-foreground')}
                  >
                    <Layers aria-hidden className="h-3.5 w-3.5" />
                    Group by Space
                  </button>
                </div>
              )}
            </div>

            {/* A new view arrives with a fade; the old one simply gives way, so the two never stack. */}
            <motion.div
              key={filter}
              className="mt-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={fade}
            >
              {filter === 'words' ? (
                <YourWords
                  words={words}
                  items={items}
                  orphans={contributions.filter((c) => c.orphaned)}
                  onMoved={reread}
                />
              ) : (
                <>
                  {showContinue && (
                    <div className="mb-12">
                      <ContinueCard item={continueItem} />
                    </div>
                  )}
                  <Shelf items={shown} grouped={big && grouped} cell={tile('cell')} />
                  {shown.length === 0 && <NothingHere filter={filter} q={q} />}
                </>
              )}
            </motion.div>
          </>
        )}
      </div>
    </ZoomThrough>,
  );
}

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-[18px]';

function Shelf({ items, grouped, cell }: { items: ShelfItem[]; grouped: boolean; cell: React.ReactNode }) {
  if (!grouped) {
    return (
      <section aria-labelledby="your-shelf">
        <h2 id="your-shelf" className="mb-4 text-[20px] font-medium tracking-[-0.02em]">
          Your shelf
        </h2>
        <EnterList aria-labelledby="your-shelf" className={GRID}>
          <EnterListItem>
            {cell}
          </EnterListItem>
          {items.map((item) => (
            <EnterListItem key={item.id}>
              <Cover item={item} />
            </EnterListItem>
          ))}
        </EnterList>
      </section>
    );
  }
  const groups = groupBySpace(items, shelfSpaceName);
  return (
    <div className="space-y-12">
      {groups.map((g, gi) => (
        <section key={g.title} aria-label={g.title}>
          <h2 className="mb-4 text-[20px] font-medium tracking-[-0.02em]">{g.title}</h2>
          <EnterList aria-label={gi === 0 ? 'Your shelf' : g.title} className={GRID}>
            {gi === 0 && (
              <EnterListItem>
                {cell}
              </EnterListItem>
            )}
            {g.items.map((item) => (
              <EnterListItem key={item.id}>
                <Cover item={item} />
              </EnterListItem>
            ))}
          </EnterList>
        </section>
      ))}
    </div>
  );
}

function NothingHere({ filter, q }: { filter: ShelfFilter; q: string }) {
  const line = q
    ? `Nothing on your shelf is called “${q}”.`
    : filter === 'shared'
      ? 'Nothing shared yet. When a page is ready for others, share it from the page itself.'
      : 'Nothing left to read. Everything here is read through.';
  return <p className="mt-8 text-center text-[14px] text-quiet">{line}</p>;
}
