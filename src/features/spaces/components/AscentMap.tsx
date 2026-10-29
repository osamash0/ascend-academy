import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { Space } from '../types';
import { FOLD_THRESHOLD, MAP_PALETTE } from './SpaceMap';
import { publishedLessonsForSpace } from '../data/world';
import { useMediaQuery } from '../data/useMediaQuery';
import { SpaceWindow } from './sky/SpaceWindow';
import { StarField } from './sky/StarField';

/**
 * Ascent — the cross-Space journey.
 *
 * Doc 2's ten map rules were written for the per-Space map, and whether a
 * second map inherits them was an open question. Abi's call, 2026-08-31:
 * **it inherits them**, scaled one level up. So the two maps are the same
 * idea at different altitudes, and the same sentence governs both —
 * *progress is what lights the map*.
 *
 * What "one level up" means, rule by rule:
 *
 *   • A **body is a Space**, not a Lesson. Its light is the fraction of its
 *     path you have cleared, exactly as a Lesson's light is the fraction of
 *     its ideas.
 *   • **Position carries order**, and here the order is time. It sorts on
 *     `lastActiveAt`, which is the only time the model records — so the route
 *     reads most-dormant to most-recent, and it *reorders itself* when you open
 *     a Space.
 *
 *     This paragraph used to claim the order was "when you joined or created
 *     it… so the route reads as a history", which is the better rule and is
 *     currently unbuildable: `Space` carries no join or create date
 *     (`types.ts`). The code had silently substituted a different fact. Stated
 *     honestly here rather than described as something it is not.
 *     NEEDS-BACKEND: `joinedAt` on the Space, which `Membership` already has
 *     per person.
 *   • The **palette is identical**: gold for earned, white for where you are
 *     now, near-black for everything else. Two maps with different colour
 *     meanings would be worse than one map.
 *   • **Never two hundred dots**: the same `FOLD_THRESHOLD`, imported rather
 *     than re-declared.
 *
 * What it deliberately does *not* inherit: the boustrophedon layout. A dozen
 * Lessons in a fixed path read as a route; a handful of Spaces do not, and
 * forcing them into rows would imply an order between subjects that does not
 * exist. Spaces sit on one gentle arc instead.
 *
 * **A night sky** (Abi, 2026-10-26). The bodies were 9px hollow circles with
 * counters under them ("0/10", "0 / 2 Spaces cleared"), which said nothing
 * about space or distance. Each Space is now a round window onto its own
 * first page — calm black and white, ringed in gold as far as you have come,
 * with a white point where you are — on a faint star field, along a dashed
 * arc. (A planet stood here for a day; Abi wanted the Space's own files
 * instead.) **Show, don't count**: no number is drawn.
 * The counts live on in the accessible names (`ascent.label`, `ascent.node`),
 * so a screen reader still hears them. On a phone the arc stands up: windows
 * stacked, swaying left and right down a vertical curve.
 */

/** Horizontal arc (≥ sm). */
const PAD_X = 90;
/** The narrowest gap between two windows on the arc. */
const STEP_X = 170;
/**
 * The arc spans at least this many units. Two Spaces on a 350-unit arc,
 * drawn full-width, came out at twice their size; the arc stretches instead.
 */
const MIN_ARC_WIDTH = 820;
const BASE_Y = 150;
/** How far the middle of the arc rises above its ends. */
const ARC = 44;
const H_HEIGHT = 225;

/** Vertical curve (phones). */
const V_WIDTH = 340;
const PAD_Y = 80;
const STEP_Y = 150;
const SWAY = 72;

/** Every window the same size: the path's length is not a contest. */
const WINDOW = 76;

interface Placed {
  space: Space;
  x: number;
  y: number;
  size: number;
  /** 0–1 — the fraction of this Space's published path you have cleared. */
  light: number;
  done: number;
  total: number;
  current: boolean;
}

/** Long names are shortened on the picture only; the accessible name keeps them whole. */
const shortName = (name: string) => (name.length > 22 ? `${name.slice(0, 21).trimEnd()}…` : name);

/** A smooth path through the points: quadratic segments via midpoints. */
const curveThrough = (pts: { x: number; y: number }[]): string => {
  if (pts.length < 2) return '';
  const d = [`M${pts[0].x},${pts[0].y}`];
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d.push(`Q${pts[i].x},${pts[i].y} ${mx},${my}`);
  }
  const last = pts[pts.length - 1];
  d.push(`L${last.x},${last.y}`);
  return d.join(' ');
};

export function AscentMap({ spaces }: { spaces: Space[] }) {
  const { t } = useTranslation('v4Spaces');
  const navigate = useNavigate();
  const wide = useMediaQuery('(min-width: 640px)');

  const placed: Placed[] = useMemo(() => {
    // Least recently active first. See the docblock: the intended order is
    // when you joined, and the model does not record it yet.
    const ordered = [...spaces].sort(
      (a, b) => +new Date(a.lastActiveAt) - +new Date(b.lastActiveAt),
    );
    const visible = ordered.slice(0, FOLD_THRESHOLD);
    const n = visible.length;
    const span = Math.max(MIN_ARC_WIDTH, PAD_X * 2 + Math.max(0, n - 1) * STEP_X);
    const step = n < 2 ? 0 : (span - PAD_X * 2) / (n - 1);
    return visible.map((space, i) => {
      const path = publishedLessonsForSpace(space.id);
      const done = path.filter((l) => l.progress === 'done').length;
      const total = path.length;
      const light = total === 0 ? 0 : done / total;
      // Position along the arc, 0 → 1.
      const f = n < 2 ? 0.5 : i / (n - 1);
      return {
        space,
        ...(wide
          ? { x: n < 2 ? span / 2 : PAD_X + i * step, y: BASE_Y - 4 * ARC * f * (1 - f) }
          : { x: V_WIDTH / 2 + (i % 2 === 0 ? -SWAY : SWAY) * (n < 2 ? 0 : 1), y: PAD_Y + i * STEP_Y }),
        size: WINDOW,
        light,
        done,
        total,
        // Where you are now: touched, but not finished.
        current: space.viewerProgress > 0 && light < 1,
      };
    });
  }, [spaces, wide]);

  const folded = Math.max(0, spaces.length - placed.length);

  if (!placed.length) {
    return (
      <p className="rounded-2xl border border-dashed border-white/12 px-6 py-10 text-center text-[14px] text-quiet">
        {t('ascent.empty')}
      </p>
    );
  }

  const width = wide
    ? Math.max(MIN_ARC_WIDTH, PAD_X * 2 + Math.max(0, placed.length - 1) * STEP_X)
    : V_WIDTH;
  const height = wide ? H_HEIGHT : PAD_Y * 2 + Math.max(0, placed.length - 1) * STEP_Y;
  const clearedSpaces = placed.filter((p) => p.light === 1).length;
  const lessonsDone = placed.reduce((n, p) => n + p.done, 0);
  const lessonsTotal = placed.reduce((n, p) => n + p.total, 0);
  /** The most recent Space is last — and "here you are" only if you are mid-way through it. */
  const latest = placed[placed.length - 1];

  return (
    <div className="relative">
      {/* Atmosphere, not content: a faint, fixed sky behind the arc. */}
      <StarField seed="ascent" count={56} className="-inset-y-4" />

      <div className="relative">
        <p className="mb-3 text-[13px] text-label">
          {t('ascent.legend')}
          {folded > 0 && <span className="text-faint"> · {t('ascent.folded', { count: folded })}</span>}
        </p>

        {/* Same reason as the per-Space map: legible, then scrollable. */}
        <div className="-mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className={wide ? 'w-full min-w-[560px] select-none' : 'mx-auto w-full max-w-[420px] select-none'}
          style={wide ? { minWidth: placed.length * 130 } : undefined}
          overflow="visible"
          /*
            `role="group"`, not `role="img"`. An image is presentational and
            cannot contain controls, and this one holds tab-focusable buttons —
            screen readers disagree about what to do with that, and some
            flatten the whole map to its label.
          */
          role="group"
          aria-label={t('ascent.label', {
            cleared: clearedSpaces,
            total: placed.length,
            done: lessonsDone,
            lessons: lessonsTotal,
          })}
        >
          {/* The route: faint and dashed — a way through the dark, not a ruler. */}
          {placed.length > 1 && (
            <path
              d={
                wide
                  ? `M${placed[0].x},${BASE_Y} Q${(placed[0].x + latest.x) / 2},${BASE_Y - 2 * ARC} ${latest.x},${BASE_Y}`
                  : curveThrough(placed)
              }
              fill="none"
              stroke={MAP_PALETTE.route}
              strokeWidth={1.25}
              strokeDasharray="3 7"
              strokeLinecap="round"
            />
          )}

          {placed.map((p) => {
            const href = `/v4/space/${p.space.id}`;
            const open = () => navigate(href);
            const r = p.size / 2;
            const boxH = p.size;
            const lit = p.light > 0 || p.current;
            return (
              <motion.g
                key={p.space.id}
                role="button"
                tabIndex={0}
                initial="rest"
                animate="rest"
                whileHover="hover"
                whileFocus="focus"
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open();
                  }
                }}
                aria-label={t('ascent.node', { name: p.space.name, done: p.done, total: p.total })}
                /*
                  Not `outline-none`: that, with a 6% wash, was the old
                  failure — a keyboard user got no feedback at all. The visible
                  state is the drawn ring below, around the window.
                */
                className="group cursor-pointer [&_text]:transition-[fill]"
              >
                {/*
                  Motion, not `group-hover:opacity-*`. Opacity is the library's
                  to animate, and a CSS transition here would ignore
                  `prefers-reduced-motion`. The `<g>` above declares `hover` and
                  `focus` states and Motion propagates them to this child.
                */}
                <motion.circle
                  cx={p.x}
                  cy={p.y}
                  r={r + 9}
                  fill="none"
                  stroke={MAP_PALETTE.labelLit}
                  strokeWidth={1.5}
                  initial={false}
                  variants={{ rest: { opacity: 0 }, hover: { opacity: 0.5 }, focus: { opacity: 1 } }}
                />

                {/* A real target, larger than the window. */}
                <circle cx={p.x} cy={p.y} r={Math.max(r + 14, 34)} fill="transparent" />
                <title>{t('ascent.nodeTitle', { name: p.space.name, done: p.done, total: p.total })}</title>

                <SpaceWindow
                  spaceId={p.space.id}
                  cx={p.x}
                  cy={p.y}
                  size={p.size}
                  cover={p.space.cover}
                  progress={p.light}
                  current={p.current}
                />

                {p === latest && p.current && (
                  <text
                    x={p.x}
                    y={p.y - boxH / 2 - 10}
                    textAnchor="middle"
                    className="pointer-events-none text-[11px] font-medium"
                    fill={MAP_PALETTE.labelLit}
                  >
                    {t('ascent.here')}
                  </text>
                )}

                <text
                  x={p.x}
                  y={p.y + boxH / 2 + 16}
                  textAnchor="middle"
                  className="pointer-events-none text-[13px] font-medium"
                  // Unlit labels measured 4.18:1 on the per-Space map — an AA
                  // failure that looked deliberate. Same floor here.
                  fill={lit ? MAP_PALETTE.labelLit : MAP_PALETTE.labelUnlit}
                >
                  {shortName(p.space.name)}
                </text>
              </motion.g>
            );
          })}
        </svg>
        </div>
      </div>
    </div>
  );
}

/** Every Space the viewer is in — what Ascent draws. */
export const ascentSpaces = (spaces: Space[]): Space[] =>
  // `publishedLessonsForSpace`, matching what the body measures. Filtering on
  // *all* Lessons admitted a Space holding only drafts, which then drew as
  // `0/0` — permanently unlit, with no way to light it.
  spaces.filter((s) => s.viewerRole !== null && publishedLessonsForSpace(s.id).length > 0);
