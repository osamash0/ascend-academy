import { useId } from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useTime,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { MAP_PALETTE } from '../SpaceMap';
import { toneFor } from './seed';

/**
 * A Space, drawn as a planet. Its Lessons are its moons.
 *
 * The night-sky redesign (Abi, 2026-10-26) replaced the hub's coloured cover
 * gradients and Ascent's hollow circles with one object used everywhere a
 * Space stands for itself. It follows the map's sentence — *progress is what
 * lights the map* — and the map's palette, read from `MAP_PALETTE` rather than
 * restated:
 *
 *   gold        — a Lesson you have finished. Earned light.
 *   white       — the one Lesson you are on now ("you are here").
 *   faint white — every Lesson still open. Darkness is the content.
 *
 * **Show, don't count.** No number is drawn. The screen-reader label carries
 * the counts instead ("Datenbanksysteme. 3 of 10 Lessons done."), so the
 * information is not lost — it is simply not printed over the picture.
 *
 * The only gradient is the soft halo behind a body you have made progress in;
 * its strength is the progress. Nothing else glows.
 */

/** Never more moons than this. A Space past it draws its progress proportionally. */
export const MAX_MOONS = 24;

/** One full drift of the moons, in ms. Slow enough to notice only when looking. */
const DRIFT_PERIOD_MS = 180_000;

/** Orbit shape, as fractions of the body radius. */
const ORBIT_RX = 1.55;
const ORBIT_RY = 0.48;

/** The layout box, as multiples of the body radius. The halo may spill past it. */
const BOX_W = 3.5;
const BOX_H = 2.2;

/**
 * Body diameter for a Space with this many Lessons — a square-root scale, so a
 * Space with four times the Lessons reads twice as wide, not four times.
 * Capped at the fold: past it every Space is "a lot".
 */
export const planetSize = (lessonCount: number, min: number, max: number): number => {
  const n = Math.max(0, Math.min(lessonCount, MAX_MOONS));
  return Math.round(min + (max - min) * Math.sqrt(n / MAX_MOONS));
};

/** The layout box a planet of this body size occupies, in px. */
export const planetBox = (size: number) => ({ width: (size / 2) * BOX_W, height: (size / 2) * BOX_H });

export type MoonState = 'done' | 'current' | 'open';

/**
 * Which moon is which. Pure, so the fold and the "you are here" rule are
 * checkable without rendering.
 */
export const moonStates = (lessonCount: number, lessonsDone: number, current: boolean): MoonState[] => {
  const total = Math.max(0, lessonCount);
  if (total === 0) return [];
  const done = Math.max(0, Math.min(lessonsDone, total));
  const n = Math.min(total, MAX_MOONS);
  let lit = total > MAX_MOONS ? Math.round((done / total) * n) : done;
  // Unfinished never rounds up to finished, and any progress shows as some light.
  if (done < total) lit = Math.min(lit, n - 1);
  if (done > 0) lit = Math.max(lit, 1);
  const here = current && done < total ? lit : -1;
  return Array.from({ length: n }, (_, i) => (i < lit ? 'done' : i === here ? 'current' : 'open'));
};

interface PlanetProps {
  /** Body diameter in px. */
  size: number;
  lessonCount: number;
  lessonsDone: number;
  /** Mark the next open Lesson as the white "you are here" moon. */
  current?: boolean;
  /** 0–1: progress. Drives the halo; 0 draws none. */
  glow: number;
  /** Space id — picks the body tone, stably. */
  seed: string;
  /**
   * The accessible name. With it the planet is `role="img"`; without it the
   * planet is decoration and hidden, because the control around it is named.
   */
  label?: string;
  /** Centre, when drawn inside another SVG (Ascent). */
  cx?: number;
  cy?: number;
  /** Let the moons drift. Off for small, many-at-once planets (the rail cards). */
  drift?: boolean;
  className?: string;
}

export function Planet({
  size,
  lessonCount,
  lessonsDone,
  current,
  glow,
  seed,
  label,
  cx,
  cy,
  drift = true,
  className,
}: PlanetProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const reduce = useReducedMotion();
  const r = size / 2;
  const { width: W, height: H } = planetBox(size);
  const ox = W / 2;
  const oy = H / 2;
  const rx = r * ORBIT_RX;
  const ry = r * ORBIT_RY;
  const moonR = Math.max(1.4, Math.min(r * 0.07, 6));
  const states = moonStates(lessonCount, lessonsDone, !!current);
  const g = Math.max(0, Math.min(1, glow));

  /*
   * The drift is a phase offset fed to every moon as a motion value, so the
   * moons move along the ellipse without a React render per frame. Under
   * reduced motion the phase is a still zero — checked here, not left to
   * `MotionConfig`, which only governs Motion's own animations.
   */
  const time = useTime();
  const drifting = useTransform(time, (t) => (t / DRIFT_PERIOD_MS) * Math.PI * 2);
  const still = useMotionValue(0);
  const phase = reduce || !drift ? still : drifting;

  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  const inSvg = cx !== undefined && cy !== undefined;

  return (
    <svg
      {...a11y}
      data-planet={seed}
      data-glow={g.toFixed(2)}
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      x={inSvg ? cx - ox : undefined}
      y={inSvg ? cy - oy : undefined}
      overflow="visible"
      className={className}
    >
      <defs>
        <radialGradient id={`halo-${uid}`}>
          <stop offset="0%" stopColor={MAP_PALETTE.goldEdge} stopOpacity="0.42" />
          <stop offset="45%" stopColor={MAP_PALETTE.goldCore} stopOpacity="0.12" />
          <stop offset="100%" stopColor={MAP_PALETTE.goldCore} stopOpacity="0" />
        </radialGradient>
        <clipPath id={`body-${uid}`}>
          <circle cx={ox} cy={oy} r={r} />
        </clipPath>
      </defs>

      {g > 0 && (
        <circle data-halo cx={ox} cy={oy} r={r * 1.6} fill={`url(#halo-${uid})`} opacity={0.25 + 0.75 * g} />
      )}

      {/* The far half of the orbit, behind the body. */}
      {states.length > 0 && (
        <path
          d={`M${ox - rx},${oy} A${rx},${ry} 0 0 1 ${ox + rx},${oy}`}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.1}
          strokeWidth={1}
        />
      )}

      {/* The body: a disc, a soft lit side, a shadowed side. Flat fills, no gradient. */}
      <circle cx={ox} cy={oy} r={r} fill={toneFor(seed)} />
      <g clipPath={`url(#body-${uid})`}>
        <circle cx={ox - r * 0.38} cy={oy - r * 0.42} r={r * 0.78} fill="#ffffff" fillOpacity={0.06} />
        <circle cx={ox + r * 0.42} cy={oy + r * 0.4} r={r * 1.02} fill="#000000" fillOpacity={0.28} />
      </g>
      <circle cx={ox} cy={oy} r={r} fill="none" stroke="#ffffff" strokeOpacity={0.1} strokeWidth={1} />

      {/* The near half, in front of it. */}
      {states.length > 0 && (
        <path
          d={`M${ox + rx},${oy} A${rx},${ry} 0 0 1 ${ox - rx},${oy}`}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.14}
          strokeWidth={1}
        />
      )}

      {states.map((state, i) => (
        <Moon
          key={i}
          state={state}
          // Start at the front and go round: the first Lessons sit nearest you.
          angle={Math.PI / 2 + (i / states.length) * Math.PI * 2}
          ox={ox}
          oy={oy}
          rx={rx}
          ry={ry}
          bodyR={r}
          moonR={moonR}
          phase={phase}
        />
      ))}
    </svg>
  );
}

const MOON_FILL: Record<MoonState, { fill: string; opacity: number }> = {
  done: { fill: MAP_PALETTE.goldCore, opacity: 1 },
  current: { fill: MAP_PALETTE.hereRim, opacity: 1 },
  open: { fill: MAP_PALETTE.hereRim, opacity: 0.18 },
};

function Moon({
  state,
  angle,
  ox,
  oy,
  rx,
  ry,
  bodyR,
  moonR,
  phase,
}: {
  state: MoonState;
  angle: number;
  ox: number;
  oy: number;
  rx: number;
  ry: number;
  bodyR: number;
  moonR: number;
  phase: MotionValue<number>;
}) {
  const x = useTransform(phase, (p) => ox + rx * Math.cos(angle + p));
  const y = useTransform(phase, (p) => oy + ry * Math.sin(angle + p));
  // Behind the body (far half, inside its silhouette) a moon is hidden.
  const shown = useTransform(phase, (p) =>
    Math.sin(angle + p) < 0 && Math.abs(rx * Math.cos(angle + p)) < bodyR * 0.95 ? 0 : 1,
  );
  const { fill, opacity } = MOON_FILL[state];
  return (
    <motion.g style={{ opacity: shown }}>
      {state === 'current' && (
        <motion.circle cx={x} cy={y} r={moonR * 2.4} fill={MAP_PALETTE.hereRim} fillOpacity={0.12} />
      )}
      <motion.circle data-moon={state} cx={x} cy={y} r={moonR} fill={fill} fillOpacity={opacity} />
    </motion.g>
  );
}
