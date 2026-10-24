import { motion, useReducedMotion } from 'motion/react';

/**
 * First run's progress, as lights rather than "1 of 2" (the Practice idiom).
 * Held steps glow in the chosen light, the current one is white and breathes,
 * the rest wait dim. When the light changes, the held ones change with it.
 */
export function Segments({
  total,
  current,
  label,
  valueText,
  accent,
}: {
  total: number;
  /** Zero-based index of the step on screen. */
  current: number;
  label: string;
  valueText: string;
  /** The held steps' colour; white until a light is chosen. */
  accent?: string | null;
}) {
  const reduce = useReducedMotion();
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current + 1}
      aria-valuetext={valueText}
      className="flex w-[96px] gap-1.5"
    >
      {Array.from({ length: total }, (_, i) => {
        const state = i < current ? 'held' : i === current ? 'current' : 'waiting';
        return (
          <motion.span
            key={i}
            data-testid="segment"
            data-state={state}
            className="h-1.5 flex-1 rounded-full"
            style={{
              background:
                state === 'held' ? accent ?? '#ffffff' : state === 'current' ? '#ffffff' : 'rgba(255,255,255,0.14)',
              transition: 'background 600ms ease',
            }}
            animate={state === 'current' && !reduce ? { opacity: [1, 0.55, 1] } : { opacity: 1 }}
            transition={state === 'current' && !reduce ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } : undefined}
          />
        );
      })}
    </div>
  );
}
