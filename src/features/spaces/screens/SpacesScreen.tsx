import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownWideNarrow, KeyRound, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ControllerHints } from '@/components/console';
import type { Space } from '../types';
import { useSpaces } from '../data/useSpaces';
import { viewer } from '../mocks/people';
import { SpacesTopBar } from '../components/SpacesTopBar';
import { SpaceTile } from '../components/SpaceTile';
import { Scene, SURFACES } from '../components/Scene';
import { JoinSpaceDialog, NewSpaceDialog } from '../components/SpaceDialogs';
import { marburg } from '../mocks/spaces';
import {
  NoSpacesYet,
  NothingToDiscover,
  SpacesError,
  SpacesSkeleton,
} from '../components/states';

/**
 * The Spaces screen.
 *
 * Read from the PS5 home and library screens supplied as reference:
 *
 *   • **The rows are the screen.** There is no hero. A console home does not
 *     explain the focused tile below the shelf — the tile says what it is, and
 *     the detail lives on the item's own page. We now have that page (the Space
 *     screen), so a hero here repeated the tile above it and pushed the rows
 *     off the fold.
 *   • **No Lesson sub-rail either.** Space → Overview owns the Lesson list.
 *     Rendering it here as well made this screen a second index of the same
 *     Lessons — the duplicate-index shape Doc 2 rejects. Selecting a Space
 *     opens it; that is the whole interaction.
 *   • **Tabs are plain text**, not pills: active is white and heavier,
 *     inactive is grey. That is how the PS Store bar reads.
 *   • **Section headings are small and quiet.** "Explore Halloween events" in
 *     the Store is muted and secondary to the art; loud headings compete with
 *     the tiles for the same attention.
 *   • **A sort row under the title**, visible rather than hidden in a menu.
 *   • **Controller hints bottom-right**, which finally document the ←/→/Enter
 *     navigation this screen has always had and never mentioned.
 */

type Tab = 'mine' | 'discover';
type Sort = 'recent' | 'alpha' | 'progress';

const RAIL_SCROLL = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

const SORTS: { key: Sort; label: string }[] = [
  { key: 'recent', label: 'Last active' },
  { key: 'alpha', label: 'Name (A–Z)' },
  { key: 'progress', label: 'Progress' },
];

const applySort = (list: Space[], sort: Sort): Space[] =>
  [...list].sort((a, b) => {
    if (sort === 'alpha') return a.name.localeCompare(b.name);
    if (sort === 'progress') return b.viewerProgress - a.viewerProgress;
    return +new Date(b.lastActiveAt) - +new Date(a.lastActiveAt);
  });

interface Group {
  key: string;
  label: string;
  /** Right-aligned on the heading row, only where it earns its place. */
  note?: string;
  spaces: Space[];
}

export default function SpacesScreen() {
  const navigate = useNavigate();
  const { state, mine, discover } = useSpaces();
  const [tab, setTab] = useState<Tab>('mine');
  const [sort, setSort] = useState<Sort>('recent');
  const [focus, setFocus] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);

  /**
   * Mine is grouped, never one merged list: a Creator has to spot their own
   * Spaces instantly, and the two groups report different numbers.
   */
  const groups: Group[] = useMemo(() => {
    if (tab === 'discover') {
      return [{ key: 'discover', label: 'Public Spaces', spaces: applySort(discover, sort) }];
    }
    const g: Group[] = [];
    if (mine.created.length)
      g.push({
        key: 'created',
        label: 'Created by you',
        note: 'Drafts and activity, not your own progress',
        spaces: applySort(mine.created, sort),
      });
    if (mine.joined.length)
      g.push({ key: 'joined', label: 'Joined', spaces: applySort(mine.joined, sort) });
    if (showArchived && mine.archived.length)
      g.push({
        key: 'archived',
        label: 'Archived',
        note: 'Read-only. Progress kept, no XP earned',
        spaces: applySort(mine.archived, sort),
      });
    return g;
  }, [tab, mine, discover, showArchived, sort]);

  const flat = useMemo(() => groups.flatMap((g) => g.spaces), [groups]);

  useEffect(() => {
    setFocus(0);
  }, [tab, showArchived, sort]);

  const open = useCallback((id: string) => navigate(`/v4/space/${id}`), [navigate]);

  /** Controller-style navigation, matching the rest of the product. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setFocus((i) => Math.min(i + 1, flat.length - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setFocus((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && flat[focus]) {
        e.preventDefault();
        open(flat[focus].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, focus, open]);

  useEffect(() => {
    railRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [focus]);

  // Spaces is a browse surface: you are choosing, so the console texture stays.
  const chrome = (body: React.ReactNode) => (
    <Scene surface={SURFACES.spaces} status="progress" motionKey={tab}>
      <SpacesTopBar active="spaces" viewer={viewer} />
      {body}
    </Scene>
  );

  if (state === 'loading') return chrome(<SpacesSkeleton />);
  if (state === 'error') return chrome(<SpacesError />);

  const noneAtAll = !mine.created.length && !mine.joined.length && !mine.archived.length;
  if (state === 'empty' || (tab === 'mine' && noneAtAll)) {
    return chrome(
      <>
        {tab === 'discover' ? (
          <NothingToDiscover
            // The Universe's name, read from the fixture rather than typed
            // here — a hardcoded copy would survive a rename.
            scopeLabel={marburg.name}
            onWiden={() => setTab('discover')}
          />
        ) : (
          <NoSpacesYet onCreate={() => setNewOpen(true)} onJoin={() => setJoinOpen(true)} />
        )}
        {/* The dialogs mount here too: this branch returns early, so the copies
            at the bottom of the screen are unreachable from the empty state. */}
        <NewSpaceDialog open={newOpen} onOpenChange={setNewOpen} />
        <JoinSpaceDialog open={joinOpen} onOpenChange={setJoinOpen} />
      </>,
    );
  }

  return chrome(
    <section className="relative flex select-none flex-col pb-28">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 px-6 pt-8 lg:px-12">
        <h1 className="text-[30px] font-bold tracking-[-0.02em]">Spaces</h1>

        {/* Plain text tabs: weight and colour do the work, no pill needed. */}
        <div role="tablist" aria-label="Spaces" className="flex items-center gap-6">
          {(['mine', 'discover'] as Tab[]).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                'console-focusable rounded-md py-1 text-[15px] capitalize transition-colors',
                tab === t
                  ? 'font-semibold text-foreground'
                  : 'font-normal text-quiet hover:text-foreground',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setJoinOpen(true)}
            className="console-focusable flex h-9 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 text-[13px] font-medium text-quiet transition-colors hover:bg-white/[0.08] hover:text-foreground"
          >
            <KeyRound aria-hidden className="h-3.5 w-3.5" />
            Join with a code
          </button>
          {/* Create lives on the screen that owns the object. */}
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="console-focusable flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-semibold text-slate-900 transition-transform hover:scale-[1.03]"
          >
            <Plus aria-hidden className="h-4 w-4" />
            New Space
          </button>
        </div>
      </div>

      {/* ── Sort ── */}
      <div className="mt-5 flex items-center gap-3 px-6 lg:px-12">
        <ArrowDownWideNarrow aria-hidden className="h-4 w-4 shrink-0 text-faint" />
        <span className="text-[13.5px] text-faint">Sort by</span>
        <div className="flex flex-wrap items-center gap-1">
          {SORTS.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={sort === o.key}
              onClick={() => setSort(o.key)}
              className={cn(
                'console-focusable h-8 rounded-full px-3 text-[13px] transition-colors',
                sort === o.key
                  ? 'bg-white/[0.10] font-medium text-foreground'
                  : 'text-quiet hover:bg-white/[0.05] hover:text-foreground',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Rows. These are the screen. ── */}
      <div ref={railRef} className="mt-9 space-y-11">
        {(() => {
          let i = -1;
          return groups.map((g) => {
            const start = i + 1;
            i += g.spaces.length;
            return (
              <section key={g.key} aria-labelledby={`row-${g.key}`}>
                {/* Quiet headings — the art is the loud thing on this screen. */}
                <div className="mb-4 flex items-baseline gap-3 px-6 lg:px-12">
                  <h2 id={`row-${g.key}`} className="text-[14px] font-medium text-quiet">
                    {g.label}
                  </h2>
                  <span className="text-[13px] text-faint tabular-nums">{g.spaces.length}</span>
                  {g.note && (
                    <span className="ml-auto hidden text-[12.5px] text-faint sm:block">
                      {g.note}
                    </span>
                  )}
                </div>

                <div
                  className={cn(
                    'flex items-start gap-5 overflow-x-auto px-6 pb-2 lg:px-12',
                    RAIL_SCROLL,
                  )}
                >
                  {g.spaces.map((sp, n) => {
                    const idx = start + n;
                    return (
                      <SpaceTile
                        key={sp.id}
                        space={sp}
                        index={idx}
                        isActive={idx === focus}
                        onFocus={() => setFocus(idx)}
                        onOpen={() => open(sp.id)}
                      />
                    );
                  })}
                </div>
              </section>
            );
          });
        })()}

        {/* Archived is never hidden — the progress lives there. */}
        {tab === 'mine' && mine.archived.length > 0 && (
          <div className="px-6 lg:px-12">
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              aria-expanded={showArchived}
              className="console-focusable flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/12 text-[13.5px] font-medium text-quiet transition-colors hover:border-white/25 hover:text-foreground"
            >
              {showArchived
                ? 'Hide archived'
                : `Show ${mine.archived.length} archived ${
                    mine.archived.length === 1 ? 'Space' : 'Spaces'
                  }`}
            </button>
          </div>
        )}
      </div>

      {/* Navigational footnotes for those who want them, per the console. */}
      <NewSpaceDialog open={newOpen} onOpenChange={setNewOpen} />
      <JoinSpaceDialog open={joinOpen} onOpenChange={setJoinOpen} />

      <ControllerHints
        hints={[
          { key: '←→', label: 'Browse' },
          { key: '↵', label: 'Open' },
        ]}
        className="pointer-events-none fixed bottom-6 right-6 lg:right-12"
      />
    </section>,
  );
}
