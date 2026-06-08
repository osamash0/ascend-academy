import { useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { FeedbackWidget } from '@/components/FeedbackWidget';
import { ConsoleTopBar } from './ConsoleTopBar';
import { ConsoleBoot } from './ConsoleBoot';

interface ConsoleLayoutProps {
  children: ReactNode;
}

/**
 * Left-to-right order of the top-bar tabs. Switching to a tab further right
 * slides the new screen in from the right (and vice-versa), mirroring the PS5
 * home tab transition. Course-scoped library deep-links sit with the library.
 */
const TAB_ORDER = [
  '/dashboard', '/library', '/course-v3', '/course', '/achievements', '/leaderboard', '/insights',
  '/professor/dashboard', '/professor/courses', '/professor/archive', '/professor/analytics', '/professor/upload'
];

const tabIndex = (pathname: string) => {
  const i = TAB_ORDER.findIndex((p) => pathname.startsWith(p));
  return i === -1 ? 0 : i;
};

// `dir` is +1 when navigating rightward across tabs, -1 leftward, 0 within.
// Exit is a short, deterministic tween (mode="wait" blocks the entrance until
// it settles); the entrance springs in for the snappy PS5 feel.
const variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 72, scale: 0.985 }),
  center: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      x: { type: 'spring', stiffness: 320, damping: 34 },
      opacity: { duration: 0.28, ease: 'easeOut' },
      scale: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
    },
  },
  exit: (dir: number) => ({
    opacity: 0,
    x: dir * -72,
    scale: 0.985,
    transition: { duration: 0.18, ease: 'easeIn' },
  }),
};

/**
 * Full-bleed console "OS" shell: a persistent top-bar nav over a deep base,
 * with PS5-style directional screen transitions between tabs.
 */
export function ConsoleLayout({ children }: ConsoleLayoutProps) {
  const location = useLocation();
  const reduceMotion = useReducedMotion();

  // Direction of travel, derived from the tab order vs. the previous screen.
  const prevIndex = useRef(tabIndex(location.pathname));
  const current = tabIndex(location.pathname);
  const dir = reduceMotion ? 0 : Math.sign(current - prevIndex.current);
  prevIndex.current = current;

  // Key the screen transition by TAB, not the full pathname. The PS5-style
  // slide is meant to play between tabs; keying on the raw pathname made every
  // intra-tab navigation (e.g. /professor/analytics → /professor/analytics/:id)
  // remount the whole screen — re-fetching data, resetting scroll, and
  // replaying the fade/scale. Sub-routes of one tab now update in place, so a
  // page can run its own smooth in-screen drill-down.
  const tabKey = TAB_ORDER.find((p) => location.pathname.startsWith(p)) ?? location.pathname;

  return (
    <div className="console-bg relative min-h-screen flex flex-col text-foreground selection:bg-primary/20">
      <ConsoleBoot />
      <ConsoleTopBar />
      <AnimatePresence mode="wait" custom={dir} initial={false}>
        <motion.main
          key={tabKey}
          custom={dir}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          className="flex-1 relative"
        >
          {children}
        </motion.main>
      </AnimatePresence>
      <FeedbackWidget />
    </div>
  );
}
