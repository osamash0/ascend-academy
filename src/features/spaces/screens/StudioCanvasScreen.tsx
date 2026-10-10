import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { LayoutGroup } from 'motion/react';
import { ChevronLeft, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ListSkeleton, NotFound, SpacesError } from '../components/states';
import { useCanvas } from '../data/useSpaces';
import { CanvasPage } from '../studio/components/CanvasPage';
import { FullPageDialog } from '../studio/components/FullPageDialog';
import { MorphSwitch } from '../studio/components/MorphSwitch';
import { PageRail } from '../studio/components/PageRail';
import { PagerPill } from '../studio/components/PagerPill';
import { PeekSlot } from '../studio/components/Peek';
import { hasSource, includeSourceBlock } from '../studio/edit';
import { groupByPage, pagesInView, pickAnchorPage, regionForBlock } from '../studio/geometry';
import { FLIGHT_S } from '../studio/motion';
import { useMorph } from '../studio/useMorph';
import { usePageNav } from '../studio/usePageNav';
import { usePeek } from '../studio/usePeek';
import { useReadingLine } from '../studio/useReadingLine';
import { useStudioTheme } from '../studio/useStudioTheme';
import { useWide } from '../studio/useWide';
import type { Region } from '../studio/geometry';
import type { CanvasDoc, SourcePage } from '../studio/types';
import '../studio/studio-surface.css';

const HINT = 'Use ← → to move between pages. Rest on a paragraph to see the source, or press S.';
const HINT_NO_ORIGINAL = 'Use ← → to move between pages.';

/**
 * The Studio canvas — spec §3.2, §4. The Material owns the screen; Peek lives in the gutter.
 *
 * The screen owns every piece of cross-cutting state (the view, the anchor
 * page, the open Peek, your edits) so nothing is lost when a panel unmounts.
 */
export default function StudioCanvasScreen() {
  const { canvasId } = useParams<{ canvasId: string }>();
  const { state, canvas, pages, material, spaceName } = useCanvas(canvasId);
  const [theme, toggleTheme] = useStudioTheme();
  const [edited, setEdited] = useState<CanvasDoc | null>(null);
  const doc = edited ?? canvas;
  const groups = useMemo(() => (doc ? groupByPage(doc.blocks) : []), [doc]);

  const peek = usePeek();
  const wide = useWide();
  const column = useRef<HTMLElement>(null);
  /** A snapshot, so the dialog outlives the Peek that opened it. */
  const [fullRegion, setFullRegion] = useState<Region | null>(null);
  const { close: closePeek } = peek;
  const [flashId, setFlashId] = useState<string | null>(null);
  const [morphPage, setMorphPage] = useState<number | null>(null);
  const [flying, setFlying] = useState(false);
  const anchor = useRef<{ page: number; top: number } | null>(null);
  const backTimer = useRef<ReturnType<typeof setTimeout>>();
  /** The view on screen right now, readable from inside the switch. */
  const shownRef = useRef<'clean' | 'original'>('clean');
  /** A page the next switch must fly instead of the one in view (clicking a region). */
  const pageHint = useRef<number | null>(null);

  /**
   * Runs right before the view changes: pick the page you're on, remember
   * where it sits, close Peek.
   *
   * The anchor page is committed *first* (flushSync), in the view that is
   * about to leave: its elements remount carrying layoutIds before they
   * exit, so they can pair with the incoming side — in both directions.
   * The view change that follows is flushed before paint.
   */
  const beforeSwitch = useCallback(() => {
    clearTimeout(backTimer.current);
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-view="${shownRef.current}"][data-page-anchor]`),
    );
    const rects = sections.map((el) => {
      const r = el.getBoundingClientRect();
      return { page: Number(el.dataset.pageAnchor), top: r.top, bottom: r.bottom, height: r.height };
    });
    // Only when nothing has layout at all (jsdom) fall back to the first page shown;
    // in a real browser with no visible section there is nothing to anchor to.
    const noLayout = rects.length > 0 && rects.every((r) => r.height === 0);
    const hinted = pageHint.current;
    pageHint.current = null;
    const picked =
      hinted !== null && rects.some((r) => r.page === hinted)
        ? hinted
        : (pickAnchorPage(rects, window.innerHeight) ?? (noLayout ? rects[0].page : null));
    const page = picked;
    anchor.current = page === null ? null : { page, top: rects.find((r) => r.page === page)!.top };
    flushSync(() => setMorphPage(page));
    setFlying(true);
    closePeek();
  }, [closePeek]);
  const morph = useMorph({ onBeforeChange: beforeSwitch, enabled: !material?.sourceRemoved });
  shownRef.current = morph.shown;
  const original = morph.shown === 'original';
  /* Peek gets the right-hand gutter on wide screens — in Clean, where it can open. */
  const gutter = wide && !original;

  /* Only pages with a section in the view on screen are stops for the rail, the pill and the keys. */
  const viewPages = useMemo(() => pagesInView(groups, pages, morph.shown), [groups, pages, morph.shown]);
  const railGroups = useMemo(() => groups.filter((g) => viewPages.includes(g.page)), [groups, viewPages]);
  const nav = usePageNav(viewPages, morph.shown);
  /* The hint stays until you've turned a page or switched faces once. */
  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    if (nav.index > 0 || original) setEngaged(true);
  }, [nav.index, original]);

  /* Keep your place: the anchor page's top stays where it was. */
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    const el = document.querySelector<HTMLElement>(`[data-view="${morph.shown}"][data-page-anchor="${a.page}"]`);
    if (el) window.scrollBy(0, el.getBoundingClientRect().top - a.top);
    anchor.current = null;
  }, [morph.shown]);

  useEffect(() => {
    if (!flying) return;
    const t = setTimeout(() => setFlying(false), FLIGHT_S * 1000 + 300);
    return () => clearTimeout(t);
  }, [flying, morph.shown]);
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 1200);
    return () => clearTimeout(t);
  }, [flashId]);
  useEffect(() => () => clearTimeout(backTimer.current), []);

  const peekOpen = peek.state.status === 'open';
  const pinned = peek.state.status === 'open' && peek.state.pinned;
  const region = doc && peek.state.status === 'open' ? regionForBlock(doc.blocks, pages, peek.state.blockId) : null;

  useReadingLine(pinned && morph.shown === 'clean', column, peek.follow);
  useEffect(() => {
    if (!peekOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || fullRegion) return;
      // React re-renders between Radix's capture listener and ours, so the
      // state guard alone can't stop one Esc closing both dialog and Peek.
      if ((e.target as Element | null)?.closest?.('[role="dialog"]')) return;
      closePeek();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [peekOpen, fullRegion, closePeek]);

  const backToBlock = (blockId: string) => {
    const target = doc?.blocks.find((b) => b.id === blockId);
    pageHint.current = target && hasSource(target) ? target.source.page : null;
    // During a quick look the committed view is already clean: end the look.
    if (morph.quickLook) morph.pressCancel();
    else morph.setView('clean');
    pageHint.current = null; // unused if nothing switched
    setFlashId(null); // so the same paragraph flashes again
    clearTimeout(backTimer.current);
    backTimer.current = setTimeout(() => {
      document.querySelector(`[data-block-id="${blockId}"]`)?.scrollIntoView?.({ block: 'center' });
      setFlashId(blockId);
    }, FLIGHT_S * 1000 + 50);
  };
  const include = (page: SourcePage, sourceBlockId: string) => {
    setEdited((prev) => {
      const base = prev ?? canvas;
      return base ? includeSourceBlock(base, page, sourceBlockId) : prev;
    });
  };

  const frame = (children: React.ReactNode) => (
    <div className="studio-surface min-h-screen" data-theme={theme}>
      <div className="mx-auto max-w-3xl p-8">{children}</div>
    </div>
  );
  if (state === 'loading') return frame(<ListSkeleton />);
  if (state === 'error') return frame(<SpacesError what="this Material" />);
  if (!doc || !material)
    return frame(<NotFound what="Material" backTo="/v4/library/studio" backLabel="Back to Studio" />);

  const peekPanel = (
    <PeekSlot
      region={peek.state.status === 'open' ? region : null}
      materialName={material.filename}
      pinned={peek.state.status === 'open' && peek.state.pinned}
      sourceRemoved={material.sourceRemoved}
      onTogglePin={() => {
        peek.togglePin();
        peek.enterPeek();
      }}
      onClose={closePeek}
      onFullPage={() => setFullRegion(region)}
      onPointerEnter={peek.enterPeek}
      onPointerLeave={peek.leavePeek}
    />
  );

  return (
    <div className="studio-surface min-h-screen" data-theme={theme}>
      {/* The reader's masthead: the way out, where you are, and which face you're reading. */}
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-md">
        <div className="relative flex min-h-[88px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
          <Link
            to="/v4/library/studio"
            aria-label="Back to Studio"
            className="console-focusable order-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-quiet transition-colors hover:bg-[rgb(var(--studio-chip))] hover:text-foreground"
          >
            <ChevronLeft aria-hidden className="h-5 w-5" />
          </Link>
          <div className="order-3 w-full min-w-0 text-center lg:pointer-events-none lg:absolute lg:inset-x-[18rem] lg:top-1/2 lg:order-2 lg:w-auto lg:-translate-y-1/2">
            <p className="mb-1 truncate text-[12.5px] text-quiet">
              Studio
              {spaceName && (
                <>
                  <span aria-hidden className="mx-2 text-faint">·</span>
                  {spaceName}
                </>
              )}
            </p>
            <h1 className="truncate text-[20px] font-medium leading-tight tracking-[-0.015em] text-foreground sm:text-[22px]">
              {material.filename}
            </h1>
          </div>
          <div className="order-2 ml-auto flex items-center gap-2 lg:order-3">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
              className="console-focusable flex h-9 w-9 items-center justify-center rounded-full text-faint transition-colors hover:bg-[rgb(var(--studio-chip))] hover:text-foreground"
            >
              {theme === 'dark' ? <Sun aria-hidden className="h-4 w-4" /> : <Moon aria-hidden className="h-4 w-4" />}
            </button>
            {!material.sourceRemoved && (
              <MorphSwitch
                view={morph.view}
                shown={morph.shown}
                onPressStart={morph.pressStart}
                onPressEnd={morph.pressEnd}
                onPressCancel={morph.pressCancel}
                onToggle={() => morph.setView(morph.view === 'clean' ? 'original' : 'clean')}
              />
            )}
          </div>
        </div>
      </header>

      {/* The contents, down the left edge — wide screens only. */}
      <div className="fixed bottom-24 left-0 top-[112px] z-20 hidden w-60 overflow-y-auto overflow-x-hidden pl-8 pr-4 min-[1180px]:block">
        <PageRail groups={railGroups} current={nav.current} onPage={nav.go} />
      </div>

      <div className="min-[1180px]:pl-60">
        <div className={cn('grid gap-6 px-4 md:px-6', gutter && 'grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]')}>
          <main
            ref={column}
            className={cn(
              // pb-56 clears the scrim and the pill: the last page scrolls fully into the open.
              'mx-auto w-full min-w-0 pb-56 pt-6',
              original ? 'max-w-[58rem]' : 'max-w-[44rem] pl-14 md:pl-16',
            )}
          >
            <LayoutGroup>
              <CanvasPage
                groups={groups}
                pages={pages}
                view={morph.shown}
                morphPage={morphPage}
                flying={flying}
                activeBlockId={peek.state.status === 'open' ? peek.state.blockId : null}
                flashBlockId={flashId}
                sourceRemoved={material.sourceRemoved}
                materialName={material.filename}
                onBlockPointerEnter={peek.hoverBlock}
                onBlockPointerLeave={peek.leaveBlock}
                onOpenPeek={peek.open}
                onClosePeek={peek.close}
                onRegion={backToBlock}
                onInclude={include}
              />
            </LayoutGroup>
          </main>
          {gutter && (
            <div className="pr-2">
              <div className="sticky top-[112px] pt-6">{peekPanel}</div>
            </div>
          )}
        </div>
      </div>

      {/*
        The bottom scrim: the page fades into the ground under the page line,
        so the hint and the pill never sit on top of words. Full width, and
        it never takes a click.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-36 bg-gradient-to-t from-background via-background/85 to-transparent"
      />

      {/* The page line: where you are, and the turn. */}
      <div
        className={cn(
          'pointer-events-none fixed inset-x-0 bottom-5 z-20 flex justify-center px-4 min-[1180px]:left-60',
          gutter && 'right-[29.5rem]',
        )}
      >
        <PagerPill
          current={nav.counter}
          last={nav.last}
          canBack={nav.index > 0}
          canForward={nav.index >= 0 && nav.index < viewPages.length - 1}
          hint={engaged ? null : material.sourceRemoved ? HINT_NO_ORIGINAL : HINT}
          onStep={nav.step}
        />
      </div>

      {!wide && <div className="fixed inset-x-3 bottom-3 z-30 max-h-[45vh] overflow-auto">{peekPanel}</div>}
      {fullRegion && (
        <FullPageDialog
          open
          onOpenChange={(o) => !o && setFullRegion(null)}
          region={fullRegion}
          materialName={material.filename}
          theme={theme}
        />
      )}
    </div>
  );
}
