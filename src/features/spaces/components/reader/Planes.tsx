import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/**
 * Planes.
 *
 * One place at reading distance, and one thing in it. A Lesson has two faces
 * — the Material's page and the parsed text — and turning it over replaces
 * one with the other *in that place*: a cross-dissolve, nothing moving, both
 * faces positioned at the anchor before it starts. The other face does not
 * exist to the eye, the pointer or a screen reader until it is asked for.
 *
 * This is the third shape this file has had. It began as depth of field
 * (blur, scale, a ripple of sharpness), which the browser turned into a
 * smear; it was toned down to dim-and-step-back, then to flat wallpaper; and
 * each cut left the reader better. The second design pass
 * (`docs/READER_TWO_FACES_PHASE_A2.md`) finished the thought: continuity comes
 * from the room — the same page's still behind both faces — not from a copy
 * of the other face lingering behind this one. So the plane does one thing
 * now, and does it in opacity only.
 */

/** How far down the window the anchor sits, on both faces. */
export const anchorLine = 0.38;
export const anchorY = () => Math.round(window.innerHeight * anchorLine);

/** Seconds. One curve everywhere: the house ease from `MotionRoot`. */
export const timing = {
  press: 0.12,
  mark: 0.18,
  card: 0.28,
  /** The cross-dissolve between faces. */
  turn: 0.32,
  /** The room dissolving to the next page's still — `LectureBackdrop`'s number. */
  room: 1.1,
  /** The hairline that finds the same sentence on the other face. */
  found: 0.48,
} as const;

const INERT: Record<string, string> = { inert: '' };

interface PlaneProps {
  focused: boolean;
  /** Announced as the region's name while it is the one showing. */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * One face's layer. Showing, it is the page. Not showing, it is nothing:
 * transparent, `inert`, hidden from assistive tech, and no target for the
 * pointer.
 */
export function Plane({ focused, label, children, className }: PlaneProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      role="region"
      aria-label={label}
      aria-hidden={!focused || undefined}
      {...(!focused ? INERT : {})}
      initial={false}
      animate={{ opacity: focused ? 1 : 0 }}
      transition={{ duration: reduce ? 0.2 : timing.turn }}
      style={{ zIndex: focused ? 2 : 1 }}
      className={cn('absolute inset-0', !focused && 'pointer-events-none', className)}
    >
      {children}
    </motion.div>
  );
}

interface BlockProps {
  focused: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
  /** Kept for the callers that name their anchor block; changes nothing here. */
  anchor?: boolean;
  as?: 'div' | 'section';
  'data-page'?: number;
}

/** One piece of a face. The unit the anchor logic and the tests address. */
export function Block({ children, className, id, as = 'div', focused: _focused, anchor: _anchor, ...rest }: BlockProps) {
  const Tag = as;
  return (
    <Tag id={id} {...rest} className={className}>
      {children}
    </Tag>
  );
}
