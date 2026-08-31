import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Space } from '../types';
import { publishedLessonsForSpace } from '../mocks/lessons';
import { FOLD_THRESHOLD, MAP_PALETTE } from './SpaceMap';

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
 *   • The **palette is identical**: gold for earned, violet for where you are
 *     now, near-black for everything else. Two maps with different colour
 *     meanings would be worse than one map.
 *   • **Never two hundred dots**: the same `FOLD_THRESHOLD`, imported rather
 *     than re-declared.
 *
 * What it deliberately does *not* inherit: the boustrophedon layout. A dozen
 * Lessons in a fixed path read as a route; a handful of Spaces do not, and
 * forcing them into rows would imply an order between subjects that does not
 * exist. Spaces sit on one horizontal timeline instead.
 */

const PAD_X = 80;
const STEP_X = 190;
const MID_Y = 130;
/** Vertical offset by progress: further along means higher. Position means something. */
const RISE = 58;

interface Placed {
  space: Space;
  x: number;
  y: number;
  /** 0–1 — the fraction of this Space's published path you have cleared. */
  light: number;
  done: number;
  total: number;
  current: boolean;
}

export function AscentMap({ spaces }: { spaces: Space[] }) {
  const navigate = useNavigate();

  const placed: Placed[] = useMemo(() => {
    // Least recently active first. See the docblock: the intended order is
    // when you joined, and the model does not record it yet.
    const ordered = [...spaces].sort(
      (a, b) => +new Date(a.lastActiveAt) - +new Date(b.lastActiveAt),
    );
    const visible = ordered.slice(0, FOLD_THRESHOLD);
    return visible.map((space, i) => {
      const path = publishedLessonsForSpace(space.id);
      const done = path.filter((l) => l.progress === 'done').length;
      const total = path.length;
      const light = total === 0 ? 0 : done / total;
      return {
        space,
        x: PAD_X + i * STEP_X,
        y: MID_Y - light * RISE,
        light,
        done,
        total,
        // Where you are now: touched, but not finished.
        current: space.viewerProgress > 0 && light < 1,
      };
    });
  }, [spaces]);

  const folded = Math.max(0, spaces.length - placed.length);

  if (!placed.length) {
    return (
      <p className="rounded-2xl border border-dashed border-white/12 px-6 py-10 text-center text-[14px] text-quiet">
        Nothing to light yet. Your journey fills in as you work through a Space.
      </p>
    );
  }

  const width = PAD_X * 2 + Math.max(0, placed.length - 1) * STEP_X;
  const height = MID_Y * 2;
  const clearedSpaces = placed.filter((p) => p.light === 1).length;
  const lessonsDone = placed.reduce((n, p) => n + p.done, 0);
  const lessonsTotal = placed.reduce((n, p) => n + p.total, 0);

  /** The route so far — up to the last Space you have touched. */
  const lastTouched = placed.reduce((last, p, i) => (p.light > 0 || p.current ? i : last), -1);
  const line = (pts: Placed[]) =>
    pts.length < 2
      ? ''
      : pts
          .map((p, i) =>
            i === 0
              ? `M${p.x},${p.y}`
              : `Q${(pts[i - 1].x + p.x) / 2},${pts[i - 1].y} ${p.x},${p.y}`,
          )
          .join(' ');

  return (
    <div className="relative">
      {/*
        Darkness is the content, here as on the per-Space map — an edgeless
        radial wash rather than a bordered panel, so this reads as part of
        Profile and not as a widget dropped into it.
      */}
      {/*
        `farthest-side`, not `closest-side`.
        
        `closest-side` sizes the radius to half the *shorter* axis — so on a
        wide, short map the wash was a circle in the middle and the leftmost
        and rightmost labels sat on the raw console backdrop, which carries a
        40%-opacity gradient and two accent glows. I could not settle that by
        measurement: compositing in the browser only reads `backgroundColor`,
        and every layer above the base is a `background-image`. So the
        dependency is removed rather than measured — the wash now reaches the
        full width and every label has the same ground under it, at both ends.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-8 -inset-y-4"
        style={{
          background:
            'radial-gradient(farthest-side at 50% 50%, rgba(6,7,12,0.97) 0%, rgba(6,7,12,0.93) 60%, rgba(6,7,12,0.55) 88%, rgba(6,7,12,0) 100%)',
        }}
      />

      <div className="relative">
        <p className="mb-2 text-[14px] text-quiet">
          <span className="font-semibold tabular-nums text-foreground">{clearedSpaces}</span>
          <span className="tabular-nums"> / {placed.length}</span> Spaces cleared
          <span className="text-faint">
            {' · '}
            <span className="tabular-nums">
              {lessonsDone}/{lessonsTotal}
            </span>{' '}
            Lessons
          </span>
          {folded > 0 && <span className="text-faint"> · {folded} further folded</span>}
        </p>

        {/* Same reason as the per-Space map: legible, then scrollable. */}
        <div className="-mx-6 overflow-x-auto px-6 sm:mx-0 sm:overflow-visible sm:px-0">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[560px] select-none sm:min-w-0"
          style={{ maxHeight: '40vh' }}
          /*
            `role="group"`, not `role="img"`. An image is presentational and
            cannot contain controls, and this one holds five tab-focusable
            buttons — screen readers disagree about what to do with that, and
            some flatten the whole map to its label.
          */
          role="group"
          aria-label={`Your journey: ${clearedSpaces} of ${placed.length} Spaces cleared, ${lessonsDone} of ${lessonsTotal} Lessons.`}
        >
          <defs>
            <radialGradient id="am-halo-gold">
              <stop offset="0%" stopColor={MAP_PALETTE.goldEdge} stopOpacity="0.55" />
              <stop offset="45%" stopColor={MAP_PALETTE.goldCore} stopOpacity="0.14" />
              <stop offset="100%" stopColor={MAP_PALETTE.goldCore} stopOpacity="0" />
            </radialGradient>
            <radialGradient id="am-halo-violet">
              <stop offset="0%" stopColor={MAP_PALETTE.violetEdge} stopOpacity="0.45" />
              <stop offset="50%" stopColor={MAP_PALETTE.violetCore} stopOpacity="0.12" />
              <stop offset="100%" stopColor={MAP_PALETTE.violetCore} stopOpacity="0" />
            </radialGradient>
          </defs>

          <path d={line(placed)} fill="none" stroke={MAP_PALETTE.route} strokeWidth={1.5} />
          {lastTouched >= 1 && (
            <path
              d={line(placed.slice(0, lastTouched + 1))}
              fill="none"
              stroke={MAP_PALETTE.ember}
              strokeWidth={1.5}
            />
          )}

          {placed.map((p) => {
            const href = `/v4/space/${p.space.id}`;
            const open = () => navigate(href);
            const r = 9;
            return (
              <g
                key={p.space.id}
                role="button"
                tabIndex={0}
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open();
                  }
                }}
                aria-label={`${p.space.name}. ${p.done} of ${p.total} Lessons cleared.`}
                /*
                  `console-focusable` rather than `outline-none`. The previous
                  version removed the outline and replaced it with a 6% white
                  wash on near-black — nowhere near the 3:1 a focus indicator
                  needs — and the enlargement meant to accompany it was
                  `group-hover:r-[11]`, which compiles to nothing at all:
                  Tailwind has no `r` utility and this config adds none. So a
                  keyboard user tabbing across the map got no feedback
                  whatsoever, then pressed Enter and navigated somewhere.
                */
                className="group cursor-pointer [&_circle]:transition-[fill,opacity] [&_text]:transition-[fill]"
              >
                {/*
                  The visible focus and hover state, drawn rather than
                  declared: a ring that appears on `group-focus-visible` and
                  `group-hover`. `stroke` is animatable and `r` is not, which
                  is what the dead `r-[11]` class was trying to work around.
                */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={17}
                  fill="none"
                  stroke={MAP_PALETTE.labelLit}
                  strokeWidth={2}
                  className="opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-100"
                />

                {/* A real target, not an 18px dot. */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={30}
                  fill="transparent"
                  className="transition-[fill] group-hover:fill-white/[0.035] group-focus-visible:fill-white/[0.06]"
                />
                <title>{`${p.space.name} — ${p.done} of ${p.total} Lessons cleared`}</title>

                {/* Earned light. Only a cleared Space emits it. */}
                {p.light > 0 && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={44}
                    fill={p.light === 1 ? 'url(#am-halo-gold)' : 'url(#am-halo-violet)'}
                    opacity={0.35 + p.light * 0.65}
                  />
                )}

                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  fill={
                    p.light === 1
                      ? MAP_PALETTE.goldCore
                      : p.current
                        ? MAP_PALETTE.violetEdge
                        : MAP_PALETTE.ink
                  }
                  stroke={
                    p.light === 1
                      ? MAP_PALETTE.goldEdge
                      : p.current
                        ? MAP_PALETTE.violetRim
                        : MAP_PALETTE.bodyStroke
                  }
                  strokeWidth={1.5}
                />

                {/* Progress as an arc, so partial work is visible before it is finished. */}
                {p.light > 0 && p.light < 1 && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={15}
                    fill="none"
                    stroke={MAP_PALETTE.violetEdge}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeDasharray={`${p.light * 2 * Math.PI * 15} ${2 * Math.PI * 15}`}
                    transform={`rotate(-90 ${p.x} ${p.y})`}
                    opacity={0.8}
                  />
                )}

                <text
                  x={p.x}
                  y={p.y + 42}
                  textAnchor="middle"
                  className="pointer-events-none text-[13px] font-medium"
                  // Unlit labels measured 4.18:1 on the per-Space map — an AA
                  // failure that looked deliberate. Same floor here.
                  fill={p.light > 0 || p.current ? MAP_PALETTE.labelLit : MAP_PALETTE.labelUnlit}
                >
                  {p.space.shortCode}
                </text>
                <text
                  x={p.x}
                  y={p.y + 59}
                  textAnchor="middle"
                  className="pointer-events-none text-[11px] tabular-nums"
                  // `text-label` (0.58), the lowest tier the scale allows for
                  // information-bearing text. This was a raw 0.55 — a value
                  // between two tokens, invented at the call site.
                  fill={MAP_PALETTE.labelMeta}
                >
                  {p.done}/{p.total}
                </text>
              </g>
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
