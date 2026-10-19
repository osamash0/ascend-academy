import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useSpring } from 'motion/react';
import type { Mood } from '@/features/avatar/types';
import { cn } from '@/lib/utils';

const LunaAvatar = lazy(() =>
  import('@/features/avatar/LunaAvatar').then((m) => ({ default: m.LunaAvatar })),
);

/**
 * Luna shows you around (Abi, 2026-10-16: "impress me").
 *
 * The live page used to turn by itself while Luna stood beside it as
 * decoration. Now she is the reason it turns: she stands on the tab bar, hops
 * onto the next tab, and the page changes as she lands. She reacts to what is
 * on the page — squints at the dense page, follows the parts being explained,
 * waits for the answer, concentrates on the question — and cheers a right one.
 * She says one or two words per tab: the demo's only labels, where the eye is.
 * The moment the visitor touches anything she steps back and watches *them*.
 *
 * She stays Luna (face, helmet, eyes, moods from the avatar system); only
 * scale and motion change. Decoration only: aria-hidden, never focusable.
 */

export const GUIDE_VIEWS = ['page', 'explain', 'ask', 'practise'] as const;
export type GuideView = (typeof GUIDE_VIEWS)[number];
export type GuideReaction = { kind: 'right' | 'wrong' | 'poke'; n: number };

/** How long a reaction (a cheer, a head tilt) holds before her mood returns to the page. */
export const REACTION_MS = 1600;
/** One hop from tab to tab. LivePage lands the page change on her landing. */
export const HOP_MS = 620;

const VIEW_MOOD: Record<GuideView, Mood> = {
  page: 'thinking', // "hmm" — a page this dense makes anyone squint
  explain: 'curious',
  ask: 'bright',
  practise: 'focused',
};

/** Luna's face for a moment of the tour. Pure, so the choreography is testable. */
export function guideMood(view: GuideView, reaction: GuideReaction['kind'] | null): Mood {
  if (reaction === 'right' || reaction === 'poke') return 'celebrating';
  if (reaction === 'wrong') return 'curious'; // a head tilt, never sad
  return VIEW_MOOD[view];
}

type Gaze = { x: number; y: number };

/** Where her eyes rest on each page while she is showing it (-1..1; +y is down, toward the page). */
function viewGaze(view: GuideView, beat: number): Gaze {
  switch (view) {
    case 'page':
      return { x: 0.35, y: 0.9 };
    case 'explain': // from the parts on the left to the lit words on the right
      return { x: [-0.7, 0.75, -0.5, 0.8][beat % 4], y: 0.75 };
    case 'ask': // watches the question being typed, then the answer below it
      return { x: [-0.3, 0.3, 0][beat % 3], y: beat % 3 === 2 ? 0.95 : 0.55 };
    case 'practise':
      return { x: 0.1, y: 0.95 };
  }
}

const WIDTH = 76;

type Spark = { id: number; color: string };

export function LunaGuide({
  tabs,
  at,
  view,
  touched,
  arrived,
  reaction,
}: {
  /** The tab list she stands on. */
  tabs: RefObject<HTMLElement>;
  /** The tab she is standing on. */
  at: GuideView;
  /** What the page shows. */
  view: GuideView;
  /** The visitor has taken over. */
  touched: boolean;
  /** The page has come into view — she drops in once. */
  arrived: boolean;
  reaction: GuideReaction | null;
}) {
  const { t } = useTranslation('landing');
  const reduce = useReducedMotion() ?? false;
  const self = useRef<HTMLDivElement>(null);

  /* ── Where she stands: centred over the tab, re-measured when labels change width. ── */
  const [x, setX] = useState<number | null>(null);
  useLayoutEffect(() => {
    const list = tabs.current;
    if (!list) return;
    const measure = () => {
      const btns = list.querySelectorAll<HTMLElement>('[role="tab"]');
      const i = GUIDE_VIEWS.indexOf(at);
      const b = btns[i];
      if (b) setX(b.offsetLeft + b.offsetWidth / 2 - WIDTH / 2);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [tabs, at]);

  /* ── Hops: each change of tab is one arc with a soft landing. ── */
  const [hop, setHop] = useState(0);
  const [dir, setDir] = useState(0);
  const prevAt = useRef(at);
  useEffect(() => {
    if (prevAt.current === at) return;
    setDir(Math.sign(GUIDE_VIEWS.indexOf(at) - GUIDE_VIEWS.indexOf(prevAt.current)));
    prevAt.current = at;
    setHop((h) => h + 1);
  }, [at]);
  const [hopping, setHopping] = useState(false);
  useEffect(() => {
    if (!hop) return;
    setHopping(true);
    const id = window.setTimeout(() => setHopping(false), HOP_MS);
    return () => window.clearTimeout(id);
  }, [hop]);

  /* ── Reactions: a cheer or a tilt that holds, then lets go. ── */
  const [poke, setPoke] = useState<GuideReaction | null>(null);
  const live = poke && (!reaction || poke.n > reaction.n) ? poke : reaction;
  const [recent, setRecent] = useState<GuideReaction['kind'] | null>(null);
  useEffect(() => {
    if (!live) return;
    setRecent(live.kind);
    const id = window.setTimeout(() => setRecent(null), REACTION_MS);
    return () => window.clearTimeout(id);
  }, [live?.kind, live?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Sparks: on landing in the page, on a right answer, on a poke. ── */
  const [sparks, setSparks] = useState<Spark[]>([]);
  const burst = (color: string) => {
    if (reduce) return;
    const id = Date.now() + Math.random();
    setSparks((s) => [...s, { id, color }]);
    window.setTimeout(() => setSparks((s) => s.filter((p) => p.id !== id)), 900);
  };
  useEffect(() => {
    if (recent === 'right') burst('#10b981');
    if (recent === 'poke') burst('#ffffff');
  }, [recent, live?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Gaze: sprung, written straight to CSS variables (no re-render per frame). ── */
  const gx = useSpring(0, { stiffness: 120, damping: 15, mass: 0.6 });
  const gy = useSpring(0, { stiffness: 120, damping: 15, mass: 0.6 });
  useMotionValueEvent(gx, 'change', (v) => self.current?.style.setProperty('--luna-gx', v.toFixed(3)));
  useMotionValueEvent(gy, 'change', (v) => self.current?.style.setProperty('--luna-gy', v.toFixed(3)));

  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (reduce || touched) return;
    const id = window.setInterval(() => setBeat((b) => b + 1), view === 'explain' ? 1050 : 1400);
    return () => window.clearInterval(id);
  }, [view, touched, reduce]);

  // Showing the page: her eyes are on it. Hopping: on where she's going.
  useEffect(() => {
    if (reduce || touched) return;
    const g = hopping ? { x: dir * 0.9, y: 0.25 } : recent === 'right' || recent === 'poke' ? { x: 0, y: -0.3 } : viewGaze(view, beat);
    gx.set(g.x);
    gy.set(g.y);
  }, [view, beat, hopping, dir, recent, touched, reduce, gx, gy]);

  // Handed over: she watches the visitor — and drifts back to the page when they go quiet.
  useEffect(() => {
    if (reduce || !touched) return;
    let quiet = 0;
    const onMove = (e: PointerEvent) => {
      const r = self.current?.getBoundingClientRect();
      if (!r) return;
      window.clearTimeout(quiet);
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height * 0.35);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 360);
      gx.set((dx / d) * k);
      gy.set((dy / d) * k);
      quiet = window.setTimeout(() => {
        const g = viewGaze(view, 0);
        gx.set(g.x);
        gy.set(g.y);
      }, 2600);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.clearTimeout(quiet);
    };
  }, [touched, view, reduce, gx, gy]);

  const mood = guideMood(view, recent);

  return (
    <motion.div
      ref={self}
      aria-hidden
      data-testid="luna-guide"
      data-at={at}
      data-mood={mood}
      className="pointer-events-none absolute bottom-full left-0 z-10 origin-bottom max-sm:scale-[0.7]"
      style={{ width: WIDTH, translateY: 6 }}
      initial={false}
      animate={{ x: x ?? 0, opacity: x === null ? 0 : 1 }}
      transition={reduce ? { duration: 0 } : { x: { duration: HOP_MS / 1000, ease: [0.3, 0.7, 0.4, 1] }, opacity: { duration: 0.2 } }}
    >
      {/* The drop-in: once, when the page first comes into view. */}
      <motion.div
        initial={reduce ? false : { y: -260, opacity: 0 }}
        animate={arrived || reduce ? { y: 0, opacity: 1 } : { y: -260, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 170, damping: 15, mass: 0.9 }}
        onAnimationComplete={() => arrived && burst('rgba(255,255,255,0.85)')}
      >
        {/* Handover: a small step back the moment the visitor takes the page. */}
        <motion.div animate={touched && !reduce ? { scale: [1, 0.92, 1], x: [0, -6, 0] } : undefined} transition={{ duration: 0.5 }}>
          {/* One hop per tab change: arc up, squash on landing. */}
          <motion.div
            key={hop}
            className="origin-bottom"
            initial={false}
            animate={
              reduce || !hop
                ? undefined
                : { y: [0, -24, 0, 0], scaleY: [1, 1.05, 0.88, 1], scaleX: [1, 0.97, 1.08, 1] }
            }
            transition={{ duration: HOP_MS / 1000, times: [0, 0.45, 0.82, 1], ease: 'easeOut' }}
          >
            {/* Reactions: a cheer jumps, a wrong answer tilts the head. */}
            <motion.div
              className="pointer-events-auto cursor-pointer origin-bottom"
              onClick={() => setPoke({ kind: 'poke', n: Date.now() })}
              animate={
                reduce
                  ? undefined
                  : recent === 'right' || recent === 'poke'
                    ? { y: [0, -18, 0, -10, 0] }
                    : recent === 'wrong'
                      ? { rotate: [0, -9, -9, 0] }
                      : { y: 0, rotate: 0 }
              }
              transition={{ duration: recent === 'wrong' ? 1.1 : 0.9, ease: 'easeOut' }}
            >
              <Suspense fallback={<div style={{ width: WIDTH, height: (WIDTH * 188) / 160 }} />}>
                <LunaAvatar size={WIDTH} mood={mood} showBackdrop={false} animated={!reduce} title="" />
              </Suspense>
            </motion.div>
          </motion.div>
        </motion.div>
      </motion.div>

      {/* What she says: one or two words, the demo's only labels. */}
      <AnimatePresence mode="wait">
        {!hopping && (
          <motion.span
            key={at}
            data-testid="luna-says"
            // On the last tab she speaks to her left, so the bubble never leaves a phone screen.
            className={cn(
              'absolute top-[12%] whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-[12.5px] font-medium text-black shadow-[0_6px_20px_-8px_rgba(0,0,0,0.8)]',
              GUIDE_VIEWS.indexOf(at) === GUIDE_VIEWS.length - 1 ? 'right-[calc(100%-6px)] rounded-br-[4px]' : 'left-[calc(100%-6px)] rounded-bl-[4px]',
            )}
            initial={reduce ? false : { opacity: 0, scale: 0.85, x: -4 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 400, damping: 26, delay: 0.1 }}
          >
            {t(`story.luna.${at}`)}
          </motion.span>
        )}
      </AnimatePresence>

      {/* Stardust. */}
      <AnimatePresence>
        {sparks.map((s) => (
          <span key={s.id} className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            {Array.from({ length: 7 }, (_, i) => {
              const a = (Math.PI * (i + 0.5)) / 7; // a fan upward
              return (
                <motion.span
                  key={i}
                  className="absolute h-1.5 w-1.5 rounded-full"
                  style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }}
                  initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                  animate={{ x: -Math.cos(a) * 46, y: -Math.sin(a) * 38, opacity: 0, scale: 0.4 }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              );
            })}
          </span>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
