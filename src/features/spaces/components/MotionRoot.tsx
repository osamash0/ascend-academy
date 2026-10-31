import { useRef } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Outlet, useLocation } from 'react-router-dom';
import { LiveGate } from '../data/viewer';
import { isInPlace } from './inPlace';

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

/**
 * Which *screen* a path belongs to.
 *
 * A Space's tabs live at `/v4/space/:id`, `/v4/space/:id/map` and
 * `/v4/space/:id/members` but are one screen with three panels, so they share
 * a key and do not remount when you move between them.
 */
const screenKey = (pathname: string) =>
  pathname.replace(/^(\/v4\/space\/[^/]+)\/(map|members)$/, '$1');

export function MotionRoot() {
  const { pathname, state } = useLocation();
  /* A path reached with `IN_PLACE` answers to the key of the screen it came from, for as long as you stay on it. */
  const alias = useRef<{ path: string; key: string } | null>(null);
  const shown = useRef<string>('');
  const own = screenKey(pathname);
  if (isInPlace(state) && shown.current && shown.current !== own && alias.current?.path !== pathname)
    alias.current = { path: pathname, key: shown.current };
  const key = alias.current?.path === pathname ? alias.current.key : own;
  shown.current = key;
  return (
    <MotionConfig
      transition={{ duration: MOTION_DURATION, ease: MOTION_EASE }}
      reducedMotion="user"
    >
      {/*
        Route changes fade. `mode="wait"` so the outgoing screen finishes before
        the incoming one starts — overlapping two full pages mid-fade shows
        both at half opacity, which reads as a glitch rather than a transition.
        
        Opacity only, and 0.16s. No slide, and no cross-route shared element:
        `mode="wait"` unmounts the old screen before mounting the new, so a
        `layoutId` pair spanning the two could never coexist in a frame. The
        spec's own fallback — "if layoutId isn't feasible across the router,
        fade only" — is the one that applies.
        
        Keyed on the *screen*, not the raw pathname. A Space's tabs are routes
        (`/map`, `/members`), so keying on pathname would tear down and rebuild
        the whole Space to move between them — losing scroll position and
        killing the tab indicator's own `layoutId`, which needs the strip to
        stay mounted. Switching tab should feel like turning a page, not
        arriving somewhere.
      */}
      {/* Outside the keyed fade, so the viewer resolves once per visit, not per screen. */}
      <LiveGate>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={key}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <Outlet />
        </motion.div>
      </AnimatePresence>
      </LiveGate>
    </MotionConfig>
  );
}
