import { useMemo } from 'react';
import { motion } from 'motion/react';
import type { Space } from '../../types';
import { SpaceWindow, windowOf } from '../sky/SpaceWindow';
import { seededRandom } from '../sky/seed';

/**
 * The hero's art: the selected Space, seen through a round window onto its
 * own first page, on the black stage.
 *
 * This file used to paint a full-bleed radial gradient per Space, hashed from
 * its id (Abi, 2026-10-26: "the gradient is awful"), and then, briefly, a
 * planet. Neither came from the Space. The window does: page 1 of its first
 * Lesson, in calm black and white, with the gold ring of your progress.
 *
 * It fades on the same 180ms beat as the hero's copy (`swapping`), so the
 * picture and the words turn over together. Opacity only.
 */
export function HeroCover({ space, swapping }: { space?: Space; swapping: boolean }) {
  return (
    <motion.div
      aria-hidden
      data-hero-art
      className="pointer-events-none absolute right-[22px] top-[13vh] w-[38vw] max-w-[340px] md:right-[8%] md:top-[24vh] md:w-[26vw]"
      initial={false}
      animate={{ opacity: swapping ? 0 : 1 }}
      transition={{ duration: 0.2 }}
    >
      {space ? (
        <SpaceWindow key={space.id} size={340} {...windowOf(space)} lifted className="h-auto w-full" />
      ) : (
        <StarCluster seed="discover" className="h-auto w-full" />
      )}
    </motion.div>
  );
}

/**
 * Discover is not a Space, so it has no page: a loose cluster of stars —
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
