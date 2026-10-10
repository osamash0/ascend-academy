import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

/**
 * The lecture's ideas as one strip along the top edge of the slide.
 *
 * One segment per idea, as wide as the idea is long in pages. Ideas behind
 * you are filled, the one you are in fills in the lecture's colour as you
 * read through it, the ones ahead are empty — the whole deck's shape and
 * where you are in it, at a glance, in the width of the page itself.
 * Pointing at a segment names it in the label; pressing it goes there.
 *
 * It replaced the spine at the right edge, which fanned names out over the
 * slide and said nothing about how far along you were.
 */

export interface Chapter {
  id: string;
  name: string;
  first: number;
  last: number;
}

/** Ideas as page ranges: each runs to the page before the next one starts. */
export function chaptersOf(sections: { conceptId: string; name: string; blocks: { page: number }[] }[], pages: number): Chapter[] {
  const starts = sections
    .map((s) => ({ id: s.conceptId, name: s.name, first: Math.min(...s.blocks.map((b) => b.page)) }))
    .filter((s) => Number.isFinite(s.first))
    .sort((a, b) => a.first - b.first);
  return starts.map((s, i) => ({ ...s, last: Math.max(s.first, (starts[i + 1]?.first ?? pages + 1) - 1) }));
}

interface Props {
  chapters: Chapter[];
  page: number;
  onJump: (page: number) => void;
  /** What a checkpoint or rehearsal said about each idea, in chapter order. */
  lights?: ('lit' | 'weak' | 'dark')[];
}

export function ChapterStrip({ chapters, page, onJump, lights = [] }: Props) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  if (chapters.length < 2) return null;
  const at = Math.max(
    0,
    chapters.findIndex((c) => page >= c.first && page <= c.last),
  );
  const shown = hover ?? at;
  const label = chapters[shown];
  /* Said in words: how much of the idea you are in is still ahead. */
  const ahead = chapters[at].last - page;
  const left = ahead <= 0 ? 'Last page of this idea' : `${ahead} ${ahead === 1 ? 'page' : 'pages'} left in this idea`;

  return (
    <nav aria-label="Ideas in this lecture" className="w-full" onPointerLeave={() => setHover(null)}>
      <div className="mb-2 flex h-[18px] items-baseline justify-between gap-4 overflow-hidden text-[12.5px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={label.id}
            initial={{ opacity: 0, y: reduce ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -4 }}
            transition={{ duration: 0.16 }}
            className={cn('min-w-0 truncate', hover !== null && hover !== at ? 'text-quiet' : 'text-foreground')}
          >
            <span className="text-faint">
              Idea {shown + 1} of {chapters.length}
            </span>
            <span aria-hidden className="mx-2 text-faint">·</span>
            {label.name}
          </motion.p>
        </AnimatePresence>
        <p className="shrink-0 tabular-nums text-faint">
          {lights[shown] === 'lit' && <span className="mr-1.5 text-success">Tested right ·</span>}
          {lights[shown] === 'weak' && <span className="mr-1.5 text-destructive">To revisit ·</span>}
          {shown === at ? left : `Pages ${label.first}–${label.last} · click to go there`}
        </p>
      </div>
      <ol className="flex items-center gap-[3px]">
        {chapters.map((c, i) => {
          const span = c.last - c.first + 1;
          const fill = i < at ? 1 : i > at ? 0 : (page - c.first + 1) / span;
          return (
            <li key={c.id} className="min-w-[6px]" style={{ flexGrow: span, flexBasis: 0 }}>
              <button
                type="button"
                onClick={() => onJump(c.first)}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${c.name}, pages ${c.first} to ${c.last}${lights[i] === 'lit' ? ', tested right' : lights[i] === 'weak' ? ', to revisit' : ''}`}
                aria-current={i === at ? 'location' : undefined}
                className="console-focusable group flex h-4 w-full items-center rounded-sm"
              >
                <span
                  className={cn(
                    'relative block h-[3px] w-full overflow-hidden rounded-full transition-colors',
                    hover === i ? 'bg-white/[0.3]' : 'bg-white/[0.12]',
                  )}
                >
                  {/* A lit idea glows along its whole length, under the reading fill. */}
                  {lights[i] && lights[i] !== 'dark' && (
                    <span
                      aria-hidden
                      className={cn('absolute inset-0 rounded-full', lights[i] === 'lit' ? 'bg-success/60' : 'bg-destructive/50')}
                    />
                  )}
                  <motion.span
                    className="absolute inset-y-0 left-0 w-full origin-left rounded-full"
                    style={{
                      /* Read past: the idea's light, if a check has said; otherwise plain. */
                      background:
                        i === at
                          ? 'var(--reader-accent, hsl(var(--secondary)))'
                          : lights[i] === 'lit'
                            ? 'hsl(var(--success))'
                            : lights[i] === 'weak'
                              ? 'hsl(var(--destructive))'
                              : 'rgba(255,255,255,0.45)',
                    }}
                    initial={false}
                    animate={{ scaleX: fill }}
                    transition={{ duration: reduce ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
