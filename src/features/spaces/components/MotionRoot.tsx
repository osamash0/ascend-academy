import { MotionConfig } from 'motion/react';
import { Outlet } from 'react-router-dom';

/**
 * The one `MotionConfig` for the whole v4 namespace.
 *
 * Everything below inherits `duration: 0.18` and this easing, so a component
 * only writes a `transition` when it is deliberately different — the 0.7s
 * background cross-fade, and nothing else so far.
 *
 * **Once, and scoped.** It used to be mounted twice — `Scene` carried one for
 * Learn screens and `StudioShell` a second for Studio — which is two places to
 * change a default and two chances for them to disagree. It is a layout route
 * now, so every v4 screen sits under exactly one.
 *
 * Scoped to v4 rather than wrapped around the app because 99 files outside
 * this namespace import `framer-motion` and belong to the old product. A
 * global default would silently retime all of them.
 *
 * `reducedMotion="user"` covers `prefers-reduced-motion` for every Motion
 * component beneath it — no media queries by hand. What it does *not* cover is
 * CSS: a Tailwind `hover:scale-*` is a plain transform and sails straight
 * past, which is why hover is Motion's job here rather than the stylesheet's.
 */

export const MOTION_DURATION = 0.18;
/** Fast out, settle in. The house curve for everything foreground. */
export const MOTION_EASE = [0.2, 0, 0, 1] as const;

export function MotionRoot() {
  return (
    <MotionConfig
      transition={{ duration: MOTION_DURATION, ease: MOTION_EASE }}
      reducedMotion="user"
    >
      <Outlet />
    </MotionConfig>
  );
}
