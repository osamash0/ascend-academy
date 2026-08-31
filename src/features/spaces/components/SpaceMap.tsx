import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Lesson, Space } from '../types';

/**
 * The map — a progress portrait you can act from.
 *
 * Built to `docs/design-v4/map-ui-vision.html`, which draws this screen and the
 * anatomy of a single body. Doc 2 §"The map (locked)" supplies the rules; the
 * vision file supplies the form. Both come from one sentence in Doc 1:
 * **"Progress is what lights the map."**
 *
 * The palette here is deliberately not the product's token set. This is the one
 * fully themed screen, and its colours mean something specific:
 *
 *   gold    — earned. A cleared Concept emits light; nothing else does.
 *   violet  — where you are now. Present, not yet earned.
 *   cyan    — contributions, orbiting. Density is the signal, not identity.
 *   near-black — everything you have not learned. This is the content.
 *
 * What makes this idea slop, per the vision file: "treating the cosmos as
 * texture — nebula gradients, ambient purple haze, twinkling, nodes scattered
 * wherever they look pretty." Hence: no gradient behind anything, and position
 * carries Lesson order.
 */

/**
 * Rule 8 — past this the route folds. Raising it is deliberate; a test guards
 * it.
 *
 * Exported so the guard can read the real value. It used to declare its own
 * `const FOLD_THRESHOLD = 20` and assert that against itself, which is a
 * tautology wearing a guard's clothes — worse than no guard, because the
 * comment above told the next person the number was protected.
 */
export const FOLD_THRESHOLD = 20;

/**
 * The map palette. One source, both maps.
 *
 * These six values were written out in `SpaceMap` and again in `AscentMap`,
 * whose own docblock says the palette "is identical" — and `maps.test.tsx`
 * asserted that *each file body contains* the hexes, so extracting them into a
 * shared constant would have turned the guard red. A guard that requires the
 * duplication it was written to prevent is worse than no guard: it makes the
 * fix look like a regression.
 *
 *   gold   — earned. A cleared body emits light; nothing else does.
 *   violet — where you are now. Present, not yet earned.
 *   ember  — the route you have already travelled.
 *   ink    — everything you have not learned. This is the content.
 */
export const MAP_PALETTE = {
  goldCore: '#ffcf7a',
  goldEdge: '#ffe9b8',
  violetCore: '#6c5ce7',
  violetEdge: '#8d7bff',
  violetRim: '#a898ff',
  ember: '#5b4a2e',
  ink: '#12151f',
  /** Labels. `lit` is full strength; `unlit` measured 4.18:1 once and must not. */
  labelLit: '#f2f3f7',
  labelUnlit: 'rgba(242,243,247,0.78)',
  /** `text-label` (0.58) — the lowest tier allowed for information. */
  labelMeta: 'rgba(242,243,247,0.58)',
  route: 'rgba(255,255,255,0.13)',
  bodyStroke: 'rgba(255,255,255,0.28)',
} as const;

const PER_ROW = 5;
const STEP_X = 176;
const ROW_H = 210;
const PAD_X = 96;
const PAD_Y = 96;
/** Vertical undulation, so the route reads as a trajectory and not a ruler. */
const WAVE = 26;

interface Placed {
  lesson: Lesson;
  x: number;
  y: number;
  cleared: number;
  total: number;
  touched: boolean;
  done: boolean;
}

function place(lessons: Lesson[]): Placed[] {
  return lessons.map((lesson, i) => {
    const row = Math.floor(i / PER_ROW);
    const inRow = i % PER_ROW;
    // Boustrophedon: consecutive Lessons are always adjacent, so the eye
    // follows a route rather than scanning a grid.
    const col = row % 2 === 0 ? inRow : PER_ROW - 1 - inRow;
    const cleared = lesson.concepts.filter((c) => c.progress === 'cleared').length;
    return {
      lesson,
      x: PAD_X + col * STEP_X,
      y: PAD_Y + row * ROW_H + Math.sin((i / PER_ROW) * Math.PI * 2 + row) * WAVE,
      cleared,
      total: lesson.concepts.length,
      touched: lesson.progress !== 'not-started',
      done: lesson.progress === 'done',
    };
  });
}

/**
 * Catmull-Rom through the bodies, emitted as cubic Béziers. A polyline would
 * make this a diagram; the curve is what makes it a journey.
 */
function curve(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  const d = [`M${pts[0].x},${pts[0].y}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d.push(
      `C${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ` +
        `${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ` +
        `${p2.x},${p2.y}`,
    );
  }
  return d.join(' ');
}

export function SpaceMap({ space, lessons }: { space: Space; lessons: Lesson[] }) {
  const navigate = useNavigate();
  const href = (l: Lesson) => `/v4/space/${space.id}/lesson/${l.id}`;
  const published = useMemo(
    () => lessons.filter((l) => l.state === 'published'),
    [lessons],
  );
  const visible = published.slice(0, FOLD_THRESHOLD);
  const folded = published.length - visible.length;
  const placed = useMemo(() => place(visible), [visible]);

  const rows = Math.ceil(placed.length / PER_ROW);
  const width = PAD_X * 2 + (PER_ROW - 1) * STEP_X;
  const height = PAD_Y * 2 + Math.max(0, rows - 1) * ROW_H + WAVE * 2;

  const clearedTotal = placed.reduce((n, p) => n + p.cleared, 0);
  const conceptTotal = placed.reduce((n, p) => n + p.total, 0);
  const doneCount = placed.filter((p) => p.done).length;

  // The route you have already travelled, drawn brighter over the full route.
  const lastTouched = placed.reduce((last, p, i) => (p.touched ? i : last), -1);

  if (!placed.length) {
    return (
      <p className="py-16 text-center text-[14.5px] text-quiet">
        Nothing to light yet — the map fills in as Lessons are published.
      </p>
    );
  }

  return (
    <div className="mt-6">
      {/*
       * No container. The map sits directly on the page like the path and the
       * member list do — it is the third tab of a Space, not a widget embedded
       * in one, and a bordered panel made it read as a separate thing.
       *
       * "Darkness is the content" still has to hold, so the ground under the
       * bodies is darkened by an edgeless radial wash. It has no border and no
       * hard edge to notice: the console texture simply falls away where the
       * map needs black, and returns where it does not.
       */}
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-8 -inset-y-4"
          style={{
            background:
              'radial-gradient(closest-side at 50% 45%, rgba(6,7,12,0.96) 0%, rgba(6,7,12,0.86) 55%, rgba(6,7,12,0) 100%)',
          }}
        />
        <div className="relative">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-[14px] text-quiet">
          <span className="font-semibold tabular-nums text-foreground">{doneCount}</span>
          <span className="tabular-nums"> / {placed.length}</span> Lessons cleared
          <span className="text-faint">
            {' · '}
            <span className="tabular-nums">
              {clearedTotal}/{conceptTotal}
            </span>{' '}
            ideas
          </span>
          {folded > 0 && <span className="text-faint"> · {folded} further folded</span>}
        </p>
      </div>

      {/*
        On a phone the map must not shrink to fit.
        A 896-unit viewBox rendered into 327px scales everything by 0.36, which
        turns a 13px label into 4.7px — the map still "fits" and is unreadable.
        Below `sm` it keeps a legible minimum width and scrolls sideways inside
        its own container, so the page never scrolls horizontally.
      */}
      <div className="-mx-6 overflow-x-auto px-6 sm:mx-0 sm:overflow-visible sm:px-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[790px] select-none sm:min-w-0"
        style={{ maxHeight: '70vh' }}
        role="img"
        aria-label={`Progress map for ${space.name}: ${doneCount} of ${placed.length} Lessons cleared, ${clearedTotal} of ${conceptTotal} ideas.`}
      >
        <defs>
          {/* Earned. The only warm light on the screen. */}
          <radialGradient id="lm-halo-gold">
            <stop offset="0%" stopColor={MAP_PALETTE.goldEdge} stopOpacity="0.55" />
            <stop offset="45%" stopColor={MAP_PALETTE.goldCore} stopOpacity="0.14" />
            <stop offset="100%" stopColor={MAP_PALETTE.goldCore} stopOpacity="0" />
          </radialGradient>
          {/* Where you are. Present, not yet earned. */}
          <radialGradient id="lm-halo-violet">
            <stop offset="0%" stopColor={MAP_PALETTE.violetEdge} stopOpacity="0.45" />
            <stop offset="50%" stopColor={MAP_PALETTE.violetCore} stopOpacity="0.12" />
            <stop offset="100%" stopColor={MAP_PALETTE.violetCore} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* The whole route, dim. */}
        <path d={curve(placed)} fill="none" stroke={MAP_PALETTE.route} strokeWidth={1.5} />
        {/* The part you have travelled, warm. */}
        {lastTouched >= 1 && (
          <path
            d={curve(placed.slice(0, lastTouched + 1))}
            fill="none"
            stroke={MAP_PALETTE.ember}
            strokeWidth={1.5}
          />
        )}

        {placed.map((p) => {
          const { lesson, x, y, cleared, total, touched, done } = p;
          const community = lesson.origin === 'community';
          const sats = Math.min(lesson.contributionCount, 3);
          const ringR = 19;
          const orbitR = 34;

          return (
            <g
              key={lesson.id}
              /*
               * A body opens its Lesson. This carried `role="button"`,
               * `tabIndex={0}` and a hover state with no handler of any kind —
               * focusable, announced as a button, and inert. Keyboard is wired
               * too: `role="button"` promises Enter and Space, and an SVG <g>
               * gives you neither for free.
               */
              onClick={() => navigate(href(lesson))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(href(lesson));
                }
              }}
              /*
                `transition-[r,opacity]` declared a transition for two
                properties nothing on this map ever changes — the leftover of a
                `group-hover:r-[11]` that never compiled, since Tailwind has no
                `r` utility. `r` is SVG geometry (a layout property) and opacity
                is Motion's; only `fill` is left, which is colour.
                
                `console-focusable` instead of `outline-none`: the ring it
                removed was the only focus indicator these bodies had, and
                `AscentMap` had the same pair fixed already.
              */
              className="group console-focusable cursor-pointer [&_text]:transition-[fill] [&_circle]:transition-[fill]"
              tabIndex={0}
              role="button"
              aria-label={`${lesson.title}. Lesson ${lesson.order}. ${cleared} of ${total} ideas cleared.`}
            >
              {/* Hover / focus target. Invisible until touched, then a soft
                  disc so the whole body reacts rather than just the 8px core —
                  tapping a body opens its Lesson, so it needs a real target. */}
              <circle
                cx={x}
                cy={y}
                r={44}
                fill="rgba(255,255,255,0)"
                className="transition-[fill] group-hover:fill-white/[0.035] group-focus-visible:fill-white/[0.06]"
              />
              <title>{`${lesson.title} — ${cleared} of ${total} ideas cleared`}</title>
              {/* Halo: only for bodies that have earned light, or hold it now. */}
              {done && <circle cx={x} cy={y} r={26} fill="url(#lm-halo-gold)" />}
              {touched && !done && <circle cx={x} cy={y} r={30} fill="url(#lm-halo-violet)" />}

              {/* Orbit — contributions circling the body. Faint, dashed, and
                  dimmer when the Lesson itself is dark. */}
              {sats > 0 && (
                <>
                  <ellipse
                    cx={x}
                    cy={y}
                    rx={orbitR}
                    ry={orbitR}
                    fill="none"
                    stroke={touched ? '#14343a' : '#11282d'}
                    strokeWidth={1}
                    strokeDasharray="2 5"
                  />
                  {Array.from({ length: sats }).map((_, si) => {
                    const a = (si / sats) * Math.PI * 2 + 0.7;
                    return (
                      <circle
                        key={si}
                        cx={x + Math.cos(a) * orbitR}
                        cy={y + Math.sin(a) * orbitR}
                        /* Never the same size as a Concept: density is the
                           signal, not identity. */
                        r={1.8}
                        fill={touched ? '#00d2d3' : '#1d6b6d'}
                      />
                    );
                  })}
                </>
              )}

              {/* The concept ring IS the gauge. Filled = cleared. */}
              {lesson.concepts.map((c, ci) => {
                const a = (ci / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
                const cx = x + Math.cos(a) * ringR;
                const cy = y + Math.sin(a) * ringR;
                const lit = c.progress === 'cleared';
                const seen = c.progress === 'discovered';
                return lit ? (
                  <circle key={c.id} cx={cx} cy={cy} r={2.4} fill={done ? '#ffd98a' : '#b3a8ff'}>
                    <title>{`${c.name} — cleared`}</title>
                  </circle>
                ) : (
                  <circle
                    key={c.id}
                    cx={cx}
                    cy={cy}
                    r={2.4}
                    fill="none"
                    stroke={
                      seen
                        ? '#8792ad'
                        : touched
                          ? 'rgba(255,255,255,0.30)'
                          : 'rgba(255,255,255,0.24)'
                    }
                  >
                    <title>{`${c.name} — ${seen ? 'read' : 'not started'}`}</title>
                  </circle>
                );
              })}

              {/* The body. Dark is the default; light is earned. */}
              {done ? (
                <circle cx={x} cy={y} r={8} fill="#fff3d6" />
              ) : touched ? (
                <>
                  <circle cx={x} cy={y} r={8.5} fill="none" stroke={MAP_PALETTE.violetEdge} strokeWidth={1.6} />
                  <circle cx={x} cy={y} r={3} fill={MAP_PALETTE.violetEdge} />
                </>
              ) : (
                <>
                  {/* Unlit, but not absent. An unlearned Lesson is a place you
                      have not been, not a hole in the picture — so it gets a
                      visible rim and a faint core. It still emits no light:
                      no halo, no fill glow, nothing that reads as earned. */}
                  <circle
                    cx={x}
                    cy={y}
                    r={8}
                    fill="rgba(255,255,255,0.05)"
                    stroke="rgba(255,255,255,0.30)"
                    strokeWidth={1.2}
                    className="transition-[fill,stroke] group-hover:fill-white/[0.10] group-hover:stroke-white/50"
                  />
                  <circle cx={x} cy={y} r={2.4} fill="rgba(255,255,255,0.22)" />
                </>
              )}

              {/* Origin is a badge ON the body — never a different body. */}
              {community && (
                <>
                  <circle
                    cx={x + 13}
                    cy={y - 13}
                    r={6}
                    fill="#0b0d14"
                    stroke={MAP_PALETTE.violetCore}
                    strokeWidth={1}
                  />
                  <text
                    x={x + 13}
                    y={y - 10.5}
                    textAnchor="middle"
                    style={{ fontSize: 7, fontFamily: 'ui-monospace, monospace' }}
                    fill="#b3a8ff"
                  >
                    C
                  </text>
                  <title>Community — published by a Member</title>
                </>
              )}

              {/* The label is the Lesson's name. Never called a star in copy. */}
              <text
                x={x}
                y={y + 48}
                textAnchor="middle"
                style={{ fontSize: 11.5 }}
                fill={touched ? '#e8edf8' : '#98a3bd'}
                className="group-hover:fill-[#e8edf8] group-focus-visible:fill-[#e8edf8]"
              >
                {lesson.title.length > 20 ? `${lesson.title.slice(0, 19)}…` : lesson.title}
              </text>

              {/* Meta only where there is something earned to report. */}
              {touched && (
                <text
                  x={x}
                  y={y + 62}
                  textAnchor="middle"
                  style={{
                    fontSize: 8.5,
                    letterSpacing: '0.8px',
                    fontFamily: 'ui-monospace, monospace',
                  }}
                  fill="#7c88a6"
                >
                  {done
                    ? `${cleared} / ${total} CLEARED`
                    : `${cleared} / ${total} · YOU ARE HERE`}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      </div>

      {/* Colour alone must not carry meaning. */}
      <ul className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-quiet">
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#fff3d6]" /> Cleared
        </li>
        <li className="flex items-center gap-2">
          {/* Inline, because a Tailwind arbitrary value cannot read a constant —
              and the legend swatch must be the same violet as the body it
              explains, or the legend is decoration. */}
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: MAP_PALETTE.violetEdge }}
          />{' '}
          You are here
        </li>
        <li className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full border border-[#232838] bg-[#080a10]"
          />{' '}
          Not yet
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#00d2d3]" /> Contributions
        </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
