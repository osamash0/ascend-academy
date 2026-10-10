import { AnimatePresence, motion } from 'motion/react';
import { CleanBlock } from './CleanBlock';
import { OriginalPage } from './OriginalPage';
import { PageDivider } from './PageDivider';
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
}

/**
 * Your version and the original, page by page — spec §4.2.
 *
 * `popLayout` takes the outgoing view out of flow while the incoming one
 * mounts, so both exist in the same frame and Motion can pair their layoutIds.
 */
export function CanvasPage(p: Props) {
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
                  initial={{ opacity: morph ? 1 : 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <PageDivider page={g.page} />
                  <div className="space-y-2">
                    {g.blocks.map((b, i) => (
                      <CleanBlock
                        key={b.id}
                        block={b}
                        page={g.page}
                        index={i}
                        count={g.blocks.length}
                        flying={p.flying && morph}
                        lowConfidence={b.origin === 'extracted' && (minConfidence(b.source, p.pages) ?? 1) < 0.8}
                        active={p.activeBlockId === b.id}
                        flash={p.flashBlockId === b.id}
                        markerDisabled={p.sourceRemoved}
                        onPointerEnter={p.onBlockPointerEnter}
                        onPointerLeave={p.onBlockPointerLeave}
                        onOpenPeek={p.onOpenPeek}
                        onClosePeek={p.onClosePeek}
                      />
                    ))}
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
