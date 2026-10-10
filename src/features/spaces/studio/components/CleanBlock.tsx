import { memo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { Markdown } from './Markdown';
import { FLASH_FRAMES, FLIGHT_EASE, FLIGHT_S, STAGGER_S, TEXT_FADE_S } from '../motion';
import type { CanvasBlock } from '../types';

interface Props {
  block: CanvasBlock;
  page: number;
  /** Position within its page, for the reverse stagger on the way back. */
  index: number;
  count: number;
  /**
   * On the anchor page: this block carries `layoutId` and flies to/from its
   * spot on the original. Only the anchor page's blocks are layout nodes, so
   * a re-render elsewhere (hover, pin-follow, flash) never measures the rest.
   * The caller keys the block by this flag: Motion registers a `layoutId`
   * once, at mount, so changing it requires a remount.
   */
  morph: boolean;
  /** True on the anchor page right after a switch: the text fades in after landing. */
  flying: boolean;
  lowConfidence: boolean;
  active: boolean;
  flash: boolean;
  /** The source file was removed: the marker stays as text, it leads nowhere. */
  markerDisabled: boolean;
  onPointerEnter(blockId: string, pointerType: string): void;
  onPointerLeave(): void;
  onOpenPeek(blockId: string): void;
  onClosePeek(): void;
}

/**
 * One block of your version.
 *
 * Only an `extracted` block has a place on the original, so only it gets a
 * page marker, a hover-intent and Space-to-peek. The marker is a real button
 * — the touch and keyboard way in — and on hover-capable screens it shows on
 * hover or focus to keep the margin quiet.
 */
export const CleanBlock = memo(function CleanBlock({
  block, page, index, count, morph, flying, lowConfidence, active, flash, markerDisabled,
  onPointerEnter, onPointerLeave, onOpenPeek, onClosePeek,
}: Props) {
  const extracted = block.origin === 'extracted';
  const reduce = useReducedMotion();
  const flies = extracted && morph;
  return (
    <motion.div
      data-block-id={block.id}
      data-extracted={extracted ? 'true' : 'false'}
      data-morph={flies ? 'true' : undefined}
      data-flash={flash ? 'true' : undefined}
      tabIndex={extracted ? 0 : undefined}
      onPointerEnter={(e) => extracted && onPointerEnter(block.id, e.pointerType)}
      // Touch fires pointerleave after every tap; only a mouse really leaves.
      onPointerLeave={(e) => extracted && e.pointerType !== 'touch' && e.pointerType !== 'pen' && onPointerLeave()}
      onKeyDown={(e) => {
        if (!extracted) return;
        if (e.key === ' ') {
          e.preventDefault();
          onOpenPeek(block.id);
        } else if (e.key === 'Escape') {
          onClosePeek();
        }
      }}
      layoutId={flies ? `morph-${block.id}` : undefined}
      animate={flash ? { backgroundColor: FLASH_FRAMES } : undefined}
      transition={{
        layout: { duration: FLIGHT_S, ease: FLIGHT_EASE, delay: (count - 1 - index) * STAGGER_S },
        backgroundColor: { duration: 1.2, times: [0, 0.6, 1] },
      }}
      className={cn(
        'group relative -mx-3 rounded-lg px-3 py-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        active && 'bg-[hsl(var(--studio-mark)/0.14)]',
        block.origin === 'written' && 'rounded-l-none border-l-2 border-primary/40',
      )}
    >
      {extracted &&
        (markerDisabled ? (
          <span className="absolute -left-14 top-1.5 w-11 text-right text-[11px] tabular-nums text-muted-foreground">
            p.{page}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onOpenPeek(block.id)}
            aria-label={`Show the original, page ${page}`}
            className="absolute -left-14 top-1 min-h-6 w-11 rounded-full border border-border bg-card text-[11px] tabular-nums text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:border-transparent [@media(hover:none)]:bg-transparent [@media(hover:none)]:text-muted-foreground/70 [@media(hover:none)]:opacity-100"
          >
            p.{page}
          </button>
        ))}
      <motion.div
        initial={flies && flying && !reduce ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ delay: FLIGHT_S * 0.6, duration: TEXT_FADE_S }}
      >
        <Markdown
          className={cn(lowConfidence && 'underline decoration-dotted decoration-muted-foreground underline-offset-4')}
        >
          {block.markdown}
        </Markdown>
      </motion.div>
    </motion.div>
  );
});
