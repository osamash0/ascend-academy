import { motion, stagger } from 'motion/react';
import { cn } from '@/lib/utils';

/**
 * Content arriving: a small drift up, and a fade.
 *
 * Parent/child variants rather than a delay per item. The parent declares the
 * rhythm once and Motion propagates `show` down, so adding a row does not mean
 * computing another delay — and removing one does not leave a hole in the
 * sequence.
 *
 * **0.04s between children, and nothing longer than ~0.3s in total.** Eight
 * rows is 0.32s to the last one, which is the ceiling. Past that the stagger
 * stops reading as life and starts reading as the page being slow: the reader
 * is waiting for the eighth item, not enjoying the first.
 *
 * 12px of drift, not 40. The eye should register that something arrived, not
 * watch it travel.
 */

export const railVariants = {
  hidden: {},
  show: { transition: { delayChildren: stagger(0.04) } },
};

export const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

/**
 * A staggered group.
 *
 * `whileInView` with `viewport={{ once: true }}` for anything below the fold —
 * "once" is load-bearing. Without it the rail replays every time it scrolls
 * back into view, which turns a nice first impression into a page that will
 * not sit still.
 *
 * Above the fold, `animate` runs it immediately: waiting for an intersection
 * that already happened would just delay the first thing you see.
 */
export function EnterGroup({
  /**
   * True for rails below the fold — plays once, when scrolled to.
   *
   * Named `whenVisible` rather than `onScroll`, which is a DOM handler on
   * every div and would have been silently overwritten by the spread below.
   */
  whenVisible = false,
  className,
  children,
  ...rest
}: React.ComponentProps<typeof motion.div> & { whenVisible?: boolean }) {
  return (
    <motion.div
      variants={railVariants}
      initial="hidden"
      {...(whenVisible
        ? { whileInView: 'show', viewport: { once: true, margin: '-40px' } }
        : { animate: 'show' })}
      className={cn(className)}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** One child of an `EnterGroup`. Inherits the parent's timing. */
export function EnterItem({
  className,
  children,
  ...rest
}: React.ComponentProps<typeof motion.div>) {
  return (
    <motion.div variants={itemVariants} className={cn(className)} {...rest}>
      {children}
    </motion.div>
  );
}

/**
 * The same rhythm for a real list.
 *
 * `motion.ul` / `motion.li` rather than reusing the div pair, because a
 * staggered list must still be a list: swapping the elements for divs would
 * animate nicely and stop a screen reader announcing "list, 6 items".
 * Semantics are not the thing to trade for a fade.
 */
export function EnterList({
  whenVisible = false,
  className,
  children,
  ...rest
}: React.ComponentProps<typeof motion.ul> & { whenVisible?: boolean }) {
  return (
    <motion.ul
      variants={railVariants}
      initial="hidden"
      {...(whenVisible
        ? { whileInView: 'show', viewport: { once: true, margin: '-40px' } }
        : { animate: 'show' })}
      className={cn(className)}
      {...rest}
    >
      {children}
    </motion.ul>
  );
}

export function EnterListItem({
  className,
  children,
  ...rest
}: React.ComponentProps<typeof motion.li>) {
  return (
    <motion.li variants={itemVariants} className={cn(className)} {...rest}>
      {children}
    </motion.li>
  );
}
