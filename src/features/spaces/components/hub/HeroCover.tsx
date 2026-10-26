import { useMemo } from 'react';
import { motion } from 'motion/react';
import type { Space } from '../../types';
import { Planet } from '../sky/Planet';
import { seededRandom } from '../sky/seed';

/**
 * The hero's art: the selected Space as a planet, on the black stage.
 *
 * This file used to paint a full-bleed radial gradient per Space, hashed from
 * its id, with a giant initial and three scrims over it. Abi, 2026-10-26: the
 * colours washed the whole page ("moss" green behind a database course) and
 * broke the monochrome stage. The night sky replaces them — one planet whose
 * moons are the Space's Lessons, lit gold as you finish them — and the stage
 * stays black. No gradient, no scrim, no letter.
 *
 * It fades on the same 180ms beat as the hero's copy (`swapping`), so the
 * picture and the words turn over together. Opacity only: the planet does not
 * move, it is replaced.
 */

/** What a Space's planet shows, from the hub's own fields. */
export const planetOf = (space: Space) => {
  const glow = Math.max(0, Math.min(1, space.viewerProgress / 100));
  return {
    lessonCount: space.lessonCount,
    lessonsDone: Math.round(glow * space.lessonCount),
    glow,
    // "You are here" belongs to a Space you are in.
    current: space.viewerRole !== null,
    seed: space.id,
  };
};

export function HeroCover({ space, swapping }: { space?: Space; swapping: boolean }) {
  return (
    <motion.div
      aria-hidden
      data-hero-art
      className="pointer-events-none absolute right-[22px] top-[11vh] w-[42vw] max-w-[380px] md:right-[7%] md:top-[26vh] md:w-[30vw]"
      initial={false}
      animate={{ opacity: swapping ? 0 : 1 }}
      transition={{ duration: 0.2 }}
    >
      {space ? (
        <Planet size={210} {...planetOf(space)} className="h-auto w-full" />
      ) : (
        <StarCluster seed="discover" className="h-auto w-full" />
      )}
    </motion.div>
  );
}

/**
 * Discover is not a Space, so it is not a planet: a loose cluster of stars —
 * everything out there you have not visited yet.
 */
export function StarCluster({ seed, className, count = 9 }: { seed: string; className?: string; count?: number }) {
  const stars = useMemo(() => {
    const rand = seededRandom(seed);
    return Array.from({ length: count }, () => {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * 34;
      return { x: 50 + Math.cos(a) * d * 1.4, y: 32 + Math.sin(a) * d * 0.7, r: 0.9 + rand() * 1.6, o: 0.3 + rand() * 0.45 };
    });
  }, [seed, count]);
  return (
    <svg aria-hidden data-star-cluster viewBox="0 0 100 64" className={className}>
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#ffffff" opacity={s.o} />
      ))}
    </svg>
  );
}
