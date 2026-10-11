/**
 * LunaHero — Luna, alive, at the size of a hero.
 *
 * `LunaAvatar` is the layered character for chips, lists and the Suit Locker:
 * her blink is a fixed SMIL loop and her eyes never move, which is right at
 * 36px and reads as a screensaver at 300. This is the same Luna — the same
 * helmet, face palette and the viewer's own suit and visor — drawn with live
 * eyes, for the one place she has room to be a character (Abi, 2026-10-11:
 * "only Luna's head, very big, blinking in the empty space, friendly, alive").
 *
 * Alive, concretely:
 *   - Her eyes follow the pointer anywhere on the page; the face and the eyes
 *     move further than the helmet, so the head reads as 3D, not a sticker.
 *   - She blinks on her own rhythm — irregular, now and then twice — and when
 *     you stop moving she looks around.
 *   - She is synced with the page through `attention`: listening (looks down at
 *     what you are typing into), typing (`nudge` nods once per keystroke), and
 *     `cheer` (a hop and happy eyes when you send something).
 *   - `sleepy` (late at night) droops the lids and lets her yawn.
 *   - Click or Enter: a wink, a hop and a few sparks.
 *
 * Reduced motion gets the same friendly face, still: no follow, no float, no
 * blink. Pure SVG + Motion; no data, no network — `loadout` is a prop.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react';
import { getLunaColors } from '../../../learnstation-luna/utils/colors';
import { DEFAULT_LOADOUT, itemById } from './catalog';
import { moodPhase } from './mood';
import type { Loadout } from './types';

const INK = '#4A3F6B';

export type LunaAttention = 'idle' | 'listening' | 'typing';

export interface LunaHeroProps {
  loadout?: Partial<Loadout>;
  /** Rendered width in px. */
  size?: number;
  /** The page's own light — her halo. Defaults to a soft white. */
  accent?: string | null;
  /** What the page is doing, so she can join in. */
  attention?: LunaAttention;
  /** Increments once per keystroke while typing — one small nod each. */
  nudge?: number;
  /** Increments when something is sent — a hop and happy eyes. */
  cheer?: number;
  /** Late at night: heavier lids, a yawn now and then. */
  sleepy?: boolean;
  className?: string;
}

type Burst = { id: number };

export function LunaHero({
  loadout,
  size = 280,
  accent,
  attention = 'idle',
  nudge = 0,
  cheer = 0,
  sleepy = false,
  className,
}: LunaHeroProps) {
  const reduce = useReducedMotion() ?? false;
  const uid = 'lh' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const lo = { ...DEFAULT_LOADOUT, ...loadout };
  const visor = itemById(lo.visor) ?? itemById(DEFAULT_LOADOUT.visor)!;
  const colors = useMemo(() => getLunaColors(moodPhase('bright')), []);
  const glow = accent ?? 'rgba(255,255,255,0.9)';

  const ref = useRef<HTMLButtonElement>(null);
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /* ── Gaze: -1..1 on each axis, sprung so the eyes ease rather than snap. ── */
  const gx = useMotionValue(0);
  const gy = useMotionValue(0);
  const sx = useSpring(gx, { stiffness: 140, damping: 16, mass: 0.6 });
  const sy = useSpring(gy, { stiffness: 140, damping: 16, mass: 0.6 });
  const looking = attention !== 'idle';

  useEffect(() => {
    if (reduce) return;
    let last = Date.now();
    let wander = 0;
    const onMove = (e: PointerEvent) => {
      last = Date.now();
      if (looking) return;
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height * 0.55);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 420);
      gx.set((dx / d) * k);
      gy.set((dy / d) * k);
    };
    // Left alone, she looks around — the difference between a picture and someone.
    const look = () => {
      if (!looking && Date.now() - last > 3200) {
        gx.set((Math.random() * 2 - 1) * 0.85);
        gy.set((Math.random() * 2 - 1) * 0.55);
      }
      wander = window.setTimeout(look, 1300 + Math.random() * 2000);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    wander = window.setTimeout(look, 2200);
    return () => {
      window.removeEventListener('pointermove', onMove);
      clearTimeout(wander);
    };
  }, [reduce, looking, gx, gy]);

  // Listening: she looks down at what you are writing.
  useEffect(() => {
    if (looking) {
      gx.set(0);
      gy.set(0.95);
    }
  }, [looking, gx, gy]);

  // Depth: helmet < face < eyes < pupils, so the head turns rather than slides.
  const helmetX = useTransform(sx, (v) => v * 1.4);
  const helmetY = useTransform(sy, (v) => v * 1);
  const faceX = useTransform(sx, (v) => v * 3.2);
  const faceY = useTransform(sy, (v) => v * 2.6);
  const eyesX = useTransform(sx, (v) => v * 1.4);
  const eyesY = useTransform(sy, (v) => v * 1.1);
  const pupilX = useTransform(sx, (v) => v * 2.4);
  const pupilY = useTransform(sy, (v) => v * 2.2);
  const tilt = useTransform(sx, (v) => v * 6);

  /* ── Bob: one nod per keystroke, a hop on cheer or click. ── */
  const bob = useMotionValue(0);
  useEffect(() => {
    if (reduce || nudge === 0) return;
    animate(bob, [0, 2.2, 0], { duration: 0.28, ease: 'easeOut' });
  }, [nudge, reduce, bob]);

  const [happy, setHappy] = useState(false);
  const [hover, setHover] = useState(false);
  const [wink, setWink] = useState(false);
  const [bursts, setBursts] = useState<Burst[]>([]);

  const hop = (height: number) => {
    if (!reduce) animate(bob, [0, -height, 0], { duration: 0.5, ease: [0.22, 1.4, 0.36, 1] });
  };
  const sparkle = () => {
    if (reduce) return;
    const id = Date.now() + Math.random();
    setBursts((b) => [...b, { id }]);
    later(() => setBursts((b) => b.filter((x) => x.id !== id)), 950);
  };

  useEffect(() => {
    if (cheer === 0) return;
    setHappy(true);
    hop(9);
    sparkle();
    later(() => setHappy(false), 1400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheer]);

  /* ── Blink: irregular, sometimes twice — never a metronome. ── */
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (reduce) return;
    let alive = true;
    let t = 0;
    const once = (then: () => void) => {
      setBlink(true);
      window.setTimeout(() => {
        if (!alive) return;
        setBlink(false);
        then();
      }, sleepy ? 240 : 120);
    };
    const loop = () => {
      t = window.setTimeout(() => {
        if (!alive) return;
        once(() => {
          if (Math.random() < 0.22) window.setTimeout(() => alive && once(loop), 150);
          else loop();
        });
      }, (sleepy ? 1800 : 2400) + Math.random() * (sleepy ? 2600 : 4000));
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [reduce, sleepy]);

  /* ── Yawn, late at night. ── */
  const [yawn, setYawn] = useState(false);
  useEffect(() => {
    if (!sleepy || reduce) return;
    const id = window.setInterval(() => {
      setYawn(true);
      window.setTimeout(() => setYawn(false), 1700);
    }, 11000 + Math.random() * 5000);
    return () => clearInterval(id);
  }, [sleepy, reduce]);

  const greet = () => {
    setWink(true);
    setHappy(true);
    hop(7);
    sparkle();
    later(() => setWink(false), 420);
    later(() => setHappy(false), 900);
  };

  const smiling = happy || hover;
  // Sleepy is a gentle droop, never a closed face — she is still glad you came.
  const open = yawn ? 0.3 : sleepy ? 0.78 : attention !== 'idle' ? 1.1 : 1;
  const mouth: 'smile' | 'grin' | 'o' | 'yawn' = yawn
    ? 'yawn'
    : smiling
      ? 'grin'
      : attention !== 'idle'
        ? 'o'
        : 'smile';

  const eye = (cx: number, winking: boolean) => (
    <g transform={`translate(${cx} 60)`}>
      <AnimatePresence initial={false} mode="wait">
        {smiling && !winking ? (
          <motion.path
            key="arc"
            d="M-6.5 2 Q0 -6.5 6.5 2"
            stroke={INK}
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          />
        ) : (
          <motion.g
            key="round"
            initial={false}
            animate={{ scaleY: blink || winking ? 0.08 : open }}
            transition={{ duration: blink || winking ? 0.06 : 0.14 }}
          >
            <circle r={7.2} fill="white" stroke={INK} strokeWidth="1.4" />
            <motion.g style={reduce ? undefined : { x: pupilX, y: pupilY }}>
              <circle r={3.6} fill="#3B3352" />
              <circle cx={-1.5} cy={-1.7} r={1.45} fill="white" />
              <circle cx={1.4} cy={1.3} r={0.6} fill="white" opacity="0.8" />
            </motion.g>
          </motion.g>
        )}
      </AnimatePresence>
    </g>
  );

  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label="Luna. Say hi."
      onClick={greet}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      className={className}
      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', position: 'relative', display: 'block' }}
      animate={reduce ? undefined : { y: [0, -7, 0] }}
      transition={reduce ? undefined : { duration: sleepy ? 6 : 4.5, repeat: Infinity, ease: 'easeInOut' }}
    >
      {/* Her halo: the page's own light, breathing with her. */}
      <motion.span
        aria-hidden
        style={{
          position: 'absolute',
          inset: '-22%',
          borderRadius: '9999px',
          background: `radial-gradient(closest-side, color-mix(in srgb, ${glow} 42%, transparent), transparent 70%)`,
          pointerEvents: 'none',
        }}
        animate={reduce ? undefined : { opacity: [0.75, 1, 0.75], scale: [0.98, 1.03, 0.98] }}
        transition={reduce ? undefined : { duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
      />

      <svg
        aria-hidden
        viewBox="28 6 104 104"
        width={size}
        height={size}
        style={{ overflow: 'visible', display: 'block', position: 'relative' }}
      >
        <defs>
          <radialGradient id={`${uid}-face`} cx="40%" cy="35%">
            <stop offset="0%" stopColor={colors.faceLight} />
            <stop offset="65%" stopColor={colors.faceMid} />
            <stop offset="100%" stopColor={colors.faceDark} />
          </radialGradient>
          <radialGradient id={`${uid}-glass`} cx="50%" cy="50%">
            <stop offset="62%" stopColor={visor.color} stopOpacity="0" />
            <stop offset="100%" stopColor={visor.color} stopOpacity="0.4" />
          </radialGradient>
          <clipPath id={`${uid}-helmet`}>
            <circle cx="80" cy="62" r="37" />
          </clipPath>
          <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="white" stopOpacity="0" />
            <stop offset="50%" stopColor="white" stopOpacity="0.22" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
        </defs>

        <motion.g style={reduce ? undefined : { y: bob, rotate: tilt, originX: '80px', originY: '62px' }}>
          {/* Helmet — moves least. */}
          <motion.g style={reduce ? undefined : { x: helmetX, y: helmetY }}>
            <circle cx="80" cy="62" r="38" fill={`url(#${uid}-glass)`} />
            <circle cx="80" cy="62" r="38" fill="none" stroke={visor.color} strokeWidth="3" opacity="0.95" />
          </motion.g>

          {/* Face — moves more. */}
          <motion.g style={reduce ? undefined : { x: faceX, y: faceY }}>
            <circle cx="80" cy="62" r="30" fill={`url(#${uid}-face)`} stroke={INK} strokeWidth="1.8" />
            <ellipse cx="64" cy="50" rx="4" ry="3" fill="#000" opacity={0.06 + colors.craterBaseOpacity} />
            <ellipse cx="94" cy="77" rx="3.5" ry="2.6" fill="#000" opacity={0.05 + colors.craterBaseOpacity} />

            {/* Eyes — move most. */}
            <motion.g style={reduce ? undefined : { x: eyesX, y: eyesY }}>
              {eye(70, wink)}
              {eye(90, false)}
            </motion.g>

            {/* Cheeks warm when she is pleased. */}
            <motion.circle cx="62" cy="68.5" r="3.8" fill="#E8A598" animate={{ opacity: smiling ? 0.85 : 0.45 }} />
            <motion.circle cx="98" cy="68.5" r="3.8" fill="#E8A598" animate={{ opacity: smiling ? 0.85 : 0.45 }} />

            <AnimatePresence initial={false} mode="wait">
              {mouth === 'smile' && (
                <motion.path
                  key="smile"
                  d="M73.5 70.5 Q80 77 86.5 70.5"
                  stroke={INK}
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                />
              )}
              {mouth === 'grin' && (
                <motion.g key="grin" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
                  <path d="M72 69 Q80 81 88 69 Z" fill="#7C2D12" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
                  <path d="M75.5 73.4 Q80 77 84.5 73.4" fill="#F472B6" />
                </motion.g>
              )}
              {mouth === 'o' && (
                <motion.ellipse key="o" cx="80" cy="72.5" rx="2.6" ry="3" fill="#7C2D12" stroke={INK} strokeWidth="1.2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} />
              )}
              {mouth === 'yawn' && (
                <motion.ellipse key="yawn" cx="80" cy="73" fill="#7C2D12" stroke={INK} strokeWidth="1.2" initial={{ rx: 2, ry: 1.5 }} animate={{ rx: 3.6, ry: 5 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }} />
              )}
            </AnimatePresence>
          </motion.g>

          {/* The glass catching light, now and then. */}
          {!reduce && (
            <g clipPath={`url(#${uid}-helmet)`}>
              <motion.rect
                x="20"
                y="10"
                width="22"
                height="110"
                fill={`url(#${uid}-sheen)`}
                transform="rotate(24 80 62)"
                initial={{ x: -10 }}
                animate={{ x: [-10, 120] }}
                transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 6, ease: 'easeInOut' }}
              />
            </g>
          )}
          <path d="M52 42 Q64 32 82 36" stroke="white" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity="0.45" />
        </motion.g>

        {/* Sparks on a hello or a cheer. */}
        {bursts.map((b) => (
          <g key={b.id}>
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i / 8) * Math.PI * 2 + 0.3;
              const r = 44 + (i % 2) * 8;
              return (
                <motion.circle
                  key={i}
                  cx={80}
                  cy={62}
                  r={i % 2 ? 1.6 : 2.4}
                  fill={i % 3 === 0 ? 'white' : glow}
                  initial={{ x: 0, y: 0, opacity: 1, scale: 0.4 }}
                  animate={{ x: Math.cos(a) * r, y: Math.sin(a) * r, opacity: 0, scale: 1 }}
                  transition={{ duration: 0.85, ease: 'easeOut' }}
                />
              );
            })}
          </g>
        ))}
      </svg>
    </motion.button>
  );
}

export default LunaHero;
