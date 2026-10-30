import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { seededRandom } from './seed';

/**
 * A faint field of stars behind a night-sky screen.
 *
 * Seeded from a string, so the same screen has the same sky on every render
 * and every visit — a sky that reshuffles on each paint reads as noise, not
 * as a place. Tiny dots, low opacity: atmosphere, never content. The map's
 * slop warning still holds ("treating the cosmos as texture — nebula
 * gradients, ambient purple haze"), so there is no haze, no colour and no
 * gradient here — only points of light.
 *
 * A few stars breathe very slowly. Not under reduced motion: that is checked
 * here, because `MotionConfig reducedMotion="user"` deliberately keeps opacity
 * animations, and a twinkle is nothing but opacity.
 */

interface Star {
  x: number;
  y: number;
  r: number;
  o: number;
  twinkle: boolean;
  dur: number;
}

export const starsFor = (seed: string, count: number): Star[] => {
  const rand = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => ({
    x: rand() * 100,
    y: rand() * 100,
    r: 0.5 + rand() * 0.8,
    o: 0.25 + rand() * 0.35,
    twinkle: i % 7 === 0,
    dur: 5 + rand() * 6,
  }));
};

export function StarField({
  seed,
  count = 60,
  className,
}: {
  seed: string;
  /** 40–80 reads as a sky; more starts to read as noise. */
  count?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const stars = useMemo(() => starsFor(seed, count), [seed, count]);
  return (
    <svg
      aria-hidden
      data-starfield={seed}
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
      width="100%"
      height="100%"
    >
      {stars.map((s, i) =>
        s.twinkle && !reduce ? (
          <motion.circle
            key={i}
            cx={`${s.x}%`}
            cy={`${s.y}%`}
            r={s.r}
            fill="#ffffff"
            initial={{ opacity: s.o }}
            animate={{ opacity: [s.o, s.o * 0.35, s.o] }}
            transition={{ duration: s.dur, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : (
          <circle key={i} cx={`${s.x}%`} cy={`${s.y}%`} r={s.r} fill="#ffffff" opacity={s.o} />
        ),
      )}
    </svg>
  );
}
