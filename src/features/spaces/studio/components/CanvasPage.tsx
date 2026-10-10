import { useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CleanBlock } from './CleanBlock';
import { OriginalPage } from './OriginalPage';
import { PageDivider } from './PageDivider';
import { WovenAnswer } from './WovenAnswer';
import { hasSource } from '../edit';
import { minConfidence } from '../geometry';
import type { PageGroup } from '../geometry';
import type { CanvasView } from '../useMorph';
import type { SourcePage } from '../types';

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
  // Once per (blocks, pages), not per block per render.
  const lowConfidence = useMemo(() => {
    const ids = new Set<string>();
    for (const g of p.groups)
      for (const b of g.blocks)
        if (hasSource(b) && (minConfidence(b.source, p.pages) ?? 1) < 0.8) ids.add(b.id);
    return ids;
  }, [p.groups, p.pages]);
  return (
    <div className="space-y-12">
      {p.groups.map((g) => {
        const page = p.pages.find((x) => x.materialId === g.materialId && x.page === g.page) ?? null;
        const morph = p.morphPage === g.page;
        const showOriginal = p.view === 'original' && page && !p.sourceRemoved;
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
                  <PageDivider page={g.page} />
                  <div className="space-y-2">
                    {g.blocks.map((b, i) =>
                      b.origin === 'generated' ? (
                        <WovenAnswer
                          key={b.id}
                          block={b}
                          fresh={p.freshId === b.id}
                          onSettled={p.onAnswerSettled}
                          onRemove={p.onRemoveAnswer}
                          onOpenPeek={p.onOpenPeekSource}
                        />
                      ) : (
                        <CleanBlock
                          key={`${b.id}:${morph}`}
                          block={b}
                          page={g.page}
                          index={i}
                          count={g.blocks.length}
                          morph={morph}
                          flying={p.flying && morph}
                          lowConfidence={lowConfidence.has(b.id)}
                          active={p.activeBlockId === b.id}
                          flash={p.flashBlockId === b.id}
                          glow={p.glowId === b.id}
                          markerDisabled={p.sourceRemoved}
                          onPointerEnter={p.onBlockPointerEnter}
                          onPointerLeave={p.onBlockPointerLeave}
                          onOpenPeek={p.onOpenPeek}
                          onClosePeek={p.onClosePeek}
                        />
                      ),
                    )}
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
