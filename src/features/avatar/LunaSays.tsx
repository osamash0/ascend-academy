import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/**
 * What Luna says: one or two words in a white pill beside her head. The one
 * squared corner points back at her, so the words read as hers.
 *
 * `side` is where the bubble sits relative to Luna. Positioning is the
 * caller's (`className`): the bubble is absolutely placed against her frame.
 * Callers that change the words wrap it in `AnimatePresence` and key it.
 */
export function LunaSays({
  side = 'right',
  className,
  children,
}: {
  side?: 'left' | 'right';
  className?: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      data-testid="luna-says"
      className={cn(
        'absolute whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-[12.5px] font-medium text-black shadow-[0_6px_20px_-8px_rgba(0,0,0,0.8)]',
        side === 'right' ? 'rounded-bl-[4px]' : 'rounded-br-[4px]',
        className,
      )}
      initial={reduce ? false : { opacity: 0, scale: 0.85, x: side === 'right' ? -4 : 4 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 26, delay: 0.1 }}
    >
      {children}
    </motion.span>
  );
}
