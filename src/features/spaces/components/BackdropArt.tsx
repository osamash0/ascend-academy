import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { gradientFor } from '@/components/console';
import { topicIcon } from '@/lib/topicIcon';
import { cn } from '@/lib/utils';

/**
 * The selected item's art, behind everything.
 *
 * A console store shows you what you are pointing at before you commit to it.
 * Scrubbing the rail changes the whole backdrop, so choosing feels like moving
 * through a place rather than reading a list.
 *
 * **0.7s, against the foreground's 0.18s.** The gap is the point: the thing
 * under your cursor answers immediately, the world behind it takes its time.
 * Matching them would make the backdrop feel twitchy; closing the gap the
 * other way would make the tiles feel laggy.
 *
 * **Debounced by 150ms.** Holding an arrow key walks the rail faster than the
 * fade completes, and without this each card queues its own 0.7s cross-fade —
 * a backlog of dissolves still resolving long after you have stopped. The
 * debounce means fast scrubbing skips straight to wherever you landed.
 *
 * `mode="popLayout"` so the outgoing art is taken out of flow while it fades:
 * the two layers overlap rather than the new one waiting for the old.
 */

export function BackdropArt({
  /** The focused item. `null` fades the backdrop out entirely. */
  id,
  /** Drives the gradient, so consecutive items differ. */
  index = 0,
  /** Used for the watermark glyph, so the art is about *this* subject. */
  title,
  className,
}: {
  id: string | null;
  index?: number;
  title?: string;
  className?: string;
}) {
  /*
   * The settled id, not the live one. Everything below keys off this so a fast
   * scrub produces one fade rather than a queue of them.
   */
  const [settled, setSettled] = useState(id);
  useEffect(() => {
    const t = setTimeout(() => setSettled(id), 150);
    return () => clearTimeout(t);
  }, [id]);

  const Icon = settled && title ? topicIcon(title, settled) : null;

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {settled && (
        <motion.div
          key={settled}
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          // Deliberately slower than the 0.18s house default.
          transition={{ duration: 0.7, ease: 'easeInOut' }}
          className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden', className)}
        >
          <div className={cn('absolute inset-0 bg-gradient-to-br opacity-[0.22]', gradientFor(index))} />
          {/*
            Blur is allowed on the background layer and nowhere else — it is the
            one place it cannot cost a frame in the foreground.
          */}
          <div className="absolute inset-0 backdrop-blur-3xl" />
          {Icon && (
            <Icon className="absolute -right-16 top-1/2 h-[36rem] w-[36rem] -translate-y-1/2 text-white/[0.02]" />
          )}
          {/* Legibility: the rails sit on the left, so darken there hardest. */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#070b14] via-[#070b14]/85 to-[#070b14]/60" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
