import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Light, Mark } from './light';
import { downstream, layoutStars, starKey, startHere, upstream, type CourseLink, type Star } from './constellation';

/**
 * The course as a sky: every idea a star, every prerequisite a faint line.
 *
 * Lectures stand left to right, their ideas top to bottom. Point at a star
 * and what it builds on lights up, all the way back; what builds on it
 * brightens ahead; the rest of the sky dims. If a foundation under it is
 * still red or dark, the card says where to start. Every star opens the
 * reader at its idea's first page.
 */

interface Lecture {
  id: string;
  title: string;
  total_slides: number;
  ideas: { name: string; first_page: number }[] | null;
}

interface Props {
  lectures: Lecture[];
  marks: Mark[];
  links: CourseLink[];
  linksState: 'idle' | 'loading' | 'ready' | 'error';
  readHref: (lectureId: string, page: number) => string;
}

const W = 1000;
const H = 460;
const LABEL_H = 54;

const FILL: Record<Light, string> = {
  lit: 'hsl(var(--success))',
  fading: 'hsl(var(--success) / 0.45)',
  weak: 'hsl(var(--destructive))',
  dark: '#050505',
};

const WORD: Record<Light, string> = {
  lit: 'Tested right',
  fading: 'Fading',
  weak: 'To revisit',
  dark: 'Not tested yet',
};

export function CourseMap({ lectures, marks, links, linksState, readHref }: Props) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [focus, setFocus] = useState<string | null>(null);
  const stars = useMemo(() => layoutStars(lectures, marks, W, H), [lectures, marks]);
  const byKey = useMemo(() => new Map(stars.map((s) => [s.key, s])), [stars]);

  const up = useMemo(() => new Set(focus ? upstream(focus, links) : []), [focus, links]);
  const down = useMemo(() => new Set(focus ? downstream(focus, links) : []), [focus, links]);
  const star = focus ? byKey.get(focus) : undefined;
  const begin = focus ? startHere(focus, links, stars) : null;
  const direct = focus
    ? links.filter((l) => starKey(l.to.lecture_id, l.to.first_page) === focus).map((l) => ({ star: byKey.get(starKey(l.from.lecture_id, l.from.first_page)), why: l.why }))
    : [];

  /* An edge lit when it lies on the path behind the focused star, or leads out of it. */
  const edgeState = (l: CourseLink): 'path' | 'ahead' | 'rest' | 'idle' => {
    if (!focus) return 'idle';
    const from = starKey(l.from.lecture_id, l.from.first_page);
    const to = starKey(l.to.lecture_id, l.to.first_page);
    if ((to === focus || up.has(to)) && (up.has(from) || from === focus)) return 'path';
    if (from === focus) return 'ahead';
    return 'rest';
  };

  const open = (s: Star) => navigate(readHref(s.lectureId, s.firstPage));
  const colW = W / Math.max(1, lectures.length);

  return (
    <div>
      {/* The sky scrolls sideways on a narrow screen rather than squeezing its stars together. */}
      <div className="-mx-2 overflow-x-auto px-2 [scrollbar-width:thin]">
        <svg
          viewBox={`0 0 ${W} ${H + LABEL_H}`}
          role="group"
          aria-label="Map of the course's ideas and what builds on what"
          className="block w-full min-w-[720px]"
          onMouseLeave={() => setFocus(null)}
        >
          {/* Prerequisite lines, faint until a star asks for them. */}
          <g fill="none">
            {links.map((l, i) => {
              const a = byKey.get(starKey(l.from.lecture_id, l.from.first_page));
              const b = byKey.get(starKey(l.to.lecture_id, l.to.first_page));
              if (!a || !b) return null;
              const state = edgeState(l);
              const dx = Math.max(30, Math.abs(b.x - a.x) * 0.5);
              return (
                <motion.path
                  key={i}
                  d={`M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`}
                  stroke={state === 'path' ? 'var(--stage-accent, #fff)' : '#fff'}
                  strokeWidth={state === 'path' ? 1.6 : 1}
                  initial={reduce ? false : { pathLength: 0, opacity: 0 }}
                  animate={{
                    pathLength: 1,
                    opacity: state === 'path' ? 0.9 : state === 'ahead' ? 0.45 : state === 'rest' ? 0.04 : 0.1,
                  }}
                  transition={{ pathLength: { duration: reduce ? 0 : 1.2, delay: reduce ? 0 : 0.2 + i * 0.004 }, opacity: { duration: 0.25 } }}
                />
              );
            })}
          </g>

          {/* The stars. */}
          {stars.map((s) => {
            const on = s.key === focus;
            const near = on || up.has(s.key) || down.has(s.key);
            const dim = focus !== null && !near;
            return (
              <g
                key={s.key}
                role="link"
                tabIndex={0}
                aria-label={`${s.name}, ${s.lectureTitle}, ${WORD[s.light].toLowerCase()}`}
                className="console-focusable cursor-pointer outline-none"
                onMouseEnter={() => setFocus(s.key)}
                onFocus={() => setFocus(s.key)}
                onClick={() => open(s)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open(s);
                  }
                }}
              >
                {/* A wider target than the star itself. */}
                <circle cx={s.x} cy={s.y} r={Math.max(14, s.r + 8)} fill="transparent" />
                {(s.light === 'lit' || s.light === 'weak') && (
                  <circle cx={s.x} cy={s.y} r={s.r * 2.6} fill={FILL[s.light]} opacity={dim ? 0.03 : 0.14} />
                )}
                <motion.circle
                  cx={s.x}
                  cy={s.y}
                  r={s.r}
                  fill={FILL[s.light]}
                  stroke={s.light === 'dark' ? 'rgba(255,255,255,0.45)' : 'none'}
                  strokeWidth={1.2}
                  initial={false}
                  animate={{ opacity: dim ? 0.18 : 1, scale: on ? 1.35 : 1 }}
                  style={{ transformOrigin: `${s.x}px ${s.y}px` }}
                  transition={{ duration: 0.2 }}
                />
                {on && <circle cx={s.x} cy={s.y} r={s.r + 6} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={1} />}
              </g>
            );
          })}

          {/* Lecture names under their columns. */}
          {lectures.map((l, i) => (
            <text
              key={l.id}
              x={colW * (i + 0.5)}
              y={H + 26}
              textAnchor="middle"
              className="fill-[hsl(var(--muted-foreground))] text-[11px]"
              opacity={star && star.lectureId !== l.id ? 0.45 : 0.9}
            >
              <tspan x={colW * (i + 0.5)}>{i + 1}</tspan>
              <tspan x={colW * (i + 0.5)} dy="14">
                {l.title.length > 16 ? `${l.title.slice(0, 15)}…` : l.title}
              </tspan>
            </text>
          ))}
        </svg>
      </div>

      {/* The card: what this idea is, what it stands on, and where to start. */}
      <div className="mt-3 min-h-[132px]">
        <AnimatePresence mode="wait" initial={false}>
          {star ? (
            <motion.div
              key={star.key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="rounded-3xl border border-white/[0.08] bg-[#0b0b0c] p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-[17px] font-medium text-foreground">{star.name}</p>
                <p className="text-[12.5px] text-quiet">
                  {star.lectureTitle}
                  <span aria-hidden className="mx-1.5 text-faint">·</span>
                  <span className={cn(star.light === 'weak' && 'text-destructive', (star.light === 'lit' || star.light === 'fading') && 'text-success')}>
                    {WORD[star.light]}
                  </span>
                </p>
              </div>
              {direct.length > 0 ? (
                <p className="mt-2 text-[13.5px] leading-[1.55] text-quiet">
                  Builds on{' '}
                  {direct.map((d, i) =>
                    d.star ? (
                      <span key={d.star.key}>
                        {i > 0 && (i === direct.length - 1 ? ' and ' : ', ')}
                        <span className={cn('text-foreground', d.star.light === 'weak' && 'text-destructive')}>{d.star.name}</span>
                      </span>
                    ) : null,
                  )}
                  {direct[0]?.why && <span className="text-faint"> — {direct[0].why}</span>}
                </p>
              ) : (
                <p className="mt-2 text-[13.5px] text-quiet">A starting point: it needs nothing earlier in the course.</p>
              )}
              {begin && (
                <button
                  type="button"
                  onClick={() => open(begin)}
                  className="console-focusable mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[13px] font-medium text-background transition-colors"
                >
                  Start with {begin.name} — it's {begin.light === 'weak' ? 'red' : 'not tested yet'}
                  <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                </button>
              )}
            </motion.div>
          ) : (
            <motion.p
              key="hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-1 pt-2 text-[13.5px] text-quiet"
            >
              {linksState === 'loading'
                ? 'Working out which ideas build on which…'
                : linksState === 'error'
                  ? 'The connections between ideas could not be mapped just now — the stars still open their pages.'
                  : 'Point at an idea to see what it builds on. Press it to read it.'}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
