import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { ChevronLeft, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ListSkeleton, NotFound, SpacesError } from '../components/states';
import { nextSuggestions, useAsk } from '../data/useAsk';
import { useCanvas } from '../data/useSpaces';
import { shelfActions, shelfSpaceName, useShelfCanvas, useShelfItem } from '../data/useShelf';
import { Journey } from '../library/Journey';
import { ShareButton } from '../library/ShareSheet';
import { rememberOpened } from '../library/returnFocus';
import { CanvasPage } from '../studio/components/CanvasPage';
import { Composer } from '../studio/components/Composer';
import type { ComposerNotice } from '../studio/components/Composer';
import { FullPageDialog } from '../studio/components/FullPageDialog';
import { MorphSwitch } from '../studio/components/MorphSwitch';
import { PageRail } from '../studio/components/PageRail';
import { PagerPill } from '../studio/components/PagerPill';
import { PeekSlot } from '../studio/components/Peek';
import { RecallFooter } from '../studio/components/RecallFooter';
import { hasSource, includeSourceBlock, insertAnswer, removeBlock, resolveAnchor, restoreBlock } from '../studio/edit';
import { groupByPage, pagesInView, pickAnchorPage, regionForBlock } from '../studio/geometry';
import { FLIGHT_EASE, FLIGHT_S, PAGE_ENTER_S } from '../studio/motion';
import type { ShelfItem } from '../studio/shelf';
import { useMorph } from '../studio/useMorph';
import { blocksAtDepth, coveringBlock, shownAt } from '../studio/depth';
import { useCanvasRecall } from '../studio/useCanvasRecall';
import { useDepth } from '../studio/useDepth';
import { sectionFor, sectionsIn, usePageNav } from '../studio/usePageNav';
import { usePeek } from '../studio/usePeek';
import { blockAtReadingLine, useReadingLine } from '../studio/useReadingLine';
import { useStudioTheme } from '../studio/useStudioTheme';
import { useWide } from '../studio/useWide';
import type { Region } from '../studio/geometry';
import { firstWords } from '../studio/text';
import type { CanvasDoc, GeneratedBlock, SourcePage } from '../studio/types';
import '../studio/studio-surface.css';

const HINT = 'Rest on a paragraph to see the source, press S, or ask below.';
const HINT_NO_ORIGINAL = 'Use ← → to move between pages, or ask below.';
const HINT_RECALL = ' · R to recall';
/** How long "Back on page N" stands in for the hint. */
const BACK_ON_MS = 4000;

/**
 * A page of your Library — `/v4/library/m/:id` (One Library spec §5.4–5.5;
 * the canvas rules of the Living Learn spec §3.2, §4). The file owns the
 * screen; Peek lives in the gutter.
 *
 * Your edits (answers asked, removed, sources included) belong to the item and
 * live in the shelf store, so they outlast this screen and the cover counts
 * them. The screen owns the rest of the cross-cutting state (the view, the
 * anchor page, the open Peek) so nothing is lost when a panel unmounts.
 */
export default function StudioCanvasScreen() {
  const { materialId } = useParams<{ materialId: string }>();
  const { state: shelfState, item } = useShelfItem(materialId);
  const canvasId = item?.opens.kind === 'canvas' ? item.opens.canvasId : undefined;
  const { state: canvasState, canvas, pages, material } = useCanvas(canvasId);
  const state = shelfState !== 'ready' ? shelfState : item?.opens.kind === 'lesson' ? 'ready' : canvasState;
  const itemId = item?.id;
  const [theme, toggleTheme] = useStudioTheme();
  /* This item's own canvas: what you asked or changed here, kept by the shelf. */
  const own = useShelfCanvas(itemId);
  const doc = canvas ? (own ?? canvas) : null;
  /** Keep an edit on the item: it outlives this screen, and the cover counts its answers. */
  const save = useCallback(
    (next: CanvasDoc) => {
      if (itemId) shelfActions.saveCanvas(itemId, next);
    },
    [itemId],
  );
  /** The doc as of the last render, for code that runs after an await. */
  const docRef = useRef(doc);
  docRef.current = doc;
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
  const shownFlying = useRef(false);
  shownFlying.current = flying;
  /**
   * The last flight's page keeps its layoutIds (so a flash on it isn't cut short by a remount);
   * they go in the same commit as an answer arriving or leaving, or its paragraphs would glide.
   */
  const dropLayoutIds = useCallback(() => {
    if (!shownFlying.current) setMorphPage(null);
  }, []);
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
    const rects = sectionsIn(shownRef.current).map((el) => {
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

  const reduceMotion = useReducedMotion();
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  /* ── Depth (Learn deeper §3): how deep each page reads in Learn, per Material, this visit only. ── */
  const sourceRemoved = !!material?.sourceRemoved;
  const { levels, onDepth } = useDepth({
    materialId,
    groups,
    pages,
    sourceRemoved,
    original,
    current: nav.current,
    onChange: dropLayoutIds,
  });

  /* ── Recall (Learn, deeper §2): key terms become blanks; Learn only, kept per Material ── */
  const opensCanvas = item?.opens.kind === 'canvas';
  const recall = useCanvasRecall({
    materialId,
    itemId,
    opensCanvas,
    doc,
    groups,
    railGroups,
    pages,
    levels,
    original,
    reduceMotion: !!reduceMotion,
    onDepth,
  });
  /* The hint stays until you've turned a page or switched faces once. */
  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    if (nav.index > 0 || original) setEngaged(true);
  }, [nav.index, original]);

  /* Opened from the shelf: the page takes over from the cover's frame, fading up from black (spec §5.4). */
  const location = useLocation();
  const [fromShelf] = useState(() => (location.state as { from?: string } | null)?.from === 'shelf');

  /* Your place: open where you last were, and say so for a moment instead of the hint. */
  const [backOn, setBackOn] = useState<number | null>(null);
  const restoredFor = useRef<string | null>(null);
  const lastPage = item?.lastPage ?? null;
  const onCanvas = state === 'ready' && !!doc && !!material && item?.opens.kind === 'canvas';
  const hashBlock = /^#b-(.+)$/.exec(location.hash)?.[1] ?? null;
  useEffect(() => {
    if (!onCanvas || !itemId || restoredFor.current === itemId) return;
    restoredFor.current = itemId;
    /* A link to one block (Your words): land on it, not on your last page. */
    const target = hashBlock
      ? document.querySelector<HTMLElement>(`[data-view="clean"] [data-block-id="${CSS.escape(hashBlock)}"]`)
      : null;
    if (target) {
      target.scrollIntoView?.({ block: 'center', behavior: 'instant' });
      if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
      target.focus({ preventScroll: true });
      setFlashId(hashBlock);
      return;
    }
    // A block that is gone (an answer you removed) falls back to your place.
    if (lastPage === null || lastPage <= 1) return;
    const section = sectionFor(shownRef.current, lastPage);
    if (!section) return;
    // Straight there: a long smooth scroll on arrival reads as the page running away.
    section.scrollIntoView?.({ block: 'start', behavior: 'instant' });
    setBackOn(lastPage);
    // Once per item: a later hash or page change is not an arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCanvas, itemId]);
  useEffect(() => {
    if (backOn === null) return;
    const t = setTimeout(() => setBackOn(null), BACK_ON_MS);
    return () => clearTimeout(t);
  }, [backOn]);

  /*
   * Progress flows back to the shelf: opening, turning to a page, answers.
   * A Lesson-backed item only passes through here on its way to the Lesson:
   * it is not opened, so it never becomes Continue.
   */
  useEffect(() => {
    if (!itemId || !opensCanvas) return;
    shelfActions.touch(itemId);
    // Back on the shelf, focus comes home to this page's cover.
    rememberOpened(itemId);
  }, [itemId, opensCanvas]);
  /* Which material the last reported page belongs to: a new one starts over, so its arrival is not a turn. */
  const lastReported = useRef<{ itemId: string; page: number } | null>(null);
  const currentPage = nav.current;
  useEffect(() => {
    if (!itemId || currentPage === null) return;
    // The page you arrive on is not a turn: the shelf already knows where you were.
    const first = lastReported.current?.itemId !== itemId;
    lastReported.current = { itemId, page: currentPage };
    if (!first) shelfActions.markRead(itemId, currentPage);
  }, [itemId, currentPage]);

  /* Keep your place: the anchor page's top stays where it was. */
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    const el = sectionFor(morph.shown, a.page);
    // Instant: the app's root scrolls smoothly, and a glide here is the page running away.
    if (el) window.scrollBy({ top: el.getBoundingClientRect().top - a.top, behavior: 'instant' });
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
  /* At Full a paragraph of the page's own text has a place on it too. */
  const region =
    doc && peek.state.status === 'open'
      ? regionForBlock(
          [...doc.blocks, ...groups.flatMap((g) => (levels[g.page] === 'full' ? blocksAtDepth(g, 'full', pages) : []))],
          pages,
          peek.state.blockId,
        )
      : null;

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
    // Its page reads at a depth that hides it (Gist, Full, Page): open it back to Summary first.
    const g = groups.find((x) => x.blocks.some((b) => b.id === blockId));
    if (g && !shownAt(g, levels[g.page] ?? 'summary', pages).some((b) => b.id === blockId)) onDepth(g.page, 'summary', false);
    pageHint.current = target && hasSource(target) ? target.source.page : null;
    // During a quick look the committed view is already clean: end the look.
    if (morph.quickLook) morph.pressCancel();
    else morph.setView('clean');
    pageHint.current = null; // unused if nothing switched
    setFlashId(null); // so the same paragraph flashes again
    clearTimeout(backTimer.current);
    backTimer.current = setTimeout(() => {
      document
        .querySelector(`[data-view="clean"] [data-block-id="${CSS.escape(blockId)}"]`)
        ?.scrollIntoView?.({ block: 'center', behavior: reduceMotionRef.current ? 'instant' : 'smooth' });
      setFlashId(blockId);
    }, FLIGHT_S * 1000 + 50);
  };
  /* ── Living Learn: asking on the canvas (spec §4) ── */
  const { ask, answering } = useAsk();
  // Suggestions follow what is really on the page: Remove brings a chip back, Undo hides it again.
  const asked = (doc?.blocks ?? []).flatMap((b) => (b.origin === 'generated' ? [b.question ?? b.askedAs] : []));
  const suggestions = nextSuggestions(asked);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [glowId, setGlowId] = useState<string | null>(null);
  const [notice, setNotice] = useState<ComposerNotice | null>(null);
  /** Only "Answer added under: …"; the Composer announces its own notices. */
  const [announce, setAnnounce] = useState('');
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();
  const showNotice = useCallback((n: ComposerNotice | null, ms = 6000) => {
    clearTimeout(noticeTimer.current);
    setNotice(n);
    if (n) noticeTimer.current = setTimeout(() => setNotice(null), ms);
  }, []);
  /** The answer whose anchor is glowing: only its settling ends the glow. */
  const glowFor = useRef<string | null>(null);
  const mounted = useRef(true);
  const announceTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(noticeTimer.current);
      clearTimeout(announceTimer.current);
    };
  }, []);
  /** Clear, then say it a beat later: the same words twice are still announced twice. */
  const say = useCallback((text: string) => {
    clearTimeout(announceTimer.current);
    setAnnounce('');
    announceTimer.current = setTimeout(() => setAnnounce(text), 50);
  }, []);
  /** The composer's wrapper: "Added below" means below what the composer leaves visible. */
  const composerRef = useRef<HTMLDivElement>(null);

  /**
   * The paragraph you last selected text in (spec §4.2 rule 1). Kept across
   * the click into the composer, which collapses the selection; used once.
   */
  const lastSelectionBlock = useRef<string | null>(null);
  useEffect(() => {
    const onSelection = () => {
      const sel = window.getSelection?.();
      const node = sel?.anchorNode ?? null;
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      const block = el?.closest<HTMLElement>('[data-view="clean"] [data-block-id]') ?? null;
      if (!sel || sel.isCollapsed) {
        // A click anywhere else drops it; only moving into the composer keeps it.
        if (!el?.closest('[data-composer]')) lastSelectionBlock.current = null;
        return;
      }
      // A new selection that is not in a paragraph of your version replaces it with nothing.
      lastSelectionBlock.current = block && !block.matches('[data-woven]') ? (block.dataset.blockId ?? null) : null;
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  /** After Undo, focus goes to the restored answer's Remove button, never to the page body. */
  const focusAfterRestore = useRef<string | null>(null);
  useEffect(() => {
    const id = focusAfterRestore.current;
    if (!id) return;
    focusAfterRestore.current = null;
    document.querySelector<HTMLElement>(`[data-block-id="${id}"] button[aria-label="Remove this answer"]`)?.focus();
  }, [doc]);
  /** The composer input, if you asked from it: it is disabled while answering, so focus goes back after. */
  const refocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (answering || !refocus.current) return;
    const el = refocus.current;
    refocus.current = null;
    if (el.isConnected && (document.activeElement === document.body || document.activeElement === null)) el.focus();
  }, [answering]);

  const onAsk = async (question: string) => {
    if (!docRef.current) return;
    setEngaged(true);
    showNotice(null);
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.closest('form')) refocus.current = active;
    const selectionBlock = lastSelectionBlock.current;
    lastSelectionBlock.current = null;
    const result = await ask(question);
    if (!mounted.current || result.kind === 'busy') return;
    if (result.kind === 'unknown') {
      showNotice({ kind: 'unknown' }, 10000);
      return;
    }
    // Computed outside any state updater: StrictMode runs updaters twice.
    const base = docRef.current;
    if (!base) return;
    // Last resort: the last paragraph that isn't itself an answer.
    const fallback = [...base.blocks].reverse().find((b) => b.origin !== 'generated')?.id ?? null;
    const anchorId =
      resolveAnchor(base.blocks, {
        // A paragraph of the full text (Full depth) stands in for the summary that covers it.
        selection: coveringBlock(base.blocks, selectionBlock),
        cited: result.answer.anchorId,
        readingLine: coveringBlock(base.blocks, blockAtReadingLine(column.current)),
      }) ?? fallback;
    if (!anchorId) return;
    const id = shelfActions.newAnswerId();
    const block: GeneratedBlock = {
      id,
      origin: 'generated',
      markdown: result.answer.markdown,
      citations: result.answer.citations,
      askedAs: question,
      ...(result.answer.question && { question: result.answer.question }),
      anchorId,
      ...(result.answer.blocks && { blocks: result.answer.blocks }),
      ...(result.answer.format && { format: result.answer.format }),
    };
    const anchorBlock = base.blocks.find((b) => b.id === anchorId);
    const next = insertAnswer(base, block);
    docRef.current = next;
    // One commit: the answer (from the store) arrives already fresh, with its anchor glowing.
    flushSync(() => {
      dropLayoutIds();
      save(next);
      // Landed while Source is shown: it is simply there when you come back, no growth to replay.
      if (shownRef.current === 'clean') {
        setFreshId(id);
        glowFor.current = id;
        setGlowId(anchorId);
      }
    });
    say(`Answer added under: ${anchorBlock ? firstWords(anchorBlock.markdown) : 'the end'} (for: ${question})`);
  };

  /* Leaving Learn ends any growth: on the way back the answer is simply there. */
  useEffect(() => {
    if (!original) return;
    setFreshId(null);
    glowFor.current = null;
    setGlowId(null);
  }, [original]);

  /* "Added below ↓": the fresh answer landed off-screen. */
  useEffect(() => {
    if (!freshId) return;
    const el = document.querySelector<HTMLElement>(`[data-block-id="${freshId}"]`);
    if (!el) return;
    // A growing answer starts 0 px tall but its top is real; only skip when there is no layout at all.
    if (el.getClientRects().length === 0) return;
    // Visible means above the composer (and its scrim), not merely inside the window.
    const c = composerRef.current?.getBoundingClientRect();
    const fold = c && c.height > 0 ? c.top : window.innerHeight - 192;
    if (el.getBoundingClientRect().top <= fold) return;
    showNotice({
      kind: 'below',
      onJump: () => {
        el.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'center' });
        showNotice(null);
      },
    });
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setNotice((n) => (n?.kind === 'below' ? null : n));
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
    // reduceMotion is read when you jump; a change mid-notice needn't re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshId, showNotice]);

  const onAnswerSettled = useCallback((id: string) => {
    setFreshId((f) => (f === id ? null : f));
    if (glowFor.current === id) {
      glowFor.current = null;
      setGlowId(null);
    }
  }, []);
  const onRemoveAnswer = useCallback(
    (id: string) => {
      const base = docRef.current;
      if (!base) return;
      const { doc: next, removed } = removeBlock(base, id);
      if (!removed) return;
      docRef.current = next;
      flushSync(() => {
        dropLayoutIds();
        save(next);
        setFreshId((f) => (f === id ? null : f));
        // Removed before it settled: it never will, so its anchor stops glowing here.
        if (glowFor.current === id) {
          glowFor.current = null;
          setGlowId(null);
        }
      });
      showNotice({
        kind: 'removed',
        onUndo: () => {
          const now = docRef.current;
          if (now) {
            const back = restoreBlock(now, removed);
            docRef.current = back;
            focusAfterRestore.current = removed.block.id;
            flushSync(() => {
              dropLayoutIds();
              save(back);
            });
          }
          showNotice(null);
        },
      });
    },
    [showNotice, dropLayoutIds, save],
  );
  const { open: openPeek } = peek;
  const onOpenPeekSource = useCallback(
    (sourceId: string) => {
      const covering = docRef.current?.blocks.find((b) => hasSource(b) && b.source.blockIds.includes(sourceId));
      if (covering) openPeek(covering.id);
    },
    [openPeek],
  );

  const include = (page: SourcePage, sourceBlockId: string) => {
    const base = docRef.current;
    if (!base) return;
    const next = includeSourceBlock(base, page, sourceBlockId);
    docRef.current = next;
    save(next);
  };

  /*
   * One root for every state (same element type, so loading → ready keeps it):
   * from the shelf it fades up once, on mount; a deep link simply renders.
   */
  const root = (children: React.ReactNode) => (
    <motion.div
      className="studio-surface min-h-screen"
      data-theme={theme}
      initial={fromShelf ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0.15 : PAGE_ENTER_S, ease: FLIGHT_EASE }}
    >
      {children}
    </motion.div>
  );
  const frame = (children: React.ReactNode) => root(<div className="mx-auto max-w-3xl p-8">{children}</div>);
  if (state === 'loading') return frame(<ListSkeleton />);
  if (state === 'error') return frame(<SpacesError what="this Material" />);
  if (item?.opens.kind === 'lesson')
    return <Navigate replace to={`/v4/space/${item.opens.spaceId}/lesson/${item.opens.lessonId}`} />;
  if (!item || !doc || !material)
    return frame(<NotFound what="Material" backTo="/v4/library" backLabel="Back to Library" />);

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

  return root(
    <>
      {/* The reader's masthead: the way out, where you are, and which face you're reading. */}
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur-md">
        <div className="relative flex min-h-[88px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
          <Link
            to="/v4/library"
            aria-label="Back to Library"
            className="console-focusable order-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-quiet transition-colors hover:bg-[rgb(var(--studio-chip))] hover:text-foreground"
          >
            <ChevronLeft aria-hidden className="h-5 w-5" />
          </Link>
          <div className="order-3 w-full min-w-0 text-center xl:pointer-events-none xl:absolute xl:inset-x-[27rem] xl:top-1/2 xl:order-2 xl:w-auto xl:-translate-y-1/2">
            <div className="flex min-w-0 items-baseline justify-center gap-2">
              <nav aria-label="Breadcrumb" className="flex shrink-0 items-baseline gap-2">
                <Link
                  to="/v4/library"
                  className="console-focusable pointer-events-auto rounded text-[14px] text-quiet hover:text-foreground"
                >
                  Library
                </Link>
                <span aria-hidden className="text-faint">·</span>
              </nav>
              <h1 className="truncate text-[20px] font-medium leading-tight tracking-[-0.015em] text-foreground sm:text-[22px]">
                {item.filename}
              </h1>
            </div>
            {item.sample && <p className="mt-1 truncate text-[12.5px] text-faint">Sample pages in this preview</p>}
          </div>
          <div className="order-2 ml-auto flex items-center gap-2 xl:order-3">
            <button
              ref={recall.toggleRef}
              type="button"
              onClick={recall.stored.toggle}
              aria-pressed={recall.stored.state.on}
              disabled={original}
              title={original ? 'Recall works in Learn' : undefined}
              className={cn(
                'console-focusable h-9 rounded-full px-3.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                recall.stored.state.on
                  ? 'bg-[rgb(var(--studio-chip))] text-foreground'
                  : 'text-faint hover:bg-[rgb(var(--studio-chip))] hover:text-foreground',
              )}
            >
              Recall
            </button>
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
            <ShareButton item={item} />
          </div>
        </div>
      </header>

      {/* The contents, down the left edge — wide screens only. */}
      <div className="fixed bottom-24 left-0 top-[112px] z-20 hidden w-60 overflow-y-auto overflow-x-hidden pl-8 pr-4 min-[1180px]:block">
        <PageRail groups={railGroups} current={nav.current} onPage={nav.go} progress={recall.railProgress} />
      </div>

      <div className="min-[1180px]:pl-60">
        {/* Where this page stands: wide screens only; on phones it folds into Share's menu. */}
        <div className="hidden px-4 pt-5 md:px-6 lg:block">
          <Journey item={item} className="mx-auto max-w-[44rem]" />
        </div>
        <div className={cn('grid gap-6 px-4 md:px-6', gutter && 'grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]')}>
          <main
            ref={column}
            className={cn(
              // pb-72 clears the scrim and the composer (with its chips): the last page scrolls fully into the open.
              // No scroll anchoring: an answer growing above you must not drag the page (spec §4.4).
              'mx-auto w-full min-w-0 pb-72 pt-6 [overflow-anchor:none]',
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
                freshId={freshId}
                glowId={glowId}
                onAnswerSettled={onAnswerSettled}
                onRemoveAnswer={onRemoveAnswer}
                onOpenPeekSource={onOpenPeekSource}
                theme={theme}
                recall={recall.canvasRecall}
                levels={levels}
                onDepth={onDepth}
              />
            </LayoutGroup>
            {recall.on && recall.total > 0 && (
              <RecallFooter
                notYet={recall.notYet}
                anyMarked={recall.anyMarked}
                onTryAgain={recall.onTryAgain}
                onStartOver={recall.onStartOver}
              />
            )}
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
        so the composer never sits on top of words. Full width, and
        it never takes a click.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 h-48 bg-gradient-to-t from-background via-background/85 to-transparent"
      />

      {/* Ask, with the page line tucked in at its end. */}
      <div
        ref={composerRef}
        className={cn(
          'pointer-events-none fixed inset-x-0 bottom-5 z-20 flex justify-center px-4 min-[1180px]:left-60',
          gutter && 'right-[29.5rem]',
        )}
      >
        <Composer
          answering={answering}
          suggestions={suggestions}
          showSuggestions
          notice={notice}
          hint={
            backOn !== null
              ? `Back on page ${backOn}`
              : engaged
                ? null
                : (material.sourceRemoved ? HINT_NO_ORIGINAL : HINT).replace(/\.$/, '') + HINT_RECALL
          }
          onAsk={onAsk}
          pager={
            <PagerPill
              embedded
              current={nav.counter}
              last={nav.last}
              canBack={nav.index > 0}
              canForward={nav.index >= 0 && nav.index < viewPages.length - 1}
              hint={null}
              onStep={nav.step}
            />
          }
        />
      </div>
      <p role="status" aria-live="polite" aria-label="Canvas updates" className="sr-only">
        {announce}
      </p>

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
    </>,
  );
}
