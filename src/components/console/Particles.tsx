import { useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';

interface ParticlesProps {
  /** How many motes to scatter. Keep small — these are ambient, not a focus. */
  count?: number;
}

/**
 * Faint drifting dust motes for the ambient depth layer. Purely decorative and
 * pointer-transparent; disabled entirely under prefers-reduced-motion.
 */
export function Particles({ count = 22 }: ParticlesProps) {
  const reduceMotion = useReducedMotion();

  // Deterministic-enough scatter computed once per mount.
  const motes = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: `${(i * 37) % 100}%`,
        top: `${(i * 53) % 100}%`,
        size: 1 + (i % 3),
        duration: 9 + (i % 7),
        delay: -(i % 11),
      })),
    [count],
  );

  if (reduceMotion) return null;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {motes.map((m, i) => (
        <span
          key={i}
          className="depth-particle"
          style={{
            left: m.left,
            top: m.top,
            width: m.size,
            height: m.size,
            animationDuration: `${m.duration}s`,
            animationDelay: `${m.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
