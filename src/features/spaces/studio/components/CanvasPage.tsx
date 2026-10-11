import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { CleanBlock } from './CleanBlock';
import { DepthDial } from './DepthDial';
import { OriginalPage } from './OriginalPage';
import { PageDivider } from './PageDivider';
import { ProgressRing } from './ProgressRing';
import { WovenAnswer } from './WovenAnswer';
import { hasSource } from '../edit';
import { minConfidence } from '../geometry';
import type { PageGroup } from '../geometry';
import { blocksAtDepth, depthsFor, type Depth } from '../depth';
import { DEPTH_ENTER_S, DEPTH_LAYOUT_S, DEPTH_LEAVE_S, DEPTH_STAGGER_S, FLIGHT_EASE } from '../motion';
import type { CanvasView } from '../useMorph';
import { pageProgress, recallLabel, stateOf, type RecallState, type TermState } from '../recall';
import type { CanvasBlock, SourcePage } from '../types';

interface Props {
  groups: PageGroup[];
  pages: SourcePage[];
  view: CanvasView;
  /** The page that flies; every other page crossfades. */
  morphPage: number | null;
  flying: boolean;
  activeBlockId: string | null;
  flashBlockId: string | null;
  sourceRemoved: boolean;
  materialName: string;
  onBlockPointerEnter(blockId: string, pointerType: string): void;
  onBlockPointerLeave(): void;
  onOpenPeek(blockId: string): void;
  onClosePeek(): void;
  onRegion(blockId: string): void;
  onInclude(page: SourcePage, sourceBlockId: string): void;
  /** Living Learn: the answer that just arrived (it grows in), and the paragraph it grew under (it glows). */
  freshId: string | null;
  glowId: string | null;
  onAnswerSettled(id: string): void;
  onRemoveAnswer(id: string): void;
  /** A citation chip names a *source* block; the screen finds the paragraph that covers it. */
  onOpenPeekSource(sourceBlockId: string): void;
  theme?: 'light' | 'dark';
  /** Recall mode, while it is on: summary terms become blanks, and each page shows its ring. */
  recall?: CanvasRecall | null;
  /** How deep each page reads in Learn (Learn deeper §3); a page not in it reads at Summary. */
  depth: Record<number, Depth>;
  /** The dial on a page's divider; `all` when Shift was held. */
  onDepth(page: number, d: Depth, all: boolean): void;
}

export interface CanvasRecall {
  state: RecallState;
  onReveal(key: string): void;
  onMark(key: string, t: 'knew' | 'notYet'): void;
}

/** What a summary block needs to render its terms as blanks; a new one whenever any mark changes. */
export interface BlockRecall {
  get(key: string): TermState;
  onReveal(key: string): void;
  onMark(key: string, t: 'knew' | 'notYet'): void;
}

/**
 * Your version and the original, page by page — spec §4.2.
 *
 * `popLayout` takes the outgoing view out of flow while the incoming one
 * mounts, so both exist in the same frame and Motion can pair their layoutIds.
 *
 * Only the anchor page (`morphPage`) flies, and only it carries layoutIds —
 * on both sides. Elements are keyed by that anchor-ness so they remount when
 * it changes (Motion registers a `layoutId` once, at mount); the screen
 * commits `morphPage` before the view flips, so the side that leaves already
 * carries the ids it needs. Every other page crossfades.
 */
export function CanvasPage(p: Props) {
  // Once per (blocks, pages, depths), not per block per render. At Full, the page's own text counts too.
  const lowConfidence = useMemo(() => {
    const ids = new Set<string>();
    for (const g of p.groups)
      for (const b of [...g.blocks, ...(p.depth[g.page] === 'full' ? blocksAtDepth(g, 'full', p.pages) : [])])
        if (hasSource(b) && (minConfidence(b.source, p.pages) ?? 1) < 0.8) ids.add(b.id);
    return ids;
  }, [p.groups, p.pages, p.depth]);
  const recall = p.recall ?? null;
  const blockRecall = useMemo<BlockRecall | null>(
    () =>
      recall
        ? { get: (key) => stateOf(recall.state, key), onReveal: recall.onReveal, onMark: recall.onMark }
        : null,
    [recall],
  );
  return (
    <div className="space-y-12">
      {p.groups.map((g) => {
        const page = p.pages.find((x) => x.materialId === g.materialId && x.page === g.page) ?? null;
        const morph = p.morphPage === g.page;
        const showOriginal = p.view === 'original' && page && !p.sourceRemoved;
        // The dial: what this page offers (no Page without the source), and where it stands.
        const options = depthsFor(g, p.pages).filter((d) => d !== 'page' || (page && !p.sourceRemoved));
        const wanted = p.depth[g.page] ?? 'summary';
        const level: Depth = options.includes(wanted) ? wanted : 'summary';
        const inlinePage = level === 'page' && page ? page : null;
        // At Page, your own blocks (answers, notes, handwriting) still follow the page itself.
        const shown = inlinePage ? g.blocks.filter((b) => isYours(b, inlinePage)) : blocksAtDepth(g, level, p.pages);
        return (
          <div key={`${g.materialId}-${g.page}`} className="relative">
            <AnimatePresence initial={false} mode="popLayout">
              {showOriginal ? (
                <motion.div
                  key="original"
                  initial={{ opacity: morph ? 1 : 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <OriginalPage
                    page={page}
                    blocks={g.blocks}
                    morph={morph}
                    materialName={p.materialName}
                    onRegion={p.onRegion}
                    onInclude={(id) => p.onInclude(page, id)}
                  />
                </motion.div>
              ) : (
                <motion.section
                  key="clean"
                  data-view="clean"
                  data-page-anchor={g.page}
                  aria-label={g.page ? `Page ${g.page}` : 'Your notes'}
                  className="scroll-mt-40 lg:scroll-mt-28"
                  initial={{ opacity: morph ? 1 : 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <PageDivider
                    page={g.page}
                    ring={
                      recall
                        ? (() => {
                            // Only what is on screen counts: at Full or Page there are no terms, so no ring.
                            const { knew, total } = pageProgress(shown, recall.state);
                            return <ProgressRing knew={knew} total={total} label={recallLabel(g.page, knew, total)} />;
                          })()
                        : undefined
                    }
                    dial={
                      options.length > 1 ? (
                        <DepthDial
                          page={g.page}
                          value={level}
                          options={options}
                          onChange={(d, all) => p.onDepth(g.page, d, all)}
                        />
                      ) : undefined
                    }
                  />
                  <DepthBlocks
                    depth={level}
                    blocks={shown}
                    page={
                      inlinePage ? (
                        <OriginalPage
                          bare
                          page={inlinePage}
                          blocks={g.blocks}
                          morph={false}
                          materialName={p.materialName}
                          onRegion={(id) => {
                            // "Back to" this paragraph: it is in the summary, so the page opens back up into it.
                            p.onDepth(g.page, 'summary', false);
                            p.onRegion(id);
                          }}
                          onInclude={(id) => p.onInclude(inlinePage, id)}
                        />
                      ) : null
                    }
                    render={(b, i) =>
                      b.origin === 'generated' ? (
                        <WovenAnswer
                          block={b}
                          fresh={p.freshId === b.id}
                          onSettled={p.onAnswerSettled}
                          onRemove={p.onRemoveAnswer}
                          onOpenPeek={p.onOpenPeekSource}
                          flying={p.flying && morph}
                          flash={p.flashBlockId === b.id}
                        />
                      ) : (
                        <CleanBlock
                          key={`${b.id}:${morph}`}
                          block={b}
                          page={g.page}
                          index={i}
                          count={shown.length}
                          morph={morph}
                          flying={p.flying && morph}
                          lowConfidence={lowConfidence.has(b.id)}
                          active={p.activeBlockId === b.id}
                          flash={p.flashBlockId === b.id}
                          glow={p.glowId === b.id}
                          theme={p.theme}
                          recall={b.origin === 'summary' ? blockRecall : null}
                          markerDisabled={p.sourceRemoved}
                          onPointerEnter={p.onBlockPointerEnter}
                          onPointerLeave={p.onBlockPointerLeave}
                          onOpenPeek={p.onOpenPeek}
                          onClosePeek={p.onClosePeek}
                        />
                      )
                    }
                  />
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

/** Yours, not the page's: an answer, a note you wrote, or your handwriting on it. */
function isYours(b: CanvasBlock, page: SourcePage): boolean {
  if (b.origin === 'generated' || b.origin === 'written') return true;
  return (
    b.origin === 'extracted' &&
    page.blocks.some((s) => s.kind === 'handwriting' && b.source.blockIds.includes(s.id))
  );
}

const RISE_FROM = { opacity: 0, y: 4, filter: 'blur(3px)' };
const FADE_FROM = { opacity: 0 };
const SHOWN = { opacity: 1, y: 0, filter: 'none' };
/** Leaving at a depth change fades; anything else that leaves (an answer removed) simply goes, as before. */
const LEAVE = {
  leave: (shifting: boolean) => ({ opacity: 0, transition: { duration: shifting ? DEPTH_LEAVE_S : 0 } }),
};

/**
 * One page's paragraphs at its depth (Learn deeper §3.4). The list's height
 * settles with Motion `layout`, only when the depth changes
 * (`layoutDependency`), so answers growing in and other edits never glide.
 * Paragraphs at both depths stay put; leaving ones fade out of flow
 * (`popLayout`); arriving ones fade up, staggered. Reduced motion: one fade.
 */
function DepthBlocks({
  depth,
  blocks,
  page,
  render,
}: {
  depth: Depth;
  blocks: CanvasBlock[];
  /** The page itself, at the Page depth. */
  page: React.ReactNode | null;
  render(b: CanvasBlock, i: number): React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const keys = [...(page ? ['page'] : []), ...blocks.map((b) => b.id)];
  /** What the last commit showed: arrivals are what it did not. */
  const prev = useRef<string[]>(keys);
  useEffect(() => {
    prev.current = keys;
  });
  const [shift, setShift] = useState({ depth, on: false, before: new Set<string>() });
  let now = shift;
  if (shift.depth !== depth) {
    now = { depth, on: true, before: new Set(prev.current) };
    setShift(now);
  }
  useEffect(() => {
    if (!shift.on) return;
    const t = setTimeout(() => setShift((s) => (s.on ? { ...s, on: false } : s)), (DEPTH_LAYOUT_S + DEPTH_LEAVE_S) * 1000);
    return () => clearTimeout(t);
  }, [shift]);

  const arriving = keys.filter((k) => !now.before.has(k));
  const from = now.on ? (reduce ? FADE_FROM : RISE_FROM) : false;
  const item = (key: string, node: React.ReactNode) => (
    <DepthItem
      key={key}
      layout={reduce ? false : 'position'}
      layoutDependency={depth}
      custom={now.on}
      variants={LEAVE}
      initial={from}
      animate={SHOWN}
      exit="leave"
      transition={{
        duration: reduce ? 0.15 : DEPTH_ENTER_S,
        delay: reduce ? 0 : Math.max(0, arriving.indexOf(key)) * DEPTH_STAGGER_S,
        ease: FLIGHT_EASE,
        layout: { duration: DEPTH_LAYOUT_S, ease: FLIGHT_EASE },
      }}
    >
      {node}
    </DepthItem>
  );
  return (
    <motion.div
      layout={reduce ? false : true}
      layoutDependency={depth}
      transition={{ layout: { duration: DEPTH_LAYOUT_S, ease: FLIGHT_EASE } }}
      className="relative space-y-2"
    >
      <AnimatePresence mode="popLayout" custom={now.on}>
        {page && item('page', page)}
        {blocks.map((b, i) => item(b.id, render(b, i)))}
      </AnimatePresence>
    </motion.div>
  );
}

/** A paragraph on its way out is already gone for assistive tech and the pointer. */
const DepthItem = forwardRef<HTMLDivElement, HTMLMotionProps<'div'>>(function DepthItem(props, ref) {
  const present = useIsPresent();
  return (
    <motion.div
      ref={ref}
      {...props}
      data-leaving={present ? undefined : 'true'}
      aria-hidden={present ? undefined : true}
      className={present ? undefined : 'pointer-events-none'}
    />
  );
});
