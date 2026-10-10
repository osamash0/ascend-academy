import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { LayoutGroup } from 'motion/react';
import { ChevronLeft, Moon, Sun } from 'lucide-react';
import { ListSkeleton, NotFound, SpacesError } from '../components/states';
import { useCanvas } from '../data/useSpaces';
import { CanvasPage } from '../studio/components/CanvasPage';
import { FullPageDialog } from '../studio/components/FullPageDialog';
import { MorphSwitch } from '../studio/components/MorphSwitch';
import { PeekSlot } from '../studio/components/Peek';
import { includeSourceBlock } from '../studio/edit';
import { groupByPage, pickAnchorPage, regionForBlock } from '../studio/geometry';
import { FLIGHT_S } from '../studio/motion';
import { useMorph } from '../studio/useMorph';
import { usePeek } from '../studio/usePeek';
import { useReadingLine } from '../studio/useReadingLine';
import { useStudioTheme } from '../studio/useStudioTheme';
import { useWide } from '../studio/useWide';
import type { Region } from '../studio/geometry';
import type { CanvasDoc, SourcePage } from '../studio/types';
import '../studio/studio-surface.css';

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
    const page = pickAnchorPage(rects, window.innerHeight) ?? (noLayout ? rects[0].page : null);
    anchor.current = page === null ? null : { page, top: rects.find((r) => r.page === page)!.top };
    flushSync(() => setMorphPage(page));
    setFlying(true);
    closePeek();
  }, [closePeek]);
  const morph = useMorph({ onBeforeChange: beforeSwitch });
  shownRef.current = morph.shown;

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
    // During a quick look the committed view is already clean: end the look.
    if (morph.quickLook) morph.pressCancel();
    else morph.setView('clean');
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
      onFullPage={() => setFullRegion(region)}
      onPointerEnter={peek.enterPeek}
      onPointerLeave={peek.leavePeek}
    />
  );

  return (
    <div className="studio-surface min-h-screen" data-theme={theme}>
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-[90rem] items-center gap-3 px-4 py-3 md:px-6">
          <Link
            to="/v4/library/studio"
            aria-label="Back to Studio"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft aria-hidden className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{material.filename}</h1>
            <p className="truncate text-xs text-muted-foreground">{spaceName}</p>
          </div>
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
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {theme === 'dark' ? <Sun aria-hidden className="h-4 w-4" /> : <Moon aria-hidden className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-[90rem] gap-6 px-4 md:px-6 min-[1200px]:grid-cols-[minmax(0,0.6fr)_minmax(0,44rem)_minmax(24rem,1.4fr)]">
        <div className="hidden min-[1200px]:block" />
        <main ref={column} className="min-w-0 py-10 pl-14 md:pl-16">
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
        <div className="hidden min-[1200px]:block">
          <div className="sticky top-24 py-10">{wide && peekPanel}</div>
        </div>
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
