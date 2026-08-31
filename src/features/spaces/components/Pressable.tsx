import { motion } from 'motion/react';
import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * The interaction feel, in one place.
 *
 * Every card, tile and primary action nudges the same way: `whileHover` and
 * `whileFocus` lift it, `whileTap` presses it. A tight spring — no visible
 * bounce — because this is the one place the spec allows one.
 *
 * **Transform and opacity only.** Never width, height or margin: those are
 * layout properties, so animating them makes the browser re-lay-out the page
 * sixty times a second and drags every sibling along with it.
 *
 * `whileFocus` matters as much as `whileHover`. A keyboard user gets the same
 * feedback a mouse user does, and the white ring still comes from
 * `console-focusable` — Motion moves it, CSS outlines it.
 *
 * This replaces a `.lift` CSS class written an hour earlier, which in turn
 * replaced nineteen Tailwind `hover:scale-*` utilities. The utilities were a
 * real bug: `MotionConfig reducedMotion="user"` governs Motion and nothing
 * else, so a CSS transform sails past it and every one of them animated for
 * people who had asked the operating system for less motion. `.lift` fixed
 * that with a media query; this removes the CSS from the question entirely,
 * which is what the spec asks for and is one fewer mechanism to keep in sync.
 */

/** Tight, no visible bounce. The only spring in the namespace. */
export const PRESS_SPRING = { type: 'spring', stiffness: 400, damping: 30 } as const;

const PRESS = {
  whileHover: { scale: 1.04 },
  whileFocus: { scale: 1.04 },
  whileTap: { scale: 0.98 },
  transition: PRESS_SPRING,
} as const;

/** A subtler nudge for something already large — a full-width row or a hero. */
const PRESS_SUBTLE = {
  whileHover: { scale: 1.01 },
  whileFocus: { scale: 1.01 },
  whileTap: { scale: 0.99 },
  transition: PRESS_SPRING,
} as const;

type Props = React.ComponentProps<typeof motion.button> & {
  /** Large targets lift less, or the whole page appears to breathe. */
  subtle?: boolean;
};

export const Pressable = forwardRef<HTMLButtonElement, Props>(function Pressable(
  { subtle, className, children, disabled, ...rest },
  ref,
) {
  /*
   * A disabled control does not move. Browsers suppress pointer events on a
   * disabled button so `whileHover` would rarely fire anyway — but "rarely" is
   * not a guarantee, and a control that lifts under the cursor while refusing
   * to be pressed is telling two different stories.
   */
  const press = disabled ? {} : subtle ? PRESS_SUBTLE : PRESS;
  return (
    <motion.button ref={ref} disabled={disabled} {...press} className={className} {...rest}>
      {children}
    </motion.button>
  );
});

/*
 * Hoisted, deliberately. `motion.create(Link)` inside the component body would
 * mint a *new component type* on every render, so React would unmount and
 * remount the link each time — losing focus mid-interaction and restarting any
 * animation. The same class of mistake as the two-component-types-at-one-
 * position bug `Scene.test.tsx` exists to catch.
 */
const MotionLink = motion.create(Link);

/**
 * The same feel for a link, because navigation should not feel different.
 *
 * `LinkProps` and Motion's props both define `onDrag`, with incompatible
 * signatures — React's is a `DragEvent` handler, Motion's carries `PanInfo`.
 * The DOM drag handlers are dropped rather than cast away: nothing in this
 * namespace drags a link, and silencing the clash with `any` would hide the
 * next real one.
 */
type PressableLinkProps = Omit<
  React.ComponentProps<typeof Link>,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
> & { subtle?: boolean };

export function PressableLink({ to, subtle, className, children, ...rest }: PressableLinkProps) {
  return (
    <MotionLink to={to} {...(subtle ? PRESS_SUBTLE : PRESS)} className={cn(className)} {...rest}>
      {children}
    </MotionLink>
  );
}
