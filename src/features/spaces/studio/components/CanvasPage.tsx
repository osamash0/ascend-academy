import { CleanBlock } from './CleanBlock';
import { PageDivider } from './PageDivider';
import { minConfidence } from '../geometry';
import type { PageGroup } from '../geometry';
import type { SourcePage } from '../types';

interface Props {
  groups: PageGroup[];
  pages: SourcePage[];
  activeBlockId: string | null;
  flashBlockId: string | null;
  sourceRemoved: boolean;
  onBlockPointerEnter(blockId: string, pointerType: string): void;
  onBlockPointerLeave(): void;
  onOpenPeek(blockId: string): void;
  onClosePeek(): void;
}

/** Your version, one section per page of the Material. */
export function CanvasPage(p: Props) {
  return (
    <div className="space-y-12">
      {p.groups.map((g) => (
        <section
          key={`${g.materialId}-${g.page}`}
          data-view="clean"
          data-page-anchor={g.page}
          aria-label={g.page ? `Page ${g.page}` : 'Your notes'}
        >
          <PageDivider page={g.page} />
          <div className="space-y-2">
            {g.blocks.map((b) => (
              <CleanBlock
                key={b.id}
                block={b}
                page={g.page}
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
        </section>
      ))}
    </div>
  );
}
